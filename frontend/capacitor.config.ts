import type {CapacitorConfig} from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.nexusmatrix.app',
  appName: 'Nexus Matrix',
  webDir: 'dist',
  android: {
    // 允许混合内容：本地资源走 https://localhost（androidScheme: 'https'），但局域网/本机
    // 后端多为 http://（Vite dev server 或 FastAPI :8010）。若禁用混合内容，WebView 会以
    // mixed-content 为由拦截所有对 http 后端的 fetch/WS —— 表现为「保存地址后连不上」。
    // 明文流量的目标域已由 network_security_config.xml 限制在 LAN/localhost 段，风险可控。
    // 生产环境应让后端提供 https，而不是长期放开这里。
    allowMixedContent: true,
    // 必须为 false（Capacitor 默认值）。为 true 时 CapacitorWebView.onCreateInputConnection
    // 会返回一个空的 BaseInputConnection，不连接 WebView 的真实编辑内容；IME 的 commitText
    // 经 dispatchKeyEvent 落到 `document.activeElement.value = ...`，而 contenteditable 的
    // div 没有 .value，文字被写进不存在的属性 → 真机「能删字符/删 block，但完全输不进字」。
    // DEL 是 KeyEvent 直接走 WebView，所以删除正常。保持 false 才能拿到真实 InputConnection。
    captureInput: false,
    // 调试期开启 chrome://inspect 远程调试；发布版本必须关闭
    webContentsDebuggingEnabled: true,
  },
  server: {
    // 本地打包资源（webDir），不走 server.url 远程加载
    androidScheme: 'https',
  },
};

export default config;
