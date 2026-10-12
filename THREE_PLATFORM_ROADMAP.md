# 三端接入路线图（Android / iOS / Windows）

> 前提约束（2026-10-13 确定）：**先保证个人可用，但不能影响后续三端同步。**
> 因此本轮没有引入 Yjs/Automerge，而是把「将来会堵死三端的决策」提前修正，
> 让后续接入变成增量工作而非重写。

---

## 一、本轮已完成的三端前置改造

这些改动单看都不改变当前体验，但它们决定了三端接入是「增量」还是「重写」。

### 1. 存储层抽象为异步 KV 接口

新增 `frontend/src/composables/storage.ts`，导出 `KeyValueStore` 接口（`get` / `set` / `remove` 全为 Promise）与 `setStore()` 切换函数。

为什么必须是异步：`localStorage` 是同步 API，而 **Capacitor 的 `Preferences` 插件（Android/iOS 官方推荐，因为 iOS 会在存储压力下清理 localStorage）与 Tauri 的 store 插件都是异步的**。如果现在用同步 API，接入三端时所有调用点都要改。

`useSync.ts` 内的 `loadLocal` / `saveLocal` 已全部改为 `await getStore()`。接入时只需一行：

```ts
// Capacitor
import { Preferences } from '@capacitor/preferences';
setStore({
  get: async (k) => (await Preferences.get({ key: k })).value,
  set: async (k, v) => { await Preferences.set({ key: k, value: v }); },
  remove: async (k) => { await Preferences.remove({ key: k }); },
});
```

另外补了一个此前会静默丢数据的坑：写入超限（图片 Base64 很容易撑爆 5MB 配额）时现在会 `throw` 并打印错误，而不是无声失败。

### 2. ID 生成改为全局唯一

新增 `frontend/src/composables/ids.ts`，`newBlockId()` / `newPageId()` 基于 `crypto.randomUUID()`，非安全上下文（如局域网 http 调试）回退到带随机后缀的时间戳。

替换了编辑器内全部 10 处 `Date.now().toString()`。原因不只是「同一毫秒连续创建会撞 ID」——**CRDT 合并要求 ID 全局唯一且稳定**，时间戳方案在多设备并发下必然碰撞。

### 3. 顺序模型：数组下标 → prevId 链

这是为三端并发插入做的核心准备。`useSync.ts` 新增 `prevId` 字段与三个函数：

`writePrevIds(tasks)` 把数组下标顺序写成 prevId 链；`orderTasks(tasks)` 由链还原为有序数组；`mergePages(local, remote)` 做页面级合并。

**为什么必须改**：三端同时在不同位置插入块时，仅凭数组下标无法确定性地重建顺序（必然冲突，且结果取决于消息到达次序）。改用「每个块记录父级下前一个块的 ID」后，任何一端执行同一套算法都得到同一结果，无需中央仲裁。

Enter 拆块路径已接入：新块 `prevId = 当前块`，原后继块的 `prevId` 更新为新块，并一次性重写整条链兜底修复历史数据。老数据首次加载时 `prevId` 缺失，由 `writePrevIds` 自动补齐（已实测验证）。

### 4. 同步层从「整页覆盖」改为「按块合并」

原来收到远端广播时的逻辑是：本地有数据就整页丢弃远端。这意味着**两台设备各自编辑后，只有一方能活下来**。

现在改为 `mergePages()`：页面按 id 匹配（本地新增/远端新增的页面都保留，不会再被对方抹掉），页面级属性取 `updatedAt` 较新者，任务块按 id 合并（各自新增的块都保留），顺序由 `orderTasks()` 依 prevId 链确定性重建。同时给本地变更的页面打 `updatedAt` 时间戳。

### 5. 移动端触屏选区

三端里移动端是交互差异最大的。补了单指触屏选区：`touchstart` / `touchmove` / `touchend` 三个监听器与鼠标路径**共用同一套逻辑选区引擎**（`caretInfoFromPoint` + `applyLogicalSelection`），拖动时 `preventDefault` 阻止页面滚动。另外手柄（+ 与拖拽菜单）原本只靠 `:hover` 显示，触屏设备永远看不到，已改为「聚焦该块时常驻显示」，并给手柄加了 `@touchstart` 入口。

