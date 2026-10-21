<!--
  设置面板（2026-10-17）。

  由来：Android 原生底部有个「设置」Tab，但它与编辑器互斥地占用约 56dp 垂直空间，
  而移动端内容区高度极其宝贵。同时 Notion 移动端也没有底部设置 Tab —— 全局操作
  在侧边栏，页面操作在内容页右上「···」。因此把设置能力收回 Web 侧，
  入口放在侧边栏右上角齿轮（见 NexusTaskMatrix1.vue 侧边栏头部）。

  形态与项目其它浮层一致：触屏 bottom sheet / 桌面居中弹窗（单容器双形态）。

  数据与备份（2026-10-22）：导入 / 导出原先是一组常驻在每个页面右下角的浮动按钮，
  既违背上面「全局操作在侧边栏 / 设置」的原则，也让「Notion ZIP 导入 = 批量新建页面」
  这种工作区级动作显得语义错位。现收敛到本面板的「数据与备份」分区。
  其中「导入 Notion ZIP」改为唤起预览式导入向导（见 NexusTaskMatrix1.vue），
  避免选完 ZIP 静默新建一堆页面。
-->
<script setup lang="ts">
import {computed, onMounted, ref} from 'vue';
import {useMobileInput} from '../composables/useMobileInput';
import {
  exportBackup,
  importBackup,
  importMarkdown,
  onlineDevices,
  retrySync,
  storageError,
  syncStatus
} from '../composables/useSync';
import {getRuntimeConfig, SYNC_API_KEY_STORAGE_KEY, SYNC_SERVER_STORAGE_KEY} from '../runtimeConfig';

const props = defineProps<{ visible: boolean }>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'export-md'): void; (e: 'open-notion-import'): void }>();

const { isCoarsePointer } = useMobileInput();

// 同步服务器地址：Web 侧可编辑，保存到 localStorage 后重载生效。
// 移动端 WebView 的 location.host 不是后端地址，不配置就连不上。
const SYNC_KEY = SYNC_SERVER_STORAGE_KEY;
const API_KEY_STORAGE = SYNC_API_KEY_STORAGE_KEY;
const serverInput = ref('');
const apiKeyInput = ref('');
const savedMsg = ref('');

// 存储诊断：让用户能自己确认数据到底存没存住（IndexedDB 是否可用 + 配额）
const storageInfo = ref<{ usage: number; quota: number; persisted: boolean } | null>(null);
const idbOk = ref<boolean | null>(null);

onMounted(() => {
  serverInput.value = getRuntimeConfig().syncServer || localStorage.getItem(SYNC_KEY) || '';
  apiKeyInput.value = getRuntimeConfig().apiKey || localStorage.getItem(API_KEY_STORAGE) || '';
  void refreshStorageInfo();
});

const refreshStorageInfo = async () => {
  try {
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      storageInfo.value = {
        usage: est.usage ?? 0,
        quota: est.quota ?? 0,
        persisted: (await navigator.storage.persisted?.()) ?? false,
      };
    }
  } catch {
    storageInfo.value = null;
  }
  // 直接探一次 IndexedDB，确认页面数据的存储链路真的可用
  try {
    const { probeIdb } = await import('../composables/idbStore');
    idbOk.value = await probeIdb();
  } catch {
    idbOk.value = false;
  }
};

