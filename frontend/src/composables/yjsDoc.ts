// Phase 1：Yjs 文档适配层（离线优先 + 多端实时）。
// 设计原则（见迁移方案）：
//   - 顺序由 Y.Array 下标天然决定，彻底取代 prevId 链 / orderTasks（消除断链与 LWW 类 bug）
//   - 删除用软删除 deleted:true（CRDT 字段，多端一致、不丢"恢复误删块"UX），不使用物理 delete
//   - 资产仍走 /api/assets，Yjs 只存 'asset:<id>' 引用（破图属资产层，不在 Yjs 范围）
//   - 持久层可插拔：先用 IndexeddbPersistence（离线优先）；接入后端 /ws/yjs 时再挂 WebsocketProvider
//
// 注意：本文件刻意不 import useSync，也不引用任何 prevId / orderTasks / mergePages 逻辑——
// Phase 1 的「单文档试点」走的是与旧同步层完全独立的 CRDT 路径，二者共存、互不直接耦合。
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { WebsocketProvider } from 'y-websocket';
import { getRuntimeConfig } from '../runtimeConfig';
import { newBlockId } from './ids';

export interface YjsDocHandle {
  ydoc: Y.Doc;
  meta: Y.Map<any>;
  persistence: IndexeddbPersistence;
  provider: WebsocketProvider | null;
  destroy: () => void;
}

const syncServerOf = (): string => {
  const cfg = getRuntimeConfig();
  const s =
    cfg.syncServer ||
    (import.meta as any).env?.VITE_SYNC_SERVER ||
    (typeof window !== 'undefined' ? window.location.origin : '');
  return s.replace(/\/+$/, '');
};

const apiKeyOf = (): string =>
  (getRuntimeConfig().apiKey || (import.meta as any).env?.VITE_API_KEY || '').trim();

export function createYjsDoc(
  room: string,
  pageId: string,
  opts: { connect?: boolean } = {},
): YjsDocHandle {
  const ydoc = new Y.Doc();
  const persistence = new IndexeddbPersistence(`nexus-${room}/${pageId}`, ydoc);

  let provider: WebsocketProvider | null = null;
  if (opts.connect !== false) {
    const server = syncServerOf();
    if (server) {
      // 后端把 Yjs 挂在 /ws/yjs（见 backend/main.py 与 yjs_server.py），
      // 所以 Provider 基址必须是 <origin>/ws/yjs，房间名再拼到路径后。
      const wsBase = server.replace(/^http/, 'ws') + '/ws/yjs';
      provider = new WebsocketProvider(wsBase, room, ydoc, {
        params: { pageId, apiKey: apiKeyOf() },
      });
    }
  }

  const meta = ydoc.getMap('meta');

  return {
    ydoc,
    meta,
    persistence,
    provider,
    destroy() {
      provider?.destroy();
      persistence.destroy();
      ydoc.destroy();
    },
  };
}

// ============================================================
// 已废弃：Phase 1 的「Y.Array('tasks') 块列表」操作集（yAddBlock / yMoveBlock /
// yRemoveBlock / ySeedIfEmpty / yMapToTask …）已随架构 1 统一为单一
// Y.XmlFragment('doc') 文档而移除，避免遗留双结构。版本历史 / 导入导出见下文。
// ============================================================

// ============================================================
// Phase 3：版本快照（Snapshot）/ Awareness
// 快照载体采用「全量 CRDT 状态捕获（encodeStateAsUpdate）」：
// 本环境 yjs@13.6.33 的官方 Snapshot 原语（createSnapshot/encodeSnapshot/
// createDocFromSnapshot）在默认 gc 开启时要求 originDoc 关闭 gc，否则抛错，故改用
// 状态更新——gc 友好且已验证可靠。快照记录存入 meta.snapshots（Y.Map），
// 随文档 CRDT 同步，所有协作者可见同一份版本历史。
// ============================================================
const bytesToB64 = (bytes: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
};
const b64ToBytes = (b64: string): Uint8Array => {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};

export interface YjsSnapshot {
  id: string;
  label: string;
  ts: number;
}

function ySnapshotsMap(h: YjsDocHandle): Y.Map<any> {
  let m = h.meta.get('snapshots') as Y.Map<any> | undefined;
  if (!m) {
    m = new Y.Map();
    h.meta.set('snapshots', m);
  }
  return m;
}

