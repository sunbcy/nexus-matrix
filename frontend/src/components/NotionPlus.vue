<template>
  <div class="flex h-screen w-full bg-[#090a0c] text-[#e5e7eb] font-sans overflow-hidden">
    
    <!-- 左侧边栏 (Sidebar) -->
    <aside class="w-64 bg-[#14161a] border-r border-[#1e2126] flex flex-col shrink-0 transition-all">
      <!-- 侧边栏头部 -->
      <div class="h-14 px-4 flex items-center justify-between border-b border-[#1e2126] shadow-sm">
        <div class="flex items-center gap-2">
          <span class="w-2 h-2 bg-[#00f0ff] rounded-sm shadow-[0_0_8px_rgba(0,240,255,0.6)] animate-pulse"></span>
          <span class="font-['Rajdhani',sans-serif] font-bold tracking-widest text-[#e5e7eb] text-sm">NEXUS MATRIX</span>
        </div>
        <button @click="createPage" class="w-6 h-6 flex items-center justify-center rounded bg-[#1e2126] text-[#6b7280] hover:text-[#00f0ff] hover:bg-[#090a0c] transition-colors shadow-sm" title="新建子程序">
          +
        </button>
      </div>

      <!-- 页面列表树 -->
      <div class="flex-1 overflow-y-auto py-3 px-2 space-y-1 custom-scrollbar">
        <div class="text-xs font-['JetBrains_Mono',monospace] text-[#6b7280] mb-2 px-2 uppercase tracking-wider">子程序池</div>
        
        <div v-for="page in pages" :key="page.id"
             class="group relative flex items-center justify-between px-3 py-2 rounded-md cursor-pointer transition-colors"
             :class="activePageId === page.id ? 'bg-[#1e2126] text-[#00f0ff]' : 'text-[#6b7280] hover:bg-[#1e2126]/50'">
          
          <!-- 页面标题（支持双击编辑） -->
          <div class="flex-1 flex items-center gap-2 min-w-0">
            <svg class="w-4 h-4 opacity-70 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            
            <!-- 编辑模式 -->
            <input v-if="editingPageId === page.id"
                   v-model="editingTitle"
                   @blur="savePageTitle(page.id)"
                   @keyup.enter="savePageTitle(page.id)"
                   @keyup.escape="cancelEditTitle"
                   ref="editInputRef"
                   class="flex-1 min-w-0 bg-transparent text-sm font-medium text-[#00f0ff] outline-none border-b border-[#00f0ff] focus:border-[#00f0ff]/50 transition-colors"
                   @click.stop />
            
            <!-- 显示模式 -->
            <span v-else 
                  @dblclick="startEditTitle(page.id, page.title)"
                  class="text-sm truncate font-medium cursor-text hover:text-[#00f0ff]/80 transition-colors"
                  :title="'双击编辑标题'">
              {{ page.title || '未命名子程序' }}
            </span>
          </div>
          
          <!-- 操作按钮 -->
          <div class="flex items-center gap-1">
            <!-- 删除页面按钮 -->
            <button @click.stop="deletePage(page.id)" 
                    class="opacity-0 group-hover:opacity-100 text-[#6b7280] hover:text-[#ff2a2a] transition-all p-1"
                    :disabled="pages.length <= 1"
                    :title="'删除页面'">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
            
            <!-- 保存状态指示器 -->
            <div v-if="savingPageId === page.id" class="w-3 h-3 border-2 border-[#00f0ff] border-t-transparent rounded-full animate-spin"></div>
          </div>
        </div>
      </div>
    </aside>

    <!-- 右侧主编辑区 (Editor Main) -->
    <main class="flex-1 overflow-y-auto relative custom-scrollbar flex flex-col" v-if="activePage">
      
      <!-- 顶部装饰条 -->
      <div class="w-full h-1 bg-[#00f0ff] shadow-[0_0_10px_rgba(0,240,255,0.4)] shrink-0"></div>

      <!-- 编辑器核心内容区 -->
      <div class="max-w-4xl w-full mx-auto p-12 flex-1 flex flex-col">
        
        <!-- 页面大标题 -->
        <input type="text" v-model="activePage.title" 
               placeholder="无标题"
               class="w-full bg-transparent border-none outline-none font-['Rajdhani',sans-serif] text-5xl font-bold tracking-tight text-[#e5e7eb] placeholder-[#6b7280]/30 mb-10 pb-4 border-b border-[#1e2126]" />

        <!-- 任务区块矩阵 -->
        <div class="flex-1 relative cursor-text pb-32" @click="handleEmptyClick">
          
          <!-- 任务行循环渲染 -->
          <template v-for="flatTask in getFlatTaskList()" :key="flatTask.task.id">
            <div :class="getTaskContainerClass(flatTask.task)"
                 :style="getIndentStyle(flatTask.level)"
                 :data-task-id="flatTask.task.id"
                 :data-level="flatTask.level"
                 class="drag-handle"
                 draggable="true"
                 @dragstart="(e) => handleDragStart(e, flatTask.task.id)"
                 @dragend="handleDragEnd"
                 @dragover="(e) => handleDragOver(e, flatTask.task.id, (e.currentTarget as HTMLElement).getBoundingClientRect())"
                 @drop="(e) => handleDrop(e, flatTask.task.id)">
              
              <!-- 多功能操作按钮（拖拽手柄 + 类型切换菜单） -->
              <div 
                class="mt-1.5 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity text-[#6b7280] hover:text-[#00f0ff]"
                @mousedown="(e) => handleMultiFunctionClick(e, flatTask.task.id)"
                @contextmenu.prevent="(e) => openActionMenu(e, flatTask.task.id)"
                title="拖拽排序 / 右键菜单">
                <!-- 拖拽模式：6个点 -->
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="9" cy="12" r="1"></circle><circle cx="9" cy="5" r="1"></circle><circle cx="9" cy="19" r="1"></circle>
                  <circle cx="15" cy="12" r="1"></circle><circle cx="15" cy="5" r="1"></circle><circle cx="15" cy="19" r="1"></circle>
                </svg>
              </div>
              
              <!-- 层级指示线 -->
              <div v-if="flatTask.level > 0" class="mt-3 w-4 h-px bg-[#1e2126] shrink-0"></div>

              <!-- 区块类型前缀 -->
              <div v-if="flatTask.task.type === 'todo'" class="mt-1.5 relative flex items-center justify-center shrink-0">
                <input type="checkbox" :checked="flatTask.task.completed" @change="(e) => updateTask(flatTask.task.id, { completed: (e.target as HTMLInputElement).checked })" 
                       class="peer appearance-none w-5 h-5 border-2 border-[#1e2126] bg-[#090a0c] checked:border-[#00f0ff] checked:bg-[#00f0ff]/20 cursor-pointer transition-all rounded-none outline-none" 
                       style="clip-path: polygon(3px 0, 100% 0, 100% calc(100% - 3px), calc(100% - 3px) 100%, 0 100%, 0 3px)" />
                <svg class="absolute w-3.5 h-3.5 text-[#00f0ff] pointer-events-none transition-opacity" :class="flatTask.task.completed ? 'opacity-100' : 'opacity-0'" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                  <path stroke-linecap="square" stroke-linejoin="miter" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div v-else-if="flatTask.task.type === 'bullet'" class="mt-3 flex items-center justify-center shrink-0 w-5">
                <div class="w-1.5 h-1.5 rounded-full bg-[#00f0ff]/80 shadow-[0_0_10px_rgba(0,240,255,0.4)]"></div>
              </div>
              <div v-if="flatTask.task.type === 'quote'" class="absolute left-9 top-2 bottom-2 w-0.5 bg-[#ffb000] rounded-full shadow-[0_0_8px_rgba(255,176,0,0.4)]"></div>
              <div v-if="!flatTask.task.type || ['text', 'h1', 'h2', 'h3'].includes(flatTask.task.type)" class="w-1 shrink-0"></div>

              <!-- ContentEditable 富文本核心 -->
              <div class="flex-1 relative" :class="{ 'pl-4': flatTask.task.type === 'quote' }">
                <div :ref="(el) => setInputRef(el, flatTask.task.id)" 
                     contenteditable="true" 
                     @input="(e) => handleInput(e, flatTask.task)"
                     @keydown="(e) => handleKeyDown(e, flatTask.task)"
                     @focus="setFocusConfig(flatTask.task.id, null)"
                     @blur="activeSlashTaskId = null"
                     :data-placeholder="getPlaceholder(flatTask.task.type)"
                     class="ce-block w-full bg-transparent border-none outline-none leading-relaxed py-0.5 font-sans min-h-[24px] cursor-text"
                     :class="getTextClass(flatTask.task)">
                </div>

                <!-- Slash 命令弹出菜单 -->
                <div v-if="activeSlashTaskId === flatTask.task.id" 
                     class="absolute left-0 w-64 bg-[#090a0c] border border-[#1e2126] shadow-2xl rounded-sm z-50 flex flex-col overflow-hidden"
                     :class="slashMenuPosition === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'">
                  <div class="px-3 py-2 text-xs text-[#6b7280] uppercase tracking-wider font-['Rajdhani',sans-serif] bg-[#090a0c] z-10 border-b border-[#1e2126]/50 shadow-sm shrink-0">基础区块</div>
                  <div class="overflow-y-auto max-h-[220px] py-1 custom-scrollbar">
                    <div v-for="(option, idx) in slashOptions" :key="option.id"
                         :ref="(el) => setSlashItemRef(el, idx)"
                         @mousedown.prevent="executeSlashCommand(flatTask.task.id, option.id)"
                         class="flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors"
                         :class="idx === slashIndex ? 'bg-[#1e2126]/80' : 'hover:bg-[#1e2126]/40'">
                      <div class="w-8 h-8 flex items-center justify-center shrink-0 rounded-sm font-['JetBrains_Mono',monospace] text-sm border"
                           :class="idx === slashIndex ? 'border-[#00f0ff] text-[#00f0ff] bg-[#00f0ff]/10 shadow-[0_0_8px_rgba(0,240,255,0.3)]' : 'border-[#1e2126] text-[#6b7280] bg-[#14161a]'">
                        {{ option.icon }}
                      </div>
                      <div class="flex flex-col min-w-0">
                        <span class="text-sm font-medium truncate" :class="idx === slashIndex ? 'text-[#00f0ff]' : 'text-[#e5e7eb]'">{{ option.label }}</span>
                        <span class="text-[11px] text-[#6b7280] truncate">{{ option.desc }}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 快速删除 -->
              <div class="mt-1.5 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity text-[#6b7280] hover:text-[#ff2a2a]" 
                   @click="deleteTask(flatTask.task.id)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter">
                  <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </div>
            </div>
          </template>
          
          <div v-if="getFlatTaskList().length === 0" class="text-[#6b7280]/50 font-['JetBrains_Mono',monospace] text-sm py-4 select-none pointer-events-none">
            [ 按 Enter 或点击此处开始编码你的矩阵... 按 Tab 键缩进，按 Shift+Tab 键提升层级 ]
          </div>
        </div>
      </div>
    </main>

    <!-- 全局防遮挡悬浮富文本菜单 (Format Menu) -->
    <div v-if="formatMenuConfig.isOpen" 
         class="fixed z-50 flex items-center bg-[#1e2126] border border-[#00f0ff]/30 shadow-[0_0_10px_rgba(0,240,255,0.4)] rounded-md px-1 py-1 transform -translate-x-1/2"
         :class="formatMenuConfig.position === 'top' ? '-translate-y-full' : ''"
         :style="{ top: `${formatMenuConfig.y}px`, left: `${formatMenuConfig.x}px` }">
      
      <div v-if="formatMenuConfig.position === 'top'" class="absolute bottom-[-6px] left-1/2 -translate-x-1/2 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[6px] border-t-[#00f0ff]/50"></div>
      <div v-else class="absolute top-[-6px] left-1/2 -translate-x-1/2 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-b-[6px] border-b-[#00f0ff]/50"></div>

      <select class="bg-transparent text-xs font-['Rajdhani',sans-serif] text-[#e5e7eb] outline-none mx-2 cursor-pointer appearance-none hover:text-[#00f0ff]"
              @change="(e) => changeActiveBlockType((e.target as HTMLSelectElement).value)"
              @mousedown.prevent
              value="text">
        <option value="text" disabled class="bg-[#090a0c]">转换</option>
        <option v-for="t in blockTypes" :key="t.id" :value="t.id" class="bg-[#090a0c]">{{ t.label }}</option>
      </select>
      <div class="w-px h-4 bg-[#6b7280]/30 mx-1"></div>
      
      <button @mousedown.prevent="executeFormat('bold')" class="w-7 h-7 flex items-center justify-center rounded hover:bg-[#090a0c] hover:text-[#00f0ff] transition-colors font-bold font-serif">B</button>
      <button @mousedown.prevent="executeFormat('italic')" class="w-7 h-7 flex items-center justify-center rounded hover:bg-[#090a0c] hover:text-[#00f0ff] transition-colors italic font-serif">i</button>
      <button @mousedown.prevent="executeFormat('underline')" class="w-7 h-7 flex items-center justify-center rounded hover:bg-[#090a0c] hover:text-[#00f0ff] transition-colors underline font-serif">U</button>
      <button @mousedown.prevent="executeFormat('strikeThrough')" class="w-7 h-7 flex items-center justify-center rounded hover:bg-[#090a0c] hover:text-[#ff2a2a] transition-colors line-through font-serif">S</button>
      <div class="w-px h-4 bg-[#6b7280]/30 mx-1"></div>
      <button @mousedown.prevent="executeFormat('createLink')" class="w-7 h-7 flex items-center justify-center rounded hover:bg-[#090a0c] hover:text-[#00f0ff] transition-colors">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
      </button>
      <button @mousedown.prevent="executeFormat('code')" class="w-7 h-7 flex items-center justify-center rounded hover:bg-[#090a0c] text-[#00f0ff] transition-colors font-['JetBrains_Mono',monospace] text-xs font-bold">{{'<>'}}</button>
    </div>

    <!-- 全局操作菜单 (Action Menu) -->
    <div v-if="actionMenuConfig.isOpen" 
         class="fixed z-50 w-48 bg-[#090a0c] border border-[#1e2126] shadow-2xl py-1 rounded-sm text-sm"
         :style="{ top: `${actionMenuConfig.y}px`, left: `${actionMenuConfig.x}px` }"
         @click.stop>
      <div class="px-3 py-1 text-xs text-[#6b7280] uppercase tracking-wider font-['Rajdhani',sans-serif] mb-1 border-b border-[#1e2126]/50">转换区块为</div>
      <button class="w-full text-left px-4 py-1.5 hover:bg-[#1e2126]/50 transition-colors flex items-center gap-2" @click="handleActionCommand('text')"><span class="font-['JetBrains_Mono',monospace] text-[#6b7280]">T</span> 文本</button>
      <button class="w-full text-left px-4 py-1.5 hover:bg-[#1e2126]/50 transition-colors flex items-center gap-2" @click="handleActionCommand('todo')"><span class="font-['JetBrains_Mono',monospace] text-[#6b7280]">[]</span> 待办事项</button>
      <button class="w-full text-left px-4 py-1.5 hover:bg-[#1e2126]/50 transition-colors text-[#00f0ff]/80 font-bold font-['Rajdhani',sans-serif] flex items-center gap-2" @click="handleActionCommand('h1')"><span class="font-['JetBrains_Mono',monospace] text-[#00f0ff]/40 font-normal">H1</span> 标题 1</button>
      <button class="w-full text-left px-4 py-1.5 hover:bg-[#1e2126]/50 transition-colors font-bold font-['Rajdhani',sans-serif] flex items-center gap-2" @click="handleActionCommand('h2')"><span class="font-['JetBrains_Mono',monospace] text-[#6b7280] font-normal">H2</span> 标题 2</button>
      <div class="border-t border-[#1e2126]/50 my-1"></div>
      <button class="w-full text-left px-4 py-1.5 hover:bg-[#1e2126]/50 transition-colors" @click="duplicateTask(actionMenuConfig.taskId)">复制</button>
      <button class="w-full text-left px-4 py-1.5 hover:bg-[#ff2a2a]/10 transition-colors text-[#ff2a2a]" @click="deleteTask(actionMenuConfig.taskId); actionMenuConfig.isOpen = false">删除</button>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, watch, computed } from 'vue';

