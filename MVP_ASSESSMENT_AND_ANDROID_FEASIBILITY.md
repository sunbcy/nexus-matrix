# 平台评估：MVP 判定、Android 可行性与实时同步卡点

> 评估日期：2026-10-15。代码规模、功能清单均为实测（代码库扫描），
> Android / CRDT / 同步方案的外部结论来自官方一手来源并已标注出处。

---

## 结论摘要

**问：算不算 MVP？** 算，但要限定范围。**它是「个人知识管理」的合格 MVP，不是「协作工作区」的 MVP。** Notion 的核心价值由数据库、协作、搜索三者构成，我们三者全无。单机/多端异步的个人笔记场景，当前完成度已经够用甚至略超（有导入导出、图标封面、撤销、跨块选区）。

**问：新开 Android 原生项目可行吗？** 技术上可行，但**强烈不建议**——真正的卡点不在原生 vs WebView，而在数据层与同步，这些在 Web 端解决能同时惠及三端。若要移动化，复用现有 Vue 前端走 Capacitor 8 是成本最低的路径（约 5–8 人天），但**必须先解决数据层**，否则在 Android 上会真实丢数据（见第五节卡点 5）。

**问：实时同步有什么卡点？** 有 8 个，其中 3 个是根本性的：`content` 是字符串而非 CRDT、后端整页覆盖、本地优先策略主动丢弃远端。还有一个容易被忽略的**数据丢失级**风险：Android WebView 的 localStorage 只有 5 MiB 且会在存储压力下**整 origin 全量删除**。

**问：还有什么待改进？** 最该先做的四件：存储层现代化、图片独立存储、全局搜索（目前完全没有）、删除 1761 行死代码。另外**零自动化测试**是这一阶段最需要补的工程短板。

---

## 一、当前平台能力盘点

### 代码规模（实测）

| 项目 | 数值 |
| --- | --- |
| 源码总行数 | 6666 行（23 个文件） |
| 主编辑器 `NexusTaskMatrix1.vue` | 2333 行 |
| 同步层 `useSync.ts` | 537 行 |
| 后端 `main.py` | 222 行（FastAPI + SQLite + WS 广播） |
| 运行时依赖 | 仅 2 个（vue、fflate） |
| **死代码** | **1761 行（占 26%）** |

死代码明细：`NotionPlus.vue` 1109 行、`NexusTaskMatrix.vue` 556 行、`HelloWorld.vue` 96 行，三者均未挂载。这 26% 不产生功能，只增加认知负担，建议直接删除。

### 已实现 vs Notion Web

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 块类型 | 13 种 | text/h1-h3/quote/todo/bullet/numbered/toggle/callout/divider/image/codeblock/kanban |
| 行内格式 | 齐全 | 粗斜下划线、删除线、行内代码、高亮、颜色、链接、页面链接 |
| 键盘交互 | 接近 Notion | 标题↔正文流转、Shift+Enter、escape hatch、Cmd+B/I/U/E、块选择态、IME 守卫 |
| 跨块选区 | 自研 | 逻辑选区引擎（浏览器跨 contenteditable 不可靠） |
| 撤销重做 | 快照栈 | 100 步，连续输入合并；非 CRDT，协同下需替换 |
| 页面图标/封面 | 完整 | emoji 选择器、封面上传/URL/渐变/Unsplash/拖动取景/署名 |
| 双向链接 | 有 | `[[` 插入 + 反向链接区 |
| 导入 | 有 | 单文件 `.md`、Notion 导出 ZIP（层级 + 图片 Base64） |
| 导出 | 有 | Markdown（含子页递归）、JSON 备份 |
| **数据库视图** | **无** | kanban 只是固定三列演示容器，无筛选/排序/分组/多视图 |
| **表格** | **无** | 无真正表格块 |
| **全局搜索** | **无** | 现有搜索仅为图标/表情/封面选择器内部过滤 |
| **实时协同** | **无** | 无在线光标、无 awareness |
| **评论** | **无** | 代码中 0 处相关实现 |
| **页面属性 / 版本历史 / 发布分享** | **无** | 均为 0 |

---

## 二、架构评估

### 分层

```
Vue3 组件层   NexusTaskMatrix1.vue（编辑器 + 侧边栏 + 弹窗）
                 ↓
composables   useSync（同步/持久化）· storage（KV 抽象）· ids
              markdownImport / zipImport（导入）· emoji（图标数据）
              imageProviders / providers / providerRegistry（图库抽象）
                 ↓
传输          WebSocket 全量广播 + REST（/api/pages）
                 ↓
后端          FastAPI + SQLite（222 行），整页 JSON + updatedAt LWW
```

