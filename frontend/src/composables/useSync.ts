import {nextTick, ref, type Ref, watch} from 'vue';
import {getStore} from './storage';
import {newBlockId, newPageId} from './ids';
import {getRuntimeConfig, isNativeShell} from '../runtimeConfig';
import {apiFetch} from './nativeHttp';
import {collectAssetRefs, mergeImportOverwrite, stripLeadingTitleEcho} from './importMerge';
import type {CoverMeta} from './imageProviders';

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
  coverMeta?: CoverMeta; // 封面来源（图库图片 id + 署名）：随页面同步，用于署名持久化与「没用过的封面」去重
  deletedAt?: number;   // 墓碑时间戳（ms）。非空表示该页已被删除，参与同步合并，避免删除被另一端「复活」
  isTemplate?: boolean; // 模板页：从侧边栏树隐藏，收进「模板」区，可一键套用新建副本
  prevId?: string | null;  // 同一父级下的前一个页面 id（页面顺序链，与块的 prevId 同思路；根页也有链）
  fieldTs?: Record<string, number>; // 各偏好/结构字段的最后修改时刻（逐字段 LWW，取代整页时间戳裁决）
}

// === 会话接力（Session）：用户「当下正在做的事」 ===
// 与文档数据（Content）刻意分离：不参与 LWW / cursor / outbox，也不落进 pages 表。
// 只在冷启动（URL 无 hash）时用于恢复 activePageId；在线设备的「最近访问」可随
// 远端刷新，但当前屏幕永远由本机用户自己决定，服务端不做实时强推。
export interface SessionState {
  activePageId?: string;
  recentPageIds: string[];
  updatedAt: number;
}
export const sessionState = ref<SessionState | null>(null);
let localSession: SessionState = { recentPageIds: [], updatedAt: 0 };
let sessionReportTimer: ReturnType<typeof setTimeout> | null = null;
let sessionReportPending = false;

const normalizeSession = (raw: unknown): SessionState | null => {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const active = typeof s.activePageId === 'string' && s.activePageId ? s.activePageId : undefined;
  const recent = Array.isArray(s.recentPageIds)
    ? s.recentPageIds.filter((x): x is string => typeof x === 'string' && !!x).slice(0, 12)
    : [];
  const updatedAt = typeof s.updatedAt === 'number' && Number.isFinite(s.updatedAt) ? s.updatedAt : 0;
  if (!active && recent.length === 0) return null;
  return { activePageId: active, recentPageIds: recent, updatedAt };
};

const acceptSessionState = (raw: unknown): void => {
  const s = normalizeSession(raw);
  if (!s) return;
  const cur = sessionState.value;
  // 迟到的旧广播不能盖掉刚收到的新状态
  if (cur && s.updatedAt < cur.updatedAt) return;
  sessionState.value = s;
  // 服务端时间戳可能领先本机时钟：对齐水位，保证下一次上报不会被判成「迟到」。
  localSession.updatedAt = Math.max(localSession.updatedAt, s.updatedAt);
};

/** 握手阶段拉远端会话；旧后端没有 /api/session（404）时静默降级为纯本地恢复。 */
export const fetchRemoteSession = async (): Promise<SessionState | null> => {
  try {
    const r = await apiRequest('/session');
    const s = normalizeSession(r?.data);
    if (s) acceptSessionState(s);
    return s;
  } catch {
    return null;
  }
};

const sendSessionReport = async (): Promise<void> => {
  const data: SessionState = { ...localSession };
  try {
    sendWS({ type: 'SESSION_UPDATE', data });
    sessionReportPending = false;
    return;
  } catch { /* WS 未连上：走 REST 兜底 */ }
  if (!backendReachable) return;   // 纯本地模式不发无谓请求，保留 pending 等下次建连
  try {
    await apiRequest('/session', { method: 'PUT', body: JSON.stringify(data) });
    sessionReportPending = false;
  } catch { /* 保留 pending，onopen 时再补 */ }
};

/** 上报本机「正在看的文档 / 最近访问」：合并式 patch + 250ms 尾缘节流。 */
export const reportSession = (patch: Partial<SessionState>): void => {
  localSession = {
    activePageId: patch.activePageId ?? localSession.activePageId,
    recentPageIds: (patch.recentPageIds ?? localSession.recentPageIds).slice(0, 12),
    updatedAt: Math.max(Date.now(), localSession.updatedAt + 1),
  };
  sessionReportPending = true;
  if (sessionReportTimer) clearTimeout(sessionReportTimer);
  sessionReportTimer = setTimeout(() => {
    sessionReportTimer = null;
    void sendSessionReport();
  }, 250);
};

export const flushSessionReport = (): void => {
  if (sessionReportTimer) { clearTimeout(sessionReportTimer); sessionReportTimer = null; }
  if (sessionReportPending) void sendSessionReport();
};

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
// 必须覆盖**所有会随同步传播的页面标量**：漏掉 prevId / coverPos / isTemplate 时，
// 「页面排序、封面取景、模板标记」即使打上了新时间戳也不会被另一端采纳，
// 表现为「改了但不同步」。deletedAt 由墓碑分支单独处理，不在此列。
const PAGE_SCALAR_FIELDS = [
  'title', 'icon', 'cover', 'coverPos', 'coverMeta', 'parentId', 'isFavorite',
  'isTemplate', 'prevId',
] as const;

// 纯本机视图态：目录树展开/折叠只反映「本机用户当下在做什么」。
// 以前参与跨设备 LWW，一端折叠会把另一端刚展开的树整组冲掉；现在仍在本机
// 持久化，但不进入同步载荷，也不采用远端值。
const LOCAL_ONLY_FIELDS = ['isExpanded'] as const;

/** 上推前剥掉本机视图态；服务端与另一台设备因此永远看不到本机的展开选择。 */
const forSyncPage = (p: Page): Page => {
  const out = { ...p } as unknown as Record<string, unknown>;
  for (const f of LOCAL_ONLY_FIELDS) delete out[f];
  return out as unknown as Page;
};

// 时间戳归一：本地墓碑用 ms 数字，后端墓碑可能是 ISO 字符串，混用会导致比较失真
const tsOf = (v: unknown): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') { const n = Date.parse(v); return Number.isNaN(n) ? 0 : n; }
  return 0;
};

