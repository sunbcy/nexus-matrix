import { describe, it, expect } from 'vitest';
import { newId, newBlockId, newPageId } from '../src/composables/ids';

// ID 是 CRDT 合并的前提：必须全局唯一、稳定、无时间戳碰撞。
// 若这里退化成 Date.now()，三端并发必然冲突——用测试把它钉死。

describe('newId', () => {
  it('带前缀', () => {
    expect(newId('x-')).toMatch(/^x-/);
    expect(newBlockId()).toMatch(/^b-/);
    expect(newPageId()).toMatch(/^p-/);
  });

  it('一万次调用无重复', () => {
    const set = new Set<string>();
    for (let i = 0; i < 10000; i++) set.add(newBlockId());
    expect(set.size).toBe(10000);
  });

  it('连续调用不产生碰撞（原 Date.now 的缺陷）', () => {
    // 同步紧挨着调用，时间戳方案在这里必然重复
    const a = newBlockId();
    const b = newBlockId();
    expect(a).not.toBe(b);
  });

  it('非安全上下文回退仍唯一', () => {
    // 模拟 crypto.randomUUID 不可用（如局域网 http 调试）——
    // 注意 crypto 是只读 getter，不能整体替换，只能删掉 randomUUID 方法
    const c = (globalThis as any).crypto;
    if (!c) return; // 环境本身就没有 crypto，已是回退路径
    const orig = c.randomUUID;
    try {
      delete c.randomUUID;
      const set = new Set<string>();
      for (let i = 0; i < 5000; i++) set.add(newId());
      expect(set.size).toBe(5000);
    } finally {
      c.randomUUID = orig;
    }
  });
});
