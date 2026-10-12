<template>
  <div class="flex h-screen w-full bg-[#090a0c] text-[#e5e7eb] font-sans overflow-hidden" @drop="handleGlobalDrop" @dragover.prevent>
    
    <!-- 左侧边栏 (Sidebar - Tree & Routing) -->
    <aside class="w-[280px] bg-[#14161a] border-r border-[#1e2126] flex flex-col shrink-0 transition-all z-10">
      <div class="h-14 px-4 flex items-center justify-between border-b border-[#1e2126] shadow-sm shrink-0">
        <div class="flex items-center gap-2">
          <span class="w-2 h-2 bg-[#00f0ff] rounded-sm shadow-[0_0_8px_rgba(0,240,255,0.6)] animate-pulse"></span>
          <span class="font-['Rajdhani',sans-serif] font-bold tracking-widest text-[#e5e7eb] text-sm">NEXUS MATRIX</span>
        </div>
        <div class="flex items-center gap-1" :title="syncStatus === 'online' ? `已同步 · 在线设备 ${onlineDevices}` : (syncStatus === 'connecting' ? '连接中…' : '离线 / 纯本地模式')">
          <span class="w-1.5 h-1.5 rounded-full transition-colors"
                :class="syncStatus === 'online' ? 'bg-[#00f0ff] shadow-[0_0_6px_rgba(0,240,255,0.8)]' : (syncStatus === 'connecting' ? 'bg-[#ffb000]' : 'bg-[#6b7280]')"></span>
          <span class="text-[10px] font-['JetBrains_Mono',monospace] text-[#6b7280] uppercase">
            {{ syncStatus === 'online' ? 'SYNC' : (syncStatus === 'connecting' ? 'LINK' : 'LOCAL') }}
          </span>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto py-4 space-y-6 custom-scrollbar">
        <!-- 收藏的子程序 -->
        <div v-if="favoritePages.length > 0">
          <div class="text-[11px] font-['JetBrains_Mono',monospace] text-[#6b7280] mb-1 px-4 uppercase tracking-wider font-bold">收藏的子程序</div>
          <div class="space-y-0.5 px-2">
            <div v-for="page in favoritePages" :key="'fav-'+page.id"
                 @click="activePageId = page.id"
                 class="group flex items-center justify-between px-2 py-1.5 rounded-md cursor-pointer transition-colors"
                 :class="activePageId === page.id ? 'bg-[#1e2126] text-[#00f0ff]' : 'text-[#6b7280] hover:bg-[#1e2126]/50'">
              <div class="flex items-center gap-2 truncate">
                <svg class="w-4 h-4 shrink-0 text-[#ffb000]" fill="currentColor" viewBox="0 0 24 24" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                <span class="text-sm truncate font-medium">{{ page.title || '无标题' }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 私人空间树状视图 -->
        <div>
          <div class="flex items-center justify-between text-[11px] font-['JetBrains_Mono',monospace] text-[#6b7280] mb-1 px-4 uppercase tracking-wider font-bold group">
            <span>私人空间网络</span>
            <button @click="createPage(null)" class="opacity-0 group-hover:opacity-100 hover:text-[#00f0ff] transition-all" title="新建根页面">
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </button>
          </div>
          
          <div class="space-y-0.5 px-2">
            <div v-for="page in visiblePages" :key="page.id"
                 @click="activePageId = page.id"
                 :style="{ paddingLeft: `${page.depth * 0.75 + 0.25}rem` }"
                 class="group relative flex items-center justify-between py-1.5 pr-2 rounded-md cursor-pointer transition-colors"
                 :class="activePageId === page.id ? 'bg-[#1e2126] text-[#00f0ff]' : 'text-[#6b7280] hover:bg-[#1e2126]/50'">
              
              <div class="flex items-center gap-1.5 truncate">
                <button @click.stop="toggleExpand(page.id)" class="w-5 h-5 flex items-center justify-center shrink-0 hover:bg-[#1e2126] rounded text-[#6b7280] hover:text-[#e5e7eb] transition-colors">
                  <svg v-if="page.hasChildren" class="w-3 h-3 transition-transform duration-200" :class="{'rotate-90': page.isExpanded}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="9 18 15 12 9 6"></polyline></svg>
                  <div v-else class="w-3 h-3"></div> 
                </button>
                <svg class="w-4 h-4 opacity-70 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                <span class="text-sm truncate font-medium">{{ page.title || '无标题' }}</span>
              </div>
              
              <div class="flex items-center opacity-0 group-hover:opacity-100 transition-opacity gap-0.5 shrink-0 bg-[#1e2126] rounded px-1 shadow-sm" :class="activePageId === page.id ? 'opacity-100' : ''">
                <button @click.stop="toggleFavorite(page.id)" class="p-1 text-[#6b7280] hover:text-[#ffb000] transition-colors" title="收藏">
                  <svg class="w-3.5 h-3.5" :fill="page.isFavorite ? 'currentColor' : 'none'" :class="page.isFavorite ? 'text-[#ffb000]' : ''" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                </button>
                <button @click.stop="createPage(page.id)" class="p-1 text-[#6b7280] hover:text-[#00f0ff] transition-colors" title="新建子页面">
                  <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                </button>
                <button @click.stop="deletePage(page.id)" class="p-1 text-[#6b7280] hover:text-[#ff2a2a] transition-colors" v-if="pages.length > 1" title="删除">
                  <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>

    <!-- 右侧主编辑区 -->
    <main class="flex-1 overflow-y-auto relative custom-scrollbar flex flex-col" v-if="activePage">
      <div class="w-full h-1 bg-[#00f0ff] shadow-[0_0_10px_rgba(0,240,255,0.4)] shrink-0"></div>

      <div class="max-w-4xl w-full mx-auto p-12 flex-1 flex flex-col">
        <!-- 面包屑导航 -->
        <div class="flex items-center gap-2 text-xs font-['JetBrains_Mono',monospace] text-[#6b7280] mb-8" v-if="activePageBreadcrumbs.length > 0">
           <template v-for="(crumb, idx) in activePageBreadcrumbs" :key="crumb.id">
              <span class="hover:text-[#e5e7eb] cursor-pointer transition-colors truncate max-w-[150px]" @click="activePageId = crumb.id">{{ crumb.title || '无标题' }}</span>
              <span v-if="idx < activePageBreadcrumbs.length - 1" class="opacity-50">/</span>
           </template>
        </div>

        <input type="text" v-model="activePage.title" 
               placeholder="无标题"
               class="w-full bg-transparent border-none outline-none font-['Rajdhani',sans-serif] text-5xl font-bold tracking-tight text-[#e5e7eb] placeholder-[#6b7280]/30 mb-10 pb-4 border-b border-[#1e2126]" />

        <div class="flex-1 relative pb-32" @click="handleEmptyClick">
          
          <!-- 任务行循环渲染 (含层级缩进与多媒体类型) -->
          <div v-for="(task, index) in activePage.tasks" :key="task.id" 
               class="task-item-container group relative flex items-start gap-3 p-2 my-1 rounded-sm transition-all duration-150"
               :style="{ marginLeft: `${(task.indentLevel || 0) * 1.5}rem` }"
               :class="{ 
                 'opacity-50': task.completed && task.type === 'todo',
                 'hover:bg-[#1e2126]/40': draggedTaskId !== task.id,
                 'opacity-30 scale-[0.98] border border-dashed border-[#6b7280]/50': draggedTaskId === task.id,
                 'shadow-[inset_0_2px_0_0_#00f0ff] bg-[#1e2126]/30': dragOverTaskId === task.id && dropPosition === 'top',
                 'shadow-[inset_0_-2px_0_0_#00f0ff] bg-[#1e2126]/30': dragOverTaskId === task.id && dropPosition === 'bottom'
               }"
               :draggable="draggableTaskId === task.id"
               @dragstart="handleDragStart($event, task)"
               @dragover.prevent="handleDragOver($event, task)"
               @dragleave="handleDragLeave($event, task)"
               @drop.prevent="handleDrop($event, task)"
               @dragend="handleDragEnd">
            
            <!-- 缩进引导线 (Guide Line) -->
            <div v-if="(task.indentLevel || 0) > 0" class="absolute left-0 top-0 bottom-0 w-[2px] bg-[#1e2126] rounded-full group-hover:bg-[#00f0ff]/30 transition-colors"></div>

            <!-- 快速插入按钮 (+号) -->
            <div class="mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 flex items-center justify-center relative" style="pointer-events: auto; z-index: 30;" draggable="false">
              <span class="inline-flex items-center justify-center w-6 h-6 cursor-pointer text-[#00f0ff] hover:text-[#ffb000] hover:bg-[#1e2126] rounded transition-colors"
                    draggable="false"
                    @mousedown.stop.prevent="onInsertMouseDown(task.id, $event)"
                    style="pointer-events: auto;"
                    title="Alt+点击在上方插入，点击在下方插入">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="pointer-events: none;">
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
              </span>
            </div>

            <!-- 拖拽与菜单手柄 -->
            <div class="mt-1.5 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity text-[#6b7280] hover:text-[#e5e7eb] shrink-0" 
                 @mousedown="draggableTaskId = task.id"
                 @mouseup="draggableTaskId = null"
                 @mouseleave="draggableTaskId = null"
                 @click="(e) => openActionMenu(e, task.id)" 
                 title="长按拖拽 / 点击操作">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="9" cy="12" r="1"></circle><circle cx="9" cy="5" r="1"></circle><circle cx="9" cy="19" r="1"></circle>
                <circle cx="15" cy="12" r="1"></circle><circle cx="15" cy="5" r="1"></circle><circle cx="15" cy="19" r="1"></circle>
              </svg>
            </div>

            <!-- 基础区块类型前缀 -->
            <template v-if="['text', 'h1', 'h2', 'h3', 'quote', 'todo', 'bullet'].includes(task.type)">
              <div v-if="task.type === 'todo'" class="mt-1.5 relative flex items-center justify-center shrink-0">
                <input type="checkbox" :checked="task.completed" @change="(e) => updateTask(task.id, { completed: (e.target as HTMLInputElement).checked })" 
                       class="peer appearance-none w-5 h-5 border-2 border-[#1e2126] bg-[#090a0c] checked:border-[#00f0ff] checked:bg-[#00f0ff]/20 cursor-pointer transition-all rounded-none outline-none" 
                       style="clip-path: polygon(3px 0, 100% 0, 100% calc(100% - 3px), calc(100% - 3px) 100%, 0 100%, 0 3px)" />
                <svg class="absolute w-3.5 h-3.5 text-[#00f0ff] pointer-events-none transition-opacity" :class="task.completed ? 'opacity-100' : 'opacity-0'" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                  <path stroke-linecap="square" stroke-linejoin="miter" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div v-else-if="task.type === 'bullet'" class="mt-3 flex items-center justify-center shrink-0 w-5">
                <div class="w-1.5 h-1.5 rounded-full bg-[#00f0ff]/80 shadow-[0_0_10px_rgba(0,240,255,0.4)]"></div>
              </div>
              <div v-if="task.type === 'quote'" class="absolute left-9 top-2 bottom-2 w-0.5 bg-[#ffb000] rounded-full shadow-[0_0_8px_rgba(255,176,0,0.4)]"></div>
              <div v-if="!task.type || ['text', 'h1', 'h2', 'h3'].includes(task.type)" class="w-1 shrink-0"></div>

              <!-- ContentEditable 富文本 -->
              <div class="flex-1 relative" :class="{ 'pl-4': task.type === 'quote' }">
                <div :ref="(el) => setInputRef(el, task.id)" 
                     contenteditable="true" 
                     @input="(e) => handleInput(e, task)"
                     @keydown="(e) => handleKeyDown(e, task, index)"
                     @focus="setFocusConfig(task.id, null)"
                     @blur="activeSlashTaskId = null"
                     :data-placeholder="getPlaceholder(task.type)"
                     class="ce-block w-full bg-transparent border-none outline-none leading-relaxed py-0.5 font-sans min-h-[24px] cursor-text"
                     :class="getTextClass(task)">
                </div>
              </div>
            </template>

            <!-- 多媒体区块：图片上传器 (Image Block) -->
            <div v-else-if="task.type === 'image'" class="flex-1 mt-1">
              <img v-if="task.payload?.url" :src="task.payload.url" class="max-w-full rounded-md border border-[#1e2126] shadow-sm object-contain max-h-[500px]" />
              <div v-else class="w-full h-32 border-2 border-dashed border-[#1e2126] bg-[#14161a] hover:bg-[#1e2126]/50 flex flex-col items-center justify-center rounded-md cursor-pointer hover:border-[#00f0ff] transition-all" @click="triggerImageUpload(task.id)">
                  <svg class="w-8 h-8 text-[#6b7280] mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                  <span class="text-sm font-['JetBrains_Mono',monospace] text-[#6b7280]">点击选择图片，或拖拽文件至屏幕任意位置</span>
                  <input type="file" :id="'img-upload-'+task.id" class="hidden" @change="(e) => handleImageUpload(e, task.id)" accept="image/*">
              </div>
            </div>

            <!-- 多行代码容器 (Code Block) -->
            <div v-else-if="task.type === 'codeblock'" class="flex-1 mt-1 bg-[#090a0c] border border-[#1e2126] rounded-md overflow-hidden font-['JetBrains_Mono',monospace] shadow-inner relative group/code">
              <div class="flex items-center justify-between px-4 py-2 bg-[#14161a] border-b border-[#1e2126]">
                  <div class="flex items-center gap-2">
                    <span class="w-2.5 h-2.5 rounded-full bg-[#ff2a2a]/80"></span>
                    <span class="w-2.5 h-2.5 rounded-full bg-[#ffb000]/80"></span>
                    <span class="w-2.5 h-2.5 rounded-full bg-[#00f0ff]/80"></span>
                  </div>
                  <select v-model="task.payload.language" @change="saveTasks" class="bg-transparent text-xs font-bold text-[#6b7280] hover:text-[#00f0ff] outline-none cursor-pointer uppercase tracking-wider">
                    <option value="javascript">JavaScript</option>
                    <option value="python">Python</option>
                    <option value="vue">Vue / HTML</option>
                    <option value="rust">Rust</option>
                  </select>
              </div>
              <textarea v-model="task.payload.code" @input="saveTasks" @keydown.tab.prevent="insertTabInCode($event, task)" class="w-full bg-transparent text-[#00f0ff] p-4 text-sm outline-none resize-y min-h-[120px] custom-scrollbar leading-relaxed" placeholder="// TYPE YOUR DIRECTIVES HERE..."></textarea>
            </div>

            <!-- 可视化看板 (Kanban / Database) -->
            <div v-else-if="task.type === 'kanban'" class="flex-1 mt-1 overflow-x-auto custom-scrollbar pb-4 pt-2">
               <div class="flex gap-4 min-w-max px-1">
                   <div v-for="col in task.payload.columns" :key="col.id" class="w-64 bg-[#14161a] border border-[#1e2126] rounded-md flex flex-col p-3 shrink-0 shadow-lg">
                       <div class="flex items-center justify-between mb-3 px-1">
                          <div class="text-sm font-bold font-['Rajdhani',sans-serif] text-[#e5e7eb] tracking-wide">{{col.title}}</div>
                          <div class="text-xs bg-[#1e2126] text-[#6b7280] px-2 rounded-full">{{ col.cards.length }}</div>
                       </div>
                       <div class="flex flex-col gap-2 flex-1">
                           <div v-for="(card, cIdx) in col.cards" :key="card.id" class="bg-[#1e2126] border border-[#374151]/50 p-2.5 rounded-sm text-sm text-[#e5e7eb] shadow-sm relative group/card">
                               {{card.text}}
                               <button @click="deleteKanbanCard(task, col, cIdx)" class="absolute top-1 right-1 p-1 opacity-0 group-hover/card:opacity-100 text-[#6b7280] hover:text-[#ff2a2a] transition-all"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
                           </div>
                           <input type="text" placeholder="+ 新建数据片" class="bg-transparent border border-dashed border-[#1e2126] hover:border-[#00f0ff]/50 focus:border-[#00f0ff] focus:bg-[#1e2126]/30 rounded-sm px-3 py-1.5 text-sm outline-none text-[#e5e7eb] transition-all mt-1 font-['JetBrains_Mono',monospace]" @keydown.enter="(e) => addKanbanCard(e, task, col)">
                       </div>
                   </div>
               </div>
            </div>

            <!-- 统一 Slash 命令弹出菜单 -->
            <div v-if="activeSlashTaskId === task.id" 
                 class="absolute left-0 w-64 bg-[#090a0c] border border-[#1e2126] shadow-2xl rounded-sm z-50 flex flex-col overflow-hidden"
                 :class="slashMenuPosition === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'">
              <div class="px-3 py-2 text-xs text-[#6b7280] uppercase tracking-wider font-['Rajdhani',sans-serif] bg-[#090a0c] z-10 border-b border-[#1e2126]/50 shadow-sm shrink-0">基础区块 & 多媒体容器</div>
              <div class="overflow-y-auto max-h-[260px] py-1 custom-scrollbar">
                <div v-for="(option, idx) in slashOptions" :key="option.id"
                     :ref="(el) => setSlashItemRef(el, idx)"
                     @mousedown.prevent="executeSlashCommand(task.id, option.id)"
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
          
          <div v-if="activePage.tasks.length === 0" class="text-[#6b7280]/50 font-['JetBrains_Mono',monospace] text-sm py-4 select-none pointer-events-none">
            [ 按 Enter 或点击此处开始编码你的矩阵... ]
          </div>
        </div>
      </div>
    </main>

    <!-- 悬浮防遮挡菜单 & 全局操作菜单 (与之前一致，保持精简引用) -->
    <!-- ... -->
    <div v-if="actionMenuConfig.isOpen" class="action-menu-popup fixed z-50 w-48 bg-[#090a0c] border border-[#1e2126] shadow-2xl py-1 rounded-sm text-sm" :style="{ top: `${actionMenuConfig.y}px`, left: `${actionMenuConfig.x}px` }" @click.stop>
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
import { initSync, closeSync, pushAll, createRemotePage, deleteRemotePage, syncStatus, onlineDevices, type Page as SyncPage, type Task as SyncTask } from '../composables/useSync';

// === 数据结构 ===
interface Task { 
  id: string; 
  type: string; 
  content: string; 
  completed: boolean; 
  indentLevel?: number;
  payload?: any; 
}
interface Page { id: string; title: string; tasks: Task[]; parentId: string | null; isFavorite: boolean; isExpanded: boolean; }

// === 全局状态与持久化 (LocalFirst + 远端同步由 useSync 统一托管) ===
const pages = ref<Page[]>([
  {
    id: 'default-page', title: 'NEXUS 协议指南', parentId: null, isFavorite: true, isExpanded: true,
    tasks: [
      { id: '1', type: 'h1', content: '欢迎使用 NEXUS MATRIX', completed: false, indentLevel: 0 },
      { id: '2', type: 'text', content: '现在，它已经进化为了全功能的“六边形战士”：', completed: false, indentLevel: 0 },
      { id: '3', type: 'bullet', content: '尝试在行首按下 <kbd>Tab</kbd> 键进行层级缩进，按 <kbd>Backspace</kbd> 退格恢复。', completed: false, indentLevel: 1 },
      { id: '4', type: 'bullet', content: '输入 <kbd>/code</kbd> 生成带有多语言下拉框的代码块。', completed: false, indentLevel: 1 },
      { id: '5', type: 'bullet', content: '输入 <kbd>/kanban</kbd> 体验可视化数据看板。', completed: false, indentLevel: 1 },
      { id: '6', type: 'bullet', content: '直接把桌面上的图片 <b>拖拽</b> 到浏览器任意位置，瞬间完成解析！', completed: false, indentLevel: 1 },
    ]
  }
]);

const activePageId = ref<string>('default-page');
const activePage = computed(() => pages.value.find(p => p.id === activePageId.value));

onMounted(async () => {
  // LocalFirst: 读本地 -> 远端握手对齐 -> 建立 WebSocket -> 变更自动持久化+广播
  await initSync(pages as any);
  const hash = window.location.hash.slice(1);
  if (hash && pages.value.find(p => p.id === hash)) activePageId.value = hash;
  else if (pages.value.length > 0) { activePageId.value = pages.value[0].id; window.history.replaceState(null, '', `#${activePageId.value}`); }
  window.addEventListener('hashchange', () => {
     const newHash = window.location.hash.slice(1);
     if (newHash && pages.value.find(p => p.id === newHash)) activePageId.value = newHash;
  });

  // 全局点击关闭转换区块浮窗
  const handleGlobalClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    // 点击菜单自身时不关闭（菜单上有 @click.stop）
    if (target.closest('.action-menu-popup')) return;
    actionMenuConfig.value.isOpen = false;
  };
  document.addEventListener('mousedown', handleGlobalClick);

  // Escape 键关闭浮窗
  const handleEscape = (e: KeyboardEvent) => {
    if (e.key === 'Escape') actionMenuConfig.value.isOpen = false;
  };
  document.addEventListener('keydown', handleEscape);

  // === 跨行鼠标选区支持 ===
  // 参考 Notion 的做法：contentEditable 始终保持 true，通过 selectionchange 事件追踪选区。
  // 核心原则：绝不主动调用 focus()（会清除选区），让浏览器自然管理焦点和选区。
  let mouseDownTarget: HTMLElement | null = null;

  document.addEventListener('mousedown', (e: MouseEvent) => {
    const ceBlock = (e.target as HTMLElement).closest('.ce-block') as HTMLElement | null;
    if (!ceBlock) return;
    mouseDownTarget = ceBlock;
  });

  document.addEventListener('mouseup', (e: MouseEvent) => {
    if (!mouseDownTarget) return;

    const sel = window.getSelection();
    const hasSelection = sel && sel.rangeCount > 0 && sel.toString().length > 0;

    if (!hasSelection) {
      // 没有选区：说明是单击，进入编辑模式
      const mouseUpTarget = (e.target as HTMLElement).closest('.ce-block') as HTMLElement | null;
      if (mouseUpTarget && mouseDownTarget === mouseUpTarget) {
        // 使用 caretRangeFromPoint 定位光标，这会自动 focus 元素
        const range = document.caretRangeFromPoint(e.clientX, e.clientY);
        if (range) {
          sel?.removeAllRanges();
          sel?.addRange(range);
        }
      }
    }
    // 有选区时什么都不做——浏览器已正确设置选区和焦点，不干预就不会丢失

    mouseDownTarget = null;
  });
});

