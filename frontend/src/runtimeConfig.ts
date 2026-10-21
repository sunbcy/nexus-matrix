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
  window.__NEXUS_CONFIG__ = {
    ...(window.__NEXUS_CONFIG__ ?? {}),
    ...stored,
    ...fromQuery,
  };
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
