# NEXUS MATRIX

一个支持 **LocalFirst（本地优先）** 的全平台**工业风区块编辑器 / 知识矩阵**。以 Notion 式块（Block）编辑为核心，具备树状页面空间、多媒体块、可视化看板、Slash 命令菜单以及跨端实时同步能力，整体采用深色科幻（Cyberpunk / Industrial）UI 风格。

---

## 核心特性

- **区块编辑器（Block Editor）**：每一行即一个「块」，支持文本、标题（H1/H2/H3）、待办、无序列表、引用、图片、代码块、看板等多种类型。
- **LocalFirst 持久化**：编辑内容优先写入浏览器 `localStorage`（键 `nexus_matrix_pages_v3`），刷新/断网数据不丢失，无需服务器即可使用。
- **Slash 命令与 Markdown 快捷输入**：行首输入 `/` 唤出命令菜单；支持 `# `、`## `、`### `、`- `、`[] `、`" `、`/code`、`/kanban` 等快捷转换。
- **树状页面空间（Sidebar）**：支持无限层级的子页面、展开/折叠、收藏夹、面包屑导航，URL Hash 路由记录当前页面。
- **文档图标（Page Icon）**：每个页面可设置一个 emoji 图标，显示在侧边栏列表、标题上方、面包屑、反向链接与 `[[` 提及菜单中。侧边栏点击行首图标或标题上方的大图标即可设置；选择器支持 8 个分类浏览、中文/拼音搜索、随机与移除。
- **页眉封面（Page Cover）**：每个页面可在标题上方设置全出血封面图，支持本地上传（自动压缩至 1600×1200 内、JPEG q0.82，避免撑爆 localStorage）、外部图片链接、Unsplash 图库、以及 5 种零存储成本的渐变色。封面高度按图片自然比例自适应（clamp 200~420px）——竖构图人像能获得更高画幅而非只露头部；桌面端 hover 浮出「更换封面 / 移除」，触屏点击后常驻显示；**按住拖动可垂直重新取景**（`object-position-y`，存入 `Page.coverPos`，默认 35% 偏上以利于人像构图）。
- **Notion 导入**：右下角「IMPORT ZIP」按钮导入 Notion 的 Markdown & CSV 导出包（另可用「IMPORT MD」导入单个 `.md` 文件）。ZIP 导入会解压出全部页面、按「文件夹套 .md」结构重建层级，并把包内图片转为 Base64 落成图片块（远程图片同样立即下载，避免 S3 预签名 URL 过期后破图）。导入为**追加**语义，不清空已有内容；`prevId` 链自动重建以保证三端同步可合并。不支持的形态一律降级保留原文，绝不丢弃内容，导入完成后会报告页数/块数/降级数/图片失败数。
- **Unsplash 图库**：封面选择器内置 Unsplash 搜索，需用户自填 API Key（存 localStorage 独立键，不参与页面同步）。选用后自动下载并压缩存储，并按 Unsplash 合规要求在封面浮层显示摄影师署名。Provider 抽象已就绪，后续接入 Pexels 只需新增一个实现文件并在注册表加一行。
- **标题 ⇄ 正文光标流转**：标题处按 `Enter` / `↓` / `Tab` 进入正文首块；正文首块按 `↑` 或行首 `Backspace` 回到标题末尾。
- **可折叠标题（Toggle Heading）**：H1/H2/H3 与折叠块左侧箭头可折叠其后内容——标题折叠到下一个同级或更高级标题，折叠块折叠到同级块。
- **块选择态**：`Esc` 选中当前块，`↑`/`↓` 扩展整块选择，`Tab`/`Shift+Tab` 批量缩进，`Cmd/Ctrl+D` 批量复制，`Backspace` 批量删除，`Enter` 回到编辑。
- **双向链接**：输入 `[[` 唤出页面链接菜单（可搜索、无匹配时新建页面并链接）；页面底部自动聚合「反向链接」列表。
- **导出 Markdown**：右下角 `MD` 按钮，当前页面连同子页面一并导出，块类型、行内格式、页面链接（`[[标题]]`）、代码块、看板均会转换。
- **撤销 / 重做**：`Ctrl/⌘+Z` 撤销、`Ctrl/⌘+Shift+Z` 重做（快照式历史栈，连续输入自动合并为一步）。
- **行内富文本**：`Ctrl/⌘+B/I/U/E`、`Ctrl/⌘+Shift+S`；选中文本后自动弹出浮动格式工具栏（含链接）；链接通过弹窗输入，地址无协议时自动补全 `https://`。
- **高级交互引擎**：
  - `Tab` / `Shift+Tab` 行内层级缩进（智能继承上一行缩进，最大不超过父级 +1）。
  - 任意位置 `Enter` 拆行、`Shift+Enter` 块内软换行、`Backspace` 行首级联合并。
  - 空的列表 / 待办项按 `Enter` 自动降级为普通段落（Notion 式 escape hatch）。
  - 块级拖拽排序（智能继承目标缩进等级）、跨行 `Shift+方向键` 选区、`Ctrl/⌘+A` 全选。
  - **跨块选区**：鼠标拖拽或 `Shift+方向键` 可跨任意多行选取文本（自建逻辑选区引擎，不依赖浏览器跨 `contenteditable` 宿主的原生行为）；选中后可加粗/高亮/删除，删除时首尾块的剩余内容自动合并。
  - `Ctrl/⌘+D` 复制块、`Ctrl/⌘+Shift+↑/↓` 移动块、`Ctrl/⌘+Enter` 勾选待办。
  - 拖拽手柄 + 操作菜单：复制、删除、上/下移动、转换为任意块类型。
  - 中文输入法（IME）组合期不拦截按键，拼音候选与 Markdown 快捷输入互不干扰。
