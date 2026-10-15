/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * 后端同步服务器地址。未设置时走同源相对路径（由 Vite 代理转发）。
   * 移动端（Capacitor/Tauri）必须设置，否则 WebView 的 location.host 不是服务器地址。
   * 例：VITE_SYNC_SERVER=http://192.168.1.10:8010
   */
  readonly VITE_SYNC_SERVER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
