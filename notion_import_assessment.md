# Notion 文档导入可行性调研

## 结论

**目前不能。** 平台现有的导入入口只接受一种格式——我们自己的 JSON 备份（`importBackup()` 直接 `JSON.parse` 后按 `Page[]` 结构覆盖），且 `accept="application/json,.json"` 把其他文件挡在选择器之外。Notion 导出的是 ZIP（内含 `.md`/`.csv` + 图片资产），会被这个过滤器拒绝。

但差距不大，而且**这是少数"我们占优"的领域**：Notion 官方明确说明「无法通过重新上传导出的文件来一键重建工作区」，也就是说 Notion 自己都不支持导出的往返。我们如果做了导入，是比 Notion 更强的能力。

评估后的推荐方案是 **Markdown & CSV 导入**，工作量约 3–5 人天，无需后端、无需用户凭据，与 LocalFirst 定位一致。

---

## 一、Notion 到底导出什么（官方口径）

Notion 的导出入口在页面 `•••` 菜单或工作区 Settings → Export，格式三选一：

**PDF** 适合备份，但会丢内容——自定义 emoji 不出现在 PDF 里，整页数据库无法直接打印。

**HTML** 保真度最高，连块级评论（含已解决/未解决状态）都能导出。但代价是产物极其臃肿。

**Markdown & CSV** 是实际可用的结构化格式：非数据库页面导出为 `.md`；整页数据库导出为 CSV，且数据库下每个子页面会附带一个 `.md`。

两个关键开关：

`Include subpages` 决定是否把子页面一并导出，开启后每个子页面成为独立的 `.md`。

`Create folders for subpages` 决定组织方式——开启时每个子页面获得自己的文件夹，`.md` 和该页的图片附件都放在里面；关闭时所有文件平铺在同一层。

**一条对我们有利的官方说明**：Notion 帮助中心明确写着「无法通过重新上传导出的文件来一键重建工作区」。所以做导入不是追赶 Notion，是超出它。

---

## 二、导出包的真实结构（含一个会咬人的坑）

解压后的典型形态：

```
export.zip 解压后
├── My Page.md              # 父页面正文
├── image/                  # 父页面的图片资产
│   └── image-1.png
├── Subpage A/              # 子页面（开启 Create folders 后）
│   ├── Subpage A.md
│   └── screenshot.png
└── Database Name.csv       # 整页数据库（Markdown & CSV 模式下）
```

### 图片有两种形态，第二种会过期

这是本次调研最关键的发现，来自近期的一手迁移记录（2026-10-12）：

**形态 A：本地相对路径。** 图片真的下载进了包里，正文写 `![alt](image/image-1.png)`。位置不变就能看。

**形态 B：S3 预签名外链。** 图片没下载，仍托管在 Notion 的对象存储上，正文写的是带 `X-Amz-Algorithm`、`X-Amz-Expires`、`X-Amz-Signature` 的长 URL。**签名过期后服务器直接返回 403**，表现为「当时能看、过几天陆续全裂」，且和文件位置无关。

对我们这是个必须先决策的点：如果导入时只把 URL 存进 `cover`/`payload.url`，就等于复刻我们刚修掉的 bug——之前粘贴图片用 `blob:` URL，重启后全变破图。**正确做法是导入时就把图片拉下来转 Base64 落成我们的图片块**，趁签名还有效。这也正好复用 `insertImageBlock()` 的既有链路。

### Callout 导出为 HTML，不是 Markdown

官方文档明确说明：Callout 块因为「没有 Markdown 等效语法」会导出为 HTML 代码片段。这意味着解析器不能假设整份文件都是合法 Markdown，必须能处理 `.md` 里嵌 HTML 片段。

### Windows 路径长度限制

官方提到 Windows 默认 260 字符路径限制，深层嵌套子页面文件夹可能解压失败。但这一条**对我们不构成问题**——我们在浏览器内解压 ZIP，不落文件系统。

### 数据库的固有限制

