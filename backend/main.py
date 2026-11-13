import asyncio
import base64
import hmac
import json
import logging
import os
import ssl
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from fastapi.staticfiles import StaticFiles
from typing import Dict, List, Optional


# 统一从 .env 读取配置：优先 backend/.env，其次项目根 .env（若存在）。
# 必须在 import db/keys/auth 之前执行，因为这三个模块在导入期就会读环境变量。
# override=False：不覆盖已存在的真实环境变量（命令行 / systemd 注入优先），
# 因此命令行显式传入的值仍可覆盖文件中的值。
def _load_env_files():
    backend_dir = os.path.dirname(os.path.abspath(__file__))
    root_env = os.path.join(os.path.dirname(backend_dir), ".env")
    backend_env = os.path.join(backend_dir, ".env")
    for path in (backend_env, root_env):
        if not os.path.exists(path):
            continue
        try:
            # 优先使用 python-dotenv（仓库已可选依赖）；未安装时回退到极简解析器
            from dotenv import load_dotenv
            load_dotenv(path, override=False)
            continue
        except ImportError:
            pass
        try:
            with open(path, "r", encoding="utf-8") as fh:
                for raw in fh:
                    line = raw.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, _, val = line.partition("=")
                    key, val = key.strip(), val.strip().strip('"').strip("'")
                    if key and key not in os.environ:
                        os.environ[key] = val
        except FileNotFoundError:
            pass


_load_env_files()

import monitor
from db import create_database
from keys import get_allowed_keys, PUBLIC_ROOM
from auth import set_db, resolve_principal_room, register_auth_routes, JWT_SECRET
from starlette.middleware.sessions import SessionMiddleware

# 初始化日志记录系统
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("NexusSync")

#: 服务版本，/api/health 会带回，便于确认线上跑的是哪份产物
VERSION = "1.0.0"
#: 进程启动时间，用于计算 uptime
START_TIME = time.time()

# ============================================================
# 平台级封面图库配置
# ------------------------------------------------------------
# 作为平台运营时，图库 Access Key 由管理员在 backend/.env（或环境变量）里
# 一次性配置：UNSPLASH_ACCESS_KEY=xxx。密钥只在服务端使用，永不下发浏览器，
# 用户打开封面选择器即可直接用，无需各自申请 / 填写 Key。
# 未配置时 /api/cover/config 返回 enabled=false，前端回退到「自填 Key」旧路径。
# ============================================================
UNSPLASH_ACCESS_KEY = (os.getenv("UNSPLASH_ACCESS_KEY") or "").strip()
UNSPLASH_API = "https://api.unsplash.com"

# 出站 HTTPS 的证书配置。python.org 版 macOS Python / pyenv / 精简容器经常找不到
# 系统根证书（urllib 直接抛 CERTIFICATE_VERIFY_FAILED），企业代理的自签 CA 同理。
# 按「管理员指定 → certifi → 系统常见路径 → OpenSSL 默认」依次回退。
UNSPLASH_CA_BUNDLE = (os.getenv("UNSPLASH_CA_BUNDLE") or os.getenv("SSL_CERT_FILE") or "").strip()
UNSPLASH_INSECURE = (os.getenv("UNSPLASH_INSECURE") or "").strip().lower() in ("1", "true", "yes")


def _cover_ssl_context() -> "ssl.SSLContext":
    if UNSPLASH_INSECURE:
        # 仅用于受控内网 / 本地调试：跳过校验会把 Access Key 暴露给中间人，
        # 必须由管理员显式开启，绝不默认启用。
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        return ctx

    candidates = [UNSPLASH_CA_BUNDLE]
    try:
        import certifi
        candidates.append(certifi.where())
    except Exception:
        pass
    candidates += [
        "/private/etc/ssl/cert.pem",            # macOS 系统根证书
        "/etc/ssl/certs/ca-certificates.crt",   # Debian / Ubuntu
        "/etc/pki/tls/certs/ca-bundle.crt",     # RHEL / CentOS
        "/etc/ssl/cert.pem",
    ]
    for path in candidates:
        if not path or not os.path.isfile(path):
            continue
        try:
            ctx = ssl.create_default_context(cafile=path)
            if ctx.get_ca_certs():              # 确认真的加载到了证书，而不是空文件
                return ctx
        except (OSError, ssl.SSLError):
            continue
    return ssl.create_default_context()         # 最后交给 OpenSSL 默认路径

COVER_CACHE_TTL = 600          # 随机精选批的缓存时长（秒），避免反复打开选择器耗尽 API 配额
COVER_FETCH_COUNT = 30         # 一次向图库取多少张，过滤掉已用过的之后仍有余量
_cover_cache: Dict[str, tuple] = {}   # (room|query) -> (ts, photos)

# ============================================================
# 多租户鉴权（阶段四：上云 / 公网服务）
# ------------------------------------------------------------
# 每个 key = 一个独立租户房间(room)；room = sha256(key)。
# 相同 key 的多台设备属于同一用户 → 互相实时同步；不同 key 之间数据完全隔离。
# 密钥的加载 / 校验 / 吊销统一由 keys.py 负责（改 keys.json 热生效）。
#
# 客户端把密钥放在：REST → `Authorization: Bearer <key>` 或 `?api_key=<key>`；
#                   WS   → 握手 query `?api_key=<key>`（浏览器 WS 不能自定义 header）。
# ============================================================


def _extract_token(authorization: str, api_key: str) -> str:
    """从 Authorization 头或 ?api_key= query 里取出密钥。"""
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    if api_key:
        return api_key.strip()
    return ""


async def get_room(
    authorization: str = Header(default=""),
    api_key: str = Query(default="", alias="api_key"),
) -> str:
    """REST 路由依赖：解析当前请求的 room。

    优先识别账户 JWT（resolve_principal_room），否则回退到 legacy API Key；
    两者都返回 room 字符串，因此现有所有 handler 无需改动。
    未配置任何 key 且非合法 JWT 时返回 401。"""
    token = _extract_token(authorization, api_key)
    room = await resolve_principal_room(token)
    if room is None:
        raise HTTPException(status_code=401, detail="Unauthorized: missing or invalid API key / token")
    return room


# CORS：默认放开（兼容本地 / 内网），公网部署请用 CORS_ORIGINS 收紧到具体前端源。
# 注意：allow_origins=["*"] 时不能带 credentials（浏览器拒绝），故二者联动。
_raw_origins = (os.getenv("CORS_ORIGINS") or "*").strip()
if _raw_origins == "*":
    CORS_ORIGINS: List[str] = ["*"]
else:
    CORS_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()] or ["*"]

# Capacitor 原生 App 的 WebView 源固定为 localhost 类保留源，必须默认放行：
# 否则 App 内所有跨域 REST 请求（/api/auth/config、/api/me、/api/pages、资产接口…）
# 拿不到 Access-Control-Allow-Origin，OPTIONS 预检直接 400，表现为「地址配好了仍连不上」。
# 这些源只可能由设备本机 WebView 发出，不是公网第三方，不构成额外的 CSRF 暴露面。
# 注意：即使 CORS_ORIGINS 被收紧成公网域名（如 https://nexus.example.com），
# 也自动追加这些原生源，避免运维漏配导致安卓 App 整体不可用。
_CAPACITOR_ORIGINS = [
    "https://localhost", "http://localhost",
    "capacitor://localhost", "ionic://localhost", "app://localhost",
]
if CORS_ORIGINS != ["*"]:
    CORS_ORIGINS = list(dict.fromkeys(CORS_ORIGINS + _CAPACITOR_ORIGINS))

_ALLOW_CREDENTIALS = CORS_ORIGINS != ["*"]

from contextlib import asynccontextmanager


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动事件：初始化数据库并登记本实例的鉴权 / 后端信息（原 on_event("startup") 迁移至此）
    await db.init()
    entries = get_allowed_keys()
    active = sum(1 for e in entries.values() if not e.get("revoked"))
    mode = "开放(无鉴权)" if active == 0 else f"多租户(有效 key {active} 个)"
    logger.info(f"[NEXUS] 版本={VERSION} 鉴权模式={mode} 后端={db.backend_name} CORS={CORS_ORIGINS}")
    yield
    # 关闭事件：释放数据库连接（原 on_event("shutdown") 迁移至此）
    await db.close()


app = FastAPI(title="Nexus Matrix Sync Server", version=VERSION, lifespan=lifespan)

# 会话中间件：OAuth 的 state/CSRF 校验依赖它（authlib 把 state 存在 session cookie 里）。
# 放在 CORS 之内、路由之外，保证所有请求都能读写 session。
app.add_middleware(SessionMiddleware, secret_key=JWT_SECRET)

# 真正注册 CORS 中间件：上面只是算出 CORS_ORIGINS，不 add_middleware 的话跨域请求
# 永远不会带 Access-Control-Allow-Origin，导致「浏览器在隧道域名、后端地址填了
# localhost:8010」这类跨域场景直接被 CORS 拦死（报 No 'Access-Control-Allow-Origin'）。
# 默认放开；公网部署请用 CORS_ORIGINS 环境变量收紧到具体前端源。
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=_ALLOW_CREDENTIALS,
    allow_methods=["*"],
    allow_headers=["*"],
)

