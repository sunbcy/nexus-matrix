# NEXUS MATRIX 文档编辑能力与 Notion 的差距分析及对齐报告

## 执行摘要

用户反馈的「标题处按 Enter 不跳正文」已修复并冒烟验证通过：现在标题中按 `Enter` / `↓` / `Tab` 会直接进入正文第一个可编辑块（正文为空时自动创建首块），光标落在块首；反向的「首块按 `↑` 或行首 `Backspace` 回到标题」也已补齐。除此之外，本轮还顺带对齐了 Notion 的 Shift+Enter 软换行、空列表项 Enter 降级为段落、行内格式快捷键、多行粘贴自动拆块等 8 项交互，并修复了中文输入法（IME）组合期被拦截器吞键、首尾块方向键越界抛异常两个既有缺陷。

差距分析显示：本项目在「块编辑器的骨架」（块 CRUD、缩进、拖拽、Slash、多媒体容器、LocalFirst 持久化）上已具备 Notion 约 40% 的形态，但在四个维度上存在结构性缺口——撤销/重做与历史、块选择态与批量操作、行内富文本与 Markdown 即时转换、块类型体系（缺编号列表、toggle、callout、分割线、表格、数据库）。其中**撤销栈缺失**是当前裸 `contenteditable` 架构下风险最高的一项：用户按 `Cmd+Z` 会绕过应用状态直接回滚 DOM，与响应式数据分叉。

---

## 一、本轮已落地的对齐改动（文件：`frontend/src/components/NexusTaskMatrix1.vue`）

| 问题 | Notion 行为 | 本次改动 |
| --- | --- | --- |
| 标题按 Enter 无反应 | 光标进入正文首块 | 新增 `handleTitleKeyDown`，`Enter`/`↓`/`Tab` 均跳正文；正文为空则自动创建首块 |
| 首块按 ↑ 抛 TypeError | 光标回到标题 | `index === 0` 时调用 `focusTitle()`；同时修复末块按 ↓ 的同类越界崩溃 |
| 首块行首 Backspace 无反应 | 光标进入标题末尾 | 首块行首退格回到标题；若该块为空则先删除再回标题 |
| 无软换行 | `Shift+Enter` 块内换行不拆块 | 新增 `insertSoftBreak()`（`insertLineBreak` + 手动 `<br>` 兜底） |
| 空列表项 Enter 无限续接 | 空列表项 Enter 降级为普通段落（escape hatch） | 空 `bullet`/`todo` 按 Enter 转为 `text` |
| 无行内格式快捷键 | `Cmd+B/I/U/E`、`Cmd+Shift+S` | 新增拦截：`bold`/`italic`/`underline`/`strikeThrough` + 自实现 `wrapInlineCode` |
| 多行粘贴塞进一个块 | 多行文本按行拆成多个块 | 新增 `handlePaste`，按 `\n` 拆块并继承列表类型，纯文本做 HTML 转义 |
| 中文输入法组合期吞键 | 组合期不触发任何编辑器逻辑 | `handleKeyDown` 顶部加 `e.isComposing` 守卫；`handleInput` 组合期只同步内容、不跑 Markdown/Slash 规则 |
| 新建页面后光标无处安放 | 新建页面光标自动落在标题 | `createPage` 末尾调用 `focusTitle()` |
| 空块占位提示整页刷屏 | 提示只在聚焦/悬停的空块出现 | CSS 改为 `.ce-block.show-placeholder:empty` + hover 选择器 |
| 同一毫秒连续 Enter 生成重复 ID | — | 新块 ID 追加随机后缀 |

冒烟验证（Playwright，Chromium headless，本地 `vite dev`）：标题按 Enter 后 `document.activeElement` 为第一个 `.ce-block` 且光标偏移为 0；首块按 ↑ 后 `activeElement` 为标题输入框。`vite build` 通过。

---

## 二 · 补 第二轮自主优化（2026-10-13 实现）

在首轮基础上，本轮又完成了以下对齐与缺陷修复，均已在 Chromium headless 冒烟验证：

