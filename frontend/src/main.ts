import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { initRuntimeConfig } from './runtimeConfig'

// 必须先于 App 挂载：useSync 在模块加载时读取同步服务器地址
initRuntimeConfig()

createApp(App).mount('#app')
