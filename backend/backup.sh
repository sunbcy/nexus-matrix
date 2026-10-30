#!/usr/bin/env bash
# Nexus Matrix SQLite 在线备份脚本（安全的「热备」：用 sqlite3 .backup，不阻塞运行中的进程）。
# 用法： ./backup.sh            # 默认备份到 ./backups/nexus-<日期>.db
#       ./backup.sh /path/out  # 指定输出目录
#
# 部署示例（每日 03:07 备份，保留近 14 天）：
#   7 3 * * *  /opt/nexus/backend/backup.sh /opt/nexus/backups >> /opt/nexus/backups/cron.log 2>&1
#   17 3 * * * find /opt/nexus/backups -name 'nexus-*.db' -mtime +14 -delete

set -euo pipefail

DB_PATH="${DB_PATH:-$(dirname "$0")/nexus.db}"
OUT_DIR="${1:-$(dirname "$0")/backups}"
mkdir -p "$OUT_DIR"

TS="$(date +%Y%m%d-%H%M%S)"
OUT="$OUT_DIR/nexus-$TS.db"

if command -v sqlite3 >/dev/null 2>&1; then
  # 在线热备：拷贝一致性快照，不影响运行中的后端
  sqlite3 "$DB_PATH" ".backup '$OUT'"
else
  # 退路：直接拷文件（运行中拷贝偶有风险，仅 sqlite3 不可用时用）
  cp "$DB_PATH" "$OUT"
fi

# 校验备份可读
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$OUT" "PRAGMA integrity_check;" >/dev/null
fi

echo "backed up -> $OUT"
