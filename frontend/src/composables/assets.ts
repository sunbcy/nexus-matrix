// 图片资产存储：把图片从「页面 JSON 里的 Base64 字符串」拆出来，
// 页面里只留一个 asset: 引用。
//
// 为什么必须做：
// 1) 页面 JSON 会被整页广播（WebSocket 与后端），Base64 让 payload 暴涨到 MB 级；
// 2) localStorage 只有 5 MiB 且会被整 origin 驱逐（Android WebView 必现）；
// 3) 撤销栈是整页快照，Base64 会让每次快照都巨大，历史栈形同虚设；
// 4) 图片与文本混在一个值里，无法对图片做单独的增删改。
//
// 引用格式：`asset:<id>`，例如 asset:9f3c1d2e-4b5a-6789-abcd-ef0123456789
// 渲染前用 resolveAsset() 还原成 blob: URL。
//
// 注意：blob: URL 每次会话都会变，因此它只用于渲染，绝不持久化。
// 持久化的是 Blob 本身（IndexedDB 可存 Blob，浏览器会持久保留）。
//
// 兼容旧数据：老页面的 payload.url 可能是 data:image/...;base64,...
// resolveAsset 对 data: 原样返回（不迁移），保证旧内容仍能显示。

import {newId} from './ids';
// 复用 idbStore 的共享连接：**绝不能再自行 indexedDB.open**。
// 历史上本模块以 DB_VERSION=2 独立开库，与 idbStore 的 v1 冲突，导致 kv store
// 永久不可用（页面数据静默丢失）。详见 idbStore.ts 的注释。
import {openNexusDB, STORE_NAMES} from './idbStore';
import {getRuntimeConfig} from '../runtimeConfig';

// 阶段二 2.3：把图片 Blob 同步到后端，使其它设备能解析 asset: 引用。
// 与页面同步同源：优先 URL ?syncServer= / 设置面板，否则走同源（Vite 代理）。
const SYNC_SERVER = (getRuntimeConfig().syncServer || (import.meta as any).env?.VITE_SYNC_SERVER || '').replace(/\/+$/, '');
const ASSET_API_BASE = SYNC_SERVER ? `${SYNC_SERVER}/api` : '/api';

export const ASSET_PREFIX = 'asset:';

const ASSET_STORE = STORE_NAMES.assets;
const openDB = openNexusDB;

/** 写一条资产记录；事务失败直接抛错，由调用方决定重试还是放弃 */
const putAssetBlob = (db: IDBDatabase, id: string, blob: Blob): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ASSET_STORE, 'readwrite');
    tx.objectStore(ASSET_STORE).put(blob, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('保存图片资产失败'));
    tx.onabort = () => reject(tx.error ?? new Error('保存图片资产被中止'));
  });

/**
 * 「写进去并且真的能读回来」为止：先查（已有就直接返回）、再写、再读回校验，最多 tries 轮。
 * 返回最终是否可读回 —— 不抛错，让调用方自己决定「没落住」算致命还是可降级。
 */
const putUntilReadable = async (db: IDBDatabase, id: string, blob: Blob, tries: number): Promise<boolean> => {
  const ref = `${ASSET_PREFIX}${id}`;
  for (let attempt = 0; attempt < tries; attempt++) {
    if (await getAsset(ref)) return true;
    try { await putAssetBlob(db, id, blob); } catch { /* 单次事务失败：消耗一次重试，最终由读回结果裁决 */ }
  }
  return (await getAsset(ref)) !== null;
};

/** 存入 Blob，返回 asset:<id> 引用 */
export const saveAsset = async (blob: Blob): Promise<string> => {
  const id = newId();
  const ref = `${ASSET_PREFIX}${id}`;
  const db = await openDB();
  // 落库校验：写入后立即读回，确认真的存住了。历史出现过「引用(asset:)生成了、但 blob 没落库」，
  // 本地与后端都取不到 → 破图（ZIP 导入篇正是此问题）。同一 id 重试最多 3 次，仍读不回就抛错，
  // 让调用方知道没存上（而不是静默返回一个取不到的死引用）。
  if (!(await putUntilReadable(db, id, blob, 3))) {
    throw new Error('图片写入本地存储后校验失败');
  }
  return ref;
};

/**
 * 已有引用的「落库复核 + 就地补写」。
 *
 * 终检场景专用：引用已经写进页面了，事后却发现 blob 读不回（事务丢失 / IDB 被驱逐）。
 * 只要手里还留着原始 blob，就该把它补回去，而不是只报一句「没存上」——
 * 这正是「确保不缺」的关键一步：缺了先救，救不回来才提示。
 */
export const verifyAssetOrRetry = async (ref: string, blob: Blob, tries = 3): Promise<boolean> => {
  const id = ref.slice(ASSET_PREFIX.length);
  if (!id) return false;
  try {
    const db = await openDB();
    return await putUntilReadable(db, id, blob, tries);
  } catch {
    return false; // 连库都开不了：无法自愈，交给调用方提示
  }
};

