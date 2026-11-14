<script setup lang="ts">
import { computed, ref, reactive, onMounted, onBeforeUnmount } from 'vue';
import type { WsDoc, WsFolder } from '../composables/useWorkspace';

const props = defineProps<{ docs: WsDoc[]; folders: WsFolder[]; activeId: string }>();
const emit = defineEmits<{
  select: [id: string];
  create: [];
  rename: [payload: { id: string; title: string }];
  remove: [id: string];
  move: [payload: { dragId: string; targetId: string; position: 'before' | 'after' }];
  toggleFavorite: [id: string];
  setIcon: [payload: { id: string; icon: string }];
  openSnapshots: [id: string];
  createFolder: [];
  renameFolder: [payload: { id: string; name: string }];
  removeFolder: [id: string];
  setDocFolder: [payload: { docId: string; folderId: string | null }];
  moveFolder: [payload: { id: string; parentId: string | null }];
}>();

// ---- 文档重命名 ----
const editingId = ref('');
const draft = ref('');
function startRename(d: WsDoc) {
  editingId.value = d.id;
  draft.value = d.title;
}
function commitRename(d: WsDoc) {
  if (editingId.value !== d.id) return;
  const t = draft.value.trim() || '未命名文档';
  emit('rename', { id: d.id, title: t });
  editingId.value = '';
}

// ---- 文件夹：展开状态 / 重命名 ----
const expanded = reactive<Record<string, boolean>>({});
function isOpen(id: string) {
  return expanded[id] !== false; // 默认展开
}
function toggleFolder(id: string) {
  expanded[id] = !isOpen(id);
}
const editingFolderId = ref('');
const folderDraft = ref('');
function startFolderRename(f: WsFolder) {
  editingFolderId.value = f.id;
  folderDraft.value = f.name;
}
function commitFolderRename(f: WsFolder) {
  if (editingFolderId.value !== f.id) return;
  const t = folderDraft.value.trim() || '新文件夹';
  emit('renameFolder', { id: f.id, name: t });
  editingFolderId.value = '';
}

const folderMap = computed(() => {
  const m = new Map<string, WsFolder>();
  props.folders.forEach((f) => m.set(f.id, f));
  return m;
});

// 将「文件夹树 + 文档」拍平为带深度的列表（支持任意层级嵌套）。
const flatTree = computed(() => {
  const out: { kind: 'folder' | 'doc'; node: WsDoc | WsFolder; depth: number }[] = [];
  const build = (parentId: string | null, depth: number) => {
    props.folders
      .filter((f) => (f.parentId ?? null) === parentId)
      .forEach((f) => {
        out.push({ kind: 'folder', node: f, depth });
        if (isOpen(f.id)) {
          props.docs
            .filter((d) => d.folderId === f.id)
            .forEach((d) => out.push({ kind: 'doc', node: d, depth: depth + 1 }));
          build(f.id, depth + 1);
        }
      });
  };
  build(null, 0);
  // 未分类文档（folderId 为空）置于末尾
  props.docs.filter((d) => !d.folderId).forEach((d) => out.push({ kind: 'doc', node: d, depth: 0 }));
  return out;
});

function isDescendant(folderId: string, ancestorId: string): boolean {
  let cur = folderMap.value.get(folderId)?.parentId ?? null;
  while (cur) {
    if (cur === ancestorId) return true;
    cur = folderMap.value.get(cur)?.parentId ?? null;
  }
  return false;
}

// ---- 拖拽：文档排序 / 拖入文件夹 / 文件夹嵌套 ----
const dragKind = ref<'doc' | 'folder' | ''>('');
const dragId = ref('');
const dragOverId = ref('');
const dragPos = ref<'before' | 'after'>('before');
const folderDrop = ref('');