/** 字段级时间戳；存量数据没有 fieldTs 时回退到整页时间戳，保持与老客户端兼容。 */
const fieldTsOf = (p: Page, f: string): number => p.fieldTs?.[f] ?? tsOf(p.updatedAt);

const mergePages = (local: Page[], remote: Page[]): Page[] => {
  const out: Page[] = local.map((p) => ({ ...p, tasks: [...p.tasks] }));
  const byId = new Map(out.map((p) => [p.id, p]));

  for (const rp of remote) {
    const lp = byId.get(rp.id);
    // 墓碑（远端已删除）：无论本地是否仍存在，都按「删除时间戳较新」剔除本地页。
    // 否则已删页面会被另一端的下一次 CLIENT_UPDATE 推回来「复活」。
    // 仅当本地页面的删除戳比远端更晚时才保留本地（极端并发：本地后删、远端先删）。
    if (rp.deletedAt) {
      if (lp && !(lp.deletedAt && tsOf(lp.deletedAt) > tsOf(rp.deletedAt))) {
        const idx = out.findIndex((p) => p.id === rp.id);
        if (idx >= 0) out.splice(idx, 1);
      }
      continue;
    }
    // 全新页：本机还没有展开偏好，给个默认初值即可（此后完全由本机维护）。
    if (!lp) { out.push({ ...rp, isExpanded: rp.isExpanded ?? true, tasks: orderTasks(rp.tasks) }); continue; }

    // 偏好字段逐字段版本化：旧实现整组标量共用 page.updatedAt，于是
    // 「A 刚换封面」与「B 刚改图标」谁的时间戳晚，就把对方那一组选择全部冲掉。
    // 现在每个字段用自己的 fieldTs 裁决，互不牵连；缺字段版本时回退整页时间戳。
    const nextFieldTs: Record<string, number> = { ...(lp.fieldTs ?? {}) };
    for (const f of PAGE_SCALAR_FIELDS) {
      const rTs = fieldTsOf(rp, f);
      if (rTs <= fieldTsOf(lp, f)) continue;
      const rv = (rp as unknown as Record<string, unknown>)[f];
      const lv = (lp as unknown as Record<string, unknown>)[f];
      // 标题是页面身份：字段整体缺失（JSON 会省略 undefined）属于旧数据 / 异常快照，
      // 不能当成「用户主动清空标题」，否则另一台的标题栏会突然显示「无标题」。
      // 真正清空会写 ''（字段仍在），其它标量字段缺失仍按删除处理（移除封面要能同步）。
      if (f === 'title' && rv === undefined && lv !== undefined) continue;
      (lp as unknown as Record<string, unknown>)[f] = rv;
      nextFieldTs[f] = rTs;
    }
    // 远端带来的更高版本戳也要跟上水位（即使本字段值恰好相同）
    for (const [f, t] of Object.entries(rp.fieldTs ?? {})) {
      if (typeof t === 'number' && t > (nextFieldTs[f] ?? 0)) nextFieldTs[f] = t;
    }
    lp.fieldTs = Object.keys(nextFieldTs).length ? nextFieldTs : undefined;
    // isExpanded 刻意不参与上面的循环：本机视图态永不采用远端值。
    if (tsOf(rp.updatedAt) > tsOf(lp.updatedAt)) lp.updatedAt = rp.updatedAt;

    // 块级：逐块比较 block.updatedAt。
    // 这是阶段一的核心修复——原先是 Object.assign(lt, rt) 无条件用远端覆盖，
    // 导致 500ms 防抖窗口内刚编辑的块被任何到达的广播吞掉（且无任何提示）。
    const localBlocks = new Map(lp.tasks.map((t) => [t.id, t]));
    for (const rt of rp.tasks) {
      const lt = localBlocks.get(rt.id);
      const rtDel = tsOf(rt.deletedAt);
      // 远端块是墓碑：给本地对应块打上删除戳。删除戳具有权威性，避免旧内容被拉回。
      // 本地根本没有该块时，不新增死块（它本就不存在，无需「复活」）。
      if (rtDel > 0) {
        if (lt) {
          const ltDel = tsOf(lt.deletedAt);
          // 只在远端删除更晚时覆盖本地；本地删得更晚/本地还活着才不打。
          // 注意：本地还活着（ltDel=0）时远端墓碑必须生效——这是别的设备刚删的块。
          if (rtDel >= ltDel) {
            lt.deletedAt = rtDel;
            (lt as { updatedAt?: number }).updatedAt = (rt as { updatedAt?: number }).updatedAt ?? lt.updatedAt;
          }
        }
        continue;
      }
      // 本端没有的块：直接加入（另一端新增的）
      if (!lt) { lp.tasks.push({ ...rt }); continue; }
      // 【关键】本端已删除的块，绝不能被另一端的旧快照「复活」：
      // 另一端在删除发生前发出的 CLIENT_UPDATE / SERVER_BROADCAST 里这个块还是活的，
      // 旧逻辑 rtTs >= ltTs 时 Object.assign 会把 deletedAt 抹掉（rt 里没这个字段不会主动删，
      // 但 rt.deletedAt 为 undefined 的显式字段、以及 page 整体替换都会清掉），
      // 于是「边删边冒出来」。只有当远端块的确晚于本地删除时间（用户在另一台设备
      // 于删除后重新编辑了它）才允许复活。
      const ltDel = tsOf(lt.deletedAt);
      if (ltDel > 0) {
        const rtTs = tsOf((rt as { updatedAt?: number }).updatedAt);
        if (rtTs > ltDel) {
          (lt as { deletedAt?: unknown }).deletedAt = undefined;
          Object.assign(lt, rt);
        }
        continue;
      }
      // 两端都有：谁的块时间戳新就保留谁。
      // 块没有 updatedAt（旧数据）时退化为「远端优先」，与历史行为一致，不至于丢块。
      const ltTs = tsOf((lt as { updatedAt?: number }).updatedAt);
      const rtTs = tsOf((rt as { updatedAt?: number }).updatedAt);
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
/**
 * 单个块的同步字段指纹。页面指纹与「是否给块打戳」共用这一份规则，
 * 避免两处字段清单漂移（只在其中一处加 prevId，块顺序变化就永远推不出去）。
 * 刻意不含块自身的 updatedAt：打戳本身不该改变指纹。
 * payload 必须参与：代码块正文、图片 URL、看板卡片都只存在 payload 里。
 */
const blockFingerprint = (t: Task): string =>
  JSON.stringify([
    t.id, t.type, t.content, t.completed, t.indentLevel,
    t.prevId ?? null, t.payload ?? null, t.deletedAt ?? 0,
  ]);

/**
 * 参与跨设备同步的字段指纹。缺一个字段 = 一类用户操作永远不同步：
 * 之前漏了 prevId / coverPos / 块 payload，导致「拖动排序」「封面重新取景」
 * 「改代码块」都只在本端生效。
 * 刻意不含 fieldTs / updatedAt：打戳本身不该改变指纹。
 */
const syncFingerprint = (p: Page): string =>
  JSON.stringify([
    p.title, p.icon, p.cover, p.coverPos, p.coverMeta ?? null, p.parentId, p.isFavorite,
    p.deletedAt ?? 0, p.isTemplate ?? false, p.prevId ?? null,
    p.tasks.map(blockFingerprint),
  ]);

/** 全量指纹比同步指纹多一个本机视图态：展开/折叠变了也要落盘，但不打戳、不上推。 */
const pageFingerprint = (p: Page): string =>
  JSON.stringify([syncFingerprint(p), p.isExpanded]);

/** 上次提交时的各标量取值，用于判断「这次到底是哪几个字段被改了」。 */
const scalarSnapshot = (p: Page): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const f of PAGE_SCALAR_FIELDS) out[f] = (p as unknown as Record<string, unknown>)[f] ?? null;
  return out;
};

// 上一次「已提交」状态的指纹，用于判断「是否真的变了」
const pageStampCache = new Map<string, string>();
const syncStampCache = new Map<string, string>();
const pageScalarCache = new Map<string, Record<string, unknown>>();
const blockStampCache = new Map<string, string>();

const writeBaselineFor = (p: Page): void => {
  pageStampCache.set(p.id, pageFingerprint(p));
  syncStampCache.set(p.id, syncFingerprint(p));
  pageScalarCache.set(p.id, scalarSnapshot(p));
  for (const t of p.tasks) blockStampCache.set(t.id, blockFingerprint(t));
};

// 启动时把「已落盘的现状」设为基线：后续只有真正被用户改动的页才会打戳上推。
const initStampBaseline = (pages: Page[]): void => {
  pageStampCache.clear();
  syncStampCache.clear();
  pageScalarCache.clear();
  blockStampCache.clear();
  for (const p of pages) writeBaselineFor(p);
};

/**
 * 远端数据应用后，把**来自远端的页**设为已提交基线（不打时间戳、不推送）。
 *
 * 这是「应用远端 → 本端不回环」的正确解法：此前只靠 remoteApplying 把 watch
 * 回调丢掉，4s 后的 reconcile 看到指纹与旧基线不符，会把刚收到的远端快照当成
 * 「本地漏改」重新打戳推回去，形成 A 推 → B 广播 → A 又推的回环。
 *
 * 只处理 remoteIds（本次广播 / 初始同步真正带来的页），且跳过 skipIds（应用窗口
 * 内本端产生的编辑、以及此前已标脏待提交的页）——这些留给 commitPages 打戳上推。
 * 本地新建的页不在 remoteIds 中，基线保持缺失，下一次提交自然会把它推出去。
 */
const resyncStampBaseline = (pages: Page[], remoteIds: Set<string>, skipIds: Set<string>): void => {
  for (const p of pages) {
    if (!remoteIds.has(p.id) || skipIds.has(p.id)) continue;
    writeBaselineFor(p);
  }
};

// onlyIds：只指纹这些页（调用方已明确知道哪些页动过）。
// 不给时按全量处理（结构变化等低频场景）。
// 返回 { changed: 需要上推的页, localOnly: 只有本机视图态变了，仅落盘 }。
const stampUpdated = (pages: Page[], onlyIds?: string[]): { changed: string[]; localOnly: boolean } => {
  const now = Date.now();
  const changed: string[] = [];
  let localOnly = false;
  const filter = onlyIds ? new Set(onlyIds) : null;
  for (const p of pages) {
    if (filter && !filter.has(p.id)) continue;
    const fp = pageFingerprint(p);
    if (pageStampCache.get(p.id) === fp) continue;   // 完全没变
    pageStampCache.set(p.id, fp);
    const sfp = syncFingerprint(p);
    if (syncStampCache.get(p.id) === sfp) {
      // 仅展开/折叠变了：本机落盘即可，不打 updatedAt、不推给其它设备，
      // 避免一次目录树操作就在另一台设备上刷出新时间戳。
      localOnly = true;
      continue;
    }
    syncStampCache.set(p.id, sfp);

    // 逐字段打版本戳：只给真正改过的标量更新 fieldTs，其它字段的时间戳保持不动。
    // 这样两台设备分别改封面 / 图标时，各自的选择都能存活，不再整组后写胜。
    const prev = pageScalarCache.get(p.id) ?? {};
    const cur = scalarSnapshot(p);
    const fieldTs: Record<string, number> = { ...(p.fieldTs ?? {}) };
    // 存量页首次进入逐字段版本化：未改动的字段必须继承「旧的整页时间戳」，
    // 不能留空去回退到本次的 now —— 否则这份旧值会被误判成刚做的新选择，
    // 把另一台设备并发改的同名字段冲掉。
    if (!p.fieldTs) {
      const legacyTs = tsOf(p.updatedAt);
      for (const f of PAGE_SCALAR_FIELDS) fieldTs[f] = legacyTs;
    }
    for (const f of PAGE_SCALAR_FIELDS) {
      if (JSON.stringify(prev[f] ?? null) !== JSON.stringify(cur[f] ?? null)) fieldTs[f] = now;
    }
    pageScalarCache.set(p.id, cur);
    p.fieldTs = fieldTs;
    p.updatedAt = now;
    changed.push(p.id);

    for (const t of p.tasks) {
      const bfp = blockFingerprint(t);
      if (blockStampCache.get(t.id) === bfp) continue;  // 块没变 → 不打戳
      blockStampCache.set(t.id, bfp);
      t.updatedAt = now;
    }
  }
  return { changed, localOnly };
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

// 后端落库会把 updatedAt/deletedAt 归一成 ISO 字符串，本地统一用 ms 数字。
// 入口处一次性转换，让 stampUpdated 打戳、mergePages 比较、cursor 计算拿到同源数据。
const normalizeTs = (v: unknown): number | undefined => {
  const ms = tsOf(v);
  return ms > 0 ? ms : undefined;
};

/** 字段版本戳只认正数 ms；脏值丢弃后回退到整页时间戳，不让坏数据污染 LWW。 */
const normalizeFieldTs = (v: unknown): Record<string, number> | undefined => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: Record<string, number> = {};
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    const n = typeof raw === 'number' ? raw : tsOf(raw);
    if (k && Number.isFinite(n) && n > 0) out[k] = n;
  }
  return Object.keys(out).length ? out : undefined;
};

