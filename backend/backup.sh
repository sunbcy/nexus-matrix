#!/usr/bin/env bash
# ============================================================
# Nexus Matrix 本机备份（L0 一致性快照 + L1 归档 / 保留）
# ------------------------------------------------------------
# 用法：
#   ./backup.sh                     立即备份一次（等价 --now）
#   ./backup.sh --now [输出目录]    立即备份一次
#   ./backup.sh --list [输出目录]   列出已有备份
#   ./backup.sh --install           安装定时（登录自启常驻守护，默认每 12h / 保留 15 天）
#   ./backup.sh --uninstall         卸载定时
#   ./backup.sh --help
#
# 【为什么不能裸 cp】
#   后端用 PRAGMA journal_mode=WAL，最新数据可能还在 nexus.db-wal 里。
#   直接 cp nexus.db 会拿到过期且不完整的库。本脚本用 sqlite3 .backup
#   （或 python sqlite3.Connection.backup）生成一致性快照，拒绝裸 cp 兜底。
#
# 【四件套】恢复后「账号 <-> workspace <-> 笔记」映射要成立，缺一不可：
#   nexus.db      users / memberships / pages / assets / invite_links
#   jwt_secret    JWT 签名 + SessionMiddleware 密钥（丢了所有登录态失效）
#   .env          OAUTH_GOOGLE_* / NEXUS_API_KEY / OAUTH_REDIRECT_BASE
#   keys.json     租户密钥哈希（若启用；不存在则跳过并记入 manifest）
#   四者同一次原子快照打包，包内含密钥，权限 600。
#
# 【可调环境变量】
#   DB_PATH                  数据库路径（默认 backend/nexus.db）
#   BACKUP_DIR               输出目录（默认 backend/backups）
#   BACKUP_RETENTION_DAYS    保留天数（默认 15）
#   BACKUP_INTERVAL_SECONDS  定时间隔秒数（默认 43200 = 12h）
#   BACKUP_NO_COMPRESS=1     不压缩（大数据量时更快；assets 多为已压缩图片）
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PY="$SCRIPT_DIR/venv/bin/python3"
DB_PATH="${DB_PATH:-$SCRIPT_DIR/nexus.db}"
LABEL="com.nexus.backup"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-15}"
INTERVAL_SECONDS="${BACKUP_INTERVAL_SECONDS:-43200}"
NO_COMPRESS="${BACKUP_NO_COMPRESS:-0}"

CMD="--now"
if [[ "${1:-}" == --* ]]; then CMD="$1"; shift; fi
OUT_DIR="${1:-${BACKUP_DIR:-$SCRIPT_DIR/backups}}"

