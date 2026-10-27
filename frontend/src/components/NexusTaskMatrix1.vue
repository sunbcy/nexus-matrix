<template>
  <div class="flex h-viewport w-full bg-void text-display font-sans overflow-hidden" @drop="handleGlobalDrop" @dragover.prevent>

    <!-- 启动加载遮罩：数据载入、目标页就绪前覆盖全屏，避免刷新时闪一下空白或默认/种子文档 -->
    <div v-if="showOverlay" data-booting="1" class="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-void gap-3">
      <span class="w-2.5 h-2.5 bg-accent rounded-sm shadow-[0_0_10px_rgba(0,240,255,0.7)] animate-pulse"></span>
      <span class="font-['Rajdhani',sans-serif] font-bold tracking-widest text-dim text-sm">NEXUS MATRIX</span>
    </div>

    <!-- 左侧边栏 / 移动端「文档列表页」
         桌面端(md: ≥768px)：常驻分栏侧边栏。
         移动端(<768px)：作为独立的全屏「列表页」，与内容页互斥显示（Notion 式页面栈），
         不再用左侧浮层抽屉。内容页通过顶部返回箭头 / 系统返回键切回本列表页。 -->
    <aside v-show="!isMobile || mobileView === 'list'"
           class="bg-surface border-r border-line flex flex-col shrink-0 md:relative md:inset-auto md:z-10"
           :class="isMobile && mobileView === 'list' ? 'fixed inset-y-0 left-0 z-50 w-full max-w-full' : ''"
           :style="isMobile ? undefined : { width: sidebarWidth + 'px' }">
      <!-- pt-safe：原生壳边到边时抽屉从状态栏底下开始，头部避开状态栏；
           非边到边时 env() 恒为 0，无副作用。h-14 改 min-h-14 防止 padding 撑破固定高 -->
      <div class="min-h-14 pt-safe px-4 flex items-center justify-between border-b border-line shadow-sm shrink-0">
        <div class="flex items-center gap-2">
          <span class="w-2 h-2 bg-accent rounded-sm shadow-[0_0_8px_rgba(0,240,255,0.6)] animate-pulse"></span>
          <span class="font-['Rajdhani',sans-serif] font-bold tracking-widest text-display text-sm">NEXUS MATRIX</span>
        </div>
        <div class="flex items-center gap-1">
        <!-- 同步状态指示：点击可手动重试（后端离线时不再无限自动重连） -->
        <button class="flex items-center gap-1 cursor-pointer hover:opacity-80 transition-opacity"
                :title="syncStatus === 'online' ? `已同步 · 在线设备 ${onlineDevices}` : (syncStatus === 'connecting' ? '正在连接后端…' : '纯本地模式（数据已存本机）· 点击重试连接')"
                @click="onSyncIndicatorClick">
          <span class="w-1.5 h-1.5 rounded-full transition-colors"
                :class="syncStatus === 'online' ? 'bg-accent shadow-[0_0_6px_rgba(0,240,255,0.8)]' : (syncStatus === 'connecting' ? 'bg-warn' : 'bg-dim')"></span>
          <span class="text-[10px] font-['JetBrains_Mono',monospace] text-dim uppercase">
            {{ syncStatus === 'online' ? 'SYNC' : (syncStatus === 'connecting' ? 'LINK' : 'LOCAL') }}
          </span>
        </button>
        <!-- 设置入口（2026-10-17）：原生底部 Tab 已移除，设置能力收回 Web 侧。
             位置遵循 Notion 移动端的惯例——全局操作在侧边栏右上角，
             页面级操作在内容页的「···」里。触摸目标 44px。 -->
        <button class="w-11 h-11 md:w-8 md:h-8 flex items-center justify-center rounded-sm text-dim hover:text-accent hover:bg-panel active:text-accent transition-colors"
                @click="openSettings($event)"
                title="设置" aria-label="设置">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
        </button>
        </div>
      </div>

      <!-- 全局搜索：匹配页面标题与正文，点击结果直接跳转 -->
      <div class="px-2 pb-2 shrink-0 border-b border-line">
        <div class="relative">
          <svg class="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-dim pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          <input v-model="searchQuery" type="text" placeholder="搜索标题或正文…  (Ctrl+Shift+F)"
                 class="w-full bg-void border border-line focus:border-accent outline-none pl-7 pr-2 py-1.5 text-sm text-display rounded-sm transition-colors placeholder:text-dim/60" />
          <button v-if="searchQuery" @click="searchQuery = ''" class="absolute right-1.5 top-1/2 -translate-y-1/2 text-dim hover:text-display transition-colors" title="清空">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
        <!-- 搜索结果 -->
        <div v-if="searchQuery.trim()" class="mt-2 max-h-[280px] overflow-y-auto custom-scrollbar space-y-0.5">
          <div v-if="searchResults.length === 0" class="text-xs text-dim py-3 text-center">无匹配结果</div>
          <div v-for="r in searchResults" :key="'sr-'+r.page.id"
               @click="selectPage(r.page.id); searchQuery = ''"
               class="px-2 py-1.5 rounded-sm cursor-pointer transition-colors hover:bg-panel/60 group">
            <div class="flex items-center gap-1.5 text-sm text-display truncate">
              <span v-if="r.page.icon" class="shrink-0">{{ r.page.icon }}</span>
              <svg v-else class="w-3.5 h-3.5 shrink-0 text-dim" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
              <!-- 标题命中时 snippet 就是带高亮的标题，直接渲染，不再重复显示纯文本标题 -->
              <span v-if="r.isTitleHit" class="truncate" v-html="r.snippet"></span>
              <span v-else class="truncate">{{ r.page.title || '无标题' }}</span>
            </div>
            <div v-if="!r.isTitleHit && r.snippet" class="text-xs text-dim truncate pl-5 mt-0.5" v-html="r.snippet"></div>
          </div>
        </div>
      </div>

      <div ref="listScrollRef" @scroll.passive="onListScroll" class="flex-1 py-4 space-y-6 custom-scrollbar" :class="overlayOpen ? 'overflow-hidden' : 'overflow-y-auto'">
        <!-- 最近访问（Notion 的 Recent）：本地记录、按访问倒序 -->
        <div v-if="recentPages.length > 0">
          <div class="text-[11px] font-['JetBrains_Mono',monospace] text-dim mb-1 px-4 uppercase tracking-wider font-bold">最近</div>
          <div class="space-y-0.5 px-2">
            <div v-for="page in recentPages" :key="'recent-'+page.id"
                 @click="selectPage(page.id)"
                 class="group flex items-center justify-between px-2 py-1.5 rounded-md cursor-pointer transition-colors"
                 :class="activePageId === page.id ? 'bg-panel text-accent' : 'text-dim hover:bg-panel/50'">
              <div class="flex items-center gap-2 truncate">
                <span v-if="page.icon" class="shrink-0">{{ page.icon }}</span>
                <svg v-else class="w-4 h-4 shrink-0 text-dim" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                <span class="text-sm truncate font-medium">{{ page.title || '无标题' }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 收藏的子程序 -->
        <div v-if="favoritePages.length > 0">
          <div class="text-[11px] font-['JetBrains_Mono',monospace] text-dim mb-1 px-4 uppercase tracking-wider font-bold">最爱</div>
          <div class="space-y-0.5 px-2">
            <div v-for="page in favoritePages" :key="'fav-'+page.id"
                 @click="selectPage(page.id)"
                 class="group flex items-center justify-between px-2 py-1.5 rounded-md cursor-pointer transition-colors"
                 :class="activePageId === page.id ? 'bg-panel text-accent' : 'text-dim hover:bg-panel/50'">
              <div class="flex items-center gap-2 truncate">
                <svg class="w-4 h-4 shrink-0 text-warn" fill="currentColor" viewBox="0 0 24 24" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                <span class="text-sm truncate font-medium">{{ page.title || '无标题' }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 模板区（isTemplate 页从私人空间树隐藏，收在这里；点 + 用模板新建页面） -->
        <div v-if="templatePages.length > 0">
          <div class="text-[11px] font-['JetBrains_Mono',monospace] text-dim mb-1 px-4 uppercase tracking-wider font-bold">模板</div>
          <div class="space-y-0.5 px-2">
            <div v-for="tpl in templatePages" :key="'tpl-'+tpl.id" class="group flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-panel/50">
              <div class="flex items-center gap-2 truncate cursor-pointer" @click="createFromTemplate(tpl.id)">
                <span v-if="tpl.icon" class="shrink-0">{{ tpl.icon }}</span>
                <svg v-else class="w-4 h-4 shrink-0 text-dim" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                <span class="text-sm truncate font-medium text-muted">{{ tpl.title || '无标题' }}</span>
              </div>
              <div class="flex items-center gap-0.5 shrink-0 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                <button @click.stop="createFromTemplate(tpl.id)" class="p-2.5 md:p-1 text-dim active:text-accent transition-colors" title="使用模板新建页面">
                  <svg class="w-4 h-4 md:w-3.5 md:h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                </button>
                <button @click.stop="unmakeTemplate(tpl.id)" class="p-2.5 md:p-1 text-dim active:text-display transition-colors" title="取消模板（恢复为普通页面）">
                  <svg class="w-4 h-4 md:w-3.5 md:h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- 私人空间树状视图 -->
        <div>
          <div class="flex items-center justify-between text-[11px] font-['JetBrains_Mono',monospace] text-dim mb-1 px-4 uppercase tracking-wider font-bold group">
            <span>私人</span>
            <!-- 新建根页面：桌面端 hover 才浮出；触屏无 hover，必须常驻可见 -->
            <button @click="createPage(null)" class="opacity-100 md:opacity-0 md:group-hover:opacity-100 active:text-accent transition-all p-2 md:p-0 -mr-2 md:mr-0" title="新建根页面" aria-label="新建根页面">
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </button>
          </div>
          
          <div class="space-y-0.5 px-2">
            <div v-for="page in visiblePages" :key="page.id" :data-page-node="page.id"
                 @click="isCoarsePointer ? undefined : selectPage(page.id)"
                 :style="{ paddingLeft: `${page.depth * 0.75 + 0.25}rem` }"
                 class="group relative flex items-center justify-between py-1.5 pr-2 rounded-md cursor-pointer transition-colors"
                 :class="[
                   activePageId === page.id ? 'bg-panel text-accent' : 'text-dim hover:bg-panel/50',
                   // 刚导入进来的页面：短暂高亮，让人一眼看到新内容落在哪
                   highlightPageIds.has(page.id) ? 'ring-1 ring-accent/60 bg-accent/10' : '',
                   draggedPageId === page.id ? 'opacity-40' : '',
                   dragOverPageId === page.id && pageDropPosition === 'top' ? 'shadow-[inset_0_2px_0_0_var(--cyan-glow)] bg-panel/60' : '',
                   dragOverPageId === page.id && pageDropPosition === 'bottom' ? 'shadow-[inset_0_-2px_0_0_var(--cyan-glow)] bg-panel/60' : '',
                   dragOverPageId === page.id && pageDropPosition === 'child' ? 'ring-1 ring-accent/70 bg-accent/10' : '',
                 ]"
                 :draggable="!isCoarsePointer"
                 @dragstart="onPageDragStart($event, page)"
                 @dragover.prevent="onPageDragOver($event, page)"
                 @dragleave="onPageDragLeave(page)"
                 @drop.prevent="onPageDrop($event, page)"
                 @dragend="resetPageDrag"
                 @touchstart.stop="onPageHandleTouchStart(page, $event)">
              
              <div class="flex items-center gap-1.5 truncate">
                <button @click.stop="toggleExpand(page.id)" class="w-8 h-8 md:w-5 md:h-5 flex items-center justify-center shrink-0 active:bg-panel rounded text-dim transition-colors" aria-label="展开或折叠子页面">
                  <svg v-if="page.hasChildren" class="w-3 h-3 transition-transform duration-200" :class="{'rotate-90': page.isExpanded}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="9 18 15 12 9 6"></polyline></svg>
                  <div v-else class="w-3 h-3"></div> 
                </button>
                <!-- 文档图标：有图标显示 emoji，无图标显示默认文件图标。
                     点击即可设置（对齐 Notion：图标是页面的第一公民） -->
                <span class="w-4 h-4 flex items-center justify-center shrink-0 text-[15px] leading-none cursor-pointer rounded-sm hover:bg-panel transition-colors"
                      :class="page.icon ? '' : 'text-dim'"
                      :title="page.icon ? `图标：${page.icon}（点击修改）` : '点击设置文档图标'"
                      @click.stop="openIconPicker(page.id, $event)">
                  <template v-if="page.icon">{{ page.icon }}</template>
                  <svg v-else class="w-4 h-4 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                </span>
                <span class="text-sm truncate font-medium">{{ page.title || '无标题' }}</span>
              </div>
              
              <!-- 行内操作组：桌面端 hover 浮出；触屏无 hover，常驻可见（Notion 移动端同理：
                   hover 收纳的控件在触屏一律常驻）。桌面端仅激活页常驻的行为不变 -->
              <div class="flex items-center opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity gap-0.5 shrink-0 bg-panel rounded px-1 shadow-sm" :class="activePageId === page.id ? 'md:opacity-100' : ''">
                <button @click.stop="toggleFavorite(page.id)" class="p-2.5 md:p-1 text-dim active:text-warn transition-colors" title="收藏" aria-label="收藏">
                  <svg class="w-4 h-4 md:w-3.5 md:h-3.5" :fill="page.isFavorite ? 'currentColor' : 'none'" :class="page.isFavorite ? 'text-warn' : ''" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                </button>
                <button @click.stop="createPage(page.id)" class="p-2.5 md:p-1 text-dim active:text-accent transition-colors" title="新建子页面" aria-label="新建子页面">
                  <svg class="w-4 h-4 md:w-3.5 md:h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                </button>
                <button @click.stop="deletePage(page.id)" class="p-2.5 md:p-1 text-dim active:text-danger transition-colors" v-if="pages.length > 1" title="删除" aria-label="删除页面">
                  <svg class="w-4 h-4 md:w-3.5 md:h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 回收站入口（aside 底部固定）：已删除页面可在此恢复或彻底删除 -->
      <button @click="openTrash"
              class="shrink-0 mx-2 mb-2 px-3 py-2 flex items-center justify-between rounded-md text-dim hover:bg-panel hover:text-display transition-colors border-t border-line"
              title="回收站">
        <span class="flex items-center gap-2 text-sm">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          回收站
        </span>
        <span v-if="trashedPages.length" class="text-[10px] font-['JetBrains_Mono',monospace] text-dim">{{ trashedPages.length }}</span>
      </button>
      <!-- 侧边栏宽度拖拽条（对齐 Notion：侧边栏可拖拽调宽，宽度会记住） -->
      <div v-if="!isMobile"
           class="absolute right-0 top-0 h-full w-1 cursor-col-resize z-30 transition-colors hover:bg-accent/50"
           :class="resizingSidebar ? 'bg-accent/70' : ''"
           @mousedown="startSidebarResize"
           title="拖拽调整侧边栏宽度"></div>
    </aside>

    <!-- 右侧主编辑区：页面切换微动画（与原生 Tab 节奏一致的淡入+轻微上移，150ms） -->
    <Transition name="page-fade" mode="out-in">
    <main class="flex-1 relative custom-scrollbar flex flex-col" :class="overlayOpen ? 'overflow-hidden' : 'overflow-y-auto'" :key="activePage ? activePage.id : 'none'" v-if="activePage && (!isMobile || mobileView === 'content')" :ref="onMainRef" @scroll="onEditorScroll" @touchstart.passive="onEditorTouchStart" @touchmove.passive="onEditorTouchMove" @touchend.passive="onEditorTouchEnd" @touchcancel.passive="onEditorTouchEnd">
      <div class="w-full h-1 bg-accent shadow-[0_0_10px_rgba(0,240,255,0.4)] shrink-0"></div>

      <!-- 页眉封面（Notion 的 Cover）：全出血，位于内容列之外、标题之上。
           高度按图片自然比例自适应（clamp 200~420px），而非固定 240px ——
           固定高度 + 宽横幅会让竖构图人像只剩头部（实测 1000×240 ≈ 4.2:1，宽屏 6~7:1）。
           桌面端 hover 浮出操作条；触屏无 hover，故点击封面后常驻显示。
           按住拖动可垂直重新取景（object-position-y），比任何自动裁切都可靠。 -->
      <div v-if="activePage.cover" class="relative group/cover shrink-0 overflow-hidden select-none"
           :style="{ height: `${coverHeight}px` }"
           :class="coverDragging ? 'cursor-grabbing' : 'cursor-grab'"
           @mousedown="coverTouched = true; startCoverDrag($event)"
           @touchstart.stop="coverTouched = true; startCoverDrag($event.touches[0] as any)">
        <div class="w-full h-full transition-[background-position] duration-100"
             :style="coverStyle(activePage.cover)"></div>
        <!-- pt-safe：封面全出血延伸到状态栏下时，操作条避开状态栏 -->
        <div class="absolute top-3 right-4 pt-safe flex items-center gap-1.5 transition-opacity z-10"
             :class="coverTouched || coverDragging ? 'opacity-100' : 'opacity-0 group-hover/cover:opacity-100'">
          <button @click.stop="openCoverPicker($event)"
                  class="px-3 py-2 md:px-2.5 md:py-1 text-xs bg-void/90 border border-line text-display active:text-accent active:border-accent rounded-sm transition-colors backdrop-blur-sm">
            更换封面
          </button>
          <button @click.stop="removeCover"
                  class="px-3 py-2 md:px-2.5 md:py-1 text-xs bg-void/90 border border-line text-dim active:text-danger active:border-danger rounded-sm transition-colors backdrop-blur-sm">
            移除
          </button>
        </div>
        <!-- 拖动取景提示：仅在 hover 时淡入，不干扰日常浏览 -->
        <div class="absolute bottom-2 left-4 text-[10px] text-display/50 opacity-0 group-hover/cover:opacity-100 transition-opacity pointer-events-none">
          拖动可重新取景
        </div>
        <!-- 摄影师署名（Unsplash 等图库的硬性合规要求） -->
        <div v-if="coverCredit" class="absolute bottom-2 right-4 text-[10px] text-display/70 backdrop-blur-sm bg-void/60 px-2 py-0.5 rounded-sm">
          Photo by
          <a :href="coverCredit.authorUrl" target="_blank" rel="noopener" class="text-accent hover:underline">{{ coverCredit.author }}</a>
          on
          <a :href="coverCredit.sourceUrl" target="_blank" rel="noopener" class="text-accent hover:underline">{{ coverCredit.source }}</a>
        </div>
      </div>

      <!-- 顶部 padding：有封面时封面已全出血占据状态栏区域，内容按常规 pt-6/md:pt-12；
           无封面时内容列直接顶到屏幕最上（边到边），用 0.5rem + 安全区避开状态栏。
           左右 padding：移动端 pl-2 / pr-4（2026-10-17 再调：块手柄改为**流内**排布后
           不再需要靠大左 padding 把外槽挤回屏幕内，左 8px + 手柄 36px = 文本起点 44px，
           右侧 16px，文本可用宽度 ~352px（412px 屏）；桌面端 md:px-20 不变） -->
      <div class="max-w-4xl w-full mx-auto pb-0 pl-2 pr-4 md:px-20 flex-1 flex flex-col"
           :class="activePage.cover ? 'pt-6 md:pt-12' : 'pt-safe-plus'">
        <!-- 面包屑 + 添加入口（无封面时才显示，避免与封面操作条重复）。
             移动端左侧放汉堡按钮唤出抽屉（桌面端隐藏，侧边栏常驻） -->
        <div class="flex items-start justify-between gap-4 mb-6 md:mb-8">
          <div class="flex items-center gap-1 md:gap-2 text-xs font-['JetBrains_Mono',monospace] text-dim min-w-0">
            <!-- 返回箭头：移动端内容页左上角，点击返回文档列表页（Notion 式页面栈）。
                 仅移动端显示（桌面端侧边栏常驻，无需此按钮）。 -->
            <button class="md:hidden shrink-0 w-11 h-11 flex items-center justify-center rounded-sm text-dim active:text-accent active:bg-panel transition-colors"
                    @click="goToList" title="返回文档列表" aria-label="返回文档列表">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
            </button>
            <template v-if="activePageBreadcrumbs.length > 0">
             <template v-for="(crumb, idx) in activePageBreadcrumbs" :key="crumb.id">
                <span class="hover:text-display active:text-display cursor-pointer transition-colors truncate max-w-[150px]" @click="activePageId = crumb.id"><span v-if="crumb.icon" class="mr-1">{{ crumb.icon }}</span>{{ crumb.title || '无标题' }}</span>
                <span v-if="idx < activePageBreadcrumbs.length - 1" class="opacity-50">/</span>
             </template>
            </template>
          </div>
          <button v-if="!activePage.cover" @click="openCoverPicker($event)"
                  class="shrink-0 flex items-center gap-1.5 px-3 py-2 md:px-2 md:py-1 text-xs text-dim active:text-accent rounded-sm transition-colors"
                  title="设置页眉封面">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
            添加封面
          </button>
          <!-- 页面级「···」菜单入口（对齐 Notion：页面操作收敛到内容页右上角） -->
          <button class="shrink-0 w-11 h-11 md:w-8 md:h-8 flex items-center justify-center rounded-sm text-dim active:text-accent hover:text-display hover:bg-panel transition-colors"
                  @click="openPageMenu($event)" title="页面操作" aria-label="页面操作">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"></circle><circle cx="12" cy="12" r="2"></circle><circle cx="19" cy="12" r="2"></circle></svg>
          </button>
        </div>

        <!-- 文档图标（Notion 的 Page Icon）：位于标题上方的大图标。
             无图标时显示「添加图标」，hover 时高亮；点击唤出选择器 -->
        <div class="mb-2 -ml-1">
          <button ref="titleIconBtnRef"
                  class="w-16 h-16 flex items-center justify-center rounded-md transition-colors group/icon"
                  :class="activePage.icon ? 'text-[64px] leading-none hover:bg-panel/50' : 'text-dim hover:text-accent hover:bg-panel/50'"
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
               class="w-full bg-transparent border-none outline-none font-['Rajdhani',sans-serif] text-3xl md:text-5xl font-bold leading-tight tracking-tight text-display placeholder-dim/30 mb-6 md:mb-10 pb-4 border-b border-line" />

        <div class="flex-1 relative pb-32" @click="onContentClick" @mouseover="onLinkHover" @mouseleave="hideLinkChip"
             @touchstart.passive="onLinkTouchStart" @touchmove.passive="onLinkTouchMove" @touchend="onLinkTouchEnd" @touchcancel="onLinkTouchEnd" @contextmenu="onLinkContextMenu">
          
          <!-- 虚拟滚动：上 spacer（视口上方未渲染块的高度占位） -->
          <div v-if="showSpacers" :style="{ height: vTop + 'px', flexShrink: '0' }" aria-hidden="true"></div>

          <!-- 任务行循环渲染 (含层级缩进与多媒体类型) -->
          <div v-for="(task, index) in displayTasks" :key="task.id" :data-block-id="task.id"
               class="task-item-container group relative flex items-start py-2 pr-2 my-1 rounded-sm transition-colors duration-150"
               :style="{ marginLeft: `${(task.indentLevel || 0) * 1.5}rem` }"
               :class="{ 
                 'opacity-50': task.completed && task.type === 'todo',
                 'ring-1 ring-danger/70 bg-danger/10': highlightTaskId === task.id,
                 'hover:bg-panel/40': draggedTaskId !== task.id,
                 'opacity-30 scale-[0.98] border border-dashed border-dim/50': draggedTaskId === task.id,
                 'shadow-[inset_0_2px_0_0_var(--cyan-glow)] bg-panel/30': dragOverTaskId === task.id && dropPosition === 'top',
                 'shadow-[inset_0_-2px_0_0_var(--cyan-glow)] bg-panel/30': dragOverTaskId === task.id && dropPosition === 'bottom',
                 'ring-1 ring-accent/70 bg-accent/5': selectedTaskIds.has(task.id),
                 'bg-surface/70 rounded-md': task.type === 'callout'
               }"
               :draggable="draggableTaskId === task.id"
               @dragstart="handleDragStart($event, task)"
               @dragover.prevent="handleDragOver($event, task)"
               @dragleave="handleDragLeave($event, task)"
               @drop.prevent="handleDrop($event, task)"
               @dragend="handleDragEnd">

            <!-- 缩进引导线已移除：默认态几乎不可见（bg-panel），层级感由 marginLeft 缩进本身承担，
                 留着只会让多层嵌套的页面看起来布满竖线（对齐 Notion：无引导线）。 -->

            <!-- 左槽（统一垂直对齐容器）：把「+号 / 拖拽点 / 块类型标记」收进同一个 flex 容器，
                 使它们与右侧文字首行的水平中线严格对齐。

                 为什么不再各自 absolute + 硬编码 top：
                 文字行高随块类型变化（text 15px→24.4px，h2 20px→32.5px，h1 24px→39px），
                 任何硬编码 top 都对不上，表现为控件整体偏高（即截图中的问题）。

                 对齐原理（依赖两个值，改动时需同步）：
                 - self-stretch 让槽位铺满内容区，items-start 让内部内容从顶部开始；
                 - mt-[2px] 抵消 .ce-block 的 py-0.5，使内容盒顶边与文字行盒顶边齐平；
                 - h-[1lh] 把内容盒高度限制为「首行行高」，再 items-center 即精确落在行内中线。
                   lh 单位取元素自身的 line-height，故这里必须复用文字的 leading-relaxed
                   与字号（getFontSizeClass），否则算出的行高与文字不一致。

                 鲁棒性：多行文本或图片等超高块同样正确（容器被拉高，但内容仍锚定首行）；
                 旧浏览器不支持 lh 单位时 height 退化为 auto，误差 < 0.5px，可接受。

                 -ml-[84px] w-[84px]：把槽位整体拉到正文左边缘之外，不占流宽，
                 从而保证各块类型的文字起点与标题左缘严格对齐。 -->
            <!-- 手柄槽位：
                 桌面 `-ml-[84px] w-[84px]`：拉到正文左边缘之外，不占流宽，
                 保证各块类型的文字起点与标题左缘严格对齐。

                 移动端**改为流内排布**（`ml-0 w-9`），不再用负 margin 外槽：
                 负 margin 的槽位宽度必须与内容区左 padding 严格匹配，而 pl 一旦
                 调整（历史上有过 pl-16→pl-6 的收紧）两者就会脱节——实测 412px 屏上
                 手柄左边缘被推到 -40px，完全在屏幕外、点不到。
                 流内排布下手柄永远在可视区内，代价是块文字比标题右移约 36px
                 （Notion 移动端同样是手柄占行内位置）。 -->
            <div class="shrink-0 ml-0 w-9 md:-ml-[84px] md:w-[84px] self-stretch flex items-start justify-start md:justify-end pr-1">
              <div class="flex items-center gap-1 mt-[2px] h-[1lh] leading-relaxed" :class="getFontSizeClass(task)">
                <!-- 悬浮控制手柄：桌面端只跟随鼠标所在行；触屏无 hover，退化为聚焦该块时显示。
                     可见性完全由 CSS 媒体查询决定，刻意不用「hover 或聚焦」二选一 -->
                <div class="row-handles flex items-center gap-1 transition-opacity z-30"
                     :class="{ 'is-active': focusedTaskId === task.id }"
                     draggable="false">
                  <!-- 「+」插入按钮在移动端隐藏：外槽放不下，插入块用回车即可（Notion 移动端同样没有该按钮） -->
                  <span class="hidden md:inline-flex items-center justify-center w-9 h-9 md:w-7 md:h-7 cursor-pointer text-dim active:text-accent active:bg-panel rounded transition-colors"
                        draggable="false"
                        @mousedown.stop.prevent="onInsertMouseDown(task.id, $event)"
                        @touchstart.stop.prevent="insertTask(task.id, 'below')"
                        title="点击在下方插入（Alt+点击在上方插入）">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="pointer-events: none;">
                      <line x1="12" y1="5" x2="12" y2="19"></line>
                      <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                  </span>
                  <!-- 桌面：拖拽排序手柄 + 点击操作菜单；触屏：仅作操作菜单入口（拖拽排序为桌面专属，
                       触屏下显式降级，避免制造无法触达的桌面交互，与 Notion 移动端一致） -->
                  <div :class="isCoarsePointer ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'"
                       class="text-dim active:text-display p-2.5 md:p-1 select-none"
                       @mousedown="!isCoarsePointer && (draggableTaskId = task.id)"
                       @mouseup="draggableTaskId = null"
                       @mouseleave="draggableTaskId = null"
                       @click="isCoarsePointer ? undefined : openActionMenu($event, task.id)"
                       @touchstart.stop="onHandleTouchStart(task, $event)"
                       :title="isCoarsePointer ? '长按拖拽 / 轻点操作菜单' : '拖拽排序 / 点击操作菜单'">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <circle cx="9" cy="12" r="1"></circle><circle cx="9" cy="5" r="1"></circle><circle cx="9" cy="19" r="1"></circle>
                      <circle cx="15" cy="12" r="1"></circle><circle cx="15" cy="5" r="1"></circle><circle cx="15" cy="19" r="1"></circle>
                    </svg>
                  </div>
                </div>

                <!-- 块类型标记：与手柄同容器，故同样对齐文字首行中线。
                     w-5 固定宽度，保证各类型的文字起点严格一致。
                     例外：todo 的复选框不在槽内 —— Notion 的复选框与其它行文字左缘平齐、
                     文字跟在其后，故渲染在正文流内（见下方 EDITABLE_TYPES 前）。 -->
                <div v-if="task.type === 'bullet'" class="w-5 flex items-center justify-center">
                  <div class="w-1.5 h-1.5 rounded-full bg-accent/80 shadow-[0_0_10px_rgba(0,240,255,0.4)]"></div>
                </div>
                <div v-else-if="task.type === 'numbered'" class="w-5 flex items-center justify-end">
                  <span class="font-['JetBrains_Mono',monospace] text-[13px] text-accent/80 select-none">{{ getNumberedIndex(task) }}.</span>
                </div>
                <button v-else-if="isCollapsible(task)"
                        @click="toggleCollapse(task)"
                        class="relative w-5 h-5 flex items-center justify-center text-dim active:text-accent active:bg-panel rounded transition-colors before:absolute before:-inset-2 before:content-['']"
                        :class="task.payload?.collapsed ? 'opacity-100' : 'opacity-100 md:opacity-0 md:group-hover:opacity-100'"
                        :title="task.payload?.collapsed ? '展开' : '折叠'">
                  <svg class="w-3.5 h-3.5 transition-transform duration-150" :class="{ 'rotate-90': !task.payload?.collapsed }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="9 18 15 12 9 6"></polyline></svg>
                </button>
                <div v-else-if="task.type === 'callout'" class="w-5 flex items-start justify-center select-none text-[15px] leading-5">
                  {{ task.payload?.icon || '💡' }}
                </div>
              </div>
            </div>

            <!-- 引用竖线：装饰元素，贴在文字左侧（quote 的 flex-1 有 pl-4 让出空间） -->
            <div v-if="task.type === 'quote'" class="absolute -left-4 top-2 bottom-2 w-0.5 bg-warn rounded-full shadow-[0_0_8px_rgba(255,176,0,0.4)]"></div>

            <!-- todo 复选框：正文流内、压在正文左缘（对齐 Notion——复选框与其它行文字平齐，
                 待办文字跟在复选框右侧）。垂直对齐复用手柄槽的同款方案：
                 mt-[2px] 抵消 ce-block 的 py-0.5，h-[1lh] 锚定首行行高中线。 -->
            <div v-if="task.type === 'todo'" class="shrink-0 mr-1.5 mt-[2px] h-[1lh] flex items-center leading-relaxed" :class="getFontSizeClass(task)">
              <div class="relative w-5 h-5 flex items-center justify-center">
                <input type="checkbox" :checked="task.completed" @change="(e) => updateTask(task.id, { completed: (e.target as HTMLInputElement).checked })"
                       class="peer appearance-none w-5 h-5 border-2 border-line bg-void checked:border-accent checked:bg-accent/20 cursor-pointer transition-all rounded-none outline-none"
                       style="clip-path: polygon(3px 0, 100% 0, 100% calc(100% - 3px), calc(100% - 3px) 100%, 0 100%, 0 3px)" />
                <svg class="absolute w-3.5 h-3.5 text-accent pointer-events-none transition-opacity" :class="task.completed ? 'opacity-100' : 'opacity-0'" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                  <path stroke-linecap="square" stroke-linejoin="miter" d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>

            <template v-if="EDITABLE_TYPES.includes(task.type)">
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
                 class="absolute left-0 w-64 bg-void border border-line shadow-2xl rounded-sm z-50 flex flex-col overflow-hidden"
                 :class="slashMenuPosition === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'">
              <div class="px-3 py-2 text-xs text-dim uppercase tracking-wider font-['Rajdhani',sans-serif] bg-void z-10 border-b border-line/50 shadow-sm shrink-0">
                {{ filteredMentionPages.length > 0 ? '链接到页面' : '无匹配页面' }}
              </div>
              <div class="overflow-y-auto max-h-[220px] py-1 custom-scrollbar">
                <div v-for="(page, idx) in filteredMentionPages" :key="page.id"
                     @mousedown.prevent="insertPageLink(task.id, page.id)"
                     class="flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors"
                     :class="idx === mentionIndex ? 'bg-panel/80' : 'hover:bg-panel/40'">
                  <span v-if="page.icon" class="text-[15px] leading-none shrink-0">{{ page.icon }}</span>
                  <svg v-else class="w-4 h-4 shrink-0 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                  <span class="text-sm truncate" :class="idx === mentionIndex ? 'text-accent' : 'text-display'">{{ page.title || '无标题' }}</span>
                </div>
                <div v-if="filteredMentionPages.length === 0"
                     @mousedown.prevent="insertPageLink(task.id, null)"
                     class="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-panel/40">
                  <span class="text-sm text-dim">+ 新建页面「{{ mentionQuery }}」并链接</span>
                </div>
              </div>
            </div>

            <!-- 多媒体区块：图片上传器 (Image Block) -->
            <div v-else-if="task.type === 'image'" class="flex-1 mt-1 relative group/img"
                 tabindex="0"
                 @mousedown="selectedMediaId = task.id"
                 @touchstart.stop="selectedMediaId = task.id"
                 @dblclick="task.payload?.url && openImagePreview(task.payload.url)"
                 @keydown.enter.prevent="insertTask(task.id, 'below')"
                 @keydown.backspace.prevent="deleteBlockAndFocus(task)"
                 @keydown.delete.prevent="deleteBlockAndFocus(task)">
              <!-- 适应内容宽度（Notion 默认）：宽度取 min(原图宽, 内容列宽)。
                   小图按原始尺寸显示，不强行拉伸；超宽的图缩进列宽内。
                   注意不要加 max-h 之类的硬高度上限——竖版大图（如 3072×4096 的扫板书页）
                   会被压到几百像素高，正是「导入后看不清」的来源之一。 -->
              <img v-if="task.payload?.url" :src="resolveAssetUrl(task.payload?.url)"
                   :style="imageStyle(task.payload?.url)"
                   @load="onImgLoad(task.payload?.url, $event)"
                   class="max-w-full rounded-md border border-line shadow-sm object-contain block" />
              <!-- 图片操作浮层：放大 / 替换 / 删除。
                   desktop 靠 hover，触屏无 hover 故点击后（selectedMediaId）常驻显示 -->
              <div v-if="task.payload?.url"
                   class="absolute top-2 right-2 flex items-center gap-1 transition-opacity z-10"
                   :class="selectedMediaId === task.id ? 'opacity-100' : 'opacity-0 group-hover/img:opacity-100'">
                <!-- 放大查看：双击也能开，但双击不可发现，给一个显式入口（对齐 Notion 的全屏按钮） -->
                <button @mousedown.stop.prevent="openImagePreview(task.payload.url)"
                        @touchstart.stop.prevent="openImagePreview(task.payload.url)"
                        title="放大查看"
                        class="w-9 h-9 md:w-7 md:h-7 flex items-center justify-center bg-void/90 border border-line text-dim hover:text-accent hover:border-accent rounded-sm transition-colors backdrop-blur-sm">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>
                </button>
                <button @mousedown.stop.prevent="triggerImageUpload(task.id)"
                        @touchstart.stop.prevent="triggerImageUpload(task.id)"
                        title="替换图片"
                        class="w-9 h-9 md:w-7 md:h-7 flex items-center justify-center bg-void/90 border border-line text-dim hover:text-accent hover:border-accent rounded-sm transition-colors backdrop-blur-sm">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 1-9 9c-9 9-9 0 0-9 9-9 9 0 0-9z"></path><path d="M21 3v6h-6"></path><path d="M3 21v-6h6"></path></svg>
                </button>
                <button @mousedown.stop.prevent="deleteBlockAndFocus(task)"
                        @touchstart.stop.prevent="deleteBlockAndFocus(task)"
                        title="删除图片"
                        class="w-9 h-9 md:w-7 md:h-7 flex items-center justify-center bg-void/90 border border-line text-dim hover:text-danger hover:border-danger rounded-sm transition-colors backdrop-blur-sm">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
              </div>
              <div v-else class="w-full h-32 border-2 border-dashed border-line bg-surface hover:bg-panel/50 flex flex-col items-center justify-center rounded-md cursor-pointer hover:border-accent transition-all" @click="triggerImageUpload(task.id)">
                  <svg class="w-8 h-8 text-dim mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                  <span class="text-sm font-['JetBrains_Mono',monospace] text-dim">点击选择图片，或拖拽文件至屏幕任意位置</span>
              </div>
              <!-- 上传输入框常驻：既服务初始上传，也服务「替换图片」 -->
              <input type="file" :id="'img-upload-'+task.id" class="hidden" @change="(e) => handleImageUpload(e, task.id)" accept="image/*">
            </div>

            <!-- 多行代码容器 (Code Block) -->
            <div v-else-if="task.type === 'codeblock'" class="flex-1 mt-1 bg-void border border-line rounded-md overflow-hidden font-['JetBrains_Mono',monospace] shadow-inner relative group/code">
              <div class="flex items-center justify-between px-4 py-2 bg-surface border-b border-line">
                  <div class="flex items-center gap-2">
                    <span class="w-2.5 h-2.5 rounded-full bg-danger/80"></span>
                    <span class="w-2.5 h-2.5 rounded-full bg-warn/80"></span>
                    <span class="w-2.5 h-2.5 rounded-full bg-accent/80"></span>
                  </div>
                  <select v-model="task.payload.language" class="bg-transparent text-xs font-bold text-dim hover:text-accent outline-none cursor-pointer uppercase tracking-wider">
                    <option value="javascript">JavaScript</option>
                    <option value="python">Python</option>
                    <option value="vue">Vue / HTML</option>
                    <option value="rust">Rust</option>
                  </select>
              </div>
              <textarea v-model="task.payload.code" @keydown.tab.prevent="insertTabInCode($event, task)" class="w-full bg-transparent text-accent p-4 text-sm outline-none resize-y min-h-[120px] custom-scrollbar leading-relaxed" placeholder="// TYPE YOUR DIRECTIVES HERE..."></textarea>
            </div>

            <!-- 可视化看板 (Kanban / Database)。
                 移动端单栏折叠：<640px 时取消横向滚动与 min-w-max，改为纵向堆叠，
                 每列从固定 256px 宽变为整宽（与 Notion 移动端「分栏折叠为单栏」一致）。
                 桌面端维持横排三列 + 横向滚动。 -->
            <div v-else-if="task.type === 'kanban'" class="flex-1 mt-1 overflow-x-auto custom-scrollbar pb-4 pt-2 md:overflow-x-auto">
               <div class="flex flex-col gap-4 px-1 md:flex-row md:gap-4 md:min-w-max md:px-1">
                   <div v-for="col in task.payload.columns" :key="col.id" class="w-full md:w-64 bg-surface border border-line rounded-md flex flex-col p-3 shrink-0 shadow-lg">
                       <div class="flex items-center justify-between mb-3 px-1">
                          <div class="text-sm font-bold font-['Rajdhani',sans-serif] text-display tracking-wide">{{col.title}}</div>
                          <div class="text-xs bg-panel text-dim px-2 rounded-full">{{ col.cards.length }}</div>
                       </div>
                       <div class="flex flex-col gap-2 flex-1">
                           <div v-for="(card, cIdx) in col.cards" :key="card.id" class="bg-panel border border-line/50 p-2.5 rounded-sm text-sm text-display shadow-sm relative group/card">
                               {{card.text}}
                               <button @click="deleteKanbanCard(task, col, Number(cIdx))" class="absolute top-1 right-1 p-1 opacity-0 group-hover/card:opacity-100 text-dim hover:text-danger transition-all"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
                           </div>
                           <input type="text" placeholder="+ 新建数据片" class="bg-transparent border border-dashed border-line hover:border-accent/50 focus:border-accent focus:bg-panel/30 rounded-sm px-3 py-1.5 text-sm outline-none text-display transition-all mt-1 font-['JetBrains_Mono',monospace]" @keydown.enter="(e) => addKanbanCard(e, task, col)">
                       </div>
                   </div>
               </div>
            </div>

            <!-- 分割线 (Divider) -->
            <div v-else-if="task.type === 'divider'" class="flex-1 py-3">
              <div class="w-full h-px bg-panel"></div>
            </div>

            <!-- 统一 Slash 命令弹出菜单 -->
            <div v-if="activeSlashTaskId === task.id" 
                 class="absolute left-0 w-64 bg-void border border-line shadow-2xl rounded-sm z-50 flex flex-col overflow-hidden"
                 :class="slashMenuPosition === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'">
              <div class="px-3 py-2 text-xs text-dim uppercase tracking-wider font-['Rajdhani',sans-serif] bg-void z-10 border-b border-line/50 shadow-sm shrink-0">{{ filteredSlashOptions.length > 0 ? '基础区块 & 多媒体容器' : '无匹配命令' }}</div>
              <div class="overflow-y-auto max-h-[260px] py-1 custom-scrollbar">
                <div v-for="(option, idx) in filteredSlashOptions" :key="option.id"
                     :ref="(el) => setSlashItemRef(el, idx)"
                     @mousedown.prevent="executeSlashCommand(task.id, option.id)"
                     class="flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors"
                     :class="idx === slashIndex ? 'bg-panel/80' : 'hover:bg-panel/40'">
                  <div class="w-8 h-8 flex items-center justify-center shrink-0 rounded-sm font-['JetBrains_Mono',monospace] text-sm border"
                       :class="idx === slashIndex ? 'border-accent text-accent bg-accent/10 shadow-[0_0_8px_rgba(0,240,255,0.3)]' : 'border-line text-dim bg-surface'">
                    {{ option.icon }}
                  </div>
                  <div class="flex flex-col min-w-0">
                    <span class="text-sm font-medium truncate" :class="idx === slashIndex ? 'text-accent' : 'text-display'">{{ option.label }}</span>
                    <span class="text-[11px] text-dim truncate">{{ option.desc }}</span>
                  </div>
                </div>
              </div>
            </div>

          </div>

          <!-- 虚拟滚动：下 spacer（视口下方未渲染块的高度占位） -->
          <div v-if="showSpacers" :style="{ height: vBottom + 'px', flexShrink: '0' }" aria-hidden="true"></div>

          <!-- 反向链接（Backlinks）：自动聚合引用本页的页面 -->
          <div v-if="backlinks.length > 0" class="mt-12 pt-4 border-t border-line">
            <div class="text-[11px] font-['JetBrains_Mono',monospace] text-dim uppercase tracking-wider font-bold mb-2">
              反向链接 · {{ backlinks.length }}
            </div>
            <div class="space-y-1">
              <div v-for="bl in backlinks" :key="bl.page.id"
                   class="flex items-start gap-2 text-sm text-dim hover:text-accent cursor-pointer transition-colors px-2 py-1 rounded-sm hover:bg-panel/40"
                   @click="activePageId = bl.page.id">
                <span v-if="bl.page.icon" class="text-[15px] leading-none mt-0.5 shrink-0">{{ bl.page.icon }}</span>
                <svg v-else class="w-4 h-4 mt-0.5 shrink-0 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                <div class="min-w-0">
                  <div class="truncate">{{ bl.page.title || '无标题' }}</div>
                  <div class="text-xs text-dim/70 truncate">{{ bl.excerpt }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
    </Transition>

    <!-- 图片全屏预览（工具栏「放大查看」或双击打开；点遮罩 / 关闭按钮 / Esc 退出） -->
    <div v-if="previewImageUrl" class="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-4 md:p-8"
         @click="closeImagePreview()" @touchstart.stop="closeImagePreview()">
      <img :src="resolveAssetUrl(previewImageUrl)" class="max-w-full max-h-full object-contain rounded-sm" @click.stop @touchstart.stop />
      <button @click.stop="closeImagePreview()" @touchstart.stop.prevent="closeImagePreview()"
              class="absolute top-3 right-3 w-11 h-11 md:w-9 md:h-9 flex items-center justify-center bg-void/90 border border-line text-dim hover:text-danger hover:border-danger rounded-sm transition-colors backdrop-blur-sm" title="关闭 (Esc)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    </div>

    <!-- 设置面板：入口在侧边栏右上角齿轮（原生底部 Tab 已移除） -->
    <SettingsPanel :visible="settingsOpen" :dirty-title-count="notionIdTitleCount" :dead-link-count="deadLinkCount" :duplicate-block-count="duplicateBlockCount" :duplicate-doc-count="duplicateDocCount" :divergent-doc-count="divergentDocCount" :wrongly-killed-count="wronglyKilledCount" @close="settingsOpen = false" @export-md="exportMarkdown" @export-all-zip="exportAllMarkdownZip" @open-notion-import="openNotionImportWizard" @clean-titles="cleanNotionIdTitles" @clean-links="cleanDeadLinks" @clean-dup-blocks="dedupBlocks" @clean-dup-pages="dedupPages" @restore-killed-blocks="restoreWronglyKilledBlocks" />

    <!-- 轻提示（导出等异步操作的反馈） -->
    <transition name="fade">
      <div v-if="exportToast" class="fixed bottom-4 left-1/2 -translate-x-1/2 z-[300] px-4 py-2 rounded-sm bg-void/95 border border-line text-xs font-['JetBrains_Mono',monospace] text-accent shadow-2xl">
        {{ exportToast }}
      </div>
    </transition>

    <!-- 悬浮防遮挡菜单 & 全局操作菜单 (与之前一致，保持精简引用) -->
    <!-- ... -->
    <!-- 选中文本后的浮动格式工具栏（对齐 Notion 的 selection toolbar） -->
    <div v-if="formatToolbar.visible"
         class="format-toolbar fixed z-50 flex items-center gap-0.5 px-1 py-1 bg-void border border-line shadow-2xl rounded-sm"
         :class="isCoarsePointer ? 'format-toolbar--touch' : ''"
         :style="formatToolbarStyle">
      <button @mousedown.prevent="execFormat('bold')" title="加粗 (Ctrl/Cmd+B)" class="ft-btn font-bold">B</button>
      <button @mousedown.prevent="execFormat('italic')" title="斜体 (Ctrl/Cmd+I)" class="ft-btn italic">I</button>
      <button @mousedown.prevent="execFormat('underline')" title="下划线 (Ctrl/Cmd+U)" class="ft-btn underline">U</button>
      <button @mousedown.prevent="execFormat('strikeThrough')" title="删除线 (Ctrl/Cmd+Shift+S)" class="ft-btn line-through">S</button>
      <div class="w-px h-4 bg-panel mx-0.5"></div>
      <button @mousedown.prevent="execFormat('code')" title="行内代码 (Ctrl/Cmd+E)" class="ft-btn font-['JetBrains_Mono',monospace] text-xs">&lt;/&gt;</button>
      <button @mousedown.prevent="execFormat('link')" title="链接 (Ctrl/Cmd+K)" class="ft-btn">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
      </button>
      <div class="w-px h-4 bg-panel mx-0.5"></div>
      <button @mousedown.prevent="colorPanel = colorPanel === 'text' ? null : 'text'" title="文本颜色" class="ft-btn font-bold">A</button>
      <button @mousedown.prevent="colorPanel = colorPanel === 'bg' ? null : 'bg'" title="背景高亮" class="ft-btn relative">
        <span class="px-1 bg-warn/30 text-warn rounded-sm">H</span>
      </button>
      <!-- 颜色面板：触屏时工具条吸底，面板必须向上展开，否则画到键盘底下 -->
      <div v-if="colorPanel"
           class="absolute left-0 flex gap-1 px-2 py-1.5 bg-void border border-line shadow-2xl rounded-sm"
           :class="isCoarsePointer ? 'bottom-full mb-1' : 'top-full mt-1'">
        <button v-for="c in colorPalette" :key="c.value"
                @mousedown.prevent="applyColor(c.value)"
                class="color-swatch w-5 h-5 rounded-sm border border-line hover:scale-110 transition-transform"
                :style="{ background: c.value }" :title="c.label"></button>
        <button @mousedown.prevent="applyColor('transparent')" class="color-swatch w-5 h-5 rounded-sm border border-dim text-[10px] text-dim flex items-center justify-center" title="清除">/</button>
      </div>
    </div>

    <!-- 链接输入弹窗（替代原生 prompt：原生弹窗会抢焦点导致选区丢失，且观感突兀） -->
    <div v-if="linkDialog.visible" class="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm" @click.self="closeLinkDialog">
      <div class="w-[420px] bg-void border border-line shadow-2xl rounded-md overflow-hidden">
        <div class="px-4 py-3 border-b border-line/60 flex items-center gap-2">
          <svg class="w-4 h-4 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
          <span class="text-sm font-bold tracking-wide text-display">{{ linkDialog.editEl ? '编辑链接' : '添加链接' }}</span>
        </div>
        <div class="p-4 space-y-3">
          <div>
            <label class="block text-xs text-dim mb-1.5 uppercase tracking-wider">地址</label>
            <input ref="linkInputRef" v-model="linkDialog.url" type="text"
                   placeholder="https://"
                   @keydown.enter.prevent="confirmLink"
                   @keydown.esc.prevent="closeLinkDialog"
                   class="w-full bg-void border border-line focus:border-accent outline-none px-3 py-2 text-sm text-display rounded-sm transition-colors" />
          </div>
          <div v-if="linkDialog.selectedText && !linkDialog.editEl" class="text-xs text-dim truncate">
            将链接应用到：<span class="text-accent">{{ linkDialog.selectedText }}</span>
          </div>
        </div>
        <div class="px-4 py-3 border-t border-line/60 flex justify-end gap-2">
          <button @click="closeLinkDialog" class="px-3 py-1.5 text-sm text-dim hover:text-display transition-colors">取消</button>
          <button @click="confirmLink" class="px-4 py-1.5 text-sm font-bold text-onaccent bg-accent hover:bg-accent2 rounded-sm transition-colors">确认</button>
        </div>
      </div>
    </div>

    <!-- 链接预览卡（Notion 式）：桌面端 hover 浮出小气泡；触屏无 hover，长按弹出底部菜单。
         两者复用同一份 linkChip 状态，内容均为「预览 + 打开/复制/编辑/移除」。 -->
    <!-- 桌面气泡 -->
    <div v-if="linkChip.visible && !isCoarsePointer"
         class="fixed z-[60] flex flex-col gap-1.5 px-2.5 py-2 rounded-md bg-panel border border-line shadow-xl max-w-[86vw]"
         :style="{ left: `${linkChip.x}px`, top: `${linkChip.y}px` }"
         @mouseenter="keepLinkChip" @mouseleave="hideLinkChip">
      <div class="flex items-center gap-1.5 min-w-0">
        <img v-if="linkChip.favicon" :src="linkChip.favicon" @error="linkChip.favicon = ''" class="w-3.5 h-3.5 rounded-sm shrink-0" alt="" />
        <span class="text-xs font-semibold text-display truncate">{{ linkChip.previewTitle || (linkChip.pageId ? '页内链接' : linkChip.href) }}</span>
      </div>
      <div v-if="linkChip.previewSnippet" class="text-[11px] text-dim truncate max-w-[260px]">{{ linkChip.previewSnippet }}</div>
      <div v-if="linkChip.copied" class="text-[11px] text-accent font-['JetBrains_Mono',monospace]">已复制 ✓</div>
      <template v-else>
        <div class="flex items-center gap-1 flex-wrap">
          <button class="shrink-0 text-[11px] font-['JetBrains_Mono',monospace] text-accent hover:underline" @click.stop="openLinkChip">打开 ↗</button>
          <button class="shrink-0 text-[11px] font-['JetBrains_Mono',monospace] text-dim hover:text-display" @click.stop="copyLinkChip">复制</button>
          <button class="shrink-0 text-[11px] font-['JetBrains_Mono',monospace] text-dim hover:text-display" @click.stop="editLinkChip">编辑</button>
          <button class="shrink-0 text-[11px] font-['JetBrains_Mono',monospace] text-dim hover:text-danger" @click.stop="unlinkChip">移除</button>
        </div>
      </template>
    </div>
    <!-- 移动端底部菜单 -->
    <div v-if="linkChip.visible && isCoarsePointer"
         class="fixed inset-0 z-[60] flex items-end justify-center bg-black/50" @click.self="hideLinkChip">
      <div class="w-full max-w-[480px] bg-void border-t border-line rounded-t-xl pb-[env(safe-area-inset-bottom,0px)]">
        <div class="w-10 h-1 rounded-full bg-dim/60 mx-auto my-2"></div>
        <div class="px-4 py-2 border-b border-line/60">
          <div class="flex items-center gap-2 min-w-0">
            <img v-if="linkChip.favicon" :src="linkChip.favicon" @error="linkChip.favicon = ''" class="w-4 h-4 rounded-sm shrink-0" alt="" />
            <span class="text-sm font-semibold text-display truncate">{{ linkChip.previewTitle || (linkChip.pageId ? '页内链接' : linkChip.href) }}</span>
          </div>
          <div v-if="linkChip.previewSnippet" class="text-xs text-dim truncate mt-0.5">{{ linkChip.previewSnippet }}</div>
        </div>
        <div v-if="linkChip.copied" class="px-4 py-3 text-sm text-accent">已复制 ✓</div>
        <template v-else>
          <button class="w-full text-left px-4 py-3 text-sm text-display hover:bg-panel/40 transition-colors" @click.stop="openLinkChip">打开 ↗</button>
          <button class="w-full text-left px-4 py-3 text-sm text-display hover:bg-panel/40 transition-colors" @click.stop="copyLinkChip">复制链接</button>
          <button class="w-full text-left px-4 py-3 text-sm text-display hover:bg-panel/40 transition-colors" @click.stop="editLinkChip">编辑链接</button>
          <button class="w-full text-left px-4 py-3 text-sm text-danger hover:bg-danger/10 transition-colors" @click.stop="unlinkChip">移除链接</button>
        </template>
      </div>
    </div>

    <!-- 底部面板遮罩（仅触屏）：低于面板(z-50)但高于内容，点击即关闭 -->
    <div v-if="actionMenuConfig.isOpen && isCoarsePointer"
         class="fixed inset-0 z-40 bg-black/60"
         @click="actionMenuConfig.isOpen = false"></div>

    <!-- 块操作菜单：触屏 = 底部面板（bottom sheet，Notion 移动端形态）；
         桌面 = 定点 popover，行为不变。两者共用同一份菜单项，只切容器样式。
         注意 .action-menu-popup 同时是桌面端「视口夹取」测量用的选择器（见 openActionMenuAtTouch）。 -->
    <div v-if="actionMenuConfig.isOpen"
         class="fixed z-50 bg-void text-sm overflow-y-auto custom-scrollbar"
         :class="isCoarsePointer
            ? 'action-menu-sheet inset-x-0 bottom-0 border-t border-line shadow-2xl rounded-t-lg max-h-[70vh] pb-[env(safe-area-inset-bottom,0px)]'
            : 'action-menu-popup w-52 border border-line shadow-2xl py-1 rounded-sm max-h-[70vh]'"
         :style="isCoarsePointer ? undefined : { top: `${actionMenuConfig.y}px`, left: `${actionMenuConfig.x}px` }"
         @click.stop>
      <!-- 底部面板的抓取条（仅触屏） -->
      <div v-if="isCoarsePointer" class="w-10 h-1 bg-dim/60 rounded-full mx-auto my-2"></div>
      <div class="px-3 py-1 text-xs text-dim uppercase tracking-wider font-['Rajdhani',sans-serif] mb-1 border-b border-line/50">转换区块为</div>
      <button class="w-full text-left px-4 py-1.5 hover:bg-panel/50 transition-colors flex items-center gap-2" @click="handleActionCommand('text')"><span class="font-['JetBrains_Mono',monospace] text-dim">T</span> 文本</button>
      <button class="w-full text-left px-4 py-1.5 hover:bg-panel/50 transition-colors text-accent/80 font-bold font-['Rajdhani',sans-serif] flex items-center gap-2" @click="handleActionCommand('h1')"><span class="font-['JetBrains_Mono',monospace] text-accent/40 font-normal">H1</span> 标题 1</button>
      <button class="w-full text-left px-4 py-1.5 hover:bg-panel/50 transition-colors font-bold font-['Rajdhani',sans-serif] flex items-center gap-2" @click="handleActionCommand('h2')"><span class="font-['JetBrains_Mono',monospace] text-dim font-normal">H2</span> 标题 2</button>
      <button class="w-full text-left px-4 py-1.5 hover:bg-panel/50 transition-colors font-bold font-['Rajdhani',sans-serif] flex items-center gap-2" @click="handleActionCommand('h3')"><span class="font-['JetBrains_Mono',monospace] text-dim font-normal">H3</span> 标题 3</button>
      <button class="w-full text-left px-4 py-1.5 hover:bg-panel/50 transition-colors flex items-center gap-2" @click="handleActionCommand('todo')"><span class="font-['JetBrains_Mono',monospace] text-dim">[]</span> 待办事项</button>
      <button class="w-full text-left px-4 py-1.5 hover:bg-panel/50 transition-colors flex items-center gap-2" @click="handleActionCommand('bullet')"><span class="font-['JetBrains_Mono',monospace] text-dim">•</span> 无序列表</button>
      <button class="w-full text-left px-4 py-1.5 hover:bg-panel/50 transition-colors flex items-center gap-2" @click="handleActionCommand('numbered')"><span class="font-['JetBrains_Mono',monospace] text-dim">1.</span> 编号列表</button>
      <button class="w-full text-left px-4 py-1.5 hover:bg-panel/50 transition-colors flex items-center gap-2" @click="handleActionCommand('toggle')"><span class="font-['JetBrains_Mono',monospace] text-dim">▸</span> 折叠列表</button>
      <button class="w-full text-left px-4 py-1.5 hover:bg-panel/50 transition-colors flex items-center gap-2" @click="handleActionCommand('quote')"><span class="font-['JetBrains_Mono',monospace] text-dim">&quot;</span> 引用块</button>
      <button class="w-full text-left px-4 py-1.5 hover:bg-panel/50 transition-colors flex items-center gap-2" @click="handleActionCommand('callout')"><span class="font-['JetBrains_Mono',monospace] text-dim">💡</span> 标注块</button>
      <button class="w-full text-left px-4 py-1.5 hover:bg-panel/50 transition-colors flex items-center gap-2" @click="handleActionCommand('divider')"><span class="font-['JetBrains_Mono',monospace] text-dim">—</span> 分割线</button>
      <div class="border-t border-line/50 my-1"></div>
      <button v-if="isCollapsible(actionMenuTask!)" class="w-full text-left px-4 py-1.5 hover:bg-panel/50 transition-colors flex items-center gap-2" @click="toggleCollapse(actionMenuTask!); actionMenuConfig.isOpen = false">
        <span class="font-['JetBrains_Mono',monospace] text-dim">▸</span> {{ actionMenuTask?.payload?.collapsed ? '展开' : '折叠' }}
      </button>
      <button class="w-full text-left px-4 py-1.5 hover:bg-panel/50 transition-colors flex items-center gap-2" @click="moveBlock(realIndexOf({ id: actionMenuConfig.taskId } as Task), -1)"><span class="font-['JetBrains_Mono',monospace] text-dim">↑</span> 上移</button>
      <button class="w-full text-left px-4 py-1.5 hover:bg-panel/50 transition-colors flex items-center gap-2" @click="moveBlock(realIndexOf({ id: actionMenuConfig.taskId } as Task), 1)"><span class="font-['JetBrains_Mono',monospace] text-dim">↓</span> 下移</button>
      <button class="w-full text-left px-4 py-1.5 hover:bg-panel/50 transition-colors flex items-center gap-2" @click="changeIndent(actionMenuTask!, 1)"><span class="font-['JetBrains_Mono',monospace] text-dim">→</span> 向右缩进</button>
      <button class="w-full text-left px-4 py-1.5 hover:bg-panel/50 transition-colors flex items-center gap-2" @click="changeIndent(actionMenuTask!, -1)"><span class="font-['JetBrains_Mono',monospace] text-dim">←</span> 向左缩进</button>
      <div class="border-t border-line/50 my-1"></div>
      <button class="w-full text-left px-4 py-1.5 hover:bg-panel/50 transition-colors" @click="duplicateTask(actionMenuConfig.taskId)">复制</button>
      <button class="w-full text-left px-4 py-1.5 hover:bg-danger/10 transition-colors text-danger" @click="deleteBlockAndFocus(actionMenuTask!); actionMenuConfig.isOpen = false">删除</button>
    </div>

    <!-- 页面「···」菜单：触屏 bottom sheet / 桌面 popover（复用块菜单双形态范式）。
         收拢页面级操作——导出 / 收藏 / 新建子页 / 重命名 / 删除。 -->
    <div v-if="pageMenuConfig.isOpen" class="fixed inset-0 z-40" :class="isCoarsePointer ? 'bg-black/60' : 'bg-transparent'" @click="closePageMenu"></div>
    <div v-if="pageMenuConfig.isOpen && activePage"
         class="fixed z-50 bg-void text-sm overflow-y-auto custom-scrollbar"
         :class="isCoarsePointer
            ? 'action-menu-sheet inset-x-0 bottom-0 border-t border-line shadow-2xl rounded-t-lg max-h-[70vh] pb-[env(safe-area-inset-bottom,0px)]'
            : 'action-menu-popup w-52 border border-line shadow-2xl py-1 rounded-sm max-h-[70vh]'"
         :style="isCoarsePointer ? undefined : { top: `${pageMenuConfig.y}px`, left: `${pageMenuConfig.x}px` }"
         @click.stop>
      <div v-if="isCoarsePointer" class="w-10 h-1 bg-dim/60 rounded-full mx-auto my-2"></div>
      <button class="w-full text-left px-4 py-1.5 hover:bg-panel/50 transition-colors flex items-center gap-2" @click="exportMarkdown(); closePageMenu()">
        <span class="font-['JetBrains_Mono',monospace] text-dim">↓</span> 导出为 Markdown
      </button>
      <button v-if="!activePage.isTemplate" class="w-full text-left px-4 py-1.5 hover:bg-panel/50 transition-colors flex items-center gap-2" @click="saveAsTemplate(); closePageMenu()">
        <span class="font-['JetBrains_Mono',monospace] text-dim">⛶</span> 存为模板
      </button>
      <button class="w-full text-left px-4 py-1.5 hover:bg-panel/50 transition-colors flex items-center gap-2" @click="toggleFavorite(activePage.id); closePageMenu()">
        <span class="font-['JetBrains_Mono',monospace] text-dim">★</span> {{ activePage.isFavorite ? '取消收藏' : '收藏' }}
      </button>
      <button class="w-full text-left px-4 py-1.5 hover:bg-panel/50 transition-colors flex items-center gap-2" @click="createPage(activePage.id); closePageMenu()">
        <span class="font-['JetBrains_Mono',monospace] text-dim">+</span> 新建子页面
      </button>
      <button class="w-full text-left px-4 py-1.5 hover:bg-panel/50 transition-colors flex items-center gap-2" @click="focusTitle(); closePageMenu()">
        <span class="font-['JetBrains_Mono',monospace] text-dim">✎</span> 重命名
      </button>
      <button v-if="pages.length > 1" class="w-full text-left px-4 py-1.5 hover:bg-danger/10 transition-colors text-danger flex items-center gap-2" @click="deletePage(activePage.id); closePageMenu()">
        <span class="font-['JetBrains_Mono',monospace] text-danger">✕</span> 删除页面
      </button>
      <button v-if="backlinks.length" class="w-full text-left px-4 py-1.5 hover:bg-panel/50 transition-colors flex items-center gap-2" @click="openBacklinks(); closePageMenu()">
        <span class="font-['JetBrains_Mono',monospace] text-dim">↩</span> 反向链接 ({{ backlinks.length }})
      </button>
      <button class="w-full text-left px-4 py-1.5 hover:bg-panel/50 transition-colors flex items-center gap-2" @click="openPageHistory(); closePageMenu()">
        <span class="font-['JetBrains_Mono',monospace] text-dim">⏱</span> 历史版本
      </button>
    </div>

    <!-- Notion 导入向导：解析预览页面树 → 勾选 → 导入。复用 bottom sheet / 弹窗双形态。
         解决「选完 ZIP 静默新建一堆页面、用户毫无掌控」的问题。 -->
    <div v-if="importWizardOpen" class="fixed inset-0 z-[70] flex items-end md:items-center justify-center">
      <div class="absolute inset-0 bg-black/70" @click="closeNotionImportWizard"></div>
      <div class="relative w-full md:w-[480px] bg-void border border-line shadow-2xl flex flex-col"
           :class="isCoarsePointer ? 'rounded-t-xl border-b-0 max-h-[85vh] pb-[env(safe-area-inset-bottom,0px)]' : 'rounded-md max-h-[80vh]'">
        <div v-if="isCoarsePointer" class="flex justify-center pt-2 pb-1 shrink-0"><div class="w-10 h-1 rounded-full bg-dim/60"></div></div>
        <div class="flex items-center justify-between px-4 py-3 border-b border-line shrink-0">
          <span class="font-['JetBrains_Mono',monospace] text-sm text-display tracking-wider">从 Notion 导入</span>
          <button class="w-11 h-11 md:w-8 md:h-8 flex items-center justify-center rounded-sm text-dim hover:text-display hover:bg-panel transition-colors" @click="closeNotionImportWizard" title="关闭">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
        <div class="flex-1 overflow-y-auto custom-scrollbar px-4 py-3 text-sm">
          <!-- 未选择文件 -->
          <div v-if="!importPreview && !importLoading && !importResult" class="space-y-3">
            <p class="text-muted leading-snug">选择 Notion 的「Markdown &amp; CSV」导出 <code class="text-accent font-['JetBrains_Mono',monospace]">.zip</code>（<span class="text-accent">可一次多选多个</span>，按文件分组预览），解析后会列出将创建的页面，确认再导入（不会改动你已有的内容）。<span class="text-warn">同名页面默认不勾选（含多个文件间的同名，仅保留第一份），需要创建副本时手动勾选即可。</span></p>
            <!-- 图片质量：必须选文件**之前**定好——图片在解析那一步就落库了，事后改不生效 -->
            <div class="space-y-1">
              <div class="flex items-center gap-2">
                <span class="text-xs text-dim shrink-0">图片质量</span>
                <div class="flex rounded-sm border border-line overflow-hidden">
                  <button @click="setImportImageMode('compressed')" class="px-3 h-9 md:h-7 text-xs font-['JetBrains_Mono',monospace] transition-colors"
                          :class="importImageMode === 'compressed' ? 'bg-accent text-onaccent' : 'text-dim hover:text-display'">压缩</button>
                  <button @click="setImportImageMode('original')" class="px-3 h-9 md:h-7 text-xs font-['JetBrains_Mono',monospace] transition-colors"
                          :class="importImageMode === 'original' ? 'bg-accent text-onaccent' : 'text-dim hover:text-display'">原图</button>
                </div>
              </div>
              <p class="text-[11px] text-dim leading-snug">
                <template v-if="importImageMode === 'original'">原图：一个字节都不动，就是 ZIP 里那个文件（最清晰，但 10 张扫板书页约 35 MB）。</template>
                <template v-else>压缩：缩到最长边 1600px 再压成 JPEG（约 3 MB），但原图会缩小到 1/3，带小字的图会发虚。</template>
              </p>
            </div>
            <button @click="importFileInput?.click()" class="h-11 md:h-9 px-4 flex items-center justify-center rounded-sm bg-surface border border-line text-accent hover:border-accent active:bg-panel transition-colors text-xs font-['JetBrains_Mono',monospace]">选择 ZIP 文件（可多选）</button>
          </div>
          <!-- 解析中 -->
          <div v-else-if="importLoading && !importPreview" class="py-10 text-center text-dim font-['JetBrains_Mono',monospace]">正在解析 ZIP…</div>
          <!-- 预览页面树（多文件按来源分组） -->
          <div v-else-if="importPreview" class="space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-xs text-dim">将导入 {{ importSelected.size }} / {{ importPreview.pages.length }} 个页面<template v-if="importPreview.sources.filter(s => s.count > 0).length > 1">（来自 {{ importPreview.sources.filter(s => s.count > 0).length }} 个文件）</template><template v-if="importPreview.imageFailures">，{{ importPreview.imageFailures }} 张图片待后台下载</template></span>
              <button @click="toggleImportSelectAll" class="text-xs text-accent font-['JetBrains_Mono',monospace]">{{ importSelected.size === importPreview.pages.length ? '全不选' : '全选' }}</button>
            </div>
            <!-- 同名页：默认不勾选（免得造副本）；勾这个则「重新导入 = 修好已有的那一页」 -->
            <label v-if="importConflictIds.size > 0" class="flex items-start gap-2 px-1 cursor-pointer select-none" @click="toggleImportOverwrite">
              <span class="mt-0.5 w-4 h-4 shrink-0 flex items-center justify-center border rounded-sm"
                    :class="importOverwrite ? 'bg-accent border-accent text-onaccent' : 'border-dim'">
                <svg v-if="importOverwrite" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              </span>
              <span class="text-xs leading-snug" :class="importOverwrite ? 'text-warn' : 'text-dim'">检测到 {{ importConflictIds.size }} 个与已有文档重复（标题或内容完全相同者会**自动去重**，不会再造副本）；勾选本项可额外把「同名但内容不同」的页也覆盖，适合重新导入修图。</span>
            </label>
            <!-- 图片落库校验失败告警：明确告诉用户哪几张没存上，避免导入后破图却不自知 -->
            <div v-if="importPreview.imageVerifyFailures > 0" class="rounded-sm bg-danger/10 border border-danger/40 text-danger text-xs leading-snug px-3 py-2">
              <div class="font-bold">⚠ {{ importPreview.imageVerifyFailures }} 张图片没能存入本地存储，刷新后会丢失（破图）。</div>
              <div class="mt-1 text-danger/90">建议：重新导入该 ZIP；若仍失败，请检查浏览器存储空间 / 是否开启了"退出时清除数据"、或换了非无痕窗口再试。</div>
              <div v-if="importPreview.verifyFailures.length" class="mt-1 font-['JetBrains_Mono',monospace] text-danger/80 break-all">
                涉及：{{ importPreview.verifyFailures.slice(0, 6).map(v => `《${v.title || '无标题'}》第${v.block}块`).join('、') }}<template v-if="importPreview.verifyFailures.length > 6"> 等{{ importPreview.verifyFailures.length }}处</template>
              </div>
            </div>
            <div class="space-y-3">
              <div v-for="g in importGroups" :key="g.file">
                <!-- 多文件或该文件解析出错时显示来源标题；单文件成功则保持简洁不显示 -->
                <div v-if="importGroups.length > 1 || g.error" class="flex items-center justify-between px-1 mb-1 gap-2">
                  <span class="text-[11px] font-['JetBrains_Mono',monospace] text-dim truncate">{{ g.file }}</span>
                  <span v-if="g.error" class="text-[10px] text-danger font-['JetBrains_Mono',monospace] shrink-0">{{ g.error }}</span>
                  <span v-else class="text-[10px] text-dim font-['JetBrains_Mono',monospace] shrink-0">{{ g.pages.length }} 页</span>
                </div>
                <div class="space-y-0.5">
                  <div v-for="p in g.pages" :key="p.id" @click="toggleImportSelect(p.id)"
                       class="flex items-center gap-2 px-2 py-1.5 rounded-sm cursor-pointer transition-colors"
                       :class="importSelected.has(p.id) ? 'bg-panel/60' : 'hover:bg-panel/30'"
                       :style="{ paddingLeft: `${importDepth(p) * 0.75 + 0.5}rem` }">
                    <span class="w-4 h-4 shrink-0 flex items-center justify-center border rounded-sm"
                          :class="importSelected.has(p.id) ? 'bg-accent border-accent text-onaccent' : 'border-dim'">
                      <svg v-if="importSelected.has(p.id)" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    </span>
                    <span class="text-sm text-display truncate">{{ p.title || '无标题' }}</span>
                    <span v-if="importConflictIds.has(p.id)" class="text-[10px] text-warn font-['JetBrains_Mono',monospace] shrink-0">已存在</span>
                    <span class="text-[10px] text-dim font-['JetBrains_Mono',monospace] shrink-0">{{ (p.tasks?.length ?? 0) }} 块</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <!-- 导入结果：不只是甩一句 toast，而是说清「进了什么、哪几张没成」，且能一键跳到出问题的那一块 -->
          <div v-else-if="importResult" class="space-y-3">
            <div class="flex items-baseline gap-2">
              <span class="text-sm text-display">已导入 {{ importResult.pages }} 个页面</span>
              <span class="text-xs text-dim font-['JetBrains_Mono',monospace]">· {{ importResult.blocks }} 个块<template v-if="importResult.overwritten > 0"> · 覆盖 {{ importResult.overwritten }} 个同名页</template><template v-if="importResult.reclaimed > 0"> · 回收 {{ importResult.reclaimed }} 张旧图</template></span>
            </div>
            <div class="flex flex-wrap gap-x-3 gap-y-1 text-xs font-['JetBrains_Mono',monospace]">
              <span v-if="importResult.recovered > 0" class="text-accent">{{ importResult.recovered }} 张图片后台补存成功</span>
              <span v-if="importResult.pending > 0" class="text-warn">{{ importResult.pending }} 张仍是外链</span>
              <span v-if="importResult.issues.length > 0" class="text-danger">{{ importResult.issues.length }} 张没存上</span>
            </div>
            <!-- 缺失明细：可点，直接跳到那一块 -->
            <div v-if="importResult.issues.length > 0" class="rounded-sm bg-danger/10 border border-danger/40 px-3 py-2">
              <div class="text-danger text-xs font-bold">⚠ 下面这些图刷新后会丢失，点条目可直接跳到那一块：</div>
              <div class="mt-1.5 space-y-0.5">
                <button v-for="iss in importResult.issues.slice(0, 8)" :key="iss.pageId + '-' + iss.block"
                        @click="gotoImportIssue(iss)"
                        class="block w-full text-left text-xs font-['JetBrains_Mono',monospace] text-danger/90 hover:text-danger hover:underline truncate">
                  《{{ iss.title || '无标题' }}》第{{ iss.block }}块
                </button>
              </div>
              <div v-if="importResult.issues.length > 8" class="mt-1 text-[11px] text-danger/70 font-['JetBrains_Mono',monospace]">…等 {{ importResult.issues.length }} 处</div>
            </div>
            <!-- 根页面入口：多文件导入时可能有多个根，块数最多的是主入口 -->
            <div v-if="importResult.roots.length > 0" class="space-y-0.5">
              <div class="text-[11px] text-dim font-['JetBrains_Mono',monospace] uppercase tracking-wider">导入的顶层页面</div>
              <button v-for="r in importResult.roots.slice(0, 8)" :key="r.id" @click="gotoImportedPage(r.id)"
                      class="w-full flex items-center justify-between px-2 py-1.5 rounded-sm text-left hover:bg-panel/50 transition-colors">
                <span class="text-sm text-display truncate">{{ r.title || '无标题' }}</span>
                <span class="text-[10px] text-dim font-['JetBrains_Mono',monospace] shrink-0">{{ r.blocks }} 块</span>
              </button>
            </div>
          </div>
          <p v-if="importWizardMsg" class="mt-3 text-xs font-['JetBrains_Mono',monospace]" :class="importLoading ? 'text-dim' : 'text-warn'">{{ importWizardMsg }}</p>
          <input ref="importFileInput" type="file" accept=".zip,application/zip" multiple class="hidden" @change="onImportFilePicked" />
        </div>
        <div v-if="importResult" class="flex items-center gap-2 px-4 py-3 border-t border-line shrink-0">
          <button @click="gotoImportedPage(importResult.roots[0]?.id ?? '')"
                  class="flex-1 h-11 md:h-9 flex items-center justify-center rounded-sm bg-surface border border-accent text-accent hover:bg-panel active:bg-panel transition-colors text-xs font-['JetBrains_Mono',monospace]">
            查看<template v-if="importResult.roots[0]">「{{ importResult.roots[0].title || '无标题' }}」</template>
          </button>
          <button @click="closeNotionImportWizard" class="h-11 md:h-9 px-4 flex items-center justify-center rounded-sm bg-surface border border-line text-dim hover:text-display transition-colors text-xs font-['JetBrains_Mono',monospace]">完成</button>
        </div>
        <div v-else-if="importPreview" class="flex items-center gap-2 px-4 py-3 border-t border-line shrink-0">
          <button @click="confirmNotionImport" :disabled="importLoading || importSelected.size === 0"
                  class="flex-1 h-11 md:h-9 flex items-center justify-center rounded-sm bg-surface border border-accent text-accent hover:bg-panel active:bg-panel transition-colors text-xs font-['JetBrains_Mono',monospace] disabled:opacity-40">
            导入所选 ({{ importSelected.size }})
          </button>
          <button @click="closeNotionImportWizard" class="h-11 md:h-9 px-4 flex items-center justify-center rounded-sm bg-surface border border-line text-dim hover:text-display transition-colors text-xs font-['JetBrains_Mono',monospace]">取消</button>
        </div>
      </div>
    </div>

    <!-- 回收站面板：恢复 / 彻底删除已删除页面。复用 bottom sheet / 弹窗双形态 -->
    <div v-if="trashOpen" class="fixed inset-0 z-[70] flex items-end md:items-center justify-center">
      <div class="absolute inset-0 bg-black/70" @click="closeTrash"></div>
      <div class="relative w-full md:w-[480px] bg-void border border-line shadow-2xl flex flex-col"
           :class="isCoarsePointer ? 'rounded-t-xl border-b-0 max-h-[80vh] pb-[env(safe-area-inset-bottom,0px)]' : 'rounded-md max-h-[75vh]'">
        <div v-if="isCoarsePointer" class="flex justify-center pt-2 pb-1 shrink-0"><div class="w-10 h-1 rounded-full bg-dim/60"></div></div>
        <div class="flex items-center justify-between px-4 py-3 border-b border-line shrink-0">
          <span class="font-['JetBrains_Mono',monospace] text-sm text-display tracking-wider">回收站</span>
          <div class="flex items-center gap-2">
            <button v-if="trashedPages.length" @click="emptyTrash" class="text-xs text-danger font-['JetBrains_Mono',monospace] hover:underline">清空</button>
            <button class="w-11 h-11 md:w-8 md:h-8 flex items-center justify-center rounded-sm text-dim hover:text-display hover:bg-panel transition-colors" @click="closeTrash" title="关闭">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </div>
        </div>
        <div class="flex-1 overflow-y-auto custom-scrollbar px-4 py-3 text-sm">
          <div v-if="trashedPages.length === 0" class="py-10 text-center text-dim">回收站为空</div>
          <div v-else class="space-y-1">
            <div v-for="p in trashedPages" :key="p.id" class="flex items-center justify-between gap-2 px-2 py-2 rounded-sm hover:bg-panel/40">
              <div class="flex items-center gap-2 min-w-0">
                <span v-if="p.icon" class="shrink-0">{{ p.icon }}</span>
                <svg v-else class="w-4 h-4 shrink-0 text-dim" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                <span class="text-sm text-display truncate">{{ p.title || '无标题' }}</span>
              </div>
              <div class="flex items-center gap-1 shrink-0">
                <button @click="restorePage(p.id)" class="px-2 py-1 text-xs text-accent font-['JetBrains_Mono',monospace] hover:underline">恢复</button>
                <button @click="purgePage(p.id)" class="px-2 py-1 text-xs text-danger font-['JetBrains_Mono',monospace] hover:underline">彻底删除</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 反向链接面板：哪些页面引用了当前页（复用 backlinks computed）。bottom sheet / 弹窗双形态 -->
    <div v-if="backlinksOpen" class="fixed inset-0 z-[70] flex items-end md:items-center justify-center">
      <div class="absolute inset-0 bg-black/70" @click="closeBacklinks"></div>
      <div class="relative w-full md:w-[480px] bg-void border border-line shadow-2xl flex flex-col"
           :class="isCoarsePointer ? 'rounded-t-xl border-b-0 max-h-[80vh] pb-[env(safe-area-inset-bottom,0px)]' : 'rounded-md max-h-[75vh]'">
        <div v-if="isCoarsePointer" class="flex justify-center pt-2 pb-1 shrink-0"><div class="w-10 h-1 rounded-full bg-dim/60"></div></div>
        <div class="flex items-center justify-between px-4 py-3 border-b border-line shrink-0">
          <span class="font-['JetBrains_Mono',monospace] text-sm text-display tracking-wider">反向链接</span>
          <button class="w-11 h-11 md:w-8 md:h-8 flex items-center justify-center rounded-sm text-dim hover:text-display hover:bg-panel transition-colors" @click="closeBacklinks" title="关闭">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
        <div class="flex-1 overflow-y-auto custom-scrollbar px-4 py-3 text-sm">
          <div v-if="backlinks.length === 0" class="py-10 text-center text-dim">没有被其它页面链接到</div>
          <div v-else class="space-y-1">
            <div v-for="b in backlinks" :key="b.page.id" @click="selectPage(b.page.id); closeBacklinks()"
                 class="px-2 py-2 rounded-sm cursor-pointer hover:bg-panel/50 transition-colors">
              <div class="flex items-center gap-2">
                <span v-if="b.page.icon" class="shrink-0">{{ b.page.icon }}</span>
                <svg v-else class="w-4 h-4 shrink-0 text-dim" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                <span class="text-sm text-display truncate">{{ b.page.title || '无标题' }}</span>
              </div>
              <div class="text-xs text-dim truncate pl-6 mt-0.5">{{ b.excerpt }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 页面历史版本面板：本地快照，可恢复 / 删除。bottom sheet / 弹窗双形态 -->
    <div v-if="historyOpen" class="fixed inset-0 z-[70] flex items-end md:items-center justify-center">
      <div class="absolute inset-0 bg-black/70" @click="closePageHistory"></div>
      <div class="relative w-full md:w-[480px] bg-void border border-line shadow-2xl flex flex-col"
           :class="isCoarsePointer ? 'rounded-t-xl border-b-0 max-h-[80vh] pb-[env(safe-area-inset-bottom,0px)]' : 'rounded-md max-h-[75vh]'">
        <div v-if="isCoarsePointer" class="flex justify-center pt-2 pb-1 shrink-0"><div class="w-10 h-1 rounded-full bg-dim/60"></div></div>
        <div class="flex items-center justify-between px-4 py-3 border-b border-line shrink-0">
          <span class="font-['JetBrains_Mono',monospace] text-sm text-display tracking-wider">历史版本</span>
          <div class="flex items-center gap-2">
            <button v-if="pageVersions.length" @click="clearHistory" class="text-xs text-danger font-['JetBrains_Mono',monospace] hover:underline">清空</button>
            <button class="w-11 h-11 md:w-8 md:h-8 flex items-center justify-center rounded-sm text-dim hover:text-display hover:bg-panel transition-colors" @click="closePageHistory" title="关闭">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </div>
        </div>
        <div class="flex-1 overflow-y-auto custom-scrollbar px-4 py-3 text-sm">
          <div v-if="pageVersions.length === 0" class="py-10 text-center text-dim">暂无历史版本<br><span class="text-xs">编辑页面后会自动定时存档</span></div>
          <div v-else class="space-y-1">
            <div v-for="(v, i) in [...pageVersions].reverse()" :key="v.ts" class="flex items-center justify-between gap-2 px-2 py-2 rounded-sm hover:bg-panel/40">
              <div class="min-w-0">
                <div class="text-sm text-display truncate">{{ v.title || '无标题' }}</div>
                <div class="text-xs text-dim font-['JetBrains_Mono',monospace]">{{ formatVersionTime(v.ts) }} · {{ v.tasks?.length ?? 0 }} 块<template v-if="i === 0"> · 最新</template></div>
              </div>
              <div class="flex items-center gap-1 shrink-0">
                <button @click="restoreVersion(v)" class="px-2 py-1 text-xs text-accent font-['JetBrains_Mono',monospace] hover:underline">恢复</button>
                <button @click="deleteVersion(v.ts)" class="px-2 py-1 text-xs text-danger font-['JetBrains_Mono',monospace] hover:underline">删除</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 文档图标选择器（侧边栏与标题区共用） -->
    <PageIconPicker v-if="iconPicker"
                    :current="pages.find(p => p.id === iconPicker!.pageId)?.icon"
                    :anchor-el="iconPicker!.anchorEl"
                    @select="setPageIcon"
                    @remove="removePageIcon"
                    @close="closeIconPicker" />

    <!-- 页眉封面选择器 -->
    <PageCoverPicker v-if="coverAnchorEl"
                     :current="activePage?.cover"
                     :anchor-el="coverAnchorEl"
                     @select="setCover"
                     @remove="removeCover"
                     @close="closeCoverPicker" />

  </div>
</template>

<script setup lang="ts">
import {computed, nextTick, onUnmounted, reactive, ref, watch} from 'vue';
import {createRemotePage, dataVersion, markDirty, onlineDevices, syncStatus,} from '../composables/useSync';
import {setNativeListAtTop, setNativePullRefresh} from '../composables/nativeBridge';
import {App} from '@capacitor/app';
import {newPageId} from '../composables/ids';
import SettingsPanel from './SettingsPanel.vue';
import {getAsset, isAssetRef} from '../composables/assets';
import PageIconPicker from './PageIconPicker.vue';
import PageCoverPicker from './PageCoverPicker.vue';

// === 数据结构 ===
interface Task {
  id: string;
  type: string;
  content: string;
  completed: boolean;
  indentLevel?: number;
  payload?: any;
  prevId?: string | null;
  deletedAt?: number;   // 块级墓碑时间戳（ms）。整页替换/去重时被换掉的旧块打此戳随同步上推
  updatedAt?: number;   // 客户端生成的时间戳（ms），供块级 LWW 合并
}
interface Page { id: string; title: string; tasks: Task[]; parentId: string | null; isFavorite: boolean; isExpanded: boolean; updatedAt?: number; icon?: string; cover?: string; coverPos?: number; deletedAt?: number; isTemplate?: boolean; prevId?: string | null; }

// 可承载富文本光标的块类型（图片 / 代码块 / 看板 / 分割线不参与纯文本行级光标逻辑）
const EDITABLE_TYPES = ['text', 'h1', 'h2', 'h3', 'quote', 'todo', 'bullet', 'numbered', 'toggle', 'callout'];

// === 全局状态与持久化 (LocalFirst + 远端同步由 useSync 统一托管) ===
// 初始为空数组：首启种子由 initSync 的「本地+远端都无数据」分支创建。
// 之前在这里预置一份种子页，会导致每次刷新第一帧先渲染种子文档、数据加载完再跳转
// ——表现为刷新时闪一下「NEXUS 协议指南」。置空后首帧无内容，加载完直接呈现正确页面。
const pages = ref<Page[]>([]);

// 初值取当前 hash：刷新时第一帧就瞄准要恢复的页，避免先渲染默认/种子页再跳转；
// 无 hash（首启）才回落 'default-page'（initSync 会建出该种子页）。
const activePageId = ref<string>(window.location.hash.slice(1) || 'default-page');
const activePage = computed(() => pages.value.find(p => p.id === activePageId.value));

// 启动加载态：数据(async initSync)载入、目标页(activePage)就绪前显示加载遮罩，
// 避免首帧空白/闪烁。目标页一就绪即撤下遮罩，直接呈现正确页面。
const booting = ref(true);
const showOverlay = ref(false);
watch(activePage, (ap) => { if (ap) { booting.value = false; showOverlay.value = false; } }, { immediate: true });
// 加载遮罩仅在明显偏慢(>150ms)时浮现：快速加载直接呈现页面，不闪一下遮罩反而更突兀
setTimeout(() => { if (booting.value) showOverlay.value = true; }, 150);
// 兜底：initSync 异常/极慢导致 activePage 长时间不就绪，超时也撤下，避免永久卡在加载态
setTimeout(() => { booting.value = false; showOverlay.value = false; }, 8000);

// 移动端视图状态：列表页(list) 与 内容页(content) 分离，像 Notion 一样走页面栈返回。
// 桌面端(md: 断点 ≥768px)仍是常驻侧边栏 + 主编辑区的分栏布局，此状态不参与。
const isMobile = ref(typeof window !== 'undefined' && window.innerWidth < 768);
const mobileView = ref<'list' | 'content'>('list');

// 进入文档页后的「静默窗口」：这段时间内拒绝程序化聚焦（focusConfig 的自动落光标），
// 避免一进页面就唤起软键盘——对齐 Notion：进入页面是「阅读」，不自动落光标。
let suppressAutoFocusUntil = 0;

// 进入内容页（仅移动端）：切到 content 视图（列表/内容分离，像 Notion 页面栈）。
const enterContent = () => {
  if (!isMobile.value) return;
  if (mobileView.value === 'content') return;   // 已在内容页则不再重复切换
  mobileView.value = 'content';
  // 不自动落光标、不弹键盘：清掉待聚焦目标，并交出可能残留的焦点。
  suppressAutoFocusUntil = Date.now() + 600;
  setFocusConfig(null, null);
  nextTick(() => {
    const ae = document.activeElement as HTMLElement | null;
    if (ae && (ae.isContentEditable || ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) ae.blur();
  });
};
// 关闭当前最上层的浮层（链接弹窗 / 设置 / 页面菜单 / 操作菜单 / 图标 / 封面 / 提及 / 格式工具栏等）。
// 返回是否关闭了某个浮层——用于「返回键先关浮层，再走页面栈/退出」，避免误退 App。
const closeTopmostOverlay = (): boolean => {
  if (linkDialog.value.visible) { closeLinkDialog(); return true; }
  if (settingsOpen.value) { settingsOpen.value = false; return true; }
  if (pageMenuConfig.value.isOpen) { closePageMenu(); return true; }
  if (actionMenuConfig.value.isOpen) { actionMenuConfig.value.isOpen = false; return true; }
  if (iconPicker.value) { closeIconPicker(); return true; }
  if (coverAnchorEl.value) { closeCoverPicker(); return true; }
  if (mentionTaskId.value) { closeMention(); return true; }
  if (formatToolbar.value.visible) { hideFormatToolbar(); return true; }
  if (linkChip.value.visible) { linkChip.value.visible = false; return true; }
  return false;
};

// 从内容页返回列表（仅移动端）：左上返回箭头点击；浮层打开时先关浮层。
const goToList = () => {
  if (!isMobile.value) return;
  if (closeTopmostOverlay()) return;
  mobileView.value = 'list';
};

// 切页统一出口：桌面端无副作用；移动端切到内容页（分离视图）。
const selectPage = (id: string) => {
  activePageId.value = id;
  rememberRecentPage(id);   // 记录最近访问（Notion 的 Recent）
  enterContent();
};

// 移动端形态切换（与 Tailwind md: 断点一致）：宽度 <768 视为移动端。
const updateIsMobile = () => { isMobile.value = window.innerWidth < 768; };

// === 侧边栏宽度：可拖拽调宽 + 记住（对齐 Notion，Notion 的侧边栏本就可拖拽）===
// 默认 240px（Notion 默认值），范围 180~480px（与 Notion 的可调区间一致）。
const SIDEBAR_W_KEY = 'nexus.sidebar.width';
const sidebarWidth = ref<number>((() => {
  try {
    const v = parseInt(localStorage.getItem(SIDEBAR_W_KEY) || '', 10);
    if (Number.isFinite(v) && v >= 180 && v <= 480) return v;
  } catch { /* localStorage 不可用则用默认 */ }
  return 240;
})());
const resizingSidebar = ref(false);
const startSidebarResize = (e: MouseEvent) => {
  e.preventDefault();
  const startX = e.clientX;
  const startW = sidebarWidth.value;
  resizingSidebar.value = true;
  const prevSelect = document.body.style.userSelect;
  document.body.style.userSelect = 'none'; // 拖拽时别选中文字
  const onMove = (ev: MouseEvent) => {
    sidebarWidth.value = Math.min(480, Math.max(180, startW + (ev.clientX - startX)));
  };
  const onUp = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    document.body.style.userSelect = prevSelect;
    resizingSidebar.value = false;
    try { localStorage.setItem(SIDEBAR_W_KEY, String(Math.round(sidebarWidth.value))); } catch { /* 忽略 */ }
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
};
// 安卓系统/手势返回（由 Capacitor App 插件的 backButton 事件驱动，见 onMounted）：
// 任意浮层打开时先收起浮层；否则内容页 → 回列表页；列表页 → 退出 App。
const onBackButton = () => {
  if (!isMobile.value) return;
  if (closeTopmostOverlay()) return;
  if (mobileView.value === 'content') {
    mobileView.value = 'list';
  } else {
    App.exitApp();
  }
};

// === 移动端：输入法弹起时，滑动文档自动收起输入法 ===
// 安卓常见交互：键盘占了半屏，此时再滑动文档的意图多半是「去看内容 / 让出屏幕」，应自动收起，
// 不必先按一次返回。仅在「确有可编辑焦点」且「未在做跨块文本拖选」时触发，避免抢掉选区。
const KB_DISMISS_DRAG = 64;   // 判定为「滑动」的最小位移(px)
let kbDragStartY = 0;
let kbDragTracking = false;
const getActiveEditable = (): HTMLElement | null => {
  const ae = document.activeElement as HTMLElement | null;
  if (!ae) return null;
  return (ae.isContentEditable || ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA') ? ae : null;
};
const onEditorTouchStart = (e: TouchEvent) => {
  if (!isMobile.value || mobileView.value !== 'content') return;
  const t = e.touches[0];
  kbDragStartY = t ? t.clientY : 0;
  kbDragTracking = !!(t && getActiveEditable());
};
const onEditorTouchMove = (e: TouchEvent) => {
  if (!kbDragTracking) return;
  const t = e.touches[0];
  if (!t) return;
  // 已经拖出选区：让位给选区引擎，不抢
  if (hasTextSelection()) { kbDragTracking = false; return; }
  const ae = getActiveEditable();
  if (!ae) { kbDragTracking = false; return; }
  // 上/下滑都算「有意图的滑动」（对应「往下翻看更多」与「下滑收起」两种表述）
  if (Math.abs(t.clientY - kbDragStartY) >= KB_DISMISS_DRAG) {
    kbDragTracking = false;
    ae.blur();
  }
};
const onEditorTouchEnd = () => { kbDragTracking = false; };

// 受控下拉刷新（仅移动端）：
// - 列表页才允许下拉刷新；内容编辑页整体禁用（与安卓手势导航不再冲突）。
// - 列表滚动位置实时上报，仅顶部可触发，避免阅读时下滑误刷新。
const listScrollRef = ref<HTMLElement | null>(null);
let listScrollRaf = 0;
const onListScroll = (e: Event) => {
  if (!isMobile.value) return;
  const el = e.target as HTMLElement;
  const atTop = el.scrollTop <= 0;
  if (listScrollRaf) return;
  listScrollRaf = requestAnimationFrame(() => {
    listScrollRaf = 0;
    setNativeListAtTop(atTop);
  });
};
watch(mobileView, (v) => {
  if (!isMobile.value) return;
  setNativePullRefresh(v === 'list');
  const el = listScrollRef.value;
  setNativeListAtTop(!el || el.scrollTop <= 0);
}, { immediate: true });

// === 全局搜索 ===
// 匹配范围：页面标题 + 所有块的正文（转纯文本后匹配）。
// 命中正文时给出上下文片段，并用 <mark> 高亮关键词。
const searchQuery = ref('');
const plainText = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

interface SearchHit { page: Page; snippet: string; isTitleHit: boolean }
const searchResults = computed<SearchHit[]>(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];
  for (const page of pages.value) {
    const title = page.title || '无标题';
    if (title.toLowerCase().includes(q)) {
      // 标题命中也要高亮，否则用户看不出这条为何被匹配
      const idx = title.toLowerCase().indexOf(q);
      hits.push({
        page,
        isTitleHit: true,
        snippet: `${escapeHtml(title.slice(0, idx))}<mark style="background-color:rgb(var(--warn));color:rgb(var(--onaccent));padding:0 1px;border-radius:2px;">${escapeHtml(title.slice(idx, idx + q.length))}</mark>${escapeHtml(title.slice(idx + q.length))}`,
      });
      continue;
    }
    // 标题未命中则找正文首个匹配块，取关键词前后各 30 字作为上下文
    for (const t of page.tasks ?? []) {
      if (t.deletedAt) continue;
      const text = plainText(t.content || '');
      const idx = text.toLowerCase().indexOf(q);
      if (idx === -1) continue;
      const from = Math.max(0, idx - 30);
      const to = Math.min(text.length, idx + q.length + 30);
      const before = escapeHtml(text.slice(from, idx));
      const hit = escapeHtml(text.slice(idx, idx + q.length));
      const after = escapeHtml(text.slice(idx + q.length, to));
      hits.push({
        page,
        isTitleHit: false,
        snippet: `${from > 0 ? '…' : ''}${before}<mark style="background-color:rgb(var(--warn));color:rgb(var(--onaccent));padding:0 1px;border-radius:2px;">${hit}</mark>${after}${to < text.length ? '…' : ''}`,
      });
      break; // 每个页面只取第一个匹配块，避免结果冗长
    }
  }
  return hits.slice(0, 30); // 上限避免侧边栏过长
});

// Ctrl+Shift+F 唤起搜索（与主流编辑器一致）
const handleSearchHotkey = (e: KeyboardEvent) => {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    const input = document.querySelector('input[placeholder*="搜索标题"]') as HTMLInputElement | null;
    input?.focus();
    input?.select();
  }
};

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
const visibleTasks = computed(() => (activePage.value?.tasks ?? []).filter((t: Task) => !t.deletedAt && !hiddenTaskIds.value.has(t.id)));

// P1 补充：块的「结构性变化」（增 / 删 / 拖拽重排 / 合并 / 拆分）都是直接改 tasks 数组
// （splice 或整体重赋值），不经过 updateTask，因此不触发即时保存——过去只靠 4s 对账兜底，
// 于是「删了空行/块，几秒内刷新」删除就丢了、空行回来（用户反馈的 bug）。
// 这里监听 tasks 的 id 序列签名：结构一变立即 markDirty。内容编辑仍走 updateTask（id 序列不变、不重复触发），
// 二者合一即覆盖全部改动路径，4s 对账退居纯安全网。
watch(
  () => activePage.value?.tasks.map((t: Task) => t.id).join(','),
  () => { if (activePage.value) markDirty(activePage.value.id); }
);

// === P2 全虚拟滚动（变高） ===
// 长文档即使首屏渐进，最终全部挂载也会让滚动/内存吃紧。P2 只渲染「视口 ± overscan」的块，上下用 spacer 占位。
// 块高先按类型估算，挂载后实测校正；ResizeObserver 跟踪内容/图片导致的块高变化，并对「视口上方块的尺寸变化」
// 补偿 scrollTop，避免滚动跳动。offsets 用「版本号缓存」：只有列表或某块高度变化才重算前缀和，滚动时 O(1) 命中。
// 关键不变量：焦点块不能被卸载；键盘/跳转/搜索先把目标块滚进视口（纳入窗口并挂载）再聚焦（见 focusConfig watch）。
// 开关 virtualScrolling=false → 退回 P3「渐进全挂载」，便于对照与回退。
// 关闭虚拟滚动，改为「整篇挂载」（渐进式，见 renderedTasks / scheduleRenderGrowth）。
// 原因：虚拟滚动靠「估算未挂载块的高度」撑总高度，估算永远做不到精确（字体、图片、换行都会让它偏），
// 偏了就表现为——滚不到真正的底部、拖到底疯狂跳、静止时抖动。为了修这些我们已经打了多层补丁
// （锚点补偿 / 冻结模型 / 关原生锚定 / 收敛检测），代价高却仍不稳定。
// 用户明确偏好「稳定可靠 > 速度」，且实测 Notion 长文档也是「先空白卡一下、之后长度精确、永远能触底」，
// 那正是整篇挂载的形态。故改回整篇挂载：总高度 = 真实 DOM 高度，天然精确，不存在估算误差。
const virtualScrolling = ref(false);
const VIRTUAL_OVERSCAN = 2;                 // 视口上下各多渲染 2 屏（1 屏在快速滚动时会一帧跳过，出现空白闪现）
const VIRTUAL_QUANT = 24;                   // 窗口按 N 块一档对齐，避免拖动滚动条时每帧都重渲染
const scrollEl = ref<HTMLElement | null>(null);
const blockHeights = ref<Record<string, number>>({});
// 图片自然尺寸（按 asset 引用聚合，同一张图复用）。用于：①虚拟滚动的「估算高度」用真实宽高比，
// 而非固定 520 → 滚动条总行程更接近真实值，解决「拖不到底」；②渲染时按宽高比预留占位，
// 图片异步加载完成不再撑高重排（修 80% 处行抖动）。尺寸在「首次解析/加载」时写入，之后一直准确。
const imageDims = reactive<Record<string, { w: number; h: number }>>({});
const vStart = ref(0);
const vEnd = ref(0);
const vTop = ref(0);
const vBottom = ref(0);
// 「量高过程」标记：打开长文档时先把全篇逐块量一遍真实高度（见 startMeasurePass），
// 期间窗口由量高逻辑直接控制，禁止滚动/RO 改窗口。量完后所有块高度都是实测值，总高度固定。
const measureAll = ref(false);
// 「滚动补偿冻结」：量高完成后置 true，此后**不再为了补偿而写 scrollTop**。
// 这是修「不动滚轮时内容与滚动条一起上下抖」的关键：
// 写 scrollTop → 触发 scroll 事件 → 重算窗口 → 新块挂载 → 测高 → 又写 scrollTop，
// 会形成自激振荡。量完之后高度模型已完整，再挪滚动位置没有收益，只会抖。
// 用户明确偏好「稳定可靠 > 速度」，故此处宁可偶尔有一次内容位移，也不要持续抖动。
const heightsFrozen = ref(false);
// 已量过的页：量过的页再打开直接复用（秒开且稳）；resize（宽度变 → 文字重排）或字体就绪后清空重来。
// 注意不能只靠「blockHeights 里有没有值」判断要不要量——高度是跨页持久的，
// 若某页是在字体/图片就绪前量的，那份偏小的高度会一直被沿用，导致总高度被低估 → 滚不到底。
const measuredPageIds = new Set<string>();
// 收敛检测：RO 还在改高度就说明模型没稳定（字体刚生效、图片刚撑开），此时不能冻结。
let roActivity = false;
let settleFrames = 0;
let listVersion = 0;
let heightsVersion = 0;

// 估算高度缓存：只有「剥离标签后的文本长度」需要跑正则，故按 (content 引用, type, 缩进) 缓存。
// 每次重算 offsets 都要遍历全篇（1418 块），没缓存就等于每次都对全篇做一遍正则剥离。
const estCache = new Map<string, { raw: string; ty: string; lv: number; h: number }>();
const estimateBlockHeight = (t: Task): number => {
  const raw = t.content || '';
  const lv = t.indentLevel || 0;
  const cached = estCache.get(t.id);
  if (cached && cached.raw === raw && cached.ty === t.type && cached.lv === lv) return cached.h;
  let h = 0;
  switch (t.type) {
    case 'divider': h = 33; break;
    case 'image': {
      // 有真实尺寸时按「内容列宽 × 宽高比」估算（竖版大图不再被估成 520 而严重偏短）；否则回落到 520。
      const ref = t.payload?.url as string | undefined;
      const d = (t.payload?.width && t.payload?.height)
        ? { w: t.payload.width, h: t.payload.height }
        : (ref ? imageDims[ref] : null);
      if (d && d.w > 0) { const CW = 760; const dw = Math.min(d.w, CW); h = Math.round(dw * d.h / d.w) + 10; }
      else h = 520;
      break;
    }
    case 'todo': h = 40; break;
    case 'h1': h = 52; break;
    case 'h2': h = 44; break;
    case 'h3': h = 38; break;
    case 'callout': h = 72; break;
    default: {
      const len = raw.replace(/<[^>]*>/g, '').length;
      h = 24 + Math.max(0, Math.ceil(len / 60) - 1) * 26;
    }
  }
  if (estCache.size > 8000) estCache.clear();
  estCache.set(t.id, { raw, ty: t.type, lv, h });
  return h;
};
const heightOf = (t: Task): number => blockHeights.value[t.id] || estimateBlockHeight(t);

// 前缀和 offsets（offsets[i]=前 i 块高度和），按 (listVersion, heightsVersion) 缓存
let offsetsCache: { lv: number; hv: number; arr: number[] } | null = null;
const buildOffsets = (): number[] => {
  const lv = listVersion, hv = heightsVersion;
  if (offsetsCache && offsetsCache.lv === lv && offsetsCache.hv === hv) return offsetsCache.arr;
  const all = visibleTasks.value;
  const arr = new Array<number>(all.length + 1);
  arr[0] = 0;
  for (let i = 0; i < all.length; i++) arr[i + 1] = arr[i] + heightOf(all[i]);
  offsetsCache = { lv, hv, arr };
  return arr;
};

// 滚动方向：上滑时「上方」要多备货——空白闪现几乎都发生在上滑
// （下滑时内容往下长，视觉上不缺东西；上滑时上方块还没挂载就是实打实的空白）。
let lastScrollTop = 0;
let scrollDirUp = false;
const onEditorScrollDir = (el: HTMLElement) => {
  const t = el.scrollTop;
  if (t < lastScrollTop - 2) scrollDirUp = true;
  else if (t > lastScrollTop + 2) scrollDirUp = false;
  lastScrollTop = t;
};

const recomputeRange = () => {
  if (!virtualScrolling.value) return;
  if (measureAll.value) return; // 量高中：窗口由 stepMeasure 直接控制，别被滚动/RO 打断
  const all = visibleTasks.value;
  const el = scrollEl.value;
  if (!el || all.length === 0) {
    if (vStart.value !== 0 || vEnd.value !== all.length) { vStart.value = 0; vEnd.value = all.length; vTop.value = 0; vBottom.value = 0; }
    return;
  }
  const offsets = buildOffsets();
  const total = offsets[all.length];
  const top = el.scrollTop;
  const bottom = top + el.clientHeight;
  const over = el.clientHeight * VIRTUAL_OVERSCAN;
  const overTop = scrollDirUp ? over * 2 : over;   // 上滑：上方多备一屏
  // 第一个 bottom > top-overTop 的块
  let lo = 0, hi = all.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (offsets[mid + 1] > top - overTop) hi = mid; else lo = mid + 1; }
  const rawStart = lo;
  // 第一个 top >= bottom+over 的块
  lo = rawStart; hi = all.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (offsets[mid] < bottom + over) lo = mid + 1; else hi = mid; }
  const rawEnd = lo;
  // 窗口按 QUANT 个块一档对齐：拖动滚动条时窗口不会每帧都变，
  // 重渲染频率从「每帧一次」降到「每跨越一档一次」，这是滚动丝滑度的关键。
  const start = Math.max(0, Math.floor(rawStart / VIRTUAL_QUANT) * VIRTUAL_QUANT);
  const end = Math.min(all.length, Math.max(Math.ceil(rawEnd / VIRTUAL_QUANT) * VIRTUAL_QUANT, start + VIRTUAL_QUANT));
  const t = offsets[start];
  const b = Math.max(0, total - offsets[end]);
  if (start !== vStart.value || end !== vEnd.value || t !== vTop.value || b !== vBottom.value) {
    vStart.value = start; vEnd.value = end; vTop.value = t; vBottom.value = b;
  }
};

