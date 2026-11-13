/**
 * P2 Phase A：主编辑器 ↔ Yjs 的「影子双写」通道（默认关闭、可一键回退）。
 *
 * 为什么不直接把试点编辑器搬进主编辑器：
 *   现有 Yjs 试点是 `Y.XmlFragment('doc')` + Tiptap/ProseMirror，而主编辑器的块正文是
 *   非受控 contenteditable 的 **HTML 字符串**（内含 `<a data-page-id>`、`<span style>`、
 *   `asset:<id>` 图片引用）。Y.Text 按字符合并会把标签/属性截断，整段 innerHTML 覆盖又
 *   会退化成「删全部 + 插全文」，反而破坏数据并打断 IME。报告见 PHASE5_PAGES_RETIRE.md。
 *
 * 因此双写过渡分两步：
 *   Phase A（本文件）：写 legacy `pages` 的同时，额外写一份按 block.id 索引的 Y.Map 影子；
 *     **影子只读观测，绝不回写 task.content**，编辑结果与关闭时完全一致。
 *     目的：把 `Page/Task ↔ Yjs` 的映射、挂/卸生命周期、多端连通与并发冲突观测先跑通。
 *   Phase B：把结构化 CRDT（Y.XmlFragment/ProseMirror）的收敛结果切流为主数据源，
 *     届时才能真正解决「同块并发后写覆盖丢字」。
 *
 * 开关（默认关闭，关闭时连 yjs 运行时都不加载）：
 *   ?yjsDualWrite=1 开启 / =0 关闭，值会写入 localStorage，刷新后保持；
 *   也可直接改 localStorage 的 nexus_yjs_dual_write。
 *   出问题时把开关置 0 并刷新即完整回退，不留任何后台连接或后台写入。
 */
import { ref } from 'vue';
import type { YjsDocHandle } from './yjsDoc';   // type-only：关闭时不产生运行时依赖
import type { Task } from './useSync';           // type-only：不与同步层形成循环引用

const FLAG_STORAGE = 'nexus_yjs_dual_write';
const FLAG_QUERY = 'yjsDualWrite';

const flagOf = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    const q = new URLSearchParams(window.location.search).get(FLAG_QUERY);
    if (q !== null) {
      const on = q === '1' || q === 'true';
      window.localStorage.setItem(FLAG_STORAGE, on ? '1' : '0');
      return on;
    }
    return window.localStorage.getItem(FLAG_STORAGE) === '1';
  } catch {
    return false;
  }
};

export const isYjsDualWriteEnabled = (): boolean => flagOf();

export interface ShadowDiag {
  enabled: boolean;
  pageId: string;
  connected: boolean;
  seeded: number;
  writes: number;
  remoteUpdates: number;
  conflicts: number;
  lastConflictBlockId: string;
}

const diag: ShadowDiag = {
  enabled: false, pageId: '', connected: false,
  seeded: 0, writes: 0, remoteUpdates: 0, conflicts: 0, lastConflictBlockId: '',
};
export const yjsDualWriteDiag = ref<ShadowDiag>({ ...diag });

const publish = (): void => {
  diag.enabled = isYjsDualWriteEnabled();
  yjsDualWriteDiag.value = { ...diag };
  try { (window as any).__NEXUS_YJS_DIAG__ = yjsDualWriteDiag.value; } catch { /* ignore */ }
};

const bump = (k: 'seeded' | 'writes' | 'remoteUpdates' | 'conflicts'): void => {
  diag[k] += 1;
  publish();
};

/** 只用于诊断的纯文本投影；刻意不解析 HTML，避免 innerHTML 触发内联事件。 */
const toPlain = (html: string): string =>
  (html ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, '&');

let Y: any = null;
let handle: YjsDocHandle | null = null;
let blocks: any = null;
let boundPageId = '';
let clientId = '';
const localShadow = new Map<string, string>();

const onRemoteObserve = (events: any[], txn: any): void => {
  if (txn?.local || !blocks) return;   // 本端写入不算远端
  const ids = new Set<string>();
  for (const ev of events) {
    if (ev.target === blocks) {
      for (const k of ev.keys.keys()) ids.add(String(k));
    } else {
      const id = ev.target?.get?.('id');
      if (typeof id === 'string') ids.add(id);
    }
  }
  for (const key of ids) {
    const entry = blocks.get(key);
    if (!entry || entry.get('by') === clientId) continue;
    bump('remoteUpdates');
    const local = localShadow.get(key);
    if (local !== undefined && local !== entry.get('html')) {
      diag.lastConflictBlockId = key;
      bump('conflicts');
      // 影子阶段只观测：不回写 task.content，不改变任何编辑结果。
      console.warn('[NEXUS YJS] 检测到同块并发编辑（影子阶段仅观测）：', key);
    }
  }
};