- **多媒体与富容器**：图片上传 / 任意位置拖拽图片自动解析（Base64）、多语言代码块（JS/Python/Vue/Rust）、可视化看板（待办/进行中/已完成 列与卡片 CRUD）。
- **跨端实时同步（后端）**：FastAPI + WebSocket 广播，新设备接入即推送全量矩阵（`INITIAL_SYNC`），任意端修改后广播至其余在线设备（`SERVER_BROADCAST`）。
- **全平台封装潜力**：后端 `CORS` 放通，前端可嵌入 Tauri / Capacitor 打包为桌面 / 移动端应用（代码注释层面已预留）。

---

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | Vue 3（`script setup`） + TypeScript + Vite + Tailwind CSS 3 |
| 后端 | Python + FastAPI + Uvicorn + WebSocket（跨端同步中继） |
| 持久化 | 前端：存储抽象（默认 `localStorage`，可切 `IndexedDB` 解决配额/驱逐）；后端：SQLite（`nexus.db`，重启不丢，全局锁防并发） |
| 工具链 | PowerShell 一键启动（`start.ps1`）、Yarn/npm 包管理、Capacitor（Android 壳） |

---

## 系统架构

```
┌─────────────────────────────────────────────────────┐
│                  前端 (Vue 3 SPA)                     │
│  App.vue → NexusTaskMatrix1.vue (已集成同步层)        │
│  ├─ Sidebar 树状页面空间 / 收藏 / 面包屑               │
│  ├─ 区块编辑器（Block CRUD + 缩进 + 拖拽 + 富文本）     │
│  └─ 同步层 composables/useSync.ts                     │
│       ├─ LocalFirst 存储抽象（localStorage↔IndexedDB） │
│       └─ WebSocket 实时同步（INITIAL_SYNC/BROADCAST）  │
└──────────────────────┬──────────────────────────────┘
                       │  REST API + WebSocket（可禁用）
                       │  /api/pages*   /ws/sync
┌──────────────────────▼──────────────────────────────┐
│           后端 (FastAPI + Uvicorn + SQLite)           │
│  ├─ REST: 页面 CRUD（持久化到 nexus.db）               │
│  ├─ SQLite 存储（全局锁防线程池/事件循环竞争）          │
│  ├─ WebSocket /ws/sync: 连接管理 + 全量广播            │
│  └─ CORS 放通：支持 Tauri/Capacitor/WebView 跨端       │
└─────────────────────────────────────────────────────┘
```

**数据流说明**

1. **启动同步（LocalFirst）**：`NexusTaskMatrix1.vue` 在 `onMounted` 调用 `initSync(pages)`——先读本地存储（IndexedDB/localStorage），再向 `/api/pages` 拉取远端全量，经 `mergePages`（最后写入者胜出 + 块级 LWW）合并后回写本地。整条链路离线可用，联网时自动对齐。
2. **实时同步路径**：后端将页面持久化到 `nexus.db`(SQLite)，REST（`/api/pages`）提供 CRUD，WebSocket（`/ws/sync`）在设备建连时下发 `INITIAL_SYNC`、任何端变更后 `SERVER_BROADCAST` 增量广播；前端编辑经「首发即推 + 停手 300ms 收尾」防抖后通过 `CLIENT_UPDATE` 上推变化页。
3. **统一组件**：`App.vue` 当前直接挂载 `NexusTaskMatrix1.vue`，它已内置 `useSync` 同步层（不依赖 `NotionPlus.vue` 旧参考实现）。后端地址可在「设置」面板或 `?syncServer=` 配置，留空即纯本地模式。

---

## 目录结构

