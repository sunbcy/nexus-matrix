<script setup lang="ts">
// 页眉封面选择器（对齐 Notion 的 Cover）
//
// 关键实现点：上传时必须先降采样再存。
// localStorage 仅约 5MB，且 Base64 会膨胀 33%；封面通常是 1500x500 的大图，
// 不压缩的话两三张就会撑爆配额（而同一个存储键里还存着图片块的 Base64）。
// 因此这里限制到 1600x600 以内、JPEG q0.82，实测可把体积压到 100KB 量级。
import {computed, nextTick, onMounted, onUnmounted, ref, watch} from 'vue';
import {getProvider, isPlatformGalleryEnabled, PLATFORM_PROVIDER, PROVIDERS, saveGalleryPhoto} from '../composables/providerRegistry';
import {saveImageAsset} from '../composables/assets';
import {getProviderKey, setProviderKey} from '../composables/providerKeys';
import type {CoverMeta, CoverPhoto, ImageProvider} from '../composables/imageProviders';

const props = defineProps<{
  current?: string;
  anchorEl?: HTMLElement | null;
  /** 本账号所有文档已使用过的图库图片 id，用于「从没用过」的默认推荐 */
  usedPhotoIds?: string[];
}>();

const emit = defineEmits<{
  (e: 'select', cover: string, meta?: CoverMeta): void;
  (e: 'remove'): void;
  (e: 'close'): void;
}>();

// 渐变预设：零存储成本，用户没有合适图片时可直接用。
// 注意：<script setup> 内不能有 export，故这里只声明，由底部普通 <script> 块统一导出。
const COVER_GRADIENTS = [
  { id: 'cyan', css: 'linear-gradient(135deg, #00f0ff 0%, #0066ff 100%)' },
  { id: 'amber', css: 'linear-gradient(135deg, #ffb000 0%, #ff2a2a 100%)' },
  { id: 'violet', css: 'linear-gradient(135deg, #a78bfa 0%, #00f0ff 100%)' },
  { id: 'lime', css: 'linear-gradient(135deg, #3ddc84 0%, #00f0ff 100%)' },
  { id: 'graphite', css: 'linear-gradient(135deg, #1e2126 0%, #090a0c 100%)' },
] as const;

// 图片压缩已移至 composables/assets.ts 的 compressImage，
// 图片块与封面共用同一套降采样参数（1600×1200 / JPEG q0.82）。

const fileRef = ref<HTMLInputElement | null>(null);
const urlInput = ref('');
const busy = ref(false);

const onFile = async (e: Event) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  busy.value = true;
  try {
    // 封面存为独立资产，页面 JSON 里只留 asset: 引用（理由同图片块：
    // Base64 会撑爆整页广播 payload、撤销快照与存储配额）
    const ref = await saveImageAsset(f);
    emit('select', ref);
  } finally {
    busy.value = false;
    (e.target as HTMLInputElement).value = '';
  }
};

const submitUrl = () => {
  const raw = urlInput.value.trim();
  if (!raw) return;
  // 无协议时补 https://，避免生成相对地址
  const href = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || raw.startsWith('/') || raw.startsWith('data:') ? raw : `https://${raw}`;
  emit('select', href);
};

// === 图库 ===
// 平台已配置密钥 → 走后端代理（默认，用户零配置）；否则回退到自填 Key 的直连模式。
const platformEnabled = ref(false);
const activeProviderId = ref(PROVIDERS[0]?.id ?? 'unsplash');
const activeProvider = ref<ImageProvider | undefined>(PROVIDERS[0]);
const apiKey = ref('');
const galleryQuery = ref('');
const galleryPhotos = ref<CoverPhoto[]>([]);
const galleryPage = ref(1);
const galleryLoading = ref(false);
const galleryError = ref('');
const galleryDone = ref(false); // 是否已翻到底（避免无谓请求）

// 打开面板自动加载到的第一张「本账号从没用过」的封面，做成一键推荐。
const featuredPhoto = computed<CoverPhoto | null>(() => galleryPhotos.value[0] ?? null);
// 推荐图已单独展示，网格里不再重复它
const morePhotos = computed<CoverPhoto[]>(() =>
  platformEnabled.value ? galleryPhotos.value.slice(1) : galleryPhotos.value,
);