// 持久化与远端广播统一由 useSync 内部 watch 处理
watch(activePageId, (newId) => { if(window.location.hash.slice(1) !== newId) window.location.hash = newId; });

onUnmounted(() => { closeSync(); });

// === Sidebar 树状逻辑 ===
const favoritePages = computed(() => pages.value.filter(p => p.isFavorite));
const getChildren = (parentId: string | null) => pages.value.filter(p => p.parentId === parentId);
const hasChildren = (id: string) => pages.value.some(p => p.parentId === id);
const buildTree = (parentId: string | null, depth: number): any[] => {
  let result: any[] = [];
  for (const child of getChildren(parentId)) {
    result.push({ ...child, depth, hasChildren: hasChildren(child.id) });
    if (child.isExpanded) result = result.concat(buildTree(child.id, depth + 1));
  }
  return result;
};
const visiblePages = computed(() => buildTree(null, 0));
const activePageBreadcrumbs = computed(() => {
   const breadcrumbs = []; let current = activePage.value;
   while (current) { breadcrumbs.unshift(current); current = pages.value.find(p => p.id === current?.parentId); }
   return breadcrumbs;
});

const createPage = (parentId: string | null = null) => {
  const newId = 'page-' + Date.now().toString();
  pages.value.push({ id: newId, title: '', tasks: [{ id: Date.now().toString(), type: 'text', content: '', completed: false, indentLevel: 0 }], parentId, isFavorite: false, isExpanded: true });
  if (parentId) { const parent = pages.value.find(p => p.id === parentId); if (parent) parent.isExpanded = true; }
  activePageId.value = newId;
  // 同步到后端（失败不影响本地编辑）
  const created = pages.value.find(p => p.id === newId);
  if (created) createRemotePage(created as any);
};
const toggleFavorite = (id: string) => { const p = pages.value.find(p => p.id === id); if (p) p.isFavorite = !p.isFavorite; };
const toggleExpand = (id: string) => { const p = pages.value.find(p => p.id === id); if (p) p.isExpanded = !p.isExpanded; };
const deletePage = (id: string) => {
   const idsToDelete = new Set([id]); let currentSize = 0;
   while(idsToDelete.size > currentSize) {
       currentSize = idsToDelete.size;
       pages.value.forEach(p => { if (p.parentId && idsToDelete.has(p.parentId)) idsToDelete.add(p.id); });
   }
   pages.value = pages.value.filter(p => !idsToDelete.has(p.id));
   if (!pages.value.find(p => p.id === activePageId.value)) activePageId.value = pages.value[0]?.id || '';
   idsToDelete.forEach(pid => deleteRemotePage(pid));
};