// === 数据结构 ===
interface Task {
  id: string;
  type: string;
  content: string;
  completed: boolean;
  children?: Task[];  // 支持嵌套子任务
  parentId?: string;  // 父任务 ID
  level?: number;     // 层级深度
}

interface Page {
  id: string;
  title: string;
  tasks: Task[];  // 现在支持嵌套结构
}

// === API 客户端 ===
const API_BASE = 'http://localhost:8000';

const apiRequest = async (endpoint: string, options?: RequestInit): Promise<any> => {
  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      headers: {
        'Content-Type': 'application/json',
      },
      ...options,
    });
    return await response.json();
  } catch (error) {
    console.error('API 请求失败:', error);
    throw error;
  }
};

// === 全局状态 ===
const pages = ref<Page[]>([]);
const activePageId = ref<string>('');
const activePage = computed(() => pages.value.find(p => p.id === activePageId.value));

// === 编辑状态 ===
const editingPageId = ref<string | null>(null);
const editingTitle = ref('');
const editingPageOriginalTitle = ref('');
const savingPageId = ref<string | null>(null);
const editInputRef = ref<HTMLInputElement | null>(null);

// === 从后端加载数据 ===
const loadPagesFromBackend = async () => {
  try {
    const result = await apiRequest('/api/pages');
    if (result.success && result.data.length > 0) {
      pages.value = result.data;
      if (!activePageId.value || !pages.value.find(p => p.id === activePageId.value)) {
        activePageId.value = pages.value[0].id;
      }
    }
  } catch (error) {
    console.error('加载页面数据失败:', error);
    // 如果后端不可用，创建默认页面
    if (pages.value.length === 0) {
      const defaultPage: Page = {
        id: 'default-page',
        title: 'NEXUS 协议指南',
        tasks: [
          { id: '1', type: 'h1', content: '欢迎使用 NEXUS MATRIX', completed: false },
          { id: '2', type: 'quote', content: '这是一个支持 LocalFirst (本地优先) 的全平台工业风编辑器。', completed: false },
          { id: '3', type: 'todo', content: '在左侧边栏新建一个属于你自己的页面。', completed: true },
          { id: '4', type: 'text', content: '刷新浏览器，验证你的数据是否持久存活。', completed: false },
        ]
      };
      pages.value.push(defaultPage);
      activePageId.value = 'default-page';
    }
  }
};

