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

import type { Page } from './useSync';
import { newBlockId, newPageId } from './ids';
import { saveImageAsset } from './assets';

export interface ZipImportResult {
  pages: Page[];
  /** 每个页面的导入摘要，用于给用户展示 */
  report: Array<{ title: string; blocks: number; images: number; downgraded: number }>;
  /** 下载失败的图片数（网络问题等），不影响其余内容导入 */
  imageFailures: number;
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

export const importZip = async (file: File): Promise<ZipImportResult | null> => {
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
  const report: ZipImportResult['report'] = [];
  let imageFailures = 0;

  // 先按路径深度排序，保证父页面先创建（parentId 引用时已存在）
  const sorted = [...mdByPath.values()].sort((a, b) => a.path.split('/').length - b.path.split('/').length);

  for (const entry of sorted) {
    const bytes = fileMap.get(entry.path);
    if (!bytes) continue;
    const md = decoder.decode(bytes);

    // 复用单文件导入的解析器
    const { parseMarkdown } = await import('./markdownImport');
    const { blocks, downgraded } = parseMarkdown(md);

    // 图片处理：包内相对路径与远程 URL 都转为**独立资产**，页面只留 asset: 引用。
    // （此前是转 Base64 内联进 payload.url，会让整页广播与存储配额暴涨。）
    let images = 0;
    for (const b of blocks) {
      if (b.type !== 'image') continue;
      const url = String(b.payload?.url ?? '').trim();
      if (!url || /^(data:|blob:|asset:)/.test(url)) { images++; continue; }

      let blob: Blob | null = null;
      if (/^https?:\/\//i.test(url)) {
        blob = await fetchAsBlob(url);
      } else {
        // 相对路径：按 md 所在目录解析（支持 ./ 与 ../）
        const clean = url.split(/[?#]/)[0];
        const abs = resolveRelative(entry.dir, clean);
        const hit = fileMap.get(abs);
        if (hit) {
          blob = new Blob([new Uint8Array(hit)], { type: mimeOf(abs) });
        } else {
          // 文件名兜底：有些导出不带目录前缀，直接按 basename 找
          const base = clean.slice(clean.lastIndexOf('/') + 1);
          const byBase = entries.find((p) => p.slice(p.lastIndexOf('/') + 1) === base && isImageName(p));
          if (byBase) blob = new Blob([new Uint8Array(fileMap.get(byBase)!)], { type: mimeOf(byBase) });
        }
      }

      if (blob) {
        const ref = await saveImageAsset(blob);
        // 必须显式清掉 pendingDownload：parseMarkdown 会预置该标记，
        // 只覆盖 url 会让它残留为 true，导致编辑器仍把它当作待下载的外链
        b.payload = { ...b.payload, url: ref, alt: b.payload?.alt ?? '', pendingDownload: false };
        images++;
      } else {
        // 下载/查找失败：保留原 URL 并标记，至少内容不丢
        b.payload = { ...b.payload, pendingDownload: true };
        imageFailures++;
      }
    }

    // 标题：优先取文件名；若正文首块是 h1 且更具体，用 h1
    const firstH1 = blocks.find((b) => b.type === 'h1');
    const fromName = entry.base.replace(/\.md$/i, '').trim();
    const title = fromName || (firstH1?.content.replace(/<[^>]+>/g, '') || '导入的文档');

    // 层级：所在目录的拥有者即父页面
    const parentPath = ownerMdOfDir(entry.dir, entry.path);
    const parentId = parentPath ? pageIdByPath.get(parentPath) ?? null : null;

    const id = newPageId();
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

    pages.push({
      id,
      title,
      tasks,
      parentId,
      isFavorite: false,
      isExpanded: true,
    });
    report.push({ title, blocks: blocks.length, images, downgraded });
  }

  return { pages, report, imageFailures };
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