```
nexus-matrix/
├── start.ps1                 # 一键启动脚本（检查 Python→建 venv→装依赖→起前后端）
├── .env                      # 端口配置（BACKEND_PORT / FRONTEND_PORT）
├── backend/
│   ├── main.py               # FastAPI 应用：REST + WebSocket 同步 + SQLite 持久化
│   ├── nexus.db              # SQLite 数据库（页面矩阵 + 图片 BLOB，重启不丢）
│   ├── requirements.txt       # fastapi / uvicorn / websockets / pydantic
│   └── venv/                 # Python 虚拟环境（自动生成）
└── frontend/
    ├── index.html
    ├── package.json           # vue / vite / tailwind / typescript / capacitor
    ├── vite.config.ts         # 端口 + /api、/ws 代理到后端
    ├── tailwind.config.js
    └── src/
        ├── main.ts
        ├── style.css
        ├── App.vue            # 根组件，挂载主编辑器 + 备份/导入工具栏 + 存储告警
        ├── runtimeConfig.ts   # 同步服务器地址（URL query > localStorage）
        ├── assets/
        ├── components/
        │   ├── NexusTaskMatrix1.vue  # 当前启用的区块编辑器（已集成 useSync 同步层）
        │   ├── NotionPlus.vue        # 早期后端对接参考实现（功能已被前者覆盖）
        │   ├── SettingsPanel.vue     # 同步服务器 / 图库 Key 等设置
        │   └── ...
        └── composables/
            ├── useSync.ts     # 同步层：initSync / mergePages / 存储读写 / WS 收发
            ├── storage.ts     # 统一键值存储抽象（默认 localStorage）
            ├── idbStore.ts    # IndexedDB 实现（突破配额/驱逐，图片 Blob 复用其连接）
            ├── assets.ts      # 图片资产降采样 + Blob 入库
            ├── zipImport.ts   # Notion ZIP / MD 导入（层级重建 + 图片转 Base64）
            └── providerKeys.ts / imageProviders.ts  # 图库 Provider 抽象
```

---

## 同步与数据一致性

整体遵循 **LocalFirst（本地优先）** 原则：本地存储是可信源，服务器用于跨设备对齐，断网/无服务器也能完整编辑。

### 存储抽象层
- `composables/storage.ts` 定义统一 `KeyValueStore` 接口（Promise 化），默认 Web 实现为 `localStorage`。
- `composables/idbStore.ts` 提供 **IndexedDB** 实现：突破 `localStorage` 的 5 MiB 配额与存储压力下的 LRU 驱逐、避免同步 API 阻塞主线程；图片 Blob 经 `assets.ts` 复用同一数据库连接存入（绝不再独立 `indexedDB.open`，否则版本冲突致数据静默丢失）。
- `migrateFromLocalStorage` 在 `initSync` 读取前做**双向「较新者优先」迁移**：首次（IndexedDB 空）搬 `localStorage` 过去；降级回退时（localStorage 更新）反向搬回；迁移后保留旧键便于回退。

### initSync 启动流程（`useSync.ts`）
1. `loadLocal()`：从存储抽象读取 `nexus_matrix_pages_v3`。
2. `fetchRemotePages()`：若配置了同步服务器，拉取 `/api/pages` 全量。
3. `mergePages(local, remote)`：本地优先合并——
   - 以本地页为基准，**远端新增页**直接并入；
   - 同页内的**块级 Last-Write-Wins**（按 `updatedAt`）：远端块较新则 `Object.assign` 覆盖，本地独有块保留，绝不丢页丢块。
4. `sanitizeLoadedPages()`：清洗非法/缺字段（如图片 Blob 引用），保证结构完整。
5. 回写本地，初始化 WebSocket。

### 实时同步协议（WebSocket `/ws/sync`）
| 消息 | 方向 | 说明 |
| --- | --- | --- |
| `INITIAL_SYNC` | 服务端→客户端 | 建连即按 **128KB/帧** 分片推送该 room 的「存活页」（墓碑不发，避免撑大单帧被隧道/移动网丢弃），客户端缓冲收齐后块级合并 |
| `SERVER_BROADCAST` | 服务端→客户端 | 任意端变更后**增量**广播变化的页（不发全量），其余端按同一合并路径并入 |
| `CLIENT_UPDATE` | 客户端→服务端 | 编辑经「首发即推 + 停手 300ms 收尾」防抖后**只上推变化页**，服务端按页 LWW 合并、回 `ACK`（水位 cursor + 采纳页 id）后广播 |

### 同步刷新频率与防漏机制
**同步是推送式（事件驱动），没有定时轮询**——客户端不会周期性地去服务器"拉一遍"，完全依赖 WebSocket 广播。各方向节奏如下：

