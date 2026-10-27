import type {Page, Task} from './useSync';

const ASSET_REF_RE = /asset:[0-9a-fA-F-]+/g;
/** 收集一批页面里仍在使用的所有 asset 引用（块 payload + 正文 <img> + 封面）。跳过墓碑块。 */
export const collectAssetRefs = (ps: Page[]): Set<string> => {
  const s = new Set<string>();
  for (const p of ps) {
    for (const t of p.tasks ?? []) {
      if (t.deletedAt) continue;
      const u = String(t.payload?.url ?? '');
      if (u.startsWith('asset:')) s.add(u);
      if (t.content) for (const m of t.content.match(ASSET_REF_RE) ?? []) s.add(m);
    }
    if (typeof p.cover === 'string' && p.cover.startsWith('asset:')) s.add(p.cover);
  }
  return s;
};

export interface ImportMergeResult {
  next: Page[];
  /** 导入页 id -> 最终保留下来的页面 id（覆盖时是旧页 id） */
  idRemap: Map<string, string>;
  overwritten: number;
  /** 因覆盖而被换掉、且全库都不再引用的旧图（供调用方回收） */
  replacedRefs: Set<string>;
}

/**
 * 块的内容指纹：类型 + 纯文本 + 图片/封面 URL + 代码块正文。
 * 代码块的 content 恒为空、正文在 payload.code —— 不算进去的话整页所有代码块 key 相同，
 * 「清理重复块」会把第一个之后的每一个不同代码块都当重复误杀（已发生的内容丢失事故），
 * 覆盖导入的块对齐也会把不同代码错配。用于「覆盖导入复用旧块 id」「去重」「误杀恢复」。
 */
export const blockContentKey = (t: Task): string =>
  `${t.type}|${String(t.content ?? '').replace(/<[^>]+>/g, '').trim()}|${String(t.payload?.url ?? '')}|${String(t.payload?.code ?? '')}`;

// 非加密 53-bit 哈希：同步、零依赖（浏览器/Node 皆可跑），用作文档指纹的紧凑键。
const cyrb53 = (str: string, seed = 0): string => {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
};

