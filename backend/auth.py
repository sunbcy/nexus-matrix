"""账户 / 多租户工作区 / OAuth 鉴权层（叠加在现有 room 隔离之上）。

设计要点：
- room 仍是数据隔离单元（= sha256(key) 或 OAuth 用户的 uuid 工作区），不改动现有隔离。
- 身份分两层，resolve_principal_room 统一出口：
    (1) legacy API Key（keys.py）：sha256 → room，向后兼容，现有设备零改动；
    (2) 账户 JWT：登录 / 切换工作区时签发，payload={sub, room, email, name, provider}，
        由 resolve_principal_room 优先识别，因此前端【无需改动】即可把 JWT 当 token 用
        （OAuth 回调重定向到 /?apiKey=<jwt>，复用现有注入链路）。
- OAuth 用 authlib 做服务端中转（client_secret 只留服务端，不进前端）。
"""
from __future__ import annotations

import json
import jwt
import logging
import os
import secrets
import uuid
from datetime import datetime, timezone, timedelta
from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse
from typing import Dict, Optional
from urllib.parse import urlencode

from keys import validate

logger = logging.getLogger("NexusSync")


# ---------------- JWT 密钥（持久化到 jwt_secret 文件，避免重启即失效） ----------------
def _load_jwt_secret() -> str:
    env = os.getenv("JWT_SECRET")
    if env:
        return env
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "jwt_secret")
    try:
        if os.path.isfile(path):
            with open(path, "r", encoding="utf-8") as f:
                s = f.read().strip()
                if s:
                    return s
    except Exception:
        pass
    s = secrets.token_urlsafe(32)
    try:
        with open(path, "w", encoding="utf-8") as f:
            f.write(s)
        os.chmod(path, 0o600)
    except Exception as e:  # 写失败也别崩，只是本次进程内有效
        logger.warning(f"[NEXUS] 无法持久化 jwt_secret（{e}），重启后已签发 JWT 将失效")
    return s


JWT_SECRET = _load_jwt_secret()
JWT_ALGO = "HS256"
JWT_EXP_DAYS = int(os.getenv("JWT_EXP_DAYS", "7"))


# ---------------- 与 db 单例解耦（避免与 main 循环 import） ----------------
_DB = None


def set_db(db) -> None:
    global _DB
    _DB = db


def issue_token(user_id: str, room: str, email: str, name: str, provider: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "room": room,
        "email": email,
        "name": name,
        "provider": provider,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=JWT_EXP_DAYS)).timestamp()),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


def decode_jwt(token: str) -> Optional[Dict]:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except Exception:
        return None


# ---------------- 身份解析：JWT 优先，legacy key 兜底 ----------------
async def resolve_principal_room(token: str) -> Optional[str]:
    """返回该 token 对应的 room；非法/过期/无权限返回 None。

    JWT 路径：解出 sub+room → 确认该用户对 room 有 active 成员关系才放行（防止伪造 room）。
    legacy 路径：回退到 keys.validate（含开放模式 PUBLIC_ROOM）。
    """
    if not token:
        return None
    payload = decode_jwt(token)
    if payload and payload.get("sub") and payload.get("room"):
        m = await _DB.get_membership(payload["sub"], payload["room"])
        if m and m.get("status") == "active":
            return payload["room"]
    return validate(token)


# ---------------- OAuth（authlib 服务端中转） ----------------
oauth = None


def _init_oauth() -> None:
    global oauth
    gid = os.getenv("OAUTH_GOOGLE_ID")
    gsecret = os.getenv("OAUTH_GOOGLE_SECRET")
    if not (gid and gsecret):
        logger.info("[NEXUS] 未配置 OAUTH_GOOGLE_ID/SECRET，Google 登录不可用（dev-login 仍可用）")
        return
    try:
        from authlib.integrations.starlette_client import OAuth as _OAuth
    except ImportError:
        logger.warning("[NEXUS] 未安装 authlib，Google 登录不可用（pip install authlib）")
        return
    oauth = _OAuth()
    oauth.register(
        name="google",
        client_id=gid,
        client_secret=gsecret,
        server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
        client_kwargs={"scope": "openid email profile"},
    )


_init_oauth()


