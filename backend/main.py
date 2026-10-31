import asyncio
import base64
import json
import logging
import os
import time
from datetime import datetime, timezone
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from fastapi.staticfiles import StaticFiles
from typing import Dict, List, Optional

import monitor
from db import create_database
from keys import get_allowed_keys, validate, PUBLIC_ROOM

# 初始化日志记录系统
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("NexusSync")

#: 服务版本，/api/health 会带回，便于确认线上跑的是哪份产物
VERSION = "1.0.0"
#: 进程启动时间，用于计算 uptime
START_TIME = time.time()

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


def get_room(
    authorization: str = Header(default=""),
    api_key: str = Query(default="", alias="api_key"),
) -> str:
    """REST 路由依赖：校验密钥并解析出当前请求的 room。
    未配置任何 key 时返回 PUBLIC_ROOM（开放模式）；启用鉴权后非法 key 返回 401。"""
    token = _extract_token(authorization, api_key)
    room = validate(token)
    if room is None:
        raise HTTPException(status_code=401, detail="Unauthorized: missing or invalid API key")
    return room


# CORS：默认放开（兼容本地 / 内网），公网部署请用 CORS_ORIGINS 收紧到具体前端源。
# 注意：allow_origins=["*"] 时不能带 credentials（浏览器拒绝），故二者联动。
_raw_origins = (os.getenv("CORS_ORIGINS") or "*").strip()
if _raw_origins == "*":
    CORS_ORIGINS: List[str] = ["*"]
else:
    CORS_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()] or ["*"]

_ALLOW_CREDENTIALS = CORS_ORIGINS != ["*"]

app = FastAPI(title="Nexus Matrix Sync Server", version=VERSION)

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


@app.on_event("startup")
async def _startup() -> None:
    await db.init()
    entries = get_allowed_keys()
    active = sum(1 for e in entries.values() if not e.get("revoked"))
    mode = "开放(无鉴权)" if active == 0 else f"多租户(有效 key {active} 个)"
    logger.info(f"[NEXUS] 版本={VERSION} 鉴权模式={mode} 后端={db.backend_name} CORS={CORS_ORIGINS}")


@app.on_event("shutdown")
async def _shutdown() -> None:
    await db.close()


@app.middleware("http")
async def _metrics_middleware(request: Request, call_next):
    """计数 + 错误捕获：给 /api/health 的 metrics 提供素材。"""
    monitor.record_request()
    try:
        response = await call_next(request)
        if response.status_code >= 500:
            monitor.record_error(f"{request.method} {request.url.path} -> {response.status_code}")
        return response
    except Exception as e:
        monitor.record_error(f"{request.method} {request.url.path}: {e}")
    raise


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


def _ts_of(page: Dict) -> str:
    """页面用于 LWW 比较的时间戳。

    墓碑（deletedAt）优先：删除是一种「带外时间戳」的终态，
    若只看 updatedAt，可能出现「A 端删除 / B 端之后编辑」时删除被编辑覆盖、
    或反过来删除一直复活的情况。谁的时间更晚谁生效，语义才一致。
    """
    deleted = _norm_ts(page.get("deletedAt")) if page.get("deletedAt") else ""
    if deleted:
        return deleted
    return _norm_ts(page.get("updatedAt"))


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
PAGE_SCALAR_FIELDS = ["title", "icon", "cover", "parentId", "isFavorite", "isExpanded"]


