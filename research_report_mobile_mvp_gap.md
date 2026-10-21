# 移动端问题核实与相对 Notion 移动端的 MVP 差距评估

## 执行摘要

用户提出的三个问题中，**两个完全属实、一个属实但根因与直觉相反**。收藏入口重复确实存在且属于「比 Notion 更冗余」的设计；点击图标弹软键盘的现象真实，根因是图标弹窗在挂载时无条件聚焦搜索框；而移动端数据不落本地的怀疑，其真正根因并非「没写」或「图片撑爆存储」，而是一处 **IndexedDB 版本冲突**——两个模块共用数据库名 `nexus-matrix` 却分别声明版本 1 与 2，导致键值存储可能永久静默失效，之后所有页面写入全部落空且用户无任何提示。这是一条 P0 级数据丢失缺陷，优先于任何体验优化。在此之前，本项目的移动端编辑器形态（抽屉、吸底工具栏、底部菜单、看板单栏、图片预览）已基本对齐 Notion 移动端的「形」，真正的差距集中在信息架构层：全局搜索、快速捕获、回收站，以及一个可用的本地持久化底座。

## 一、三个问题的核实结论

### 问题 1：侧边栏收藏与底部收藏 Tab 重复 —— 属实，建议去掉底部收藏 Tab

两处入口读的是**同一份数据的同一个过滤表达式**，不是两套数据。

Web 侧边栏的收藏分组位于 `NexusTaskMatrix1.vue:58-72`，标题为「收藏的子程序」（`:60`），列表循环 `favoritePages`（`:62`），点击行为仅为跳转页面 `selectPage(page.id)`（`:63`），数据源是 `:1170` 的计算属性：

```ts
const favoritePages = computed(() => pages.value.filter(p => p.isFavorite));
```

Android 底部 Tab 的收藏页则是另一条链路。`NexusApp.kt:26-30` 定义了 `FAVORITES("收藏", Icons.Filled.Star)`，底部导航栏在 `:44-54`；`FavoritesScreen.kt:43-52` 通过 `WebQuery.JS_FAVORITES` 求值，该脚本在 `WebQuery.kt:27-28` 指向 `window.__NEXUS_API__.getFavorites()`，而桥的实现在 `nativeBridge.ts:52`：

```ts
getFavorites: () => pages.value.filter(p => p.isFavorite).map(summarize),
```

两者是同一个表达式。更关键的是桥的挂载方式：`:1009` 处 `installNativeBridge(pages as any, activePageId)` 传入的正是同一个 `pages` ref，原生端并不落任何数据（`FavoritesScreen.kt:36-39` 注释自陈）。

因此底部收藏 Tab **没有独立价值**，理由有三。它唯一的能力是跳回编辑器（`FavoritesScreen.kt:85-92` 先 `openPage` 再切 `ShellTab.DOCS`），而这在 Web 侧一键可达（`:63`）。它的数据是启动时的一次性快照（`FavoritesScreen.kt:54` 的 `LaunchedEffect(webView) { refresh() }`，只有手动刷新按钮 `:60-62`），编辑后收藏会过期；反而 Web 侧是 `computed` 实时更新（`:1170`），原生端体验更差。至于「少开一次抽屉」的收益，移动端开抽屉只需 1 次点击（`:185-187` 汉堡按钮），不足以抵消两套 UI 的维护成本。

对照 Notion 官方口径更能说明问题。《Workspaces on mobile》明确移动端底部导航栏为 **Home / Search / Inbox / 新建**四个常驻项，而 Favorites 只是 Home 内的一个 section，与 Shared、Private、Teamspaces 并列——**不存在底部收藏 Tab**。所以「侧边栏收藏 + 底部收藏并存」是比 Notion 更冗余的设计，应当合并为单一入口。

