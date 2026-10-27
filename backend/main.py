import asyncio
import json
import logging
import os
import sqlite3
import threading
from datetime import datetime, timezone
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Depends, Header, Query
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Dict

# 初始化日志记录系统
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("NexusSync")

# ============================================================
# 轻量共享密钥鉴权（阶段四：穿透 / 上云前置）
# 仅当环境变量 NEXUS_API_KEY 非空时强制校验；为空（默认 / 纯本地模式）则完全开放，
# 向后兼容现有局域网用法。REST 经全局依赖校验，WS 在握手阶段校验。
# 客户端把密钥放在：REST → `Authorization: Bearer <key>` 或 `?api_key=<key>`；
#                    WS   → 握手 query `?api_key=<key>`（浏览器 WebSocket 无法自定义 header）。
# ============================================================
API_KEY = (os.getenv("NEXUS_API_KEY") or "").strip()


def _extract_token(authorization: str, api_key: str) -> str:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    if api_key:
        return api_key.strip()
    return ""


async def _require_key(
    authorization: str = Header(default=""),
    api_key: str = Query(default="", alias="api_key"),
) -> None:
    if not API_KEY:
        return  # 未启用鉴权 → 开放
    token = _extract_token(authorization, api_key)
    if not token or token != API_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized: missing or invalid API key")


app = FastAPI(title="Nexus Matrix Sync Server", dependencies=[Depends(_require_key)])

# 允许本地和跨端的前端容器进行网络请求 (Cors)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 允许跨端（Tauri/Capacitor）的本地或远程源
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
# 持久化层：SQLite（零额外依赖，重启不丢数据）
# 设计：服务端仅作同步中继，初始为空；数据由客户端 LocalFirst 上推。
# ============================================================
# 阶段三 F8 修复：SQLite 连接被 FastAPI 线程池（REST）、WebSocket 事件循环（/ws/sync）、
# 以及 _schedule_broadcast 经 asyncio.run_coroutine_threadsafe 跨线程触发的协程并发访问。
# check_same_thread=False 只关闭了线程检查、并未提供并发安全，多线程序列执行同一连接
# 可能导致 "SQLite objects created in a thread..." 或写竞争。此处用一把全局锁把所有
# 对 _conn 的访问串行化（写串行 + 读串行），并保留 busy_timeout 作为兜底。
_DB_PATH = os.getenv("DB_PATH", os.path.join(os.path.dirname(os.path.abspath(__file__)), "nexus.db"))
_DB_LOCK = threading.Lock()
_conn = sqlite3.connect(_DB_PATH, check_same_thread=False)
_conn.execute("PRAGMA busy_timeout=5000")
_conn.execute("CREATE TABLE IF NOT EXISTS pages (id TEXT PRIMARY KEY, data TEXT, updated_at TEXT)")
# 阶段二资产同步：图片 Blob 单独入库，避免页面 JSON 携带 Base64 膨胀 payload。
_conn.execute("CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, data BLOB, created_at TEXT)")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _norm_ts(ts) -> str:
    """统一为 ISO 字符串，便于 LWW（最后写入胜出）比较。"""
    if isinstance(ts, (int, float)):
        return datetime.fromtimestamp(ts / 1000, timezone.utc).isoformat()
    return ts or _now_iso()


def _save_page(page: Dict) -> None:
    ts = _norm_ts(page.get("updatedAt"))
    page["updatedAt"] = ts
    with _DB_LOCK:
        _conn.execute(
            "INSERT OR REPLACE INTO pages (id, data, updated_at) VALUES (?, ?, ?)",
            (page["id"], json.dumps(page, ensure_ascii=False), ts),
        )
        _conn.commit()


def _delete_page(pid: str) -> None:
    with _DB_LOCK:
        _conn.execute("DELETE FROM pages WHERE id = ?", (pid,))
        _conn.commit()


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


