import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // 加载 .env 文件中的环境变量
  const env = loadEnv(mode, process.cwd(), '')
  const backendPort = env.BACKEND_PORT || '8010'
  const frontendPort = parseInt(env.FRONTEND_PORT || '5180')

  return {
    plugins: [vue()],
    server: {
      port: frontendPort,
      host: true,
      proxy: {
        '/api': {
          target: `http://localhost:${backendPort}`,
          changeOrigin: true,
          // 后端未启动 / 重启时，Vite 会打印红色 ECONNREFUSED 堆栈。
          // 前端已有纯本地模式降级与状态指示，这里静默处理避免误导用户。
          configure: (proxy: any) => {
            proxy.on('error', () => { /* 交由前端 syncStatus 呈现 */ });
          },
        },
        '/ws': {
          target: `ws://localhost:${backendPort}`,
          ws: true,
          configure: (proxy: any) => {
            proxy.on('error', () => { /* 同上：WS 不可用时走纯本地模式 */ });
          },
        },
      },
    },
  }
})
