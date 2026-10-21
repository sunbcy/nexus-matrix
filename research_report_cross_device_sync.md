# Android 与 Web 端数据一致性与联动：现状分析与可行方案

## 执行摘要

你的两端目前**没有建立可靠的一致性**——不是"有小毛病"，而是架构上有四个会**必然丢数据**的设计缺陷，其中最严重的一条是：**App 每次启动时，本地数据都会无条件上推并覆盖服务端**。也就是说，手机离线编辑一周后联网启动，会把电脑上的新改动整体冲掉。

但同时有个好消息：**这个问题不需要换编辑器内核就能解决**。Yjs/Automerge 是为"多人同时编辑同一段文字"设计的，而你的场景是"同一个人的两台设备"——真实的冲突频率是"同一块在两台设备上都被改"，概率极低。用**块级 LWW + 墓碑删除 + 上传队列**就能覆盖，工程量比换内核小一个数量级。

本文先给出经过代码验证的现状与失效点，再给出候选方案对比与分阶段落地建议。

---

## 一、现状：数据到底怎么走的

### 1.1 整体数据流

```
[Android WebView]                    [桌面浏览器]
   本地 IndexedDB                      本地 IndexedDB
        │                                   │
        │ WebSocket 全量 CLIENT_UPDATE      │
        └──────────► [Python 后端] ◄────────┘
                      SQLite: 一行=一页
                      data 列 = 整页 JSON
                      LWW: updatedAt 字符串比较
                           │
                           └─ 全量 SERVER_BROADCAST → 除发送者外的所有连接
```

后端 `main.py:29-32` 用 SQLite，一行一页，`data` 列存**整页 JSON**（含全部 `tasks`）：

```python
_conn.execute("CREATE TABLE IF NOT EXISTS pages (id TEXT PRIMARY KEY, data TEXT, updated_at TEXT)")
```

冲突仲裁只有一处，`main.py:71`：

```python
merged[pid] = inc if inc_ts >= cur_ts else cur   # 整页 LWW
```

广播是全量而非增量，`main.py:195-206`：收到任一客户端的 `CLIENT_UPDATE` 后，把整表重算再广播给**除发送者外的所有连接**。

### 1.2 一个反直觉的事实：前端其实已经做了块级合并

既有结论里说"本地有数据时一律忽略远端全量"，但代码已经演进过——现在 `useSync.ts:85-110` 有 `mergePages()`，`onmessage` 里 `:344-357` 会拿本地与远端做合并而不是丢弃。

**但合并逻辑本身有个致命缺陷**，`useSync.ts:102-105`：

```ts
// 两端都有：保留远端版本（远端广播即代表其它端的最新提交）。
// 注：此处刻意不做逐块 updatedAt 比较——content 字段没有独立的 updatedAt，
// 用页面级 updatedAt 判断会导致「本地刚编辑的块被旧远端覆盖」。
Object.assign(lt, rt);
```

**无条件用远端覆盖本地块**。这不是合并，是"远端优先"。后果见下节 F2。

---

## 二、失效点清单（按严重性排序）

### F1（致命）启动即覆盖：本地数据无条件上推

`useSync.ts:556-561`，`initSync` 在"本地与远端都有数据"时：

```ts
} else if (local && remote) {
    // 本地与远端都有：保留本地，但把本地上推到服务端
    await pushAll(pagesRef.value);
}
```

而 `pushAll`（`:280`）与 `persistPages`（`:238`）都会**无条件给每一页打上当前时间戳**：

```ts
const stamped = pages.map(p => ({ ...p, updatedAt: Date.now() }));
```

配合后端 `>=` 的整页 LWW，结果是：**最后推送的一方，所有页面全部获胜**。

触发场景（这就是你感觉"不一致"的主因）：
- 手机离线编辑一周 → 电脑在这期间改了很多 → 手机联网启动 → 手机把本地数据（时间戳全是 now）推上去 → **电脑的改动被整体覆盖**。
- 反之亦然：电脑启动时也会无条件上推。

即便本地明明是旧数据，也因为时间戳被刷成 now 而"赢"。**这是必然丢数据，不是偶发。**

### F2（致命）防抖窗口内的本地编辑被远端覆盖

`mergePages` 的 `Object.assign(lt, rt)` 意味着：任何一次远端广播到达，本地所有同名块都会被远端版本替换。

触发场景：
- A 端在 500ms 防抖窗口内刚编辑了块 Y（尚未广播）
- 此时 B 端的广播到达
- A 的块 Y 被 B 的**旧版本**覆盖 → A 的编辑丢失，且无任何提示

由于广播是"全量、且服务端在任一客户端更新时都会广播"，这种覆盖在两端同时在线时会**频繁**发生。

### F3（严重）删除不会同步，且会被复活

后端 `main.py:72-74` 明确保留服务端独有的页：

```python
for pid, p in existing.items():
    if pid not in merged:      # 服务端独有的页一律保留
        merged[pid] = p
```

同时 `DELETE /api/pages/{id}`（`:165-170`）以及三个写端点（POST/PUT/DELETE）**都不做 WebSocket 广播**（只有 `:173` 的 WS 路径会广播）。