# ---------------- 账户 / 工作区助手 ----------------
async def find_or_create_oauth_user(provider: str, sub: str, email: str, name: str) -> Dict:
    u = await _DB.get_user_by_oauth(provider, sub)
    if u:
        return u
    # 同邮箱已存在账户则视为同一人（合并），避免重复建号
    u = await _DB.get_user_by_email(email)
    if u:
        return u
    uid = await _DB.create_user(provider, sub, email, name)
    return await _DB.get_user_by_id(uid)


async def ensure_personal_room(user_id: str, label: str) -> str:
    """确保用户有一个私人工作区（owner）。已存在则复用，返回 room。"""
    memberships = await _DB.get_memberships(user_id)
    owned = [m for m in memberships if m.get("role") == "owner"]
    if owned:
        return owned[0]["room"]
    room = str(uuid.uuid4())
    await _DB.create_membership(user_id, room, "owner", "active", label)
    return room


# ---------------- 请求助手 ----------------
def _token_from_request(request: Request) -> Optional[str]:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return (request.query_params.get("api_key") or "").strip()


async def _require_user(request: Request) -> Dict:
    token = _token_from_request(request)
    payload = decode_jwt(token) if token else None
    if not payload or not payload.get("sub"):
        raise HTTPException(status_code=401, detail="Unauthorized: account required")
    user = await _DB.get_user_by_id(payload["sub"])
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized: account not found")
    return user


async def _require_member(request: Request, room: str, roles) -> Dict:
    """校验当前账户对该 room 是 active 成员且角色在 roles 内；返回 user。否则 403。"""
    user = await _require_user(request)
    m = await _DB.get_membership(user["id"], room)
    if not m or m.get("status") != "active" or m.get("role") not in roles:
        raise HTTPException(status_code=403, detail="permission denied")
    return user


def _json(status: int, body: Dict) -> JSONResponse:
    return JSONResponse(status_code=status, content=body)