// === Notion 式「先量全篇、后固定滚轮」===
// 之前只有「视口内的块」是实测高度，视口外的全靠估算 → 滚动时估算不断被实测替换，
// 总高度一直变 → 滚轮长度漂移、拖到哪内容就跟着抖（后半段尤其明显）。
// 这里在打开长文档时用一个「滑动测量窗口」把全篇逐块量一遍：每帧挂载一档，量完滑走，
// DOM 常驻数量恒定（不会一次挂载整篇），测得的真实高度留在 blockHeights 里永久生效。
// 量完之后：总高度 = 全篇实测之和，不再变化 → 右侧滚轮长度固定，拖到哪就加载到哪；
// 而渲染仍然只画视口那一档（窗口机制保留，滚动照样快）。
const MEASURE_CHUNK = 200; // 每帧挂载的块数：够大则量得快，够小则单帧不卡死
let measurePos = 0;
let measureWait = 0;
let measureRaf: number | null = null;
const finishMeasure = () => {
  measureRaf = null;
  // 等最后一批 ResizeObserver 把实测高度收上来，再切回正常窗口
  requestAnimationFrame(() => requestAnimationFrame(() => {
    measureAll.value = false;
    heightsFrozen.value = true; // 量完 → 冻结滚动补偿，此后不再因尺寸变化挪动滚动位置
    measuredPageIds.add(activePageId.value); // 本页已量过：再打开直接复用
    recomputeRange();
  }));
};
const stepMeasure = () => {
  const all = visibleTasks.value;
  if (all.length === 0) { finishMeasure(); return; }
  if (measurePos < all.length) {
    const end = Math.min(measurePos + MEASURE_CHUNK, all.length);
    const offsets = buildOffsets();
    vStart.value = measurePos;
    vEnd.value = end;
    vTop.value = offsets[measurePos];
    vBottom.value = Math.max(0, offsets[all.length] - offsets[end]);
    measurePos = end;
    measureRaf = requestAnimationFrame(stepMeasure);
    return;
  }
  // 全篇已挂载过：先等图片宽高比回填，再等高度模型「收敛」，最后才冻结。
  // ①等图片：图片块此刻还没占位会被量成矮块，之后加载又撑高 → 总高度再变，等于白量（最多约 1 秒）。
  const pending = all.some((t) => t.type === 'image' && isAssetRef(t.payload?.url) && !imageDims[t.payload!.url as string]);
  if (pending && measureWait < 60) { measureWait++; measureRaf = requestAnimationFrame(stepMeasure); return; }
  // ②等收敛：RO 还在改高度说明字体刚生效 / 图片刚撑开，模型没稳。
  //   此时冻结会把「偏小的高度」固化下来 → 总高度被低估 → 表现为滚轮滚不到底、拖到底疯狂跳。
  //   连续 3 帧没有高度变化才认为稳了（总帧数设上限，避免死等）。
  if (roActivity) {
    roActivity = false;
    settleFrames = 0;
    if (measureWait < 180) { measureWait++; measureRaf = requestAnimationFrame(stepMeasure); return; }
  }
  if (settleFrames < 3) { settleFrames++; measureRaf = requestAnimationFrame(stepMeasure); return; }
  finishMeasure();
};
const startMeasurePass = () => {
  if (!virtualScrolling.value) { heightsFrozen.value = true; return; } // 整篇挂载模式没有 spacer，无需量高
  if (measureRaf != null) { cancelAnimationFrame(measureRaf); measureRaf = null; }
  const all = visibleTasks.value;
  if (all.length === 0) { measureAll.value = false; heightsFrozen.value = true; recomputeRange(); return; }
  measureAll.value = true;
  heightsFrozen.value = false; // 量高期间允许测高（此时高度模型还没定型）
  // 丢掉本页旧的实测高度：上一轮可能是在字体/图片就绪前量的，那份偏小的高度必须作废，
  // 否则重新量也只是在旧值上「看着没变化」，错误模型照样被冻结沿用。
  for (const t of all) delete blockHeights.value[t.id];
  measurePos = 0;
  measureWait = 0;
  settleFrames = 0;
  roActivity = false;
  measureRaf = requestAnimationFrame(stepMeasure);
};

