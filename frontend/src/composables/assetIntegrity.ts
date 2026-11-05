// Phase 0 资产层止血：资产引用完整性扫描与孤儿 GC 的前端封装。
// 后端提供 GET /api/assets/integrity 与 POST /api/assets/gc（见 backend/main.py）。
import {getRuntimeConfig} from '../runtimeConfig';

const SYNC_SERVER = (
  getRuntimeConfig().syncServer ||
  (import.meta as any).env?.VITE_SYNC_SERVER ||
  (typeof window !== 'undefined' ? window.location.origin : '')
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
  const res = await fetch(`${BASE}/assets/integrity`, {
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
  const res = await fetch(`${BASE}/assets/gc?dry_run=${dryRun}`, {
    method: 'POST',
    headers: SYNC_API_KEY ? { Authorization: `Bearer ${SYNC_API_KEY}` } : {},
  });
  if (!res.ok) throw new Error('清理孤儿资产失败');
  return (await res.json()) as GcResult;
};
