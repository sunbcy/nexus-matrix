#!/usr/bin/env bash
# ============================================================
# Nexus Matrix - 用 Cloudflare Tunnel Token 跑隧道 (macOS / Linux)
# 对应 deploy_cloudflare.sh 的「命名隧道 / 固定域名」版本，但用
# Token 模式，绕开 `cloudflared tunnel login` 的浏览器回调解密
# （本机访问 login.cloudflareaccess.org 超时的情况）。
#
# 前置（在 Cloudflare 控制台完成）：
#   1. 域名已加入 Cloudflare、NS 已指向 Cloudflare、且已解除 serverHold
#      （阿里云完成实名认证 / 邮箱验证）
#   2. Cloudflare Zero Trust -> Networks -> Tunnels -> Create a tunnel
#      -> 选 Cloudflared，命名 nexus，Public Hostname 设
#         nexus.<你的域名> -> http://127.0.0.1:8010
#         （务必写 127.0.0.1：localhost 在 macOS 上优先解析 ::1，
#           而后端只监听 IPv4，会报 dial tcp [::1]:8010 refused）
#      -> 复制给出的运行命令里的 --token 值
#
# Token 来源（任选其一）：
#   a) 写入文件:  ~/.cloudflared/tunnel_token.txt
#   b) 环境变量:  CLOUDFLARE_TUNNEL_TOKEN=xxxx ./run_tunnel.sh
#
# 可选环境变量：
#   TUNNEL_HOSTNAME=nexus.sunbcy.homes   # 控制台里配的子域名，默认此值
#
# 用法：
#   ./run_tunnel.sh            # 部署（写 .env + 起隧道）
#   ./run_tunnel.sh --stop     # 仅停止隧道与后端
# ============================================================

set -u

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
ENV_FILE="$ROOT_DIR/.env"
TOKEN_FILE="$HOME/.cloudflared/tunnel_token.txt"
TUNNEL_LOG="$BACKEND_DIR/cloudflared.log"

TUNNEL_HOSTNAME="${TUNNEL_HOSTNAME:-nexus.sunbcy.homes}"
PUBLIC_URL="https://${TUNNEL_HOSTNAME}"