- **你的编辑 → 服务端：事件驱动 + 首发即推**。`markDirty(id)` 把该页加入脏集合并触发 `debouncedCommit = debounce(commitPages, 300)`（**leading + trailing** 防抖）：首次改动**立即**上推 `CLIENT_UPDATE`（首字符近零延迟，逼近 Notion 的实时感），之后 300ms 内的连续输入合并到尾缘再发一次收尾——一段连续输入整段只在「首发 + 停手」各推一次，且每次仍只推变化的页（指纹未变则不发），不影响冲突模型。
- **他人/其他设备 → 你：实时推送（0 间隔）**。对方一保存，服务端立即 `SERVER_BROADCAST` 增量页，接收方在亚秒级（取决于网络）并入本地，无轮询延迟。
- **本地落盘**：与首发/收尾同一时机写存储抽象（localStorage/IndexedDB），离线也能完整编辑。
- **4s 本地对账（兜底网）**：`setInterval(reconcile, 4000)` 每 4 秒只检查**当前激活页**是否漏标脏（指纹 ≠ 上次提交戳且未显式标脏时补一次提交），**隐藏标签页跳过**。它是防漏网的保险，不是主同步路径；确认显式标脏已覆盖全部路径后可整体移除。
- **断线补偿**：
  - 离线期间本地最新快照压入 `outboxPages`；`onopen` 重连成功后 `pushAll` 一次性补发，对齐其他端（避免「切后台编辑→杀进程→重连丢改」）。
  - 增量水位游标 `lastSyncCursor`（持久化到 kv）用于 `fetchRemotePages(since)` 只拉错过的变更，重连后无需整表回退。
  - `INITIAL_SYNC` 分片 25s 看门狗：隧道/移动网丢帧收不齐时，丢弃并降级为 REST 全量拉取（`fallbackInitialPull`）。
- **断线重连退避**：指数退避，上限 15s，最多 5 次；超过后转入「纯本地模式」（同步状态提示可手动重试），不再空刷后端。
- **图片资产**：页面 JSON 只存 `asset:<id>` 引用，二进制 Blob 走独立 `POST /api/assets`，用到时经 `warmAssets` 懒加载，不进 WS 同步载荷（避免 Base64 把单帧撑到 MB 级）。

> 实践含义：WS 一长连不断，多端即近实时一致；一旦 WS 断，该端仅本地可用，期间看不到他人新改，但改动不会丢（靠 outbox + 游标在重连后补齐）。

### 删除与恢复（墓碑机制）
- 页面/块删除采用**软删除**：打 `deletedAt` 时间戳而非物理删除，便于跨端合并与恢复。
- 恢复时必须显式传 `deletedAt: null`；`{...old, ...incoming}` 合并无法清除旧字段，这点务必注意（曾导致恢复后仍处于删除态）。

---

## 编辑器块类型（Block Types）

| 类型 | 说明 | 触发方式 |
| --- | --- | --- |
| `text` | 普通文本段落 | 默认 / `/text` |
| `h1` / `h2` / `h3` | 一级/二级/三级标题 | `# `、`## `、`### ` 或 `/h1` |
| `todo` | 待办事项（复选框） | `[] ` 或 `/todo` |
| `bullet` | 无序列表（点状） | `- `、`* ` 或 `/bullet` |
| `numbered` | 编号列表（自动编号） | `1. ` 或 `/numbered` |
| `toggle` | 折叠列表（可折叠其后子内容） | `> ` 或 `/toggle` |
| `quote` | 引用块（高亮竖线） | `" ` 或 `/quote` |
| `callout` | 标注块（带图标提示框） | `/callout` |
| `divider` | 分割线 | `--- ` 或 `/divider` |
| `image` | 图片媒体（上传/拖拽解析） | `/image` |
| `codeblock` | 多语言代码块（JS/Python/Vue/Rust） | `/code` |
| `kanban` | 可视化看板数据库 | `/kanban` |

> 注：Markdown 行首快捷输入支持 `# `、`## `、`### `、`- `、`* `、`1. `、`[] `、`" `、`> `、`--- `。
> 行内 Markdown 在键入时即时转换为富文本：`**粗体**`、`*斜体*`、`` `行内代码` ``、`~~删除线~~`。

---

## API 端点

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/` | 健康检查（返回协议状态） |
| GET | `/api/pages` | 获取所有页面 |
| GET | `/api/pages/{id}` | 获取单个页面 |
| POST | `/api/pages` | 创建页面 |
| PUT | `/api/pages/{id}` | 更新页面 |
| DELETE | `/api/pages/{id}` | 删除页面 |
| WS | `/ws/sync` | WebSocket 实时同步（连接即 `INITIAL_SYNC`，变更后 `SERVER_BROADCAST`） |

---

## 启动方式

### 方式一：一键启动（推荐，Windows PowerShell）

在项目根目录执行：

```powershell
.\start.ps1
```

脚本自动完成：检查 Python → 创建/激活 `venv` 并安装后端依赖 → 安装前端依赖 → 启动后端（默认 `8010`）→ 启动前端（默认 `5180`）。启动后访问 **http://localhost:5180**。

端口可在项目根目录 `.env` 中配置（`BACKEND_PORT` / `FRONTEND_PORT`）。

### 方式二：手动启动

**后端**

```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
python main.py
```

后端地址：http://localhost:8010

**前端（新开终端）**

```powershell
cd frontend
yarn install
yarn dev
```

前端地址：http://localhost:5180（`vite.config.ts` 已配置 `/api`、`/ws` 代理到后端）

### 方式三：Android App（原生壳 + WebView 编辑器）

阶段 1 已完成原生壳（Kotlin + Jetpack Compose，Capacitor 8 容器，最低 Android 8.0 / API 26）。
架构与 Notion 移动端同款：原生 Compose 外壳（底部 Tab：文档 / 收藏 / 设置）+ WebView 编辑器
（加载本仓库 Vue 前端产物，`https://localhost` scheme 本地打包，离线可用）。

