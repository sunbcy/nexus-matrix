import { defineConfig } from 'vitest/config';

// 只跑纯逻辑测试（composables 下的解析器与工具函数）。
// 编辑器组件本身依赖 DOM 与浏览器 API，暂不纳入自动化测试。
export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
    reporters: 'default',
  },
});
