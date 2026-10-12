import { ref, watch, type Ref } from 'vue';

// === 数据结构 ===
export interface Task {
  id: string;
  type: string;
  content: string;
  completed: boolean;
  indentLevel?: number;
  payload?: any;
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
let isInternalUpdate = false; // 标记：本次变更来自远端，不触发本地推送
let currentPagesRef: Ref<Page[]> | null = null;

// === 本地持久化 ===
export const loadLocal = (): Page[] | null => {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch (e) {
    console.error('[NEXUS SYNC] 本地数据反序列化失败', e);
    return null;
  }
};

export const saveLocal = (pages: Page[]) => {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(pages));
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
const persistPages = (pages: Page[]) => {
  const stamped = pages.map(p => ({ ...p, updatedAt: Date.now() }));
  saveLocal(stamped);
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
        // 本地优先：本地已有数据时忽略远端全量，防止陈旧服务端数据覆盖本地
        const existing = loadLocal();
        if (existing && existing.length > 0) {
          Promise.resolve().then(() => { remoteApplying = false; });
          return;
        }
        // 应用远端数据（关闭回环标记）
        remoteApplying = true;
        pagesRef.value = msg.data as Page[];
        saveLocal(pagesRef.value);
        // nextTick 后释放标记
        Promise.resolve().then(() => { remoteApplying = false; });
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
  const local = loadLocal();
  if (local) {
    pagesRef.value = local;
    saveLocal(local); // 立刻写回，确保键存在
  }

  // 2) 远端握手：仅当本地为空时才以远端为准（首次装机/换设备场景）
  const remote = await fetchRemotePages();
  if (!local && remote) {
    pagesRef.value = remote;
    saveLocal(remote);
  } else if (local && remote) {
    // 本地与远端都有：保留本地，但把本地上推到服务端，让服务端对齐最新（避免陈旧种子）
    await pushAll(pagesRef.value);
  } else if (local && !remote) {
    // 后端不可用或为空：保持本地并尝试上推
    await pushAll(pagesRef.value);
  } else if (!local && !remote) {
    // 本地与远端都无数据：创建初始默认页（仅首次装机）
    const now = Date.now().toString();
    const seed: Page[] = [{
      id: 'default-page',
      title: 'NEXUS 协议指南',
      parentId: null,
      isFavorite: true,
      isExpanded: true,
      tasks: [
        { id: now + '-1', type: 'h1', content: '欢迎使用 NEXUS MATRIX', completed: false, indentLevel: 0 },
        { id: now + '-2', type: 'text', content: '这是一个本地优先（LocalFirst）的工业风区块编辑器。', completed: false, indentLevel: 0 },
        { id: now + '-3', type: 'bullet', content: '输入 / 唤出命令菜单，或 # / - / [] 快捷转换块类型。', completed: false, indentLevel: 1 },
        { id: now + '-4', type: 'todo', content: '数据保存在本机，刷新不会丢失。', completed: false, indentLevel: 1 },
      ],
    }];
    pagesRef.value = seed;
    saveLocal(seed);
    await pushAll(seed);
  }

  // 3) 本地持久化 + 变更广播（防抖 500ms，降低写入频率）
  watch(pagesRef, (newVal) => {
    // 远端应用期间的变更不回推，避免无限回环
    if (remoteApplying) return;
    debouncedPersist(newVal);
  }, { deep: true });

  // 4) 建立 WebSocket
  connectWS(pagesRef);

  return !!remote;
};
