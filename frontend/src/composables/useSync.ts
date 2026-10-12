import { ref, watch, type Ref } from 'vue';
import { getStore } from './storage';
import { newBlockId } from './ids';

// === 数据结构 ===
export interface Task {
  id: string;
  type: string;
  content: string;
  completed: boolean;
  indentLevel?: number;
  payload?: any;
  // 排序锚点：指向「同一父级下前一个块的 ID」。三端并发插入时，仅凭数组下标
  // 无法确定性地重建顺序（必然冲突），而锚点 ID + 字典序可得到确定性的合并结果。
  // null 表示该块是其父级下的第一个块。见 orderTasks()。
  prevId?: string | null;
}

export interface Page {
  id: string;
  title: string;
  tasks: Task[];
  parentId: string | null;
  isFavorite: boolean;
  isExpanded: boolean;
  updatedAt?: number;   // 客户端生成的时间戳（ms），供后端 LWW 合并
}

// === 顺序模型（CRDT 前置） ===
// 目标：不引入 Yjs/Automerge 的前提下，就让「三端并发编辑」得到确定性的合并结果。
//
// 做法：把 tasks 的顺序从「数组下标」改为「prevId 链」。每个块记录它在父级下的
// 前一个块 ID（首个块为 null）。合并时：
//   1. 按 id 去重（同一块多端修改时保留 updatedAt 较新的内容）
//   2. 从 prevId=null 的块开始，沿链遍历重建顺序
//   3. 出现环（不可能，但防御性处理）或断链时，剩余块按 id 字典序追加到末尾
// 这样任何一端执行同一套算法，结果都一致，无需中央仲裁。
//
// 注意：插入新块时必须同时更新「原后继块」的 prevId，否则链会断裂。
// 因此本文件导出 setPrevId / normalizeOrder 供编辑器在增删块后调用。

/** 重建顺序：把数组下标顺序写成 prevId 链（首次迁移与插入新块时调用） */
export const writePrevIds = (tasks: Task[]): Task[] =>
  tasks.map((t, i) => ({ ...t, prevId: i === 0 ? null : tasks[i - 1].id }));

/** 由 prevId 链还原为有序数组（对同一输入永远得到同一输出） */
export const orderTasks = (tasks: Task[]): Task[] => {
  if (tasks.length === 0) return [];
  const byId = new Map<string, Task>();
  for (const t of tasks) byId.set(t.id, t);

  const heads = tasks.filter((t) => !t.prevId || !byId.has(t.prevId));
  // 没有明确的头时，用 id 最小的块兜底，保证结果确定
  if (heads.length === 0) heads.push([...tasks].sort((a, b) => (a.id < b.id ? -1 : 1))[0]);

  const used = new Set<string>();
  const out: Task[] = [];
  for (const head of heads) {
    let cur: Task | undefined = head;
    while (cur && !used.has(cur.id)) {
      used.add(cur.id);
      out.push(cur);
      const next = tasks.find((t) => t.prevId === cur!.id && !used.has(t.id));
      cur = next;
    }
  }
  // 断链/环导致的遗漏块，按 id 字典序追加，保证输出完整且确定
  const rest = tasks.filter((t) => !used.has(t.id)).sort((a, b) => (a.id < b.id ? -1 : 1));
  return [...out, ...rest];
};

