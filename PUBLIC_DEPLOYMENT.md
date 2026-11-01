# Nexus Matrix —— 公网多租户部署指南

让**任意两台设备**（浏览器 Web + Android App）在**公网**（不限局域网）实时同步笔记。

---

## 0. 架构总览

```
┌─────────────┐  wss://域名/ws/sync    ┌──────────────┐
│ Android App │◄─────────────────────►│              │
│ (房间A)     │   https://域名/api    │   Caddy      │
└─────────────┘                       │  TLS 终止    │
                                      │  + 反代      │
┌─────────────┐  同源（由后端托管）   │              │
│   Web 端    │◄─────────────────────►│  :443        │
│ (房间A)     │                       └──────┬───────┘
└─────────────┘                              │ 127.0.0.1:8010
                                      ┌──────▼───────┐
┌─────────────┐  另一个 key → 房间B   │   uvicorn    │
│  其它用户   │◄─────────────────────►│  (单 worker)  │
└─────────────┘  数据互不可见         │   SQLite     │
                                      └──────────────┘
```

**多租户隔离（本次新增）**：`NEXUS_API_KEY` 是逗号分隔的允许列表，**每个 key 对应一个独立房间**。
- 相同 key 的设备 = 同一用户 → 互相实时同步；
- 不同 key 的设备 → 数据完全隔离，广播也只发同房间。

**同步链路**：
```
设备A编辑 → 防抖500ms → CLIENT_UPDATE → 后端合并(块级LWW)
                                          │
                                          ▼ SERVER_BROADCAST（仅同房间）
                                    设备B收到 → 合并 → UI刷新
```

---

## 1. 需要准备什么

### 1.1 一台公网可达的机器（二选一）

| 方案 | 说明 | 适合 |
|---|---|---|
| **A. 云 VPS** | 有固定公网 IP，最稳 | 长期对外服务 |
| **B. 家里常开机 + Cloudflare Tunnel** | 免去公网 IP、免开端口，Cloudflare 边缘自动 TLS | 个人自用、不想租服务器 |

#### 1.1.1 方案 B 详细步骤：家里常开机 + Cloudflare Tunnel

> 适用：不想租 VPS、家里有一台**常开机且禁止睡眠**的机器（台式机 / NAS / 小主机）。
> 核心思路：`cloudflared` 在你的机器上**出站**连到 Cloudflare 边缘，把 `localhost:8010` 暴露成公网 `https://你的域名`；
> 因此**不需要公网 IP、不需要端口转发、不需要开防火墙入站、也不需要 Caddy 做 TLS**（证书由 Cloudflare 边缘自动签发/续期）。
> 用 Tunnel 时**跳过 §2.5 的 Caddy 配置**（除非你主动保留）。

**与方案 A 的差别（方案 B 被 Tunnel 接管、可省的项）：**

| 项 | 方案 A（VPS） | 方案 B（Tunnel） |
|---|---|---|
| 公网 IP / 端口转发 | 需要 | **不需要** |
| TLS 证书 | Caddy 自动 | **Cloudflare 边缘自动**（本机免证书） |
| 反向代理 Caddy | 推荐 | **可省**，tunnel 直接打到 8010 |
| 防火墙入站 80/443 | 需要 | **不需要**（只有出站连接） |
| 机器常开 | 服务商保证 | **你来保证**（断网/睡眠 = 服务不可达） |
| 数据落盘 | 服务器 | **你的 home 机器**（备份也在这里） |

> §1.2 的「运行环境 / 密钥 / 备份」方案 B 同样需要；只有「域名 / TLS 证书 / 反向代理 / 防火墙入站」被 Tunnel 接管、可省。域名一项在方案 B 可用 Tunnel 提供的临时子域先验证，满意后再绑自有域名。

**步骤：**

1. **后端照常起在 `127.0.0.1:8010`**（`.env`）——关键是同源托管前端，这样只暴露一个源、`wss` 自动生效：
   ```bash
   BACKEND_HOST=127.0.0.1
   BACKEND_PORT=8010
   STATIC_DIR=/opt/nexus/frontend/dist   # 同源托管前端，WSS 自动走 wss，只需暴露一个源
   NEXUS_API_KEY=key-alice               # 现在是对公网，必须设；公网建议改用 keys.json（见 §10）
   ```
   先 `curl http://127.0.0.1:8010/` 确认本机返回 200。

