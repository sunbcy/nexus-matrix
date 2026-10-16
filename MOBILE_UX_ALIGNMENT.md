# 移动端体验对齐 Notion：差距全景与落地方案

> 评估日期：2026-10-16。基于对 `NexusTaskMatrix1.vue`（约 2500 行）的代码审查，
> 以及 Notion 官方帮助页 / 发布笔记确认的移动端交互事实。
> 结论先行：**架构不用动**（原生壳 + WebView 编辑器与 Notion 同构），
> 要动的是 Web 编辑器内部的布局与可达性——目前它是「桌面界面缩在小屏上」，不是「移动界面」。

> **执行状态（2026-10-16 更新）**：第一期「可用性」与第二期「输入体验」均已实现并通过
> 真渲染验证（Playwright Pixel 7 触屏模拟实测，截图存 `test_samples/mobile_ux/`），
> 新产物已 `cap sync` 进 Android 工程。第三期未开始。
> 实现要点分别记录在文末「第一期落地记录」「第二期落地记录」。

---

## 一、Notion 移动端的真实形态（官方确认）

| 维度 | Notion 移动端事实 | 来源 |
| --- | --- | --- |
| 架构 | 原生壳 + WebView 编辑器；2022 年起首页/导航逐个原生化，启动 iOS 2× / Android 3×；2024 年官方口径「除编辑器外全部原生」 | notion.com/releases 2022-07-20；Pragmatic Engineer 访谈 2024-12 |
| 导航 | 侧边栏是**抽屉**，不常驻；无悬停态——桌面端 hover 才出现的 `•••`/`+` 在移动端**常驻可见** | notion.com/help/notion-for-mobile |
| 块操作 | 键盘附件工具栏最右端是 `•••`，点开是与桌面相同的块操作集；内容块角落也有 `•••` | notion.com/help/duplicate-delete-and-restore-content |
| 多选 | **移动端不支持多选块**，只能逐块操作 | notion.com/help/notion-for-mobile |
| 分栏 | 桌面端创建的分栏在移动端**折叠为单栏** | 同上 |
| 删除 | 进垃圾箱保留 30 天 | 同上 |

未被官方证实、不要照抄「网传细节」的：底部 Tab（Notion 是抽屉）、滑动缩进手势、块菜单是 bottom sheet 还是 popover。

**给我们的三条设计原则**（比抄交互细节更重要）：
1. **可达性优先于信息密度**：桌面端靠 hover 收纳的控件，移动端必须常驻可达。
2. **键盘上方的工具栏是格式操作的主战场**（WebView 里拿不到真正的输入法附件栏，用「贴在键盘上方的工具条」近似）。
3. **砍掉桌面专属交互，不硬移植**：多选块、拖拽排序在移动端没有原生对应物，Notion 自己也砍了。

---

## 二、当前差距（按严重度排序，均带代码位置）

### P0-1 侧边栏 280px 常驻，编辑器被压成一条
`NexusTaskMatrix1.vue:5` — `<aside class="w-[280px] ... shrink-0">`。360dp 手机上编辑区只剩约 80px，完全不可用。这是**当前最阻断的问题**。
Notion 对应形态：侧边栏默认收起，点汉堡按钮以**浮层抽屉**滑出，带遮罩；打开页面后自动收起。

### P0-2 `h-screen` + 裸 viewport，安全区与键盘全无处理
`index.html:6` — viewport 只有 `width=device-width, initial-scale=1.0`，缺 `viewport-fit=cover`（无 `env(safe-area-inset-*)` 支持）与 `interactive-widget=resizes-content`（移动浏览器下键盘不缩布局视口）。
`NexusTaskMatrix1.vue:2` — 根容器 `h-screen`，应改 `100dvh`；多处 `70vh`（如 action menu `max-h-[70vh]`）同理会随键盘漂移。

