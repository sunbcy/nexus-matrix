<script setup lang="ts">
// 文档图标选择器（对齐 Notion 的 Page Icon picker）
//
// 设计要点：
// - 不用原生 prompt/confirm：会抢焦点，且观感与整体工业风割裂
// - 分类页签 + 网格，支持中文/拼音关键词搜索
// - 底部固定「随机 / 移除」两个动作（Notion 同款）
// - 打开时自动聚焦搜索框，Esc 关闭，回车选第一个
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { EMOJI_CATEGORIES, searchEmojis, randomEmoji } from '../composables/emoji';

const props = defineProps<{
  current?: string;
  /** 锚点元素，用于定位弹窗 */
  anchorEl?: HTMLElement | null;
}>();

const emit = defineEmits<{
  (e: 'select', emoji: string): void;
  (e: 'remove'): void;
  (e: 'close'): void;
}>();

const query = ref('');
const activeCategory = ref(0);
const searchRef = ref<HTMLInputElement | null>(null);

const results = computed(() => (query.value.trim() ? searchEmojis(query.value) : []));
const gridEmojis = computed(() => {
  if (query.value.trim()) return results.value;
  return EMOJI_CATEGORIES[activeCategory.value]?.emojis.split(/\s+/).filter(Boolean) ?? [];
});

const pick = (emoji: string) => emit('select', emoji);
const randomize = () => emit('select', randomEmoji());
const remove = () => emit('remove');

const onKeyDown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') { e.preventDefault(); emit('close'); return; }
  if (e.key === 'Enter' && gridEmojis.value.length > 0) { e.preventDefault(); pick(gridEmojis.value[0]); }
};

// 弹窗定位：贴在锚点下方，左右不超出视口
const pos = ref({ top: 0, left: 0 });
const updatePos = () => {
  const el = props.anchorEl;
  if (!el) return;
  const r = el.getBoundingClientRect();
  const W = 320;
  const H = 380;
  pos.value = {
    top: Math.min(r.bottom + 6, window.innerHeight - H - 8),
    left: Math.max(8, Math.min(r.left, window.innerWidth - W - 8)),
  };
};

// 点击外部关闭
const onDocClick = (e: MouseEvent) => {
  const t = e.target as HTMLElement;
  if (t.closest('.icon-picker-popup')) return;
  if (props.anchorEl && props.anchorEl.contains(t)) return;
  emit('close');
};

// 滚动 / 缩放时重新定位，避免弹窗与锚点脱节
const onScrollOrResize = () => updatePos();

watch(() => props.anchorEl, () => nextTick(updatePos));
watch(query, () => { activeCategory.value = 0; });

onMounted(() => {
  updatePos();
  nextTick(() => searchRef.value?.focus());
  // 延迟挂载，避免「打开弹窗的这次点击」立刻被判定为外部点击而关闭
  setTimeout(() => document.addEventListener('click', onDocClick), 0);
  window.addEventListener('resize', onScrollOrResize);
  window.addEventListener('scroll', onScrollOrResize, true);
});
onUnmounted(() => {
  document.removeEventListener('click', onDocClick);
  window.removeEventListener('resize', onScrollOrResize);
  window.removeEventListener('scroll', onScrollOrResize, true);
});
</script>

<template>
  <div class="icon-picker-popup fixed z-[70] w-80 bg-[#090a0c] border border-[#1e2126] shadow-2xl rounded-md overflow-hidden flex flex-col"
       :style="{ top: `${pos.top}px`, left: `${pos.left}px` }"
       @keydown="onKeyDown">
    <!-- 搜索 -->
    <div class="p-2 border-b border-[#1e2126]/60 shrink-0">
      <input ref="searchRef" v-model="query" type="text" placeholder="搜索表情（中文/拼音）"
             class="w-full bg-[#14161a] border border-[#1e2126] focus:border-[#00f0ff] outline-none px-2.5 py-1.5 text-sm text-[#e5e7eb] rounded-sm transition-colors" />
    </div>

    <!-- 分类页签（搜索时隐藏） -->
    <div v-if="!query.trim()" class="flex items-center gap-0.5 px-2 py-1.5 border-b border-[#1e2126]/60 shrink-0 overflow-x-auto custom-scrollbar">
      <button v-for="(cat, idx) in EMOJI_CATEGORIES" :key="cat.name"
              @click="activeCategory = idx"
              class="shrink-0 px-2 py-1 text-xs rounded-sm transition-colors whitespace-nowrap"
              :class="idx === activeCategory ? 'bg-[#1e2126] text-[#00f0ff]' : 'text-[#6b7280] hover:text-[#e5e7eb]'">
        <span class="mr-1">{{ cat.icon }}</span>{{ cat.name }}
      </button>
    </div>

    <!-- 表情网格 -->
    <div class="flex-1 overflow-y-auto p-2 custom-scrollbar" style="min-height: 180px; max-height: 260px;">
      <div v-if="gridEmojis.length === 0" class="text-center text-xs text-[#6b7280] py-8">未找到相关表情</div>
      <div v-else class="grid grid-cols-8 gap-0.5">
        <button v-for="(e, i) in gridEmojis" :key="`${e}-${i}`"
                @click="pick(e)"
                class="w-7 h-7 flex items-center justify-center text-lg rounded-sm hover:bg-[#1e2126] transition-colors"
                :title="e">{{ e }}</button>
      </div>
    </div>

    <!-- 底部动作 -->
    <div class="flex items-center gap-1 px-2 py-1.5 border-t border-[#1e2126]/60 shrink-0">
      <button @click="randomize" class="flex-1 flex items-center justify-center gap-1.5 px-2 py-1 text-xs text-[#6b7280] hover:text-[#00f0ff] hover:bg-[#1e2126] rounded-sm transition-colors">
        <span>🎲</span> 随机
      </button>
      <button @click="remove" class="flex-1 flex items-center justify-center gap-1.5 px-2 py-1 text-xs text-[#6b7280] hover:text-[#ff2a2a] hover:bg-[#1e2126] rounded-sm transition-colors">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        移除
      </button>
    </div>
  </div>
</template>