需要说明的是，**不应连带去掉设置 Tab**。它有真实独立能力：`SettingsScreen.kt:86-103` 提供同步服务器地址写入 SharedPreferences 并重载 WebView，`:64-71` 读取 `navigator.storage.estimate()` 显示 IndexedDB 用量与配额——后者恰好也是诊断问题 3 的关键入口。文档 Tab 则是编辑器本体。建议的形态是保留「文档 / 设置」两 Tab，或改为「文档 / 搜索 / 设置」。

### 问题 2：点击图标呼出软键盘 —— 现象属实，根因是弹窗主动聚焦搜索框

首先需要澄清一个常见误解：图标**不在** contenteditable 内部。侧边栏行内图标是 `<span>`（`:98-104`），标题区大图标是 `<button>`（`:206-220`），页面标题本身是 `<input type="text">`（`:222`），只有正文块才是 `contenteditable="true"`（`:344`）。点击处理函数 `openIconPicker`（`:1481-1485`）既没有调用 `focus()`，也没有 `blur()` 掉当前焦点。

真正的根因在图标选择弹窗自身。`PageIconPicker.vue:71-78`：

```ts
onMounted(() => {
  updatePos();
  nextTick(() => searchRef.value?.focus());
  setTimeout(() => document.addEventListener('click', onDocClick), 0);
  ...
});
```

弹窗一挂载就**无条件聚焦搜索输入框**（`PageIconPicker.vue:92` 的 `<input type="text">`），WebView 随即弹出软键盘。这在桌面端是合理的「打开即搜索」设计，但在移动端就是打断。次因是打开前未收掉既有焦点：全仓 `blur()` 调用仅 `NexusTaskMatrix1.vue:1632` 一处，若此前焦点在正文 contenteditable，键盘本就是展开状态。

还有一个叠加问题：图标选择器**完全没有做移动端适配**。它是桌面 popover 形态（`PageIconPicker.vue:87-88`，`class="icon-picker-popup fixed z-[70] w-80 ..."` 配合 `:style="{ top, left }"`），定位逻辑在 `:45-55`（固定 `W=320, H=380`，按 `window.innerHeight` 夹取）。键盘弹出后 `window.innerHeight` 收缩（`useMobileInput.ts:20-28` 有同样观察），`:52` 的计算会把弹窗顶到视口外或被键盘截断。相比之下，同项目的格式工具栏已按 `isCoarsePointer` 吸底（`:1225`、`:1233-1245`），而图标选择器未接入 `useMobileInput`。

用户提出的「默认随机 + 保留自定义选择界面」是合理的方向：移动端单击图标直接换一个随机图标（零键盘、零打断），另设一个入口打开完整选择器。这与主流笔记应用的处理一致，也符合本项目已经在块操作上采用的「触屏降级」思路。

### 问题 3：移动端数据不保存到本地 —— 属实，但根因是 IndexedDB 版本冲突（P0）

写入链路本身是完整的，并非「没有实现持久化」。`useSync.ts:143` 定义键名 `nexus_matrix_pages_v3`；`:187-193` 的 `saveLocal` 走 `getStore().set()`；触发路径是 `:543-549` 的深度 `watch(pagesRef)` → `stampUpdated` → `debouncedPersist`，防抖 500ms（`:212`）。全仓 `frontend/src` 内 `localStorage` 的实际调用点只有 `storage.ts:18/25/34` 三处，没有绕过存储抽象的直接写入。

**根因①（可能性最高）：IndexedDB 版本冲突导致键值存储永久失效。**

`idbStore.ts:16-18` 与 `assets.ts:23-25` 使用了**同一个数据库名**，却声明了**不同版本**：

```ts
// idbStore.ts
const DB_NAME = 'nexus-matrix';
const DB_VERSION = 1;
const STORE = 'kv';

// assets.ts
const DB_NAME = 'nexus-matrix';
const DB_VERSION = 2; // 1 -> 2：新增 assets object store
const ASSET_STORE = 'assets';
```