### P0-3 hover 收纳的控件在触屏上不可达（全组件性问题）
搜索 `opacity-0 group-hover:opacity-100` 与 `hover:` 变体共 75+ 处，其中**功能性**（非装饰）的包括：
- 侧边栏「新建根页面」按钮（`NexusTaskMatrix1.vue:72`）
- 页面行的收藏/建子页/删除按钮组（`:101`）——当前仅**当前激活页**可见，触屏上想收藏别的页面必须先打开它
- 封面操作浮层（`:135`，有 `coverTouched` 兜底，但 class 叠加 `opacity-0`/`opacity-100` 靠 CSS 顺序决胜，脆弱）

### P0-4 触摸目标尺寸不足
侧边栏图标按钮 `w-5 h-5` / `p-1`（20–28px），远低于 Material 48dp / Apple 44pt 最低标准。行首手柄（`+`/拖拽点）同样偏小，误触率高。

### P1-1 格式工具栏会被键盘吞掉
`.format-toolbar`（`:482`）是 `fixed` 浮层，按选区矩形定位。移动端选中文本后键盘弹出，选区矩形常在键盘上方或被遮挡，工具栏可能跑出屏幕。Notion 的解法是把格式操作放进**键盘上方的常驻工具条**；WebView 近似解：监听 `visualViewport`，键盘弹出时把工具条吸附到键盘顶部。

### P1-2 App.vue 右下角固定工具栏侵占拇指区
`App.vue:71` — `fixed bottom-4 right-4` 四个按钮（MD/导出/IMPORT MD/IMPORT ZIP/JSON）。移动端应折叠为单个「···」按钮展开，或移入编辑器顶栏。

### P1-3 弹窗全是居中模态，非移动形态
链接弹窗（`:509`）、图标/封面选择器均为 `fixed inset-0 items-center justify-center`。Notion 移动端用**底部弹出（bottom sheet）**。居中模态在移动端可用但不达标，且选择器内容高时 `max-h` 处理粗糙。

### P1-4 无 overscroll 控制，下拉刷新风险
未设 `overscroll-behavior`。Android WebView/Chrome 的下拉刷新会重载整个 SPA（虽不丢数据——IndexedDB 持久化——但 Scroll 位置与编辑焦点全丢，体验断裂）。应 `overscroll-behavior: contain` + 视情况 `touch-action: pan-y`。

### P2-1 看板不响应单栏折叠
Notion 移动端把分栏折叠为单栏。我们的 kanban 块（横排三列 + CRUD）在 360dp 上不可用，应折叠为单列纵向堆叠或横向 snap 滚动。

### P2-2 行首手柄的触屏形态
现有 `@media (hover: none)` 降级为「聚焦块显示」（`:2461`）方向正确，但 Notion 移动端的形态是**常驻的 `+` 与拖拽点出现在当前行**，且点击 `+` 在下方插入、长按拖拽点出操作菜单。我们已有 `openActionMenuAtTouch`（`:264`）——需要的是让手柄在触屏上**始终跟随焦点行**且命中区域放大。

---

## 三、落地方案（三期，可按期停止）

### 第一期：可用性（约 2–3 天）——做完「能当移动 App 用」

| # | 改动 | 位置 | 验收 |
| --- | --- | --- | --- |
| 1 | viewport 补 `viewport-fit=cover, interactive-widget=resizes-content`；根容器 `h-screen`→`100dvh`；全局 `-webkit-text-size-adjust: 100%` | `index.html`、`NexusTaskMatrix1.vue:2` | 键盘弹出不漂移；刘海/圆角设备不被裁 |
| 2 | 侧边栏改抽屉：`<640px` 时 `fixed` 浮层 + 遮罩 + transform 滑入；编辑器顶栏加汉堡按钮；选页后自动收起 | `NexusTaskMatrix1.vue:5, 118-176` | 360dp 下编辑区全宽；抽屉滑出/遮罩/选页收起 |
| 3 | 触屏可达性修复：新建页面按钮、页面行操作组在 `(hover: none)` 下常驻显示（或改为行尾「···」按钮）；封面浮层改用单一 class 绑定而非叠加 | `:72, :101, :135` | 无鼠标设备可完成建页/收藏/删页/换封面 |
| 4 | 安全区：顶栏/底栏/抽屉加 `env(safe-area-inset-*)` padding；`overscroll-behavior: contain` 加在滚动容器 | 全局 | 手势区不遮挡；无下拉刷新重载 |
| 5 | 触摸目标放大：侧边栏与手柄按钮 min 44×44px（可用负 margin 保视觉尺寸） | 侧边栏 + 行首手柄 | 无连续误触 |

