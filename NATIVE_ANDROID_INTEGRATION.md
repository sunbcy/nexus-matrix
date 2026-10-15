# 原生 Android（Kotlin）与现有平台联动方案

> 评估日期：2026-10-15。关键事实均来自官方一手来源并已标注。
> 本回答的是「如何联动达到 Notion 级」，因此分两层：**联动的架构可行性**，以及**Notion 级在原生端的真实成本**。

---

## 结论摘要

**「原生 Kotlin app 与现有平台联动」完全可行，但必须区分两件事：编辑器内核，和编辑器之外的一切。**

最关键的事实：**Notion 自己的移动端就是原生壳 + WebView 编辑器**。他们 2019 年试过 React Native，用户反馈「即使在新 iPhone 上也要 6–7 秒才能开始输入笔记」，2020 年放弃转向 Hybrid；2022 年起逐个把首页、导航替换为原生（启动快 2–3 倍），但其前端负责人的原话是「**在可预见的未来，编辑器可能仍然是一个 webview**」，并类比 Google Docs、Quip、Dropbox Paper、Coda 都是同一架构。

也就是说：**连 Notion 都不用原生写编辑器。** 我们如果走纯原生编辑器路线，是在挑战一个连头部产品都回避的问题。

**联动方案因此清晰**：数据层与同步协议完全共享（这是「联动」的实质），UI 层走 Notion 同款的原生壳 + WebView 编辑器，再按优先级把非编辑器部分逐步原生化。

---

## 一、联动的架构：哪些共享、哪些分叉

```
┌─────────────────────────────────────────────┐
│  共享层（联动的实质）                          │
│                                             │
│  · 数据模型：Page / Task 结构 + prevId 链      │
│  · 合并语义：块级 LWW + 服务端仲裁              │
│  · 同步协议：WebSocket JSON，两端各自实现       │
│  · 后端：FastAPI + SQLite（改造成合并服务器）   │
└─────────────────────────────────────────────┘
        ↑                          ↑
┌───────┴────────┐        ┌────────┴────────┐
│  Web / 桌面端   │        │  Android 原生端 │
│  Vue 3 + Vite  │        │  Kotlin + CMP   │
│  （编辑器在这里）│        │  （编辑器=WebView）│
└────────────────┘        └─────────────────┘
```

**共享层的三个决定项**：

**数据模型需要一次结构化改造。** 当前 `content` 是整体 HTML 字符串，这是联动的最大障碍——原生端解析 HTML 拿不到块结构。需要把 `content` 拆成结构化表示（如 `{ spans: [{ text, marks: [] }] }` 或 ProseMirror JSON）。这一项不做，后面全部免谈。

**同步协议走「自研 + LWW」，不要引入 CRDT。** Google 官方《Build offline-first apps》明确为移动场景推荐 LWW（最后写入生效，设备附时间戳，网络数据源作为最终仲裁者）。而 CRDT 路线在原生端走不通：Yjs 的 Kotlin 绑定 `ykt` **已停用**，`y-uniffi` 只生成 Swift 绑定且标注 WIP；Automerge 的 Kotlin 绑定未能确认存在。Android 端目前**没有可用的 CRDT 库**。

**schema 共享用 protobuf 或 CBOR。** 注意 `kotlinx.serialization` **不会生成 TypeScript 代码**，且除 JSON 外（CBOR/ProtoBuf）全部标注 Experimental。现实路径是 Kotlin 侧用 `kotlinx-serialization-json`（Stable），TS 侧手写类型。AppFlowy 用 protobuf 做 FFI 边界的先例存在，但成本更高，MVP 阶段不必。

---

## 二、Notion 级在原生端的真实成本

### 官方 API 远未就绪

Compose Foundation 1.12.1 stable（2026-09）中：

**富文本编辑 API 仍是实验性**，且连续两次破坏性重构（1.12.0-alpha03、1.13.0-alpha03 改为基于 `CommonStyle`，旧 `Style` 实现将废弃移除）。可用的稳定部分只有：`BasicTextField(TextFieldState)` + `OutputTransformation` + `TextFieldBuffer.addStyle()` + `undoState`（**仅限单个 TextField 内部**）。