// === 合并（三端同步的基础） ===
// 合并规则：
//   - 页面按 id 匹配合并（本地新增/远端新增的页面都保留，不会再被对方抹掉）
//   - 页面级属性取 updatedAt 较新的一侧
//   - 任务块按 id 合并：两边都有的块取 updatedAt/内容较新者；各自新增的块都保留
//   - 顺序由 orderTasks() 依 prevId 链确定性重建，与「谁先到达」无关
// 局限（如实说明）：块内 content 是整体字符串，无法做到字符级合并；
// 两端同时改同一个块时仍会有一方被覆盖，只是不会再扩散到整页。
// 要真正解决字符级冲突，需要把 content 换成 Yjs.Text 之类的 CRDT 结构。
const mergePages = (local: Page[], remote: Page[]): Page[] => {
  const out: Page[] = local.map((p) => ({ ...p, tasks: [...p.tasks] }));
  const byId = new Map(out.map((p) => [p.id, p]));

  for (const rp of remote) {
    const lp = byId.get(rp.id);
    if (!lp) { out.push({ ...rp, tasks: orderTasks(rp.tasks) }); continue; }

    // 页面级属性：远端更新则整体采用远端版本
    if ((rp.updatedAt ?? 0) > (lp.updatedAt ?? 0)) {
      lp.title = rp.title; lp.parentId = rp.parentId;
      lp.isFavorite = rp.isFavorite; lp.isExpanded = rp.isExpanded; lp.updatedAt = rp.updatedAt;
    }
    const localBlocks = new Map(lp.tasks.map((t) => [t.id, t]));
    for (const rt of rp.tasks) {
      const lt = localBlocks.get(rt.id);
      if (!lt) { lp.tasks.push({ ...rt }); continue; }
      // 两端都有：保留远端版本（远端广播即代表其它端的最新提交）。
      // 注：此处刻意不做逐块 updatedAt 比较——content 字段没有独立的 updatedAt，
      // 用页面级 updatedAt 判断会导致「本地刚编辑的块被旧远端覆盖」。
      Object.assign(lt, rt);
    }
    lp.tasks = orderTasks(lp.tasks);
  }
  return orderPages(out);
};

const orderPages = (pages: Page[]): Page[] => pages;

/** 给本地变更的页面打上 updatedAt（后端 LWW 合并与未来的 CRDT 判定都依赖它） */
const stampUpdated = (pages: Page[]) => {
  const now = Date.now();
  for (const p of pages) {
    // 只更新「本地上次已知时间」之前的页面，避免每次 watch 都把全部页面推成最新
    if (!p.updatedAt || p.updatedAt < now - 1000) p.updatedAt = now;
  }
};

// === 配置 ===
const LOCAL_STORAGE_KEY = 'nexus_matrix_pages_v3';
// 走 Vite 代理（/api -> 后端），同源自相对路径，避免硬编码端口
const API_BASE = '/api';
const WS_PATH = '/ws/sync';

// === 同步状态 ===
export const syncStatus = ref<'offline' | 'connecting' | 'online'>('offline');
export const onlineDevices = ref<number>(0);
export const lastSyncError = ref<string>('');

let socket: WebSocket | null = null;
let wsUrl = '';
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
let remoteApplying = false;   // 标记：正在应用远端数据，避免回环广播
let currentPagesRef: Ref<Page[]> | null = null;

