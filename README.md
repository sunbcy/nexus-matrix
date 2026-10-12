# NEXUS MATRIX

一个支持 **LocalFirst（本地优先）** 的全平台**工业风区块编辑器 / 知识矩阵**。以 Notion 式块（Block）编辑为核心，具备树状页面空间、多媒体块、可视化看板、Slash 命令菜单以及跨端实时同步能力，整体采用深色科幻（Cyberpunk / Industrial）UI 风格。

---

## 核心特性

- **区块编辑器（Block Editor）**：每一行即一个「块」，支持文本、标题（H1/H2/H3）、待办、无序列表、引用、图片、代码块、看板等多种类型。
- **LocalFirst 持久化**：编辑内容优先写入浏览器 `localStorage`（键 `nexus_matrix_pages_v3`），刷新/断网数据不丢失，无需服务器即可使用。
- **Slash 命令与 Markdown 快捷输入**：行首输入 `/` 唤出命令菜单；支持 `# `、`## `、`### `、`- `、`[] `、`" `、`/code`、`/kanban` 等快捷转换。
- **树状页面空间（Sidebar）**：支持无限层级的子页面、展开/折叠、收藏夹、面包屑导航，URL Hash 路由记录当前页面。
- **高级交互引擎**：
  - `Tab` / `Shift+Tab` 行内层级缩进（智能继承上一行缩进，最大不超过父级 +1）。
  - 任意位置 `Enter` 拆行、`Backspace` 行首级联合并。
  - 块级拖拽排序（智能继承目标缩进等级）、跨行 `Shift+方向键` 选区、`Ctrl/⌘+A` 全选。
  - 拖拽手柄 + 操作菜单：复制、删除、转换为任意块类型。
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
| `bullet` | 无序列表（点状） | `- ` 或 `/bullet` |
| `quote` | 引用块（高亮竖线） | `" ` 或 `/quote` |
| `image` | 图片媒体（上传/拖拽解析） | `/image` |
| `codeblock` | 多语言代码块（JS/Python/Vue/Rust） | `/code` |
| `kanban` | 可视化看板数据库 | `/kanban` |

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
