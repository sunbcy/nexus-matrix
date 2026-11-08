<script setup lang="ts">
// 架构 1：统一 ProseMirror + Yjs 编辑器（Notion 式单文档）。
// 整篇文档即一个 ProseMirror 文档，经 ySyncPlugin 绑到同一个 Y.Doc 的 Y.XmlFragment('doc')。
//  - ySyncPlugin    : 文档内容与 Yjs 双向同步（复用 pilot 的 connect/provider，零额外接线）
//  - yCursorPlugin  : 远端协作光标（读取 awareness 的 user.name/color）
//  - yUndoPlugin     : 协同级撤销（关闭 StarterKit 自带 history 以免与 Yjs 绑定冲突）
// 与 pilot 共享同一 handle（同一房间 / 同一份后端 /ws/yjs）。
import { onBeforeUnmount, onMounted, reactive, computed, watch } from 'vue';
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

const props = defineProps<{ handle: YjsDocHandle; docs?: { id: string; title: string; icon: string }[] }>();
const emit = defineEmits<{ links: [ids: string[]]; navigate: [id: string] }>();

// 文档链接芯片的实时标题解析器（随 props.docs 更新），避免链接标签停留在插入时的旧标题。
let docTitleResolver: (id: string) => string = () => '';
function updateDocResolver() {
  const map = new Map((props.docs || []).map((d) => [d.id, d.title]));
  docTitleResolver = (id: string) => map.get(id) ?? '';
}
updateDocResolver();
watch(() => props.docs, updateDocResolver, { deep: true });

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

