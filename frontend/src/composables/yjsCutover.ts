/**
 * P2 Phase B：把块正文真正切到结构化 CRDT（Y.XmlFragment + ProseMirror），全类型迁移。
 *
 * 与 Phase A 影子双写（只观测、不改写）不同，这里块正文 **就是** CRDT：
 *   - 每个块在页面级 Y.Doc 的 `block_crdt` Map 里拥有一份 `Y.XmlFragment`；
 *   - 主编辑器在 ?yjsCutover=1 时，把裸 contenteditable 换成绑定该 fragment 的 ProseMirror 编辑器；
 *   - 本地键入直接写入 Y.Text（字符级），远端更新由 y-prosemirror 合并回来 ——
 *     这才能真正解决「同块并发后写覆盖丢字」。
 *   - 为兼容既有 legacy `pages` 同步，`task.content` 仍作为 HTML 投影被持续回写
 *     （由编辑器 emit 的 HTML 经 updateTask 写入）；关闭开关后块内容以原 HTML 字符串
 *     继续工作，无数据丢失（且首次进入切流时会把原文备份到 localStorage 便于恢复）。
 *
 * 注意：本通道与 Phase A 影子通道 **互斥**（共用同一页面级 Y.Doc 房间，不能同时挂两套）。
 * 由调用方（NexusTaskMatrix1）根据开关二选一。
 */
import { ref } from 'vue';
import type * as Y from 'yjs';
import type { YjsDocHandle } from './yjsDoc';

const FLAG_STORAGE = 'nexus_yjs_cutover';
const FLAG_QUERY = 'yjsCutover';

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

export const isYjsCutoverEnabled = (): boolean => flagOf();

export interface CutoverDiag {
  enabled: boolean;
  pageId: string;
  connected: boolean;
  blocks: number;
  writes: number;
}

const diag: CutoverDiag = { enabled: false, pageId: '', connected: false, blocks: 0, writes: 0 };
export const yjsCutoverDiag = ref<CutoverDiag>({ ...diag });
// 主组件据此决定何时把裸 contenteditable 换成 Yjs 编辑器（避免 handle 未建好就渲染导致 fragment 为 null）
export const cutoverReady = ref(false);

const publish = (): void => {
  diag.enabled = isYjsCutoverEnabled();
  yjsCutoverDiag.value = { ...diag };
  try { (window as any).__NEXUS_YJS_CUTOVER__ = yjsCutoverDiag.value; } catch { /* ignore */ }
};

const bump = (k: 'blocks' | 'writes'): void => {
  diag[k] += 1;
  publish();
};

// 块级 fragment 用顶层 XmlFragment（命名含 blockId），而非嵌进某个 Y.Map 的值：
// ypy 对「Map 内嵌共享类型」会触发 "Couldn't get item's parent" 恐慌并损坏整份 Doc，
// 顶层 fragment 才是受支持的形态（试点 doc 即如此）。切流通道独占本页面级 Doc，
// 与 Phase A 影子通道命名隔离，不会互相踩踏。
export function getBlockFragment(ydoc: Y.Doc, blockId: string): Y.XmlFragment | null {
  if (!ydoc) return null;
  return ydoc.getXmlFragment('block_crdt:' + blockId);
}

let handle: YjsDocHandle | null = null;
let boundPageId = '';

export const getCutoverHandle = (): YjsDocHandle | null => handle;

export const getCutoverBlockFragment = (blockId: string): Y.XmlFragment | null =>
  handle ? getBlockFragment(handle.ydoc, blockId) : null;

let attachToken = 0;
let attachPromise: Promise<void> | null = null;

const release = (): void => {
  boundPageId = '';
  try { handle?.destroy(); } catch { /* ignore */ }
  handle = null;
  cutoverReady.value = false;
  diag.connected = false;
  diag.pageId = '';
  publish();
};

const doAttach = async (pageId: string, token: number): Promise<void> => {
  release();
  boundPageId = pageId;
  publish();
  try {
    const { createYjsDoc } = await import('./yjsDoc');
    if (token !== attachToken || !isYjsCutoverEnabled() || boundPageId !== pageId) { release(); return; }
    // 切流独占房间名（crdt/ 前缀），与 Phase A 影子通道（page/）及可能已损坏的 pilot 持久化隔离。
    handle = createYjsDoc(`crdt/${pageId}`, pageId, { connect: true });
    diag.connected = !!handle.provider;
    diag.pageId = pageId;
    cutoverReady.value = true;
    publish();
    console.info('[NEXUS YJS] 切流通道已挂载（块正文 = CRDT，字符级合并）：', pageId,
      { connected: diag.connected });
  } catch (e) {
    console.warn('[NEXUS YJS] 切流通道启动失败，已回退到原 contenteditable：', e);
    release();
  }
};

export const attachYjsCutover = (pageId: string): Promise<void> => {
  if (!isYjsCutoverEnabled() || !pageId) { if (handle || attachPromise) detachYjsCutover(); return Promise.resolve(); }
  if (handle && boundPageId === pageId) return Promise.resolve();
  if (attachPromise && boundPageId === pageId) return attachPromise;
  const token = ++attachToken;
  let p: Promise<void>;
  p = doAttach(pageId, token).finally(() => { if (attachPromise === p) attachPromise = null; });
  attachPromise = p;
  return p;
};

export const detachYjsCutover = (): void => {
  attachToken += 1;
  attachPromise = null;
  release();
};

export const reportCutoverWrite = (): void => bump('writes');
export const reportCutoverBlock = (): void => bump('blocks');

publish();
