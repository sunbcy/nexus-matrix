import {createApp} from 'vue'
import './style.css'
// 自托管字体（替代原先会失败的 Google Fonts @import）：只引用到字重 + latin 子集，
// woff2 由 Vite 打进产物、无外部请求；中文回退系统字体（这三款不含 CJK）。
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-700.css'
import '@fontsource/rajdhani/latin-600.css'
import '@fontsource/rajdhani/latin-700.css'
import App from './App.vue'
import {initRuntimeConfig} from './runtimeConfig'
import {initTheme} from './composables/theme'

// runtimeConfig 已在模块加载时自初始化（确保 useSync 顶层读取前 __NEXUS_CONFIG__ 就绪）。
// 此处再调用一次，保持幂等，并为未来「原生壳在页面加载前注入 window.__NEXUS_CONFIG__」兜底。
initRuntimeConfig()

// 主题必须在 mount 之前落到 <html data-theme> 上，否则首屏会先闪一下默认配色。
initTheme()

createApp(App).mount('#app')