布局与光标基线。原先正文块的文本起点被 `p-2` + `gap-3` + 加号按钮 + 拖拽手柄 + 类型前缀逐级推到 88px（text）/104px（bullet、todo），且各类型互不相同。现改为：控制手柄（`+` 与拖拽）以 absolute 定位到正文左边缘之外的 `-72px` 负空间，列表标记（圆点、复选框、序号、折叠箭头）统一为 `-24px` 处的 `w-5` 容器，主容器左右内边距由 `p-12` 调整为 `pt-12 pb-0 px-20` 以容纳负空间。实测标题左边缘与各类型块（段落 / 项目符号 / 待办 / 编号 / 折叠 / 引用）左边缘均为 412px，完全一致；缩进块按层级右移 24px。

撤销与重做（首轮列为 P0）。采用快照式历史栈，`Ctrl/⌘+Z` 撤销、`Ctrl/⌘+Shift+Z` 重做，上限 100 步，连续输入按 800ms 停顿合并为一步。关键点有二：一是必须自己接管 `Ctrl+Z`，否则浏览器原生 undo 会直接回滚 contenteditable 的 DOM 而与响应式数据分叉；二是回退期间的 `watch` 不得入栈、且要 cancel 掉回退前 pending 的防抖提交，否则 redo 栈会被随后的自动提交清空（此问题在实现过程中实际出现并已修复）。

行内 Markdown 即时转换。支持 `**粗体**`、`*斜体*`、`` `行内代码` ``、`~~删除线~~` 在键入时立即转为富文本。实现上只改写光标所在的**那一个文本节点**（Range 删除 + 插入元素），不重建 `innerHTML`，因此不会破坏块内已有的其它格式。

斜杠菜单搜索过滤。输入 `/` 后继续键入即作为过滤关键字，按 label、块 id、拼音关键字匹配；例如 `/code` 直接定位到「代码片段」。菜单为空时显示「无匹配命令」。

新增三个块类型。编号列表 `numbered`（`1. ` 快捷输入，序号按「同级相邻」自动计算）、折叠列表 `toggle`（`> ` 快捷输入，点击箭头折叠其后所有层级更深的块）、分割线 `divider`（`--- ` 快捷输入）。折叠引入了渲染索引与数据索引的分离：`visibleTasks` 用于渲染，`realIndexOf` 用于键盘逻辑，避免折叠状态下拆行、粘贴、移动块定位到错误的下标。

浮动格式工具栏。选中文本后在选区上方弹出，含加粗、斜体、下划线、删除线、行内代码、链接六项；按钮用 `@mousedown.prevent` 以避免点击时丢失选区。

其它修复。清理了 `saveTasks` 未定义的遗留调用（看板增删卡片时会抛 ReferenceError）；补全 `vue-tsc` 的全部既有类型错误，`npm run build` 现已可正常通过；`numbered`/`toggle` 曾被遗漏在 DOM 内容回写的类型白名单之外，导致内容不渲染，现已统一收敛到 `EDITABLE_TYPES` 常量。

## 二 · 补 2 第三轮自主优化（2026-10-13 实现，P2 层）

在 P0/P1 收尾后，继续补齐了 P2 层的四项能力，均已在 Chromium headless 冒烟验证：

可折叠标题（Toggle Heading）。Notion 的 H1/H2/H3 可折叠其后整节内容。折叠引擎从原先只支持 toggle 扩展为双规则：toggle 折叠其后所有层级更深的块直到同级；标题忽略缩进、折叠其后所有内容直到遇到同级或更高级的标题（`HEADING_LEVEL` 判定）。折叠箭头在展开态仅 hover 可见、折叠态常驻，避免干扰排版。实测：折叠 H1「第一章」后仅剩「第一章 / 第二章 / 第二章正文」，正确停在下一个 H1。

块选择态。这是 Notion 的核心交互之一，此前完全缺失。现在 `Esc`（光标处无选区时）选中当前块进入选择态，`↑`/`↓` 以锚点扩展或收缩整块选区，`Tab`/`Shift+Tab` 批量缩进，`Cmd/Ctrl+D` 批量复制，`Backspace/Delete` 批量删除，`Enter` 或再次 `Esc` 回到编辑态。选中块以青色 ring 高亮。实测：Esc 选中 1 块 → ↓ 扩展为 2 块 → Backspace 两块一并删除。

双向链接。`[[` 唤出页面链接菜单，支持关键字搜索，无匹配时提供「新建页面并链接」（对齐 Notion 的 “+ Add new page”）。链接以 `<a data-page-id>` 存储，因此页面改名后链接文本需手动同步（Notion 会自动更新，此项尚未追平）。页面底部自动生成「反向链接」区，聚合引用了本页的页面并附上下文摘要。实测：插入链接后 HTML 为 `参见 <a data-page-id="p2" href="#p2">引用页</a>`，反向链接区正确显示来源页与摘要。

