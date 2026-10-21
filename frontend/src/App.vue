<!-- src/App.vue -->
<script setup lang="ts">
import {ref} from 'vue';
import NexusTaskMatrix from './components/NexusTaskMatrix1.vue'
import {exportBackup, importBackup, importMarkdown, importNotionZip, storageError} from './composables/useSync'

const fileInput = ref<HTMLInputElement | null>(null)
const mdInput = ref<HTMLInputElement | null>(null)
const zipInput = ref<HTMLInputElement | null>(null)
const importMsg = ref('')
const editorRef = ref<{ exportMarkdown?: () => void } | null>(null)
// 移动端工具栏折叠状态（桌面端忽略，CSS md: 断点始终展开）
const toolsOpen = ref(false)

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

    <!-- 存储告警横幅：本地写入失败 / IndexedDB 降级时必须让用户看见。
         此前这些失败只在 console 打日志，用户以为存了、重开发现没了。 -->
    <div v-if="storageError"
         class="fixed left-1/2 -translate-x-1/2 top-[calc(0.5rem+env(safe-area-inset-top,0px))] z-[80] max-w-[92vw]
                flex items-center gap-2 px-3 py-2 rounded bg-[#2a1214] border border-[#ff2a2a]/60 shadow-lg">
      <svg class="shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ff2a2a" stroke-width="2" stroke-linecap="round">
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
        <line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line>
      </svg>
      <span class="text-xs font-['JetBrains_Mono',monospace] text-[#ffb0b0] leading-snug">{{ storageError }}</span>
      <button class="shrink-0 text-[11px] font-['JetBrains_Mono',monospace] text-[#00f0ff] underline" @click="onExport">
        立即导出
      </button>
    </div>

    <!-- 备份工具栏（SQLite 之外的额外保险）。
         移动端适配：底部留出安全区（WebView 边到边时避开手势条）；按钮放大到 44px 触摸目标；
         z-index 降到 20——必须低于抽屉遮罩(30)与抽屉(40)，否则开抽屉时工具栏浮在遮罩上方很违和。
         格式工具栏/弹窗仍是 z-50，不受影响。 -->
    <div class="fixed right-4 z-20 flex flex-col items-end gap-2 bottom-[calc(1rem+env(safe-area-inset-bottom,0px))]">
      <!-- 移动端折叠开关：五个按钮平铺会占掉半屏宽并压在拇指热区上，
           收起成一个 44px 圆钮，需要时再展开（桌面端隐藏，始终展开）。 -->
      <button class="md:hidden w-11 h-11 flex items-center justify-center rounded-full bg-[#14161a] border border-[#1e2126] text-[#6b7280] active:text-[#00f0ff] active:border-[#00f0ff] transition-colors shadow-lg"
              :title="toolsOpen ? '收起工具' : '展开工具'"
              :aria-label="toolsOpen ? '收起工具' : '展开工具'"
              @click="toolsOpen = !toolsOpen">
        <svg v-if="!toolsOpen" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="5" r="1.5"></circle><circle cx="12" cy="12" r="1.5"></circle><circle cx="12" cy="19" r="1.5"></circle></svg>
        <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
      <span v-if="importMsg"
            class="text-xs text-[#00f0ff] font-['JetBrains_Mono',monospace] bg-[#090a0c] border border-[#1e2126] px-2 py-1 rounded shadow-lg">
        {{ importMsg }}
      </span>
      <div class="flex items-center gap-2" :class="toolsOpen ? 'flex' : 'hidden md:flex'">
      <button @click="onExportMarkdown" title="导出 Markdown"
              class="w-11 h-11 md:w-9 md:h-9 flex items-center justify-center rounded bg-[#14161a] border border-[#1e2126] text-[#6b7280] active:text-[#00f0ff] active:border-[#00f0ff] transition-colors shadow-lg">
        <span class="text-[11px] font-['JetBrains_Mono',monospace] font-bold">MD</span>
      </button>
      <button @click="onExport" title="导出 JSON 备份"
              class="w-11 h-11 md:w-9 md:h-9 flex items-center justify-center rounded bg-[#14161a] border border-[#1e2126] text-[#6b7280] active:text-[#00f0ff] active:border-[#00f0ff] transition-colors shadow-lg">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="7 10 12 15 17 10"></polyline>
          <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
      </button>
      <!-- Markdown 导入（Notion 导出的 .md 是主要目标） -->
      <button @click="triggerMarkdownImport" title="导入 Markdown 文件（含 Notion 导出）"
              class="h-11 md:h-9 px-3 md:px-2.5 flex items-center gap-1.5 rounded bg-[#14161a] border border-[#1e2126] text-[#6b7280] active:text-[#00f0ff] active:border-[#00f0ff] transition-colors shadow-lg">
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
              class="h-11 md:h-9 px-3 md:px-2.5 flex items-center gap-1.5 rounded bg-[#14161a] border border-[#1e2126] text-[#6b7280] active:text-[#ffb000] active:border-[#ffb000] transition-colors shadow-lg">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 8v13H3V8"></path>
          <path d="M1 3h22v5H1z"></path>
          <line x1="10" y1="12" x2="14" y2="12"></line>
        </svg>
        <span class="text-[10px] font-['JetBrains_Mono',monospace] font-bold">IMPORT ZIP</span>
      </button>
      <input ref="zipInput" type="file" accept=".zip,application/zip" class="hidden" @change="onZipImport" />

      <button @click="triggerImport" title="导入 JSON 备份"
              class="w-11 h-11 md:w-9 md:h-9 flex items-center justify-center rounded bg-[#14161a] border border-[#1e2126] text-[#6b7280] active:text-[#00f0ff] active:border-[#00f0ff] transition-colors shadow-lg">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="17 8 12 3 7 8"></polyline>
          <line x1="12" y1="3" x2="12" y2="15"></line>
        </svg>
      </button>
      <input ref="fileInput" type="file" accept="application/json,.json" class="hidden" @change="onImport" />
      </div>
    </div>
  </div>
</template>