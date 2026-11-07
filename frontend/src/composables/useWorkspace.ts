// 架构 2 阶段 1/2/3：多文档工作区 composable。
//  - 工作区级 Y.Doc（room=workspace）用 Y.Array('docs') 存「文档清单」（随协作者同步）：
//    每项 { id, title, icon, createdAt, favorite, snapCount, links, folderId }。
//  - Y.Array('folders') 存「文件夹/分区」树：每项 { id, name, parentId }。
//  - 每篇文档各自一个独立 YjsDocHandle（room=doc-<id>），内容仍是 Y.XmlFragment('doc')，
//    因此快照 / 导入导出 / 协作光标都按「当前文档」天然隔离。
//  - 后端 /ws/yjs 按 room 隔离，多文档即多个 room，无需后端改动。
// 阶段 2：拖拽排序（moveDoc）、收藏（toggleFavorite）、图标（setIcon）、快照计数（setSnapCount）。
// 阶段 3：双向链接（links 出链索引 + 由 docs 反查反向链接）、文件夹/分区（folders 树）、跨文档搜索（见 yjsDoc.yGetDocText）。
import { ref, shallowRef, watch } from 'vue';
import * as Y from 'yjs';
import { createYjsDoc, type YjsDocHandle } from './yjsDoc';
import { newBlockId } from './ids';

export interface WsDoc {
  id: string;
  title: string;
  icon: string;
  createdAt: number;
  favorite: boolean;
  snapCount: number;
  /** 出链：本篇文档引用到的其它文档 id 列表（用于反向链接 / 图谱）。 */
  links: string[];
  /** 所属文件夹 id；null 表示未分类（根）。 */
  folderId: string | null;
}

export interface WsFolder {
  id: string;
  name: string;
  parentId: string | null;
}

const WS_ROOM = 'workspace';
const WS_PAGE = 'workspace';