// === 核心状态与 Refs ===
const inputRefs = ref<Record<string, HTMLElement>>({});
const setInputRef = (el: any, id: string) => { if (el) inputRefs.value[id] = el; else delete inputRefs.value[id]; };
const focusConfig = ref<{ id: string | null, pos: any }>({ id: null, pos: null });
const actionMenuConfig = ref({ isOpen: false, x: 0, y: 0, taskId: '' });
const formatMenuConfig = ref({ isOpen: false, x: 0, y: 0, position: 'top', activeTaskId: '' });

// 拖拽排序状态
const draggableTaskId = ref<string | null>(null);
const draggedTaskId = ref<string | null>(null);
const dragOverTaskId = ref<string | null>(null);
const dropPosition = ref<'top' | 'bottom'>('bottom');

// Slash 菜单选项 (新增多媒体)
const activeSlashTaskId = ref<string | null>(null);
const slashIndex = ref(0);
const slashMenuPosition = ref('bottom');
const slashItemRefs = ref<HTMLElement[]>([]);
const setSlashItemRef = (el: any, index: number) => { if (el) slashItemRefs.value[index] = el; };
const slashOptions = [
  { id: 'text', label: '普通文本', icon: 'T', desc: '基础的文字段落' }, { id: 'todo', label: '待办事项', icon: '[]', desc: '带有复选框的任务' },
  { id: 'h1', label: '一级标题', icon: 'H1', desc: '大尺寸科幻标题' }, { id: 'h2', label: '二级标题', icon: 'H2', desc: '中等尺寸副标题' },
  { id: 'h3', label: '三级标题', icon: 'H3', desc: '小尺寸副标题' }, { id: 'bullet', label: '无序列表', icon: '•', desc: '基础的点状列表' },
  { id: 'quote', label: '引用块', icon: '"', desc: '高亮引用的重要文字' },
  { id: 'image', label: '图片媒体', icon: 'IMG', desc: '上传或拖拽图片解析' },
  { id: 'codeblock', label: '代码片段', icon: '</>', desc: '多行语法高亮容器' },
  { id: 'kanban', label: '看板数据库', icon: '|||', desc: '可视化状态追踪画板' },
];
const blockTypes = [ { id: 'text', label: '文本' }, { id: 'h1', label: 'H1' }, { id: 'h2', label: 'H2' }, { id: 'quote', label: '引用' } ];

