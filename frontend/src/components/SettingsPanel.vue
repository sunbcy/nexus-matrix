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
  accountInfo,
  exportBackup,
  importBackup,
  importMarkdown,
  lastAuthError,
  lastSyncError,
  onlineDevices,
  probeServer,
  retrySync,
  storageError,
  syncStatus
} from '../composables/useSync';
import {getRuntimeConfig, SYNC_API_KEY_STORAGE_KEY, SYNC_SERVER_STORAGE_KEY} from '../runtimeConfig';
import {applyTheme, currentThemeId, type ThemeId, THEMES} from '../composables/theme';
import {useAuth} from '../composables/auth';

const props = defineProps<{ visible: boolean; dirtyTitleCount?: number; deadLinkCount?: number; duplicateBlockCount?: number; duplicateDocCount?: number; divergentDocCount?: number; wronglyKilledCount?: number }>();
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'export-md'): void;
  (e: 'export-all-zip'): void;
  (e: 'open-notion-import'): void;
  (e: 'clean-titles'): void;
  (e: 'clean-links'): void;
  (e: 'clean-dup-blocks'): void;
  (e: 'clean-dup-pages'): void;
  (e: 'restore-killed-blocks'): void;
}>();

const { isCoarsePointer } = useMobileInput();

// 账户 / 多工作区（P2）：token 复用 nexus_sync_api_key，登录即换成账户 JWT
const {
  isAccount, isLegacyKey, user, workspaces, activeRoom, loading, error,
  init: initAuth, loginWithGoogle, switchWorkspace, logout,
} = useAuth();

// 外观：主题即刻生效（只改 html[data-theme]），无需重连或刷新
const themes = THEMES;
const pickTheme = (id: ThemeId) => applyTheme(id);

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
  void initAuth();
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
  if (lastAuthError.value) return '密钥被拒绝';
  if (syncStatus.value === 'online') return `已连接 · 在线设备 ${onlineDevices.value}`;
  if (syncStatus.value === 'connecting') return '正在连接…';
  return '未连接（纯本地模式）';
});

// 账户/房间明细：让「访问密钥 = 房间」对用户可见，并提示空房间
const syncDetail = computed(() => {
  if (lastAuthError.value) return lastAuthError.value;
  if (lastSyncError.value) return lastSyncError.value;
  if (syncStatus.value === 'online' && accountInfo.value) {
    const a = accountInfo.value;
    const dataTip = a.page_count === 0 ? '本房间暂无数据' : `${a.page_count} 页`;
    return `房间 ${a.room_label} · ${dataTip}`;
  }
  return '';
});

// 跨域提醒：后端地址与当前页面不同源时（常见于经公网域名访问却填了 localhost/内网 IP），
// 在手机/其它设备上「localhost」会指向那台设备自身而连不上，且易触发 CORS。经域名访问应留空走同源。
const crossOriginWarn = computed(() => {
  const v = (serverInput.value || '').trim();
  if (!v) return '';
  try {
    const u = new URL(v);
    if (u.origin === window.location.origin) return '';
    return `当前页面来自 ${window.location.origin}，你填的后端是 ${u.origin}（跨域）。经域名访问建议留空，自动走同源；否则在手机/其它设备上「localhost」会指向那台设备自身而连不上。`;
  } catch {
    return '';
  }
});

const probeMsg = ref('');
const probeState = ref<'idle' | 'unreachable' | 'unauthorized' | 'empty' | 'ok'>('idle');