export function useWorkspace(opts: { connect?: boolean } = {}) {
  // 工作区级文档（文档清单 / 文件夹清单所在）
  const ws = createYjsDoc(WS_ROOM, WS_PAGE, opts);
  const docsArray = ws.ydoc.getArray<Y.Map<any>>('docs');
  const foldersArray = ws.ydoc.getArray<Y.Map<any>>('folders');

  const docs = ref<WsDoc[]>([]);
  const folders = ref<WsFolder[]>([]);
  const activeId = ref<string>('');
  const activeHandle = shallowRef<YjsDocHandle | null>(null);
  const handles = new Map<string, YjsDocHandle>();

  function readDocs() {
    const out: WsDoc[] = [];
    docsArray.forEach((m) => {
      out.push({
        id: m.get('id'),
        title: (m.get('title') as string) || '未命名文档',
        icon: (m.get('icon') as string) || '📄',
        createdAt: (m.get('createdAt') as number) || 0,
        favorite: !!m.get('favorite'),
        snapCount: (m.get('snapCount') as number) || 0,
        links: (m.get('links') as string[]) || [],
        folderId: (m.get('folderId') as string | null) ?? null,
      });
    });
    docs.value = out;
  }
  function readFolders() {
    const out: WsFolder[] = [];
    foldersArray.forEach((m) => {
      out.push({
        id: m.get('id'),
        name: (m.get('name') as string) || '文件夹',
        parentId: (m.get('parentId') as string | null) ?? null,
      });
    });
    folders.value = out;
  }
  // observeDeep：嵌套 Y.Map 的 key 变更（标题/图标/收藏/快照数/链接/文件夹）也要触发刷新，
  // 普通 observe 只响应数组结构性变更（插入/删除），会导致改图标/改链接后侧边栏不同步。
  docsArray.observeDeep(readDocs);
  foldersArray.observeDeep(readFolders);

  function getHandle(id: string): YjsDocHandle {
    let h = handles.get(id);
    if (!h) {
      h = createYjsDoc(`doc-${id}`, id, opts);
      handles.set(id, h);
    }
    return h;
  }

  function createDoc(title = '未命名文档', icon = '📄'): string {
    const id = newBlockId();
    const m = new Y.Map();
    m.set('id', id);
    m.set('title', title);
    m.set('icon', icon);
    m.set('createdAt', Date.now());
    m.set('favorite', false);
    m.set('snapCount', 0);
    m.set('links', []);
    m.set('folderId', null);
    docsArray.push([m]);
    // 同步初始化该文档元信息（标题），供快照 / 导出使用
    const h = getHandle(id);
    h.meta.set('title', title);
    activeId.value = id;
    return id;
  }

  function renameDoc(id: string, title: string) {
    const m = docsArray.toArray().find((x) => x.get('id') === id);
    m?.set('title', title);
    // 若该文档 handle 已加载（通常是当前文档），同步其 meta.title
    const h = handles.get(id);
    if (h) h.meta.set('title', title);
  }

  function setIcon(id: string, icon: string) {
    const m = docsArray.toArray().find((x) => x.get('id') === id);
    m?.set('icon', icon);
  }

  /** 写入本篇文档的出链列表（由编辑器在内容变更时上报）。 */
  function setDocLinks(id: string, ids: string[]) {
    const m = docsArray.toArray().find((x) => x.get('id') === id);
    m?.set('links', ids);
  }

  /** 将文档在清单中移动到 toIndex（基于数组下标）。Y.Array 无 move；
   *  注意不能用 delete 后「原引用」再 insert（Yjs 会报“已集成类型”），
   *  因此复制一份新 Y.Map 插入，原条目删除。id 不变，文档身份保持。 */
  function moveDoc(id: string, toIndex: number) {
    const arr = docsArray.toArray();
    const from = arr.findIndex((x) => x.get('id') === id);
    if (from < 0) return;
    const target = Math.max(0, Math.min(toIndex, arr.length - 1));
    const src = arr[from];
    const copy = new Y.Map();
    src.forEach((value, key) => copy.set(key, value));
    ws.ydoc.transact(() => {
      docsArray.delete(from, 1);
      docsArray.insert(target, [copy]);
    });
  }

  function toggleFavorite(id: string) {
    const m = docsArray.toArray().find((x) => x.get('id') === id);
    if (m) m.set('favorite', !m.get('favorite'));
  }

  function setSnapCount(id: string, n: number) {
    const m = docsArray.toArray().find((x) => x.get('id') === id);
    if (m) m.set('snapCount', n);
  }

  function removeDoc(id: string) {
    const idx = docsArray.toArray().findIndex((x) => x.get('id') === id);
    if (idx >= 0) docsArray.delete(idx, 1);
    const h = handles.get(id);
    if (h) {
      h.destroy();
      handles.delete(id);
    }
    if (activeId.value === id) {
      activeId.value = docs.value[0]?.id ?? '';
      if (!activeId.value) createDoc();
    }
  }

  function selectDoc(id: string) {
    activeId.value = id;
  }

  // ---- 文件夹 / 分区 ----
  function createFolder(name = '新文件夹', parentId: string | null = null): string {
    const id = newBlockId();
    const m = new Y.Map();
    m.set('id', id);
    m.set('name', name);
    m.set('parentId', parentId);
    foldersArray.push([m]);
    return id;
  }
  function renameFolder(id: string, name: string) {
    const m = foldersArray.toArray().find((x) => x.get('id') === id);
    if (m) m.set('name', name);
  }
  /** 删除文件夹：其下文档回到未分类，子文件夹上提到被删文件夹的父级。 */
  function removeFolder(id: string) {
    const folder = foldersArray.toArray().find((x) => x.get('id') === id);
    const parentId = folder?.get('parentId') as string | null;
    ws.ydoc.transact(() => {
      docsArray.toArray().forEach((m) => {
        if (m.get('folderId') === id) m.set('folderId', null);
      });
      foldersArray.toArray().forEach((m) => {
        if (m.get('parentId') === id) m.set('parentId', parentId);
      });
      const idx = foldersArray.toArray().findIndex((x) => x.get('id') === id);
      if (idx >= 0) foldersArray.delete(idx, 1);
    });
  }
  function setDocFolder(docId: string, folderId: string | null) {
    const m = docsArray.toArray().find((x) => x.get('id') === docId);
    if (m) m.set('folderId', folderId);
  }
  /** 移动文件夹到新父级（parentId=null 表示根）。不允许挂到自身或自身的子孙（由调用方保证）。 */
  function moveFolder(id: string, parentId: string | null) {
    if (id === parentId) return;
    const m = foldersArray.toArray().find((x) => x.get('id') === id);
    if (m) m.set('parentId', parentId);
  }

  // 切换文档：维护 activeHandle（懒加载对应 handle）
  watch(
    activeId,
    (id) => {
      activeHandle.value = id ? getHandle(id) : null;
    },
    { immediate: true },
  );

  // IndexedDB 同步后再决定初始状态：已有文档则选第一篇，否则自动建一篇，
  // 避免刷新瞬间因 IndexedDB 未加载而重复建房。
  ws.persistence.whenSynced.then(() => {
    readDocs();
    readFolders();
    if (docs.value.length === 0) createDoc();
    else if (!activeId.value) activeId.value = docs.value[0].id;
  });

  function destroy() {
    docsArray.unobserveDeep(readDocs);
    foldersArray.unobserveDeep(readFolders);
    handles.forEach((h) => h.destroy());
    handles.clear();
    ws.destroy();
  }

  return {
    ws,
    docs,
    folders,
    activeId,
    activeHandle,
    getHandle,
    createDoc,
    renameDoc,
    setIcon,
    setDocLinks,
    moveDoc,
    toggleFavorite,
    setSnapCount,
    removeDoc,
    selectDoc,
    createFolder,
    renameFolder,
    removeFolder,
    setDocFolder,
    moveFolder,
    destroy,
  };
}