// === 保存页面到后端 ===
const savePageToBackend = async (pageId: string) => {
  try {
    savingPageId.value = pageId;
    const page = pages.value.find(p => p.id === pageId);
    if (page) {
      await apiRequest(`/api/pages/${pageId}`, {
        method: 'PUT',
        body: JSON.stringify(page),
      });
    }
  } catch (error) {
    console.error('保存页面失败:', error);
  } finally {
    savingPageId.value = null;
  }
};

// === 页面标题编辑 ===
const startEditTitle = (pageId: string, title: string) => {
  editingPageId.value = pageId;
  editingTitle.value = title || '';
  editingPageOriginalTitle.value = title || '';
  nextTick(() => {
    if (editInputRef.value) {
      editInputRef.value.focus();
      editInputRef.value.select();
    }
  });
};

const savePageTitle = async (pageId: string) => {
  if (editingPageId.value !== pageId) return;
  
  const page = pages.value.find(p => p.id === pageId);
  if (page) {
    const newTitle = editingTitle.value.trim() || '未命名子程序';
    if (newTitle !== editingPageOriginalTitle.value) {
      page.title = newTitle;
      await savePageToBackend(pageId);
    }
  }
  editingPageId.value = null;
};

const cancelEditTitle = () => {
  editingPageId.value = null;
  editingTitle.value = '';
  editingPageOriginalTitle.value = '';
};

