<template>
  <div class="flex h-screen w-full bg-[#090a0c] text-[#e5e7eb] font-sans overflow-hidden" @drop="handleGlobalDrop" @dragover.prevent>
    
    <!-- 左侧边栏 (Sidebar - Tree & Routing) -->
    <aside class="w-[280px] bg-[#14161a] border-r border-[#1e2126] flex flex-col shrink-0 transition-all z-10">
      <div class="h-14 px-4 flex items-center justify-between border-b border-[#1e2126] shadow-sm shrink-0">
        <div class="flex items-center gap-2">
          <span class="w-2 h-2 bg-[#00f0ff] rounded-sm shadow-[0_0_8px_rgba(0,240,255,0.6)] animate-pulse"></span>
          <span class="font-['Rajdhani',sans-serif] font-bold tracking-widest text-[#e5e7eb] text-sm">NEXUS MATRIX</span>
        </div>
        <!-- 同步状态指示：点击可手动重试（后端离线时不再无限自动重连） -->
        <button class="flex items-center gap-1 cursor-pointer hover:opacity-80 transition-opacity"
                :title="syncStatus === 'online' ? `已同步 · 在线设备 ${onlineDevices}` : (syncStatus === 'connecting' ? '正在连接后端…' : '纯本地模式（数据已存本机）· 点击重试连接')"
                @click="onSyncIndicatorClick">
          <span class="w-1.5 h-1.5 rounded-full transition-colors"
                :class="syncStatus === 'online' ? 'bg-[#00f0ff] shadow-[0_0_6px_rgba(0,240,255,0.8)]' : (syncStatus === 'connecting' ? 'bg-[#ffb000]' : 'bg-[#6b7280]')"></span>
          <span class="text-[10px] font-['JetBrains_Mono',monospace] text-[#6b7280] uppercase">
            {{ syncStatus === 'online' ? 'SYNC' : (syncStatus === 'connecting' ? 'LINK' : 'LOCAL') }}
          </span>
        </button>
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
                <!-- 文档图标：有图标显示 emoji，无图标显示默认文件图标。
                     点击即可设置（对齐 Notion：图标是页面的第一公民） -->
                <span class="w-4 h-4 flex items-center justify-center shrink-0 text-[15px] leading-none cursor-pointer rounded-sm hover:bg-[#1e2126] transition-colors"
                      :class="page.icon ? '' : 'text-[#6b7280]'"
                      :title="page.icon ? `图标：${page.icon}（点击修改）` : '点击设置文档图标'"
                      @click.stop="openIconPicker(page.id, $event)">
                  <template v-if="page.icon">{{ page.icon }}</template>
                  <svg v-else class="w-4 h-4 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                </span>
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
    <main class="flex-1 overflow-y-auto relative custom-scrollbar flex flex-col" v-if="activePage" @scroll="hideFormatToolbar">
      <div class="w-full h-1 bg-[#00f0ff] shadow-[0_0_10px_rgba(0,240,255,0.4)] shrink-0"></div>

      <div class="max-w-4xl w-full mx-auto pt-12 pb-0 px-20 flex-1 flex flex-col">
        <!-- 面包屑导航 -->
        <div class="flex items-center gap-2 text-xs font-['JetBrains_Mono',monospace] text-[#6b7280] mb-8" v-if="activePageBreadcrumbs.length > 0">
           <template v-for="(crumb, idx) in activePageBreadcrumbs" :key="crumb.id">
              <span class="hover:text-[#e5e7eb] cursor-pointer transition-colors truncate max-w-[150px]" @click="activePageId = crumb.id"><span v-if="crumb.icon" class="mr-1">{{ crumb.icon }}</span>{{ crumb.title || '无标题' }}</span>
              <span v-if="idx < activePageBreadcrumbs.length - 1" class="opacity-50">/</span>
           </template>
        </div>

        <!-- 文档图标（Notion 的 Page Icon）：位于标题上方的大图标。
             无图标时显示「添加图标」，hover 时高亮；点击唤出选择器 -->
        <div class="mb-2 -ml-1">
          <button ref="titleIconBtnRef"
                  class="w-16 h-16 flex items-center justify-center rounded-md transition-colors group/icon"
                  :class="activePage.icon ? 'text-[64px] leading-none hover:bg-[#1e2126]/50' : 'text-[#6b7280] hover:text-[#00f0ff] hover:bg-[#1e2126]/50'"
                  :title="activePage.icon ? `文档图标：${activePage.icon}（点击修改）` : '添加文档图标'"
                  @click="openIconPicker(activePage.id, $event)">
            <template v-if="activePage.icon">{{ activePage.icon }}</template>
            <svg v-else class="w-10 h-10 opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="12" cy="12" r="10"></circle>
              <path d="M8 14s1.5 2 4 2 4-2 4-2"></path>
              <line x1="9" y1="9" x2="9.01" y2="9"></line>
              <line x1="15" y1="9" x2="15.01" y2="9"></line>
            </svg>
          </button>
        </div>

        <input ref="titleInputRef" type="text" v-model="activePage.title" 
               placeholder="无标题"
               @keydown="handleTitleKeyDown"
               class="w-full bg-transparent border-none outline-none font-['Rajdhani',sans-serif] text-5xl font-bold tracking-tight text-[#e5e7eb] placeholder-[#6b7280]/30 mb-10 pb-4 border-b border-[#1e2126]" />

        <div class="flex-1 relative pb-32" @click="handleEmptyClick">
          
          <!-- 任务行循环渲染 (含层级缩进与多媒体类型) -->
          <div v-for="(task, index) in visibleTasks" :key="task.id" 
               class="task-item-container group relative flex items-start py-2 pr-2 my-1 rounded-sm transition-all duration-150"
               :style="{ marginLeft: `${(task.indentLevel || 0) * 1.5}rem` }"
               :class="{ 
                 'opacity-50': task.completed && task.type === 'todo',
                 'hover:bg-[#1e2126]/40': draggedTaskId !== task.id,
                 'opacity-30 scale-[0.98] border border-dashed border-[#6b7280]/50': draggedTaskId === task.id,
                 'shadow-[inset_0_2px_0_0_#00f0ff] bg-[#1e2126]/30': dragOverTaskId === task.id && dropPosition === 'top',
                 'shadow-[inset_0_-2px_0_0_#00f0ff] bg-[#1e2126]/30': dragOverTaskId === task.id && dropPosition === 'bottom',
                 'ring-1 ring-[#00f0ff]/70 bg-[#00f0ff]/5': selectedTaskIds.has(task.id),
                 'bg-[#14161a]/70 rounded-md': task.type === 'callout'
               }"
               :draggable="draggableTaskId === task.id"
               @dragstart="handleDragStart($event, task)"
               @dragover.prevent="handleDragOver($event, task)"
               @dragleave="handleDragLeave($event, task)"
               @drop.prevent="handleDrop($event, task)"
               @dragend="handleDragEnd">
            
            <!-- 缩进引导线 (Guide Line) -->
            <div v-if="(task.indentLevel || 0) > 0" class="absolute -left-4 top-0 bottom-0 w-[2px] bg-[#1e2126] rounded-full group-hover:bg-[#00f0ff]/30 transition-colors"></div>

            <!-- 悬浮控制手柄（+号 / 拖拽）：置于正文左边缘之外的负空间，保证文本与标题对齐。
                 触屏设备无 hover，改为聚焦该块时常驻显示 -->
            <div class="absolute -left-[72px] top-1 flex items-center gap-1 transition-opacity z-30"
                 :class="focusedTaskId === task.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'"
                 draggable="false">
              <span class="inline-flex items-center justify-center w-7 h-7 cursor-pointer text-[#6b7280] hover:text-[#00f0ff] hover:bg-[#1e2126] rounded transition-colors"
                    draggable="false"
                    @mousedown.stop.prevent="onInsertMouseDown(task.id, $event)"
                    @touchstart.stop.prevent="insertTask(task.id, 'below')"
                    title="点击在下方插入（Alt+点击在上方插入）">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="pointer-events: none;">
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
              </span>
              <div class="cursor-grab active:cursor-grabbing text-[#6b7280] hover:text-[#e5e7eb] p-1 -m-1"
                   @mousedown="draggableTaskId = task.id"
                   @mouseup="draggableTaskId = null"
                   @mouseleave="draggableTaskId = null"
                   @click="(e) => openActionMenu(e, task.id)"
                   @touchstart.stop="openActionMenuAtTouch(task.id, $event)"
                   title="拖拽排序 / 点击操作菜单">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="9" cy="12" r="1"></circle><circle cx="9" cy="5" r="1"></circle><circle cx="9" cy="19" r="1"></circle>
                  <circle cx="15" cy="12" r="1"></circle><circle cx="15" cy="5" r="1"></circle><circle cx="15" cy="19" r="1"></circle>
                </svg>
              </div>
            </div>

            <!-- 基础区块类型前缀：同样左突出到负空间，宽度统一，各类型文本起点严格一致 -->
            <template v-if="EDITABLE_TYPES.includes(task.type)">
              <div v-if="task.type === 'todo'" class="absolute -left-6 top-1.5 w-5 h-5 flex items-center justify-center">
                <input type="checkbox" :checked="task.completed" @change="(e) => updateTask(task.id, { completed: (e.target as HTMLInputElement).checked })" 
                       class="peer appearance-none w-5 h-5 border-2 border-[#1e2126] bg-[#090a0c] checked:border-[#00f0ff] checked:bg-[#00f0ff]/20 cursor-pointer transition-all rounded-none outline-none" 
                       style="clip-path: polygon(3px 0, 100% 0, 100% calc(100% - 3px), calc(100% - 3px) 100%, 0 100%, 0 3px)" />
                <svg class="absolute w-3.5 h-3.5 text-[#00f0ff] pointer-events-none transition-opacity" :class="task.completed ? 'opacity-100' : 'opacity-0'" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                  <path stroke-linecap="square" stroke-linejoin="miter" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div v-else-if="task.type === 'bullet'" class="absolute -left-6 top-[0.6rem] w-5 flex items-center justify-center">
                <div class="w-1.5 h-1.5 rounded-full bg-[#00f0ff]/80 shadow-[0_0_10px_rgba(0,240,255,0.4)]"></div>
              </div>
              <div v-else-if="task.type === 'numbered'" class="absolute -left-6 top-1.5 w-5 flex items-center justify-end">
                <span class="font-['JetBrains_Mono',monospace] text-[13px] text-[#00f0ff]/80 select-none">{{ getNumberedIndex(task) }}.</span>
              </div>
              <button v-else-if="isCollapsible(task)"
                      @click="toggleCollapse(task)"
                      class="absolute -left-6 top-1 w-5 h-5 flex items-center justify-center text-[#6b7280] hover:text-[#00f0ff] hover:bg-[#1e2126] rounded transition-colors"
                      :class="task.payload?.collapsed ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'"
                      :title="task.payload?.collapsed ? '展开' : '折叠'">
                <svg class="w-3.5 h-3.5 transition-transform duration-150" :class="{ 'rotate-90': !task.payload?.collapsed }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="9 18 15 12 9 6"></polyline></svg>
              </button>
              <div v-else-if="task.type === 'callout'" class="absolute -left-6 top-1.5 w-5 flex items-start justify-center select-none text-[15px] leading-5">
                {{ task.payload?.icon || '💡' }}
              </div>
              <div v-if="task.type === 'quote'" class="absolute -left-4 top-1 bottom-1 w-0.5 bg-[#ffb000] rounded-full shadow-[0_0_8px_rgba(255,176,0,0.4)]"></div>

              <!-- ContentEditable 富文本 -->
              <div class="flex-1 relative">
                <div :ref="(el) => setInputRef(el, task.id)" 
                     contenteditable="true" 
                     @input="(e) => handleInput(e, task)"
                     @keydown="(e) => handleKeyDown(e, task, index)"
                     @paste="(e) => handlePaste(e, task, index)"
                     @compositionstart="onCompositionStart"
                     @compositionend="(e) => onCompositionEnd(e, task)"
                     @focus="onBlockFocus(task.id)"
                     @blur="onBlockBlur"
                     :data-task-id="task.id"
                     :data-placeholder="getPlaceholder(task.type)"
                     class="ce-block w-full bg-transparent border-none outline-none leading-relaxed py-0.5 font-sans min-h-[24px] cursor-text"
                     :class="[getTextClass(task), { 'show-placeholder': focusedTaskId === task.id }]">
                </div>
              </div>
            </template>

            <!-- 提及菜单：[[ 唤出页面链接（对齐 Notion 的双向链接入口） -->
            <div v-if="mentionTaskId === task.id"
                 class="absolute left-0 w-64 bg-[#090a0c] border border-[#1e2126] shadow-2xl rounded-sm z-50 flex flex-col overflow-hidden"
                 :class="slashMenuPosition === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'">
              <div class="px-3 py-2 text-xs text-[#6b7280] uppercase tracking-wider font-['Rajdhani',sans-serif] bg-[#090a0c] z-10 border-b border-[#1e2126]/50 shadow-sm shrink-0">
                {{ filteredMentionPages.length > 0 ? '链接到页面' : '无匹配页面' }}
              </div>
              <div class="overflow-y-auto max-h-[220px] py-1 custom-scrollbar">
                <div v-for="(page, idx) in filteredMentionPages" :key="page.id"
                     @mousedown.prevent="insertPageLink(task.id, page.id)"
                     class="flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors"
                     :class="idx === mentionIndex ? 'bg-[#1e2126]/80' : 'hover:bg-[#1e2126]/40'">
                  <span v-if="page.icon" class="text-[15px] leading-none shrink-0">{{ page.icon }}</span>
                  <svg v-else class="w-4 h-4 shrink-0 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                  <span class="text-sm truncate" :class="idx === mentionIndex ? 'text-[#00f0ff]' : 'text-[#e5e7eb]'">{{ page.title || '无标题' }}</span>
                </div>
                <div v-if="filteredMentionPages.length === 0"
                     @mousedown.prevent="insertPageLink(task.id, null)"
                     class="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[#1e2126]/40">
                  <span class="text-sm text-[#6b7280]">+ 新建页面「{{ mentionQuery }}」并链接</span>
                </div>
              </div>
            </div>

            <!-- 多媒体区块：图片上传器 (Image Block) -->
            <div v-else-if="task.type === 'image'" class="flex-1 mt-1 relative group/img"
                 tabindex="0"
                 @mousedown="selectedMediaId = task.id"
                 @touchstart.stop="selectedMediaId = task.id"
                 @keydown.enter.prevent="insertTask(task.id, 'below')"
                 @keydown.backspace.prevent="deleteBlockAndFocus(task)"
                 @keydown.delete.prevent="deleteBlockAndFocus(task)">
              <img v-if="task.payload?.url" :src="task.payload.url"
                   class="max-w-full rounded-md border border-[#1e2126] shadow-sm object-contain max-h-[500px] block" />
              <!-- 图片操作浮层：替换 / 删除。
                   desktop 靠 hover，触屏无 hover 故点击后（selectedMediaId）常驻显示 -->
              <div v-if="task.payload?.url"
                   class="absolute top-2 right-2 flex items-center gap-1 transition-opacity z-10"
                   :class="selectedMediaId === task.id ? 'opacity-100' : 'opacity-0 group-hover/img:opacity-100'">
                <button @mousedown.stop.prevent="triggerImageUpload(task.id)"
                        @touchstart.stop.prevent="triggerImageUpload(task.id)"
                        title="替换图片"
                        class="w-7 h-7 flex items-center justify-center bg-[#090a0c]/90 border border-[#1e2126] text-[#6b7280] hover:text-[#00f0ff] hover:border-[#00f0ff] rounded-sm transition-colors backdrop-blur-sm">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 1-9 9c-9 9-9 0 0-9 9-9 9 0 0-9z"></path><path d="M21 3v6h-6"></path><path d="M3 21v-6h6"></path></svg>
                </button>
                <button @mousedown.stop.prevent="deleteBlockAndFocus(task)"
                        @touchstart.stop.prevent="deleteBlockAndFocus(task)"
                        title="删除图片"
                        class="w-7 h-7 flex items-center justify-center bg-[#090a0c]/90 border border-[#1e2126] text-[#6b7280] hover:text-[#ff2a2a] hover:border-[#ff2a2a] rounded-sm transition-colors backdrop-blur-sm">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
              </div>
              <div v-else class="w-full h-32 border-2 border-dashed border-[#1e2126] bg-[#14161a] hover:bg-[#1e2126]/50 flex flex-col items-center justify-center rounded-md cursor-pointer hover:border-[#00f0ff] transition-all" @click="triggerImageUpload(task.id)">
                  <svg class="w-8 h-8 text-[#6b7280] mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                  <span class="text-sm font-['JetBrains_Mono',monospace] text-[#6b7280]">点击选择图片，或拖拽文件至屏幕任意位置</span>
              </div>
              <!-- 上传输入框常驻：既服务初始上传，也服务「替换图片」 -->
              <input type="file" :id="'img-upload-'+task.id" class="hidden" @change="(e) => handleImageUpload(e, task.id)" accept="image/*">
            </div>

            <!-- 多行代码容器 (Code Block) -->
            <div v-else-if="task.type === 'codeblock'" class="flex-1 mt-1 bg-[#090a0c] border border-[#1e2126] rounded-md overflow-hidden font-['JetBrains_Mono',monospace] shadow-inner relative group/code">
              <div class="flex items-center justify-between px-4 py-2 bg-[#14161a] border-b border-[#1e2126]">
                  <div class="flex items-center gap-2">
                    <span class="w-2.5 h-2.5 rounded-full bg-[#ff2a2a]/80"></span>
                    <span class="w-2.5 h-2.5 rounded-full bg-[#ffb000]/80"></span>
                    <span class="w-2.5 h-2.5 rounded-full bg-[#00f0ff]/80"></span>
                  </div>
                  <select v-model="task.payload.language" class="bg-transparent text-xs font-bold text-[#6b7280] hover:text-[#00f0ff] outline-none cursor-pointer uppercase tracking-wider">
                    <option value="javascript">JavaScript</option>
                    <option value="python">Python</option>
                    <option value="vue">Vue / HTML</option>
                    <option value="rust">Rust</option>
                  </select>
              </div>
              <textarea v-model="task.payload.code" @keydown.tab.prevent="insertTabInCode($event, task)" class="w-full bg-transparent text-[#00f0ff] p-4 text-sm outline-none resize-y min-h-[120px] custom-scrollbar leading-relaxed" placeholder="// TYPE YOUR DIRECTIVES HERE..."></textarea>
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
                               <button @click="deleteKanbanCard(task, col, Number(cIdx))" class="absolute top-1 right-1 p-1 opacity-0 group-hover/card:opacity-100 text-[#6b7280] hover:text-[#ff2a2a] transition-all"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
                           </div>
                           <input type="text" placeholder="+ 新建数据片" class="bg-transparent border border-dashed border-[#1e2126] hover:border-[#00f0ff]/50 focus:border-[#00f0ff] focus:bg-[#1e2126]/30 rounded-sm px-3 py-1.5 text-sm outline-none text-[#e5e7eb] transition-all mt-1 font-['JetBrains_Mono',monospace]" @keydown.enter="(e) => addKanbanCard(e, task, col)">
                       </div>
                   </div>
               </div>
            </div>

            <!-- 分割线 (Divider) -->
            <div v-else-if="task.type === 'divider'" class="flex-1 py-3">
              <div class="w-full h-px bg-[#1e2126]"></div>
            </div>

            <!-- 统一 Slash 命令弹出菜单 -->
            <div v-if="activeSlashTaskId === task.id" 
                 class="absolute left-0 w-64 bg-[#090a0c] border border-[#1e2126] shadow-2xl rounded-sm z-50 flex flex-col overflow-hidden"
                 :class="slashMenuPosition === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'">
              <div class="px-3 py-2 text-xs text-[#6b7280] uppercase tracking-wider font-['Rajdhani',sans-serif] bg-[#090a0c] z-10 border-b border-[#1e2126]/50 shadow-sm shrink-0">{{ filteredSlashOptions.length > 0 ? '基础区块 & 多媒体容器' : '无匹配命令' }}</div>
              <div class="overflow-y-auto max-h-[260px] py-1 custom-scrollbar">
                <div v-for="(option, idx) in filteredSlashOptions" :key="option.id"
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

          <!-- 反向链接（Backlinks）：自动聚合引用本页的页面 -->
          <div v-if="backlinks.length > 0" class="mt-12 pt-4 border-t border-[#1e2126]">
            <div class="text-[11px] font-['JetBrains_Mono',monospace] text-[#6b7280] uppercase tracking-wider font-bold mb-2">
              反向链接 · {{ backlinks.length }}
            </div>
            <div class="space-y-1">
              <div v-for="bl in backlinks" :key="bl.page.id"
                   class="flex items-start gap-2 text-sm text-[#6b7280] hover:text-[#00f0ff] cursor-pointer transition-colors px-2 py-1 rounded-sm hover:bg-[#1e2126]/40"
                   @click="activePageId = bl.page.id">
                <span v-if="bl.page.icon" class="text-[15px] leading-none mt-0.5 shrink-0">{{ bl.page.icon }}</span>
                <svg v-else class="w-4 h-4 mt-0.5 shrink-0 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                <div class="min-w-0">
                  <div class="truncate">{{ bl.page.title || '无标题' }}</div>
                  <div class="text-xs text-[#6b7280]/70 truncate">{{ bl.excerpt }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>

    <!-- 悬浮防遮挡菜单 & 全局操作菜单 (与之前一致，保持精简引用) -->
    <!-- ... -->
    <!-- 选中文本后的浮动格式工具栏（对齐 Notion 的 selection toolbar） -->
    <div v-if="formatToolbar.visible"
         class="format-toolbar fixed z-50 flex items-center gap-0.5 px-1 py-1 bg-[#090a0c] border border-[#1e2126] shadow-2xl rounded-sm"
         :style="{ top: `${formatToolbar.y}px`, left: `${formatToolbar.x}px` }">
      <button @mousedown.prevent="execFormat('bold')" title="加粗 (Ctrl/Cmd+B)" class="ft-btn font-bold">B</button>
      <button @mousedown.prevent="execFormat('italic')" title="斜体 (Ctrl/Cmd+I)" class="ft-btn italic">I</button>
      <button @mousedown.prevent="execFormat('underline')" title="下划线 (Ctrl/Cmd+U)" class="ft-btn underline">U</button>
      <button @mousedown.prevent="execFormat('strikeThrough')" title="删除线 (Ctrl/Cmd+Shift+S)" class="ft-btn line-through">S</button>
      <div class="w-px h-4 bg-[#1e2126] mx-0.5"></div>
      <button @mousedown.prevent="execFormat('code')" title="行内代码 (Ctrl/Cmd+E)" class="ft-btn font-['JetBrains_Mono',monospace] text-xs">&lt;/&gt;</button>
      <button @mousedown.prevent="execFormat('link')" title="链接 (Ctrl/Cmd+K)" class="ft-btn">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
      </button>
      <div class="w-px h-4 bg-[#1e2126] mx-0.5"></div>
      <button @mousedown.prevent="colorPanel = colorPanel === 'text' ? null : 'text'" title="文本颜色" class="ft-btn font-bold">A</button>
      <button @mousedown.prevent="colorPanel = colorPanel === 'bg' ? null : 'bg'" title="背景高亮" class="ft-btn relative">
        <span class="px-1 bg-[#ffb000]/30 text-[#ffb000] rounded-sm">H</span>
      </button>
      <!-- 颜色面板 -->
      <div v-if="colorPanel" class="absolute top-full mt-1 left-0 flex gap-1 px-2 py-1.5 bg-[#090a0c] border border-[#1e2126] shadow-2xl rounded-sm">
        <button v-for="c in colorPalette" :key="c.value"
                @mousedown.prevent="applyColor(c.value)"
                class="w-5 h-5 rounded-sm border border-[#1e2126] hover:scale-110 transition-transform"
                :style="{ background: c.value }" :title="c.label"></button>
        <button @mousedown.prevent="applyColor('transparent')" class="w-5 h-5 rounded-sm border border-[#6b7280] text-[10px] text-[#6b7280] flex items-center justify-center" title="清除">/</button>
      </div>
    </div>

    <!-- 链接输入弹窗（替代原生 prompt：原生弹窗会抢焦点导致选区丢失，且观感突兀） -->
    <div v-if="linkDialog.visible" class="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm" @click.self="closeLinkDialog">
      <div class="w-[420px] bg-[#090a0c] border border-[#1e2126] shadow-2xl rounded-md overflow-hidden">
        <div class="px-4 py-3 border-b border-[#1e2126]/60 flex items-center gap-2">
          <svg class="w-4 h-4 text-[#00f0ff]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
          <span class="text-sm font-bold tracking-wide text-[#e5e7eb]">添加链接</span>
        </div>
        <div class="p-4 space-y-3">
          <div>
            <label class="block text-xs text-[#6b7280] mb-1.5 uppercase tracking-wider">地址</label>
            <input ref="linkInputRef" v-model="linkDialog.url" type="text"
                   placeholder="https://"
                   @keydown.enter.prevent="confirmLink"
                   @keydown.esc.prevent="closeLinkDialog"
                   class="w-full bg-[#090a0c] border border-[#1e2126] focus:border-[#00f0ff] outline-none px-3 py-2 text-sm text-[#e5e7eb] rounded-sm transition-colors" />
          </div>
          <div v-if="linkDialog.selectedText" class="text-xs text-[#6b7280] truncate">
            将链接应用到：<span class="text-[#00f0ff]">{{ linkDialog.selectedText }}</span>
          </div>
        </div>
        <div class="px-4 py-3 border-t border-[#1e2126]/60 flex justify-end gap-2">
          <button @click="closeLinkDialog" class="px-3 py-1.5 text-sm text-[#6b7280] hover:text-[#e5e7eb] transition-colors">取消</button>
          <button @click="confirmLink" class="px-4 py-1.5 text-sm font-bold text-[#090a0c] bg-[#00f0ff] hover:bg-[#00d4e0] rounded-sm transition-colors">确认</button>
        </div>
      </div>
    </div>

    <div v-if="actionMenuConfig.isOpen" class="action-menu-popup fixed z-50 w-52 bg-[#090a0c] border border-[#1e2126] shadow-2xl py-1 rounded-sm text-sm max-h-[70vh] overflow-y-auto custom-scrollbar" :style="{ top: `${actionMenuConfig.y}px`, left: `${actionMenuConfig.x}px` }" @click.stop>
      <div class="px-3 py-1 text-xs text-[#6b7280] uppercase tracking-wider font-['Rajdhani',sans-serif] mb-1 border-b border-[#1e2126]/50">转换区块为</div>
      <button class="w-full text-left px-4 py-1.5 hover:bg-[#1e2126]/50 transition-colors flex items-center gap-2" @click="handleActionCommand('text')"><span class="font-['JetBrains_Mono',monospace] text-[#6b7280]">T</span> 文本</button>
      <button class="w-full text-left px-4 py-1.5 hover:bg-[#1e2126]/50 transition-colors text-[#00f0ff]/80 font-bold font-['Rajdhani',sans-serif] flex items-center gap-2" @click="handleActionCommand('h1')"><span class="font-['JetBrains_Mono',monospace] text-[#00f0ff]/40 font-normal">H1</span> 标题 1</button>
      <button class="w-full text-left px-4 py-1.5 hover:bg-[#1e2126]/50 transition-colors font-bold font-['Rajdhani',sans-serif] flex items-center gap-2" @click="handleActionCommand('h2')"><span class="font-['JetBrains_Mono',monospace] text-[#6b7280] font-normal">H2</span> 标题 2</button>
      <button class="w-full text-left px-4 py-1.5 hover:bg-[#1e2126]/50 transition-colors font-bold font-['Rajdhani',sans-serif] flex items-center gap-2" @click="handleActionCommand('h3')"><span class="font-['JetBrains_Mono',monospace] text-[#6b7280] font-normal">H3</span> 标题 3</button>
      <button class="w-full text-left px-4 py-1.5 hover:bg-[#1e2126]/50 transition-colors flex items-center gap-2" @click="handleActionCommand('todo')"><span class="font-['JetBrains_Mono',monospace] text-[#6b7280]">[]</span> 待办事项</button>
      <button class="w-full text-left px-4 py-1.5 hover:bg-[#1e2126]/50 transition-colors flex items-center gap-2" @click="handleActionCommand('bullet')"><span class="font-['JetBrains_Mono',monospace] text-[#6b7280]">•</span> 无序列表</button>
      <button class="w-full text-left px-4 py-1.5 hover:bg-[#1e2126]/50 transition-colors flex items-center gap-2" @click="handleActionCommand('numbered')"><span class="font-['JetBrains_Mono',monospace] text-[#6b7280]">1.</span> 编号列表</button>
      <button class="w-full text-left px-4 py-1.5 hover:bg-[#1e2126]/50 transition-colors flex items-center gap-2" @click="handleActionCommand('toggle')"><span class="font-['JetBrains_Mono',monospace] text-[#6b7280]">▸</span> 折叠列表</button>
      <button class="w-full text-left px-4 py-1.5 hover:bg-[#1e2126]/50 transition-colors flex items-center gap-2" @click="handleActionCommand('quote')"><span class="font-['JetBrains_Mono',monospace] text-[#6b7280]">&quot;</span> 引用块</button>
      <button class="w-full text-left px-4 py-1.5 hover:bg-[#1e2126]/50 transition-colors flex items-center gap-2" @click="handleActionCommand('callout')"><span class="font-['JetBrains_Mono',monospace] text-[#6b7280]">💡</span> 标注块</button>
      <button class="w-full text-left px-4 py-1.5 hover:bg-[#1e2126]/50 transition-colors flex items-center gap-2" @click="handleActionCommand('divider')"><span class="font-['JetBrains_Mono',monospace] text-[#6b7280]">—</span> 分割线</button>
      <div class="border-t border-[#1e2126]/50 my-1"></div>
      <button v-if="isCollapsible(actionMenuTask!)" class="w-full text-left px-4 py-1.5 hover:bg-[#1e2126]/50 transition-colors flex items-center gap-2" @click="toggleCollapse(actionMenuTask!); actionMenuConfig.isOpen = false">
        <span class="font-['JetBrains_Mono',monospace] text-[#6b7280]">▸</span> {{ actionMenuTask?.payload?.collapsed ? '展开' : '折叠' }}
      </button>
      <button class="w-full text-left px-4 py-1.5 hover:bg-[#1e2126]/50 transition-colors flex items-center gap-2" @click="moveBlock(realIndexOf({ id: actionMenuConfig.taskId } as Task), -1)"><span class="font-['JetBrains_Mono',monospace] text-[#6b7280]">↑</span> 上移</button>
      <button class="w-full text-left px-4 py-1.5 hover:bg-[#1e2126]/50 transition-colors flex items-center gap-2" @click="moveBlock(realIndexOf({ id: actionMenuConfig.taskId } as Task), 1)"><span class="font-['JetBrains_Mono',monospace] text-[#6b7280]">↓</span> 下移</button>
      <div class="border-t border-[#1e2126]/50 my-1"></div>
      <button class="w-full text-left px-4 py-1.5 hover:bg-[#1e2126]/50 transition-colors" @click="duplicateTask(actionMenuConfig.taskId)">复制</button>
      <button class="w-full text-left px-4 py-1.5 hover:bg-[#ff2a2a]/10 transition-colors text-[#ff2a2a]" @click="deleteBlockAndFocus(actionMenuTask!); actionMenuConfig.isOpen = false">删除</button>
    </div>

    <!-- 文档图标选择器（侧边栏与标题区共用） -->
    <PageIconPicker v-if="iconPicker"
                    :current="pages.find(p => p.id === iconPicker!.pageId)?.icon"
                    :anchor-el="iconPicker!.anchorEl"
                    @select="setPageIcon"
                    @remove="removePageIcon"
                    @close="closeIconPicker" />

  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, watch, computed } from 'vue';
import { initSync, closeSync, createRemotePage, deleteRemotePage, syncStatus, onlineDevices, retrySync } from '../composables/useSync';
import { newBlockId, newPageId } from '../composables/ids';
import { writePrevIds } from '../composables/useSync';
import PageIconPicker from './PageIconPicker.vue';

// === 数据结构 ===
interface Task {
  id: string;
  type: string;
  content: string;
  completed: boolean;
  indentLevel?: number;
  payload?: any;
  prevId?: string | null;
}
interface Page { id: string; title: string; tasks: Task[]; parentId: string | null; isFavorite: boolean; isExpanded: boolean; icon?: string; }

// 可承载富文本光标的块类型（图片 / 代码块 / 看板 / 分割线不参与纯文本行级光标逻辑）
const EDITABLE_TYPES = ['text', 'h1', 'h2', 'h3', 'quote', 'todo', 'bullet', 'numbered', 'toggle', 'callout'];

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

// 标题层级：用于「可折叠标题」（Notion 的 toggle heading）
const HEADING_LEVEL: Record<string, number> = { h1: 1, h2: 2, h3: 3 };
const isCollapsible = (task: Task) => task.type === 'toggle' || !!HEADING_LEVEL[task.type];

// === 折叠引擎 ===
// toggle：隐藏其后所有层级更深的块，直到遇到同级或更浅的块
// 标题：忽略缩进，隐藏其后所有内容，直到遇到同级或更高级的标题
const hiddenTaskIds = computed(() => {
  const hidden = new Set<string>();
  const list = activePage.value?.tasks ?? [];
  let active: { ignoreLevel: boolean; level: number; isEnd: (t: Task) => boolean } | null = null;
  for (const t of list) {
    const level = t.indentLevel || 0;
    if (active) {
      const within = active.ignoreLevel || level > active.level;
      if (within && !active.isEnd(t)) { hidden.add(t.id); continue; }
      active = null;
    }
    if (!t.payload?.collapsed) continue;
    if (t.type === 'toggle') {
      active = { ignoreLevel: false, level, isEnd: () => false };
    } else if (HEADING_LEVEL[t.type]) {
      const lv: number = HEADING_LEVEL[t.type];
      active = { ignoreLevel: true, level, isEnd: (x: Task): boolean => { const hl = HEADING_LEVEL[x.type]; return !!hl && hl <= lv; } };
    }
  }
  return hidden;
});
const visibleTasks = computed(() => (activePage.value?.tasks ?? []).filter((t: Task) => !hiddenTaskIds.value.has(t.id)));
// 渲染索引 ≠ 数据索引（折叠会跳过块），键盘逻辑必须使用数据索引
const realIndexMap = computed(() => {
  const map = new Map<string, number>();
  (activePage.value?.tasks ?? []).forEach((t: Task, i: number) => map.set(t.id, i));
  return map;
});
const realIndexOf = (task: Task) => realIndexMap.value.get(task.id) ?? 0;

// 编号列表序号：只累计「同级且相邻」的 numbered 块，遇到其它类型或更浅层级则重置
const getNumberedIndex = (task: Task) => {
  const list = activePage.value?.tasks ?? [];
  const idx = list.findIndex((t: Task) => t.id === task.id);
  const level = task.indentLevel || 0;
  let n = 1;
  for (let i = idx - 1; i >= 0; i--) {
    const prev = list[i];
    const prevLevel = prev.indentLevel || 0;
    if (prevLevel < level) break;
    if (prevLevel === level) {
      if (prev.type === 'numbered') n++;
      else break;
    }
  }
  return n;
};
const toggleCollapse = (task: Task) => {
  if (!task.payload) task.payload = {};
  task.payload.collapsed = !task.payload.collapsed;
};

// === 页面链接 [[ 与反向链接（对齐 Notion 的双向链接） ===
const PAGE_LINK_RE = /<a[^>]+data-page-id="([^"]+)"[^>]*>/g;
const getLinkedPageIds = (page: Page): string[] => {
  const ids = new Set<string>();
  for (const t of page.tasks) {
    if (!t.content) continue;
    let m: RegExpExecArray | null;
    PAGE_LINK_RE.lastIndex = 0;
    while ((m = PAGE_LINK_RE.exec(t.content))) ids.add(m[1]);
  }
  return [...ids];
};
// 引用了当前页面的其它页面（含引用处的上下文摘要）
const backlinks = computed(() => {
  const current = activePage.value;
  if (!current) return [];
  const result: Array<{ page: Page; excerpt: string }> = [];
  for (const p of pages.value) {
    if (p.id === current.id) continue;
    const linked = getLinkedPageIds(p).includes(current.id);
    if (!linked) continue;
    const hit = p.tasks.find((t: Task) => t.content?.includes(`data-page-id="${current.id}"`));
    const plain = (hit?.content ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    result.push({ page: p, excerpt: plain.slice(0, 80) || '（链接）' });
  }
  return result;
});

const mentionTaskId = ref<string | null>(null);
const mentionIndex = ref(0);
const mentionQuery = ref('');
const filteredMentionPages = computed(() => {
  const q = mentionQuery.value.trim().toLowerCase();
  const pool = pages.value.filter(p => p.id !== activePageId.value);
  if (!q) return pool.slice(0, 8);
  return pool.filter(p => (p.title || '无标题').toLowerCase().includes(q)).slice(0, 8);
});
const closeMention = () => { mentionTaskId.value = null; mentionQuery.value = ''; mentionIndex.value = 0; };
const insertPageLink = (taskId: string, pageId: string | null) => {
  if (!activePage.value) return;
  let targetId = pageId;
  if (!targetId) {
    // 无匹配时新建同名页面并链接（对齐 Notion 的 "+ Add new page"）
    const newPage: Page = { id: newPageId(), title: mentionQuery.value.trim() || '无标题', tasks: [], parentId: null, isFavorite: false, isExpanded: true };
    pages.value.push(newPage);
    createRemotePage(newPage as any);
    targetId = newPage.id;
  }
  const target = pages.value.find(p => p.id === targetId);
  const task = activePage.value.tasks.find((t: Task) => t.id === taskId);
  if (!task) { closeMention(); return; }
  // 去掉行内尚未闭合的 [[ 前缀
  const cleaned = task.content.replace(/\[\[([^\[\]]*)?$/, '');
  const linkHtml = `<a data-page-id="${targetId}" href="#${targetId}">${target?.title || '无标题'}</a>`;
  updateTask(taskId, { content: cleaned + linkHtml });
  closeMention();
  setFocusConfig(taskId, 'end');
};

// === 导出 Markdown ===
const htmlToMarkdown = (html: string): string => {
  let s = html;
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(strong|b)>/gi, '**').replace(/<(strong|b)>/gi, '**');
  s = s.replace(/<\/(em|i)>/gi, '*').replace(/<(em|i)>/gi, '*');
  s = s.replace(/<\/(del|strike)>/gi, '~~').replace(/<(del|strike)>/gi, '~~');
  s = s.replace(/<code>/gi, '`').replace(/<\/code>/gi, '`');
  s = s.replace(/<a[^>]*data-page-id="[^"]*"[^>]*>([^<]*)<\/a>/gi, '[[$1]]');
  s = s.replace(/<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi, '[$2]($1)');
  s = s.replace(/<[^>]+>/g, '');
  return s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
};
const escapeMdText = (s: string) => s.replace(/[\\`*_[\]]/g, c => `\\${c}`);
const exportMarkdown = () => {
  const page = activePage.value;
  if (!page) return;
  const pageMd = (p: Page, depth: number): string => {
    const lines: string[] = [`${'#'.repeat(Math.min(depth + 1, 6))} ${p.title || '无标题'}`, ''];
    for (const t of p.tasks) {
      const text = htmlToMarkdown(t.content || '');
      const indent = '  '.repeat(t.indentLevel || 0);
      switch (t.type) {
        case 'h1': lines.push(`${indent}# ${text}`, ''); break;
        case 'h2': lines.push(`${indent}## ${text}`, ''); break;
        case 'h3': lines.push(`${indent}### ${text}`, ''); break;
        case 'bullet': lines.push(`${indent}- ${text}`); break;
        case 'numbered': lines.push(`${indent}1. ${text}`); break;
        case 'todo': lines.push(`${indent}- [${t.completed ? 'x' : ' '}] ${text}`); break;
        case 'quote': lines.push(`${indent}> ${text}`, ''); break;
        case 'callout': lines.push(`${indent}> ${t.payload?.icon || '💡'} ${text}`, ''); break;
        case 'toggle': lines.push(`${indent}<details><summary>${text}</summary>`, '', `${indent}</details>`, ''); break;
        case 'divider': lines.push('', '---', ''); break;
        case 'codeblock': lines.push('```' + (t.payload?.language || ''), t.payload?.code || '', '```', ''); break;
        case 'image': lines.push(t.payload?.url ? `![](${String(t.payload.url).slice(0, 60)}…)` : '<!-- 未上传图片 -->', ''); break;
        case 'kanban': {
          lines.push('<!-- 看板 -->');
          for (const col of t.payload?.columns ?? []) {
            lines.push(`**${col.title}**`);
            for (const c of col.cards) lines.push(`- ${escapeMdText(c.text)}`);
          }
          lines.push('');
          break;
        }
        default: lines.push(`${indent}${text}`, '');
      }
    }
    return lines.join('\n');
  };
  // 连同子页面一起导出（Notion 导出时每个子页面一个文件，这里合并为一个 md）
  const collect = (parentId: string | null, depth: number): string[] => {
    const out: string[] = [];
    for (const child of pages.value.filter(p => p.parentId === parentId)) {
      out.push(pageMd(child, depth));
      out.push(...collect(child.id, depth + 1));
    }
    return out;
  };
  const body = [pageMd(page, 0), ...collect(page.id, 1)].join('\n\n---\n\n');
  const blob = new Blob([body], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(page.title || 'untitled').replace(/[\\/:*?"<>|]/g, '_')}.md`;
  a.click();
  URL.revokeObjectURL(url);
};

// === 块选择态（对齐 Notion：Esc 选中当前块，↑↓ 扩展，Enter 回到编辑） ===
const selectedTaskIds = ref<Set<string>>(new Set());
const blockSelectMode = ref(false);
const clearBlockSelection = () => { selectedTaskIds.value = new Set(); blockSelectMode.value = false; };
const selectSingleBlock = (id: string) => { selectedTaskIds.value = new Set([id]); blockSelectMode.value = true; };
const isBlockSelected = (id: string) => selectedTaskIds.value.has(id);
// 以最后一个被加入选区的块为锚点，向上/向下扩展整块选择
const extendBlockSelection = (dir: -1 | 1) => {
  const list = visibleTasks.value;
  if (list.length === 0) return;
  const ids = [...selectedTaskIds.value];
  const anchorIdx = list.findIndex((t: Task) => t.id === ids[ids.length - 1]);
  if (anchorIdx === -1) { selectSingleBlock(list[0].id); return; }
  const nextIdx = anchorIdx + dir;
  if (nextIdx < 0 || nextIdx >= list.length) return;
  const nextId = list[nextIdx].id;
  const next = new Set(selectedTaskIds.value);
  // 反向移动时收缩选区，正向移动时扩展（Notion 行为）
  if (dir < 0 && ids.length > 1 && isBlockSelected(list[nextIdx + 1]?.id ?? '')) next.delete(ids[ids.length - 1]);
  else next.add(nextId);
  selectedTaskIds.value = next;
  blockSelectMode.value = true;
};
const deleteSelectedBlocks = () => {
  if (!activePage.value || selectedTaskIds.value.size === 0) return;
  const list = activePage.value.tasks;
  // 记录第一个被删块的位置，删除后把光标交还给相邻的可编辑块
  // （否则图片/看板这类非文本块删掉后光标悬空，用户无处继续打字）
  const firstDeletedIdx = list.findIndex((t: Task) => selectedTaskIds.value.has(t.id));
  const before = firstDeletedIdx > 0 ? list[firstDeletedIdx - 1] : null;
  const after = firstDeletedIdx >= 0 ? list.slice(firstDeletedIdx + 1).find((t: Task) => !selectedTaskIds.value.has(t.id)) : null;

  list.splice(0, list.length, ...list.filter((t: Task) => !selectedTaskIds.value.has(t.id)));
  clearBlockSelection();
  selectedMediaId.value = null;

  // 优先落在前一个块的末尾；没有可编辑的前块则落在后一个块的开头；都没有则新建
  const target = (before && EDITABLE_TYPES.includes(before.type)) ? { id: before.id, pos: 'end' as const }
    : (after && EDITABLE_TYPES.includes(after.type)) ? { id: after.id, pos: 'start' as const }
    : null;
  if (target) { setFocusConfig(target.id, target.pos); return; }

  const newId = newBlockId();
  list.push({ id: newId, type: 'text', content: '', completed: false, indentLevel: 0, prevId: null });
  setFocusConfig(newId, 'start');
};
const duplicateSelectedBlocks = () => {
  if (!activePage.value || selectedTaskIds.value.size === 0) return;
  const list = activePage.value.tasks;
  const picked = list.filter((t: Task) => selectedTaskIds.value.has(t.id));
  const lastIdx = list.findIndex((t: Task) => t.id === picked[picked.length - 1].id);
  const copies = picked.map((t: Task) => ({ ...t, id: newBlockId() }));
  list.splice(lastIdx + 1, 0, ...copies);
};

// === 同步状态交互 ===
// 后端离线时前端已停止自动重连（纯本地模式），这里提供手动重试入口
const onSyncIndicatorClick = () => {
  if (syncStatus.value === 'connecting') return; // 正在连接中不重复触发
  void retrySync();
};

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
    // 点击菜单自身时不关闭（菜单上有 @click.stop / @mousedown.prevent）
    if (target.closest('.action-menu-popup')) return;
    // 链接弹窗内的点击不触发任何关闭逻辑（否则恢复选区前选区就被清了）
    if (target.closest('.fixed.inset-0.z-\\[60\\]')) return;
    actionMenuConfig.value.isOpen = false;
    // 点击工具栏自身时不关闭，否则按钮的 mousedown 还没执行选区就被清掉了
    if (!target.closest('.format-toolbar')) hideFormatToolbar();
    if (!target.closest('.task-item-container')) clearBlockSelection();
    // 图标选择器自身处理外部点击，这里只兜底页面级关闭
    if (!target.closest('.icon-picker-popup')) closeIconPicker();
  };
  document.addEventListener('mousedown', handleGlobalClick);

  // Escape 键关闭浮窗
  const handleEscape = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    // 链接弹窗优先：它内部输入框已自行处理 Esc，这里兜底非输入焦点触发的情况
    if (linkDialog.value.visible) { closeLinkDialog(); return; }
    actionMenuConfig.value.isOpen = false;
  };
  document.addEventListener('keydown', handleEscape);

  // 撤销栈基线：初始矩阵入栈，保证第一次 Ctrl+Z 有可回退的状态
  commitHistory();

  // 任何数据变更都记入历史（防抖合并连续输入）；回退期间的变更不入栈
  watch(pages, () => { if (isRestoring) return; debouncedCommit(); }, { deep: true });

  // === 跨行鼠标选区支持（自建逻辑选区，不依赖浏览器跨宿主行为） ===
  // 原则：绝不主动 focus()（会清掉选区），只重建 Range；焦点交给浏览器随 mousedown 自然处理。
  document.addEventListener('mousedown', (e: MouseEvent) => {
    const ceBlock = (e.target as HTMLElement).closest('.ce-block') as HTMLElement | null;
    if (!ceBlock) return;
    const info = caretInfoFromPoint(e.clientX, e.clientY);
    if (!info) return;
    isDragSelecting = true;
    pointerDragged = false;
    selAnchor.value = info;
    selFocus.value = info;
    hideFormatToolbar();
  });

  document.addEventListener('mousemove', (e: MouseEvent) => {
    if (!isDragSelecting || !selAnchor.value) return;
    // 鼠标未按下（单纯划过）时不处理
    if (e.buttons === 0) { isDragSelecting = false; return; }
    const info = caretInfoFromPoint(e.clientX, e.clientY);
    if (!info) return;
    const prev = selFocus.value;
    if (prev && prev.blockId === info.blockId && prev.offset === info.offset) return;
    pointerDragged = true;
    selFocus.value = info;
    applyLogicalSelection(selAnchor.value, info);
  });

  document.addEventListener('mouseup', (e: MouseEvent) => {
    if (!isDragSelecting) return;
    isDragSelecting = false;

    const sel = window.getSelection();
    if (hasTextSelection()) {
      // 有选区：在选区上方弹出浮动格式工具栏（对齐 Notion 的 selection toolbar）
      const rect = sel!.getRangeAt(0).getBoundingClientRect();
      const above = rect.top > 48;
      formatToolbar.value = {
        visible: true,
        x: Math.max(8, Math.round(rect.left)),
        y: Math.round(above ? rect.top - 40 : rect.bottom + 8),
      };
      return;
    }
    hideFormatToolbar();

    // 无选区（单击定位光标）：用 caretRangeFromPoint 精确定位，避免点在块内空白处时光标丢失
    const ceBlock = (e.target as HTMLElement).closest('.ce-block') as HTMLElement | null;
    if (ceBlock && selAnchor.value?.blockId === ceBlock.dataset.taskId) {
      const info = caretInfoFromPoint(e.clientX, e.clientY);
      if (info) { selFocus.value = info; applyLogicalSelection(info, info); }
    }
    selAnchor.value = null; selFocus.value = null;
  });

  document.addEventListener('touchstart', (e: TouchEvent) => {
    // 单指触屏选区（移动端必备，且与鼠标路径共用同一套逻辑选区引擎）
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    const ceBlock = (t.target as HTMLElement).closest('.ce-block') as HTMLElement | null;
    if (!ceBlock) return;
    const info = caretInfoFromPoint(t.clientX, t.clientY);
    if (!info) return;
    isDragSelecting = true;
    pointerDragged = false;
    selAnchor.value = info;
    selFocus.value = info;
  }, { passive: true });

  document.addEventListener('touchmove', (e: TouchEvent) => {
    if (!isDragSelecting || e.touches.length !== 1) return;
    const t = e.touches[0];
    const info = caretInfoFromPoint(t.clientX, t.clientY);
    if (!info) return;
    const prev = selFocus.value;
    if (prev && prev.blockId === info.blockId && prev.offset === info.offset) return;
    pointerDragged = true;
    selFocus.value = info;
    applyLogicalSelection(selAnchor.value!, info);
    // 阻止页面滚动，否则长距离拖动选区时页面会跟着滚
    if (e.cancelable) e.preventDefault();
  }, { passive: false });

  document.addEventListener('touchend', (e: TouchEvent) => {
    if (!isDragSelecting) return;
    isDragSelecting = false;
    // 纯长按未拖动：把光标落到触点位置（移动端点选定位）
    if (!pointerDragged) {
      const t = e.changedTouches[0];
      const info = caretInfoFromPoint(t.clientX, t.clientY);
      if (info) { selFocus.value = info; applyLogicalSelection(info, info); }
    }
    selAnchor.value = null; selFocus.value = null;
  });
}); // end onMounted

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
  const newId = newPageId();
  pages.value.push({ id: newId, title: '', tasks: [{ id: newBlockId(), type: 'text', content: '', completed: false, indentLevel: 0 }], parentId, isFavorite: false, isExpanded: true });
  if (parentId) { const parent = pages.value.find(p => p.id === parentId); if (parent) parent.isExpanded = true; }
  activePageId.value = newId;
  // 同步到后端（失败不影响本地编辑）
  const created = pages.value.find(p => p.id === newId);
  if (created) createRemotePage(created as any);
  // Notion：新建页面后光标自动落在标题，方便直接命名
  focusTitle();
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
// 当前获得焦点的文本块（用于对齐 Notion：占位提示只在聚焦/悬停时出现）
const focusedTaskId = ref<string | null>(null);
const onBlockFocus = (id: string) => { focusedTaskId.value = id; setFocusConfig(id, null); };
const onBlockBlur = () => { activeSlashTaskId.value = null; focusedTaskId.value = null; };
// 选中文本后的浮动格式工具栏
const formatToolbar = ref({ visible: false, x: 0, y: 0 });
const hideFormatToolbar = () => { formatToolbar.value.visible = false; colorPanel.value = null; };
// 文本颜色 / 背景高亮（对齐 Notion 的 /color 与 /blue background）
const colorPanel = ref<'text' | 'bg' | null>(null);
const colorPalette = [
  { label: '青', value: '#00f0ff' }, { label: '琥珀', value: '#ffb000' }, { label: '红', value: '#ff2a2a' },
  { label: '绿', value: '#3ddc84' }, { label: '紫', value: '#a78bfa' }, { label: '灰', value: '#6b7280' },
];
const applyColor = (value: string) => {
  const isText = colorPanel.value === 'text';
  // execCommand 前必须先让 contenteditable 进入编辑态，且 styleWithCSS 打开才能写出 <span style>
  document.execCommand('styleWithCSS', false, 'true');
  document.execCommand(isText ? 'foreColor' : 'hiliteColor', false, value === 'transparent' ? 'transparent' : value);
  colorPanel.value = null;
  const sel = window.getSelection();
  const n = sel?.anchorNode;
  const el = ((n && n.nodeType === 3 ? n.parentElement : n as HTMLElement) ?? null)?.closest('.ce-block') as HTMLElement | null;
  if (el?.dataset.taskId) updateTask(el.dataset.taskId, { content: el.innerHTML });
};
// === 链接弹窗 ===
// 为什么不用 window.prompt：
// 1) 原生 prompt 会强制抢焦点，确认后选区已丢，createLink 找不到目标，链接创建失败或错位；
// 2) 在 WebView（Capacitor / Tauri）中 prompt 表现不一致，部分环境直接不弹；
// 3) 观感与整体工业风割裂。
// 关键实现点：打开时把 Range 克隆保存，确认时先恢复选区再 execCommand。
const linkInputRef = ref<HTMLInputElement | null>(null);
const linkDialog = ref({ visible: false, url: '', selectedText: '' });
let savedLinkRange: Range | null = null;