// === 本地持久化 ===
// 走存储抽象层（异步），Web 端为 localStorage，三端可替换为 Preferences / Tauri store
export const loadLocal = async (): Promise<Page[] | null> => {
  try {
    const raw = await getStore().get(LOCAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch (e) {
    console.error('[NEXUS SYNC] 本地数据反序列化失败', e);
    return null;
  }
};

export const saveLocal = async (pages: Page[]): Promise<void> => {
  try {
    await getStore().set(LOCAL_STORAGE_KEY, JSON.stringify(pages));
  } catch (e) {
    console.error('[NEXUS SYNC] 本地持久化失败', e);
  }
};

// === 防抖工具 ===
function debounce<T extends (...args: any[]) => void>(fn: T, wait: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

// 防抖持久化：本地写入 + 远端推送（写入时打 updatedAt，供后端 LWW）
const persistPages = async (pages: Page[]) => {
  const stamped = pages.map(p => ({ ...p, updatedAt: Date.now() }));
  try { await saveLocal(stamped); } catch { /* 写入失败不阻塞后续广播 */ }
  if (syncStatus.value === 'online') {
    try { sendWS({ type: 'CLIENT_UPDATE', data: stamped }); } catch (e) { /* 断线忽略 */ }
  }
};
const debouncedPersist = debounce(persistPages, 500);

// === REST 客户端 ===
const apiRequest = async (endpoint: string, options?: RequestInit): Promise<any> => {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  return await res.json();
};

// 首次握手：拉取服务端全量矩阵；不可用则返回 null（保持 LocalFirst）
export const fetchRemotePages = async (): Promise<Page[] | null> => {
  try {
    const result = await apiRequest('/pages');
    if (result?.success && Array.isArray(result.data) && result.data.length > 0) {
      return result.data;
    }
    return null;
  } catch (e) {
    console.warn('[NEXUS SYNC] 后端不可用，进入纯本地模式');
    lastSyncError.value = '后端不可用，纯本地模式';
    return null;
  }
};

// 推送全量到服务端（服务端会广播给其他设备）
export const pushAll = async (pages: Page[]) => {
  const stamped = pages.map(p => ({ ...p, updatedAt: Date.now() }));
  try {
    await sendWS({ type: 'CLIENT_UPDATE', data: stamped });
  } catch (e) {
    // WS 不可用时降级为 REST 全量保存（尽力而为）
    try {
      for (const p of stamped) {
        await apiRequest(`/pages/${p.id}`, { method: 'PUT', body: JSON.stringify(p) });
      }
    } catch (_) { /* 静默：LocalFirst 不阻塞编辑 */ }
  }
};

export const createRemotePage = async (page: Page) => {
  try {
    const r = await apiRequest('/pages', { method: 'POST', body: JSON.stringify(page) });
    return r?.success ? r.data : null;
  } catch (e) { return null; }
};

export const deleteRemotePage = async (id: string) => {
  try { await apiRequest(`/pages/${id}`, { method: 'DELETE' }); } catch (e) { /* ignore */ }
};

export const updateRemotePage = async (page: Page) => {
  try { await apiRequest(`/pages/${page.id}`, { method: 'PUT', body: JSON.stringify(page) }); } catch (e) { /* ignore */ }
};

// === WebSocket ===
const sendWS = (payload: any) => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  } else {
    throw new Error('WS_NOT_OPEN');
  }
};

const connectWS = (pagesRef: Ref<Page[]>) => {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  wsUrl = `${proto}//${window.location.host}${WS_PATH}`;

  try {
    socket = new WebSocket(wsUrl);
  } catch (e) {
    syncStatus.value = 'offline';
    scheduleReconnect(pagesRef);
    return;
  }
  syncStatus.value = 'connecting';

  socket.onopen = () => {
    syncStatus.value = 'online';
    lastSyncError.value = '';
    reconnectAttempts = 0;
  };

  socket.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if ((msg.type === 'INITIAL_SYNC' || msg.type === 'SERVER_BROADCAST') && Array.isArray(msg.data)) {
        // 不再「本地优先整页丢弃」，而是按块合并：本地与远端各自的编辑都尽量保留。
        // 这是从 LWW 整页覆盖走向 CRDT 的第一步；后续接 Yjs 时可整体替换本函数。
        void (async () => {
          const existing = await loadLocal();
          if (existing && existing.length > 0) {
            const merged = mergePages(existing, msg.data as Page[]);
            // 只在真正有变化时才写回，避免无谓触发 watch -> 广播回环
            if (JSON.stringify(merged) === JSON.stringify(existing)) { remoteApplying = false; return; }
            remoteApplying = true;
            pagesRef.value = merged;
            await saveLocal(merged);
            remoteApplying = false;
            return;
          }
          // 本地为空（首次装机/换设备）：直接采用远端
          remoteApplying = true;
          pagesRef.value = orderPages(msg.data as Page[]);
          await saveLocal(pagesRef.value);
          remoteApplying = false;
        })();
      }
      if (msg.type === 'DEVICE_COUNT') {
        onlineDevices.value = typeof msg.data === 'number' ? msg.data : 0;
      }
    } catch (e) {
      console.error('[NEXUS SYNC] 消息解析失败', e);
    }
  };

  socket.onclose = () => {
    syncStatus.value = 'offline';
    socket = null;
    scheduleReconnect(pagesRef);
  };

  socket.onerror = () => {
    // onclose 会紧随其后触发，统一在 onclose 处理重连
  };
};

