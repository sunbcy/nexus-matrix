#!/usr/bin/env bash
# ============================================================
# Nexus Matrix 定时备份守护（每 12h，保留 15 天）
# ------------------------------------------------------------
# 为什么不用 launchd：
#   项目在 /Volumes/4TSATADisk（可移除卷）。macOS TCC 会拒绝 launchd
#   派生的后台进程读写该卷（Operation not permitted），实测连 .env / db
#   都读不了。由「已获授权的终端会话」启动的进程则继承权限，可正常备份。
#   因此用常驻守护 + 登录自启，而不是 LaunchAgent。
#
# 用法：
#   ./backup_scheduler.sh --start     启动（后台常驻，立即先备份一次）
#   ./backup_scheduler.sh --stop      停止
#   ./backup_scheduler.sh --status    查看状态（running 返回 0）
#   ./backup_scheduler.sh --run       内部循环入口，勿手动调用
#
# 可调：BACKUP_INTERVAL_SECONDS（默认 43200 = 12h）、BACKUP_DIR
# ============================================================

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="${BACKUP_DIR:-$SCRIPT_DIR/backups}"
INTERVAL="${BACKUP_INTERVAL_SECONDS:-43200}"
PIDFILE="$OUT_DIR/scheduler.pid"
LOGFILE="$OUT_DIR/scheduler.log"

mkdir -p "$OUT_DIR"

is_running() {
  [ -f "$PIDFILE" ] || return 1
  local pid
  pid="$(cat "$PIDFILE" 2>/dev/null)"
  [ -n "$pid" ] || return 1
  kill -0 "$pid" 2>/dev/null
}

do_status() {
  if is_running; then
    echo "running PID=$(cat "$PIDFILE")  interval=${INTERVAL}s  log=${LOGFILE}"
    return 0
  fi
  echo "not running"
  return 1
}

do_start() {
  if is_running; then
    echo "已在运行：PID=$(cat "$PIDFILE")"
    return 0
  fi
  rm -f "$PIDFILE"
  nohup /bin/bash "$0" --run >> "$LOGFILE" 2>&1 < /dev/null &
  local pid=$!
  echo "$pid" > "$PIDFILE"
  echo "已启动定时备份：PID=${pid}，每 ${INTERVAL}s 一次，保留由 backup.sh 控制"
  echo "日志：${LOGFILE}"
}

do_stop() {
  if is_running; then
    local pid
    pid="$(cat "$PIDFILE")"
    kill "$pid" 2>/dev/null || true
    sleep 1
    kill -9 "$pid" 2>/dev/null || true
    echo "已停止 PID=${pid}"
  else
    echo "未在运行"
  fi
  rm -f "$PIDFILE"
}

do_run() {
  echo "===== scheduler start $(date) interval=${INTERVAL}s ====="
  while true; do
    echo "----- backup $(date) -----"
    /bin/bash "$SCRIPT_DIR/backup.sh" --now "$OUT_DIR"
    echo "----- done $(date), next in ${INTERVAL}s -----"
    sleep "$INTERVAL"
  done
}

case "${1:---status}" in
  --start)  do_start ;;
  --stop)   do_stop ;;
  --status) do_status ;;
  --run)    do_run ;;
  *) echo "用法：$0 {--start|--stop|--status}" >&2; exit 1 ;;
esac
