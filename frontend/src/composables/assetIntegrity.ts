// Phase 0 资产层止血：资产引用完整性扫描与孤儿 GC 的前端封装。
// 后端提供 GET /api/assets/integrity 与 POST /api/assets/gc（见 backend/main.py）。
import {getRuntimeConfig} from '../runtimeConfig';
import {apiFetch} from './nativeHttp';

// 与 useSync.ts 一致：原生 WebView 的 https://localhost 是本地资源源，不能当后端。
const _pageOrigin =
  typeof window !== 'undefined'
  && /^https?:$/.test(window.location.protocol)
  && window.location.hostname !== 'localhost'
    ? window.location.origin
    : '';
const SYNC_SERVER = (
  getRuntimeConfig().syncServer ||
  (import.meta as any).env?.VITE_SYNC_SERVER ||
  _pageOrigin
).replace(/\/+$/, '');
const SYNC_API_KEY = (getRuntimeConfig().apiKey || (import.meta as any).env?.VITE_API_KEY || '').trim();
const BASE = SYNC_SERVER ? `${SYNC_SERVER}/api` : '/api';

export interface AssetIntegrity {
  referenced_count: number;
  total_assets: number;
  missing_refs: string[];
  orphan_assets: string[];
}

export const checkAssetIntegrity = async (): Promise<AssetIntegrity> => {
  const res = await apiFetch(`${BASE}/assets/integrity`, {
    headers: SYNC_API_KEY ? { Authorization: `Bearer ${SYNC_API_KEY}` } : {},
  });
  if (!res.ok) throw new Error('资产体检失败');
  return (await res.json()) as AssetIntegrity;
};

export interface GcResult {
  dry_run: boolean;
  deleted: number;
  orphan_count: number;
}

export const gcOrphanAssets = async (dryRun = true): Promise<GcResult> => {
  const res = await apiFetch(`${BASE}/assets/gc?dry_run=${dryRun}`, {
    method: 'POST',
    headers: SYNC_API_KEY ? { Authorization: `Bearer ${SYNC_API_KEY}` } : {},
  });
  if (!res.ok) throw new Error('清理孤儿资产失败');
  return (await res.json()) as GcResult;
};