/** 捕获当前文档全量状态为一份快照（base64 存于 meta.snapshots）。 */
export function yTakeSnapshot(h: YjsDocHandle, label?: string): string {
  const update = Y.encodeStateAsUpdate(h.ydoc);
  const data = bytesToB64(update);
  const id = newBlockId();
  const rec = new Y.Map();
  rec.set('id', id);
  rec.set('label', label || `快照 @ ${new Date().toLocaleTimeString()}`);
  rec.set('ts', Date.now());
  rec.set('data', data);
  ySnapshotsMap(h).set(id, rec);
  return id;
}

/** 列出快照元信息（不含 data），按时间倒序。 */
export function yListSnapshots(h: YjsDocHandle): YjsSnapshot[] {
  const m = h.meta.get('snapshots') as Y.Map<any> | undefined;
  if (!m) return [];
  const out: YjsSnapshot[] = [];
  m.forEach((rec: Y.Map<any>) => {
    out.push({ id: rec.get('id'), label: rec.get('label'), ts: rec.get('ts') });
  });
  out.sort((a, b) => b.ts - a.ts);
  return out;
}

/** 删除一份快照记录。 */
export function yRemoveSnapshot(h: YjsDocHandle, id: string): void {
  const m = h.meta.get('snapshots') as Y.Map<any> | undefined;
  if (m) m.delete(id);
}

/**
 * 恢复到某份快照：用快照状态重建临时文档，再把活动文档还原为该版本。
 * 版本历史（meta.snapshots）本身不被覆盖，可跨多次恢复保留。
 * 文档正文（Y.XmlFragment('doc')）由 Tiptap 层注册的还原钩子处理（需 ProseMirror schema）。
 */
export function yRestoreSnapshot(h: YjsDocHandle, id: string): void {
  const m = h.meta.get('snapshots') as Y.Map<any> | undefined;
  const rec = m?.get(id) as Y.Map<any> | undefined;
  if (!rec) return;
  const update = b64ToBytes(rec.get('data'));
  const tmp = new Y.Doc();
  Y.applyUpdate(tmp, update);
  const tMeta = tmp.getMap('meta');
  const targetTitle = (tMeta.get('title') as string) ?? '';
  h.ydoc.transact(() => {
    h.meta.set('title', targetTitle);
    // 文档正文片段：交给 Tiptap 层注册的还原钩子（有 schema 才能重建 XML 结构）
    const tmpFrag = tmp.getXmlFragment('doc');
    if (tiptapFragmentRestorer) tiptapFragmentRestorer(tmpFrag);
  });
}

// ============================================================
// 富文本片段还原钩子（Phase 4/5 衔接）
// yjsDoc 刻意不依赖 y-prosemirror / Tiptap schema；片段重建需 ProseMirror Schema，
// 故由 YjsBlockEditor.vue 在挂载时注册一个还原器，这里只持有引用并在恢复时调用。
// ============================================================
type FragmentRestorer = (tmpFrag: Y.XmlFragment) => void;
let tiptapFragmentRestorer: FragmentRestorer | null = null;
export function registerTiptapFragmentRestorer(fn: FragmentRestorer): void {
  tiptapFragmentRestorer = fn;
}
export function unregisterTiptapFragmentRestorer(fn: FragmentRestorer): void {
  if (tiptapFragmentRestorer === fn) tiptapFragmentRestorer = null;
}

// ============================================================
// Phase 5：导入 / 导出（试点文档级）
// 导出 = 当前 Y.Doc 全量状态（二进制 update）；导入 = 合并进当前文档。
// ============================================================
/** 导出当前文档全量状态（Yjs 二进制更新），用于下载 / 备份。 */
export function yExportDoc(h: YjsDocHandle): Uint8Array {
  return Y.encodeStateAsUpdate(h.ydoc);
}

/** 导入一份文档状态（合并进当前文档）。用于从备份文件恢复。 */
export function yImportDoc(h: YjsDocHandle, data: Uint8Array): void {
  Y.applyUpdate(h.ydoc, data);
}

// ============================================================
// 阶段 3：跨文档搜索——无需 ProseMirror schema 即可从 Y.XmlFragment 抽取纯文本。
// 递归遍历 XmlElement 子节点，XmlText 的文本内容即文档可见文字。
// ============================================================
export function yGetDocText(ydoc: Y.Doc): string {
  const frag = ydoc.getXmlFragment('doc');
  const out: string[] = [];
  const walk = (node: any): void => {
    if (node instanceof Y.XmlText) {
      const t = node.toString();
      if (t) out.push(t);
      return;
    }
    if (node instanceof Y.XmlElement) {
      node.forEach((c: any) => walk(c));
      // 块级节点之间补换行，保证搜索时词不被错误拼接
      out.push('\n');
    }
  };
  frag.forEach((n: any) => walk(n));
  return out.join('');
}