2. **装 `cloudflared`**（home 机器，按系统选一种）：
   ```bash
   # Linux（Debian/Ubuntu）
   sudo apt install cloudflared          # 或官方 deb/rpm
   # macOS
   brew install cloudflare/cloudflare/cloudflared
   # Windows
   winget install Cloudflare.cloudflared # 或官网 msi
   ```
   验证：`cloudflared --version`。

3. **登录并建隧道**（首次需要 Cloudflare 账号；仅绑自有域名时需要）：
   ```bash
   cloudflared tunnel login        # 浏览器授权，选你的域名
   cloudflared tunnel create nexus # 生成隧道凭据
   ```
   不绑域名也能跑（见第 4 步），仅用临时子域验证时此步可只做 `login`。

4. **快速验证（零配置临时域名）**——先用它确认整条链路通：
   ```bash
   cloudflared tunnel --url http://localhost:8010
   ```
   终端会打印 `https://<随机>.trycloudflare.com`。浏览器打开它应看到同源前端；
   再访问 `https://<随机>.trycloudflare.com/api/pages` 应返回 JSON。**到此「整库同步 + 跨设备实时」已可跑通。**
   > 临时域名每次重启都变、且可能限速，仅用于验证。长期用第 5 步绑固定域名。

5. **绑固定域名（稳定使用）**——建配置文件 `~/.cloudflared/config.yml`：
   ```yaml
   tunnel: nexus
   credentials-file: ~/.cloudflared/<tunnel-id>.json
   ingress:
     - hostname: nexus.example.com
       service: http://localhost:8010
     - service: http_status:404
   ```
   把域名 DNS 指到 Cloudflare（CNAME 到 `<tunnel-id>.cfargotunnel.com`，或直接用下面一键命令），然后：
   ```bash
   cloudflared tunnel route dns nexus nexus.example.com  # 一键加 DNS 记录
   cloudflared service install                           # 装成系统服务，开机自启
   sudo systemctl start cloudflared
   ```
   浏览器访问 `https://nexus.example.com` 即可，无需任何证书/端口操作。

6. **（可选）保留 Caddy**：若你想要 Caddy 的静态托管/响应头/访问日志，可让 tunnel 的 `service` 指向 `https://localhost`（Caddy 在 443）而非 `http://localhost:8010`，其余不变。多数个人场景直接 tunnel→8010 更省事。

**客户端配置**：与 §3 完全一致——Web 直接访问 `https://你的域名`；Android 填同一地址 + 同一 key，`wss` 自动生效。

> **想开「用 Google 登录」？** 经 Tunnel（或任何反代）暴露时，**必须**设 `OAUTH_REDIRECT_BASE=https://你的域名`（§2.3 有说明）。因为后端拿到的 `request.base_url` 是 `http://localhost:8010`，若不覆盖，Google 回调会因 `redirect_uri` 不匹配而拒绝。域名项可用 Tunnel 提供的临时子域先行验证，满意后再绑固定域名；回调地址在 Google Cloud Console 填 `https://你的域名/api/auth/oauth/google/callback`。开发期不想配 Google，可设 `NEXUS_DEV_LOGIN=1` 用免密 dev-login（生产务必关掉）。

**安全 / 备份（同 §7、§4）**：`NEXUS_API_KEY` / `keys.json` 必设；`nexus.db` 备份仍在 home 机器本地（`backup.sh` 不变）。

**方案 B 的性能红线（决定要不要上 VPS）：**
- **大文件上传**：Cloudflare 免费版对单次请求体有上限（历史约 100MB 量级，以官网当前文档为准），批量大图/视频上传可能触顶——这是最常逼你迁移的点。
- **延迟与上行**：流量绕 Cloudflare 边缘 + 走家庭上行带宽；个人笔记同步通常够用，但家里上行小或常在外地会偏慢。
- **可用性**：断网、IP 变动、机器睡眠都会让服务掉线（VPS 无此问题），务必保证常开 + 禁止睡眠 + 断电保护。
- **配额 / SLA**：免费隧道无 SLA，量大可能被限。

