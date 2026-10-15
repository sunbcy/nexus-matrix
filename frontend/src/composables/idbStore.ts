// IndexedDB 实现的键值存储。
//
// 为什么必须替换 localStorage：
// 1) **配额**：localStorage 每 origin 仅 5 MiB；IndexedDB 配额约为磁盘总量的 60%。
//    本项目把图片/封面以 Base64 存进页面 JSON，几张图就会逼近 5 MiB。
// 2) **驱逐风险（最关键）**：localStorage 默认 best-effort，设备存储压力下会按 LRU
//    把**整个 origin 全量删除**（不是删一部分）。Android WebView 上这是必现的数据丢失。
//    IndexedDB 同样有驱逐，但可通过 navigator.storage.persist() 申请持久化豁免。
// 3) 不阻塞主线程：localStorage 是同步 API，大对象读写会卡 UI。
//
// 接口与 storage.ts 的 KeyValueStore 一致（全异步），可直接替换。

import type { KeyValueStore } from './storage';
import { webStore } from './storage';

const DB_NAME = 'nexus-matrix';
const DB_VERSION = 1;
const STORE = 'kv';

let dbPromise: Promise<IDBDatabase> | null = null;

const openDB = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB 不可用'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('打开 IndexedDB 失败'));
  });
  return dbPromise;
};

const tx = async <T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> => {
  const db = await openDB();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 操作失败'));
  });
};

export const idbStore: KeyValueStore = {
  async get(key) {
    try {
      const v = await tx<unknown>('readonly', (s) => s.get(key));
      return v === undefined ? null : String(v);
    } catch {
      return null;
    }
  },
  async set(key, value) {
    await tx('readwrite', (s) => s.put(value, key));
  },
  async remove(key) {
    await tx('readwrite', (s) => s.delete(key));
  },
};

// 申请持久化存储：避免浏览器在存储压力下驱逐本 origin 的数据。
// 返回值仅供参考——是否授予由浏览器策略决定（Chrome 按站点参与度判定，
// Firefox 会弹窗）。移动端 WebView 的实际行为需真机验证。
export const requestPersistence = async (): Promise<boolean> => {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
};

// 是否已获得持久化
export const isPersisted = async (): Promise<boolean> => {
  try {
    return (await navigator.storage?.persisted?.()) ?? false;
  } catch {
    return false;
  }
};

/**
 * 一次性迁移：把 localStorage 里的既有数据搬到 IndexedDB。
 * 必须在写入任何新数据之前调用，否则会覆盖掉用户尚未迁移的旧数据。
 * 迁移后旧键保留（不删除），便于出问题时回退。
 */
export const migrateFromLocalStorage = async (keys: string[]): Promise<number> => {
  let moved = 0;
  for (const key of keys) {
    try {
      const raw = await webStore.get(key);
      if (raw == null) continue;
      const existing = await idbStore.get(key);
      if (existing != null) continue; // 目标已有数据则不覆盖
      await idbStore.set(key, raw);
      moved++;
    } catch {
      /* 单个键失败不影响其余 */
    }
  }
  return moved;
};
