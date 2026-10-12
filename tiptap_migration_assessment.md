# 迁移 Tiptap / ProseMirror 的改造成本评估

## 执行摘要

评估对象为 `NexusTaskMatrix1.vue`（1789 行，有效 1657 行）这一自研裸 `contenteditable` 编辑器内核。**全量迁移到 Tiptap（ProseMirror）约需 26–36 人天，单人约 5–7 周**，其中最大的单项成本不是编辑器交互，而是**数据模型迁移**（现有 `Page[].tasks[].content` 是 HTML 字符串，需与 ProseMirror JSON 双向转换，且要兼容 localStorage 里已存在的用户数据）。

但评估过程中得出一个更重要的判断：过去几轮修复暴露的问题里，真正属于「架构级」的只有跨块选区和撤销栈两项，而**这两项在上一轮已经解决**（逻辑选区引擎 + 快照历史栈）。剩下未解决的核心债是协同冲突（整页覆盖）。因此迁移的紧迫性已显著下降——除非下一步要做真正的多人实时协同，否则建议优先选择 5–8 人天的「内核加固」方案，把迁移推迟到协同需求明确时再做。

另外排除一个看似更优的选项：**BlockNote 不适用**。它是 React 专有（`@blocknote/react` + Mantine/Shadcn/Ariakit 均为 React 组件），Vue 3 无原生支持，且许可为 MPL-2.0 而非 MIT。

---

## 一、现状代码资产

主编辑器 `NexusTaskMatrix1.vue` 共 1789 行（有效 1657 行），构成为模板约 373 行、脚本约 1388 行、样式约 28 行。外围 `useSync.ts` 278 行、`App.vue` 63 行。另有 1616 行死代码（`NexusTaskMatrix.vue` 503、`NotionPlus.vue` 1023、`HelloWorld.vue` 90）均未挂载，迁移前可直接删除，不影响功能。

脚本部分按职责拆解后，各模块的规模与迁移去向如下表。

| 模块 | 约行数 | 迁移后去向 |
| --- | --- | --- |
| `handleKeyDown` 键盘引擎 | 253 | 删除约 80%，剩余改写为 PM keymap |
| 跨块选区引擎（`SelPoint` / `caretInfoFromPoint` / `applyLogicalSelection`） | 200 | **删除**，PM 原生 Selection 接管 |
| 光标引擎（`setCaretPosition` / `getCaretPosition` / `setBoundary`） | 150 | **删除** |
| Sidebar 树与页面管理 | 150 | 原样保留 |
| `handleInput` + 行内 Markdown 转换 | 90 | **删除**，PM Input Rules 内置 `**粗体**` 等 |
| 导出 Markdown | 68 | 保留逻辑，改从 PM JSON 序列化（更简单） |
| 双向链接 + 反向链接 | 59 | 保留计算逻辑，改遍历 PM doc |
| 折叠引擎 | 57 | 保留并适配（PM 不管折叠渲染） |
| 撤销重做快照栈 | 50 | **删除**，StarterKit 自带 UndoRedo |
| `handlePaste` 多行拆块 | 40 | 删除约 60%，拆块业务规则保留 |
| 块选择态 | 36 | 删除约 70%，PM NodeSelection 原生支持 |
| 块 CRUD / 拖拽 / 菜单 / 多媒体 | 约 200 | 部分保留，重写为命令与 NodeView |

合计约 **830 行可直接删除**（Tiptap 原生接管），约 **700 行可保留或微调**，约 **600–700 行需要新写**（Schema、NodeView、自研扩展）。

## 二、块类型的迁移对照

现有 13 个块类型中，7 个可由官方免费扩展直接覆盖，4 个需自研节点，2 个属于「官方没有、必须自研」的硬骨头。

| 块类型 | Tiptap 方案 | 成本 |
| --- | --- | --- |
| text / h1 / h2 / h3 / quote / bullet | StarterKit 免费内置 | 配置即可 |
| todo | TaskList / TaskItem，免费 | 低 |
| numbered | OrderedList，免费 | 低 |
| divider | HorizontalRule，免费 | 低 |
| image | Image 免费；Base64 上传与全局拖拽逻辑保留 | 低 |
| codeblock | CodeBlockLowlight 免费（语法高亮），但须重写带语言下拉的 UI | 中 |
| toggle | 无官方对应，自研 Node + NodeView | 中（约 80 行） |
| callout | 无官方对应，自研 Node | 中（约 60 行） |
| kanban | 无官方对应，自研 atom NodeView | 高（约 120 行） |
| **缩进 `indentLevel`** | **官方扩展列表中不存在 Indent** | **高（约 120 行自研）** |
| **Slash 命令菜单** | **官方仅实验性 demo，未发布 npm 包**；需基于免费 `@tiptap/suggestion` 自研 | **中（约 150 行）** |
| 页面链接 Mark | 自研 Mark（`data-page-id`） | 中（约 50 行） |
| 拖拽手柄 | Drag Handle，免费 MIT | 低 |

