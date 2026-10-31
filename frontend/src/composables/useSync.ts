import {ref, type Ref, watch} from 'vue';
import {getStore} from './storage';
import {newBlockId, newPageId} from './ids';
import {getRuntimeConfig} from '../runtimeConfig';
import {collectAssetRefs, mergeImportOverwrite} from './importMerge';

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
  deletedAt?: number;   // 块级墓碑时间戳（ms）。与 Page.deletedAt 一致，块删除也走墓碑参与合并
  updatedAt?: number;   // 客户端生成的时间戳（ms），供块级 LWW 合并
}

export interface Page {
  id: string;
  title: string;
  tasks: Task[];
  parentId: string | null;
  isFavorite: boolean;
  isExpanded: boolean;
  updatedAt?: number;   // 客户端生成的时间戳（ms），供后端 LWW 合并
  icon?: string;        // 文档图标（Notion 的 Page Icon），单个 emoji 字符
  cover?: string;       // 页眉封面（Notion 的 Cover）：图片 URL/DataURL，或 `gradient:<id>`
  coverPos?: number;    // 封面垂直取景点，0=顶部 100=底部，默认 35（偏上，利于人像）。用于拖动重新构图
  deletedAt?: number;   // 墓碑时间戳（ms）。非空表示该页已被删除，参与同步合并，避免删除被另一端「复活」
  isTemplate?: boolean; // 模板页：从侧边栏树隐藏，收进「模板」区，可一键套用新建副本
  prevId?: string | null;  // 同一父级下的前一个页面 id（页面顺序链，与块的 prevId 同思路；根页也有链）
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

/** 重建顺序：把数组下标顺序写成 prevId 链（首次迁移与插入新块时调用）。墓碑块不参与链。 */
export const writePrevIds = (tasks: Task[]): Task[] => {
  let prev: string | null = null;
  return tasks.map((t) => {
    if (t.deletedAt) return t; // 墓碑不参与顺序链
    const out = { ...t, prevId: prev };
    prev = t.id;
    return out;
  });
};

/** 由 prevId 链还原为有序数组（对同一输入永远得到同一输出）。墓碑块不参与链，统一挪到末尾。 */
export const orderTasks = (tasks: Task[]): Task[] => {
  if (tasks.length === 0) return [];
  const dead = tasks.filter((t) => t.deletedAt);
  const live = tasks.filter((t) => !t.deletedAt);
  const byId = new Map(live.map((t) => [t.id, t]));

  const heads = live.filter((t) => !t.prevId || !byId.has(t.prevId));
  // 没有明确的头时，用 id 最小的块兜底，保证结果确定
  if (heads.length === 0) heads.push([...live].sort((a, b) => (a.id < b.id ? -1 : 1))[0]);

  const used = new Set<string>();
  const out: Task[] = [];
  for (const head of heads) {
    let cur: Task | undefined = head;
    while (cur && !used.has(cur.id)) {
      used.add(cur.id);
      out.push(cur);
      const next = live.find((t) => t.prevId === cur!.id && !used.has(t.id));
      cur = next;
    }
  }
  // 断链/环导致的遗漏块，按 id 字典序追加，保证输出完整且确定
  const rest = live.filter((t) => !used.has(t.id)).sort((a, b) => (a.id < b.id ? -1 : 1));
  // 墓碑块保留在数组尾部，随同步上推让各端消化删除（渲染/导出/搜索已过滤）
  return [...out, ...rest, ...dead];
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
/**
 * 页面级标量的逐字段合并：谁的时间戳新就采用谁。
 * 不做整页替换——否则「改了标题」会连带把另一端刚编辑的 icon/cover 冲掉。
 */
const PAGE_SCALAR_FIELDS = ['title', 'icon', 'cover', 'parentId', 'isFavorite', 'isExpanded'] as const;

const mergePages = (local: Page[], remote: Page[]): Page[] => {
  const out: Page[] = local.map((p) => ({ ...p, tasks: [...p.tasks] }));
  const byId = new Map(out.map((p) => [p.id, p]));

  for (const rp of remote) {
    const lp = byId.get(rp.id);
    // 墓碑（远端已删除）：无论本地是否仍存在，都按「删除时间戳较新」剔除本地页。
    // 否则已删页面会被另一端的下一次 CLIENT_UPDATE 推回来「复活」。
    // 仅当本地页面的删除戳比远端更晚时才保留本地（极端并发：本地后删、远端先删）。
    if (rp.deletedAt) {
      if (lp && !(lp.deletedAt && (lp.deletedAt ?? 0) > (rp.deletedAt ?? 0))) {
        const idx = out.findIndex((p) => p.id === rp.id);
        if (idx >= 0) out.splice(idx, 1);
      }
      continue;
    }
    if (!lp) { out.push({ ...rp, tasks: orderTasks(rp.tasks) }); continue; }

    // 页面级标量：逐字段按 updatedAt 比较。
    // 远端更新 → 采用远端；否则保留本地。这样「本端刚改的字段」不会被旧远端覆盖。
    const remoteNewer = (rp.updatedAt ?? 0) > (lp.updatedAt ?? 0);
    if (remoteNewer) {
      for (const f of PAGE_SCALAR_FIELDS) {
        (lp as unknown as Record<string, unknown>)[f] = (rp as unknown as Record<string, unknown>)[f];
      }
      lp.updatedAt = rp.updatedAt;
    }

    // 块级：逐块比较 block.updatedAt。
    // 这是阶段一的核心修复——原先是 Object.assign(lt, rt) 无条件用远端覆盖，
    // 导致 500ms 防抖窗口内刚编辑的块被任何到达的广播吞掉（且无任何提示）。
    const localBlocks = new Map(lp.tasks.map((t) => [t.id, t]));
    for (const rt of rp.tasks) {
      const lt = localBlocks.get(rt.id);
      // 远端块是墓碑：标记本地对应块为删除。删除戳具有权威性，避免旧内容被拉回。
      // 本地根本没有该块时，不新增死块（它本就不存在，无需「复活」）。
      if (rt.deletedAt) {
        if (lt) {
          lt.deletedAt = rt.deletedAt;
          (lt as { updatedAt?: number }).updatedAt = (rt as { updatedAt?: number }).updatedAt ?? lt.updatedAt;
        }
        continue;
      }
      // 本端没有的块：直接加入（另一端新增的）
      if (!lt) { lp.tasks.push({ ...rt }); continue; }
      // 两端都有：谁的块时间戳新就保留谁。
      // 块没有 updatedAt（旧数据）时退化为「远端优先」，与历史行为一致，不至于丢块。
      const ltTs = (lt as { updatedAt?: number }).updatedAt ?? 0;
      const rtTs = (rt as { updatedAt?: number }).updatedAt ?? 0;
      if (rtTs >= ltTs) {
        Object.assign(lt, rt);
      }
    }
    lp.tasks = orderTasks(lp.tasks);
  }
  return orderPages(out);
};

// 页面顺序链：按当前数组顺序，为每个父级分组重写 prevId（同块的 writePrevIds 思路）。
// 只改顺序字段、不碰内容（也不改 updatedAt），返回新数组供原位替换。
export const writePagePrevIds = (pages: Page[]): Page[] => {
  const lastByParent = new Map<string, string>();
  return pages.map((p) => {
    const key = p.parentId ?? '__root__';
    const prev = lastByParent.get(key) ?? null;
    lastByParent.set(key, p.id);
    return { ...p, prevId: prev };
  });
};

// 按 prevId 链还原页面顺序（替换此前的 no-op）：同父级的页按链排列，
// 使侧边栏 getChildren / buildTree 消费到的顺序确定；断链 / 环 / 多头按原数组顺序兜底，绝不丢页。
const orderPages = (pages: Page[]): Page[] => {
  const byParent = new Map<string, Page[]>();
  const parentOrder: string[] = [];
  for (const p of pages) {
    const key = p.parentId ?? '__root__';
    if (!byParent.has(key)) { byParent.set(key, []); parentOrder.push(key); }
    byParent.get(key)!.push(p);
  }
  const orderGroup = (group: Page[]): Page[] => {
    const idSet = new Set(group.map((p) => p.id));
    const result: Page[] = [];
    const seen = new Set<string>();
    const walk = (start: Page) => {
      let cur: Page | undefined = start;
      while (cur && !seen.has(cur.id)) {
        seen.add(cur.id);
        result.push(cur);
        cur = group.find((p) => p.prevId === cur!.id && !seen.has(p.id));
      }
    };
    for (const p of group) if (!p.prevId || !idSet.has(p.prevId)) walk(p);   // 头节点沿链走
    for (const p of group) if (!seen.has(p.id)) { seen.add(p.id); result.push(p); }  // 断链/成环兜底，保证不丢页
    return result;
  };
  const out: Page[] = [];
  for (const key of parentOrder) out.push(...orderGroup(byParent.get(key)!));
  return out;
};

/**
 * 给本地变更的页面/块打上 updatedAt（块级 LWW 的判定依据）。
 *
 * 页面级：只在页面**内容真的变了**时才打戳（用内容哈希比对），
 * 不再「无条件每次 watch 都推成最新」——那是「启动即覆盖另一端」的直接成因。
 *
 * 块级：同样只在块内容真的变了时才打戳，这样 mergePages 才能逐块判断谁更新。
 */
const pageFingerprint = (p: Page): string =>
  JSON.stringify([
    p.title, p.icon, p.cover, p.parentId, p.isFavorite, p.isExpanded, p.deletedAt ?? 0, p.isTemplate ?? false,
    // 块只取「内容」参与指纹，不取块自身的 updatedAt——否则打戳本身就会改变指纹
    p.tasks.map((t) => [t.id, t.type, t.content, t.completed, t.indentLevel, t.deletedAt ?? 0]),
  ]);

// 上一次打戳时各页/各块的内容指纹，用于判断「是否真的变了」
const pageStampCache = new Map<string, string>();
const blockStampCache = new Map<string, string>();

// onlyIds：只指纹这些页（调用方已明确知道哪些页动过）。
// 不给时按全量处理（结构变化等低频场景）。
const stampUpdated = (pages: Page[], onlyIds?: string[]): string[] => {
  const now = Date.now();
  const changed: string[] = [];
  const filter = onlyIds ? new Set(onlyIds) : null;
  for (const p of pages) {
    if (filter && !filter.has(p.id)) continue;
    const fp = pageFingerprint(p);
    if (pageStampCache.get(p.id) === fp) continue;   // 内容没变 → 不打戳
    pageStampCache.set(p.id, fp);
    p.updatedAt = now;
    changed.push(p.id);

    for (const t of p.tasks as unknown as Array<Record<string, unknown>>) {
      const bfp = JSON.stringify([t.type, t.content, t.completed, t.indentLevel, t.deletedAt ?? 0]);
      if (blockStampCache.get(String(t.id)) === bfp) continue;  // 块没变 → 不打戳
      blockStampCache.set(String(t.id), bfp);
      t.updatedAt = now;
    }
  }
  return changed;
};

// === 页面历史版本（本地快照，不同步；独立 pageHistory store，按变化页节流保存） ===
export interface PageVersion { ts: number; title: string; tasks: Task[]; }
const HISTORY_MAX = 30;          // 每页最多保留的版本数
const HISTORY_INTERVAL = 60_000; // 同页 60s 内只存一个版本，避免每次击键都存档
const lastSnapAt = new Map<string, number>();

export const getPageHistory = async (pageId: string): Promise<PageVersion[]> => {
  try {
    const { pageHistoryGet } = await import('./idbStore');
    const v = await pageHistoryGet(pageId);
    return Array.isArray(v) ? (v as PageVersion[]) : [];
  } catch {
    return [];
  }
};

const savePageVersion = async (pageId: string, version: PageVersion): Promise<void> => {
  try {
    const { pageHistoryGet, pageHistorySet } = await import('./idbStore');
    const prev = await pageHistoryGet(pageId);
    const list = Array.isArray(prev) ? (prev as PageVersion[]).slice() : [];
    list.push(version);
    while (list.length > HISTORY_MAX) list.shift();
    await pageHistorySet(pageId, list);
  } catch { /* 历史存储失败不影响主流程 */ }
};

export const deletePageVersion = async (pageId: string, ts: number): Promise<PageVersion[]> => {
  try {
    const { pageHistoryGet, pageHistorySet } = await import('./idbStore');
    const prev = await pageHistoryGet(pageId);
    const next = (Array.isArray(prev) ? (prev as PageVersion[]) : []).filter((v) => v.ts !== ts);
    await pageHistorySet(pageId, next);
    return next;
  } catch {
    return [];
  }
};

export const clearPageHistory = async (pageId: string): Promise<void> => {
  try {
    const { pageHistoryRemove } = await import('./idbStore');
    await pageHistoryRemove(pageId);
  } catch { /* noop */ }
};

// 对刚发生变化的页存档一个版本（节流 + 跳过墓碑页）
const snapshotPages = async (pages: Page[], changedIds: string[]) => {
  const now = Date.now();
  const changed = new Set(changedIds);
  for (const p of pages) {
    if (!changed.has(p.id) || p.deletedAt) continue;
    const last = lastSnapAt.get(p.id) ?? 0;
    if (now - last < HISTORY_INTERVAL) continue;
    lastSnapAt.set(p.id, now);
    await savePageVersion(p.id, { ts: now, title: p.title, tasks: JSON.parse(JSON.stringify(p.tasks)) as Task[] });
  }
};

// === 历史数据清洗 ===
// 早期版本把粘贴的图片以 <img src="blob:..."> 内联存进 content。
// blob: URL 随文档卸载即失效，重启后必然变成破图。这里在加载时把这些死链接清掉，
// 让存量数据不会一直显示破碎图标（图片本身已无法恢复，但至少不留残留）。
const stripDeadBlobImages = (html: string): string => {
  if (html.indexOf('blob:') === -1) return html;
  return html
    .replace(/<img\b[^>]*\bsrc\s*=\s*["']blob:[^"']*["'][^>]*>/gi, '')
    .replace(/(\s|&nbsp;)+$/g, '');
};

export const sanitizeLoadedPages = (pages: Page[]): Page[] =>
  pages.map((p) => ({
    ...p,
    // 后端 tombstone 的 deletedAt 是 ISO 字符串，本地统一用 ms 数字戳比较，
    // 这里一次性转成数字，保证 mergePages / stampUpdated 与本地数据同源。
    deletedAt: p.deletedAt ? (typeof p.deletedAt === 'string' ? Date.parse(p.deletedAt) : p.deletedAt) : undefined,
    tasks: (p.tasks ?? []).map((t) => (
      t.content && t.content.indexOf('blob:') > -1 ? { ...t, content: stripDeadBlobImages(t.content) } : t
    )),
  }));

// === 配置 ===
const LOCAL_STORAGE_KEY = 'nexus_matrix_pages_v3';

// 服务器地址：默认走同源相对路径（由 Vite 代理 /api 与 /ws 转发到后端，见 vite.config.ts）。
// 但**移动端 WebView 的 window.location.host 不是后端地址**（是本地 file:// 或 localhost），
// 若不配置，打包进 App 后根本连不上服务器。因此提供 VITE_SYNC_SERVER 覆盖：
//   桌面开发：不设置（走 Vite 代理）
//   Capacitor/Tauri：VITE_SYNC_SERVER=http://192.168.1.10:8010
//   Electron 打包：同上
// 运行时注入（URL ?syncServer= 或 window.__NEXUS_CONFIG__）优先于构建期 env，
// 便于同一份产物切换环境；注入逻辑见 runtimeConfig.ts
const SYNC_SERVER = (getRuntimeConfig().syncServer || import.meta.env.VITE_SYNC_SERVER || '').replace(/\/+$/, '');
const API_BASE = SYNC_SERVER ? `${SYNC_SERVER}/api` : '/api';
// ws 与 http 的协议映射：https -> wss（混合内容会被浏览器拦截）
const WS_ORIGIN = SYNC_SERVER
  ? SYNC_SERVER.replace(/^http/, 'ws')
  : '';
const WS_PATH = '/ws/sync';
// 共享密钥（后端 NEXUS_API_KEY 启用鉴权时必填；为空走开放模式）。见 runtimeConfig.ts
const SYNC_API_KEY = (getRuntimeConfig().apiKey || (import.meta.env.VITE_API_KEY as string | undefined) || '').trim();

// === 同步状态 ===
export const syncStatus = ref<'offline' | 'connecting' | 'online'>('offline');
export const onlineDevices = ref<number>(0);
export const lastSyncError = ref<string>('');
// 当前账户/房间信息（来自 /api/me），让「访问密钥 = 房间」对用户可见
export const accountInfo = ref<{ room_label: string; page_count: number; device_count: number } | null>(null);
// 鉴权失败（密钥被拒 / WS 1008）的明确提示
export const lastAuthError = ref<string>('');

let socket: WebSocket | null = null;
let wsUrl = '';
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
let remoteApplying = false;   // 标记：正在应用远端数据，避免回环广播
let stopWatch: (() => void) | null = null;  // 页面订阅的取消函数，closeSync 时清理，防 HMR 重复订阅
let currentPagesRef: Ref<Page[]> | null = null;
let backendReachable = false;   // 探测到确有后端（REST 探针成功或 WS 已连）才做网络推送；纯本地模式一律不推，杜绝 /api 404 噪音
// INITIAL_SYNC 分片缓冲：后端把大房间数据切成多片下发，客户端拼齐后再合并应用
let initialSyncBuffer: Page[] | null = null;
let initialSyncExpected = 0;
let initialSyncReceived = 0;
let initialSyncTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 数据变更计数：任何页面的内容或结构变化都会 +1。
 * 上层（撤销栈等）用**浅** watch 观察它即可感知「有东西变了」，
 * 无需自己对整个 pages 做 deep watch —— 那是击键卡顿的另一半来源。
 */
export const dataVersion = ref(0);

// === 变更订阅：按页订阅，避免「改一个字就 traverse 全库」 ===
const pageWatchStops = new Map<string, { obj: Page; stop: () => void }>();
let dirtyPageIds = new Set<string>();   // 自上次提交以来动过的页
let structureDirty = false;             // 发生了结构变化（增删页 / 整表替换），需按全量处理

const watchPages = (pagesRef: Ref<Page[]>): (() => void) => {
  const onChange = (id?: string) => {
    if (remoteApplying) return;                // 远端应用期间不回推，避免无限回环
    requestCommit(id);
  };

  // 让「每页一个 deep watch」的集合与当前 pages 保持一致：
  // 新增页补订阅、删除页退订、整表替换（撤销/导入）时按对象身份重建。
  const syncPageWatchers = () => {
    const pages = pagesRef.value ?? [];
    const alive = new Set<string>();
    for (const p of pages) {
      alive.add(p.id);
      const cur = pageWatchStops.get(p.id);
      if (cur && cur.obj === p) continue;      // 仍是同一个对象，保留已有订阅
      if (cur) cur.stop();
      const stop = watch(() => p, () => onChange(p.id));   // 浅订阅：只在页面对象整体替换时触发（字段改动走 markDirty，不再整页遍历）
      pageWatchStops.set(p.id, { obj: p, stop });
    }
    for (const [id, rec] of [...pageWatchStops]) {
      if (!alive.has(id)) { rec.stop(); pageWatchStops.delete(id); }
    }
  };
  syncPageWatchers();

  // 结构变化：数组被整体替换、push/pop/splice（length 变化）时重建订阅并按全量提交
  const stopStructure = watch(
    () => [pagesRef.value, pagesRef.value?.length],
    () => { syncPageWatchers(); onChange(); },
  );

  return () => {
    stopStructure();
    for (const rec of pageWatchStops.values()) rec.stop();
    pageWatchStops.clear();
    dirtyPageIds.clear();
    structureDirty = false;
  };
};

// === 阶段二 2.1/2.2：上传队列 + 增量游标 ===
// lastSyncCursor：服务端已确认的高水位（ms）。持久化到 kv，下次启动用它作
//   fetchRemotePages(since=cursor) 的增量基准，断线期间错过的变更得以补齐。
// outboxPages / outboxSeq：断线期间本地发生的「最新一份未确认快照」。
//   在线时立即整页上推；离线时累积到这里，onopen 重连后补发，避免阶段一的
//   「断线即丢最后编辑」。LWW + 全量快照语义下，保留最新一份即足够对齐其它端。
const CURSOR_KEY = 'nexus_matrix_cursor';
export const lastSyncCursor = ref<number>(0);
let outboxPages: Page[] | null = null;
let outboxSeq = 0;
let clientSeq = 0;

const loadCursor = async (): Promise<void> => {
  try {
    const raw = await getStore().get(CURSOR_KEY);
    if (raw) lastSyncCursor.value = Number(raw) || 0;
  } catch { /* 忽略 */ }
};
const saveCursor = async (): Promise<void> => {
  try { await getStore().set(CURSOR_KEY, String(lastSyncCursor.value)); } catch { /* 忽略 */ }
};

// === 本地持久化 ===
// 走存储抽象层（异步），Web 端为 localStorage，三端可替换为 Preferences / Tauri store
export const loadLocal = async (): Promise<Page[] | null> => {
  try {
    const raw = await getStore().get(LOCAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? sanitizeLoadedPages(parsed) : null;
  } catch (e) {
    console.error('[NEXUS SYNC] 本地数据反序列化失败', e);
    return null;
  }
};

// 本地写入失败的可见提示。此前只在 console 打日志，用户完全无感，
// 表现为「以为存了、重开没了」。现在把它暴露成全局状态，UI 顶层渲染横幅。
export const storageError = ref<string>('');
export const setStorageWarning = (msg: string) => { storageError.value = msg; };

export const saveLocal = async (pages: Page[]): Promise<void> => {
  try {
    await getStore().set(LOCAL_STORAGE_KEY, JSON.stringify(pages));
    // 成功后清掉此前的告警，避免一直挂着旧错误
    if (storageError.value) storageError.value = '';
  } catch (e) {
    console.error('[NEXUS SYNC] 本地持久化失败', e);
    storageError.value = '本地保存失败，改动可能没有落盘。请立即导出备份，避免数据丢失。';
    throw e;
  }
};

// === 防抖工具（带 flush） ===
// flush 是必需的：原本只有防抖，且全仓无 visibilitychange/pagehide 处理，
// 于是「编辑后立刻切走 / 进程被杀」会丢掉最后 500ms 内的改动。
// 移动端进程更易被回收，这个窗口是真实的数据丢失点。
function debounce<T extends (...args: any[]) => void>(fn: T, wait: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Parameters<T> | null = null;

  const debounced = (...args: Parameters<T>) => {
    pending = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      pending = null;
      void fn(...args);
    }, wait);
  };

  // 立即执行挂起的调用（若有），返回是否真的执行过
  debounced.flush = (): boolean => {
    if (!timer || !pending) return false;
    const args = pending;
    clearTimeout(timer);
    timer = null;
    pending = null;
    void fn(...args);
    return true;
  };

  return debounced;
}

// P1 过渡期对账（防漏保存）：见下方 reconcile。只对账「当前激活页」，复用 pageFingerprint/pageStampCache，
// 每 4s 跑一次、隐藏标签页跳过；确认显式标脏已覆盖全部路径后可整体移除（本段 + setReconcilePage + setInterval）。
let reconcilePageId: string | null = null;
export const setReconcilePage = (id: string | null): void => { reconcilePageId = id; };
let reconTimer: ReturnType<typeof setInterval> | null = null;

// 一次提交的完整动作：打戳 -> 页面历史 -> 本地落盘 + 远端上推。
// 只有真的发生了内容变化的页才会被打戳并返回其 id。
const commitPages = (pages: Page[]): void => {
  // 结构变化（新增/删除/整表替换）时按全量处理；否则只处理被标记过的页
  const onlyIds = structureDirty ? undefined : [...dirtyPageIds];
  dirtyPageIds.clear();
  structureDirty = false;
  const changed = stampUpdated(pages, onlyIds);
  // 没有任何内容变化（例如仅焦点 / UI 态触发的响应式抖动）就不做无意义的全量写与推送
  if (changed.length === 0) return;
  void snapshotPages(pages, changed);          // 页面历史：对变化页节流存档
  void persistPages(pages, changed);
};
const debouncedCommit = debounce(commitPages, 500);

// P1 块级隔离：显式标脏 + 触发防抖提交，取代「每页 deep watch 隐式触发整页遍历」。
// 编辑器知道某页被改时调 markDirty(id)；浅 watch 只兜页面对象整体替换；4s 对账兜其余漏网。
const requestCommit = (id?: string) => {
  dataVersion.value++;
  if (id) dirtyPageIds.add(id); else structureDirty = true;
  if (currentPagesRef) debouncedCommit(currentPagesRef.value);
};
export const markDirty = (pageId: string) => {
  if (remoteApplying) return;           // 远端应用期间不回推，避免回环广播
  requestCommit(pageId);
};
const reconcile = () => {
  const pages = currentPagesRef?.value;
  if (!pages || !reconcilePageId || document.visibilityState === 'hidden') return;
  const p = pages.find((x) => x.id === reconcilePageId);
  if (!p) return;
  // 激活页当前内容指纹 ≠ 上次提交时打的戳，且没被显式标脏 → 有漏网修改，补一次提交
  if (pageFingerprint(p) !== pageStampCache.get(p.id) && !dirtyPageIds.has(p.id)) {
    dataVersion.value++;
    dirtyPageIds.add(p.id);
    commitPages(pages);   // 直接提交（debouncedCommit.flush 仅在「有挂起调用」时才执行，这里没有，故直接调 commitPages）
  }
};

// 防抖持久化：本地写入 + 远端推送（写入时打 updatedAt，供后端 LWW）
// changedIds 存在时只上推**变化的那几页**：后端 CLIENT_UPDATE 走的是 merge 语义，
// 增量推送完全安全，却能把全量序列化（120 页）从每次保存里省掉。
const persistPages = async (pages: Page[], changedIds?: string[]) => {
  // 【阶段一修复】不再 pages.map(p => ({...p, updatedAt: Date.now()}))。
  // 无条件给**每一页**刷成当前时间，配合后端 `inc_ts >= cur_ts` 的整页 LWW，
  // 会让「最后推送的一方」所有页面全部获胜——于是 App 每次启动（initSync 会 pushAll）
  // 都会把另一端的改动整体冲掉，属于必然丢数据。
  // 时间戳现在只由 stampUpdated 打给**内容真的变了的**页/块。
  try { await saveLocal(pages); } catch { /* 写入失败不阻塞后续广播 */ }
  if (syncStatus.value === 'online') {
    // 阶段二 2.1：带 clientSeq 上推，供后端 ACK 对齐 outbox。
    clientSeq += 1;
    outboxSeq = clientSeq;
    outboxPages = pages;
    const changedSet = changedIds && changedIds.length ? new Set(changedIds) : null;
    const payload = changedSet ? pages.filter((p) => changedSet.has(p.id)) : pages;
    try {
      sendWS({ type: 'CLIENT_UPDATE', data: payload, clientSeq });
    } catch (e) { /* 发送瞬间断线：留在 outbox，onopen 会补发 */ }
  } else {
    // 阶段二 2.1：离线时把最新快照压入 outbox（累积，不丢）。
    // onopen 重连后立即补发这一份，对齐其它端。
    outboxPages = pages;
  }
};

/**
 * 立即把挂起的改动落盘。在页面隐藏（切后台、切 App）与卸载时调用。
 * 这是「最后 500ms 必丢」的兜底。
 */
export const flushPendingSave = (): void => {
  debouncedCommit.flush();
};

// === REST 客户端 ===
const apiRequest = async (endpoint: string, options?: RequestInit): Promise<any> => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string> | undefined),
  };
  if (SYNC_API_KEY) headers['Authorization'] = `Bearer ${SYNC_API_KEY}`;
  const res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
};