# 阶段二 2.1/2.2：服务端水位戳（ms 数字）。
# 取所有页 max(updatedAt, deletedAt) 的数值，作为「已确认高水位」基准。
# 用于：CLIENT_UPDATE 后回 ACK 的 cursor；GET /pages?since= 的增量比较基准。
def _water_mark() -> int:
    wm = 0
    for p in pages_db:
        ts = _ts_of(p)
        try:
            ms = int(datetime.fromisoformat(ts).timestamp() * 1000)
        except Exception:
            ms = 0
        wm = max(wm, ms)
    return wm


# 阶段二 2.3：图片资产存取（SQLite BLOB）。
def _save_asset(aid: str, blob: bytes) -> None:
    with _DB_LOCK:
        _conn.execute(
            "INSERT OR REPLACE INTO assets (id, data, created_at) VALUES (?, ?, ?)",
            (aid, blob, _now_iso()),
        )
        _conn.commit()


def _get_asset(aid: str):
    with _DB_LOCK:
        row = _conn.execute("SELECT data FROM assets WHERE id = ?", (aid,)).fetchone()
    return row[0] if row else None


def _delete_asset(aid: str) -> None:
    with _DB_LOCK:
        _conn.execute("DELETE FROM assets WHERE id = ?", (aid,))
        _conn.commit()


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


def _merge_pages(incoming: List[Dict]) -> List[Dict]:
    """块级 LWW 合并，语义对齐前端 mergePages。

    将 incoming（某客户端上推的页）合并进服务端现有 pages_db，而不是整页替换——
    这样「先到达服务端的设备编辑的块」不会被「后到的整页」覆盖，
    新设备 INITIAL_SYNC 拉到的才是块级合并后的真实状态。

    - 删除：墓碑 deletedAt 优先；远端删除戳不比本地更晚时才剔除该页；
    - 页面标量：逐字段按 updatedAt 严格较新（>）才采用远端；
    - 块级：逐块比较 block.updatedAt，>= 取远端；本地缺失的块直接加入。
    阶段三 F7：合并后对每页 tasks 做 prevId 链自愈。
    """
    existing = {p["id"]: p for p in pages_db}
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

# 离线数据持久化池 - 页面数据结构（从 SQLite 恢复；初始为空，由客户端上推）
pages_db: List[Dict] = [json.loads(r[0]) for r in _conn.execute("SELECT data FROM pages").fetchall()]

# 兼容旧版单页数据结构
in_memory_db: List[Dict] = [
    { "id": "1", "type": "h1", "content": "NEXUS 协议核心目标", "completed": False },
    { "id": "2", "type": "todo", "content": "本地优先分布式矩阵调试已启动", "completed": True },
]

# 核心：管理跨端（iOS/Android/桌面端）WebSocket 同接通道的管理器
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"设备建立连接。在线设备总数: {len(self.active_connections)}")
        await self.broadcast_device_count()

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        logger.info(f"设备断开连接。在线设备总数: {len(self.active_connections)}")

    async def _send_or_drop(self, connection: WebSocket, message: str) -> None:
        """向单个连接发送；失败即判定为死连接并移除（静默，不刷 error）。
        同步场景下连接频繁建立/断开，向已断开连接 send 失败是常态，
        只需清理掉以保持在线数准确，不应以 error 刷屏。"""
        try:
            await connection.send_text(message)
        except Exception:
            if connection in self.active_connections:
                self.active_connections.remove(connection)

    async def broadcast_device_count(self):
        # 向所有设备推送当前在线设备数（死连接由 _send_or_drop 顺手清理）
        msg = json.dumps({"type": "DEVICE_COUNT", "data": len(self.active_connections)})
        for connection in list(self.active_connections):
            await self._send_or_drop(connection, msg)

    async def broadcast(self, message: str, sender: WebSocket):
        # 广播数据给其他连接的客户端设备，排除发送者自身（防止回环反射）。
        # 用副本遍历 + _send_or_drop：避免遍历中移除导致跳过元素，并静默清理死连接。
        for connection in list(self.active_connections):
            if connection != sender:
                await self._send_or_drop(connection, message)