const saveServer = async () => {
  const v = serverInput.value.trim().replace(/\/+$/, '');
  const k = apiKeyInput.value.trim();
  // 保存前先校验，给用户明确反馈：连不通 / 密钥被拒 / 房间为空 / 正常
  savedMsg.value = '正在校验连接…';
  const r = await probeServer(v, k);
  probeState.value = r.state;
  probeMsg.value = r.message;
  if (r.state === 'unreachable' || r.state === 'unauthorized') {
    savedMsg.value = '';
    return;  // 配置无效，不写入，避免把坏配置固化
  }
  // 校验通过（含「房间为空」——可能是用户想用的全新房间）：保存并重载生效
  if (v) localStorage.setItem(SYNC_KEY, v);
  else localStorage.removeItem(SYNC_KEY);
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
// 早期导入把 Notion 的内部 id 留在了标题尾部，这里一键还原（数量由父组件统计后传入）
const onCleanTitles = () => {
  const n = props.dirtyTitleCount ?? 0;
  if (n === 0) return;
  emit('clean-titles');
  flashDataMsg(`已清理 ${n} 个标题尾部的 Notion ID`);
};
// 早期 Notion 导入把页内链接压成 href="#" 死链，这里按链接文字匹配页面标题还原
const onCleanLinks = () => {
  const n = props.deadLinkCount ?? 0;
  if (n === 0) return;
  emit('clean-links');
  flashDataMsg(`已修复 ${n} 个文档死链为页内链接`);
};
// 导入翻倍导致同一份内容出现多份，这里把重复块标成墓碑随同步删除
const onCleanDupBlocks = () => {
  const n = props.duplicateBlockCount ?? 0;
  if (n === 0) return;
  emit('clean-dup-blocks');
  flashDataMsg(`已清理 ${n} 个重复块（导入翻倍残留），删除将随同步广播到各端`);
};
// 反复导入同一批 ZIP 导致整页重复：内容基本一致的副本自动合并，保留封面/图标更全的一份
const onCleanDupPages = () => {
  const n = props.duplicateDocCount ?? 0;
  const d = props.divergentDocCount ?? 0;
  if (n === 0) return;
  emit('clean-dup-pages'); // 删除数在 emit 前已捕获，避免删除后计数归零
  flashDataMsg(
    `已合并 ${n} 份重复文档（保留封面/图标更全的一份）` +
      (d > 0 ? `；另有 ${d} 组标题相同但内容不同，未自动删除，请人工核对/改名。` : '。'),
  );
};
// 恢复被旧版「清理重复块」误杀的独有块（不含代码正文的旧指纹把不同代码块当成了重复）
const onRestoreKilledBlocks = () => {
  const n = props.wronglyKilledCount ?? 0;
  if (n === 0) return;
  emit('restore-killed-blocks'); // 数量在 emit 前已捕获
  flashDataMsg(`已恢复 ${n} 个被误删的独有块（代码/图片等），删除标记已随同步广播到各端`);
};
</script>

<template>
  <div v-if="visible" class="fixed inset-0 z-[75] flex items-end md:items-center justify-center">
    <!-- 遮罩：点击关闭 -->
    <div class="absolute inset-0 bg-black/60" @click="emit('close')" @touchstart.stop="emit('close')"></div>

    <div class="relative w-full md:w-[420px] bg-void border border-line shadow-2xl flex flex-col"
         :class="isCoarsePointer
           ? 'rounded-t-xl border-b-0 max-h-[85vh] pb-[env(safe-area-inset-bottom,0px)]'
           : 'rounded-md max-h-[80vh]'">
      <!-- 抓取条（触屏） -->
      <div v-if="isCoarsePointer" class="flex justify-center pt-2 pb-1 shrink-0">
        <div class="w-10 h-1 rounded-full bg-dim/60"></div>
      </div>

      <div class="flex items-center justify-between px-4 py-3 border-b border-line shrink-0">
        <span class="font-['JetBrains_Mono',monospace] text-sm text-display tracking-wider">设置</span>
        <button class="w-11 h-11 md:w-8 md:h-8 flex items-center justify-center rounded-sm text-dim hover:text-display hover:bg-panel transition-colors"
                @click="emit('close')" title="关闭">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>

      <div class="flex-1 overflow-y-auto custom-scrollbar px-4 py-3 space-y-5 text-sm">

        <!-- 账号 · 工作区（P2）：OAuth 登录、工作区切换、退出 -->
        <section>
          <div class="text-[11px] font-['Rajdhani',sans-serif] text-dim uppercase tracking-wider mb-2">账号 · 工作区</div>

          <!-- 已登录账户 -->
          <div v-if="isAccount" class="space-y-3">
            <div class="flex items-center gap-2">
              <div class="w-9 h-9 rounded-full bg-accent/15 text-accent flex items-center justify-center text-sm font-bold shrink-0">
                {{ (user?.name || user?.email || '?').slice(0, 1).toUpperCase() }}
              </div>
              <div class="min-w-0">
                <div class="text-sm text-display truncate">{{ user?.name || user?.email }}</div>
                <div class="text-[11px] text-dim truncate">{{ user?.email }} · {{ user?.provider }}</div>
              </div>
            </div>

            <div>
              <label class="block text-xs text-dim mb-1">当前工作区</label>
              <select :value="activeRoom || ''"
                      :disabled="loading"
                      @change="switchWorkspace(($event.target as HTMLSelectElement).value)"
                      class="w-full bg-surface border border-line focus:border-accent outline-none px-2 py-2 text-sm text-display rounded-sm transition-colors">
                <option v-for="ws in workspaces" :key="ws.room" :value="ws.room">
                  {{ ws.label || ws.room.slice(0, 8) }} · {{ ws.role }}
                </option>
              </select>
            </div>

            <button @click="logout()"
                    class="h-9 px-4 rounded-sm bg-surface border border-line text-dim hover:text-danger hover:border-danger transition-colors text-xs font-['JetBrains_Mono',monospace]">
              退出登录
            </button>
            <p v-if="error" class="text-xs text-danger">{{ error }}</p>
          </div>

          <!-- 未登录：可登录，或沿用访问密钥 -->
          <div v-else class="space-y-3">
            <button @click="loginWithGoogle()"
                    class="w-full h-11 flex items-center justify-center gap-2 rounded-sm bg-surface border border-line text-display hover:border-accent active:bg-panel transition-colors text-sm font-['JetBrains_Mono',monospace]">
              <svg width="16" height="16" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.65l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.05l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/></svg>
              用 Google 登录
            </button>
            <p v-if="isLegacyKey" class="text-xs text-warn leading-snug">
              当前以「访问密钥」直接访问某工作区。登录 Google 账号会切换到一个新的账号空间；原密钥数据仍保留在后端，可在下方「同步」重新填回密钥访问。
            </p>
            <p v-else class="text-xs text-dim leading-snug">
              登录后可在多设备间同步，并邀请他人协作，无需记忆密钥。
            </p>
            <p v-if="error" class="text-xs text-danger">{{ error }}</p>
          </div>
        </section>

        <!-- 外观：主题。放在最上面——这是最常被改、且反馈最即时的设置。
             每张卡片给出「什么时候用 / 对注意力与眼睛的影响」，而不是只给颜色名。 -->
        <section>
          <div class="text-[11px] font-['Rajdhani',sans-serif] text-dim uppercase tracking-wider mb-2">外观 · 主题</div>
          <div class="grid grid-cols-2 gap-2">
            <button v-for="t in themes" :key="t.id" @click="pickTheme(t.id)"
                    class="text-left p-2 rounded-sm border transition-colors bg-surface active:opacity-80"
                    :class="currentThemeId === t.id ? 'border-accent' : 'border-line hover:border-dim'">
              <div class="flex items-center gap-1 mb-1.5">
                <span v-for="(c, i) in t.swatch" :key="i"
                      class="w-3.5 h-3.5 rounded-[2px] border border-black/20"
                      :style="{ background: c }"></span>
                <span class="ml-auto text-[10px] font-['JetBrains_Mono',monospace]"
                      :class="currentThemeId === t.id ? 'text-accent' : 'text-dim'">
                  {{ t.mode === 'auto' ? '自动' : (t.mode === 'light' ? '浅色' : '深色') }}{{ currentThemeId === t.id ? ' · 使用中' : '' }}
                </span>
              </div>
              <div class="text-xs text-display">{{ t.name }}</div>
              <div class="text-[11px] text-dim leading-snug mt-0.5">{{ t.desc }}</div>
            </button>
          </div>
        </section>

        <!-- 存储状态：数据到底存没存住，用户自己能看见 -->
        <section>
          <div class="text-[11px] font-['Rajdhani',sans-serif] text-dim uppercase tracking-wider mb-2">本地存储</div>
          <div class="space-y-1.5 text-muted">
            <div class="flex items-center justify-between gap-3">
              <span>数据库（IndexedDB）</span>
              <span class="font-['JetBrains_Mono',monospace]"
                    :class="idbOk === true ? 'text-accent' : (idbOk === false ? 'text-danger' : 'text-dim')">
                {{ idbOk === true ? '正常' : (idbOk === false ? '不可用' : '检测中…') }}
              </span>
            </div>
            <div v-if="storageInfo" class="flex items-center justify-between gap-3">
              <span>已用 / 配额</span>
              <span class="font-['JetBrains_Mono',monospace] text-muted">
                {{ formatBytes(storageInfo.usage) }} / {{ formatBytes(storageInfo.quota) }}
              </span>
            </div>
            <div v-if="storageInfo" class="flex items-center justify-between gap-3">
              <span>持久化豁免</span>
              <span class="font-['JetBrains_Mono',monospace]"
                    :class="storageInfo.persisted ? 'text-accent' : 'text-warn'">
                {{ storageInfo.persisted ? '已授予' : '未授予' }}
              </span>
            </div>
          </div>
          <p v-if="idbOk === false" class="mt-2 text-xs text-danger leading-snug">
            数据当前降级在 localStorage，系统存储紧张时可能被整体清理。建议及时导出备份。
          </p>
        </section>

        <!-- 同步服务器 -->
        <section>
          <div class="text-[11px] font-['Rajdhani',sans-serif] text-dim uppercase tracking-wider mb-2">同步</div>
          <div class="flex items-center justify-between gap-3 mb-2">
            <span class="text-muted">状态</span>
            <span class="font-['JetBrains_Mono',monospace] text-xs" :class="lastAuthError ? 'text-danger' : 'text-muted'">{{ syncLabel }}</span>
          </div>
          <p v-if="syncDetail" class="text-xs text-dim mb-2 font-['JetBrains_Mono',monospace]">{{ syncDetail }}</p>
          <p v-if="crossOriginWarn" class="mt-1 text-xs text-warn">{{ crossOriginWarn }}</p>
          <label class="block text-xs text-dim mb-1">后端地址（通过公网域名访问时通常留空，走同源）</label>
          <input v-model="serverInput" type="text" inputmode="url" placeholder="http://192.168.1.10:8010 或留空(同源)"
                 class="w-full bg-surface border border-line focus:border-accent outline-none px-2 py-2 text-sm text-display rounded-sm transition-colors placeholder:text-dim/60" />
          <label class="block text-xs text-dim mb-1 mt-3">访问密钥（后端启用鉴权时填写）</label>
          <input v-model="apiKeyInput" type="password" placeholder="与后端 NEXUS_API_KEY 一致"
                 class="w-full bg-surface border border-line focus:border-accent outline-none px-2 py-2 text-sm text-display rounded-sm transition-colors placeholder:text-dim/60" />
          <div class="flex items-center gap-2 mt-2">
            <button @click="saveServer"
                    class="h-11 md:h-9 px-4 flex items-center justify-center rounded-sm bg-surface border border-line text-accent hover:border-accent active:bg-panel transition-colors text-xs font-['JetBrains_Mono',monospace]">
              保存并重连
            </button>
            <button @click="onRetry"
                    class="h-11 md:h-9 px-4 flex items-center justify-center rounded-sm bg-surface border border-line text-dim hover:text-display active:bg-panel transition-colors text-xs font-['JetBrains_Mono',monospace]">
              立即重试
            </button>
          </div>
          <p v-if="probeMsg" class="mt-2 text-xs font-['JetBrains_Mono',monospace]" :class="{
            'text-danger': probeState === 'unreachable' || probeState === 'unauthorized',
            'text-warn': probeState === 'empty',
            'text-success': probeState === 'ok',
          }">{{ probeMsg }}</p>
          <p v-if="savedMsg" class="mt-2 text-xs text-accent">{{ savedMsg }}</p>
        </section>

        <!-- 数据与备份：导入 / 导出。工作区级操作，对齐 Notion「在设置里做 Import/Export」 -->
        <section>
          <div class="text-[11px] font-['Rajdhani',sans-serif] text-dim uppercase tracking-wider mb-2">数据与备份</div>
          <div class="flex flex-wrap gap-2">
            <button @click="onExportJson"
                    class="h-11 md:h-9 px-3 flex items-center justify-center rounded-sm bg-surface border border-line text-muted hover:text-accent hover:border-accent active:bg-panel transition-colors text-xs font-['JetBrains_Mono',monospace]">
              导出 JSON 备份
            </button>
            <button @click="emit('export-md')"
                    class="h-11 md:h-9 px-3 flex items-center justify-center rounded-sm bg-surface border border-line text-muted hover:text-accent hover:border-accent active:bg-panel transition-colors text-xs font-['JetBrains_Mono',monospace]">
              导出当前页 MD
            </button>
            <button @click="emit('export-all-zip')"
                    class="h-11 md:h-9 px-3 flex items-center justify-center rounded-sm bg-surface border border-line text-muted hover:text-accent hover:border-accent active:bg-panel transition-colors text-xs font-['JetBrains_Mono',monospace]">
              导出全部文档 (ZIP)
            </button>
          </div>
          <div class="flex flex-wrap gap-2 mt-2">
            <button @click="triggerJsonImport"
                    class="h-11 md:h-9 px-3 flex items-center justify-center rounded-sm bg-surface border border-line text-muted hover:text-accent hover:border-accent active:bg-panel transition-colors text-xs font-['JetBrains_Mono',monospace]">
              导入 JSON
            </button>
            <button @click="triggerMdImport"
                    class="h-11 md:h-9 px-3 flex items-center justify-center rounded-sm bg-surface border border-line text-muted hover:text-accent hover:border-accent active:bg-panel transition-colors text-xs font-['JetBrains_Mono',monospace]">
              导入 Markdown
            </button>
            <button @click="emit('open-notion-import')"
                    class="h-11 md:h-9 px-3 flex items-center justify-center rounded-sm bg-surface border border-line text-muted hover:text-warn hover:border-warn active:bg-panel transition-colors text-xs font-['JetBrains_Mono',monospace]">
              导入 Notion ZIP
            </button>
          </div>
          <div class="mt-2">
            <button @click="onCleanTitles" :disabled="!dirtyTitleCount"
                    class="h-11 md:h-9 px-3 flex items-center justify-center rounded-sm bg-surface border border-line text-muted enabled:hover:text-accent enabled:hover:border-accent enabled:active:bg-panel disabled:opacity-40 transition-colors text-xs font-['JetBrains_Mono',monospace]">
              清理标题里的 Notion ID<template v-if="dirtyTitleCount">（{{ dirtyTitleCount }}）</template>
            </button>
          </div>
          <div class="mt-2">
            <button @click="onCleanLinks" :disabled="!deadLinkCount"
                    class="h-11 md:h-9 px-3 flex items-center justify-center rounded-sm bg-surface border border-line text-muted enabled:hover:text-accent enabled:hover:border-accent enabled:active:bg-panel disabled:opacity-40 transition-colors text-xs font-['JetBrains_Mono',monospace]">
              修复文档里的死链<template v-if="deadLinkCount">（{{ deadLinkCount }}）</template><template v-else>（无）</template>
            </button>
          </div>
          <div class="mt-2">
            <button @click="onRestoreKilledBlocks" :disabled="!wronglyKilledCount"
                    class="h-11 md:h-9 px-3 flex items-center justify-center rounded-sm bg-surface border border-line text-muted enabled:hover:text-accent enabled:hover:border-accent enabled:active:bg-panel disabled:opacity-40 transition-colors text-xs font-['JetBrains_Mono',monospace]">
              恢复误删块<template v-if="wronglyKilledCount">（{{ wronglyKilledCount }}）</template><template v-else>（无）</template>
            </button>
          </div>
          <div class="mt-2">
            <button @click="onCleanDupBlocks" :disabled="!duplicateBlockCount"
                    class="h-11 md:h-9 px-3 flex items-center justify-center rounded-sm bg-surface border border-line text-muted enabled:hover:text-accent enabled:hover:border-accent enabled:active:bg-panel disabled:opacity-40 transition-colors text-xs font-['JetBrains_Mono',monospace]">
              清理重复块<template v-if="duplicateBlockCount">（{{ duplicateBlockCount }}）</template><template v-else>（无）</template>
            </button>
          </div>
          <div class="mt-2">
            <button @click="onCleanDupPages" :disabled="!duplicateDocCount"
                    class="h-11 md:h-9 px-3 flex items-center justify-center rounded-sm bg-surface border border-line text-muted enabled:hover:text-accent enabled:hover:border-accent enabled:active:bg-panel disabled:opacity-40 transition-colors text-xs font-['JetBrains_Mono',monospace]">
              清理重复文档<template v-if="duplicateDocCount">（{{ duplicateDocCount }}）</template><template v-else>（无）</template>
            </button>
          </div>
          <p class="text-xs text-dim mt-2 leading-snug">Notion ZIP 会打开导入向导，先预览将创建的页面再确认；导入不会改动已同步的后端数据，直到下次同步。早期导入残留的标题尾部 ID、变成 `href="#"` 的页内死链、与反复导入导致的重复块，可分别用上面的按钮一键修复。</p>
          <p v-if="dataMsg" class="mt-2 text-xs text-accent font-['JetBrains_Mono',monospace]">{{ dataMsg }}</p>
          <input ref="jsonInput" type="file" accept="application/json,.json" class="hidden" @change="onJsonImport" />
          <input ref="mdInput" type="file" accept=".md,.markdown,text/markdown" class="hidden" @change="onMdImport" />
        </section>

        <p v-if="storageError" class="text-xs text-danger leading-snug">{{ storageError }}</p>
      </div>
    </div>
  </div>
</template>