function resetDrag() {
  dragKind.value = '';
  dragId.value = '';
  dragOverId.value = '';
  dragPos.value = 'before';
  folderDrop.value = '';
}
function onDragStartDoc(id: string) {
  dragKind.value = 'doc';
  dragId.value = id;
}
function onDragStartFolder(id: string) {
  dragKind.value = 'folder';
  dragId.value = id;
}
function onDragOver(e: DragEvent, node: { kind: 'folder' | 'doc'; node: any; depth: number }) {
  e.preventDefault();
  if (!dragId.value) return;
  if (node.kind === 'doc') {
    if (dragKind.value === 'folder') {
      dragOverId.value = '';
      folderDrop.value = '';
      return;
    }
    if (dragId.value === node.node.id) {
      dragOverId.value = '';
      return;
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dragOverId.value = node.node.id;
    dragPos.value = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    folderDrop.value = '';
  } else {
    // 文件夹作为放置目标
    if (dragKind.value === 'folder') {
      if (dragId.value === node.node.id || isDescendant(dragId.value, node.node.id)) {
        folderDrop.value = '';
        return;
      }
    }
    folderDrop.value = node.node.id;
    dragOverId.value = '';
  }
}
function onDrop(node: { kind: 'folder' | 'doc'; node: any; depth: number }) {
  if (dragKind.value === 'doc' && node.kind === 'doc' && dragId.value !== node.node.id) {
    emit('move', { dragId: dragId.value, targetId: node.node.id, position: dragPos.value });
  } else if (dragKind.value === 'doc' && node.kind === 'folder') {
    emit('setDocFolder', { docId: dragId.value, folderId: node.node.id });
  } else if (
    dragKind.value === 'folder' &&
    node.kind === 'folder' &&
    dragId.value !== node.node.id &&
    !isDescendant(dragId.value, node.node.id)
  ) {
    emit('moveFolder', { id: dragId.value, parentId: node.node.id });
  }
  resetDrag();
}
function onDragEnd() {
  resetDrag();
}

// ---- 图标选择器（点外部自动关闭）----
const iconFor = ref('');
const EMOJIS = ['📄', '📝', '📓', '📚', '📌', '📊', '📈', '💡', '🔥', '🚀', '🎯', '🧩', '🔧', '🌟', '⭐', '💬', '🗂️', '🐛', '✅', '🔖'];
function toggleIcon(d: WsDoc) {
  iconFor.value = iconFor.value === d.id ? '' : d.id;
}
function pickIcon(emoji: string) {
  if (iconFor.value) emit('setIcon', { id: iconFor.value, icon: emoji });
  iconFor.value = '';
}
function onDocClick(e: Event) {
  const t = e.target as HTMLElement;
  if (t.closest && !t.closest('.ws-icon-ctx')) iconFor.value = '';
}
onMounted(() => document.addEventListener('click', onDocClick));
onBeforeUnmount(() => document.removeEventListener('click', onDocClick));
</script>

<template>
  <aside class="ws-sidebar">
    <div class="ws-sidebar-head">
      <span class="ws-sidebar-title">工作区</span>
      <div class="ws-head-btns">
        <button class="ws-new" title="新建文件夹" @click="emit('createFolder')">📁+</button>
        <button class="ws-new" title="新建文档" @click="emit('create')">＋</button>
      </div>
    </div>

    <ul class="ws-list">
      <template v-for="row in flatTree" :key="(row.node as any).id">
        <!-- 文件夹 -->
        <li
          v-if="row.kind === 'folder'"
          class="ws-folder"
          :class="{ 'drop-target': folderDrop === (row.node as any).id, open: isOpen((row.node as any).id) }"
          :style="{ paddingLeft: row.depth * 0.8 + 0.5 + 'rem' }"
          :draggable="true"
          @dragstart="onDragStartFolder((row.node as any).id)"
          @dragover.prevent="onDragOver($event, row)"
          @drop="onDrop(row)"
          @dragend="onDragEnd"
        >
          <button class="ws-folder-toggle" @click.stop="toggleFolder((row.node as any).id)">
            {{ isOpen((row.node as any).id) ? '▾' : '▸' }}
          </button>
          <span class="ws-folder-icon">📁</span>
          <input
            v-if="editingFolderId === (row.node as any).id"
            v-model="folderDraft"
            class="ws-rename"
            @click.stop
            @keydown.enter.prevent="commitFolderRename(row.node as WsFolder)"
            @keydown.esc.prevent="editingFolderId = ''"
            @blur="commitFolderRename(row.node as WsFolder)"
          />
          <span v-else class="ws-folder-name" @dblclick.stop="startFolderRename(row.node as WsFolder)">
            {{ (row.node as WsFolder).name }}
          </span>
          <button class="ws-del" title="删除文件夹" @click.stop="emit('removeFolder', (row.node as any).id)">✕</button>
        </li>

        <!-- 文档 -->
        <li
          v-else
          :draggable="true"
          :style="{ paddingLeft: row.depth * 0.8 + 0.45 + 'rem' }"
          :class="[
            'ws-item',
            { active: (row.node as WsDoc).id === activeId, dragging: (row.node as WsDoc).id === dragId,
              'drop-before': dragOverId === (row.node as WsDoc).id && dragPos === 'before',
              'drop-after': dragOverId === (row.node as WsDoc).id && dragPos === 'after' },
          ]"
          @click="emit('select', (row.node as WsDoc).id)"
          @dragstart="onDragStartDoc((row.node as WsDoc).id)"
          @dragover.prevent="onDragOver($event, row)"
          @drop="onDrop(row)"
          @dragend="onDragEnd"
        >
          <button
            class="ws-star"
            :class="{ on: (row.node as WsDoc).favorite }"
            title="收藏"
            @click.stop="emit('toggleFavorite', (row.node as WsDoc).id)"
          >{{ (row.node as WsDoc).favorite ? '★' : '☆' }}</button>

          <span class="ws-icon-ctx">
            <button class="ws-icon-btn" title="更改图标" @click.stop="toggleIcon(row.node as WsDoc)">{{ (row.node as WsDoc).icon }}</button>
            <div v-if="iconFor === (row.node as WsDoc).id" class="ws-emojis" @click.stop>
              <button v-for="e in EMOJIS" :key="e" class="ws-emoji" @click="pickIcon(e)">{{ e }}</button>
            </div>
          </span>

          <input
            v-if="editingId === (row.node as WsDoc).id"
            v-model="draft"
            class="ws-rename"
            @click.stop
            @keydown.enter.prevent="commitRename(row.node as WsDoc)"
            @keydown.esc.prevent="editingId = ''"
            @blur="commitRename(row.node as WsDoc)"
          />
          <span v-else class="ws-name" @dblclick.stop="startRename(row.node as WsDoc)">{{ (row.node as WsDoc).title }}</span>

          <span
            v-if="(row.node as WsDoc).snapCount > 0"
            class="ws-snap"
            title="查看该文档快照"
            @click.stop="emit('openSnapshots', (row.node as WsDoc).id)"
          >📸{{ (row.node as WsDoc).snapCount }}</span>

          <button class="ws-del" title="删除" @click.stop="emit('remove', (row.node as WsDoc).id)">✕</button>
        </li>
      </template>

      <li v-if="docs.length === 0 && folders.length === 0" class="ws-empty">暂无内容，点 ＋ 新建</li>
    </ul>
  </aside>