### 第二期：输入体验（约 3–4 天）——做完「像 Notion 一样编辑」

| # | 改动 | 位置 | 验收 |
| --- | --- | --- | --- |
| 6 | 键盘感知格式工具条：监听 `visualViewport`，键盘弹出时将 `.format-toolbar` 吸附到键盘顶部；加 `Aa`/颜色/链接（与键盘工具栏信息架构对齐） | `:482` + script | 选中文本→键盘弹出→工具条恒在键盘上方可见 |
| 7 | 块操作菜单改 bottom sheet：`action-menu-popup` 在小屏从底部滑入（大屏保持浮层），加遮罩 | `:535` | 触屏点 `···`→底部菜单，含删除/转换/移动 |
| 8 | App.vue 工具栏折叠为单按钮 | `App.vue:71` | 不侵占拇指区 |
| 9 | 图标/封面/链接弹窗小屏 bottom sheet 化；`max-h` 改 `dvh` | 三个 Picker + `:509` | 弹窗不被键盘/裁切 |
| 10 | 行首手柄触屏常驻聚焦行 + 命中区放大 | `:2457-2463` | 点 `+` 插入、点拖拽点出菜单，手感接近原生 |

### 第三期：细节（已落地，2026-10-16）

实现位置：`frontend/src/components/NexusTaskMatrix1.vue` + `frontend/src/style.css`。

| # | 改动 | 位置 | 验收 |
| --- | --- | --- | --- |
| 11 | kanban 单栏折叠：行容器 `flex-col gap-4`（`<640px`），列 `w-full`；`md:` 恢复横排三列 + 横向滚动 | kanban 块模板 | Pixel 7（412px）下列 `flex-direction:column`、列宽 100% 全宽堆叠 |
| 12 | 图片块触屏手势：双击全屏预览遮罩（`fixed inset-0 z-[60]`），点遮罩/外区关闭；替换/删除浮层按钮触摸目标 `w-9 h-9 md:w-7 md:h-7`；单击仍是选中块（沿用 `@touchstart.stop`） | image 块 `:352-371` + script | 双击图片块→预览遮罩出现；桌面双击同样可用 |
| 13 | 页面切换微动画：`<main :key="activePage.id">` 包裹 `<Transition name="page-fade" mode="out-in">`；`style.css` 定义 150ms 淡入 + 6px 上移 / 淡出 + 6px 上移 | 主区域 + `style.css` | `page-fade` CSS 已注入、`<main>` 随 `key` 重建 |
| 14 | 桌面专属交互显式降级：拖拽手柄在触屏下移除 `cursor-grab` 与 `mousedown` 拖拽，改为 `cursor-pointer` + title「点击打开操作菜单」；Esc 块多选态本就依赖键盘，触屏不可达属符合预期 | 块手柄模板 | 手柄 `hasGrab:false / hasPointer:true / title=点击打开操作菜单` |

验证：Playwright MCP（Pixel 7 触屏模拟）逐项验证 #11/#12/#14 通过；#13 的过渡 CSS 已注入、`<main>` 随 `key` 重建确认；前端 `npm run build` 通过、`vitest` 38 项通过；`cap sync android` 已同步进原生工程（需重新 `gradlew assembleDebug` 装包生效）。预览遮罩 `z-[60]` 高于抽屉（`z-30/40`）与底部面板（`z-50`），确保覆盖全部 UI。

---

## 四、明确不做（对齐 Notion 的取舍）

- **不做移动端多选块**：Notion 官方明确移动端无此交互；我们的跨块选区引擎保留给桌面端，触屏隐藏入口。
- **不做左右滑动缩进**：未获官方证实，且与系统返回手势冲突风险高；缩进走操作菜单。
- **不动原生壳**：底部 Tab 已是原生；Web 内的侧边栏抽屉与原生 Tab 各司其职（Notion 同样是「原生 Tab/抽屉 + WebView 编辑器」）。
- **不引 Tiptap/ProseMirror**：与阶段规划一致，移动适配不动编辑器内核。