// === 页面层级操作 (Page CRUD) ===
const createPage = async () => {
  try {
    savingPageId.value = 'creating';
    const newPage: Page = {
      id: `page-${Date.now()}`,
      title: '',
      tasks: [{ id: Date.now().toString(), type: 'text', content: '', completed: false }]
    };
    
    const result = await apiRequest('/api/pages', {
      method: 'POST',
      body: JSON.stringify(newPage),
    });
    
    if (result.success) {
      pages.value.push(result.data);
      activePageId.value = result.data.id;
    }
  } catch (error) {
    console.error('创建页面失败:', error);
  } finally {
    savingPageId.value = null;
  }
};

const deletePage = async (id: string) => {
  if (pages.value.length <= 1) return; // 至少保留一页
  
  try {
    savingPageId.value = id;
    await apiRequest(`/api/pages/${id}`, {
      method: 'DELETE',
    });
    
    pages.value = pages.value.filter(p => p.id !== id);
    if (activePageId.value === id) {
      activePageId.value = pages.value[0].id;
    }
  } catch (error) {
    console.error('删除页面失败:', error);
  } finally {
    savingPageId.value = null;
  }
};

// === 拖拽排序状态 ===
const dragState = ref<{
  draggingId: string | null;
  dragOverId: string | null;
  dragOverPosition: 'before' | 'after' | 'child';
  dragOffset: number;
}>({
  draggingId: null,
  dragOverId: null,
  dragOverPosition: 'after',
  dragOffset: 0,
});

// === 拖拽事件处理 ===
const handleDragStart = (e: DragEvent, taskId: string) => {
  dragState.value.draggingId = taskId;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
  }
};

const handleDragEnd = (_e: DragEvent) => {
  dragState.value.draggingId = null;
  dragState.value.dragOverId = null;
  dragState.value.dragOverPosition = 'after';
};

const handleDragOver = (e: DragEvent, taskId: string, rect: DOMRect) => {
  if (!dragState.value.draggingId || dragState.value.draggingId === taskId) return;
  
  e.preventDefault();
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'move';
  }
  
  const mouseY = e.clientY;
  const blockHeight = rect.height;
  const topThird = rect.top + blockHeight / 3;
  const bottomThird = rect.top + (blockHeight * 2) / 3;
  
  // 计算拖放位置
  if (mouseY < topThird) {
    dragState.value.dragOverPosition = 'before';
  } else if (mouseY > bottomThird) {
    dragState.value.dragOverPosition = 'after';
  } else {
    dragState.value.dragOverPosition = 'child';
  }
  
  dragState.value.dragOverId = taskId;
};

const handleDrop = (_e: DragEvent, targetId: string) => {
  if (!dragState.value.draggingId || dragState.value.draggingId === targetId) {
    dragState.value.draggingId = null;
    return;
  }
  
  const sourceId = dragState.value.draggingId;
  const position = dragState.value.dragOverPosition;
  
  // 执行重排序
  if (activePage.value) {
    reorderTask(sourceId, targetId, position);
  }
  
  dragState.value.draggingId = null;
  dragState.value.dragOverId = null;
};