manager = ConnectionManager()

# 阶段一：REST 写操作（POST/PUT/DELETE）原本**不广播**，只有 WS 路径才广播，
# 导致「在某端用 REST 删除/新增页面」后，其它已连接设备永远收不到变更，
# 已删页还会被另一端下一次 CLIENT_UPDATE 推回来「复活」。
# 这里在 REST 写后主动把最新全量广播出去。
# 注意：FastAPI 的 sync def 路由跑在独立线程，不能直接 await；
# 用模块级事件循环 + run_coroutine_threadsafe 跨线程投递广播协程。
_event_loop: asyncio.AbstractEventLoop | None = None


def _schedule_broadcast() -> None:
    """REST 写操作后，把最新 pages_db 广播给所有已连接的 WebSocket 设备。"""
    if not manager.active_connections:
        return  # 没有在线设备时无需广播（数据已落 SQLite）
    message = json.dumps({"type": "SERVER_BROADCAST", "data": pages_db})
    # 同步 REST 端点在 worker 线程执行，线程内可能无事件循环；
    # 此时 get_event_loop() 会抛 RuntimeError。无可用 loop 时安全跳过广播——
    # 数据已落 SQLite，WebSocket 建连时的 INITIAL_SYNC 会把最新数据补发给对端。
    loop = _event_loop
    if loop is None:
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            return

    async def _broadcast() -> None:
        for connection in list(manager.active_connections):
            await manager._send_or_drop(connection, message)

    try:
        asyncio.run_coroutine_threadsafe(_broadcast(), loop)
    except RuntimeError:
        # 事件循环尚未建立（首字节请求极早到达）——忽略，WS 连接建立时本就会发 INITIAL_SYNC
        pass


@app.get("/")
def read_root():
    return {"status": "ONLINE", "protocol": "NEXUS_SYNCHRONIZATION_MATRIX"}

# REST API: 获取所有页面
# 阶段二 2.2：支持 ?since=<ms 水位戳> 增量拉取。
# since 为空 → 返回全量（首装/换设备）；since 非空 → 只返回比该水位更新的页
# （任一 updatedAt 或 deletedAt 晚于 since）。前端用上次收到的 cursor 作 since，
# 断线期间错过的变更得以补齐，无需每次传输整库。
@app.get("/api/pages")
def get_pages(since: int | None = None):
    if since is None:
        return {"success": True, "data": pages_db, "cursor": _water_mark()}
    changed = []
    for p in pages_db:
        ts = _ts_of(p)
        try:
            ms = int(datetime.fromisoformat(ts).timestamp() * 1000)
        except Exception:
            ms = 0
        if ms > since:
            changed.append(p)
    return {"success": True, "data": changed, "cursor": _water_mark()}

# REST API: 获取单个页面
@app.get("/api/pages/{page_id}")
def get_page(page_id: str):
    for page in pages_db:
        if page["id"] == page_id:
            return {"success": True, "data": page}
    return {"success": False, "error": "Page not found"}

# REST API: 创建新页面
@app.post("/api/pages")
def create_page(page: Dict):
    new_page = {
        "id": page.get("id") or f"page-{len(pages_db) + 1}-{int(__import__('time').time())}",
        "title": page.get("title", "未命名子程序"),
        "tasks": page.get("tasks", []),
        "updatedAt": _now_iso(),
    }
    # 保留客户端传来的其它字段（icon/cover/parentId/isFavorite 等）
    for k, v in page.items():
        if k not in new_page:
            new_page[k] = v
    pages_db.append(new_page)
    _save_page(new_page)
    _schedule_broadcast()
    return {"success": True, "data": new_page}