```powershell
cd frontend
npm install                    # 首次（含 @capacitor/* 依赖）
npm run android:build          # 构建 dist 并同步进 android 工程
cd android
.\gradlew.bat assembleDebug    # 产出 app-debug.apk
```

- 需要 JDK 21 + Android SDK 36（Android Studio Ladybug+ 自带 JBR 21）。
- **全新克隆后必须先跑 `npm run android:build`**：`capacitor-cordova-android-plugins/` 与
  Web 产物目录均被 gitignore，不跑 sync 直接 assemble 会报工程缺失。
- 后端地址不写死在产物里：App「设置」Tab 输入 `http://<局域网IP>:8010` 即注入 WebView
  （URL query `?syncServer=`，优先级高于构建期 env）；留空 = 纯本地模式。
- 真机验收清单见 `ANDROID_VERIFICATION.md`（冷启动 / 存储持久化 / 离线恢复 / cleartext / 软键盘）。
- 方案与阶段规划见 `STAGE1_ANDROID_PLAN.md`、`NATIVE_ANDROID_INTEGRATION.md`。

---

## 近期升级调整与已知问题修复

### 架构与持久化升级
- **后端落盘 SQLite**：由内存 `pages_db` 改为 `nexus.db`（SQLite），重启不丢数据；用全局锁序列化所有读写，规避 FastAPI 线程池（REST）与 WebSocket 事件循环并发访问 SQLite 的报错。
- **前端存储抽象 + IndexedDB**：新增 `composables/storage.ts` 统一 Promise 接口（默认 `localStorage`），可切换 `idbStore.ts`（IndexedDB）突破 5 MiB 配额与 LRU 驱逐；图片 Blob 经 `assets.ts` 复用同一连接。`migrateFromLocalStorage` 做 localStorage ↔ IndexedDB 双向「较新者优先」迁移。
- **LocalFirst 同步层 `useSync.ts`**：封装 `initSync / fetchRemotePages / loadLocal / saveLocal / mergePages / sanitizeLoadedPages` 与 WebSocket 收发；`App.vue` 直接挂载已集成该层的 `NexusTaskMatrix1.vue`。

### 已修复的关键 Bug（记入此，避免重犯）
| 现象 | 根因 | 修复 |
| --- | --- | --- |
| 切换页签时文档内容偶发消失，刷新恢复 | ① 同时起了多个后端实例，REST 与 WS 被分发到不同进程的内存 `pages_db`，前端收到陈旧广播覆盖本地；② contenteditable 在 DOM 复用/切换时依赖 watch 的 `nextTick` 回填 `innerHTML`，时机竞态导致块为空（只剩占位符） | ① 运行期确保**只有一个后端进程**监听 8010；② `setInputRef` 在元素挂载/复用时**立即确定性回填** `task.content` 到 `innerHTML` |
| 侧边栏只显示部分根页 | `getChildren(null)` 用 `p.parentId === null` 严格判等，后端缺省 `parentId` 字段解析为 `undefined` 被排除 | 改为宽松 `!p.parentId` 假值判断 |
| PUT 更新返回 500 | 同步 REST 端点在 worker 线程执行，`asyncio.get_event_loop()` 抛 `RuntimeError` 未捕获 | `_schedule_broadcast` 无可用 loop 时安全跳过（数据已落 SQLite，`INITIAL_SYNC` 会补发） |
| 墓碑页（已删除）恢复后 `deletedAt` 仍在 | `{**p, **incoming}` 合并无法清旧字段 | 恢复时显式传 `deletedAt: null` 覆盖 |
| 存储写入失败用户无感知 | 失败只打 console，用户以为已保存 | `App.vue` 新增红色告警横幅（`storageError`），并提供「立即导出」兜底 |
| 多标签页/多端同步互相覆盖 | 多实例后端各自内存不一致 | 同「切换页签消失」①，单实例后消除 |