</template>

<style scoped>
.ws-sidebar {
  width: 250px;
  flex-shrink: 0;
  border-right: 1px solid rgb(var(--line));
  display: flex;
  flex-direction: column;
  background: rgb(var(--surface));
}
.ws-sidebar-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 0.85rem;
  border-bottom: 1px solid rgb(var(--line));
}
.ws-sidebar-title {
  font-size: 0.72rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgb(var(--dim));
}
.ws-head-btns { display: flex; gap: 0.35rem; }
.ws-new {
  width: 1.6rem;
  height: 1.6rem;
  border-radius: 0.35rem;
  border: 1px solid rgb(var(--line));
  color: rgb(var(--dim));
  font-size: 0.9rem;
  line-height: 1;
}
.ws-new:hover { color: rgb(var(--accent)); border-color: rgb(var(--accent)); }
.ws-list { list-style: none; margin: 0; padding: 0.4rem; flex: 1; overflow: auto; }

/* 文件夹行 */
.ws-folder {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.32rem 0.45rem;
  border-radius: 0.35rem;
  cursor: pointer;
  font-size: 0.85rem;
  color: rgb(var(--display));
}
.ws-folder:hover { background: rgb(var(--surface)); }
.ws-folder.drop-target { outline: 1px dashed rgb(var(--accent)); background: rgb(var(--surface)); }
.ws-folder-toggle { background: none; border: none; color: rgb(var(--dim)); width: 1rem; }
.ws-folder-icon { font-size: 0.9rem; }
.ws-folder-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* 文档行 */
.ws-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem 0.45rem;
  border-radius: 0.35rem;
  cursor: pointer;
  font-size: 0.85rem;
}
.ws-item:hover { background: rgb(var(--surface)); }
.ws-item.active { background: rgb(var(--surface)); }
.ws-item.dragging { opacity: 0.4; }
/* 拖拽插入位置指示线 */
.ws-item.drop-before::before,
.ws-item.drop-after::after {
  content: '';
  position: absolute;
  left: 0.4rem;
  right: 0.4rem;
  height: 2px;
  background: rgb(var(--accent));
  border-radius: 2px;
}
.ws-item.drop-before::before { top: -1px; }
.ws-item.drop-after::after { bottom: -1px; }