const openLinkDialog = () => {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  savedLinkRange = sel.getRangeAt(0).cloneRange();
  linkDialog.value = { visible: true, url: '', selectedText: sel.toString().slice(0, 40) };
  nextTick(() => linkInputRef.value?.focus());
};
const closeLinkDialog = () => { linkDialog.value.visible = false; savedLinkRange = null; hideFormatToolbar(); };
const confirmLink = () => {
  const url = linkDialog.value.url.trim();
  if (!url || !savedLinkRange) { closeLinkDialog(); return; }
  // 无协议时补 https://，避免生成相对链接
  const href = /^[a-z][a-z0-9+.-]*:\/\//i.test(url) || url.startsWith('/') || url.startsWith('#') ? url : `https://${url}`;

  // 恢复弹窗前保存的选区，否则 createLink 作用在错误的位置
  const sel = window.getSelection();
  if (sel) { sel.removeAllRanges(); sel.addRange(savedLinkRange); }
  document.execCommand('createLink', false, href);

  // 同步回数据模型
  const n = sel?.anchorNode;
  const blockEl = ((n && n.nodeType === 3 ? n.parentElement : n as HTMLElement) ?? null)?.closest('.ce-block') as HTMLElement | null;
  if (blockEl?.dataset.taskId) updateTask(blockEl.dataset.taskId, { content: blockEl.innerHTML });
  closeLinkDialog();
};