### 做对的四件事

**存储抽象成了异步 KV**（`storage.ts`）。`localStorage` 是同步的，而 Capacitor Preferences 与 Tauri Store 都是异步的——现在不抽象，接入三端时所有调用点都要改。这个决策提前消除了一个会堵死迁移的点。

**ID 全局唯一**（`ids.ts`，基于 `crypto.randomUUID`）。时间戳方案在多设备并发下必然碰撞，CRDT 要求 ID 全局唯一且稳定。

**图库做了 Provider 抽象**。接入 Unsplash 后，加 Pexels 只需新增一个实现文件并在注册表加一行；Key 存在独立存储键，不参与页面同步因而不会被广播到其它设备。

**顺序模型引入 `prevId` 链**。数组下标在多端并发插入时无法确定性重建顺序——这是 CRDT 前置准备里最关键的一步。

### 架构债

`content` 字段是**整块 HTML 字符串**，不是结构化文档。这是所有同步问题的总根源：它无法做字符级合并，也无法被 Yjs 承载。

后端是 222 行的整页覆盖模型，没有块级 diff，没有向量时钟。

前端 `mergePages` 只做页面级合并，块级是远端直接覆盖本地（`Object.assign`），且服务端那一跳仍是覆盖。所以现状是「前端尽力不丢，后端仍然覆盖」。

`prevId` 链只在部分路径维护（Enter 拆块、图片插入），拖拽排序、批量粘贴、块选择态删除等靠 `writePrevIds` 兜底重写整链——断链时按 id 字典序追加，顺序不符合直觉。

**零自动化测试**。6666 行代码、刚做完跨块选区、撤销栈、导入导出这类高复杂度逻辑，却没有任何测试框架（package.json 中无 vitest/jest）。测试目前依赖我手工构造的 Node 断言脚本（放在 `test_samples/`，未接入 CI）。这是这个阶段最需要补的短板。

---

## 三、MVP 判定

**判定：是 MVP，但边界必须说清楚。**

如果 MVP 的定义是「一个用户能真实用它完成个人笔记与文档管理，且数据不丢」，那么达标，且在若干细节上超出（Notion 自己都不支持导出文件的一键重建，而我们做了 ZIP 导入）。

如果定义是「对标 Notion Web」，则远未达到。差距集中在三处：

**数据库**（Notion 的护城河）。我们连表格块都没有，kanban 是演示容器。这不是工作量问题，是产品形态差异。

**协作**。无实时协同、无评论、无 awareness。

**搜索**。完全没有。对一个以「知识管理」为定位的产品，没有全局搜索是结构性缺失——用户内容越多越找不到。

一个更贴切的定位可能是：**「带 Notion 交互手感的本地优先个人笔记」**，而非「Notion 替代品」。当前能力与此定位匹配。

---

## 四、Android 版可行性

### 三条路线

| 路线 | 成熟度 | 工作量 | 适用 |
| --- | --- | --- | --- |
| **Capacitor 8** | 最成熟（npm 8.5.3，周下载 442 万） | 5–8 人天 | 复用现有 Vue 前端，成本最低 |
| **Tauri 2** | 移动端已随 2.0 stable（2024-10），但官方承认「移动端插件未全覆盖、CI 构建支持 in progress、DX 仍不满意」 | 8–15 人天 | 若已用 Tauri 做 Windows，Rust 核心可复用；价值在于能把 WebSocket/SQLite 下沉到原生侧 |
| **原生 Kotlin + PowerSync** | 成熟 | 40–60 人天 | 离线体验上限最高，但要重写整个编辑器 UI |

### 结论：不要新开原生项目

核心理由是**卡点不在 UI 层**。真正的障碍是数据层（存储持久性、CRDT 模型）与同步策略，这些在 Web 端解决后三端同时受益；而重写原生 UI 会把编辑器再实现一遍，且从此双份维护、必然分叉。

Notion 自身也走过原生→Web→Electron 的演化，说明编辑器这类重交互 UI 用 Web 技术承载是合理的。

### 但有一个必须先解决的硬阻塞