### 运行须知
- **禁止同时启动多个 `py main.py`**：多实例共享同一 `nexus.db` 但内存 `pages_db` 不共享，REST 写入进程 A、WS 广播进程 B 的旧内存会覆盖前端正确数据，表现为内容偶尔消失。排查：`netstat -ano \| findstr :8010` 应只有一个 LISTEN。
- 指定后端地址：Web「设置」面板填写，或 URL 加 `?syncServer=http://<IP>:8010`，留空即纯本地模式。

---

## 数据备份与恢复（本机）

后端为**单文件 SQLite**（`backend/nexus.db`，WAL 模式），数据库里 `users` / `memberships` / `pages` / `assets` 共同决定「Google 账号 ↔ workspace ↔ 笔记」的映射关系，因此备份必须把它们与鉴权凭据一起打包。

| 脚本 | 职责 |
|---|---|
| `backend/backup.sh` | 生成 **WAL 安全的一致性快照**（`sqlite3 .backup`，**绝不能裸 `cp nexus.db`**，会丢 WAL 中未 checkpoint 的数据）；打包「四件套」写 `manifest.json`（sha256 + `integrity_check` + 源库/快照统计对比 + `restore_map`）；清理过期包 |
| `backend/restore_drill.sh` | 恢复演练：解压到临时目录 → 校验 sha256 / `integrity_check` / 账号映射完整性 → **起临时后端实例**连副本实测 `/api/health`，全程不碰真实库 |
| `backend/backup_scheduler.sh` | 定时守护：默认每 12h 备份一次，保留 15 天 |

**四件套（缺一不可）**：`nexus.db`、`backend/jwt_secret`（JWT 与 SessionMiddleware 密钥，丢了所有登录态失效）、根目录 `.env`（OAuth / API Key 配置）、`backend/keys.json`（若启用）。压缩包权限 `600`，内含密钥。

```bash
cd backend
./backup.sh --now                       # 立即备份一次
./backup.sh --list                      # 列出备份
./backup.sh --install                   # 安装定时（每 12h）+ 登录自启
./backup.sh --uninstall                 # 卸载定时
./backup_scheduler.sh --status          # 查看守护状态
./restore_drill.sh                      # 演练最新备份
./restore_drill.sh <备份包路径>          # 演练指定备份
```

备份产物在 `backend/backups/`，`LATEST` 指向最新包。可调环境变量：`BACKUP_RETENTION_DAYS`（默认 15）、`BACKUP_INTERVAL_SECONDS`（默认 43200）、`BACKUP_NO_COMPRESS=1`（大数据量时跳过 gzip）、`DB_PATH` / `BACKUP_DIR`。

> **为什么不用 launchd（macOS）**：本项目位于可移除卷 `/Volumes/4TSATADisk`，macOS TCC 会拒绝 launchd 派生的后台进程读写该卷（实测连 `.env`、`nexus.db` 都返回 `Operation not permitted`，任务退出码 78），但终端会话启动的进程正常。因此改用「由终端启动的常驻守护 + `~/.zprofile` 登录自启」。
> 若要恢复使用 launchd，需二选一：① 在「系统设置 → 隐私与安全性 → 完全磁盘访问」中为对应可执行文件授权；② 把 `nexus.db` 与备份目录迁到内置盘（设 `DB_PATH` 指向 `~/Library/Application Support/...`）。

**真实恢复 SOP**：停后端 `pkill -f 'main.py'` → 解压备份、按 `manifest.restore_map` 放回四件套 → **删除残留的 `nexus.db-wal` / `nexus.db-shm`**（否则旧 WAL 会覆盖恢复后的库）→ `./start_backend.sh` → 用 Google 账号登录确认 workspace 列表与笔记数量。

**已知边界**：当前备份落在外置卷**同一块盘**上，只防误删/误改，不防磁盘或机器损毁；异地容灾（加密后上传对象存储）尚未接入。迁入 171MB 附件后实测：单次快照约 348MB、压缩包约 337MB、耗时约 10s；按每 12h 一次保留 15 天（约 30 份）约需 10GB。可设 `BACKUP_NO_COMPRESS=1` 减少 CPU 开销（图片类附件本身压缩率很低）。

## 公网暴露与访问鉴权

将后端经隧道 / 反向代理暴露到公网或上云时，**务必启用共享密钥鉴权**，否则任何能连上的人都能读写你的 `nexus.db`。

- 后端：环境变量 `NEXUS_API_KEY=<密钥>` 即开启强制校验；**未设置则完全开放**（纯本地 / 局域网向后兼容）。REST 经全局依赖校验，WebSocket 在握手阶段校验。
- 客户端携带方式：REST → `Authorization: Bearer <key>` 或 `?api_key=<key>`；WebSocket → 握手 query `?api_key=<key>`（浏览器 WebSocket 无法自定义 header）。
- 前端配置：「设置」面板「访问密钥」输入框，或 URL 加 `?apiKey=<key>`；构建期可用 `VITE_API_KEY` 注入。空密钥即开放模式。
- 建议：配合 Cloudflare Access / Tailscale 做二次访问控制；公网务必用 wss/https（TLS）避免明文传输文档。

