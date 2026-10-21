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
2. **实时同步路径**：后端将页面持久化到 `nexus.db`(SQLite)，REST（`/api/pages`）提供 CRUD，WebSocket（`/ws/sync`）在设备建连时下发 `INITIAL_SYNC`、任何端变更后 `SERVER_BROADCAST` 全量广播；前端编辑经防抖后通过 `CLIENT_UPDATE` 上推。
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
| `INITIAL_SYNC` | 服务端→客户端 | 建连即推送全量 `pages_db` |
| `SERVER_BROADCAST` | 服务端→客户端 | 任意端变更后广播最新全量矩阵 |
| `CLIENT_UPDATE` | 客户端→服务端 | 编辑经防抖（约 500ms）后上推，服务端落 SQLite 后广播 |

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

## 公网暴露与访问鉴权

将后端经隧道 / 反向代理暴露到公网或上云时，**务必启用共享密钥鉴权**，否则任何能连上的人都能读写你的 `nexus.db`。

- 后端：环境变量 `NEXUS_API_KEY=<密钥>` 即开启强制校验；**未设置则完全开放**（纯本地 / 局域网向后兼容）。REST 经全局依赖校验，WebSocket 在握手阶段校验。
- 客户端携带方式：REST → `Authorization: Bearer <key>` 或 `?api_key=<key>`；WebSocket → 握手 query `?api_key=<key>`（浏览器 WebSocket 无法自定义 header）。
- 前端配置：「设置」面板「访问密钥」输入框，或 URL 加 `?apiKey=<key>`；构建期可用 `VITE_API_KEY` 注入。空密钥即开放模式。
- 建议：配合 Cloudflare Access / Tailscale 做二次访问控制；公网务必用 wss/https（TLS）避免明文传输文档。

## 说明与后续方向

- 后端已落地 **SQLite 持久化**（`nexus.db`，全局锁防并发），重启不丢数据；如需水平扩展再考虑 Postgres。
- 实时同步为 **LocalFirst + 全量广播** 模型（合并采用最后写入者胜出 + 块级 LWW），后续可演进为增量 diff / CRDT 冲突合并。
- 前端存储为统一 **抽象层**：Web 默认 `localStorage`，已支持切换 `IndexedDB`；Android/iOS 可替换为 Capacitor Preferences / Tauri store。
- `NotionPlus.vue` 为早期后端对接参考实现，功能已被 `NexusTaskMatrix1.vue` + `useSync.ts` 覆盖，可逐步退役。