两个模块还各自维护独立的 `dbPromise`（`idbStore.ts:20`、`assets.ts:27`）。若 `assets.ts` 先以版本 2 打开，数据库实际版本即为 2，此时 `idbStore.ts:29` 的 `indexedDB.open(DB_NAME, 1)` 因请求版本低于现存版本而抛出 **VersionError**，进入 `:35` 的 `onerror` 分支。而 `:23-24` 会把这个 **rejected promise 缓存进 `dbPromise`**，此后每次 `get`/`set` 都复用同一个已拒绝的 promise——`get` 走 `:58-60` 的 catch 返回 `null`，`set` 在 `:62-64` 直接 reject，且**永不重试**。

触发顺序的证据是确凿的：`NexusTaskMatrix1.vue:1463-1475` 的 `watch(..., { immediate: true })` 在页面含图片时会调用 `warmAssets` → `assets.openDB(2)`，这发生在 `:1007` 的 `initSync` 期间，**早于** `:1014-1025` 的迁移 IIFE。也就是说，只要会话里存在图片或封面，`assets.ts` 极可能先建库。

后果链条是静默的。`idbStore.ts:97-112` 的 `migrateFromLocalStorage` 把每个键的失败吞掉（`:107-109` 的 `catch {}`），不抛错；于是 `:1019` 的 `setStore(idbStore)` 照常执行，之后所有页面写入都进入失效的 `idbStore`；`useSync.ts:190-192` 只做 `console.error`，无任何 UI 反馈；而 `loadLocal` 首读走 localStorage（`:1007` → `:175-177`），用户还会看到**回退到迁移前的旧数据**。这正是「好像数据没保存」的典型表现。

**根因②：IndexedDB 不可用时静默退回 localStorage。** `:1021-1024` 的 catch 分支自陈「继续使用 localStorage」。而 `idbStore.ts:6-7` 与 `assets.ts:6` 的注释已经写明：localStorage 是 best-effort，设备存储压力下会按 LRU 把**整个 origin 全量删除**，Android WebView 上必现。

**根因③：`navigator.storage.persist()` 有调用但结果被丢弃。** 与「没调用」的猜测相反，`:1020` 确实执行了 `await requestPersistence()`（实现在 `idbStore.ts:73-81`），但返回值未使用、无重试、无提示，且位于①的失败路径之后。

**根因④：500ms 防抖且无离场落盘。** `useSync.ts:212`；全仓搜 `visibilitychange|pagehide|beforeunload` **0 命中**，意味着编辑后立刻切走或进程被杀，最后 500ms 内的编辑必然丢失。移动端进程更易被回收，这一条比桌面致命得多。

**根因⑤：写入失败对用户完全不可见。** `storage.ts:26-30` 超限时 `console.error` 并 `throw`，`useSync.ts:190-192`、`:207` 均只 catch 打日志。

有一处需要澄清的**反直觉结论**：「图片 Base64 撑爆 5 MiB」在当前代码下**已不成立**。图片已改为独立资产存储（`assets.ts:44-55` 的 `saveAsset` 存 Blob 进 `assets` store，页面只留 `asset:<id>` 引用），封面同理（`PageCoverPicker.vue:49`、`:125`）。风险仅残留于历史 `data:image/...;base64` 数据（`NexusTaskMatrix1.vue:1451-1453` 对非 asset 引用原样返回）。所以 5 MiB 超限不是主因，主因是版本冲突。

最后，Android 原生侧**未发现任何会清除或禁用存储的配置**：`MainActivity.kt:43-74` 复用 Capacitor WebView 且不 destroy，`AndroidWebView.kt:29-35` 的 `onDispose` 仅 `removeView`；`capacitor.config.ts` 无存储相关项；`AndroidManifest.xml` 仅 `:9` 的 `allowBackup="true"`；在 `frontend/android` 全目录搜 `domStorageEnabled|clearCache|deleteAllData|setDataDirectorySuffix|databaseEnabled` 为 **0 命中**（Capacitor 默认即可用）。所以问题在 Web 层，不在原生壳。