// === 拖拽引擎实现 ===
const handleDragStart = (e: DragEvent, task: Task) => {
  if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', task.id); }
  draggedTaskId.value = task.id; formatMenuConfig.value.isOpen = false;
};
const handleDragOver = (e: DragEvent, task: Task) => {
  if (!draggedTaskId.value || draggedTaskId.value === task.id) return;
  dragOverTaskId.value = task.id;
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  dropPosition.value = e.clientY < rect.top + rect.height / 2 ? 'top' : 'bottom';
};
const handleDragLeave = (e: DragEvent, task: Task) => { if (dragOverTaskId.value === task.id) dragOverTaskId.value = null; };
const handleDrop = (e: DragEvent, task: Task) => {
  const draggedId = e.dataTransfer?.getData('text/plain');
  if (!draggedId || draggedId === task.id || !activePage.value) { resetDragState(); return; }
  const tasksList = activePage.value.tasks;
  const draggedIdx = tasksList.findIndex((t: Task) => t.id === draggedId);
  const targetIdx = tasksList.findIndex((t: Task) => t.id === task.id);
  if (draggedIdx > -1 && targetIdx > -1) {
    const [draggedItem] = tasksList.splice(draggedIdx, 1);
    const newTargetIdx = tasksList.findIndex((t: Task) => t.id === task.id);
    // 智能继承缩进等级
    draggedItem.indentLevel = task.indentLevel;
    tasksList.splice(dropPosition.value === 'top' ? newTargetIdx : newTargetIdx + 1, 0, draggedItem);
  }
  resetDragState();
};
const handleDragEnd = () => resetDragState();
const resetDragState = () => { draggedTaskId.value = null; dragOverTaskId.value = null; draggableTaskId.value = null; };