const execFormat = (cmd: string) => {
  const blockFromSelection = () => {
    const sel = window.getSelection();
    const n = sel?.anchorNode;
    const start: HTMLElement | null = n ? (n.nodeType === 3 ? n.parentElement : n as HTMLElement) : null;
    return (start?.closest('.ce-block') as HTMLElement | null) ?? null;
  };
  if (cmd === 'code') wrapInlineCode();
  else if (cmd === 'link') { openLinkDialog(); return; } // 交给弹窗处理
  else document.execCommand(cmd);
  const el = blockFromSelection();
  if (el?.dataset.taskId) updateTask(el.dataset.taskId, { content: el.innerHTML });
};

// 中文输入法（IME）组合态：组合期间一律不拦截按键，否则会吞掉候选词确认与换行
const isComposing = ref(false);
const onCompositionStart = () => { isComposing.value = true; };
const onCompositionEnd = (e: CompositionEvent, task: Task) => {
  isComposing.value = false;
  updateTask(task.id, { content: (e.currentTarget as HTMLElement).innerHTML });
};
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
  { id: 'text', label: '普通文本', icon: 'T', desc: '基础的文字段落', kw: 'text wenben duanluo 文本 段落' },
  { id: 'todo', label: '待办事项', icon: '[]', desc: '带有复选框的任务', kw: 'todo daiban 待办 任务 checkbox' },
  { id: 'h1', label: '一级标题', icon: 'H1', desc: '大尺寸科幻标题', kw: 'h1 heading biaoti 标题 一级' },
  { id: 'h2', label: '二级标题', icon: 'H2', desc: '中等尺寸副标题', kw: 'h2 heading biaoti 标题 二级' },
  { id: 'h3', label: '三级标题', icon: 'H3', desc: '小尺寸副标题', kw: 'h3 heading biaoti 标题 三级' },
  { id: 'bullet', label: '无序列表', icon: '•', desc: '基础的点状列表', kw: 'bullet list liebiao 列表 无序 项目符号' },
  { id: 'numbered', label: '编号列表', icon: '1.', desc: '自动编号的有序列表', kw: 'numbered num list liebiao 编号 有序 列表' },
  { id: 'toggle', label: '折叠列表', icon: '▸', desc: '可折叠展开的内容块', kw: 'toggle zhedie 折叠 展开' },
  { id: 'quote', label: '引用块', icon: '"', desc: '高亮引用的重要文字', kw: 'quote yinyong 引用' },
  { id: 'callout', label: '标注块', icon: '💡', desc: '带图标的高亮提示框', kw: 'callout biaozhu 标注 callout 提示' },
  { id: 'divider', label: '分割线', icon: '—', desc: '水平分割线', kw: 'divider hr fengexian 分割线' },
  { id: 'image', label: '图片媒体', icon: 'IMG', desc: '上传或拖拽图片解析', kw: 'image tupian 图片 媒体' },
  { id: 'codeblock', label: '代码片段', icon: '</>', desc: '多行语法高亮容器', kw: 'code daima 代码 片段' },
  { id: 'kanban', label: '看板数据库', icon: '|||', desc: '可视化状态追踪画板', kw: 'kanban kanban 看板 数据库' },
];
// 斜杠菜单支持关键字过滤（对齐 Notion：输入 /code 直接定位到代码片段）
const slashQuery = ref('');
const filteredSlashOptions = computed(() => {
  const q = slashQuery.value.trim().toLowerCase();
  if (!q) return slashOptions;
  return slashOptions.filter(o => o.label.toLowerCase().includes(q) || o.id.includes(q) || o.kw.includes(q));
});