// 阶段二 2.2：握手拉取。支持 since 增量——只有 since 之后变更的页才返回。
// 无 since 时拉全量（首装/换设备）。后端在响应里带回 cursor（服务端水位），
// 本地据此更新 lastSyncCursor，下次断线恢复后只拉增量。
export const fetchRemotePages = async (since = 0): Promise<Page[] | null> => {
  try {
    const qs = since > 0 ? `?since=${since}` : '';
    const result = await apiRequest(`/pages${qs}`);
    if (typeof result?.cursor === 'number') {
      lastSyncCursor.value = result.cursor;
      void saveCursor();
    }
    // 后端有成功响应即视为可达（哪怕 data 为空）：决定后续是否值得推送/连 WS
    if (result?.success) backendReachable = true;
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

// INITIAL_SYNC 分片收不齐时（隧道 / 移动网络丢帧），改用 REST 全量拉取——
// HTTP（后端已开 GZip）比数 MB 的 WS 大帧更抗代理，作为首拉兜底的可靠路径。
const fallbackInitialPull = async () => {
  if (!currentPagesRef) return;
  const remote = await fetchRemotePages(0);
  if (!remote) return;
  try {
    const existing = await loadLocal();
    const base = (existing && existing.length > 0)
      ? mergePages(existing, sanitizeLoadedPages(remote))
      : sanitizeLoadedPages(remote);
    remoteApplying = true;
    currentPagesRef.value = orderPages(base);
    await saveLocal(currentPagesRef.value);
    remoteApplying = false;
    lastSyncError.value = '';
  } catch (e) {
    remoteApplying = false;
    lastSyncError.value = '同步接收失败：' + (e instanceof Error ? e.message : String(e));
    console.error('[NEXUS] 初始 REST 兜底失败', e);
  }
};

// 推送全量到服务端（服务端会广播给其他设备）
export const pushAll = async (pages: Page[]) => {
  // 【阶段一修复】同 persistPages：不再无条件给每一页刷 updatedAt。
  // 否则「启动即 pushAll」= 用本地时间戳强行覆盖服务端，必然冲掉另一端的改动。
  clientSeq += 1;
  outboxSeq = clientSeq;
  outboxPages = pages;
  try {
    await sendWS({ type: 'CLIENT_UPDATE', data: pages, clientSeq });
  } catch (e) {
    // WS 正在连接中：onopen 会补发 outbox，这里别再逐页 REST（否则每次启动都 121 个串行 PUT）。
    if (socket && socket.readyState === WebSocket.CONNECTING) return;
    // 后端不可达（未配置，或探测/连接都从没成功过）：跳过 REST，避免纯本地或后端下线时刷 404/错误。
    if (!backendReachable) return;
    // WS 已断开且无正在进行的连接 → 退化为 REST 全量保存（尽力而为）
    try {
      for (const p of pages) {
        await apiRequest(`/pages/${p.id}`, { method: 'PUT', body: JSON.stringify(p) });
      }
    } catch (_) { /* 静默：LocalFirst 不阻塞编辑 */ }
  }
};

export const createRemotePage = async (page: Page) => {
  if (!SYNC_SERVER && !backendReachable) return null;   // 纯本地：无后端可推，跳过避免 404
  try {
    const r = await apiRequest('/pages', { method: 'POST', body: JSON.stringify(page) });
    return r?.success ? r.data : null;
  } catch (e) { return null; }
};

export const deleteRemotePage = async (id: string) => {
  if (!SYNC_SERVER && !backendReachable) return;        // 纯本地：无后端可推，跳过避免 404
  try { await apiRequest(`/pages/${id}`, { method: 'DELETE' }); } catch (e) { /* ignore */ }
};

export const updateRemotePage = async (page: Page) => {
  if (!SYNC_SERVER && !backendReachable) return;        // 纯本地：无后端可推，跳过避免 404
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
  // 配置了独立服务器地址就用它，否则回退到同源（走 Vite 代理）
  const wsQs = SYNC_API_KEY ? `?api_key=${encodeURIComponent(SYNC_API_KEY)}` : '';
  if (WS_ORIGIN) {
    wsUrl = `${WS_ORIGIN}${WS_PATH}${wsQs}`;
  } else {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    wsUrl = `${proto}//${window.location.host}${WS_PATH}${wsQs}`;
  }

  // 防连接泄漏：新建前先关掉并脱离旧 socket（重连 / HMR 竞态时旧的可能没被 closeSync 关掉）
  if (socket) {
    try { socket.onclose = null; socket.close(); } catch { /* 忽略 */ }
    socket = null;
  }
  let mySocket: WebSocket;
  try {
    mySocket = new WebSocket(wsUrl);
  } catch (e) {
    syncStatus.value = 'offline';
    scheduleReconnect(pagesRef);
    return;
  }
  socket = mySocket;
  syncStatus.value = 'connecting';

  mySocket.onopen = () => {
    // 代际守护：若已被更新的连接取代（HMR / 重连竞态），自关以防后端连接数虚高
    if (socket !== mySocket) { try { mySocket.close(); } catch { /* 忽略 */ } return; }
    syncStatus.value = 'online';
    backendReachable = true;   // WS 连上即证明后端可达（后续 pushAll 的 REST 兜底因此放行）
    lastSyncError.value = '';
    lastAuthError.value = '';
    reconnectAttempts = 0;
    // 新连接开始：清空可能残留的 INITIAL_SYNC 分片缓冲，避免与旧连接的分片混淆
    initialSyncBuffer = null; initialSyncReceived = 0; initialSyncExpected = 0;
    if (initialSyncTimer) { clearTimeout(initialSyncTimer); initialSyncTimer = null; }
    void refreshAccount();     // 连上即拉取当前房间信息（房间标识 / 数据量 / 在线设备）
    // 阶段二 2.1：重连成功后补发离线期间累积的 outbox。
    // 断线时 persistPages 把最新快照压进 outboxPages，这里一次性上推对齐其它端，
    // 避免「切后台编辑 → 杀进程 → 重连后改动丢失」。
    if (outboxPages) {
      const pending = outboxPages;
      outboxPages = null;
      void pushAll(pending);
    }
  };

  mySocket.onmessage = (event) => {
    if (socket !== mySocket) return;  // 过期连接，忽略
    try {
      const msg = JSON.parse(event.data);

      // 阶段二 2.1：服务端对 CLIENT_UPDATE 的确认回执。
      // cursor = 服务端水位；clientSeq = 原样回显，用于对齐哪一批 outbox 被确认。
      // 阶段三 ACK 细粒度：acceptedIds = 本次被服务端 LWW 采纳的页 id 集合。
      //   若后端返回该字段，则仅从待发快照中剔除「已确认」的页，保留未确认的页
      //   待断线重发时补推，避免把已达成一致的全量快照反复重推造成冲突覆盖。
      if (msg.type === 'ACK') {
        if (typeof msg.cursor === 'number' && msg.cursor > lastSyncCursor.value) {
          lastSyncCursor.value = msg.cursor;
          void saveCursor();
        }
        const accepted: string[] = Array.isArray(msg.acceptedIds) ? msg.acceptedIds : [];
        if (accepted.length && outboxPages) {
          // 细粒度：剔除已确认页，仅留未确认页
          const remaining = outboxPages.filter((p) => !accepted.includes(p.id));
          outboxPages = remaining.length ? remaining : null;
        } else if (msg.clientSeq === outboxSeq) {
          // 回退兼容：旧后端不返回 acceptedIds 时，按批次整体清空
          outboxPages = null;
        }
        return;
      }

      if ((msg.type === 'INITIAL_SYNC' || msg.type === 'SERVER_BROADCAST') && Array.isArray(msg.data)) {
        // INITIAL_SYNC 可能分片下发（房间数据大时）：先缓冲拼齐，收满再合并应用。
        // SERVER_BROADCAST（实时增量）不分片，直接处理。
        let incoming: Page[];
        if (msg.type === 'INITIAL_SYNC' && typeof msg.chunks === 'number' && msg.chunks > 1) {
          if (initialSyncReceived === 0) {
            initialSyncBuffer = []; initialSyncExpected = msg.chunks;
            // 看门狗：分片 25s 内未收齐（隧道 / 移动网络丢帧），丢弃并用 REST 全量兜底
            if (initialSyncTimer) clearTimeout(initialSyncTimer);
            initialSyncTimer = setTimeout(() => {
              initialSyncTimer = null;
              initialSyncBuffer = null; initialSyncReceived = 0; initialSyncExpected = 0;
              lastSyncError.value = '初始数据接收超时，改用 HTTP 重新拉取…';
              void fallbackInitialPull();
            }, 25000);
          }
          initialSyncBuffer!.push(...sanitizeLoadedPages(msg.data as Page[]));
          initialSyncReceived++;
          if (initialSyncReceived < initialSyncExpected) return;  // 等剩余分片
          if (initialSyncTimer) { clearTimeout(initialSyncTimer); initialSyncTimer = null; }
          incoming = initialSyncBuffer!;
          initialSyncBuffer = null; initialSyncReceived = 0; initialSyncExpected = 0;
        } else {
          incoming = sanitizeLoadedPages(msg.data as Page[]);
        }
        // 不再「本地优先整页丢弃」，而是按块合并：本地与远端各自的编辑都尽量保留。
        // 这是从 LWW 整页覆盖走向 CRDT 的第一步；后续接 Yjs 时可整体替换本函数。
        // 阶段二 2.2：用合并数据的最大时间戳更新本地水位，作为下次增量拉取的 since。
        let maxTs = 0;
        for (const p of incoming) {
          maxTs = Math.max(maxTs, (p.updatedAt ?? 0) as number, (p.deletedAt ?? 0) as number);
          for (const t of p.tasks as Array<{ updatedAt?: number }>) {
            maxTs = Math.max(maxTs, (t.updatedAt ?? 0) as number);
          }
        }
        if (maxTs > lastSyncCursor.value) { lastSyncCursor.value = maxTs; void saveCursor(); }
        void (async () => {
          try {
            const existing = await loadLocal();
            // 本地有数据则按块合并（尽量双向保留），否则直接采用远端（首次装机/换设备）。
            // 合并是幂等的，重复应用同一份数据不会有副作用（remoteApplying 已阻断 watch 回环）。
            const base = (existing && existing.length > 0) ? mergePages(existing, incoming) : incoming;
            remoteApplying = true;
            pagesRef.value = orderPages(base);
            await saveLocal(pagesRef.value);
            remoteApplying = false;
          } catch (e) {
            remoteApplying = false;
            lastSyncError.value = '同步接收失败：' + (e instanceof Error ? e.message : String(e));
            console.error('[NEXUS] INITIAL_SYNC 应用失败', e);
          }
        })();
      }
      if (msg.type === 'DEVICE_COUNT') {
        onlineDevices.value = typeof msg.data === 'number' ? msg.data : 0;
        if (accountInfo.value) {
          accountInfo.value = { ...accountInfo.value, device_count: onlineDevices.value };
        }
      }
    } catch (e) {
      console.error('[NEXUS SYNC] 消息解析失败', e);
    }
  };

  mySocket.onclose = (ev?: CloseEvent) => {
    if (socket !== mySocket) return;  // 已被取代的旧连接，忽略（不触发重连）
    if (ev && ev.code === 1008) {
      // 服务端因密钥无效主动断开（见 backend main.py WS 握手 close(1008)）
      lastAuthError.value = '密钥被拒绝（后端返回 1008）：访问密钥不正确，或后端未启用该密钥';
    }
    syncStatus.value = 'offline';
    socket = null;
    accountInfo.value = null;
    scheduleReconnect(pagesRef);
  };

  socket.onerror = () => {
    // onclose 会紧随其后触发，统一在 onclose 处理重连
  };
};

// 拉取当前房间信息（房间标识 / 数据量 / 在线设备），连接成功后调用。
const refreshAccount = async () => {
  try {
    const headers: Record<string, string> = {};
    if (SYNC_API_KEY) headers['Authorization'] = `Bearer ${SYNC_API_KEY}`;
    const res = await fetch(`${API_BASE}/me`, { headers });
    if (res.ok) {
      const d = await res.json();
      accountInfo.value = {
        room_label: d.room_label,
        page_count: d.page_count,
        device_count: d.device_count,
      };
    }
  } catch { /* 忽略：纯本地或后端不可达时不影响编辑 */ }
};

// 保存同步配置前的即时校验：返回四态之一，供设置面板明确告知用户。
//   unreachable  → 地址/网络连不通（含后端 5xx）
//   unauthorized → 密钥被拒（HTTP 401）
//   empty        → 已连，但本房间无数据（多半用错了密钥/模式）
//   ok           → 已连且有数据
export const probeServer = async (
  server: string,
  key: string,
): Promise<{
  state: 'unreachable' | 'unauthorized' | 'empty' | 'ok';
  message: string;
  info?: { room_label: string; page_count: number; device_count: number };
}> => {
  const s = (server || '').replace(/\/+$/, '');
  const base = s ? `${s}/api` : '/api';
  // 1) 连通性
  try {
    const h = await fetch(`${base}/health`);
    if (!h.ok) return { state: 'unreachable', message: '无法连接后端：请检查服务器地址或网络' };
  } catch {
    return { state: 'unreachable', message: '无法连接后端：请检查服务器地址或网络' };
  }
  // 2) 鉴权 + 数据量
  const k = (key || '').trim();
  const headers: Record<string, string> = {};
  if (k) headers['Authorization'] = `Bearer ${k}`;
  let res: Response;
  try {
    res = await fetch(`${base}/me`, { headers });
  } catch {
    return { state: 'unreachable', message: '无法连接后端：请检查服务器地址或网络' };
  }
  if (res.status === 401) {
    return { state: 'unauthorized', message: '密钥被拒绝（401）：访问密钥不正确，或后端未启用该密钥' };
  }
  if (!res.ok) {
    return { state: 'unreachable', message: `后端返回错误（HTTP ${res.status}）` };
  }
  const d = await res.json();
  const info = { room_label: d.room_label, page_count: d.page_count, device_count: d.device_count };
  if (d.page_count === 0) {
    return {
      state: 'empty',
      message: '已连接，但本房间暂无数据——可能访问密钥/模式与创建数据时不同（旧数据或落在「开放模式」公共房间）',
      info,
    };
  }
  return { state: 'ok', message: `已连接 · 房间 ${d.room_label} · ${d.page_count} 页`, info };
};

// 自动重连上限。超过后停止重试——LocalFirst 模式下纯本地编辑完全可用，
// 没必要持续敲一个已下线的后端（Vite 代理每次失败都会打印一条红色 ECONNREFUSED，
// 无限重试会把控制台刷满，也会让用户误以为编辑器坏了）。
const MAX_RECONNECT_ATTEMPTS = 5;

const scheduleReconnect = (pagesRef: Ref<Page[]>) => {
  if (reconnectTimer) return;
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    // 达到上限：转入「纯本地模式」，等用户手动重试
    syncStatus.value = 'offline';
    lastSyncError.value = '后端未连接，已切换纯本地模式（点击同步状态可重试）';
    return;
  }
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 15000);
  reconnectAttempts++;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWS(pagesRef);
  }, delay);
};

