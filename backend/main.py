from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Dict
import json
import logging
import os
import sqlite3
from datetime import datetime, timezone

# 初始化日志记录系统
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("NexusSync")

app = FastAPI(title="Nexus Matrix Sync Server")

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
_DB_PATH = os.getenv("DB_PATH", os.path.join(os.path.dirname(os.path.abspath(__file__)), "nexus.db"))
_conn = sqlite3.connect(_DB_PATH, check_same_thread=False)
_conn.execute("PRAGMA busy_timeout=5000")
_conn.execute("CREATE TABLE IF NOT EXISTS pages (id TEXT PRIMARY KEY, data TEXT, updated_at TEXT)")

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
    _conn.execute(
        "INSERT OR REPLACE INTO pages (id, data, updated_at) VALUES (?, ?, ?)",
        (page["id"], json.dumps(page, ensure_ascii=False), ts),
    )
    _conn.commit()

def _delete_page(pid: str) -> None:
    _conn.execute("DELETE FROM pages WHERE id = ?", (pid,))
    _conn.commit()

def _merge_pages(incoming: List[Dict]) -> List[Dict]:
    """按 updatedAt 做 LWW 合并，并保留仅存于服务端的页面（其他设备创建的）。"""
    existing = {p["id"]: p for p in pages_db}
    merged: Dict[str, Dict] = {}
    for inc in incoming:
        pid = inc.get("id")
        if not pid:
            continue
        inc_ts = _norm_ts(inc.get("updatedAt"))
        cur = existing.get(pid)
        if cur is None:
            inc["updatedAt"] = inc_ts
            merged[pid] = inc
        else:
            cur_ts = _norm_ts(cur.get("updatedAt"))
            merged[pid] = inc if inc_ts >= cur_ts else cur
    for pid, p in existing.items():
        if pid not in merged:
            merged[pid] = p
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

    async def broadcast_device_count(self):
        # 向所有设备推送当前在线设备数
        for connection in list(self.active_connections):
            try:
                await connection.send_text(json.dumps({
                    "type": "DEVICE_COUNT",
                    "data": len(self.active_connections)
                }))
            except Exception as e:
                logger.error(f"推送设备数失败: {e}")

    async def broadcast(self, message: str, sender: WebSocket):
        # 广播数据给其他连接的客户端设备，排除发送者自身（防止回环反射）
        for connection in self.active_connections:
            if connection != sender:
                try:
                    await connection.send_text(message)
                except Exception as e:
                    logger.error(f"向设备广播数据包失败: {e}")

manager = ConnectionManager()

@app.get("/")
def read_root():
    return {"status": "ONLINE", "protocol": "NEXUS_SYNCHRONIZATION_MATRIX"}

# REST API: 获取所有页面
@app.get("/api/pages")
def get_pages():
    return {"success": True, "data": pages_db}

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
        "id": f"page-{len(pages_db) + 1}-{int(__import__('time').time())}",
        "title": page.get("title", "未命名子程序"),
        "tasks": page.get("tasks", []),
        "updatedAt": _now_iso(),
    }
    pages_db.append(new_page)
    _save_page(new_page)
    return {"success": True, "data": new_page}

# REST API: 更新页面
@app.put("/api/pages/{page_id}")
def update_page(page_id: str, page: Dict):
    for i, p in enumerate(pages_db):
        if p["id"] == page_id:
            pages_db[i] = {**p, **page, "updatedAt": _now_iso()}
            _save_page(pages_db[i])
            return {"success": True, "data": pages_db[i]}
    return {"success": False, "error": "Page not found"}

# REST API: 删除页面
@app.delete("/api/pages/{page_id}")
def delete_page(page_id: str):
    global pages_db
    pages_db = [p for p in pages_db if p["id"] != page_id]
    _delete_page(page_id)
    return {"success": True, "message": "Page deleted"}

# WS 实时同步路由
@app.websocket("/ws/sync")
async def websocket_endpoint(websocket: WebSocket):
    global pages_db
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
                if isinstance(incoming, list) and incoming:
                    pages_db = _merge_pages(incoming)
                    for p in pages_db:
                        _save_page(p)

                # 触发向全平台已联网的设备同步数据广播 (同步中继)
                await manager.broadcast(json.dumps({
                    "type": "SERVER_BROADCAST",
                    "data": pages_db
                }), sender=websocket)
                
    except WebSocketDisconnect:
        manager.disconnect(websocket)
        await manager.broadcast_device_count()
    except Exception as e:
        logger.error(f"连接中转异常: {e}")
        manager.disconnect(websocket)
        await manager.broadcast_device_count()

if __name__ == "__main__":
    import uvicorn
    import os
    # 从环境变量读取端口和主机配置，默认值分别为 8010 和 0.0.0.0
    port = int(os.getenv("BACKEND_PORT", "8010"))
    host = os.getenv("BACKEND_HOST", "0.0.0.0")
    uvicorn.run("main:app", host=host, port=port, reload=True)