导出 Markdown。右下角新增 `MD` 按钮（App.vue 备份工具栏），通过 `defineExpose` 调用编辑器内的导出函数。当前页面连同所有子页面递归导出为一个 md 文件。转换器覆盖全部块类型：标题、列表、待办、引用、callout（`> 💡`）、toggle（`<details>`）、分割线、代码块（带语言围栏）、看板、图片，以及行内格式（粗体/斜体/删除线/行内代码）与页面链接（`[[标题]]`）。

新增标注块 callout。`/callout` 插入带图标的高亮提示框（默认 💡），图标与列表标记同样位于 `-24px` 负空间，不破坏文本对齐。

内联颜色与高亮。浮动格式工具栏新增文本颜色与背景高亮两组色板（青/琥珀/红/绿/紫/灰 + 清除），基于 `execCommand('styleWithCSS')` + `foreColor`/`hiliteColor` 写出 `<span style>`，随后同步回数据模型。实测高亮后 HTML 为 `<span style="background-color: rgb(255, 176, 0);">…</span>`。

## 二 · 补 3 跨块选区缺陷修复（2026-10-13）

用户反馈「无法跨行任意选取文本」。实测定位到三个叠加缺陷，均已修复。

根因一（最主要的元凶）：跨块拖拽时 `click` 事件会冒泡到拖拽起点与终点的**共同祖先**（正文容器），从而触发 `handleEmptyClick` ——它会在末尾新建一个空块并 `setFocusConfig` 抢走焦点，选区当场消失。用户看到的现象就是「拖过去选不中，还多出一个空行」。修复：`handleEmptyClick` 增加 `pointerDragged || hasTextSelection()` 双重守卫。

根因二：浏览器对跨 `contenteditable` 宿主的原生选区支持不可靠。实测 Chromium 下，一个从第 1 行跨到第 3 行的 Range，`Selection.toString()` 只返回起始块的 8 个字符（应为 22），丢失中间块；`Range.toString()` 与 `Selection.toString()` 结果还不一致。修复：自建**逻辑选区引擎**——`selAnchor` / `selFocus` 均记录为 `{ blockId, offset }`，由 `caretInfoFromPoint` 从屏幕坐标解析，再由 `applyLogicalSelection` 按文档顺序重建 DOM Range（边界定位只在单一宿主内做）。mousemove 期间持续重建，因此中间块同样被正确覆盖。

根因三：`extendSelectionTo`（键盘 `Shift+方向键` 的旧实现）第一步就调用 `el.focus()`，而 focus 会清除选区，导致锚点丢失——连续按 `Shift+↓` 只会原地踏步。修复：删除该函数，改为 `extendSelectionByKeyboard`，锚点复用 `selAnchor`，且以**逻辑焦点块**而非事件所在块为基准计算目标行。

附带修复：拖动已选中的文字会被 `handleDragStart` 劫持成「块拖拽」并在 drop 时重排块（实测把 a,b,c 重排成 b,a,c）。修复：`handleDragStart` 中若 `draggableTaskId !== task.id`（即非手柄发起）则 `preventDefault` 取消拖拽。

联动补齐：`Backspace` / `Delete` / 可打印字符在存在选区时先调用 `deleteSelectionContents()`——中间块整块删除，首尾块保留未选中部分并合并到首块，光标落在合并点。

验证（Chromium headless，真实鼠标拖拽）：三行文本从第 1 行拖到第 3 行，选区 `start=a / end=c`，高亮矩形覆盖全部三行 y 坐标，文本完整包含中间块；按退格后首尾合并为单块 `AACCCC第三行`；拖动已选中文字后块顺序保持 `a,b,c` 不变。`vue-tsc -b` 全绿，`vite build` 通过。

## 三、对照基线：Notion 已确证的行为