// 窗口尺寸变化 → 文字重排、块高全变，之前量好的高度模型失效：解冻并重跑一遍量高。
// 防抖 200ms，避免拖拽窗口时反复触发。
let resizeTimer: ReturnType<typeof setTimeout> | null = null;
const onWindowResize = () => {
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    measuredPageIds.clear(); // 宽度变了 → 文字重排，所有页的高度都要重量
    heightsFrozen.value = false;
    startMeasurePass();
  }, 200);
};
window.addEventListener('resize', onWindowResize);
onUnmounted(() => {
  window.removeEventListener('resize', onWindowResize);
  if (resizeTimer) clearTimeout(resizeTimer);
});

// 字体就绪会改变文字度量：若首轮量高发生在字体生效之前，量到的是回退字体的高度（通常偏小），
// 冻结后总高度被低估 → 滚轮滚不到底。字体就绪后作废重来一次（只补一次）。
const onFontsReady = () => {
  if (measuredPageIds.size === 0) return; // 还没量过，正常流程会用就绪后的字体量，无需补
  measuredPageIds.clear();
  heightsFrozen.value = false;
  startMeasurePass();
};
try {
  const f = (document as any).fonts;
  if (f && f.ready && typeof f.ready.then === 'function') f.ready.then(() => onFontsReady()).catch(() => {});
} catch { /* 不支持 FontFaceSet 的浏览器忽略 */ }