> 触发迁移信号：①家里无法保证常开；②大图频繁上传失败/触顶；③多人/移动端并发明显变慢。
> 到那时按 §2 把 `/opt/nexus` 搬上 VPS，`nexus.db` 直接拷（SQLite 单文件），业务零改动。

### 1.2 其它必备项

| 项目 | 要求 |
|---|---|
| **域名** | 自有域名（DNS A 记录指向服务器）；用 Tunnel 可直接用其提供的子域 |
| **TLS 证书** | Caddy 自动 Let's Encrypt（无需 certbot）；或 nginx + certbot |
| **反向代理** | Caddy（推荐：一行配置同时做 TLS、反代、静态托管） |
| **运行环境** | Python 3.10+ venv（已有 `requirements.txt`：fastapi / uvicorn / websockets / pydantic） |
| **防火墙** | 放行 80 / 443；**公网不要直接暴露 8010**，只让 Caddy 对外 |
| **密钥** | 强随机 `NEXUS_API_KEY`（每个用户一个） |
| **备份** | 定时备份 `nexus.db` |

---

## 2. 部署步骤

假设部署目录 `/opt/nexus/backend`。

### 2.1 上传代码并建虚拟环境

```bash
sudo mkdir -p /opt/nexus
# 上传/克隆仓库到 /opt/nexus

cd /opt/nexus/backend
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
```

### 2.2 构建前端（供后端同源托管）

```bash
cd /opt/nexus/frontend
npm install
npm run build      # 产物在 frontend/dist/
```

### 2.3 配置环境变量

```bash
cp /opt/nexus/backend/.env.example /opt/nexus/backend/.env
# 编辑 .env
```

关键项：

```bash
# 每个用户一个独立 key，逗号分隔（留空 = 开放模式，仅限可信内网）
# 更推荐用 keys.json 管理（见 §10），支持单独吊销且改完热生效
NEXUS_API_KEY=key-alice,key-bob

# keys.json 的位置（默认 backend/keys.json）。里面只存 key 的 sha256，不落明文。
KEYS_FILE=

# 前端同源托管：指向构建产物目录（留空则用默认的 ../frontend/dist）
STATIC_DIR=/opt/nexus/frontend/dist

# 公网部署建议只监听本机，由 Caddy 对外
BACKEND_HOST=127.0.0.1
BACKEND_PORT=8010

# 前端若独立部署在别的源，才需要填；同源托管时留空
# CORS_ORIGINS=https://nexus.example.com

RELOAD=0

# ===== 账户 / OAuth 登录 =====
# 开发期本地联调登录（免 Google 凭据）：设 1 启用 /api/auth/dev-login。
# 生产务必设为 0 或留空，否则任何人可免密登录。
NEXUS_DEV_LOGIN=0

# JWT 签名密钥：默认自动生成并持久化到 backend/jwt_secret 文件（重启不失效）。
# 生产可在环境变量显式指定一个强随机值（与 jwt_secret 文件二选一，环境变量优先）。
JWT_SECRET=
# 登录 JWT 有效期（天），默认 7
JWT_EXP_DAYS=7

# Google OAuth（可选）：三项都填才启用「用 Google 登录」按钮。
# 在 Google Cloud Console 创建 OAuth 客户端，回调填 https://你的域名/api/auth/oauth/google/callback
OAUTH_GOOGLE_ID=
OAUTH_GOOGLE_SECRET=
# 经反代 / Cloudflare Tunnel 暴露时必填：后端看到的 request.base_url 是 http://localhost，
# 必须用公网 base 覆盖，否则 Google 会因 redirect_uri 不匹配拒绝登录。
# 例： OAUTH_REDIRECT_BASE=https://nexus.example.com
OAUTH_REDIRECT_BASE=
```