后果：一端删除页面后，另一端仍持有该页，下一次 `CLIENT_UPDATE` 会把它**推回服务端**，已删除的页面复活。删除语义在整个系统里不存在。

### F4（严重）移动端断线后不再自动重连

`useSync.ts:388-395`：

```ts
const MAX_RECONNECT_ATTEMPTS = 5;
...
if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    syncStatus.value = 'offline';
    lastSyncError.value = '后端未连接，已切换纯本地模式（点击同步状态可重试）';
}
```

移动端 App 切后台后 WebSocket 断开（Android Doze / App Standby 会挂起网络），5 次重连失败后**永久停在纯本地模式，必须用户手动点击同步指示器才重试**。

触发场景：手机锁屏一晚 → 第二天打开 App 仍在纯本地模式 → 你以为在同步，其实没有。

### F5（严重）Android 端不配置 syncServer 时根本连不上

Android WebView 的 `location.host` 不是后端地址。`capacitor.config.ts` 配了 `androidScheme: 'https'`，所以 WebView 里的 origin 是 `https://localhost`，`API_BASE` 默认是 `/api`（`useSync.ts:154`）→ 请求打到 `https://localhost/api`，也就是 WebView 自己的本地服务器，**永远到不了后端**。

必须在设置面板里填局域网地址（如 `http://192.168.1.10:8010`）。未配置时，Android 端 100% 是纯本地模式，与 Web 端**不可能**一致。

### F6（中等）图片资产完全不参与同步

图片以 Blob 存在 IndexedDB 的 `assets` store，页面里只留 `asset:<id>` 引用（`assets.ts`）。同步只传页面 JSON（含 `asset:` 引用字符串），**Blob 本身不上传**。

后果：另一端拿到的是一个指向本地不存在资产的引用，图片显示为空白（`resolveAssetUrl` 返回空串）。

### F7（中等）块顺序用 prevId 链表，并发移动会成环

`orderTasks()` 依赖 prevId 链恢复顺序，且 `writePrevIds` 只在部分路径维护。两端并发移动块时，链表可能成环或断链，而 LWW 修复不了结构性问题。

### F8（轻微）后端并发无锁

`check_same_thread=False`（`:30`），`pages_db` 被 WS 协程与 FastAPI 线程池同时读写，无锁保护。

---

## 三、为什么不需要 CRDT（先破除一个直觉）

业界方案的对比结论是：**CRDT 的成本，只有"多人同时编辑同一段文字"才付得值。**

关键约束在于你的内核：Yjs 官方 binding 只有 ProseMirror / Tiptap / Monaco / Quill / CodeMirror / Remirror / Milkdown / Slate，**裸 contenteditable 没有官方 binding**（Yjs 官方 Editor Bindings 页，【官方证实】）。而你的块 `content` 是整体 HTML 字符串——如果把它塞进 `Y.Map` 当不透明值，**CRDT 就退化成块级 LWW，字符级合并的收益为零**，却付了换内核的全部成本。

版本现状（2026 下半年，【官方证实 · npm registry】）：`yjs` 13.6.33（纯 JS，2.3MB）、`@automerge/automerge` 3.5.0（含内联 wasm，47.5MB，浏览器端必须加载 WASM）。Automerge 在移动端 WebView 的首屏成本明显高于 Yjs。两者都需自建 WebSocket 服务端（Yjs 官方无托管服务）。

对"同一个人的两台设备"而言，真正的冲突是"同一块在两端都被改"，概率极低。用**块级 LWW + 冲突时不静默丢弃**即可覆盖。

### 候选方案对比

| 方案 | 换内核 | 离线编辑 | 冲突表现 | 工程量 | 主要局限 |
|---|---|---|---|---|---|
| 整页 LWW（现状） | 否 | 能 | 后写整页胜，先写全丢 | 已实现 | F1–F4 全部致命缺陷 |
| **块级 LWW + 墓碑** | **否** | 能 | 不同块的并发改动都保留；同块并发仍整块覆盖 | **中（1–2 周）** | 同块并发仍不可合并；需解决块顺序（F7） |
| 操作日志 oplog | 否（但需可重放命令） | 能 | 可做语义合并 | 大（1–2 月） | `updateBlock{html}` 是整串替换，语义合并退化回 LWW；日志压缩与重放 bug 难 |
| CRDT（Yjs/Automerge） | **是**（裸 contenteditable 无官方 binding） | 天生支持 | 自动收敛 | 很大（2–6 周换内核，自写 binding 数月且高风险） | 整串 HTML 会退化成块级 LWW；自写 binding 遇中文 IME/富文本粘贴极易错 |
| 托管同步（PowerSync / PouchDB） | 否（数据层方案） | 能 | 行级/文档级 LWW 或服务端仲裁 | 中~大（数据模型改造） | **不提供文本合并**；需后端改造成关系表/文档库；两端存储栈不同 |

结论：**块级 LWW 是你的最佳性价比选择**。它直接消除 F1/F2/F3，不需要动编辑器内核。