// <main> 滚动容器 ref：挂载即算一次窗口（切页时 <main> 重挂载、scrollTop 归零）
const onMainRef = (el: any) => { scrollEl.value = (el as HTMLElement) || null; if (el) recomputeRange(); };
// 把某块滚进视口中上部（键盘/跳转/搜索用）；会把它纳入渲染窗口并挂载
const scrollTaskIntoView = (id: string) => {
  const all = visibleTasks.value;
  const idx = all.findIndex((t) => t.id === id);
  const el = scrollEl.value;
  if (idx < 0 || !el) return;
  const offsets = buildOffsets();
  const blockTop = offsets[idx];
  const blockH = heightOf(all[idx]);
  const viewH = el.clientHeight;
  let target = blockTop - Math.min(80, viewH * 0.2);
  if (blockH > viewH) target = blockTop - 16;
  const maxTop = Math.max(0, offsets[all.length] - viewH);
  el.scrollTop = Math.max(0, Math.min(target, maxTop));
  recomputeRange();
};

// 观测当前挂载块：记录真实高度（量高阶段用），并把一批变化合并为一次 heightsVersion 自增 + 一次 recompute。
//
// 重要：这里**不再写 scrollTop**。此前为了「补偿」而写 scrollTop，与另一条链路闭环成自激振荡：
//   写 scrollTop → 触发 scroll 事件 → 重算窗口 → 新块挂载 → 测高 → 高度变了 → 又写 scrollTop → …
// 表现就是「不动滚轮时，内容和滚动条持续一起上下抖」。
// 用户明确偏好稳定可靠 > 速度：宁可偶尔有一次内容位移，也不要无休止抖动。
// 量高完成后（heightsFrozen）连高度更新也停掉：此时高度模型已完整，再接受 RO 更新只会让
// offsets / 总高度反复微调 → 滚动条长度继续抖。需要重新适应时（切页 / 改窗口 / 结构性增删）再解冻。
const blockRO = new ResizeObserver((entries) => {
  if (heightsFrozen.value) return; // 已量完：高度模型冻结，不再因为观测而改动任何东西
  if (!scrollEl.value) return;
  let changed = false;
  for (const en of entries) {
    const node = en.target as HTMLElement;
    const id = node.getAttribute('data-block-id');
    if (!id) continue;
    const h = node.offsetHeight;
    if (h <= 0) continue;
    if (blockHeights.value[id] === h) continue;
    blockHeights.value[id] = h;
    changed = true;
  }
  if (!changed) return;
  roActivity = true; // 标记「模型还在变」，量高收尾要等它停下来才冻结
  heightsVersion++; // 整批一次，避免多次 O(n) 前缀和重建
  recomputeRange();
});
const observedIds = new Set<string>();
const observeBlocks = () => {
  nextTick(() => {
    const el = scrollEl.value;
    if (!el) return;
    // 只观测新出现的块。此前每次窗口变化都 disconnect + 全量重观测，
    // 拖动滚动条时每帧一遍 O(n)，是长文档滚动掉帧的主力之一。
    const nodes = el.querySelectorAll('[data-block-id]');
    const current = new Set<string>();
    for (const n of nodes) {
      const id = n.getAttribute('data-block-id');
      if (!id) continue;
      current.add(id);
      if (!observedIds.has(id)) { observedIds.add(id); blockRO.observe(n); }
    }
    for (const id of observedIds) if (!current.has(id)) observedIds.delete(id);
  });
};

