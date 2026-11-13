#!/usr/bin/env bash
# ============================================================
# Nexus Matrix - Cloudflare Tunnel 部署脚本 (macOS / Linux)
# 对应 Windows 下没有的「用 cloudflared 把本机 8010 暴露到公网」流程。
#
# 做什么：
#   1. 确保已安装 cloudflared（没有就用 brew 装）
#   2. 确保后端在 127.0.0.1:8010 运行
#   3. 启动 Cloudflare 快速隧道 -> http://localhost:8010
#   4. 解析新生成的 https://xxx.trycloudflare.com URL
#   5. 自动写回 .env 的 OAUTH_REDIRECT_BASE 与 CORS_ORIGINS
#      （Google 工作台 / OAuth 回调依赖这两个值）
#   6. 重启后端使 .env 生效，并做公网健康检查
#   7. 打印需在 Google Cloud Console 添加的「已获授权的重定向 URI」
#
# 用法：
#   ./deploy_cloudflare.sh            # 部署 + 自动写 .env
#   ./deploy_cloudflare.sh --stop    # 仅停止隧道与后端
# ============================================================

set -u

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
ENV_FILE="$ROOT_DIR/.env"
TUNNEL_LOG="$BACKEND_DIR/cloudflared.log"

health() { curl -fsS http://127.0.0.1:8010/api/health >/dev/null 2>&1; }

# ---------- --stop ----------
if [ "${1:-}" = "--stop" ]; then
  echo "停止隧道与后端 ..."
  pkill -f "cloudflared tunnel" 2>/dev/null || true
  pkill -f "main.py" 2>/dev/null || true
  echo "已停止。"
  exit 0
fi

# ---------- 1. cloudflared ----------
if ! command -v cloudflared >/dev/null 2>&1; then
  echo "==> 未检测到 cloudflared，使用 brew 安装 ..."
  if ! command -v brew >/dev/null 2>&1; then
    echo "未找到 Homebrew，请先安装：https://brew.sh 或手动安装 cloudflared" >&2
    exit 1
  fi
  HOMEBREW_NO_AUTO_UPDATE=1 brew install cloudflare/cloudflare/cloudflared
fi
echo "==> cloudflared: $(cloudflared --version 2>&1 | head -1)"

# ---------- 2. 确保后端运行 ----------
if ! health; then
  echo "==> 后端未运行，启动中 ..."
  ( cd "$BACKEND_DIR" && ./start_backend.sh >/tmp/nexus_start.log 2>&1 & )
  for _ in $(seq 1 30); do health && break; sleep 1; done
fi
if ! health; then
  echo "后端启动失败，请查看 $BACKEND_DIR/backend.log" >&2
  exit 1
fi
echo "==> 后端健康 (http://127.0.0.1:8010)"

# ---------- 3. 启动快速隧道 ----------
pkill -f "cloudflared tunnel" 2>/dev/null || true
sleep 1
# 用 127.0.0.1 而非 localhost：macOS 上 localhost 会优先解析成 IPv6 ::1，
# 而 uvicorn 只监听 IPv4 0.0.0.0，日志里会出现 dial tcp [::1]:8010 refused。
echo "==> 启动 Cloudflare 快速隧道 (127.0.0.1:8010) ..."
nohup cloudflared tunnel --url http://127.0.0.1:8010 > "$TUNNEL_LOG" 2>&1 &
CF_PID=$!

URL=""
for _ in $(seq 1 40); do
  URL=$(grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" | head -n1)
  [ -n "$URL" ] && break
  # 首次可能需要在浏览器接受 Cloudflare Tunnel 条款
  if grep -qi "accept.*terms\|cloudflare.com/.*accept" "$TUNNEL_LOG" 2>/dev/null; then
    echo "!! 首次使用可能需先在浏览器接受 Cloudflare Tunnel 条款，请查看日志：$TUNNEL_LOG" >&2
  fi
  sleep 1
done

if [ -z "$URL" ]; then
  echo "未能从日志解析 Cloudflare URL，请查看 $TUNNEL_LOG" >&2
  echo "隧道进程 PID=$CF_PID 仍在运行，可稍后手动重试。" >&2
  exit 1
fi
echo "==> Cloudflare URL: $URL"

# ---------- 4. 写回 .env ----------
upsert() {
  local key="$1" val="$2"
  if [ -f "$ENV_FILE" ] && grep -q "^[[:space:]]*${key}=" "$ENV_FILE"; then
    sed -i '' "s|^[[:space:]]*${key}=.*|${key}=${val}|" "$ENV_FILE"
  else
    printf '\n%s=%s\n' "$key" "$val" >> "$ENV_FILE"
  fi
}
upsert OAUTH_REDIRECT_BASE "$URL"
upsert CORS_ORIGINS "$URL"
echo "==> 已写入 $ENV_FILE : OAUTH_REDIRECT_BASE 与 CORS_ORIGINS"

# ---------- 5. 重启后端使 .env 生效 ----------
echo "==> 重启后端以加载新 .env ..."
pkill -f "main.py" 2>/dev/null || true
sleep 2
( cd "$BACKEND_DIR" && ./start_backend.sh >/tmp/nexus_start.log 2>&1 & )
for _ in $(seq 1 30); do health && break; sleep 1; done
if ! health; then
  echo "后端重启失败，请查看 $BACKEND_DIR/backend.log" >&2
  exit 1
fi

# ---------- 6. 公网健康检查 ----------
echo "==> 公网健康检查 ..."
if curl -fsS "$URL/api/health" >/dev/null 2>&1; then
  echo "公网可达: $URL/api/health"
else
  echo "公网暂不可达（Cloudflare 边缘可能还在生效，稍后重试: $URL/api/health）"
fi

# ---------- 7. Google Cloud Console 提示 ----------
echo ""
echo "============================================================"
echo " 请到 Google Cloud Console 添加以下「已获授权的重定向 URI」："
echo "   $URL/api/auth/oauth/google/callback"
echo ""
echo " 位置：APIs & Services -> Credentials -> OAuth 2.0 Client"
echo "       -> Authorized redirect URIs"
echo "============================================================"
echo ""
echo "后端公网地址 : $URL"
echo "隧道日志     : tail -F $TUNNEL_LOG"
echo "仅停隧道     : pkill -f 'cloudflared tunnel'"
echo "停止全部     : $0 --stop"
echo ""
echo "===== 实时隧道日志（Ctrl+C 停止查看，隧道与后端继续运行）====="
exec tail -F "$TUNNEL_LOG"