Notion 官方快捷键文档确认了以下可直接作为验收标准的条目：正文 `Enter` 插入新文本行；`Shift+Enter` 为块内换行；`Tab`/`Shift+Tab` 缩进即嵌套（选中父块连带选中嵌套内容）；选中文本后 `Cmd/Ctrl+B` 加粗、`I` 斜体、`U` 下划线、`E` 行内代码、`Shift+S` 删除线、`K` 链接；块选中后 `Cmd/Ctrl+D` 复制块；`Esc` 选中当前块；`Shift+↑/↓` 扩展整块选择；`Cmd/Ctrl+Shift+↑↓` 移动块。

行首 Markdown 语法方面，官方口径与本项目**存在一处重要语义差异**：`>` + 空格在 Notion 中生成的是**可折叠的 toggle 列表**，而引用块由 `"` + 空格生成；`[]` 中间无空格；`1.` / `a.` / `i.` + 空格生成编号列表；`---` 生成分割线。本项目目前 `" ` → quote 与 Notion 一致，`# ` / `## ` / `### ` / `- ` / `[] ` 也一致，但缺少 `1. `、`---`、`> `（toggle），且 `*` 与 `+` 两种项目符号前缀未支持。

行内 Markdown（`**粗体**`、`*斜体*`、`` `代码` ``、`~删除线~`）官方文档明确写为「键入时即时转换」（While typing），即转换后不保留 Markdown 源码。

有三项在本次检索中**未能从官方来源确认**，属于「业界共识但无一手文档」，实现时应以黑盒实测为准：标题区 Enter/Tab/↓ 的精确落点（本次按「跳到首块开头」实现，与 BlockSuite 对标 Notion 时的描述一致）；空块占位提示是否常驻；多行纯文本粘贴是否严格逐行拆块（有第三方资料称单个 `\n` 在 Notion 中可能作为块内软换行，空行才拆块——本项目的实现选择了逐行拆块，若后续发现与预期不符，可改为「仅当空行分隔或粘贴内容呈列表形态时才拆块」）。

---

## 三、差距全景

### 1. 键盘与光标（缺口最小，本轮已基本补齐）

剩余未对齐项：`Cmd/Ctrl+A` 在 Notion 中是「第一次选中当前块、再次按升级为全页」，本项目直接全选所有块；Notion 的 `Esc` 会切换「编辑态 ↔ 块选择态」，本项目 `Esc` 只用于关闭浮窗；`Cmd/Ctrl+Option/Shift+0~9` 直达块类型（text/H1/H2/H3/todo/bullet/numbered/toggle/code/page）未实现；方向键跨块时光标横向位置的「粘性记忆」（Notion 会记住上一次的横向偏移）未实现。

### 2. 块类型体系（缺口最大的一层）

项目现有：text、h1、h2、h3、quote、todo、bullet、image、codeblock、kanban。

Notion 官方斜杠菜单分组中还包含：子页面 `/page`、编号列表 `/num`、切换列表 `/toggle`、分割线 `/div`、书签 `/book`、PDF、音视频、文件、嵌入（官方称支持 500+ 服务）、目录 `/toc`、面包屑 `/bread`、模板按钮 `/button`、块级公式 `/math`、行内公式 `/equation`、日期 `/date`、提醒 `/reminder`、提及 `/mention`、表情 `/emoji`。此外实际存在但本次未取到官方来源、需人工复核的还有 callout 标注块、简单表格、行内数据库及其七种视图（table / board / timeline / calendar / list / gallery / chart）、同步块、AI block、toggle heading、拖拽分栏布局。

对照下来，本项目的 `h1/h2/h3` **不可折叠**（Notion 的 toggle heading 可折叠整节），没有编号列表，没有分割线与 callout，图片仅支持本地 Base64 上传而无书签/嵌入，看板 `kanban` 是一个孤立的三列演示容器而非真正的数据库（无视图切换、筛选、排序、分组、属性）。

### 3. 行内富文本

项目当前只在 CSS 层面渲染了 `b/strong`、`i/em`、`u`、`strike/del`、`a`、`code`、`kbd` 七种标签，且**没有产生这些标签的入口**（除本轮新增的 `Cmd+B/I/U/E/Shift+S` 外）。缺失：文本颜色与背景高亮（Notion 支持 `/color`、`/blue background`、`Cmd+Shift+H` 复用上次颜色）、提及 `@`（人 / 页面 / 日期 / 提醒）、行内表情、评论线程（`Cmd+Shift+M`）、行内公式。字号与字体属于 Notion 也不开放逐段控制的能力，不必追平。

### 4. Markdown 与斜杠命令

