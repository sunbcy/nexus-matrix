<script setup lang="ts">
// P2 Phase B：单块结构化编辑器，绑定到页面级 Y.Doc 里本块专属的 Y.XmlFragment。
// 与试点的整页单文档（YjsBlockEditor.vue）不同，这里「一块一个 fragment」，
// 以便契合主编辑器的「按块 task + task.content」数据模型：块正文真正以 CRDT 存储，
// 本地键入走 Y.Text（字符级），远端更新由 y-prosemirror 合并；emit 的 HTML 作为
// legacy `task.content` 投影回写，关闭 ?yjsCutover 即恢复原 contenteditable。
import { onBeforeUnmount, onMounted, watch } from 'vue';
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
import { Node, Mark, mergeAttributes } from '@tiptap/core';
import { ySyncPlugin, yCursorPlugin, yUndoPlugin, undoCommand, redoCommand } from 'y-prosemirror';
import type { YjsDocHandle } from '../composables/yjsDoc';
import { getBlockFragment, reportCutoverWrite, reportCutoverBlock } from '../composables/yjsCutover';

const props = defineProps<{
  handle: YjsDocHandle;
  blockId: string;
  initialHtml: string;
  placeholder?: string;
  docs?: { id: string; title: string; icon: string }[];
}>();
const emit = defineEmits<{ update: [html: string]; navigate: [id: string] }>();

// 块级 fragment（页面 Y.Doc 的 block_crdt Map 中按 blockId 索引）。父组件已保证 cutoverReady。
const ydoc = props.handle.ydoc;
const awareness = props.handle.provider?.awareness ?? null;
const fragment = getBlockFragment(ydoc, props.blockId);

// 首次进入切流：把原文备份到 localStorage，万一 HTML↔PM 映射有损可手工恢复。
try {
  const bk = `nexus_cutover_backup_${props.blockId}`;
  if (!window.localStorage.getItem(bk) && props.initialHtml) window.localStorage.setItem(bk, props.initialHtml);
} catch { /* ignore */ }

// 主编辑器正文大量使用 <a data-page-id>：必须无损往返为一个原子内联节点。
const PageLink = Node.create({
  name: 'pageLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,
  draggable: false,
  addAttributes() {
    return { targetId: { default: '' }, title: { default: '' }, href: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'a[data-page-id]', priority: 200 }];
  },
  renderHTML({ node, HTMLAttributes }) {
    const id = node.attrs.targetId as string;
    return [
      'a',
      mergeAttributes(HTMLAttributes, {
        'data-page-id': id,
        href: (node.attrs.href as string) || `#${id}`,
        class: 'nexus-pagelink',
      }),
      node.attrs.title || '',
    ];
  },
});

// asset: 图片 / 任意 <img>：保持 src 原样（asset:<id> 或 http(s)），无损往返。
const AssetImage = Node.create({
  name: 'assetImage',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,
  addAttributes() {
    return { src: { default: '' }, alt: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'img' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes, { src: node.attrs.src, alt: node.attrs.alt || '' })];
  },
});

