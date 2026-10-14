// 调试：检查 unzipSync 的原始输出
const fs = require('fs');
const { unzipSync } = require('d:/PycharmProjects/nexus-matrix/frontend/node_modules/fflate');

const buf = fs.readFileSync('d:/PycharmProjects/nexus-matrix/test_samples/notion_export_sample.zip');
console.log('zip 大小:', buf.length, '类型:', buf.constructor.name);

const raw = unzipSync(new Uint8Array(buf));
const keys = Object.keys(raw);
console.log('解压出条目数:', keys.length);
keys.forEach((k) => console.log('  ', JSON.stringify(k), '->', raw[k].length, 'bytes'));