# REST API: 更新页面
@app.put("/api/pages/{page_id}")
def update_page(page_id: str, page: Dict):
    for i, p in enumerate(pages_db):
        if p["id"] == page_id:
            # 墓碑优先：客户端若带 deletedAt，保留它（删除要能传播，不能被服务端时间盖掉）
            incoming = dict(page)
            if incoming.get("deletedAt"):
                incoming["deletedAt"] = _norm_ts(incoming.get("deletedAt"))
            pages_db[i] = {**p, **incoming, "updatedAt": _now_iso()}
            _save_page(pages_db[i])
            _schedule_broadcast()
            return {"success": True, "data": pages_db[i]}
    return {"success": False, "error": "Page not found"}

# REST API: 删除页面
#
# 阶段一：删除改为**墓碑**，不再真删行。
# 原因：真删时另一端仍持有该页，其下一次 CLIENT_UPDATE 会把页面推回来「复活」；
# 而且 DELETE 原本不广播，其它端永远不知道要删。
@app.delete("/api/pages/{page_id}")
def delete_page(page_id: str):
    for i, p in enumerate(pages_db):
        if p["id"] == page_id:
            p["deletedAt"] = _now_iso()
            p["updatedAt"] = p["deletedAt"]
            _save_page(p)
            _schedule_broadcast()
            return {"success": True, "message": "Page tombstoned"}
    return {"success": False, "error": "Page not found"}

# === 阶段二 2.3：图片资产同步端点 ===
# 页面 JSON 只存 asset:<id> 引用；Blob 二进制走独立端点，避免全量广播塞满 Base64。
# 单用户多设备：资产一旦上传即全端可读；删除页时不级联删资产（墓碑期引用可能仍在其它端）。
import base64
from fastapi import Request, Response

@app.post("/api/assets")
async def upload_asset(request: Request):
    # 支持两种上传体：
    #  1) JSON { "id": "asset:xxx", "data": "<base64>" }（前端 saveImageAsset 预生成 id）
    #  2) multipart/form-data（其它端或调试用），由服务端生成 id
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
        aid = f"asset-{int(__import__('time').time() * 1000)}-{os.urandom(4).hex()}"
    _save_asset(aid, blob)
    return {"success": True, "id": f"asset:{aid}"}

@app.get("/api/assets/{asset_id}")
def download_asset(asset_id: str):
    blob = _get_asset(asset_id.replace("asset:", ""))
    if blob is None:
        return Response(status_code=404, content=b"not found")
    # 尝试推断 MIME；默认 image/jpeg
    return Response(content=blob, media_type="image/jpeg", headers={
        "Content-Disposition": f"inline; filename={asset_id}",
        "Cache-Control": "no-store",
    })

@app.delete("/api/assets/{asset_id}")
def remove_asset(asset_id: str):
    _delete_asset(asset_id.replace("asset:", ""))
    return {"success": True}

# === 阶段三：墓碑 GC（垃圾回收）===
# 删除采用墓碑（deletedAt）而非真删，以便删除能通过广播/增量同步传播到所有设备。
# 但墓碑会永久堆积，长期抬高 _water_mark 比较基数、拖慢每次 SERVER_BROADCAST / INITIAL_SYNC 的 payload。
# 故提供手动触发的 GC：仅清理 deletedAt 早于 retention_days（默认30天）的墓碑——
# 30 天内任何设备都已有充足时间完成至少一次同步/上线，过期墓碑可安全物理删除，不会致复活。
# 注意：不自动运行，避免误删尚未同步到离线设备的墓碑。
@app.post("/api/admin/gc")
def gc_tombstones(retention_days: int = 30):
    global pages_db
    cutoff = datetime.now(timezone.utc).timestamp() * 1000 - retention_days * 86400_000
    purged = 0
    kept = []
    for p in pages_db:
        if p.get("deletedAt"):
            ms = 0
            try:
                ms = int(datetime.fromisoformat(_norm_ts(p["deletedAt"])).timestamp() * 1000)
            except Exception:
                ms = 0
            if ms and ms < cutoff:
                _delete_page(p["id"])  # 走加锁的 SQLite 删除
                purged += 1
                continue
        kept.append(p)
    pages_db = kept
    with _DB_LOCK:
        _conn.execute("VACUUM")
    return {"success": True, "purged": purged, "remaining": len(pages_db)}