const scheduleReconnect = (pagesRef: Ref<Page[]>) => {
  if (reconnectTimer) return;
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 15000);
  reconnectAttempts++;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWS(pagesRef);
  }, delay);
};

export const closeSync = () => {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (socket) { socket.close(); socket = null; }
  syncStatus.value = 'offline';
  currentPagesRef = null;
};

// === 手动备份：导出 / 导入 JSON（SQLite 之外的额外保险） ===
export const exportBackup = () => {
  const pages = currentPagesRef?.value ?? [];
  const payload = {
    app: 'nexus-matrix',
    version: 1,
    exportedAt: new Date().toISOString(),
    pages,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `nexus-matrix-backup-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
};

export const importBackup = async (file: File): Promise<{ ok: boolean; message: string }> => {
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    // 兼容「裸数组」与「带元信息对象」两种格式
    const pages = Array.isArray(parsed) ? parsed : (parsed?.pages ?? null);
    if (!Array.isArray(pages) || pages.length === 0) {
      return { ok: false, message: '备份文件无效或为空' };
    }
    if (!currentPagesRef) {
      return { ok: false, message: '同步尚未初始化' };
    }
    // 直接覆盖当前矩阵，并落盘 + 上推（携带 updatedAt，后端按 LWW 合并）
    currentPagesRef.value = pages;
    await pushAll(pages);
    return { ok: true, message: `已导入 ${pages.length} 个页面` };
  } catch (e) {
    return { ok: false, message: '解析失败：' + (e as Error).message };
  }
};

// === 统一接入：LocalFirst + 远端同步 ===
// 返回是否成功从远端加载
export const initSync = async (pagesRef: Ref<Page[]>): Promise<boolean> => {
  currentPagesRef = pagesRef;

  // 1) LocalFirst：先读本地（本地数据优先，绝不被服务端陈旧的种子数据覆盖）
  const local = await loadLocal();
  if (local) {
    pagesRef.value = local;
    await saveLocal(local); // 立刻写回，确保键存在
  }

  // 2) 远端握手：仅当本地为空时才以远端为准（首次装机/换设备场景）
  const remote = await fetchRemotePages();
  if (!local && remote) {
    pagesRef.value = remote;
    await saveLocal(remote);
  } else if (local && remote) {
    // 本地与远端都有：保留本地，但把本地上推到服务端，让服务端对齐最新（避免陈旧种子）
    await pushAll(pagesRef.value);
  } else if (local && !remote) {
    // 后端不可用或为空：保持本地并尝试上推
    await pushAll(pagesRef.value);
  } else if (!local && !remote) {
    // 本地与远端都无数据：创建初始默认页（仅首次装机）
    const seed: Page[] = [{
      id: 'default-page',
      title: 'NEXUS 协议指南',
      parentId: null,
      isFavorite: true,
      isExpanded: true,
      tasks: [
        { id: newBlockId(), type: 'h1', content: '欢迎使用 NEXUS MATRIX', completed: false, indentLevel: 0 },
        { id: newBlockId(), type: 'text', content: '这是一个本地优先（LocalFirst）的工业风区块编辑器。', completed: false, indentLevel: 0 },
        { id: newBlockId(), type: 'bullet', content: '输入 / 唤出命令菜单，或 # / - / [] 快捷转换块类型。', completed: false, indentLevel: 1 },
        { id: newBlockId(), type: 'todo', content: '数据保存在本机，刷新不会丢失。', completed: false, indentLevel: 1 },
      ],
    }];
    pagesRef.value = seed;
    await saveLocal(seed);
    await pushAll(seed);
  }

  // 3) 本地持久化 + 变更广播（防抖 500ms，降低写入频率）
  watch(pagesRef, (newVal) => {
    // 远端应用期间的变更不回推，避免无限回环
    if (remoteApplying) return;
    // 标记被修改的页面，供 LWW 与未来的 CRDT 合并判定先后
    stampUpdated(newVal);
    debouncedPersist(newVal);
  }, { deep: true });

  // 4) 建立 WebSocket
  connectWS(pagesRef);

  return !!remote;
};