// === 重排序逻辑 ===
const reorderTask = (sourceId: string, targetId: string, position: 'before' | 'after' | 'child') => {
  if (!activePage.value) return;
  
  const sourceTask = findTaskById(activePage.value.tasks, sourceId);
  const targetTask = findTaskById(activePage.value.tasks, targetId);
  
  if (!sourceTask || !targetTask || sourceId === targetId) return;
  
  // 从原位置移除
  removeTaskFromTree(activePage.value.tasks, sourceId);
  
  // 确定目标位置
  let targetParent = activePage.value.tasks;
  let insertIndex = targetParent.findIndex(t => t.id === targetId);
  
  if (position === 'child') {
    // 成为子任务
    if (!targetTask.children) {
      targetTask.children = [];
    }
    targetParent = targetTask.children;
    insertIndex = targetTask.children.length;
    sourceTask.level = (targetTask.level || 0) + 1;
    sourceTask.parentId = targetId;
  } else {
    // 同级排序
    sourceTask.level = targetTask.level;
    sourceTask.parentId = targetTask.parentId;
    
    if (position === 'before') {
      insertIndex = Math.max(0, insertIndex);
    } else {
      insertIndex = Math.min(insertIndex + 1, targetParent.length);
    }
  }
  
  // 插入到新位置
  targetParent.splice(insertIndex, 0, sourceTask);
};

// === 辅助函数：查找任务 ===
const findTaskById = (tasks: Task[], id: string): Task | null => {
  for (const task of tasks) {
    if (task.id === id) return task;
    if (task.children) {
      const found = findTaskById(task.children, id);
      if (found) return found;
    }
  }
  return null;
};

// === 辅助函数：从树中移除任务 ===
const removeTaskFromTree = (tasks: Task[], id: string): boolean => {
  const index = tasks.findIndex(t => t.id === id);
  if (index !== -1) {
    tasks.splice(index, 1);
    return true;
  }
  
  for (const task of tasks) {
    if (task.children && removeTaskFromTree(task.children, id)) {
      return true;
    }
  }
  return false;
};

// === 层级缩进处理 ===
const handleIndentation = (taskId: string, direction: 'indent' | 'outdent') => {
  if (!activePage.value) return;
  
  const task = findTaskById(activePage.value.tasks, taskId);
  if (!task) return;
  
  if (direction === 'indent') {
    // Tab: 变成上一个兄弟节点的子节点
    const parent = getParentTask(activePage.value.tasks, taskId);
    const siblings = parent && parent.children ? parent.children : activePage.value.tasks;
    const currentIndex = siblings.findIndex(t => t.id === taskId);
    
    if (currentIndex > 0) {
      const prevSibling = siblings[currentIndex - 1];
      
      // 从原位置移除
      siblings.splice(currentIndex, 1);
      
      // 添加到前一个节点的子节点
      if (!prevSibling.children) {
        prevSibling.children = [];
      }
      prevSibling.children.push(task);
      
      // 更新层级
      task.level = (prevSibling.level || 0) + 1;
      task.parentId = prevSibling.id;
    }
  } else {
    // Shift+Tab: 提升层级
    if (task.parentId) {
      const parent = findTaskById(activePage.value.tasks, task.parentId);
      if (parent && parent.children) {
        const childIndex = parent.children.findIndex(t => t.id === taskId);
        if (childIndex !== -1) {
          const taskToMove = parent.children.splice(childIndex, 1)[0];
          
          // 添加到父节点的同级
          const grandParent = getParentTask(activePage.value.tasks, task.parentId);
          const targetList = grandParent && grandParent.children ? grandParent.children : activePage.value.tasks;
          
          // 找到父节点在目标列表中的位置
          const parentIndex = targetList.findIndex(t => t.id === task.parentId);
          targetList.splice(parentIndex + 1, 0, taskToMove);
          
          // 更新层级
          taskToMove.level = parent.level || 0;
          taskToMove.parentId = parent.parentId;
        }
      }
    }
  }
};

// === 辅助函数：获取父任务 ===
const getParentTask = (tasks: Task[], taskId: string): Task | null => {
  for (const task of tasks) {
    if (task.children && task.children.some(c => c.id === taskId)) {
      return task;
    }
    if (task.children) {
      const found = getParentTask(task.children, taskId);
      if (found) return found;
    }
  }
  return null;
};

// === 计算任务的缩进样式 ===
const getIndentStyle = (level: number): string => {
  const indentPx = level * 20;
  return `padding-left: ${indentPx + 32}px;`;  // 32px 是基础缩进
};

// === 获取任务容器的样式类 ===
const getTaskContainerClass = (task: Task) => {
  const baseClass = 'task-item-container group relative flex items-start gap-3 p-2 my-1 rounded-sm transition-colors duration-150 hover:bg-[#1e2126]/40';
  const completedClass = task.completed && task.type === 'todo' ? 'opacity-50' : '';
  return `${baseClass} ${completedClass}`;
};

// === 获取扁平化的任务列表（包含所有层级） ===
interface FlatTask {
  task: Task;
  level: number;
}

const getFlatTaskList = (): FlatTask[] => {
  if (!activePage.value) return [];
  
  const result: FlatTask[] = [];
  
  const flattenTasks = (tasks: Task[], currentLevel: number = 0) => {
    tasks.forEach(task => {
      result.push({ task, level: currentLevel });
      if (task.children && task.children.length > 0) {
        flattenTasks(task.children, currentLevel + 1);
      }
    });
  };
  
  flattenTasks(activePage.value.tasks);
  return result;
};

// === 组件生命周期 ===
onMounted(async () => {
  await loadPagesFromBackend();
});