// === 光标引擎 ===
const setCaretPosition = (el: HTMLElement, pos: any) => {
  if (!el) return;
  const range = document.createRange(); const sel = window.getSelection();
  let charIndex = 0; let rangeFound = false;
  const traverseNodes = (node: Node) => {
    if (rangeFound) return;
    if (node.nodeType === 3) {
      const nextCharIndex = charIndex + (node.textContent?.length || 0);
      if (pos <= nextCharIndex) { range.setStart(node, pos - charIndex); range.collapse(true); rangeFound = true; }
      charIndex = nextCharIndex;
    } else { for (let i = 0; i < node.childNodes.length; i++) traverseNodes(node.childNodes[i]); }
  };
  if (pos === 'end') { range.selectNodeContents(el); range.collapse(false); } 
  else if (pos === 'start') { range.selectNodeContents(el); range.collapse(true); } 
  else { traverseNodes(el); if (!rangeFound) { range.selectNodeContents(el); range.collapse(false); } }
  sel?.removeAllRanges(); sel?.addRange(range);
};
const getCaretPosition = (el: HTMLElement) => {
  const sel = window.getSelection(); if (!sel || sel.rangeCount === 0) return 0;
  const range = sel.getRangeAt(0); const preCaretRange = range.cloneRange();
  preCaretRange.selectNodeContents(el); preCaretRange.setEnd(range.endContainer, range.endOffset);
  return preCaretRange.toString().length;
};