// === 拖拽引擎实现 ===
const handleDragStart = (e: DragEvent, task: Task) => {
  // 只有从手柄按下才允许「块拖拽」。否则「拖动选中的文字」会冒泡触发 dragstart，
  // 被本处理器劫持成块拖拽并在 drop 时重排块（实测会打乱文档顺序）——这里直接取消。
  if (draggableTaskId.value !== task.id) { e.preventDefault(); return; }
  if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', task.id); }
  draggedTaskId.value = task.id; formatMenuConfig.value.isOpen = false;
};
const handleDragOver = (e: DragEvent, task: Task) => {
  if (!draggedTaskId.value || draggedTaskId.value === task.id) return;
  dragOverTaskId.value = task.id;
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  dropPosition.value = e.clientY < rect.top + rect.height / 2 ? 'top' : 'bottom';
};
const handleDragLeave = (_e: DragEvent, task: Task) => { if (dragOverTaskId.value === task.id) dragOverTaskId.value = null; };
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

// === 撤销 / 重做（快照式历史栈） ===
// 关键：必须自己接管 Cmd/Ctrl+Z。否则浏览器原生 undo 会直接回滚 contenteditable 的 DOM，
// 与 Vue 的响应式数据分叉，随后任何一次输入都会把错乱的 DOM 写回数据。
const undoStack = ref<string[]>([]);
const redoStack = ref<string[]>([]);
let isRestoring = false;
const MAX_HISTORY = 100;