// 监听页面数据变更，自动保存到后端
watch(pages, async (newVal) => {
  // 排除初始加载和创建/删除操作
  if (savingPageId.value) return;
  if (editingPageId.value) return;
  
  for (const page of newVal) {
    // 只保存当前活跃页面或有变更的页面
    if (page.id === activePageId.value) {
      await savePageToBackend(page.id);
    }
  }
}, { deep: true });


// === DOM Refs 管理 ===
const inputRefs = ref<Record<string, HTMLElement>>({});
const setInputRef = (el: any, id: string) => {
  if (el) {
    inputRefs.value[id] = el;
  } else {
    delete inputRefs.value[id]; // 切换页面时清理废弃的 refs
  }
};

// === 焦点与菜单状态 ===
const focusConfig = ref<{ id: string | null, pos: any }>({ id: null, pos: null });
const actionMenuConfig = ref({ isOpen: false, x: 0, y: 0, taskId: '' });
const formatMenuConfig = ref({ isOpen: false, x: 0, y: 0, position: 'top', activeTaskId: '' });

// === Slash 命令状态 ===
const activeSlashTaskId = ref<string | null>(null);
const slashIndex = ref(0);
const slashMenuPosition = ref('bottom');
const slashItemRefs = ref<HTMLElement[]>([]);
const setSlashItemRef = (el: any, index: number) => {
  if (el) slashItemRefs.value[index] = el;
};

const slashOptions = [
  { id: 'text', label: '普通文本', icon: 'T', desc: '基础的文字段落' },
  { id: 'todo', label: '待办事项', icon: '[]', desc: '带有复选框的任务' },
  { id: 'h1', label: '一级标题', icon: 'H1', desc: '大尺寸科幻标题' },
  { id: 'h2', label: '二级标题', icon: 'H2', desc: '中等尺寸副标题' },
  { id: 'h3', label: '三级标题', icon: 'H3', desc: '小尺寸副标题' },
  { id: 'bullet', label: '无序列表', icon: '•', desc: '基础的点状列表' },
  { id: 'quote', label: '引用块', icon: '"', desc: '高亮引用的重要文字' },
];

const blockTypes = [
  { id: 'text', label: '文本' },
  { id: 'h1', label: 'H1' },
  { id: 'h2', label: 'H2' },
  { id: 'quote', label: '引用' }
];

// === 辅助工具函数：光标管理 ===
const setCaretPosition = (el: HTMLElement, pos: any) => {
  if (!el) return;
  const range = document.createRange();
  const sel = window.getSelection();
  let charIndex = 0;
  let rangeFound = false;

  const traverseNodes = (node: Node) => {
    if (rangeFound) return;
    if (node.nodeType === 3) {
      const nextCharIndex = charIndex + (node.textContent?.length || 0);
      if (pos <= nextCharIndex) {
        range.setStart(node, pos - charIndex);
        range.collapse(true);
        rangeFound = true;
      }
      charIndex = nextCharIndex;
    } else {
      for (let i = 0; i < node.childNodes.length; i++) {
        traverseNodes(node.childNodes[i]);
      }
    }
  };

  if (pos === 'end') {
    range.selectNodeContents(el);
    range.collapse(false);
  } else if (pos === 'start') {
    range.selectNodeContents(el);
    range.collapse(true);
  } else {
    traverseNodes(el);
    if (!rangeFound) {
      range.selectNodeContents(el);
      range.collapse(false);
    }
  }
  sel?.removeAllRanges();
  sel?.addRange(range);
};

const getCaretPosition = (el: HTMLElement) => {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  const range = sel.getRangeAt(0);
  const preCaretRange = range.cloneRange();
  preCaretRange.selectNodeContents(el);
  preCaretRange.setEnd(range.endContainer, range.endOffset);
  return preCaretRange.toString().length;
};

// === 核心渲染与状态同步逻辑 ===
// 监听当前活跃页面的任务列表，同步到 ContentEditable
watch(() => activePage.value?.tasks, () => {
  nextTick(() => {
    if (!activePage.value) return;
    activePage.value.tasks.forEach(task => {
      const el = inputRefs.value[task.id];
      if (el && el.innerHTML !== task.content) {
        el.innerHTML = task.content; 
      }
    });
  });
}, { deep: true, immediate: true });

watch(focusConfig, (newVal) => {
  if (newVal.id) {
    nextTick(() => {
      const el = inputRefs.value[newVal.id as string];
      if (el && newVal.pos !== null) {
        el.focus();
        setCaretPosition(el, newVal.pos);
      }
    });
  }
}, { deep: true });

// === 基础增删改操作 (针对 activePage) ===
const updateTask = (id: string, updates: Partial<Task>) => {
  if (!activePage.value) return;
  const task = activePage.value.tasks.find((t: Task) => t.id === id);
  if (task) Object.assign(task, updates);
};

const deleteTask = (id: string) => {
  if (!activePage.value) return;
  activePage.value.tasks = activePage.value.tasks.filter((t: Task) => t.id !== id);
};

const duplicateTask = (id: string) => {
  if (!activePage.value) return;
  const idx = activePage.value.tasks.findIndex((t: Task) => t.id === id);
  if (idx !== -1) {
    const newId = Date.now().toString();
    const newTask = { ...activePage.value.tasks[idx], id: newId };
    activePage.value.tasks.splice(idx + 1, 0, newTask);
  }
  actionMenuConfig.value.isOpen = false;
};

