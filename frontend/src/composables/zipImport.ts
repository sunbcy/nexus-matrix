// Notion 导出 ZIP 的导入。
//
// 核心认识：ZIP 里装的本来就是 .md 文件，所以这里不重复造解析器，
// 而是给 parseMarkdown 补上它自己拿不到的三样东西：
//   1) ZIP 解压（fflate，动态 import 按需加载，不导入的人不付包体代价）
//   2) 图片资产：md 里写的是包内相对路径（![alt](image/image-1.png)），
//      必须从 ZIP 里取出对应文件转 Base64，否则又是破图
//   3) 页面层级：Notion 用「文件夹套 .md」表达父子关系，需推断 parentId
//
// 另外要处理 Notion 的图片第二种形态：S3 预签名外链（带 X-Amz-Signature），
// 签名过期后会 403。这里同样在导入时立即下载转 Base64，不留外链。

import type {ImportAssetIssue, Page} from './useSync';
import {newBlockId, newPageId} from './ids';
import {clearAssetMissing, getAsset, type ImageSaveOptions, saveImageAssetWithBlob, verifyAssetOrRetry} from './assets';

/**
 * 导入选项。
 * imageMode='original' 时图片原样落库（不缩放、不重编码）——ZIP 里本来就是
 * 用户自己的文件，很多场景（扫描书页、带小字的截图）要的就是原图，
 * 默认压缩会把 3072×4096 缩到 900×1200 再压成 JPEG 0.82，图就不是原来那张了。
 */
export interface ZipImportOptions {
  imageMode?: 'original' | 'compressed';
}
const saveOptsOf = (opts?: ZipImportOptions): ImageSaveOptions =>
  (opts?.imageMode === 'original' ? { original: true } : {});

/** 导入后落库复核的结果 */
export interface AssetCheckReport {
  /** 引用已写进页面、但本地 store 里读不回来的（刷新后必破图）——「第 N 张没存上」 */
  missing: ImportAssetIssue[];
  /** 本次后台补下载并成功落库的张数 */
  recovered: number;
  /** 仍未落库、暂留原链接的张数（远程外链为主，网络恢复后可再试） */
  pending: number;
}

export interface ZipImportResult {
  pages: Page[];
  /** 每个页面的导入摘要，用于给用户展示 */
  report: Array<{ title: string; blocks: number; images: number; downgraded: number }>;
  /** 下载失败的图片数（网络问题等），不影响其余内容导入 */
  imageFailures: number;
  /** 落库校验失败的图片数（写进本地 store 后读不回） */
  imageVerifyFailures: number;
  /** 具体哪些没存上（含定位用的 pageId/taskId），用于明确提示与一键跳转 */
  verifyFailures: ImportAssetIssue[];
}

const decoder = new TextDecoder();

// 图片 MIME：ZIP 里没有扩展名之外的元信息，按扩展名推断
const mimeOf = (name: string): string => {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
    avif: 'image/avif',
  };
  return map[ext] ?? 'application/octet-stream';
};

const isImageName = (name: string) => /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(name);

// ZIP 里存的是真实文件名，而 md 正文里的引用常是百分号编码（Notion 导出一贯如此：
// 代码里页链接用的 linkKey() 早就解码了，图片这条路径此前没解）。
// 不解码的话，中文标题页面（如「一些很棒的书」）的图片几乎必然 miss ——
// 完整路径匹配不上，basename 兜底也匹配不上，最后只剩一张破图。
const safeDecode = (s: string): string => {
  try { return decodeURIComponent(s); } catch { return s; } // 非法百分号序列：原样返回
};

// Notion 导出的 .md 文件名末尾会追加一个内部页面 id（如「会议记录 1a2b…5o6p.md」）。
// 它是 Notion 的标识、不属于标题，导入时必须去掉才能还原原标题。
// 形制：空格或下划线 + 32 位十六进制（少数导出为带连字符的 UUID 形式）。
const NOTION_ID_SUFFIX =
  /[\s_]+(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s*$/i;

// 去掉标题尾部的 Notion id。边界：若整串只剩 id（标题本身就是 id），保持原样不做清空。
export const stripNotionId = (s: string): string => {
  const src = s ?? '';
  const m = NOTION_ID_SUFFIX.exec(src);
  if (!m) return src.trim();
  const head = src.slice(0, m.index).trim();
  return head || src.trim();
};

// 是否还残留 Notion id（用于历史数据的批量体检与清理）
export const hasNotionIdSuffix = (s: string): boolean => stripNotionId(s ?? '') !== (s ?? '').trim();

// 远程图片下载为 Blob（S3 预签名等）。失败返回 null，由调用方降级保留原 URL。
const fetchAsBlob = async (url: string): Promise<Blob | null> => {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.blob();
  } catch {
    return null;
  }
};

