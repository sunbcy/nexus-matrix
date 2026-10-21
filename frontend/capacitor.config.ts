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
    captureInput: true,
    // 调试期开启 chrome://inspect 远程调试；发布版本必须关闭
    webContentsDebuggingEnabled: true,
  },
  server: {
    // 本地打包资源（webDir），不走 server.url 远程加载
    androidScheme: 'https',
  },
};

export default config;
