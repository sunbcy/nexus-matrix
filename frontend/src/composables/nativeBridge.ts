import type {Ref} from 'vue';
import {ref, watch} from 'vue';
import {lastSyncError, onlineDevices, retrySync, syncStatus} from './useSync';

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
  /** 下拉刷新触发：重新同步（而非整页 reload，避免丢失编辑态） */
  triggerResync(): void;
}

declare global {
  interface Window {
    __NEXUS_API__?: NexusNativeApi;
    /** 原生注入的 Web → 原生 桥：推送下拉刷新开关与列表置顶状态 */
    NexusNativeBridge?: {
      setPullRefresh(enabled: boolean): void;
      setListScrollAtTop(atTop: boolean): void;
      finishPullRefresh(): void;
    };
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

/** Web → 原生：是否允许下拉刷新（仅列表页为 true，内容编辑页为 false）。 */
export const setNativePullRefresh = (enabled: boolean): void => {
  window.NexusNativeBridge?.setPullRefresh(enabled);
};
/** Web → 原生：列表滚动容器是否已在顶部（仅顶部允许触发刷新）。 */
export const setNativeListAtTop = (atTop: boolean): void => {
  window.NexusNativeBridge?.setListScrollAtTop(atTop);
};
const finishNativePullRefresh = (): void => {
  window.NexusNativeBridge?.finishPullRefresh();
};

// 下拉刷新进行中标记：同步状态落定后由本模块通知原生收起 spinner。
const pullRefreshActive = ref(false);

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
    // 下拉刷新触发：重新同步（而非整页 reload，避免丢失编辑态）。
    triggerResync: () => {
      pullRefreshActive.value = true;
      void retrySync();
      // Web 兜底：若同步状态在 3s 内未落定（online/offline），强制收起 spinner，
      // 避免原生侧未收到回调时 spinner 卡死（原生另有 8s 安全网）。
      setTimeout(() => {
        if (pullRefreshActive.value) {
          pullRefreshActive.value = false;
          finishNativePullRefresh();
        }
      }, 3000);
    },
  };

  // 同步状态落定（online=同步完成 / offline=无后端可连）后，通知原生收起下拉 spinner。
  watch(syncStatus, (s) => {
    if (pullRefreshActive.value && (s === 'online' || s === 'offline')) {
      pullRefreshActive.value = false;
      finishNativePullRefresh();
    }
  });
}