const windowedTasks = computed(() => virtualScrolling.value ? visibleTasks.value.slice(vStart.value, vEnd.value) : visibleTasks.value);
watch(windowedTasks, () => observeBlocks(), { flush: 'post' });
// 列表/高度版本变化 → 让 offsets 缓存失效并重算窗口
watch(visibleTasks, (cur, prev) => {
  listVersion++;
  // 结构性增删（新建/删除块）：解冻高度模型，让新块能被量到。
  // 纯打字不改变块数，保持冻结 —— 否则每敲一个字都可能触发一轮「测高 → 偏移变 → 窗口动」的抖动。
  if (!prev || cur.length !== prev.length) heightsFrozen.value = false;
  nextTick(() => recomputeRange());
});
// 切页：<main> 重挂载、scrollTop 归零，从顶部重建窗口。
// 若本页还有没量过真实高度的块，先跑一遍「量全篇」，把总高度固定下来（滚轮长度不再变）；
// 已经全量过的页（回头再看）直接建窗口，秒开且不抖动。
watch(activePageId, () => {
  listVersion++;
  nextTick(() => {
    // 本页量过就直接复用（秒开且稳）；没量过才跑量高。
    // 不用「blockHeights 有没有值」判断：高度跨页持久，字体就绪前量出来的偏小值会一直被复用。
    if (measuredPageIds.has(activePageId.value)) { heightsFrozen.value = true; recomputeRange(); }
    else startMeasurePass();
  });
});

// === P3 渐进全挂载（virtualScrolling=false 时的回退形态）===
const INITIAL_RENDER = 80;
const RENDER_CHUNK = 80;
const renderCount = ref(INITIAL_RENDER);
const renderedTasks = computed(() => {
  const all = visibleTasks.value;
  return all.length <= renderCount.value ? all : all.slice(0, renderCount.value);
});
let renderIdleHandle: number | null = null;
const scheduleRenderGrowth = () => {
  if (virtualScrolling.value) return;
  if (renderIdleHandle != null) return;
  const step = () => {
    renderIdleHandle = null;
    const total = visibleTasks.value.length;
    if (renderCount.value >= total) return;
    renderCount.value = Math.min(renderCount.value + RENDER_CHUNK, total);
    scheduleRenderGrowth();
  };
  const ric = (window as any).requestIdleCallback as undefined | ((cb: () => void, o?: { timeout: number }) => number);
  renderIdleHandle = ric ? ric(step, { timeout: 1000 }) : (window.setTimeout(step, 150) as unknown as number);
};
watch(activePageId, () => { renderCount.value = INITIAL_RENDER; }, { immediate: true });
watch(() => !virtualScrolling.value && renderCount.value < visibleTasks.value.length, (need) => { if (need) scheduleRenderGrowth(); }, { immediate: true });

// 最终渲染列表 + 是否显示 spacer
const displayTasks = computed(() => virtualScrolling.value ? windowedTasks.value : renderedTasks.value);
const showSpacers = computed(() => virtualScrolling.value && visibleTasks.value.length > 0);

// 滚动：虚拟模式重算窗口；回退模式按需补挂
// 滚动事件一帧可能触发多次，重算窗口合并到下一帧即可（反正读的是当时的 scrollTop）
let recomputeRaf: number | null = null;
const scheduleRecompute = () => {
  if (recomputeRaf != null) return;
  recomputeRaf = requestAnimationFrame(() => { recomputeRaf = null; recomputeRange(); });
};

const onEditorScroll = (e: Event) => {
  hideFormatToolbar();
  closeCoverPicker();
  if (virtualScrolling.value) {
    const el = e.currentTarget as HTMLElement | null;
    if (el) onEditorScrollDir(el);
    scheduleRecompute();
    return;
  }
  const el = e.currentTarget as HTMLElement | null;
  if (el && el.scrollTop + el.clientHeight >= el.scrollHeight - 600 && renderCount.value < visibleTasks.value.length) {
    renderCount.value = Math.min(renderCount.value + RENDER_CHUNK, visibleTasks.value.length);
  }
};
// 渲染索引 ≠ 数据索引（折叠会跳过块），键盘逻辑必须使用数据索引
const realIndexMap = computed(() => {
  const map = new Map<string, number>();
  // 用 visibleTasks（已剔除折叠与墓碑块），与键盘/光标逻辑看到的数据索引一致
  visibleTasks.value.forEach((t: Task, i: number) => map.set(t.id, i));
  return map;
});
const realIndexOf = (task: Task) => realIndexMap.value.get(task.id) ?? 0;

// 编号列表序号：只累计「同级且相邻」的 numbered 块，遇到其它类型或更浅层级则重置
const getNumberedIndex = (task: Task) => {
  const list = (activePage.value?.tasks ?? []).filter((t: Task) => !t.deletedAt);
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
// 反链：原本是 computed，而它读取了「所有页的所有块内容」，于是每敲一个键都会触发一次全库扫描
// （121 页 / 上万块，实测约 4ms 每次击键）。改为放在 watch 回调里算——watch 回调不收集响应式依赖——
// 只在「切页 / 增删页 / 一次数据提交之后」防抖重建。
const backlinks = ref<Array<{ page: Page; excerpt: string }>>([]);
let backlinksTimer: ReturnType<typeof setTimeout> | null = null;
const rebuildBacklinks = () => {
  const current = activePage.value;
  if (!current) { backlinks.value = []; return; }
  const result: Array<{ page: Page; excerpt: string }> = [];
  for (const p of pages.value) {
    if (p.id === current.id || p.deletedAt) continue;
    if (!getLinkedPageIds(p).includes(current.id)) continue;
    const hit = p.tasks.find((t: Task) => !t.deletedAt && t.content?.includes(`data-page-id="${current.id}"`));
    const plain = (hit?.content ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    result.push({ page: p, excerpt: plain.slice(0, 80) || '（链接）' });
  }
  backlinks.value = result;
};
const scheduleBacklinks = (delay: number) => {
  if (backlinksTimer) clearTimeout(backlinksTimer);
  backlinksTimer = setTimeout(rebuildBacklinks, delay);
};
watch([() => pages.value.length, activePageId], () => scheduleBacklinks(120), { immediate: true });
watch(dataVersion, () => scheduleBacklinks(600));

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
      if (t.deletedAt) continue;
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
        case 'image': {
          const u = String(t.payload?.url ?? '');
          // asset: 引用是本地存储指针，导出无意义，标为占位说明；
          // data:/http: 才可能有实际内容
          if (!u) lines.push('<!-- 未上传图片 -->', '');
          else if (u.startsWith('asset:')) lines.push('<!-- 图片：本地资产，未随文档导出 -->', '');
          else lines.push(`![](${u.slice(0, 80)})`, '');
          break;
        }
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

// === 整库导出为 ZIP（Notion 风格：每篇一个 .md + 图片二进制放进 images/）===
let exportingZip = false;
const exportToast = ref('');
let exportToastTimer: ReturnType<typeof setTimeout> | null = null;
const flashDataMsg = (m: string) => {
  exportToast.value = m;
  if (exportToastTimer) clearTimeout(exportToastTimer);
  exportToastTimer = setTimeout(() => { exportToast.value = ''; }, 3200);
};
const mimeExt = (type: string): string => {
  const m = /image\/(png|jpe?g|gif|webp|svg|bmp|avif)/.exec(type || '');
  if (!m) return 'png';
  const sub = m[1].toLowerCase();
  return sub === 'jpeg' ? 'jpg' : sub;
};
const exportAllMarkdownZip = async () => {
  if (exportingZip) return;
  const live = pages.value.filter((p) => !p.deletedAt);
  if (!live.length) { flashDataMsg('没有可导出的文档'); return; }
  exportingZip = true;
  try {
    const ASSET_RE = /asset:([0-9a-fA-F-]+)/g;
    const usedAssets = new Set<string>();
    const safeName = (t: string) => (t || 'untitled').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'untitled';
    // 与 exportMarkdown 同构，但图片块把 asset 引用写成 ![image](asset:<id>)，交由全局改写
    const pageMdForZip = (p: Page, depth: number): string => {
      const lines: string[] = [`${'#'.repeat(Math.min(depth + 1, 6))} ${p.title || '无标题'}`, ''];
      for (const t of p.tasks) {
        if (t.deletedAt) continue;
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
          case 'image': {
            const u = String(t.payload?.url ?? '');
            if (!u) lines.push('<!-- 未上传图片 -->', '');
            else if (u.startsWith('asset:')) { usedAssets.add(u.slice('asset:'.length)); lines.push(`![image](${u})`, ''); }
            else lines.push(`![](${u.slice(0, 80)})`, '');
            break;
          }
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
    const collect = (parentId: string | null, depth: number): string[] => {
      const out: string[] = [];
      for (const child of live.filter((p) => p.parentId === parentId)) {
        out.push(pageMdForZip(child, depth));
        out.push(...collect(child.id, depth + 1));
      }
      return out;
    };
    const liveIds = new Set(live.map((p) => p.id));
    const roots = live.filter((p) => p.parentId === null || !liveIds.has(p.parentId)); // 含父页已删的孤儿页
    const nameCount = new Map<string, number>();
    const pageFiles: { rel: string; content: string }[] = [];
    for (const root of roots) {
      const body = [pageMdForZip(root, 0), ...collect(root.id, 1)].join('\n\n---\n\n');
      const base = safeName(root.title);
      const n = nameCount.get(base) ?? 0;
      nameCount.set(base, n + 1);
      pageFiles.push({ rel: `pages/${n === 0 ? base : `${base}_${n + 1}`}.md`, content: body });
    }
    // 取回所有引用到的图片二进制
    const assetBlobs = new Map<string, Blob>();
    for (const id of usedAssets) {
      const blob = await getAsset(`asset:${id}`);
      if (blob) assetBlobs.set(`asset:${id}`, blob);
    }
    const rewriteAssets = (content: string): string =>
      content.replace(ASSET_RE, (m) => assetBlobs.has(m) ? `images/${m.slice('asset:'.length)}.${mimeExt(assetBlobs.get(m)!.type)}` : `<!-- 图片缺失: ${m} -->`);
    const enc = new TextEncoder();
    const files: Record<string, Uint8Array> = {};
    for (const pf of pageFiles) files[pf.rel] = enc.encode(rewriteAssets(pf.content));
    for (const [ref, blob] of assetBlobs) {
      files[`images/${ref.slice('asset:'.length)}.${mimeExt(blob.type)}`] = new Uint8Array(await blob.arrayBuffer());
    }
    if (!Object.keys(files).length) { flashDataMsg('没有可导出的内容'); return; }
    const { zipSync } = await import('fflate');
    const zipped = zipSync(files);
    const blob = new Blob([zipped], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nexus-导出-${new Date().toISOString().slice(0, 10)}.zip`;
    a.click();
    URL.revokeObjectURL(url);
    flashDataMsg(`已导出 ${pageFiles.length} 篇文档 / ${assetBlobs.size} 张图片（ZIP）`);
  } finally {
    exportingZip = false;
  }
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

/**
 * 存储初始化：把历史数据从 localStorage 搬到 IndexedDB，确认可用后切换存储。
 *
 * 必须在 initSync 之前调用并 await —— initSync 的 loadLocal() 依赖「当前 store」，
 * 若此时还没切换，就会读到 localStorage 里的旧快照并在之后覆盖掉 IndexedDB 的新数据。
 */
const initStorage = async (): Promise<void> => {
  try {
    const { idbStore, migrateFromLocalStorage, requestPersistence, probeIdb } = await import('../composables/idbStore');
    const { setStore } = await import('../composables/storage');
    await migrateFromLocalStorage(['nexus_matrix_pages_v3', 'nexus_image_provider_keys']);
    // 关键：切换存储前必须真实读写一轮确认可用。
    // 只看异常是不够的——migrateFromLocalStorage 内部会 catch 吞错，
    // 会导致「迁移实际失败却照常切到失效存储」，之后所有写入静默丢失。
    const ok = await probeIdb();
    if (!ok) throw new Error('IndexedDB 读写探针未通过');
    setStore(idbStore);
    await requestPersistence();
    // 探针用的临时键在成功后清掉，避免脏数据
    await idbStore.remove('__nexus_probe__').catch(() => { /* 清理失败无碍 */ });
  } catch (e) {
    // 迁移失败不影响使用：仍留在 localStorage，但必须让用户知道
    console.warn('[NEXUS] IndexedDB 迁移失败，继续使用 localStorage', e);
    setStorageWarning('本地存储降级：数据暂存在 localStorage，存在被系统清理的风险。请及时导出备份。');
  }
};

// hash 恢复等待标记：刷新后若 URL 带 #pageId 但该页还没加载完，先按 hash 等着，
// 期间禁止 activePage 兜底跳到第一篇（否则会把要恢复的页冲掉 → 「刷新后内容变成另一篇」）。
let hashPending = false;

onMounted(async () => {
  // 先捕获原始 hash（在任何兜底/同步改写它之前），并标记「等待按 hash 恢复」。
  // 必须早于 initSync：initSync 装载 pages 的瞬间，activePage 兜底 watch 会因 activePageId
  // 仍是 'default-page' 而跳到第一篇并改写 hash——不提前置 hashPending 就会把要恢复的页冲掉
  // （表现为「刷新后内容变成第一篇文档」）。
  const hash = window.location.hash.slice(1);
  if (hash) hashPending = true;
  // 【关键顺序】存储初始化**必须**在 initSync 之前完成并 await。
  //
  // 历史缺陷：迁移原本放在 initSync 之后「异步不阻塞首屏」，于是 initSync 里的
  // loadLocal() 用的是默认存储 localStorage，读到的是**迁移前的旧快照**；随后
  // setStore(idbStore) 切换，watch 又把这份旧快照写回 IndexedDB，
  // 直接覆盖上次会话存进去的新数据 —— 表现为「重开 App 数据回到旧版本/丢失」。
  // 首屏多等几十毫秒远不如数据正确性重要。
  await initStorage();
  loadRecentPages();   // 载入「最近访问」列表（本地 localStorage）

  // LocalFirst: 读本地 -> 远端握手对齐 -> 建立 WebSocket -> 变更自动持久化+广播
  await initSync(pages as any);
  // 原生壳（Android Compose）只读桥：查询页面/同步状态、反向打开页面
  installNativeBridge(pages as any, activePageId);
  // 刷新后用 hash 恢复「上次选中的页」（hash 已在 onMounted 开头捕获）。若该页尚未就绪
  // （仅经 WS 同步稍后到达），先等着，不跳第一篇——否则表现为「刷新后内容变成另一篇文档」。
  const restoreFromHash = (): boolean => {
    if (hash && pages.value.find(p => p.id === hash)) { activePageId.value = hash; hashPending = false; return true; }
    return false;
  };
  if (!restoreFromHash()) {
    if (!hash) {
      if (pages.value.length > 0) {
        // 跳过已删除（墓碑）页面，避免首屏默认选中墓碑页导致主编辑区空白
        const live = pages.value.find(p => !p.deletedAt) || pages.value[0];
        activePageId.value = live.id;
        window.history.replaceState(null, '', `#${activePageId.value}`);
      }
    } else if (pages.value.length > 0 && !pages.value.find(p => p.id === hash)) {
      // hash 指向的页不存在/已删：放弃等待并显式回退第一篇（不能只靠兜底 watch——activePage 未变化它不会再触发）
      hashPending = false;
      const live = pages.value.find(p => !p.deletedAt) || pages.value[0];
      if (live) { activePageId.value = live.id; window.history.replaceState(null, '', `#${live.id}`); }
    } else {
      // 页还没装载：继续等它到达再恢复（hashPending 已在开头置 true）
      const stop = watch(pages, () => {
        if (restoreFromHash()) { hashPending = false; stop(); return; }
        if (pages.value.length > 0 && !pages.value.find(p => p.id === hash)) {
          hashPending = false; stop();
          const live = pages.value.find(p => !p.deletedAt) || pages.value[0];
          if (live) { activePageId.value = live.id; window.history.replaceState(null, '', `#${live.id}`); }
        }
      }, { flush: 'post' });
    }
  }
  window.addEventListener('hashchange', () => {
     const newHash = window.location.hash.slice(1);
     if (newHash && pages.value.find(p => p.id === newHash)) activePageId.value = newHash;
  });

  // 移动端视图栈初始化：监听形态切换，初始若已恢复出文档则直接进入内容页。
  updateIsMobile();
  window.addEventListener('resize', updateIsMobile);
  // 接管安卓系统/手势返回：内容页→列表页，列表页→退出 App（替代原生默认直接退出）。
  App.addListener('backButton', onBackButton);
  if (isMobile.value && activePage.value) enterContent();

  // 初始同步受控下拉刷新状态（确保原生桥就绪后状态已下发：列表页允许、内容页禁用）
  if (isMobile.value) {
    setNativePullRefresh(mobileView.value === 'list');
    const lel = listScrollRef.value;
    setNativeListAtTop(!lel || lel.scrollTop <= 0);
  }

  // 离场落盘：防抖 500ms 意味着切走/杀进程会丢掉最后一批改动。
  // 移动端 App 切后台极易被回收，这里在隐藏与卸载时强制 flush。
  // pagehide 比 beforeunload 在移动端（iOS Safari / WebView）可靠得多。
  const flush = () => flushPendingSave();
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flush();
      return;
    }
    // 阶段一 1.4：移动端切回前台时自动重连。
    // WebView 切后台 WebSocket 即被系统回收，且重连达上限后会转入「纯本地模式」
    // 等用户手动点——但移动端用户很难发现状态按钮。这里回到前台且处于离线时
    // 自动触发 retrySync()，无需手动干预，保证多端数据联动及时恢复。
    if (syncStatus.value === 'offline') {
      retrySync();
    }
  });

  // 全局点击关闭转换区块浮窗
  const handleGlobalClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    // 点击菜单自身时不关闭（菜单上有 @click.stop / @mousedown.prevent）
    if (target.closest('.action-menu-popup, .action-menu-sheet')) return;
    // 链接弹窗内的点击不触发任何关闭逻辑（否则恢复选区前选区就被清了）
    if (target.closest('.fixed.inset-0.z-\\[60\\]')) return;
    actionMenuConfig.value.isOpen = false;
    // 点击工具栏自身时不关闭，否则按钮的 mousedown 还没执行选区就被清掉了
    if (!target.closest('.format-toolbar')) hideFormatToolbar();
    if (!target.closest('.task-item-container')) clearBlockSelection();
    // 图标选择器自身处理外部点击，这里只兜底页面级关闭
    if (!target.closest('.icon-picker-popup')) closeIconPicker();
    if (!target.closest('.cover-picker-popup')) closeCoverPicker();
  };
  document.addEventListener('mousedown', handleGlobalClick);

  // Escape 键关闭浮窗
  const handleEscape = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    // 移动端内容页优先：Esc 走「返回列表」（与系统返回一致）
    if (isMobile.value && mobileView.value === 'content') { goToList(); return; }
    // 链接弹窗优先：它内部输入框已自行处理 Esc，这里兜底非输入焦点触发的情况
    if (linkDialog.value.visible) { closeLinkDialog(); return; }
    actionMenuConfig.value.isOpen = false;
  };
  document.addEventListener('keydown', handleEscape);
  document.addEventListener('keydown', handleSearchHotkey);

  // 撤销栈基线：初始矩阵入栈，保证第一次 Ctrl+Z 有可回退的状态
  commitHistory();

  // 任何数据变更都记入历史（防抖合并连续输入）；回退期间的变更不入栈。
  // 【性能】这里原本是 watch(pages, ..., { deep: true })，每次击键都要 traverse
  // 全部 156 个页面（实测一次 flush 约 27 万次属性读取）。改为观察 useSync 的
  // dataVersion 计数器：它由「按页订阅」在真正发生变化时递增，零遍历成本。
  watch(dataVersion, () => { if (isRestoring) return; debouncedCommit(); });

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
// P1：把激活页告知 useSync，供 4s 对账只扫这一页（防漏保存的过渡安全网）
watch(activePageId, (id) => setReconcilePage(id), { immediate: true });
// 兜底：激活页无效时（打开了已删除/不存在的页面锚点，或数据异步加载完成前 hash 指向失效），
// 回退到第一个可用页，避免主编辑区空白（移动端侧边栏是默认隐藏的抽屉，空白会更明显）。
// 兜底：激活页无效时（打开了已删除/不存在的页面锚点，或数据异步加载完成前 hash 指向失效），
// 回退到第一个可用页，避免主编辑区空白（移动端侧边栏是默认隐藏的抽屉，空白会更明显）。
// 注意：仅当「当前选中的页确实失效」才回退；不能因 activePage 在数据加载 / 同步替换 pages
// 数组的瞬间短暂为 undefined 就回退，否则会把用户选中的页（含刷新后由 hash 恢复的页）冲掉，
// 表现为「刷新后内容变成另一篇文档」。
watch(activePage, (ap) => {
  if (ap) return;
  if (hashPending) return;   // 正在等 hash 页加载，别跳第一篇把要恢复的页冲掉
  const cur = activePageId.value;
  if (cur && pages.value.some((p) => p.id === cur && !p.deletedAt)) return;
  const live = pages.value.find((p) => !p.deletedAt) || pages.value[0];
  if (live) { activePageId.value = live.id; window.history.replaceState(null, '', `#${live.id}`); }
});

