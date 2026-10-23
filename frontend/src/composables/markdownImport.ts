// Markdown → 块 的受限解析器（Notion 导出的 .md 是主要目标，但兼容常见 Markdown）。
//
// 为什么手写而不引 marked / markdown-it：
// 1) 我们只需要把已知的几种块结构映射成自己的 Task[]，不需要完整 CommonMark 兼容；
// 2) 手写能精确控制映射规则，不引入意外行为（自动链接、引用式链接、脚注等我们都用不到）；
// 3) 引入库会带来约 30KB gzip 的包体增量，而这个功能使用频率极低。
//
// 核心原则：**认不出的一律降级为 text 块并保留原文，绝不丢弃内容。**
// Notion 的 .md 会混有 HTML 片段（官方说明 Callout 因无 Markdown 等效语法而导出为 HTML），
// 且不同客户端/版本存在细节差异，解析器必须对这些形态宽松。

export interface ImportedBlock {
  type: string;
  content: string;      // 块内 HTML（行内格式已转换）
  completed?: boolean;
  indentLevel?: number;
  payload?: any;
}

export interface ImportResult {
  blocks: ImportedBlock[];
  /** 降级统计：无法识别而降级为 text 的行数，用于导入报告 */
  downgraded: number;
}

// ---------- 行内格式 ----------
// 注意顺序：code 必须最先处理，避免 ** 等被误转换进代码内容。
// 用占位符隔离已转换片段，防止嵌套误匹配（如 **粗体里的 `code`**）。
const INLINE_RULES: Array<[RegExp, string]> = [
  [/`([^`\n]+)`/g, 'code'],
  [/\*\*([^*\n]+)\*\*/g, 'strong'],
  [/__([^_\n]+)__/g, 'strong'],
  // em：要求开 * 前与闭 * 后都不是 *（避免吃到 ** 的残余）且不在单词内部
  [/(?<![\w*])\*([^*\n]+)\*(?![\w*])/g, 'em'],
  [/(?<![\w_])_([^_\n]+)_(?![\w_])/g, 'em'],
  [/~~([^~\n]+)~~/g, 'del'],
  [/==([^=\n]+)==/g, 'mark'],
];

const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

/** 把 Markdown 行内语法转成块内 HTML */
/**
 * 链接安全过滤：放行无协议的相对路径与 http/https/mailto，
 * 其余（javascript:、data:、vbscript:、file: …）一律降级为 `#`。
 *
 * 判定方式是「有协议就校验协议」，而不是「前缀白名单」——后者会误杀
 * Notion 导出的裸相对文件名链接（见下方 inlineToHtml 里的说明）。
 */
const isSafeHref = (href: string): boolean => {
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(href);
  if (!m) return true;                          // 无协议：相对路径 / 锚点
  return /^(https?|mailto):$/i.test(m[1]);
};

export const inlineToHtml = (text: string): string => {
  // 先转义，再把识别出的语法替换成标签，避免用户内容里的 < > 破坏结构
  let out = escapeHtml(text);
  const stash: string[] = [];
  const keep = (html: string) => {
    stash.push(html);
    return `\u0000${stash.length - 1}\u0000`;
  };

  // 链接优先于其它规则处理：必须先于 INLINE_RULES，
  // 否则 URL 里的 * _ ~ 会被误当行内格式（如 https://a.com/x_y_z）。
  // 负向回顾排除 `![...](...)`，避免把段内图片误判成链接。
  out = out.replace(/(?<!!)\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, label, href) => {
    // 安全过滤：挡掉 javascript: / data: / file: 等危险协议，其余一律保留。
    //
    // 为什么不再用「白名单前缀」：Notion 导出的**页内链接**是裸相对文件名
    // （`[Why We Can](Why%20We%20Can%201a2b…5o6p.md)`），既不以 / 也不以 ./ 开头，
    // 旧规则会把它们一律压成 href="#" —— 导入后整页链接全变成死链。
    // 这里放行后，ZIP 导入会在下一步把它解析成真正的页内链接（见 zipImport）。
    const safe = isSafeHref(href) ? href : '#';
    return keep(`<a href="${safe}" target="_blank" rel="noopener">${label}</a>`);
  });

  for (const [re, tag] of INLINE_RULES) {
    // tag=mark 需要带 style，其余直接包标签
    out = out.replace(re, (_m, inner) => {
      const html =
        tag === 'mark'
          ? `<mark style="background-color: rgb(var(--warn)); color: rgb(var(--onaccent));">${inner}</mark>`
          : `<${tag}>${inner}</${tag}>`;
      return keep(html);
    });
  }
  // 还原占位符（可能嵌套，故循环到没有占位符为止）
  let guard = 0;
  while (out.indexOf('\u0000') !== -1 && guard++ < 10) {
    out = out.replace(/\u0000(\d+)\u0000/g, (_m, i) => stash[Number(i)]);
  }
  return out;
};

// ---------- HTML 片段（Notion 的 callout 等） ----------
const stripTags = (html: string) => html.replace(/<[^>]+>/g, '');