生成强随机 key（任选其一）：

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
# 或用项目自带脚本（跨平台、可一次生成多个）：
python tools/gen_api_key.py            # 默认 32 字节
python tools/gen_api_key.py --count 3  # 多用户：一次出 3 个
```

### 2.4 配置 systemd

```bash
sudo useradd -r -s /bin/false nexus 2>/dev/null || true
sudo chown -R nexus:nexus /opt/nexus
sudo cp /opt/nexus/backend/nexus.service /etc/systemd/system/nexus.service
sudo systemctl daemon-reload
sudo systemctl enable --now nexus
sudo systemctl status nexus
```

> **单 worker 是硬性要求**：房间连接表是进程内 `ConnectionManager` 维护的，
> 多 worker 会让各进程房间互相看不见，导致同房间设备收不到广播。
> `nexus.service` 已写死 `--workers 1`。

### 2.5 配置 Caddy

```bash
# 编辑 /etc/caddy/Caddyfile（或复制仓库根目录的 Caddyfile）
sudo cp /opt/nexus/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy 会自动申请证书并把 80 重定向到 443。

### 2.6 验证

```bash
# 后端健康检查（服务器本机）
curl http://127.0.0.1:8010/

# 公网验证（任意设备浏览器）
https://nexus.example.com/api/pages
# 应返回 {"success":true,"data":[...],"cursor":...}
```

---

## 3. 客户端怎么配

### Android App
1. 打开 App → 设置 → 同步
2. 后端地址：`https://nexus.example.com`
3. 访问密钥：分配给该用户的那个 key
4. 点「保存并重连」

> 走 https 后不再依赖 `network_security_config` 的明文放行；`ws` 会自动映射为 `wss`。

### Web 端
- **同源托管时**：直接访问 `https://nexus.example.com` 即可，无需任何配置（相对路径 `/api`、`/ws/sync` 自动指向同源后端）。
- **独立部署时**：把 `SYNC_SERVER` 设为 `https://nexus.example.com`，并在后端 `CORS_ORIGINS` 里放行该前端源。

同一 key 的多台设备互相实时同步；不同 key 完全隔离。

---

## 4. 备份与恢复

```bash
chmod +x /opt/nexus/backend/backup.sh

# 每日 03:07 备份，保留 14 天
(crontab -l 2>/dev/null; echo "7 3 * * * /opt/nexus/backend/backup.sh /opt/nexus/backups >> /opt/nexus/backups/cron.log 2>&1") | crontab -
(crontab -l 2>/dev/null; echo "17 3 * * * find /opt/nexus/backups -name 'nexus-*.db' -mtime +14 -delete") | crontab -
```

恢复：停服务 → 用备份覆盖 `nexus.db` → 启服务。

```bash
sudo systemctl stop nexus
cp /opt/nexus/backups/nexus-YYYYMMDD-HHMMSS.db /opt/nexus/backend/nexus.db
sudo chown nexus:nexus /opt/nexus/backend/nexus.db
sudo systemctl start nexus
```

## 5. 监控与日志

```bash
journalctl -u nexus -f              # 后端日志
journalctl -u caddy -f              # Caddy 日志
systemctl status nexus              # 运行状态
```

启动时日志会打印：`[NEXUS] 版本=x.y.z 鉴权模式=多租户(有效 key N 个) 后端=sqlite CORS=[...]`，可用来确认配置是否生效。

### 5.1 Prometheus 指标导出

```bash
curl -s http://127.0.0.1:8010/api/metrics
```

输出（exposition format v0.0.4）：

```
# HELP nexus_uptime_seconds 服务已运行的秒数
# TYPE nexus_uptime_seconds gauge
nexus_uptime_seconds 3621.417

# HELP nexus_requests_total 累计 HTTP 请求数
# TYPE nexus_requests_total counter
nexus_requests_total 812

# HELP nexus_errors_total 累计错误数
# TYPE nexus_errors_total counter
nexus_errors_total 0

# HELP nexus_ws_messages_total 累计收到的 WebSocket 消息数
# TYPE nexus_ws_messages_total counter
nexus_ws_messages_total 154

# HELP nexus_broadcasts_total 累计房间广播次数
# TYPE nexus_broadcasts_total counter
nexus_broadcasts_total 96

# HELP nexus_rooms 当前在线房间数
# TYPE nexus_rooms gauge
nexus_rooms 2

# HELP nexus_connections 当前 WebSocket 连接总数
# TYPE nexus_connections gauge
nexus_connections 3
```

Prometheus 抓取配置：

