<script setup lang="ts">
// 页眉封面选择器（对齐 Notion 的 Cover）
//
// 关键实现点：上传时必须先降采样再存。
// localStorage 仅约 5MB，且 Base64 会膨胀 33%；封面通常是 1500x500 的大图，
// 不压缩的话两三张就会撑爆配额（而同一个存储键里还存着图片块的 Base64）。
// 因此这里限制到 1600x600 以内、JPEG q0.82，实测可把体积压到 100KB 量级。
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue';
import { PROVIDERS, getProvider } from '../composables/providerRegistry';
import { getProviderKey, setProviderKey } from '../composables/providerKeys';
import type { CoverPhoto, ImageProvider } from '../composables/imageProviders';

const props = defineProps<{
  current?: string;
  anchorEl?: HTMLElement | null;
}>();

const emit = defineEmits<{
  (e: 'select', cover: string, credit?: { author: string; authorUrl: string; source: string; sourceUrl: string }): void;
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

const MAX_W = 1600;
// 竖构图人像需要更高的上限才能保留可用的展示比例。
// 早期 600 会把竖图压成 2.67:1，与封面横幅叠加后只剩头部。
const MAX_H = 1200;
const SMALL_ENOUGH = 400_000; // 小于此长度的 DataURL 直接采用，省一次解码

// 读取文件并降采样为 JPEG DataURL
const processImage = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const src = String(reader.result ?? '');
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(MAX_W / img.width, MAX_H / img.height, 1);
        // 已经够小就不折腾，保留原图（PNG 的清晰度比 JPEG 好）
        if (scale >= 1 && src.length < SMALL_ENOUGH) { resolve(src); return; }
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(src); return; }
        // PNG 透明区转 JPEG 会变黑，必须先铺白底
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => resolve(src); // 解码失败就退回原图，至少不丢功能
      img.src = src;
    };
    reader.readAsDataURL(file);
  });

const fileRef = ref<HTMLInputElement | null>(null);
const urlInput = ref('');
const busy = ref(false);