// 任意行内 <span style="...">：保留全部内联样式（颜色等），无损往返。
const InlineStyle = Mark.create({
  name: 'inlineStyle',
  parseHTML() {
    return [{ tag: 'span[style]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0];
  },
});

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

const YjsSync = Extension.create({
  name: 'yjs-sync-block',
  addProseMirrorPlugins() {
    const plugins: any[] = [ySyncPlugin(fragment as any)];
    if (awareness) plugins.push(yCursorPlugin(awareness, { cursorBuilder }));
    plugins.push(yUndoPlugin());
    return plugins;
  },
});

const yUndoKeymap = Extension.create({
  name: 'yjs-undo-keymap-block',
  addKeyboardShortcuts() {
    return {
      'Mod-z': () => undoCommand(this.editor.state, this.editor.view.dispatch) ?? false,
      'Mod-y': () => redoCommand(this.editor.state, this.editor.view.dispatch) ?? false,
      'Shift-Mod-z': () => redoCommand(this.editor.state, this.editor.view.dispatch) ?? false,
    };
  },
});

const extensions: any[] = [
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
  PageLink,
  AssetImage,
  InlineStyle,
  Placeholder.configure({ placeholder: props.placeholder || '输入 "/" 插入块 · 支持标题、列表、待办、表格、折叠、标注、引用、代码块' }),
  YjsSync,
  yUndoKeymap,
];

const editor = useEditor({
  extensions,
  content: '',
  editable: true,
  autofocus: false,
  editorProps: {
    handleClick(_view, _pos, event) {
      const t = event.target as HTMLElement;
      const el = t.closest && (t.closest('[data-page-id]') as HTMLElement | null);
      if (el) {
        const id = el.getAttribute('data-page-id');
        if (id) {
          emit('navigate', id);
          return true;
        }
      }
      return false;
    },
  },
});

// 文档就绪后：若 fragment 为空（远端/本地都还没有内容），用初始 HTML 播种；
// 否则 ySync 会自行把 fragment 现有内容载入编辑器。播种后发一次 update 同步投影。
let seeded = false;
let attached = false;
let updateTimer: any = null;
function emitUpdate() {
  clearTimeout(updateTimer);
  updateTimer = setTimeout(() => {
    const html = editor.value?.getHTML() ?? '';
    emit('update', html);
    reportCutoverWrite();
  }, 150);
}
watch(
  editor,
  (e) => {
    if (!e || attached) return;
    attached = true;
    if (!seeded) {
      seeded = true;
      if ((fragment as any)?.length === 0 && props.initialHtml) {
        e.commands.setContent(props.initialHtml, false);
        emit('update', e.getHTML());
        reportCutoverWrite();
      }
    }
    reportCutoverBlock();
    e.on('update', emitUpdate);
  },
  { immediate: true },
);

onMounted(() => reportCutoverBlock());

onBeforeUnmount(() => {
  const e = editor.value;
  if (e) e.off('update', emitUpdate);
  e?.destroy();
});

function undo() {
  if (editor.value) undoCommand(editor.value.state, editor.value.view.dispatch);
}
function redo() {
  if (editor.value) redoCommand(editor.value.state, editor.value.view.dispatch);
}

// 供主组件「[[ 提及」菜单等调用：在光标处插入页面链接节点。
function insertPageLink(targetId: string, title: string) {
  editor.value?.chain().focus().insertContent({
    type: 'pageLink',
    attrs: { targetId, title, href: `#${targetId}` },
  }).run();
}

defineExpose({ undo, redo, insertPageLink });
</script>

<template>
  <div class="yjs-block">
    <EditorContent :editor="editor" />
  </div>
</template>

<style scoped>
.yjs-block :deep(.ProseMirror) {
  outline: none;
  min-height: 24px;
  font: inherit;
  line-height: 1.5;
  color: inherit;
  cursor: text;
}
.yjs-block :deep(.ProseMirror p) { margin: 0.15rem 0; }
.yjs-block :deep(.ProseMirror ul),
.yjs-block :deep(.ProseMirror ol) { margin: 0.15rem 0; padding-left: 1.4rem; }
.yjs-block :deep(.ProseMirror li) { margin: 0.06rem 0; }
.yjs-block :deep(.ProseMirror blockquote) {
  border-left: 3px solid rgb(var(--line));
  padding-left: 0.75rem;
  color: rgb(var(--dim));
  margin: 0.15rem 0;
}
.yjs-block :deep(.ProseMirror h1) { font-size: 1.4rem; font-weight: 700; margin: 0.5rem 0 0.25rem; }
.yjs-block :deep(.ProseMirror h2) { font-size: 1.2rem; font-weight: 700; margin: 0.4rem 0 0.2rem; }
.yjs-block :deep(.ProseMirror h3) { font-size: 1.05rem; font-weight: 700; margin: 0.35rem 0 0.15rem; }
.yjs-block :deep(.ProseMirror code) {
  background: rgb(var(--void));
  padding: 0.1em 0.3em;
  border-radius: 0.25rem;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.85em;
}
.yjs-block :deep(.ProseMirror pre) { background: rgb(var(--void)); padding: 0.6rem; border-radius: 0.5rem; overflow: auto; }
.yjs-block :deep(.ProseMirror table) { border-collapse: collapse; margin: 0.4rem 0; width: 100%; table-layout: fixed; }
.yjs-block :deep(.ProseMirror table td),
.yjs-block :deep(.ProseMirror table th) { border: 1px solid rgb(var(--line)); padding: 0.3rem 0.5rem; vertical-align: top; }
.yjs-block :deep(.ProseMirror table th) { background: rgb(var(--void)); }
.yjs-block :deep(.ProseMirror details) {
  border: 1px solid rgb(var(--line));
  border-radius: 0.4rem;
  margin: 0.4rem 0;
  padding: 0 0.6rem;
}
.yjs-block :deep(.ProseMirror details > summary) { cursor: pointer; font-weight: 600; padding: 0.3rem 0; list-style: none; }
.yjs-block :deep(.ProseMirror details > summary::-webkit-details-marker) { display: none; }
.yjs-block :deep(.yjs-cursor) { word-break: normal; }
.yjs-block :deep(.nexus-pagelink) {
  color: rgb(var(--accent));
  cursor: pointer;
  text-decoration: underline;
}
</style>