export const sanitizeLoadedPages = (pages: Page[]): Page[] =>
  pages.map((p) => ({
    ...p,
    updatedAt: normalizeTs(p.updatedAt),
    deletedAt: normalizeTs(p.deletedAt),
    // 服务端不再下发本机视图态；给个默认展开初值，之后完全由本机维护。
    isExpanded: p.isExpanded ?? true,
    fieldTs: normalizeFieldTs(p.fieldTs),
    tasks: (p.tasks ?? []).map((t) => {
      let task: Task = { ...t, updatedAt: normalizeTs(t.updatedAt), deletedAt: normalizeTs(t.deletedAt) };
      if (task.content && task.content.indexOf('blob:') > -1) {
        // blob: URL 随文档卸载即失效，重启后必然变成破图。
        task = { ...task, content: stripDeadBlobImages(task.content) };
      }
      // 历史bug自愈：旧版触发「[] +空格」快捷键时 DOM 残留会被后续编辑写进持久化数据，
      // 待办块内容只剩「[]」这一确凿残留特征，加载时清掉（范围极窄，不误伤正常文本）。
      // 注意浏览器 contenteditable 把空格存成不间断空格 \u00A0，旧数据里是「[]\u00A0」而非「[] 」，
      // 所以正则要同时覆盖普通空格与 \u00A0，否则清不干净。
      if (task.type === 'todo' && /^\[\][ \u00A0]*$/.test(task.content)) {
        task = { ...task, content: '' };
      }
      return task;
    }),
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
// 未显式配置时，默认回退到「页面所在的源」(location.origin)：标准自托管里前端由后端
// 同源托管（或经同一 Tunnel 暴露），后端就在该源提供 /api 与 /ws/sync，开箱即连，
// 省去手工填地址。仅当「前端与后端跨域分离部署」时才需要显式配置 syncServer。
// 例外：Capacitor 原生 WebView 用 https://localhost 承载**本地打包资源**，它不是后端；
// 若拿它当同源推断，所有 REST/WS 都会打进 WebView 本地（表现为「配了地址也连不上」）。
// Vite dev 的 localhost 同理走相对 /api 交给代理，所以一律排除 localhost。
// file:// 等非 http(s) 源没有可用后端，保持空（纯本地模式），避免无意义重连。
const _pageOrigin =
  typeof window !== 'undefined'
  && /^https?:$/.test(window.location.protocol)
  && window.location.hostname !== 'localhost'
    ? window.location.origin
    : '';
const SYNC_SERVER = (getRuntimeConfig().syncServer || import.meta.env.VITE_SYNC_SERVER || _pageOrigin || '').replace(/\/+$/, '');
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
// === 同步状态域（三个入口共享的唯一状态）===
//   本地变更：captureLocalChange / requestCommit → commitPages（唯一上推口）
//   远端变更：applyRemotePages（唯一应用口）
//   服务端写入：_apply_incoming（backend，WS 与 REST 共用）
// 三者互不感知对方的实现细节，修某个 CRUD 不需要再往同步层打补丁。
let remoteApplying = false;   // 仅在 applyRemotePages 的应用窗口内为 true
// 应用窗口内发生的本地页变更既不丢弃、也不立刻推送，先暂存：
// 应用结束后统一补提交，否则「边删边收到广播」时删除会被静默吞掉。
// 无 id 的结构回调主要来自远端整表赋值本身，不用暂存——真实的「本地新建页」
// 由 applyRemotePages 比对应用前后的 id 集合单独识别并补推。
let pendingLocalDirty = new Set<string>();
const captureLocalChange = (id?: string): void => {
  if (id) pendingLocalDirty.add(id);
};
// 广播按到达顺序串行应用：多条 SERVER_BROADCAST 各自 await 后整表赋值会互相覆盖，
// 后完成的旧快照可能把先完成的新快照（含刚删的墓碑）盖回去。
let remoteApplyChain: Promise<void> = Promise.resolve();
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
    // 远端应用窗口内不立刻回推，但**必须暂存**：原先直接 return 会把此时
    // 新建 / 删除页这类结构变更永久吞掉（新增页在另一台设备上始终不出现）。
    if (remoteApplying) { captureLocalChange(id); return; }
    requestCommit(id);
  };

  // 让「每页一个 deep watch」的集合与当前 pages 保持一致：
  // 新增页补订阅、删除页退订、整表替换（撤销/导入）时按对象身份重建。
  // 页面级同步字段签名：只读标量 + tasks 引用，**不 deep traverse 块内容**。
  // 于是「改标题 / 图标 / 封面 / 收藏 / 墓碑 / 排序」全部由这一处 watch 进入提交口，
  // 不必在每个 mutation 点手写 markDirty（过去漏掉的地方就永远不同步）。
  // 块内容改动仍由编辑器显式 markDirty，避免回到「一次击键 traverse 全库」的老问题。
  const pageSignature = (p: Page) => [
    p.title, p.icon, p.cover, p.coverPos, p.coverMeta, p.parentId, p.isFavorite, p.isExpanded,
    p.deletedAt, p.isTemplate, p.prevId, p.tasks,
  ];

  const syncPageWatchers = () => {
    const pages = pagesRef.value ?? [];
    const alive = new Set<string>();
    for (const p of pages) {
      alive.add(p.id);
      const cur = pageWatchStops.get(p.id);
      if (cur && cur.obj === p) continue;      // 仍是同一个对象，保留已有订阅
      if (cur) cur.stop();
      const stop = watch(() => pageSignature(p), () => onChange(p.id));
      pageWatchStops.set(p.id, { obj: p, stop });
    }
    for (const [id, rec] of [...pageWatchStops]) {
      if (!alive.has(id)) { rec.stop(); pageWatchStops.delete(id); }
    }
  };
  syncPageWatchers();

  // 结构变化：整表替换 / push / splice 替换元素时都要重建按页订阅。
  // 展开每页对象让 getter 订阅数组索引：writePagePrevIds 那种「length 不变、
  // 元素全换」的写法若只监听 length，旧订阅会一直挂在已废弃的对象上，
  // 之后所有字段改动都检测不到。
  const stopStructure = watch(
    () => [pagesRef.value, pagesRef.value?.length, ...(pagesRef.value ?? []).map((p) => p)],
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
// 于是「编辑后立刻切走 / 进程被杀」会丢掉最后改动。移动端进程更易被回收，这个窗口是真实的数据丢失点。
// 升级为 leading + trailing：首次调用立即执行（leading，首字符零延迟上推），
// 之后 wait 内的连续调用合并到尾缘再执行一次（trailing，停手收尾）。
// 既能把「首个改动」近乎实时同步出去（解决原先纯尾缘防抖带来的感知延迟），
// 又不会因连续击键产生高频发送——一段连续输入整段只在「首发 + 停手」各推一次，且每次仍只推变化页。
function debounce<T extends (...args: any[]) => void>(fn: T, wait: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Parameters<T> | null = null;

  const debounced = (...args: Parameters<T>) => {
    pending = args;
    if (timer) {
      // 已排程尾缘：重置计时以合并连续调用，不重复首发
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        pending = null;
        void fn(...args);
      }, wait);
      return;
    }
    // 首次调用：立即首发（leading）
    void fn(...args);
    pending = null;
    timer = setTimeout(() => {
      timer = null;
      if (pending) {
        const a = pending;
        pending = null;
        void fn(...a);
      }
    }, wait);
  };

  // 立即执行挂起的尾缘调用（若有），返回是否真的执行过；pagehide/切后台时兜底，避免丢最后改动。
  // leading 已即时发出，pending 为空表示没有挂起的新内容，返回 false 即可（数据不丢）。
  debounced.flush = (): boolean => {
    if (!timer) return false;
    clearTimeout(timer);
    timer = null;
    if (pending) {
      const a = pending;
      pending = null;
      void fn(...a);
      return true;
    }
    return false;
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
  const { changed, localOnly } = stampUpdated(pages, onlyIds);
  // 没有任何可同步的变化：本机视图态仍需落盘（展开/折叠要记住），但不推送。
  if (changed.length === 0) {
    if (localOnly) void saveLocal(pages);
    return;
  }
  void snapshotPages(pages, changed);          // 页面历史：对变化页节流存档
  void persistPages(pages, changed);
};
// 发送窗口 300ms：首发零延迟 + 停手 300ms 收尾，连续输入合并只发两次（首/尾），
// 在「实时感」与「发送频率」间取平衡（Notion 类体验约 150~300ms 阈值内即感知为实时）。
const debouncedCommit = debounce(commitPages, 300);

// P1 块级隔离：显式标脏 + 触发防抖提交，取代「每页 deep watch 隐式触发整页遍历」。
// 编辑器知道某页被改时调 markDirty(id)；浅 watch 只兜页面对象整体替换；4s 对账兜其余漏网。
const requestCommit = (id?: string) => {
  dataVersion.value++;
  if (id) dirtyPageIds.add(id); else structureDirty = true;
  if (currentPagesRef) debouncedCommit(currentPagesRef.value);
};
// 本地内容变更的唯一显式入口：编辑器改任意字段 / 块 / 顺序都走这里。
export const markDirty = (pageId: string) => {
  if (remoteApplying) { captureLocalChange(pageId); return; }
  requestCommit(pageId);
};
const flushPendingLocalDirty = () => {
  const ids = [...pendingLocalDirty];
  pendingLocalDirty.clear();
  for (const id of ids) requestCommit(id);
};

/**
 * 远端数据的唯一应用入口：INITIAL_SYNC / SERVER_BROADCAST / REST 全量兜底共用。
 *
 * 串行化（remoteApplyChain）+ 以内存 pagesRef 为合并基准 + 应用窗口隔离 +
 * 基线重建 + 窗口内本地变更补提交，这一整套对「新增、删除、编辑、排序、并发」
 * 是同一套语义，不再为每种 CRUD 分别加时间窗补丁。
 */
const applyRemotePages = (incoming: Page[]): void => {
  const remoteIds = new Set(incoming.map((p) => p.id));
  remoteApplyChain = remoteApplyChain.then(async () => {
    remoteApplying = true;
    const beforeIds = new Set((currentPagesRef?.value ?? []).map((p) => p.id));
    let hasLocalNewPage = false;
    try {
      const current = currentPagesRef?.value ?? [];
      // 以内存为基准：磁盘在 300ms 防抖窗口内仍是操作前的旧快照，
      // 用它做 base 会把刚删的块 / 刚建的页覆盖回去。
      const base = current.length > 0 ? mergePages(current, incoming) : incoming;
      const ordered = orderPages(base);
      // 远端整表赋值本身必然产生一次结构 watch，不能把它当成本地改动，
      // 否则每条广播都会无谓地 dataVersion++ 并全量扫描；但用户恰好在
      // 应用窗口内新建的页必须识别出来并补推给其它设备。
      hasLocalNewPage = ordered.some((p) => !beforeIds.has(p.id) && !remoteIds.has(p.id));
      if (currentPagesRef) currentPagesRef.value = ordered;
      lastSyncError.value = '';
      await saveLocal(currentPagesRef?.value ?? []);
    } catch (e) {
      lastSyncError.value = '同步接收失败：' + (e instanceof Error ? e.message : String(e));
      console.error('[NEXUS] 远端数据应用失败', e);
    } finally {
      // Vue watch 异步 flush：让「整表赋值」引发的回调在标志仍为 true 时跑完，
      // 否则它会在复位后执行，把远端数据误判成本地改动推回去形成回环。
      await nextTick();
      remoteApplying = false;
      // 先把远端带来的页设成「已提交」，再补提交本端窗口内的编辑。
      // 顺序不能反：先 flush 会把本地编辑写进基线，导致它们永远不再被上推。
      const skip = new Set<string>([...pendingLocalDirty, ...dirtyPageIds]);
      resyncStampBaseline(currentPagesRef?.value ?? [], remoteIds, skip);
      flushPendingLocalDirty();
      if (hasLocalNewPage) requestCommit();   // 全量扫描把窗口内新建的页打戳上推
    }
  });
};

const reconcile = () => {
  const pages = currentPagesRef?.value;
  // 远端应用期间跳过对账：此刻 pages 是刚收到的远端快照，指纹差异会被误判为
  // 「本地漏改」而打新戳上推，把旧快照回灌给服务端并广播到其它设备。
  if (remoteApplying || !pages || !reconcilePageId || document.visibilityState === 'hidden') return;
  const p = pages.find((x) => x.id === reconcilePageId);
  if (!p) return;
  // 激活页当前内容指纹 ≠ 上次提交时打的戳，且没被显式标脏 → 有漏网修改，补一次提交
  if (pageFingerprint(p) !== pageStampCache.get(p.id) && !dirtyPageIds.has(p.id)) {
    dataVersion.value++;
    dirtyPageIds.add(p.id);
    commitPages(pages);   // 直接提交（debouncedCommit.flush 仅在「有挂起调用」时才执行，这里没有，故直接调 commitPages）
  }
};

// CLIENT_UPDATE 单帧字节上限：Cloudflare / 隧道会静默丢弃数 MB 的 WS 帧。
// 一次提交可能包含全库（首次补齐页面 prevId 链、导入后重基线），不切片就会
// 「明明推了，另一端什么也没收到」。每帧都是完整的页子集，服务端走同一个
// 写入口按并集合并，逐帧处理与一次全量等价。
const WS_UPLOAD_MAX_BYTES = 96 * 1024;
const chunkPagesForUpload = (pages: Page[]): Page[][] => {
  const chunks: Page[][] = [];
  let buf: Page[] = [];
  let bytes = 0;
  for (const p of pages) {
    const size = new TextEncoder().encode(JSON.stringify(p)).length;
    if (buf.length && bytes + size > WS_UPLOAD_MAX_BYTES) {
      chunks.push(buf);
      buf = [];
      bytes = 0;
    }
    buf.push(p);   // 单页超预算也单独成帧，不无限循环
    bytes += size;
  }
  if (buf.length) chunks.push(buf);
  return chunks.length ? chunks : [[]];
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
    // 上推前剥掉本机视图态（isExpanded）；本机 pages 原样保留，落盘不受影响。
    const payload = (changedSet ? pages.filter((p) => changedSet.has(p.id)) : pages).map(forSyncPage);
    // 多帧共用同一个 clientSeq：服务端逐帧回 ACK，前端按 acceptedIds 逐步从
    // outbox 剔除已确认页；任一帧丢失时重连仍会补发完整快照。
    for (const chunk of chunkPagesForUpload(payload)) {
      try {
        sendWS({ type: 'CLIENT_UPDATE', data: chunk, clientSeq });
      } catch (e) { /* 发送瞬间断线：留在 outbox，onopen 会补发 */ }
    }
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
  flushSessionReport();
};

// === REST 客户端 ===
const apiRequest = async (endpoint: string, options?: RequestInit): Promise<any> => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string> | undefined),
  };
  if (SYNC_API_KEY) headers['Authorization'] = `Bearer ${SYNC_API_KEY}`;
  const res = await apiFetch(`${API_BASE}${endpoint}`, { ...options, headers });
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
  // 与 WS 的 INITIAL_SYNC 走完全相同的合并 / 基线 / 补提交语义
  applyRemotePages(sanitizeLoadedPages(remote));
};