```yaml
scrape_configs:
  - job_name: nexus
    metrics_path: /api/metrics
    static_configs:
      - targets: ['127.0.0.1:8010']
```

> `/api/metrics` 同样不鉴权。建议用 Caddy 限制只允许内网 / 监控网访问（配置示例见 `Caddyfile` 注释）。
>
> 指标为**进程内计数**，重启清零；多实例时各自统计，跨实例聚合需外部指标系统。
>
> 基于这些指标的**告警规则见 §12**，**通知渠道（邮件 / Telegram / Webhook）见 §12.1**。

## 6. 常见问题排查

```
两端不同步？
└─ 公网能否打开 https://域名/api/pages ？
   ├─ 打不开 → 后端没起 / Caddy 没连上 / 防火墙没放行 443
   └─ 能打开 JSON，但 App 不同步 → App 配置问题
       ├─ 后端地址必须是 https://域名（不能是 localhost / 10.0.2.2）
       ├─ 访问密钥必须与后端 NEXUS_API_KEY 中的某一个一致
       └─ 看 App 设置里的「状态」：未连接（纯本地模式）= 地址空或不可达
```

- **地址必须是 `https://`**（公网），端口不要写 `8010`（那是后端内部端口，对外是 443）。
- **两个设备必须用同一个 key** 才会同步；换了 key 等于换了一个空房间。
- 后端监听 `127.0.0.1:8010` 时，只有 Caddy 能访问，公网直接连 8010 会失败（这是对的）。

## 7. 安全提醒

- **务必设置 `NEXUS_API_KEY`**：留空 = 开放模式，任何人连上就能读/改**全部**数据。公网部署必须配置。
- 每个用户一个独立 key，不要把同一个 key 发给多个人（那样他们共享同一个房间）。
- `CORS_ORIGINS` 公网请收紧到具体前端源，避免 `*`。
- 定期备份 `nexus.db`（单文件，直接拷即可）。

## 8. 切换到 Postgres（已实现）

持久层已抽出 `db.py` 的 `Database` 抽象，并有**两个完整实现**：

| 实现 | 触发条件 | 依赖 |
|---|---|---|
| `SQLiteDatabase` | 未设 `DATABASE_URL`（默认） | 无 |
| `PostgresDatabase` | 设了 `DATABASE_URL`（`postgres://` 或 `postgresql://`） | `asyncpg` |

启用 Postgres 只需两步：

```bash
# 1) 安装驱动
./venv/bin/pip install asyncpg

# 2) 在 .env 里设置连接串
DATABASE_URL=postgres://nexus:你的密码@127.0.0.1:5432/nexus
```

重启后端即可，启动日志会打印 `后端=postgres` 便于确认：
```bash
sudo systemctl restart nexus && journalctl -u nexus -f
```

实现要点（已封装在 `db.py`，业务代码无感）：
- 占位符用 `$1,$2...`（Postgres）而非 `?`（SQLite）；
- upsert 用 `ON CONFLICT (id, room) DO UPDATE`，而非 `INSERT OR REPLACE`；
- `data` 列 Postgres 用 `JSONB`（写入显式 `::jsonb`），SQLite 用 `TEXT`；
- `updated_at` 两边都存 ISO 字符串，保证与前端 LWW 比较基准一致；
- 首次 `init()` 自动建表；若表已存在但缺 `room` 列会自动补齐并重建复合主键 `(id, room)`。

**多实例注意**：`ConnectionManager` 是进程内的房间表，多实例时各实例房间互不可见，
广播需换成 Redis Pub/Sub 之类的跨进程通道（业务代码 `await manager.broadcast(...)` 不用改）。

---

## 9. 一键部署脚本

```bash
sudo backend/deploy.sh
```

脚本会按序完成：

1. 创建系统用户 `nexus`
2. 创建部署目录（默认 `/opt/nexus`）
3. 同步 `backend/` 与 `frontend/`（排除 `venv`、`node_modules`、`dist`、`nexus.db`、`keys.json`、`.env`、`backups`、日志）
4. 创建 venv 并安装 `requirements.txt`（含可选 `asyncpg`）
5. 生成 `.env`（权限 `0600`；已存在则跳过，除非 `FORCE_ENV=1`）
6. 构建前端产物（需要 `npm`；无 npm 则跳过，后端以纯 API 模式运行）
7. 安装并启动 systemd 服务（单 worker）
8. 若检测到 Caddy：写入站点配置并重载（域名自动替换）
9. 安装每日备份计划任务（保留 14 天）