def _merge_pages(incoming: List[Dict], existing_pages: List[Dict]) -> List[Dict]:
    """块级 LWW 合并，语义对齐前端 mergePages。

    将 incoming（某客户端上推的页）合并进服务端「该 room 现有页」，而不是整页替换——
    这样「先到达服务端的设备编辑的块」不会被「后到的整页」覆盖，
    新设备 INITIAL_SYNC 拉到的才是块级合并后的真实状态。

    - 删除：墓碑 deletedAt 优先；远端删除戳不比本地更晚时才剔除该页；
    - 页面标量：逐字段按 updatedAt 严格较新（>）才采用远端；
    - 块级：逐块比较 block.updatedAt，>= 取远端；本地缺失的块直接加入。
    阶段三 F7：合并后对每页 tasks 做 prevId 链自愈。
    """
    existing = {p["id"]: p for p in existing_pages}
    merged: Dict[str, Dict] = {}

    def _scalar_lww(base: Dict, other: Dict) -> None:
        """把 other 中严格更新的标量字段覆盖进 base（就地）。"""
        base_upd = _norm_ts(base.get("updatedAt"))
        other_upd = _norm_ts(other.get("updatedAt"))
        if other_upd and base_upd and other_upd > base_upd:
            for f in PAGE_SCALAR_FIELDS:
                if f in other:
                    base[f] = other[f]
            base["updatedAt"] = other_upd

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
            elif (_norm_ts(ot.get("updatedAt")) or "0") >= (_norm_ts(bt.get("updatedAt")) or "0"):
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


async def _broadcast_room(room: str) -> None:
    """REST 写操作后，把该 room 最新数据广播给同 room 的 WS 设备。
    没有在线设备时直接返回（数据已落库，新设备建连时会收到 INITIAL_SYNC 补发）。"""
    if not manager.rooms.get(room):
        return
    pages = await db.load_pages(room)
    await manager.broadcast(
        json.dumps({"type": "SERVER_BROADCAST", "data": pages}), room=room
    )


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


# REST API: 创建新页面
@app.post("/api/pages")
async def create_page(page: Dict, room: str = Depends(get_room)):
    new_page = {
        "id": page.get("id") or f"page-{len(await db.load_pages(room)) + 1}-{int(time.time())}",
        "title": page.get("title", "未命名子程序"),
        "tasks": page.get("tasks", []),
        "updatedAt": _now_iso(),
    }
    # 保留客户端传来的其它字段（icon/cover/parentId/isFavorite 等）
    for k, v in page.items():
        if k not in new_page:
            new_page[k] = v
    await _persist_page(new_page, room)
    await _broadcast_room(room)
    return {"success": True, "data": new_page}


# REST API: 更新页面
@app.put("/api/pages/{page_id}")
async def update_page(page_id: str, page: Dict, room: str = Depends(get_room)):
    pages = await db.load_pages(room)
    for p in pages:
        if p["id"] == page_id:
            # 墓碑优先：客户端若带 deletedAt，保留它（删除要能传播，不能被服务端时间盖掉）
            incoming = dict(page)
            if incoming.get("deletedAt"):
                incoming["deletedAt"] = _norm_ts(incoming.get("deletedAt"))
            merged = {**p, **incoming, "updatedAt": _now_iso()}
            await _persist_page(merged, room)
            await _broadcast_room(room)
            return {"success": True, "data": merged}
    return {"success": False, "error": "Page not found"}


