"""轻量运行时监控（进程内计数器，零额外依赖）。

目标：给 /api/health 与 /api/metrics 提供「够用」的可观测性，
不引入 Prometheus client 之类的额外依赖（指标文本格式自己拼，见下）。

局限（重要）：
- 计数器只在本进程内存中，进程重启即清零；
- 多实例部署时每个实例只统计自己那份，需要外部指标系统聚合
  （多实例时把 collect() 改成写 Redis / Prometheus exporter 即可，调用点不变）。
"""
from __future__ import annotations

import threading
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Union

_START = time.time()
_LOCK = threading.Lock()

_requests = 0
_errors = 0
_ws_messages = 0
_broadcasts = 0
_last_error: Optional[str] = None
_last_error_at: Optional[str] = None

# ---- 业务指标（用量 / 性能 / 异常） ----
_sync_conflicts = 0          # 累计同步冲突数
_asset_uploads = 0           # 累计资产上传次数
_asset_bytes = 0             # 累计资产写入字节数
_logins = 0                  # 累计账号登录成功数
_login_failures = 0          # 累计登录失败数
_slow_requests_top: List[Dict[str, Any]] = []   # 慢请求 TopN（按耗时降序，有界）
_SLOW_TOP_MAX = 10
_SLOW_THRESHOLD_MS = 1000    # 超过此耗时才记为慢请求


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def record_request() -> None:
    global _requests
    with _LOCK:
        _requests += 1


def record_error(msg: Union[str, Exception]) -> None:
    """记录一次错误。存最近一次的文案与时间，便于外部巡检定位。"""
    global _errors, _last_error, _last_error_at
    text = str(msg)
    with _LOCK:
        _errors += 1
        _last_error = text
        _last_error_at = _now_iso()


def record_ws_message() -> None:
    global _ws_messages
    with _LOCK:
        _ws_messages += 1


def record_broadcast() -> None:
    global _broadcasts
    with _LOCK:
        _broadcasts += 1


def record_sync_conflict() -> None:
    """记录一次同步冲突（块级 LWW 出现并发修改）。"""
    global _sync_conflicts
    with _LOCK:
        _sync_conflicts += 1


def record_asset_upload() -> None:
    global _asset_uploads
    with _LOCK:
        _asset_uploads += 1


def record_asset_bytes(n: int) -> None:
    global _asset_bytes
    with _LOCK:
        _asset_bytes += max(0, int(n))


def record_login(success: bool = True) -> None:
    global _logins, _login_failures
    with _LOCK:
        if success:
            _logins += 1
        else:
            _login_failures += 1


def record_slow_request(path: str, ms: float) -> None:
    """记录一条慢请求，按耗时保留 TopN。"""
    with _LOCK:
        _slow_requests_top.append({"path": path, "ms": round(ms, 1), "at": _now_iso()})
        _slow_requests_top.sort(key=lambda x: x["ms"], reverse=True)
        if len(_slow_requests_top) > _SLOW_TOP_MAX:
            _slow_requests_top[:] = _slow_requests_top[:_SLOW_TOP_MAX]


def uptime_seconds() -> float:
    return time.time() - _START


def snapshot() -> Dict[str, Any]:
    """返回当前计数快照（供 /api/health 使用）。"""
    with _LOCK:
        return {
            "requests": _requests,
            "errors": _errors,
            "ws_messages": _ws_messages,
            "broadcasts": _broadcasts,
            "sync_conflicts": _sync_conflicts,
            "asset_uploads": _asset_uploads,
            "asset_bytes": _asset_bytes,
            "logins": _logins,
            "login_failures": _login_failures,
            "slow_requests": len(_slow_requests_top),
            "last_error": _last_error,
            "last_error_at": _last_error_at,
        }


def business_snapshot() -> Dict[str, Any]:
    """业务指标快照（供 /api/admin/dashboard 与 /admin 面板使用）。"""
    with _LOCK:
        return {
            "requests": _requests,
            "errors": _errors,
            "error_rate": round(_errors / _requests, 4) if _requests else 0.0,
            "ws_messages": _ws_messages,
            "broadcasts": _broadcasts,
            "sync_conflicts": _sync_conflicts,
            "asset_uploads": _asset_uploads,
            "asset_bytes": _asset_bytes,
            "logins": _logins,
            "login_failures": _login_failures,
            "slow_requests": len(_slow_requests_top),
            "slow_top": list(_slow_requests_top),
            "last_error": _last_error,
            "last_error_at": _last_error_at,
        }


def collect() -> List[Dict[str, Any]]:
    """返回指标定义列表：[(name, help, type, value)]。

    统一在这里定义，避免 /api/health 的 JSON 与 /api/metrics 的
    Prometheus 文本出现口径不一致。
    """
    s = snapshot()
    return [
        {
            "name": "nexus_uptime_seconds",
            "help": "服务已运行的秒数",
            "type": "gauge",
            "value": float(round(uptime_seconds(), 3)),
        },
        {"name": "nexus_requests_total", "help": "累计 HTTP 请求数", "type": "counter", "value": float(s["requests"])},
        {"name": "nexus_errors_total", "help": "累计错误数", "type": "counter", "value": float(s["errors"])},
        {"name": "nexus_ws_messages_total", "help": "累计收到的 WebSocket 消息数", "type": "counter", "value": float(s["ws_messages"])},
        {"name": "nexus_broadcasts_total", "help": "累计房间广播次数", "type": "counter", "value": float(s["broadcasts"])},
        {"name": "nexus_sync_conflicts_total", "help": "累计同步冲突数", "type": "counter", "value": float(s["sync_conflicts"])},
        {"name": "nexus_asset_uploads_total", "help": "累计资产上传数", "type": "counter", "value": float(s["asset_uploads"])},
        {"name": "nexus_asset_bytes_total", "help": "累计资产写入字节数", "type": "counter", "value": float(s["asset_bytes"])},
        {"name": "nexus_logins_total", "help": "累计账号登录成功数", "type": "counter", "value": float(s["logins"])},
        {"name": "nexus_login_failures_total", "help": "累计登录失败数", "type": "counter", "value": float(s["login_failures"])},
        {"name": "nexus_slow_requests_total", "help": "累计慢请求数(>=1s)", "type": "counter", "value": float(s["slow_requests"])},
    ]


def render_prometheus(extra: Optional[List[Dict[str, Any]]] = None) -> str:
    """渲染 Prometheus 文本格式（exposition format v0.0.4）。

    形如：
        # HELP nexus_requests_total 累计 HTTP 请求数
        # TYPE nexus_requests_total counter
        nexus_requests_total 812

    extra 用于追加运行时的瞬时指标（房间数 / 连接数等），
    结构与 collect() 返回的一致。
    """
    metrics: List[Dict[str, Any]] = list(collect())
    if extra:
        metrics.extend(extra)

    lines: List[str] = []
    for m in metrics:
        lines.append(f"# HELP {m['name']} {m['help']}")
        lines.append(f"# TYPE {m['name']} {m['type']}")
        lines.append(f"{m['name']} {_fmt_value(m['value'])}")
        lines.append("")
    return "\n".join(lines)


def _fmt_value(value: Any) -> str:
    """Prometheus 数值格式：整数不带小数点；特殊值 +Inf/-Inf/NaN 原样输出。"""
    if isinstance(value, str):
        return value
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, float):
        if value != value:  # NaN
            return "NaN"
        if value == float("inf"):
            return "+Inf"
        if value == float("-inf"):
            return "-Inf"
        if value.is_integer():
            return str(int(value))
    return str(value)
