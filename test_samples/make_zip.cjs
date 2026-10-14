// 构造一个模拟 Notion 导出的 ZIP，用于验证 zipImport
const fs = require('fs');
const { zipSync, strToU8 } = require('d:/PycharmProjects/nexus-matrix/frontend/node_modules/fflate');

const out = 'd:/PycharmProjects/nexus-matrix/test_samples/notion_export_sample.zip';

// 1x1 透明 PNG（足够验证 Base64 转换链路）
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const files = {
  // 父页面
  'Notion Export/Main Page.md': strToU8(
    '# 主页面\n\n这是**父页面**的正文。\n\n![配图](image/image-1.png)\n\n- 父级列表项\n',
  ),
  'Notion Export/image/image-1.png': new Uint8Array(png),

  // 子页面（开启 Create folders for subpages）
  'Notion Export/Subpage A/Subpage A.md': strToU8(
    '## 子页面 A\n\n子页面的内容，带 `代码`。\n\n- [x] 子页面待办\n',
  ),
  'Notion Export/Subpage A/screenshot.png': new Uint8Array(png),

  // 二级子页面（验证深层嵌套）
  'Notion Export/Subpage A/Deep/Deep.md': strToU8(
    '### 深层页面\n\n第三层内容。\n',
  ),

  // 系统垃圾文件（应被过滤）
  'Notion Export/__MACOSX/._Main Page.md': strToU8('junk'),
  'Notion Export/.DS_Store': strToU8('junk'),
};

const zipped = zipSync(files, { level: 6 });
fs.writeFileSync(out, zipped);
console.log('已生成 ' + out + ' (' + Math.round(zipped.length) + ' bytes)');
console.log('包含 ' + Object.keys(files).length + ' 个条目');
