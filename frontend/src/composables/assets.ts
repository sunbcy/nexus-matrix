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

import { newId } from './ids';

export const ASSET_PREFIX = 'asset:';

const DB_NAME = 'nexus-matrix';
const DB_VERSION = 2; // 1 -> 2：新增 assets object store
const ASSET_STORE = 'assets';

let dbPromise: Promise<IDBDatabase> | null = null;

const openDB = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(ASSET_STORE)) db.createObjectStore(ASSET_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('打开 IndexedDB 失败'));
  });
  return dbPromise;
};

/** 存入 Blob，返回 asset:<id> 引用 */
export const saveAsset = async (blob: Blob): Promise<string> => {
  const id = newId();
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ASSET_STORE, 'readwrite');
    tx.objectStore(ASSET_STORE).put(blob, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('保存图片资产失败'));
    tx.onabort = () => reject(tx.error ?? new Error('保存图片资产被中止'));
  });
  return `${ASSET_PREFIX}${id}`;
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

export const isAssetRef = (url: unknown): url is string =>
  typeof url === 'string' && url.startsWith(ASSET_PREFIX);

// blob: URL 缓存：同一个 asset 在同一会话内复用同一个 URL，
// 避免每次渲染都新建 URL 导致 <img> 反复刷新。
const blobUrlCache = new Map<string, string>();

/** 把 asset: 引用还原成可直接用于 <img src> 的 URL */
export const resolveAsset = async (ref: string): Promise<string> => {
  const cached = blobUrlCache.get(ref);
  if (cached) return cached;
  const blob = await getAsset(ref);
  if (!blob) return '';
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
 * 上传时先降采样，避免原图直接进 IndexedDB 把配额吃光。
 */
const MAX_W = 1600;
const MAX_H = 1200;
const SMALL_ENOUGH = 400_000; // 小于此长度的 DataURL 直接采用，省一次解码

/** 读取文件并降采样为 JPEG Blob */
const compressImage = (file: Blob): Promise<Blob> =>
  new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve(file); // 读失败就用原文件，至少不丢功能
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(MAX_W / img.width, MAX_H / img.height, 1);
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
          0.82,
        );
      };
      img.onerror = () => resolve(file);
      img.src = String(reader.result ?? '');
    };
    reader.readAsDataURL(file);
  });

export const saveImageAsset = async (file: Blob): Promise<string> => {
  const blob = await compressImage(file);
  return saveAsset(blob);
};