## 公网部署（Cloudflare Tunnel 快速路径）

不想租 VPS、家里有一台**常开机**机器时，用 Cloudflare Tunnel 把 `localhost:8010` 暴露成公网 `https://你的域名`——**无需公网 IP、端口转发、TLS 证书**（由 Cloudflare 边缘自动签发/续期）。完整版（含 VPS + Caddy 方案）见 `PUBLIC_DEPLOYMENT.md`。

**前置**：后端按上文「启动方式」跑起来，并设置 `NEXUS_API_KEY`（公网必须鉴权）；前端用 `STATIC_DIR` 同源托管（`yarn build` 后指向 `frontend/dist`），这样只暴露一个源、`wss` 自动生效。

```bash
# 1) 装 cloudflared
brew install cloudflare/cloudflare/cloudflared   # macOS
# sudo apt install cloudflared                    # Debian/Ubuntu
# winget install Cloudflare.cloudflared           # Windows

# 2) 零配置临时域名，先验证整条链路（每次重启变化，仅用于验证）
cloudflared tunnel --url http://localhost:8010
# 终端打印 https://<随机>.trycloudflare.com → 浏览器打开应看到同源前端；
# 再访问 https://<随机>.trycloudflare.com/api/pages 应返回 JSON。

# 3) 绑固定域名（稳定使用）
cloudflared tunnel login
cloudflared tunnel create nexus
# 写 ~/.cloudflared/config.yml（参考仓库 backend/tunnel-example-config.yml）
cloudflared tunnel route dns nexus nexus.example.com
cloudflared service install && sudo systemctl start cloudflared
```

配置文件 `~/.cloudflared/config.yml`：

```yaml
tunnel: nexus
credentials-file: ~/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: nexus.example.com
    service: http://localhost:8010   # 后端已同源托管前端，/api、/ws、静态都走这一个源
  - service: http_status:404
```

> 临时子域每次重启都变、且可能限速，仅用于验证；长期用第 3 步绑固定域名。机器断网/睡眠 = 服务不可达，务必保证常开 + 禁止睡眠。

### 一键部署脚本（macOS / Linux）

仓库提供了两个封装脚本，**用途完全不同，别混用**：

| 脚本 | 隧道类型 | 公网地址 | `.env` 是否每次重写 | 适用场景 |
|---|---|---|---|---|
| `deploy_cloudflare.sh` | 快速隧道（临时 `*.trycloudflare.com`） | 每次重启都变 | **是**（自动写 `OAUTH_REDIRECT_BASE` / `CORS_ORIGINS` 并重启后端） | **临时公网测试 / 验证链路** |
| `run_tunnel.sh` | 命名隧道（固定域名，如 `nexus.sunbcy.homes`） | 永久不变 | **仅首次/值变化时才写**（幂等，重启隧道不会动 `.env`） | **稳定长期使用** |

#### `deploy_cloudflare.sh` —— 快速隧道（临时公网测试用）

零配置临时域名，用来快速验证「整库同步 + 跨设备实时」是否跑通。**注意：地址每次重启都会变，且可能限速，仅限临时测试，不要作为长期方案。**

```bash
./deploy_cloudflare.sh            # 装 cloudflared（首次）→ 起后端 → 起快速隧道 → 自动把新地址写进 .env → 重启后端
./deploy_cloudflare.sh --stop    # 停止隧道与后端
```

脚本会自动把每次生成的新 `https://<随机>.trycloudflare.com` 写回 `.env` 的 `OAUTH_REDIRECT_BASE` 与 `CORS_ORIGINS`，并打印需在 Google Cloud Console 添加的「已获授权的重定向 URI」。**因为地址会变，每次重跑都要去控制台同步更新那条重定向 URI。**

#### `run_tunnel.sh` —— 固定域名隧道（稳定生产用，Token 模式）

走 Cloudflare **命名隧道 + 自有域名**，地址永久固定（`nexus.sunbcy.homes`），重启不再变，因此 `.env` 只需配一次。采用 **Token 模式**，绕开 `cloudflared tunnel login` 的浏览器回调解密（某些网络下本机访问 `login.cloudflareaccess.org` 会超时）。

**前置（在 Cloudflare / 阿里云控制台完成）：**
1. 域名加入 Cloudflare，NS 指向 Cloudflare（阿里云把域名的 DNS 服务器改成 Cloudflare 给的两个 `*.ns.cloudflare.com`）；
2. 完成阿里云**实名认证 / 邮箱验证**解除 `serverHold`（否则域名不解析）；
3. Cloudflare Zero Trust → **Networks → Tunnels → Create a tunnel** → 选 Cloudflared，命名 `nexus`，Public Hostname 配 `nexus.<你的域名> → http://localhost:8010`，复制给出的 `--token` 值。