**中文输入法有实锤 bug。** Compose Multiplatform 1.8.0 release notes 明确修复过「`OutputTransformation` 的输出在使用输入法（Chinese…）时错误地渗入未转换文本本身」。这正是我们 Web 端花了很大力气处理的那类问题——而 Compose 侧的修复历史说明它同样需要持续适配。

**跨块选择没有稳定 API。** 官方仍是 `TextRange` + `SelectionContainer` 级别。

### 唯一可参考的开源实现规模

`linreal/cascade-editor`（README 自称 "the Notion/Craft editing model, natively in Kotlin"）是目前唯一直接对标物。它的规模是客观的工作量下限：

- **2,185 个测试函数 / 179 个测试源文件**
- 六层严格依赖架构（UI / Text State / State / Action / Registry / Core）
- 自述核心难点：保持 live `TextFieldState` 与 immutable document state 对齐；在 split/merge/replace/typing/**undo/redo** 全过程中保持富文本 span 不丢失；缩进、拖拽、序列化全部放进共享 Kotlin `commonMain`

它自述「原生文本选择被限制在单个块内（无法跨块连续选择）」——而这正是我们 Web 端已用逻辑选区引擎解决的问题。

**结论：原生 Notion 级编辑器不是一个季度能收尾的活。**

---

## 三、推荐路线：Notion 同款分阶段原生化

### 阶段 1：原生壳 + WebView 编辑器（约 5–8 人天）

Kotlin + Jetpack Compose 写应用外壳（首页、页面列表、导航、设置），编辑器用 WebView 加载现有 Vue 前端。这一阶段：

- 用户立即获得原生应用的启动速度、离线能力、系统集成（分享、小部件、通知）
- 编辑器体验与桌面端完全一致（同一套代码，不会分叉）
- 成本极低，因为外壳不涉及编辑器逻辑

Notion 2022 年只把首页原生化就换来 iOS 启动 2 倍 / Android 3 倍——这是他们验证过的路径。

**技术要点**：
- WebView 加载 `file:///android_asset/index.html`（打包前端产物）或远程 URL
- 用 `WebViewAssetLoader` 或自定义 `WebViewClient.shouldInterceptRequest` 拦截本地资源请求
- 原生壳与 Web 层通过 `addJavascriptInterface` 或 `postMessage` 双向通信（传递页面 id、触发分享、通知等）
- 后端地址通过 Intent extra / BuildConfig 注入，走第一步已做的 `VITE_SYNC_SERVER` 机制

### 阶段 2：数据层对齐（约 10–15 人天，需先完成 Web 端结构化改造）

- Kotlin 侧 Room schema 与 Web 端 IndexedDB 表结构 1:1 对齐
- 用 Kotlin 复刻同一份合并函数：`updatedAt` 比较 + **确定性 tiebreaker（如 blockId）**，避免时钟漂移导致双端不一致
- Kotlin 实现现有 WebSocket JSON 协议客户端
- 写入走 WorkManager（`NetworkType.CONNECTED` + 指数退避），符合 Google 官方 offline-first 推荐

**这一阶段是「联动」的真正落地。** 完成后两端操作同一份逻辑数据，各自离线编辑，联网后由服务端仲裁合并。

### 阶段 3：按优先级原生化非编辑器部分（每项 3–10 人天）

候选：首页/页面列表（最高优先，Notion 第一个原生化的就是它）、搜索、数据库视图、小部件、分享扩展。**编辑器保持 WebView**，除非 Compose 官方 RichText API 转 stable。

### 阶段 4（可选）：原生编辑器

只有当两个条件同时满足才考虑：Compose 官方 RichText API 已 stable，且我们愿意投入 cascade-editor 级别的工作量（以 2,185 个测试函数为参照）。届时可用 Kotlin Multiplatform 让 Android/iOS/Desktop 共享编辑器 UI——CMP for iOS 自 1.8.0（2025-05）已 stable，这是唯一值得考虑的路径。

---

## 四、达到 Notion 级的必要条件

把「Notion 级」拆开，原生 app 能贡献的和不能贡献的要分清：

| Notion 级要素 | 原生 app 能带来什么 | 前置条件 |
| --- | --- | --- |
| 编辑器交互手感 | **几乎为零**（同一套 Web 代码） | Web 端已实现 |
| 启动速度 / 离线 | **显著**（原生壳） | 阶段 1 |
| 系统集成（分享/小部件/通知） | **独有**，Web 做不到 | 阶段 1、3 |
| 手势（滑动导航、拖拽排序） | 部分，WebView 内仍受 Web 限制 | 阶段 3 |
| 移动端输入体验（IME、选区） | Web 端已处理；原生端需重做且无稳定 API | 阶段 4（不建议） |
| 数据库 | 与端无关，是产品功能缺口 | 独立事项 |
| 实时协同 | 与端无关，需 CRDT 或强服务端仲裁 | 独立事项 |

**判断：原生 app 的价值在「壳」和「系统集成」，不在编辑器。** 如果目标是 Notion 级，真正的缺口是数据库与协作，而这两个都与「是否原生」无关。先做原生壳拿到移动端体验红利，同时补数据库和搜索，比投入原生编辑器更符合 Notion 级的定义。

---

## 五、风险与建议

**最大风险是阶段 2 的数据模型改造。** 当前 `content` 是 HTML 字符串，不结构化则两端无法共享数据。这项改造影响 Web 端所有读写路径（编辑器、导入、导出、撤销栈），工作量约 10–15 人天，且**必须在原生端动工之前完成**。

**次要风险是 WebView 的存储持久性。** Android WebView 的 localStorage 仅 5 MiB 且会被整 origin 驱逐——第一步已切到 IndexedDB + `persist()`，但真机验证尚未做。若 WebView 内 IndexedDB 表现不佳，需要把数据层下沉到原生 SQLite，通过 JS bridge 读写——这会显著增加复杂度。

**我的建议**：走阶段 1 → 2 → 3，**跳过阶段 4**。阶段 1 成本极低而收益明确（Notion 自己验证过），阶段 2 是联动的实质且不依赖原生端先动，阶段 3 按价值排序推进。阶段 4 等 Compose 官方 API 稳定再说——现在投入是在用一个每两个版本就重构一次的实验性 API 打地基。

如果时间有限只能做一件事：**做阶段 1 的原生壳**。它能让你立刻在真机上看到产品形态，又不阻塞任何后续决策。

---

## References

1. [Notion 官方 Release：Faster Mobile Apps, Database Side Peek & More（2022-07-20，原生化进展与「编辑器可能仍是 webview」表述）](https://www.notion.com/releases/2022-07-20)
2. [InfoQ/搜狐：搞不定移动端性能，Notion 从 Hybrid 转向 Native（React Native 6-7 秒输入延迟、团队规模）](https://news.sohu.com/a/575198741_121124372)
3. [Android Developers：Compose Foundation Release Notes（1.12.1 / 1.13.0-beta01，Style API 破坏性重构）](https://developer.android.google.cn/jetpack/androidx/releases/compose-foundation)
4. [JetBrains Blog：Compose Multiplatform 1.8.0 — iOS Is Stable and Production-Ready](https://blog.jetbrains.com/kotlin/2025/05/compose-multiplatform-1-8-0/)
5. [GitHub：JetBrains/compose-multiplatform Release 1.8.0（中文 IME transformation bug 修复记录）](https://github.com/JetBrains/compose-multiplatform/releases/tag/v1.8.0)
6. [GitHub：linreal/cascade-editor（唯一原生 Notion 级参考实现，2,185 测试函数）](https://github.com/linreal/cascade-editor)
7. [GitHub：MohamedRejeb/Compose-Rich-Editor（1,860 star，活跃维护）](https://github.com/MohamedRejeb/Compose-Rich-Editor)
8. [Android Developers：Build offline-first apps（Google 官方推荐 LWW + 服务端仲裁、Repository 单一真相源、WorkManager）](https://developer.android.google.cn/topic/architecture/data-layer/offline-first/)
9. [GitHub：y-crdt/ykt（Kotlin bindings，README 标注 not active）](https://raw.githubusercontent.com/y-crdt/ykt/main/README.md)
10. [GitHub：y-crdt/y-uniffi（仅 Swift 绑定，WIP）](https://raw.githubusercontent.com/y-crdt/y-uniffi/main/README.md)
11. [PowerSync Pricing（Kotlin SDK 为 Alpha，源库仅 Postgres/Mongo/MySQL/SQL Server，Pro $49/月起）](https://powersync.com/pricing)
12. [Kotlin Serialization 官方文档（不生成 TS 代码；仅 JSON 为 Stable）](https://kotlinlang.org/docs/serialization.html)
