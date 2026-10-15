import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.nexusmatrix.app',
  appName: 'Nexus Matrix',
  webDir: 'dist',
  android: {
    // 禁用混合内容：本地资源走 https://localhost scheme，与桌面行为一致
    allowMixedContent: false,
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
