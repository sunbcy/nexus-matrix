import {createApp} from 'vue'
import './style.css'
import App from './App.vue'
import {initRuntimeConfig} from './runtimeConfig'

// runtimeConfig 已在模块加载时自初始化（确保 useSync 顶层读取前 __NEXUS_CONFIG__ 就绪）。
// 此处再调用一次，保持幂等，并为未来「原生壳在页面加载前注入 window.__NEXUS_CONFIG__」兜底。
initRuntimeConfig()

createApp(App).mount('#app')
