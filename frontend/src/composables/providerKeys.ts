// 图库 API Key 的本地存储。
//
// 为什么用独立键而不并入页面数据：
// Key 是用户凭据，不应被 WS 广播到其它设备，也不该出现在 Markdown 导出里。
// 因此单独一个 localStorage 键，与 nexus_matrix_pages_v3 完全隔离。
import { getStore } from './storage';

const KEY_STORAGE = 'nexus_image_provider_keys';

type KeyMap = Record<string, string>;

let cache: KeyMap | null = null;

const load = async (): Promise<KeyMap> => {
  if (cache) return cache;
  try {
    const raw = await getStore().get(KEY_STORAGE);
    cache = raw ? JSON.parse(raw) : {};
  } catch {
    cache = {};
  }
  return cache as KeyMap;
};

const persist = async (map: KeyMap) => {
  cache = map;
  await getStore().set(KEY_STORAGE, JSON.stringify(map));
};

export const getProviderKey = async (providerId: string): Promise<string> =>
  (await load())[providerId] ?? '';

export const setProviderKey = async (providerId: string, key: string): Promise<void> => {
  const map = await load();
  const next = { ...map };
  const trimmed = key.trim();
  if (trimmed) next[providerId] = trimmed;
  else delete next[providerId];
  await persist(next);
};