// === 富文本与输入拦截引擎 ===
const handleInput = (e: Event, task: Task) => {
  const target = e.currentTarget as HTMLElement;
  let htmlVal = target.innerHTML;
  let textVal = target.textContent || '';

  if (htmlVal === '<br>' || htmlVal === '<div><br></div>') {
    target.innerHTML = '';
    htmlVal = '';
    textVal = '';
  }

  const normalizedText = textVal.replace(/\u00A0/g, ' '); 
  const triggerShortcut = (type: string) => {
    updateTask(task.id, { type, content: '' });
    setFocusConfig(task.id, 'start');
    activeSlashTaskId.value = null;
  };

  if (normalizedText === '/') {
    activeSlashTaskId.value = task.id;
    slashIndex.value = 0;
    updateTask(task.id, { content: htmlVal });
    nextTick(() => {
      const rect = target.getBoundingClientRect();
      slashMenuPosition.value = (window.innerHeight - rect.bottom < 300) ? 'top' : 'bottom';
    });
  } else if (activeSlashTaskId.value === task.id && !normalizedText.includes('/')) {
    activeSlashTaskId.value = null;
    updateTask(task.id, { content: htmlVal });
  } 
  else if (normalizedText === '[] ') triggerShortcut('todo');
  else if (normalizedText === '# ') triggerShortcut('h1');
  else if (normalizedText === '## ') triggerShortcut('h2');
  else if (normalizedText === '### ') triggerShortcut('h3');
  else if (normalizedText === '- ') triggerShortcut('bullet');
  else if (normalizedText === '" ') triggerShortcut('quote');
  else {
    updateTask(task.id, { content: htmlVal });
  }
};

// === 键盘接管引擎 ===
const handleKeyDown = (e: KeyboardEvent, task: Task) => {
  if (!activePage.value) return;
  const tasksList = activePage.value.tasks;

  if (activeSlashTaskId.value === task.id) {
    if (e.key === 'ArrowDown') { e.preventDefault(); slashIndex.value = (slashIndex.value + 1) % slashOptions.length; scrollSlashIntoView(); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); slashIndex.value = (slashIndex.value - 1 + slashOptions.length) % slashOptions.length; scrollSlashIntoView(); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      executeSlashCommand(task.id, slashOptions[slashIndex.value].id);
      return;
    }
    if (e.key === 'Escape') { activeSlashTaskId.value = null; return; }
  }

  const target = e.currentTarget as HTMLElement;
  const textContent = target.textContent || '';
  const currentPos = getCaretPosition(target);
  const idx = tasksList.findIndex((t: Task) => t.id === task.id);

  // Tab 键：层级缩进
  if (e.key === 'Tab') {
    e.preventDefault();
    if (e.shiftKey) {
      // Shift+Tab: 减少缩进
      handleIndentation(task.id, 'outdent');
    } else {
      // Tab: 增加缩进
      handleIndentation(task.id, 'indent');
    }
    return;
  }

  if (e.key === 'Enter') {
    e.preventDefault();
    const newType = ['bullet', 'todo'].includes(task.type) ? task.type : 'text';
    const newId = Date.now().toString();
    
    // 在当前任务后插入新任务
    tasksList.splice(idx + 1, 0, { id: newId, type: newType, content: '', completed: false, level: task.level || 0 });
    setFocusConfig(newId, 'start');
  } 
  else if (e.key === 'Backspace' && textContent === '') {
    e.preventDefault();
    if (idx > 0) {
      setFocusConfig(tasksList[idx - 1].id, 'end');
    }
    deleteTask(task.id);
  }
  else if (e.key === 'ArrowUp') {
    if (idx > 0) { e.preventDefault(); setFocusConfig(tasksList[idx - 1].id, currentPos); }
  } 
  else if (e.key === 'ArrowDown') {
    if (idx < tasksList.length - 1) { e.preventDefault(); setFocusConfig(tasksList[idx + 1].id, currentPos); }
  } 
  else if (e.key === 'ArrowLeft') {
    if (currentPos === 0 && idx > 0) { e.preventDefault(); setFocusConfig(tasksList[idx - 1].id, 'end'); }
  } 
  else if (e.key === 'ArrowRight') {
    if (currentPos === textContent.length && idx < tasksList.length - 1) { e.preventDefault(); setFocusConfig(tasksList[idx + 1].id, 'start'); }
  }
};

const executeSlashCommand = (taskId: string, newType: string) => {
  updateTask(taskId, { type: newType, content: '' });
  activeSlashTaskId.value = null;
  setFocusConfig(taskId, 'start');
};

const scrollSlashIntoView = () => {
  nextTick(() => {
    const el = slashItemRefs.value[slashIndex.value];
    if (el) el.scrollIntoView({ block: 'nearest' });
  });
};

const setFocusConfig = (id: string | null, pos: any) => {
  focusConfig.value = { id, pos };
};

// === 全局点击交互 ===
const handleEmptyClick = (e: MouseEvent) => {
  if (!activePage.value) return;
  if ((e.target as HTMLElement).closest('.task-item-container') || (e.target as HTMLElement).closest('.fixed')) return;
  const tasksList = activePage.value.tasks;
  const lastTask = tasksList[tasksList.length - 1];
  
  if (lastTask && lastTask.content === '' && ['text', 'todo'].includes(lastTask.type)) {
    setFocusConfig(lastTask.id, 'end');
  } else {
    const newId = Date.now().toString();
    tasksList.push({ id: newId, type: 'text', content: '', completed: false });
    setFocusConfig(newId, 'start');
  }
};

// === 多功能按钮点击处理 ===
const handleMultiFunctionClick = (e: MouseEvent, taskId: string) => {
  // 如果是右键，由 contextmenu 事件处理
  if (e.button === 2) return;
  
  // 左键点击：打开类型切换菜单
  if (e.button === 0) {
    e.preventDefault();
    e.stopPropagation();
    
    // 打开类型切换下拉菜单
    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    
    // 更新 slash 菜单状态（复用现有的菜单组件）
    activeSlashTaskId.value = taskId;
    slashIndex.value = 0;
    slashMenuPosition.value = (window.innerHeight - rect.bottom < 300) ? 'top' : 'bottom';
    
    // 更新任务内容为空（显示菜单时的占位）
    if (activePage.value) {
      const task = activePage.value.tasks.find((t: Task) => t.id === taskId);
      if (task) {
        updateTask(taskId, { content: '' });
      }
    }
  }
};

