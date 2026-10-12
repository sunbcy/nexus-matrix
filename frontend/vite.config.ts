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
        },
        '/ws': {
          target: `ws://localhost:${backendPort}`,
          ws: true,
        },
      },
    },
  }
})