function makeDebounce<T extends (...args: any[]) => void>(fn: T, wait: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const wrapped = (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(...args); }, wait);
  };
  return Object.assign(wrapped, { cancel: () => { if (timer) { clearTimeout(timer); timer = null; } } });
}
const snapshot = () => JSON.stringify({ pages: pages.value, activePageId: activePageId.value });

const commitHistory = () => {
  if (isRestoring) return;
  const snap = snapshot();
  if (undoStack.value[undoStack.value.length - 1] === snap) return;
  undoStack.value.push(snap);
  if (undoStack.value.length > MAX_HISTORY) undoStack.value.shift();
  redoStack.value = [];
};
// 连续打字合并为一条历史记录，避免每个字符一步
const debouncedCommit = makeDebounce(commitHistory, 800);

const restore = (snap: string) => {
  isRestoring = true;
  debouncedCommit.cancel(); // 撤销/重做本身绝不能产生新的历史记录
  try {
    const parsed = JSON.parse(snap);
    pages.value = parsed.pages;
    if (parsed.activePageId && pages.value.some((p: Page) => p.id === parsed.activePageId)) activePageId.value = parsed.activePageId;
  } catch { /* 快照损坏则放弃本次回退 */ }
  nextTick(() => { isRestoring = false; });
};
const undo = () => {
  if (undoStack.value.length === 0) return;
  const current = snapshot();
  redoStack.value.push(current);
  let target = undoStack.value.pop() as string;
  if (target === current && undoStack.value.length > 0) target = undoStack.value.pop() as string;
  restore(target);
};
const redo = () => {
  if (redoStack.value.length === 0) return;
  undoStack.value.push(snapshot());
  restore(redoStack.value.pop() as string);
};

// === 标题区 ⇄ 正文区 的光标流转（对齐 Notion） ===
const titleInputRef = ref<HTMLInputElement | null>(null);

// === 文档图标（Page Icon，对齐 Notion）===
// 一套状态同时服务侧边栏与标题区两个入口；icon 存在 Page 上，三端同步自动继承
const iconPicker = ref<{ pageId: string; anchorEl: HTMLElement | null } | null>(null);

const openIconPicker = (pageId: string, e: MouseEvent) => {
  e.stopPropagation();
  if (iconPicker.value?.pageId === pageId) { iconPicker.value = null; return; }
  iconPicker.value = { pageId, anchorEl: (e.currentTarget as HTMLElement) ?? null };
};

const setPageIcon = (emoji: string) => {
  if (!iconPicker.value) return;
  const p = pages.value.find((x: Page) => x.id === iconPicker.value!.pageId);
  if (p) p.icon = emoji;
  iconPicker.value = null;
};

const removePageIcon = () => {
  if (!iconPicker.value) return;
  const p = pages.value.find((x: Page) => x.id === iconPicker.value!.pageId);
  if (p) p.icon = undefined;
  iconPicker.value = null;
};

const closeIconPicker = () => { iconPicker.value = null; };

const focusTitle = () => {
  nextTick(() => {
    const el = titleInputRef.value;
    if (!el) return;
    el.focus();
    const len = el.value.length;
    el.setSelectionRange(len, len);
  });
};

