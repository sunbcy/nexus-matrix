import type { Ref } from 'vue';
import { syncStatus, onlineDevices, lastSyncError } from './useSync';

/**
 * Web → 原生 只读桥（阶段 1）。
 *
 * 挂在 window.__NEXUS_API__ 上，供 Android 原生壳（Compose）通过
 * webView.evaluateJavascript 查询页面列表/同步状态，以及反向打开页面。
 *
 * 边界（刻意保持只读 + 最小面）：
 * - 不暴露写操作：原生壳不重复实现数据层（那是阶段 2 的事）
 * - 不替代路由：页面切换仍走 location.hash（编辑器自己 watch）
 * - 桌面端无原生壳时挂上也无副作用，纯函数式快照
 */
export interface NativePageSummary {
  id: string;
  title: string;
  icon?: string;
  isFavorite: boolean;
  updatedAt?: number;
}

export interface NexusNativeApi {
  getPages(): NativePageSummary[];
  getFavorites(): NativePageSummary[];
  getActivePage(): NativePageSummary | null;
  getSyncStatus(): { status: string; onlineDevices: number; lastError: string };
  openPage(id: string): boolean;
}

declare global {
  interface Window {
    __NEXUS_API__?: NexusNativeApi;
  }
}

type BridgePage = NativePageSummary;

const summarize = (p: BridgePage): NativePageSummary => ({
  id: p.id,
  title: p.title,
  icon: p.icon,
  isFavorite: !!p.isFavorite,
  updatedAt: p.updatedAt,
});

/** 在编辑器 onMounted 中调用；pages/activePageId 为编辑器内的 ref */
export function installNativeBridge(pages: Ref<BridgePage[]>, activePageId: Ref<string>): void {
  if (typeof window === 'undefined') return;
  window.__NEXUS_API__ = {
    getPages: () => pages.value.map(summarize),
    getFavorites: () => pages.value.filter(p => p.isFavorite).map(summarize),
    getActivePage: () => {
      const p = pages.value.find(x => x.id === activePageId.value);
      return p ? summarize(p) : null;
    },
    getSyncStatus: () => ({
      status: syncStatus.value,
      onlineDevices: onlineDevices.value,
      lastError: lastSyncError.value,
    }),
    openPage: (id: string) => {
      if (!pages.value.some(p => p.id === id)) return false;
      activePageId.value = id;   // 编辑器 watch 会同步 location.hash
      return true;
    },
  };
}