// 把 y-prosemirror 的原生 ProseMirror 插件包进一个 Tiptap Extension。
// ⚠️ 不能把 ySyncPlugin/yCursorPlugin/yUndoPlugin 直接塞进 Tiptap 的 extensions 数组：
//    Tiptap 只会识别 Extension/Node/Mark 实例，原生 PM 插件会被静默丢弃，
//    导致编辑器内容无法同步到 Yjs（yGetDocText 取空、协作/快照/导出全部失效）。
const YjsSync = Extension.create({
  name: 'yjs-sync',
  addProseMirrorPlugins() {
    const plugins: any[] = [ySyncPlugin(fragment)];
    if (awareness) plugins.push(yCursorPlugin(awareness, { cursorBuilder }));
    plugins.push(yUndoPlugin());
    return plugins;
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
// 文档链接节点（[[双向链接]]）：行内 atom，存 targetId（文档 id）+ label（插入时的标题快照）。
// 渲染用 NodeView 显示「实时标题」（从 docTitleResolver 查当前标题），点击经 editorProps.handleClick 触发导航。
// ============================================================
const DocLink = Node.create({
  name: 'docLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,
  draggable: false,
  addAttributes() {
    return {
      targetId: { default: '' },
      label: { default: '' },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-doc-link]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-doc-link': '', class: 'yjs-doclink' })];
  },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('span');
      dom.className = 'yjs-doclink';
      dom.setAttribute('data-doc-link', '');
      dom.setAttribute('data-target', node.attrs.targetId);
      const render = () => {
        const title = docTitleResolver(node.attrs.targetId) || node.attrs.label || '(未知文档)';
        dom.textContent = '🔗 ' + title;
      };
      render();
      return { dom };
    };
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
  // [[ 文档链接 ]] 菜单 + 出链上报
  onEditorStateLink();
  emitLinks();
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

// ============================================================
// [[ 文档链接 ]] 自动补全：输入 "[[query" 弹出文档列表，选中插入 docLink 节点。
// 与 slash 共用 onEditorState 触发；导航点击在 editorProps.handleClick 处理。
// ============================================================
const linkMenu = reactive({ open: false, query: '', x: 0, y: 0, index: 0 });

const linkFlat = computed(() => {
  const q = linkMenu.query.trim().toLowerCase();
  const list = props.docs || [];
  if (!q) return list;
  return list.filter((d) => d.title.toLowerCase().includes(q));
});

function onEditorStateLink() {
  const e = editor.value;
  if (!e) return;
  const sel = e.state.selection as any;
  const $from = sel.$from;
  const textBefore = $from.parent.textBetween(0, $from.parentOffset, '\n', '\0');
  const m = /(?:^|\s)\[\[([^\]\n]*)$/.exec(textBefore);
  if (m) {
    const wasOpen = linkMenu.open;
    linkMenu.open = true;
    if (!wasOpen || linkMenu.query !== m[1]) linkMenu.index = 0;
    linkMenu.query = m[1];
    try {
      const coords = e.view.coordsAtPos($from.pos);
      linkMenu.x = coords.left;
      linkMenu.y = coords.bottom + 6;
    } catch { /* 坐标失败保持上次 */ }
  } else {
    linkMenu.open = false;
  }
}

function applyDocLink(d: { id: string; title: string }) {
  const e = editor.value;
  if (!e) return;
  const sel = e.state.selection as any;
  const $from = sel.$from;
  const textBefore = $from.parent.textBetween(0, $from.parentOffset, '\n', '\0');
  const m = /(?:^|\s)\[\[([^\]\n]*)$/.exec(textBefore);
  if (m) {
    const parentOffset = $from.parentOffset;
    const blockStart = $from.pos - parentOffset;
    const idx = m.index + (m[0][0] === ' ' ? 1 : 0);
    const from = blockStart + idx;
    const to = $from.pos;
    e.chain()
      .focus()
      .deleteRange({ from, to })
      .insertContent({ type: 'docLink', attrs: { targetId: d.id, label: d.title } })
      .run();
  }
  linkMenu.open = false;
}

function onDocMouseDownLink(ev: MouseEvent) {
  const t = ev.target as HTMLElement;
  if (linkMenu.open && !t.closest('.link-menu')) linkMenu.open = false;
}

const LinkNav = Extension.create({
  name: 'link-nav',
  addKeyboardShortcuts() {
    return {
      ArrowDown: () => {
        if (!linkMenu.open) return false;
        const n = linkFlat.value.length;
        if (!n) return true;
        linkMenu.index = (linkMenu.index + 1) % n;
        return true;
      },
      ArrowUp: () => {
        if (!linkMenu.open) return false;
        const n = linkFlat.value.length;
        if (!n) return true;
        linkMenu.index = (linkMenu.index - 1 + n) % n;
        return true;
      },
      Enter: () => {
        if (!linkMenu.open) return false;
        const items = linkFlat.value;
        if (!items.length) return true;
        applyDocLink(items[linkMenu.index]);
        return true;
      },
      Escape: () => {
        if (!linkMenu.open) return false;
        linkMenu.open = false;
        return true;
      },
    };
  },
});

// ---- 出链上报：编辑器内容变更时收集 docLink 节点的 targetId，去重后 emit 给父组件 ----
let lastLinks: string[] = [];
function collectLinks(): string[] {
  const e = editor.value;
  if (!e) return [];
  const ids: string[] = [];
  e.state.doc.descendants((n: any) => {
    if (n.type.name === 'docLink') ids.push(n.attrs.targetId);
  });
  return [...new Set(ids)];
}
function emitLinks() {
  const ids = collectLinks();
  if (JSON.stringify(ids) !== JSON.stringify(lastLinks)) {
    lastLinks = ids;
    emit('links', ids);
  }
}

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
  DocLink,
  Placeholder.configure({
    placeholder: '输入 "/" 插入块 · 输入 "[[" 链接到其它文档 · 支持标题、列表、待办、表格、折叠、标注、引用、代码块',
  }),
  SlashNav,
  LinkNav,
  YjsSync,
  yUndoKeymap,
];

const editor = useEditor({
  extensions,
  content: '',
  editable: true,
  autofocus: false,
  editorProps: {
    // 点击文档链接芯片 → 导航到目标文档
    handleClick(_view, _pos, event) {
      const t = event.target as HTMLElement;
      const el = t.closest && (t.closest('[data-doc-link]') as HTMLElement | null);
      if (el) {
        const id = el.getAttribute('data-target');
        if (id) {
          emit('navigate', id);
          return true;
        }
      }
      return false;
    },
  },
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
    emitLinks(); // 初始内容已含链接时，先把出链上报一次
  },
  { immediate: true },
);

onMounted(() => {
  cachedHandle = props.handle;
  registerTiptapFragmentRestorer(fragmentRestorer);
  document.addEventListener('mousedown', onDocMouseDown, true);
  document.addEventListener('mousedown', onDocMouseDownLink, true);
});

onBeforeUnmount(() => {
  const e = editor.value;
  if (e) {
    e.off('update', onEditorState);
    e.off('selectionUpdate', onEditorState);
  }
  document.removeEventListener('mousedown', onDocMouseDown, true);
  document.removeEventListener('mousedown', onDocMouseDownLink, true);
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

    <!-- [[ 文档链接 ]] 自动补全菜单 -->
    <div
      v-if="linkMenu.open"
      class="link-menu"
      :style="{ left: linkMenu.x + 'px', top: linkMenu.y + 'px' }"
    >
      <div class="link-title">链接到文档</div>
      <div
        v-for="(d, i) in linkFlat"
        :key="d.id"
        :class="['link-item', { active: i === linkMenu.index }]"
        @mousedown.prevent="applyDocLink(d)"
        @mouseenter="linkMenu.index = i"
      >
        <span class="link-icon">{{ d.icon }}</span>
        <span class="link-name">{{ d.title }}</span>
      </div>
      <div v-if="linkFlat.length === 0" class="link-empty">无匹配文档</div>
    </div>
  </div>
</template>

<style scoped>
/* [[ 文档链接 ]] 自动补全菜单 */
.link-menu {
  position: fixed;
  z-index: 80;
  min-width: 200px;
  max-height: 280px;
  overflow: auto;
  background: rgb(var(--surface));
  border: 1px solid rgb(var(--line));
  border-radius: 0.5rem;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
  padding: 0.25rem;
}
.link-title {
  font-size: 0.68rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgb(var(--dim));
  padding: 0.4rem 0.6rem 0.2rem;
}
.link-item {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  padding: 0.4rem 0.6rem;
  border-radius: 0.35rem;
  cursor: pointer;
  font-size: 0.85rem;
}
.link-item.active { background: rgb(var(--void)); }
.link-icon { width: 1.4rem; text-align: center; }
.link-name { color: rgb(var(--display)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.link-empty { padding: 0.5rem 0.6rem; font-size: 0.8rem; color: rgb(var(--dim)); }

/* 文档链接芯片（编辑器内） */
.yjs-editor :deep(.yjs-doclink) {
  display: inline;
  padding: 0.05em 0.35em;
  border-radius: 0.3rem;
  background: rgb(var(--void));
  border: 1px solid rgb(var(--line));
  color: rgb(var(--accent));
  cursor: pointer;
  font-size: 0.9em;
  white-space: nowrap;
}
.yjs-editor :deep(.yjs-doclink:hover) { border-color: rgb(var(--accent)); }

.yjs-editor :deep(.ProseMirror) {
  min-height: 60vh;
  outline: none;
  padding: 1rem 1.25rem;
  background: rgb(var(--surface));
  border: 1px solid rgb(var(--line));
  border-radius: 0.5rem;
  color: rgb(var(--display));
  font-size: 0.95rem;
  line-height: 1.5;
}
.yjs-editor :deep(.ProseMirror p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  color: rgb(var(--dim));
  float: left;
  height: 0;
  pointer-events: none;
}
/* 段落/列表/引用：紧凑块间距，贴近 Notion（默认 p 的浏览器 margin≈1em 过大） */
.yjs-editor :deep(.ProseMirror p) { margin: 0.15rem 0; }
.yjs-editor :deep(.ProseMirror ul),
.yjs-editor :deep(.ProseMirror ol) { margin: 0.15rem 0; }
.yjs-editor :deep(.ProseMirror li) { margin: 0.06rem 0; }
.yjs-editor :deep(.ProseMirror blockquote) { margin: 0.15rem 0; }
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
/* 复选框垂直居中于首行行盒（对齐 Notion：1em 方框落在 1lh 行高中线，替代硬编码 margin-top） */
.yjs-editor :deep(.ProseMirror ul[data-type="taskList"] li > label) {
  display: flex; align-items: center; height: 1lh; margin-top: 0;
}
/* 待办复选框：与 NexusTaskMatrix1 主文档保持同一观感（1em = 正文字号、细边框、accent 勾） */
.yjs-editor :deep(.ProseMirror ul[data-type="taskList"] li > label input[type="checkbox"]) {
  appearance: none; -webkit-appearance: none;
  flex-shrink: 0;
  width: 1em; height: 1em;
  margin: 0;
  font-size: inherit;
  position: relative;
  border: 1.5px solid rgb(var(--line));
  border-radius: 2px;
  background: rgb(var(--void));
  cursor: pointer;
  transition: all 0.15s;
}
.yjs-editor :deep(.ProseMirror ul[data-type="taskList"] li > label input[type="checkbox"]:checked) {
  border-color: rgb(var(--accent));
  background: rgb(var(--accent) / 0.2);
}
.yjs-editor :deep(.ProseMirror ul[data-type="taskList"] li > label input[type="checkbox"]:checked)::after {
  content: '';
  position: absolute;
  left: 0.32em; top: 0.08em;
  width: 0.3em; height: 0.55em;
  border: solid rgb(var(--accent));
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}
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
