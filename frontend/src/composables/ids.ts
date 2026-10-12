// 全局唯一 ID 生成。
//
// 为什么必须替换 Date.now()：
// - 同一毫秒内连续创建（快速回车、批量粘贴、批量复制）会产生重复 ID，
//   导致 Vue 的 :key 冲突、块定位错乱。
// - 后续接入 CRDT（Yjs / Automerge）做三端合并时，ID 必须全局唯一且稳定，
//   时间戳方案在多设备并发下必然碰撞。
//
// crypto.randomUUID 需要安全上下文（https / localhost / capacitor / tauri），
// 非安全上下文（如局域网 http 调试）下回退到带随机后缀的时间戳。
const fallbackId = (prefix: string) =>
  `${prefix}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const newId = (prefix = ''): string => {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') {
    return `${prefix}${c.randomUUID()}`;
  }
  return fallbackId(prefix);
};

// 块 ID（前缀便于调试时区分类型）
export const newBlockId = () => newId('b-');
// 页面 ID
export const newPageId = () => newId('p-');
