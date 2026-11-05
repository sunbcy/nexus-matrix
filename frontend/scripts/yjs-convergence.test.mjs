// Phase 1 收敛验证：纯 yjs 模拟「双端并发编辑同一文档」并断言 CRDT 收敛。
// 不依赖浏览器/后端/安卓，可在 CI/命令行跑通，作为「切 Yjs 后冲突不再发散」的可信证据。
//
// 场景：客户端 A 软删除块 'b'，同时客户端 B 修改块 'b' 的 content。
//   - 在旧架构 LWW 下：删除与修改会因时间戳冲突丢其一（本次对话的"删了又回来/丢更新"根因）。
//   - 在 CRDT 下：两者都应保留，且两端最终完全一致。
import * as Y from 'yjs';

function makeDoc() {
  const doc = new Y.Doc();
  const arr = doc.getArray('tasks');
  for (const id of ['a', 'b', 'c']) {
    const m = new Y.Map();
    m.set('id', id);
    m.set('type', 'text');
    m.set('content', id.toUpperCase());
    m.set('deleted', false);
    const p = new Y.Map();
    p.set('url', '');
    p.set('alt', '');
    p.set('code', '');
    m.set('payload', p);
    arr.push([m]);
  }
  return doc;
}

const find = (arr, id) => {
  for (let i = 0; i < arr.length; i++) if (arr.get(i).get('id') === id) return arr.get(i);
  return null;
};

// 模拟网络：两端各自 doc，互相 apply 对方的 state update（等价 y-websocket 的广播）
function sync(a, b) {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
}

// 正确模拟「双端共享同一文档」：先造一个 base 文档，再把它的状态分别灌给 A、B，
// 让两端共享同一份初始历史（相同 item id），之后各自的修改都针对同一逻辑块。
const base = makeDoc();
const A = new Y.Doc();
const B = new Y.Doc();
Y.applyUpdate(A, Y.encodeStateAsUpdate(base));
Y.applyUpdate(B, Y.encodeStateAsUpdate(base));

// 并发操作
find(A.getArray('tasks'), 'b').set('deleted', true); // A 软删除
find(B.getArray('tasks'), 'b').set('content', 'B-edited'); // B 并发修改

sync(A, B); // 交换更新

const check = (doc) => {
  const arr = doc.getArray('tasks');
  const b = find(arr, 'b');
  return { len: arr.length, deleted: b.get('deleted'), content: b.get('content') };
};
const ca = check(A);
const cb = check(B);

console.log('A 视角:', ca);
console.log('B 视角:', cb);

let ok = true;
if (ca.len !== 3 || cb.len !== 3) {
  console.error('FAIL: 数组长度异常（应为 3，未出现重复块）');
  ok = false;
}
if (ca.deleted !== true || cb.deleted !== true) {
  console.error('FAIL: 软删除未在所有端生效');
  ok = false;
}
if (ca.content !== 'B-edited' || cb.content !== 'B-edited') {
  console.error('FAIL: 并发修改被 LWW 式覆盖丢失');
  ok = false;
}
if (JSON.stringify(ca) !== JSON.stringify(cb)) {
  console.error('FAIL: 两端状态未收敛');
  ok = false;
}

if (ok) {
  console.log('PASS: CRDT 收敛 — 删除与并发修改均保留，两端一致，无 LWW 丢更新');
  process.exit(0);
} else {
  process.exit(1);
}
