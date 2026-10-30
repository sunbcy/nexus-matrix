#!/usr/bin/env python3
"""Nexus Matrix —— 密钥签发 / 吊销 管理脚本。

用法：
    python keyctl.py add <label>                  签发一个新 key（label 标识用户/设备，如 alice）
    python keyctl.py list                         列出所有 key（只显示 room 前缀，不显示明文）
    python keyctl.py revoke <label|room前缀>      吊销某个 key
    python keyctl.py unrevok <label|room前缀>     恢复某个 key（误吊销补救）
    python keyctl.py remove <label|room前缀>      彻底删除条目

说明：
- keys.json 里只存 key 的 sha256，**不存明文**；明文仅在 `add` 时打印一次，请自行保存。
- 后端通过 mtime 检测 keys.json 变化，修改后**无需重启**即可对新的连接生效。
- 但**已建立**的 WebSocket 连接不会被强制断开；若要立即踢掉，请重启后端：
      sudo systemctl restart nexus
- 若某个 key 仍写在环境变量 NEXUS_API_KEY 中，吊销不会生效（环境变量优先级兜底）。
  `list` 会对此给出提示——请把它从环境变量移出，改用 keyctl 签发。
"""
from __future__ import annotations

import argparse
import json
import os
import secrets
import sys
from datetime import datetime, timezone
from typing import Dict, List, Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from keys import KEYS_PATH, room_of  # noqa: E402


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _read() -> dict:
    if not os.path.isfile(KEYS_PATH):
        return {"keys": []}
    try:
        with open(KEYS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        data.setdefault("keys", [])
        return data
    except Exception as e:
        print(f"[错误] keys.json 解析失败：{e}", file=sys.stderr)
        sys.exit(1)


def _write(data: dict) -> None:
    tmp = f"{KEYS_PATH}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, KEYS_PATH)  # 原子替换，避免半写状态
    try:
        os.chmod(KEYS_PATH, 0o600)
    except Exception:
        pass


def _find(entries: List[dict], target: str) -> List[int]:
    """按 label 全等或 room 前缀匹配，返回命中的下标列表。"""
    hits = [i for i, e in enumerate(entries) if e.get("label") == target]
    if not hits:
        hits = [i for i, e in enumerate(entries) if (e.get("hash") or "").startswith(target)]
    return hits


def cmd_add(label: str) -> None:
    data = _read()
    if any(e.get("label") == label for e in data["keys"]):
        print(f"[错误] label '{label}' 已存在。先 revoke 它，或换一个 label。", file=sys.stderr)
        sys.exit(1)
    key = secrets.token_urlsafe(32)
    data["keys"].append(
        {"hash": room_of(key), "label": label, "created_at": _now_iso(), "revoked": False}
    )
    _write(data)
    print("签发成功。请把下面的密钥发给对应用户（只显示一次）：\n")
    print(f"  {key}\n")
    print("提示：也可在 App / Web 的「设置 → 同步 → 访问密钥」里直接填写。")


def cmd_list() -> None:
    data = _read()
    entries: List[dict] = data["keys"]
    if not entries:
        print("keys.json 中暂无任何 key → 当前为「开放模式」（任何人可读写全部数据）。")
        print("公网部署请执行：python keyctl.py add <label>")
    else:
        print(f"{'LABEL':<20} {'ROOM(前缀)':<16} {'CREATED_AT':<28} STATUS")
        print("-" * 80)
        for e in entries:
            status = "REVOKED" if e.get("revoked") else "ACTIVE"
            print(f"{e.get('label',''):<20} {(e.get('hash') or '')[:12]:<16} "
                  f"{str(e.get('created_at',''))[:26]:<28} {status}")
    if (os.getenv("NEXUS_API_KEY") or "").strip():
        print("\n[注意] 环境变量 NEXUS_API_KEY 仍有值 → 其中的 key 始终有效、无法单独吊销。")
        print("       建议清空该环境变量，改用 keys.json 管理。")


def _set_revoked(target: str, revoked: bool) -> None:
    data = _read()
    hits = _find(data["keys"], target)
    if not hits:
        print(f"[错误] 未找到匹配 '{target}' 的 key。", file=sys.stderr)
        sys.exit(1)
    if len(hits) > 1:
        print(f"[错误] 匹配到 {len(hits)} 个 key，请给出更精确的 label 或 room 前缀：",
              file=sys.stderr)
        for i in hits:
            print(f"  - {data['keys'][i].get('label')} ({(data['keys'][i].get('hash') or '')[:12]})",
                  file=sys.stderr)
        sys.exit(1)
    data["keys"][hits[0]]["revoked"] = revoked
    _write(data)
    label = data["keys"][hits[0]].get("label")
    print(f"已{'吊销' if revoked else '恢复'} key：{label}")
    if revoked:
        print("（已连接设备需 `systemctl restart nexus` 才会被断开）")


def cmd_remove(target: str) -> None:
    data = _read()
    hits = _find(data["keys"], target)
    if not hits:
        print(f"[错误] 未找到匹配 '{target}' 的 key。", file=sys.stderr)
        sys.exit(1)
    if len(hits) > 1:
        print(f"[错误] 匹配到 {len(hits)} 个 key，请给出更精确的 label 或 room 前缀。",
              file=sys.stderr)
        sys.exit(1)
    removed = data["keys"].pop(hits[0])
    _write(data)
    print(f"已彻底删除 key：{removed.get('label')}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Nexus Matrix 密钥签发 / 吊销")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_add = sub.add_parser("add", help="签发一个新 key")
    p_add.add_argument("label", help="用户/设备标识，如 alice、phone-1")

    sub.add_parser("list", help="列出所有 key")

    p_rev = sub.add_parser("revoke", help="吊销某个 key")
    p_rev.add_argument("target", help="label 或 room 前缀")

    p_un = sub.add_parser("unrevok", help="恢复某个 key")
    p_un.add_argument("target", help="label 或 room 前缀")

    p_rm = sub.add_parser("remove", help="彻底删除条目")
    p_rm.add_argument("target", help="label 或 room 前缀")

    args = parser.parse_args()

    if args.cmd == "add":
        cmd_add(args.label)
    elif args.cmd == "list":
        cmd_list()
    elif args.cmd == "revoke":
        _set_revoked(args.target, True)
    elif args.cmd == "unrevok":
        _set_revoked(args.target, False)
    elif args.cmd == "remove":
        cmd_remove(args.target)


if __name__ == "__main__":
    main()
