// Phase 1：Yjs 文档适配层（离线优先 + 多端实时）。
// 设计原则（见迁移方案）：
//   - 顺序由 Y.Array 下标天然决定，彻底取代 prevId 链 / orderTasks（消除断链与 LWW 类 bug）
//   - 删除用软删除 deleted:true（CRDT 字段，多端一致、不丢"恢复误删块"UX），不使用物理 delete
//   - 资产仍走 /api/assets，Yjs 只存 'asset:<id>' 引用（破图属资产层，不在 Yjs 范围）
//   - 持久层可插拔：先用 IndexeddbPersistence（离线优先）；接入后端 /ws/yjs 时再挂 WebsocketProvider
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { WebsocketProvider } from 'y-websocket';
import { getRuntimeConfig } from '../runtimeConfig';

export interface YjsDocHandle {
  ydoc: Y.Doc;
  yTasks: Y.Array<Y.Map<any>>;
  meta: Y.Map<any>;
  persistence: IndexeddbPersistence;
  provider: WebsocketProvider | null;
  undoManager: Y.UndoManager;
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
      const wsBase = server.replace(/^http/, 'ws');
      provider = new WebsocketProvider(wsBase, room, ydoc, {
        params: { pageId, apiKey: apiKeyOf() },
      });
    }
  }

  const yTasks = ydoc.getArray<Y.Map<any>>('tasks');
  const meta = ydoc.getMap('meta');
  const undoManager = new Y.UndoManager(yTasks, { captureTimeout: 300 });

  return {
    ydoc,
    yTasks,
    meta,
    persistence,
    provider,
    undoManager,
    destroy() {
      provider?.destroy();
      persistence.destroy();
      ydoc.destroy();
    },
  };
}

// Task <-> Y.Map 互转（用于迁移脚本、试点、以及与现有 Task 结构互通）
export function taskToYMap(t: any): Y.Map<any> {
  const m = new Y.Map();
  m.set('id', t.id);
  m.set('type', t.type);
  m.set('content', t.content ?? '');
  m.set('completed', !!t.completed);
  m.set('indentLevel', t.indentLevel ?? 0);
  m.set('deleted', !!t.deletedAt);
  const p = new Y.Map();
  const pl = t.payload || {};
  p.set('url', pl.url ?? '');
  p.set('alt', pl.alt ?? '');
  p.set('code', pl.code ?? '');
  m.set('payload', p);
  return m;
}

export function yMapToTask(m: Y.Map<any>): any {
  const pl = m.get('payload') as Y.Map<any> | undefined;
  return {
    id: m.get('id'),
    type: m.get('type'),
    content: m.get('content') ?? '',
    completed: !!m.get('completed'),
    indentLevel: m.get('indentLevel') ?? 0,
    deletedAt: m.get('deleted') ? new Date().toISOString() : null,
    payload: {
      url: pl?.get?.('url') ?? '',
      alt: pl?.get?.('alt') ?? '',
      code: pl?.get?.('code') ?? '',
    },
  };
}