// 扩展选区到指定元素（支持跨行选择）
const extendSelectionTo = (el: HTMLElement | undefined, pos: 'start' | 'end') => {
  if (!el) return;
  el.focus();
  
  const sel = window.getSelection();
  if (!sel) return;
  
  // 获取目标位置
  const targetRange = document.createRange();
  if (pos === 'start') {
    targetRange.setStart(el, 0);
    targetRange.collapse(true);
  } else {
    targetRange.setEnd(el, el.childNodes.length);
    targetRange.collapse(false);
  }
  
  // 如果有现有选区，扩展它；否则从当前光标位置开始选区
  if (sel.rangeCount > 0) {
    const existingRange = sel.getRangeAt(0);
    const newRange = document.createRange();
    
    // 比较位置，确定锚点和焦点
    const comparison = existingRange.compareBoundaryPoints(Range.END_TO_END, targetRange);
    
    if (comparison <= 0) {
      // 目标在现有选区之后或相同位置：锚点不变，焦点移到目标
      newRange.setStart(existingRange.startContainer, existingRange.startOffset);
      newRange.setEnd(targetRange.endContainer, targetRange.endOffset);
    } else {
      // 目标在现有选区之前：锚点变为原焦点，焦点移到目标
      newRange.setStart(targetRange.startContainer, targetRange.startOffset);
      newRange.setEnd(existingRange.endContainer, existingRange.endOffset);
    }
    
    sel.removeAllRanges();
    sel.addRange(newRange);
  } else {
    // 无现有选区，创建一个从光标到目标的选区
    sel.addRange(targetRange);
  }
};

// 状态同步
watch(() => activePage.value?.tasks, () => {
  nextTick(() => {
    if (!activePage.value) return;
    activePage.value.tasks.forEach(task => {
      const el = inputRefs.value[task.id]; 
      if (el && el.innerHTML !== task.content && ['text', 'h1', 'h2', 'h3', 'quote', 'todo', 'bullet'].includes(task.type)) {
          el.innerHTML = task.content; 
      }
    });
  });
}, { deep: true, immediate: true });

// 设置焦点到指定行的指定位置
const setFocusConfig = (id: string | null, pos: any) => {
  focusConfig.value = { id, pos };
};

watch(focusConfig, (newVal) => {
  if (newVal.id) { nextTick(() => { const el = inputRefs.value[newVal.id as string]; if (el && newVal.pos !== null) { el.focus(); setCaretPosition(el, newVal.pos); } }); }
}, { deep: true });

// === 高级交互逻辑 (Block CRUD & Nested & Multimedia) ===
const updateTask = (id: string, updates: Partial<Task>) => { if (!activePage.value) return; const task = activePage.value.tasks.find((t: Task) => t.id === id); if (task) Object.assign(task, updates); };
const deleteTask = (id: string) => { if (!activePage.value) return; activePage.value.tasks = activePage.value.tasks.filter((t: Task) => t.id !== id); };
const duplicateTask = (id: string) => {
  if (!activePage.value) return;
  const idx = activePage.value.tasks.findIndex((t: Task) => t.id === id);
  if (idx !== -1) { const newId = Date.now().toString(); activePage.value.tasks.splice(idx + 1, 0, { ...activePage.value.tasks[idx], id: newId }); }
  actionMenuConfig.value.isOpen = false;
};

// 拦截文本输入 (Markdown 与 Slash)
const handleInput = (e: Event, task: Task) => {
  const target = e.currentTarget as HTMLElement; let htmlVal = target.innerHTML; let textVal = target.textContent || '';
  if (htmlVal === '<br>' || htmlVal === '<div><br></div>') { target.innerHTML = ''; htmlVal = ''; textVal = ''; }
  const normalizedText = textVal.replace(/\u00A0/g, ' '); 
  const triggerShortcut = (type: string) => { updateTask(task.id, { type, content: '' }); setFocusConfig(task.id, 'start'); activeSlashTaskId.value = null; };
  if (normalizedText === '/') {
    activeSlashTaskId.value = task.id; slashIndex.value = 0; updateTask(task.id, { content: htmlVal });
    nextTick(() => { slashMenuPosition.value = (window.innerHeight - target.getBoundingClientRect().bottom < 300) ? 'top' : 'bottom'; });
  } else if (activeSlashTaskId.value === task.id && !normalizedText.includes('/')) { activeSlashTaskId.value = null; updateTask(task.id, { content: htmlVal }); } 
  else if (normalizedText === '[] ') triggerShortcut('todo'); else if (normalizedText === '# ') triggerShortcut('h1'); else if (normalizedText === '## ') triggerShortcut('h2');
  else if (normalizedText === '### ') triggerShortcut('h3'); else if (normalizedText === '- ') triggerShortcut('bullet'); else if (normalizedText === '" ') triggerShortcut('quote');
  else updateTask(task.id, { content: htmlVal });
};