值得单独提醒的是**缩进**。当前实现是块级数值 `indentLevel` 加上「智能继承上一行缩进、最大不超过父级 +1」的规则，而 Tiptap 官方没有 Indent 扩展（社区实现多为 React 版），这项必须自研，约 120 行，且要作为 PM command 重新表达现有规则。Slash 菜单同理，官方只有实验性示例，需基于 `@tiptap/suggestion` 自建，不过现有约 60 行的菜单逻辑可复用。

## 三、许可、体积与 Vue 支持

许可方面，Tiptap 主仓库与 `@tiptap/*` 均为 **MIT**，免费。商业化边界在独立的 Tiptap Pro License，付费项通过私有 registry 的 `@tiptap-pro/*` 安装，未订阅会 403。按官方扩展页的分级：TaskList、CodeBlockLowlight、Placeholder、Drag Handle、Collaboration 均未标付费，属开源免费；需要留意付费的是 **Paste Handler（Team 档）**、Comments、版本历史、AI 相关扩展。平台云服务 Start 档 49 美元/月起。本项目的块类型清单里没有一项落在付费区，**许可与费用不是障碍**。

Vue 3 支持是官方的（`@tiptap/vue-3`），支持 `<script setup>` 与 TypeScript，自定义节点用 `VueNodeViewRenderer` + `NodeViewWrapper` / `NodeViewContent`，可同时表达「块内可编辑」与「块内不可编辑的自定义 UI」两种形态，看板和代码块的现有 UI 都能迁移过去。当前最新为 3.31.4，新项目应直接上 v3（v3 的 StarterKit 已含 Link、Underline、ListKeymap、TrailingNode，History 更名为 UndoRedo）。

包体积上，`@tiptap/starter-kit` 实测 330 KB minified、约 103 KB gzip（含 `prosemirror-view` 195 KB、`prosemirror-model` 89 KB 等），叠加 `@tiptap/vue-3`、lowlight 后预计增加约 100–150 KB gzip。当前项目仅 Vue（约 34 KB gzip）。对本地优先的桌面级应用可接受；若目标包含移动端 H5 则需权衡。

## 四、工时估算

按单人、含 ProseMirror 学习曲线（Transaction / Plugin / Decoration / Schema 概念，前 1–2 周效率打折）估算：

| 阶段 | 内容 | 人天 |
| --- | --- | --- |
| 1. Schema 与数据迁移 | 10–13 个 Node/Mark 定义；`Task[]` ↔ PM JSON 双向转换；localStorage 老数据兼容；后端结构适配 | 5–7 |
| 2. 内核替换 | 接入 Editor；删除选区/光标/键盘/撤销四处引擎；键盘行为改写为 PM keymap/commands；自研 Indent | 6–9 |
| 3. NodeView 与 UI | toggle / callout / kanban / codeblock / image；基于 Suggestion 重写 Slash 菜单；块菜单与拖拽手柄；折叠引擎适配 | 8–10 |
| 4. 外围能力 | 页面链接 Mark + 反向链接；导出 Markdown 改从 PM JSON；块选择态与跨块选区验证 | 4–5 |
| 5. 回归与打磨 | IME、粘贴规范化、长文档性能、边界用例 | 3–5 |
| **合计** | | **26–36** |

若同时上 Yjs 协同（`@tiptap/extension-collaboration` + `y-websocket`，免费开源，或用 Tiptap 自托管的 Hocuspocus），需**额外 10–15 人天**，且现有 `useSync.ts` 要整体重写。

## 五、风险清单

数据迁移是单向门。现有 localStorage 键 `nexus_matrix_pages_v3` 里的 `content` 是 HTML 字符串，后端 `main.py` 也按此结构存储。切换后要么写完整的双向转换层，要么放弃老数据；且后端若不跟着改，前端就得长期维护两套表达的适配。这是被低估的隐藏成本。