usage() { sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'; }

# ---------------- 备份一次 ----------------
do_backup() {
  if [ ! -f "$DB_PATH" ]; then
    echo "ERROR: 数据库不存在：$DB_PATH" >&2
    exit 1
  fi
  if [ ! -x "$PY" ]; then
    echo "ERROR: 缺少 ${PY}（请先运行 backend/start_backend.sh 创建 venv）" >&2
    exit 1
  fi

  mkdir -p "$OUT_DIR"
  TS="$(date +%Y%m%d-%H%M%S)"
  NAME="nexus-backup-$TS"
  STAGE="$(mktemp -d "${TMPDIR:-/tmp}/nexusbk.XXXXXX")"
  trap 'rm -rf "$STAGE"' EXIT
  PKG="$STAGE/$NAME"
  mkdir -p "$PKG"

  echo "==> 生成 WAL 安全的一致性快照：$DB_PATH"
  METHOD=""
  if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 "$DB_PATH" ".backup '$PKG/nexus.db'"
    METHOD="sqlite3 .backup"
  else
    DB_SRC="$DB_PATH" DB_DST="$PKG/nexus.db" "$PY" - <<'PY'
import os, sqlite3
src = sqlite3.connect(os.environ["DB_SRC"])
dst = sqlite3.connect(os.environ["DB_DST"])
src.backup(dst)
dst.close()
src.close()
PY
    METHOD="python Connection.backup"
  fi

  echo "==> 复制四件套（身份/配置）"
  for spec in "jwt_secret|$SCRIPT_DIR/jwt_secret" ".env|$ROOT_DIR/.env" "keys.json|$SCRIPT_DIR/keys.json"; do
    n="${spec%%|*}"; p="${spec#*|}"
    if [ -f "$p" ]; then
      cp -p "$p" "$PKG/$n"
      echo "    + $n"
    else
      echo "    - $n (不存在，跳过)"
    fi
  done

  echo "==> 校验快照并生成 manifest.json"
  "$PY" - "$PKG" "$METHOD" "$DB_PATH" "$ROOT_DIR" "$SCRIPT_DIR" <<'PY'
import datetime, hashlib, json, os, platform, sqlite3, sys

pkg, method, src_db, root, script_dir = sys.argv[1:6]
dbp = os.path.join(pkg, "nexus.db")

# 固化：源库是 WAL 模式，.backup 的副本会继承 WAL 标志并产生 -wal/-shm。
# 强制 checkpoint 后切回 DELETE 并删除辅助文件，保证 nexus.db 是完整自包含单文件。
fix = sqlite3.connect(dbp)
try:
    fix.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    fix.execute("PRAGMA journal_mode=DELETE")
except Exception as e:
    print("WARN: 固化快照失败:", e, file=sys.stderr)
fix.close()
for suffix in ("-wal", "-shm"):
    try:
        os.remove(dbp + suffix)
    except OSError:
        pass

COUNT_QUERIES = {
    "users": "SELECT COUNT(*) FROM users",
    "memberships": "SELECT COUNT(*) FROM memberships",
    "pages": "SELECT COUNT(*) FROM pages",
    "assets": "SELECT COUNT(*) FROM assets",
}

def counts(conn):
    out = {}
    for k, q in COUNT_QUERIES.items():
        try:
            out[k] = conn.execute(q).fetchone()[0]
        except Exception:
            out[k] = None
    return out

# 源库对比：证明快照确实捕获了 WAL 中尚未 checkpoint 的最新数据
src = sqlite3.connect("file:" + src_db + "?mode=ro", uri=True)
source_stats = counts(src)
src.close()

con = sqlite3.connect("file:" + dbp + "?mode=ro", uri=True)
chk = con.execute("PRAGMA integrity_check").fetchone()[0]
if chk != "ok":
    print("ERROR: integrity_check =", chk, file=sys.stderr)
    sys.exit(1)
snap_counts = counts(con)
for k, v in source_stats.items():
    if v is not None and snap_counts.get(k) != v:
        print("ERROR: 快照与源库 %s 不一致：源=%s 快照=%s（WAL 数据可能丢失）"
              % (k, v, snap_counts.get(k)), file=sys.stderr)
        sys.exit(1)
print("    源库/快照一致性: %s" % source_stats)

def scalar(q):
    try:
        return con.execute(q).fetchone()[0]
    except Exception:
        return None

def rooms():
    try:
        return {r[0]: r[1] for r in con.execute("SELECT room,COUNT(*) FROM pages GROUP BY room")}
    except Exception:
        return {}

stats = {
    "users": scalar("SELECT COUNT(*) FROM users"),
    "memberships": scalar("SELECT COUNT(*) FROM memberships"),
    "pages": scalar("SELECT COUNT(*) FROM pages"),
    "assets": scalar("SELECT COUNT(*) FROM assets"),
    "pages_by_room": rooms(),
    "orphan_memberships": scalar(
        "SELECT COUNT(*) FROM memberships m LEFT JOIN users u ON m.user_id=u.id "
        "WHERE u.id IS NULL"
    ),
}
con.close()

files = {}
for name in sorted(os.listdir(pkg)):
    p = os.path.join(pkg, name)
    if not os.path.isfile(p):
        continue
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    files[name] = {"sha256": h.hexdigest(), "bytes": os.path.getsize(p)}

manifest = {
    "schema": 1,
    "created_at": datetime.datetime.now().astimezone().isoformat(),
    "host": platform.node(),
    "db_source": src_db,
    "db_snapshot_method": method,
    "integrity_check": chk,
    "source_stats": source_stats,
    "files": files,
    "stats": stats,
    "restore_map": {
        "nexus.db": os.path.join(script_dir, "nexus.db"),
        "jwt_secret": os.path.join(script_dir, "jwt_secret"),
        ".env": os.path.join(root, ".env"),
        "keys.json": os.path.join(script_dir, "keys.json"),
    },
}
with open(os.path.join(pkg, "manifest.json"), "w", encoding="utf-8") as f:
    json.dump(manifest, f, ensure_ascii=False, indent=2)

print("    integrity_check=ok users=%s memberships=%s pages=%s assets=%s orphan_memberships=%s"
      % (stats["users"], stats["memberships"], stats["pages"],
         stats["assets"], stats["orphan_memberships"]))
PY

  echo "==> 打包"
  if [ "$NO_COMPRESS" = "1" ]; then
    ARCHIVE="$OUT_DIR/$NAME.tar"
    COPYFILE_DISABLE=1 tar -cf "$ARCHIVE" -C "$STAGE" "$NAME"
  else
    ARCHIVE="$OUT_DIR/$NAME.tar.gz"
    COPYFILE_DISABLE=1 tar -czf "$ARCHIVE" -C "$STAGE" "$NAME"
  fi
  chmod 600 "$ARCHIVE"
  printf '%s\n' "$ARCHIVE" > "$OUT_DIR/LATEST"

  echo "==> 清理超过 ${RETENTION_DAYS} 天的旧备份"
  DELETED=0
  while IFS= read -r old; do
    [ -n "$old" ] || continue
    rm -f "$old"
    DELETED=$((DELETED + 1))
  done < <(find "$OUT_DIR" -maxdepth 1 -type f \
             \( -name 'nexus-backup-*.tar' -o -name 'nexus-backup-*.tar.gz' \) \
             -mtime +"$RETENTION_DAYS" -print 2>/dev/null || true)

  echo ""
  echo "备份完成 : $ARCHIVE"
  echo "大小     : $(du -h "$ARCHIVE" | cut -f1)"
  echo "快照方式 : $METHOD"
  echo "清理旧包 : $DELETED 个"
  echo "清单     : $OUT_DIR/LATEST（恢复演练默认读它）"
}

# ---------------- 列出备份 ----------------
do_list() {
  if [ ! -d "$OUT_DIR" ]; then echo "(备份目录不存在：$OUT_DIR)"; return 0; fi
  echo "备份目录：$OUT_DIR  （保留 ${RETENTION_DAYS} 天 / 每 ${INTERVAL_SECONDS}s）"
  ls -lht "$OUT_DIR"/nexus-backup-*.tar* 2>/dev/null || echo "(暂无备份)"
}

# ---------------- 安装定时（登录自启常驻调度器） ----------------
# 注意：不用 launchd。项目在可移除卷 /Volumes/4TSATADisk 上，macOS TCC
# 会拒绝 launchd 派生进程读写该卷（实测 .env / nexus.db 均 Operation not
# permitted）。由终端会话启动的调度器继承已授权的权限，可正常备份。
ZPROFILE="$HOME/.zprofile"
MARK_BEGIN="# >>> nexus-backup-scheduler >>>"
MARK_END="# <<< nexus-backup-scheduler <<<"

do_install() {
  # 清理可能存在的旧 LaunchAgent（否则会持续以退出码 78 失败）
  launchctl unload -w "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"

  touch "$ZPROFILE"
  if ! grep -qF "$MARK_BEGIN" "$ZPROFILE"; then
    cat >> "$ZPROFILE" <<EOF

$MARK_BEGIN
# Nexus Matrix 定时备份守护：登录自启（每 $((INTERVAL_SECONDS / 3600)) 小时，保留 ${RETENTION_DAYS} 天）
if ! "$SCRIPT_DIR/backup_scheduler.sh" --status >/dev/null 2>&1; then
  "$SCRIPT_DIR/backup_scheduler.sh" --start >/dev/null 2>&1
fi
$MARK_END
EOF
    echo "已写入登录自启：$ZPROFILE"
  else
    echo "登录自启已存在，跳过写入"
  fi

  /bin/bash "$SCRIPT_DIR/backup_scheduler.sh" --start
  echo ""
  echo "  间隔    : 每 ${INTERVAL_SECONDS}s（$((INTERVAL_SECONDS / 3600)) 小时）"
  echo "  保留    : ${RETENTION_DAYS} 天"
  echo "  输出    : $OUT_DIR"
  echo "  日志    : $OUT_DIR/scheduler.log"
  echo "  状态    : $SCRIPT_DIR/backup_scheduler.sh --status"
}

do_uninstall() {
  launchctl unload -w "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  if [ -f "$ZPROFILE" ] && grep -qF "$MARK_BEGIN" "$ZPROFILE"; then
    sed -i '' "/$MARK_BEGIN/,/$MARK_END/d" "$ZPROFILE"
    echo "已移除登录自启片段"
  fi
  /bin/bash "$SCRIPT_DIR/backup_scheduler.sh" --stop 2>/dev/null || true
  echo "已卸载定时备份（备份文件保留）"
}

case "$CMD" in
  --now)       do_backup ;;
  --list)      do_list ;;
  --install)   do_install ;;
  --uninstall) do_uninstall ;;
  --help|-h)   usage ;;
  *) echo "未知命令：$CMD" >&2; usage >&2; exit 1 ;;
esac
