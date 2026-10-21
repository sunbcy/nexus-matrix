<script setup lang="ts">
// 文档图标选择器（对齐 Notion 的 Page Icon picker）
//
// 设计要点：
// - 不用原生 prompt/confirm：会抢焦点，且观感与整体工业风割裂
// - 分类页签 + 网格，支持中文/拼音关键词搜索
// - 底部固定「随机 / 移除」两个动作（Notion 同款）
// - 打开时自动聚焦搜索框，Esc 关闭，回车选第一个
import {computed, nextTick, onMounted, onUnmounted, ref, watch} from 'vue';
import {EMOJI_CATEGORIES, randomEmoji, searchEmojis, getRecentEmojis, rememberEmoji} from '../composables/emoji';
import {useMobileInput} from '../composables/useMobileInput';

// 触屏判定（与编辑器同一套双信号逻辑）：决定弹窗是底部 sheet 还是定点 popover，
// 以及是否聚焦搜索框（触屏聚焦 = 弹软键盘 = 打断操作）。
const { isCoarsePointer } = useMobileInput();

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
// 最近使用（Notion 的 Recents）：有记录时作为置顶分类
const recents = ref<string[]>(getRecentEmojis());

const categories = computed(() =>
  recents.value.length
    ? [{ name: '最近', icon: '🕘', emojis: recents.value.join(' ') }, ...EMOJI_CATEGORIES]
    : EMOJI_CATEGORIES,
);

const results = computed(() => (query.value.trim() ? searchEmojis(query.value) : []));
const gridEmojis = computed(() => {
  if (query.value.trim()) return results.value;
  return categories.value[activeCategory.value]?.emojis.split(/\s+/).filter(Boolean) ?? [];
});

const pick = (emoji: string) => { recents.value = rememberEmoji(emoji); emit('select', emoji); };
const randomize = () => { const e = randomEmoji(); recents.value = rememberEmoji(e); emit('select', e); };
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
  if (isCoarsePointer.value) {
    // 触屏：先收掉当前焦点（正文 contenteditable 上正展开的软键盘），
    // 再**不聚焦搜索框**——否则一打开选择器就弹输入法，打断操作。
    // 这是移动端「点图标必弹键盘」的根因，桌面端保留原行为（打开即搜索）。
    (document.activeElement as HTMLElement | null)?.blur();
  } else {
    updatePos();
    nextTick(() => searchRef.value?.focus());
  }
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
  <!-- 触屏：底部 sheet（不依赖锚点定位，避开键盘导致的 innerHeight 收缩把弹窗顶飞）；
       桌面：锚点下方浮层。单容器双形态，避免两套 DOM 造成菜单项重复。 -->
  <div class="icon-picker-popup fixed z-[70] bg-[#090a0c] border border-[#1e2126] shadow-2xl flex flex-col"
       :class="isCoarsePointer
         ? 'inset-x-0 bottom-0 rounded-t-xl border-b-0 max-h-[70vh]'
         : 'w-80 rounded-md overflow-hidden'"
       :style="isCoarsePointer ? { bottom: '0px' } : { top: `${pos.top}px`, left: `${pos.left}px` }"
       @keydown="onKeyDown">
    <!-- 触屏 sheet 的抓取条（视觉提示可下滑关闭） -->
    <div v-if="isCoarsePointer" class="flex justify-center pt-2 pb-1 shrink-0">
      <div class="w-10 h-1 rounded-full bg-[#6b7280]/60"></div>
    </div>

    <!-- 触屏：把「随机换一个」提到最顶部。
         移动端改图标多数时候没有明确目标，「默认随机」应是最顺手的一步操作；
         需要精确挑选时再往下用搜索/分类。这样既不用弹键盘，也不用先想选什么。 -->
    <div v-if="isCoarsePointer" class="px-2 pb-2 shrink-0">
      <button @click="randomize"
              class="w-full h-12 flex items-center justify-center gap-2 rounded border border-[#1e2126] bg-[#14161a] text-sm text-[#00f0ff] active:bg-[#1e2126] transition-colors">
        <span class="text-base">🎲</span> 换一个随机图标
      </button>
    </div>
    <!-- 搜索 -->
    <div class="p-2 border-b border-[#1e2126]/60 shrink-0">
      <input ref="searchRef" v-model="query" type="text" placeholder="搜索表情（中文/拼音）"
             class="w-full bg-[#14161a] border border-[#1e2126] focus:border-[#00f0ff] outline-none px-2.5 py-1.5 text-sm text-[#e5e7eb] rounded-sm transition-colors" />
    </div>

    <!-- 分类页签（搜索时隐藏） -->
    <div v-if="!query.trim()" class="flex items-center gap-0.5 px-2 py-1.5 border-b border-[#1e2126]/60 shrink-0 overflow-x-auto custom-scrollbar">
      <button v-for="(cat, idx) in categories" :key="cat.name"
              @click="activeCategory = idx"
              class="shrink-0 px-2 py-1 text-xs rounded-sm transition-colors whitespace-nowrap"
              :class="idx === activeCategory ? 'bg-[#1e2126] text-[#00f0ff]' : 'text-[#6b7280] hover:text-[#e5e7eb]'">
        <span class="mr-1">{{ cat.icon }}</span>{{ cat.name }}
      </button>
    </div>

    <!-- 表情网格 -->
    <div class="flex-1 overflow-y-auto p-2 custom-scrollbar" style="min-height: 180px; max-height: 260px;">
      <div v-if="gridEmojis.length === 0" class="text-center text-xs text-[#6b7280] py-8">未找到相关表情</div>
      <div v-else class="grid gap-0.5" :class="isCoarsePointer ? 'grid-cols-6' : 'grid-cols-8'">
        <button v-for="(e, i) in gridEmojis" :key="`${e}-${i}`"
                @click="pick(e)"
                class="flex items-center justify-center rounded-sm hover:bg-[#1e2126] transition-colors"
                :class="isCoarsePointer ? 'w-11 h-11 text-2xl' : 'w-7 h-7 text-lg'"
                :title="e">{{ e }}</button>
      </div>
    </div>

    <!-- 底部动作（触屏放大到 44px 触摸目标并避开手势条安全区） -->
    <div class="flex items-center gap-1 px-2 border-t border-[#1e2126]/60 shrink-0"
         :class="isCoarsePointer ? 'py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))]' : 'py-1.5'">
      <button @click="randomize"
              class="flex-1 flex items-center justify-center gap-1.5 px-2 rounded-sm transition-colors text-xs text-[#6b7280] hover:text-[#00f0ff] hover:bg-[#1e2126]"
              :class="isCoarsePointer ? 'h-11 text-sm' : 'py-1'">
        <span>🎲</span> 随机
      </button>
      <button @click="remove"
              class="flex-1 flex items-center justify-center gap-1.5 px-2 rounded-sm transition-colors text-xs text-[#6b7280] hover:text-[#ff2a2a] hover:bg-[#1e2126]"
              :class="isCoarsePointer ? 'h-11 text-sm' : 'py-1'">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        移除
      </button>
    </div>
  </div>
</template>