// 手动重试（UI 的同步状态按钮调用）。重置计数后立即重连。
export const retrySync = async () => {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (socket) { socket.onclose = null; socket.close(); socket = null; }
  reconnectAttempts = 0;
  syncStatus.value = 'connecting';
  lastSyncError.value = '';
  if (currentPagesRef) connectWS(currentPagesRef);
};

export const closeSync = () => {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (reconTimer) { clearInterval(reconTimer); reconTimer = null; }
  if (socket) { socket.onclose = null; socket.close(); socket = null; }
  if (stopWatch) { stopWatch(); stopWatch = null; }
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

// Markdown 导入（Notion 导出的 .md 是主要目标）。
// 与 importBackup 的「覆盖」不同，这里是「追加新页面」：
// 导入不该清空用户已有内容，故每次导入生成新的页面 id。
export const importMarkdown = async (
  file: File,
): Promise<{ ok: boolean; message: string; detail?: string }> => {
  try {
    if (!currentPagesRef) return { ok: false, message: '同步尚未初始化' };
    const text = await file.text();
    const { parseMarkdown } = await import('./markdownImport');
    const { blocks, downgraded } = parseMarkdown(text);
    if (blocks.length === 0) {
      return { ok: false, message: '未解析出任何内容块' };
    }

    // 标题取文件名（去掉 .md），比正文首行更可靠——
    // Notion 导出的 .md 首行未必是标题
    const title = file.name.replace(/\.md$/i, '').trim() || '导入的文档';

    const tasks = blocks.map((b) => ({
      id: newBlockId(),
      type: b.type,
      content: b.content,
      completed: b.completed ?? false,
      indentLevel: b.indentLevel ?? 0,
      prevId: null as string | null,
      payload: b.payload,
    }));
    // 重建 prevId 链，保证三端同步的顺序可确定性合并
    tasks.forEach((t, i) => { t.prevId = i === 0 ? null : tasks[i - 1].id; });

    const page: Page = {
      id: newPageId(),
      title,
      tasks,
      parentId: null,
      isFavorite: false,
      isExpanded: true,
    };

    currentPagesRef.value = [...currentPagesRef.value, page];
    await pushAll(currentPagesRef.value);

    const detail = `导入「${title}」：${blocks.length} 个块` + (downgraded > 0 ? `，${downgraded} 行降级为文本` : '');
    return { ok: true, message: detail, detail };
  } catch (e) {
    return { ok: false, message: '导入失败：' + (e as Error).message };
  }
};

// ZIP 导入（Notion 的 Markdown & CSV 导出）。
// 与 importMarkdown 一样是追加语义，但一次可导入多个页面并重建层级。
export const importNotionZip = async (
  file: File,
  opts?: { imageMode?: 'original' | 'compressed' },
): Promise<{ ok: boolean; message: string }> => {
  try {
    if (!currentPagesRef) return { ok: false, message: '同步尚未初始化' };
    const { importZip } = await import('./zipImport');
    const result = await importZip(file, opts);
    if (!result || result.pages.length === 0) {
      return { ok: false, message: 'ZIP 中未找到可导入的 Markdown 文件' };
    }

    currentPagesRef.value = [...currentPagesRef.value, ...result.pages];
    await pushAll(currentPagesRef.value);

    // 落库复核（与向导式导入同一道闸）：复验 asset: 引用、补存导入时没下下来的外链图
    const { verifyImportedAssets } = await import('./zipImport');
    const check = await verifyImportedAssets(result.pages);
    if (check.recovered > 0) {
      for (const p of result.pages) markDirty(p.id);
      flushPendingSave();
    }

    const totalBlocks = result.report.reduce((s, r) => s + r.blocks, 0);
    const parts = [`导入 ${result.pages.length} 个页面、${totalBlocks} 个块`];
    const downgraded = result.report.reduce((s, r) => s + r.downgraded, 0);
    if (downgraded > 0) parts.push(`${downgraded} 处降级为文本`);
    if (check.pending > 0) parts.push(`${check.pending} 张图片未存为本地资产（已保留原链接）`);
    return { ok: true, message: describeAssetCheck(parts.join('，'), check) };
  } catch (e) {
    return { ok: false, message: 'ZIP 导入失败：' + (e as Error).message };
  }
};

// 导入向导支持：把「解析」与「提交」拆开——先在 UI 上预览将创建的页面，确认后再导入。
// 只解析、不修改 currentPagesRef、不上推，供预览面板展示页面树与层级。
export const previewNotionZip = async (
  file: File,
  opts?: { imageMode?: 'original' | 'compressed' },
): Promise<{ ok: boolean; message?: string; pages?: Page[]; report?: Array<{ title: string; blocks: number; images: number; downgraded: number }>; imageFailures?: number; imageVerifyFailures?: number; verifyFailures?: ImportAssetIssue[] }> => {
  try {
    const { importZip } = await import('./zipImport');
    // 注意：图片在**预览阶段**就落库了（importZip 一步做完），
    // 所以「原图 / 压缩」必须在选文件之前定好，事后再改不生效。
    const result = await importZip(file, opts);
    if (!result || result.pages.length === 0) {
      return { ok: false, message: 'ZIP 中未找到可导入的 Markdown 文件' };
    }
    return { ok: true, pages: result.pages, report: result.report, imageFailures: result.imageFailures, imageVerifyFailures: result.imageVerifyFailures, verifyFailures: result.verifyFailures };
  } catch (e) {
    return { ok: false, message: 'ZIP 解析失败：' + (e as Error).message };
  }
};

/**
 * 一条「图片没存上」的明细。
 * 带 pageId / taskId 是为了让结果面板能「点一下直接跳到那一块」——
 * 只有「《标题》第 N 块」这种文字描述，用户还得自己回侧边栏一页页找。
 */
export interface ImportAssetIssue {
  title: string;
  block: number;
  pageId: string;
  taskId: string;
}

// 提交预览中勾选的页面（追加语义，不动已有内容），落盘 + 上推。
export interface CommitImportResult {
  ok: boolean;
  message: string;
  /** 落库复核后仍然缺失的张数（asset: 引用读不回，刷新后必破图） */
  imageVerifyFailures: number;
  /** 缺失明细（含定位所需的 pageId/taskId） */
  verifyFailures: ImportAssetIssue[];
  /** 提交时后台补下载并成功落库的张数 */
  recovered: number;
  /** 仍未落库、暂留原链接的张数 */
  pending: number;
  /** 覆盖了几个同名页面 */
  overwritten: number;
  /** 覆盖时回收掉几张旧图（避免同一份内容在 IndexedDB 里占两份） */
  reclaimed: number;
  /** 最终落地的页面 id（覆盖模式下是**旧页 id**，不是导入时的临时 id） */
  importedIds: string[];
  /** 建议跳转的根页面（块数最多的那个根；多文件导入时其余在 roots 里） */
  rootId: string | null;
  /** 所有根页面，块数降序 */
  roots: Array<{ id: string; title: string; blocks: number }>;
  /** 本次导入的总块数 */
  blocks: number;
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 把落库复核结果拼成一句人话（含缺失明细），供导入完成后的提示复用 */
const describeAssetCheck = (base: string, check: { missing: Array<{ title: string; block: number }>; recovered: number; pending: number }): string => {
  const parts = [base];
  if (check.recovered > 0) parts.push(`${check.recovered} 张图片后台补存成功`);
  if (check.pending > 0) parts.push(`${check.pending} 张图片仍是外链（联网后可重新导入补存）`);
  if (check.missing.length > 0) {
    const detail = check.missing.slice(0, 3).map((m) => `《${m.title || '无标题'}》第${m.block}块`).join('、');
    parts.push(`${check.missing.length} 张图片没存上（${detail}${check.missing.length > 3 ? ' 等' : ''}）`);
  }
  const msg = parts.join('，');
  return check.missing.length > 0
    ? `${msg}。这几张刷新后会丢失，建议重新导入该 ZIP，或检查浏览器存储设置（无痕窗口 / 退出时清除数据会导致存不住）。`
    : msg;
};

export const commitImportPages = async (
  pages: Page[],
  opts?: { overwriteSameTitle?: boolean; imageMode?: 'original' | 'compressed' },
): Promise<CommitImportResult> => {
  const fail = (message: string): CommitImportResult =>
    ({ ok: false, message, imageVerifyFailures: 0, verifyFailures: [], recovered: 0, pending: 0, overwritten: 0, reclaimed: 0, importedIds: [], rootId: null, roots: [], blocks: 0 });
  const idRemap = new Map<string, string>(); // 导入页 id -> 最终保留下来的页面 id
  try {
    if (!currentPagesRef) return fail('同步尚未初始化');
    if (pages.length === 0) return fail('未选择任何页面');

    let reclaimed = 0;
    // 文档级去重（指纹默认开启）：导入页若与现有存活页「标题+内容」指纹完全相同，直接覆盖那页
    // （沿用旧 id），而不是再建一份副本——这正是「反复导入同一批 zip 越导越重复」的根因修复。
    // 仅当勾选「覆盖同名页面」时，才额外把「同名但内容不同」的页也覆盖（适合重新导入修图）。
    let overwritten = 0;
    const { next, idRemap: remap, overwritten: n, replacedRefs } = mergeImportOverwrite(
      currentPagesRef.value, pages,
      { overwriteSameTitle: opts?.overwriteSameTitle ?? false, fingerprintOverwrite: true },
    );
    for (const [k, v] of remap) idRemap.set(k, v);
    overwritten = n;
    if (idRemap.size > 0) {
      // 导入时生成的都是临时 id：子页的 parentId 与正文里的 data-page-id 都指过去，
      // 覆盖之后必须一并改指到保留下来的旧 id，否则层级与页内链接全断。
      const idRe = new RegExp([...idRemap.keys()].map(escapeRegExp).join('|'), 'g');
      for (const p of pages) {
        p.parentId = (p.parentId && idRemap.get(p.parentId)) || p.parentId;
        for (const t of p.tasks ?? []) {
          if (t.content) t.content = t.content.replace(idRe, (m) => idRemap.get(m) ?? m);
        }
      }
    }
    currentPagesRef.value = next;
    // 回收被换掉的旧图：否则「压缩版」和「原图版」会在 IndexedDB 里同时躺着，白占一份
    const stillUsed = collectAssetRefs(next);
    const orphans = [...replacedRefs].filter((r) => !stillUsed.has(r));
    if (orphans.length > 0) {
      const { deleteAsset } = await import('./assets');
      for (const r of orphans) void deleteAsset(r);
      reclaimed = orphans.length;
    }

    await pushAll(currentPagesRef.value);

    // 落库复核：确认每个 asset: 引用都真在本地 store，并对导入时没下下来的外链图后台补存一次。
    // 顺序很重要——必须在页面已并入 currentPagesRef 之后改，这样补存的图能跟着一起落盘。
    const { verifyImportedAssets } = await import('./zipImport');
    const check = await verifyImportedAssets(pages, { imageMode: opts?.imageMode });
    if (check.recovered > 0 || overwritten > 0) {
      // 覆盖过的页要按**保留下来的 id** 标脏，否则改动不会落盘
      for (const p of pages) markDirty(idRemap.get(p.id) ?? p.id);
      flushPendingSave();
    }

    // 最终落地 id：覆盖模式下导入页的临时 id 已被旧页 id 取代，
    // 前端必须拿这个去跳转，否则 selectPage 指向不存在的页 → 被兜底 watch 打回第一篇。
    const finalIdOf = (p: Page): string => idRemap.get(p.id) ?? p.id;
    const importedIds = pages.map(finalIdOf);
    const importedIdSet = new Set(importedIds);
    const roots = pages
      .filter((p) => !(p.parentId && importedIdSet.has(p.parentId)))
      .map((p) => ({ id: finalIdOf(p), title: p.title, blocks: (p.tasks ?? []).length }))
      .sort((a, b) => b.blocks - a.blocks);
    // 缺失明细里的 pageId 也要跟着重映射，否则「跳到那一块」会跳空
    const issues: ImportAssetIssue[] = check.missing.map((m) => ({ ...m, pageId: idRemap.get(m.pageId) ?? m.pageId }));

    const base = `已导入 ${pages.length} 个页面`
      + (overwritten > 0
        ? `（覆盖 ${overwritten} 个同名页${reclaimed > 0 ? `，回收 ${reclaimed} 张旧图` : ''}）`
        : '');
    return {
      ok: true,
      message: describeAssetCheck(base, check),
      imageVerifyFailures: issues.length,
      verifyFailures: issues,
      recovered: check.recovered,
      pending: check.pending,
      overwritten,
      reclaimed,
      importedIds,
      rootId: roots[0]?.id ?? null,
      roots,
      blocks: pages.reduce((s, p) => s + (p.tasks?.length ?? 0), 0),
    };
  } catch (e) {
    return fail('导入失败：' + (e as Error).message);
  }
};

// === 统一接入：LocalFirst + 远端同步 ===
// 返回是否成功从远端加载
export const initSync = async (pagesRef: Ref<Page[]>): Promise<boolean> => {
  // 幂等：HMR / 重复挂载会重复调用，先清理上一次的 socket + watch，避免连接与订阅泄漏
  if (currentPagesRef) closeSync();
  currentPagesRef = pagesRef;

  // 1) LocalFirst：先读本地（本地数据优先，绝不被服务端陈旧的种子数据覆盖）
  const local = await loadLocal();
  await loadCursor(); // 阶段二 2.2：读本地水位，作为增量拉取 since
  if (local) {
    pagesRef.value = local;
    await saveLocal(local); // 立刻写回，确保键存在
  }

  // 2) 远端握手（阶段二 2.2 增量）：带 lastSyncCursor 作 since，只拉断线期间
  //    其它端发生变更的页；无 cursor 时拉全量（首装/换设备）。
  const remote = await fetchRemotePages(lastSyncCursor.value);

  // 先发起 WS 连接（后端可达时）：让下面的 pushAll 走 WS（open 后由 onopen 补发 outbox），
  // 而不是在 socket 尚未 open 时退化成逐页 REST（121 页 = 121 个串行 PUT，每次启动都来一遍）。
  if (backendReachable) connectWS(pagesRef);

  if (!local && remote) {
    pagesRef.value = sanitizeLoadedPages(remote);
    await saveLocal(pagesRef.value);
  } else if (local && remote) {
    // 本地与远端都有：增量合并远端（since 之后的变更），再把本地上推到服务端，
    // 让服务端对齐最新（避免陈旧种子），同时补齐本端离线期间其它端的改动。
    //
    // 【性能/健壮性】上推改为**不等待**（void）：WS 不可用时会退化成逐页 REST
    // （156 页 = 156 个串行请求），一旦 await 在这里，第 3 步的订阅注册就被拖住，
    // 表现为「编辑半天不落盘」。本地订阅必须先于任何网络动作建立。
    const merged = mergePages(pagesRef.value, sanitizeLoadedPages(remote));
    pagesRef.value = orderPages(merged);
    await saveLocal(pagesRef.value);
    void pushAll(pagesRef.value);
  } else if (local && !remote) {
    // 后端不可用或为空：保持本地并尝试上推（同样不阻塞）
    void pushAll(pagesRef.value);
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
  //
  // 【性能】这里刻意**不用** `watch(pagesRef, cb, { deep: true })`。
  // deep watch 的代价不在回调，而在「每次触发都要 traverse 整棵数据树」：
  // 156 个页面 × 各页的块，实测一次击键触发约 27 万次属性读取 ≈ 170ms 的同步卡顿。
  // 改成**按页订阅**：每页各自一个 deep watch，改动哪一页就只 traverse 那一页
  // （成本从「全库」降到「一页」，约两个数量级），并只把这一页标记为待提交。
  //
  // 同时 stampUpdated 也不再在每次触发时跑：它要给每页算内容指纹（JSON.stringify 全页
  // blocks），同样与全库规模成正比。现在合并进防抖，并且只指纹被标记的那些页。
  stopWatch = watchPages(pagesRef);
  // P1 过渡期对账：每 4s 用廉价指纹兜一次漏网修改（防漏保存），closeSync 时清理
  if (reconTimer) clearInterval(reconTimer);
  reconTimer = setInterval(reconcile, 4000);

  return !!remote;
};
