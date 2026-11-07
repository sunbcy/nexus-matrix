/**
 * 运行时配置注入（Capacitor / 原生壳用）。
 *
 * 优先级：URL query `?syncServer=` > localStorage（Web 设置面板写入）
 *        > window.__NEXUS_CONFIG__（JS 注入）> 构建期 VITE_SYNC_SERVER。
 *
 * 为什么加上 localStorage：设置入口已从原生底部 Tab 移到 Web 侧边栏右上角
 * （见 SettingsPanel.vue），用户配置落在 Web 侧。若只认 URL query，
 * 冷启动后原生注入的旧值会盖掉用户刚在 Web 里改的新值，出现「设置不生效」。
 * URL query 仍保留最高优先级，供原生壳/调试临时覆盖。
 *
 * 为什么不用「evaluateJavascript 改 import.meta.env」：
 * Vite 生产构建会把 `import.meta.env.VITE_SYNC_SERVER` 静态内联成字面量，
 * 运行时改对象属性对已内联的读取点无效。URL query 在模块初始化前就一定可读，时序最稳。
 */
export interface NexusRuntimeConfig {
  syncServer?: string;
  apiKey?: string;
}

declare global {
  interface Window {
    __NEXUS_CONFIG__?: NexusRuntimeConfig;
  }
}

/**
 * 打包进 APK 的默认同步服务器地址。
 * 只在 Capacitor 原生壳内生效（桌面 dev / Web 同源部署不受影响）；用户在「设置」里
 * 保存的地址（localStorage）与 URL query ?syncServer= 优先级更高，可随时覆盖。
 *
 * 为什么必须有默认值：安卓 WebView 的 origin 是 https://localhost，既不指向后端，
 * 也不能拿它当「同源」推断。不注入的话 useSync 会退化到 localhost、auth 会退化到
 * 相对 /api，结果所有请求打进 WebView 本地 → 查不到 OAuth 配置、连不上数据库。
 */
export const DEFAULT_SYNC_SERVER = 'https://nexus.sunbcy.homes';

/** 是否运行在 Capacitor 原生 WebView。 */
export function isNativeShell(): boolean {
  if (typeof window === 'undefined') return false;
  // 主判定：Capacitor 的 native-bridge.js 在模块求值前注入 window.Capacitor。
  if ((window as any).Capacitor?.isNativePlatform?.()) return true;
  // 兜底（注入稍晚时）：Capacitor 默认 androidScheme=https，本地资源源固定为
  // https://localhost **且无端口**。带端口的 localhost（Vite dev、后端自带 Web 版
  // localhost:8010）与公网域名都不算，避免同源自托管部署被误注入默认地址。
  return window.location.protocol === 'https:'
    && window.location.hostname === 'localhost'
    && !window.location.port;
}

function readQueryConfig(): NexusRuntimeConfig {
  if (typeof window === 'undefined') return {};
  try {
    const params = new URLSearchParams(window.location.search);
    const out: NexusRuntimeConfig = {};
    const syncServer = params.get('syncServer');
    if (syncServer) out.syncServer = syncServer;
    const apiKey = params.get('apiKey');
    if (apiKey) out.apiKey = apiKey;
    return out;
  } catch {
    return {};
  }
}

/** Web 设置面板写入的持久化配置（见 SettingsPanel.vue） */
export const SYNC_SERVER_STORAGE_KEY = 'nexus_sync_server';
export const SYNC_API_KEY_STORAGE_KEY = 'nexus_sync_api_key';

function readStoredConfig(): NexusRuntimeConfig {
  if (typeof window === 'undefined') return {};
  try {
    const out: NexusRuntimeConfig = {};
    const sv = window.localStorage.getItem(SYNC_SERVER_STORAGE_KEY);
    if (sv) out.syncServer = sv;
    const ak = window.localStorage.getItem(SYNC_API_KEY_STORAGE_KEY);
    if (ak) out.apiKey = ak;
    return out;
  } catch {
    return {};
  }
}

/** 必须在任何 composables 初始化前调用（useSync 在模块加载时读取服务器地址） */
export function initRuntimeConfig(): void {
  if (typeof window === 'undefined') return;
  const stored = readStoredConfig();
  const fromQuery = readQueryConfig();
  // 后面的覆盖前面的：query 优先级最高，stored 次之，JS 注入最低
  const merged: NexusRuntimeConfig = {
    ...(window.__NEXUS_CONFIG__ ?? {}),
    ...stored,
    ...fromQuery,
  };
  // 原生壳内若没显式配置地址，注入内置默认后端；放在合并之后，保证用户配置优先。
  if (isNativeShell() && !merged.syncServer) merged.syncServer = DEFAULT_SYNC_SERVER;
  window.__NEXUS_CONFIG__ = merged;
  // OAuth 登录 / ?apiKey= 直达：把 URL 携带的 apiKey 回写 localStorage，
  // 使登录态在刷新 / 重开页面后仍保留（否则仅当次会话有效）。
  if (fromQuery.apiKey) {
    try { window.localStorage.setItem(SYNC_API_KEY_STORAGE_KEY, fromQuery.apiKey); } catch {}
    // 立刻从 URL 抹掉 apiKey：否则后续 reload（切换工作区 / 退出登录）会反复把它写回
    // localStorage，导致「退出登录后又被自动登录」。
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete('apiKey');
      window.history.replaceState(null, '', u.pathname + u.search + u.hash);
    } catch { /* ignore */ }
  }
}

export function getRuntimeConfig(): NexusRuntimeConfig {
  return (typeof window !== 'undefined' && window.__NEXUS_CONFIG__) || {};
}

// 自初始化（关键修复）：本模块被 useSync 等依赖方 import 时，会**先于**依赖方的模块体求值，
// 从而确保 getRuntimeConfig() 在「模块加载期」就能拿到配置。
// 否则 main.ts 顶部的 initRuntimeConfig() 调用会被 ESM 的 import 提升挡在 useSync 模块求值之后，
// 导致 useSync 顶层 `const SYNC_SERVER = getRuntimeConfig().syncServer` 永远读到空值——
// 表现为「保存了同步地址但不生效、文档页签永远不同步」（见 issue 2026-10-19）。
// 这里在模块加载即执行一次；main.ts 的同名调用变为幂等冗余，无害。
initRuntimeConfig();
