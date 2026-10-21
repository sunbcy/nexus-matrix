<!-- src/App.vue -->
<script setup lang="ts">
import NexusTaskMatrix from './components/NexusTaskMatrix1.vue'
import {exportBackup, storageError} from './composables/useSync'

// 存储告警触发时的一键导出（全局兜底：IndexedDB 写入失败 / 降级时让用户立刻抢救数据）。
// 常规的导入 / 导出已收敛进「设置 → 数据与备份」（见 SettingsPanel），
// 不再以浮动条形式常驻在每个页面右下角——那既违背「全局操作在侧边栏 / 设置」的
// 自建原则，也让「Notion ZIP 导入 = 批量新建页面」这类工作区级动作显得语义错位。
function onEmergencyExport() {
  exportBackup()
}
</script>

<template>
  <div class="min-h-screen bg-nexus-void relative">
    <!-- 直接渲染 Notion 级核心组件 -->
    <NexusTaskMatrix />

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
      <button class="shrink-0 text-[11px] font-['JetBrains_Mono',monospace] text-[#00f0ff] underline" @click="onEmergencyExport">
        立即导出
      </button>
    </div>
  </div>
</template>