# GZip 压缩 API 响应：/api/pages 首拉全量经上一步剔除墓碑后仍达数 MB，经 Cloudflare 隧道 /
# 移动网络极易被拖垮或丢弃。JSON 压缩率极高（3.6MB -> ~1MB），让 HTTP 首拉路径更抗代理。
# 仅压缩 >=512 字节的响应；WebSocket 不受影响（Starlette GZip 只作用于 HTTP 作用域）。
from fastapi.middleware.gzip import GZipMiddleware
app.add_middleware(GZipMiddleware, minimum_size=512)

# 数据持久层：由 DATABASE_URL 决定 SQLite / Postgres，业务代码不感知
db = create_database()
# 把 db 单例交给 auth 层（避免与 main 循环 import）
set_db(db)

# 管理面板令牌：设置后 /api/admin/* 与 /admin 需携带；留空则面板禁用（返回 503）。
ADMIN_TOKEN = (os.getenv("ADMIN_TOKEN") or "").strip()


async def require_admin(request: Request) -> bool:
    """保护管理端点：?token= 或 Authorization: Bearer 携带 ADMIN_TOKEN。"""
    if not ADMIN_TOKEN:
        raise HTTPException(status_code=503, detail="admin panel disabled (set ADMIN_TOKEN)")
    token = request.query_params.get("token") or ""
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        token = auth[7:].strip() or token
    if not token or not hmac.compare_digest(token, ADMIN_TOKEN):
        raise HTTPException(status_code=401, detail="invalid admin token")
    return True


@app.middleware("http")
async def _metrics_middleware(request: Request, call_next):
    """计数 + 错误捕获 + 慢请求记录：给 /api/health 与 /api/metrics 提供素材。"""
    monitor.record_request()
    start = time.time()
    try:
        response = await call_next(request)
        if response.status_code >= 500:
            monitor.record_error(f"{request.method} {request.url.path} -> {response.status_code}")
        return response
    except Exception as e:
        monitor.record_error(f"{request.method} {request.url.path}: {e}")
        raise
    finally:
        elapsed_ms = (time.time() - start) * 1000
        if elapsed_ms >= 1000:
            monitor.record_slow_request(request.url.path, elapsed_ms)


# ============================================================
# 同步语义：时间戳归一化 / 水位戳 / 块级 LWW 合并
# （存储细节全在 db.py，这里只管同步逻辑）
# ============================================================


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _norm_ts(ts) -> str:
    """统一为 ISO 字符串，便于 LWW（最后写入胜出）比较。"""
    if isinstance(ts, (int, float)):
        return datetime.fromtimestamp(ts / 1000, timezone.utc).isoformat()
    return ts or _now_iso()


def _norm_ms(ts) -> int:
    """时间戳 → ms 整数；缺戳返回 0（绝不返回 now，否则旧快照会被抬成最新）。"""
    if not ts:
        return 0
    try:
        return int(datetime.fromisoformat(_norm_ts(ts)).timestamp() * 1000)
    except Exception:
        return 0


def _field_ms(page: Dict, field: str, page_ms: int) -> int:
    """字段级版本戳；存量数据没有 fieldTs 时回退到整页时间戳。"""
    ft = page.get("fieldTs")
    if isinstance(ft, dict):
        v = ft.get(field)
        if isinstance(v, (int, float)) and v > 0:
            return int(v)
    return page_ms


def _ts_of(page: Dict) -> str:
    """页面用于 LWW 比较的时间戳。

    墓碑（deletedAt）优先：删除是一种「带外时间戳」的终态，
    若只看 updatedAt，可能出现「A 端删除 / B 端之后编辑」时删除被编辑覆盖、
    或反过来删除一直复活的情况。谁的时间更晚谁生效，语义才一致。
    """
    deleted = _norm_ts(page.get("deletedAt")) if page.get("deletedAt") else ""
    if deleted:
        return deleted
    # 缺时间戳必须返回「零值」：_norm_ts(None) 会返回当前时间，把一条没有戳的
    # 旧快照抬成最新，ACK 的采纳判定与水位计算都会整体失真。
    return _norm_ts(page.get("updatedAt")) if page.get("updatedAt") else "0"


async def _water_mark(room: str, pages: Optional[List[Dict]] = None) -> int:
    """该 room 的高水位戳（ms）。传入 pages 可复用已有数据，避免重复读库。"""
    if pages is None:
        pages = await db.load_pages(room)
    wm = 0
    for p in pages:
        ts = _ts_of(p)
        try:
            ms = int(datetime.fromisoformat(ts).timestamp() * 1000)
        except Exception:
            ms = 0
        wm = max(wm, ms)
    return wm


async def _persist_page(page: Dict, room: str) -> None:
    """落库前统一归一化 updatedAt，保证 LWW 比较基准一致。"""
    page["updatedAt"] = _norm_ts(page.get("updatedAt"))
    await db.save_page(page, room)


def _page_fingerprint(page: Dict) -> str:
    """页面内容指纹，用于判断「这一页是否真的变了」。

    sort_keys 使结果与字段插入顺序无关；default=str 兜住 datetime 之类
    非 JSON 原生类型，避免比对时抛异常。
    """
    return json.dumps(page, sort_keys=True, ensure_ascii=False, default=str)


def _changed_pages(merged: List[Dict], existing: Dict[str, Dict]) -> List[Dict]:
    """从合并结果里挑出真正发生变化的页。

    _merge_pages 返回的是「incoming ∪ 服务端现有页」的全量并集，但通常
    只有一两页真的变了。这里按指纹过滤，只保留新增页与内容有差异的页，
    使落库 / 广播的开销从 O(该房间全部页) 降为 O(变更页)。

    判定偏保守：只要指纹不一致就算变更，宁可多写一次也不会漏写。
    """
    changed: List[Dict] = []
    for p in merged:
        pid = p.get("id")
        cur = existing.get(pid) if pid else None
        if cur is None or _page_fingerprint(cur) != _page_fingerprint(p):
            changed.append(p)
    return changed


def _heal_prev_id_chain(tasks: List[Dict]) -> List[Dict]:
    """阶段三 F7：prevId 链自愈。

    三端并发编辑靠「prevId 链」确定性重建块顺序。但一个坏/旧客户端可能推送
    成环、断链、或 prevId 指向不存在块的链。若不处理，坏链会被原样入库并
    广播给所有端，导致各端 orderTasks 行为不一致。

    策略：仅当链是「合法单链」（恰好一个头、无环、无悬空 prevId）时才原样保留；
    否则按数组下标顺序重置为一条合法链（与前端 writePrevIds 等价），保证入库
    数据对任意端都是确定性可还原的。墓碑块不参与链，统一挪到末尾。
    """
    if not tasks:
        return tasks
    dead = [t for t in tasks if t.get("deletedAt")]
    live = [t for t in tasks if not t.get("deletedAt")]
    if not dead:
        return _heal_chain(live)
    return _heal_chain(live) + dead


def _heal_chain(live: List[Dict]) -> List[Dict]:
    """对活块做链自愈（墓碑已在外部剥离）。"""
    if not live:
        return live
    ids = {t.get("id") for t in live}
    if len(ids) != len(live):
        # 存在重复 id（数据已损坏），按数组顺序强制重置链，去重交由上层 LWW
        return [dict(t, prevId=(live[i - 1]["id"] if i > 0 else None)) for i, t in enumerate(live)]
    heads = [t for t in live if not t.get("prevId") or t.get("prevId") not in ids]
    if len(heads) != 1:
        return [dict(t, prevId=(live[i - 1]["id"] if i > 0 else None)) for i, t in enumerate(live)]
    # 单头：沿链走一遍，检测环与断链
    seen = set()
    cur = heads[0]
    while cur is not None:
        tid = cur.get("id")
        if tid in seen:  # 成环
            return [dict(t, prevId=(live[i - 1]["id"] if i > 0 else None)) for i, t in enumerate(live)]
        seen.add(tid)
        nxt = next((t for t in live if t.get("prevId") == tid), None)
        cur = nxt
    if len(seen) != len(live):  # 断链（有游离块）
        return [dict(t, prevId=(live[i - 1]["id"] if i > 0 else None)) for i, t in enumerate(live)]
    return live  # 合法单链，原样保留


# 页面标量字段（对齐前端 useSync.ts 的 PAGE_SCALAR_FIELDS）
# 必须与前端 useSync.ts 的 PAGE_SCALAR_FIELDS 完全一致：漏一个字段就有一类
# 用户操作（页面排序 prevId、封面取景 coverPos、模板标记 isTemplate）永远不同步。
PAGE_SCALAR_FIELDS = [
    "title", "icon", "cover", "coverPos", "coverMeta", "parentId", "isFavorite",
    "isTemplate", "prevId",
]

