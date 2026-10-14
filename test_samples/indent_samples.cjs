// 验证缩进解析：先确认 Notion 导出实际用哪种缩进形态
const { execSync } = require('child_process');
const SRC = 'd:/PycharmProjects/nexus-matrix/frontend/src/composables/markdownImport.ts';
const OUT = 'd:/PycharmProjects/nexus-matrix/frontend/.indcache';
execSync(`npx esbuild "${SRC}" --format=cjs --outfile=${OUT}.cjs --log-level=error`, {
  cwd: 'd:/PycharmProjects/nexus-matrix/frontend', stdio: 'inherit',
});
const { parseMarkdown } = require(`${OUT}.cjs`);
const fs = require('fs');

const cases = [
  ['2 空格缩进列表', '- 父项\n  - 子项\n    - 孙项'],
  ['4 空格缩进列表', '- 父项\n    - 子项'],
  ['tab 缩进列表', '- 父项\n\t- 子项'],
  ['混合缩进', '- A\n  - A1\n  - A2\n- B'],
  ['待办缩进', '- [ ] 父\n  - [ ] 子'],
  ['段落缩进', '普通段\n  缩进段'],
  ['引用缩进', '> 父\n>   子'],
  ['tab 宽 4 空格', '- 父项\n    - 子项\n        - 孙项'],
];

for (const [name, md] of cases) {
  const r = parseMarkdown(md);
  const levels = r.blocks.map((b) => b.indentLevel ?? 0);
  console.log(`${name.padEnd(16)} -> levels=${JSON.stringify(levels)}  types=${JSON.stringify(r.blocks.map((b) => b.type))}`);
}

fs.unlinkSync(`${OUT}.cjs`);