**真机三步验证法**（可立即坐实①）：在设置 Tab 看「IndexedDB 用量」是否显示不可用（`SettingsScreen.kt:70`）；控制台检索 `[NEXUS SYNC] 本地持久化失败`（`useSync.ts:191`）与 `[NEXUS] IndexedDB 迁移失败`（`:1023`）两条日志；DevTools → Application → IndexedDB → `nexus-matrix`，若 version 为 **2 且只有 `assets` 没有 `kv`**，即①已发生，且此状态下 `idbStore` 不可自愈。

## 二、修复建议（按优先级）

P0 是统一 IndexedDB 的版本与连接：把 `kv` 与 `assets` 收敛到同一个模块的同一次升级中（统一为版本 2，`onupgradeneeded` 同时建两个 store），并让 `openDB` 在失败时清空 `dbPromise` 以支持重试。同时必须让失败可见——`setStore(idbStore)` 之前要确认迁移真实成功（按迁移键数而非异常判断），写入失败要有用户可见提示，并补上 `visibilitychange`/`pagehide` 的 flush 以堵住防抖窗口。

P1 是移除底部收藏 Tab，保留文档与设置两 Tab；以及图标交互改造——移动端单击随机换图标，长按或独立入口打开选择器，且选择器在触屏下改 bottom sheet、打开前 `blur()` 当前焦点、移除无条件 `focus()`。

P2 才是体验向的补齐，见下节差距矩阵中的 P1/P2 项。

## 三、相对移动端 Notion 的 MVP 差距

评估标尺取自 Notion 官方移动端文档（《Notion for mobile》《Workspaces on mobile》《Use Notion pages offline》）与 Material Design 触摸目标规范。需要注意 Notion 移动端是**刻意精简**的：官方自己列了六项必须回桌面完成的操作（多选块、导入、账号信息、退出工作区、安全设置、账单），因此「Notion 没有」不等于「不该做」，但「Notion 有」基本就是及格线。

| 维度 | Notion 移动端 | 本项目现状 | 差距 | 优先级 |
| --- | --- | --- | --- | --- |
| 本地持久化与离线 | 2025-08 才补齐离线（仅 App 端，非网页）；付费自动离线最近访问与收藏 | 架构是 local-first，但**因版本冲突实际不可用**；无离场 flush | 底座是坏的，比「没做」更糟 | **P0** |
| 收藏入口 | 单一入口（Home 内 Favorites 分组） | 侧边栏分组 + 底部 Tab 双入口，且原生端数据会过期 | 比 Notion 冗余，需合并 | **P1** |
| 搜索 | 底部独立 Search Tab，全局搜索 | 全局搜索缺失（既有评估结论） | 移动场景刚需，完全缺失 | **P1** |
| 快速捕获 | Home Tab 常驻新建；iOS 有 Siri/Spotlight/Action Button | 侧边栏新建，需先开抽屉；无 widget / 分享面板 | 捕获链路偏长 | **P1** |
| 软键盘避让 | 编辑工具栏位于键盘上方，随键盘升起 | 格式工具栏已吸底（二期）；**图标选择器仍会被键盘顶飞** | 部分对齐，图标处有洞 | **P1** |
| 块编辑与块操作 | 键盘上方工具栏含 `+`（替代桌面 `/`）、缩进、颜色、删除复制；横向滚动 | 已有吸底格式工具栏、底部块菜单、看板单栏、图片预览 | 形态基本对齐 | P2 |
| 图标/封面编辑 | 移动端可否编辑元信息**未证实** | 图标/封面可编辑（但移动端弹键盘） | 我们有机会做得更好 | P2 |
| 多列/看板 | 移动端无分栏，桌面多列折叠为单列 | 看板已实现单栏折叠（三期 #11） | 已对齐 | 完成 |
| 控件常驻（无 hover） | 桌面 hover 才出现的 `•••`/`+` 在触屏常驻 | 已统一为 `opacity-100 md:opacity-0 md:group-hover` 模式 | 已对齐 | 完成 |
| 触摸目标 | Material 48dp / HIG 44pt | 主要控件已放大到 44px | 已对齐 | 完成 |
| 回收站 | 移动端可查看/恢复/永久删除 | 状态待核实 | 若为缺失则属 P1 | 待核实 |
| 导入导出 | 移动端支持导出，**不支持导入** | 双向都支持（MD/JSON/ZIP），且是桌面端强项 | **我们更强** | 优势 |
| 同步与冲突 | 云优先；文本冲突自动合并，非文本冲突承认会丢 | 整页 JSON + `updatedAt` LWW 覆盖，多端并发会互相覆盖 | 弱于 Notion，但个人场景可接受 | P2 |
| 协作类（评论/@/分享/版本历史） | 完整 | 缺失（既有评估结论） | 个人 PKM 场景非刚需 | P3 |