# 纯本机视图态（对齐前端 LOCAL_ONLY_FIELDS）：目录树展开/折叠不跨设备传播，
# 否则一端折叠会把另一端刚展开的树整组冲掉。老客户端仍可能上推该字段，写入口统一剥离。
LOCAL_ONLY_FIELDS = ("isExpanded",)


def _merge_pages(incoming: List[Dict], existing_pages: List[Dict]) -> List[Dict]:
    """块级 LWW 合并，语义对齐前端 mergePages。

    将 incoming（某客户端上推的页）合并进服务端「该 room 现有页」，而不是整页替换——
    这样「先到达服务端的设备编辑的块」不会被「后到的整页」覆盖，
    新设备 INITIAL_SYNC 拉到的才是块级合并后的真实状态。

    - 删除：墓碑 deletedAt 优先；远端删除戳不比本地更晚时才剔除该页；
    - 页面标量：按各字段自己的 fieldTs 严格较新（>）才采用，互不牵连；
      存量数据无 fieldTs 时回退整页 updatedAt，保持与老客户端兼容；
    - 块级：逐块比较 block.updatedAt，>= 取远端；本地缺失的块直接加入。
    阶段三 F7：合并后对每页 tasks 做 prevId 链自愈。
    """
    existing = {p["id"]: p for p in existing_pages}
    merged: Dict[str, Dict] = {}

    def _scalar_lww(base: Dict, other: Dict) -> None:
        """逐字段版本化 LWW（就地改写 base）。

        旧实现整组标量共用 page.updatedAt：A 换封面、B 改图标时，时间戳更晚的
        一方会把对方刚做的选择整组冲掉。现在每个字段用自己的 fieldTs 裁决，
        因此两台设备的不同选择都能同时存活。
        """
        base_ms = _norm_ms(base.get("updatedAt"))
        other_ms = _norm_ms(other.get("updatedAt"))
        base_ft = base.get("fieldTs") if isinstance(base.get("fieldTs"), dict) else {}
        next_ft: Dict[str, int] = {
            f: int(v) for f, v in base_ft.items()
            if isinstance(v, (int, float)) and v > 0
        }

        for f in PAGE_SCALAR_FIELDS:
            if _field_ms(other, f, other_ms) <= _field_ms(base, f, base_ms):
                continue
            if f in other:
                base[f] = other[f]
            elif f in base:
                if f == "title":
                    # 标题缺失只可能是旧数据 / 异常快照，不当成「清空标题」：
                    # 用户主动清空会写 ""（字段仍存在），无需 pop。否则服务端
                    # 会丢掉标题，各端同步后标题栏都变成「无标题」。
                    continue
                # 客户端把字段设成 undefined 时 JSON 会省略该键：视为「明确删除」。
                # 否则「移除封面 / 清除图标 / 取消模板」在服务端永远清不掉，
                # 新设备 INITIAL_SYNC 拉到的仍是旧值（删了又复活）。
                base.pop(f)
            next_ft[f] = _field_ms(other, f, other_ms)

        other_ft = other.get("fieldTs") if isinstance(other.get("fieldTs"), dict) else {}
        for f, v in other_ft.items():
            if f in PAGE_SCALAR_FIELDS and isinstance(v, (int, float)) and v > next_ft.get(f, 0):
                next_ft[f] = int(v)
        if next_ft:
            base["fieldTs"] = next_ft
        # 水位戳必须覆盖「字段级变更后采纳的版本」：否则远端字段戳更晚、
        # 整页 updatedAt 却更旧时，游标不前进，断线重连用 since 拉增量会漏掉这次选择。
        ceiling = max([base_ms, other_ms] + list(next_ft.values()))
        if ceiling > base_ms:
            base["updatedAt"] = _norm_ts(ceiling)

    def _tasks_lww(base_tasks, other_tasks):
        """以 base 为基，叠加 other 中更新或新增的块；尊重块级墓碑。

        块级墓碑（deletedAt）是「整页替换型导入 / 去重」能真正删除旧块的唯一途径：
        服务端原本是只增不减的并集，本地独有的旧块永远不会被它移除——这正是
        反复导入导致内容翻倍的元凶。让 tombstone 随上推一并到达服务端即可就地删除。
        """
        out = [dict(t) for t in (base_tasks or [])]
        by_id = {t.get("id"): t for t in out}
        for ot in (other_tasks or []):
            oid = ot.get("id")
            if oid is None:
                continue
            if ot.get("deletedAt"):
                # 远端墓碑：本地有该块则打上删除戳；本地没有则不新增死块
                bt = by_id.get(oid)
                if bt is not None:
                    bt["deletedAt"] = ot["deletedAt"]
                    if ot.get("updatedAt") is not None:
                        bt["updatedAt"] = ot["updatedAt"]
                continue
            bt = by_id.get(oid)
            if bt is None:
                out.append(dict(ot))           # 另一端新增的块
            elif bt.get("deletedAt"):
                # 【多端删除错乱修复】服务端已经记着这个块被删了，另一端发来的
                # 只是删除发生前的旧活块（它还没收到/应用墓碑）。旧逻辑 bt.update(ot)
                # 会用旧内容覆盖并让块看起来又活了，广播给各端就是「边删边复活」。
                # 只有另一端确实在删除之后又编辑了它，才允许清除墓碑复活。
                # 注意 _norm_ts(None) 会返回「当前时间」，绝不能直接喂给它缺省值，
                # 否则一个没有 updatedAt 的旧活块会被误判为「比墓碑更新」而复活。
                bt_del = _norm_ts(bt["deletedAt"]) if bt.get("deletedAt") else "0"
                ot_ts = _norm_ts(ot["updatedAt"]) if ot.get("updatedAt") else "0"
                if ot_ts > bt_del:
                    bt.pop("deletedAt", None)
                    bt.update(ot)
            elif (_norm_ts(ot["updatedAt"]) if ot.get("updatedAt") else "0") >= (
                _norm_ts(bt["updatedAt"]) if bt.get("updatedAt") else "0"
            ):
                bt.update(ot)                  # 远端块更新 → 浅合并覆盖
        # 墓碑块不参与 prevId 链，统一挪到末尾，避免其 prevId=null 破坏活块顺序
        dead = [t for t in out if t.get("deletedAt")]
        if dead:
            out = [t for t in out if not t.get("deletedAt")] + dead
        return out

    seen: set = set()
    for inc in incoming:
        pid = inc.get("id")
        if not pid:
            continue
        seen.add(pid)
        cur = existing.get(pid)

        # 墓碑优先：远端删除戳不比本地更晚时剔除该页
        inc_del = _norm_ts(inc.get("deletedAt")) if inc.get("deletedAt") else ""
        if inc_del:
            if cur is None:
                continue
            cur_del = _norm_ts(cur.get("deletedAt")) if cur.get("deletedAt") else ""
            if cur_del and cur_del > inc_del:
                merged[pid] = cur              # 本地后删，保留本地
                continue
            # 远端墓碑生效：就地给现有页打上删除戳，再放进结果集。
            # 旧实现在这里直接 continue 丢弃该页，导致服务端始终保留「活着的」
            # 旧页，并在下次 INITIAL_SYNC 时推回各端 —— 即「删了又复活」。
            tombstoned = {k: (list(v) if isinstance(v, list) else v) for k, v in cur.items()}
            tombstoned["deletedAt"] = inc_del
            tombstoned["updatedAt"] = inc_del
            merged[pid] = tombstoned
            continue

        if cur is None:
            inc["updatedAt"] = _norm_ts(inc.get("updatedAt"))
            merged[pid] = inc
            continue

        # 两端都存在且未删：以 cur 为基，把 inc 合入（对齐前端"合入 local"）
        merged_page = {k: (list(v) if isinstance(v, list) else v) for k, v in cur.items()}
        _scalar_lww(merged_page, inc)
        merged_page["tasks"] = _tasks_lww(merged_page.get("tasks", []), inc.get("tasks", []))
        merged[pid] = merged_page

    # 保留仅存在于服务端的页（其他设备创建、且 incoming 未提及的）
    for pid, p in existing.items():
        if pid not in merged and pid not in seen:
            merged[pid] = p

    # 阶段三 F7：对合并结果中每个页做 prevId 链自愈
    for p in merged.values():
        if isinstance(p.get("tasks"), list):
            p["tasks"] = _heal_prev_id_chain(p["tasks"])
    return list(merged.values())


