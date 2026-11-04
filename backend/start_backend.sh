#!/usr/bin/env bash
# ============================================================
# Nexus Matrix backend startup script (macOS / Linux)
# Equivalent to start_backend.ps1 on Windows
# Usage:
#   cd backend && ./start_backend.sh
# Notes:
#   - Kills any running main.py to avoid port 8010 conflict
#   - Starts detached in background; survives terminal close
#   - Logs to backend.log
#   - Follows logs live; Ctrl+C stops viewing, backend keeps running
#   - Re-view logs: tail -f backend.log
#   - Stop backend: pkill -f "main.py"
# ============================================================

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

VENV_PY="$SCRIPT_DIR/venv/bin/python3"
LOG_PATH="$SCRIPT_DIR/backend.log"

export NEXUS_API_KEY="${NEXUS_API_KEY:-Xz2lZyHjnAuYCzR_cPffdsaEdcIAYQcB7CHzfm428bw}"
export STATIC_DIR="${STATIC_DIR:-$SCRIPT_DIR/../frontend/dist}"
export PYTHONUTF8=1
export LANG="${LANG:-en_US.UTF-8}"

PIDS=$(pgrep -f "main.py" || true)
if [ -n "$PIDS" ]; then
  echo "Stopping old instance(s): $PIDS"
  kill $PIDS 2>/dev/null || true
  sleep 2
fi

if [ ! -x "$VENV_PY" ]; then
  echo "venv not found, creating..."
  python3 -m venv "$SCRIPT_DIR/venv"
  "$SCRIPT_DIR/venv/bin/pip" install -r "$SCRIPT_DIR/requirements.txt" -q
fi

echo "Starting backend (log -> $LOG_PATH)..."
nohup "$VENV_PY" main.py > "$LOG_PATH" 2>&1 &
BACKEND_PID=$!
echo "Backend PID=$BACKEND_PID"

sleep 8
if curl -fsS "http://127.0.0.1:8010/api/health" >/dev/null 2>&1; then
  echo "Health check: OK"
else
  echo "Health check not passed (may still be starting), recent log:"
  tail -n 20 "$LOG_PATH"
fi

echo ""
echo "===== Live log (Ctrl+C stops viewing, backend keeps running) ====="
exec tail -F "$LOG_PATH"
