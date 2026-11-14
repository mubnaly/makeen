<script>
  // Dual Studio: Simultaneous Video and PDF study with flexible splitter and Markdown notes.
  // Left: Video player with full controls (subtitles, quality, speed, sidebar closed by default).
  // Right: PDF Reader with full controls (zoom, annotations, bookmarks, search).
  // Options: Split horizontally or vertically, draggable splitter, Markdown notes drawer, Project filtering.

  import { onMount, tick } from 'svelte';
  import Icon from './Icon.svelte';
  import Video from './Video.svelte';
  import Reader from './Reader.svelte';
  import MarkdownEditor from './MarkdownEditor.svelte';
  import { t } from '../lib/lang.svelte.js';
  import { listProjects } from '../lib/projects.js';
  import { getOrCreateNoteForMaterial, formatVideoNoteTitle } from '../lib/markdownStore.js';

  let {
    docs = [],
    initialDoc = null,
    initialVideo = null,
    projects = [],
    activeProjectId = '',
    sidecarStore = null,
    undoManager = null,
    notify = () => {},
    onCapture = null,
    captures = [],
    onDeleteCapture = null,
    refreshDocs = () => {},
    onPickPdf = null,
    onPickVideo = null
  } = $props();

  function defaultSplitMode() {
    if (typeof window !== 'undefined' && window.innerWidth <= 768 && window.innerHeight >= window.innerWidth) {
      return 'vertical'; // Stacks top (video) & bottom (pdf) on portrait phones
    }
    return 'horizontal'; // Side by side on tablet/landscape and desktop
  }

  // --- Layout & Splitter State ---
  let splitMode = $state(defaultSplitMode()); // 'horizontal' | 'vertical'
  let splitRatio = $state(50); // percentage 20 to 80
  let isDragging = $state(false);
  let isMarkdownOpen = $state(false);
  let splitAreaEl = $state(null);

  // --- Project & Document Selection ---
  let selectedProjectId = $state(activeProjectId || '');
  let selectedPdfId = $state(initialDoc?.id || '');
  let selectedVideoId = $state(initialVideo?.id || '');

  // Derived Project
  const activeProject = $derived(
    projects.find((p) => p.id === selectedProjectId) || null
  );

  // Filter docs according to active project (or all library docs)
  const availablePdfs = $derived.by(() => {
    const allPdfs = (docs || []).filter((d) => !d.kind || d.kind === 'pdf');
    if (!activeProject || !activeProject.sources?.length) return allPdfs;
    const projectSources = activeProject.sources || [];
    const filtered = allPdfs.filter((d) =>
      projectSources.some((s) => s.id === d.id || s.title === d.title || s.title === d.filename)
    );
    return filtered.length > 0 ? filtered : allPdfs;
  });

  const availableVideos = $derived.by(() => {
    const allVideos = (docs || []).filter((d) => d.kind === 'video');
    if (!activeProject || !activeProject.sources?.length) return allVideos;
    const projectSources = activeProject.sources || [];
    const filtered = allVideos.filter((d) =>
      projectSources.some((s) => s.id === d.id || s.title === d.title || s.title === d.filename)
    );
    return filtered.length > 0 ? filtered : allVideos;
  });

  // Active documents
  const activePdf = $derived(
    availablePdfs.find((d) => d.id === selectedPdfId) || availablePdfs[0] || null
  );
  const activeVideo = $derived(
    availableVideos.find((d) => d.id === selectedVideoId) || availableVideos[0] || null
  );

  // Ensure selected IDs follow active items
  $effect(() => {
    if (activePdf && selectedPdfId !== activePdf.id) {
      selectedPdfId = activePdf.id;
    }
  });
  $effect(() => {
    if (activeVideo && selectedVideoId !== activeVideo.id) {
      selectedVideoId = activeVideo.id;
    }
  });

  // Active Note for Studio Session (project note, or material note)
  const studioNoteMaterialId = $derived(
    activeProject?.id || activeVideo?.id || activePdf?.id || 'studio-general'
  );
  const studioNoteTitle = $derived(
    activeProject ? `${activeProject.name} — ${t('studio.notes') || 'Studio Notes'}`
    : activeVideo && activePdf ? `${formatVideoNoteTitle(activeVideo)} & ${activePdf.title || 'PDF'}`
    : activeVideo ? formatVideoNoteTitle(activeVideo)
    : activePdf ? (activePdf.title || 'PDF Notes')
    : 'Studio Session Notes'
  );

  // --- Splitter Mouse Dragging Handler ---
  function startDragging(e) {
    e.preventDefault();
    isDragging = true;
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stopDragging);
  }

  function onPointerMove(e) {
    if (!isDragging || !splitAreaEl) return;
    const rect = splitAreaEl.getBoundingClientRect();
    if (splitMode === 'horizontal') {
      const offset = e.clientX - rect.left;
      const pct = (offset / rect.width) * 100;
      splitRatio = Math.max(20, Math.min(80, Math.round(pct * 10) / 10));
    } else {
      const offset = e.clientY - rect.top;
      const pct = (offset / rect.height) * 100;
      splitRatio = Math.max(20, Math.min(80, Math.round(pct * 10) / 10));
    }
  }

  function stopDragging() {
    isDragging = false;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', stopDragging);
  }

  function toggleSplitMode() {
    splitMode = splitMode === 'horizontal' ? 'vertical' : 'horizontal';
  }

  function toggleMarkdownDrawer() {
    isMarkdownOpen = !isMarkdownOpen;
  }