onUnmounted(() => {
  closeSync();
  window.removeEventListener('resize', updateIsMobile);
});

// === Sidebar 树状逻辑 ===
// 墓碑页（deletedAt 非空）从侧边栏隐藏：用户删除后在 UI 上立即消失，
// 但墓碑仍保留在 pages 数组里随同步上推，待其它端消化后再从本地彻底移除。
// 最近访问（Notion 的 Recent）：本地 localStorage 记录、按访问倒序，不同步
const RECENT_PAGES_KEY = 'nexus_recent_pages';
const RECENT_PAGES_MAX = 12;
const recentPageIds = ref<string[]>([]);
const loadRecentPages = () => {
  try {
    const arr = JSON.parse(localStorage.getItem(RECENT_PAGES_KEY) || '[]');
    recentPageIds.value = Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
  } catch { recentPageIds.value = []; }
};
const rememberRecentPage = (id: string) => {
  const next = [id, ...recentPageIds.value.filter((x) => x !== id)].slice(0, RECENT_PAGES_MAX);
  recentPageIds.value = next;
  try { localStorage.setItem(RECENT_PAGES_KEY, JSON.stringify(next)); } catch { /* ignore */ }
};
const recentPages = computed(() =>
  recentPageIds.value.map((id) => pages.value.find((p) => p.id === id && !p.deletedAt)).filter((p): p is Page => !!p)
);
const favoritePages = computed(() => pages.value.filter(p => p.isFavorite && !p.deletedAt));
// 回收站：已打墓碑的页面，按删除时间倒序（最新删除在上）
const trashedPages = computed(() => pages.value.filter(p => p.deletedAt).sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0)));
// 模板页：从侧边栏树隐藏，收进「模板」区
const templatePages = computed(() => pages.value.filter(p => p.isTemplate && !p.deletedAt));
// 后端页的 parentId 可能是显式 null 或干脆缺省字段（前端解析为 undefined），
// 两者都代表「根页面」。用宽松的假值判断，避免 undefined 的根页被侧边栏遗漏。
const getChildren = (parentId: string | null) =>
  pages.value.filter(p => (parentId ? p.parentId === parentId : !p.parentId) && !p.deletedAt && !p.isTemplate);
const hasChildren = (id: string) => pages.value.some(p => p.parentId === id && !p.deletedAt);
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
  // 新建页面默认给一个随机图标：移动端改图标要弹选择器（会被软键盘打断），
  // 默认随机可让绝大多数情况下「根本不用去改图标」。用户仍可随时自定义。
  pages.value.push({ id: newId, title: '', icon: randomEmoji(), tasks: [{ id: newBlockId(), type: 'text', content: '', completed: false, indentLevel: 0 }], parentId, isFavorite: false, isExpanded: true });
  // 维护页面顺序链：新页加入后重写同父级 prevId 链（与块级 writePrevIds 同思路）
  pages.value.splice(0, pages.value.length, ...writePagePrevIds(pages.value));
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
// 阶段一：删除改为**墓碑**，不再真删数组元素。
// 原因：直接 filter 移除 + REST DELETE 会让「已删页」在同步时被远端的下一次
// CLIENT_UPDATE 推回来「复活」——因为服务端原本保留自己独有的页、且 DELETE 不广播。
// 现在给页打 deletedAt 戳，留在 pages 数组里随全量上推：服务端 _merge_pages 按 LWW
// 保留墓碑并广播给其它端；其它端的 mergePages 检测到墓碑会剔除本地副本。
// 侧边栏渲染时过滤掉墓碑页，用户无感；墓碑页直到被所有端同步消化后自然不再可见。
const deletePage = (id: string) => {
   const idsToDelete = new Set([id]); let currentSize = 0;
   while(idsToDelete.size > currentSize) {
       currentSize = idsToDelete.size;
       pages.value.forEach(p => { if (p.parentId && idsToDelete.has(p.parentId)) idsToDelete.add(p.id); });
   }
   const now = Date.now();
   for (const p of pages.value) {
     if (idsToDelete.has(p.id)) p.deletedAt = now;
   }
   // 切换到第一个未删除的页（墓碑页从 UI 隐藏，但保留在数组中供同步）
   const alive = pages.value.filter((p) => !p.deletedAt);
   if (!alive.find(p => p.id === activePageId.value)) activePageId.value = alive[0]?.id || '';
   // 变更经 watch -> stampUpdated + persistPages 上推（携带 deletedAt），无需单独调 REST DELETE
};

// === 回收站（配合墓碑删除：可恢复 / 彻底删除） ===
const trashOpen = ref(false);
const openTrash = () => { trashOpen.value = true; };
const closeTrash = () => { trashOpen.value = false; };

// 恢复：清墓碑戳（stampUpdated 已把 deletedAt 纳入指纹，会自动上推给其它端）。
// 若其父页仍在回收站里，则提到根，避免恢复后父不存在。
const restorePage = (id: string) => {
  const p = pages.value.find((x) => x.id === id);
  if (!p) return;
  if (p.parentId) {
    const parent = pages.value.find((x) => x.id === p.parentId);
    if (!parent || parent.deletedAt) p.parentId = null;
  }
  delete p.deletedAt;
};

// 递归收集某页及其所有子孙页 id
const collectSubtree = (id: string): string[] => {
  const out = [id];
  for (const p of pages.value) if (p.parentId === id) out.push(...collectSubtree(p.id));
  return out;
};

// 彻底删除：从本地数组真删（墓碑此前已上推，其它端会各自消化）
const purgePages = (ids: string[]) => {
  const toDelete = new Set<string>();
  for (const id of ids) for (const x of collectSubtree(id)) toDelete.add(x);
  pages.value = pages.value.filter((p) => !toDelete.has(p.id));
  if (toDelete.has(activePageId.value)) {
    const alive = pages.value.find((p) => !p.deletedAt) || pages.value[0];
    activePageId.value = alive?.id || '';
  }
};
const purgePage = (id: string) => purgePages([id]);
const emptyTrash = () => purgePages(trashedPages.value.map((p) => p.id));

// === 模板 ===
// 把当前页存为模板（从侧边栏树隐藏，进「模板」区；isTemplate 已纳入 pageFingerprint，会自动上推）
const saveAsTemplate = () => {
  if (activePage.value) activePage.value.isTemplate = true;
};
const unmakeTemplate = (id: string) => {
  const p = pages.value.find((x) => x.id === id);
  if (p) p.isTemplate = false;
};
// 用模板新建一个副本页面（深拷贝内容、生成新 id、重建 prevId 链），并跳转过去
const createFromTemplate = (tplId: string) => {
  const tpl = pages.value.find((x) => x.id === tplId);
  if (!tpl) return;
  const newTasks = (tpl.tasks ?? []).map((t) => ({ ...t, id: newBlockId(), prevId: null as string | null }));
  newTasks.forEach((t, i) => { t.prevId = i === 0 ? null : newTasks[i - 1].id; });
  const newId = newPageId();
  pages.value.push({
    id: newId,
    title: tpl.title || '无标题',
    tasks: newTasks,
    parentId: null,
    isFavorite: false,
    isExpanded: true,
    icon: tpl.icon,
    cover: tpl.cover,
    coverPos: tpl.coverPos,
    isTemplate: false,
  });
  selectPage(newId);
};

// === 核心状态与 Refs ===
const inputRefs = ref<Record<string, HTMLElement>>({});
const setInputRef = (el: any, id: string) => {
  if (el) {
    inputRefs.value[id] = el;
    // 元素挂载/复用时立即回填内容。切换页签时旧块卸载、新块创建，此回调必被调用，
    // 可确定性地把 task.content 写入 DOM，避免依赖下方 watch 的 nextTick 竞态导致
    // contenteditable 偶尔显示为空（只剩占位符），即「切换页签内容消失、刷新恢复」的 bug。
    const task = activePage.value?.tasks.find((t: any) => t.id === id);
    if (task && EDITABLE_TYPES.includes(task.type) && el.innerHTML !== task.content) {
      el.innerHTML = task.content;
    }
  } else {
    delete inputRefs.value[id];
  }
};
const focusConfig = ref<{ id: string | null, pos: any }>({ id: null, pos: null });
// 当前获得焦点的文本块（用于对齐 Notion：占位提示只在聚焦/悬停时出现）
const focusedTaskId = ref<string | null>(null);
const onBlockFocus = (id: string) => { focusedTaskId.value = id; setFocusConfig(id, null); };
const onBlockBlur = () => { activeSlashTaskId.value = null; focusedTaskId.value = null; };
// 选中文本后的浮动格式工具栏
const formatToolbar = ref({ visible: false, x: 0, y: 0 });
const hideFormatToolbar = () => { formatToolbar.value.visible = false; colorPanel.value = null; };

// 移动端输入环境（第二期）：软键盘遮挡高度 + 是否触屏
const { keyboardInset, isCoarsePointer } = useMobileInput();

/**
 * 格式工具栏定位：
 * - 触屏：吸底（贴在键盘/屏幕底部之上居中）。跟随选区浮动的方案在手机上必然被键盘吞掉，
 *   Notion 移动端同样是键盘上方工具条。
 * - 桌面：维持原「浮在选区上方/下方」的行为，一像素不变。
 */
const formatToolbarStyle = computed(() => {
  if (isCoarsePointer.value) {
    return {
      bottom: `calc(${keyboardInset.value}px + env(safe-area-inset-bottom, 0px) + 8px)`,
      left: '0px',
      right: '0px',
      marginLeft: 'auto',
      marginRight: 'auto',
      width: 'fit-content',
    };
  }
  return { top: `${formatToolbar.value.y}px`, left: `${formatToolbar.value.x}px` };
});
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
// editEl 非空 = 编辑已有链接；为空 = 由选区新建链接
const linkDialog = ref<{ visible: boolean; url: string; selectedText: string; editEl: HTMLAnchorElement | null }>({ visible: false, url: '', selectedText: '', editEl: null });
let savedLinkRange: Range | null = null;

// 无协议时补 https://，避免生成相对链接
const normalizeHref = (raw: string): string =>
  /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || raw.startsWith('/') || raw.startsWith('#') ? raw : `https://${raw}`;

const openLinkDialog = () => {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  savedLinkRange = sel.getRangeAt(0).cloneRange();
  linkDialog.value = { visible: true, url: '', selectedText: sel.toString().slice(0, 40), editEl: null };
  nextTick(() => linkInputRef.value?.focus());
};
// 从 hover 气泡「编辑」进入：预填当前链接的 href，确认时就地更新而非新建
const openEditLinkDialog = (el: HTMLAnchorElement) => {
  linkDialog.value = { visible: true, url: el.getAttribute('href') || '', selectedText: (el.textContent || '').trim(), editEl: el };
  nextTick(() => linkInputRef.value?.focus());
};
const closeLinkDialog = () => { linkDialog.value.visible = false; savedLinkRange = null; hideFormatToolbar(); };
const confirmLink = () => {
  const raw = linkDialog.value.url.trim();
  const editEl = linkDialog.value.editEl;
  if (!raw || (!editEl && !savedLinkRange)) { closeLinkDialog(); return; }
  const href = normalizeHref(raw);

  // 编辑已有链接：就地更新该 <a>，不再新建
  if (editEl) {
    const external = /^https?:\/\//i.test(href) || (href.startsWith('/') && !href.startsWith('#'));
    if (external) {
      // 改成外链：去掉页内标记，补上新标签打开所需的属性
      editEl.removeAttribute('data-page-id');
      editEl.setAttribute('target', '_blank');
      editEl.setAttribute('rel', 'noopener noreferrer');
    }
    editEl.setAttribute('href', href);
    const blockEl = editEl.closest('.ce-block') as HTMLElement | null;
    if (blockEl?.dataset.taskId) updateTask(blockEl.dataset.taskId, { content: blockEl.innerHTML });
    closeLinkDialog();
    return;
  }

  // 由选区新建链接（原有逻辑）
  const sel = window.getSelection();
  if (sel) { sel.removeAllRanges(); sel.addRange(savedLinkRange!); }
  document.execCommand('createLink', false, href);

  // 同步回数据模型
  const n = sel?.anchorNode;
  const blockEl = ((n && n.nodeType === 3 ? n.parentElement : n as HTMLElement) ?? null)?.closest('.ce-block') as HTMLElement | null;
  if (blockEl) {
    // execCommand 只给裸 <a href>，补上 target/rel：导出、分享、以及将来
    // 任何脱离本组件的渲染都能保持「新标签打开 + 防 tabnabbing」。
    for (const a of Array.from(blockEl.querySelectorAll(`a[href="${href.replace(/"/g, '\\"')}"]`))) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    }
    if (blockEl.dataset.taskId) updateTask(blockEl.dataset.taskId, { content: blockEl.innerHTML });
  }
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

// === 侧边栏页面拖拽（桌面 HTML5 DnD：重排 + 拖改层级，对齐 Notion） ===
const draggedPageId = ref<string | null>(null);
const dragOverPageId = ref<string | null>(null);
const pageDropPosition = ref<'top' | 'bottom' | 'child'>('bottom');

const onPageDragStart = (e: DragEvent, page: Page) => {
  if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', page.id); }
  draggedPageId.value = page.id;
};
const onPageDragOver = (e: DragEvent, page: Page) => {
  if (!draggedPageId.value || draggedPageId.value === page.id) return;
  if (collectSubtree(draggedPageId.value).includes(page.id)) return;  // 不能拖进自己的子孙（成环）
  dragOverPageId.value = page.id;
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const ratio = (e.clientY - rect.top) / rect.height;
  // 上 30% → 插到目标前；下 30% → 插到目标后；中间 40% → 成为目标子页（缩进）
  pageDropPosition.value = ratio < 0.3 ? 'top' : ratio > 0.7 ? 'bottom' : 'child';
};
const onPageDragLeave = (page: Page) => { if (dragOverPageId.value === page.id) dragOverPageId.value = null; };
const onPageDrop = (e: DragEvent, page: Page) => {
  const draggedId = e.dataTransfer?.getData('text/plain') || draggedPageId.value;
  const pos = pageDropPosition.value;
  resetPageDrag();
  if (!draggedId || draggedId === page.id) return;
  movePageTo(draggedId, page.id, pos);
};
const resetPageDrag = () => { draggedPageId.value = null; dragOverPageId.value = null; };

// 触屏：按手指 Y 命中目标页面节点，更新蓝线/子级高亮（复用 top/bottom/child 判定）
const updatePageDropTarget = (clientY: number, dragId: string) => {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-page-node]'));
  for (const el of nodes) {
    const r = el.getBoundingClientRect();
    if (clientY >= r.top && clientY <= r.bottom) {
      const id = el.dataset.pageNode!;
      if (id === dragId || collectSubtree(dragId).includes(id)) { dragOverPageId.value = null; return; }
      dragOverPageId.value = id;
      const ratio = (clientY - r.top) / r.height;
      pageDropPosition.value = ratio < 0.3 ? 'top' : ratio > 0.7 ? 'bottom' : 'child';
      return;
    }
  }
  dragOverPageId.value = null;
};

// 触屏长按拖拽页面（对齐 Notion 移动端）：长按 ~400ms 进入拖拽，轻点仍是选择
const onPageHandleTouchStart = (page: Page, e: TouchEvent) => {
  if (!isCoarsePointer.value) return;
  if ((e.target as HTMLElement).closest('button')) return;  // 行内按钮（收藏/新建/删除）不触发拖拽
  const t0 = e.touches[0];
  if (!t0) return;
  const startY = t0.clientY;
  let fired = false;
  const restore = () => { document.body.style.userSelect = ''; (document.body.style as any).webkitUserSelect = ''; };
  const cleanup = () => {
    window.clearTimeout(timer);
    window.removeEventListener('touchmove', onMove, TOUCH_MOVE_OPTS);
    window.removeEventListener('touchend', onEnd);
    window.removeEventListener('touchcancel', onCancel);
  };
  const timer = window.setTimeout(() => {
    if (fired) return;
    fired = true;
    draggedPageId.value = page.id;
    document.body.style.userSelect = 'none';
    (document.body.style as any).webkitUserSelect = 'none';
    (navigator as any).vibrate?.(15);
    updatePageDropTarget(startY, page.id);
  }, 400);
  const onMove = (ev: TouchEvent) => {
    const ct = ev.touches[0];
    if (!ct) return;
    if (!fired) {
      if (Math.abs(ct.clientY - startY) > 10) cleanup();  // 滚动意图，取消长按（侧边栏本身可滚动）
      return;
    }
    if (ev.cancelable) ev.preventDefault();  // 拖拽中阻止侧边栏滚动
    updatePageDropTarget(ct.clientY, page.id);
  };
  const onEnd = () => {
    const wasFired = fired;
    cleanup();
    if (wasFired) {
      if (dragOverPageId.value && dragOverPageId.value !== page.id) {
        movePageTo(page.id, dragOverPageId.value, pageDropPosition.value);
      }
      resetPageDrag();
      restore();
    } else {
      selectPage(page.id);  // 轻点 → 选择
    }
  };
  const onCancel = () => { cleanup(); if (fired) { resetPageDrag(); restore(); } };
  window.addEventListener('touchmove', onMove, TOUCH_MOVE_OPTS);
  window.addEventListener('touchend', onEnd);
  window.addEventListener('touchcancel', onCancel);
};

// 把 draggedId 移到 targetId 的前/后（同级重排）或其下（改 parentId 成为子页）
const movePageTo = (draggedId: string, targetId: string, pos: 'top' | 'bottom' | 'child') => {
  const list = pages.value;
  const dragged = list.find((p) => p.id === draggedId);
  const target = list.find((p) => p.id === targetId);
  if (!dragged || !target) return;
  if (collectSubtree(draggedId).includes(targetId)) return;  // 成环保护
  const from = list.findIndex((p) => p.id === draggedId);
  if (from < 0) return;
  list.splice(from, 1);
  if (pos === 'child') {
    dragged.parentId = targetId;                 // 成为目标的子页
    const ti = list.findIndex((p) => p.id === targetId);
    list.splice(ti + 1, 0, dragged);             // 紧跟目标 → 其第一个子页
  } else {
    dragged.parentId = target.parentId ?? null;  // 与目标同级（重排）
    const ti = list.findIndex((p) => p.id === targetId);
    list.splice(pos === 'top' ? ti : ti + 1, 0, dragged);
  }
  // 顺序已变：重写整条页面 prevId 链，保证跨端合并时顺序可确定性还原（与块级一致）
  list.splice(0, list.length, ...writePagePrevIds(list));
};

// === 触屏长按拖拽引擎（移动端块排序，对齐 Notion 移动端） ===
// 桌面用原生 HTML5 DnD（见 handleDragStart 等）；触屏无 DnD，改为：
// 手柄长按 ~400ms 进入拖拽 → 手指移动实时高亮目标块（复用桌面蓝线视觉）
// → 松手落位（继承目标缩进 + 重写 prevId 链）。轻点（未长按）仍打开操作菜单。
const TOUCH_MOVE_OPTS: AddEventListenerOptions = { passive: false };
const restoreUserSelect = () => { document.body.style.userSelect = ''; (document.body.style as any).webkitUserSelect = ''; };

// 按手指 Y 命中目标块，更新蓝线指示（复用桌面 dragOverTaskId / dropPosition 视觉）
const updateDropTarget = (clientY: number, dragId: string) => {
  const blocks = Array.from(document.querySelectorAll<HTMLElement>('[data-block-id]'));
  for (const el of blocks) {
    const r = el.getBoundingClientRect();
    if (clientY >= r.top && clientY <= r.bottom) {
      const id = el.dataset.blockId!;
      if (id === dragId) { dragOverTaskId.value = null; return; }
      dragOverTaskId.value = id;
      dropPosition.value = clientY < r.top + r.height / 2 ? 'top' : 'bottom';
      return;
    }
  }
  // 手指超出所有块范围：吸附到首 / 尾
  if (blocks.length) {
    const first = blocks[0], last = blocks[blocks.length - 1];
    if (clientY < first.getBoundingClientRect().top) { dragOverTaskId.value = first.dataset.blockId!; dropPosition.value = 'top'; }
    else if (clientY > last.getBoundingClientRect().bottom) { dragOverTaskId.value = last.dataset.blockId!; dropPosition.value = 'bottom'; }
    else dragOverTaskId.value = null;
  }
};

// 松手落位：把拖动块移到目标前 / 后，继承缩进并重写 prevId 链（与桌面 handleDrop 一致）
const finishTouchDrag = () => {
  const dragId = draggedTaskId.value;
  const overId = dragOverTaskId.value;
  if (dragId && overId && overId !== dragId && activePage.value) {
    const list = activePage.value.tasks;
    const from = list.findIndex((t: Task) => t.id === dragId);
    const target = list.find((t: Task) => t.id === overId);
    if (from > -1 && target) {
      const [item] = list.splice(from, 1);
      const newTo = list.findIndex((t: Task) => t.id === overId);
      item.indentLevel = target.indentLevel;
      list.splice(dropPosition.value === 'top' ? newTo : newTo + 1, 0, item);
      list.splice(0, list.length, ...writePrevIds(list));
    }
  }
  resetDragState();
  restoreUserSelect();
};

const onHandleTouchStart = (task: Task, e: TouchEvent) => {
  if (!isCoarsePointer.value || !activePage.value) return;
  const t0 = e.touches[0];
  if (!t0) return;
  const startX = t0.clientX, startY = t0.clientY;
  let fired = false;
  const cleanup = () => {
    window.clearTimeout(timer);
    window.removeEventListener('touchmove', onMove, TOUCH_MOVE_OPTS);
    window.removeEventListener('touchend', onEnd);
    window.removeEventListener('touchcancel', onCancel);
  };
  const timer = window.setTimeout(() => {
    if (fired) return;
    fired = true;
    draggedTaskId.value = task.id;
    document.body.style.userSelect = 'none';
    (document.body.style as any).webkitUserSelect = 'none';
    (navigator as any).vibrate?.(15);
    updateDropTarget(startY, task.id);
  }, 400);
  const onMove = (ev: TouchEvent) => {
    const ct = ev.touches[0];
    if (!ct) return;
    // 未进入拖拽：移动超过阈值即视为滚动意图，取消长按（不拦截页面滚动）
    if (!fired) {
      if (Math.abs(ct.clientX - startX) > 10 || Math.abs(ct.clientY - startY) > 10) cleanup();
      return;
    }
    // 已进入拖拽：阻止页面滚动并实时更新落点
    if (ev.cancelable) ev.preventDefault();
    updateDropTarget(ct.clientY, task.id);
  };
  const onEnd = (ev: TouchEvent) => {
    const wasFired = fired;
    cleanup();
    if (wasFired) finishTouchDrag();
    else openActionMenuAtTouch(task.id, ev);   // 轻点 → 打开操作菜单
  };
  const onCancel = () => { cleanup(); if (fired) { resetDragState(); restoreUserSelect(); } };
  window.addEventListener('touchmove', onMove, TOUCH_MOVE_OPTS);
  window.addEventListener('touchend', onEnd);
  window.addEventListener('touchcancel', onCancel);
};

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

// 图片资产解析：payload.url 可能是 asset:<id>（新数据）或 data:...（旧数据）或外链。
// 同步命中缓存立即返回；未命中时异步解析并写入缓存，触发模板重渲染。
const assetUrlCache = reactive<Record<string, string>>({});
const resolveAssetUrl = (url: string | undefined): string => {
  if (!url) return '';
  if (!isAssetRef(url)) return url; // 旧 data: 或外链，直接用
  const hit = assetUrlCache[url];
  if (hit) return hit;
  void resolveAsset(url).then((resolved) => {
    if (resolved) assetUrlCache[url] = resolved;
  });
  return '';
};

// 记录图片自然尺寸：写入 imageDims（按 asset 引用聚合），并让 offsets 用新尺寸重算，
// 使虚拟滚动的估算高度更准、滚动条行程稳定（修「拖不到底」）。
const recordImageDims = (ref: string | undefined, w: number, h: number) => {
  if (!ref || w <= 0 || h <= 0) return;
  const cur = imageDims[ref];
  if (cur && cur.w === w && cur.h === h) return;
  imageDims[ref] = { w, h };
  heightsVersion++;
  nextTick(() => recomputeRange());
};
// 图片加载完成：取真实尺寸回填（覆盖导入/未存尺寸的旧图）
const onImgLoad = (ref: string | undefined, e: Event) => {
  const im = e.target as HTMLImageElement;
  if (im && im.naturalWidth > 0) recordImageDims(ref, im.naturalWidth, im.naturalHeight);
};
// 给 <img> 预留「宽高比占位」：尺寸已知时高度在加载前就正确，异步加载不再撑高重排（修行抖动）。
const imageStyle = (ref: string | undefined): Record<string, string> => {
  if (!ref) return {};
  const d = imageDims[ref];
  if (!d || d.w <= 0) return {};
  return { aspectRatio: `${d.w} / ${d.h}`, width: `${d.w}px` };
};

