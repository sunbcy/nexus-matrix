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
| 持久化 | 前端：`localStorage`（LocalFirst）；后端：内存矩阵 `pages_db`（演示级临时持久化） |
| 工具链 | PowerShell 一键启动脚本（`start.ps1`）、Yarn 包管理 |

---

## 系统架构

```
┌─────────────────────────────────────────┐
│              前端 (Vue SPA)               │
│  App.vue → NexusTaskMatrix1.vue          │
│  ├─ Sidebar 树状页面空间 / 收藏 / 面包屑   │
│  ├─ 区块编辑器（Block CRUD + 缩进 + 拖拽） │
│  ├─ Slash 命令 / Markdown 快捷 / 富文本    │
│  └─ LocalFirst: localStorage 持久化        │
└───────────────┬─────────────────────────┘
                │  (可选) REST API + WebSocket
                │  /api/pages*   /ws/sync
┌───────────────▼─────────────────────────┐
│        后端 (FastAPI + Uvicorn)           │
│  ├─ REST: 页面 CRUD（内存 pages_db）       │
│  ├─ WebSocket /ws/sync: 连接管理 + 广播    │
│  └─ CORS 放通：支持 Tauri/Capacitor 跨端   │
└─────────────────────────────────────────┘
```

**数据流说明**

1. **本地优先路径（当前默认）**：`NexusTaskMatrix1.vue` 在 `onMounted` 时从 `localStorage` 读取页面矩阵，编辑过程通过 `watch(pages, ...)` 深度监听实时写回 `localStorage`。整条链路不依赖服务器。
2. **后端同步路径**：后端维护一份 `pages_db` 内存矩阵，通过 REST（`/api/pages`）提供 CRUD，通过 WebSocket（`/ws/sync`）做跨设备广播。组件 `NotionPlus.vue` 已实现对 `/api/pages` 的对接（fetch），可作为后端集成版本的参考实现。
3. **当前状态提示**：`App.vue` 默认挂载的是 `NexusTaskMatrix1.vue`（LocalFirst 版）。若需启用后端实时同步，可将 `App.vue` 中的导入切换为 `NotionPlus.vue` 并接入 WebSocket 客户端逻辑。

---

## 目录结构

```
nexus-matrix/
├── start.ps1                 # 一键启动脚本（检查 Python→建 venv→装依赖→起前后端）
├── .env                      # 端口配置（BACKEND_PORT / FRONTEND_PORT）
├── backend/
│   ├── main.py               # FastAPI 应用：REST + WebSocket 同步中继
│   ├── requirements.txt       # fastapi / uvicorn / websockets / pydantic
│   └── venv/                 # Python 虚拟环境（自动生成）
└── frontend/
    ├── index.html
    ├── package.json           # vue / vite / tailwind / typescript
    ├── vite.config.ts         # 端口 + /api、/ws 代理到后端
    ├── tailwind.config.js
    └── src/
        ├── main.ts
        ├── style.css
        ├── App.vue            # 根组件，挂载主编辑器
        ├── assets/
        └── components/
            ├── NexusTaskMatrix1.vue  # 当前启用的 LocalFirst 区块编辑器
            ├── NotionPlus.vue        # 对接后端 REST API 的版本（参考实现）
            ├── NexusTaskMatrix.vue   # 早期版本
            └── HelloWorld.vue        # 脚手架示例组件
```

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

---

## 说明与后续方向

- 后端 `pages_db` 为内存级存储，重启即重置，生产化需接入数据库（如 SQLite/Postgres）。
- 实时同步目前为「全量广播」模型，后续可演进为增量 diff / CRDT 冲突合并。
- 前端 LocalFirst 版与后端集成版（`NotionPlus.vue`）目前并存，建议统一为一种持久化策略并补全 WebSocket 客户端。