/** 影子 Y.Map 是 LWW 寄存器，多端同时写同值不会像 Y.Text 种子那样产生重复文本。 */
const ensureEntry = (blockId: string): any => {
  let entry = blocks.get(blockId);
  if (!entry) {
    entry = new Y.Map();
    entry.set('id', blockId);
    blocks.set(blockId, entry);
  }
  return entry;
};

const seedBlock = (t: Task): void => {
  if (!blocks || !Y || !t?.id || blocks.has(t.id)) return;  // 已存在交给双写/远端观测维护
  const html = t.content ?? '';
  const entry = ensureEntry(t.id);
  entry.set('html', html);
  entry.set('text', toPlain(html));
  entry.set('ts', Date.now());
  entry.set('by', clientId);
  localShadow.set(t.id, html);
  bump('seeded');
};

/** 页面数据在 attach 之后才到齐时补种子；只补缺失块，幂等。 */
const seedTasks = (tasks: Task[]): void => {
  if (!blocks || !Y || !isYjsDualWriteEnabled()) return;
  for (const t of tasks) seedBlock(t);
};

// 单飞（single-flight）：onMounted 与切页 watch 可能在同一次启动里并发调用 attach，
// 两个异步流程各自 await import 后都去 createYjsDoc 会建出两个 provider（连接泄漏）。
let attachToken = 0;
let attachPromise: Promise<void> | null = null;

/** 只做资源释放，不动 token —— 供 doAttach 在抢占旧连接时复用。 */
const release = (): void => {
  boundPageId = '';
  try { if (blocks) blocks.unobserveDeep(onRemoteObserve); } catch { /* ignore */ }
  try { handle?.destroy(); } catch { /* ignore */ }
  handle = null; blocks = null; Y = null; clientId = '';
  localShadow.clear();
  diag.connected = false;
  diag.pageId = '';
  publish();
};

/**
 * 切页时挂载当前文档的影子通道。backend 会把 `/ws/yjs/page/<id>` 的房间名按租户
 * 加前缀（见 yjs_server.py），前端只需给出页面级房间名。
 */
const doAttach = async (pageId: string, tasks: Task[], token: number): Promise<void> => {
  release();
  boundPageId = pageId;
  publish();
  try {
    const Ymod = await import('yjs');
    const { createYjsDoc } = await import('./yjsDoc');
    // 异步加载期间用户可能已切页 / 关掉开关 / 被更新的 attach 抢占
    if (token !== attachToken || !isYjsDualWriteEnabled() || boundPageId !== pageId) { release(); return; }
    Y = Ymod;
    handle = createYjsDoc(`page/${pageId}`, pageId, { connect: true });
    clientId = String(handle.ydoc.clientID);
    diag.connected = !!handle.provider;
    blocks = handle.ydoc.getMap('blocks');
    publish();
    // 立刻补种子，不等 IndexedDB whenSynced / provider synced：
    // Y.Map 是 LWW 寄存器，远端状态随后到达会被 Yjs 自动合并；而 WebView 的 IDB
    // 可能被禁用或卡住，等它会让影子通道一直停在「半挂载」，双写完全不生效。
    seedTasks(tasks);
    blocks.observeDeep(onRemoteObserve);
    diag.pageId = pageId;
    publish();
    console.info('[NEXUS YJS] 影子通道已挂载（只读观测，不改写正文）：', pageId,
      { seeded: diag.seeded, connected: diag.connected });
  } catch (e) {
    // 影子层任何失败都必须静默回退，绝不影响主编辑与既有同步
    console.warn('[NEXUS YJS] 影子通道启动失败，已回退到原同步：', e);
    release();
  }
};

export const attachYjsDualWrite = (pageId: string, tasks: Task[]): Promise<void> => {
  if (!isYjsDualWriteEnabled() || !pageId) {
    if (handle || attachPromise) detachYjsDualWrite();
    return Promise.resolve();
  }
  // 已挂在同一页：只补数据到齐后才出现的块，不重建连接。
  if (handle && boundPageId === pageId) { seedTasks(tasks); return Promise.resolve(); }
  if (attachPromise && boundPageId === pageId) return attachPromise;
  const token = ++attachToken;   // 让任何在途的旧 attach 立即失效
  let p: Promise<void>;
  p = doAttach(pageId, tasks, token).finally(() => {
    if (attachPromise === p) attachPromise = null;
  });
  attachPromise = p;
  return p;
};

/** 本地写 legacy pages 的同时写影子；失败绝不影响主链路。 */
export const dualWriteBlock = (blockId: string, html: string): void => {
  if (!isYjsDualWriteEnabled() || !blocks || !Y || !blockId) return;
  try {
    const entry = ensureEntry(blockId);
    entry.set('html', html);
    entry.set('text', toPlain(html));
    entry.set('ts', Date.now());
    entry.set('by', clientId);
    localShadow.set(blockId, html);
    bump('writes');
  } catch { /* ignore */ }
};

export const detachYjsDualWrite = (): void => {
  attachToken += 1;
  attachPromise = null;
  release();
};

publish();