# ============================================================
# WebSocket 连接管理：按 room 分桶，广播只发同 room 的设备（租户隔离核心）
# ============================================================
class ConnectionManager:
    def __init__(self):
        self.rooms: Dict[str, List[WebSocket]] = {}
        self._ws_room: Dict[WebSocket, str] = {}

    async def connect(self, websocket: WebSocket, room: str) -> None:
        await websocket.accept()
        self.rooms.setdefault(room, []).append(websocket)
        self._ws_room[websocket] = room
        logger.info(f"设备建立连接 room={room[:8]}… 在线设备数: {len(self.rooms.get(room, []))}")
        await self.broadcast_device_count(room)

    def disconnect(self, websocket: WebSocket) -> None:
        room = self._ws_room.pop(websocket, None)
        if room and websocket in self.rooms.get(room, []):
            self.rooms[room].remove(websocket)
            if not self.rooms[room]:
                self.rooms.pop(room, None)
        logger.info(
            f"设备断开连接 room={(room or '?')[:8]}… "
            f"在线设备数: {len(self.rooms.get(room, [])) if room else 0}"
        )

    async def _send_or_drop(self, connection: WebSocket, message: str) -> None:
        """向单个连接发送；失败即判定为死连接并移除（静默，不刷 error）。"""
        try:
            await connection.send_text(message)
        except Exception:
            room = self._ws_room.get(connection)
            if room and connection in self.rooms.get(room, []):
                self.rooms[room].remove(connection)

    async def broadcast_device_count(self, room: str) -> None:
        conns = self.rooms.get(room, [])
        msg = json.dumps({"type": "DEVICE_COUNT", "data": len(conns)})
        for connection in list(conns):
            await self._send_or_drop(connection, msg)

    async def broadcast(self, message: str, room: str, sender: Optional[WebSocket] = None) -> None:
        # 仅向同 room 的其它连接广播（排除发送者自身，防止回环反射）。
        # 用副本遍历 + _send_or_drop：避免遍历中移除导致跳过元素，并静默清理死连接。
        for connection in list(self.rooms.get(room, [])):
            if connection != sender:
                await self._send_or_drop(connection, message)
        monitor.record_broadcast()


manager = ConnectionManager()


# ============================================================
# 跨设备「会话接力」：按 room 保存轻量 UI 状态（当前文档 / 最近访问）
#
# 与文档数据不同，这类状态描述的是「用户当下正在做的事」，不做实时强推：
#   - 设备建连 / REST 握手时下发一次，由客户端决定是否在冷启动恢复；
#   - 已在线设备的当前屏幕永远不被远端覆盖，只更新「最近访问」列表。
# 用独立 JSON 文件持久化（不塞进 pages 表，也不必给两种 DB 后端各写一套）；
# 与 ConnectionManager 同属单进程语义，文件只用于后端重启后仍能接力。
# ============================================================
SESSION_RECENT_MAX = 12
_SESSION_PATH = os.getenv("SESSION_STATE_PATH") or os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "session_state.json"
)
_session_store: Dict[str, Dict] = {}
_session_loaded = False


