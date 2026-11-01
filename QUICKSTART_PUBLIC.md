# 公网速通清单（Cloudflare Tunnel，零 VPS）

> 目标：让家里一台**常开机、禁止睡眠**的机器跑后端，用 Cloudflare Tunnel 把它暴露成公网 `https://你的域名`，任何设备浏览器 / App 都能访问并实时同步。
> 完整原理与安全说明见 `PUBLIC_DEPLOYMENT.md` §1.1.1（方案 B）。本文件只给**照着点**的步骤。

---

## 0. 前置
- 一台常开、不睡眠的机器（Win / macOS / Linux 小主机 / NAS）
- 装：Python 3.10+、Node.js 18+（仅用来构建前端，一次）
- 拿到代码（clone 或复制整个 `nexus-matrix/`）

## 1. 构建前端（只做一次，升级才重做）
```bash
cd frontend
npm install
npm run build      # 产物在 frontend/dist/
```

## 2. 起后端（同源托管 + 只听本机）
后端既当 API 又当静态服务器，只听 `127.0.0.1`（只让 Tunnel 进，公网打不到它）。

**Windows（PowerShell）：**
```powershell
cd backend
python -m venv venv
venv\Scripts\pip install -r requirements.txt

$env:BACKEND_HOST="127.0.0.1"
$env:BACKEND_PORT="8010"
$env:STATIC_DIR="C:\路径\nexus-matrix\frontend\dist"
$env:NEXUS_API_KEY="<填强随机串>"
$env:RELOAD="0"
venv\Scripts\python.exe main.py
```

**Linux / macOS：**
```bash
cd backend
python3 -m venv venv
./venv/bin/pip install -r requirements.txt

BACKEND_HOST=127.0.0.1 BACKEND_PORT=8010 \
STATIC_DIR=/opt/nexus/frontend/dist \
NEXUS_API_KEY="<强随机串>" RELOAD=0 \
./venv/bin/python main.py
```
生成强随机 key（用项目自带脚本，跨平台）：`python tools/gen_api_key.py`（默认 32 字节；`--count 3` 一次出多个给多用户；`--bytes 48` 更长）。从 `backend/` 目录运行时用 `python ../tools/gen_api_key.py`。

> ⚠️ 后端 `main.py` 直接读**操作系统环境变量**，不会自动加载 `.env` 文件——所以上面用"行内设置环境变量"启动，跨平台都稳。
> `start.ps1` 是**本地开发**脚本（会另起前端 dev server 在 5180），公网部署不用它，只单独跑后端即可。

**本机验证：**
- 浏览器开 `http://127.0.0.1:8010/` → 应看到应用界面
- 开 `http://127.0.0.1:8010/api/pages` → 应返回 JSON

## 3. 用 Cloudflare Tunnel 暴露到公网
1. 装 `cloudflared`：
   - Linux：`sudo apt install cloudflared`（或官方 deb/rpm）
   - macOS：`brew install cloudflare/cloudflare/cloudflared`
   - Windows：`winget install Cloudflare.cloudflared`
2. **快速验证（零配置临时域名）：**
   ```bash
   cloudflared tunnel --url http://localhost:8010
   ```
   终端打印 `https://<随机>.trycloudflare.com`，手机开它就能用（每次重启域名会变，仅测试）。
3. **绑固定域名（稳定使用）：**
   - 把 `backend/tunnel-example-config.yml` 复制到 `~/.cloudflared/config.yml`，替换三处 `<...>` 占位符（隧道名、凭据路径、域名）
   - `cloudflared tunnel route dns nexus 你的域名`
   - `cloudflared service install`（开机自启）+ 启动

## 4. 各设备登录使用
- **Web（任意浏览器）：** 打开你的域名 → 设置 → 同步 →「同步服务器」留空（同源）或填 `https://你的域名`，「访问密钥」填第 2 步的 `NEXUS_API_KEY` → 状态变「已连接」即生效。
- **Android App：** 设置 → 同步 → 服务器填 `https://你的域名`、密钥填 `NEXUS_API_KEY`、保存重连（`ws` 自动转 `wss`）。

> 同一 key 的多台设备 = 同一房间、互相同步；换 key = 换一个空房间。

## 5. 一直在线 & 别丢数据
- 机器**关闭睡眠/休眠**、最好接 UPS（断电保护）
- `cloudflared` + 后端都设成**开机自启**（Windows 任务计划 / Linux systemd）
- 定时备份 `backend/nexus.db`（SQLite 单文件，直接拷即可）

## 6. 什么时候该上 VPS
踩到任一条就搬（数据 `nexus.db` 直接拷走，业务零改动）：
1. 家里没法保证常开
2. 批量大图/视频上传频繁失败（触碰 Cloudflare 免费版单次请求体上限）
3. 多人 / 移动端并发明显变慢

---

### 相关文件
- `PUBLIC_DEPLOYMENT.md` —— 完整部署文档（原理 / 安全 / 备份 / VPS 方案）
- `backend/tunnel-example-config.yml` —— Tunnel 配置文件模板（第 3 步用）
- `backend/.env.example` —— 后端环境变量说明