// 进入正文：优先落到第一个可编辑块，若页面无正文则自动创建首个块
const focusFirstEditableBlock = (pos: any = 'start') => {
  if (!activePage.value) return;
  const tasksList = activePage.value.tasks;
  const idx = tasksList.findIndex((t: Task) => EDITABLE_TYPES.includes(t.type));
  if (idx > -1) { setFocusConfig(tasksList[idx].id, pos); return; }
  const newId = newBlockId();
  tasksList.unshift({ id: newId, type: 'text', content: '', completed: false, indentLevel: 0 });
  setFocusConfig(newId, pos);
};

const handleTitleKeyDown = (e: KeyboardEvent) => {
  // Notion：标题处 Enter / ↓ / Tab 都会把光标送进正文
  if (e.key !== 'Enter' && e.key !== 'ArrowDown' && e.key !== 'Tab') return;
  e.preventDefault();
  (e.currentTarget as HTMLInputElement).blur();
  focusFirstEditableBlock('start');
};

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

// === 跨块选区引擎 ===
// 每个块是独立的 contenteditable（各自一个「编辑宿主」），浏览器对跨宿主的原生选区支持不可靠：
// 实测 Chromium 下 Selection.toString() 会漏掉中间块，且拖动选中文字会被误判成块拖拽。
// 因此这里自己维护「逻辑选区」：anchor / focus 均为 { blockId, offset }，再据此重建 DOM Range。
interface SelPoint { blockId: string; offset: number }
const selAnchor = ref<SelPoint | null>(null);
const selFocus = ref<SelPoint | null>(null);
let isDragSelecting = false;
// 标记本次按下是否发生过拖动。跨块拖动时 click 会冒泡到共同祖先，
// 若不加区分会被「点击空白处新建块」的逻辑接管，导致选区被抢焦点销毁。
let pointerDragged = false;

const blockIndexOf = (id: string) => (activePage.value?.tasks ?? []).findIndex((t: Task) => t.id === id);

// 把 DOM 的 (node, offset) 归一成「块内字符偏移」
const toBlockOffset = (block: HTMLElement, node: Node, offset: number): number => {
  const r = document.createRange();
  r.selectNodeContents(block);
  try { r.setEnd(node, offset); } catch { return 0; }
  return r.toString().length;
};

// 逻辑偏移 → Range 边界（只在单一宿主内定位，避免跨宿主的不确定行为）
// 注意 offset >= 全部文本长度时必须落到「块元素的子节点末尾」而不是「最后一个文本节点的末尾」：
// 两者视觉位置相同，但 Range.cloneContents() 对后者会把夹在中间的 <a>/<b> 做部分克隆，
// 产出 `<a href="..."></a>` 这样的空标签（曾表现为「Enter 拆块后多出一个空链接」）。
const setBoundary = (range: Range, block: HTMLElement, offset: number, isStart: boolean) => {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  let total = 0;
  while (walker.nextNode()) { const t = walker.currentNode as Text; texts.push(t); total += t.length; }

  if (texts.length === 0 || offset >= total) {
    // 空块，或光标在块尾：用元素级边界
    const pos = block.childNodes.length;
    if (isStart) range.setStart(block, pos); else range.setEnd(block, pos);
    return;
  }
  let remaining = offset;
  for (const t of texts) {
    if (remaining <= t.length) {
      if (isStart) range.setStart(t, remaining); else range.setEnd(t, remaining);
      return;
    }
    remaining -= t.length;
  }
};

// 由屏幕坐标解析出 { blockId, offset }
const caretInfoFromPoint = (x: number, y: number): SelPoint | null => {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  const block = el?.closest('.ce-block') as HTMLElement | null;
  if (!block || !block.dataset.taskId) return null;
  const blockId = block.dataset.taskId;
  const anyDoc = document as any;
  let node: Node | null = null; let offset = 0;
  if (typeof anyDoc.caretPositionFromPoint === 'function') {
    const pos = anyDoc.caretPositionFromPoint(x, y);
    if (pos) { node = pos.offsetNode; offset = pos.offset; }
  } else if (typeof anyDoc.caretRangeFromPoint === 'function') {
    const r = anyDoc.caretRangeFromPoint(x, y);
    if (r) { node = r.startContainer; offset = r.startOffset; }
  }
  if (!node || !block.contains(node)) {
    // 指针落在块的空白处：按 y 判断落在文本上方还是下方
    const rect = block.getBoundingClientRect();
    return { blockId, offset: y < rect.top + rect.height / 2 ? 0 : (block.textContent || '').length };
  }
  return { blockId, offset: toBlockOffset(block, node, offset) };
};

// 依据逻辑 anchor / focus 重建选区（自动按文档顺序校正首尾）
const applyLogicalSelection = (a: SelPoint, f: SelPoint) => {
  const elA = inputRefs.value[a.blockId]; const elF = inputRefs.value[f.blockId];
  if (!elA || !elF) return;
  const ia = blockIndexOf(a.blockId); const ifr = blockIndexOf(f.blockId);
  if (ia < 0 || ifr < 0) return;
  let s: { el: HTMLElement; off: number }; let e: { el: HTMLElement; off: number };
  if (ia === ifr) {
    s = { el: elA, off: Math.min(a.offset, f.offset) };
    e = { el: elA, off: Math.max(a.offset, f.offset) };
  } else if (ia < ifr) {
    s = { el: elA, off: a.offset }; e = { el: elF, off: f.offset };
  } else {
    s = { el: elF, off: f.offset }; e = { el: elA, off: a.offset };
  }
  const range = document.createRange();
  try {
    setBoundary(range, s.el, s.off, true);
    setBoundary(range, e.el, e.off, false);
  } catch { return; }
  const sel = window.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  sel.addRange(range);
};

// 当前是否存在跨块（或块内）非空选区
const hasTextSelection = () => {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;
  return sel.getRangeAt(0).toString().length > 0;
};

// 从当前 DOM 选区反推出逻辑端点（键盘 Shift+方向键造出的选区也走这条路）
const getLogicalSelection = (): { a: SelPoint; f: SelPoint } | null => {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const r = sel.getRangeAt(0);
  const toBlock = (n: Node) => {
    const el = (n.nodeType === 3 ? n.parentElement : n as HTMLElement) as HTMLElement | null;
    return el?.closest('.ce-block') as HTMLElement | null;
  };
  const b1 = toBlock(r.startContainer); const b2 = toBlock(r.endContainer);
  if (!b1?.dataset.taskId || !b2?.dataset.taskId) return null;
  return {
    a: { blockId: b1.dataset.taskId, offset: toBlockOffset(b1, r.startContainer, r.startOffset) },
    f: { blockId: b2.dataset.taskId, offset: toBlockOffset(b2, r.endContainer, r.endOffset) },
  };
};

// 在光标处把块拆成前后两段 HTML（保留 <a>/<b>/<code> 等行内标签）。
// 注意：绝不能用 textContent 切片——那会丢掉所有行内格式。
const splitBlockAtCaret = (el: HTMLElement, offset: number): { before: string; after: string } => {
  const fragWrap = document.createElement('div');
  const cursor = document.createRange();
  setBoundary(cursor, el, offset, true);

  const beforeRange = document.createRange();
  beforeRange.selectNodeContents(el);
  try { beforeRange.setEnd(cursor.startContainer, cursor.startOffset); } catch { /* ignore */ }
  fragWrap.appendChild(beforeRange.cloneContents());

  const afterRange = document.createRange();
  afterRange.selectNodeContents(el);
  try { afterRange.setStart(cursor.endContainer, cursor.endOffset); } catch { /* ignore */ }
  const afterWrap = document.createElement('div');
  afterWrap.appendChild(afterRange.cloneContents());

  // 空片段的 innerHTML 可能是 '' 或 '<br>'，统一成 '' 便于后续判断
  const clean = (html: string) => (html === '<br>' ? '' : html);
  return { before: clean(fragWrap.innerHTML), after: clean(afterWrap.innerHTML) };
};

// 键盘扩展选区：锚点沿用已有选区的起点，没有则以当前光标为锚点。
// 注意：绝不能先 focus() 再读选区——focus 会清掉选区导致锚点丢失（原 extendSelectionTo 正是踩了这个坑）。
const extendSelectionByKeyboard = (fromId: string, fromPos: number, targetId: string, targetOffset: number) => {
  let anchor = selAnchor.value;
  const stillValid = anchor && blockIndexOf(anchor.blockId) >= 0 && hasTextSelection();
  const safeAnchor: SelPoint = stillValid && anchor ? anchor : { blockId: fromId, offset: fromPos };
  const focus: SelPoint = { blockId: targetId, offset: targetOffset };
  selAnchor.value = safeAnchor; selFocus.value = focus;
  applyLogicalSelection(safeAnchor, focus);
};

// 删除逻辑选区覆盖的内容：中间块整块删除，首尾块保留未选中的部分并合并
const deleteSelectionContents = (): boolean => {
  const logical = getLogicalSelection();
  const a = logical?.a ?? selAnchor.value; const f = logical?.f ?? selFocus.value;
  if (!a || !f) return false;
  if (a.blockId === f.blockId && a.offset === f.offset) return false;
  const list = activePage.value?.tasks;
  if (!list) return false;
  const ia = blockIndexOf(a.blockId); const ifr = blockIndexOf(f.blockId);
  if (ia < 0 || ifr < 0) return false;
  const lo = ia < ifr ? a : f;
  const hi = ia < ifr ? f : a;
  const firstIdx = Math.min(ia, ifr); const lastIdx = Math.max(ia, ifr);
  const firstTask = list[firstIdx]; const lastTask = list[lastIdx];
  const firstEl = inputRefs.value[firstTask.id]; const lastEl = inputRefs.value[lastTask.id];
  if (!firstEl || !lastEl) return false;

  // 块内删除（单一宿主内操作，安全）
  const cutBlock = (el: HTMLElement, from: number, to: number) => {
    const r = document.createRange();
    setBoundary(r, el, from, true);
    setBoundary(r, el, to, false);
    r.deleteContents();
    return el.innerHTML;
  };
  if (firstIdx === lastIdx) {
    cutBlock(firstEl, Math.min(lo.offset, hi.offset), Math.max(lo.offset, hi.offset));
    updateTask(firstTask.id, { content: firstEl.innerHTML });
    setFocusConfig(firstTask.id, Math.min(lo.offset, hi.offset));
  } else {
    const firstLen = (firstEl.textContent || '').length;
    cutBlock(firstEl, lo.offset, firstLen);            // 起点块：删到行尾
    cutBlock(lastEl, 0, hi.offset);                     // 终点块：删到选区末端
    const merged = firstEl.innerHTML + lastEl.innerHTML;
    updateTask(firstTask.id, { content: merged });
    list.splice(firstIdx + 1, lastIdx - firstIdx);      // 移除中间块与终点块
    setFocusConfig(firstTask.id, lo.offset);
  }
  selAnchor.value = null; selFocus.value = null;
  return true;
};

