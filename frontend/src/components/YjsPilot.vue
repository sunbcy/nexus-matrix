<script setup lang="ts">
// Phase 1 试点（路线 B）：用 Y.Array + IndexeddbPersistence 取代 prevId 链 / LWW 合并。
// 仅本地持久（connect:false，离线优先），验证「增删改 + 撤销 + 刷新后仍在」的收敛行为。
// 接入后端实时后在 createYjsDoc 打开 connect 即可多端同步（Phase 2）。
import { onMounted, onUnmounted, ref } from 'vue';
import { createYjsDoc, taskToYMap, yMapToTask } from '../composables/yjsDoc';

// 试点固定 room；生产接入时改为当前登录 room（JWT 解析所得）
const room = 'demo-room';
const pageId = 'pilot-demo';
const handle = createYjsDoc(room, pageId, { connect: false });

const blocks = ref<any[]>([]);
const newContent = ref('');

function render() {
  const arr = handle.yTasks;
  const out: any[] = [];
  for (let i = 0; i < arr.length; i++) {
    const m = arr.get(i);
    if (!m.get('deleted')) out.push(yMapToTask(m));
  }
  blocks.value = out;
}

handle.yTasks.observe(render);
handle.meta.observe(render);
onMounted(render);
onUnmounted(() => {
  handle.yTasks.unobserve(render);
  handle.meta.unobserve(render);
  handle.destroy();
});

function addBlock() {
  const id = 'blk-' + Math.random().toString(36).slice(2, 8);
  handle.yTasks.push([taskToYMap({ id, type: 'text', content: newContent.value || '新块', payload: {} })]);
  newContent.value = '';
}
function removeBlock(id: string) {
  const arr = handle.yTasks;
  for (let i = 0; i < arr.length; i++) {
    if (arr.get(i).get('id') === id) {
      arr.get(i).set('deleted', true); // 软删除（CRDT 字段，多端一致，可恢复）
      break;
    }
  }
}
function editBlock(id: string, content: string) {
  const arr = handle.yTasks;
  for (let i = 0; i < arr.length; i++) {
    if (arr.get(i).get('id') === id) {
      arr.get(i).set('content', content);
      break;
    }
  }
}
function undo() {
  handle.undoManager.undo();
}
</script>

<template>
  <div class="yjs-pilot p-3 border border-line rounded mt-3">
    <div class="text-[11px] font-['Rajdhani',sans-serif] text-dim uppercase tracking-wider mb-2">
      Yjs 试点（本地 IndexedDB 持久 · 离线优先 · 路线 B）
    </div>
    <div class="flex gap-2 mb-2">
      <input
        v-model="newContent"
        placeholder="新块内容"
        class="flex-1 bg-surface border border-line rounded px-2 py-1 text-xs"
      />
      <button
        @click="addBlock"
        class="px-3 py-1 bg-surface border border-line rounded text-xs hover:text-accent transition-colors"
      >
        添加
      </button>
      <button
        @click="undo"
        class="px-3 py-1 bg-surface border border-line rounded text-xs hover:text-accent transition-colors"
      >
        撤销
      </button>
    </div>
    <div v-for="b in blocks" :key="b.id" class="flex gap-2 items-center text-xs py-1">
      <input
        :value="b.content"
        @input="editBlock(b.id, ($event.target as HTMLInputElement).value)"
        class="flex-1 bg-surface border border-line rounded px-2 py-1"
      />
      <button
        @click="removeBlock(b.id)"
        class="px-2 py-1 text-warn border border-line rounded transition-colors"
      >
        删
      </button>
    </div>
    <div class="text-[10px] text-dim mt-2">块数：{{ blocks.length }} · 刷新页面后内容仍在（IndexedDB 持久）</div>
  </div>
</template>