### 升级路径（保留数据）

脚本会自动判断：若 `${DEPLOY_DIR}/backend` 已存在 → 走 **upgrade** 模式。

```bash
sudo backend/deploy.sh           # 自动识别为升级
sudo backend/deploy.sh upgrade   # 显式升级
sudo backend/deploy.sh fresh     # 强制全新安装
```

**upgrade 模式的关键区别：**

| 项 | fresh | upgrade |
|---|---|---|
| rsync `--delete` | ✅ 开启 | ❌ **关闭**（绝不删目标端独有文件） |
| `nexus.db` | 新建 | **保留** |
| `keys.json` | 新建 | **保留**（丢了所有用户都连不上） |
| `.env` | 生成/覆盖（`FORCE_ENV=1`） | **保留**（除非 `FORCE_ENV=1`） |
| `backups/` | 新建 | **保留** |
| venv | 重建 | 复用，仅 `pip install -U` |

每次升级前脚本会自动热备数据库到 `backups/nexus-preupgrade-<时间戳>.db`。

> 想彻底重置数据：先 `systemctl stop nexus`，手动删 `nexus.db` 与 `keys.json`，再 `sudo backend/deploy.sh`；
> 注意这会**丢掉所有租户密钥与笔记数据**，不可恢复。

可用环境变量覆盖默认值：

```bash
sudo DEPLOY_DIR=/opt/nexus \
     BACKEND_PORT=8010 \
     BACKEND_HOST=127.0.0.1 \
     NEXUS_API_KEY=key-alice,key-bob \
     backend/deploy.sh
```

| 变量 | 默认 | 说明 |
|---|---|---|
| `DEPLOY_DIR` | `/opt/nexus` | 部署目录 |
| `DOMAIN` | `nexus.example.com` | 对外域名（写入 Caddy 配置） |
| `BACKEND_PORT` | `8010` | 后端内部端口 |
| `BACKEND_HOST` | `127.0.0.1` | 后端监听地址 |
| `NEXUS_API_KEY` | 空 | 多租户密钥；留空则交互输入（回车 = 开放模式） |
| `DATABASE_URL` | 空 | Postgres 连接串；留空用 SQLite |
| `SKIP_FRONTEND_BUILD` | `0` | 设 `1` 跳过前端构建 |
| `SKIP_CRON` | `0` | 设 `1` 不安装备份计划任务 |
| `FORCE_ENV` | `0` | 设 `1` 覆盖已有 `.env` |

### 回滚（`--rollback`）

```bash
sudo backend/deploy.sh rollback                       # 回滚到最近一次「升级前备份」
sudo backend/deploy.sh rollback /opt/nexus/backups/nexus-preupgrade-20261029-030700.db
sudo backend/deploy.sh list-backups                   # 先看有哪些可回滚的备份
```

流程：**停服务 → 备份当前库 → 用备份覆盖 → 启服务 → 自动打一次健康检查**。
每次 `upgrade` 前都会自动热备，所以 `rollback` 永远有上一版可退。

> 只回滚**数据**（`nexus.db`），不动代码。若要连代码一起退，回滚后重新部署对应版本的仓库即可。

**前置条件**：域名 DNS 已指向本机；防火墙放行 80 / 443。
脚本在 Debian / Ubuntu（systemd + apt）上验证；其它发行版请先装好 `python3-venv` 与 `caddy`。

---

## 10. 密钥管理（keyctl.py）

### 10.1 签发

```bash
cd /opt/nexus/backend
python keyctl.py add alice        # 输出一串明文密钥，**只显示一次**，请保存
python keyctl.py add phone-1      # 同一个人第二台设备 → 要用**同一个 key**，不要再 add 一个
```

- 把打印出来的 key 发给对应用户；
- 用户填到 App / Web 的「设置 → 同步 → 访问密钥」；
- **同一用户的多台设备共用同一个 key**（这样它们才在同一个房间、才能互相同步）。