```bash
# Token 写法二选一：
mkdir -p ~/.cloudflared
# 把控制台给的 --token 后面那段粘进 tunnel_token.txt
vim ~/.cloudflared/tunnel_token.txt
# 或：CLOUDFLARE_TUNNEL_TOKEN='eyJhbG...' ./run_tunnel.sh

TUNNEL_HOSTNAME=nexus.sunbcy.homes ./run_tunnel.sh   # 默认子域名即 nexus.sunbcy.homes
./run_tunnel.sh --stop                                # 停止隧道与后端
```

脚本行为（适配固定域名场景）：只有 `.env` 里 `OAUTH_REDIRECT_BASE` / `CORS_ORIGINS` **缺失或与当前域名不一致时才改写并重启后端**；地址不变时重启隧道只会提示「无需改动」，不会无谓弹后端。

> 切换固定域名后，`.env` 里若仍是旧的快速隧道地址，首次跑 `run_tunnel.sh` 会触发一次改写 + 后端重启，之后稳定不变。

### Google 登录（OAuth）注意事项

「用 Google 登录」的回调地址必须是 **HTTPS 且不能是裸 IP**，因此必须经 Cloudflare（或自有域名）拿到对外 HTTPS 地址：

- 在 **Google Cloud Console** 把 `https://你的域名/api/auth/oauth/google/callback` 注册为回调（OAuth 同意屏幕把你的账号加进「测试用户」）；
- 后端设置：
  ```bash
  OAUTH_GOOGLE_ID=<Client ID>
  OAUTH_GOOGLE_SECRET=<Client Secret>
  # 经 Tunnel / 反代时必填：后端看到的是 http://localhost，必须用公网 base 覆盖
  OAUTH_REDIRECT_BASE=https://nexus.example.com
  ```
  三项齐全后 `/api/auth/config` 返回 `{"google_oauth":true}`，「用 Google 登录」按钮即生效。
- 开发期不想配 Google 时，设 `NEXUS_DEV_LOGIN=1` 启用免密 `/api/auth/dev-login`（**生产务必关掉**，否则任何人可免密登录）。

> **退出 / 重新登录**：App 里的「退出登录」只清除本地的 JWT（`localStorage`），**不会**注销 Google 本身的会话。再点「用 Google 登录」时，后端已加 `prompt=select_account`，会弹出账户选择器让你重新选择/切换账号；若仍想强制换号，可在无痕窗口登录，或在 Google 官网先退出 Google 账号。

---

### 管理面板（性能 / 用量 / 异常）

后端自带轻量可观测与运维面板，便于一眼看清服务状态：

- 在 `.env` 设置 **`ADMIN_TOKEN`** 后，访问 `https://你的域名/admin?token=<ADMIN_TOKEN>` 打开面板；`/api/admin/dashboard` 返回同样结构的 JSON（供外部监控拉取）。未设置则面板禁用（返回 503），`?token=` 错误或缺失返回 401。
- 面板展示：**数据库连通性**、后端/版本/运行时长、**在线房间与 WS 连接数**、**用量统计**（注册用户 / 工作区 / 页面 / 资产数 / 资产存储量 / 成员关系 / 邀请链接）、**性能指标**（累计请求、错误、错误率、同步冲突、资产上传、登录成败、慢请求 ≥1s、WS 消息）、**异常**（慢请求 TopN、最近错误）。
- 指标为**进程内计数器**（重启清零）；多实例需外部聚合。所有计数已在 `/api/metrics` 以 Prometheus 文本格式导出，接 Prometheus + Grafana 即可做持久化图表与告警。
- 面板**仅展示聚合计数与运行指标，不含任何用户内容**，适合运维自查。要做内容安审（违规图片 / 泄密检测）属于另一层，需在资产写入路径接入哈希/分类管线（见上文合规讨论）。

> 安全提示：`ADMIN_TOKEN` 等同于运维权限，生产务必用强随机值（如 `python -c "import secrets;print(secrets.token_urlsafe(32))"`），并配合反向代理限制 `/admin` 与 `/api/admin/*` 仅内网/监控网可达。

---

## 说明与后续方向

- 后端已落地 **SQLite 持久化**（`nexus.db`，全局锁防并发），重启不丢数据；如需水平扩展再考虑 Postgres。
- 实时同步为 **LocalFirst + 全量广播** 模型（合并采用最后写入者胜出 + 块级 LWW），后续可演进为增量 diff / CRDT 冲突合并。
- 前端存储为统一 **抽象层**：Web 默认 `localStorage`，已支持切换 `IndexedDB`；Android/iOS 可替换为 Capacitor Preferences / Tauri store。
- `NotionPlus.vue` 为早期后端对接参考实现，功能已被 `NexusTaskMatrix1.vue` + `useSync.ts` 覆盖，可逐步退役。