导出数据库时只能选「当前视图」或「默认视图」之一，无法一次导出所有视图；Form 视图目前根本无法导出。

---

## 三、我们平台的现状与差距

现有能力盘点（相对 Notion 导入的需求）：

**已有且可直接承接的块类型**：text、h1/h2/h3、quote、todo、bullet、numbered、toggle、callout、divider、image、codeblock。加上页面的 `icon` / `cover` / `coverPos`，以及 `[[` 双向链接与反向链接——这已经覆盖 Notion 普通页面 80% 以上的内容形态。

**已有的 Markdown 能力**：只有**导出**方向（`htmlToMarkdown` + 块序列化），**导入方向为零**，且项目没有引入任何 Markdown 解析库。

**缺失的块类型**：没有真正的表格块（`kanban` 是固定的三列演示容器，不是表格）、没有书签/嵌入块、没有公式块。Notion 数据库导出的 CSV 没有对应容器可去。

**行内富文本**：已有加粗/斜体/下划线/删除线/行内代码/颜色/高亮/链接。Notion 的 `@` 提及（人/日期/提醒）没有对应结构，只能降级为纯文本。

结论：**普通笔记类页面的导入可以做到较高保真；数据库类页面的导入只能做到"内容不丢、结构降级"。**

---

## 四、三个方案对比

| 方案 | 工作量 | 保真度 | 依赖 | 风险 |
| --- | --- | --- | --- | --- |
| A. Markdown & CSV 导入 | 3–5 人天 | 中高 | 前端 ZIP + MD 解析库 | 低 |
| B. HTML 导入 | 5–8 人天 | 高 | 前端 HTML 解析 | 高（Notion 的 HTML 产物充斥内联样式与自定义 class，选择器极脆弱） |
| C. Notion API 集成 | 5–8 人天 | 最高 | 需用户 integration token，且 token 不应放前端 | 中（需后端代理，违背纯本地可用） |

**推荐 A**，理由：与「先保证个人可用」的定位一致——不需要后端、不需要用户去 Notion 后台建 integration、不需要把 token 交给我们。Markdown 也是三种格式里唯一"人和程序都能读懂"的中间态。

B 的保真度优势在我们这里意义有限：我们要的是块结构，不是视觉复刻。而 Notion 的 HTML 导出为了保真会把所有样式内联，解析它的成本远高于收益。

C 适合将来做「持续同步」时再上，届时 `providerKeys.ts` 那套 Key 管理机制可以直接复用（这次图库做的抽象这时显出价值了）。

---

## 五、方案 A 的落地设计

### 新增依赖

`fflate`（约 8KB gzip，无依赖）做 ZIP 解压。必须用动态 `import()` 按需加载——导入是低频操作，不该让所有用户为它付包体代价。

Markdown 解析建议**手写一个受限解析器**而非引入 `marked`/`markdown-it`。原因：我们不需要完整 CommonMark 兼容，只需要把已知的几种块结构映射成我们的 `Task[]`；手写能精确控制「行首 `#` / `-` / `[]` / `1.` / `>` / ``` 」这些我们本来就支持的语法，且不会引入意外行为。缺点是 Notion 导出语法的细节差异需要实测校准（见下）。

### 导入流程

1. 用户选择 `.zip`（导入按钮的 `accept` 需扩展为 `.zip,.md,.json`）。
2. 解压，区分出 `.md` 与资产文件（`image/` 等目录）。
3. 对每个 `.md`：先剥离内嵌的 HTML 片段（callout 等）单独处理，其余走块映射。
4. 图片处理分两路：包内相对路径的，直接读字节转 Base64 走 `insertImageBlock`；S3 预签名 URL 的，**导入时立即 fetch 下载并转 Base64**，不留外链。
5. 子页面层级：由文件夹结构 + `.md` 内的子页面链接共同推断，通过 `parentId` 重建页面树；子页面链接尽量转成我们的 `[[页面]]` 双向链接，这样反向链接也能一起生效。
6. 元信息：`.md` 首行若是 `# 标题`，与文件名比对后取作页面标题； Notion 的页面图标若在导出中保留则读入 `icon`。
7. 数据库 CSV：导入为只读文本呈现（或在 README 中明确告知"数据库暂不支持"），不假装支持。