# WS 实时同步路由
@app.websocket("/ws/sync")
async def websocket_endpoint(websocket: WebSocket):
    global pages_db
    # 握手阶段鉴权（浏览器 WebSocket 不能自定义 header，只用 query）
    if API_KEY:
        key = websocket.query_params.get("api_key", "") or ""
        auth = websocket.headers.get("authorization", "")
        token = _extract_token(auth, key)
        if not token or token != API_KEY:
            await websocket.close(code=1008, reason="Unauthorized")
            return
    await manager.connect(websocket)
    
    # 建立网络时，立即将当前最新的服务器端持久化缓存矩阵发送给新设备
    try:
        await websocket.send_text(json.dumps({
            "type": "INITIAL_SYNC",
            "data": pages_db  # 使用新的页面数据结构
        }))
        await websocket.send_text(json.dumps({
            "type": "DEVICE_COUNT",
            "data": len(manager.active_connections)
        }))
        
        while True:
            # 持续监听各台客户端上报的心跳及内容更改
            data = await websocket.receive_text()
            payload = json.loads(data)
            
            # 如果是客户端设备推送的内容（单 Block 内容或全量更新）
            if payload.get("type") == "CLIENT_UPDATE":
                incoming = payload.get("data")
                accepted_ids = []
                if isinstance(incoming, list) and incoming:
                    existing_snap = {p["id"]: p for p in pages_db}
                    for inc in incoming:
                        pid = inc.get("id")
                        if not pid:
                            continue
                        cur = existing_snap.get(pid)
                        # 阶段三 ACK 细粒度：本端推送的页若「服务端原本没有」或
                        # 「其时间戳 >= 服务端现有页」，即被 LWW 采纳，纳入已确认集合。
                        if cur is None or _ts_of(inc) >= _ts_of(cur):
                            accepted_ids.append(pid)
                    pages_db = _merge_pages(incoming)
                    for p in pages_db:
                        _save_page(p)

                # 阶段二 2.1：回 ACK 给发送者。
                # cursor = 服务端合并后的水位戳（ms），前端据此确认「服务端已收到并能
                # 让其它端看到」，从而可以丢弃本地 outbox 中低于该水位的待确认变更。
                # clientSeq 原样回显，前端用来精确对齐哪一批 outbox 被确认。
                # 阶段三细粒度：acceptedIds = 本次被服务端采纳的页 id 集合，前端据此
                # 只从 outbox 中剔除「已确认」的页，断线重发时仅补发未确认的页，
                # 避免把已达成一致的全量快照反复重推、造成冲突覆盖。
                await websocket.send_text(json.dumps({
                    "type": "ACK",
                    "cursor": _water_mark(),
                    "clientSeq": payload.get("clientSeq"),
                    "acceptedIds": accepted_ids,
                }))

                # 触发向全平台已联网的设备同步数据广播 (同步中继)
                await manager.broadcast(json.dumps({
                    "type": "SERVER_BROADCAST",
                    "data": pages_db
                }), sender=websocket)
                
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"连接中转异常: {e}")
    finally:
        # 无论正常断开还是异常，都确保移除连接并刷新在线数，防止计数只增不减
        manager.disconnect(websocket)
        await manager.broadcast_device_count()

if __name__ == "__main__":
    import uvicorn
    import os
    # 记录主事件循环，供 _schedule_broadcast 跨线程投递广播协程
    _event_loop = asyncio.get_event_loop()
    # 从环境变量读取端口和主机配置，默认值分别为 8010 和 0.0.0.0
    port = int(os.getenv("BACKEND_PORT", "8010"))
    host = os.getenv("BACKEND_HOST", "0.0.0.0")
    uvicorn.run("main:app", host=host, port=port, reload=True)