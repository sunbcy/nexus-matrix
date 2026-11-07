<script setup lang="ts">
// 架构 2 阶段 1：多文档工作区（MVP）。
// 左侧文档树（WorkspaceSidebar）+ 右侧统一编辑器（复用 YjsBlockEditor）。
// 每篇文档独立 Yjs 房间 / IndexedDB；快照、导入导出、协作光标都按「当前文档」隔离。
// 复用架构 1 的 YjsBlockEditor 与 yjsDoc 适配层，仅需在此编排「选哪篇文档」。
import { computed, onUnmounted, reactive, ref, watch } from 'vue';
import {
  useWorkspace,
} from '../composables/useWorkspace';
import {
  yTakeSnapshot, yListSnapshots, yRestoreSnapshot, yRemoveSnapshot,
  yExportDoc, yImportDoc, yGetDocText,
  type YjsSnapshot,
} from '../composables/yjsDoc';
import WorkspaceSidebar from './WorkspaceSidebar.vue';
import YjsBlockEditor from './YjsBlockEditor.vue';

const emit = defineEmits<{ close: [] }>();

const ws = useWorkspace({ connect: true });
const {
  docs, folders, activeId, activeHandle,
  createDoc, renameDoc, removeDoc, selectDoc,
  moveDoc, toggleFavorite, setIcon, setSnapCount, setDocLinks, getHandle,
  createFolder, renameFolder, removeFolder, setDocFolder, moveFolder,
} = ws;

// 编辑器上报的出链：写入当前文档清单的 links 字段（供反向链接 / 图谱使用）。
function onDocLinks(ids: string[]) {
  if (activeId.value) setDocLinks(activeId.value, ids);
}

const activeDoc = computed(() => docs.value.find((d) => d.id === activeId.value) || null);
const editorRef = ref<any>(null);

// ---- 标题（写入文档清单 + 当前文档 meta）----
function onTitle(v: string) {
  if (activeId.value) renameDoc(activeId.value, v);
}

// ---- Phase 3：Awareness（在线状态，随当前文档切换）----
const PALETTE = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];
const ME = {
  name: 'U-' + Math.random().toString(36).slice(2, 5).toUpperCase(),
  color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
};
interface Peer { clientId: number; name: string; color: string }
const peers = ref<Peer[]>([]);
let awarenessRef: any = null;
function refreshPeers() {
  const a = awarenessRef;
  if (!a) { peers.value = []; return; }
  const out: Peer[] = [];
  a.getStates().forEach((st: any, cid: number) => {
    if (cid === a.clientID) return;
    if (!st.user) return;
    out.push({ clientId: cid, name: st.user.name, color: st.user.color });
  });
  peers.value = out;
}
function bindAwareness() {
  if (awarenessRef) awarenessRef.off('change', refreshPeers);
  awarenessRef = activeHandle.value?.provider?.awareness ?? null;
  if (awarenessRef) {
    awarenessRef.setLocalStateField('user', ME);
    awarenessRef.on('change', refreshPeers);
  }
  refreshPeers();
}
watch(activeHandle, bindAwareness);

// ---- 版本快照（按当前文档）----
const snapshots = ref<YjsSnapshot[]>([]);
const showHistory = ref(false);
function refreshSnapshots() {
  snapshots.value = activeHandle.value ? yListSnapshots(activeHandle.value) : [];
}
watch(activeId, refreshSnapshots);

function takeSnapshot() {
  if (!activeHandle.value) return;
  const label = window.prompt('快照名称（留空自动命名）', '')?.trim();
  yTakeSnapshot(activeHandle.value, label || undefined);
  refreshSnapshots();
  if (activeId.value) setSnapCount(activeId.value, snapshots.value.length);
}
function restoreSnapshot(id: string) {
  if (!activeHandle.value) return;
  if (!window.confirm('恢复到该版本？当前内容将被覆盖（可用「撤销」回退）。')) return;
  yRestoreSnapshot(activeHandle.value, id);
}
function removeSnapshot(id: string) {
  if (!activeHandle.value) return;
  yRemoveSnapshot(activeHandle.value, id);
  refreshSnapshots();
  if (activeId.value) setSnapCount(activeId.value, snapshots.value.length);
}