.ws-star {
  background: none; border: none; color: rgb(var(--dim));
  font-size: 0.8rem; width: 1rem; flex-shrink: 0;
}
.ws-star.on { color: rgb(var(--warn)); }
.ws-star:hover { color: rgb(var(--warn)); }
.ws-icon-ctx { position: relative; display: inline-flex; }
.ws-icon-btn {
  background: none; border: none; font-size: 0.95rem;
  width: 1.3rem; flex-shrink: 0; line-height: 1;
}
.ws-icon-btn:hover { filter: brightness(1.2); }
.ws-name {
  flex: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: rgb(var(--display));
}
.ws-rename {
  flex: 1; min-width: 0;
  background: rgb(var(--void)); border: 1px solid rgb(var(--line));
  border-radius: 0.25rem; padding: 0.1rem 0.3rem;
  color: rgb(var(--display)); outline: none;
}
.ws-snap {
  font-size: 0.65rem; color: rgb(var(--dim));
  background: rgb(var(--surface)); border: 1px solid rgb(var(--line));
  border-radius: 0.3rem; padding: 0 0.3rem; cursor: pointer; flex-shrink: 0;
}
.ws-snap:hover { color: rgb(var(--accent)); border-color: rgb(var(--accent)); }
.ws-del { color: rgb(var(--dim)); opacity: 0; background: none; border: none; font-size: 0.75rem; flex-shrink: 0; }
.ws-item:hover .ws-del, .ws-folder:hover .ws-del { opacity: 1; }
.ws-del:hover { color: rgb(var(--warn)); }
.ws-empty { padding: 0.75rem 0.5rem; font-size: 0.78rem; color: rgb(var(--dim)); }

.ws-emojis {
  position: absolute;
  top: 100%; left: 0; z-index: 20;
  display: grid; grid-template-columns: repeat(5, 1fr); gap: 0.1rem;
  width: 180px; padding: 0.35rem;
  background: rgb(var(--panel, var(--void)));
  border: 1px solid rgb(var(--line)); border-radius: 0.4rem;
  box-shadow: 0 6px 18px rgba(0,0,0,0.4);
}
.ws-emoji { background: none; border: none; font-size: 1rem; padding: 0.15rem; border-radius: 0.25rem; }
.ws-emoji:hover { background: rgb(var(--surface)); }
</style>