// 推送全量到服务端（服务端会广播给其他设备）
export const pushAll = async (pages: Page[]) => {
  // 【阶段一修复】同 persistPages：不再无条件给每一页刷 updatedAt。
  // 否则「启动即 pushAll」= 用本地时间戳强行覆盖服务端，必然冲掉另一端的改动。
  clientSeq += 1;
  outboxSeq = clientSeq;
  outboxPages = pages;
  try {
    // 与 persistPages 同一套分片规则：全量补发同样不能塞进一条数 MB 的 WS 帧
    for (const chunk of chunkPagesForUpload(pages.map(forSyncPage))) {
      await sendWS({ type: 'CLIENT_UPDATE', data: chunk, clientSeq });
    }
  } catch (e) {
    // WS 正在连接中：onopen 会补发 outbox，这里别再逐页 REST（否则每次启动都 121 个串行 PUT）。
    if (socket && socket.readyState === WebSocket.CONNECTING) return;
    // 后端不可达（未配置，或探测/连接都从没成功过）：跳过 REST，避免纯本地或后端下线时刷 404/错误。
    if (!backendReachable) return;
    // WS 已断开且无正在进行的连接 → 退化为 REST 全量保存（尽力而为）
    try {
      for (const p of pages) {
        await apiRequest(`/pages/${p.id}`, { method: 'PUT', body: JSON.stringify(forSyncPage(p)) });
      }
    } catch (_) { /* 静默：LocalFirst 不阻塞编辑 */ }
  }
};