// ---- 快照中心（按文档列表化展示）----
const showSnapCenter = ref(false);
const expandedSnapDoc = ref('');
const snapCache = reactive<Record<string, YjsSnapshot[]>>({});
function refreshSnapFor(id: string) {
  const h = getHandle(id);
  snapCache[id] = yListSnapshots(h);
  h.persistence.whenSynced.then(() => { snapCache[id] = yListSnapshots(h); });
}
function openSnapshotsFor(id: string) {
  if (!id) return;
  selectDoc(id);
  showSnapCenter.value = true;
  expandedSnapDoc.value = id;
  if (!snapCache[id]) refreshSnapFor(id);
}
function toggleSnapDoc(id: string) {
  if (expandedSnapDoc.value === id) { expandedSnapDoc.value = ''; return; }
  expandedSnapDoc.value = id;
  if (!snapCache[id]) refreshSnapFor(id);
}
function restoreSnapOf(id: string, sid: string) {
  if (!window.confirm('恢复到该版本？当前内容将被覆盖（可用「撤销」回退）。')) return;
  yRestoreSnapshot(getHandle(id), sid);
  snapCache[id] = yListSnapshots(getHandle(id));
}
function removeSnapOf(id: string, sid: string) {
  yRemoveSnapshot(getHandle(id), sid);
  const list = yListSnapshots(getHandle(id));
  snapCache[id] = list;
  setSnapCount(id, list.length);
}