</script>

<div class="dual-studio-root" class:is-dragging={isDragging}>
  <!-- Top Control Toolbar -->
  <header class="studio-header">
    <div class="header-left">
      <!-- Project / Folder Filter -->
      <div class="select-group">
        <span class="group-icon"><Icon name="projects" size={14} /></span>
        <select class="studio-select" bind:value={selectedProjectId} title={t('studio.selectProject') || 'Project'}>
          <option value="">{t('studio.allFiles') || 'All Library Files'}</option>
          {#each projects as proj (proj.id)}
            <option value={proj.id}>{proj.name || 'Untitled Project'}</option>
          {/each}
        </select>
      </div>

      <!-- Quick Video Picker -->
      <div class="select-group video-select-group">
        <span class="group-icon"><Icon name="video" size={14} /></span>
        {#if availableVideos.length > 0}
          <select class="studio-select" bind:value={selectedVideoId} title={t('studio.selectVideo') || 'Video'}>
            {#each availableVideos as vid (vid.id)}
              <option value={vid.id}>{vid.title || vid.filename || 'Untitled Video'}</option>
            {/each}
          </select>
        {:else}
          <span class="empty-badge">{t('studio.noVideo') || 'No videos'}</span>
        {/if}
      </div>

      <!-- Quick PDF Picker -->
      <div class="select-group pdf-select-group">
        <span class="group-icon"><Icon name="reader" size={14} /></span>
        {#if availablePdfs.length > 0}
          <select class="studio-select" bind:value={selectedPdfId} title={t('studio.selectPdf') || 'PDF'}>
            {#each availablePdfs as p (p.id)}
              <option value={p.id}>{p.title || p.filename || 'Untitled PDF'}</option>
            {/each}
          </select>
        {:else}
          <span class="empty-badge">{t('studio.noPdf') || 'No PDFs'}</span>
        {/if}
      </div>
    </div>

    <div class="header-right">
      <!-- Split Orientation Toggle (Horizontal / Vertical) -->
      <button
        type="button"
        class="studio-btn"
        onclick={toggleSplitMode}
        title={splitMode === 'horizontal' ? (t('studio.splitVertical') || 'Split Vertically') : (t('studio.splitHorizontal') || 'Split Horizontally')}
      >
        <Icon name={splitMode === 'horizontal' ? 'rows' : 'columns'} size={15} />
        <span class="btn-label">{splitMode === 'horizontal' ? (t('studio.splitVertical') || 'رأسي') : (t('studio.splitHorizontal') || 'أفقي')}</span>
      </button>

      <!-- Markdown Notes Drawer Toggle -->
      <button
        type="button"
        class="studio-btn primary-btn {isMarkdownOpen ? 'active' : ''}"
        onclick={toggleMarkdownDrawer}
        title={isMarkdownOpen ? (t('studio.closeMarkdown') || 'Close Notes') : (t('studio.openMarkdown') || 'Markdown Notes')}
      >
        <Icon name="file-text" size={15} />
        <span class="btn-label">{t('studio.openMarkdown') || 'الملاحظات'}</span>
      </button>
    </div>
  </header>

  <!-- Main Split Studio Body -->
  <main class="studio-main-body">
    <div
      bind:this={splitAreaEl}
      class="split-area {splitMode}"
      style="direction: ltr;"
    >
      <!-- LEFT PANE: Video Player (with full options, speed, quality, subtitles, sidebar toggle) -->
      <section
        class="studio-pane pane-video"
        style={splitMode === 'horizontal' ? `width: ${splitRatio}%;` : `height: ${splitRatio}%;`}
      >
        {#if activeVideo}
          <Video
            video={activeVideo}
            videos={availableVideos}
            {captures}
            {onCapture}
            {onDeleteCapture}
            {notify}
            initialSidebarOpen={false}
            onOpen={(v) => { selectedVideoId = v.id; }}
            onRemove={() => refreshDocs()}
            {refreshDocs}
            onImport={onPickVideo}
          />
        {:else}
          <div class="empty-pane">
            <Icon name="video" size={40} />
            <h4>{t('studio.noVideo') || 'No Video Selected'}</h4>
            {#if onPickVideo}
              <button class="studio-import-btn" onclick={onPickVideo}>
                <Icon name="upload" size={14} />
                <span>{t('topbar.importVideo') || 'Import Video'}</span>
              </button>
            {/if}
          </div>
        {/if}
      </section>

      <!-- FLEXIBLE SPLITTER DIVIDER -->
      <div
        class="studio-splitter {splitMode}"
        onpointerdown={startDragging}
        role="separator"
        aria-orientation={splitMode}
        tabindex="0"
      >
        <div class="splitter-grip"></div>
      </div>

      <!-- RIGHT PANE: PDF Reader (with full options, zoom, search, annotations, bookmarks) -->
      <section
        class="studio-pane pane-pdf"
        style={splitMode === 'horizontal' ? `width: calc(100% - ${splitRatio}% - 8px);` : `height: calc(100% - ${splitRatio}% - 8px);`}
      >
        {#if activePdf}
          <Reader
            doc={activePdf}
            {sidecarStore}
            {undoManager}
            {notify}
            {onCapture}
            {captures}
            {onDeleteCapture}
            tabDocs={availablePdfs}
            activeTabId={activePdf.id}
            onSelectTab={(id) => { selectedPdfId = id; }}
            onCloseTab={() => {}}
            onNewTab={onPickPdf}
          />
        {:else}
          <div class="empty-pane">
            <Icon name="reader" size={40} />
            <h4>{t('studio.noPdf') || 'No PDF Selected'}</h4>
            {#if onPickPdf}
              <button class="studio-import-btn" onclick={onPickPdf}>
                <Icon name="upload" size={14} />
                <span>{t('topbar.importPdf') || 'Import PDF'}</span>
              </button>
            {/if}
          </div>
        {/if}
      </section>
    </div>

    <!-- SLIDING MARKDOWN NOTES DRAWER -->
    {#if isMarkdownOpen}
      <aside class="studio-markdown-drawer">
        <header class="drawer-header">
          <div class="drawer-title hstack" style="gap:8px;">
            <Icon name="file-text" size={15} />
            <span class="drawer-title-text">{studioNoteTitle}</span>
          </div>
          <button class="drawer-close-btn" onclick={() => (isMarkdownOpen = false)} title={t('common.close') || 'Close'}>
            <Icon name="x" size={14} />
          </button>
        </header>
        <div class="drawer-editor-wrap">
          <MarkdownEditor
            materialId={studioNoteMaterialId}
            materialType={activeProject ? 'project' : activeVideo ? 'video' : 'pdf'}
            materialTitle={studioNoteTitle}
            {captures}
            compact={true}
            {notify}
          />
        </div>
      </aside>
    {/if}
  </main>
</div>

<style>
  .dual-studio-root {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    overflow: hidden;
    background: var(--bg);
    color: var(--text);
  }

  .dual-studio-root.is-dragging {
    user-select: none;
    cursor: col-resize;
  }

  /* Header Toolbar */
  .studio-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 14px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    gap: 12px;
    flex-shrink: 0;
    z-index: 10;
  }

  .header-left,
  .header-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .select-group {
    display: flex;
    align-items: center;
    gap: 6px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 3px 8px;
  }

  .group-icon {
    display: flex;
    align-items: center;
    color: var(--muted);
  }

  .studio-select {
    background: transparent;
    border: none;
    color: var(--text);
    font-size: 13px;
    font-weight: 500;
    outline: none;
    cursor: pointer;
    max-width: 200px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .studio-select option {
    background: var(--surface);
    color: var(--text);
  }

  .empty-badge {
    font-size: 12px;
    color: var(--muted);
  }

  .studio-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 5px 12px;
    font-size: 13px;
    font-weight: 500;
    color: var(--text);
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }

  .studio-btn:hover {
    background: var(--border);
  }

  .studio-btn.primary-btn {
    background: var(--accent);
    color: #fff;
    border-color: var(--accent);
  }

  .studio-btn.primary-btn:hover {
    filter: brightness(1.1);
  }

  .studio-btn.primary-btn.active {
    box-shadow: 0 0 0 2px var(--accent-soft);
  }

  /* Main Workspace Area */
  .studio-main-body {
    display: flex;
    flex: 1;
    overflow: hidden;
    position: relative;
  }

  .split-area {
    display: flex;
    flex: 1;
    height: 100%;
    width: 100%;
    overflow: hidden;
  }

  .split-area.horizontal {
    flex-direction: row;
  }

  .split-area.vertical {
    flex-direction: column;
  }

  .studio-pane {
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .pane-video,
  .pane-pdf {
    height: 100%;
    overflow: hidden;
  }

  /* While dragging, disable pointer events on panes to avoid iframes grabbing pointer */
  .is-dragging .studio-pane {
    pointer-events: none;
  }

  /* Splitter Divider */
  .studio-splitter {
    background: var(--border);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: background 0.15s;
    z-index: 5;
  }

  .studio-splitter.horizontal {
    width: 8px;
    height: 100%;
    cursor: col-resize;
  }

  .studio-splitter.vertical {
    height: 8px;
    width: 100%;
    cursor: row-resize;
  }

  .studio-splitter:hover,
  .is-dragging .studio-splitter {
    background: var(--accent);
  }

  .splitter-grip {
    background: rgba(255, 255, 255, 0.4);
    border-radius: 4px;
  }

  .studio-splitter.horizontal .splitter-grip {
    width: 3px;
    height: 32px;
  }

  .studio-splitter.vertical .splitter-grip {
    height: 3px;
    width: 32px;
  }

  /* Empty Panes */
  .empty-pane {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    width: 100%;
    gap: 12px;
    color: var(--muted);
    background: var(--surface);
  }

  .studio-import-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: var(--radius);
    padding: 8px 16px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
  }

  /* Markdown Sliding Drawer */
  .studio-markdown-drawer {
    width: 380px;
    height: 100%;
    background: var(--surface);
    border-left: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    z-index: 20;
    box-shadow: -4px 0 20px rgba(0, 0, 0, 0.15);
    animation: slideInDrawer 0.2s ease-out;
    flex-shrink: 0;
  }

  @keyframes slideInDrawer {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }

  .drawer-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
    background: var(--surface-2);
  }

  .drawer-title-text {
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 300px;
  }

  .drawer-close-btn {
    background: transparent;
    border: none;
    color: var(--muted);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 4px;
    border-radius: 4px;
  }

  .drawer-close-btn:hover {
    background: var(--border);
    color: var(--text);
  }

  .drawer-editor-wrap {
    flex: 1;
    height: 100%;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  /* DualStudio Mobile rule: Stack vertically in portrait, split horizontally in landscape */
  @media (max-width: 768px) and (orientation: portrait) {
    .split-area {
      flex-direction: column !important;
    }
    .studio-pane {
      width: 100% !important;
    }
    .studio-splitter.horizontal {
      display: none !important;
    }
    .studio-splitter.vertical {
      height: 6px !important;
      width: 100% !important;
    }
    .studio-header {
      flex-wrap: wrap !important;
      padding: 6px 10px !important;
      gap: 6px !important;
    }
    .studio-markdown-drawer {
      position: fixed !important;
      top: 0;
      bottom: 0;
      right: 0;
      width: min(340px, 90vw) !important;
      z-index: 1000 !important;
    }
  }
</style>