行首快捷输入本已覆盖 `# `、`## `、`### `、`- `、`[] `、`" `，缺 `1. `、`--- `、`> `（toggle）、`* `、`+ `。行内 Markdown 即时转换（`**粗体**` 等）**完全没有实现**——这是「感觉不像 Notion」最容易被用户直觉捕捉到的一点：在 Notion 里敲 `**重点**` 会当场变成粗体，在本项目里会原样保留星号。斜杠菜单本身缺搜索框过滤（只能方向键翻页）、缺分组标题、缺「最近使用优先」排序。

### 5. 块操作与选择

项目已有：拖拽手柄、块菜单（转换类型 / 复制 / 删除）、`+` 快速插入、块级拖拽排序、跨行 `Shift+方向键` 选区。缺口：块选择态（`Esc` 选中整块、多块批量选中后的批量删除/移动/转换）、多块选中后显示字数、`Cmd+D` 复制块、`Cmd+Shift+↑↓` 移动块、块级折叠、把块拖到侧边形成分栏布局。

### 6. 历史与协同（风险最高）

项目**完全没有撤销/重做栈**。由于所有块操作都是「直接改数组 + `nextTick` 回写 `innerHTML`」，浏览器原生 undo 会把 DOM 回滚到与应用数据不一致的状态，属于会丢数据的隐患，应列为最高优先级。

协同方面，`useSync.ts` 采用「全量矩阵广播 + `updatedAt` 时间戳 LWW」模型：任意端改动 500ms 防抖后推送整个 `pages` 数组，服务端再全量广播。**多端同时编辑同一页面必然互相覆盖**，且本地只要已有数据就一律忽略远端（`if (existing && existing.length > 0) return`），意味着两台设备各自离线编辑后重连只会有一方胜出。Notion 未公开其冲突处理算法，但可以确认的是它具备块级/字符级合并能力，而非整页覆盖。演进路线应为增量 diff → CRDT（Yjs / Automerge）。

### 7. 平台级能力

缺失：双向链接 backlinks、块级链接（Copy link to block）、页面属性、页面图标与封面、版本历史、导出（Markdown / HTML / PDF / CSV）、模板库、页面级权限与发布。已有的：树状页面空间、收藏、面包屑、JSON 备份导入导出。

---

## 四、架构层面的判断

当前内核是「裸 `contenteditable` + DOM 即数据源 + Vue 数组即文档模型」的双写结构。中文技术社区在实现同类编辑器时反复踩到的坑，本项目已命中或即将命中：

DOM、业务数据、Selection 三套状态互相竞争。只要响应式数据回写 `innerHTML`，原文本节点被替换，浏览器保存的 Range 失效，光标跳到末尾——本项目用 `watch(tasks)` 在 `el.innerHTML !== task.content` 时才回写，配合 `focusConfig` 在 `nextTick` 恢复光标，本质上是一套补丁。

每块一个 `contenteditable`，原生 Selection 极难自然跨块——项目为此手写了 `extendSelectionTo` 与 `document.caretRangeFromPoint` 兜底中文/跨块选区，并刻意「绝不主动 `focus()`」，注释里已写明这是参照 Notion 的做法，这一点是对的。

中文 IME 组合期把 `input`/`keydown` 当普通事件处理，会把未上屏拼音当正式文本——本轮已加守卫，但 `getCaretPosition` 用 `textContent` 长度计算偏移，软换行 `<br>` 不计入长度，Shift+Enter 之后的光标偏移会失真，这是已知残留问题。

撤销栈与原生 undo 分叉——未解决。

业界共识是「不再把 DOM 当数据源」，在其上补结构化文档、逻辑选区、事务、规范化与历史。对本项目而言，现实的路线是：短期保留自研内核但仿照 transaction 模型，把「改数组 + 回写 DOM」收敛成统一的 `applyTransaction(op)`，并在此基础上实现 undo/redo；中期评估迁移到 Tiptap/ProseMirror（Vue 3 接入友好，NodeView 便于保留现有的工业风自定义块如看板与代码块），代价是复杂问题最终仍需理解 ProseMirror 的 schema 与位置映射。

---

## 五、完成度与剩余路线图

### 已完成（三轮实现后）

P0：撤销与重做栈（快照式，100 步，连续输入合并）。协同冲突改为块级 diff **尚未做**，仍是整页覆盖。

