"""数据持久层抽象（SQLite / Postgres 双实现，异步接口）。

对外只暴露「按 room 隔离」的**异步**操作；业务代码（main.py）不接触任何具体驱动。

- 默认：SQLiteDatabase（零额外依赖、单文件，适合个人 / 小规模部署）。
  用 asyncio.to_thread 把同步的 sqlite3 调用挪到线程里，避免阻塞事件循环。
- 公网 / 高并发：设 DATABASE_URL=postgres://... 即自动切到 PostgresDatabase（asyncpg）。

约定：所有方法都必须显式传 room —— 让「按租户隔离」成为接口约束，
      任何一次读写都无法绕过 room 过滤。

接入新后端只需三步：
  1. 继承 Database 并实现全部抽象方法；
  2. 在 create_database() 里加一个分支；
  3. 在 requirements.txt 里加上对应驱动。
业务代码（main.py）无需改动。
"""
from __future__ import annotations

import asyncio
import json
import os
import sqlite3
import threading
import uuid
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from keys import first_allowed_room


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_data(raw: Any) -> Optional[Dict]:
    """统一把存储层取回的 data 解析成 dict。

    SQLite 存 TEXT（需要 json.loads）；Postgres 用 JSONB，asyncpg 默认返回 str，
    但将来若注册 codec 可能直接返回 dict —— 这里两种都兼容。
    """
    if raw is None:
        return None
    if isinstance(raw, (dict, list)):
        return raw
    return json.loads(raw)


# ============================================================
# 接口
# ============================================================
class Database(ABC):
    """存储接口（异步）。所有方法都必须显式传 room。"""

    #: 后端名称，用于 /api/health 展示
    backend_name: str = "unknown"

    @abstractmethod
    async def init(self) -> None:
        """建立连接 / 建表 / 一次性迁移。"""

    @abstractmethod
    async def close(self) -> None:
        """释放连接。"""

    @abstractmethod
    async def ping(self) -> bool:
        """连通性探测（/api/health 用），异常返回 False。"""

    @abstractmethod
    async def load_pages(self, room: str) -> List[Dict]:
        """取该 room 下全部页面（返回已反序列化的 dict 列表）。"""

    @abstractmethod
    async def save_page(self, page: Dict, room: str) -> None:
        """整页 upsert，按 (id, room) 唯一。"""

    @abstractmethod
    async def delete_page(self, page_id: str, room: str) -> None:
        """物理删除该 room 下的指定页。"""

    @abstractmethod
    async def save_asset(self, asset_id: str, blob: bytes, room: str) -> None:
        """写入 / 覆盖二进制资产。"""

    @abstractmethod
    async def get_asset(self, asset_id: str, room: str) -> Optional[bytes]:
        """读取资产；不存在返回 None。"""

    @abstractmethod
    async def delete_asset(self, asset_id: str, room: str) -> None:
        """删除该 room 下的指定资产。"""

    @abstractmethod
    async def vacuum(self) -> None:
        """整理存储空间（SQLite 的 VACUUM；Postgres 交给 autovacuum）。"""

    # ---- 账户 / 工作区（多租户账号体系，叠加在 room 隔离之上） ----
    @abstractmethod
    async def create_user(self, provider: str, sub: str, email: str, name: str) -> str:
        """创建用户，返回 user_id（uuid）。"""

    @abstractmethod
    async def get_user_by_oauth(self, provider: str, sub: str) -> Optional[Dict]:
        """按 OAuth(provider, sub) 查用户。"""

    @abstractmethod
    async def get_user_by_email(self, email: str) -> Optional[Dict]:
        """按邮箱查用户（用于 OAuth 邮箱一致时合并到已有账户）。"""

    @abstractmethod
    async def get_user_by_id(self, user_id: str) -> Optional[Dict]:
        """按 id 查用户。"""

    @abstractmethod
    async def create_membership(self, user_id: str, room: str, role: str,
                               status: str = "active", label: Optional[str] = None) -> None:
        """建立用户↔工作区(room) 的成员关系。role: owner/admin/member。"""

    @abstractmethod
    async def get_memberships(self, user_id: str) -> List[Dict]:
        """列出用户的所有成员关系（room, role, status, label）。"""

    @abstractmethod
    async def get_membership(self, user_id: str, room: str) -> Optional[Dict]:
        """查单条成员关系；get_room 校验 JWT 时用来确认用户对该 room 有权。"""