# REST API: 删除页面（墓碑，不真删）
@app.delete("/api/pages/{page_id}")
async def delete_page(page_id: str, room: str = Depends(get_room)):
    pages = await db.load_pages(room)
    for p in pages:
        if p["id"] == page_id:
            p["deletedAt"] = _now_iso()
            p["updatedAt"] = p["deletedAt"]
            await _persist_page(p, room)
            await _broadcast_room(room)
            return {"success": True, "message": "Page tombstoned"}
    return {"success": False, "error": "Page not found"}


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
    room = validate(token)
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

        while True:
            # 持续监听各台客户端上报的内容更改
            data = await websocket.receive_text()
            payload = json.loads(data)
            monitor.record_ws_message()

            if payload.get("type") == "CLIENT_UPDATE":
                incoming = payload.get("data")
                incoming_list = incoming if isinstance(incoming, list) else []
                accepted_ids = []
                existing_pages = await db.load_pages(room)
                existing_snap = {p["id"]: p for p in existing_pages}
                if incoming_list:
                    for inc in incoming_list:
                        pid = inc.get("id")
                        if not pid:
                            continue
                        cur = existing_snap.get(pid)
                        # 阶段三 ACK 细粒度：本端推送的页若「服务端原本没有」或
                        # 「其时间戳 >= 服务端现有页」，即被 LWW 采纳，纳入已确认集合。
                        if cur is None or _ts_of(inc) >= _ts_of(cur):
                            accepted_ids.append(pid)
                merged = _merge_pages(incoming_list, existing_pages)
                # 只落库真正变化的页：_merge_pages 的结果是全量并集，
                # 若原样遍历会把「每次按键」放大成对全部页的写。
                changed = _changed_pages(merged, existing_snap)
                for p in changed:
                    await _persist_page(p, room)

                # 阶段二 2.1：回 ACK 给发送者（cursor = 该 room 合并后的水位戳）
                await websocket.send_text(json.dumps({
                    "type": "ACK",
                    "cursor": await _water_mark(room, merged),
                    "clientSeq": payload.get("clientSeq"),
                    "acceptedIds": accepted_ids,
                }))

                # 触发向同 room 已联网的设备同步数据广播（同步中继）
                #
                # 只广播变更页（增量），不再发全量。
                # 前端对 SERVER_BROADCAST 与 INITIAL_SYNC 走的是同一条
                # mergePages 合并路径（见 useSync.ts），因此发子集是安全的：
                # 未提及的页在接收端保持原样，不会被删除。
                # 无变更时不广播，避免空包刷屏（发送方仍会收到上面的 ACK）。
                if changed:
                    await manager.broadcast(
                        json.dumps({"type": "SERVER_BROADCAST", "data": changed}),
                        room=room,
                        sender=websocket,
                    )

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
_FRONTEND_DIST = os.getenv(
    "STATIC_DIR",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend", "dist"),
)


class SPAStaticFiles(StaticFiles):
    """静态托管 + SPA 兜底。

    任意「未匹配到真实文件」且不属于 /api、/ws 的路径，一律回落到 index.html，
    使前端路由在刷新 / 深链场景下仍能进入应用。
    带扩展名的资源（js/css/图片）缺失时按 404 处理，避免用 HTML 掩盖构建问题。
    """

    async def get_response(self, path: str, scope):
        try:
            return await super().get_response(path, scope)
        except Exception:
            # API / WS 前缀不参与 SPA 兜底，避免给接口返回 HTML
            if path.startswith("api/") or path.startswith("ws/"):
                return PlainTextResponse("Not Found", status_code=404)
            # 带扩展名的静态资源缺失 → 直接 404，便于发现构建/路径问题
            if "." in path.rsplit("/", 1)[-1]:
                return PlainTextResponse("Not Found", status_code=404)
            try:
                return await super().get_response("index.html", scope)
            except Exception:
                return PlainTextResponse("Frontend not built", status_code=404)


def _mount_frontend() -> None:
    if os.path.isdir(_FRONTEND_DIST):
        app.mount("/", SPAStaticFiles(directory=_FRONTEND_DIST, html=True), name="frontend")
        logger.info(f"[NEXUS] 前端已同源托管：{_FRONTEND_DIST}")
    else:
        logger.warning(f"[NEXUS] 未找到前端构建产物（{_FRONTEND_DIST}），仅提供 API 服务")


_mount_frontend()


if __name__ == "__main__":
    import uvicorn

    # 从环境变量读取端口和主机配置，默认值分别为 8010 和 0.0.0.0
    port = int(os.getenv("BACKEND_PORT", "8010"))
    host = os.getenv("BACKEND_HOST", "0.0.0.0")
    # 生产默认关闭 reload（开发期需要热重载时设 RELOAD=1）
    reload_flag = os.getenv("RELOAD", "0") == "1"
    uvicorn.run("main:app", host=host, port=port, reload=reload_flag)
