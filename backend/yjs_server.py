"""
Phase 2：后端 Yjs WebSocket 实时同步端点。
- 复用 ASGIServer（ypy-websocket 原生 ASGI），挂载到 FastAPI 的 /ws/yjs
- 多文档按 path 自动分房间（每页一个 Y.Doc，doc_name = <room>/<pageId>）
- 持久化用 NexusYStore（SQLiteYStore 子类，写入独立 ydocs.db；Phase 5 再并入 nexus.db）
- 鉴权复用 resolve_principal_room（前端 apiKey query/header 即 JWT）；
  本地联调用环境变量 YJS_AUTH_DISABLED=1 放行，生产不留此开关。
"""
import os
from urllib.parse import parse_qs
from ypy_websocket import ASGIServer, WebsocketServer
from ypy_websocket.ystore import SQLiteYStore
from ypy_websocket.yroom import YRoom

YDOCS_DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ydocs.db")


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
    return False


yjs_app = ASGIServer(server, on_connect=_auth_connect)