// 去掉导出时常见的顶层包裹目录（Notion 有时会把所有内容放在一个同名文件夹下）
const stripRootDir = (paths: string[]): string[] => {
  const dirs = paths.filter((p) => p.includes('/'));
  if (dirs.length === 0) return paths;
  const firsts = new Set(dirs.map((p) => p.slice(0, p.indexOf('/'))));
  if (firsts.size !== 1) return paths;
  const root = [...firsts][0] + '/';
  return paths.map((p) => (p.startsWith(root) ? p.slice(root.length) : p));
};

export const importZip = async (file: File, opts?: ZipImportOptions): Promise<ZipImportResult | null> => {
  const saveOpts = saveOptsOf(opts);
  // 动态 import：fflate 约 8KB gzip，但 ZIP 导入是低频操作
  const { unzipSync } = await import('fflate');

  const buf = new Uint8Array(await file.arrayBuffer());
  const raw = unzipSync(buf);

  // 归一化路径：去掉顶层包裹目录，过滤掉 __MACOSX 等系统垃圾。
  // 注意：raw 的键是 ZIP 内的原始路径，而 stripRootDir 会改写路径，
  // 因此必须维护「剥离后路径 -> 原始路径」的平行映射，否则 fileMap 全取到 undefined。
  const originalPaths = Object.keys(raw)
    .filter((p) => !p.endsWith('/'))
    .filter((p) => !p.startsWith('__MACOSX') && !p.includes('/__MACOSX'))
    .filter((p) => !/(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/i.test(p));
  const entries = stripRootDir(originalPaths);

  // 剥离后路径 -> 文件字节
  const fileMap = new Map<string, Uint8Array>();
  originalPaths.forEach((orig, i) => fileMap.set(entries[i], raw[orig]));

  // 图片 basename -> 包内路径。目录前缀靠不住（有的导出带、有的不带），
  // 所以除了按完整路径找，还要能只凭文件名兜底命中。
  const imageByName = new Map<string, string>();
  for (const p of entries) {
    if (!isImageName(p)) continue;
    const k = safeDecode(p.slice(p.lastIndexOf('/') + 1)).toLowerCase();
    if (!imageByName.has(k)) imageByName.set(k, p);
  }

  const mdPaths = entries.filter((p) => /\.md$/i.test(p));

  // 建索引：md 路径 -> 页面试图，用于后续把子页面链接解析成 parentId
  const mdByPath = new Map<string, { path: string; dir: string; base: string }>();
  for (const p of mdPaths) {
    const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
    mdByPath.set(p, { path: p, dir, base: p.slice(p.lastIndexOf('/') + 1) });
  }

  // 目录 -> 该目录的「拥有者」.md（作为目录的父页面）。
  // 从 dir 的父目录开始向上找，有两个原因：
  //   1) 若从 dir 本身找起，会把页面自己（位于该目录内的 .md）当成父级，形成自引用；
  //   2) Notion 的「Create folders for subpages」结构下，Subpage A/Subpage A.md 的父级
  //      是根目录的 Main Page.md，必须向上走一级才找得到。
  const ownerMdOfDir = (dir: string, selfPath: string): string | null => {
    let cur = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '';
    for (;;) {
      const hit = [...mdByPath.values()].find((m) => m.dir === cur && m.path !== selfPath);
      if (hit) return hit.path;
      if (!cur) return null;
      cur = cur.includes('/') ? cur.slice(0, cur.lastIndexOf('/')) : '';
    }
  };

  const pages: Page[] = [];
  const pageIdByPath = new Map<string, string>();
  const srcById = new Map<string, string>(); // 页面 id -> 其来源 md 路径，供页间链接按源目录归一化
  const report: ZipImportResult['report'] = [];
  let imageFailures = 0;
  const verifyFailures: ImportAssetIssue[] = [];
  // asset 引用 -> 真正落库的那份 Blob。终检发现「引用在、blob 不在」时，
  // 靠它就地把图补回去，而不是只能报一句没存上。导入结束即释放。
  const blobByRef = new Map<string, Blob>();

  // 先按路径深度排序，保证父页面先创建（parentId 引用时已存在）
  const sorted = [...mdByPath.values()].sort((a, b) => a.path.split('/').length - b.path.split('/').length);

  for (const entry of sorted) {
    const bytes = fileMap.get(entry.path);
    if (!bytes) continue;
    const md = decoder.decode(bytes);

    // 解析 frontmatter（nexus 导出用 --- 包裹的 icon/cover），余下正文再交给解析器。
    // 无 frontmatter 时（Notion 导出等）原样透传，不影响既有逻辑。
    let body = md;
    let fmIcon: string | undefined;
    let fmCover: string | undefined;
    const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md);
    if (fmMatch) {
      body = md.slice(fmMatch[0].length);
      for (const line of fmMatch[1].split('\n')) {
        const mm = /^([A-Za-z_-]+)\s*:\s*(.*)$/.exec(line.trim());
        if (!mm) continue;
        const k = mm[1].toLowerCase();
        const v = mm[2].trim().replace(/^["']|["']$/g, '');
        if (k === 'icon') fmIcon = v || undefined;
        else if (k === 'cover') fmCover = v || undefined;
      }
    }

    // 复用单文件导入的解析器
    const { parseMarkdown } = await import('./markdownImport');
    const { blocks, downgraded } = parseMarkdown(body);

    // 标题（下面的图片失败提示也要用到，故先算）：优先取文件名（已解码 %20 等）；正文首块 h1 兜底
    const firstH1 = blocks.find((b) => b.type === 'h1');
    const fromName = stripNotionId(safeDecode(entry.base).replace(/\.md$/i, ''));
    const title = fromName || (stripNotionId(firstH1?.content.replace(/<[^>]+>/g, '') || '') || '导入的文档');

    // 页面 id 提前生成：图片失败明细要记 pageId，供结果面板「跳到那一块」
    const id = newPageId();
    srcById.set(id, entry.path);

    // 图片处理：包内相对路径与远程 URL 都转为**独立资产**，页面只留 asset: 引用。
    // （此前是转 Base64 内联进 payload.url，会让整页广播与存储配额暴涨。）
    let images = 0;
    for (let bi = 0; bi < blocks.length; bi++) {
      const b = blocks[bi];
      if (b.type !== 'image') continue;
      const url = String(b.payload?.url ?? '').trim();
      if (!url || /^(data:|blob:|asset:)/.test(url)) { images++; continue; }

      let blob: Blob | null = null;
      if (/^https?:\/\//i.test(url)) {
        blob = await fetchAsBlob(url);
      } else {
        // 相对路径：按 md 所在目录解析（支持 ./ 与 ../）。
        // md 里的引用可能是百分号编码的，而 ZIP 条目是真实字符，故两种写法都要试。
        const clean = url.split(/[?#]/)[0];
        const decoded = safeDecode(clean);
        const candidates = [
          resolveRelative(entry.dir, clean),
          resolveRelative(entry.dir, decoded),
          clean,
          decoded,
        ];
        let hitPath: string | undefined;
        for (const c of candidates) {
          if (fileMap.has(c)) { hitPath = c; break; }
        }
        if (hitPath) {
          blob = new Blob([new Uint8Array(fileMap.get(hitPath)!)], { type: mimeOf(hitPath) });
        } else {
          // 文件名兜底：有些导出不带目录前缀，直接按 basename 找（同样要解码后比对）
          const base = safeDecode(clean.slice(clean.lastIndexOf('/') + 1)).toLowerCase();
          const byBase = imageByName.get(base);
          if (byBase) blob = new Blob([new Uint8Array(fileMap.get(byBase)!)], { type: mimeOf(byBase) });
        }
      }

      if (blob) {
        try {
          // saveImageAssetWithBlob 内部已「写入→读回校验→同 id 重试」，真正没落库会抛错
          const { ref, blob: stored } = await saveImageAssetWithBlob(blob, saveOpts);
          blobByRef.set(ref, stored);
          // 必须显式清掉 pendingDownload：parseMarkdown 会预置该标记，
          // 只覆盖 url 会让它残留为 true，导致编辑器仍把它当作待下载的外链
          b.payload = { ...b.payload, url: ref, alt: b.payload?.alt ?? '', pendingDownload: false };
          images++;
        } catch {
          // 落库校验失败：保留原 URL + 标记待下载（内容不丢），并记录以便明确提示「第 N 张没存上」
          b.payload = { ...b.payload, pendingDownload: true };
          imageFailures++;
          verifyFailures.push({ title, block: bi + 1, pageId: id, taskId: '' });
        }
      } else {
        // 下载/查找失败：保留原 URL 并标记，至少内容不丢
        b.payload = { ...b.payload, pendingDownload: true };
        imageFailures++;
      }
    }

    // 层级：所在目录的拥有者即父页面
    const parentPath = ownerMdOfDir(entry.dir, entry.path);
    const parentId = parentPath ? pageIdByPath.get(parentPath) ?? null : null;

    pageIdByPath.set(entry.path, id);

    const tasks = blocks.map((b) => ({
      id: newBlockId(),
      type: b.type,
      content: b.content,
      completed: b.completed ?? false,
      indentLevel: b.indentLevel ?? 0,
      prevId: null as string | null,
      payload: b.payload,
    }));
    tasks.forEach((t, i) => { t.prevId = i === 0 ? null : tasks[i - 1].id; });

    // 块 id 是建 tasks 时才生成的，这里回填到失败明细上（blocks 与 tasks 一一对应、同序）
    for (const f of verifyFailures) {
      if (f.pageId === id && !f.taskId) f.taskId = tasks[f.block - 1]?.id ?? '';
    }

    // 封面：若是图片路径（nexus 导出，形如 images/xxx.png）则按块图片同样落库；
    // 否则（渐变键等）原样保留。图标直接保留。
    let coverVal: string | undefined = fmCover;
    if (fmCover && (/images\//i.test(fmCover) || isImageName(fmCover))) {
      const clean = fmCover.split(/[?#]/)[0];
      const decoded = safeDecode(clean);
      let hit: string | undefined = fileMap.has(clean) ? clean : (fileMap.has(decoded) ? decoded : undefined);
      if (!hit) { const b = safeDecode(clean.slice(clean.lastIndexOf('/') + 1)).toLowerCase(); hit = imageByName.get(b); }
      if (hit) {
        const cblob = new Blob([new Uint8Array(fileMap.get(hit)!)], { type: mimeOf(hit) });
        try { const { ref, blob: stored } = await saveImageAssetWithBlob(cblob, saveOpts); blobByRef.set(ref, stored); coverVal = ref; } catch { /* 落库失败保留原值 */ }
      }
    }

    pages.push({
      id,
      title,
      tasks,
      parentId,
      icon: fmIcon,
      cover: coverVal,
      isFavorite: false,
      isExpanded: true,
    });
    report.push({ title, blocks: blocks.length, images, downgraded });
  }

  // 第二步：把 md 里的「指向另一个导出页面的相对链接」解析成页内链接。
  // Notion 导出时，A 页面里指向 B 页面的链接写作 [标题](相对路径/B%20标题%20<32位id>.md)。
  // 直接留着就是一个永远打不开的 .md 文件路径；解析成 data-page-id 后
  // 点击即在应用内跳转到导入后的 B 页面（与 [[ 插入的页内链接同款）。
  resolveImportedPageLinks(pages, pageIdByPath, srcById);

  // 落库终检：对每个 asset: 引用读回校验，捕捉「保存时成功、之后又丢」的罕见情况。
  // 与保存时的重试不同，这里手里还有原始 blob —— 读不回先就地补写（verifyAssetOrRetry），
  // 补回来就从失败列表里撤掉，补不回才记录「第 N 张没存上」。绝不静默留下死引用。
  for (const p of pages) {
    const tasks = p.tasks ?? [];
    for (let ti = 0; ti < tasks.length; ti++) {
      const t = tasks[ti];
      const refs: string[] = [];
      if (t.type === 'image' && typeof t.payload?.url === 'string' && t.payload.url.startsWith('asset:')) refs.push(t.payload.url);
      if (t.content) { const m = t.content.match(/asset:[0-9a-fA-F-]+/g); if (m) refs.push(...m); }
      for (const ref of [...new Set(refs)]) {
        if (await getAsset(ref)) { clearAssetMissing(ref); continue; }
        const blob = blobByRef.get(ref);
        if (blob && (await verifyAssetOrRetry(ref, blob))) { clearAssetMissing(ref); continue; }
        verifyFailures.push({ title: p.title, block: ti + 1, pageId: p.id, taskId: t.id });
      }
    }
  }

  blobByRef.clear(); // 归还内存：解析阶段结束了，blob 不必再留着

  return { pages, report, imageFailures, imageVerifyFailures: verifyFailures.length, verifyFailures };
};

/**
 * 提交后的落库复核（「确保不缺」的最后一道闸）。
 *
 * 与 importZip 结尾的终检分工不同：那时手里还有 ZIP 里的原始字节，能就地补写；
 * 提交时原文件早已释放，所以这里做两件仍做得到的事：
 *   1) 复验所有 asset: 引用是否真的还在本地 store —— 不在的就是「第 N 张没存上」，如实报出来；
 *   2) 对仍挂着 pendingDownload 的**远程外链**，后台再下一次并落库（网络抖动是最常见的可恢复原因）。
 *      相对路径的图在 ZIP 释放后已无从下载，不计入可恢复，只算 pending。
 *
 * 会**就地修改**传入的页面块（补成功的图会把 url 换成 asset: 并清掉 pendingDownload），
 * 调用方需要在之后触发一次落盘。
 */
export const verifyImportedAssets = async (pages: Page[], opts?: ZipImportOptions): Promise<AssetCheckReport> => {
  const missing: ImportAssetIssue[] = [];
  let recovered = 0;
  let pending = 0;

  for (const p of pages) {
    const tasks = p.tasks ?? [];
    for (let ti = 0; ti < tasks.length; ti++) {
      const t = tasks[ti];
      if (t.type !== 'image') continue;
      const url = String(t.payload?.url ?? '').trim();
      if (!url) continue;

      if (url.startsWith('asset:')) {
        if (!(await getAsset(url))) missing.push({ title: p.title, block: ti + 1, pageId: p.id, taskId: t.id });
        continue;
      }
      if (!t.payload?.pendingDownload) continue;

      let fixed = false;
      if (/^https?:\/\//i.test(url)) {
        const blob = await fetchAsBlob(url);
        if (blob) {
          try {
            const { ref } = await saveImageAssetWithBlob(blob, saveOptsOf(opts));
            t.payload = { ...t.payload, url: ref, pendingDownload: false };
            recovered++;
            fixed = true;
          } catch { /* 存不进去：按未恢复处理，保留原外链 */ }
        }
      }
      if (!fixed) pending++;
    }
  }

  return { missing, recovered, pending };
};

/**
 * 把导入页面正文里指向「同批导入页面」的 md 链接改写成页内链接。
 *
 * 匹配用归一化键：URL 解码 → 去 .md → 去尾部 Notion id。
 * 同时按「完整路径」与「basename」两种键查表：Notion 的链接有时带目录前缀，
 * 有时不带（取决于导出设置），只认一种会漏。
 */
const linkKey = (raw: string): string => {
  let s = raw.trim().replace(/^["']|["']$/g, '');
  try { s = decodeURIComponent(s); } catch { /* 非合法百分号编码时保持原样 */ }
  s = s.replace(/\.md$/i, '').replace(/^\.\//, '').replace(/^\//, '');
  return stripNotionId(s).toLowerCase();
};

const resolveImportedPageLinks = (pages: Page[], pageIdByPath: Map<string, string>, srcById: Map<string, string>) => {
  // 路径键 -> 页面 id（完整路径 + basename 都能命中）
  const byKey = new Map<string, string>();
  for (const [path, id] of pageIdByPath) {
    byKey.set(linkKey(path), id);
    const base = path.slice(path.lastIndexOf('/') + 1);
    if (!byKey.has(linkKey(base))) byKey.set(linkKey(base), id);
  }
  if (byKey.size === 0) return;

  // 每页的源目录，用于把 ../ 相对链接归一成 zip 内绝对路径再匹配（支持跨层级页间链接）
  const srcDirOf = (id: string): string => {
    const p = srcById.get(id);
    return p && p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
  };
  const re = /<a\s+[^>]*href="([^"]+)"[^>]*>/gi;
  for (const p of pages) {
    for (const t of p.tasks ?? []) {
      if (!t.content || !t.content.includes('<a ')) continue;
      let changed = false;
      const next = t.content.replace(re, (tag, href: string) => {
        // 只处理指向 .md 的相对链接；外链保持原样（点击走新标签打开）
        if (/^(https?:|mailto:)/i.test(href) || !/\.md($|[?#])/i.test(href)) return tag;
        const cleanHref = href.split(/[?#]/)[0];
        const abs = resolveRelative(srcDirOf(p.id), cleanHref); // 归一为 zip 内绝对路径
        const targetId =
          byKey.get(linkKey(abs)) ??
          byKey.get(linkKey(cleanHref)) ??
          byKey.get(linkKey(cleanHref.slice(cleanHref.lastIndexOf('/') + 1)));
        if (!targetId || targetId === p.id) return tag;
        changed = true;
        const label = />([^<]*)<\/a>/i.exec(tag)?.[1] ?? '';
        return `<a data-page-id="${targetId}" href="#${targetId}">${label}</a>`;
      });
      if (changed) t.content = next;
    }
  }
};

// 解析相对路径：把 ./ 与 ../ 归一到 ZIP 内的绝对路径
const resolveRelative = (dir: string, rel: string): string => {
  const parts = dir ? dir.split('/') : [];
  for (const seg of rel.split('/')) {
    if (seg === '.' || seg === '') continue;
    if (seg === '..') { parts.pop(); continue; }
    parts.push(seg);
  }
  return parts.join('/');
};
