<!-- src/App.vue -->
<script setup lang="ts">
// import NexusTaskMatrix from './components/NexusTaskMatrix.vue'
// import NexusTaskMatrix from './components/NotionPlus.vue'
import { ref } from 'vue';
import NexusTaskMatrix from './components/NexusTaskMatrix1.vue'
import { exportBackup, importBackup } from './composables/useSync'

const fileInput = ref<HTMLInputElement | null>(null)
const importMsg = ref('')

function onExport() {
  exportBackup()
}

function triggerImport() {
  fileInput.value?.click()
}

async function onImport(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const res = await importBackup(file)
  importMsg.value = res.message
  setTimeout(() => (importMsg.value = ''), 3000)
  input.value = ''  // 允许重复导入同一文件
}
</script>

<template>
  <div class="min-h-screen bg-nexus-void relative">
    <!-- 直接渲染 Notion 级核心组件 -->
    <NexusTaskMatrix />

    <!-- 备份工具栏（SQLite 之外的额外保险） -->
    <div class="fixed bottom-4 right-4 z-50 flex items-center gap-2">
      <span v-if="importMsg"
            class="text-xs text-[#00f0ff] font-['JetBrains_Mono',monospace] bg-[#090a0c] border border-[#1e2126] px-2 py-1 rounded shadow-lg">
        {{ importMsg }}
      </span>
      <button @click="onExport" title="导出 JSON 备份"
              class="w-9 h-9 flex items-center justify-center rounded bg-[#14161a] border border-[#1e2126] text-[#6b7280] hover:text-[#00f0ff] hover:border-[#00f0ff] transition-colors shadow-lg">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="7 10 12 15 17 10"></polyline>
          <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
      </button>
      <button @click="triggerImport" title="导入 JSON 备份"
              class="w-9 h-9 flex items-center justify-center rounded bg-[#14161a] border border-[#1e2126] text-[#6b7280] hover:text-[#00f0ff] hover:border-[#00f0ff] transition-colors shadow-lg">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="17 8 12 3 7 8"></polyline>
          <line x1="12" y1="3" x2="12" y2="15"></line>
        </svg>
      </button>
      <input ref="fileInput" type="file" accept="application/json,.json" class="hidden" @change="onImport" />
    </div>
  </div>
</template>