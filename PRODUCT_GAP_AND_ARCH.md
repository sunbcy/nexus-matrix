# 产品对照（Notion）、差距与架构闭环路线

> 整理自 Phase 1–5 实测结论（2026-11-06）。
> 验证环境：前端 Vue3 + Tiptap2 + y-prosemirror；后端 FastAPI `/ws/yjs`（`yjs_server.py`，自建 `ydocs.db`）。
> 实测：8010 端口实时 e2e 通过（A↔B 双向合并 + CRDT 无 LWW 丢更新 + Awareness 传播）；tsx 集成测试通过（快照+富文本片段+导入导出）。

---

## 一、Phase 对照测试结果

| Phase | 核心交付 | 本次验证 | 结论 |
|---|---|---|---|
| P1/P2 单文档 + Yjs 实时 | `Y.Array` 块 / IndexedDB 离线 / `/ws/yjs` / 撤销重做 | 8010 实时 e2e：B 收 A 更新、A 收 B 并发修改(CRDT 合并) 均 true，PASS | ✅ 通过 |
| P3 Awareness + 快照 | 在线光标 / 版本快照历史 | 8010 e2e：Awareness 传播 true；快照逻辑此前单测通过 | ✅ 通过(逻辑) |
| P4 Tiptap 富文本 | 独立「富文本」模式（共享同一 handle） | 源码接线确认 + schema 往返验证；浏览器 UI 需手动确认 | ⚠️ 代码完整，UI 未跑 |
| P5 片段入快照 + 导入导出 | 片段还原钩子 / `yExportDoc`/`yImportDoc` | tsx 集成测试：快照→片段+块回滚、导出产出字节 均 OK | ✅ 通过(逻辑) |

> 说明：P4/P5 的浏览器交互（切富文本、快照恢复、导入导出文件）无法在此环境起浏览器，靠源码 + 逻辑/集成测试保证；e2e 中 `connected:false` 为 node+`ws` polyfill 的显示瑕疵，数据已证连接成功。

---

## 二、对照 Notion 的产品差距

**已具备（架构方向正确）**：CRDT 实时协同、离线优先、在线状态/光标、整文档快照恢复、房间隔离——底层与 Notion 思路一致。

**差距（按产品权重）**：
1. **单文档 vs 工作区**：试点仅「一篇文档」；Notion 是多级嵌套页面树 + 反向链接 + 工作区。讽刺的是 legacy `pages` 表反而是「多页」的，只是没用 CRDT。
2. **块模型 vs 块内富文本**：Notion 每个 block 本身是富文本节点（块内可加粗/链接/行内代码/评论）。当前试点是「块模式(`Y.Array`)」与「富文本模式(`Y.XmlFragment`)」**两套平行结构靠切换**——恰是 Notion 不会有的形态。
3. **块类型库**：缺表格、toggle、callout、代码运行、数据库/看板、公式、书签、嵌入等。
4. **协作深度**：缺评论/@提及/Thread、页面级与块级权限、分享链接。
5. **版本历史**：仅整文档快照（全量 update，体量大），缺块/页级 diff 视图、命名版本、自动版本。
6. **导入导出**：当前是 `.ybin` 二进制（仅本系统可用）；Notion 支持 Markdown/HTML/PDF，且能从旧系统迁移。
7. **资产/搜索/模板/数据库视图**：均缺失或未纳入 Yjs 路径。

---

## 三、需改进的架构点（闭环路线，按优先级）

1. **统一编辑模型（最关键，决定能否闭环）**
   把「`Y.Array` 块列表 + 独立 `Y.XmlFragment` 富文本」合并为**单一 ProseMirror + Yjs 文档**——每个 block 是带内联富文本的 ProseMirror 节点（BlockNote 路线）。块内富文本与块结构成同一份 CRDT，不再是切换两种模式。当前 P2 与 P4 并行是通往 Notion 的架构死胡同，应在生产化前收敛。

2. **多文档工作区模型**
   「一篇文档」→ workspace→pages 树。可用 `Y.Doc` 级结构：room=工作区，内含 `Y.Map` 索引各页（或每页独立 `Y.Doc`）。等于用 Yjs 重做 legacy `pages` 的「多页」语义并叠加权限。

3. **服务端权威与权限**
   `y-websocket` 是无脑中继。生产需：连接鉴权（已有）+ 文档/工作区级 ACL + 服务端校验 + 限流 + 审计；并考虑服务端做最终合并仲裁防滥用。细粒度分享/权限是 Notion 护城河。

4. **离线 / 冲突 UX**
   Yjs 自动合并，但缺：冲突可视化、离线队列可见性、设备合并提示、awareness 离线态。

5. **版本历史粒度**
   从整文档快照 → 块/页级历史 + diff + 命名版本。注意当前 yjs 版本下官方 `Snapshot` 原语在 gc 开启时会报错（已验证），要么关 gc，要么自研增量版本。

6. **可互操作导入导出 + 迁移工具**
   补 Markdown/HTML/PDF 导出；写 legacy `pages` → Yjs 工作区迁移脚本（双写过渡再切流，见 `PHASE5_PAGES_RETIRE.md` 步骤 A）。

7. **资产纳入 Yjs 路径**
   `assets` 表仍 legacy 耦合；图片/文件嵌入应在 Yjs 文档内引用，而非依赖 pages 扫引用。

8. **搜索 + 可观测运维**
   跨文档全文检索；中继服务端需连接数限制、持久化健康、孤儿 `Y.Doc` GC、监控告警（目前 `alert.rules.yml` 还盯着 pages）。

---

## 四、建议的闭环 MVP 次序

1. **先做统一编辑器（架构 1）**：用 ProseMirror+Yjs 单文档替换当前「块/富文本」双结构，把 P2/P4 真正并轨——离 Notion 最近、最该先决。
2. **加多文档工作区（架构 2）+ 权限（架构 3）**，形成「能用的小 Notion」。
3. **再补版本粒度 / 冲突 UX / 可互操作导出 / 迁移工具**，最后按 `PHASE5_PAGES_RETIRE.md` 退役 legacy。

> 配套文档：`PHASE5_PAGES_RETIRE.md`（后端 pages 下线专项计划）。
