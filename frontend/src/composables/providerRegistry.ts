// Provider 注册表。新增自填式图库只需在 PROVIDERS 里加一行。
//
// 平台运营时走 PLATFORM_PROVIDER：密钥由后端 .env 统一配置，前端只调本服务的
// /api/cover/* 代理，用户无需申请或填写任何 Key。平台未配置时回退到 PROVIDERS
// （用户自填 Key 的直连模式），保留纯本地 / 自建场景的可用性。
import {apiFetch} from './nativeHttp';
import {getRuntimeConfig} from '../runtimeConfig';
import {saveImageAsset} from './assets';
import {getProviderKey} from './providerKeys';
import type {CoverMeta, CoverPhoto, ImageProvider} from './imageProviders';
import {unsplashProvider} from './providers/unsplash';

const _pageOrigin =
  typeof window !== 'undefined'
  && /^https?:$/.test(window.location.protocol)
  && window.location.hostname !== 'localhost'
    ? window.location.origin
    : '';
const SYNC_SERVER = (getRuntimeConfig().syncServer || (import.meta as any).env?.VITE_SYNC_SERVER || _pageOrigin || '').replace(/\/+$/, '');
const API_BASE = SYNC_SERVER ? `${SYNC_SERVER}/api` : '/api';
const API_KEY = (getRuntimeConfig().apiKey || (import.meta as any).env?.VITE_API_KEY || '').trim();

const coverApi = async (path: string): Promise<any> => {
  const res = await apiFetch(`${API_BASE}${path}`, {
    headers: API_KEY ? {Authorization: `Bearer ${API_KEY}`} : {},
  });
  if (!res.ok) throw new Error(`图库服务不可用：HTTP ${res.status}`);
  return res.json();
};

/** 平台是否已配置图库密钥。失败（纯本地 / 后端下线）时静默回退到自填模式。
 *  只缓存「已启用」的结果：一键添加不必每次多跑一次探测；未启用不缓存，
 *  管理员配好 Key 重启后端后能立刻生效。 */
let _platformEnabledAt = 0;
export const isPlatformGalleryEnabled = async (): Promise<boolean> => {
  if (_platformEnabledAt && Date.now() - _platformEnabledAt < 5 * 60 * 1000) return true;
  try {
    const r = await coverApi('/cover/config');
    if (r?.enabled) {
      _platformEnabledAt = Date.now();
      return true;
    }
  } catch {
    return false;
  }
  return false;
};

/** 平台代理 Provider：无 Key、无跨域、服务端统一缓存与合规计数。 */
export const PLATFORM_PROVIDER: ImageProvider = {
  id: 'platform',
  name: '精选图库',
  needsKey: false,
  keyHelpUrl: '',

  async search(query, page, _key, exclude = [], refresh = false) {
    // 服务端一次给一批（已过滤本账号用过的），前端不再分页；「换一批」由 refresh 触发。
    if (page > 1) return [];
    const qs = new URLSearchParams();
    if (query.trim()) qs.set('query', query.trim());
    if (exclude.length) qs.set('exclude', exclude.join(','));
    if (refresh) qs.set('refresh', '1');
    const r = await coverApi(`/cover/gallery?${qs.toString()}`);
    if (!r?.success) throw new Error(r?.error || '图库加载失败');
    return (r.data ?? []) as CoverPhoto[];
  },

  onSelected(photo) {
    // Unsplash 合规要求：选用时通知 download 计数端点，由服务端代发（密钥不出后端）
    void coverApi(`/cover/download/${encodeURIComponent(photo.id)}`).catch(() => {});
  },
};

/** 自填 Key 的直连图库，仅作平台未配置时的回退。 */
export const PROVIDERS: ImageProvider[] = [unsplashProvider];

export const getProvider = (id: string): ImageProvider | undefined =>
  PROVIDERS.find((p) => p.id === id);

/**
 * 把图库图片下载成本地 asset，返回 `asset:<id>` 引用。
 * 选择器点选与「一键随机封面」共用，避免两处下载/落盘逻辑漂移。
 */
export const saveGalleryPhoto = async (photo: CoverPhoto): Promise<string> => {
  if (!photo.fullUrl) throw new Error('图库未返回图片地址');
  let url: URL;
  try { url = new URL(photo.fullUrl, window.location.href); } catch { throw new Error('图库图片地址无效'); }
  if (!/^https:$/i.test(url.protocol)) throw new Error('仅支持 HTTPS 图片');
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`图片下载失败（HTTP ${res.status}）`);
  const blob = await res.blob();
  // 封面存为独立资产，页面 JSON 里只留 asset: 引用（理由同图片块）
  return saveImageAsset(new File([blob], 'cover.jpg', { type: blob.type || 'image/jpeg' }));
};

/**
 * 一键随机封面：直接从图库源取一张「本账号没用过」的图并落成本地 asset。
 * 平台已配置密钥时用户零操作；未配置且没自填 Key 时返回 null，由调用方回退到设置面板。
 */
export const fetchRandomCover = async (
  usedIds: string[],
): Promise<{ cover: string; meta: CoverMeta } | null> => {
  const enabled = await isPlatformGalleryEnabled();
  const provider = enabled ? PLATFORM_PROVIDER : PROVIDERS[0];
  if (!provider) return null;
  const key = enabled ? '' : await getProviderKey(provider.id);
  if (!enabled && !key) return null;

  // refresh=true：每次点「添加封面」都换一批，不会反复给同一张
  const photos = await provider.search('', 1, key, usedIds, true);
  const used = new Set(usedIds);
  const photo = photos.find((p) => !used.has(p.id));
  if (!photo) return null;

  const cover = await saveGalleryPhoto(photo);
  provider.onSelected?.(photo, key);   // 合规：选用计数（平台模式由后端代发）
  return {
    cover,
    meta: {
      photoId: photo.id,
      author: photo.author,
      authorUrl: photo.authorUrl,
      // 平台代理的 Provider 名是「精选图库」，署名必须写真实图库名
      source: enabled ? 'Unsplash' : provider.name,
      sourceUrl: photo.sourceUrl,
    },
  };
};