---

## 二、后续三端接入步骤

### Android / iOS（Capacitor）

预计 3–5 人天，主要是配置而非逻辑。

1. `npx cap init`，`npm i @capacitor/core @capacitor/cli`，按平台装 `@capacitor/android` / `@capacitor/ios`。
2. `npm i @capacitor/preferences`，按上面的代码 `setStore()` 替换存储实现。
3. 处理后端地址：WebView 中 `window.location.host` 不是你的服务器，需改为配置项（建议加 `VITE_SYNC_SERVER` 环境变量，`API_BASE` 与 `WS_PATH` 从它派生）。
4. `npx cap add android && npx cap sync`，用 Android Studio / Xcode 构建。
5. 触屏已支持，但需真机回归：软键盘弹出时的布局（`env(safe-area-inset-bottom)`）、横竖屏切换、双指缩放。

### Windows（Tauri 或 Electron）

预计 2–4 人天。**推荐 Tauri**：产物体积远小于 Electron（数 MB vs 上百 MB），且自带 store 插件。

1. `npm i -D @tauri-apps/cli`，`npx tauri init`。
2. `npm i @tauri-apps/plugin-store`，`setStore()` 替换为 Tauri store。
3. 同样处理后端地址配置。
4. 若选 Electron，则用 `electron-store`，并注意渲染进程的 `localStorage` 可用但同样建议走 store。

### 后端

`backend/main.py` 当前按「整页 JSON + `updatedAt` LWW」存储。三端并发下这会成为瓶颈，两个方向：

短期（1–2 人天）：保持整页模型，但在服务端也调用 `mergePages`，让服务端成为「合并点」而非「最后写入者」。多个客户端的编辑都能进来。

中期（若要真正实时协同）：迁移到 Yjs + `@tiptap/extension-collaboration`，但这需要先把编辑器内核换成结构化文档模型（裸 DOM 承载不了 Yjs）。**这是个独立决策**，见 `tiptap_migration_assessment.md` 的方案对比。

---

## 三、已知局限（如实说明）

**块内 content 仍是整体字符串，无法做字符级合并。** 两端同时编辑同一个块时，仍会有一方被覆盖——只是不会再扩散到整页。这是当前架构的硬边界，要真正解决必须引入 CRDT 结构。

**后端仍是整页覆盖模型。** 前端的 `mergePages` 只能保证「本地收到广播时不丢自己的编辑」，但服务端自身的存储与广播逻辑还是 LWW。三端并发编辑同一页面时，服务端那一跳仍可能丢数据。短期方案见上一节。

**顺序模型依赖「插入时维护链」。** 目前只有 Enter 拆块和 + 按钮两条路径显式维护了 prevId，其余增删块路径靠 `writePrevIds` 在拆块时顺带重写整条链兜底。如果后续新增块路径（如拖拽排序、批量粘贴），需要一并维护，否则链可能断裂——`orderTasks` 对断链的处理是「按 id 字典序追加」，不会崩但顺序可能不符合直觉。

**未做离线冲突提示。** 用户看不到「你的编辑与另一台设备有冲突」。

---

## 四、验证记录

`vue-tsc -b` 全绿，`vite build` 通过。冒烟测试（Chromium headless，连接真实后端）：

从后端恢复的老数据（无 `prevId` 字段）正常加载并渲染 3 个块；在第一块末尾按 Enter 后，localStorage 中的块序列为 `a → b-133c3f(UUID) → b → c`，新块 ID 为合法 UUID，`prevId` 链完整无断裂，老数据的缺失字段被自动补齐。

过程中修掉一个自伤 bug：补触屏监听器时不慎删除了 `mouseup` 处理器并造成 `onMounted` 花括号未闭合，表现为模板所有绑定报错。已用花括号配平脚本定位并修复。
