#!/usr/bin/env bash
# ============================================================
# Nexus Matrix 后端 —— 部署 / 升级 / 回滚 脚本（Linux / systemd / Caddy）
# ------------------------------------------------------------
# 用法（需要 root）：
#   sudo backend/deploy.sh                  # 自动：已装 → upgrade；未装 → fresh
#   sudo backend/deploy.sh fresh            # 强制全新部署
#   sudo backend/deploy.sh upgrade          # 强制升级（保留数据与配置）
#   sudo backend/deploy.sh rollback         # 回滚到最近的升级前备份
#   sudo backend/deploy.sh rollback <文件>  # 回滚到指定备份文件
#   sudo backend/deploy.sh list-backups     # 列出可回滚的备份
#
# 【升级路径的核心保证】
#   升级时**绝不删除**以下文件，它们承载「数据」与「身份」：
#     - nexus.db        （SQLite 全量数据）
#     - keys.json       （租户密钥哈希，丢了所有用户都连不上）
#     - .env             （运行配置）
#     - backups/         （历史备份）
#   做法：rsync 不加 --delete，并对上述路径显式 exclude
#        （exclude 同时具备「保护不被 --delete 删除」的作用）。
#   另外每次升级前都会自动热备一份数据库。
# ============================================================
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/nexus}"
DOMAIN="${DOMAIN:-nexus.example.com}"
BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-8010}"
DATABASE_URL="${DATABASE_URL:-}"
API_KEY="${NEXUS_API_KEY:-}"
SKIP_FRONTEND_BUILD="${SKIP_FRONTEND_BUILD:-0}"
SKIP_CRON="${SKIP_CRON:-0}"
FORCE_ENV="${FORCE_ENV:-0}"

MODE="${1:-auto}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BACKUP_DIR="${DEPLOY_DIR}/backups"
DB_FILE="${DEPLOY_DIR}/backend/nexus.db"
KEYS_FILE_DST="${DEPLOY_DIR}/backend/keys.json"

log()  { echo "[deploy] $*"; }
warn() { echo "[deploy][警告] $*" >&2; }
die()  { echo "[deploy][错误] $*" >&2; exit 1; }

[[ "${EUID}" -eq 0 ]] || die "请用 root 执行：sudo $0"

# ---------- 模式判定 ----------
if [[ "${MODE}" == "auto" ]]; then
  if [[ -d "${DEPLOY_DIR}/backend" ]]; then MODE="upgrade"; else MODE="fresh"; fi
fi
case "${MODE}" in
  fresh|upgrade|rollback|list-backups) log "模式：${MODE}" ;;
  *) die "未知模式：${MODE}（可用：fresh | upgrade | rollback | list-backups，留空自动）" ;;
esac

# ---------- 1. 系统用户 ----------
if ! id -u nexus >/dev/null 2>&1; then
  log "创建系统用户 nexus"
  useradd -r -s /bin/false nexus
else
  log "系统用户 nexus 已存在，跳过"
fi

install -d -o nexus -g nexus -m 0755 "${DEPLOY_DIR}"
mkdir -p "${BACKUP_DIR}"

# ---------- 2. 回滚 ----------
list_backups() {
  ls -1t "${BACKUP_DIR}"/nexus-preupgrade-*.db 2>/dev/null || true
}

if [[ "${MODE}" == "list-backups" ]]; then
  cands="$(list_backups)"
  [[ -n "${cands}" ]] || { warn "backups 目录下暂无 nexus-preupgrade-*.db"; exit 0; }
  log "可回滚的备份（最近优先）："
  echo "${cands}"
  exit 0
fi

