# 封面图库可选方案分析（Unsplash 及其他）

> 背景：`PageCoverPicker.vue` 目前支持本地上传（canvas 降采样）、外部 URL、5 种渐变色。
> 用户希望接入 Unsplash 图库，并想了解还有哪些可选。本文对比各方案的技术与合规可行性，
> 所有 CORS 结论均为 2026-10-14 实测（curl 预检 + 真实下载），非文档推测。

---

## 一、核心结论先说

**技术上只有 Unsplash、Pexels、Pixabay 三家可行**，且都**必须用户自备 API Key**。
这带来一个绕不开的架构问题：Key 放哪里。

我的建议是：**优先做 Unsplash（Notion 同款），Pexels 作为第二来源；Key 由用户在设置里自填、存 localStorage，前端直连**。理由是这套架构与项目的 LocalFirst 定位一致——纯本地模式依然可用，不引入后端依赖。Picsum 虽然零门槛，但**不能用于封面**（见下文实测）。

---

## 二、四家方案实测对比

| 维度 | Unsplash | Pexels | Pixabay | Lorem Picsum |
| --- | --- | --- | --- | --- |
| 需要 API Key | 是（Client-ID） | 是（Authorization 头） | 是（`key` 查询参数） | **否** |
| 速率限制 | demo 50 次/时；正式 1000 次/时 | 200 次/时 + 20000 次/月 | 100 次/60 秒 | 文档未说明 |
| API 支持 CORS | **是**（`allow-origin: *`，预检允许 `authorization`） | **是**（`allow-origin: *`，预检返回 `allow-headers: authorization`） | **是**（`Access-Control-Allow-Origin: *`） | — |
| 图片 CDN 支持 CORS | **是**（`images.unsplash.com` 返回 `*`） | **是**（`images.pexels.com` 返回 `*`） | **是**（`cdn.pixabay.com` 返回 `*`） | **否**（`picsum.photos` 图片响应无任何 CORS 头） |
| 能否走「下载→压缩→本地存储」 | **能** | **能** | **能** | **不能** |
| 署名要求 | 必须（摄影师 + Unsplash） | 必须（"Photos provided by Pexels" + 摄影师） | 必须（标明来源 Pixabay） | 图源为 Unsplash |
| 额外合规约束 | 每次选用须调 `/photos/:id/download` 端点；裁剪缩放须保留 URL 中的 `ixid` 参数 | 禁止复刻 Pexels 核心功能（如做成壁纸 App） | **禁止 hotlinking**，图片须下载到自有存储；结果须缓存 24 小时 | — |

### 关于 Picsum 的重要更正

Picsum 常被推荐为「零门槛图库」，但**它不适合做封面**，原因是实测发现 `picsum.photos` 的图片响应（经 302 跳转到 fastly CDN）**不带任何 CORS 头**。这意味着：

`<img src>` 直接渲染没问题，但一旦想 `fetch()` 取字节流做 canvas 压缩，浏览器会以 CORS 为由拦截；而把跨域图片画进 canvas 后，该 canvas 被「污染」，`toDataURL()` 直接抛 `SecurityError`。

所以 Picsum 只能整条热链 URL，无法纳入我们既有的「压缩后本地存储」流程——而热链又意味着封面依赖外部服务可用性，且体积不受控。它作为「占位图预览」可以，作为正式封面源不推荐。

---

## 三、绕不开的架构问题：API Key 放哪

三家都要 Key，这是选型时最该先想清楚的。三种放法：

**放前端 bundle**。Unsplash 的 Client-ID 可用查询参数传递，Pixabay 的 `key` 也是查询参数，Pexels 的 Authorization 头也已实测允许预检——三家都支持浏览器直连。代价是 Key 会暴露在打包产物里。对本项目「先保证个人可用」的定位，**这是可接受的**：Key 由用户自己在设置里填、存 localStorage，不进入代码仓库，泄露范围仅限于用户自己的浏览器。

**放后端代理**（FastAPI 加一层 `/api/cover/search`）。Key 留在服务端更安全，且能统一做缓存。代价是纯本地模式失效——没起后端就用不了图库，这与 LocalFirst 定位冲突。

