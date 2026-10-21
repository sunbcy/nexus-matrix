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

import type {KeyValueStore} from './storage';
import {webStore} from './storage';

const DB_NAME = 'nexus-matrix';

// 两个 object store 共用同一个库、同一次升级。
//
// 历史缺陷（必须留档，勿重犯）：此前 idbStore 用 DB_VERSION=1 建 `kv`、
// assets.ts 用 DB_VERSION=2 建 `assets`，**两处共用同一个 DB_NAME 且各自缓存
// dbPromise**。当 assets.ts 先以 v2 开库后，idbStore 的 open(DB_NAME, 1) 因
// 请求版本低于现存版本直接抛 VersionError，而这个 rejected promise 被永久缓存
// ——之后所有页面写入全部落空且静默失败（表现为「数据不保存 / 回到旧版本」）。
// 根治方式是**单一连接、单一版本、同一次 upgrade 建齐所有 store**，assets.ts
// 复用本模块的 openNexusDB()，不再自行 open。
//
// 版本演进：
//   1 = 仅 kv
//   2 = 新增 assets（历史 bug：idbStore 停在 1、assets 已到 2）
//   3 = 修复上一条 bug 留下的**存量坏库**——那些库版本号已是 2 但只建了 assets、
//       没有 kv。因为版本相同不会再触发 upgrade，只能靠递增到 3 强制补齐 kv，
//       否则存量用户会永久卡在「有 assets 无 kv、页面数据存不进去」的状态。
const DB_VERSION = 3;

/** 所有 object store 名称的唯一来源，assets.ts 也从此取，避免两处各写一份 */
export const STORE_NAMES = {
  kv: 'kv',
  assets: 'assets',
} as const;

const STORE = STORE_NAMES.kv;

let dbPromise: Promise<IDBDatabase> | null = null;

/** 共享的数据库连接。assets.ts 必须复用它，不要另开一个 indexedDB.open */
export const openNexusDB = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB 不可用'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // 一次升级把两个 store 都建齐（幂等），否则谁先开谁后开都会缺另一个
      for (const name of Object.values(STORE_NAMES)) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // 防御性校验：upgrade 可能因版本未递增而没跑，这里确认 store 确实齐备。
      // 缺失就直接判定失败，让上层留在 localStorage 并提示用户，
      // 而不是拿着一个「能连但存不进」的连接静默丢数据。
      const missing = Object.values(STORE_NAMES).filter(
        (name) => !db.objectStoreNames.contains(name),
      );
      if (missing.length > 0) {
        db.close();
        reject(new Error(`IndexedDB 缺少 object store: ${missing.join(', ')}`));
        return;
      }
      // 别的标签页要升级版本时主动让路，否则对方会被 blocked 卡死
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error('打开 IndexedDB 失败'));
    req.onblocked = () => reject(new Error('IndexedDB 被其他标签页阻塞'));
  }).catch((err) => {
    // 关键：失败必须清空缓存，否则这个 rejected promise 会被后续每次调用复用，
    // 造成「一次失败、永久失败、且无法重试」。
    dbPromise = null;
    throw err;
  });
  return dbPromise;
};

const tx = async <T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> => {
  const db = await openNexusDB();
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
 * 健康探针：真实写一次再读回，确认 kv store 确实可用。
 *
 * 为什么必须有这一步：光看 `indexedDB.open` 是否抛异常是不够的——
 * 版本冲突曾导致 open 成功返回旧版本连接、而事务目标 store 不存在，
 * 或 promise 被缓存成 rejected 后每次 set 都静默失败。只有真实读写一轮
 * 才能证明「这条存储链路真的能存住数据」。
 * 在 setStore(idbStore) 之前必须调用，失败就绝不能切换存储。
 */
const PROBE_KEY = '__nexus_probe__';
export const probeIdb = async (): Promise<boolean> => {
  try {
    const marker = String(Date.now());
    await idbStore.set(PROBE_KEY, marker);
    const back = await idbStore.get(PROBE_KEY);
    return back === marker;
  } catch {
    return false;
  }
};

/**
 * 取一份数据的「新鲜度」：页面数组里最大的 updatedAt。
 * 无法解析或没有 updatedAt 时返回 -1，表示无法判断。
 */
const freshnessOf = (raw: string | null): number => {
  if (!raw) return -1;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return -1;
    let max = -1;
    for (const p of parsed) {
      const t = typeof p?.updatedAt === 'number' ? p.updatedAt : -1;
      if (t > max) max = t;
    }
    return max;
  } catch {
    return -1;
  }
};

/**
 * 迁移：让 localStorage 与 IndexedDB 中**较新的那份**成为唯一数据源。
 *
 * 为什么必须双向比较（而不是简单地「localStorage -> IndexedDB」）：
 * 1) 首次迁移：IndexedDB 为空，搬 localStorage 过去。
 * 2) 正常启动：IndexedDB 里有上次会话的新数据，localStorage 是旧快照
 *    ——此时若按老逻辑「目标已有数据则不覆盖」是对的，不会回退。
 * 3) 降级回退：IndexedDB 某次不可用时写入退回了 localStorage，
 *    localStorage 反而更新——此时必须把 localStorage 的新数据搬过去，
 *    否则会丢掉最近一次会话的编辑。
 * 只有比较 updatedAt 才能同时覆盖 2 和 3 两种方向。
 *
 * 必须在 initSync 读取之前调用；迁移后不删除 localStorage 旧键，便于出问题时回退。
 */
export const migrateFromLocalStorage = async (keys: string[]): Promise<number> => {
  let moved = 0;
  for (const key of keys) {
    try {
      const raw = await webStore.get(key);
      if (raw == null) continue;
      const existing = await idbStore.get(key);
      if (existing != null) {
        // 两边都有数据：比新鲜度，谁新谁留下
        const localFresh = freshnessOf(raw);
        const idbFresh = freshnessOf(existing);
        // 任一侧无法判断时保持现状（不冒险覆盖）
        if (localFresh < 0 || idbFresh < 0) continue;
        if (localFresh <= idbFresh) continue; // IndexedDB 更新或一样，保留
      }
      await idbStore.set(key, raw);
      moved++;
    } catch {
      /* 单个键失败不影响其余 */
    }
  }
  return moved;
};