def _load_session_store() -> Dict[str, Dict]:
    global _session_loaded
    if not _session_loaded:
        _session_loaded = True
        try:
            with open(_SESSION_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                _session_store.update({k: v for k, v in data.items() if isinstance(v, dict)})
        except (OSError, ValueError):
            pass  # 首次运行 / 文件损坏：退化为纯内存
    return _session_store


def _save_session_store() -> None:
    tmp = _SESSION_PATH + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(_session_store, f, ensure_ascii=False)
        os.replace(tmp, _SESSION_PATH)
    except OSError as e:
        logger.warning(f"会话状态落盘失败（仅本次进程有效）：{e}")


def _session_key(room: str) -> str:
    # room 是账号/房间标识，不把明文写进文件
    return hmac.new(str(JWT_SECRET).encode("utf-8"), room.encode("utf-8"), "sha256").hexdigest()


def _read_session(room: str) -> Dict:
    state = _load_session_store().get(_session_key(room))
    if not isinstance(state, dict):
        return {"activePageId": None, "recentPageIds": [], "updatedAt": 0}
    recent = state.get("recentPageIds")
    return {
        "activePageId": state.get("activePageId") if isinstance(state.get("activePageId"), str) else None,
        "recentPageIds": [x for x in recent if isinstance(x, str)][:SESSION_RECENT_MAX] if isinstance(recent, list) else [],
        "updatedAt": int(state.get("updatedAt") or 0),
    }


def _merge_session(room: str, raw: Dict) -> Dict:
    """按客户端上报的时间戳做 LWW；最近访问取并集，避免一台设备抹掉另一台的本地记录。"""
    source = raw if isinstance(raw, dict) else {}
    active = source.get("activePageId")
    active = active if isinstance(active, str) and 0 < len(active) <= 128 else None
    reported = source.get("recentPageIds")
    reported = [x for x in reported if isinstance(x, str) and 0 < len(x) <= 128][:SESSION_RECENT_MAX] if isinstance(reported, list) else []
    client_ts = source.get("updatedAt")
    client_ts = int(client_ts) if isinstance(client_ts, (int, float)) and client_ts > 0 else 0

    cur = _read_session(room)
    # 迟到的离线补报不能盖掉更新的会话（例如另一台设备之后又打开了别的文档）
    if client_ts and client_ts <= cur["updatedAt"]:
        return cur

    recent: List[str] = []
    for pid in reported + cur["recentPageIds"]:
        if pid not in recent:
            recent.append(pid)
        if len(recent) >= SESSION_RECENT_MAX:
            break
    state = {
        "activePageId": active or cur["activePageId"],
        "recentPageIds": recent,
        "updatedAt": max(int(time.time() * 1000), client_ts),
    }
    _load_session_store()[_session_key(room)] = state
    _save_session_store()
    return state


def _session_broadcast_payload(state: Dict) -> str:
    return json.dumps({"type": "SESSION_STATE", "data": state}, ensure_ascii=False)


# SERVER_BROADCAST 单帧字节上限：Cloudflare / 隧道对超大 WS 帧会静默丢弃，
# 这正是「REST 写完后整房间一帧全量广播」在公网环境下时灵时不灵的原因。
# 与 INITIAL_SYNC 同理按页切分；每帧都是完整的页子集，前端 mergePages 是
# 并集合并且逐帧串行应用，未提及的页保持原样。
BROADCAST_MAX_BYTES = 96 * 1024


def _split_broadcast_chunks(pages: List[Dict]) -> List[List[Dict]]:
    chunks: List[List[Dict]] = []
    buf: List[Dict] = []
    buf_bytes = 0
    for p in pages:
        pb = len(json.dumps(p, ensure_ascii=False).encode("utf-8"))
        if buf and buf_bytes + pb > BROADCAST_MAX_BYTES:
            chunks.append(buf)
            buf = []
            buf_bytes = 0
        buf.append(p)
        buf_bytes += pb
    if buf:
        chunks.append(buf)
    return chunks


async def _broadcast_pages(
    room: str, pages: List[Dict], sender: Optional[WebSocket] = None
) -> None:
    """增量 + 分片广播：只发本次真正变化的页，且按字节切成小帧。

    sender 由 WS 通道传入以排除发起者；REST 通道没有 socket，广播给所有在线
    设备（数据已由同一写入口落库，接收端合并后不会产生回环）。
    """
    if not pages or not manager.rooms.get(room):
        return
    for chunk in _split_broadcast_chunks(pages):
        await manager.broadcast(
            json.dumps({"type": "SERVER_BROADCAST", "data": chunk}, ensure_ascii=False),
            room=room,
            sender=sender,
        )


async def _apply_incoming(
    room: str,
    incoming_list: List[Dict],
    sender: Optional[WebSocket] = None,
    existing_pages: Optional[List[Dict]] = None,
) -> List[Dict]:
    """服务端唯一写入口：WS CLIENT_UPDATE 与 REST POST / PUT / DELETE 全部走这里。

    统一「读现状 → 块级合并 → 挑出变更页 → 落库 → 增量分片广播」五步。
    此前三个 REST 端点各自手写整页覆盖 / 无条件刷时间戳 / 全量广播，
    与 WS 的合并语义完全不同，制造出「新建页在另一台设备不出现」这类竞态。
    """
    if existing_pages is None:
        existing_pages = await db.load_pages(room)
    existing_snap = {p["id"]: p for p in existing_pages}
    # 老客户端仍可能把本机视图态带上来；统一在写入口剥离，避免入库后又广播出去。
    cleaned = [
        {k: v for k, v in dict(p).items() if k not in LOCAL_ONLY_FIELDS}
        for p in incoming_list
    ]
    merged = _merge_pages(cleaned, existing_pages)
    changed = _changed_pages(merged, existing_snap)
    for p in changed:
        await _persist_page(p, room)
    await _broadcast_pages(room, changed, sender=sender)
    return changed


@app.get("/api/health")
async def health(response: Response):
    """健康检查 + 简单运行时指标。

    刻意**不做鉴权**：负载均衡 / uptime 监控通常不带 API key。
    因此这里只暴露聚合计数（页数 / 资产数 / 房间数 / 连接数 / 错误数），
    不含任何用户内容，也不暴露 key。
    """
    db_error: Optional[str] = None
    try:
        db_ok = await db.ping()
    except Exception as e:  # ping 内部已兜底，这里再兜一层
        db_ok = False
        db_error = str(e)
        monitor.record_error(f"health ping: {e}")

    room_count = len(manager.rooms)
    conn_count = sum(len(v) for v in manager.rooms.values())

    status = "ok" if db_ok else "degraded"
    if status != "ok":
        response.status_code = 503

    return {
        "status": status,
        "version": VERSION,
        "backend": db.backend_name,
        "db": "up" if db_ok else "down",
        "db_error": db_error,
        "uptime_seconds": round(time.time() - START_TIME, 1),
        "rooms": room_count,
        "connections": conn_count,
        "metrics": monitor.snapshot(),
    }


@app.get("/api/metrics")
async def metrics_prometheus():
    """Prometheus 文本格式（exposition format v0.0.4）的指标导出。

    Prometheus 抓取配置示例：
        scrape_configs:
          - job_name: nexus
            metrics_path: /api/metrics
            static_configs:
              - targets: ['127.0.0.1:8010']

    同样**不做鉴权**，建议在反向代理层限制只允许内网 / 监控网访问。
    """
    try:
        db_ok = await db.ping()
    except Exception:
        db_ok = False
    extra: List[Dict[str, object]] = [
        {"name": "nexus_db_up", "help": "数据库连通性（1=通，0=断）", "type": "gauge",
         "value": 1.0 if db_ok else 0.0},
        {"name": "nexus_rooms", "help": "当前在线房间数", "type": "gauge", "value": len(manager.rooms)},
        {"name": "nexus_connections", "help": "当前 WebSocket 连接总数", "type": "gauge",
         "value": sum(len(v) for v in manager.rooms.values())},
    ]
    return PlainTextResponse(
        monitor.render_prometheus(extra),
        media_type="text/plain; version=0.0.4; charset=utf-8",
    )


# ============================================================
# 管理面板（受 ADMIN_TOKEN 保护）
# ============================================================
@app.get("/api/admin/dashboard")
async def admin_dashboard(_: bool = Depends(require_admin)):
    """聚合概览：性能 / 用量 / 异常，供 /admin 页或外部监控拉取。"""
    try:
        db_ok = await db.ping()
    except Exception:
        db_ok = False
    stats: Dict[str, int] = {}
    try:
        stats = await db.get_stats()
    except Exception as e:
        monitor.record_error(f"admin get_stats: {e}")
    bs = monitor.business_snapshot()
    return {
        "version": VERSION,
        "backend": db.backend_name,
        "db_up": db_ok,
        "uptime_seconds": round(time.time() - START_TIME, 1),
        "live_rooms": len(manager.rooms),
        "live_connections": sum(len(v) for v in manager.rooms.values()),
        "db_stats": stats,
        "monitor": bs,
    }


@app.get("/admin")
async def admin_page(_: bool = Depends(require_admin)):
    """极简管理面板页面（数据内联，无需额外静态资源）。"""
    try:
        db_ok = await db.ping()
    except Exception:
        db_ok = False
    stats: Dict[str, int] = {}
    try:
        stats = await db.get_stats()
    except Exception as e:
        monitor.record_error(f"admin get_stats: {e}")
    bs = monitor.business_snapshot()
    data = {
        "version": VERSION,
        "backend": db.backend_name,
        "db_up": db_ok,
        "uptime_seconds": round(time.time() - START_TIME, 1),
        "live_rooms": len(manager.rooms),
        "live_connections": sum(len(v) for v in manager.rooms.values()),
        "db_stats": stats,
        "monitor": bs,
    }
    return _render_admin_html(data)


def _render_admin_html(d: Dict) -> "HTMLResponse":
    """生成深色主题管理面板 HTML（指标由后端内联，纯展示）。"""
    def _fmt_bytes(n: int) -> str:
        n = int(n or 0)
        for unit in ("B", "KB", "MB", "GB", "TB"):
            if n < 1024 or unit == "TB":
                return f"{n:.1f} {unit}" if unit != "B" else f"{n} B"
            n /= 1024
        return str(n)

    s = d.get("db_stats", {})
    m = d.get("monitor", {})
    error_rate = m.get("error_rate", 0)
    slow_top = m.get("slow_top", [])
    slow_rows = "".join(
        f"<tr><td class='p'>{x['path']}</td><td>{x['ms']:.0f} ms</td><td>{x['at']}</td></tr>"
        for x in slow_top
    ) or "<tr><td colspan='3' class='dim'>暂无</td></tr>"

    cards = [
        ("数据库", "up" if d["db_up"] else "down", "OK" if d["db_up"] else "断"),
        ("后端", d["backend"], ""),
        ("版本", d["version"], ""),
        ("运行时长", f"{d['uptime_seconds']:.0f}s", ""),
        ("在线房间(WS)", d["live_rooms"], ""),
        ("WS 连接数", d["live_connections"], ""),
        ("注册用户", s.get("users_total", 0), ""),
        ("工作区(room)", s.get("rooms_total", 0), ""),
        ("页面总数", s.get("pages_total", 0), ""),
        ("资产数", s.get("assets_total", 0), ""),
        ("资产存储", _fmt_bytes(s.get("assets_bytes_total", 0)), ""),
        ("成员关系", s.get("memberships_total", 0), ""),
        ("邀请链接", s.get("invite_links_total", 0), ""),
        ("累计请求", m.get("requests", 0), ""),
        ("累计错误", m.get("errors", 0), ""),
        ("错误率", f"{error_rate*100:.2f}%", ""),
        ("同步冲突", m.get("sync_conflicts", 0), ""),
        ("资产上传", m.get("asset_uploads", 0), ""),
        ("登录成功", m.get("logins", 0), ""),
        ("登录失败", m.get("login_failures", 0), ""),
        ("慢请求(≥1s)", m.get("slow_requests", 0), ""),
        ("WS 消息", m.get("ws_messages", 0), ""),
    ]
    card_html = "".join(
        f"<div class='card'><div class='k'>{k}</div><div class='v {c}'>{v}</div></div>"
        for (k, v, c) in cards
    )
    last_err = m.get("last_error")
    last_err_at = m.get("last_error_at")
    err_html = (
        f"<div class='err'>最近错误：<b>{last_err}</b><br><span class='dim'>{last_err_at}</span></div>"
        if last_err else "<div class='err dim'>最近无错误</div>"
    )
    html = f"""<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Nexus Matrix · 管理面板</title>
<style>
*{{box-sizing:border-box}}
body{{margin:0;background:#0e0f13;color:#e6e7ea;font:13px/1.5 'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace}}
.wrap{{max-width:1080px;margin:0 auto;padding:24px}}
h1{{font-size:18px;margin:0 0 4px}}
.sub{{color:#8a8f98;margin-bottom:18px}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}}
.card{{background:#16181d;border:1px solid #23262d;border-radius:6px;padding:12px}}
.k{{color:#8a8f98;font-size:11px}}
.v{{font-size:20px;margin-top:4px}}
.v.up{{color:#3fb950}}.v.down{{color:#f85149}}
section{{margin-top:22px}}
h2{{font-size:14px;color:#c9cdd4;border-bottom:1px solid #23262d;padding-bottom:6px}}
table{{width:100%;border-collapse:collapse;margin-top:8px}}
th,td{{text-align:left;padding:6px 8px;border-bottom:1px solid #1c1f26;font-size:12px}}
th{{color:#8a8f98;font-weight:400}}
.p{{color:#e6e7ea}}
.dim{{color:#6b7079}}
.err{{margin-top:14px;padding:10px 12px;background:#16181d;border:1px solid #23262d;border-radius:6px}}
.foot{{margin-top:24px;color:#6b7079;font-size:11px}}
</style></head><body><div class="wrap">
<h1>Nexus Matrix · 管理面板</h1>
<div class="sub">性能 / 用量 / 异常一览（指标为进程内计数器，重启清零；多实例需外部聚合）</div>
<div class="grid">{card_html}</div>
<section><h2>异常 · 慢请求 TopN</h2>
<table><thead><tr><th>路径</th><th>耗时</th><th>时间(UTC)</th></tr></thead>
<tbody>{slow_rows}</tbody></table>
{err_html}
</section>
<div class="foot">说明：本面板仅展示聚合计数与运行指标，不含任何用户内容。如需持久化审计/告警，请接 Prometheus + Grafana（/api/metrics 已导出）。</div>
</div></body></html>"""
    from fastapi.responses import HTMLResponse
    return HTMLResponse(html)


# 身份自述：返回当前密钥对应的房间信息（数据量 / 在线设备数）。
# 前端「保存同步配置」时用它即时校验三态：连不通 / 密钥被拒(401) / 已连但房间为空。
@app.get("/api/me")
async def me(room: str = Depends(get_room)):
    pages = await db.load_pages(room)
    live = [p for p in pages if not p.get("deletedAt")]
    return {
        "ok": True,
        "room_label": room[:8] if room != PUBLIC_ROOM else "public",
        "page_count": len(live),
        "device_count": len(manager.rooms.get(room, [])),
        "auth_required": bool(get_allowed_keys()),
    }


# ============================================================
# 封面图库代理：平台 Access Key 只在服务端使用，永不下发浏览器
# ============================================================
def _unsplash_get(path: str):
    """同步调用 Unsplash，放到线程池里跑；client_id 由服务端注入。"""
    sep = "&" if "?" in path else "?"
    url = f"{UNSPLASH_API}{path}{sep}client_id={urllib.parse.quote(UNSPLASH_ACCESS_KEY)}"
    req = urllib.request.Request(url, headers={
        "Accept": "application/json",
        "User-Agent": "NexusMatrix/1.0",
    })
    try:
        with urllib.request.urlopen(req, timeout=12, context=_cover_ssl_context()) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        code = getattr(e, "code", None)
        if code == 401:
            raise RuntimeError("平台配置的 Unsplash Key 无效")
        if code == 403:
            raise RuntimeError("Unsplash 访问被拒（速率限制或应用被限制）")
        # URLError 会把 SSLCertVerificationError 包进字符串，两种特征一起识别；
        # 否则用户只看到一串英文堆栈，不知道该改哪里。
        if isinstance(e, ssl.SSLCertVerificationError) or "CERTIFICATE_VERIFY_FAILED" in str(e).upper():
            raise RuntimeError(
                "图库 HTTPS 证书校验失败：请在 backend/.env 设置 "
                "UNSPLASH_CA_BUNDLE=<CA 文件>（macOS: /private/etc/ssl/cert.pem；"
                "Linux: /etc/ssl/certs/ca-certificates.crt），或安装 certifi 后重启后端；"
                "受控内网可临时设 UNSPLASH_INSECURE=1（跳过校验，有风险）"
            )
        raise RuntimeError(f"Unsplash 请求失败：{code or e}")


def _cover_sized(raw: str, w: int, h: int = 0) -> str:
    """在 urls.raw 上叠加尺寸参数，保留原有 query（尤其合规要求的 ixid）。"""
    if not raw:
        return ""
    u = urllib.parse.urlsplit(raw)
    q = [(k, v) for k, v in urllib.parse.parse_qsl(u.query, keep_blank_values=True)
         if k not in ("w", "h", "fit", "q", "crop")]
    q += [("w", str(w)), ("fit", "crop" if h else "max"), ("q", "80")]
    if h:
        q += [("h", str(h)), ("crop", "faces,entropy")]
    return urllib.parse.urlunsplit((u.scheme, u.netloc, u.path, urllib.parse.urlencode(q), u.fragment))


def _cover_map(p: Dict) -> Dict:
    raw = (p.get("urls") or {}).get("raw") or ""
    user = p.get("user") or {}
    width, height = p.get("width") or 0, p.get("height") or 0
    return {
        "id": p.get("id") or "",
        "author": user.get("name") or "Unknown",
        "authorUrl": (user.get("links") or {}).get("html") or "https://unsplash.com",
        "thumbUrl": _cover_sized(raw, 400, 150),
        "fullUrl": _cover_sized(raw, 1600),
        "aspect": (width / height) if width and height else None,
        "dimensions": f"{width} × {height}" if width and height else None,
        "sourceUrl": (p.get("links") or {}).get("html") or "https://unsplash.com",
    }


@app.get("/api/cover/config")
async def cover_config():
    """不鉴权：只暴露能力开关，绝不返回密钥本身。纯本地模式也能探测。"""
    return {
        "enabled": bool(UNSPLASH_ACCESS_KEY),
        "provider": "unsplash",
        "needsKey": False,
    }


@app.get("/api/cover/gallery")
async def cover_gallery(
    query: str = "",
    exclude: str = "",
    refresh: int = 0,
    room: str = Depends(get_room),
):
    """返回一批「本账号文档里没用过」的封面候选。

    exclude 是前端从全部 pages 的 coverMeta.photoId 收集来的已用图片 id，
    服务端过滤后再返回，保证每次打开选择器看到的都是新鲜封面。
    随机精选批按 room 缓存，避免反复打开面板耗尽 Unsplash 的每小时配额。
    """
    if not UNSPLASH_ACCESS_KEY:
        return {"success": False, "error": "平台尚未配置 UNSPLASH_ACCESS_KEY", "data": []}

    q = query.strip()
    excluded = {x for x in (exclude or "").split(",") if x}
    cache_key = f"{room}|{q.lower()}"

    def fetch() -> List[Dict]:
        if q:
            path = f"/search/photos?query={urllib.parse.quote(q)}&page=1&per_page={COVER_FETCH_COUNT}"
            raw_list = (_unsplash_get(path) or {}).get("results") or []
        else:
            path = f"/photos/random?count={COVER_FETCH_COUNT}"
            data = _unsplash_get(path)
            raw_list = data if isinstance(data, list) else ([data] if data else [])
        return [_cover_map(p) for p in raw_list if isinstance(p, dict) and p.get("id")]

    try:
        now = time.time()
        cached = _cover_cache.get(cache_key)
        use_cache = bool(cached) and not refresh and (now - cached[0]) < COVER_CACHE_TTL
        photos = cached[1] if use_cache else await asyncio.to_thread(fetch)
        if not use_cache:
            _cover_cache[cache_key] = (now, photos)

        items = [p for p in photos if p["id"] not in excluded][:24]
        if not items and excluded:
            # 缓存里的图恰好全被用过：强制回源再取一批，不让用户看到空面板
            photos = await asyncio.to_thread(fetch)
            _cover_cache[cache_key] = (time.time(), photos)
            items = [p for p in photos if p["id"] not in excluded][:24]
        return {"success": True, "data": items, "provider": "unsplash"}
    except Exception as e:
        logger.warning(f"封面图库加载失败 room={room[:8]}: {e}")
        return {"success": False, "error": str(e), "data": []}


@app.get("/api/cover/download/{photo_id}")
async def cover_download(photo_id: str, room: str = Depends(get_room)):
    """Unsplash 合规要求：每次选用都要触发 download 计数，由服务端代发。"""
    if not UNSPLASH_ACCESS_KEY:
        return {"success": False}
    try:
        await asyncio.to_thread(
            _unsplash_get, f"/photos/{urllib.parse.quote(photo_id, safe='')}/download"
        )
    except Exception as e:
        logger.warning(f"封面选用计数失败: {e}")
    return {"success": True}


# === 会话接力 REST 兜底 ===
# 原生 WebView / 隧道环境下 WS 可能连不上，握手阶段也要能拿到「另一台设备正在看的文档」。
# PUT 与 WS 的 SESSION_UPDATE 共用 _merge_session，保证两条通道语义一致。
@app.get("/api/session")
async def get_session(room: str = Depends(get_room)):
    return {"success": True, "data": _read_session(room)}


@app.put("/api/session")
async def put_session(payload: Dict, room: str = Depends(get_room)):
    state = _merge_session(room, payload)
    await manager.broadcast(_session_broadcast_payload(state), room=room)
    return {"success": True, "data": state}


# REST API: 获取某 room 的所有页面
# 阶段二 2.2：支持 ?since=<ms 水位戳> 增量拉取。
@app.get("/api/pages")
async def get_pages(since: Optional[int] = None, room: str = Depends(get_room)):
    pages = await db.load_pages(room)
    if since is None:
        # 首拉全量：对全新设备，墓碑(已删页)无意义，剔除以压缩载荷
        #（331 页 -> 128 存活页，9MB -> ~3.6MB），更抗 Cloudflare 隧道 / 移动网络的单响应体积限制。
        # 增量拉取(since>0)仍保留墓碑——其它端删除的页需靠墓碑在本地消化。
        live = [p for p in pages if not p.get("deletedAt")]
        return {"success": True, "data": live, "cursor": await _water_mark(room, live)}
    changed = []
    for p in pages:
        ts = _ts_of(p)
        try:
            ms = int(datetime.fromisoformat(ts).timestamp() * 1000)
        except Exception:
            ms = 0
        if ms > since:
            changed.append(p)
    return {"success": True, "data": changed, "cursor": await _water_mark(room, pages)}


# REST API: 获取单个页面
@app.get("/api/pages/{page_id}")
async def get_page(page_id: str, room: str = Depends(get_room)):
    for page in await db.load_pages(room):
        if page["id"] == page_id:
            return {"success": True, "data": page}
    return {"success": False, "error": "Page not found"}


# REST API：三个端点只负责把 incoming 交给统一写入口，不再自己实现
# 合并 / 时间戳 / 广播，语义与 WS CLIENT_UPDATE 完全一致。
@app.post("/api/pages")
async def create_page(page: Dict, room: str = Depends(get_room)):
    incoming = dict(page)
    incoming["id"] = incoming.get("id") or f"page-{len(await db.load_pages(room)) + 1}-{int(time.time())}"
    incoming.setdefault("title", "未命名子程序")
    incoming.setdefault("tasks", [])
    # 保留客户端时间戳：原先无条件盖 _now_iso()，会让「尚未打戳的空标题快照」
    # 比客户端随后推送的正式快照还新，另一端合并时新页被判成旧数据。
    incoming.setdefault("updatedAt", _now_iso())
    changed = await _apply_incoming(room, [incoming])
    saved = next((p for p in changed if p.get("id") == incoming["id"]), incoming)
    return {"success": True, "data": saved}


@app.put("/api/pages/{page_id}")
async def update_page(page_id: str, page: Dict, room: str = Depends(get_room)):
    incoming = dict(page)
    incoming["id"] = page_id
    incoming.setdefault("updatedAt", _now_iso())
    # 墓碑要能传播：时间戳归一但保留客户端的删除时刻，不能被服务端当前时间盖掉
    if incoming.get("deletedAt"):
        incoming["deletedAt"] = _norm_ts(incoming["deletedAt"])
    changed = await _apply_incoming(room, [incoming])
    saved = next((p for p in changed if p.get("id") == page_id), incoming)
    return {"success": True, "data": saved}


@app.delete("/api/pages/{page_id}")
async def delete_page(page_id: str, room: str = Depends(get_room)):
    ts = _now_iso()
    await _apply_incoming(room, [{"id": page_id, "deletedAt": ts, "updatedAt": ts}])
    return {"success": True, "message": "Page tombstoned"}


# === 阶段二 2.3：图片资产同步端点（按 room 隔离）===
# 页面 JSON 只存 asset:<id> 引用；Blob 二进制走独立端点，避免全量广播塞满 Base64。
@app.post("/api/assets")
async def upload_asset(request: Request, room: str = Depends(get_room)):
    ctype = request.headers.get("content-type", "")
    if "application/json" in ctype:
        body = await request.json()
        aid = (body.get("id") or "").replace("asset:", "")
        b64 = body.get("data", "")
        try:
            blob = base64.b64decode(b64)
        except Exception:
            return {"success": False, "error": "Invalid base64"}
    else:
        form = await request.form()
        f = form.get("file")
        if f is None:
            return {"success": False, "error": "No file"}
        aid = (str(form.get("id") or "")).replace("asset:", "")
        blob = await f.read()
    if not aid:
        aid = f"asset-{int(time.time() * 1000)}-{os.urandom(4).hex()}"
    await db.save_asset(aid, blob, room)
    monitor.record_asset_upload()
    monitor.record_asset_bytes(len(blob))
    # P2 传输层：资产就绪即时通知同 room 的在线设备。此前 B 端 GET 404 后要等
    # 15s 负缓存限流重试才重拉，A 端补传成功到 B 端出图之间有明显空窗。
    await manager.broadcast(
        json.dumps({"type": "ASSET_READY", "assetId": aid}, ensure_ascii=False), room=room
    )
    return {"success": True, "id": f"asset:{aid}"}


@app.get("/api/assets/{asset_id}")
async def download_asset(asset_id: str, room: str = Depends(get_room)):
    blob = await db.get_asset(asset_id.replace("asset:", ""), room)
    if blob is None:
        return Response(status_code=404, content=b"not found")
    return Response(
        content=blob,
        media_type="image/jpeg",
        headers={"Content-Disposition": f"inline; filename={asset_id}", "Cache-Control": "no-store"},
    )


@app.delete("/api/assets/{asset_id}")
async def remove_asset(asset_id: str, room: str = Depends(get_room)):
    await db.delete_asset(asset_id.replace("asset:", ""), room)
    return {"success": True}


# === 资产引用完整性扫描 + GC（Phase 0 资产层止血）===
# pages 只存 asset:<id> 引用，assets 表无「谁引用我」记录，故需主动扫描：
#   - missing_refs：引用了但库里没有 blob → 破图
#   - orphan_assets：库里有但无任何页面引用 → 可回收空间
_ASSET_REF_RE = __import__("re").compile(r"asset:([0-9a-fA-F-]+)")

def _collect_asset_ids(page: dict) -> set:
    """提取页面里所有**无前缀**的 asset id（与 db.list_asset_ids 对齐，便于直接求差集）。"""
    ids: set = set()
    for t in (page.get("tasks") or []):
        if not isinstance(t, dict):
            continue
        pl = t.get("payload") or {}
        u = pl.get("url") if isinstance(pl, dict) else None
        if isinstance(u, str) and u.startswith("asset:"):
            ids.add(u[6:])
        c = t.get("content")
        if isinstance(c, str):
            for m in _ASSET_REF_RE.findall(c):
                ids.add(m)
    cover = page.get("cover")
    if isinstance(cover, str) and cover.startswith("asset:"):
        ids.add(cover[6:])
    return ids

@app.get("/api/assets/integrity")
async def asset_integrity(room: str = Depends(get_room)):
    pages = await db.load_pages(room)
    referenced: set = set()
    for p in pages:
        referenced |= _collect_asset_ids(p)
    asset_ids = set(await db.list_asset_ids(room))
    return {
        "success": True,
        "referenced_count": len(referenced),
        "total_assets": len(asset_ids),
        "missing_refs": sorted(referenced - asset_ids),
        "orphan_assets": sorted(asset_ids - referenced),
    }

@app.post("/api/assets/gc")
async def gc_assets(dry_run: bool = True, room: str = Depends(get_room)):
    pages = await db.load_pages(room)
    referenced: set = set()
    for p in pages:
        referenced |= _collect_asset_ids(p)
    asset_ids = set(await db.list_asset_ids(room))
    orphans = sorted(asset_ids - referenced)
    deleted = 0
    if not dry_run:
        for aid in orphans:
            await db.delete_asset(aid, room)
        await db.vacuum()
        deleted = len(orphans)
    return {"success": True, "dry_run": dry_run, "deleted": deleted, "orphan_count": len(orphans)}


# === 阶段三：墓碑 GC（垃圾回收）===
# 仅清理 deletedAt 早于 retention_days（默认30天）的墓碑；不自动运行，避免误删
# 尚未同步到离线设备的墓碑。
@app.post("/api/admin/gc")
async def gc_tombstones(retention_days: int = 30, room: str = Depends(get_room)):
    cutoff = datetime.now(timezone.utc).timestamp() * 1000 - retention_days * 86400_000
    purged = 0
    kept: List[Dict] = []
    for p in await db.load_pages(room):
        if p.get("deletedAt"):
            ms = 0
            try:
                ms = int(datetime.fromisoformat(_norm_ts(p["deletedAt"])).timestamp() * 1000)
            except Exception:
                ms = 0
            if ms and ms < cutoff:
                await db.delete_page(p["id"], room)
                purged += 1
                continue
        kept.append(p)
    await db.vacuum()
    return {"success": True, "purged": purged, "remaining": len(kept)}


# WS 实时同步路由（按 room 隔离广播）
# INITIAL_SYNC 分片：把「存活页」切成小消息下发。按【字节】切（每片 <= INITIAL_SYNC_MAX_BYTES），
# 而非按页数——否则单帧仍可能达数 MB，在 Cloudflare 隧道 / 移动网络下被丢弃，导致「连上了却拉不下数据」。
INITIAL_SYNC_MAX_BYTES = 128 * 1024
@app.websocket("/ws/sync")
async def websocket_endpoint(websocket: WebSocket):
    # 握手阶段鉴权（浏览器 WebSocket 不能自定义 header，只用 query）
    key = websocket.query_params.get("api_key", "") or ""
    auth = websocket.headers.get("authorization", "")
    token = _extract_token(auth, key)
    room = await resolve_principal_room(token)
    if room is None:
        await websocket.close(code=1008, reason="Unauthorized")
        return
    await manager.connect(websocket, room)

    # 建立连接时，立即将该 room 当前最新数据发给新设备。
    # 只下发「存活页」：墓碑(已删页)对全新设备毫无意义，却会把 INITIAL_SYNC 撑大。
    # 删除事件本就会通过 SERVER_BROADCAST 实时广播，存活态不需要墓碑也能保持一致。
    # 进一步分片下发（按字节预算，每片 <=INITIAL_SYNC_MAX_BYTES）：避免单条 WS 消息过大（十几 MB）
    # 被 Cloudflare 隧道/浏览器丢弃，导致「连上了却拉不下数据」。
    try:
        all_pages = await db.load_pages(room)
        live_pages = [p for p in all_pages if not p.get("deletedAt")]
        # 按字节预算切分：单条 WS 帧 <= INITIAL_SYNC_MAX_BYTES，隧道 / 移动网络友好。
        # 单页若本身超预算也单独成片（不无限循环），由对端整页接收。
        chunks: list = []
        buf: list = []
        buf_bytes = 0
        for p in live_pages:
            pb = len(json.dumps(p, ensure_ascii=False).encode("utf-8"))
            if buf and buf_bytes + pb > INITIAL_SYNC_MAX_BYTES:
                chunks.append(buf)
                buf = []
                buf_bytes = 0
            buf.append(p)
            buf_bytes += pb
        if buf:
            chunks.append(buf)
        chunks = chunks or [[]]
        for idx, chunk in enumerate(chunks):
            await websocket.send_text(json.dumps({
                "type": "INITIAL_SYNC",
                "data": chunk,
                "chunk": idx,
                "chunks": len(chunks),
            }))
        await websocket.send_text(json.dumps({
            "type": "DEVICE_COUNT",
            "data": len(manager.rooms.get(room, [])),
        }))
        # 会话接力：只在建连时下发一次。客户端自己决定要不要在冷启动恢复，
        # 服务端从不向「已在线且正在看某篇文档」的设备强推切页。
        session_snapshot = _read_session(room)
        if session_snapshot["updatedAt"]:
            await websocket.send_text(_session_broadcast_payload(session_snapshot))

        while True:
            # 持续监听各台客户端上报的内容更改
            data = await websocket.receive_text()
            payload = json.loads(data)
            monitor.record_ws_message()

            if payload.get("type") == "SESSION_UPDATE":
                session_state = _merge_session(room, payload.get("data") or {})
                # 广播给其它设备：它们只用这份状态刷新「最近访问」，不切当前页。
                await manager.broadcast(
                    _session_broadcast_payload(session_state), room=room, sender=websocket
                )
                continue

            if payload.get("type") == "CLIENT_UPDATE":
                incoming = payload.get("data")
                incoming_list = incoming if isinstance(incoming, list) else []
                existing_pages = await db.load_pages(room)
                existing_snap = {p["id"]: p for p in existing_pages}
                # 阶段三 ACK 细粒度：本端推送的页若「服务端原本没有」或
                # 「其时间戳 >= 服务端现有页」，即被 LWW 采纳，纳入已确认集合。
                accepted_ids = []
                for inc in incoming_list:
                    pid = inc.get("id")
                    if not pid:
                        continue
                    cur = existing_snap.get(pid)
                    if cur is None or _ts_of(inc) >= _ts_of(cur):
                        accepted_ids.append(pid)

                # 与 REST 共用的唯一写入口：合并 → 落库变更页 → 增量分片广播。
                # 广播是页子集的并集合并语义，发送方由 sender 排除，不产生回环。
                await _apply_incoming(
                    room, incoming_list, sender=websocket, existing_pages=existing_pages
                )

                # 阶段二 2.1：回 ACK 给发送者（cursor = 该 room 当前水位戳）
                await websocket.send_text(json.dumps({
                    "type": "ACK",
                    "cursor": await _water_mark(room),
                    "clientSeq": payload.get("clientSeq"),
                    "acceptedIds": accepted_ids,
                }))

    except WebSocketDisconnect:
        pass
    except Exception as e:
        monitor.record_error(f"ws/room={room[:8]}: {e}")
        logger.error(f"连接中转异常: {e}")
    finally:
        # 无论正常断开还是异常，都确保移除连接并刷新在线数，防止计数只增不减
        manager.disconnect(websocket)
        await manager.broadcast_device_count(room)


# ============================================================
# 前端同源托管：把 frontend/dist/ 挂到 "/"
# ------------------------------------------------------------
# 目的：web 端与 /api、/ws 同源 → 前端请求走相对路径，天然免 CORS、免混合内容；
#       Caddy 只需做 TLS 终止 + 反代，不需要额外放行跨域。
#
# 【挂载顺序是硬约束】必须在**所有 API / WS 路由注册之后**再挂 "/"，
# 否则根路径的通配挂载会把 /api、/ws/sync 也吞掉。本文件自上而下执行，
# 故这段放在文件末尾（__main__ 之前）。
#
# 未构建前端（纯 API 部署）时目录不存在 → 跳过挂载，不影响 API。
# ============================================================
_DIST_DEFAULT = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend", "dist"
)
# STATIC_DIR 若被设成「空字符串」，os.getenv(key, default) 会直接返回 "" 而不回退默认，
# 导致 _FRONTEND_DIST 为空、前端静默不挂载（访问 / 得 404）。这里再加一层兜底：
# 仅当 STATIC_DIR 非空且真实存在时才采用，否则回退默认 dist 路径。
_candidate = os.getenv("STATIC_DIR")
_FRONTEND_DIST = _candidate if (_candidate and os.path.isdir(_candidate)) else _DIST_DEFAULT