const loadGallery = async (reset = false, shuffle = false) => {
  if (!activeProvider.value) return;
  if (reset) { galleryPage.value = 1; galleryDone.value = false; galleryPhotos.value = []; }
  if (galleryDone.value || galleryLoading.value) return;

  const key = apiKey.value.trim();
  if (!platformEnabled.value && !key) {
    galleryError.value = `需要 ${activeProvider.value.name} API Key`;
    return;
  }
  galleryLoading.value = true;
  galleryError.value = '';
  try {
    const photos = await activeProvider.value.search(
      galleryQuery.value, galleryPage.value, key, props.usedPhotoIds ?? [], shuffle,
    );
    // 双保险：即便 Provider 漏过滤，也不把已用过的封面摆到用户面前
    const used = new Set(props.usedPhotoIds ?? []);
    const fresh = photos.filter((p) => !used.has(p.id));
    if (fresh.length === 0) {
      galleryDone.value = true;
      if (galleryPage.value === 1) {
        galleryError.value = platformEnabled.value
          ? '暂时没有更多未使用过的封面，点「换一批」试试'
          : '未找到相关图片';
      }
    } else {
      galleryPhotos.value = reset ? fresh : [...galleryPhotos.value, ...fresh];
      galleryPage.value += 1;
    }
  } catch (e: any) {
    galleryError.value = e?.message ?? '加载失败';
    galleryDone.value = true;
  } finally {
    galleryLoading.value = false;
    void nextTick(updatePos);
  }
};

const onProviderChange = async () => {
  activeProvider.value = getProvider(activeProviderId.value);
  apiKey.value = await getProviderKey(activeProviderId.value);
  await loadGallery(true);
};

const saveKey = async () => {
  await setProviderKey(activeProviderId.value, apiKey.value);
  await loadGallery(true);
};

// 从图库选图：下载 → 压缩 → 交给父组件存为封面
const pickFromGallery = async (photo: CoverPhoto) => {
  galleryLoading.value = true;
  galleryError.value = '';
  try {
    // 与「一键随机封面」共用下载 / 落盘逻辑
    const coverRef = await saveGalleryPhoto(photo);
    // 合规要求：选用时通知图库（平台模式由后端代发 download 计数）
    activeProvider.value?.onSelected?.(photo, apiKey.value.trim());
    emit('select', coverRef, {
      photoId: photo.id,
      author: photo.author,
      authorUrl: photo.authorUrl,
      // 平台代理的 Provider 名是「精选图库」，署名必须写真实图库名才合规
      source: platformEnabled.value ? 'Unsplash' : (activeProvider.value?.name ?? ''),
      sourceUrl: photo.sourceUrl,
    });
  } catch (e: any) {
    galleryError.value = e?.message ?? '图片处理失败';
  } finally {
    galleryLoading.value = false;
  }
};

const galleryScroll = (e: Event) => {
  const el = e.target as HTMLElement;
  // 距底部 60px 内时预加载下一页
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 60) void loadGallery();
};

// 弹窗定位：贴在锚点下方，不超出视口。
// 推荐卡片是异步加载出来的，弹窗高度会变化，因此按实际高度重算而不是写死 300。
const popupRef = ref<HTMLElement | null>(null);
const pos = ref({ top: 0, left: 0 });
const updatePos = () => {
  const el = props.anchorEl;
  const W = 300;
  const H = popupRef.value?.offsetHeight || 340;
  // 锚点已被卸载（例如一键添加失败后异步回退打开）时居中显示，避免弹窗停在左上角
  if (!el || !el.isConnected) {
    pos.value = {
      top: Math.max(8, Math.round((window.innerHeight - H) / 2)),
      left: Math.max(8, Math.round((window.innerWidth - W) / 2)),
    };
    return;
  }
  const r = el.getBoundingClientRect();
  pos.value = {
    top: Math.max(8, Math.min(r.bottom + 6, window.innerHeight - H - 8)),
    left: Math.max(8, Math.min(r.left - 60, window.innerWidth - W - 8)),
  };
};

const onDocClick = (e: MouseEvent) => {
  const t = e.target as HTMLElement;
  if (t.closest('.cover-picker-popup')) return;
  if (props.anchorEl && props.anchorEl.contains(t)) return;
  emit('close');
};
const onScrollOrResize = () => updatePos();

watch(() => props.anchorEl, () => nextTick(updatePos));
onMounted(() => {
  updatePos();
  setTimeout(() => document.addEventListener('click', onDocClick), 0);
  window.addEventListener('resize', onScrollOrResize);
  window.addEventListener('scroll', onScrollOrResize, true);
  // 打开即就绪：平台配好密钥时自动拉一批「没用过」的封面，用户只需点一下推荐图；
  // 平台未配置时才回退到自填 Key 的旧流程。
  void (async () => {
    platformEnabled.value = await isPlatformGalleryEnabled();
    if (platformEnabled.value) {
      activeProvider.value = PLATFORM_PROVIDER;
      activeProviderId.value = PLATFORM_PROVIDER.id;
      await loadGallery(true);
    } else {
      apiKey.value = await getProviderKey(activeProviderId.value);
      if (apiKey.value) await loadGallery(true);
    }
  })();
});
onUnmounted(() => {
  document.removeEventListener('click', onDocClick);
  window.removeEventListener('resize', onScrollOrResize);
  window.removeEventListener('scroll', onScrollOrResize, true);
});
</script>