---

## 五、技术要点速查（实现时直接引用）

- viewport：`width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content`（后者 Chrome 108+，iOS WebKit 不支持，需 `visualViewport` 兜底）
- 高度单位：`100dvh` 替代 `100vh`；`max-h` 同步换
- 安全区：`env(safe-area-inset-top/bottom/left/right)`，须配合 `viewport-fit=cover`
- 触摸目标：≥ 48dp（Material）/ 44pt（Apple），可用 `min-w/h` + 负 margin 保持视觉尺寸
- 键盘定位：`window.visualViewport.height/offsetTop` + `resize`/`scroll` 事件（Android WebView 的 adjustResize 已缩窗口，此处主要兜底 iOS 与浏览器场景）
- 防刷新：滚动容器 `overscroll-behavior: contain`
- 媒体查询断点：跟随 Tailwind `sm`（640px）；触屏能力判断用 `(hover: none) and (pointer: coarse)`，不嗅探 UA

---

## 六、与阶段 2 的边界

原生页面列表（底部「收藏」Tab 改真正的原生列表 + Room 数据层）属于阶段 2，不在本方案内。
本方案三期做完后，Web 编辑器自身达到「移动可用且接近 Notion 手感」，阶段 2 再决定哪些屏幕整体原生化。

---

## 七、第一期落地记录（2026-10-16 实现）

### 改了什么

| # | 项 | 实现 | 关键文件 |
| --- | --- | --- | --- |
| 1 | viewport | `viewport-fit=cover, interactive-widget=resizes-content`；**保留缩放**（WCAG），双击缩放用 `touch-action: manipulation` 抑制 | `index.html` |
| 2 | 侧边栏抽屉 | aside 改 `fixed inset-y-0 left-0 z-40 w-[min(280px,85vw)]` + `translate-x` 过渡；`md:` 断点恢复常驻；遮罩 `z-30`；汉堡按钮 `md:hidden w-11 h-11`；`sidebarOpen` ref + `selectPage()`（切页即关）+ Esc 关闭 | `NexusTaskMatrix1.vue` |
| 3 | 视口高度 | `.h-viewport` 工具类（`100vh` 先行、`100dvh` 覆盖，旧 WebView 保底） | `style.css`、`NexusTaskMatrix1.vue:2` |
| 4 | hover 控件触屏化 | 新建页按钮、页面行操作组（收藏/建子页/删除）、折叠箭头 → `opacity-100 md:opacity-0 md:group-hover:opacity-100`（桌面行为逐像素不变）；图片浮层原本就有 touchstart 选中机制，未动 | `NexusTaskMatrix1.vue` |
| 5 | 触摸目标 | 页面行操作按钮 `p-2.5 md:p-1`、展开按钮 `w-8 h-8 md:w-5 md:h-5`、块手柄 `w-9 h-9 / p-2.5 md:`、折叠箭头用 `before:-inset-2` 伪元素扩热区（不改布局）、封面/App 工具栏按钮 `h-11 md:h-9` | 多处 |
| 附 | 块菜单防越界 | `openActionMenuAtTouch` 加 `nextTick` 测量后夹取到视口内（点屏幕下半部分时菜单原会画出屏外） | `NexusTaskMatrix1.vue` |
| 附 | 全局 | `overscroll-behavior: none` + `touch-action: manipulation`；App 工具栏 `z-50→z-20`（低于遮罩）+ `bottom-[calc(1rem+env(safe-area-inset-bottom))]` | `style.css`、`App.vue` |

### 验证（Playwright，Pixel 7 预设 412×839 触屏模拟）

- 初始：aside x=-280（屏外）、汉堡可见、内容列宽 412px、padding 20px（原 80px）
- 点汉堡：aside x=0、遮罩出现、`transition-property: transform`
- 点页面行：aside x=-280、遮罩移除、hash 通道正常
- 桌面 1280×720 回归：aside x=0 常驻、汉堡 `display:none`、内容 padding 80px 不变
- 构建：`vue-tsc + vite build` 通过；vitest 42/42 通过；截图 `test_samples/mobile_ux/`
- 已 `cap sync`：真机重装 APK 即生效