// 当前页所有图片引用预热，确保首屏就有 src；同时预读自然尺寸，让虚拟滚动的估算高度接近真实值
watch(
  () => activePage.value?.tasks,
  (tasks) => {
    if (!tasks) return;
    const refs = tasks
      .filter((t: Task) => t.type === 'image' && isAssetRef(t.payload?.url))
      .map((t: Task) => t.payload!.url as string);
    const cover = activePage.value?.cover;
    if (cover && isAssetRef(cover)) refs.push(cover);
    if (refs.length > 0) {
      void warmAssets(refs);
      // 预读尺寸：每张图解析出 blob URL 后用一次 Image 取 naturalWidth/Height，回填 imageDims。
      // 这样打开长文档时，视口下方未挂载的图片也能拿到真实宽高比 → 估算高度准确 → 滚动条行程稳定（修拖不到底）。
      for (const ref of refs) {
        if (imageDims[ref]) continue;
        void resolveAsset(ref).then((u) => {
          if (!u) return;
          const im = new Image();
          im.onload = () => recordImageDims(ref, im.naturalWidth, im.naturalHeight);
          im.src = u;
        });
      }
    }
  },
  { immediate: true, deep: false },
);

// === 文档图标（Page Icon，对齐 Notion）===
// 一套状态同时服务侧边栏与标题区两个入口；icon 存在 Page 上，三端同步自动继承
const iconPicker = ref<{ pageId: string; anchorEl: HTMLElement | null } | null>(null);

// 设置面板（原生底部 Tab 已移除，设置入口在侧边栏右上角齿轮）
const settingsOpen = ref(false);
const openSettings = (_e?: MouseEvent) => { settingsOpen.value = true; };

// === 历史脏标题清理 ===
// 早先版本导入 Notion ZIP 时把文件名尾部的 32 位 id 一起当成了标题，
// 已导入的页面不会自动受益于新的导入逻辑，这里提供一次性体检 + 清理。
const notionIdTitleCount = computed(
  () => pages.value.filter((p) => !p.deletedAt && hasNotionIdSuffix(p.title ?? '')).length,
);
const cleanNotionIdTitles = () => {
  let n = 0;
  for (const p of pages.value) {
    if (p.deletedAt || !hasNotionIdSuffix(p.title ?? '')) continue;
    p.title = stripNotionId(p.title);
    n++;
  }
  return n;   // 就地改 title，经 pages 的 deep watch -> stampUpdated + 上推同步
};

// === 历史死链修复 ===
// 早期 Notion 导入把页内链接压成了 href="#" 死链（点开是空白页）。
// 这里按「链接文字 → 页面标题」做模糊匹配，把能认出来的还原成真正的页内链接
// （data-page-id），还原的点进来即可在应用内跳转；认不出 / 指向自己的保持原样。
const DEAD_LINK_RE = /<a\b([^>]*?)\bhref\s*=\s*["']#?["']([^>]*?)>([\s\S]*?)<\/a>/gi;
const normalizeTitle = (s: string): string => stripNotionId((s ?? '').trim().toLowerCase());

const deadLinkCount = computed(() => {
  let n = 0;
  for (const p of pages.value) {
    if (p.deletedAt) continue;
    for (const t of p.tasks ?? []) {
      if (!t.content) continue;
      DEAD_LINK_RE.lastIndex = 0;
      while (DEAD_LINK_RE.exec(t.content)) n++;
    }
  }
  return n;
});

const cleanDeadLinks = () => {
  // 标题（已去除 Notion id、转小写）-> 页面 id（同标题取第一个）
  const byTitle = new Map<string, string>();
  for (const p of pages.value) {
    if (p.deletedAt) continue;
    const key = normalizeTitle(p.title ?? '');
    if (key && !byTitle.has(key)) byTitle.set(key, p.id);
  }
  let fixed = 0;
  for (const p of pages.value) {
    if (p.deletedAt) continue;
    for (const t of p.tasks ?? []) {
      if (t.deletedAt || !t.content) continue;
      DEAD_LINK_RE.lastIndex = 0;
      const next = t.content.replace(DEAD_LINK_RE, (_tag, _pre, _post, inner) => {
        const text = inner.replace(/<[^>]+>/g, '').trim();
        const target = byTitle.get(normalizeTitle(text));
        if (!target || target === p.id) return _tag; // 认不出或指向自己则不动
        fixed++;
        return `<a data-page-id="${target}" href="#${target}">${inner}</a>`;
      });
      if (next !== t.content) t.content = next;
    }
  }
  return fixed;   // 就地改 content，经 pages 的 deep watch -> stampUpdated + 上推同步
};

// === 历史重复块清理（导入翻倍导致） ===
// 反复覆盖导入会让同一份内容在服务端并集出多份：块级合并只增不减（见 useSync.mergePages /
// 后端 _tasks_lww 注释），旧块没墓碑就永久残留。这里按「类型 + 纯文本 + 图片 URL」指纹，
// 把每页里重复出现的块标成墓碑（保留首份），随同步上推，服务端据此删除，不再并集成双份。
const duplicateBlockCount = computed(() => {
  let n = 0;
  for (const p of pages.value) {
    if (p.deletedAt) continue;
    const seen = new Set<string>();
    for (const t of p.tasks ?? []) {
      if (t.deletedAt) continue;
      const k = blockContentKey(t);
      if (seen.has(k)) n++;
      else seen.add(k);
    }
  }
  return n;
});

const dedupBlocks = () => {
  let n = 0;
  const now = Date.now();
  const touched = new Set<string>();
  for (const p of pages.value) {
    if (p.deletedAt) continue;
    const seen = new Set<string>();
    let changed = false;
    for (const t of p.tasks ?? []) {
      if (t.deletedAt) continue;
      const k = blockContentKey(t);
      if (seen.has(k)) { t.deletedAt = now; t.updatedAt = now; n++; changed = true; }
      else seen.add(k);
    }
    if (changed) touched.add(p.id);
  }
  // 就地改 deletedAt 不改 id 序列，pages 的 id 签名 watch 不触发，需显式标脏并上推
  if (touched.size > 0) {
    for (const id of touched) markDirty(id);
    flushPendingSave();
  }
  return n;
};

// === 历史重复文档清理（反复导入同一批 ZIP 导致） ===
// 按「标题」分组；组内再按「去重后的唯一块集合」指纹细分：同一份文档被多次导入只会多出
// 内容一致的副本（或仅重复块数量不同），这些"基本相同"的副本自动合并——按封面+图标优先、
// 其次块更多、再其次更新更晚，保留最优一份，其余整页打墓碑随同步删除。
// 标题相同但唯一块集合不同（真·内容不同）的，只各留一份、绝不误删，留给用户人工核对/改名。
// 核心分组/挑选逻辑抽到 importMerge.planDuplicatePages（纯函数，已单测覆盖）。
const duplicateDocPreview = computed(() => {
  const plan = planDuplicatePages(pages.value);
  return { toDelete: plan.toDelete.length, divergentGroups: plan.divergentGroups.length };
});

const duplicateDocCount = computed(() => duplicateDocPreview.value.toDelete);
const divergentDocCount = computed(() => duplicateDocPreview.value.divergentGroups);

const dedupPages = () => {
  const plan = planDuplicatePages(pages.value);
  const now = Date.now();
  let deleted = 0;
  const touched = new Set<string>();
  const byId = new Map(pages.value.map((p) => [p.id, p]));
  for (const id of plan.toDelete) {
    const p = byId.get(id);
    if (!p || p.deletedAt) continue;
    p.deletedAt = now; p.updatedAt = now; deleted++; touched.add(id);
  }
  if (touched.size > 0) {
    for (const id of touched) markDirty(id);
    flushPendingSave();
  }
  return { deleted, divergentGroups: plan.divergentGroups.length };
};

// === 误杀块恢复（清理重复块旧指纹把不同代码块当重复误杀的事故修复） ===
const wronglyKilledCount = computed(() => planWronglyKilledBlocks(pages.value).total);

const restoreWronglyKilledBlocks = () => {
  const { byPage, total } = planWronglyKilledBlocks(pages.value);
  if (total === 0) return 0;
  const now = Date.now();
  const byId = new Map(pages.value.map((p) => [p.id, p]));
  for (const [pid, ids] of byPage) {
    const p = byId.get(pid);
    if (!p) continue;
    const want = new Set(ids);
    let changed = false;
    for (const t of p.tasks ?? []) {
      if (!t.deletedAt || !want.has(t.id)) continue;
      t.deletedAt = undefined; t.updatedAt = now; // 清墓碑并抬高 updatedAt，LWW 下复活覆盖服务端墓碑
      changed = true;
    }
    if (changed) markDirty(p.id);
  }
  flushPendingSave();
  return total;
};

// === 页面级「···」菜单（对齐 Notion：页面操作收敛到内容页右上角） ===
const pageMenuConfig = ref<{ isOpen: boolean; x: number; y: number }>({ isOpen: false, x: 0, y: 0 });
const openPageMenu = (e: MouseEvent) => {
  e.stopPropagation();
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  pageMenuConfig.value = { isOpen: true, x: rect.left, y: rect.bottom + 4 };
};
const closePageMenu = () => { pageMenuConfig.value.isOpen = false; };

// 反向链接面板（复用已有 backlinks computed：引用了当前页的其它页面）
const backlinksOpen = ref(false);
const openBacklinks = () => { backlinksOpen.value = true; };
const closeBacklinks = () => { backlinksOpen.value = false; };

// === 页面历史版本面板（本地快照，可恢复 / 删除） ===
const historyOpen = ref(false);
const historyPageId = ref<string | null>(null);
const pageVersions = ref<PageVersion[]>([]);
const openPageHistory = async () => {
  if (!activePage.value) return;
  historyPageId.value = activePage.value.id;
  pageVersions.value = await getPageHistory(activePage.value.id);
  historyOpen.value = true;
};
const closePageHistory = () => { historyOpen.value = false; };
// 任一「菜单 / 模态」浮层打开时，锁定背景（主编辑区 + 侧边栏）滚动，
// 避免鼠标在浮层外滚轮时背景跟着滑（对齐 Notion：弹出菜单后背景不滚动）。
// 浮层自身是 fixed 独立容器、自带滚动，不受影响；小下拉（slash/mention/格式栏）不纳入，避免影响编辑滚动。
const overlayOpen = computed(() =>
  actionMenuConfig.value.isOpen ||
  pageMenuConfig.value.isOpen ||
  settingsOpen.value ||
  importWizardOpen.value ||
  trashOpen.value ||
  historyOpen.value ||
  backlinksOpen.value
);
// 用历史快照覆盖当前页（深拷贝，触发 watch -> stampUpdated -> 上推同步）
const restoreVersion = (v: PageVersion) => {
  if (!activePage.value) return;
  activePage.value.title = v.title;
  activePage.value.tasks = JSON.parse(JSON.stringify(v.tasks));
  historyOpen.value = false;
};
const deleteVersion = async (ts: number) => {
  if (!historyPageId.value) return;
  pageVersions.value = await deletePageVersion(historyPageId.value, ts);
};
const clearHistory = async () => {
  if (!historyPageId.value) return;
  await clearPageHistory(historyPageId.value);
  pageVersions.value = [];
};
const formatVersionTime = (ts: number): string => {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// === Notion 导入向导（预览式：先解析展示页面树，勾选确认后再导入） ===
const importWizardOpen = ref(false);
const importFileInput = ref<HTMLInputElement | null>(null);
const importPreview = ref<{ pages: Page[]; report: Array<{ title: string; blocks: number; images: number; downgraded: number }>; imageFailures: number; imageVerifyFailures: number; verifyFailures: Array<{ title: string; block: number }>; sources: Array<{ file: string; count: number; error?: string }> } | null>(null);
const importGroups = ref<Array<{ file: string; pages: Page[]; error?: string }>>([]);  // 多文件按来源分组预览
const importLoading = ref(false);
const importWizardMsg = ref('');
const importSelected = ref<Set<string>>(new Set());
const importConflictIds = ref<Set<string>>(new Set());  // 与现有存活页同名的待导入页（默认不勾选，避免盲目创建重复）
const importOverwrite = ref(false);  // 覆盖同名页：重新导入时用它「修好已有的那一页」而不是再建副本
// 图片质量：'original' 原样落库，'compressed' 缩放+重编码。持久化，免得每次都要重新选。
const IMPORT_MODE_KEY = 'nexus_import_image_mode';
const importImageMode = ref<'original' | 'compressed'>(
  (() => { try { return localStorage.getItem(IMPORT_MODE_KEY) === 'original' ? 'original' : 'compressed'; } catch { return 'compressed'; } })(),
);
const setImportImageMode = (m: 'original' | 'compressed') => {
  importImageMode.value = m;
  try { localStorage.setItem(IMPORT_MODE_KEY, m); } catch { /* 配额满：本次会话内仍生效 */ }
};
// 导入结果摘要：导入完成后展示「进了什么 + 哪几张没成」，替代一句一闪而过的 toast
const importResult = ref<null | {
  pages: number; blocks: number; overwritten: number; reclaimed: number; recovered: number; pending: number;
  roots: Array<{ id: string; title: string; blocks: number }>;
  issues: Array<{ title: string; block: number; pageId: string; taskId: string }>;
}>(null);
// 侧边栏/正文的临时高亮：告诉用户「这批是刚进来的」「就是这一块」
const highlightPageIds = ref<Set<string>>(new Set());
const highlightTaskId = ref<string | null>(null);
let highlightTimer: ReturnType<typeof setTimeout> | null = null;
const armHighlight = () => {
  if (highlightTimer) clearTimeout(highlightTimer);
  highlightTimer = setTimeout(() => {
    highlightPageIds.value = new Set();
    highlightTaskId.value = null;
  }, 3000);
};

const openNotionImportWizard = () => {
  settingsOpen.value = false;   // 先关设置面板，避免其盖在导入向导之上
  importWizardOpen.value = true;
  importPreview.value = null;
  importGroups.value = [];
  importSelected.value = new Set();
  importConflictIds.value = new Set();
  importOverwrite.value = false;
  importResult.value = null;
  importWizardMsg.value = '';
};
const closeNotionImportWizard = () => {
  importWizardOpen.value = false;
  importPreview.value = null;
  importResult.value = null;
  importLoading.value = false;
  importWizardMsg.value = '';
};
const onImportFilePicked = async (e: Event) => {
  const input = e.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = '';
  if (files.length === 0) return;
  importLoading.value = true;
  importWizardMsg.value = files.length > 1 ? `正在解析 ${files.length} 个 ZIP…` : '正在解析 ZIP…';
  // 逐个解析（支持一次多选多个 Notion 导出 zip），按来源分组；单个失败不影响其余
  const groups: Array<{ file: string; pages: Page[]; error?: string }> = [];
  let imageFailures = 0;
  let imageVerifyFailures = 0;
  const verifyFailures: Array<{ title: string; block: number }> = [];
  for (const file of files) {
    const res = await previewNotionZip(file, { imageMode: importImageMode.value });
    if (res.ok && res.pages && res.pages.length > 0) {
      groups.push({ file: file.name, pages: res.pages });
      imageFailures += res.imageFailures ?? 0;
      imageVerifyFailures += res.imageVerifyFailures ?? 0;
      if (res.verifyFailures) verifyFailures.push(...res.verifyFailures);
    } else {
      groups.push({ file: file.name, pages: [], error: res.message || '未找到可导入内容' });
    }
  }
  const allPages = groups.flatMap((g) => g.pages);
  importLoading.value = false;
  if (allPages.length === 0) {
    importPreview.value = null;
    importGroups.value = groups;
    importWizardMsg.value = '未从所选 ZIP 解析出可导入的页面';
    return;
  }
  importPreview.value = {
    pages: allPages,
    report: [],
    imageFailures,
    imageVerifyFailures,
    verifyFailures,
    sources: groups.map((g) => ({ file: g.file, count: g.pages.length, error: g.error })),
  };
  importGroups.value = groups;
  // 文档级去重预览：标题（去大小写/空白）或「标题+内容」指纹与现有页/已选页重复的，标记「已存在」
  // 并默认不勾选——避免反复导入同一批 zip 时又默默造出副本。空标题不参与（都允许导入）。
  const seenTitles = new Set<string>();
  const seenFp = new Set<string>();
  for (const p of pages.value) {
    if (p.deletedAt) continue;
    seenTitles.add((p.title || '').trim().toLowerCase());
    seenFp.add(docFingerprint(p));
  }
  const conflict = new Set<string>();
  for (const p of allPages) {
    const t = (p.title || '').trim().toLowerCase();
    const fp = docFingerprint(p);
    if (!t) continue;                 // 空标题不参与去重（都允许导入）
    if (seenFp.has(fp) || seenTitles.has(t)) conflict.add(p.id);
    else { seenTitles.add(t); seenFp.add(fp); }
  }
  importConflictIds.value = conflict;
  // 默认勾选：同名冲突页不勾；**祖先里有冲突页的整棵子树也不勾**——
  // 否则子页导进来 parentId 指向一个没导入的父页，在侧边栏里是隐形的。
  const defaultSel = new Set<string>();
  for (const p of allPages) {
    if (conflict.has(p.id)) continue;
    if (importAncestorIds(p.id).some((a) => conflict.has(a))) continue;
    defaultSel.add(p.id);
  }
  importSelected.value = defaultSel;
  importWizardMsg.value = '';
};
// 依据 parentId 计算某页在预览树里的深度（带环保护）
const importDepth = (p: Page): number => {
  if (!importPreview.value) return 0;
  const byId = new Map(importPreview.value.pages.map((x) => [x.id, x]));
  let d = 0;
  let cur: Page | undefined = p;
  const guard = new Set<string>();
  while (cur?.parentId && byId.has(cur.parentId) && !guard.has(cur.id)) {
    guard.add(cur.id);
    d++;
    cur = byId.get(cur.parentId);
  }
  return d;
};
// 以当前预览树为准，取某页的整棵子树（含自身）。勾选/取消都要沿树级联，
// 否则「父没选、子选了」导入后 parentId 指向不存在的页 → 在侧边栏树里永远不显示。
const importSubtreeIds = (id: string): string[] => {
  const pages = importPreview.value?.pages ?? [];
  const byParent = new Map<string, Page[]>();
  for (const p of pages) {
    const k = p.parentId ?? '';
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k)!.push(p);
  }
  const out: string[] = [];
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    out.push(cur);
    for (const c of byParent.get(cur) ?? []) stack.push(c.id);
  }
  return out;
};
// 某页的全部祖先 id（自下而上，带环保护）
const importAncestorIds = (id: string): string[] => {
  const byId = new Map((importPreview.value?.pages ?? []).map((p) => [p.id, p]));
  const out: string[] = [];
  let cur = byId.get(id);
  const guard = new Set<string>();
  while (cur?.parentId && byId.has(cur.parentId) && !guard.has(cur.id)) {
    guard.add(cur.id);
    out.push(cur.parentId);
    cur = byId.get(cur.parentId);
  }
  return out;
};
const toggleImportSelect = (id: string) => {
  const willCheck = !importSelected.value.has(id);
  const s = new Set(importSelected.value);
  if (willCheck) {
    for (const x of importSubtreeIds(id)) s.add(x);
    // 勾子必须连祖先一起勾：只勾子页的话，导进来就是侧边栏里看不见的孤儿
    for (const a of importAncestorIds(id)) s.add(a);
  } else {
    for (const x of importSubtreeIds(id)) s.delete(x);
  }
  importSelected.value = s;
};
// 让导入的页面在侧边栏「看得见」：展开自身与整条父链 + 短暂高亮 + 滚动进视口。
// 它们被追加在私人列表末尾，不做这一步的话用户根本看不到新内容落在哪。
const revealImportedPages = (ids: string[]) => {
  if (ids.length === 0) return;
  for (const id of ids) {
    let cur = pages.value.find((p) => p.id === id);
    let guard = 0;
    while (cur && guard++ < 50) {
      cur.isExpanded = true;
      cur = cur.parentId ? pages.value.find((p) => p.id === cur!.parentId) : undefined;
    }
  }
  highlightPageIds.value = new Set(ids);
  armHighlight();
  nextTick(() => {
    document.querySelector(`[data-page-node="${ids[0]}"]`)?.scrollIntoView({ block: 'nearest' });
  });
};
// 从结果摘要跳到某个导入页
const gotoImportedPage = (id: string) => {
  closeNotionImportWizard();
  if (id) selectPage(id);
};
// 从「第 N 块没存上」跳到具体那一块并高亮
const gotoImportIssue = (iss: { pageId: string; taskId: string }) => {
  closeNotionImportWizard();
  if (!iss.pageId) return;
  selectPage(iss.pageId);
  if (!iss.taskId) return;
  nextTick(() => {
    scrollTaskIntoView(iss.taskId);
    highlightTaskId.value = iss.taskId;
    armHighlight();
  });
};
// 覆盖同名页开关：连带把「已存在」的那几页（含其子树）选上/取消——
// 勾了却没选它们的话什么也不会发生，是最容易让人以为「重新导入没生效」的坑。
// 子树也要一起：只覆盖父页的话，子页还是旧内容。
const toggleImportOverwrite = () => {
  importOverwrite.value = !importOverwrite.value;
  const s = new Set(importSelected.value);
  for (const id of importConflictIds.value) {
    for (const x of importSubtreeIds(id)) {
      if (importOverwrite.value) s.add(x);
      else s.delete(x);
    }
  }
  importSelected.value = s;
};
const toggleImportSelectAll = () => {
  if (!importPreview.value) return;
  importSelected.value = importSelected.value.size === importPreview.value.pages.length
    ? new Set()
    : new Set(importPreview.value.pages.map((p) => p.id));
};
const confirmNotionImport = async () => {
  if (!importPreview.value) return;
  const chosen = importPreview.value.pages.filter((p) => importSelected.value.has(p.id));
  if (chosen.length === 0) { importWizardMsg.value = '请先勾选要导入的页面'; return; }
  importLoading.value = true;
  const res = await commitImportPages(chosen, { overwriteSameTitle: importOverwrite.value, imageMode: importImageMode.value });
  importLoading.value = false;
  if (res.ok) {
    // 展开 + 高亮 + 滚动，让新内容在侧边栏里看得见
    revealImportedPages(res.importedIds);
    // 有覆盖、或有没落库的图，就留在结果面板里说清楚；全绿才直接关掉，不打扰。
    // 覆盖过也要展示：否则用户无从知道「覆盖到底生效没有」（覆盖 0 个 = 其实一份都没匹配上）。
    if (res.overwritten > 0 || res.imageVerifyFailures > 0 || res.pending > 0) {
      importResult.value = {
        pages: chosen.length,
        blocks: res.blocks,
        overwritten: res.overwritten,
        reclaimed: res.reclaimed,
        recovered: res.recovered,
        pending: res.pending,
        roots: res.roots,
        issues: res.verifyFailures,
      };
      importPreview.value = null; // 已导入：清掉预览，避免重复提交
      importGroups.value = [];
      importWizardMsg.value = '';
    } else {
      closeNotionImportWizard();
    }
    // 跳转必须用**最终落地 id**：覆盖模式下导入时的临时 id 已被旧页 id 取代，
    // 拿临时 id 去 selectPage 会命中「页面不存在」的兜底 → 表现就是跳到私人列表第一篇。
    const target = res.rootId ?? chosen[0]?.id ?? null;
    if (target) selectPage(target);
  } else {
    importWizardMsg.value = res.message;
  }
};

const openIconPicker = (pageId: string, e: MouseEvent) => {
  e.stopPropagation();
  if (iconPicker.value?.pageId === pageId) { iconPicker.value = null; return; }
  // 触屏：先收掉软键盘再打开选择器。
  // 否则正文 contenteditable 仍持有焦点，键盘不收，选择器会被顶到屏幕外。
  if (isCoarsePointer.value) {
    (document.activeElement as HTMLElement | null)?.blur();
  }
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

// === 页眉封面（Page Cover，对齐 Notion）===
// cover 存的是图片 URL/DataURL，或 `gradient:<id>` 标记（零存储成本的渐变色）
const coverAnchorEl = ref<HTMLElement | null>(null);
const coverTouched = ref(false); // 触屏：点击封面上浮操作条

const coverStyle = (cover: string) => {
  if (cover.startsWith('gradient:')) {
    const g = COVER_GRADIENTS.find((x) => x.id === cover.slice('gradient:'.length));
    return { background: g ? g.css : 'rgb(var(--panel))' };
  }
  // object-position 的 y 由 coverPos 驱动（0=顶部 100=底部），x 固定居中。
  // 默认 35 而非 50：竖构图人像的主体（脸部）通常位于画面上部，
  // 居中裁切会把头顶切掉、下半身占比过大。35 是兼顾人像与风景的经验值。
  const posY = activePage.value?.coverPos ?? 35;
  // asset: 引用需先解析成 blob: URL；未命中缓存时返回空串，
  // 由 warmAssets 异步解析后触发重渲染（模板依赖 assetUrlCache 的响应性）
  const src = isAssetRef(cover) ? resolveAssetUrl(cover) : cover;
  return {
    backgroundImage: src ? `url("${src}")` : undefined,
    backgroundSize: 'cover',
    backgroundPosition: `center ${posY}%`,
  };
};

// 封面的自然宽高比。图片是 DataURL/远程 URL，无法从字段直接得知，
// 故预加载一次读取 naturalWidth/naturalHeight（仅请求一次，浏览器有缓存）。
const coverNatural = ref<{ w: number; h: number } | null>(null);
watch(
  () => activePage.value?.cover,
  (cover) => {
    coverNatural.value = null;
    if (!cover || cover.startsWith('gradient:')) return;
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) coverNatural.value = { w: img.naturalWidth, h: img.naturalHeight };
    };
    img.src = cover;
  },
  { immediate: true },
);

// 封面高度：按图片自然比例推算，clamp 在 200~420px。
// 渐变无自然比例，用固定 240px。
// 效果：横幅全景图 → 矮（不浪费纵向空间）；竖构图人像 → 高（能容纳更多身体，而非只露头）。
const coverHeight = computed(() => {
  const n = coverNatural.value;
  if (!n) return 240;
  // 内容列宽度未知（全出血），用窗口宽度近似；clamp 保证任何视口下都不失控
  const approxW = Math.min(window.innerWidth, 1600);
  const h = Math.round(approxW / (n.w / n.h));
  return Math.max(200, Math.min(420, h));
});