**Android WebView 的 localStorage 每 origin 只有 5 MiB，且默认是 best-effort——设备存储压力时按 LRU 把整个 origin 全量删除**（不是删一部分）。MDN 明确记载了这一驱逐行为。

对照我们的现状：封面与图片块都以 Base64 存进同一个 JSON，一张压缩后的封面约 100 KB，几张图就会逼近 5 MiB 上限；一旦触发驱逐，**整个工作区数据全部消失**。

这在桌面浏览器上已经是隐患（我此前为此加了压缩与写入失败告警），在 Android WebView 上会升级为**必现的数据丢失**。所以：

- 存储必须换成 IndexedDB（配额为磁盘总量 60%）或原生 SQLite
- 必须调用 `navigator.storage.persist()` 申请持久化——但它在 WebView 中的实际生效情况官方无明确说明，**必须真机验证**
- 图片必须改为独立资产存储 + 引用，不再内联进页面 JSON

---

## 五、跨设备实时同步的八个卡点

按「是否需要改内核」分为两组。

### A 组：不动编辑器内核也能解决

**卡点 1 — 本地优先策略主动丢弃远端。** `initSync` 中「本地有数据就忽略远端全量」。虽然我加了 `mergePages` 做块级合并，但服务端自身仍是整页 LWW 覆盖。两台设备各自离线编辑后重连，服务端那一跳仍会丢一方。

**卡点 2 — `prevId` 链未全路径维护。** 拖拽排序、批量粘贴、块选择态删除等路径不维护链，只靠兜底重写。断链时按 id 字典序追加，顺序不符合直觉。要可靠合并，**所有**变更路径都必须维护链。

**卡点 3 — 整页全量广播。** 500ms 防抖推整个 `pages` 数组，payload 随内容增长（含 Base64 图片可达 MB 级），每次全量重传浪费带宽与 CPU。

**卡点 4 — 后端无块级合并。** 222 行的 SQLite 存储按整页 JSON + `updatedAt` LWW。需在服务端实现块级 diff 合并与更可靠的因果序（向量时钟或 per-block 时间戳）。

**卡点 5 — Android 存储持久性。** 见上一节，5 MiB + LRU 全量驱逐，属数据丢失级。

**卡点 6 — Android 后台网络。** 官方 Doze/App Standby 文档明确：Doze 期间**挂起网络访问**、忽略 wake lock；App Standby 下空闲应用**约每天一次**网络访问。WebView 里的 WebSocket 切后台即断。官方推荐用 **FCM** 而非自维护长连接；保活只能用**前台服务**（Play 政策禁止普通应用请求电池优化豁免）。**注意：JS 侧心跳同样受限，救不了。**

**卡点 7 — 无冲突呈现与 awareness。** 没有在线光标、没有「谁在编辑」、没有冲突提示、没有版本历史。用户遇到覆盖时毫无感知。

### B 组：必须换编辑器内核才能解决

**卡点 8 — `content` 是字符串，不是 CRDT。** 两个端同时编辑同一个块，必然一方被覆盖。Yjs 需要结构化文档（`Y.Text`）才能做字符级合并，裸 HTML 字符串无法承载。

这正是此前 Tiptap 迁移评估（26–36 人天）中「非此即彼的分岔点」所指：**如果确定要做多人实时协同，就应该直接迁移内核，不要再在现有内核上投入**——因为 CRDT 需要结构化文档模型，裸 DOM 无法承载 Yjs，届时所有工作都要重做。

### 破解路径

| 阶段 | 目标 | 关键动作 | 工作量 |
| --- | --- | --- | --- |
| 0（必做） | 数据层现代化 | 存储换 IndexedDB/SQLite；图片独立资产；全路径维护 prevId；`navigator.storage.persist()` | 5–8 人天 |
| 1 | 多端异步最终一致 | 后端块级 diff + 向量时钟；客户端增量同步 | 10–15 人天 |
| 2 | 真正的实时协同 | 内核迁到 Tiptap/ProseMirror + Yjs（y-prosemirror）；自建 Hocuspocus | 36–50 人天 |
| Android | 移动化 | Capacitor 8 + 前台服务/FCM；数据层已完成阶段 0 | 5–8 人天 |

阶段 0 与 1 不需要换内核，能支撑「多端先后编辑、最终一致」，对「个人 + 多设备」场景已足够。**只有阶段 2 才需要动内核，而它应当等到协同需求明确时再启动。**

