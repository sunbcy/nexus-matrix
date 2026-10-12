// 跨平台键值存储抽象。
//
// 为什么必须是异步接口：
// - Web 端 localStorage 是同步的，但 Capacitor Preferences（Android/iOS 推荐，
//   因为 iOS 会在存储压力下清理 localStorage）与 Tauri store 插件都是异步的。
// - 如果现在用同步 API，将来接入三端时所有调用点都要改，属于会堵死迁移的决策。
// 因此这里统一为 Promise 接口，Web 端用 localStorage 作为默认实现（立即 resolve）。
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

// 默认实现：浏览器 localStorage。在 Capacitor / Tauri 的 WebView 中同样可用。
export const webStore: KeyValueStore = {
  async get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  async set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      // 容量超限（图片 Base64 很容易撑爆 5MB）时不能静默丢数据
      console.error('[NEXUS STORE] 写入失败', e);
      throw e;
    }
  },
  async remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

// 当前激活的存储实现。接入三端时在此替换：
//   Capacitor: import { Preferences } from '@capacitor/preferences'
//   Tauri:     import { load, save } from '@tauri-apps/plugin-store'
let activeStore: KeyValueStore = webStore;

export const setStore = (store: KeyValueStore) => { activeStore = store; };
export const getStore = () => activeStore;