def _current_entry_asset(path: str) -> Optional[str]:
    """重新构建后旧 index.html 引用的 index-<hash>.js/css 已不在 dist 里时，
    返回当前构建的同类入口文件。

    每次 vite build 都会清空 dist 并换掉入口 hash：浏览器 / CDN 只要还拿着上一版
    index.html，就会去请求一个不存在的 JS，模块加载失败 → 整页白屏。这里只对
    `assets/index-*.js|css` 做回退；其它带扩展名的资源仍严格 404，不用 HTML 掩盖问题。
    """
    if not path.startswith("assets/"):
        return None
    name = path.rsplit("/", 1)[-1]
    if not name.startswith("index-"):
        return None
    ext = name.rsplit(".", 1)[-1]
    if ext not in ("js", "css"):
        return None
    assets_dir = os.path.join(_FRONTEND_DIST, "assets")
    try:
        candidates = [
            f for f in os.listdir(assets_dir)
            if f.startswith("index-") and f.endswith("." + ext) and f != name
        ]
        if not candidates:
            return None
        newest = max(candidates, key=lambda f: os.path.getmtime(os.path.join(assets_dir, f)))
        return "assets/" + newest
    except OSError:
        return None


class SPAStaticFiles(StaticFiles):
    """静态托管 + SPA 兜底。

    任意「未匹配到真实文件」且不属于 /api、/ws 的路径，一律回落到 index.html，
    使前端路由在刷新 / 深链场景下仍能进入应用。
    带扩展名的资源（js/css/图片）缺失时按 404 处理，避免用 HTML 掩盖构建问题。
    """

    async def get_response(self, path: str, scope):
        try:
            response = await super().get_response(path, scope)
        except Exception:
            # API / WS 前缀不参与 SPA 兜底，避免给接口返回 HTML
            if path.startswith("api/") or path.startswith("ws/"):
                return PlainTextResponse("Not Found", status_code=404)
            name = path.rsplit("/", 1)[-1]
            if "." in name:
                # 带扩展名的资源缺失一般直接 404（不用 HTML 掩盖构建问题），
                # 但旧版 index.html 的入口 bundle 例外：回退到当前构建的同类入口，
                # 避免「重新构建 + 浏览器/CDN 缓存旧 HTML」造成的白屏。
                fallback = _current_entry_asset(path)
                if not fallback:
                    return PlainTextResponse("Not Found", status_code=404)
                path = fallback
            else:
                path = "index.html"
            try:
                response = await super().get_response(path, scope)
            except Exception:
                return PlainTextResponse("Frontend not built", status_code=404)
        # HTML 入口禁止缓存：保证硬刷新总能拿到最新 index.html → 引用最新带 hash 的 JS，
        # 彻底规避「浏览器缓存旧 index.html → 引用旧 JS」导致的旧 bundle 残留问题。
        # 必须用强制赋值而非 setdefault——Starlette/代理可能已写入 max-age=0，setdefault
        # 会被跳过，导致浏览器对 index.html（URL 不变）仍走 304 复用旧 JS。
        # no-store 确保不协商、不复用；带 hash 的 js/css 不受影响（文件名即版本，更新自然失效）。
        if getattr(response, "media_type", "") == "text/html":
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        return response