export const getAsset = async (ref: string): Promise<Blob | null> => {
  const id = ref.slice(ASSET_PREFIX.length);
  if (!id) return null;
  const db = await openDB();
  return new Promise<Blob | null>((resolve) => {
    const tx = db.transaction(ASSET_STORE, 'readonly');
    const req = tx.objectStore(ASSET_STORE).get(id);
    req.onsuccess = () => resolve((req.result as Blob) ?? null);
    req.onerror = () => resolve(null);
  });
};

export const deleteAsset = async (ref: string): Promise<void> => {
  const id = ref.slice(ASSET_PREFIX.length);
  if (!id) return;
  const db = await openDB();
  await new Promise<void>((resolve) => {
    const tx = db.transaction(ASSET_STORE, 'readwrite');
    tx.objectStore(ASSET_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
};

/**
 * Blob -> base64。必须分块：String.fromCharCode(...arr) 是把数组展开成函数入参，
 * V8 的入参上限约 100~200KB，超过直接抛 RangeError（已实测：200KB 必炸）。
 * 而导入的图片压缩后仍有 150~350KB，等于**上传从来没成功过一次** ——
 * 本地看着好好的，一旦换设备 / 清缓存 / 无痕窗口，回源只有 404，图就全破。
 */
const blobToBase64 = (buf: ArrayBuffer): string => {
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000; // 32KB：远低于上限，又不至于循环太多轮
  let bin = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
};

/**
 * 阶段二 2.3：把本地资产上传到后端（尽力而为，不阻塞正文保存）。
 * 离线或后端不可用时静默失败——本地已存，待下次有网时由 resolveAsset 的回源
 * 路径触发补传（另一设备来取时本端不一定在线，故采用「按需回源」而非预推送）。
 */
export const uploadAssetToServer = async (ref: string, blob: Blob): Promise<void> => {
  if (!SYNC_SERVER) return; // 纯本地模式（无 syncServer）无需上传
  try {
    const buf = await blob.arrayBuffer();
    const b64 = blobToBase64(buf);
    await fetch(`${ASSET_API_BASE}/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: ref, data: b64 }),
    });
  } catch (e) {
    // 静默：离线/后端挂了都不影响本地编辑；其它端来取时再走 resolveAsset 回源
    console.warn('[NEXUS ASSET] 上传失败（将有网时由对端按需回源）', e);
  }
};

/**
 * 阶段二 2.3：从后端拉取资产（对端已上传、本端缺失时）。
 * resolveAsset 本地 miss 时调用：把 Blob 存回本地 + 缓存，使后续渲染直读本地。
 */
export const fetchAssetFromServer = async (ref: string): Promise<Blob | null> => {
  if (!SYNC_SERVER) return null;
  const id = ref.slice(ASSET_PREFIX.length);
  try {
    const res = await fetch(`${ASSET_API_BASE}/assets/${id}`);
    // 明确 404：记入负缓存，后续不再对同一缺失资产反复回源（消除 404 刷屏）
    if (res.status === 404) { markAssetMissing(ref); return null; }
    if (!res.ok) return null; // 5xx 等瞬时错误：不记录，下次自重试
    const blob = await res.blob();
    // 落本地，避免每次渲染都跨网
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(ASSET_STORE, 'readwrite');
      tx.objectStore(ASSET_STORE).put(blob, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
    return blob;
  } catch (e) {
    console.warn('[NEXUS ASSET] 回源下载失败', e);
    return null;
  }
};

export const isAssetRef = (url: unknown): url is string =>
  typeof url === 'string' && url.startsWith(ASSET_PREFIX);

// blob: URL 缓存：同一个 asset 在同一会话内复用同一个 URL，
// 避免每次渲染都新建 URL 导致 <img> 反复刷新。
const blobUrlCache = new Map<string, string>();

// === 「查无此资产」负缓存（消除缺失图片的反复 404） ===
// 页面引用了 asset:<id>，但本地 IDB 没有、后端也 404（多为 Notion 导入遗留 / 资产丢失）。
// 不记负缓存的话，resolveAsset 每次被调用（渲染 / warmAssets）都会重新回源 → 反复 404 刷屏。
// 只在**后端明确 404** 时记录；网络错误 / 5xx 视为瞬时故障，不记录，下次自重试。
// 持久化到 localStorage 跨刷新生效，并带 TTL：万一资产后来补上传，到期会自动重新探测。
const ASSET_MISS_KEY = 'nexus_asset_miss_v1';
const ASSET_MISS_TTL = 7 * 24 * 60 * 60 * 1000; // 7 天
const assetMissCache = new Set<string>();
try {
  const raw = localStorage.getItem(ASSET_MISS_KEY);
  if (raw) {
    const parsed = JSON.parse(raw) as { ts?: number; refs?: unknown };
    if (parsed && typeof parsed.ts === 'number' && Date.now() - parsed.ts <= ASSET_MISS_TTL && Array.isArray(parsed.refs)) {
      for (const r of parsed.refs) if (typeof r === 'string') assetMissCache.add(r);
    } else {
      localStorage.removeItem(ASSET_MISS_KEY); // 过期 / 损坏：清掉重来
    }
  }
} catch { /* 读不到就当没有负缓存 */ }
let assetMissSaveTimer: ReturnType<typeof setTimeout> | null = null;
const persistAssetMiss = (): void => {
  if (assetMissSaveTimer) clearTimeout(assetMissSaveTimer);
  assetMissSaveTimer = setTimeout(() => {
    try {
      localStorage.setItem(ASSET_MISS_KEY, JSON.stringify({ ts: Date.now(), refs: [...assetMissCache] }));
    } catch { /* 配额满等：仅本次不持久化，不影响使用 */ }
  }, 800);
};
const markAssetMissing = (ref: string): void => {
  if (assetMissCache.has(ref)) return;
  assetMissCache.add(ref);
  persistAssetMiss();
};
/** 资产后来补上了（含补上传/补写入）：移出负缓存，允许再次解析 */
export const clearAssetMissing = (ref: string): void => {
  if (!assetMissCache.delete(ref)) return;
  persistAssetMiss();
};

/** 把 asset: 引用还原成可直接用于 <img src> 的 URL */
export const resolveAsset = async (ref: string): Promise<string> => {
  const cached = blobUrlCache.get(ref);
  if (cached) return cached;
  let blob = await getAsset(ref);
  // 阶段二 2.3：本地 miss → 从后端回源；已知缺失（负缓存）的跳过，避免反复 404
  if (!blob && !assetMissCache.has(ref)) {
    blob = await fetchAssetFromServer(ref);
  }
  if (!blob) return '';
  clearAssetMissing(ref); // 找到了（含后来补上传的）：移出负缓存
  const url = URL.createObjectURL(blob);
  blobUrlCache.set(ref, url);
  return url;
};

/** 同步版本：命中缓存则立即返回，否则返回空串（首次加载走异步版） */
export const resolveAssetSync = (ref: string): string => blobUrlCache.get(ref) ?? '';

/**
 * 预热：把页面里所有 asset 引用解析成 blob: URL 并缓存。
 * 渲染 <img> 前调用，确保 src 一开始就有值。
 */
export const warmAssets = async (refs: string[]): Promise<void> => {
  const pending = refs.filter((r) => isAssetRef(r) && !blobUrlCache.has(r));
  await Promise.all(pending.map(resolveAsset));
};

/**
 * 把 File / Blob 转成 asset 引用（图片块与封面统一入口）。
 * 默认先降采样再存，避免原图直接进 IndexedDB 把配额吃光。
 *
 * 但「降采样 + 重编码」是有损的：一张 3072×4096 的图会被缩到 900×1200
 * 再压成 JPEG 0.82 —— 分辨率只剩 1/3。扫板书页、截图带小字的这类图会明显发虚。
 * 所以提供 `original`：原样落库，一个字节都不动（代价是体积 = 原文件）。
 */
export interface ImageSaveOptions {
  /** 原样落库：不缩放、不重编码。用于「我要的就是原图」的场景（如 ZIP 导入） */
  original?: boolean;
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
}

const MAX_W = 1600;
const MAX_H = 1200;
const SMALL_ENOUGH = 400_000; // 小于此长度的 DataURL 直接采用，省一次解码

/** 读取文件并降采样为 JPEG Blob */
const compressImage = (file: Blob, opts: ImageSaveOptions = {}): Promise<Blob> =>
  new Promise((resolve) => {
    const maxW = opts.maxWidth ?? MAX_W;
    const maxH = opts.maxHeight ?? MAX_H;
    const reader = new FileReader();
    reader.onerror = () => resolve(file); // 读失败就用原文件，至少不丢功能
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(maxW / img.width, maxH / img.height, 1);
        // 已经够小就不折腾，保留原图（PNG 的清晰度比 JPEG 好）
        if (scale >= 1 && file.size < SMALL_ENOUGH) { resolve(file); return; }
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(file); return; }
        // PNG 透明区转 JPEG 会变黑，必须先铺白底
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0);
        canvas.toBlob(
          (blob) => resolve(blob ?? file),
          'image/jpeg',
          opts.quality ?? 0.82,
        );
      };
      img.onerror = () => resolve(file);
      img.src = String(reader.result ?? '');
    };
    reader.readAsDataURL(file);
  });

export const saveImageAsset = async (file: Blob, opts?: ImageSaveOptions): Promise<string> =>
  (await saveImageAssetWithBlob(file, opts)).ref;

/**
 * 与 saveImageAsset 相同，但一并返回**真正落库的那份** Blob。
 * 导入场景要留着它：终检发现没存上时，得拿同一份内容原样补写，
 * 否则存进去的不是落库时的那份（原图模式下就是未压缩原图），白白吃掉 IndexedDB 配额。
 */
export const saveImageAssetWithBlob = async (file: Blob, opts?: ImageSaveOptions): Promise<{ ref: string; blob: Blob }> => {
  const blob = opts?.original ? file : await compressImage(file, opts);
  const ref = await saveAsset(blob);
  // 阶段二 2.3：本地存好后尽力上传到后端，供其它设备安装/渲染。
  // 异步、不阻塞正文保存（图片同步失败不应让打字卡顿）。
  void uploadAssetToServer(ref, blob);
  return { ref, blob };
};