### 块映射表

| Notion 导出形态 | 我们的块 |
| --- | --- |
| `# ` / `## ` / `### ` | h1 / h2 / h3 |
| `- ` / `* ` | bullet |
| `1. ` | numbered |
| `- [ ]` / `- [x]` | todo（completed 映射） |
| `> ` | quote |
| `<details><summary>` | toggle |
| HTML callout 片段 | callout（尽力提取 emoji 与正文） |
| `---` | divider |
| ```` ``` ```` | codeblock |
| `![](...)` | image |
| 子页面链接 | 子页面 + `[[链接]]` |
| `**粗体**` `` `code` `` 等 | 对应行内 HTML |
| 表格 | **无对应块**，降级为 codeblock 或文本 |
| `@` 提及 | 降级为纯文本 |

### 需要实测校准的三处

以下三点我未能从官方或高可信来源取得确定的语法样例，实现时需用真实导出包校准，建议解析器对这些位置保持宽松：

子页面链接的确切格式（很可能是 `[名称](子页面/子页面.md)` 形式的相对路径，空格是否 URL 编码需实测）；toggle 是否用 `<details>` 表达；callout 导出的 HTML 具体标签结构。

处理原则：**认不出的一律降级为 text 块保留原文，绝不丢弃内容**。宁可保真度低，不能让用户的内容消失。

---

## 六、风险与建议

**最大风险是 Notion 导出格式的版本差异。** 不同客户端、不同时间导出的包在细节上不完全一致，解析器必然遇到认不出的形态。对策就是上面的降级原则，外加导入完成后给一份明确的统计报告（导入 N 个页面、M 个块、K 处降级），让用户知道哪里没转好。

**其次是图片体积。** 若用户的 Notion 页面图片很多，全部转 Base64 会快速吃掉 localStorage 配额（我们已有 5MB 上限与写入失败告警）。建议导入时对超过 2MB 的图片做一次压缩，并在导入报告里提示总量。

**建议分两步走。** 第一步先做「单文件 `.md` 导入」（不需要 ZIP 解压，工作量砍半到 1–2 人天），验证块映射的准确度；确认无误后再加 ZIP 与图片资产处理。这样风险可控，且第一步就能让用户看到价值。

---

## Sources

1. [Export your Notion content | Notion Help（官方：格式选项、ZIP 结构、Callout 导出为 HTML、数据库导出 CSV、无法一键重建、Windows 路径限制）](https://www.notion.com/help/export-your-content)
2. [Block object | Notion Developers（官方 API 的块类型定义，作为块映射参考）](https://developers.notion.com/reference/block)
3. [Notion 导出的 Markdown，图片为什么「当时能看、过几天全裂」（2026-10-12，一手迁移记录：图片两种形态、S3 预签名 URL 过期机制、`image/image-1.png` 相对路径样例）](https://blog.csdn.net/aowu1999009/article/details/167401382)
4. [【Notion教程】怎么将 Notion 页面导出为 MarkDown（导出操作步骤与 Include subpages 选项说明）](https://zhuanlan.zhihu.com/p/617689709)
5. [Notion 批量导出 Markdown Typora 完美接收（带子笔记模式的导出实践）](https://blog.csdn.net/qq_34913909/article/details/121157340)
6. [Notion markdown 导出 | LangChain Docs（第三方加载器对导出目录结构的消费方式）](https://langchain.docs-hub.com/oss/javascript/integrations/document_loaders/file_loaders/notion_markdown)
7. [Notion-to-MD（Notion API → Markdown 的既有开源实现，注意其方向是 API 而非导出文件）](https://github.com/souvikinator/notion-to-md)