### 10.2 查看

```bash
python keyctl.py list
```

输出示例：
```
LABEL                ROOM(前缀)        CREATED_AT                   STATUS
alice                a1b2c3d4e5f6     2026-10-28T12:00:00+00:00   ACTIVE
bob                  9f8e7d6c5b4a     2026-10-28T12:05:00+00:00   REVOKED
```

只显示 room 前缀，不回显明文（服务端不存明文）。

### 10.3 吊销 / 恢复 / 删除

```bash
python keyctl.py revoke <label|room前缀>    # 吊销：立即禁止新连接
python keyctl.py unrevok <label|room前缀>  # 恢复（误吊销补救）
python keyctl.py remove <label|room前缀>   # 彻底删除条目
```

### 10.4 两个必须知道的限制

1. **已建立的 WebSocket 不会被立刻断开**。吊销只对**新连接**生效（后端通过 mtime 热检测，无需重启）。  
   若要立刻踢掉在线设备：`sudo systemctl restart nexus`。
2. **写在 `NEXUS_API_KEY` 环境变量里的 key 无法单独吊销**（它作为旧部署兜底恒有效）。  
   公网部署请清空该变量，改用 `keys.json` 管理。`keyctl.py list` 会在检测到该变量存在时给出提示。

### 10.5 keys.json 结构

```json
{
  "keys": [
    {
      "hash": "<sha256(明文key)>",
      "label": "alice",
      "created_at": "2026-10-28T12:00:00.000000+00:00",
      "revoked": false
    }
  ]
}
```

文件权限自动设为 `0600`；写入采用临时文件 + `os.replace` 原子替换，避免半写状态。

---

## 11. 健康检查与监控

### 11.1 `GET /api/health`

**刻意不做鉴权**——负载均衡 / uptime 监控通常不带 API key。因此只返回聚合信息，
不含任何用户内容，也不暴露 key。

```bash
curl -s https://nexus.example.com/api/health
```

返回示例：

```json
{
  "status": "ok",
  "version": "1.0.0",
  "backend": "sqlite",
  "db": "up",
  "db_error": null,
  "uptime_seconds": 3621.4,
  "rooms": 2,
  "connections": 3,
  "metrics": {
    "requests": 812,
    "errors": 0,
    "ws_messages": 154,
    "broadcasts": 96,
    "last_error": null,
    "last_error_at": null
  }
}
```

字段说明：

| 字段 | 含义 |
|---|---|
| `status` | `ok` = 库连通；`degraded` = 库探测失败（此时 HTTP **503**） |
| `backend` | 当前持久层实现：`sqlite` 或 `postgres` |
| `rooms` / `connections` | 当前在线房间数 / WebSocket 连接总数 |
| `metrics.errors` | 进程内累计错误数 |
| `metrics.last_error` / `_at` | 最近一次错误文案与时间（无则 `null`） |

> 用途：LB 健康探测、uptime 监控定时轮询、以及出错后快速看一眼 `last_error`。

### 11.2 监控指标如何采集

指标由 `monitor.py` 在进程内计数，经 HTTP 中间件自动采集：

- `requests` —— 每个 HTTP 请求 +1；
- `errors` + `last_error` —— 响应状态码 ≥ 500 或抛出异常时记录；
- `ws_messages` —— 每收到一条 WS 消息 +1；
- `broadcasts` —— 每次房间广播 +1。

也可以直接访问 `/api/health` 拿 JSON，用任意监控手段（如定时 curl、或改造成 Prometheus exporter）消费。

### 11.3 已知局限与告警建议

- **进程重启即清零**，且**多实例各自统计**，跨实例聚合需外部指标系统（Prometheus / Redis）。
- 建议至少对以下情况告警：
  - `/api/health` 连续返回 **503**（库断了）；
  - `metrics.errors` **持续增长**（说明有稳定复现的故障）；
  - `connections` 长时间为 **0** 但预期有设备在线（可能是 WS 连不上）。
- `errors` 只记录"最近一次"详情，如需完整错误日志请看 `journalctl -u nexus`。

---

## 12. Prometheus 告警规则

规则文件已放在 **`backend/alert.rules.yml`**，可直接拷贝到 `/etc/prometheus/`。

