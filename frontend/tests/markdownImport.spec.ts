import { describe, it, expect } from 'vitest';
import { parseMarkdown, inlineToHtml } from '../src/composables/markdownImport';

// 覆盖此前手工验证过的全部断言，防止编辑器逻辑回归。
// 重点：category / type / indentLevel / completed 四个字段，
// 以及「认不出就降级保留原文」这条核心原则。

describe('inlineToHtml', () => {
  it('转换行内格式', () => {
    expect(inlineToHtml('这是**粗体**与*斜体*')).toContain('<strong>粗体</strong>');
    expect(inlineToHtml('这是**粗体**与*斜体*')).toContain('<em>斜体</em>');
    expect(inlineToHtml('`code`')).toContain('<code>code</code>');
    expect(inlineToHtml('~~del~~')).toContain('<del>del</del>');
  });

  it('不误转单词内部的星号与下划线', () => {
    expect(inlineToHtml('a*b*c')).not.toContain('<em>');
    expect(inlineToHtml('snake_case_name')).not.toContain('<em>');
  });

  it('转义危险 HTML（防 XSS）', () => {
    const out = inlineToHtml('<img src=x onerror=alert(1)>');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });

  it('转换链接并拦截危险协议', () => {
    expect(inlineToHtml('[文字](https://example.com)')).toContain('href="https://example.com"');
    expect(inlineToHtml('[点我](javascript:alert(1))')).toContain('href="#"');
  });

  it('嵌套格式不串味', () => {
    const out = inlineToHtml('**粗体里的 `code`**');
    expect(out).toContain('<strong>');
    expect(out).toContain('<code>');
  });
});

describe('parseMarkdown - 块类型', () => {
  const cases: Array<[string, string]> = [
    ['# 标题', 'h1'],
    ['## 二级', 'h2'],
    ['### 三级', 'h3'],
    ['#### 四级', 'h3'], // 超过 3 级统一归 h3
    ['- 列表项', 'bullet'],
    ['* 也是列表', 'bullet'],
    ['+ 还是列表', 'bullet'],
    ['1. 有序', 'numbered'],
    ['> 引用', 'quote'],
    ['---', 'divider'],
    ['***', 'divider'],
    ['```js', 'codeblock'],
    ['普通段落', 'text'],
  ];
  for (const [md, type] of cases) {
    it(`${md} -> ${type}`, () => {
      expect(parseMarkdown(md).blocks[0].type).toBe(type);
    });
  }

  it('待办区分完成态', () => {
    const r = parseMarkdown('- [ ] 未完成\n- [x] 已完成');
    expect(r.blocks[0].type).toBe('todo');
    expect(r.blocks[0].completed).toBe(false);
    expect(r.blocks[1].completed).toBe(true);
  });

  it('代码块保留内容与语言', () => {
    const r = parseMarkdown('```javascript\nconst a = 1;\nconsole.log(a);\n```');
    expect(r.blocks[0].type).toBe('codeblock');
    expect(r.blocks[0].payload.code).toContain('const a = 1;');
    expect(r.blocks[0].payload.language).toBe('javascript');
  });

  it('未闭合围栏捕获到文件尾', () => {
    const r = parseMarkdown('```js\nconst a = 1;\nconst b = 2;');
    expect(r.blocks[0].type).toBe('codeblock');
    expect(r.blocks[0].payload.code).toContain('const b = 2;');
  });

  it('details 转为 toggle 且保留其后内容', () => {
    const r = parseMarkdown('<details>\n<summary>标题</summary>\n\n- 隐藏项\n\n</details>');
    expect(r.blocks[0].type).toBe('toggle');
    expect(r.blocks.some((b) => b.type === 'bullet')).toBe(true);
  });

  it('HTML 注释被丢弃', () => {
    const r = parseMarkdown('<!-- 注释 -->\n正文');
    expect(JSON.stringify(r.blocks)).not.toContain('注释');
    expect(r.blocks.some((b) => b.content.includes('正文'))).toBe(true);
  });

  it('图片行转为 image 块且标记待下载', () => {
    const r = parseMarkdown('![alt](image/a.png)');
    expect(r.blocks[0].type).toBe('image');
    expect(r.blocks[0].payload.url).toBe('image/a.png');
    expect(r.blocks[0].payload.pendingDownload).toBe(true);
  });

  it('data URL 图片不标记待下载', () => {
    const r = parseMarkdown('![a](data:image/png;base64,xxx)');
    expect(r.blocks[0].payload.pendingDownload).toBe(false);
  });
});