// 键盘高级拦截 (Tab 层级引擎 & 级联退格)
const handleKeyDown = (e: KeyboardEvent, task: Task, index: number) => {
  if (!activePage.value) return; const tasksList = activePage.value.tasks;

  // Slash 拦截
  if (activeSlashTaskId.value === task.id) {
    if (e.key === 'ArrowDown') { e.preventDefault(); slashIndex.value = (slashIndex.value + 1) % slashOptions.length; scrollSlashIntoView(); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); slashIndex.value = (slashIndex.value - 1 + slashOptions.length) % slashOptions.length; scrollSlashIntoView(); return; }
    if (e.key === 'Enter') { e.preventDefault(); executeSlashCommand(task.id, slashOptions[slashIndex.value].id); return; }
    if (e.key === 'Escape') { activeSlashTaskId.value = null; return; }
  }

  const target = e.currentTarget as HTMLElement; const textContent = target.textContent || ''; const currentPos = getCaretPosition(target); 

  // Ctrl+A：选中所有行的所有内容
  if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    const taskElements = document.querySelectorAll('.ce-block');
    if (taskElements.length > 0) {
      const firstEl = taskElements[0] as HTMLElement;
      const lastEl = taskElements[taskElements.length - 1] as HTMLElement;
      const range = document.createRange();
      const sel = window.getSelection();
      range.setStart(firstEl, 0);
      range.setEnd(lastEl, lastEl.childNodes.length);
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    return;
  }
  
  // Tab 缩进拦截引擎
  if (e.key === 'Tab') {
    e.preventDefault();
    if (e.shiftKey) {
      if ((task.indentLevel || 0) > 0) updateTask(task.id, { indentLevel: (task.indentLevel || 0) - 1 });
    } else {
      if (index > 0) {
        const prevTask = tasksList[index - 1];
        const maxIndent = (prevTask.indentLevel || 0) + 1;
        if ((task.indentLevel || 0) < maxIndent) updateTask(task.id, { indentLevel: (task.indentLevel || 0) + 1 });
      }
    }
    return;
  }

  // Enter 键：在任意位置拆分当前行为两行
  if (e.key === 'Enter') {
    e.preventDefault();
    const newType = ['bullet', 'todo'].includes(task.type) ? task.type : 'text';
    const newId = Date.now().toString();
    
    // 从 DOM 获取当前行的实际内容和光标位置
    const actualText = target.textContent || '';
    const beforeCursor = actualText.slice(0, currentPos);
    const afterCursor = actualText.slice(currentPos);
    
    // 更新当前行内容为光标前的部分
    updateTask(task.id, { content: beforeCursor });
    
    // 在当前行之后插入新行，内容为光标后的部分
    tasksList.splice(index + 1, 0, { 
      id: newId, 
      type: newType, 
      content: afterCursor, 
      completed: false, 
      indentLevel: task.indentLevel 
    });
    
    // 光标定位到新行开头
    setFocusConfig(newId, 'start');
  } 
  // 级联退格保护 (Cascade Backspace)
  else if (e.key === 'Backspace' && currentPos === 0) {
    // 有缩进时先减少缩进
    if ((task.indentLevel || 0) > 0) {
      e.preventDefault();
      updateTask(task.id, { indentLevel: (task.indentLevel || 0) - 1 });
      return;
    }
    // 无缩进且非首行时，合并到上一行末尾
    if (index > 0) {
      e.preventDefault();
      const prevTask = tasksList[index - 1];
      const prevEl = inputRefs.value[prevTask.id];
      
      // 关键：从 DOM 直接读取上一行的实际文本长度，而非响应式数据
      // 因为响应式数据可能滞后于用户输入
      const prevActualLength = prevEl ? (prevEl.textContent || '').length : 0;
      const currContentText = task.content || '';
      
      // 更新数据模型：合并内容并删除当前行
      updateTask(prevTask.id, { content: (prevTask.content || '') + currContentText });
      deleteTask(task.id);
      
      // 等待 DOM 更新后，将光标定位到上一行原始末尾位置
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const updatedPrevEl = inputRefs.value[prevTask.id];
          if (updatedPrevEl) {
            updatedPrevEl.focus();
            // 光标定位到按 Backspace 前上一行的实际末尾
            setCaretPosition(updatedPrevEl, prevActualLength);
          }
        });
      });
      return;
    }
    // 首行且为空时删除
    if (textContent === '') {
      e.preventDefault();
      deleteTask(task.id);
    }
  }
  // 方向键：支持 Shift 跨行选区
  else if (e.key === 'ArrowUp') {
    e.preventDefault();
    const targetId = tasksList[index - 1].id;
    const targetEl = inputRefs.value[targetId];
    if (e.shiftKey) {
      // 跨行扩展选区到上一行末尾
      extendSelectionTo(targetEl, 'end');
    } else {
      setFocusConfig(targetId, currentPos);
    }
  }
  else if (e.key === 'ArrowDown') {
    e.preventDefault();
    const targetId = tasksList[index + 1].id;
    const targetEl = inputRefs.value[targetId];
    if (e.shiftKey) {
      // 跨行扩展选区到下一行开头
      extendSelectionTo(targetEl, 'start');
    } else {
      setFocusConfig(targetId, currentPos);
    }
  }
  else if (e.key === 'ArrowLeft') {
    if (currentPos === 0 && index > 0) {
      e.preventDefault();
      const targetId = tasksList[index - 1].id;
      const targetEl = inputRefs.value[targetId];
      if (e.shiftKey) {
        // 跨行扩展选区到上一行末尾
        extendSelectionTo(targetEl, 'end');
      } else {
        setFocusConfig(targetId, 'end');
      }
    }
  }
  else if (e.key === 'ArrowRight') {
    if (currentPos === textContent.length && index < tasksList.length - 1) {
      e.preventDefault();
      const targetId = tasksList[index + 1].id;
      const targetEl = inputRefs.value[targetId];
      if (e.shiftKey) {
        // 跨行扩展选区到下一行开头
        extendSelectionTo(targetEl, 'start');
      } else {
        setFocusConfig(targetId, 'start');
      }
    }
  }
};