const normAssetRef = (s: string): string => (s || '').replace(ASSET_REF_RE, 'asset:#');
// 图片/资源引用归一化：asset:<uuid> 与「裸文件名/相对路径」（zip 原始引用，无 scheme）都视为同一资源。
// 只用于 payload.url（图片），绝不用于正文文字 —— 否则会把普通文本也吞成 asset:#。
const normImageRef = (s: string): string => {
  const v = s || '';
  if (/^asset:/i.test(v)) return 'asset:#';
  if (v && !/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return 'asset:#'; // 裸文件名/相对路径 → 与 asset 等价
  return v; // 保留外链（http/https）原样
};

/**
 * 文档级指纹：标题（去大小写/空白）+ 逐块内容（类型 + 去标签纯文本 + 图片URL，asset 引用归一化）+ 封面。
 * asset 引用归一化是关键：每次导入都会为新图片重新生成 asset:<uuid>，若把 id 算进指纹，
 * 同一份文档两次导入的指纹就不同 -> 去重失效、又造副本。归一化后「同一份文档、仅图片 id 不同」
 * 也能被判为同一份，反复导入同一 zip 不再翻倍。图片 url 用 normImageRef：裸文件名引用（zip 原始引用）
 * 也视作与 asset 等价，避免「同一张图、一份用 asset:、另一份用原始文件名」被判成不同文档。
 */
export const docFingerprint = (p: Page): string => {
  const title = (p.title || '').trim().toLowerCase();
  // 指纹只认「文字 + 资源 + 代码」，不认块类型：同一份文档在重导入/编辑后，
  // 小节标题可能从 text/todo 变成 toggle（可折叠），类型变了但内容一字不差，
  // 若把 type 算进指纹会把同一篇判成不同文档 → 反复导入又翻倍。整篇指纹是「全块集合」比对，
  // 去掉类型只会让真副本更容易判同，不会把两个内容不同的文档误判成同一篇。
  const content = (p.tasks ?? [])
    .map((t) => `${normAssetRef(String(t.content ?? '').replace(/<[^>]+>/g, ' ').trim().toLowerCase())}|${normImageRef(String(t.payload?.url ?? ''))}|${normAssetRef(String(t.payload?.code ?? ''))}`)
    .join('\n');
  const cover = typeof p.cover === 'string' ? normAssetRef(p.cover) : '';
  return cyrb53(`${title} ${content} ${cover}`);
};

// === 历史重复文档清理（反复导入同一批 ZIP 导致）===

/** 页面的「内容指纹」：去重后的唯一块集合（纯文本+图片URL+代码，不含块类型）。
 * 同一份文档被多次导入/编辑，副本间只会多出内容一致的块（或仅重复块数量不同）、图片 id 每轮重新生成、
 * 标题块大小写可能不同、重新导入还可能多塞空块 —— 这些都不该算「内容不同」；
 * 此外小节标题可能从 text/todo 变成 toggle（可折叠），类型变了但内容一字不差，也不该算不同。
 * 所以这里：asset 引用归一化、文字去标签+小写、空块（无文字无图无代码）忽略、块类型忽略，再取唯一集合。
 * 整篇指纹是「全块集合」比对，忽略类型只会让真副本更容易判同，不会把两个内容不同的文档误判成同一篇。 */
export const pageContentSig = (p: Page): string => {
  const keys = (p.tasks ?? [])
    .filter((t) => !t.deletedAt)
    .map((t): string | null => {
      const text = normAssetRef(String(t.content ?? '').replace(/<[^>]+>/g, ' ').trim().toLowerCase());
      const url = normImageRef(String(t.payload?.url ?? ''));
      const code = String(t.payload?.code ?? '');
      if (!text && !url && !code) return null; // 空块不计，避免重新导入多塞的空块干扰判定
      return `${text}|${url}|${code}`;
    })
    .filter((k): k is string => Boolean(k));
  return [...new Set(keys)].sort().join('\n');
};

const normTitleKey = (t?: string): string => (t ?? '').trim().toLowerCase();

// 坏图片引用：存活的图片块，其 url 既非 asset: 也非外链（http/https）—— 即 zip 原始文件名等裸引用，多半显示不出来
const brokenImgCount = (p: Page): number =>
  (p.tasks ?? []).filter((t) => {
    if (t.deletedAt || t.type !== 'image') return false;
    const u = String(t.payload?.url ?? '').trim();
    return u !== '' && !/^asset:/i.test(u) && !/^[a-z][a-z0-9+.-]*:\/\//i.test(u);
  }).length;

/**
 * 在「内容基本一致」的副本组里挑最优保留。
 * 优先级：① 健康度（墓碑更少、坏图片引用更少，再叠加封面+图标加分）→ 优先留干净、能正常显示的副本；
 *          ② 存活块更少（更干净，导入翻倍的份删掉）；③ 更新更晚。
 * 之前的「只看图标」会把「503 墓碑 + 6 张裸文件名废图」的膨胀副本留下、把干净版删掉，故改为健康度优先。
 */
export const pickBestPage = (group: Page[]): Page => {
  const health = (p: Page): number => {
    const tombs = (p.tasks ?? []).filter((t) => t.deletedAt).length;
    const present = (p.cover ? 2 : 0) + (p.icon ? 1 : 0);
    return tombs + brokenImgCount(p) * 5 - present; // 越小越「健康」越好
  };
  return [...group].sort((a, b) => {
    const h = health(a) - health(b);
    if (h !== 0) return h; // 健康度优先（墓碑少 / 图片规范 / 有封面图标）
    const ca = (a.tasks ?? []).filter((t) => !t.deletedAt).length;
    const cb = (b.tasks ?? []).filter((t) => !t.deletedAt).length;
    if (cb !== ca) return ca - cb; // 存活块更少（更干净）优先
    return (b.updatedAt ?? 0) - (a.updatedAt ?? 0); // 更新的优先
  })[0];
};

export interface PageDedupPlan {
  toDelete: string[]; // 应打墓碑删除的页面 id
  divergentGroups: string[]; // 标题相同但内容分歧、未自动删除的组标题
}

/** 规划重复文档合并：按标题分组，组内按内容指纹细分；内容基本一致的副本组只留最优一份（其余进 toDelete），
 * 标题相同但唯一块集合不同（真·内容不同）的只各留一份、绝不误删（进 divergentGroups 供人工核对）。 */
export const planDuplicatePages = (pages: Page[]): PageDedupPlan => {
  const byTitle = new Map<string, Page[]>();
  for (const p of pages) {
    if (p.deletedAt) continue;
    const k = normTitleKey(p.title);
    if (!k) continue;
    (byTitle.get(k) ?? byTitle.set(k, []).get(k)!).push(p);
  }
  const toDelete: string[] = [];
  const divergentGroups: string[] = [];
  for (const [title, group] of byTitle) {
    if (group.length < 2) continue;
    const bySig = new Map<string, Page[]>();
    for (const p of group) {
      const s = pageContentSig(p);
      (bySig.get(s) ?? bySig.set(s, []).get(s)!).push(p);
    }
    for (const [, sub] of bySig) {
      if (sub.length < 2) continue;
      const keep = pickBestPage(sub);
      for (const p of sub) if (p.id !== keep.id) toDelete.push(p.id);
    }
    if (bySig.size > 1) divergentGroups.push(title);
  }
  return { toDelete, divergentGroups };
};

// === 误杀块恢复 ===

/**
 * 规划「被清理重复块误杀的独有内容」的恢复。
 *
 * 事故背景：清理重复块曾用不含 payload.code 的块指纹，代码块 content 恒为空、
 * 整页所有代码块 key 相同 → 第一个之后每个不同代码块都被误标墓碑（另有独有图片同因被杀）。
 *
 * 判定标准：墓碑块按【修正后的】blockContentKey（含 code），在本页存活块中找不到同指纹者
 * => 它是独有内容，应复活（清 deletedAt）。同指纹的多个墓碑只复活最早一个，其余维持去重语义。
 * 只恢复有实际内容的块（正文/图片/代码非空），空块与分割线不值得恢复，避免添噪。
 */
export const planWronglyKilledBlocks = (pages: Page[]): { byPage: Map<string, string[]>; total: number } => {
  const byPage = new Map<string, string[]>();
  let total = 0;
  for (const p of pages) {
    if (p.deletedAt) continue;
    const tasks = p.tasks ?? [];
    const aliveKeys = new Set<string>();
    for (const t of tasks) if (!t.deletedAt) aliveKeys.add(blockContentKey(t));
    const restore: string[] = [];
    const restoredKeys = new Set<string>();
    for (const t of tasks) {
      if (!t.deletedAt) continue;
      // 有实际内容才值得恢复：正文 / 图片URL / 代码 至少一项非空
      const hasContent = Boolean(
        String(t.content ?? '').replace(/<[^>]+>/g, '').trim() ||
        String(t.payload?.url ?? '') ||
        String(t.payload?.code ?? ''),
      );
      if (!hasContent) continue;
      const k = blockContentKey(t);
      if (aliveKeys.has(k) || restoredKeys.has(k)) continue; // 有存活同内容块 / 已复活过同内容块
      restoredKeys.add(k);
      restore.push(t.id);
    }
    if (restore.length > 0) { byPage.set(p.id, restore); total += restore.length; }
  }
  return { byPage, total };
};

/**
 * 整页替换时，把导入块按内容指纹对齐到旧块：
 * - 能配对的沿用旧块 id → 同步语义上表现为「逐块更新」而非「删全部 + 增全部」。
 *   后者每次导入都会让服务端并集出一份新块，内容翻倍（用户实际踩到的 bug）。
 * - 配不上的导入块保留新 id（新增）。
 * - 旧块中没被配对的 → 打墓碑（deletedAt），随同步上推，服务端据此删除，不再并集成双份。
 */
const alignTasks = (oldTasks: Task[], newTasks: Task[]): Task[] => {
  const now = Date.now();
  const pool = new Map<string, Task[]>();
  for (const t of oldTasks) {
    if (t.deletedAt) continue;
    const k = blockContentKey(t);
    if (!pool.has(k)) pool.set(k, []);
    pool.get(k)!.push(t);
  }
  const live: Task[] = [];
  for (const nt of newTasks) {
    const bucket = pool.get(blockContentKey(nt));
    const reuse = bucket?.shift();
    const out: Task = { ...nt, updatedAt: now };
    if (reuse) out.id = reuse.id; // 沿用旧块 id：同步语义 = 逐块更新，而非删增
    live.push(out);
  }
  // 重建活块之间的 prevId 链（墓碑不参与）
  let prev: string | null = null;
  for (const t of live) { t.prevId = prev; prev = t.id; }
  const tombstones: Task[] = [];
  for (const bucket of pool.values()) for (const t of bucket) tombstones.push({ ...t, deletedAt: now, updatedAt: now });
  return [...live, ...tombstones];
};

/**
 * 「覆盖 / 文档去重」的合并逻辑（纯函数，便于单测）。
 *
 * 语义是**替换，不是追加**：匹配的页沿用旧页 id，tasks 整个换成导入的那份（按内容对齐复用旧块 id，
 * 旧块多余部分打墓碑）。沿用旧 id 才能保住旧页的子页面、页内链接、收藏状态。
 *
 * 匹配口径（按优先级）：
 *  1. 文档指纹（标题+内容，asset 引用归一化）—— 默认开启，是「反复导入同一批 zip 越导越重复」的根因修复：
 *     同一份文档（即便图片 id 不同）导入时直接覆盖，绝不建副本。
 *  2. 仅标题（title.trim().toLowerCase()）—— 仅当 opts.overwriteSameTitle 为真时启用，
 *     用于「同名但内容不同」的页也覆盖（重新导入修图场景）。
 * 两者都匹配不上的按新增追加。
 */
export const mergeImportOverwrite = (
  current: Page[],
  imported: Page[],
  opts?: { overwriteSameTitle?: boolean; fingerprintOverwrite?: boolean },
): ImportMergeResult => {
  const fpOverwrite = opts?.fingerprintOverwrite ?? true;
  const titleOverwrite = opts?.overwriteSameTitle ?? true; // 默认 true 以保持历史「标题即匹配」语义；commitImportPages 会按勾选显式传 false
  const byTitle = new Map<string, Page>();
  const byFp = new Map<string, Page>();
  for (const p of current) {
    if (p.deletedAt) continue;
    const t = (p.title || '').trim().toLowerCase();
    if (t && !byTitle.has(t)) byTitle.set(t, p);
    const f = docFingerprint(p);
    if (!byFp.has(f)) byFp.set(f, p);
  }
  const idRemap = new Map<string, string>();
  const merged = new Map<string, Page>(); // 现有页 id -> 导入页
  const replacedRefs = new Set<string>();
  const rest: Page[] = [];
  for (const p of imported) {
    const t = (p.title || '').trim().toLowerCase();
    const f = docFingerprint(p);
    // 指纹优先（标题+内容完全相同 = 同一份文档，默认去重）；其次才是仅标题匹配（需勾选覆盖）
    const target = (fpOverwrite ? byFp.get(f) : undefined) ?? (titleOverwrite ? byTitle.get(t) : undefined);
    if (target) {
      idRemap.set(p.id, target.id);
      merged.set(target.id, p);
      for (const r of collectAssetRefs([target])) replacedRefs.add(r);
    } else rest.push(p);
  }
  const next = current
    .map((x) => {
      const imp = merged.get(x.id);
      if (!imp) return x;
      // 关键：tasks 是**整个替换**（按内容对齐复用旧块 id，旧块多余部分打墓碑）
      return { ...x, tasks: alignTasks(x.tasks ?? [], imp.tasks ?? []), icon: imp.icon ?? x.icon, cover: imp.cover ?? x.cover, updatedAt: Date.now() };
    })
    .concat(rest);
  return { next, idRemap, overwritten: merged.size, replacedRefs };
};