// ---------- 缩进测量 ----------
// Markdown 用「前导空格数」表达列表层级。Notion 导出的 .md 同样遵循这一点：
// 每深一级约 2 或 4 空格（tab 常见于 Obsidian/VS Code 等编辑器，按 4 空格折算）。
//
// 难点：不同来源的每级宽度不一致（2/4/tab），无法预设固定值。
// 这里用「本文件实际观测到的缩进宽度」来归一化：
//   1) 先扫描全文，收集所有前导空白宽度；
//   2) 取最小非零宽度作为一个层级单位（2 或 4）；
//   3) 各行缩进 = round(宽度 / 单位)，再 clamp 到编辑器支持的 0~5 级。
// 这样无论源文件用 2 还是 4 空格，都能得到正确的层级。
const MAX_INDENT = 5;

const measureIndent = (line: string): number => {
  let width = 0;
  for (const ch of line) {
    if (ch === ' ') width += 1;
    else if (ch === '\t') width += 4;
    else break;
  }
  return width;
};

// 推断缩进「刻度」：收集文中实际出现过的所有前导宽度，升序排列。
//
// 为什么不做「取最小宽度当单位再相除」：
// 同一份文档混用两种单位时（如列表用 2 空格、编号用 4 空格），
// 除法会把 4 空格算成 2 级，层级就错了。
// 按「宽度在升序序列中的序号」映射深度则天然正确：
//   宽度 {0,2,4} -> 深度 {0,1,2}；宽度 {0,4,8} -> 深度 {0,1,2}；混用也一样。
//
// 采集范围：所有非空行（段落也要算，否则缩进段落会被判 0 级而与上一段合并），
// 但**围栏代码块内部一律跳过**——代码内容的缩进是语法的一部分，
// 若计入会污染刻度（如 `    const a = 1;` 会凭空多出宽度 4）。
const buildIndentScale = (lines: string[]): number[] => {
  const widths = new Set<number>([0]);
  let inFence = false;
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    const isFence = /^(`{3,}|~{3,})/.test(t);
    if (inFence) {
      if (isFence) inFence = false; // 闭合围栏，后续行重新纳入采集
      continue;
    }
    if (isFence) { inFence = true; widths.add(measureIndent(line)); continue; }
    widths.add(measureIndent(line));
  }
  return [...widths].sort((a, b) => a - b);
};

// 宽度 -> 深度：取它在刻度序列里的序号。找不到的宽度用插值（落在两个刻度之间时取较大的一级）
const toIndentLevel = (width: number, scale: number[]): number => {
  let depth = 0;
  for (let i = 0; i < scale.length; i++) {
    if (width >= scale[i]) depth = i;
    else break;
  }
  return Math.max(0, Math.min(MAX_INDENT, depth));
};

// ---------- 主解析 ----------
export const parseMarkdown = (md: string): ImportResult => {
  const lines = md.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const blocks: ImportedBlock[] = [];
  let downgraded = 0;
  const indentScale = buildIndentScale(lines);

  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trimEnd();
    const t = line.trim();

    // 空行：块分隔
    if (t === '') { i++; continue; }

    // 本行的缩进层级。
    // 代码块不需要特殊处理：围栏**内容**在下面的循环里原样收集，
    // 不会走到这里测量；参与测量的只有围栏标记行，它的缩进正是代码块自身的位置。
    const indent = toIndentLevel(measureIndent(line), indentScale);

    // 围栏代码块：收集到闭合或文件尾
    const fence = /^(`{3,}|~{3,})\s*([\w+-]*)\s*$/.exec(t);
    if (fence) {
      const marker = fence[1][0].repeat(3);
      const lang = fence[2] || 'javascript';
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(marker)) { body.push(lines[i]); i++; }
      i++; // 跳过闭合围栏
      blocks.push({
        type: 'codeblock',
        content: '',
        indentLevel: indent,
        payload: { language: normalizeLang(lang), code: body.join('\n') },
      });
      continue;
    }

    // <details> 折叠块（Notion 的 toggle 很可能用这个）
    if (/^<details\b/i.test(t)) {
      const collected: string[] = [];
      let depth = 0;
      let summary = '';
      while (i < lines.length) {
        const cur = lines[i];
        collected.push(cur);
        if (/<details\b/i.test(cur)) depth++;
        if (/<\/details>/i.test(cur)) depth--;
        const sm = /<summary[^>]*>([\s\S]*?)<\/summary>/i.exec(cur);
        if (sm && !summary) summary = stripTags(sm[1]).trim();
        i++;
        if (depth <= 0) break;
      }
      const inner = collected.join('\n').replace(/<\/?details[^>]*>/gi, '').replace(/<summary[\s\S]*?<\/summary>/gi, '');
      const sub = parseMarkdown(inner);
      blocks.push({ type: 'toggle', content: inlineToHtml(summary || '折叠内容'), indentLevel: indent, payload: { collapsed: false } });
      // 子块继承 details 的缩进，避免展开后层级错乱
      for (const sb of sub.blocks) sb.indentLevel = (sb.indentLevel ?? 0) + indent;
      blocks.push(...sub.blocks);
      downgraded += sub.downgraded;
      continue;
    }

    // 分割线
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) { blocks.push({ type: 'divider', content: '', indentLevel: indent }); i++; continue; }

    // 标题
    const h = /^(#{1,6})\s+(.*)$/.exec(t);
    if (h) {
      const level = Math.min(h[1].length, 3);
      blocks.push({ type: `h${level}`, content: inlineToHtml(h[2].trim()), indentLevel: indent });
      i++;
      continue;
    }

    // 待办 - [ ] / - [x]
    const todo = /^[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(t);
    if (todo) {
      blocks.push({ type: 'todo', content: inlineToHtml(todo[2].trim()), completed: todo[1].toLowerCase() === 'x', indentLevel: indent });
      i++;
      continue;
    }

    // 无序列表
    if (/^[-*+]\s+/.test(t)) {
      const item = t.replace(/^[-*+]\s+/, '');
      blocks.push({ type: 'bullet', content: inlineToHtml(item), indentLevel: indent });
      i++;
      continue;
    }

    // 有序列表
    const ol = /^\d+[.)]\s+(.*)$/.exec(t);
    if (ol) {
      blocks.push({ type: 'numbered', content: inlineToHtml(ol[1].trim()), indentLevel: indent });
      i++;
      continue;
    }

    // 引用块
    if (/^>\s?/.test(t)) {
      const item = t.replace(/^>\s?/, '');
      // 空引用行是段落分隔，跳过
      if (item === '') { i++; continue; }
      blocks.push({ type: 'quote', content: inlineToHtml(item), indentLevel: indent });
      i++;
      continue;
    }

    // HTML 注释：静默丢弃
    if (/^<!--[\s\S]*?-->$/.test(t)) { i++; continue; }

    // Notion 的 callout 导出为 HTML 片段（官方口径）。尽力提取可读文本降级为 callout，
    // 保留内容优先于完美还原。
    if (/^<(figure|aside|div|blockquote|table)\b/i.test(t)) {
      const collected: string[] = [];
      const openTag = (s: string) => {
        const m = /^<([a-zA-Z][\w-]*)/.exec(s.trim());
        if (!m) return null;
        return m[1].toLowerCase();
      };
      const tag = openTag(t);
      const closeRe = new RegExp(`</${tag}\\s*>`, 'i');
      let depth = 0;
      while (i < lines.length) {
        const cur = lines[i];
        collected.push(cur);
        if (new RegExp(`<${tag}\\b`, 'i').test(cur)) depth++;
        if (closeRe.test(cur)) depth--;
        i++;
        if (depth <= 0) break;
      }
      const html = collected.join('\n');
      const text = stripTags(html).replace(/\s+/g, ' ').trim();
      if (text) blocks.push({ type: 'callout', content: escapeHtml(text), indentLevel: indent, payload: { icon: '💡' } });
      continue;
    }

    // 图片行（单独一行时成为图片块）
    const img = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(t);
    if (img) {
      blocks.push({
        type: 'image',
        content: '',
        indentLevel: indent,
        payload: { url: img[2].trim(), alt: img[1], pendingDownload: !/^(data:|blob:)/.test(img[2].trim()) },
      });
      i++;
      continue;
    }

    // HTML <img>（Notion 有时直接嵌标签）
    if (/^<img\b/i.test(t)) {
      const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(t);
      if (src) {
        blocks.push({
          type: 'image',
          content: '',
          indentLevel: indent,
          payload: { url: src[1], alt: '', pendingDownload: !/^(data:|blob:)/.test(src[1]) },
        });
        i++;
        continue;
      }
    }

    // 链接行：保留为 text（内联已转换），不在块级特殊处理
    // 其余一律作为普通段落。连续的非空行合并为一个段落块，
    // 因为 Markdown 的软换行属于同一段。
    const para: string[] = [t];
    i++;
    while (i < lines.length) {
      const nextLine = lines[i];
      const next = nextLine.trim();
      if (next === '') break;
      // 遇到块级语法则停止合并
      if (
        /^(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|```|~~~|<details\b|<img\b|!\[)/.test(next) ||
        /^(-{3,}|\*{3,}|_{3,})$/.test(next)
      ) break;
      // 缩进变化也要断开：不同层级的续行属于不同块，
      // 否则「普通段 + 缩进段」会被合并成一块，缩进就看不见了
      if (toIndentLevel(measureIndent(nextLine), indentScale) !== indent) break;
      para.push(next);
      i++;
    }
    // 段内软换行转 <br>，符合 Markdown 语义
    blocks.push({ type: 'text', content: para.map(inlineToHtml).join('<br>'), indentLevel: indent });
  }

  return { blocks, downgraded };
};

const normalizeLang = (lang: string): string => {
  const l = lang.toLowerCase();
  if (['js', 'javascript', 'ts', 'typescript', 'jsx', 'tsx'].includes(l)) return 'javascript';
  if (['py', 'python'].includes(l)) return 'python';
  if (['vue', 'html', 'xml', 'svg'].includes(l)) return 'vue';
  if (['rs', 'rust'].includes(l)) return 'rust';
  return 'javascript';
};
