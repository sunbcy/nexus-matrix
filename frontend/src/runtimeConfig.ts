/**
 * 运行时配置注入（Capacitor / 原生壳用）。
 *
 * 优先级：URL query `?syncServer=` > window.__NEXUS_CONFIG__（JS 注入）> 构建期 VITE_SYNC_SERVER。
 *
 * 为什么不用「evaluateJavascript 改 import.meta.env」：
 * Vite 生产构建会把 `import.meta.env.VITE_SYNC_SERVER` 静态内联成字面量，
 * 运行时改对象属性对已内联的读取点无效。URL query 在模块初始化前就一定可读，时序最稳。
 *
 * 原生壳加载地址示例：
 *   https://localhost/index.html?syncServer=http://192.168.1.10:8010#pageId
 */
export interface NexusRuntimeConfig {
  syncServer?: string;
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
    const syncServer = params.get('syncServer');
    return syncServer ? { syncServer } : {};
  } catch {
    return {};
  }
}

/** 必须在任何 composables 初始化前调用（useSync 在模块加载时读取服务器地址） */
export function initRuntimeConfig(): void {
  if (typeof window === 'undefined') return;
  const fromQuery = readQueryConfig();
  window.__NEXUS_CONFIG__ = { ...(window.__NEXUS_CONFIG__ ?? {}), ...fromQuery };
}

export function getRuntimeConfig(): NexusRuntimeConfig {
  return (typeof window !== 'undefined' && window.__NEXUS_CONFIG__) || {};
}
