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

/**
 * 阶段二 2.3：把本地资产上传到后端（尽力而为，不阻塞正文保存）。
 * 离线或后端不可用时静默失败——本地已存，待下次有网时由 resolveAsset 的回源
 * 路径触发补传（另一设备来取时本端不一定在线，故采用「按需回源」而非预推送）。
 */
export const uploadAssetToServer = async (ref: string, blob: Blob): Promise<void> => {
  if (!SYNC_SERVER) return; // 纯本地模式（无 syncServer）无需上传
  try {
    const buf = await blob.arrayBuffer();
    const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
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
  try {
    const res = await fetch(`${ASSET_API_BASE}/assets/${ref.slice(ASSET_PREFIX.length)}`);
    if (!res.ok) return null;
    const blob = await res.blob();
    // 落本地，避免每次渲染都跨网
    const id = ref.slice(ASSET_PREFIX.length);
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

/** 把 asset: 引用还原成可直接用于 <img src> 的 URL */
export const resolveAsset = async (ref: string): Promise<string> => {
  const cached = blobUrlCache.get(ref);
  if (cached) return cached;
  let blob = await getAsset(ref);
  // 阶段二 2.3：本地 miss → 从后端回源（其它设备上传过的图片）
  if (!blob) {
    blob = await fetchAssetFromServer(ref);
  }
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
  const ref = await saveAsset(blob);
  // 阶段二 2.3：本地存好后尽力上传到后端，供其它设备安装/渲染。
  // 异步、不阻塞正文保存（图片同步失败不应让打字卡顿）。
  void uploadAssetToServer(ref, blob);
  return ref;
};