# ============================================================
# SQLite 实现
# ============================================================
class SQLiteDatabase(Database):
    """SQLite 实现。

    连接会被 FastAPI 线程池（REST）、WebSocket 事件循环（/ws/sync）以及跨线程
    投递的广播协程并发访问。check_same_thread=False 只关闭了线程检查、并未提供
    并发安全，故用一把全局锁把对连接的所有访问串行化（读写都串行），
    并保留 busy_timeout 作为兜底。

    sqlite3 是同步 API，这里所有调用都经 asyncio.to_thread 投递到线程池，
    避免因文件 IO 卡住整个事件循环。
    """

    backend_name = "sqlite"

    _CREATE_PAGES = (
        "CREATE TABLE IF NOT EXISTS pages "
        "(id TEXT NOT NULL, room TEXT NOT NULL DEFAULT 'public', "
        "data TEXT, updated_at TEXT, PRIMARY KEY (id, room))"
    )
    _CREATE_ASSETS = (
        "CREATE TABLE IF NOT EXISTS assets "
        "(id TEXT NOT NULL, room TEXT NOT NULL DEFAULT 'public', "
        "data BLOB, created_at TEXT, PRIMARY KEY (id, room))"
    )
    _CREATE_USERS = (
        "CREATE TABLE IF NOT EXISTS users "
        "(id TEXT PRIMARY KEY, provider TEXT, sub TEXT, "
        "email TEXT, name TEXT, created_at TEXT)"
    )
    _CREATE_MEMBERSHIPS = (
        "CREATE TABLE IF NOT EXISTS memberships "
        "(user_id TEXT NOT NULL, room TEXT NOT NULL, role TEXT NOT NULL, "
        "status TEXT NOT NULL DEFAULT 'active', label TEXT, created_at TEXT, "
        "PRIMARY KEY (user_id, room))"
    )

    def __init__(self, path: str) -> None:
        self._path = path
        self._lock = threading.Lock()
        self._conn: Optional[sqlite3.Connection] = None

    # ---- 同步内部实现（由下面的 async 方法投递到线程执行） ----
    def _sync_init(self) -> None:
        self._conn = sqlite3.connect(self._path, check_same_thread=False)
        # WAL：读写互不阻塞，多个进程/线程（或误双开的第二个实例）并发访问时不再致命。
        # busy_timeout 调大到 30s：迁移建表是写事务，若另一实例正持有写锁，本方会等待而非直接报
        # 「database is locked」退出（之前 5s 在大数据量迁移下偶发不够）。
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA busy_timeout=30000")
        self._conn.execute("PRAGMA synchronous=NORMAL")
        self._conn.execute(self._CREATE_PAGES)
        self._conn.execute(self._CREATE_ASSETS)
        self._conn.execute(self._CREATE_USERS)
        self._conn.execute(self._CREATE_MEMBERSHIPS)
        self._conn.commit()
        self._sync_migrate()

    def _sync_migrate(self) -> None:
        """一次性迁移：旧库无 room 列 / 主键仅为 id → 多租户复合主键 (id, room)。"""
        import logging

        logger = logging.getLogger("NexusSync")
        try:
            pcols = [r[1] for r in self._conn.execute("PRAGMA table_info(pages)")]
            if "room" not in pcols:
                self._conn.execute("ALTER TABLE pages ADD COLUMN room TEXT NOT NULL DEFAULT 'public'")
                self._conn.commit()

            self._conn.execute(
                "CREATE TABLE IF NOT EXISTS pages_new "
                "(id TEXT NOT NULL, room TEXT NOT NULL DEFAULT 'public', "
                "data TEXT, updated_at TEXT, PRIMARY KEY (id, room))"
            )
            self._conn.execute(
                "INSERT OR REPLACE INTO pages_new (id, room, data, updated_at) "
                "SELECT id, room, data, updated_at FROM pages"
            )
            self._conn.execute("DROP TABLE pages")
            self._conn.execute(self._CREATE_PAGES)
            self._conn.execute(
                "INSERT OR REPLACE INTO pages (id, room, data, updated_at) "
                "SELECT id, room, data, updated_at FROM pages_new"
            )
            self._conn.execute("DROP TABLE pages_new")

            acols = [r[1] for r in self._conn.execute("PRAGMA table_info(assets)")]
            if "room" not in acols:
                self._conn.execute("ALTER TABLE assets ADD COLUMN room TEXT NOT NULL DEFAULT 'public'")
                self._conn.commit()

            self._conn.execute(
                "CREATE TABLE IF NOT EXISTS assets_new "
                "(id TEXT NOT NULL, room TEXT NOT NULL DEFAULT 'public', "
                "data BLOB, created_at TEXT, PRIMARY KEY (id, room))"
            )
            self._conn.execute(
                "INSERT OR REPLACE INTO assets_new (id, room, data, created_at) "
                "SELECT id, room, data, created_at FROM assets"
            )
            self._conn.execute("DROP TABLE assets")
            self._conn.execute(self._CREATE_ASSETS)
            self._conn.execute(
                "INSERT OR REPLACE INTO assets (id, room, data, created_at) "
                "SELECT id, room, data, created_at FROM assets_new"
            )
            self._conn.execute("DROP TABLE assets_new")

            # 历史单租户数据：启用 key 后迁到第一个 key 的 room
            first = first_allowed_room()
            if first:
                self._conn.execute("UPDATE pages SET room=? WHERE room='public'", (first,))
                self._conn.execute("UPDATE assets SET room=? WHERE room='public'", (first,))

            self._conn.commit()
            logger.info("[NEXUS] schema 迁移完成（已支持多租户 room 隔离）")
        except Exception as e:  # 迁移失败不应让服务起不来
            logger.error(f"[NEXUS] schema 迁移异常（已跳过）：{e}")

    def _sync_load_pages(self, room: str) -> List[Dict]:
        with self._lock:
            rows = self._conn.execute("SELECT data FROM pages WHERE room=?", (room,)).fetchall()
        out: List[Dict] = []
        for r in rows:
            d = _parse_data(r[0])
            if d is not None:
                out.append(d)
        return out

    def _sync_save_page(self, page: Dict, room: str) -> None:
        ts = page.get("updatedAt") or _now_iso()
        with self._lock:
            self._conn.execute(
                "INSERT OR REPLACE INTO pages (id, room, data, updated_at) VALUES (?, ?, ?, ?)",
                (page["id"], room, json.dumps(page, ensure_ascii=False), ts),
            )
            self._conn.commit()

    def _sync_delete_page(self, page_id: str, room: str) -> None:
        with self._lock:
            self._conn.execute("DELETE FROM pages WHERE id=? AND room=?", (page_id, room))
            self._conn.commit()

    def _sync_save_asset(self, asset_id: str, blob: bytes, room: str) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT OR REPLACE INTO assets (id, room, data, created_at) VALUES (?, ?, ?, ?)",
                (asset_id, room, blob, _now_iso()),
            )
            self._conn.commit()

    def _sync_get_asset(self, asset_id: str, room: str) -> Optional[bytes]:
        with self._lock:
            row = self._conn.execute(
                "SELECT data FROM assets WHERE id=? AND room=?", (asset_id, room)
            ).fetchone()
        return row[0] if row else None

    def _sync_delete_asset(self, asset_id: str, room: str) -> None:
        with self._lock:
            self._conn.execute("DELETE FROM assets WHERE id=? AND room=?", (asset_id, room))
            self._conn.commit()

    def _sync_vacuum(self) -> None:
        with self._lock:
            self._conn.execute("VACUUM")
            self._conn.commit()

    def _row_to_user(self, row) -> Optional[Dict]:
        if not row:
            return None
        return {"id": row[0], "provider": row[1], "sub": row[2],
                "email": row[3], "name": row[4], "created_at": row[5]}

    def _sync_create_user(self, provider: str, sub: str, email: str, name: str) -> str:
        uid = str(uuid.uuid4())
        with self._lock:
            self._conn.execute(
                "INSERT OR IGNORE INTO users (id, provider, sub, email, name, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (uid, provider, sub, email, name, _now_iso()),
            )
            self._conn.commit()
        return uid

    def _sync_get_user_by_oauth(self, provider: str, sub: str) -> Optional[Dict]:
        with self._lock:
            row = self._conn.execute(
                "SELECT id, provider, sub, email, name, created_at FROM users "
                "WHERE provider=? AND sub=?", (provider, sub)
            ).fetchone()
        return self._row_to_user(row)

    def _sync_get_user_by_email(self, email: str) -> Optional[Dict]:
        with self._lock:
            row = self._conn.execute(
                "SELECT id, provider, sub, email, name, created_at FROM users "
                "WHERE email=?", (email,)
            ).fetchone()
        return self._row_to_user(row)

    def _sync_get_user_by_id(self, uid: str) -> Optional[Dict]:
        with self._lock:
            row = self._conn.execute(
                "SELECT id, provider, sub, email, name, created_at FROM users "
                "WHERE id=?", (uid,)
            ).fetchone()
        return self._row_to_user(row)

    def _sync_create_membership(self, user_id: str, room: str, role: str,
                               status: str, label: Optional[str]) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT OR IGNORE INTO memberships (user_id, room, role, status, label, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (user_id, room, role, status, label, _now_iso()),
            )
            self._conn.commit()

    def _sync_get_memberships(self, user_id: str) -> List[Dict]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT room, role, status, label FROM memberships WHERE user_id=?", (user_id,)
            ).fetchall()
        return [{"room": r[0], "role": r[1], "status": r[2], "label": r[3]} for r in rows]

    def _sync_get_membership(self, user_id: str, room: str) -> Optional[Dict]:
        with self._lock:
            row = self._conn.execute(
                "SELECT room, role, status, label FROM memberships "
                "WHERE user_id=? AND room=?", (user_id, room)
            ).fetchone()
        if not row:
            return None
        return {"room": row[0], "role": row[1], "status": row[2], "label": row[3]}

    # ---- 异步接口实现 ----
    def _run(self, func, *args):
        # 在协程里用 get_running_loop（get_event_loop 在新版本中已废弃/行为不同）
        return asyncio.get_running_loop().run_in_executor(None, func, *args)

    async def init(self) -> None:
        await self._run(self._sync_init)

    async def close(self) -> None:
        await self._run(self._sync_close)

    def _sync_close(self) -> None:
        if self._conn is not None:
            self._conn.close()
            self._conn = None

    async def ping(self) -> bool:
        try:
            await self._run(self._sync_ping)
            return True
        except Exception:
            return False

    def _sync_ping(self) -> None:
        self._conn.execute("SELECT 1").fetchone()

    async def load_pages(self, room: str) -> List[Dict]:
        return await self._run(self._sync_load_pages, room)

    async def save_page(self, page: Dict, room: str) -> None:
        await self._run(self._sync_save_page, page, room)

    async def delete_page(self, page_id: str, room: str) -> None:
        await self._run(self._sync_delete_page, page_id, room)

    async def save_asset(self, asset_id: str, blob: bytes, room: str) -> None:
        await self._run(self._sync_save_asset, asset_id, blob, room)

    async def get_asset(self, asset_id: str, room: str) -> Optional[bytes]:
        return await self._run(self._sync_get_asset, asset_id, room)

    async def delete_asset(self, asset_id: str, room: str) -> None:
        await self._run(self._sync_delete_asset, asset_id, room)

    async def vacuum(self) -> None:
        await self._run(self._sync_vacuum)

    async def create_user(self, provider: str, sub: str, email: str, name: str) -> str:
        return await self._run(self._sync_create_user, provider, sub, email, name)

    async def get_user_by_oauth(self, provider: str, sub: str) -> Optional[Dict]:
        return await self._run(self._sync_get_user_by_oauth, provider, sub)

    async def get_user_by_email(self, email: str) -> Optional[Dict]:
        return await self._run(self._sync_get_user_by_email, email)

    async def get_user_by_id(self, user_id: str) -> Optional[Dict]:
        return await self._run(self._sync_get_user_by_id, user_id)

    async def create_membership(self, user_id: str, room: str, role: str,
                               status: str = "active", label: Optional[str] = None) -> None:
        await self._run(self._sync_create_membership, user_id, room, role, status, label)

    async def get_memberships(self, user_id: str) -> List[Dict]:
        return await self._run(self._sync_get_memberships, user_id)

    async def get_membership(self, user_id: str, room: str) -> Optional[Dict]:
        return await self._run(self._sync_get_membership, user_id, room)