---

## 四、推荐方案（分三阶段，均不换内核）

### 阶段一：止血（必做，解决"必然丢数据"）

**1.1 给块加独立时间戳，改掉无条件覆盖**

- 块结构增加 `updatedAt`（块级），页面级字段各自带 `updatedAt`（title / icon / cover / isFavorite）。
- `mergePages` 从"远端优先"改为**逐块比较**：`remote.updatedAt > local.updatedAt` 才采用远端，否则保留本地。这直接消除 F2。
- 页面级属性同理：逐字段比较，而不是整页替换。

**1.2 停止无条件给所有页打时间戳**

`persistPages`（`:238`）和 `pushAll`（`:280`）的 `pages.map(p => ({...p, updatedAt: Date.now()}))` 必须删除，改为**只给真正变更的页/块打戳**。这是 F1 的直接成因。

配合此改动，`initSync` 的"本地与远端都有就 `pushAll`"就安全了——因为不再靠时间戳刷赢。

**1.3 删除改为墓碑**

- 页面与块增加 `deletedAt` 字段，删除 = 打墓碑而非真删。
- 后端 `_merge_pages` 保留墓碑，同步时传播墓碑；客户端收到墓碑则本地移除。消除 F3。

**1.4 修复移动端重连**

`MAX_RECONNECT_ATTEMPTS` 达上限后，改为**监听 `visibilitychange`/`online` 事件自动重试**（App 回到前台时触发），而不是要求用户手动点击。消除 F4。

### 阶段二：可靠（建议做）

**2.1 上传队列 + 确认机制**

WebSocket 发完就完（`main.py` 无 ack）不可靠。改为：
- 本地维护待确认队列，服务端处理完回 ack；
- 断线期间入队，重连后按序补发。这是"离线编辑不丢"的标准做法。

**2.2 增量同步**

现在是全量广播（`main.py:195-206` 整表重算后推全量）。改为按 `since=<cursor>` 只推变更页。对移动端流量与首屏都有明显收益。

**2.3 图片资产同步**

为 `assets` 增加 HTTP 端点（上传/下载 Blob），页面同步后按需拉取缺失资产。消除 F6，否则另一端永远看到破图。

### 阶段三：健壮（可选）

**3.1 块顺序独立化**：把 prevId 链表改为服务端权威序列或 fractional index，消除 F7。

**3.2 冲突可见化**：同块并发冲突时，保留双方版本（如生成冲突副本块）而不是静默覆盖。单用户场景下冲突概率极低，但保留比丢弃安全。

**3.3 Android 端后台同步**：若要求"回到前台即已同步"，可评估 Capacitor 的后台同步方案。需注意 Android Doze 会挂起网络、App Standby 限制后台访问频率，官方推荐 FCM 而非自维护长连接；普通应用不能请求电池优化豁免（Play 政策）。

---

## 五、关键决策点与假设

1. **本文按"单用户多设备同步"设计**，依据是问题里的"我的安卓和 web 端"。若你实际要的是**多人实时协同**，则结论改变：必须换内核（Tiptap/ProseMirror + y-prosemirror），成本上升一个数量级。
2. **阶段一不改变"同块并发"的合并能力**——同一块在两端同时被编辑时，仍是一方覆盖另一方。若这个行为不可接受，才需要考虑 CRDT。
3. **后端需改造**：`_merge_pages` 的整页 LWW、写端点不广播、无 ack，都要动。这不是纯前端能解决的。
4. 时间同步假设：块级 LWW 依赖各端时钟。若时钟漂移大（设备间相差数分钟），会出现"新编辑被旧编辑覆盖"。建议服务端在收到时**盖服务端时间戳**做仲裁，而不是信任客户端时间。

## 六、局限

本文的失效点结论均经代码行号验证；移动端网络行为（Doze/App Standby 的具体表现）取自 Android 官方文档摘要，未在真机实测。Yjs/Automerge 的版本信息取自 npm registry（2026-09 前后）。未做真机跨端同步实测，建议阶段一落地后用"手机离线编辑 → 联网 → 电脑查看"这一条路径做端到端验证。

## References

1. [Yjs — Editor Bindings（官方，列出支持的编辑器绑定）](https://docs.yjs.dev/ecosystem/editor-bindings)
2. [Yjs — Offline Support / Persisting the Document（官方）](https://docs.yjs.dev/getting-started/allowing-offline-editing)
3. [Yjs on npm（13.6.33）](https://www.npmjs.com/package/yjs)
4. [@automerge/automerge on npm（3.5.0）](https://www.npmjs.com/package/@automerge/automerge)
5. [Android 开发者文档 — 针对低电耗模式和应用待机模式进行优化](https://developer.android.com/training/monitoring-device-state/doze-standby)
6. [PowerSync — 官方文档](https://docs.powersync.com/)
7. [PouchDB — 官方文档](https://pouchdb.com/)
8. 本地代码证据：`backend/main.py`、`frontend/src/composables/useSync.ts`、`assets.ts`、`runtimeConfig.ts`、`frontend/capacitor.config.ts`