缩进与 Slash 菜单两项无官方方案，合计约 270 行需自研，且这两处恰恰是当前体验最贴近 Notion 的地方，重写后需要逐条回归验证「智能继承缩进」「搜索式斜杠菜单」等行为不退化。

协同语义冲突是另一个坑：Yjs 的 UndoManager 与 PM History 语义不同（会「撤销别人的编辑」），启用协同后必须禁用 StarterKit 的 UndoRedo。此外 `UniqueID` 与 `Collaboration` 的初始化顺序错误会产生持久空段落，官方对此有明确警告。

性能方面，长文档（超过 5 万字）首屏可能到 3 秒以上，官方无虚拟滚动，需自行分片或延迟加载。

## 六、方案对比与建议

| 方案 | 成本 | 收益 | 适用条件 |
| --- | --- | --- | --- |
| A. 全量迁移 Tiptap | 26–36 人天 | 根治跨宿主选区、粘贴规范化、协同冲突；撤销/输入规则/选区全部由内核保证 | 确定要做多人实时协同，或长期重度演进 |
| B. 内核加固（不迁移） | 5–8 人天 | 抽象统一 transaction 层、补齐 schema 规范化（粘贴清洗）、删除 1616 行死代码 | 继续单人/多端同步形态 |
| C. 分层迁移（块内换 PM） | 12–18 人天 | 改善块内编辑，但**跨块选区仍是自研**，核心痛点不解决 | 不推荐 |

**建议选 B，除非协同需求明确。**

理由是：回顾这几轮修复，标题 Enter 跳转、左边缘对齐属于常规缺陷，跨块选区与撤销栈是真正的架构级痛点，而**这两项在上一轮已经用逻辑选区引擎和快照历史栈解决了**。当前剩余的核心债只有协同冲突（整页覆盖 + LWW）与粘贴规范化。若下一步并不打算做多人实时协同，花 26–36 人天换来的主要是「未来不会再遇到这类问题」的确定性，性价比不高。

反之，**如果确定要做多人实时协同，就应该直接走 A**，而且不要再在现有内核上投入——因为 CRDT 需要一个结构化的文档模型，裸 DOM 无法承载 Yjs，届时所有工作都要重做一遍。这是个非此即彼的分岔点，建议先明确产品方向再决定。

无论选哪个，都建议先做一件零风险的事：删除 1616 行未挂载的死代码（`NexusTaskMatrix.vue`、`NotionPlus.vue`、`HelloWorld.vue`），它们目前干扰对真实复杂度的判断。

## References

1. [Vue 3 | Tiptap Editor Docs](https://tiptap.dev/docs/editor/getting-started/install/vue3)
2. [Vue node views | Tiptap Editor Docs](https://tiptap.dev/docs/editor/extensions/custom-extensions/node-views/vue)
3. [Extensions overview（Open Source / Start / Team / Add-on 分级）](https://tiptap.dev/docs/editor/extensions/overview)
4. [StarterKit extension | Tiptap Editor Docs](https://tiptap.dev/docs/editor/extensions/functionality/starterkit)
5. [Collaboration extension | Tiptap Editor Docs](https://tiptap.dev/docs/editor/extensions/functionality/collaboration)
6. [Slash Commands Extension（官方实验，未发布 npm 包）](https://tiptap.dev/docs/examples/experiments/slash-commands)
7. [Suggestion utility | Tiptap Docs](https://tiptap.dev/docs/editor/api/utilities/suggestion)
8. [Tiptap Pro license](https://tiptap.dev/pro-license)
9. [Tiptap Pricing](https://tiptap.dev/pricing)
10. [GitHub API：ueberdosis/tiptap LICENSE.md（MIT）](https://api.github.com/repos/ueberdosis/tiptap/license)
11. [npm registry：@tiptap/extension-drag-handle（license MIT）](https://registry.npmjs.org/@tiptap/extension-drag-handle/latest)
12. [Bundlephobia：@tiptap/starter-kit 体积](https://bundlephobia.com/api/size?package=%40tiptap%2Fstarter-kit)
13. [Bold extension（内置 `**粗体**` 输入规则）](https://tiptap.dev/docs/editor/extensions/marks/bold)
14. [BlockNote - Getting Started（确认 React only）](https://www.blocknotejs.org/docs/getting-started)