// ---- 导入 / 导出（按当前文档）----
const fileInput = ref<HTMLInputElement | null>(null);
function onExport() {
  if (!activeHandle.value) return;
  const bytes = yExportDoc(activeHandle.value);
  const blob = new Blob([bytes as BlobPart], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${activeDoc.value?.title || activeId.value}-${Date.now()}.ybin`;
  a.click();
  URL.revokeObjectURL(url);
}
function onImportFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file || !activeHandle.value) return;
  file
    .arrayBuffer()
    .then((buf) => yImportDoc(activeHandle.value!, new Uint8Array(buf)))
    .finally(() => { input.value = ''; });
}

// ---- 撤销 / 重做（协同，走 yUndoPlugin）----
const undo = () => editorRef.value?.undo();
const redo = () => editorRef.value?.redo();

// ---- 删除文档（带确认）----
function onRemove(id: string) {
  if (!window.confirm('删除该文档？此操作不可撤销。')) return;
  removeDoc(id);
}

// ---- 拖拽落点 -> moveDoc 插入下标（修正 delete+insert 的 off-by-one）----
function onMove(p: { dragId: string; targetId: string; position: 'before' | 'after' }) {
  const arr = docs.value;
  const from = arr.findIndex((d) => d.id === p.dragId);
  const origC = arr.findIndex((d) => d.id === p.targetId);
  if (from < 0 || origC < 0 || from === origC) return;
  const cPost = origC - (from < origC ? 1 : 0); // 删除被拖项后目标的新下标
  const insertIndex = p.position === 'after' ? cPost + 1 : cPost;
  moveDoc(p.dragId, insertIndex);
}

// ---- 阶段 3：双向链接面板（出链 + 反向链接）----
const showLinks = ref(false);
const outgoingLinks = computed(() => {
  const a = activeDoc.value;
  if (!a) return [];
  return (a.links || [])
    .map((id) => docs.value.find((d) => d.id === id))
    .filter((d): d is NonNullable<typeof d> => Boolean(d));
});
const backlinks = computed(() =>
  docs.value.filter((d) => (d.links || []).includes(activeId.value) && d.id !== activeId.value),
);

// ---- 阶段 3：跨文档搜索（基于 yGetDocText 抽取纯文本）----
const showSearch = ref(false);
const searchQuery = ref('');
const searching = ref(false);
const searchResults = ref<{ id: string; title: string; icon: string; snippet: string; count: number }[]>([]);
async function runSearch() {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) {
    searchResults.value = [];
    return;
  }
  searching.value = true;
  const results: { id: string; title: string; icon: string; snippet: string; count: number }[] = [];
  for (const d of docs.value) {
    const h = getHandle(d.id);
    await h.persistence.whenSynced;
    const text = yGetDocText(h.ydoc);
    const lower = text.toLowerCase();
    let count = 0;
    let idx = lower.indexOf(q);
    while (idx !== -1) {
      count++;
      idx = lower.indexOf(q, idx + q.length);
    }
    if (count > 0) {
      const at = text.toLowerCase().indexOf(q);
      const start = Math.max(0, at - 30);
      const snippet = (start > 0 ? '…' : '') + text.slice(start, at + q.length + 30).replace(/\n+/g, ' ');
      results.push({ id: d.id, title: d.title, icon: d.icon, snippet, count });
    }
  }
  searchResults.value = results;
  searching.value = false;
}

// ---- 阶段 3：文件夹 / 分区 ----
function onCreateFolder() {
  createFolder('新文件夹');
}
function onRenameFolder(p: { id: string; name: string }) {
  renameFolder(p.id, p.name);
}
function onRemoveFolder(id: string) {
  if (!window.confirm('删除该文件夹？其下文档会回到「未分类」（不删除文档）。')) return;
  removeFolder(id);
}
function onSetDocFolder(p: { docId: string; folderId: string | null }) {
  setDocFolder(p.docId, p.folderId);
}
function onMoveFolder(p: { id: string; parentId: string | null }) {
  moveFolder(p.id, p.parentId);
}

onUnmounted(() => {
  if (awarenessRef) awarenessRef.off('change', refreshPeers);
  ws.destroy();
});
</script>

<template>
  <div class="fixed inset-0 z-[60] bg-void text-display flex font-['JetBrains_Mono',monospace]">
    <WorkspaceSidebar
      :docs="docs"
      :folders="folders"
      :active-id="activeId"
      @select="selectDoc"
      @create="createDoc"
      @rename="(p) => renameDoc(p.id, p.title)"
      @remove="onRemove"
      @move="onMove"
      @toggle-favorite="toggleFavorite"
      @set-icon="(p) => setIcon(p.id, p.icon)"
      @open-snapshots="openSnapshotsFor"
      @create-folder="onCreateFolder"
      @rename-folder="onRenameFolder"
      @remove-folder="onRemoveFolder"
      @set-doc-folder="onSetDocFolder"
      @move-folder="onMoveFolder"
    />

    <div class="flex-1 flex flex-col min-w-0">
      <header class="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-line shrink-0">
        <button
          @click="emit('close')"
          class="px-3 py-1.5 bg-surface border border-line rounded text-xs hover:text-accent hover:border-accent transition-colors"
        >← 返回</button>
        <input
          :value="activeDoc?.title"
          @input="onTitle(($event.target as HTMLInputElement).value)"
          placeholder="未命名文档"
          class="flex-1 min-w-[12rem] bg-transparent text-lg font-['Rajdhani',sans-serif] outline-none placeholder:text-dim"
        />

        <!-- 在线协作者（当前文档 Awareness） -->
        <div class="flex items-center gap-1.5">
          <span class="w-2 h-2 rounded-full" :style="{ background: ME.color }"></span>
          <span class="text-xs text-dim">{{ ME.name }}(我)</span>
          <template v-for="p in peers" :key="p.clientId">
            <span class="w-2 h-2 rounded-full" :style="{ background: p.color }"></span>
            <span class="text-xs" :style="{ color: p.color }">{{ p.name }}</span>
          </template>
        </div>

        <span class="text-[11px] text-dim hidden lg:inline">本地优先 · 离线可用 · 多端实时</span>

        <div class="ml-auto flex items-center gap-2">
          <button @click="onExport" class="px-3 py-1.5 bg-surface border border-line rounded text-xs hover:text-accent hover:border-accent transition-colors">导出</button>
          <button @click="fileInput?.click()" class="px-3 py-1.5 bg-surface border border-line rounded text-xs hover:text-accent hover:border-accent transition-colors">导入</button>
          <button @click="takeSnapshot" class="px-3 py-1.5 bg-surface border border-line rounded text-xs hover:text-accent hover:border-accent transition-colors">保存快照</button>
          <button @click="openSnapshotsFor(activeId)" class="px-3 py-1.5 bg-surface border border-line rounded text-xs hover:text-accent hover:border-accent transition-colors">快照中心</button>
          <button @click="showLinks = true" class="px-3 py-1.5 bg-surface border border-line rounded text-xs hover:text-accent hover:border-accent transition-colors">🔗 链接 ({{ (activeDoc?.links?.length || 0) + backlinks.length }})</button>
          <button @click="showSearch = true" class="px-3 py-1.5 bg-surface border border-line rounded text-xs hover:text-accent hover:border-accent transition-colors">🔍 搜索</button>
          <button @click="showHistory = !showHistory" class="px-3 py-1.5 bg-surface border border-line rounded text-xs hover:text-accent hover:border-accent transition-colors">版本历史 ({{ snapshots.length }})</button>
          <button @click="undo" class="px-3 py-1.5 bg-surface border border-line rounded text-xs hover:text-accent transition-colors">撤销</button>
          <button @click="redo" class="px-3 py-1.5 bg-surface border border-line rounded text-xs hover:text-accent transition-colors">重做</button>
        </div>
      </header>

      <div class="flex-1 overflow-auto px-4 py-5">
        <div class="max-w-3xl mx-auto w-full">
          <YjsBlockEditor v-if="activeHandle" :key="activeId" ref="editorRef" :handle="activeHandle" :docs="docs" @links="onDocLinks" @navigate="selectDoc" />

          <div v-if="showHistory" class="mt-8 pt-4 border-t border-line">
            <div class="text-xs text-dim mb-2">版本历史（Snapshot）· {{ snapshots.length }} 份 · 随文档 CRDT 同步</div>
            <div v-if="!snapshots.length" class="text-xs text-dim">暂无快照，点「保存快照」记录当前版本。</div>
            <div v-for="s in snapshots" :key="s.id" class="flex gap-2 items-center text-sm py-1">
              <span class="flex-1 truncate">{{ s.label }}</span>
              <span class="text-[10px] text-dim">{{ new Date(s.ts).toLocaleString() }}</span>
              <button @click="restoreSnapshot(s.id)" class="px-2 py-0.5 text-xs text-accent border border-line rounded hover:border-accent transition-colors">恢复</button>
              <button @click="removeSnapshot(s.id)" class="px-2 py-0.5 text-xs text-warn border border-line rounded hover:border-warn transition-colors">删</button>
            </div>
          </div>
        </div>
      </div>

      <footer class="px-4 py-2 border-t border-line text-[11px] text-dim shrink-0">
        工作区 · 文档 {{ docs.length }} · 当前协作者 {{ peers.length + 1 }}
        · 基于 Yjs CRDT（Y.XmlFragment + Y.Map），无 prevId、无 LWW 合并。
      </footer>
    </div>

    <!-- 快照中心：按文档列表化展示快照 -->
    <div v-if="showSnapCenter" class="fixed inset-0 z-[70] bg-black/60 flex items-start justify-center pt-20" @click.self="showSnapCenter = false">
      <div class="w-[440px] max-w-[92vw] bg-void border border-line rounded-lg shadow-2xl overflow-hidden">
        <header class="flex items-center justify-between px-4 py-3 border-b border-line">
          <span class="text-sm font-['Rajdhani',sans-serif]">快照中心 · 按文档</span>
          <button class="text-dim hover:text-warn" @click="showSnapCenter = false">✕</button>
        </header>
        <div class="max-h-[60vh] overflow-auto p-2">
          <div v-for="d in docs" :key="d.id" class="border-b border-line last:border-0">
            <button class="w-full flex items-center gap-2 px-2 py-2 text-left hover:bg-surface" @click="toggleSnapDoc(d.id)">
              <span class="text-base">{{ d.icon }}</span>
              <span class="flex-1 truncate text-sm text-display">{{ d.title }}</span>
              <span class="text-[11px] text-dim">📸 {{ d.snapCount }}</span>
              <span class="text-dim text-xs">{{ expandedSnapDoc === d.id ? '▾' : '▸' }}</span>
            </button>
            <div v-if="expandedSnapDoc === d.id" class="px-3 pb-2">
              <div v-if="!(snapCache[d.id] || []).length" class="text-[11px] text-dim py-1">该文档暂无快照</div>
              <div v-for="s in (snapCache[d.id] || [])" :key="s.id" class="flex gap-2 items-center text-sm py-1">
                <span class="flex-1 truncate text-display">{{ s.label }}</span>
                <span class="text-[10px] text-dim">{{ new Date(s.ts).toLocaleString() }}</span>
                <button class="px-2 py-0.5 text-xs text-accent border border-line rounded hover:border-accent transition-colors" @click="restoreSnapOf(d.id, s.id)">恢复</button>
                <button class="px-2 py-0.5 text-xs text-warn border border-line rounded hover:border-warn transition-colors" @click="removeSnapOf(d.id, s.id)">删</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 双向链接面板：出链 + 反向链接 -->
    <div v-if="showLinks" class="fixed inset-0 z-[70] bg-black/60 flex items-start justify-center pt-20" @click.self="showLinks = false">
      <div class="w-[420px] max-w-[92vw] bg-void border border-line rounded-lg shadow-2xl overflow-hidden">
        <header class="flex items-center justify-between px-4 py-3 border-b border-line">
          <span class="text-sm font-['Rajdhani',sans-serif]">双向链接 · {{ activeDoc?.title }}</span>
          <button class="text-dim hover:text-warn" @click="showLinks = false">✕</button>
        </header>
        <div class="max-h-[60vh] overflow-auto p-3 text-sm">
          <div class="text-xs text-dim mb-1">出链（本文档链接到）</div>
          <div v-if="!outgoingLinks.length" class="text-[11px] text-dim mb-2">暂无。在编辑器中输入「[[」可链接其它文档。</div>
          <div
            v-for="d in outgoingLinks"
            :key="d.id"
            class="flex items-center gap-2 px-2 py-1.5 hover:bg-surface rounded cursor-pointer"
            @click="selectDoc(d.id)"
          >
            <span>{{ d.icon }}</span><span class="flex-1 truncate">{{ d.title }}</span>
          </div>
          <div class="text-xs text-dim mt-3 mb-1">反向链接（其它文档链接到本文档）</div>
          <div v-if="!backlinks.length" class="text-[11px] text-dim">暂无其它文档链接到本文档。</div>
          <div
            v-for="d in backlinks"
            :key="d.id"
            class="flex items-center gap-2 px-2 py-1.5 hover:bg-surface rounded cursor-pointer"
            @click="selectDoc(d.id)"
          >
            <span>{{ d.icon }}</span><span class="flex-1 truncate">{{ d.title }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 跨文档搜索 -->
    <div v-if="showSearch" class="fixed inset-0 z-[70] bg-black/60 flex items-start justify-center pt-20" @click.self="showSearch = false">
      <div class="w-[520px] max-w-[92vw] bg-void border border-line rounded-lg shadow-2xl overflow-hidden">
        <header class="flex items-center gap-2 px-4 py-3 border-b border-line">
          <span class="text-sm">🔍 跨文档搜索</span>
          <input
            v-model="searchQuery"
            @input="runSearch"
            placeholder="输入关键词，跨所有文档检索…"
            class="flex-1 bg-surface border border-line rounded px-2 py-1 text-sm outline-none"
          />
          <button class="text-dim hover:text-warn" @click="showSearch = false">✕</button>
        </header>
        <div class="max-h-[60vh] overflow-auto p-2 text-sm">
          <div v-if="searching" class="text-[11px] text-dim p-2">检索中…</div>
          <div v-else-if="!searchResults.length && searchQuery.trim()" class="text-[11px] text-dim p-2">无匹配结果。</div>
          <div
            v-for="r in searchResults"
            :key="r.id"
            class="px-2 py-2 hover:bg-surface rounded cursor-pointer border-b border-line last:border-0"
            @click="selectDoc(r.id); showSearch = false"
          >
            <div class="flex items-center gap-2 text-xs">
              <span>{{ r.icon }}</span><span class="text-display">{{ r.title }}</span>
              <span class="text-dim ml-auto">{{ r.count }} 处</span>
            </div>
            <div class="text-[11px] text-dim mt-0.5 truncate">{{ r.snippet }}</div>
          </div>
        </div>
      </div>
    </div>

    <input ref="fileInput" type="file" accept=".ybin,.bin" @change="onImportFile" class="hidden" />
  </div>
</template>