// 拖动重新取景：把垂直拖拽距离映射到 coverPos（0~100）
const coverDragging = ref(false);
let coverDragStart: { y: number; pos: number } | null = null;
const startCoverDrag = (e: { clientY: number }) => {
  if (!activePage.value) return;
  coverDragStart = { y: e.clientY, pos: activePage.value.coverPos ?? 35 };
  coverDragging.value = true;
  const onMove = (ev: MouseEvent | TouchEvent) => {
    if (!coverDragStart) return;
    const y = 'touches' in ev && ev.touches.length > 0 ? ev.touches[0].clientY : (ev as MouseEvent).clientY;
    const dy = y - coverDragStart.y;
    // 120px 拖拽 = 全范围，兼顾精细与效率
    // 方向：向下拖(dy>0) 图片跟手向下移 → 露出更上部 → coverPos 减小（0=顶 100=底）。
    // 修复：原先用 +，导致向下拖图片反而上移，与「按住图片拖动」的手势相反。
    const next = Math.max(0, Math.min(100, coverDragStart.pos - (dy / 120) * 100));
    if (activePage.value) activePage.value.coverPos = Math.round(next);
  };
  const onUp = () => {
    coverDragging.value = false;
    coverDragStart = null;
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend', onUp);
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('touchend', onUp);
};

const openCoverPicker = (e: MouseEvent) => {
  e.stopPropagation();
  coverAnchorEl.value = (e.currentTarget as HTMLElement) ?? null;
};
const closeCoverPicker = () => { coverAnchorEl.value = null; };
const setCover = (cover: string, credit?: { author: string; authorUrl: string; source: string; sourceUrl: string }) => {
  if (activePage.value) {
    activePage.value.cover = cover;
    // 换图时重置取景点，避免沿用上一张图的构图偏移
    activePage.value.coverPos = undefined;
  }
  coverCredit.value = credit ?? null; // 渐变/本地上传无署名
  closeCoverPicker();
};
// 署名信息：图库选图时附带保存（Unsplash 的硬性合规要求）
const coverCredit = ref<{ author: string; authorUrl: string; source: string; sourceUrl: string } | null>(null);
const removeCover = () => {
  if (activePage.value) { activePage.value.cover = undefined; activePage.value.coverPos = undefined; }
  coverTouched.value = false;
  closeCoverPicker();
};

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

// 状态同步（DOM <- 数据）
// 原本是 watch(activePage.tasks, ..., { deep: true })：每次击键都要深遍历整份 tasks
// （基准页 1418 块，逐属性登记依赖），回调还要遍历全部块做 innerHTML 比对——是击键耗时的大头之一。
// 打字路径本身是「DOM -> 数据」，并不需要回写；真正需要回写的只有「代码改了 content 却没动 DOM」
// 的场景（斜杠命令清空、@ 页面链接插入、块类型转换、撤销/恢复/远端合并），而这些块必然是已挂载的块。
// 因此只订阅「已挂载块的 content 快照」，并按下标比对，只对内容真的变了的块读一次 innerHTML。
// 上次同步时的渲染窗口。窗口滑动导致的 displayTasks 变化要跳过同步：
// 这些块是 Vue 刚渲染出来的，DOM 本来就对；而 contenteditable 的 HTML 规范化
// 会让 el.innerHTML !== task.content 恒成立 → 反复回写 → 反复触发 ResizeObserver
// → 总高度不停变 → 滚动条持续抖动。
let lastSyncWindowKey = '';
const syncDomFromTasks = (cur?: string[], prev?: string[]) => {
  nextTick(() => {
    if (prev && cur) {
      const key = `${vStart.value}:${vEnd.value}`;
      if (lastSyncWindowKey !== key) { lastSyncWindowKey = key; return; }
    }
    const list = displayTasks.value;
    for (let i = 0; i < list.length; i++) {
      if (prev && cur && prev.length === cur.length && prev[i] === cur[i]) continue;
      const task = list[i];
      const el = inputRefs.value[task.id];
      if (el && el.innerHTML !== task.content && EDITABLE_TYPES.includes(task.type)) el.innerHTML = task.content;
    }
  });
};
watch(
  () => displayTasks.value.map((t: Task) => t.content),
  (cur, prev) => syncDomFromTasks(cur, prev),
  { immediate: true }
);
// 切页：整页 DOM 重建，prev 为空则全量比对一次
watch(activePageId, () => syncDomFromTasks());

// 设置焦点到指定行的指定位置
const setFocusConfig = (id: string | null, pos: any) => {
  focusConfig.value = { id, pos };
};

watch(focusConfig, (newVal) => {
  if (!newVal.id) return;
  const id = newVal.id;
  const attempt = (): boolean => {
    // 静默窗口内不抢焦点（刚进入文档页）；返回 true 以阻止后续延迟重试再聚焦。
    if (Date.now() < suppressAutoFocusUntil) return true;
    const el = inputRefs.value[id];
    if (el) { el.focus(); if (newVal.pos !== null) setCaretPosition(el, newVal.pos); return true; }
    return false;
  };
  nextTick(() => {
    if (attempt()) return;
    // 目标块未挂载：虚拟滚动先把它滚进视口（纳入窗口并挂载）；回退模式则扩大渲染范围
    if (virtualScrolling.value) {
      scrollTaskIntoView(id);
    } else {
      const all = visibleTasks.value;
      const idx = all.findIndex((t: Task) => t.id === id);
      if (idx >= renderCount.value) renderCount.value = Math.min(idx + 1 + RENDER_CHUNK, all.length);
    }
    nextTick(() => attempt());
  });
}, { deep: true });

// === 高级交互逻辑 (Block CRUD & Nested & Multimedia) ===
const updateTask = (id: string, updates: Partial<Task>) => {
  if (!activePage.value) return;
  const task = activePage.value.tasks.find((t: Task) => t.id === id);
  if (task) {
    Object.assign(task, updates);
    markDirty(activePage.value.id);   // P1：显式标记本页为脏（替代原先每页 deep watch 的隐式触发）
  }
};
const deleteTask = (id: string) => { if (!activePage.value) return; activePage.value.tasks = activePage.value.tasks.filter((t: Task) => t.id !== id); };

// 当前「激活」的多媒体块（图片等）：用于触屏无 hover 时仍能显示操作浮层
const selectedMediaId = ref<string | null>(null);

// 图片全屏预览（触屏双击放大查看）
const previewImageUrl = ref<string | null>(null);
const openImagePreview = (url: string) => { previewImageUrl.value = url; };
const closeImagePreview = () => { previewImageUrl.value = null; };
// 放大是显式入口了，就得能顺手退出：Esc 关闭（捕获阶段拦截，避免被别的浮层逻辑抢走）
const onPreviewKeydown = (e: KeyboardEvent) => {
  if (e.key !== 'Escape') return;
  e.stopPropagation();
  closeImagePreview();
};
watch(previewImageUrl, (v) => {
  if (v) window.addEventListener('keydown', onPreviewKeydown, true);
  else window.removeEventListener('keydown', onPreviewKeydown, true);
});


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

  // 删除图片块时同步清掉资产，否则 IndexedDB 会无限堆积孤儿图片
  if (task.type === 'image' && isAssetRef(task.payload?.url)) {
    void deleteAsset(task.payload.url);
  }

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
// 上下移动块（Cmd/Ctrl + Shift + ↑/↓ / 移动端菜单上移下移）
const moveBlock = (index: number, dir: number) => {
  if (!activePage.value) return;
  const list = activePage.value.tasks;
  const target = index + dir;
  if (index < 0 || target < 0 || target >= list.length) return;
  const [item] = list.splice(index, 1);
  list.splice(target, 0, item);
  // 顺序已变：重写整条 prevId 链，保证三端合并时块顺序一致。
  // 修复：原先只裸 splice，移动后 prevId 链错乱，多端同步时块顺序会乱。
  list.splice(0, list.length, ...writePrevIds(list));
};

// 调整块缩进层级（向右 +1 / 向左 -1）。移动端无 Tab 键盘，靠菜单按钮触发；
// 约束与桌面 Tab 完全一致：不能比上一块深超过 1 级，且不能小于 0。
const changeIndent = (task: Task, dir: 1 | -1) => {
  const list = activePage.value?.tasks ?? [];
  const index = list.findIndex((t: Task) => t.id === task.id);
  if (index < 0) return;
  const cur = task.indentLevel || 0;
  if (dir < 0) {
    if (cur > 0) updateTask(task.id, { indentLevel: cur - 1 });
  } else if (index > 0) {
    const prevTask = list[index - 1];
    const maxIndent = (prevTask.indentLevel || 0) + 1;
    if (cur < maxIndent) updateTask(task.id, { indentLevel: cur + 1 });
  }
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

// 把图片文件插入为独立图片块（存为独立资产，页面只留 asset: 引用），
// 并在其后补一个空文本块供继续输入。
// 粘贴与拖拽共用此函数，保证两条路径的块结构、prevId 链、焦点行为一致。
const insertImageBlock = (file: File, afterIndex: number) => {
  if (!activePage.value) return;
  void saveImageAsset(file).then((url) => {
    const list = activePage.value?.tasks;
    if (!list || !url) return;

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
    void resolveAsset(url).then((u) => { if (u) assetUrlCache[url] = u; });
  });
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
    // 存为独立资产，页面里只留 asset: 引用——
    // Base64 会让整页广播 payload、撤销快照、localStorage 全部暴涨
    void saveImageAsset(file).then((ref) => {
      updateTask(taskId, { payload: { url: ref } });
      void resolveAsset(ref).then((u) => { if (u) assetUrlCache[ref] = u; });
    });
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

// === 文档内链接（对齐 Notion：点击即访问） ===
//
// 背景：块是 contenteditable，浏览器在编辑区内点击 <a> 只会放光标、不跳转，
// 所以「点链接打开」在富文本编辑器里必须自己做。规则（与 Notion 一致）：
//   1) 页内链接（[[ 插入的 a[data-page-id]）→ 应用内跳转到该页；
//   2) 外链 → 新标签打开（noopener，防 tabnabbing）；
//   3) **编辑态也「点即打开」**——要改链接文字，用方向键 / 点链接旁的空白把光标移进去，
//      而不是靠「点链接不打开」。这是 Notion 的行为，也是用户确认的对齐方式。
//   4) hover 链接浮出 Notion 式气泡：打开 / 复制链接 / 编辑 / 移除（见 linkChip）。
const openExternal = (href: string) => {
  // 优先 window.open 新标签打开；noopener 同时避免新页拿到 window.opener（防 tabnabbing）。
  // 若被环境拦截（WebView / 弹窗拦截器常在用户手势之外或 WebView 内拦掉），
  // 退化为「点击 target=_blank 的 <a>`」——多数 WebView 会委派系统浏览器打开，
  // 且绝不会让当前应用页跳走。严禁退化为 window.location.href（会把整个应用冲掉）。
  const w = window.open(href, '_blank', 'noopener,noreferrer');
  if (w) return;
  const a = document.createElement('a');
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.style.position = 'fixed';
  a.style.left = '-9999px';
  a.style.top = '-9999px';
  document.body.appendChild(a);
  a.click();
  a.remove();
};

// 悬停预览卡 / 移动端长按菜单（Notion 式链接卡）：提供 打开 / 复制链接 / 编辑 / 移除，
// 桌面端 hover 浮出小气泡，触屏无 hover 改成长按弹出底部菜单（见模板里的两套渲染）。
const linkChip = ref<{
  visible: boolean; x: number; y: number; href: string; pageId: string | null;
  text: string; copied: boolean; previewTitle: string; previewSnippet: string; domain: string; favicon: string;
}>({
  visible: false, x: 0, y: 0, href: '', pageId: null, text: '', copied: false,
  previewTitle: '', previewSnippet: '', domain: '', favicon: '',
});
// 当前 hover / 长按到的 <a>（非响应式，仅动作时读取），避免把 DOM 节点塞进响应式状态
let linkChipEl: HTMLAnchorElement | null = null;
// 迟一点再隐藏：鼠标从链接移到气泡上时不该立刻消失，否则按钮点不到
let linkChipTimer: number | null = null;
const hideLinkChip = () => {
  if (linkChipTimer) clearTimeout(linkChipTimer);
  linkChipTimer = window.setTimeout(() => {
    linkChip.value.visible = false;
    linkChip.value.copied = false;
    linkChipEl = null;
  }, 160);
};
const keepLinkChip = () => { if (linkChipTimer) { clearTimeout(linkChipTimer); linkChipTimer = null; } };
// 滚动后气泡位置就失效了，直接收起（capture：内容区/侧边栏滚动都能收到）
window.addEventListener('scroll', hideLinkChip, true);

// 预览卡内容：页内链接取目标页标题 + 首段文字；外链取域名 + favicon（浏览器直连站点自己的
// /favicon.ico，无需后端；取不到则回退到域名文字）。真实 OG 元信息（标题/描述/封面图）需要
// 后端代理抓取，这里不做，留给后续。
const stripHtml = (s: string): string => (s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const resolvePreview = (a: HTMLAnchorElement) => {
  const pageId = a.getAttribute('data-page-id');
  if (pageId) {
    const p = pages.value.find((pg) => pg.id === pageId && !pg.deletedAt);
    if (p) {
      const firstText = (p.tasks || [])
        .map((t) => stripHtml(t.content || ''))
        .find((s) => s.length > 0) || '';
      return { previewTitle: p.title || '无标题', previewSnippet: firstText.slice(0, 90), domain: '', favicon: '' };
    }
    return { previewTitle: '链接的页面已不存在', previewSnippet: '', domain: '', favicon: '' };
  }
  const href = a.getAttribute('href') || '';
  try {
    const u = new URL(href);
    const host = u.hostname.replace(/^www\./, '');
    return { previewTitle: host, previewSnippet: href, domain: host, favicon: `https://${u.hostname}/favicon.ico` };
  } catch {
    return { previewTitle: href, previewSnippet: '', domain: '', favicon: '' };
  }
};
const showLinkChipFor = (a: HTMLAnchorElement) => {
  const r = a.getBoundingClientRect();
  linkChipEl = a;
  linkChip.value = {
    visible: true,
    x: Math.round(r.left),
    y: Math.round(r.bottom + 4),
    href: a.getAttribute('href') || '',
    pageId: a.getAttribute('data-page-id'),
    text: (a.textContent || '').trim(),
    copied: false,
    ...resolvePreview(a),
  };
};
const onLinkHover = (e: MouseEvent) => {
  const a = (e.target as HTMLElement | null)?.closest?.('a') as HTMLAnchorElement | null;
  if (!a || isCoarsePointer.value) { hideLinkChip(); return; }
  // href="#" 是导入时没能解析的死链（早期版本的 Notion ZIP 导入会这样），
  // 点了只会开一个空白页，索性不提示。
  if (!a.getAttribute('data-page-id') && !(a.getAttribute('href') || '').replace('#', '')) { hideLinkChip(); return; }
  showLinkChipFor(a);
};

// === 移动端长按链接菜单 ===
// 触屏没有 hover，否则 复制/编辑/移除 在手机上完全无法触达。长按（~480ms、未滚动）即弹出
// 与桌面 hover 气泡相同的操作菜单；长按期间若发生位移视为滚动，取消。
let longPressTimer: number | null = null;
let longPressStart: { x: number; y: number } | null = null;
let suppressClickUntil = 0;   // 长按菜单弹出后，吞掉紧随其后的合成 click（限时，避免误开链接）
const onLinkTouchStart = (e: TouchEvent) => {
  if (!isCoarsePointer.value) return;
  const t = e.touches[0];
  const a = (e.target as HTMLElement | null)?.closest?.('a') as HTMLAnchorElement | null;
  if (!a) return;
  if (!a.getAttribute('data-page-id') && !(a.getAttribute('href') || '').replace('#', '')) return;
  longPressStart = { x: t.clientX, y: t.clientY };
  if (longPressTimer) clearTimeout(longPressTimer);
  longPressTimer = window.setTimeout(() => {
    suppressClickUntil = Date.now() + 700;
    showLinkChipFor(a);
  }, 480);
};
const onLinkTouchMove = (e: TouchEvent) => {
  if (!longPressStart || !longPressTimer) return;
  const t = e.touches[0];
  if (Math.abs(t.clientX - longPressStart.x) > 10 || Math.abs(t.clientY - longPressStart.y) > 10) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
    longPressStart = null;
  }
};
const onLinkTouchEnd = () => {
  if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
  longPressStart = null;
};
// 长按原生会触发 contextmenu，阻止默认右键菜单 / 文字选择气泡
const onLinkContextMenu = (e: MouseEvent) => {
  const a = (e.target as HTMLElement | null)?.closest?.('a') as HTMLAnchorElement | null;
  if (a && isCoarsePointer.value) e.preventDefault();
};
const openLinkChip = () => {
  if (linkChip.value.pageId) { selectPage(linkChip.value.pageId); hideLinkChip(); return; }
  if (linkChip.value.href) openExternal(linkChip.value.href);
  hideLinkChip();
};
// 复制链接：页内链接复制「应用地址 + #pageId」，外链复制原始 href
const copyLinkChip = async () => {
  const url = linkChip.value.pageId
    ? `${location.origin}${location.pathname}#${linkChip.value.pageId}`
    : linkChip.value.href;
  try { await navigator.clipboard.writeText(url); } catch { /* 隐私模式可能失败，忽略 */ }
  linkChip.value.copied = true;
  if (linkChipTimer) clearTimeout(linkChipTimer);
  linkChipTimer = window.setTimeout(() => {
    linkChip.value.visible = false;
    linkChip.value.copied = false;
    linkChipEl = null;
  }, 1200);
};
// 编辑已有链接的 URL（行内小框，非居中大弹窗）—— 见 openEditLinkDialog
const editLinkChip = () => {
  const el = linkChipEl;
  if (!el) return;
  hideLinkChip();
  openEditLinkDialog(el);
};
// 移除链接：保留文字、去掉 <a> 包裹（与 Notion「取消链接」一致）
const unlinkChip = () => {
  const el = linkChipEl;
  if (!el) return;
  const blockEl = el.closest('.ce-block') as HTMLElement | null;
  el.replaceWith(document.createTextNode(el.textContent || ''));
  if (blockEl?.dataset.taskId) updateTask(blockEl.dataset.taskId, { content: blockEl.innerHTML });
  hideLinkChip();
};

const onContentClick = (e: MouseEvent) => {
  // 移动端长按菜单刚弹出时，系统会补发一个合成 click，吞掉它以免误开链接
  if (Date.now() < suppressClickUntil) return;
  const a = (e.target as HTMLElement | null)?.closest?.('a') as HTMLAnchorElement | null;
  if (a) {
    const pageId = a.getAttribute('data-page-id');
    // 与 Notion 一致：单击链接即打开（编辑态也开），改链接文字用方向键 / 相邻点击移入光标。
    e.preventDefault();
    e.stopPropagation();
    if (pageId) { selectPage(pageId); hideLinkChip(); return; }
    const href = a.getAttribute('href');
    // '#'/空 = 死链（早期 ZIP 导入把 Notion 页内链接压成了 #），点了只会开空白页，不动
    if (href && href !== '#') { openExternal(href); hideLinkChip(); return; }
  }
  handleEmptyClick(e);
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

// 菜单视口自适应：菜单是 fixed 浮层，靠近边缘（尤其底部/右缘）会画出可视区。
// 打开后下一帧量到真实宽高再夹取到视口内；传入 anchor（触发元素 rect）时，
// 下溢出优先翻到锚点上方（对齐 Notion：菜单完整落在界面内、不溢出、尽量不遮触发块）。
const clampActionMenuIntoViewport = (anchor?: { top: number; left: number; right: number; bottom: number }) => {
  nextTick(() => {
    const el = document.querySelector('.action-menu-popup') as HTMLElement | null;
    if (!el || !actionMenuConfig.value.isOpen) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    const m = 8;
    const vw = window.innerWidth, vh = window.innerHeight;
    let { x, y } = actionMenuConfig.value;
    // 水平：右溢出 → 菜单右缘贴锚点右缘；再不行夹取到视口内
    if (x + w > vw - m && anchor) x = anchor.right - w;
    x = Math.max(m, Math.min(x, vw - w - m));
    // 垂直：下溢出 → 锚点上方放得下就翻上去；否则夹取到视口底部内
    if (y + h > vh - m) {
      const above = anchor ? anchor.top - h - 4 : -Infinity;
      y = above >= m ? above : Math.max(m, Math.min(y, vh - h - m));
    } else {
      y = Math.max(m, Math.min(y, vh - h - m));
    }
    actionMenuConfig.value = { ...actionMenuConfig.value, x: Math.round(x), y: Math.round(y) };
  });
};
// 桌面：鼠标点六点，以手柄为锚点定位，并做视口自适应（flip + clamp）
const openActionMenu = (e: MouseEvent, taskId: string) => {
  e.stopPropagation();
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  actionMenuConfig.value = { isOpen: true, x: rect.left, y: rect.bottom + 4, taskId };
  clampActionMenuIntoViewport({ top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom });
};
// 触屏：由 touch 坐标直接定位菜单（e.currentTarget 在 touch 事件里拿不到可靠元素），无锚点仅夹取
const openActionMenuAtTouch = (taskId: string, e: TouchEvent) => {
  e.stopPropagation();
  const t = e.touches[0] || (e.changedTouches && e.changedTouches[0]);
  if (!t) return;
  actionMenuConfig.value = { isOpen: true, x: Math.round(t.clientX), y: Math.round(t.clientY), taskId };
  clampActionMenuIntoViewport();
};
const actionMenuTask = computed(() => activePage.value?.tasks.find((t: Task) => t.id === actionMenuConfig.value.taskId) ?? null);
const handleActionCommand = (type: string) => {
  updateTask(actionMenuConfig.value.taskId, { type, payload: makePayload(type) });
  actionMenuConfig.value.isOpen = false;
};

// 样式与提示
const getTextClass = (task: Task) => {
  if (task.type === 'h1') return 'text-2xl font-bold font-["Rajdhani",sans-serif] text-accent/90';
  if (task.type === 'h2') return 'text-xl font-bold font-["Rajdhani",sans-serif] text-display';
  if (task.type === 'h3') return 'text-lg font-bold font-["Rajdhani",sans-serif] text-dim';
  if (task.type === 'quote') return 'italic text-warn/90';
  if (task.type === 'toggle') return 'text-[15px] font-medium text-accent/80';
  if (task.completed && task.type === 'todo') return 'text-[15px] line-through text-dim';
  return 'text-[15px] text-display';
};
const getPlaceholder = (type: string) => { if (type === 'h1') return '标题 1'; if (type === 'h2') return '标题 2'; if (type === 'h3') return '标题 3'; if (type === 'callout') return '写点提示…'; if (type === 'text') return "输入 '/' 唤出命令菜单..."; return '...'; };

// 左槽控件对齐用的字号类。必须与 .ce-block 的字号保持一致：
// 左槽用 h-[1lh] 把控件盒限制在「首行行高」内，而 lh 单位取元素自身的
// line-height × font-size。若字号不一致，算出的行高就与文字行盒不匹配，对齐失效。
// 修改 getTextClass 的字号时，这里要同步。
const getFontSizeClass = (task: Task) => {
  if (task.type === 'h1') return 'text-2xl';
  if (task.type === 'h2') return 'text-xl';
  if (task.type === 'h3') return 'text-lg';
  return 'text-[15px]';
};

// 供 App.vue 的备份工具栏调用
defineExpose({ exportMarkdown });
</script>

<style scoped>
/* 关于浏览器原生「滚动锚定」（scroll anchoring）：
   它发现「视口上方内容高度变了」会自动挪 scrollTop，让可见内容看起来不动。
   虚拟滚动模式下必须关掉（vTop spacer 会按 VIRTUAL_QUANT 整档跳变，被误判成「上方内容变了」，
   于是反复补偿 → 静止时也持续抖动）。但当前已改为整篇挂载（virtualScrolling=false），
   没有 spacer，原生锚定反而成了好事：图片延迟加载撑高时，它能自动稳住视口，不让内容跳动。
   故这里不再写 overflow-anchor: none。若将来重新开启虚拟滚动，记得把这行加回来。 */
/* 主题化：这里全部走语义变量（定义在 src/style.css 的 [data-theme]），
   不要再写死 hex，否则换肤后这些富文本样式会「留在旧主题里」。 */
.ce-block b, .ce-block strong { color: rgb(var(--accent)); font-weight: 700; text-shadow: 0 0 var(--accent-glow-radius, 4px) rgb(var(--accent) / var(--accent-glow, 0.3)); }
.ce-block i, .ce-block em { font-style: italic; color: rgb(var(--warn)); }
.ce-block u { text-decoration: underline; text-underline-offset: 3px; text-decoration-color: rgb(var(--accent) / 0.6); }
.ce-block strike, .ce-block del { text-decoration: line-through; color: rgb(var(--dim)); opacity: 0.8; }
/* 左槽控制手柄（+号 / 拖拽点）可见性。
   用媒体查询区分设备能力，而非 JS 判断，好处是零运行时开销、且不依赖 UA 嗅探：
   - 支持真实 hover 的设备（桌面）：只跟随鼠标所在行。光标停在哪一行完全不显示，
     与 Notion 一致。此前用「hover 或聚焦」会导致光标停留行常驻手柄。
   - 无 hover 能力的设备（触屏）：hover 不可用，退化为「聚焦该块时显示」（is-active）。
     这是触屏唯一的可达路径，必须保留。
   注意手柄是 .task-item-container 的绝对定位子元素（left:-72px 溢出到容器外），
   CSS :hover 会覆盖溢出的后代，所以鼠标移到手柄上时手柄不会闪退。 */
.row-handles { opacity: 0; }
@media (hover: hover) and (pointer: fine) {
  .task-item-container:hover .row-handles { opacity: 1; }
}
@media (hover: none) {
  .row-handles.is-active { opacity: 1; }
}

/* 浮动格式工具栏 */
.ft-btn { display: flex; align-items: center; justify-content: center; min-width: 26px; height: 26px; padding: 0 6px; border-radius: 2px; color: rgb(var(--display)); font-size: 13px; transition: all 0.15s; }
.ft-btn:hover { background: rgb(var(--panel)); color: rgb(var(--accent)); }
/* 触屏：格式工具条吸底后按钮扩到 44px 触摸目标（Material 48dp / Apple 44pt 量级） */
.format-toolbar--touch .ft-btn { min-width: 44px; height: 44px; font-size: 15px; }
.format-toolbar--touch .color-swatch { width: 36px; height: 36px; }
/* 触屏：块操作菜单走底部面板，菜单项同样放大触摸目标 */
.action-menu-sheet > button { padding-top: 12px; padding-bottom: 12px; font-size: 15px; }
.ce-block a { color: rgb(var(--accent)); text-decoration: underline; text-underline-offset: 4px; cursor: pointer; transition: all 0.2s; }
.ce-block a:hover { text-shadow: 0 0 8px rgb(var(--accent) / var(--accent-glow, 0.3)); }
.ce-block code { background: rgb(var(--accent) / 0.08); color: rgb(var(--accent)); padding: 2px 6px; border-radius: 4px; font-family: 'JetBrains Mono', monospace; font-size: 0.9em; border: 1px solid rgb(var(--accent) / 0.15); }
.ce-block kbd { background: rgb(var(--panel)); border: 1px solid rgb(var(--line)); border-bottom: 2px solid rgb(var(--line)); padding: 2px 6px; border-radius: 3px; font-size: 0.85em; color: rgb(var(--display)); font-family: 'JetBrains Mono', monospace; }
/* 页内页面链接（[[ 插入） */
.ce-block a[data-page-id] { color: rgb(var(--accent)); text-decoration: none; border-bottom: 1px solid rgb(var(--accent) / 0.35); transition: all 0.2s; }
.ce-block a[data-page-id]:hover { background: rgb(var(--accent) / 0.1); border-bottom-color: rgb(var(--accent)); }
/* Notion 行为：占位提示只在「当前编辑的空块」或「鼠标悬停的空块」上出现，避免整页刷屏 */
.ce-block.show-placeholder:empty::before,
.task-item-container:hover .ce-block:empty::before { content: attr(data-placeholder); color: rgb(var(--dim) / 0.45); pointer-events: none; display: block; }
.custom-scrollbar::-webkit-scrollbar { width: 4px; height: 4px; }
.custom-scrollbar::-webkit-scrollbar-track { background: rgb(var(--panel) / 0.3); }
.custom-scrollbar::-webkit-scrollbar-thumb { background: rgb(var(--accent) / 0.3); border-radius: 2px; }
.custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgb(var(--accent) / 0.6); }
</style>