```bash
sudo cp backend/alert.rules.yml /etc/prometheus/alert.rules.yml
```

在 `prometheus.yml` 里引用并配置抓取：

```yaml
rule_files:
  - /etc/prometheus/alert.rules.yml

scrape_configs:
  - job_name: nexus
    metrics_path: /api/metrics
    static_configs:
      - targets: ['127.0.0.1:8010']

alerting:
  alertmanagers:
    - static_configs:
        - targets: ['127.0.0.1:9093']
```

规则清单：

| 告警 | 表达式 | 级别 |
|---|---|---|
| `NexusBackendDown` | `up{job="nexus"} == 0` | critical |
| `NexusScrapeSlow` | `scrape_duration_seconds{job="nexus"} > 1` | warning |
| `NexusDatabaseDown` | `nexus_db_up == 0` | critical |
| `NexusHighErrorRate` | `rate(nexus_errors_total[5m]) > 0.05` | warning |
| `NexusErrorBurst` | `increase(nexus_errors_total[10m]) > 20` | warning |
| `NexusNoDevicesOnline` | `nexus_connections == 0`（for 6h） | info |

重载配置：
```bash
sudo systemctl reload prometheus      # 或 kill -HUP <pid>
# 校验规则语法：promtool check rules /etc/prometheus/alert.rules.yml
```

> 告警规则引用的指标名必须与 `/api/metrics` 暴露的一致。
> 多实例时把 `nexus_connections` / `nexus_rooms` 包一层 `sum()` 聚合，避免单实例为 0 就误报。
> `NexusNoDevicesOnline` 只是 info 级提醒，夜间无人使用会命中，不必接强通知渠道。

### 12.1 接 Alertmanager（真正的通知渠道）

Prometheus 只负责「算出告警」，**发邮件 / Telegram / Webhook 由 Alertmanager 做**。
配置示例在 **`backend/alertmanager.yml`**。

```bash
sudo cp backend/alertmanager.yml /etc/alertmanager/alertmanager.yml
sudo systemctl restart alertmanager

# 改完先校验，避免配置写错导致「静默不通知」
amtool check-config /etc/alertmanager/alertmanager.yml
```

**按 severity 分流：**

| 级别 | 接收器 | 渠道 |
|---|---|---|
| `critical` | `critical-email` | 邮件（SMTP；`group_wait: 10s`，1 小时内重复提醒） |
| `warning` | `telegram` | Telegram Bot |
| `info` | `default-webhook` | 兜底 Webhook（日志归档 / 企微 / 钉钉机器人） |

`critical` 与 `warning` 两条 route 都带 `continue: true`，所以它们**同时**还会落到兜底 webhook，便于统一留痕。

**需要替换的占位符：**

| 位置 | 占位符 | 说明 |
|---|---|---|
| `critical-email` | `smtp.example.com:587`、`auth_username`、`auth_password` | 多数邮箱要用**应用专用密码**，不是登录密码 |
| `telegram` | `<BOT_TOKEN>`、`chat_id` | 需要 **Alertmanager ≥ 0.24**（原生 `telegram_configs`）；旧版本请改用 webhook 桥接（如 `alertmanager-bot`） |
| `default-webhook` | `http://127.0.0.1:5001/` | 任意能收 POST 的服务 |

`inhibit_rules` 的作用：后端整体挂掉（`critical`）时抑制 `NexusNoDevicesOnline` 这类派生的 `info` 告警，避免一次故障刷屏。

```yaml
inhibit_rules:
  - source_matchers: ['severity="critical"']
    target_matchers: ['severity="info"']
    equal: ['job']
```

> **凭据安全**：`bot_token` / SMTP 密码属于机密，不要提交进公开仓库，建议用环境变量或 secret 注入。
> Alertmanager 的 9093 端口若暴露在公网，务必加认证或反代限制。

**端到端自检：**

```bash
amtool alert add nexus_test severity="warning" job="nexus"   # 手动造一条告警，确认能收到通知
amtool alert query                                           # 看告警是否已到达 Alertmanager
amtool silence add --comment '维护' --duration 2h severity="warning"   # 维护窗口内静默
```
