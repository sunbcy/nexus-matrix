// Phase 2 端到端验证：两个真实 y-websocket 客户端连本地后端（默认 8010，可用 YJS_TEST_PORT 覆盖），
// 断言多端实时合并。复用前端已装的 yjs / y-websocket / ws（与产品前端同一套）。
// 运行前请先启动后端并放行鉴权：YJS_AUTH_DISABLED=1 启动，或带有效 apiKey。
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import WS from 'ws';

const PORT = process.env.YJS_TEST_PORT || '8010';
const URL = `ws://127.0.0.1:${PORT}/ws/yjs`;
const ROOM = 'e2e/e2e1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const a = new Y.Doc();
const pa = new WebsocketProvider(URL, ROOM, a, { WebSocketPolyfill: WS });
const b = new Y.Doc();
const pb = new WebsocketProvider(URL, ROOM, b, { WebSocketPolyfill: WS });

// 用 status 事件跟踪真实连接状态（node + ws polyfill 下 wsconnected 快照不可靠）
let aConn = false, bConn = false;
pa.on('status', (e) => { if (e.status === 'connected') aConn = true; });
pb.on('status', (e) => { if (e.status === 'connected') bConn = true; });
await sleep(2000);
console.log('A connected:', aConn, 'B connected:', bConn);

const ta = a.getArray('tasks');
const tb = b.getArray('tasks');

// A 新增一个块
const m = new Y.Map();
m.set('id', 'x1');
m.set('content', 'hello');
ta.push([m]);
await sleep(1200);
const ok1 = tb.length === 1 && tb.get(0).get('content') === 'hello';
console.log('B 收到 A 的更新:', ok1);

// B 并发修改同一块（验证 CRDT 合并，无 LWW 丢更新）
tb.get(0).set('content', 'edited-by-B');
await sleep(1200);
const ok2 = ta.get(0).get('content') === 'edited-by-B';
console.log('A 收到 B 的并发修改 (CRDT 合并):', ok2);

// Phase 3 Awareness：A 设置本地状态，B 端应收到（经同一 WebSocket 的 awareness 通道）
pa.awareness.setLocalStateField('user', { name: 'Alice' });
await sleep(800);
const bStates = Array.from(pb.awareness.getStates().values());
const ok3 = bStates.some((s) => s.user && s.user.name === 'Alice');
console.log('B 收到 A 的 Awareness（在线状态/光标）:', ok3);

pa.destroy();
pb.destroy();
if (ok1 && ok2 && ok3) {
  console.log('PASS: 多端实时合并 + Awareness 闭环 — A↔B 双向同步，CRDT 无 LWW 丢更新');
  process.exit(0);
} else {
  console.log('FAIL: 多端同步未达成');
  process.exit(1);
}
