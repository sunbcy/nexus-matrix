# Phase 5：`pages` 表 / 遗留同步路径下线计划

> 状态：**暂缓执行**。当前 Phase 5 已交付「富文本片段纳入快照恢复」+「导入/导出」（均已验证），
> 但 `pages` 表及其后端路径**暂不下线**——因为生产编辑器仍 100% 依赖它。
> 本文档是后续「编辑器迁 Yjs → 拆后端」专项的精准待办，按此执行即可。

---

## 0. 为什么现在不能删

生产编辑器 `frontend/src/components/NexusTaskMatrix1.vue`（约 1789 行）**完全跑在遗留路径上**：

- 从 `useSync` import 全部同步逻辑（`initSync` / `createRemotePage` / `writePrevIds` / `writePagePrevIds` / `updateRemotePage` / `markDirty` …），**不 import `yjsDoc`**。
- 持久化与远端广播由 `useSync` 内部 watch 统一处理（块级 `prevId` 链 + LWW 合并）。
- 它打的后端是 `/ws/sync` + `/api/pages` + `prevId` LWW 合并。

**任何后端 `pages` 表 / 路由 / WebSocket 的删除都会立即让生产编辑器无法加载/保存/多端同步。**
唯一已干净隔离的是 `backend/yjs_server.py`（`/ws/yjs`，自建 `ydocs.db`，不碰 `pages`），可保留。

> 硬约束：**在 `NexusTaskMatrix1.vue` 完全迁到 `yjsDoc`（`/ws/yjs` 且 `useSync` 移除前，禁止删后端 pages 相关代码。**

---

## 1. 当前遗留路径清单（拆除前必读）

### 1.1 后端 `backend/db.py`（双存储实现）

| 位置 | 内容 |
|---|---|
| `db.py:189-193` / `629-636` | SQLite / Postgres 的 `_CREATE_PAGES` 建表语句 |
| `db.py:231` / `679` | `(_sync_init` / `init`) 建 pages 表 |
| `db.py:239-298` / `687-700` | `_sync_migrate` / `_migrate` 中 pages 相关（room 列、复合主键重建） |
| `db.py:300-322` / `715-738` | `_sync_load/save/delete_page` / `load_pages`/`save_page`/`delete_page` |
| `db.py:599` / `894,904` | `get_stats` 里的 `pages_total` 统计 |

接口在 `Database` 抽象基类 `db.py:73-82`（`load_pages`/`save_page`/`delete_page`），两套实现都实现它。

### 1.2 后端 `backend/main.py`（路由 + LWW 合并）

| 位置 | 内容 |
|---|---|
| `main.py:719-737` | `GET /api/pages`（增量 `since` / 全量，依赖 `load_pages` + `_water_mark`） |
| `main.py:741-746` | `GET /api/pages/{page_id}` |
| `main.py:750-764` | `POST /api/pages`（create，`_persist_page` + `_broadcast_room`） |
| `main.py:768-781` | `PUT /api/pages/{page_id}`（update） |
| `main.py:785-795` | `DELETE /api/pages/{page_id}`（墓碑） |
| `main.py:704-714` | `/api/me` 的 `page_count` |
| `main.py:480-488` | `_broadcast_room`（`SERVER_BROADCAST`，依赖 pages） |
| `main.py:929-1036` | **`/ws/sync`** 实时同步 WebSocket（依赖 `load_pages`/`_merge_pages`/`_heal_prev_id_chain`/`_changed_pages`/`_persist_page`/`manager.broadcast`） |
| `main.py:869-898` | `/api/assets/integrity` + `/api/assets/gc`（靠 `_collect_asset_ids` 扫 pages 找资产引用） |
| `main.py:904-922` | `/api/admin/gc`（pages 墓碑 GC） |
| `main.py:561,527` | `/api/admin/dashboard` + `/api/metrics`（经 `get_stats` → `pages_total`） |

LWW / 自愈辅助函数（同文件，服务于 pages 路径，移除时可一并删）：
`_ts_of` (210) · `_water_mark` (223) · `_persist_page` (238) · `_page_fingerprint` (244) ·
`_changed_pages` (253) · `_heal_prev_id_chain` (271) · `_heal_chain` (291) ·
`PAGE_SCALAR_FIELDS` (318) · `_merge_pages` (321-429，注释明写「语义对齐前端 `mergePages`」) ·
`_scalar_lww` / `_tasks_lww` (336/346)。

### 1.3 前端遗留耦合

- `composables/useSync.ts`：`WS_PATH='/ws/sync'` (356)、`fetchRemotePages` (639)、`pushAll` (684)、
  `createRemotePage`/`deleteRemotePage`/`updateRemotePage` (706-722)、`initSync` (1290)；
  `prevId` 链 (`writePrevIds` 53 / `writePagePrevIds` 166 / `orderTasks` 64)、
  模块私有 `mergePages` (106，调用点 669/849/1321)。
- `components/NexusTaskMatrix1.vue`：全程依赖 `useSync` + `prevId`（数据结构、批量操作后重写页面链、拖拽排序、粘贴/插入块等），**不 import `yjsDoc`**。
- `composables/importMerge.ts`：仅 `import type {Page,Task}` (1) + 重建 `prevId` 链 (254-256)。
- `composables/zipImport.ts`：`import type {Page}` (13) + 导入时重建 `prevId` 链 (297-300)。
- `components/SettingsPanel.vue`：从 `useSync` import 备份/同步状态 (32)，并挂载 `YjsPilot` (35,618)。

