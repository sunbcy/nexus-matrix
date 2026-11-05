<script setup lang="ts">
// 架构 1：统一 ProseMirror + Yjs 编辑器（Notion 式单文档）。
// 整篇文档即一个 ProseMirror 文档，经 ySyncPlugin 绑到同一个 Y.Doc 的 Y.XmlFragment('doc')。
//  - ySyncPlugin    : 文档内容与 Yjs 双向同步（复用 pilot 的 connect/provider，零额外接线）
//  - yCursorPlugin  : 远端协作光标（读取 awareness 的 user.name/color）
//  - yUndoPlugin     : 协同级撤销（关闭 StarterKit 自带 history 以免与 Yjs 绑定冲突）
// 与 pilot 共享同一 handle（同一房间 / 同一份后端 /ws/yjs）。
import { onBeforeUnmount, onMounted, ref, reactive, computed, watch } from 'vue';
import { EditorContent, Extension, useEditor } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Link from '@tiptap/extension-link';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { Details } from '@tiptap/extension-details';
import { DetailsSummary } from '@tiptap/extension-details-summary';
import { DetailsContent } from '@tiptap/extension-details-content';
import { Node, mergeAttributes } from '@tiptap/core';
import {
  ySyncPlugin, yCursorPlugin, yUndoPlugin, undoCommand, redoCommand,
  yXmlFragmentToProsemirrorJSON, prosemirrorJSONToYXmlFragment,
} from 'y-prosemirror';
import {
  registerTiptapFragmentRestorer,
  unregisterTiptapFragmentRestorer,
} from '../composables/yjsDoc';
import type { YjsDocHandle } from '../composables/yjsDoc';

const props = defineProps<{ handle: YjsDocHandle }>();

const ydoc = props.handle.ydoc;
const awareness = props.handle.provider?.awareness ?? null;
const fragment = ydoc.getXmlFragment('doc');

// 让「快照恢复」也能还原富文本片段：恢复器需要 ProseMirror schema（仅 Tiptap 层有）。
// 缓存 schema 与 handle；注册后即使组件卸载（本编辑器常驻）恢复器仍可被 yjsDoc 调用。
let cachedSchema: any = null;
let cachedHandle: YjsDocHandle | null = null;
const fragmentRestorer = (tmpFrag: any) => {
  if (!cachedSchema || !cachedHandle) return;
  const json = yXmlFragmentToProsemirrorJSON(tmpFrag);
  const live = cachedHandle.ydoc.getXmlFragment('doc');
  cachedHandle.ydoc.transact(() => {
    while (live.length) live.delete(0, 1);
    prosemirrorJSONToYXmlFragment(cachedSchema, json, live);
  });
};

// 远端光标：读取 awareness 中 user 的 name/color（与 YjsPilot 的 ME 一致）。
const cursorBuilder = (user: any): HTMLElement => {
  const cursor = document.createElement('span');
  cursor.classList.add('yjs-cursor');
  const color = user?.color || '#888';
  cursor.style.cssText = `position:relative;border-left:2px solid ${color};margin-left:-1px;margin-right:-1px;pointer-events:none;`;
  const label = document.createElement('span');
  label.className = 'yjs-cursor-label';
  label.textContent = user?.name || '匿名';
  label.style.cssText = `position:absolute;top:-1.4em;left:-1px;font-size:11px;line-height:1;white-space:nowrap;color:#fff;background:${color};border-radius:3px;padding:1px 4px;user-select:none;`;
  cursor.appendChild(label);
  return cursor;
};

// y-prosemirror 的 yUndoPlugin 不自带键盘快捷键（且我们关闭了 StarterKit 的 history），
// 这里把协同撤销 / 重做绑到 Mod-z / Mod-y，并对外暴露给父组件 toolbar 按钮。
const yUndoKeymap = Extension.create({
  name: 'yjs-undo-keymap',
  addKeyboardShortcuts() {
    return {
      'Mod-z': () => undoCommand(this.editor.state, this.editor.view.dispatch) ?? false,
      'Mod-y': () => redoCommand(this.editor.state, this.editor.view.dispatch) ?? false,
      'Shift-Mod-z': () => redoCommand(this.editor.state, this.editor.view.dispatch) ?? false,
    };
  },
});

// 自定义「标注 / Callout」块：一个带左侧高亮的容器，内含任意块级内容。
const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  parseHTML() {
    return [{ tag: 'div[data-callout]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-callout': '', class: 'yjs-callout' }), 0];
  },
});

// ============================================================
// Slash 块菜单（输入 "/" 选块类型，Notion 式）。纯前端轻量实现，不引额外依赖。
// 原理：监听编辑器 update/selectionUpdate，检测光标前是否形如 "(^|\s)/(\w*)$"，
// 命中则弹出菜单；选中项时删除 "/query" 文本并套用对应块命令。
// 菜单按「基础 / 列表 / 结构」分组，每项含图标与说明，并支持表格 / 折叠块 / 标注。
// ============================================================
type SlashItem = {
  group: string;
  title: string;
  icon: string;
  desc?: string;
  run: (e: any) => any;
};