补充：Yjs 官方**没有托管服务**，`y-websocket` 需自建（Hocuspocus 是常见自建选项，含 SQLite 持久化）。第三方托管如 Liveblocks、Velt 均付费。另有一类现成方案（如 PowerSync，Postgres↔SQLite 双向同步，有 Kotlin SDK、支持免费自托管与付费云）可承担业务数据同步，与 Yjs 可并存——前者管文档块树合并，后者管元数据同步。

---

## 六、待处理与改进清单

### P0（正确性 / 数据风险）

1. **存储层现代化** —— IndexedDB 或 SQLite 替换 localStorage。这是 Android 上的数据丢失级问题，也是桌面端 Base64 配额隐患的根治。
2. **图片独立资产存储** —— 不再内联进页面 JSON，改为文件/Blob + 引用。
3. **全局搜索** —— 当前完全没有。以「知识管理」为定位的产品缺搜索是结构性缺失。
4. **删除 1761 行死代码** —— `NotionPlus.vue`、`NexusTaskMatrix.vue`、`HelloWorld.vue`。低风险，立刻降低认知负担。
5. **补自动化测试** —— 跨块选区、撤销栈、导入解析这三块高复杂度逻辑目前零覆盖。

### P1（三端接入前必须）

6. **全路径维护 `prevId`** —— 拖拽排序、批量粘贴、块选择态删除。
7. **后端块级合并** —— 消除服务端覆盖。
8. **后端地址配置化** —— 加 `VITE_SYNC_SERVER`，`API_BASE` 与 `WS_PATH` 由其派生。移动端 WebView 的 `window.location.host` 不是服务器地址，**不配置就根本连不上**。
9. **表格块** —— Notion database 的最小可用形态。

### P2（体验完善）

10. 提及 `@`（日期 / 提醒）
11. 块级链接、块级评论
12. 页面属性
13. 页面改名后 `[[链接]]` 文本自动联动（当前不联动）
14. 块选择态字数统计
15. 版本历史
16. **图片块浮层 hover 粘滞** —— 行手柄已用媒体查询修好，图片块浮层仍是「hover 或聚焦」旧模式，桌面端点击后不消失

### P3（生态）

17. 数据库视图体系（筛选 / 排序 / 分组 / 多视图）
18. 实时协同（需先完成阶段 2）
19. 发布 / 分享 / 权限

---

## 七、建议路线

我的建议分三步，且**严格按顺序**：

**第一步（1–2 周）**：清死代码、补测试、做存储层现代化与图片独立存储、加全局搜索、后端地址配置化。这一步不引入新架构，纯粹把地基打牢，且完成后 Android 上的数据丢失风险被消除。

**第二步（2–3 周）**：Capacitor 8 接入 Android，真机验证三件事——`navigator.storage.persist()` 是否生效、切后台后 WebSocket 的实际断开时机、`navigator` 相关 API 在 WebView 的行为差异。这三件事**只能在真机确认**，文档无法替代。同时做后端块级合并，让多端异步编辑可用。

**第三步（视需求启动）**：只有当「多人实时协同」被确认为产品方向时，才启动 Tiptap + Yjs 的内核迁移。在此之前不要动内核——它成本高，且在没有协同需求时收益有限。

一个贯穿的判断：**当前所有架构债里，真正会咬人的只有两类——会造成数据丢失的（存储持久性），和会阻塞 CRDT 的（content 非结构化）。其余都可以往后放。** 建议按这个优先级分配精力。

---

## References

1. [Optimize for Doze and App Standby（Android 官方，2026-08-18 更新）](https://developer.android.com/training/monitoring-device-state/doze-standby)
2. [Storage quotas and eviction criteria - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)
3. [Tauri 2.0 Stable Release（官方博客）](https://v2.tauri.app/blog/tauri-20/)
4. [@capacitor/core - npm](https://www.npmjs.com/package/@capacitor/core)
5. [GitHub - yjs/yjs（编辑器绑定与 Provider 全表）](https://github.com/yjs/yjs)
6. [crdt-benchmarks（Yjs 作者维护）](https://github.com/dmonad/crdt-benchmarks)
7. [@automerge/automerge - npm](https://www.npmjs.com/package/@automerge/automerge)
8. [PowerSync 官网](https://powersync.com/)
9. 项目内部文档：`tiptap_migration_assessment.md`、`THREE_PLATFORM_ROADMAP.md`、`notion_import_assessment.md`、`IMAGE_LIBRARY_OPTIONS.md`
