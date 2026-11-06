<script setup lang="ts">
// 架构 1：Yjs 试点统一编辑器（Notion 式单文档）。
// 整篇文档 = 一个 ProseMirror 文档，经 ySyncPlugin 绑到 Y.Doc 的 Y.XmlFragment('doc')，
// 多端实时 + 离线优先（IndexedDB）+ 协作光标 + 版本快照 + 导入/导出。
// 不再有「块列表 / 富文本」双模式，统一由 YjsBlockEditor 承载。
import { onMounted, onUnmounted, ref } from 'vue';
import {
  createYjsDoc,
  yTakeSnapshot, yListSnapshots, yRestoreSnapshot, yRemoveSnapshot,
  yExportDoc, yImportDoc,
  type YjsDocHandle, type YjsSnapshot,
} from '../composables/yjsDoc';
import YjsBlockEditor from './YjsBlockEditor.vue';

const emit = defineEmits<{ close: [] }>();

// 试点固定 room（v2：切换统一 'doc' 模型后，旧的 IndexedDB('tiptap'/'tasks') 数据不再加载，
// 升 v2 起一个干净起点，避免历史脏数据混入）。connect:true 走后端 /ws/yjs
//（syncServer 见 runtimeConfig，生产即同源后端）。
const room = 'pilot-room-v2';
const pageId = 'pilot-doc';
const handle: YjsDocHandle = createYjsDoc(room, pageId, { connect: true });

const title = ref('');
const snapshots = ref<YjsSnapshot[]>([]);
const showHistory = ref(false);
const editorRef = ref<any>(null);

// ---- Phase 3：Awareness（在线状态）----
const PALETTE = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];
const ME = {
  name: 'U-' + Math.random().toString(36).slice(2, 5).toUpperCase(),
  color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
};
const awareness = handle.provider?.awareness ?? null;
if (awareness) awareness.setLocalStateField('user', ME);

interface Peer { clientId: number; name: string; color: string }
const peers = ref<Peer[]>([]);
function refreshPeers() {
  if (!awareness) { peers.value = []; return; }
  const out: Peer[] = [];
  awareness.getStates().forEach((st: any, cid: number) => {
    if (cid === awareness!.clientID) return;
    if (!st.user) return;
    out.push({ clientId: cid, name: st.user.name, color: st.user.color });
  });
  peers.value = out;
}
awareness?.on('change', refreshPeers);

function refreshSnapshots() {
  snapshots.value = yListSnapshots(handle);
}

// ---- 标题 ----
const onTitle = (v: string) => handle.meta.set('title', v);

// ---- 版本快照 ----
function takeSnapshot() {
  const label = window.prompt('快照名称（留空自动命名）', '')?.trim();
  yTakeSnapshot(handle, label || undefined);
  refreshSnapshots();
}
function restoreSnapshot(id: string) {
  if (!window.confirm('恢复到该版本？当前内容将被覆盖（可用「撤销」回退）。')) return;
  yRestoreSnapshot(handle, id);
}
function removeSnapshot(id: string) {
  yRemoveSnapshot(handle, id);
  refreshSnapshots();
}

// ---- 导入 / 导出（Phase 5，文档级）----
const fileInput = ref<HTMLInputElement | null>(null);
function onExport() {
  const bytes = yExportDoc(handle);
  const blob = new Blob([bytes as BlobPart], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${room}-${Date.now()}.ybin`;
  a.click();
  URL.revokeObjectURL(url);
}
function onImportFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  file
    .arrayBuffer()
    .then((buf) => yImportDoc(handle, new Uint8Array(buf)))
    .finally(() => { input.value = ''; });
}

// ---- 撤销 / 重做（协同，走 yUndoPlugin）----
const undo = () => editorRef.value?.undo();
const redo = () => editorRef.value?.redo();

onMounted(() => {
  title.value = (handle.meta.get('title') as string) ?? '';
  refreshPeers();
  refreshSnapshots();
});

onUnmounted(() => {
  awareness?.off('change', refreshPeers);
  handle.destroy();
});
</script>

<template>
  <div class="fixed inset-0 z-[60] bg-void text-display flex flex-col font-['JetBrains_Mono',monospace]">
    <input ref="fileInput" type="file" accept=".ybin,.bin" @change="onImportFile" class="hidden" />
    <header class="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-line shrink-0">
      <button
        @click="emit('close')"
        class="px-3 py-1.5 bg-surface border border-line rounded text-xs hover:text-accent hover:border-accent transition-colors"
      >← 返回</button>
      <input
        :value="title"
        @input="onTitle(($event.target as HTMLInputElement).value)"
        placeholder="无标题文档"
        class="flex-1 min-w-[12rem] bg-transparent text-lg font-['Rajdhani',sans-serif] outline-none placeholder:text-dim"
      />

      <!-- 在线协作者（Awareness） -->
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
        <button
          @click="onExport"
          class="px-3 py-1.5 bg-surface border border-line rounded text-xs hover:text-accent hover:border-accent transition-colors"
        >导出</button>
        <button
          @click="fileInput?.click()"
          class="px-3 py-1.5 bg-surface border border-line rounded text-xs hover:text-accent hover:border-accent transition-colors"
        >导入</button>
        <button
          @click="takeSnapshot"
          class="px-3 py-1.5 bg-surface border border-line rounded text-xs hover:text-accent hover:border-accent transition-colors"
        >保存快照</button>
        <button
          @click="showHistory = !showHistory"
          class="px-3 py-1.5 bg-surface border border-line rounded text-xs hover:text-accent hover:border-accent transition-colors"
        >版本历史 ({{ snapshots.length }})</button>
        <button
          @click="undo"
          class="px-3 py-1.5 bg-surface border border-line rounded text-xs hover:text-accent transition-colors"
        >撤销</button>
        <button
          @click="redo"
          class="px-3 py-1.5 bg-surface border border-line rounded text-xs hover:text-accent transition-colors"
        >重做</button>
      </div>
    </header>

    <div class="flex-1 overflow-auto px-4 py-5">
      <div class="max-w-3xl mx-auto w-full">
        <YjsBlockEditor ref="editorRef" :handle="handle" />

        <div v-if="showHistory" class="mt-8 pt-4 border-t border-line">
          <div class="text-xs text-dim mb-2">版本历史（Snapshot）· {{ snapshots.length }} 份 · 随文档 CRDT 同步</div>
          <div v-if="!snapshots.length" class="text-xs text-dim">暂无快照，点「保存快照」记录当前版本。</div>
          <div
            v-for="s in snapshots" :key="s.id"
            class="flex gap-2 items-center text-sm py-1"
          >
            <span class="flex-1 truncate">{{ s.label }}</span>
            <span class="text-[10px] text-dim">{{ new Date(s.ts).toLocaleString() }}</span>
            <button
              @click="restoreSnapshot(s.id)"
              class="px-2 py-0.5 text-xs text-accent border border-line rounded hover:border-accent transition-colors"
            >恢复</button>
            <button
              @click="removeSnapshot(s.id)"
              class="px-2 py-0.5 text-xs text-warn border border-line rounded hover:border-warn transition-colors"
            >删</button>
          </div>
        </div>
      </div>
    </div>

    <footer class="px-4 py-2 border-t border-line text-[11px] text-dim shrink-0">
      Awareness 在线 {{ peers.length + 1 }} · 版本 {{ snapshots.length }}
      · 基于 Yjs CRDT（Y.XmlFragment + Y.Map），无 prevId、无 LWW 合并。
    </footer>
  </div>
</template>