综合判断：**编辑器的「形」已经接近，差距在「底座」和「信息架构」**。前两期做完了抽屉、吸底工具栏、底部菜单、看板折叠、图片预览，形态层面对齐度约七八成；但本地持久化这条底座实际是坏的（P0），而搜索、快速捕获、回收站这三项移动场景的刚需缺失或待核实（P1）。如果把 P0 与三项 P1 补齐，本应用在「个人知识管理」这一定位上可以达到移动端可用的 MVP 水准；协作类能力（评论、@提及、分享、版本历史）在个人场景下优先级最低，Notion 的强项恰恰在此，但那不是本项目当前定位（既有结论：本平台是个人知识管理的 MVP，不是协作工作区的 MVP）。

## 四、局限与待验证项

本次结论基于静态代码取证与官方文档，未做真机验证。以下几项需实测确认：IndexedDB 版本冲突在真机上的触发率（依赖是否存在图片/封面，以及模块加载顺序的实际时序）；Android WebView 中 `navigator.storage.persist()` 的真实授予行为；软键盘弹出时 `keyboardInset` 与图标弹窗定位的实际表现。此外，Notion 移动端的块拖拽排序、Markdown 快捷输入、块菜单是否底部弹出等项，官方文档未证实，本轮不作为事实引用；中文信息源（搜狗微信检索）返回的多为 2026 年 3 月一批同质化自媒体内容，质量有限，仅用于辅助印证「移动端编辑标题光标乱跳、块色入口难找」一类痛点，未作为结论依据。

## References

1. [Notion for mobile (iOS & Android) — Notion Help Center](https://www.notion.com/help/notion-for-mobile)
2. [Notion workspaces on mobile — Notion Help Center](https://www.notion.com/help/workspaces-on-mobile)
3. [Use Notion pages offline — Notion Help Center](https://www.notion.com/help/use-pages-offline)
4. [What's New / Release Notes — Notion](https://www.notion.com/releases)
5. [Finally, Notion now works without an internet connection — TechCrunch (2025-08-20)](https://techcrunch.com/2025/08/20/finally-notion-now-works-without-an-internet-connection)
6. [Accessibility — Material Design（48×48 dp 触摸目标）](https://material.io/design/usability/accessibility.html)
7. [Mobile Navigation Design Best Practices — UXPin](https://www.uxpin.com/studio/blog/mobile-navigation-examples/)
8. 本地代码证据：`frontend/src/composables/idbStore.ts`、`assets.ts`、`storage.ts`、`useSync.ts`、`frontend/src/components/NexusTaskMatrix1.vue`、`PageIconPicker.vue`、`frontend/src/composables/nativeBridge.ts`、`frontend/android/app/src/main/java/com/nexusmatrix/app/ui/NexusApp.kt`、`FavoritesScreen.kt`、`SettingsScreen.kt`
