import {ref} from 'vue';

/**
 * 全平台主题（2026-10-24）
 *
 * 设计原则（以使用者为中心，而不是「好看」）：
 * 1. **效率**：界面本身必须是低信息量的——背景/边框一律无彩色或极低饱和，
 *    只有「可交互」与「状态」才配得到强调色，减少视觉搜索成本。
 * 2. **集中注意力**：正文对比度足够（≥ 7:1 量级）、背景不参与竞争；
 *    弱化文字只用于元信息，不承载正文。
 * 3. **解压 / 护眼**：提供低色温（Sepia）与低唤醒度（Forest / Graphite）方案，
 *    并让发光效果只在深色主题生效（浅色主题上发光会让字发虚）。
 *
 * 换肤的实现：只改 `<html data-theme>`，其余全部由 CSS 变量级联下去。
 * 组件里一律使用语义 token（void / surface / panel / line / display / accent …），
 * 不要写死 hex —— 见 tailwind.config.js 与 src/style.css。
 */
export type ThemeId = 'void' | 'paper' | 'sepia' | 'forest' | 'ocean' | 'graphite' | 'system';

export interface ThemeMeta {
  id: ThemeId;
  /** 展示名 */
  name: string;
  /** 一句话定位：什么时候用它、对眼睛/注意力有什么影响 */
  desc: string;
  /** 卡片上的色板：[底, 次级底, 浮层, 主文字, 强调] */
  swatch: [string, string, string, string, string];
  /** 明/暗/自动，仅用于卡片上的小标记 */
  mode: 'dark' | 'light' | 'auto';
}

// 色板只用于卡片预览（视觉示意），真实取值以 CSS 变量为准。
export const THEMES: ThemeMeta[] = [
  {
    id: 'void',
    name: '酷黑',
    desc: '默认。界面完全退到背景里，只剩内容与光标，适合夜间长时间写作。',
    swatch: ['#090a0c', '#14161a', '#1e2126', '#e5e7eb', '#00f0ff'],
    mode: 'dark',
  },
  {
    id: 'paper',
    name: '纸白',
    desc: 'Notion 浅色。白底暖灰层级，白天/明亮环境下细节辨认成本最低。',
    swatch: ['#ffffff', '#fbfbfa', '#efefed', '#37352f', '#2b6feb'],
    mode: 'light',
  },
  {
    id: 'sepia',
    name: '暖阳',
    desc: '低色温米黄，蓝光占比最低。连续读写的「解压档」，眼睛最不容易累。',
    swatch: ['#faf4e8', '#f3ebdb', '#eae0cd', '#4a3c2a', '#b05814'],
    mode: 'light',
  },
  {
    id: 'forest',
    name: '墨绿',
    desc: '深绿基底：人眼对绿光调节负担最小，暗色里也不刺眼，久看不燥。',
    swatch: ['#0f1a15', '#14201a', '#1b2b23', '#dfe8e2', '#4ade80'],
    mode: 'dark',
  },
  {
    id: 'ocean',
    name: '午夜蓝',
    desc: '深蓝比纯黑多一点空间感，冷色降低唤醒度，夜间专注又不压抑。',
    swatch: ['#0b1220', '#111a2b', '#1a2540', '#dbe6f5', '#60a5fa'],
    mode: 'dark',
  },
  {
    id: 'graphite',
    name: '石墨',
    desc: '近乎无彩色：把界面的色彩奖励信号降到最低，最不跟内容抢注意力。',
    swatch: ['#17181a', '#1e2023', '#26292d', '#dfe1e4', '#b0bed2'],
    mode: 'dark',
  },
  {
    id: 'system',
    name: '跟随系统',
    desc: '跟随操作系统的浅色 / 深色：白天自动纸白、夜里自动酷黑，省心护眼。',
    swatch: ['#090a0c', '#ffffff', '#1e2126', '#e5e7eb', '#2b6feb'],
    mode: 'auto',
  },
];

const STORAGE_KEY = 'nexus_theme';

const DEFAULT_THEME: ThemeId = 'void';

export const currentThemeId = ref<ThemeId>(DEFAULT_THEME);

const isThemeId = (v: string | null | undefined): v is ThemeId =>
  !!v && THEMES.some((t) => t.id === v);

/** 跟随系统时使用的明暗基准：暗=酷黑（对比度最高）、亮=纸白（护眼） */
const SYSTEM_DARK: ThemeId = 'void';
const SYSTEM_LIGHT: ThemeId = 'paper';
const mq =
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: light)')
    : null;
const resolveSystem = (): ThemeId => (mq && mq.matches ? SYSTEM_LIGHT : SYSTEM_DARK);

let mediaAttached = false;
const onSystemChange = () => {
  // 只在当前确实选了「跟随系统」时才改写；切回固定主题后变更事件被忽略
  if (currentThemeId.value === 'system') {
    document.documentElement.dataset.theme = resolveSystem();
  }
};

/** 应用主题：只动 html[data-theme]，其余靠 CSS 变量级联 */
export const applyTheme = (id: ThemeId) => {
  currentThemeId.value = id;
  // 「跟随系统」要落到一个具体的主题上，由系统深浅决定
  const effective = id === 'system' ? resolveSystem() : id;
  document.documentElement.dataset.theme = effective;
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* 隐私模式下 localStorage 可能不可用，忽略 */
  }
  // 选了「跟随系统」才挂系统主题监听（只挂一次）
  if (id === 'system' && mq && !mediaAttached) {
    if (mq.addEventListener) mq.addEventListener('change', onSystemChange);
    else (mq as MediaQueryList & { addListener?: (fn: () => void) => void }).addListener(onSystemChange);
    mediaAttached = true;
  }
};

/**
 * 启动时调用（在 mount 之前），避免首屏先闪一下默认主题。
 *
 * 默认固定为「酷黑」而不是跟随系统：这个产品的既有观感就是酷黑，
 * 首次打开就因为系统浅色而换脸属于意外改动。用户只要在设置里选过一次
 * （含「跟随系统」），之后就以其选择为准（存 localStorage）。
 */
export const initTheme = () => {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    /* 隐私模式下 localStorage 可能不可用，忽略 */
  }
  applyTheme(isThemeId(stored) ? stored : DEFAULT_THEME);
};
