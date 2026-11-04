#!/usr/bin/env bash
# ============================================================
# Nexus Matrix 恢复演练（验证「备份真的能恢复」，而不只是文件存在）
# ------------------------------------------------------------
# 用法：
#   ./restore_drill.sh                 演练最新备份（读 backups/LATEST）
#   ./restore_drill.sh <备份包路径>    演练指定备份
#
# 演练步骤：
#   1) 解压到临时目录（绝不写回真实库）
#   2) 按 manifest.json 逐文件校验 sha256
#   3) PRAGMA integrity_check + 账号/workspace/笔记映射完整性检查
#   4) 用环境变量把 DB_PATH / 端口指到临时副本，起一个临时后端实例，
#      实测 /api/health 可用（main.py 的 _load_env_files 是 override=False，
#      因此命令行注入优先，不会连到真实 nexus.db）
#   5) 关闭临时实例并清理
#
# 可调：DRILL_PORT（默认 18010）、BACKUP_DIR
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY="$SCRIPT_DIR/venv/bin/python3"
OUT_DIR="${BACKUP_DIR:-$SCRIPT_DIR/backups}"
DRILL_PORT="${DRILL_PORT:-18010}"

ARCHIVE="${1:-}"
if [ -z "$ARCHIVE" ] && [ -f "$OUT_DIR/LATEST" ]; then
  ARCHIVE="$(cat "$OUT_DIR/LATEST")"
fi
if [ -z "$ARCHIVE" ]; then
  ARCHIVE="$(ls -1t "$OUT_DIR"/nexus-backup-*.tar* 2>/dev/null | head -1 || true)"
fi
if [ -z "$ARCHIVE" ] || [ ! -f "$ARCHIVE" ]; then
  echo "ERROR: 找不到备份包，请先运行 ./backup.sh 或指定路径" >&2
  exit 1
fi
if [ ! -x "$PY" ]; then
  echo "ERROR: 缺少 $PY" >&2
  exit 1
fi

TMP="$(mktemp -d "${TMPDIR:-/tmp}/nexusdrill.XXXXXX")"
PID=""
cleanup() {
  if [ -n "$PID" ]; then
    kill "$PID" 2>/dev/null || true
    wait "$PID" 2>/dev/null || true
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

echo "==> [1/5] 解压备份到临时目录"
echo "    包   : $ARCHIVE"
echo "    临时 : $TMP"
case "$ARCHIVE" in
  *.tar.gz) tar -xzf "$ARCHIVE" -C "$TMP" ;;
  *.tar)    tar -xf  "$ARCHIVE" -C "$TMP" ;;
  *) echo "ERROR: 无法识别的备份格式" >&2; exit 1 ;;
esac
PKG="$(find "$TMP" -maxdepth 1 -type d -name 'nexus-backup-*' | head -1)"
if [ -z "$PKG" ] || [ ! -f "$PKG/manifest.json" ]; then
  echo "ERROR: 备份包内缺少 manifest.json / nexus-backup-* 目录" >&2
  exit 1
fi

echo "==> [2/5] 校验 sha256 + integrity_check + 映射完整性"
"$PY" - "$PKG" <<'PY'
import hashlib, json, os, sqlite3, sys

pkg = sys.argv[1]
with open(os.path.join(pkg, "manifest.json"), "r", encoding="utf-8") as f:
    manifest = json.load(f)

fail = []
for name, meta in sorted(manifest.get("files", {}).items()):
    p = os.path.join(pkg, name)
    if not os.path.isfile(p):
        fail.append("缺文件: " + name)
        continue
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    if h.hexdigest() != meta["sha256"]:
        fail.append("sha256 不符: " + name)
    else:
        print("    OK  %-14s %s bytes" % (name, meta["bytes"]))

for name in ("nexus.db", "jwt_secret", ".env"):
    if not os.path.isfile(os.path.join(pkg, name)):
        fail.append("四件套缺失: " + name)

con = sqlite3.connect("file:" + os.path.join(pkg, "nexus.db") + "?mode=ro", uri=True)
chk = con.execute("PRAGMA integrity_check").fetchone()[0]
if chk != "ok":
    fail.append("integrity_check = " + chk)

def scalar(q):
    try:
        return con.execute(q).fetchone()[0]
    except Exception:
        return None