/**
 * 「整表替换」的唯一提交入口：备份恢复 / Markdown 导入 / ZIP 导入都走这里。
 * 落盘 + 重建基线 + 全量上推顺序固定：若不重建基线，整表赋值触发的 watch 会在
 * 300ms 后把全库当成「本端新编辑」逐页打新戳再推一遍，把其它设备刚改的内容冲掉。
 */
const commitReplaceAll = async (pages: Page[]): Promise<void> => {
  if (!currentPagesRef) return;
  currentPagesRef.value = pages;
  initStampBaseline(pages);
  await saveLocal(pages);
  await pushAll(pages);
};

// 兼容旧调用方保留，但编辑器已不再直连 REST：任何本地变更一律走 markDirty → CLIENT_UPDATE。
// REST 与 WS 现在共用服务端同一个写入口（_apply_incoming），双写只会制造竞态。
/** @deprecated 使用 markDirty / commitReplaceAll */
export const createRemotePage = async (page: Page) => {
  if (!SYNC_SERVER && !backendReachable) return null;   // 纯本地：无后端可推，跳过避免 404
  try {
    const r = await apiRequest('/pages', { method: 'POST', body: JSON.stringify(forSyncPage(page)) });
    return r?.success ? r.data : null;
  } catch (e) { return null; }
};