def _mount_frontend() -> None:
    if os.path.isdir(_FRONTEND_DIST):
        app.mount("/", SPAStaticFiles(directory=_FRONTEND_DIST, html=True), name="frontend")
        logger.info(f"[NEXUS] 前端已同源托管：{_FRONTEND_DIST}")
    else:
        logger.warning(f"[NEXUS] 未找到前端构建产物（{_FRONTEND_DIST}），仅提供 API 服务")


# 账户 / 多租户工作区 / OAuth 路由（必须在挂载前端 "/" 之前注册，否则被 SPA 兜底吞掉）
register_auth_routes(app)

# Phase 2：Yjs 实时协同 WebSocket 端点（复用 auth + 房间隔离）。
# 必须在 "_mount_frontend()" 的 "/" SPA 兜底挂载之前注册——
# 否则根挂载会优先匹配并吞掉 /ws/yjs 的 WebSocket 连接（StaticFiles 不处理 websocket）。
from yjs_server import yjs_app

app.mount("/ws/yjs", yjs_app)

_mount_frontend()


if __name__ == "__main__":
    import uvicorn

    # 从环境变量读取端口和主机配置，默认值分别为 8010 和 0.0.0.0
    port = int(os.getenv("BACKEND_PORT", "8010"))
    host = os.getenv("BACKEND_HOST", "0.0.0.0")
    # 生产默认关闭 reload（开发期需要热重载时设 RELOAD=1）
    reload_flag = os.getenv("RELOAD", "0") == "1"
    uvicorn.run("main:app", host=host, port=port, reload=reload_flag)
