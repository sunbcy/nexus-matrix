"""多租户密钥（tenant key）管理：签发 / 校验 / 吊销。

模型：
    一个 key = 一个独立租户房间(room)；room = sha256(key)。
    相同 key 的多台设备属于同一用户，互相实时同步；
    不同 key 之间数据完全隔离（DB 层 room 过滤 + 广播层 room 分桶，双重保险）。

存储：
    只存 key 的 sha256 哈希，**不落明文**。因此数据库/配置文件即使被读到，
    也无法反推出可用 key（唯一泄露点是签发时控制台打印的那一次）。

key 的两个来源（取并集，命中任一即有效）：
    1) keys.json —— 推荐，由 keyctl.py 管理，支持按 label 单独吊销；
    2) 环境变量 NEXUS_API_KEY —— 旧部署兼容，逗号分隔，**无法单独吊销**。
       （若某个 key 仍写在这里，吊销不会生效；keyctl.py 会提示你移出来。）
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
from typing import Dict, Optional

logger = logging.getLogger("NexusSync")

# 未启用鉴权（开放模式）时，所有连接落入的公共房间
PUBLIC_ROOM = "public"

# keys.json 路径，可用 KEYS_FILE 覆盖
KEYS_PATH = os.getenv("KEYS_FILE") or os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "keys.json"
)


def room_of(token: str) -> str:
    """由 key 派生租户 room（sha256）。空 token 归到 PUBLIC_ROOM。"""
    if not token:
        return PUBLIC_ROOM
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _load_file_entries() -> list:
    """读取 keys.json；不存在或解析失败时返回空列表（不抛异常）。"""
    if not os.path.isfile(KEYS_PATH):
        return []
    try:
        with open(KEYS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data.get("keys", []) or []
    except Exception as e:
        logger.error(f"[NEXUS] keys.json 读取失败（{KEYS_PATH}）：{e}")
        return []


def _env_keys() -> list:
    """旧部署兼容：环境变量里的 key 列表。"""
    raw = os.getenv("NEXUS_API_KEY") or ""
    out = []
    for k in raw.split(","):
        k = k.strip()
        if k:
            out.append({"hash": room_of(k), "label": "legacy-env", "created_at": "-", "revoked": False})
    return out


def load_allowed_keys() -> Dict[str, dict]:
    """返回 {room_hash: entry}。文件条目优先于环境变量同名条目。"""
    out: Dict[str, dict] = {}
    for e in _load_file_entries():
        h = e.get("hash") or ""
        if h:
            out[h] = e
    for e in _env_keys():
        out.setdefault(e["hash"], e)
    return out


# mtime 缓存：keyctl 改动 keys.json 后，无需重启后端即可生效（重新校验时会重载）
_keys_cache: Dict[str, object] = {"mtime": None, "entries": {}}


def get_allowed_keys() -> Dict[str, dict]:
    try:
        mtime = os.stat(KEYS_PATH).st_mtime
    except OSError:
        mtime = None
    if _keys_cache["mtime"] != mtime:
        _keys_cache["entries"] = load_allowed_keys()
        _keys_cache["mtime"] = mtime
    return _keys_cache["entries"]  # type: ignore[return-value]


def first_allowed_room() -> Optional[str]:
    """（排序后）第一个已启用 key 的 room，用于把历史单租户数据迁过去。"""
    file_rooms = [e.get("hash") for e in _load_file_entries() if e.get("hash")]
    if file_rooms:
        return sorted(file_rooms)[0]
    env_rooms = [e["hash"] for e in _env_keys()]
    return sorted(env_rooms)[0] if env_rooms else None


def validate(token: str) -> Optional[str]:
    """校验 token 并返回其 room；未配置任何 key 时返回 PUBLIC_ROOM（开放模式）。"""
    entries = get_allowed_keys()
    if not entries:
        return PUBLIC_ROOM
    entry = entries.get(room_of(token))
    if entry and not entry.get("revoked"):
        return entry["hash"]
    return None