const onFile = async (e: Event) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  busy.value = true;
  try {
    emit('select', await processImage(f));
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

// === 图库（Unsplash / Pexels）===
const activeProviderId = ref(PROVIDERS[0]?.id ?? 'unsplash');
const activeProvider = ref<ImageProvider | undefined>(PROVIDERS[0]);
const apiKey = ref('');
const galleryQuery = ref('');
const galleryPhotos = ref<CoverPhoto[]>([]);
const galleryPage = ref(1);
const galleryLoading = ref(false);
const galleryError = ref('');
const galleryDone = ref(false); // 是否已翻到底（避免无谓请求）

const loadGallery = async (reset = false) => {
  if (!activeProvider.value) return;
  if (reset) { galleryPage.value = 1; galleryDone.value = false; galleryPhotos.value = []; }
  if (galleryDone.value || galleryLoading.value) return;

  const key = apiKey.value.trim();
  if (!key) {
    galleryError.value = `需要 ${activeProvider.value.name} API Key`;
    return;
  }
  galleryLoading.value = true;
  galleryError.value = '';
  try {
    const photos = await activeProvider.value.search(galleryQuery.value, galleryPage.value, key);
    if (photos.length === 0) {
      galleryDone.value = true;
      if (galleryPage.value === 1) galleryError.value = '未找到相关图片';
    } else {
      galleryPhotos.value = reset ? photos : [...galleryPhotos.value, ...photos];
      galleryPage.value += 1;
    }
  } catch (e: any) {
    galleryError.value = e?.message ?? '加载失败';
    galleryDone.value = true;
  } finally {
    galleryLoading.value = false;
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
    const res = await fetch(photo.fullUrl);
    if (!res.ok) throw new Error(`下载失败：HTTP ${res.status}`);
    const blob = await res.blob();
    const dataUrl = await processImage(new File([blob], 'cover.jpg', { type: blob.type || 'image/jpeg' }));
    // 合规要求：选用时通知图库（Unsplash 的 download 计数端点）
    activeProvider.value?.onSelected?.(photo, apiKey.value.trim());
    emit('select', dataUrl, {
      author: photo.author,
      authorUrl: photo.authorUrl,
      source: activeProvider.value?.name ?? '',
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

// 弹窗定位：贴在锚点下方，不超出视口
const pos = ref({ top: 0, left: 0 });
const updatePos = () => {
  const el = props.anchorEl;
  if (!el) return;
  const r = el.getBoundingClientRect();
  const W = 300;
  pos.value = {
    top: Math.min(r.bottom + 6, window.innerHeight - 300),
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
  // 预填已保存的 Key 并加载首批图库
  void getProviderKey(activeProviderId.value).then((k) => {
    apiKey.value = k;
    void loadGallery(true);
  });
});
onUnmounted(() => {
  document.removeEventListener('click', onDocClick);
  window.removeEventListener('resize', onScrollOrResize);
  window.removeEventListener('scroll', onScrollOrResize, true);
});
</script>

<template>
  <div class="cover-picker-popup fixed z-[70] w-[300px] bg-[#090a0c] border border-[#1e2126] shadow-2xl rounded-md overflow-hidden flex flex-col"
       :style="{ top: `${pos.top}px`, left: `${pos.left}px` }">
    <div class="px-3 py-2 border-b border-[#1e2126]/60 text-xs font-bold text-[#e5e7eb] tracking-wide shrink-0">设置页眉封面</div>

    <div class="p-3 space-y-3 overflow-y-auto custom-scrollbar">
      <!-- 图库（Unsplash） -->
      <div v-if="activeProvider">
        <div class="flex items-center justify-between mb-1.5">
          <div class="text-[10px] text-[#6b7280] uppercase tracking-wider">图库</div>
          <!-- 多图库时显示切换按钮；目前仅 Unsplash，故隐藏 -->
          <template v-if="PROVIDERS.length > 1">
            <button v-for="p in PROVIDERS" :key="p.id"
                    @click="activeProviderId = p.id; onProviderChange()"
                    class="px-1.5 py-0.5 text-[10px] rounded-sm transition-colors"
                    :class="p.id === activeProviderId ? 'bg-[#1e2126] text-[#00f0ff]' : 'text-[#6b7280] hover:text-[#e5e7eb]'">
              {{ p.name }}
            </button>
          </template>
          <a :href="activeProvider.keyHelpUrl" target="_blank" rel="noopener"
             class="text-[10px] text-[#6b7280] hover:text-[#00f0ff] transition-colors">
            申请 Key ↗
          </a>
        </div>

        <!-- API Key 输入：用户自填，存 localStorage 独立键（不参与页面同步） -->
        <div class="flex gap-1.5 mb-2">
          <input v-model="apiKey" type="password" :placeholder="`${activeProvider.name} API Key`"
                 @keydown.enter.prevent="saveKey"
                 @blur="saveKey"
                 class="flex-1 bg-[#14161a] border border-[#1e2126] focus:border-[#00f0ff] outline-none px-2 py-1.5 text-xs text-[#e5e7eb] rounded-sm transition-colors" />
          <button @click="saveKey" class="px-2.5 py-1.5 text-xs font-bold text-[#090a0c] bg-[#00f0ff] hover:bg-[#00d4e0] rounded-sm transition-colors">保存</button>
        </div>
        <!-- 申请入口：Unsplash 需注册开发者应用获取 Access Key -->
        <a :href="activeProvider.keyHelpUrl" target="_blank" rel="noopener"
           class="block text-[10px] text-[#6b7280] hover:text-[#00f0ff] transition-colors mb-2">
          没有 Key？去 {{ activeProvider.name }} 申请 ↗
        </a>

        <!-- 搜索框 -->
        <div class="flex gap-1.5 mb-2">
          <input v-model="galleryQuery" type="text" placeholder="搜索图片关键词…"
                 @keydown.enter.prevent="loadGallery(true)"
                 class="flex-1 bg-[#14161a] border border-[#1e2126] focus:border-[#00f0ff] outline-none px-2 py-1.5 text-xs text-[#e5e7eb] rounded-sm transition-colors" />
          <button @click="loadGallery(true)" :disabled="galleryLoading"
                  class="px-2.5 py-1.5 text-xs font-bold text-[#e5e7eb] bg-[#1e2126] hover:bg-[#2a2e35] rounded-sm transition-colors disabled:opacity-50">
            搜索
          </button>
        </div>

        <!-- 错误 / 空态提示 -->
        <div v-if="galleryError && galleryPhotos.length === 0"
             class="text-[11px] text-[#ff2a2a] px-1 py-2 leading-relaxed">
          {{ galleryError }}
        </div>

        <!-- 图片网格：3 列，滚动到底自动加载下一页 -->
        <div v-if="galleryPhotos.length > 0" class="grid grid-cols-3 gap-1.5 max-h-[200px] overflow-y-auto custom-scrollbar" @scroll="galleryScroll">
          <button v-for="p in galleryPhotos" :key="p.id"
                  @click="pickFromGallery(p)"
                  :disabled="galleryLoading"
                  class="relative h-[52px] rounded-sm border border-[#1e2126] hover:border-[#00f0ff] transition-colors overflow-hidden disabled:opacity-50"
                  :style="{ backgroundImage: `url('${p.thumbUrl}')`, backgroundSize: 'cover', backgroundPosition: 'center' }"
                  :title="`${p.author} · ${activeProvider.name}`">
          </button>
        </div>

        <!-- 加载中 / 已到底 -->
        <div v-if="galleryLoading" class="text-[11px] text-[#6b7280] text-center py-2">加载中…</div>
        <div v-else-if="galleryDone && galleryPhotos.length > 0" class="text-[11px] text-[#6b7280] text-center py-1.5">— 已到底部 —</div>

        <!-- 署名要求提示（Unsplash 的硬性合规要求） -->
        <div v-if="galleryPhotos.length > 0" class="text-[10px] text-[#6b7280]/70 leading-relaxed pt-1">
          选用后会在封面浮层显示摄影师署名
        </div>
      </div>

      <!-- 渐变色（零存储成本） -->
      <div>
        <div class="text-[10px] text-[#6b7280] uppercase tracking-wider mb-1.5">渐变色</div>
        <div class="flex gap-1.5">
          <button v-for="g in COVER_GRADIENTS" :key="g.id"
                  @click="emit('select', `gradient:${g.id}`)"
                  class="w-9 h-9 rounded-sm border border-[#1e2126] hover:border-[#00f0ff] transition-colors"
                  :style="{ background: g.css }"
                  :title="g.id"></button>
        </div>
      </div>

      <!-- 上传本地图片 -->
      <div>
        <div class="text-[10px] text-[#6b7280] uppercase tracking-wider mb-1.5">上传图片</div>
        <button @click="fileRef?.click()" :disabled="busy"
                class="w-full flex items-center justify-center gap-2 px-3 py-2 border border-dashed border-[#1e2126] hover:border-[#00f0ff] text-[#6b7280] hover:text-[#00f0ff] rounded-sm transition-colors text-xs">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
          {{ busy ? '处理中…' : '选择图片（自动压缩）' }}
        </button>
        <input ref="fileRef" type="file" accept="image/*" class="hidden" @change="onFile" />
      </div>

      <!-- 外部链接 -->
      <div>
        <div class="text-[10px] text-[#6b7280] uppercase tracking-wider mb-1.5">图片链接</div>
        <div class="flex gap-1.5">
          <input v-model="urlInput" type="text" placeholder="https://..."
                 @keydown.enter.prevent="submitUrl"
                 class="flex-1 bg-[#14161a] border border-[#1e2126] focus:border-[#00f0ff] outline-none px-2 py-1.5 text-xs text-[#e5e7eb] rounded-sm transition-colors" />
          <button @click="submitUrl" class="px-2.5 py-1.5 text-xs font-bold text-[#090a0c] bg-[#00f0ff] hover:bg-[#00d4e0] rounded-sm transition-colors">用</button>
        </div>
      </div>
    </div>

    <div class="px-3 py-2 border-t border-[#1e2126]/60 shrink-0">
      <button @click="emit('remove')"
              class="w-full flex items-center justify-center gap-1.5 px-2 py-1 text-xs text-[#6b7280] hover:text-[#ff2a2a] hover:bg-[#1e2126] rounded-sm transition-colors">
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