P1：行内 Markdown 即时转换；浮动格式工具栏；行首 Markdown 补齐 `1. ` / `---` / `> `（toggle）/ `* `；新增编号列表、分割线、callout、toggle、折叠标题；斜杠菜单搜索过滤。

P2：块选择态与批量操作（`Esc` / `↑↓` / `Cmd+D` / `Tab` / `Backspace`）；可折叠标题；文本颜色与高亮；双向链接（`[[` + 反向链接区）；导出 Markdown；标注块 callout。

### 剩余

P2 剩余：提及 `@`（人 / 日期 / 提醒）；块级链接（Copy link to block）；页面改名后自动同步链接文本（当前不联动）；多块选中后显示字数统计。

P3（生态层，均为较大工程）：数据库视图体系（筛选 / 排序 / 分组 / 多视图，当前 `kanban` 只是固定的三列演示容器）；模板按钮；同步块 synced block；嵌入与书签；AI block。

协同仍是最大架构债：`useSync.ts` 为「整页全量广播 + `updatedAt` LWW」，且本地有数据时一律忽略远端全量，多端并发编辑同一页面必然互相覆盖。演进路线为增量 diff → CRDT（Yjs / Automerge）。

---

## 六、局限与未确认项

Notion 官方帮助站在本次检索中大量子页面抓取超时，仅 `keyboard-shortcuts` 一页完整取到，因此块类型清单、行内能力、斜杠菜单分组等条目中标注「未确认」的部分需在真实 Notion 环境黑盒复核后再作为需求。标题 Enter 的精确语义、空块占位提示规则、多行粘贴的拆分粒度三项均未能取得官方或高可信来源，当前实现基于 BlockSuite 等对标项目的描述与常见产品表现推导。微信公众号文章检索未能取到 2024—2026 年间直接讨论类 Notion 编辑器光标实现的原文，中文侧结论主要来自掘金实战文章。

另有一项顺带发现（不属于本次需求范围，未改动）：`npm run build` 会因 `vue-tsc` 报出若干**既有**类型错误而中断——`saveTasks` 未定义（看板与代码块处调用，实际持久化已由 `useSync` 的深度 watch 接管，该调用为历史遗留）、`pushAll`/`SyncPage`/`SyncTask`/`blockTypes` 未使用、`isInternalUpdate` 未使用、一处 `string | number` 类型不匹配。`vite build` 本身可正常出包。如需让 `npm run build` 恢复可用，可另行清理。

---

## References

1. [Notion keyboard shortcuts（官方，本次主要一手来源）](https://www.notion.com/help/keyboard-shortcuts)
2. [BlockSuite：首块退格回到标题的 Notion 对标 issue](https://github.com/toeverything/blocksuite/issues/567)
3. [Notion 换行技巧（Shift+Enter 与块内换行）](https://zhuanlan.zhihu.com/p/621761559)
4. [Notion 块内多行转多个块（粘贴拆分粒度的反例资料）](https://niinblog.vercel.app/return-convertor)
5. [Notion 跨 Blocks 文本选择与复制粘贴更新](https://www.playpcesor.com/2022/02/notion-blocks.html)
6. [导出你的 Notion 内容 | Notion 帮助中心](https://www.notion.so/zh-cn/help/export-your-content)
7. [Chart view databases in Notion | Notion Help](https://www.notion.so/help/charts)
8. [How Long Does Notion Keep Version History and Trash? (By Plan)](https://restora.cc/blog/notion-version-history-and-trash-limits)
9. [历史版本 | NotionChina（官方中文镜像）](https://notionchina.co/guide/editing-pages/version-history.html)
10. [中文输入法在 input 的表现引起异常？且听我娓娓道来（掘金）](https://juejin.cn/post/7433226139125940251)
11. [富文本编辑器框架 ProseMirror、Slate 和 Lexical 横向比较（掘金）](https://article.juejin.cn/post/7140921781380415501)
12. [每天肝到晚上两点，WYSIWYG 开源编辑器，正式启程（掘金，Tiptap 实践）](https://juejin.cn/post/7448251115572346930)
13. [ProseMirror：模块化的富文本编辑框架](https://cloud.tencent.com/developer/article/2047202)
14. [Notion 写作与编辑入门（官方中文）](https://www.notion.so/zh-cn/help/writing-and-editing-basics)