const ALL_SLASH: SlashItem[] = [
  // 基础
  { group: '基础', title: '文本', icon: '¶', run: (e: any) => e.chain().focus().setParagraph().run() },
  { group: '基础', title: '标题 1', icon: 'H1', run: (e: any) => e.chain().focus().setNode('heading', { level: 1 }).run() },
  { group: '基础', title: '标题 2', icon: 'H2', run: (e: any) => e.chain().focus().setNode('heading', { level: 2 }).run() },
  { group: '基础', title: '标题 3', icon: 'H3', run: (e: any) => e.chain().focus().setNode('heading', { level: 3 }).run() },
  { group: '基础', title: '引用', icon: '❝', run: (e: any) => e.chain().focus().toggleBlockquote().run() },
  { group: '基础', title: '代码块', icon: '</>', run: (e: any) => e.chain().focus().toggleCodeBlock().run() },
  // 列表
  { group: '列表', title: '待办', icon: '☑', run: (e: any) => e.chain().focus().toggleTaskList().run() },
  { group: '列表', title: '无序列表', icon: '•', run: (e: any) => e.chain().focus().toggleBulletList().run() },
  { group: '列表', title: '有序列表', icon: '1.', run: (e: any) => e.chain().focus().toggleOrderedList().run() },
  // 结构
  {
    group: '结构', title: '标注', icon: '💡', desc: '高亮提示块',
    run: (e: any) => e.chain().focus().insertContent({ type: 'callout', content: [{ type: 'paragraph' }] }).run(),
  },
  {
    group: '结构', title: '折叠块', icon: '▸', desc: '可展开 / 收起',
    run: (e: any) =>
      e
        .chain()
        .focus()
        .insertContent({
          type: 'details',
          content: [
            { type: 'detailsSummary', content: [{ type: 'paragraph', content: [{ type: 'text', text: '折叠标题' }] }] },
            { type: 'detailsContent', content: [{ type: 'paragraph' }] },
          ],
        })
        .run(),
  },
  {
    group: '结构', title: '表格', icon: '▦', desc: '3×3 含表头',
    run: (e: any) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
];

const slash = reactive({ open: false, query: '', x: 0, y: 0, index: 0 });

// 按 query 过滤后的扁平列表（键盘导航用，保持全局顺序）。
const slashFlat = computed<SlashItem[]>(() => {
  const q = slash.query.trim().toLowerCase();
  if (!q) return ALL_SLASH;
  return ALL_SLASH.filter(
    (i) => i.title.toLowerCase().includes(q) || (i.desc ?? '').toLowerCase().includes(q),
  );
});

// 按分组聚合（渲染用）。
const slashGroups = computed(() => {
  const groups: { name: string; items: SlashItem[] }[] = [];
  for (const it of slashFlat.value) {
    let g = groups.find((x) => x.name === it.group);
    if (!g) {
      g = { name: it.group, items: [] };
      groups.push(g);
    }
    g.items.push(it);
  }
  return groups;
});

function flatIndexOf(item: SlashItem): number {
  return slashFlat.value.indexOf(item);
}

// 从文档坐标反推光标前形如 "(^|\s)/query$" 的匹配，更新菜单状态 + 定位。
function onEditorState() {
  const e = editor.value;
  if (!e) return;
  const sel = e.state.selection as any;
  const $from = sel.$from;
  const textBefore = $from.parent.textBetween(0, $from.parentOffset, '\n', '\0');
  const m = /(?:^|\s)\/([^\/\s]*)$/.exec(textBefore);
  if (m) {
    const wasOpen = slash.open;
    slash.open = true;
    if (!wasOpen || slash.query !== m[1]) slash.index = 0;
    slash.query = m[1];
    try {
      const coords = e.view.coordsAtPos($from.pos);
      slash.x = coords.left;
      slash.y = coords.bottom + 6;
    } catch { /* 坐标计算失败则保持上次位置 */ }
  } else {
    slash.open = false;
  }
}

// 选中某项：删除 "/query" 文本并套用块命令。
function applyItem(item: SlashItem) {
  const e = editor.value;
  if (!e) return;
  const sel = e.state.selection as any;
  const $from = sel.$from;
  const textBefore = $from.parent.textBetween(0, $from.parentOffset, '\n', '\0');
  const m = /(?:^|\s)\/([^\/\s]*)$/.exec(textBefore);
  if (m) {
    const parentOffset = $from.parentOffset;
    const blockStart = $from.pos - parentOffset;
    const slashIndex = m.index + (m[0][0] === ' ' ? 1 : 0);
    const from = blockStart + slashIndex;
    const to = $from.pos;
    e.chain().focus().deleteRange({ from, to }).run();
  }
  item.run(e);
  slash.open = false;
}

// 点击编辑器之外时收起菜单。
function onDocMouseDown(ev: MouseEvent) {
  const t = ev.target as HTMLElement;
  if (slash.open && !t.closest('.slash-menu')) slash.open = false;
}

// 菜单键盘导航：上下移动、回车选中、Esc 关闭（仅在菜单打开时拦截）。
const SlashNav = Extension.create({
  name: 'slash-nav',
  addKeyboardShortcuts() {
    return {
      ArrowDown: () => {
        if (!slash.open) return false;
        const n = slashFlat.value.length;
        if (!n) return true;
        slash.index = (slash.index + 1) % n;
        return true;
      },
      ArrowUp: () => {
        if (!slash.open) return false;
        const n = slashFlat.value.length;
        if (!n) return true;
        slash.index = (slash.index - 1 + n) % n;
        return true;
      },
      Enter: () => {
        if (!slash.open) return false;
        const items = slashFlat.value;
        if (!items.length) return true;
        applyItem(items[slash.index]);
        return true;
      },
      Escape: () => {
        if (!slash.open) return false;
        slash.open = false;
        return true;
      },
    };
  },
});

const extensions: any[] = [
  // 关闭自带 history，改用 yUndoPlugin 做协同撤销
  StarterKit.configure({ history: false }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Link.configure({ openOnClick: false, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } }),
  Table,
  TableRow,
  TableHeader,
  TableCell,
  Details,
  DetailsSummary,
  DetailsContent,
  Callout,
  Placeholder.configure({
    placeholder: '输入 "/" 插入块 · 支持标题、列表、待办、表格、折叠、标注、链接、引用、代码块',
  }),
  ySyncPlugin(fragment),
  SlashNav,
];
if (awareness) extensions.push(yCursorPlugin(awareness, { cursorBuilder }));
extensions.push(yUndoPlugin(), yUndoKeymap);

const editor = useEditor({
  extensions,
  content: '',
  editable: true,
  autofocus: false,
});

// 编辑器就绪后挂上状态监听（用 guard 防止重复挂载）。
let attached = false;
watch(
  editor,
  (e) => {
    if (!e || attached) return;
    attached = true;
    cachedSchema = e.schema;
    e.on('update', onEditorState);
    e.on('selectionUpdate', onEditorState);
  },
  { immediate: true },
);

onMounted(() => {
  cachedHandle = props.handle;
  registerTiptapFragmentRestorer(fragmentRestorer);
  document.addEventListener('mousedown', onDocMouseDown, true);
});

onBeforeUnmount(() => {
  const e = editor.value;
  if (e) {
    e.off('update', onEditorState);
    e.off('selectionUpdate', onEditorState);
  }
  document.removeEventListener('mousedown', onDocMouseDown, true);
  unregisterTiptapFragmentRestorer(fragmentRestorer);
  e?.destroy();
});

// 协同撤销 / 重做（走 yUndoPlugin 的 undoCommand/redoCommand），供父组件 toolbar 调用。
function undo() {
  if (editor.value) undoCommand(editor.value.state, editor.value.view.dispatch);
}
function redo() {
  if (editor.value) redoCommand(editor.value.state, editor.value.view.dispatch);
}
defineExpose({ undo, redo });
</script>

<template>
  <div class="yjs-editor">
    <EditorContent :editor="editor" />

    <div
      v-if="slash.open"
      class="slash-menu"
      :style="{ left: slash.x + 'px', top: slash.y + 'px' }"
    >
      <template v-for="g in slashGroups" :key="g.name">
        <div class="slash-group">{{ g.name }}</div>
        <div
          v-for="item in g.items"
          :key="item.title"
          :class="['slash-item', { active: flatIndexOf(item) === slash.index }]"
          @mousedown.prevent="applyItem(item)"
          @mouseenter="slash.index = flatIndexOf(item)"
        >
          <span class="slash-icon">{{ item.icon }}</span>
          <span class="slash-text">
            <span class="slash-title">{{ item.title }}</span>
            <span v-if="item.desc" class="slash-desc">{{ item.desc }}</span>
          </span>
        </div>
      </template>
      <div v-if="slashFlat.length === 0" class="slash-empty">无匹配块类型</div>
    </div>
  </div>
</template>

<style scoped>
.yjs-editor :deep(.ProseMirror) {
  min-height: 60vh;
  outline: none;
  padding: 1rem 1.25rem;
  background: rgb(var(--surface));
  border: 1px solid rgb(var(--line));
  border-radius: 0.5rem;
  color: rgb(var(--display));
  font-size: 0.95rem;
  line-height: 1.7;
}
.yjs-editor :deep(.ProseMirror p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  color: rgb(var(--dim));
  float: left;
  height: 0;
  pointer-events: none;
}
.yjs-editor :deep(.ProseMirror h1) { font-size: 1.6rem; font-weight: 700; margin: 0.6rem 0 0.3rem; }
.yjs-editor :deep(.ProseMirror h2) { font-size: 1.3rem; font-weight: 700; margin: 0.5rem 0 0.25rem; }
.yjs-editor :deep(.ProseMirror h3) { font-size: 1.1rem; font-weight: 700; margin: 0.4rem 0 0.2rem; }
.yjs-editor :deep(.ProseMirror ul),
.yjs-editor :deep(.ProseMirror ol) { padding-left: 1.4rem; }
.yjs-editor :deep(.ProseMirror blockquote) {
  border-left: 3px solid rgb(var(--line));
  padding-left: 0.75rem;
  color: rgb(var(--dim));
}
.yjs-editor :deep(.ProseMirror code) {
  background: rgb(var(--void));
  padding: 0.1em 0.3em;
  border-radius: 0.25rem;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.85em;
}
.yjs-editor :deep(.ProseMirror pre) {
  background: rgb(var(--void));
  padding: 0.75rem;
  border-radius: 0.5rem;
  overflow: auto;
}
.yjs-editor :deep(.ProseMirror ul[data-type="taskList"]) { list-style: none; padding-left: 0.25rem; }
.yjs-editor :deep(.ProseMirror ul[data-type="taskList"] li) { display: flex; gap: 0.5rem; align-items: flex-start; }
.yjs-editor :deep(.ProseMirror ul[data-type="taskList"] li > label) { margin-top: 0.35rem; }
.yjs-editor :deep(.yjs-cursor) { word-break: normal; }

/* 标注 / Callout 块 */
.yjs-editor :deep(.yjs-callout) {
  border-left: 3px solid rgb(var(--line));
  background: rgb(var(--void));
  padding: 0.5rem 0.75rem;
  border-radius: 0.4rem;
  margin: 0.5rem 0;
}
/* 表格 */
.yjs-editor :deep(.ProseMirror table) {
  border-collapse: collapse;
  margin: 0.5rem 0;
  overflow: hidden;
  table-layout: fixed;
  width: 100%;
}
.yjs-editor :deep(.ProseMirror table td),
.yjs-editor :deep(.ProseMirror table th) {
  border: 1px solid rgb(var(--line));
  padding: 0.35rem 0.5rem;
  vertical-align: top;
  position: relative;
}
.yjs-editor :deep(.ProseMirror table th) { background: rgb(var(--void)); }
.yjs-editor :deep(.ProseMirror table .selectedCell::after) {
  content: '';
  position: absolute;
  inset: 0;
  background: rgba(120, 120, 255, 0.15);
  pointer-events: none;
}
/* 折叠块 / Details */
.yjs-editor :deep(.ProseMirror details) {
  border: 1px solid rgb(var(--line));
  border-radius: 0.4rem;
  margin: 0.5rem 0;
  padding: 0 0.6rem;
}
.yjs-editor :deep(.ProseMirror details > summary) {
  cursor: pointer;
  font-weight: 600;
  padding: 0.35rem 0;
  list-style: none;
}
.yjs-editor :deep(.ProseMirror details > summary::-webkit-details-marker) { display: none; }
.yjs-editor :deep(.ProseMirror details[open] > summary) { border-bottom: 1px solid rgb(var(--line)); margin-bottom: 0.4rem; }

/* Slash 块菜单 */
.slash-menu {
  position: fixed;
  z-index: 80;
  min-width: 220px;
  max-height: 300px;
  overflow: auto;
  background: rgb(var(--surface));
  border: 1px solid rgb(var(--line));
  border-radius: 0.5rem;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
  padding: 0.25rem;
}
.slash-group {
  font-size: 0.68rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgb(var(--dim));
  padding: 0.4rem 0.6rem 0.2rem;
}
.slash-item {
  display: flex;
  gap: 0.6rem;
  align-items: center;
  padding: 0.4rem 0.6rem;
  border-radius: 0.35rem;
  cursor: pointer;
  font-size: 0.85rem;
}
.slash-item.active { background: rgb(var(--void)); }
.slash-icon {
  width: 1.6rem;
  text-align: center;
  color: rgb(var(--dim));
  font-size: 0.85rem;
  font-family: 'JetBrains Mono', monospace;
}
.slash-text { display: flex; flex-direction: column; line-height: 1.25; }
.slash-title { color: rgb(var(--display)); }
.slash-desc { font-size: 0.72rem; color: rgb(var(--dim)); }
.slash-empty { padding: 0.5rem 0.6rem; font-size: 0.8rem; color: rgb(var(--dim)); }
</style>
