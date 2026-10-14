<!-- src/App.vue -->
<script setup lang="ts">
// import NexusTaskMatrix from './components/NexusTaskMatrix.vue'
// import NexusTaskMatrix from './components/NotionPlus.vue'
import { ref } from 'vue';
import NexusTaskMatrix from './components/NexusTaskMatrix1.vue'
import { exportBackup, importBackup, importMarkdown, importNotionZip } from './composables/useSync'

const fileInput = ref<HTMLInputElement | null>(null)
const mdInput = ref<HTMLInputElement | null>(null)
const zipInput = ref<HTMLInputElement | null>(null)
const importMsg = ref('')
const editorRef = ref<{ exportMarkdown?: () => void } | null>(null)

function onExport() {
  exportBackup()
}

function onExportMarkdown() {
  editorRef.value?.exportMarkdown?.()
}

function triggerImport() {
  fileInput.value?.click()
}

function triggerMarkdownImport() {
  mdInput.value?.click()
}

function triggerZipImport() {
  zipInput.value?.click()
}

async function onImport(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const res = await importBackup(file)
  importMsg.value = res.message
  setTimeout(() => (importMsg.value = ''), 4000)
  input.value = ''  // 允许重复导入同一文件
}

async function onMarkdownImport(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const res = await importMarkdown(file)
  importMsg.value = res.message
  setTimeout(() => (importMsg.value = ''), 5000)
  input.value = ''
}

async function onZipImport(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  importMsg.value = '正在解析 ZIP…'
  const res = await importNotionZip(file)
  importMsg.value = res.message
  setTimeout(() => (importMsg.value = ''), 8000)
  input.value = ''
}
</script>

<template>
  <div class="min-h-screen bg-nexus-void relative">
    <!-- 直接渲染 Notion 级核心组件 -->
    <NexusTaskMatrix ref="editorRef" />

    <!-- 备份工具栏（SQLite 之外的额外保险） -->
    <div class="fixed bottom-4 right-4 z-50 flex items-center gap-2">
      <span v-if="importMsg"
            class="text-xs text-[#00f0ff] font-['JetBrains_Mono',monospace] bg-[#090a0c] border border-[#1e2126] px-2 py-1 rounded shadow-lg">
        {{ importMsg }}
      </span>
      <button @click="onExportMarkdown" title="导出 Markdown"
              class="w-9 h-9 flex items-center justify-center rounded bg-[#14161a] border border-[#1e2126] text-[#6b7280] hover:text-[#00f0ff] hover:border-[#00f0ff] transition-colors shadow-lg">
        <span class="text-[11px] font-['JetBrains_Mono',monospace] font-bold">MD</span>
      </button>
      <button @click="onExport" title="导出 JSON 备份"
              class="w-9 h-9 flex items-center justify-center rounded bg-[#14161a] border border-[#1e2126] text-[#6b7280] hover:text-[#00f0ff] hover:border-[#00f0ff] transition-colors shadow-lg">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="7 10 12 15 17 10"></polyline>
          <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
      </button>
      <!-- Markdown 导入（Notion 导出的 .md 是主要目标） -->
      <button @click="triggerMarkdownImport" title="导入 Markdown 文件（含 Notion 导出）"
              class="h-9 px-2.5 flex items-center gap-1.5 rounded bg-[#14161a] border border-[#1e2126] text-[#6b7280] hover:text-[#00f0ff] hover:border-[#00f0ff] transition-colors shadow-lg">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
          <line x1="9" y1="13" x2="15" y2="13"></line>
          <line x1="9" y1="17" x2="13" y2="17"></line>
        </svg>
        <span class="text-[10px] font-['JetBrains_Mono',monospace] font-bold">IMPORT MD</span>
      </button>
      <input ref="mdInput" type="file" accept=".md,.markdown,text/markdown" class="hidden" @change="onMarkdownImport" />

      <!-- ZIP 导入（Notion 的 Markdown & CSV 导出包） -->
      <button @click="triggerZipImport" title="导入 Notion 导出的 ZIP"
              class="h-9 px-2.5 flex items-center gap-1.5 rounded bg-[#14161a] border border-[#1e2126] text-[#6b7280] hover:text-[#ffb000] hover:border-[#ffb000] transition-colors shadow-lg">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 8v13H3V8"></path>
          <path d="M1 3h22v5H1z"></path>
          <line x1="10" y1="12" x2="14" y2="12"></line>
        </svg>
        <span class="text-[10px] font-['JetBrains_Mono',monospace] font-bold">IMPORT ZIP</span>
      </button>
      <input ref="zipInput" type="file" accept=".zip,application/zip" class="hidden" @change="onZipImport" />

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