actual = {
    "users": scalar("SELECT COUNT(*) FROM users"),
    "memberships": scalar("SELECT COUNT(*) FROM memberships"),
    "pages": scalar("SELECT COUNT(*) FROM pages"),
    "assets": scalar("SELECT COUNT(*) FROM assets"),
}
expected = manifest.get("stats", {})
for k, v in actual.items():
    if expected.get(k) != v:
        fail.append("统计不符 %s: manifest=%s 实际=%s" % (k, expected.get(k), v))

orphan = scalar(
    "SELECT COUNT(*) FROM memberships m LEFT JOIN users u ON m.user_id=u.id "
    "WHERE u.id IS NULL"
) or 0
if orphan:
    fail.append("有 %s 条 membership 指向不存在的 user（账号映射断裂）" % orphan)

rooms = {r[0]: r[1] for r in con.execute("SELECT room,COUNT(*) FROM pages GROUP BY room")}
owned = {r[0] for r in con.execute("SELECT DISTINCT room FROM memberships")}
con.close()

print("    integrity_check = %s" % chk)
print("    users=%s memberships=%s pages=%s assets=%s orphan_memberships=%s"
      % (actual["users"], actual["memberships"], actual["pages"], actual["assets"], orphan))
print("    账号 <-> workspace <-> 笔记 映射：")
for room, count in sorted(rooms.items(), key=lambda x: -x[1]):
    if room in owned:
        tag = "OK 已绑定账号"
    elif room == "public":
        tag = "WARN public 房间（历史开放模式数据）"
    else:
        tag = "WARN 无 membership（legacy key 房间，迁移时需重绑定）"
    print("      %-66s %4d 页  %s" % (room[:66], count, tag))
print("    restore_map: %s" % json.dumps(manifest.get("restore_map", {}), ensure_ascii=False))

if fail:
    print("")
    for e in fail:
        print("    FAIL " + e, file=sys.stderr)
    sys.exit(1)
print("    PASS 校验通过")
PY

echo "==> [3/5] 起临时后端实例（仅连副本，端口 ${DRILL_PORT}）"
export DB_PATH="$PKG/nexus.db"
export BACKEND_PORT="$DRILL_PORT"
export BACKEND_HOST="127.0.0.1"
if [ -f "$PKG/jwt_secret" ]; then
  export JWT_SECRET="$(cat "$PKG/jwt_secret")"
fi
case "$DB_PATH" in
  "$TMP"/*) ;;
  *) echo "ERROR: 拒绝启动，演练 DB 不在临时目录内：$DB_PATH" >&2; exit 1 ;;
esac

( cd "$SCRIPT_DIR" && exec "$PY" main.py ) > "$TMP/instance.log" 2>&1 &
PID=$!

echo "==> [4/5] 等待 /api/health"
OK=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 3 "http://127.0.0.1:$DRILL_PORT/api/health" > "$TMP/health.json" 2>/dev/null; then
    OK=1
    break
  fi
  sleep 1
done
if [ "$OK" != 1 ]; then
  echo "ERROR: 临时实例未通过健康检查" >&2
  echo "---- instance.log ----" >&2
  tail -n 30 "$TMP/instance.log" >&2
  exit 1
fi
if ! grep -q '"status":"ok"' "$TMP/health.json"; then
  echo "ERROR: /api/health 未返回 status:ok" >&2
  cat "$TMP/health.json" >&2
  exit 1
fi
echo "    PASS 临时实例可启动，health: $(head -c 120 "$TMP/health.json")"

echo "==> [5/5] 关闭临时实例并清理"
kill "$PID" 2>/dev/null || true
wait "$PID" 2>/dev/null || true
PID=""

echo ""
echo "==================== 恢复演练通过 ===================="
echo " 备份包   : $ARCHIVE"
echo " 验证内容 : sha256 / integrity_check / 统计 / 账号映射 / 临时实例启动"
echo " 真实库   : 未被修改（全程只操作临时副本），当前仍为 $SCRIPT_DIR/nexus.db"
echo ""
echo " 【真实恢复 SOP】"
echo "  1) 停后端：pkill -f 'main.py'"
echo "  2) 解压备份，按 manifest.restore_map 放回四件套"
echo "  3) 删除残留 nexus.db-wal / nexus.db-shm（避免旧 WAL 覆盖恢复后的库）"
echo "  4) 起后端：cd backend && ./start_backend.sh"
echo "  5) 用 Google 账号登录，确认 workspace 列表与笔记数量"
echo "======================================================"