<template>
  <div ref="popupRef" class="cover-picker-popup fixed z-[70] w-[300px] max-h-[70vh] bg-void border border-line shadow-2xl rounded-md overflow-hidden flex flex-col"
       :style="{ top: `${pos.top}px`, left: `${pos.left}px` }">
    <div class="px-3 py-2 border-b border-line/60 text-xs font-bold text-display tracking-wide shrink-0">设置页眉封面</div>

    <div class="p-3 space-y-3 overflow-y-auto custom-scrollbar">
      <!-- 图库（Unsplash） -->
      <div v-if="activeProvider">
        <div class="flex items-center justify-between mb-1.5">
          <div class="text-[10px] text-dim uppercase tracking-wider">{{ platformEnabled ? '为你推荐' : '图库' }}</div>
          <button v-if="platformEnabled" @click="loadGallery(true, true)" :disabled="galleryLoading"
                  class="text-[10px] text-dim hover:text-accent transition-colors disabled:opacity-50">
            换一批
          </button>
          <a v-else :href="activeProvider.keyHelpUrl" target="_blank" rel="noopener"
             class="text-[10px] text-dim hover:text-accent transition-colors">
            申请 Key ↗
          </a>
          <!-- 多图库时显示切换按钮（仅自填 Key 模式，目前只有 Unsplash 故隐藏） -->
          <template v-if="!platformEnabled && PROVIDERS.length > 1">
            <button v-for="p in PROVIDERS" :key="p.id"
                    @click="activeProviderId = p.id; onProviderChange()"
                    class="px-1.5 py-0.5 text-[10px] rounded-sm transition-colors"
                    :class="p.id === activeProviderId ? 'bg-panel text-accent' : 'text-dim hover:text-display'">
              {{ p.name }}
            </button>
          </template>
        </div>

        <!-- 仅平台未配置密钥时，才回退到用户自填 Key -->
        <template v-if="!platformEnabled">
          <div class="mb-2 text-[10px] text-dim leading-relaxed">
            平台运营可在后台 .env 配置 <span class="text-accent">UNSPLASH_ACCESS_KEY</span>，配置后所有用户免填 Key、打开即用。
          </div>
          <div class="flex gap-1.5 mb-2">
            <input v-model="apiKey" type="password" :placeholder="`${activeProvider.name} API Key`"
                   @keydown.enter.prevent="saveKey"
                   @blur="saveKey"
                   class="flex-1 bg-surface border border-line focus:border-accent outline-none px-2 py-1.5 text-xs text-display rounded-sm transition-colors" />
            <button @click="saveKey" class="px-2.5 py-1.5 text-xs font-bold text-onaccent bg-accent hover:bg-accent2 rounded-sm transition-colors">保存</button>
          </div>
          <a :href="activeProvider.keyHelpUrl" target="_blank" rel="noopener"
             class="block text-[10px] text-dim hover:text-accent transition-colors mb-2">
            没有 Key？去 {{ activeProvider.name }} 申请 ↗
          </a>
        </template>

        <!-- 默认推荐：打开面板就已加载好的第一张「本账号从没用过」的封面，一键即用 -->
        <div v-else-if="featuredPhoto" class="mb-2 rounded-sm border border-line overflow-hidden">
          <div class="h-[86px] bg-surface bg-cover bg-center"
               :style="{ backgroundImage: `url('${featuredPhoto.thumbUrl}')` }"></div>
          <button @click="pickFromGallery(featuredPhoto)" :disabled="galleryLoading"
                  class="w-full flex items-center justify-between gap-2 px-2.5 py-2 text-[11px] hover:bg-panel transition-colors disabled:opacity-50">
            <span class="text-dim truncate">你的文档还没用过这张</span>
            <span class="shrink-0 font-bold text-accent">使用这张 →</span>
          </button>
        </div>
        <div v-else-if="galleryLoading" class="mb-2 rounded-sm border border-line px-2.5 py-4 text-center text-[11px] text-dim">
          正在为你挑一张没用过的封面…
        </div>

        <!-- 搜索框 -->
        <div class="flex gap-1.5 mb-2">
          <input v-model="galleryQuery" type="text" placeholder="搜索图片关键词…"
                 @keydown.enter.prevent="loadGallery(true)"
                 class="flex-1 bg-surface border border-line focus:border-accent outline-none px-2 py-1.5 text-xs text-display rounded-sm transition-colors" />
          <button @click="loadGallery(true)" :disabled="galleryLoading"
                  class="px-2.5 py-1.5 text-xs font-bold text-display bg-panel hover:bg-panel2 rounded-sm transition-colors disabled:opacity-50">
            搜索
          </button>
        </div>

        <!-- 错误 / 空态提示 -->
        <div v-if="galleryError && galleryPhotos.length === 0"
             class="text-[11px] text-danger px-1 py-2 leading-relaxed">
          {{ galleryError }}
        </div>

        <!-- 图片网格：3 列，滚动到底自动加载下一页 -->
        <div v-if="morePhotos.length > 0" class="grid grid-cols-3 gap-1.5 max-h-[200px] overflow-y-auto custom-scrollbar" @scroll="galleryScroll">
          <button v-for="p in morePhotos" :key="p.id"
                  @click="pickFromGallery(p)"
                  :disabled="galleryLoading"
                  class="relative h-[52px] rounded-sm border border-line hover:border-accent transition-colors overflow-hidden disabled:opacity-50"
                  :style="{ backgroundImage: `url('${p.thumbUrl}')`, backgroundSize: 'cover', backgroundPosition: 'center' }"
                  :title="`${p.author} · ${activeProvider.name}`">
          </button>
        </div>

        <!-- 加载中 / 已到底 -->
        <div v-if="galleryLoading" class="text-[11px] text-dim text-center py-2">加载中…</div>
        <div v-else-if="galleryDone && galleryPhotos.length > 0" class="text-[11px] text-dim text-center py-1.5">
          {{ platformEnabled ? '· 点「换一批」看更多 ·' : '— 已到底部 —' }}
        </div>

        <!-- 署名要求提示（Unsplash 的硬性合规要求） -->
        <div v-if="galleryPhotos.length > 0" class="text-[10px] text-dim/70 leading-relaxed pt-1">
          选用后会在封面浮层显示摄影师署名
        </div>
      </div>

      <!-- 渐变色（零存储成本） -->
      <div>
        <div class="text-[10px] text-dim uppercase tracking-wider mb-1.5">渐变色</div>
        <div class="flex gap-1.5">
          <button v-for="g in COVER_GRADIENTS" :key="g.id"
                  @click="emit('select', `gradient:${g.id}`)"
                  class="w-9 h-9 rounded-sm border border-line hover:border-accent transition-colors"
                  :style="{ background: g.css }"
                  :title="g.id"></button>
        </div>
      </div>

      <!-- 上传本地图片 -->
      <div>
        <div class="text-[10px] text-dim uppercase tracking-wider mb-1.5">上传图片</div>
        <button @click="fileRef?.click()" :disabled="busy"
                class="w-full flex items-center justify-center gap-2 px-3 py-2 border border-dashed border-line hover:border-accent text-dim hover:text-accent rounded-sm transition-colors text-xs">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
          {{ busy ? '处理中…' : '选择图片（自动压缩）' }}
        </button>
        <input ref="fileRef" type="file" accept="image/*" class="hidden" @change="onFile" />
      </div>

      <!-- 外部链接 -->
      <div>
        <div class="text-[10px] text-dim uppercase tracking-wider mb-1.5">图片链接</div>
        <div class="flex gap-1.5">
          <input v-model="urlInput" type="text" placeholder="https://..."
                 @keydown.enter.prevent="submitUrl"
                 class="flex-1 bg-surface border border-line focus:border-accent outline-none px-2 py-1.5 text-xs text-display rounded-sm transition-colors" />
          <button @click="submitUrl" class="px-2.5 py-1.5 text-xs font-bold text-onaccent bg-accent hover:bg-accent2 rounded-sm transition-colors">用</button>
        </div>
      </div>
    </div>

    <div class="px-3 py-2 border-t border-line/60 shrink-0">
      <button @click="emit('remove')"
              class="w-full flex items-center justify-center gap-1.5 px-2 py-1 text-xs text-dim hover:text-danger hover:bg-panel rounded-sm transition-colors">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        移除封面
      </button>
    </div>
  </div>
</template>

<!-- 渐变预设需被父组件复用（封面渲染），故用普通 script 块导出；
     <script setup> 内不允许 export -->
<script lang="ts">
export const COVER_GRADIENTS = [
  { id: 'cyan', css: 'linear-gradient(135deg, #00f0ff 0%, #0066ff 100%)' },
  { id: 'amber', css: 'linear-gradient(135deg, #ffb000 0%, #ff2a2a 100%)' },
  { id: 'violet', css: 'linear-gradient(135deg, #a78bfa 0%, #00f0ff 100%)' },
  { id: 'lime', css: 'linear-gradient(135deg, #3ddc84 0%, #00f0ff 100%)' },
  { id: 'graphite', css: 'linear-gradient(135deg, #1e2126 0%, #090a0c 100%)' },
] as const;
</script>
