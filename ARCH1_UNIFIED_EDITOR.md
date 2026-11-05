# 架构 1 实施方案：统一 ProseMirror + Yjs 编辑器

> 目标：把当前「`Y.Array` 块列表 + 独立 `Y.XmlFragment('tiptap')` 富文本」两套平行结构，
> 收敛为**单一 ProseMirror 文档**，经 `ySyncPlugin` 绑到**一个** `Y.XmlFragment('doc')`。
> 这是通往 Notion 式「块内富文本」模型的必要架构并轨（见 `PRODUCT_GAP_AND_ARCH.md` 架构 1）。

---

## 1. 技术决策

- **选型**：基于已装的 Tiptap 2 + y-prosemirror，整篇文档 = 单个 ProseMirror 文档，绑 `Y.XmlFragment('doc')`。
  每个 block = ProseMirror 节点，块内 = 内联富文本（bold/italic/code/link）。
- **理由**：`YjsRichText.vue` 的 `ySyncPlugin`/`yCursorPlugin`/`yUndoPlugin`/`fragmentRestorer` 基建已验证可用，
  只需换 fragment key + 扩 schema，改动最小、可控、不引入重依赖。
- **备选**：BlockNote（ProseMirror+Yjs 原生协同，开箱拖拽手柄/slash/侧边菜单，Notion 平价最快）。
  若追求速度可换，但引入较重新依赖；本方案先用自研 Tiptap。

## 2. 目标数据模型

| 现状 | 目标 |
|---|---|
| `Y.Array('tasks')`（块列表，textarea 纯文本） | 删除（统一后不再使用） |
| `Y.XmlFragment('tiptap')`（独立富文本，靠 mode 切换） | 合并为 `Y.XmlFragment('doc')` |
| 块内无富文本 | 块内 = 内联 rich（bold/italic/code/link） |

- 文档标题保留 `meta.title`（页面名）；正文全部在 `('doc')` 片段。
- block 类型：StarterKit 覆盖 paragraph / heading(h1–h3) / bulletList+listItem / orderedList / blockquote / codeBlock；
  新增 taskList+taskItem（todo）、link（内联）。

## 3. 新增依赖

```
@tiptap/extension-task-list @tiptap/extension-task-item @tiptap/extension-link
# 可选：@tiptap/extension-underline；slash 菜单用 @tiptap/suggestion + 自定义（MVP 可暂缓）
```

## 4. 文件级改动

### 4.1 `YjsRichText.vue` → 重命名为 `YjsBlockEditor.vue`
- fragment 改 `'doc'`：`const fragment = ydoc.getXmlFragment('doc');`
- extensions：
  ```ts
  const extensions: any[] = [
    StarterKit.configure({ history: false }),
    TaskList, TaskItem.configure({ nested: true }),
    Link.configure({ openOnClick: false }),
    Placeholder.configure({ placeholder: '输入内容，输入 “/” 选择块类型…' }),
    ySyncPlugin(fragment),
  ];
  if (awareness) extensions.push(yCursorPlugin(awareness, { cursorBuilder }));
  extensions.push(yUndoPlugin(), yUndoKeymap);
  ```
- `fragmentRestorer` 不变（用 `editor.value.schema` → 自动适配 richer schema），但读取/写入片段用 `'doc'`。
- 可选：加 slash 命令（`@tiptap/suggestion`）插入块类型；拖拽排序暂缓。

### 4.2 `YjsPilot.vue`
- 删除 `mode` ref、切换 UI、`v-if="mode==='blocks'"` / `v-else` 分支。
- 直接渲染 `<YjsBlockEditor :handle="handle" />`。
- 顶栏「导出 / 导入」「保存快照 / 版本历史」不动（已基于 fragment，自动适配 `'doc'`）。
- 标题输入保留（写 `meta.title`）。

### 4.3 `yjsDoc.ts`
- `yRestoreSnapshot`：片段读取从 `tmp.getXmlFragment('tiptap')` 改为 `tmp.getXmlFragment('doc')`；
  `Y.Array('tasks')` 重建循环可保留（向后兼容 blocks 模式）或随统一后删除。
- 将 `yAddBlock`/`yRemoveBlock`/`yMoveBlock`/`ySetContent`/`ySetField`/`yRestoreBlock`/`yNewBlock`/`ySeedIfEmpty`
  标为 legacy（pilot 不再调用，可保留参考）。
- 新增可选 `yGetDocJSON(h)` / `ySetDocJSON(h, json)`（基于 `yXmlFragmentToProsemirrorJSON`/`prosemirrorJSONToYXmlFragment`），
  供搜索索引 / 服务端渲染。
- `createYjsDoc` 暴露 `getFragment(name)`。

### 4.4 数据迁移 / 房间号
- 旧 IndexedDB `pilot-room` 含 `'tiptap'`+`'tasks'`，切到 `'doc'` 后旧富文本不加载。
- **建议把 room 常量从 `'pilot-room'` 升到 `'pilot-room-v2'`**，避免旧数据混淆（pilot 阶段可接受清空）。

## 5. 验证计划
- **集成（tsx）**：用 `getSchema([StarterKit, TaskList, TaskItem, Link])` 跑片段往返（含 heading/list/task/link）；快照+恢复（富片段）；导出/导入。
- **e2e（node）**：沿用 `scripts/yjs-e2e.test.mjs` 测 `/ws/yjs` 实时合并 + Awareness（预期仍 PASS）。
- **浏览器手动**：两窗口、slash 插入、todo 勾选同步、协作光标、快照恢复、导出/导入。

## 6. 风险与开放问题
- **BlockNote 备选**：最快 Notion 平价但新依赖重。
- **schema 演进**：增删节点类型需谨慎（破坏性变更要 migration 策略）。
- **多文档**：下一步每页=独立 fragment 或独立 `Y.Doc`，awareness room=页（见 `PRODUCT_GAP_AND_ARCH.md` 架构 2）。
- 本方案**不动 legacy `pages`**（依 `PHASE5_PAGES_RETIRE.md`）。

## 7. 建议落地顺序（小步）
1. 加依赖 → `YjsRichText.vue` 绑 `'doc'` + 加 TaskList/Link + 可选 slash。
2. `YjsPilot.vue` 去掉 mode 切换，渲染统一编辑器。
3. 简化 `yRestoreSnapshot`。
4. 跑 tsx + e2e 验证；手动浏览器走查。
5. bump room → `pilot-room-v2`。