### 1.4 运维脚本

- `backend/backup.sh`：`pages` 统计/断言（行 19、123、162、169-171、210-211）。
- `backend/restore_drill.sh`：`pages` 断言（行 110、125、130）。
- `backend/alert.rules.yml`：行 59「后端无法读写 pages / assets，同步中断」告警文案。

> 注：存在 `*.js` / `*.vue.js` 影子文件（Volar 类型检查产物），**不是独立逻辑**，改动后重跑 TS 检查即可，勿当重复代码改。

---

## 2. 切割顺序（务必按序）

### 步骤 A — 前端编辑器迁移（最大风险项，先于此才动后端）

1. 把 `NexusTaskMatrix1.vue` 从 `useSync`（`/ws/sync` + `/api/pages` + `prevId` LWW）迁移到 `yjsDoc`（`/ws/yjs` + `Y.Array`/`Y.XmlFragment`）。
2. 同步移除 `importMerge.ts` / `zipImport.ts` 里的 `prevId` 重建逻辑（改为 Yjs 结构）。
3. `SettingsPanel.vue` 仅保留 `YjsPilot` 挂载，不再 import `useSync` 同步状态（或保留只读备份状态以其它方式提供）。
4. 迁移后必须经充分 QA（多端实时、刷新恢复、导入导出、快照），确认生产编辑器完全不依赖 `/ws/sync` 与 `pages`。

### 步骤 B — 后端退役（仅步骤 A 验证通过后执行）

| # | 文件 | 改动 |
|---|---|---|
| B1 | `main.py` | 删 5 个 `/api/pages` 路由 (719-795) |
| B2 | `main.py` | 删 `/ws/sync` 实时同步 (929-1036) |
| B3 | `main.py` | 删 `_broadcast_room` 的 pages 广播分支 (480-488)；移除 LWW 辅助：`_ts_of`/`_water_mark`/`_persist_page`/`_page_fingerprint`/`_changed_pages`/`_heal_prev_id_chain`/`_heal_chain`/`PAGE_SCALAR_FIELDS`/`_merge_pages`/`_scalar_lww`/`_tasks_lww` |
| B4 | `main.py` | 改写 `/api/assets/integrity` + `/api/assets/gc`：当前靠 `_collect_asset_ids` 扫 pages 找引用，需改为基于 Yjs 文档 / assets 表（**资产与 pages 共生，删前必须解决**） |
| B5 | `main.py` | `/api/admin/gc` 去除 pages 墓碑逻辑；`/api/me`、`/api/admin/dashboard`、`/api/metrics` 去除 `page_count` / `pages_total` |
| B6 | `db.py` | 删 SQLite/Postgres 两后端的 `_CREATE_PAGES`/`_CREATE_INDEX`、`load_pages`/`save_page`/`delete_page`、`_sync_migrate`/`_migrate` 中 pages 部分、`get_stats` 的 `pages_total`；同步从 `Database` 基类 (73-82) 移除抽象方法 |
| B7 | 运维 | `backup.sh`/`restore_drill.sh` 去 `pages` 断言；`alert.rules.yml` 去 pages 告警文案 |

### 步骤 C — 验证与回滚

- 全链路：多端实时协同、刷新恢复、快照/导入导出、资产完整性扫描均通过。
- 数据库：SQLite + Postgres 两套都验证（pages 定义在两处，stats 的 `pages_total` 也分别存在）。
- 灰度：建议先保留 `/ws/sync` 与 `/api/pages` 路由一个版本（或加 `YJS_RETIRE_PAGES` 开关），确认无客户端再依赖后再物理删除。
- 回滚预案：保留迁移前 `db.py` / `main.py` 快照与数据库备份（`backup.sh`），异常即回退。

---

## 3. 高风险点（执行时重点评估）

1. **编辑器单点耦合**：`NexusTaskMatrix1.vue` 无 Yjs 回退，迁移失败 = 直接停服。务必先小流量 / 影子验证。
2. **资产与 pages 共生**：资产内容在 `assets` 表，但「谁引用哪个资产」的真相源是 pages（`_collect_asset_ids`）。删 pages 前必须先把引用关系迁入 Yjs 或独立索引，否则完整性扫描 / 孤儿 GC 失效。
3. **实时广播通道**：`SERVER_BROADCAST`/`DEVICE_COUNT` 依赖 `/ws/sync` + `ConnectionManager`；Yjs 走自己的 Provider/awareness。切 `/ws/yjs` 前不要拆 `/ws/sync`。
4. **双存储**：pages 定义与迁移在 SQLite + Postgres 两处；stats 的 `pages_total` 也分别在 `db.py:599` 与 `db.py:894/904`，两处都要改。

---

## 4. 当前 Phase 5 已交付（与本文档解耦）

- ✅ 富文本片段（`Y.XmlFragment('tiptap')`）纳入快照恢复（`yjsDoc.ts` 调 Tiptap 层注册的还原钩子，已 tsx 集成测试验证）。
- ✅ 文档级导入 / 导出（`yExportDoc` / `yImportDoc`，Yjs 二进制 update，已接 `YjsPilot.vue` 顶栏）。
- ⏸ `pages` 表下线：按本计划暂缓，待步骤 A 编辑器迁移专项完成后再执行 B/C。