### 已知遗留（第二期处理）

- 格式工具栏仍按选区 `fixed` 定位，键盘弹出时会被吞 → 第二期做「吸键盘工具条」
- 块操作菜单仍是 popover，Notion 移动端是底部面板 → 第二期 bottom sheet 化
- 看板卡片删除按钮仍 hover-only → 第三期
- 侧滑抽屉手势（从左缘滑开）未做，汉堡唤出已够用

---

## 八、第二期落地记录（2026-10-16 实现）

### 改了什么

| # | 项 | 实现 | 关键文件 |
| --- | --- | --- | --- |
| 1 | 格式工具栏吸键盘 | 新增 `useMobileInput.ts`：`visualViewport` 算 `keyboardInset` + 触屏判定；触屏时工具条 `bottom: calc(inset + safe-area + 8px)` 水平居中吸底，按钮 44px，颜色面板改向上展开；桌面端维持跟随选区 | `useMobileInput.ts`、`NexusTaskMatrix1.vue` |
| 2 | 块菜单 bottom sheet | 单容器双形态：触屏 `inset-x-0 bottom-0` + 圆角顶 + 抓取条 + 遮罩(z-40) + 菜单项 44px；桌面仍是 `w-52` popover。全局点击关闭逻辑同步识别 `.action-menu-sheet` | `NexusTaskMatrix1.vue` |
| 3 | 工具栏折叠 | App.vue 移动端收成一个 44px 圆钮，展开才显示五个导入/导出按钮（桌面 `md:flex` 常驻） | `App.vue` |
| 附 | 块手柄可达性（实测发现的阻断问题） | 手柄外槽原为 `-ml-[84px] w-[84px]`，412px 屏上实测左边缘 **-84px 完全在屏外**，手机上根本点不到块菜单。改为移动端 `-ml-[60px] w-[60px]` + 内容 `pl-16 pr-5`，并隐藏「+」插入按钮（插入用回车） | `NexusTaskMatrix1.vue` |

### 关键设计决策

- **触屏判定取双信号或**：`(pointer: coarse)` OR (`maxTouchPoints > 0` AND 宽度 < 768)。
  前者语义最准但无头浏览器/部分 WebView 不上报；后者保证可变宽度窗口与 Surface 这类
  「有触摸屏但有鼠标」的混合设备仍走桌面形态。
- **inset 公式对两种 WebView 都成立**：`innerHeight - visualViewport.height - offsetTop`。
  支持 `interactive-widget=resizes-content` 的 Chromium 两者相等（inset=0，此时
  `fixed bottom:0` 天然在键盘之上）；不支持的（iOS WebKit/旧 WebView）inset 即键盘真实高度。

### 验证（Playwright，Pixel 7 412×839 触屏模拟）

- 格式工具栏：`format-toolbar--touch` 生效，bottom 距屏底 8px、水平居中、按钮 44×44
- 块菜单：`action-menu-sheet`，宽 412=全宽、bottom=839 贴底、遮罩存在、菜单项 44px
- 块手柄：左边缘 0（原 -84）、36×36，待办勾选框 left=40 均在屏内
- 桌面 1280×720 回归：内容 padding 80px、「+」可见、工具条 left=421 仍跟随选区、按钮 26px、
  `format-toolbar--touch` 未生效
- 构建 `vue-tsc + vite build` 通过；vitest 42/42 通过；截图 `test_samples/mobile_ux/`
  新增 `mobile_toolbar_docked.png`、`mobile_block_sheet.png`
- 已 `cap sync`：真机重装 APK 即生效

### 已知遗留（第三期）

- 看板卡片删除按钮仍 hover-only
- 块拖拽排序在触屏不可用（HTML5 drag 事件不响应触摸），目前靠菜单里的上移/下移
- 键盘上方的「块类型转换」快捷入口未做（Notion 移动端键盘工具栏有）；当前靠六点手柄唤出底部面板
- 真机软键盘下 `keyboardInset` 的实际表现需在真机确认（模拟器无法复现软键盘）