health() { curl -fsS http://127.0.0.1:8010/api/health >/dev/null 2>&1; }

# ---------- --stop ----------
if [ "${1:-}" = "--stop" ]; then
  echo "停止隧道与后端 ..."
  pkill -f "cloudflared tunnel" 2>/dev/null || true
  pkill -f "main.py" 2>/dev/null || true
  echo "已停止。"
  exit 0
fi

# ---------- token ----------
TOKEN="${CLOUDFLARE_TUNNEL_TOKEN:-}"
if [ -z "$TOKEN" ] && [ -f "$TOKEN_FILE" ]; then
  TOKEN="$(cat "$TOKEN_FILE")"
fi
if [ -z "$TOKEN" ]; then
  echo "错误: 未找到 Cloudflare Tunnel Token。" >&2
  echo "请执行以下之一:" >&2
  echo "  1) 把 token 写入 $TOKEN_FILE" >&2
  echo "  2) 用环境变量运行: CLOUDFLARE_TUNNEL_TOKEN=xxxx ./run_tunnel.sh" >&2
  exit 1
fi

# ---------- cloudflared ----------
if ! command -v cloudflared >/dev/null 2>&1; then
  echo "错误: 未安装 cloudflared（brew install cloudflare/cloudflare/cloudflared）" >&2
  exit 1
fi
echo "==> cloudflared: $(cloudflared --version 2>&1 | head -1)"

# ---------- 确保后端运行 ----------
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

# ---------- 写回 .env（固定域名场景：仅当缺失或值不同才改，避免每次重启隧道都改 .env / 弹后端）----------
needs_restart=0
upsert() {
  local key="$1" val="$2"
  local current=""
  if [ -f "$ENV_FILE" ]; then
    current="$(grep -E "^[[:space:]]*${key}=" "$ENV_FILE" 2>/dev/null | head -n1 | sed "s/^[^=]*=//")"
  fi
  if [ "$current" = "$val" ]; then
    return 0   # 值与当前一致，无需改动
  fi
  if [ -f "$ENV_FILE" ] && grep -q "^[[:space:]]*${key}=" "$ENV_FILE"; then
    sed -i '' "s|^[[:space:]]*${key}=.*|${key}=${val}|" "$ENV_FILE"
  else
    printf '\n%s=%s\n' "$key" "$val" >> "$ENV_FILE"
  fi
  needs_restart=1
}
upsert OAUTH_REDIRECT_BASE "$PUBLIC_URL"
upsert CORS_ORIGINS "$PUBLIC_URL"

if [ "$needs_restart" = 1 ]; then
  echo "==> .env 已更新为 $PUBLIC_URL，重启后端以生效 ..."
  pkill -f "main.py" 2>/dev/null || true
  sleep 2
  ( cd "$BACKEND_DIR" && ./start_backend.sh >/tmp/nexus_start.log 2>&1 & )
  for _ in $(seq 1 30); do health && break; sleep 1; done
  if ! health; then
    echo "后端重启失败，请查看 $BACKEND_DIR/backend.log" >&2
    exit 1
  fi
else
  echo "==> .env 已是 $PUBLIC_URL（固定域名：重启隧道地址不变，无需改动 / 无需重启后端）"
  # 仅确保后端在运行
  if ! health; then
    ( cd "$BACKEND_DIR" && ./start_backend.sh >/tmp/nexus_start.log 2>&1 & )
    for _ in $(seq 1 30); do health && break; sleep 1; done
  fi
fi

# ---------- 启动隧道 (token 模式, 无需 cert.pem) ----------
pkill -f "cloudflared tunnel" 2>/dev/null || true
sleep 1
echo "==> 启动 Cloudflare 隧道 (token 模式) -> $PUBLIC_URL ..."
nohup cloudflared tunnel run --protocol http2 --token "$TOKEN" > "$TUNNEL_LOG" 2>&1 &
echo "隧道 PID=$!"

echo "==> 等待隧道连接 ..."
for _ in $(seq 1 40); do
  if grep -qiE "serving|connection registered|connected to .*Cloudflare|Registered tunnel" "$TUNNEL_LOG" 2>/dev/null; then
    echo "隧道已连接"; break
  fi
  sleep 1
done

# ---------- 公网健康检查 ----------
echo "==> 公网健康检查 ($PUBLIC_URL/api/health) ..."
OK=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 10 "$PUBLIC_URL/api/health" >/dev/null 2>&1; then OK=1; break; fi
  sleep 2
done
if [ "$OK" = 1 ]; then
  echo "公网可达: $PUBLIC_URL/api/health"
else
  echo "公网暂不可达。常见原因："
  echo "  - 阿里云实名认证/邮箱验证未完成，域名仍处于 serverHold（dig NS $TUNNEL_HOSTNAME 应返回 Cloudflare NS）"
  echo "  - DNS 尚未全球生效（等几分钟再试）"
  echo "  - Cloudflare 还在激活该 zone"
fi

# ---------- Google Cloud Console 提示 ----------
echo ""
echo "============================================================"
echo " 请到 Google Cloud Console 添加以下「已获授权的重定向 URI」："
echo "   $PUBLIC_URL/api/auth/oauth/google/callback"
echo ""
echo " 位置：APIs & Services -> Credentials -> OAuth 2.0 Client"
echo "       -> Authorized redirect URIs"
echo "============================================================"
echo ""
echo "公网地址     : $PUBLIC_URL"
echo "隧道日志     : tail -F $TUNNEL_LOG"
echo "仅停隧道     : pkill -f 'cloudflared tunnel'"
echo "停止全部     : $0 --stop"
echo ""
echo "===== 实时隧道日志（Ctrl+C 停止查看，隧道与后端继续运行）====="
exec tail -F "$TUNNEL_LOG"