// 状态同步
watch(() => activePage.value?.tasks, () => {
  nextTick(() => {
    if (!activePage.value) return;
    activePage.value.tasks.forEach(task => {
      const el = inputRefs.value[task.id]; 
      if (el && el.innerHTML !== task.content && EDITABLE_TYPES.includes(task.type)) {
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

// 当前「激活」的多媒体块（图片等）：用于触屏无 hover 时仍能显示操作浮层
const selectedMediaId = ref<string | null>(null);

// 删除块后把光标交还给相邻的可编辑块。
// 纯 deleteTask 会让光标悬空：图片/看板这类非文本块删掉后用户无处继续打字，
// 删到最后一个块时页面直接空了——这是「删图片不方便」的核心。
const deleteBlockAndFocus = (task: Task) => {
  if (!activePage.value) return;
  const list = activePage.value.tasks;
  const idx = list.findIndex((t: Task) => t.id === task.id);
  if (idx === -1) return;

  list.splice(idx, 1);
  selectedMediaId.value = null;

  // 向前找最近的文本块；没有则向后找；都没有则新建一个，保证永远有可落点
  const prevEditable = [...list.slice(0, idx)].reverse().find((t: Task) => EDITABLE_TYPES.includes(t.type));
  if (prevEditable) { setFocusConfig(prevEditable.id, 'end'); return; }
  const nextEditable = list.slice(idx).find((t: Task) => EDITABLE_TYPES.includes(t.type));
  if (nextEditable) { setFocusConfig(nextEditable.id, 'start'); return; }

  const newId = newBlockId();
  list.push({ id: newId, type: 'text', content: '', completed: false, indentLevel: 0, prevId: null });
  setFocusConfig(newId, 'start');
};
const duplicateTask = (id: string) => {
  if (!activePage.value) return;
  const idx = activePage.value.tasks.findIndex((t: Task) => t.id === id);
  if (idx !== -1) { const newId = newBlockId(); activePage.value.tasks.splice(idx + 1, 0, { ...activePage.value.tasks[idx], id: newId }); }
  actionMenuConfig.value.isOpen = false;
};
// 上下移动块（Cmd/Ctrl + Shift + ↑/↓）
const moveBlock = (index: number, dir: number) => {
  if (!activePage.value) return;
  const list = activePage.value.tasks;
  const target = index + dir;
  if (index < 0 || target < 0 || target >= list.length) return;
  const [item] = list.splice(index, 1);
  list.splice(target, 0, item);
};

// 拦截文本输入 (Markdown 与 Slash)
const handleInput = (e: Event, task: Task) => {
  const target = e.currentTarget as HTMLElement; let htmlVal = target.innerHTML; let textVal = target.textContent || '';
  if (htmlVal === '<br>' || htmlVal === '<div><br></div>') { target.innerHTML = ''; htmlVal = ''; textVal = ''; }

  // 中文输入法组合期间只同步内容，绝不触发 Markdown 转换 / Slash 菜单，避免把未上屏的拼音当正式输入
  if (isComposing.value || (e as InputEvent).isComposing) { updateTask(task.id, { content: htmlVal }); return; }

  const normalizedText = textVal.replace(/\u00A0/g, ' '); 
  const triggerShortcut = (type: string) => {
    updateTask(task.id, { type, content: '', payload: makePayload(type) });
    activeSlashTaskId.value = null; slashQuery.value = '';
    if (EDITABLE_TYPES.includes(type)) setFocusConfig(task.id, 'start'); else focusAfterBlock(task.id);
  };
  // [[ 唤出页面链接菜单（对齐 Notion 的页面引用）
  const mentionMatch = /\[\[([^\[\]]*)$/.exec(normalizedText);
  if (mentionMatch) {
    mentionTaskId.value = task.id;
    mentionQuery.value = mentionMatch[1];
    if (mentionIndex.value >= filteredMentionPages.value.length) mentionIndex.value = 0;
    updateTask(task.id, { content: htmlVal });
    nextTick(() => { slashMenuPosition.value = (window.innerHeight - target.getBoundingClientRect().bottom < 300) ? 'top' : 'bottom'; });
    return;
  }

  // Slash 菜单：行首 / 唤起，其后内容作为过滤关键字（对齐 Notion 的搜索式斜杠菜单）
  const slashMatch = /^\/([^\n]*)$/.exec(normalizedText);
  if (slashMatch) {
    activeSlashTaskId.value = task.id;
    slashQuery.value = slashMatch[1];
    if (slashIndex.value >= filteredSlashOptions.value.length) slashIndex.value = 0;
    updateTask(task.id, { content: htmlVal });
    nextTick(() => { slashMenuPosition.value = (window.innerHeight - target.getBoundingClientRect().bottom < 300) ? 'top' : 'bottom'; });
  } else if (activeSlashTaskId.value === task.id) { activeSlashTaskId.value = null; slashQuery.value = ''; updateTask(task.id, { content: htmlVal }); }
  else if (mentionTaskId.value === task.id) { closeMention(); updateTask(task.id, { content: htmlVal }); }
  else if (normalizedText === '[] ') triggerShortcut('todo'); else if (normalizedText === '# ') triggerShortcut('h1'); else if (normalizedText === '## ') triggerShortcut('h2');
  else if (normalizedText === '### ') triggerShortcut('h3'); else if (normalizedText === '- ') triggerShortcut('bullet'); else if (normalizedText === '* ') triggerShortcut('bullet');
  else if (normalizedText === '1. ') triggerShortcut('numbered'); else if (normalizedText === '--- ') triggerShortcut('divider'); else if (normalizedText === '> ') triggerShortcut('toggle');
  else if (normalizedText === '" ') triggerShortcut('quote');
  else if (applyInlineMarkdown(target, task)) { /* 行内 Markdown 已转换并同步 */ }
  else updateTask(task.id, { content: htmlVal });
};

// 行内 Markdown 即时转换（对齐 Notion：敲 **粗体** / `代码` / ~~删除线~~ 当场变成富文本）
// 只改写「光标所在的那一个文本节点」，不重建 innerHTML，避免破坏块内已有的其它格式
const applyInlineMarkdown = (target: HTMLElement, task: Task): boolean => {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  if (!range.collapsed) return false;
  const node = range.endContainer;
  if (node.nodeType !== 3) return false; // 光标不在纯文本节点上时不处理
  const offset = range.endOffset;
  const before = (node.textContent || '').slice(0, offset);
  const rules: Array<[RegExp, string]> = [
    [/\*\*([^*\n]+)\*\*$/, 'strong'],
    [/~~([^~\n]+)~~$/, 'del'],
    [/`([^`\n]+)`$/, 'code'],
    [/(?<!\*)\*([^*\n]+)\*$/, 'em'],
  ];
  for (const [re, tag] of rules) {
    const m = re.exec(before);
    if (!m) continue;
    const start = offset - m[0].length;
    if (start < 0) continue;
    try {
      const r = document.createRange();
      r.setStart(node, start);
      r.setEnd(node, offset);
      r.deleteContents();
      const el = document.createElement(tag);
      el.textContent = m[1];
      r.insertNode(el);
      const after = document.createRange();
      after.setStartAfter(el); after.collapse(true);
      sel.removeAllRanges(); sel.addRange(after);
      updateTask(task.id, { content: target.innerHTML });
      return true;
    } catch { return false; }
  }
  return false;
};

// 极简 HTML 转义：粘贴进来的纯文本不能直接当 innerHTML 用
const escapeHtml = (str: string) => str.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));

// 把选区包进 <code>（对齐 Notion 的 Cmd/Ctrl + E 行内代码，execCommand 没有对应命令）
const wrapInlineCode = () => {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  const code = document.createElement('code');
  try { code.appendChild(range.extractContents()); } catch { code.textContent = range.toString(); }
  range.deleteContents();
  range.insertNode(code);
  const after = document.createRange();
  after.setStartAfter(code); after.collapse(true);
  sel.removeAllRanges(); sel.addRange(after);
};

// 块内软换行（对齐 Notion 的 Shift+Enter：只换行，不拆块）
const insertSoftBreak = () => {
  if (document.execCommand('insertLineBreak')) return;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  const br = document.createElement('br');
  range.insertNode(br);
  range.setStartAfter(br); range.collapse(true);
  sel.removeAllRanges(); sel.addRange(range);
};

// 把图片文件插入为独立图片块（Base64 持久化），并在其后补一个空文本块供继续输入。
// 粘贴与拖拽共用此函数，保证两条路径的块结构、prevId 链、焦点行为一致。
const insertImageBlock = (file: File, afterIndex: number) => {
  if (!activePage.value) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const list = activePage.value?.tasks;
    if (!list) return;
    const url = String(ev.target?.result ?? '');
    if (!url) return;

    const imgId = newBlockId();
    const textId = newBlockId();
    const prevId = afterIndex >= 0 && afterIndex < list.length ? list[afterIndex].id : (list.length > 0 ? list[list.length - 1].id : null);
    const insertAt = Math.min(afterIndex + 1, list.length);

    list.splice(insertAt, 0,
      { id: imgId, type: 'image', content: '', completed: false, indentLevel: 0, prevId, payload: { url } },
      { id: textId, type: 'text', content: '', completed: false, indentLevel: 0, prevId: imgId },
    );
    // 重写整条链，兜底修复历史数据里缺失/错乱的 prevId
    list.splice(0, list.length, ...writePrevIds(list));
    setFocusConfig(textId, 'start');
  };
  reader.readAsDataURL(file);
};

// 多行粘贴自动拆块（对齐 Notion：多行文本粘贴后按行拆成多个块）
const handlePaste = (e: ClipboardEvent, task: Task, index: number) => {
  if (!activePage.value) return;
  index = realIndexOf(task);

  // 图片粘贴：必须优先于文本分支处理。
  // 否则浏览器默认行为会把图片以 <img src="blob:..."> 内联塞进文本块，导致两个后果：
  //   1) 它不是图片块，没有删除浮层，用户很难删掉；
  //   2) blob: URL 随文档卸载失效，重启后变成破图（用户反馈「重启后还是不行」的根因）。
  // 这里转为 Base64 DataURL 并落成独立图片块，数据可持久化。
  const files = e.clipboardData?.files;
  if (files && files.length > 0) {
    const imageFile = Array.from(files).find((f: File) => f.type.startsWith('image/'));
    if (imageFile) {
      e.preventDefault();
      insertImageBlock(imageFile, index);
      return;
    }
  }

  const raw = e.clipboardData?.getData('text/plain') ?? '';
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (normalized.indexOf('\n') === -1) return; // 单行交给浏览器默认行为，保留富文本
  e.preventDefault();

  const target = e.currentTarget as HTMLElement;
  const pos = getCaretPosition(target);
  const currentText = target.textContent || '';
  const before = currentText.slice(0, pos);
  const after = currentText.slice(pos);

  let lines = normalized.split('\n');
  while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop(); // 丢弃末尾空行

  const inheritType = ['bullet', 'todo'].includes(task.type) ? task.type : 'text';
  const blocks = lines.map((line, i) => {
    let content = escapeHtml(line);
    if (i === 0) content = before + content;
    if (i === lines.length - 1) content = content + after;
    return content;
  });

  updateTask(task.id, { content: blocks[0] });
  const rest = blocks.slice(1).map((content) => ({
    id: newBlockId(),
    type: inheritType,
    content,
    completed: false,
    indentLevel: task.indentLevel || 0,
  }));
  activePage.value.tasks.splice(index + 1, 0, ...rest);
  if (rest.length > 0) setFocusConfig(rest[rest.length - 1].id, 'end');
};

// 键盘高级拦截 (Tab 层级引擎 & 级联退格)
const handleKeyDown = (e: KeyboardEvent, task: Task, index: number) => {
  if (!activePage.value) return; const tasksList = activePage.value.tasks;
  index = realIndexOf(task); // 折叠会跳过块，必须以数据索引为准

  // IME 组合期（拼音候选尚未上屏）不拦截任何按键，否则会吞掉候选词确认、方向键与换行
  if (e.isComposing || isComposing.value) return;

  // 块选择态：整块被选中后，方向键扩展选区、Enter 回到编辑、退格删除、Cmd+D 复制
  if (blockSelectMode.value) {
    if (e.key === 'ArrowUp') { e.preventDefault(); extendBlockSelection(-1); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); extendBlockSelection(1); return; }
    if (e.key === 'Escape') { e.preventDefault(); clearBlockSelection(); setFocusConfig(task.id, 'end'); return; }
    if (e.key === 'Enter') { e.preventDefault(); clearBlockSelection(); setFocusConfig(task.id, 'end'); return; }
    if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); deleteSelectedBlocks(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelectedBlocks(); return; }
    if (e.key === 'Tab') { e.preventDefault(); const sel = [...selectedTaskIds.value]; sel.forEach(id => { const t = tasksList.find((x: Task) => x.id === id); if (t) updateTask(id, { indentLevel: Math.max(0, (t.indentLevel || 0) + (e.shiftKey ? -1 : 1)) }); }); return; }
  }
  // Esc 进入块选择态（光标处无选区时）
  if (e.key === 'Escape') {
    const sel = window.getSelection();
    if (!sel || sel.toString().length === 0) { e.preventDefault(); selectSingleBlock(task.id); }
    return;
  }

  // 提及菜单拦截
  if (mentionTaskId.value === task.id) {
    const mList = filteredMentionPages.value;
    if (e.key === 'ArrowDown') { e.preventDefault(); if (mList.length) mentionIndex.value = (mentionIndex.value + 1) % mList.length; return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); if (mList.length) mentionIndex.value = (mentionIndex.value - 1 + mList.length) % mList.length; return; }
    if (e.key === 'Enter') { e.preventDefault(); insertPageLink(task.id, mList[mentionIndex.value]?.id ?? null); return; }
    if (e.key === 'Escape') { e.preventDefault(); closeMention(); return; }
  }

  // Slash 拦截
  if (activeSlashTaskId.value === task.id) {
    const list = filteredSlashOptions.value;
    if (e.key === 'ArrowDown') { e.preventDefault(); if (list.length) slashIndex.value = (slashIndex.value + 1) % list.length; scrollSlashIntoView(); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); if (list.length) slashIndex.value = (slashIndex.value - 1 + list.length) % list.length; scrollSlashIntoView(); return; }
    if (e.key === 'Enter') { e.preventDefault(); if (list.length) executeSlashCommand(task.id, list[slashIndex.value].id); return; }
    if (e.key === 'Escape') { activeSlashTaskId.value = null; slashQuery.value = ''; return; }
  }

  const target = e.currentTarget as HTMLElement; const textContent = target.textContent || ''; const currentPos = getCaretPosition(target); 

  // 存在（跨块）选区时：退格 / 删除 / 可打印字符先删掉选区，再走原逻辑。
  // 否则原生行为只作用在焦点所在的单个块内，另一部分选区会残留。
  if (hasTextSelection()) {
    const isPrintable = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
    if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); deleteSelectionContents(); return; }
    if (isPrintable) { deleteSelectionContents(); return; } // 不 preventDefault，让字符正常输入
  }

  // 撤销 / 重做：必须优先于浏览器原生 undo 拦截
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
    return;
  }

  // 块级操作快捷键（对齐 Notion）
  if (e.ctrlKey || e.metaKey) {
    const k = e.key.toLowerCase();
    if (k === 'd' && !e.shiftKey) { e.preventDefault(); duplicateTask(task.id); return; }
    if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); moveBlock(index, e.key === 'ArrowUp' ? -1 : 1); return; }
    if (e.key === 'Enter' && task.type === 'todo') { e.preventDefault(); updateTask(task.id, { completed: !task.completed }); return; }
  }

  // 行内格式快捷键（对齐 Notion：Cmd/Ctrl + B / I / U / E，Cmd/Ctrl + Shift + S 删除线）
  if (e.ctrlKey || e.metaKey) {
    const key = e.key.toLowerCase();
    if (key === 'e' && !e.shiftKey && !e.altKey) {
      e.preventDefault(); wrapInlineCode(); updateTask(task.id, { content: target.innerHTML }); return;
    }
    if (key === 's' && e.shiftKey && !e.altKey) {
      e.preventDefault(); document.execCommand('strikeThrough'); updateTask(task.id, { content: target.innerHTML }); return;
    }
    const formatMap: Record<string, string> = { b: 'bold', i: 'italic', u: 'underline' };
    const cmd = formatMap[key];
    if (cmd && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      document.execCommand(cmd);
      updateTask(task.id, { content: target.innerHTML });
      return;
    }
  }

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

    // Notion：Shift+Enter 是块内软换行，不拆块
    if (e.shiftKey) { insertSoftBreak(); updateTask(task.id, { content: target.innerHTML }); return; }

    // Notion「逃生舱」：空的列表 / 待办块按 Enter 不再续接同类块，而是降级为普通段落
    if (textContent === '' && ['bullet', 'todo', 'numbered'].includes(task.type)) {
      updateTask(task.id, { type: 'text', completed: false });
      setFocusConfig(task.id, 'start');
      return;
    }

    const newType = ['bullet', 'todo', 'numbered'].includes(task.type) ? task.type : 'text';
    const newId = newBlockId();

    // 从 DOM 按光标位置拆分为前后两段 HTML。
    // 必须用 Range 而不是 textContent 切片，否则 <a>/<b>/<code> 等行内标签会全部丢失
    // （表现为「绑了链接的文本按 Enter 后链接消失」）。
    const { before, after } = splitBlockAtCaret(target, currentPos);

    // 更新当前行内容为光标前的部分
    updateTask(task.id, { content: before });

    // 在当前行之后插入新行，内容为光标后的部分
    tasksList.splice(index + 1, 0, {
      id: newId,
      type: newType,
      content: after,
      completed: false,
      indentLevel: task.indentLevel,
      // prevId 链：新块的「前一个」是当前块，原后继块的「前一个」变成新块。
      // 三端并发插入时靠这条链确定性重建顺序（见 useSync.orderTasks）
      prevId: task.id,
    });
    const nextBlock = tasksList[index + 2];
    if (nextBlock) updateTask(nextBlock.id, { prevId: newId });
    // 一次性重写整条链，兜底修复历史数据里缺失/错乱的 prevId
    tasksList.splice(0, tasksList.length, ...writePrevIds(tasksList));

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
    // Notion：正文第一个块行首退格，光标回到标题末尾（空块则先删掉再回标题）
    if (index === 0) { e.preventDefault(); if (textContent === '') deleteTask(task.id); focusTitle(); return; }
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
  else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    const dir = e.key === 'ArrowUp' ? -1 : 1;
    // 已有选区时以「逻辑焦点所在块」为基准继续扩展，否则连续按同一个键会原地踏步
    const focusValid = selFocus.value && blockIndexOf(selFocus.value.blockId) >= 0 && hasTextSelection();
    const baseIdx = focusValid ? blockIndexOf(selFocus.value!.blockId) : index;
    const targetIdx = baseIdx + dir;

    // Notion：第一个块按 ↑ 直接回到标题（首块无上一行，原实现会越界报错）
    if (targetIdx < 0) { if (!e.shiftKey) { e.preventDefault(); focusTitle(); } return; }
    if (targetIdx >= tasksList.length) return; // 末块无下一行，避免越界

    e.preventDefault();
    const targetId = tasksList[targetIdx].id;
    const targetEl = inputRefs.value[targetId];
    if (e.shiftKey) {
      // 跨行扩展选区：向下取目标行开头，向上取目标行末尾
      const targetOffset = dir > 0 ? 0 : (targetEl?.textContent || '').length;
      extendSelectionByKeyboard(task.id, currentPos, targetId, targetOffset);
    } else {
      selAnchor.value = null; selFocus.value = null;
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
        extendSelectionByKeyboard(task.id, currentPos, targetId, (targetEl?.textContent || '').length);
      } else {
        selAnchor.value = null; selFocus.value = null;
        setFocusConfig(targetId, 'end');
      }
    }
  }
  else if (e.key === 'ArrowRight') {
    if (currentPos === textContent.length && index < tasksList.length - 1) {
      e.preventDefault();
      const targetId = tasksList[index + 1].id;
      if (e.shiftKey) {
        // 跨行扩展选区到下一行开头
        extendSelectionByKeyboard(task.id, currentPos, targetId, 0);
      } else {
        selAnchor.value = null; selFocus.value = null;
        setFocusConfig(targetId, 'start');
      }
    }
  }
};

// 各块类型的 payload 初始化
const makePayload = (newType: string) => {
  if (newType === 'codeblock') return { language: 'javascript', code: '' };
  if (newType === 'image') return { url: '' };
  if (newType === 'toggle') return { collapsed: false };
  if (newType === 'callout') return { icon: '💡' };
  if (newType === 'kanban') return { columns: [{id:'c1',title:'待办',cards:[]}, {id:'c2',title:'进行中',cards:[]}, {id:'c3',title:'已完成',cards:[]}] };
  return {};
};

// 不可编辑块（如分割线）转换后，把光标送到它的下一块，没有则新建
const focusAfterBlock = (taskId: string) => {
  if (!activePage.value) return;
  const idx = realIndexOf({ id: taskId } as Task);
  const next = activePage.value.tasks[idx + 1];
  if (next && EDITABLE_TYPES.includes(next.type)) setFocusConfig(next.id, 'start');
  else insertTask(taskId, 'below');
};

// 触发多媒体与复杂块的挂载逻辑
const executeSlashCommand = (taskId: string, newType: string) => { 
  updateTask(taskId, { type: newType, content: '', payload: makePayload(newType) }); 
  activeSlashTaskId.value = null; 
  slashQuery.value = '';
  if (EDITABLE_TYPES.includes(newType)) setFocusConfig(taskId, 'start'); 
  else focusAfterBlock(taskId);
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
      insertImageBlock(file, activePage.value ? activePage.value.tasks.length - 1 : -1);
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
const addKanbanCard = (e: Event, _task: Task, col: any) => {
   const val = (e.target as HTMLInputElement).value;
   if(val.trim()) { col.cards.push({ id: newBlockId(), text: val }); (e.target as HTMLInputElement).value = ''; }
};
const deleteKanbanCard = (_task: Task, col: any, cardIdx: number) => {
   col.cards.splice(cardIdx, 1);
};

const handleEmptyClick = (e: MouseEvent) => {
  if (!activePage.value) return;
  if ((e.target as HTMLElement).closest('.task-item-container') || (e.target as HTMLElement).closest('.fixed')) return;
  // 跨块拖拽选区 / 已有选区时，绝不新建块或抢焦点（click 会冒泡到本容器）
  if (pointerDragged || hasTextSelection()) return;
  const tasksList = activePage.value.tasks; const lastTask = tasksList[tasksList.length - 1];
  if (lastTask && lastTask.content === '' && ['text', 'todo'].includes(lastTask.type)) setFocusConfig(lastTask.id, 'end');
  else { const newId = newBlockId(); tasksList.push({ id: newId, type: 'text', content: '', completed: false, indentLevel: 0 }); setFocusConfig(newId, 'start'); }
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
  const newId = newBlockId();
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
// 触屏：由 touch 坐标直接定位菜单（e.currentTarget 在 touch 事件里拿不到可靠元素）
const openActionMenuAtTouch = (taskId: string, e: TouchEvent) => {
  e.stopPropagation();
  const t = e.touches[0];
  if (!t) return;
  actionMenuConfig.value = { isOpen: true, x: Math.round(t.clientX), y: Math.round(t.clientY), taskId };
};
const actionMenuTask = computed(() => activePage.value?.tasks.find((t: Task) => t.id === actionMenuConfig.value.taskId) ?? null);
const handleActionCommand = (type: string) => {
  updateTask(actionMenuConfig.value.taskId, { type, payload: makePayload(type) });
  actionMenuConfig.value.isOpen = false;
};

// 样式与提示
const getTextClass = (task: Task) => {
  if (task.type === 'h1') return 'text-2xl font-bold font-["Rajdhani",sans-serif] text-[#00f0ff]/90';
  if (task.type === 'h2') return 'text-xl font-bold font-["Rajdhani",sans-serif] text-[#e5e7eb]';
  if (task.type === 'h3') return 'text-lg font-bold font-["Rajdhani",sans-serif] text-[#6b7280]';
  if (task.type === 'quote') return 'italic text-[#ffb000]/90';
  if (task.type === 'toggle') return 'text-[15px] font-medium text-[#00f0ff]/80';
  if (task.completed && task.type === 'todo') return 'text-[15px] line-through text-[#6b7280]';
  return 'text-[15px] text-[#e5e7eb]';
};
const getPlaceholder = (type: string) => { if (type === 'h1') return '标题 1'; if (type === 'h2') return '标题 2'; if (type === 'h3') return '标题 3'; if (type === 'callout') return '写点提示…'; if (type === 'text') return "输入 '/' 唤出命令菜单..."; return '...'; };

// 供 App.vue 的备份工具栏调用
defineExpose({ exportMarkdown });
</script>

<style scoped>
.ce-block b, .ce-block strong { color: #00f0ff; font-weight: 700; text-shadow: 0 0 4px rgba(0, 240, 255, 0.3); }
.ce-block i, .ce-block em { font-style: italic; color: #ffb000; }
.ce-block u { text-decoration: underline; text-underline-offset: 3px; text-decoration-color: rgba(0, 240, 255, 0.6); }
.ce-block strike, .ce-block del { text-decoration: line-through; color: #6b7280; opacity: 0.8; }
/* 浮动格式工具栏 */
.ft-btn { display: flex; align-items: center; justify-content: center; min-width: 26px; height: 26px; padding: 0 6px; border-radius: 2px; color: #e5e7eb; font-size: 13px; transition: all 0.15s; }
.ft-btn:hover { background: #1e2126; color: #00f0ff; }
.ce-block a { color: #00f0ff; text-decoration: underline; text-underline-offset: 4px; cursor: pointer; transition: all 0.2s; }
.ce-block a:hover { text-shadow: 0 0 8px rgba(0, 240, 255, 0.6); }
.ce-block code { background: rgba(0, 240, 255, 0.08); color: #00f0ff; padding: 2px 6px; border-radius: 4px; font-family: 'JetBrains Mono', monospace; font-size: 0.9em; border: 1px solid rgba(0, 240, 255, 0.15); }
.ce-block kbd { background: #1e2126; border: 1px solid #374151; border-bottom: 2px solid #111827; padding: 2px 6px; border-radius: 3px; font-size: 0.85em; color: #e5e7eb; font-family: 'JetBrains Mono', monospace; }
/* 页内页面链接（[[ 插入） */
.ce-block a[data-page-id] { color: #00f0ff; text-decoration: none; border-bottom: 1px solid rgba(0, 240, 255, 0.35); transition: all 0.2s; }
.ce-block a[data-page-id]:hover { background: rgba(0, 240, 255, 0.1); border-bottom-color: #00f0ff; }
/* Notion 行为：占位提示只在「当前编辑的空块」或「鼠标悬停的空块」上出现，避免整页刷屏 */
.ce-block.show-placeholder:empty::before,
.task-item-container:hover .ce-block:empty::before { content: attr(data-placeholder); color: rgba(107, 114, 128, 0.45); pointer-events: none; display: block; }
.custom-scrollbar::-webkit-scrollbar { width: 4px; height: 4px; }
.custom-scrollbar::-webkit-scrollbar-track { background: rgba(30, 33, 38, 0.3); }
.custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(0, 240, 255, 0.3); border-radius: 2px; }
.custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(0, 240, 255, 0.6); }
</style>