if [[ "${MODE}" == "rollback" ]]; then
  target="${2:-}"
  if [[ -z "${target}" ]]; then
    target="$(list_backups | head -n1 || true)"
    [[ -n "${target}" ]] || die "没有找到 nexus-preupgrade-*.db 备份，无法回滚"
    log "未指定备份文件，使用最近的一个：${target}"
  fi
  [[ -f "${target}" ]] || die "备份文件不存在：${target}"

  # 安全校验：确认是有效的 SQLite 文件，避免误用垃圾文件覆盖数据库
  if command -v sqlite3 >/dev/null 2>&1; then
    chk="$(sqlite3 "${target}" "PRAGMA integrity_check;" 2>/dev/null || echo fail)"
    [[ "${chk}" == "ok" ]] || die "备份文件未通过完整性检查：${target}"
  fi

  db_file="${DEPLOY_DIR}/backend/nexus.db"
  log "停止服务..."
  systemctl stop nexus || true

  # 回滚前先给「当前状态」留一份，保证回滚本身可撤销
  if [[ -f "${db_file}" ]]; then
    cp "${db_file}" "${BACKUP_DIR}/nexus-pre-rollback-$(date +%Y%m%d-%H%M%S).db"
    log "已备份当前数据库 -> backups/"
  fi

  log "回滚：${db_file} <- ${target}"
  cp "${target}" "${db_file}"
  chown nexus:nexus "${db_file}"

  systemctl start nexus
  sleep 2
  log "回滚完成。健康检查："
  curl -fsS "http://127.0.0.1:${BACKEND_PORT}/api/health" || warn "健康检查未通过，请查看 journalctl -u nexus"
  exit 0
fi

# ---------- 3. 同步代码（保留数据/配置） ----------
log "同步代码（保留 venv / .env / keys.json / nexus.db / backups）"
if command -v rsync >/dev/null 2>&1; then
  if [[ "${MODE}" == "fresh" ]]; then
    rsync -a --delete \
      --exclude 'venv/' --exclude '__pycache__/' --exclude '*.pyc' \
      --exclude 'node_modules/' --exclude 'dist/' \
      --exclude 'backups/' --exclude '.env' --exclude 'keys.json' --exclude 'nexus.db' \
      --exclude '*.log' \
      "${REPO_ROOT}/backend/" "${DEPLOY_DIR}/backend/"
  else
    rsync -a \
      --exclude 'venv/' --exclude '__pycache__/' --exclude '*.pyc' \
      --exclude 'node_modules/' --exclude 'dist/' \
      --exclude 'backups/' --exclude '.env' --exclude 'keys.json' --exclude 'nexus.db' \
      --exclude '*.log' \
      "${REPO_ROOT}/backend/" "${DEPLOY_DIR}/backend/"
  fi
  if [[ -d "${REPO_ROOT}/frontend" ]]; then
    mkdir -p "${DEPLOY_DIR}/frontend"
    if [[ "${MODE}" == "fresh" ]]; then
      rsync -a --delete --exclude 'node_modules/' --exclude 'dist/' \
        "${REPO_ROOT}/frontend/" "${DEPLOY_DIR}/frontend/"
    else
      rsync -a --exclude 'node_modules/' --exclude 'dist/' \
      "${REPO_ROOT}/frontend/" "${DEPLOY_DIR}/frontend/"
    fi
  fi
else
  # 无 rsync 时的退路：先清空再拷贝
  rm -rf "${DEPLOY_DIR}/backend"
  mkdir -p "${DEPLOY_DIR}/backend"
  (cd "${REPO_ROOT}/backend" && tar \
     --exclude='./venv' --exclude='./__pycache__' \
     --exclude='./backups' --exclude='./.env' --exclude='./keys.json' --exclude='./nexus.db' \
     -cf - .) | (cd "${DEPLOY_DIR}/backend" && tar -xf -)
  if [[ -d "${REPO_ROOT}/frontend" ]]; then
    rm -rf "${DEPLOY_DIR}/frontend"
    mkdir -p "${DEPLOY_DIR}/frontend"
    (cd "${REPO_ROOT}/frontend" && tar --exclude='./node_modules' --exclude='./dist' -cf - .) | \
      (cd "${DEPLOY_DIR}/frontend" && tar -xf -)
  fi
fi

if [[ -f "${REPO_ROOT}/Caddyfile" ]]; then
  cp "${REPO_ROOT}/Caddyfile" "${DEPLOY_DIR}/Caddyfile"
fi

# ---------- 4. 虚拟环境 ----------
if [[ ! -x "${DEPLOY_DIR}/backend/venv/bin/pip" ]]; then
  log "创建虚拟环境"
  python3 -m venv "${DEPLOY_DIR}/backend/venv"
