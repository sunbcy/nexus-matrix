<template>
  <div class="w-full max-w-4xl space-y-8 mx-auto">
    <!-- 头部区域 -->
    <header class="mb-12">
      <h1 class="font-display text-4xl font-bold tracking-tight text-text-display mb-2 flex items-center gap-3">
        <span class="w-3 h-8 bg-cyan-glow inline-block" style="clip-path: polygon(0 0, 100% 4px, 100% 100%, 0 calc(100% - 4px))"></span>
        NEXUS 协议
      </h1>
      <p class="text-text-dim font-mono text-sm uppercase tracking-widest">本地优先同步矩阵 (Local-first Matrix)</p>
    </header>

    <!-- Bento 面板容器 -->
    <div class="relative bg-nexus-surface text-text-display flex flex-col w-full shadow-2xl transition-all"
         style="clip-path: polygon(0 0, calc(100% - 16px) 0, 100% 16px, 100% 100%, 16px 100%, 0 calc(100% - 16px))">
      
      <!-- 顶部状态指示条 -->
      <div class="absolute top-0 left-0 w-full h-1 bg-cyan-glow shadow-cyan-neon transition-all duration-300"></div>

      <!-- 面板标题栏 -->
      <div class="flex items-center justify-between px-5 py-3 border-b border-nexus-panel bg-nexus-void/50">
        <span class="font-display font-bold uppercase tracking-widest text-sm text-text-dim hover:text-cyan-glow transition-colors">
          激活中的子程序
        </span>
        <div class="flex gap-1.5 opacity-50">
          <div class="w-1.5 h-1.5 bg-cyan-glow rounded-sm animate-pulse"></div>
          <div class="w-1.5 h-1.5 bg-nexus-panel rounded-sm"></div>
          <div class="w-1.5 h-1.5 bg-nexus-panel rounded-sm"></div>
        </div>
      </div>

      <!-- 核心编辑区 -->
      <div class="flex-1 p-2 bg-[linear-gradient(to_right,#1e2126_1px,transparent_1px),linear-gradient(to_bottom,#1e2126_1px,transparent_1px)] bg-[size:24px_24px]">
        <div class="min-h-[350px] h-full pb-20 cursor-text relative" @click="handleEmptyClick">
          
          <!-- 任务行循环渲染 -->
          <div v-for="task in tasks" :key="task.id" 
               class="task-item-container group relative flex items-start gap-3 p-2 my-1 rounded-sm transition-colors duration-150 hover:bg-nexus-panel/40"
               :class="{ 'opacity-50': task.completed && task.type === 'todo' }">
            
            <!-- 拖拽与菜单手柄 -->
            <div class="mt-1.5 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity text-text-dim hover:text-text-display" 
                 @click="(e) => openActionMenu(e, task.id)" title="点击打开操作菜单">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="9" cy="12" r="1"></circle><circle cx="9" cy="5" r="1"></circle><circle cx="9" cy="19" r="1"></circle>
                <circle cx="15" cy="12" r="1"></circle><circle cx="15" cy="5" r="1"></circle><circle cx="15" cy="19" r="1"></circle>
              </svg>
            </div>

            <!-- 区块类型前缀装饰 -->
            <div v-if="task.type === 'todo'" class="mt-1.5 relative flex items-center justify-center shrink-0">
              <input type="checkbox" :checked="task.completed" @change="(e) => updateTask(task.id, { completed: (e.target as HTMLInputElement).checked })" 
                     class="peer appearance-none w-5 h-5 border-2 border-nexus-panel bg-nexus-void checked:border-cyan-glow checked:bg-cyan-glow/20 cursor-pointer transition-all rounded-none outline-none" 
                     style="clip-path: polygon(3px 0, 100% 0, 100% calc(100% - 3px), calc(100% - 3px) 100%, 0 100%, 0 3px)" />
              <svg class="absolute w-3.5 h-3.5 text-cyan-glow pointer-events-none transition-opacity" :class="task.completed ? 'opacity-100' : 'opacity-0'" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                <path stroke-linecap="square" stroke-linejoin="miter" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div v-else-if="task.type === 'bullet'" class="mt-3 flex items-center justify-center shrink-0 w-5">
              <div class="w-1.5 h-1.5 rounded-full bg-cyan-glow/80 shadow-cyan-neon"></div>
            </div>
            <div v-if="task.type === 'quote'" class="absolute left-9 top-2 bottom-2 w-0.5 bg-amber-warn rounded-full shadow-amber-neon"></div>
            <div v-if="!task.type || ['text', 'h1', 'h2', 'h3'].includes(task.type)" class="w-1 shrink-0"></div>

            <!-- 富文本输入区 (ContentEditable) -->
            <div class="flex-1 relative" :class="{ 'pl-4': task.type === 'quote' }">
              <div :ref="(el) => setInputRef(el, task.id)" 
                   contenteditable="true" 
                   @input="(e) => handleInput(e, task)"
                   @keydown="(e) => handleKeyDown(e, task)"
                   @focus="setFocusConfig(task.id, null)"
                   @blur="activeSlashTaskId = null"
                   :data-placeholder="getPlaceholder(task.type)"
                   class="ce-block w-full bg-transparent border-none outline-none leading-relaxed py-0.5 font-sans min-h-[24px] cursor-text"
                   :class="getTextClass(task)">
              </div>

              <!-- Slash 命令菜单 (针对当前激活的任务行) -->
              <div v-if="activeSlashTaskId === task.id" 
                   class="absolute left-0 w-64 bg-nexus-void border border-nexus-panel shadow-2xl rounded-sm z-50 flex flex-col overflow-hidden"
                   :class="slashMenuPosition === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'">
                <div class="px-3 py-2 text-xs text-text-dim uppercase tracking-wider font-display bg-nexus-void z-10 border-b border-nexus-panel/50 shadow-sm shrink-0">基础区块</div>
                <div class="overflow-y-auto max-h-[220px] py-1 custom-scrollbar">
                  <div v-for="(option, idx) in slashOptions" :key="option.id"
                       :ref="(el) => setSlashItemRef(el, idx)"
                       @mousedown.prevent="executeSlashCommand(task.id, option.id)"
                       class="flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors"
                       :class="idx === slashIndex ? 'bg-nexus-panel/80' : 'hover:bg-nexus-panel/40'">
                    <div class="w-8 h-8 flex items-center justify-center shrink-0 rounded-sm font-mono text-sm border"
                         :class="idx === slashIndex ? 'border-cyan-glow text-cyan-glow bg-cyan-glow/10 shadow-[0_0_8px_rgba(0,240,255,0.3)]' : 'border-nexus-panel text-text-dim bg-nexus-surface'">
                      {{ option.icon }}
                    </div>
                    <div class="flex flex-col min-w-0">
                      <span class="text-sm font-medium truncate" :class="idx === slashIndex ? 'text-cyan-glow' : 'text-text-display'">{{ option.label }}</span>
                      <span class="text-[11px] text-text-dim truncate">{{ option.desc }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- 快速删除按钮 -->
            <div class="mt-1.5 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity text-text-dim hover:text-danger-red" 
                 @click="deleteTask(task.id)">
               <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter">
                 <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
               </svg>
            </div>
          </div>

          <!-- 矩阵为空的提示 -->
          <div v-if="tasks.length === 0" class="text-text-dim/50 font-mono text-sm py-4 text-center select-none pointer-events-none">
            [ 矩阵为空。点击此处初始化新任务。 ]
          </div>
        </div>
      </div>
    </div>

    <!-- 悬浮富文本格式化菜单 (Format Menu) -->
    <div v-if="formatMenuConfig.isOpen" 
         class="fixed z-50 flex items-center bg-nexus-panel border border-cyan-glow/30 shadow-cyan-neon rounded-md px-1 py-1 transform -translate-x-1/2"
         :class="formatMenuConfig.position === 'top' ? '-translate-y-full' : ''"
         :style="{ top: `${formatMenuConfig.y}px`, left: `${formatMenuConfig.x}px` }">
      
      <!-- 智能指示小箭头 (Pointer Arrow) -->
      <div v-if="formatMenuConfig.position === 'top'" class="absolute bottom-[-6px] left-1/2 -translate-x-1/2 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[6px] border-t-cyan-glow/50"></div>
      <div v-else class="absolute top-[-6px] left-1/2 -translate-x-1/2 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-b-[6px] border-b-cyan-glow/50"></div>

      <!-- 类型切换 -->
      <select class="bg-transparent text-xs font-display text-text-display outline-none mx-2 cursor-pointer appearance-none hover:text-cyan-glow"
              @change="(e) => changeActiveBlockType((e.target as HTMLSelectElement).value)"
              @mousedown.prevent
              value="text">
        <option value="text" disabled class="bg-nexus-void">转换</option>
        <option v-for="t in blockTypes" :key="t.id" :value="t.id" class="bg-nexus-void">{{ t.label }}</option>
      </select>
      <div class="w-px h-4 bg-text-dim/30 mx-1"></div>
      
      <!-- 富文本操作 -->
      <button @mousedown.prevent="executeFormat('bold')" class="w-7 h-7 flex items-center justify-center rounded hover:bg-nexus-void hover:text-cyan-glow transition-colors font-bold font-serif">B</button>
      <button @mousedown.prevent="executeFormat('italic')" class="w-7 h-7 flex items-center justify-center rounded hover:bg-nexus-void hover:text-cyan-glow transition-colors italic font-serif">i</button>
      <button @mousedown.prevent="executeFormat('underline')" class="w-7 h-7 flex items-center justify-center rounded hover:bg-nexus-void hover:text-cyan-glow transition-colors underline font-serif">U</button>
      <button @mousedown.prevent="executeFormat('strikeThrough')" class="w-7 h-7 flex items-center justify-center rounded hover:bg-nexus-void hover:text-danger-red transition-colors line-through font-serif">S</button>
      <div class="w-px h-4 bg-text-dim/30 mx-1"></div>
      
      <!-- 链接与代码 -->
      <button @mousedown.prevent="executeFormat('createLink')" class="w-7 h-7 flex items-center justify-center rounded hover:bg-nexus-void hover:text-cyan-glow transition-colors">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
      </button>
      <button @mousedown.prevent="executeFormat('code')" class="w-7 h-7 flex items-center justify-center rounded hover:bg-nexus-void text-cyan-glow transition-colors font-mono text-xs font-bold">{{'<>'}}</button>
    </div>

    <!-- 全局操作菜单 (Action Menu) -->
    <div v-if="actionMenuConfig.isOpen" 
         class="fixed z-50 w-48 bg-nexus-void border border-nexus-panel shadow-2xl py-1 rounded-sm text-sm"
         :style="{ top: `${actionMenuConfig.y}px`, left: `${actionMenuConfig.x}px` }"
         @click.stop>
      <div class="px-3 py-1 text-xs text-text-dim uppercase tracking-wider font-display mb-1 border-b border-nexus-panel/50">转换区块为</div>
      <button class="w-full text-left px-4 py-1.5 hover:bg-nexus-panel/50 transition-colors flex items-center gap-2" @click="handleActionCommand('text')"><span class="font-mono text-text-dim">T</span> 文本</button>
      <button class="w-full text-left px-4 py-1.5 hover:bg-nexus-panel/50 transition-colors flex items-center gap-2" @click="handleActionCommand('todo')"><span class="font-mono text-text-dim">[]</span> 待办事项</button>
      <button class="w-full text-left px-4 py-1.5 hover:bg-nexus-panel/50 transition-colors text-cyan-glow/80 font-bold font-display flex items-center gap-2" @click="handleActionCommand('h1')"><span class="font-mono text-cyan-glow/40 font-normal">H1</span> 标题 1</button>
      <button class="w-full text-left px-4 py-1.5 hover:bg-nexus-panel/50 transition-colors font-bold font-display flex items-center gap-2" @click="handleActionCommand('h2')"><span class="font-mono text-text-dim font-normal">H2</span> 标题 2</button>
      <div class="border-t border-nexus-panel/50 my-1"></div>
      <button class="w-full text-left px-4 py-1.5 hover:bg-nexus-panel/50 transition-colors" @click="duplicateTask(actionMenuConfig.taskId)">复制</button>
      <button class="w-full text-left px-4 py-1.5 hover:bg-danger-red/10 transition-colors text-danger-red" @click="deleteTask(actionMenuConfig.taskId); actionMenuConfig.isOpen = false">删除</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue';

// === 核心数据结构与状态 ===
interface Task {
  id: string;
  type: string;
  content: string;
  completed: boolean;
}

const tasks = ref<Task[]>([
  { id: '1', type: 'h1', content: 'NEXUS 协议核心目标', completed: false },
  { id: '2', type: 'todo', content: '测试 <kbd>退格键</kbd> 自动聚焦到上一行末尾', completed: true },
  { id: '3', type: 'text', content: '拖拽选中这段文字，测试智能防遮挡富文本菜单！', completed: false },
]);

// === DOM Refs 管理 ===
const inputRefs = ref<Record<string, HTMLElement>>({});
const setInputRef = (el: any, id: string) => {
  if (el) inputRefs.value[id] = el;
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
// 解决 Vue 渲染 contenteditable 导致光标丢失的问题：手动进行 DOM 更新，并且只在外部变化时更新
watch(tasks, () => {
  nextTick(() => {
    tasks.value.forEach(task => {
      const el = inputRefs.value[task.id];
      if (el && el.innerHTML !== task.content) {
        el.innerHTML = task.content; // 只有当状态与 DOM 不同步时才覆盖
      }
    });
  });
}, { deep: true, immediate: true });

// 监听焦点要求，执行物理聚焦
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

// === 基础增删改操作 ===
const updateTask = (id: string, updates: Partial<Task>) => {
  const task = tasks.value.find(t => t.id === id);
  if (task) Object.assign(task, updates);
};

const deleteTask = (id: string) => {
  tasks.value = tasks.value.filter(t => t.id !== id);
};

const duplicateTask = (id: string) => {
  const idx = tasks.value.findIndex(t => t.id === id);
  if (idx !== -1) {
    const newId = Date.now().toString();
    const newTask = { ...tasks.value[idx], id: newId };
    tasks.value.splice(idx + 1, 0, newTask);
  }
  actionMenuConfig.value.isOpen = false;
};

// === 富文本与输入拦截引擎 ===
const handleInput = (e: Event, task: Task) => {
  const target = e.currentTarget as HTMLElement;
  let htmlVal = target.innerHTML;
  let textVal = target.textContent || '';

  // 1. 清理空标签残余，保证 Placeholder 生效
  if (htmlVal === '<br>' || htmlVal === '<div><br></div>') {
    target.innerHTML = '';
    htmlVal = '';
    textVal = '';
  }

  // 2. 拦截 Markdown 快捷指令
  const normalizedText = textVal.replace(/\u00A0/g, ' '); // 替换非断行空格
  const triggerShortcut = (type: string) => {
    updateTask(task.id, { type, content: '' });
    // 指令生效后，强制抢回焦点到行首
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

// === 键盘接管引擎 (方向键穿梭、退格、回车) ===
const handleKeyDown = (e: KeyboardEvent, task: Task) => {
  // 1. 拦截 Slash 菜单操作
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
  const idx = tasks.value.findIndex(t => t.id === task.id);

  // 2. 正常文档流操作
  if (e.key === 'Enter') {
    e.preventDefault();
    const newType = ['bullet', 'todo'].includes(task.type) ? task.type : 'text';
    const newId = Date.now().toString();
    tasks.value.splice(idx + 1, 0, { id: newId, type: newType, content: '', completed: false });
    setFocusConfig(newId, 'start');
  } 
  else if (e.key === 'Backspace' && textContent === '') {
    e.preventDefault();
    if (idx > 0) {
      setFocusConfig(tasks.value[idx - 1].id, 'end');
    }
    deleteTask(task.id);
  }
  else if (e.key === 'ArrowUp') {
    if (idx > 0) { e.preventDefault(); setFocusConfig(tasks.value[idx - 1].id, currentPos); }
  } 
  else if (e.key === 'ArrowDown') {
    if (idx < tasks.value.length - 1) { e.preventDefault(); setFocusConfig(tasks.value[idx + 1].id, currentPos); }
  } 
  else if (e.key === 'ArrowLeft') {
    if (currentPos === 0 && idx > 0) { e.preventDefault(); setFocusConfig(tasks.value[idx - 1].id, 'end'); }
  } 
  else if (e.key === 'ArrowRight') {
    if (currentPos === textContent.length && idx < tasks.value.length - 1) { e.preventDefault(); setFocusConfig(tasks.value[idx + 1].id, 'start'); }
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

// === 全局点击交互 (空区域建行 & 菜单取消) ===
const handleEmptyClick = (e: MouseEvent) => {
  if ((e.target as HTMLElement).closest('.task-item-container') || (e.target as HTMLElement).closest('.fixed')) return;
  const lastTask = tasks.value[tasks.value.length - 1];
  if (lastTask && lastTask.content === '' && ['text', 'todo'].includes(lastTask.type)) {
    setFocusConfig(lastTask.id, 'end');
  } else {
    const newId = Date.now().toString();
    tasks.value.push({ id: newId, type: 'text', content: '', completed: false });
    setFocusConfig(newId, 'start');
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

// === 富文本指令与悬浮窗定位逻辑 ===
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

            // 智能防遮挡计算：增加 40px 的安全呼吸距离
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

// === 样式辅助类计算 ===
const getTextClass = (task: Task) => {
  if (task.type === 'h1') return 'text-2xl font-bold font-display text-cyan-glow/90';
  if (task.type === 'h2') return 'text-xl font-bold font-display text-text-display';
  if (task.type === 'h3') return 'text-lg font-bold font-display text-text-dim';
  if (task.type === 'quote') return 'italic text-amber-warn/90';
  if (task.completed && task.type === 'todo') return 'text-[15px] line-through text-text-dim';
  return 'text-[15px] text-text-display';
};

const getPlaceholder = (type: string) => {
  if (type === 'h1') return '标题 1';
  if (type === 'h2') return '标题 2';
  if (type === 'text') return "输入 '/' 唤出命令菜单，或选中文字加高亮...";
  return '...';
};
</script>