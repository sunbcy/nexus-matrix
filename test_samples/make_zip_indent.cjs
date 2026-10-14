// 构造带真实嵌套缩进的 ZIP，验证端到端导入后 indentLevel 是否保留
const fs = require('fs');
const { zipSync, strToU8 } = require('d:/PycharmProjects/nexus-matrix/frontend/node_modules/fflate');

const out = 'd:/PycharmProjects/nexus-matrix/test_samples/notion_export_indent.zip';

// 模拟 Notion 导出的多层缩进（2 空格 + 4 空格两种来源）
const md = [
  '# 缩进验证文档',
  '',
  '- 顶层项目 A',
  '  - 二级项目 A1',
  '    - 三级项目 A1a',
  '  - 二级项目 A2',
  '- 顶层项目 B',
  '',
  '- [ ] 顶层待办',
  '  - [x] 子待办已完成',
  '    - [ ] 孙待办未完成',
  '',
  '1. 顶层编号',
  '  1. 二级编号',
  '',
  '> 顶层引用',
  '  - 引用下的列表项',
  '',
].join('\n');

const zipped = zipSync({
  'Export/Indented Page.md': strToU8(md),
}, { level: 6 });

fs.writeFileSync(out, zipped);
console.log('已生成 ' + out + ' (' + zipped.length + ' bytes)');