// 触发多媒体与复杂块的挂载逻辑
const executeSlashCommand = (taskId: string, newType: string) => { 
  const payloadInit: any = {};
  if (newType === 'codeblock') Object.assign(payloadInit, { language: 'javascript', code: '' });
  if (newType === 'image') Object.assign(payloadInit, { url: '' });
  if (newType === 'kanban') Object.assign(payloadInit, { columns: [{id:'c1',title:'待办',cards:[]}, {id:'c2',title:'进行中',cards:[]}, {id:'c3',title:'已完成',cards:[]}] });
  
  updateTask(taskId, { type: newType, content: '', payload: payloadInit }); 
  activeSlashTaskId.value = null; 
  if (['text', 'h1', 'h2', 'h3', 'quote', 'todo', 'bullet'].includes(newType)) setFocusConfig(taskId, 'start'); 
};
const scrollSlashIntoView = () => { nextTick(() => { const el = slashItemRefs.value[slashIndex.value]; if (el) el.scrollIntoView({ block: 'nearest' }); }); };

// 多媒体功能实现
const triggerImageUpload = (taskId: string) => { document.getElementById('img-upload-' + taskId)?.click(); };
const handleImageUpload = (e: Event, taskId: string) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file && file.type.startsWith('image/')) {
    const reader = new FileReader();
    reader.onload = (event) => { updateTask(taskId, { payload: { url: event.target?.result } }); };
    reader.readAsDataURL(file);
  }
};
// 全局拖拽拦截解析图片
const handleGlobalDrop = (e: DragEvent) => {
  if (e.dataTransfer && e.dataTransfer.files.length > 0) {
    const file = e.dataTransfer.files[0];
    if (file.type.startsWith('image/')) {
      e.preventDefault();
      const reader = new FileReader();
      reader.onload = (event) => {
        if (activePage.value) {
          activePage.value.tasks.push({
             id: Date.now().toString(), type: 'image', content: '', completed: false, indentLevel: 0,
             payload: { url: event.target?.result }
          });
        }
      };
      reader.readAsDataURL(file);
    }
  }
};

const insertTabInCode = (e: KeyboardEvent, task: Task) => {
  const target = e.target as HTMLTextAreaElement;
  const start = target.selectionStart;
  const end = target.selectionEnd;
  if(task.payload) {
     task.payload.code = task.payload.code.substring(0, start) + "  " + task.payload.code.substring(end);
     nextTick(() => { target.selectionStart = target.selectionEnd = start + 2; });
  }
};

// Kanban API
const addKanbanCard = (e: Event, task: Task, col: any) => {
   const val = (e.target as HTMLInputElement).value;
   if(val.trim()) { col.cards.push({ id: Date.now().toString(), text: val }); (e.target as HTMLInputElement).value = ''; saveTasks(); }
};
const deleteKanbanCard = (task: Task, col: any, cardIdx: number) => {
   col.cards.splice(cardIdx, 1); saveTasks();
};

const handleEmptyClick = (e: MouseEvent) => {
  if (!activePage.value) return; if ((e.target as HTMLElement).closest('.task-item-container') || (e.target as HTMLElement).closest('.fixed')) return;
  const tasksList = activePage.value.tasks; const lastTask = tasksList[tasksList.length - 1];
  if (lastTask && lastTask.content === '' && ['text', 'todo'].includes(lastTask.type)) setFocusConfig(lastTask.id, 'end');
  else { const newId = Date.now().toString(); tasksList.push({ id: newId, type: 'text', content: '', completed: false, indentLevel: 0 }); setFocusConfig(newId, 'start'); }
};
// 点击+号按钮的处理函数（使用mousedown避免与拖拽冲突）
let insertClickHandled = false;
const onInsertMouseDown = (targetId: string, event: MouseEvent) => {
  event.preventDefault();
  event.stopPropagation();
  insertClickHandled = false;
  // 在mouseup时触发插入，避免与拖拽冲突
  const handleMouseUp = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!insertClickHandled) {
      insertClickHandled = true;
      const position = e.altKey ? 'above' : 'below';
      insertTask(targetId, position);
    }
    document.removeEventListener('mouseup', handleMouseUp);
  };
  document.addEventListener('mouseup', handleMouseUp);
};

// 在当前行的上方或下方插入新行
const insertTask = (targetId: string, position: 'above' | 'below' = 'below') => {
  if (!activePage.value) return;
  const idx = activePage.value.tasks.findIndex((t: Task) => t.id === targetId);
  if (idx === -1) return;
  const newId = Date.now().toString();
  const insertIdx = position === 'above' ? idx : idx + 1;
  const targetTask = activePage.value.tasks[idx];
  activePage.value.tasks.splice(insertIdx, 0, {
    id: newId,
    type: 'text',
    content: '',
    completed: false,
    indentLevel: targetTask.indentLevel || 0,
  });
  // 使用 focusConfig 让新行获得焦点
  focusConfig.value = { id: newId, pos: 'start' };
};

const openActionMenu = (e: MouseEvent, taskId: string) => { e.stopPropagation(); actionMenuConfig.value = { isOpen: true, x: (e.currentTarget as HTMLElement).getBoundingClientRect().left, y: (e.currentTarget as HTMLElement).getBoundingClientRect().bottom + 4, taskId }; };
const handleActionCommand = (type: string) => { updateTask(actionMenuConfig.value.taskId, { type }); actionMenuConfig.value.isOpen = false; };

// 样式与提示
const getTextClass = (task: Task) => {
  if (task.type === 'h1') return 'text-2xl font-bold font-["Rajdhani",sans-serif] text-[#00f0ff]/90';
  if (task.type === 'h2') return 'text-xl font-bold font-["Rajdhani",sans-serif] text-[#e5e7eb]';
  if (task.type === 'h3') return 'text-lg font-bold font-["Rajdhani",sans-serif] text-[#6b7280]';
  if (task.type === 'quote') return 'italic text-[#ffb000]/90';
  if (task.completed && task.type === 'todo') return 'text-[15px] line-through text-[#6b7280]';
  return 'text-[15px] text-[#e5e7eb]';
};
const getPlaceholder = (type: string) => { if (type === 'h1') return '标题 1'; if (type === 'h2') return '标题 2'; if (type === 'text') return "输入 '/' 唤出命令菜单..."; return '...'; };
</script>

<style scoped>
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