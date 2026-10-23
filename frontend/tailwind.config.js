/** @type {import('tailwindcss').Config} */

// 主题化（2026-10-24）：
// 语义色一律走 CSS 变量，且变量存的是 **RGB 通道三元组**（如 `9 10 12`），
// 配合 `rgb(var(--x) / <alpha-value>)`，这样 `bg-void/50` 这类透明度修饰符
// 才能在换肤后依然成立（直接存 hex 的话 Tailwind v3 无法注入 alpha）。
// 各主题的具体取值见 src/style.css 的 [data-theme="..."] 块。
const semanticColor = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: [ "./index.html", "./src/**/*.{vue,js,ts,jsx,tsx}", ],
  theme: {
    extend: {
      colors: {
        // 层级：页面底 → 侧栏/卡片 → 按钮/浮层 → hover 层
        void: semanticColor('bg'),
        surface: semanticColor('surface'),
        panel: semanticColor('panel'),
        panel2: semanticColor('panel2'),
        line: semanticColor('line'),
        // 文字：主 → 次 → 弱；onaccent 是强调色按钮上的字色
        display: semanticColor('display'),
        muted: semanticColor('muted'),
        dim: semanticColor('dim'),
        onaccent: semanticColor('onaccent'),
        // 语义色
        accent: semanticColor('accent'),
        accent2: semanticColor('accent2'),
        warn: semanticColor('warn'),
        danger: semanticColor('danger'),
        dangerbg: semanticColor('dangerbg'),
        success: semanticColor('success'),
      },
    },
  },
  plugins: [],
}
