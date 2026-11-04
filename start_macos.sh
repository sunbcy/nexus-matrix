#!/usr/bin/env bash
# ============================================================
# Nexus Matrix 一键启动脚本 (macOS / Linux)
# 对应 Windows 下的 start.ps1
# 用法：
#   ./start_macos.sh
# 说明：
#   - 读取项目根 .env（若存在）中的 BACKEND_PORT / FRONTEND_PORT
#     默认值分别为 8010 / 5180
#   - 自动创建并激活 backend venv、安装 Python 依赖
#   - 后台 detached 启动后端（日志 -> backend/backend.log）
#   - 安装前端依赖（yarn install）并启动 vite dev
#   - 按 Ctrl+C 退出时，前端停止、后端也一并停止
# ============================================================

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
ENV_FILE="$ROOT_DIR/.env"

# ---- 默认端口 ----
BACKEND_PORT="8010"
FRONTEND_PORT="5180"

# ---- 读取 .env（仅 BACKEND_PORT / FRONTEND_PORT）----
if [ -f "$ENV_FILE" ]; then
  echo "从 .env 加载配置..."
  while IFS='=' read -r key value; do
    key="$(echo "$key" | xargs)"
    value="$(echo "$value" | xargs | sed -e 's/^["'\'']//' -e 's/["'\'']$//')"
    [ -z "$key" ] && continue
    case "$key" in
      \#*) continue ;;
      BACKEND_PORT) BACKEND_PORT="$value" ;;
      FRONTEND_PORT) FRONTEND_PORT="$value" ;;
    esac
  done < "$ENV_FILE"
fi

echo "========================================"
echo "  NEXUS MATRIX - Starting..."
echo "  Backend:  http://localhost:$BACKEND_PORT"
echo "  Frontend: http://localhost:$FRONTEND_PORT"
echo "========================================"

# ---- [1/4] 检查 Python ----
echo ""
echo "[1/4] 检查 Python 环境..."
if ! command -v python3 >/dev/null 2>&1; then
  echo "  ERROR: 未找到 python3，请先安装 Python 3.10+"
  exit 1
fi
echo "  Found: $(command -v python3) ($(python3 --version 2>&1))"

# ---- [2/4] 后端 venv + 依赖 ----
echo ""
echo "[2/4] 准备后端..."
VENV_PY="$BACKEND_DIR/venv/bin/python3"
if [ ! -x "$VENV_PY" ]; then
  echo "  创建虚拟环境..."
  python3 -m venv "$BACKEND_DIR/venv"
fi
# shellcheck disable=SC1091
source "$BACKEND_DIR/venv/bin/activate"
echo "  安装 Python 依赖..."
pip install -r "$BACKEND_DIR/requirements.txt" -q

# ---- [3/4] 前端依赖 ----
echo ""
echo "[3/4] 准备前端..."
cd "$FRONTEND_DIR"
if [ ! -d "node_modules" ]; then
  echo "  安装前端依赖 (yarn install)..."
  yarn install
else
  echo "  前端依赖已存在"
fi

# ---- [4/4] 启动服务 ----
echo ""
echo "[4/4] 启动服务..."

# 停掉旧后端实例
PIDS=$(pgrep -f "main.py" || true)
if [ -n "$PIDS" ]; then
  echo "  停止旧后端实例：$PIDS"
  kill $PIDS 2>/dev/null || true
  sleep 2
fi

export NEXUS_API_KEY="${NEXUS_API_KEY:-Xz2lZyHjnAuYCzR_cPffdsaEdcIAYQcB7CHzfm428bw}"
export STATIC_DIR="${STATIC_DIR:-$ROOT_DIR/frontend/dist}"
export PYTHONUTF8=1
export LANG="${LANG:-en_US.UTF-8}"

LOG_PATH="$BACKEND_DIR/backend.log"
echo "  启动后端 (http://localhost:$BACKEND_PORT，日志 -> $LOG_PATH)..."
nohup "$VENV_PY" "$BACKEND_DIR/main.py" > "$LOG_PATH" 2>&1 &
BACKEND_PID=$!
echo "  后端 PID=$BACKEND_PID"

sleep 6
if curl -fsS "http://127.0.0.1:$BACKEND_PORT/api/health" >/dev/null 2>&1; then
  echo "  后端健康检查：通过"
else
  echo "  后端健康检查未通过（可能还在起），最近日志："
  tail -n 15 "$LOG_PATH"
fi

# 退出时停止所有服务（后端 + 前端）
cleanup() {
  echo ""
  echo "正在停止服务..."
  # 停止后端
  kill "$BACKEND_PID" 2>/dev/null || true
  pkill -f "main.py" 2>/dev/null || true
  # 停止前端 dev server（yarn dev / vite）
  pkill -f "vite" 2>/dev/null || true
  pkill -f "start_macos.sh" 2>/dev/null || true
  echo "所有服务已停止"
}
trap cleanup EXIT INT TERM

echo ""
echo "  启动前端 dev server (http://localhost:$FRONTEND_PORT)..."
echo "  按 Ctrl+C 退出（后端与前端会一并停止）"
cd "$FRONTEND_DIR"
yarn dev