export const deleteRemotePage = async (id: string) => {
  if (!SYNC_SERVER && !backendReachable) return;        // 纯本地：无后端可推，跳过避免 404
  try { await apiRequest(`/pages/${id}`, { method: 'DELETE' }); } catch (e) { /* ignore */ }
};

export const updateRemotePage = async (page: Page) => {
  if (!SYNC_SERVER && !backendReachable) return;        // 纯本地：无后端可推，跳过避免 404
  try { await apiRequest(`/pages/${page.id}`, { method: 'PUT', body: JSON.stringify(forSyncPage(page)) }); } catch (e) { /* ignore */ }
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
  // 未配置访问密钥：直接稳定离线（LOCAL 模式），不发起任何连接与重连。
  // 本地编辑 / 光标跟随完全是本地优先（LocalFirst），与远端鉴权解耦——
  // 没配 key 也能丝滑跟手，避免空 key 反复重连造成的连接抖动。
  if (!SYNC_API_KEY) {
    syncStatus.value = 'offline';
    lastAuthError.value = '';
    return;
  }
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
    // 离线期间用户切过文档：建连后补一次会话上报（时间戳仍是操作时刻，
    // 服务端 LWW 会自动丢弃「比另一台设备更晚的操作」之前的迟到状态）。
    if (sessionReportPending) void sendSessionReport();
  };

  mySocket.onmessage = (event) => {
    if (socket !== mySocket) return;  // 过期连接，忽略
    try {
      const msg = JSON.parse(event.data);

      // 会话接力：只更新状态，切不切页由上层按「冷启动 / 用户是否已选页」决定。
      if (msg.type === 'SESSION_STATE') { acceptSessionState(msg.data); return; }

      // P2：资产就绪广播。用动态 import 保持资产层懒加载，不与同步主模块硬耦合。
      if (msg.type === 'ASSET_READY') {
        const id = typeof msg.assetId === 'string' ? msg.assetId : '';
        if (id) void import('./assets').then((m) => m.onAssetReady(id));
        return;
      }

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
        // 阶段二 2.2：用本批数据的最大时间戳更新本地水位，作为下次增量拉取的 since。
        // 存量数据里时间戳可能是 ISO 字符串，统一经 tsOf 归一，避免 NaN 污染 cursor。
        let maxTs = 0;
        for (const p of incoming) {
          maxTs = Math.max(maxTs, tsOf(p.updatedAt), tsOf(p.deletedAt));
          for (const t of p.tasks) maxTs = Math.max(maxTs, tsOf(t.updatedAt));
        }
        if (maxTs > lastSyncCursor.value) { lastSyncCursor.value = maxTs; void saveCursor(); }
        // SERVER_BROADCAST 是服务端按字节切分的独立增量帧：每帧都是完整的页子集，
        // 逐帧串行应用即可（mergePages 是并集合并，未提及的页保持原样）。
        applyRemotePages(incoming);
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
      // 服务端因密钥无效主动断开（见 backend main.py WS 握手 close(1008)）。
      // 密钥没变，重连必然继续失败——直接稳定离线，避免无意义的反复重连抖动，
      // 让本地编辑 / 光标跟随与鉴权彻底解耦（LocalFirst 永不阻塞）。
      lastAuthError.value = '密钥被拒绝（后端返回 1008）：访问密钥不正确，或后端未启用该密钥';
      syncStatus.value = 'offline';
      socket = null;
      accountInfo.value = null;
      return;  // 不 scheduleReconnect
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
    const res = await apiFetch(`${API_BASE}/me`, { headers });
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
  // 1) 连通性。把底层原因带出来：跨域被拦、DNS/TLS 失败、HTTP 错误字面各不相同，
  //    统一写成「请检查地址或网络」会让用户无法定位（尤其是 CORS 被拒的情况）。
  const hint = '（请检查地址、网络；安卓还需确认后端 CORS 放行 https://localhost）';
  try {
    const h = await apiFetch(`${base}/health`);
    if (!h.ok) return { state: 'unreachable', message: `后端健康检查失败（HTTP ${h.status}）${hint}` };
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    return { state: 'unreachable', message: `无法连接后端：${why}${hint}` };
  }
  // 2) 鉴权 + 数据量
  const k = (key || '').trim();
  const headers: Record<string, string> = {};
  if (k) headers['Authorization'] = `Bearer ${k}`;
  let res: Response;
  try {
    res = await apiFetch(`${base}/me`, { headers });
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    return { state: 'unreachable', message: `无法连接后端：${why}${hint}` };
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
  if (sessionReportTimer) { clearTimeout(sessionReportTimer); sessionReportTimer = null; }
  if (socket) { socket.onclose = null; socket.close(); socket = null; }
  if (stopWatch) { stopWatch(); stopWatch = null; }
  // 同步状态域整体复位：HMR / 重复挂载时不能把上一次会话的「待补提交」和
  // 应用链带进新会话，否则新连接会立刻提交一批已失效的页 id。
  pendingLocalDirty.clear();
  remoteApplying = false;
  remoteApplyChain = Promise.resolve();
  dirtyPageIds.clear();
  structureDirty = false;
  pageStampCache.clear();
  syncStampCache.clear();
  pageScalarCache.clear();
  blockStampCache.clear();
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
    // 与 loadLocal 走同一份清洗：把后端墓碑的 ISO 字符串时间戳统一成 ms 数字
    // （否则 mergePages 里比较 deletedAt 会出错），并剔除失效的 blob: 图片引用。
    const restored = sanitizeLoadedPages(pages);
    // 显式落盘 + 基线 + 上推，不依赖 watch 兜底（整表替换时按页订阅未必触发）。
    await commitReplaceAll(restored);
    return { ok: true, message: `已导入 ${restored.length} 个页面` };
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

    // 文件名已作为页面标题，正文首行 `# 标题` 属重复回显，剔除以免标题栏与正文各显示一遍。
    // 必须在重建 prevId 链之前做，否则链首会指向一个已删除的块。
    const kept = stripLeadingTitleEcho(blocks, title);

    const tasks = kept.map((b) => ({
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

    await commitReplaceAll([...currentPagesRef.value, page]);

    const detail = `导入「${title}」：${kept.length} 个块` + (downgraded > 0 ? `，${downgraded} 行降级为文本` : '');
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

    await commitReplaceAll([...currentPagesRef.value, ...result.pages]);

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
  /** true=本地已存但后端未收到（上传失败/离线），其他设备会破图 */
  upload?: boolean;
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
    // 回收被换掉的旧图：否则「压缩版」和「原图版」会在 IndexedDB 里同时躺着，白占一份
    const stillUsed = collectAssetRefs(next);
    const orphans = [...replacedRefs].filter((r) => !stillUsed.has(r));
    if (orphans.length > 0) {
      const { deleteAsset } = await import('./assets');
      for (const r of orphans) void deleteAsset(r);
      reclaimed = orphans.length;
    }

    await commitReplaceAll(next);

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
// 首次装机的默认种子页模板。同一份常量既用于创建，也用于「退化种子页」识别，
// 避免两处各写一份文案、改了模板却认不出旧种子。
const SEED_PAGE_ID = 'default-page';
const SEED_TITLE = 'NEXUS 协议指南';
const SEED_BLOCKS: { type: string; content: string; indentLevel: number }[] = [
  { type: 'h1', content: '欢迎使用 NEXUS MATRIX', indentLevel: 0 },
  { type: 'text', content: '这是一个本地优先（LocalFirst）的工业风区块编辑器。', indentLevel: 0 },
  { type: 'bullet', content: '输入 / 唤出命令菜单，或 # / - / [] 快捷转换块类型。', indentLevel: 1 },
  { type: 'todo', content: '数据保存在本机，刷新不会丢失。', indentLevel: 1 },
];

/**
 * 是否是「未被用户编辑过」的占位种子页：标题一致 + 块序列与模板逐字相同。
 * 只要用户改过标题 / 增删块 / 写过字，就不再匹配——绝不把真实笔记误判成退化产物丢弃。
 */
const isUntouchedSeedPage = (p: Page): boolean => {
  if (p.id !== SEED_PAGE_ID || p.title !== SEED_TITLE) return false;
  const tasks = p.tasks ?? [];
  if (tasks.length !== SEED_BLOCKS.length) return false;
  return tasks.every((t, i) => t.type === SEED_BLOCKS[i].type && t.content === SEED_BLOCKS[i].content);
};

/**
 * 本地快照是否已退化成「仅剩默认种子页」。
 *
 * 触发链：某次启动后端 401 / 本地为空 → 走 !local && !remote 分支创建 default-page。
 * 这颗种子页的 updatedAt 是「当下」，比服务端 127 篇文档还新；而增量游标也已被推高，
 * 于是带 since 的握手恒返回空集，本地种子页被当作权威快照永久保留、还会被 pushAll
 * 反推到服务端。表现为「所有文档内容丢失，刷新也回不来」。
 */
const isSeedOnlySnapshot = (pages: Page[] | null): boolean => {
  if (!pages || pages.length === 0) return false;
  const live = pages.filter((p) => !p.deletedAt);
  // 只认「恰好一篇、且内容仍是模板」的退化产物；全墓碑页属于用户主动删光，
  // 不在此列，避免改变删除状态下的正常上推行为。
  return live.length === 1 && isUntouchedSeedPage(live[0]);
};

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
  //    【加固】本地仅剩种子页时忽略游标、强制全量重拉：此时本地不是有效数据，
  //    增量语义（只取 since 之后的变更）恰好会把服务端全量挡在门外。
  const seedOnly = isSeedOnlySnapshot(local);
  if (seedOnly) console.warn('[NEXUS SYNC] 检测到本地仅剩默认种子页，强制全量重拉以恢复文档');
  const remote = await fetchRemotePages(seedOnly ? 0 : lastSyncCursor.value);
  // 会话接力与 pages 握手并行：只拉一份轻量 UI 状态，不阻塞首屏。
  // 拿不到（旧后端 / 离线）就完全退回本机 hash + 本地最近访问。
  void fetchRemoteSession();

  // 原生壳内只要配了后端地址就直接尝试 WS，不再等 REST 探针置位 backendReachable：
  // WebView 的 REST 请求可能被 CORS 拦（探针失败），但 WebSocket 不受 CORS 约束，
  // 且后端连上后会用 INITIAL_SYNC 下发该 room 全部文档——若被 REST 失败卡住，
  // 就会出现「明明能连却一篇文档都拉不下来」。桌面保持原逻辑，避免后端下线时无谓重连。
  if (backendReachable || (SYNC_SERVER && isNativeShell())) connectWS(pagesRef);

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
    //
    // 【加固】强制全量恢复成功后，先剔除本地那颗未被编辑过的占位种子页再合并：
    // 否则 pushAll 会把它推到服务端成为垃圾页，侧边栏也会多出一篇「NEXUS 协议指南」。
    // 仅当远端确实拿到了多篇文档时才剔除，避免远端也是空的场景把唯一页弄丢。
    const base = seedOnly && remote.length > 1
      ? pagesRef.value.filter((p) => !isUntouchedSeedPage(p))
      : pagesRef.value;
    const merged = mergePages(base, sanitizeLoadedPages(remote));
    pagesRef.value = orderPages(merged);
    await saveLocal(pagesRef.value);
    void pushAll(pagesRef.value);
  } else if (local && !remote) {
    // 后端不可用或为空：保持本地并尝试上推（同样不阻塞）。
    // 但退化产物绝不上推：此时服务端可能只是暂时 401，把种子页写进去会污染正式文档。
    if (!seedOnly) void pushAll(pagesRef.value);
  } else if (!local && !remote) {
    // 本地与远端都无数据：创建初始默认页（仅首次装机）
    const seed: Page[] = [{
      id: SEED_PAGE_ID,
      title: SEED_TITLE,
      parentId: null,
      isFavorite: true,
      isExpanded: true,
      tasks: SEED_BLOCKS.map((b) => ({ id: newBlockId(), ...b, completed: false })),
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
  // 初始化完成的这份数据就是「已提交」状态：不设基线的话，4s 后的对账会把
  // 刚加载的全库当成漏改，逐页打新戳推回服务端，形成启动即回环。
  initStampBaseline(pagesRef.value);
  stopWatch = watchPages(pagesRef);
  // P1 过渡期对账：每 4s 用廉价指纹兜一次漏网修改（防漏保存），closeSync 时清理
  if (reconTimer) clearInterval(reconTimer);
  reconTimer = setInterval(reconcile, 4000);

  return !!remote;
};