# ---------------- 路由注册 ----------------
def register_auth_routes(app) -> None:
    @app.get("/api/auth/oauth/google")
    async def google_login(request: Request):
        if oauth is None or not getattr(oauth, "google", None):
            return RedirectResponse("/?auth_error=google_not_configured")
        # 无论用环境变量还是 request.base_url，统一去掉结尾斜杠，避免拼出 //callback
        base = os.getenv("OAUTH_REDIRECT_BASE", str(request.base_url)).rstrip("/")
        redirect_uri = base + "/api/auth/oauth/google/callback"
        # select_account：每次登录都弹账户选择器，便于切换/重新登录（不影响已授权 scope）
        return await oauth.google.authorize_redirect(request, redirect_uri, prompt="select_account")

    @app.get("/api/auth/oauth/google/callback")
    async def google_callback(request: Request):
        if oauth is None or not getattr(oauth, "google", None):
            return RedirectResponse("/?auth_error=google_not_configured")
        try:
            token = await oauth.google.authorize_access_token(request)
        except Exception as e:
            logger.error(f"[NEXUS] Google OAuth 失败: {e}")
            return RedirectResponse("/?auth_error=oauth_failed")
        userinfo = token.get("userinfo") or {}
        if not userinfo:
            try:
                userinfo = await oauth.google.userinfo(token=token)
            except Exception:
                userinfo = {}
        email = userinfo.get("email")
        sub = userinfo.get("sub") or email
        name = userinfo.get("name") or email or "user"
        if not email:
            return RedirectResponse("/?auth_error=no_email")
        user = await find_or_create_oauth_user("google", sub, email, name)
        room = await ensure_personal_room(user["id"], f"{name or email} 的空间")
        jwt_token = issue_token(user["id"], room, email, name, "google")
        return RedirectResponse(f"/?apiKey={jwt_token}")

    @app.get("/api/auth/config")
    async def auth_config():
        """前端据此决定显示/启用 Google 登录按钮。"""
        enabled = bool(oauth and getattr(oauth, "google", None))
        return _json(200, {"google_oauth": enabled})

    @app.post("/api/auth/dev-login")
    async def dev_login(payload: Dict, request: Request):
        """本地测试用：无需 Google 凭据即可走完「账户→工作区→JWT」全链路。
        仅当 NEXUS_DEV_LOGIN=1 时启用，生产务必关闭。"""
        if os.getenv("NEXUS_DEV_LOGIN") != "1":
            return _json(401, {"error": "dev-login disabled"})
        email = (payload.get("email") or "").strip()
        if not email:
            return _json(400, {"error": "email required"})
        name = payload.get("name") or email
        user = await find_or_create_oauth_user("dev", email, email, name)
        room = await ensure_personal_room(user["id"], f"{name} 的空间")
        jwt_token = issue_token(user["id"], room, email, name, "dev")
        return _json(200, {"token": jwt_token, "user": user, "room": room})

    @app.get("/api/auth/me")
    async def auth_me(request: Request):
        user = await _require_user(request)
        payload = decode_jwt(_token_from_request(request) or "")
        return _json(200, {
            "user": {"id": user["id"], "email": user["email"],
                     "name": user["name"], "provider": user["provider"]},
            "active_room": payload.get("room") if payload else None,
            "workspaces": await _DB.get_memberships(user["id"]),
        })

    @app.get("/api/workspaces")
    async def list_workspaces(request: Request):
        user = await _require_user(request)
        return _json(200, {"workspaces": await _DB.get_memberships(user["id"])})

    @app.post("/api/auth/select-workspace")
    async def select_workspace(payload: Dict, request: Request):
        user = await _require_user(request)
        room = (payload.get("room") or "").strip()
        m = await _DB.get_membership(user["id"], room)
        if not m or m.get("status") != "active":
            return _json(403, {"error": "no access to workspace"})
        jwt_token = issue_token(user["id"], room, user["email"], user["name"], user["provider"])
        return _json(200, {"token": jwt_token, "room": room})

    @app.post("/api/workspaces/{room}/invite")
    async def invite(room: str, payload: Dict, request: Request):
        """邀请一个邮箱加入工作区（owner/admin）。幂等：已活跃则不变，已待接受则保留。
        目标用户若不存在会按其邮箱预建（登录后 email 匹配即合并到同一账户）。"""
        await _require_member(request, room, ("owner", "admin"))
        email = (payload.get("email") or "").strip()
        if not email:
            return _json(400, {"error": "email required"})
        role = payload.get("role") or "member"
        if role not in ("admin", "member"):
            role = "member"
        target = await _DB.get_user_by_email(email)
        if not target:
            target = await _DB.get_user_by_id(await _DB.create_user("invite", email, email, email))
        existing = await _DB.get_membership(target["id"], room)
        if existing and existing.get("status") == "active":
            return _json(200, {"ok": True, "invited": email, "status": "active", "already": True})
        if existing:
            await _DB.update_membership(target["id"], room, role=role, status="pending")
        else:
            await _DB.create_membership(target["id"], room, role, "pending", None)
        return _json(200, {"ok": True, "invited": email, "status": "pending", "role": role})

    @app.post("/api/workspaces/{room}/accept")
    async def accept_invite(room: str, request: Request):
        """被邀请者接受邀请：把自己的 membership 由 pending 置为 active，从而可访问该工作区。"""
        user = await _require_user(request)
        m = await _DB.get_membership(user["id"], room)
        if not m:
            return _json(404, {"error": "no invitation"})
        if m.get("status") == "active":
            return _json(200, {"ok": True, "status": "active"})
        await _DB.update_membership(user["id"], room, status="active")
        return _json(200, {"ok": True, "status": "active"})

    @app.get("/api/workspaces/{room}/members")
    async def list_members(room: str, request: Request):
        """列出工作区成员（owner/admin）。返回含 user 信息的列表。"""
        await _require_member(request, room, ("owner", "admin"))
        members = await _DB.get_members_by_room(room)
        return _json(200, {"members": members})

    @app.post("/api/workspaces/{room}/members/{user_id}/role")
    async def set_member_role(room: str, user_id: str, payload: Dict, request: Request):
        """改成员角色（owner/admin）。不允许把唯一 owner 降级，以免工作区无主。"""
        await _require_member(request, room, ("owner", "admin"))
        new_role = (payload.get("role") or "").strip()
        if new_role not in ("owner", "admin", "member"):
            return _json(400, {"error": "invalid role"})
        target = await _DB.get_membership(user_id, room)
        if not target:
            return _json(404, {"error": "member not found"})
        if target.get("role") == "owner" and new_role != "owner":
            owners = [m for m in await _DB.get_members_by_room(room) if m.get("role") == "owner"]
            if len(owners) <= 1:
                return _json(400, {"error": "cannot remove last owner"})
        await _DB.update_membership(user_id, room, role=new_role)
        return _json(200, {"ok": True, "role": new_role})

    @app.delete("/api/workspaces/{room}/members/{user_id}")
    async def remove_member(room: str, user_id: str, request: Request):
        """移除成员（owner/admin 移除他人；任何人可移除自己=退出）。不允许移除唯一 owner。"""
        caller = await _require_user(request)
        target = await _DB.get_membership(user_id, room)
        if not target:
            return _json(404, {"error": "member not found"})
        if user_id != caller["id"]:
            my = await _DB.get_membership(caller["id"], room)
            if not my or my.get("status") != "active" or my.get("role") not in ("owner", "admin"):
                return _json(403, {"error": "permission denied"})
        if target.get("role") == "owner":
            owners = [m for m in await _DB.get_members_by_room(room) if m.get("role") == "owner"]
            if len(owners) <= 1:
                return _json(400, {"error": "cannot remove last owner"})
        await _DB.delete_membership(user_id, room)
        return _json(200, {"ok": True})

    @app.post("/api/workspaces/{room}/invite-link")
    async def create_invite_link(room: str, payload: Dict, request: Request):
        """生成一条开放邀请链接（owner/admin）。任何已登录用户持链接即可加入该工作区。
        可选 body: {role: 'member'|'admin', expires_in_hours: int(默认168=7天)}。"""
        await _require_member(request, room, ("owner", "admin"))
        role = payload.get("role") or "member"
        if role not in ("admin", "member"):
            role = "member"
        try:
            hours = float(payload.get("expires_in_hours") or 168)
        except (TypeError, ValueError):
            hours = 168.0
        expires_at = (datetime.now(timezone.utc) + timedelta(hours=hours)).timestamp()
        user = await _require_user(request)
        token = secrets.token_urlsafe(24)
        await _DB.create_invite_link(token, room, role, user["id"], expires_at)
        return _json(200, {"token": token, "role": role,
                           "expires_at": expires_at, "url": f"/?invite={token}"})

    @app.get("/api/workspaces/invite/{token}")
    async def view_invite_link(token: str, request: Request):
        """查看邀请链接信息。未登录返回 401（前端据此提示先登录）。"""
        link = await _DB.get_invite_link(token)
        if not link:
            return _json(404, {"error": "invite not found"})
        now = datetime.now(timezone.utc).timestamp()
        expired = link.get("expires_at") is not None and link["expires_at"] < now
        label = None
        caller = None
        auth_hdr = request.headers.get("Authorization", "")
        if auth_hdr.startswith("Bearer "):
            try:
                payload = jwt.decode(auth_hdr[7:], NEXUS_API_KEY, algorithms=["HS256"])
                caller = await _DB.get_user_by_id(payload["sub"])
            except Exception:
                caller = None
        status = "none"
        if caller:
            m = await _DB.get_membership(caller["id"], link["room"])
            if m:
                status = m.get("status", "active")
        return _json(200, {"room": link["room"], "role": link["role"], "label": label,
                           "expired": expired, "status": status})

    @app.post("/api/workspaces/invite/{token}/accept")
    async def accept_invite_link(token: str, request: Request):
        """持链接加入工作区：把当前登录用户以链接角色写入/激活 membership（open invite）。"""
        user = await _require_user(request)
        link = await _DB.get_invite_link(token)
        if not link:
            return _json(404, {"error": "invite not found"})
        now = datetime.now(timezone.utc).timestamp()
        if link.get("expires_at") is not None and link["expires_at"] < now:
            return _json(410, {"error": "invite expired"})
        room = link["room"]
        existing = await _DB.get_membership(user["id"], room)
        if existing and existing.get("status") == "active":
            return _json(200, {"ok": True, "room": room, "already": True})
        if existing:
            await _DB.update_membership(user["id"], room, role=link["role"], status="active")
        else:
            await _DB.create_membership(user["id"], room, link["role"], "active", None)
        return _json(200, {"ok": True, "room": room})

    @app.get("/api/workspaces/{room}/invite-links")
    async def list_invite_links(room: str, request: Request):
        """列出工作区当前有效的邀请链接（owner/admin）。"""
        await _require_member(request, room, ("owner", "admin"))
        links = await _DB.list_invite_links(room)
        return _json(200, {"links": links})

    @app.delete("/api/workspaces/{room}/invite-links/{token}")
    async def revoke_invite_link(room: str, token: str, request: Request):
        """撤销（删除）一条邀请链接（owner/admin）。"""
        await _require_member(request, room, ("owner", "admin"))
        await _DB.revoke_invite_link(token)
        return _json(200, {"ok": True})