**混合**。默认前端直连；后端可选启动时提供代理，前端检测到后端可用则优先走代理。

推荐第一种，理由与项目定位一致：图库是「增强功能」，不该让它的可用性绑定后端。若将来要多用户共享，再加代理层不迟。

---

## 四、推荐方案

### 第一阶段：Unsplash

Notion 用的就是它，用户审美预期已经被它塑造，且 demo 模式 50 次/时足够个人浏览选图。接入点：

搜索用 `GET https://api.unsplash.com/search/photos?query=x&per_page=30&client_id=KEY`，取 `results[].urls.raw` 配合 `w=1600&h=600&fit=crop` 参数生成缩略图；用户选定后按既有 `processImage` 流程下载并压缩存储。

两个合规细节必须实现，否则属于违规：选用时要调 `GET /photos/:id/download`（纯计数端点，类似 GA 的 pageview）；对 `urls.raw` 做裁剪时**必须保留 URL 里的 `ixid` 参数**。另外要在 UI 某处标注摄影师署名与 Unsplash 来源——建议放在封面浮层的图片信息里。

### 第二阶段：Pexels

作为第二来源，与 Unsplash 共用同一套 Provider 抽象。差异仅在于：Key 走 `Authorization` 头而非查询参数；速率是 200/时 + 2 万/月；署名格式是 "Photos provided by Pexels"。

### 第三阶段（可选）：Pixabay

价值在于它有矢量图与插画，且支持 JSONP。但合规最严——**禁止热链**、结果须缓存 24 小时、单次查询最多 500 条。我们的设计本来就是下载后本地存储，所以热链禁令天然满足；但「缓存 24 小时」需要额外做一层搜索结果缓存，复杂度上升。建议放到最后，或不接。

### 不推荐：Picsum

如上，无 CORS 无法压缩。若只是想给空页面一个占位预览，可直接用渐变色（已实现），无需引入它。

---

## 五、落地设计（若实施）

**Provider 抽象**：`frontend/src/composables/imageProviders.ts` 定义统一接口 `{ id, name, needsKey, search(query, page), toThumb(photo), toFull(photo), credit(photo) }`，Unsplash / Pexels / 渐变各实现一份。`PageCoverPicker` 改为按当前 Provider 渲染，新增「来源」切换页签。

**Key 存储**：设置面板加「图库 API Key」输入，存 localStorage 独立键（如 `nexus_image_provider_keys`），不参与页面数据同步——避免 Key 被广播到其它设备。

**署名展示**：选定图片后，在封面浮层或页面底部以小字显示 `Photo by X on Unsplash`，链接到摄影师主页。这是三家共同的硬性要求。

**降级策略**：未配置 Key 时，图库页签显示「需要 API Key（点击设置）」并直接链接到对应平台的申请页，不阻塞本地上传与渐变色两条路径。

---

## 六、Sources

1. [Unsplash API Documentation](https://unsplash.com/documentation) — 鉴权、demo 50/h 与正式 1000/h、attribution 与 download 端点要求、ixid 约束
2. [Pexels API Documentation](https://www.pexels.com/api/documentation/) — Authorization 头鉴权、200/h + 20k/月、attribution 格式、端点与参数
3. [Pixabay API Documentation](https://pixabay.com/api/docs/) — key 参数鉴权、100 次/60 秒、24 小时缓存要求、禁止 hotlinking、JSONP 支持
4. [Lorem Picsum](https://picsum.photos/) — 无需 Key、URL 格式、图源为 Unsplash
5. 实测（2026-10-14，curl）：`api.unsplash.com` / `api.pexels.com` / `pixabay.com/api` 均返回 `Access-Control-Allow-Origin: *`；`api.pexels.com` 预检返回 `access-control-allow-headers: authorization`；`images.unsplash.com` / `images.pexels.com` / `cdn.pixabay.com` 均返回 `Access-Control-Allow-Origin: *`；`picsum.photos` 图片响应无 CORS 头