describe('parseMarkdown - 缩进', () => {
  it('2 空格三级嵌套', () => {
    const md = ['- 顶层 A', '  - 二级 A1', '    - 三级 A1a', '  - 二级 A2', '- 顶层 B'].join('\n');
    expect(parseMarkdown(md).blocks.map((b) => b.indentLevel)).toEqual([0, 1, 2, 1, 0]);
  });

  it('4 空格单位同样正确', () => {
    expect(parseMarkdown('- a\n    - b\n        - c').blocks.map((b) => b.indentLevel)).toEqual([0, 1, 2]);
  });

  it('tab 缩进折算为 4 空格', () => {
    expect(parseMarkdown('- a\n\t- b').blocks.map((b) => b.indentLevel)).toEqual([0, 1]);
  });

  it('混合块类型嵌套', () => {
    const md = ['- [ ] 父', '  - [x] 子', '  1. 编号', '> 引用', '  - 引用下'].join('\n');
    const r = parseMarkdown(md);
    expect(r.blocks.map((b) => b.indentLevel)).toEqual([0, 1, 1, 0, 1]);
    // 嵌套下完成态仍正确
    const todos = r.blocks.filter((b) => b.type === 'todo');
    expect(todos[0].completed).toBe(false);
    expect(todos[1].completed).toBe(true);
  });

  it('超深层级 clamp 到 5', () => {
    const md = Array.from({ length: 10 }, (_, i) => '  '.repeat(i) + '- item').join('\n');
    expect(Math.max(...parseMarkdown(md).blocks.map((b) => b.indentLevel ?? 0))).toBe(5);
  });

  it('缩进段不被合并进上一段', () => {
    const r = parseMarkdown('普通段\n  缩进段');
    expect(r.blocks.length).toBe(2);
    expect(r.blocks[0].indentLevel).toBe(0);
    expect(r.blocks[1].indentLevel).toBe(1);
  });

  it('代码块内部缩进不污染层级刻度', () => {
    const r = parseMarkdown('- 列表\n  ```js\n    const a = 1;\n  ```\n- 另一项');
    const code = r.blocks.find((b) => b.type === 'codeblock')!;
    expect(code.indentLevel).toBe(1);
    expect(code.payload.code).toContain('    const a = 1;');
    expect(r.blocks.filter((b) => b.type === 'bullet').map((b) => b.indentLevel)).toEqual([0, 0]);
  });
});

describe('parseMarkdown - 容错（内容绝不丢失）', () => {
  it('未知 HTML 标签内容保留', () => {
    const r = parseMarkdown('<custom-widget data-x="1">重要内容</custom-widget>');
    expect(JSON.stringify(r.blocks)).toContain('重要内容');
  });

  it('表格降级但内容保留', () => {
    const r = parseMarkdown('| 列A | 列B |\n| --- | --- |\n| 1 | 2 |');
    expect(JSON.stringify(r.blocks)).toContain('列A');
    expect(JSON.stringify(r.blocks)).toContain('1');
  });

  it('段内图片不丢失', () => {
    const r = parseMarkdown('段落里有 ![图](a.png) 图片');
    expect(JSON.stringify(r.blocks)).toContain('a.png');
  });

  it('空输入与纯空白返回空', () => {
    expect(parseMarkdown('').blocks.length).toBe(0);
    expect(parseMarkdown('\n\n   \n\t\n').blocks.length).toBe(0);
  });

  it('CRLF 与 BOM 正常处理', () => {
    expect(parseMarkdown('# 标题\r\n\r\n内容\r\n').blocks.length).toBe(2);
    expect(parseMarkdown('\uFEFF# 标题').blocks[0].type).toBe('h1');
  });

  it('多空行不产生空块', () => {
    const r = parseMarkdown('A\n\n\n\nB');
    expect(r.blocks.length).toBe(2);
    expect(r.blocks.every((b) => b.content !== '')).toBe(true);
  });
});