# ============================================================
# Postgres 实现（asyncpg）
# ============================================================
class PostgresDatabase(Database):
    """Postgres 实现（基于 asyncpg）。

    启用方式：在 .env 里设置
        DATABASE_URL=postgres://user:pass@host:5432/dbname
        （也接受 postgresql:// 前缀）
    依赖：pip install asyncpg（已列入 requirements.txt）

    与 SQLite 实现的差异（全部封装在本类内，业务代码无感）：
      - 占位符用 $1,$2... 而非 ?
      - upsert 用 ON CONFLICT (id, room) DO UPDATE，而非 INSERT OR REPLACE
      - data 列用 JSONB：写入需显式 ::jsonb 转换，读取返回 str（_parse_data 兼容）
      - varchar/TEXT 无长度限制，updated_at 沿用 TEXT 存 ISO 串，便于与前端一致比较
    """

    backend_name = "postgres"

    _CREATE_PAGES = (
        "CREATE TABLE IF NOT EXISTS pages ("
        "id TEXT NOT NULL, "
        "room TEXT NOT NULL DEFAULT 'public', "
        "data JSONB, "
        "updated_at TEXT, "
        "PRIMARY KEY (id, room))"
    )
    _CREATE_ASSETS = (
        "CREATE TABLE IF NOT EXISTS assets ("
        "id TEXT NOT NULL, "
        "room TEXT NOT NULL DEFAULT 'public', "
        "data BYTEA, "
        "created_at TEXT, "
        "PRIMARY KEY (id, room))"
    )
    _CREATE_INDEX = (
        "CREATE INDEX IF NOT EXISTS idx_pages_room_updated ON pages (room, updated_at)"
    )
    _CREATE_USERS = (
        "CREATE TABLE IF NOT EXISTS users ("
        "id TEXT PRIMARY KEY, provider TEXT, sub TEXT, "
        "email TEXT, name TEXT, created_at TEXT)"
    )
    _CREATE_MEMBERSHIPS = (
        "CREATE TABLE IF NOT EXISTS memberships ("
        "user_id TEXT NOT NULL, room TEXT NOT NULL, role TEXT NOT NULL, "
        "status TEXT NOT NULL DEFAULT 'active', label TEXT, created_at TEXT, "
        "PRIMARY KEY (user_id, room))"
    )

    def __init__(self, dsn: str) -> None:
        self._dsn = dsn
        self._pool: Any = None

    async def init(self) -> None:
        try:
            import asyncpg
        except ImportError as e:  # 只有使用 Postgres 时才需要该驱动
            raise RuntimeError(
                "设置了 DATABASE_URL 但未安装 asyncpg，请执行：pip install asyncpg"
            ) from e
        self._pool = await asyncpg.create_pool(self._dsn)
        async with self._pool.acquire() as conn:
            await conn.execute(self._CREATE_PAGES)
            await conn.execute(self._CREATE_ASSETS)
            await conn.execute(self._CREATE_INDEX)
            await conn.execute(self._CREATE_USERS)
            await conn.execute(self._CREATE_MEMBERSHIPS)
        await self._migrate()

    async def _migrate(self) -> None:
        """补齐 room 列并确保复合主键 (id, room)。Postgres 下可直接 ALTER。"""
        async with self._pool.acquire() as conn:
            await conn.execute(
                "ALTER TABLE pages ADD COLUMN IF NOT EXISTS room TEXT NOT NULL DEFAULT 'public'"
            )
            await conn.execute("ALTER TABLE pages DROP CONSTRAINT IF EXISTS pages_pkey")
            await conn.execute("ALTER TABLE pages ADD PRIMARY KEY (id, room)")

            await conn.execute(
                "ALTER TABLE assets ADD COLUMN IF NOT EXISTS room TEXT NOT NULL DEFAULT 'public'"
            )
            await conn.execute("ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_pkey")
            await conn.execute("ALTER TABLE assets ADD PRIMARY KEY (id, room)")

    async def close(self) -> None:
        if self._pool is not None:
            await self._pool.close()
            self._pool = None

    async def ping(self) -> bool:
        try:
            async with self._pool.acquire() as conn:
                await conn.execute("SELECT 1")
            return True
        except Exception:
            return False

    async def load_pages(self, room: str) -> List[Dict]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch("SELECT data FROM pages WHERE room=$1", room)
        out: List[Dict] = []
        for r in rows:
            d = _parse_data(r["data"])
            if d is not None:
                out.append(d)
        return out

    async def save_page(self, page: Dict, room: str) -> None:
        ts = page.get("updatedAt") or _now_iso()
        payload = json.dumps(page, ensure_ascii=False)
        async with self._pool.acquire() as conn:
            await conn.execute(
                "INSERT INTO pages (id, room, data, updated_at) VALUES ($1, $2, $3::jsonb, $4) "
                "ON CONFLICT (id, room) DO UPDATE SET "
                "data = EXCLUDED.data, updated_at = EXCLUDED.updated_at",
                page["id"], room, payload, ts,
            )

    async def delete_page(self, page_id: str, room: str) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute("DELETE FROM pages WHERE id=$1 AND room=$2", page_id, room)

    async def save_asset(self, asset_id: str, blob: bytes, room: str) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute(
                "INSERT INTO assets (id, room, data, created_at) VALUES ($1, $2, $3, $4) "
                "ON CONFLICT (id, room) DO UPDATE SET data = EXCLUDED.data",
                asset_id, room, blob, _now_iso(),
            )

    async def get_asset(self, asset_id: str, room: str) -> Optional[bytes]:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT data FROM assets WHERE id=$1 AND room=$2", asset_id, room
            )
        return row["data"] if row else None

    async def delete_asset(self, asset_id: str, room: str) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute("DELETE FROM assets WHERE id=$1 AND room=$2", asset_id, room)

    async def vacuum(self) -> None:
        # Postgres 的 VACUUM 不能在事务块内执行，且通常由 autovacuum 处理；
        # 这里不做任何事，需要时由运维用定时任务执行。
        return None

    async def create_user(self, provider: str, sub: str, email: str, name: str) -> str:
        uid = str(uuid.uuid4())
        async with self._pool.acquire() as conn:
            await conn.execute(
                "INSERT INTO users (id, provider, sub, email, name, created_at) "
                "VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING",
                uid, provider, sub, email, name, _now_iso(),
            )
        return uid

    async def get_user_by_oauth(self, provider: str, sub: str) -> Optional[Dict]:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT id, provider, sub, email, name, created_at FROM users "
                "WHERE provider=$1 AND sub=$2", provider, sub
            )
        return dict(row) if row else None

    async def get_user_by_email(self, email: str) -> Optional[Dict]:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT id, provider, sub, email, name, created_at FROM users "
                "WHERE email=$1", email
            )
        return dict(row) if row else None

    async def get_user_by_id(self, user_id: str) -> Optional[Dict]:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT id, provider, sub, email, name, created_at FROM users "
                "WHERE id=$1", user_id
            )
        return dict(row) if row else None

    async def create_membership(self, user_id: str, room: str, role: str,
                               status: str = "active", label: Optional[str] = None) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute(
                "INSERT INTO memberships (user_id, room, role, status, label, created_at) "
                "VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (user_id, room) DO NOTHING",
                user_id, room, role, status, label, _now_iso(),
            )

    async def get_memberships(self, user_id: str) -> List[Dict]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT room, role, status, label FROM memberships WHERE user_id=$1", user_id
            )
        return [dict(r) for r in rows]

    async def get_membership(self, user_id: str, room: str) -> Optional[Dict]:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT room, role, status, label FROM memberships "
                "WHERE user_id=$1 AND room=$2", user_id, room
            )
        return dict(row) if row else None


def create_database() -> Database:
    """按 DATABASE_URL 选择实现。不设置则默认 SQLite（nexus.db）。"""
    dsn = (os.getenv("DATABASE_URL") or "").strip()
    if dsn.startswith("postgres://") or dsn.startswith("postgresql://"):
        return PostgresDatabase(dsn)
    default_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "nexus.db")
    return SQLiteDatabase(os.getenv("DB_PATH") or default_path)
