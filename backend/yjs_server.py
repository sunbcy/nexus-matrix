"""
Phase 2：后端 Yjs WebSocket 实时同步端点。
- 复用 ASGIServer（ypy-websocket 原生 ASGI），挂载到 FastAPI 的 /ws/yjs
- 多文档按 path 自动分房间（每页一个 Y.Doc，doc_name = <room>/<pageId>）
- 持久化用 NexusYStore（SQLiteYStore 子类，写入独立 ydocs.db；Phase 5 再并入 nexus.db）
- 鉴权复用 resolve_principal_room（前端 apiKey query/header 即 JWT）；
  本地联调用环境变量 YJS_AUTH_DISABLED=1 放行，生产不留此开关。
"""
import asyncio
import hashlib
import logging
import os
import sqlite3
from urllib.parse import parse_qs
from ypy_websocket import ASGIServer, WebsocketServer
from ypy_websocket.ystore import SQLiteYStore
from ypy_websocket.yroom import YRoom

logger = logging.getLogger("NexusSync")
YDOCS_DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ydocs.db")
_TENANT_TAG_PREFIX = "__t"


def _tenant_tag(room: str) -> str:
    """鉴权得到的 tenant room → 稳定的短标签（不落明文 room）。"""
    return _TENANT_TAG_PREFIX + hashlib.sha256(room.encode("utf-8")).hexdigest()[:16]


class NexusYStore(SQLiteYStore):
    db_path = YDOCS_DB


class NexusWebsocketServer(WebsocketServer):
    async def get_room(self, name: str) -> YRoom:
        if name not in self.rooms:
            # doc_name 用作持久化表的唯一键，去掉前导 / 并把 / 转义，避免歧义
            doc = name.lstrip("/").replace("/", "__")
            self.rooms[name] = YRoom(
                ready=self.rooms_ready,
                ystore=NexusYStore(doc),
                log=self.log,
            )
        room = self.rooms[name]
        await self.start_room(room)
        return room


server = NexusWebsocketServer(rooms_ready=True, auto_clean_rooms=False)


def _migrate_legacy_ydocs() -> None:
    """试点期 yupdates 没有租户前缀；升级后把它们归入「第一个有效 key」的租户，
    与 db.py 把 room='public' 迁到 first_allowed_room() 是同一套兼容思路。

    用 INSERT ... WHERE NOT EXISTS 保证幂等，且保留原行（旧版客户端仍可读），
    因此这一步是可回滚的：去掉前缀逻辑后数据原样还在。
    """
    try:
        from keys import first_allowed_room

        first = first_allowed_room()
    except Exception:
        first = None
    if not first or not os.path.exists(YDOCS_DB):
        return
    tag = _tenant_tag(first)
    conn = None
    try:
        conn = sqlite3.connect(YDOCS_DB, timeout=5)
        rows = conn.execute("SELECT path, yupdate, metadata, timestamp FROM yupdates").fetchall()
        legacy = [r for r in rows if not r[0].startswith(_TENANT_TAG_PREFIX)]
        if not legacy:
            return
        conn.executemany(
            "INSERT INTO yupdates (path, yupdate, metadata, timestamp) "
            "SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM yupdates WHERE path = ?)",
            [(f"{tag}__{p}", u, m, t, f"{tag}__{p}") for p, u, m, t in legacy],
        )
        conn.commit()
        logger.info(f"[NEXUS] Yjs 试点历史数据已归入租户前缀：{len(legacy)} 条")
    except Exception as e:
        logger.warning(f"[NEXUS] Yjs 试点历史数据迁移跳过（不影响新通道）：{e}")
    finally:
        if conn is not None:
            conn.close()


async def _auth_connect(msg, scope):
    """ASGIServer 连接回调：返回 True 关闭连接，False 接受。"""
    if os.environ.get("YJS_AUTH_DISABLED") == "1":
        return False
    qs = scope.get("query_string", b"").decode()
    params = parse_qs(qs)
    token = (params.get("apiKey") or params.get("api_key") or [""])[0]
    headers = {k.decode().lower(): v.decode() for k, v in scope.get("headers", [])}
    auth_hdr = headers.get("authorization", "")
    if auth_hdr.startswith("Bearer "):
        token = auth_hdr[7:]
    room = None
    if token:
        try:
            from auth import resolve_principal_room

            room = await resolve_principal_room(token)
        except Exception:
            room = None
    if not room:
        return True
    scope["nexus_room"] = room

    # 租户隔离（接入主编辑器前的必要前置）：原来房间名完全由客户端 URL path 决定，
    # scope["nexus_room"] 只写不读，不同租户用同名 path 就能读到同一份 Y.Doc。
    # ASGIServer 在 on_connect 返回之后才用 scope["path"] 建房间
    # （ypy_websocket/asgi_server.py: ASGIWebsocket(..., scope["path"], ...)），
    # 因此这里改写 path 会同时隔离内存房间名与 ydocs.db 的持久化 key。
    tag = _tenant_tag(room)
    raw = (scope.get("path") or "/").split("?", 1)[0]
    if not raw.startswith("/" + tag):
        scope["path"] = f"/{tag}{raw if raw.startswith('/') else '/' + raw}"
    return False


class NexusASGIServer(ASGIServer):
    """在首个连接到达时惰性启动 WebsocketServer（只启动一次）。

    ypy_websocket 的 ASGIServer 原样不会调用 WebsocketServer.start()/__aenter__，
    serve() 直接抛 RuntimeError("The WebsocketServer is not running")，客户端
    y-websocket provider 会无限重连——试点通道此前一直没真正跑通过。
    放在 /ws/yjs 子应用内部，任何失败都不会拖垮主服务启动。
    """

    def __init__(self, websocket_server, on_connect=None):
        super().__init__(websocket_server, on_connect=on_connect)
        self._ws_server = websocket_server
        self._lock = None
        self._entered = False

    async def __call__(self, scope, receive, send):
        if not self._entered:
            if self._lock is None:
                self._lock = asyncio.Lock()
            async with self._lock:
                if not self._entered:
                    await self._ws_server.__aenter__()
                    self._entered = True
        await super().__call__(scope, receive, send)


_migrate_legacy_ydocs()
yjs_app = NexusASGIServer(server, on_connect=_auth_connect)