else
  log "虚拟环境已存在，跳过创建"
fi

log "安装 / 更新依赖"
"${DEPLOY_DIR}/backend/venv/bin/pip" install --upgrade pip
"${DEPLOY_DIR}/backend/venv/bin/pip" install -r "${DEPLOY_DIR}/backend/requirements.txt"

# ---------- 5. .env ----------
ENV_FILE="${DEPLOY_DIR}/backend/.env"
if [[ -f "${ENV_FILE}" && "${FORCE_ENV}" != "1" ]]; then
  log ".env 已存在，保留（如需覆盖：FORCE_ENV=1）"
else
  if [[ -z "${API_KEY}" ]]; then
    echo "多租户密钥（逗号分隔，每个用户一个）。直接回车 = 开放模式（**仅限可信内网**）"
    read -rsp "NEXUS_API_KEY: " API_KEY
    echo
  fi
  cat > "${ENV_FILE}" <<EOF
# 由 backend/deploy.sh 自动生成
NEXUS_API_KEY=${API_KEY}
BACKEND_HOST=${BACKEND_HOST}
BACKEND_PORT=${BACKEND_PORT}
DATABASE_URL=${DATABASE_URL}
STATIC_DIR=${DEPLOY_DIR}/frontend/dist
RELOAD=0
EOF
  chown nexus:nexus "${ENV_FILE}"
  chmod 600 "${ENV_FILE}"
  log "已写入 ${ENV_FILE}"
fi

# ---------- 6. 构建前端（可选）----------
if [[ "${SKIP_FRONTEND_BUILD}" != "1" && -d "${DEPLOY_DIR}/frontend" ]]; then
  if command -v npm >/dev/null 2>&1; then
    log "构建前端产物"
    (cd "${DEPLOY_DIR}/frontend" && npm install && npm run build)
  else
    warn "后端将以纯 API 模式运行（未找到 npm，跳过前端构建）。"
  fi
fi

# ---------- 7. systemd ----------
UNIT=/etc/systemd/system/nexus.service
log "安装 systemd 服务 -> ${UNIT}"
sed -e "s#/opt/nexus#${DEPLOY_DIR}#g" "${SCRIPT_DIR}/nexus.service" > "${UNIT}"
systemctl daemon-reload
systemctl enable --now nexus
systemctl --no-pager status nexus | head -20

# ---------- 8. Caddy（可选）----------
if command -v caddy >/dev/null 2>&1; then
  log "检测到 Caddy，写入站点配置并重载"
  mkdir -p /etc/caddy
  sed -e "s#nexus.example.com#${DOMAIN}#g" "${DEPLOY_DIR}/Caddyfile" > /etc/caddy/Caddyfile
  systemctl reload caddy || caddy reload --config /etc/caddy/Caddyfile || true
else
  warn "未检测到 Caddy。请自行安装后执行："
  warn "  sudo mkdir -p /etc/caddy && sudo cp ${DEPLOY_DIR}/Caddyfile /etc/caddy/Caddyfile"
  warn "  然后把文件里的 nexus.example.com 换成你的域名，再 sudo systemctl reload caddy"
fi

# ---------- 9. 备份计划任务 ----------
chmod +x "${DEPLOY_DIR}/backend/backup.sh"
if [[ "${SKIP_CRON}" != "1" ]]; then
  if command -v crontab >/dev/null 2>&1; then
    log "安装每日备份计划任务（保留 14 天）"
    (crontab -l 2>/dev/null | grep -v 'backup.sh' || true
     echo "7 3 * * * ${DEPLOY_DIR}/backend/backup.sh ${BACKUP_DIR} >> ${BACKUP_DIR}/cron.log 2>&1"
     echo "17 3 * * * find ${BACKUP_DIR} -name 'nexus-*.db' -mtime +14 -delete") | crontab -
  else
    warn "未找到 crontab，请手动添加备份计划任务。"
  fi
fi

echo
log "完成。"
log "  健康检查： curl http://127.0.0.1:${BACKEND_PORT}/api/health"
log "  指标导出： curl http://127.0.0.1:${BACKEND_PORT}/api/metrics"
log "  实时日志： journalctl -u nexus -f"