const openActionMenu = (e: MouseEvent, taskId: string) => {
  e.stopPropagation();
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  actionMenuConfig.value = { isOpen: true, x: rect.left, y: rect.bottom + 4, taskId };
};

const handleActionCommand = (type: string) => {
  updateTask(actionMenuConfig.value.taskId, { type });
  actionMenuConfig.value.isOpen = false;
};

const changeActiveBlockType = (type: string) => {
  if (formatMenuConfig.value.activeTaskId) {
    updateTask(formatMenuConfig.value.activeTaskId, { type });
    formatMenuConfig.value.isOpen = false;
  }
};

// === 富文本指令与悬浮窗定位 ===
const executeFormat = (command: string) => {
  if (command === 'code') {
    const selection = window.getSelection();
    document.execCommand('insertHTML', false, `<code>${selection?.toString()}</code>`);
  } else if (command === 'createLink') {
    const url = prompt('请输入链接地址 (URL):', 'https://');
    if (url) document.execCommand('createLink', false, url);
  } else {
    document.execCommand(command, false, undefined);
  }
};

onMounted(() => {
  const handleMouseUp = () => {
    setTimeout(() => {
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
        const text = selection.toString().trim();
        let node = selection.anchorNode;
        let isInsideEditor = false;
        while(node) {
           if((node as HTMLElement).classList?.contains('ce-block')) { isInsideEditor = true; break; }
           node = node.parentNode;
        }

        if (text && isInsideEditor) {
          const range = selection.getRangeAt(0);
          const rects = range.getClientRects();
          if (rects.length > 0) {
            const firstRect = rects[0];
            const lastRect = rects[rects.length - 1];
            const boundingRect = range.getBoundingClientRect();
            
            const x = boundingRect.left + boundingRect.width / 2;
            let y, position;

            if (firstRect.top > 80) {
              y = firstRect.top - 40; 
              position = 'top';
            } else {
              y = lastRect.bottom + 12;
              position = 'bottom';
            }

            formatMenuConfig.value = { isOpen: true, x, y, position, activeTaskId: focusConfig.value.id as string };
            return;
          }
        }
      }
    }, 10);
  };

  const handleGlobalClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (actionMenuConfig.value.isOpen) actionMenuConfig.value.isOpen = false;
    if (!target.closest('.fixed')) {
      formatMenuConfig.value.isOpen = false;
    }
  };

  const handleKeyUp = (e: KeyboardEvent) => {
    if (e.shiftKey && e.key.includes('Arrow')) handleMouseUp();
    else if (e.key === 'Escape') formatMenuConfig.value.isOpen = false;
  };

  document.addEventListener('mouseup', handleMouseUp);
  document.addEventListener('mousedown', handleGlobalClick);
  document.addEventListener('keyup', handleKeyUp);

  onUnmounted(() => {
    document.removeEventListener('mouseup', handleMouseUp);
    document.removeEventListener('mousedown', handleGlobalClick);
    document.removeEventListener('keyup', handleKeyUp);
  });
});

// === 样式计算 ===
const getTextClass = (task: Task) => {
  if (task.type === 'h1') return 'text-2xl font-bold font-["Rajdhani",sans-serif] text-[#00f0ff]/90';
  if (task.type === 'h2') return 'text-xl font-bold font-["Rajdhani",sans-serif] text-[#e5e7eb]';
  if (task.type === 'h3') return 'text-lg font-bold font-["Rajdhani",sans-serif] text-[#6b7280]';
  if (task.type === 'quote') return 'italic text-[#ffb000]/90';
  if (task.completed && task.type === 'todo') return 'text-[15px] line-through text-[#6b7280]';
  return 'text-[15px] text-[#e5e7eb]';
};

const getPlaceholder = (type: string) => {
  if (type === 'h1') return '标题 1';
  if (type === 'h2') return '标题 2';
  if (type === 'text') return "输入 '/' 唤出命令菜单...";
  return '...';
};
</script>

<style scoped>
/* 富文本渲染与滚动条美化 */
.ce-block b, .ce-block strong { color: #00f0ff; font-weight: 700; text-shadow: 0 0 4px rgba(0, 240, 255, 0.3); }
.ce-block i, .ce-block em { font-style: italic; color: #ffb000; }
.ce-block u { text-decoration: underline; text-underline-offset: 3px; text-decoration-color: rgba(0, 240, 255, 0.6); }
.ce-block strike, .ce-block del { text-decoration: line-through; color: #6b7280; opacity: 0.8; }
.ce-block a { color: #00f0ff; text-decoration: underline; text-underline-offset: 4px; cursor: pointer; transition: all 0.2s; }
.ce-block a:hover { text-shadow: 0 0 8px rgba(0, 240, 255, 0.6); }
.ce-block code { background: rgba(0, 240, 255, 0.08); color: #00f0ff; padding: 2px 6px; border-radius: 4px; font-family: 'JetBrains Mono', monospace; font-size: 0.9em; border: 1px solid rgba(0, 240, 255, 0.15); }
.ce-block kbd { background: #1e2126; border: 1px solid #374151; border-bottom: 2px solid #111827; padding: 2px 6px; border-radius: 3px; font-size: 0.85em; color: #e5e7eb; font-family: 'JetBrains Mono', monospace; }
[contenteditable]:empty::before { content: attr(data-placeholder); color: rgba(107, 114, 128, 0.45); pointer-events: none; display: block; }
.custom-scrollbar::-webkit-scrollbar { width: 4px; height: 4px; }
.custom-scrollbar::-webkit-scrollbar-track { background: rgba(30, 33, 38, 0.3); }
.custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(0, 240, 255, 0.3); border-radius: 2px; }
.custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(0, 240, 255, 0.6); }
</style>