const formatBytes = (n: number): string => {
  if (n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${(n / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
};

const syncLabel = computed(() => {
  if (syncStatus.value === 'online') return `已连接 · 在线设备 ${onlineDevices.value}`;
  if (syncStatus.value === 'connecting') return '正在连接…';
  return '未连接（纯本地模式）';
});

const saveServer = () => {
  const v = serverInput.value.trim().replace(/\/+$/, '');
  if (v) localStorage.setItem(SYNC_KEY, v);
  else localStorage.removeItem(SYNC_KEY);
  const k = apiKeyInput.value.trim();
  if (k) localStorage.setItem(API_KEY_STORAGE, k);
  else localStorage.removeItem(API_KEY_STORAGE);
  savedMsg.value = '已保存，正在重新加载以生效…';
  // 通过 URL query 注入，优先级高于 localStorage（见 runtimeConfig.ts）
  setTimeout(() => {
    const base = window.location.origin + window.location.pathname;
    const q: string[] = [];
    if (v) q.push(`syncServer=${encodeURIComponent(v)}`);
    if (k) q.push(`apiKey=${encodeURIComponent(k)}`);
    window.location.href = q.length ? `${base}?${q.join('&')}` : base;
  }, 600);
};

const onRetry = () => { void retrySync(); };

// === 数据与备份（导入 / 导出） ===
// Notion ZIP 走预览式导入向导（emit 给父组件打开），不在此处直接解析。
const jsonInput = ref<HTMLInputElement | null>(null);
const mdInput = ref<HTMLInputElement | null>(null);
const dataMsg = ref('');

const flashDataMsg = (m: string, ms = 5000) => { dataMsg.value = m; setTimeout(() => (dataMsg.value = ''), ms); };
const onExportJson = () => { exportBackup(); flashDataMsg('已导出 JSON 备份'); };
const triggerJsonImport = () => jsonInput.value?.click();
const triggerMdImport = () => mdInput.value?.click();

async function onJsonImport(e: Event) {
  const input = e.target as HTMLInputElement; const file = input.files?.[0];
  if (!file) return;
  const res = await importBackup(file); flashDataMsg(res.message, 4000); input.value = '';
}
async function onMdImport(e: Event) {
  const input = e.target as HTMLInputElement; const file = input.files?.[0];
  if (!file) return;
  const res = await importMarkdown(file); flashDataMsg(res.message, 5000); input.value = '';
}
</script>

<template>
  <div v-if="visible" class="fixed inset-0 z-[75] flex items-end md:items-center justify-center">
    <!-- 遮罩：点击关闭 -->
    <div class="absolute inset-0 bg-black/60" @click="emit('close')" @touchstart.stop="emit('close')"></div>

    <div class="relative w-full md:w-[420px] bg-[#090a0c] border border-[#1e2126] shadow-2xl flex flex-col"
         :class="isCoarsePointer
           ? 'rounded-t-xl border-b-0 max-h-[85vh] pb-[env(safe-area-inset-bottom,0px)]'
           : 'rounded-md max-h-[80vh]'">
      <!-- 抓取条（触屏） -->
      <div v-if="isCoarsePointer" class="flex justify-center pt-2 pb-1 shrink-0">
        <div class="w-10 h-1 rounded-full bg-[#6b7280]/60"></div>
      </div>

      <div class="flex items-center justify-between px-4 py-3 border-b border-[#1e2126] shrink-0">
        <span class="font-['JetBrains_Mono',monospace] text-sm text-[#e5e7eb] tracking-wider">设置</span>
        <button class="w-11 h-11 md:w-8 md:h-8 flex items-center justify-center rounded-sm text-[#6b7280] hover:text-[#e5e7eb] hover:bg-[#1e2126] transition-colors"
                @click="emit('close')" title="关闭">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>

      <div class="flex-1 overflow-y-auto custom-scrollbar px-4 py-3 space-y-5 text-sm">
        <!-- 存储状态：数据到底存没存住，用户自己能看见 -->
        <section>
          <div class="text-[11px] font-['Rajdhani',sans-serif] text-[#6b7280] uppercase tracking-wider mb-2">本地存储</div>
          <div class="space-y-1.5 text-[#9ca3af]">
            <div class="flex items-center justify-between gap-3">
              <span>数据库（IndexedDB）</span>
              <span class="font-['JetBrains_Mono',monospace]"
                    :class="idbOk === true ? 'text-[#00f0ff]' : (idbOk === false ? 'text-[#ff2a2a]' : 'text-[#6b7280]')">
                {{ idbOk === true ? '正常' : (idbOk === false ? '不可用' : '检测中…') }}
              </span>
            </div>
            <div v-if="storageInfo" class="flex items-center justify-between gap-3">
              <span>已用 / 配额</span>
              <span class="font-['JetBrains_Mono',monospace] text-[#9ca3af]">
                {{ formatBytes(storageInfo.usage) }} / {{ formatBytes(storageInfo.quota) }}
              </span>
            </div>
            <div v-if="storageInfo" class="flex items-center justify-between gap-3">
              <span>持久化豁免</span>
              <span class="font-['JetBrains_Mono',monospace]"
                    :class="storageInfo.persisted ? 'text-[#00f0ff]' : 'text-[#ffb000]'">
                {{ storageInfo.persisted ? '已授予' : '未授予' }}
              </span>
            </div>
          </div>
          <p v-if="idbOk === false" class="mt-2 text-xs text-[#ffb0b0] leading-snug">
            数据当前降级在 localStorage，系统存储紧张时可能被整体清理。建议及时导出备份。
          </p>
        </section>

        <!-- 同步服务器 -->
        <section>
          <div class="text-[11px] font-['Rajdhani',sans-serif] text-[#6b7280] uppercase tracking-wider mb-2">同步</div>
          <div class="flex items-center justify-between gap-3 mb-2">
            <span class="text-[#9ca3af]">状态</span>
            <span class="font-['JetBrains_Mono',monospace] text-xs text-[#9ca3af]">{{ syncLabel }}</span>
          </div>
          <label class="block text-xs text-[#6b7280] mb-1">后端地址（留空则纯本地）</label>
          <input v-model="serverInput" type="text" inputmode="url" placeholder="http://192.168.1.10:8010"
                 class="w-full bg-[#14161a] border border-[#1e2126] focus:border-[#00f0ff] outline-none px-2 py-2 text-sm text-[#e5e7eb] rounded-sm transition-colors placeholder:text-[#6b7280]/60" />
          <label class="block text-xs text-[#6b7280] mb-1 mt-3">访问密钥（后端启用鉴权时填写）</label>
          <input v-model="apiKeyInput" type="password" placeholder="与后端 NEXUS_API_KEY 一致"
                 class="w-full bg-[#14161a] border border-[#1e2126] focus:border-[#00f0ff] outline-none px-2 py-2 text-sm text-[#e5e7eb] rounded-sm transition-colors placeholder:text-[#6b7280]/60" />
          <div class="flex items-center gap-2 mt-2">
            <button @click="saveServer"
                    class="h-11 md:h-9 px-4 flex items-center justify-center rounded-sm bg-[#14161a] border border-[#1e2126] text-[#00f0ff] hover:border-[#00f0ff] active:bg-[#1e2126] transition-colors text-xs font-['JetBrains_Mono',monospace]">
              保存并重连
            </button>
            <button @click="onRetry"
                    class="h-11 md:h-9 px-4 flex items-center justify-center rounded-sm bg-[#14161a] border border-[#1e2126] text-[#6b7280] hover:text-[#e5e7eb] active:bg-[#1e2126] transition-colors text-xs font-['JetBrains_Mono',monospace]">
              立即重试
            </button>
          </div>
          <p v-if="savedMsg" class="mt-2 text-xs text-[#00f0ff]">{{ savedMsg }}</p>
        </section>

        <!-- 数据与备份：导入 / 导出。工作区级操作，对齐 Notion「在设置里做 Import/Export」 -->
        <section>
          <div class="text-[11px] font-['Rajdhani',sans-serif] text-[#6b7280] uppercase tracking-wider mb-2">数据与备份</div>
          <div class="flex flex-wrap gap-2">
            <button @click="onExportJson"
                    class="h-11 md:h-9 px-3 flex items-center justify-center rounded-sm bg-[#14161a] border border-[#1e2126] text-[#9ca3af] hover:text-[#00f0ff] hover:border-[#00f0ff] active:bg-[#1e2126] transition-colors text-xs font-['JetBrains_Mono',monospace]">
              导出 JSON 备份
            </button>
            <button @click="emit('export-md')"
                    class="h-11 md:h-9 px-3 flex items-center justify-center rounded-sm bg-[#14161a] border border-[#1e2126] text-[#9ca3af] hover:text-[#00f0ff] hover:border-[#00f0ff] active:bg-[#1e2126] transition-colors text-xs font-['JetBrains_Mono',monospace]">
              导出当前页 MD
            </button>
          </div>
          <div class="flex flex-wrap gap-2 mt-2">
            <button @click="triggerJsonImport"
                    class="h-11 md:h-9 px-3 flex items-center justify-center rounded-sm bg-[#14161a] border border-[#1e2126] text-[#9ca3af] hover:text-[#00f0ff] hover:border-[#00f0ff] active:bg-[#1e2126] transition-colors text-xs font-['JetBrains_Mono',monospace]">
              导入 JSON
            </button>
            <button @click="triggerMdImport"
                    class="h-11 md:h-9 px-3 flex items-center justify-center rounded-sm bg-[#14161a] border border-[#1e2126] text-[#9ca3af] hover:text-[#00f0ff] hover:border-[#00f0ff] active:bg-[#1e2126] transition-colors text-xs font-['JetBrains_Mono',monospace]">
              导入 Markdown
            </button>
            <button @click="emit('open-notion-import')"
                    class="h-11 md:h-9 px-3 flex items-center justify-center rounded-sm bg-[#14161a] border border-[#1e2126] text-[#9ca3af] hover:text-[#ffb000] hover:border-[#ffb000] active:bg-[#1e2126] transition-colors text-xs font-['JetBrains_Mono',monospace]">
              导入 Notion ZIP
            </button>
          </div>
          <p class="text-xs text-[#6b7280] mt-2 leading-snug">Notion ZIP 会打开导入向导，先预览将创建的页面再确认；导入不会改动已同步的后端数据，直到下次同步。</p>
          <p v-if="dataMsg" class="mt-2 text-xs text-[#00f0ff] font-['JetBrains_Mono',monospace]">{{ dataMsg }}</p>
          <input ref="jsonInput" type="file" accept="application/json,.json" class="hidden" @change="onJsonImport" />
          <input ref="mdInput" type="file" accept=".md,.markdown,text/markdown" class="hidden" @change="onMdImport" />
        </section>

        <p v-if="storageError" class="text-xs text-[#ffb0b0] leading-snug">{{ storageError }}</p>
      </div>
    </div>
  </div>
</template>
