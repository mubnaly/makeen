<script>
  // PDF workspace. Pages are rendered by PdfPage components: that is what lets
  // the reader open as a continuous strip, as a two-page book opening, or as a
  // single page, while every visible page keeps its own annotation layers.
  import { onMount, onDestroy, tick, untrack } from 'svelte';
  import Icon from './Icon.svelte';
  import PdfPage from './PdfPage.svelte';
  import { loadDocument, extractPageText } from '../lib/pdf.js';
  import { createTransform, displaySize } from '../lib/geometry.js';
  import { renderAnnotations, hitTest } from '../lib/annotations.js';
  import { buildSidecar, serializeSidecar } from '../lib/sidecar.js';
  import { readPdfBytes, loadPdfAutosaveSettings } from '../lib/storage.js';
  import { annotatedCopyPdf, excerptsPdf, imagesToPdf, deliverBytes } from '../lib/export.js';
  import { labelPng } from '../lib/labels.js';
  import { canvasCapture } from '../lib/imageQuality.js';
  import { getDocument, setBookmarks, setReadingPosition } from '../lib/library.js';
  import {
    flattenBookmarkTree, reorderBookmarks, indentBookmark, outdentBookmark,
    setBookmarkTitle, toggleBookmarkCollapse
  } from '../lib/bookmarks.js';
  import { autoScrollbar } from '../lib/actions.js';
  import {
    normalizeLayout, normalizeReadingMode, normalizeReadingDirection,
    pagesForLayout, spreadSlots, spreadStart, stepPage
  } from '../lib/readerLayout.js';
  import {
    DEFAULT_BAR_ITEMS, defaultBarOrder, normalizeBarOrder, moveBarOrder,
    insertAfterBarItem, removeBarItem, barOrderMap, BAR_ITEM_IDS
  } from '../lib/toolbar.js';
  // The page transform in this file is also called `t`, so the translator is
  // imported as `tr`.
  import { t as tr } from '../lib/lang.svelte.js';

  let {
    doc,
    sidecarStore,
    undoManager,
    notify,
    onCapture,
    onOpenGallery,
    captures = [],
    onDeleteCapture = null,
    onSaveAnnotated = null,
    tabDocs = [],
    activeTabId = '',
    onSelectTab = null,
    onCloseTab = null,
    onNewTab = null,
    onBack = null
  } = $props();

  const PALETTE = [
    { key: 'yellow', value: '#F4D03F' },
    { key: 'orange', value: '#F2994A' },
    { key: 'red', value: '#EB5757' },
    { key: 'green', value: '#27AE60' },
    { key: 'blue', value: '#2F80ED' },
    { key: 'purple', value: '#9B51E0' },
    { key: 'grey', value: '#9AA0A6' }
  ];
  const TOOLS = [
    { id: 'hand', icon: 'hand', label: 'tool.hand' },
    { id: 'text', icon: 'text', label: 'tool.text' },
    { id: 'marker', icon: 'marker', label: 'tool.marker' },
    { id: 'shape', icon: 'shape', label: 'tool.shape' },
    { id: 'shapeFill', icon: 'shape-fill', label: 'tool.shapeFill' },
    { id: 'pen', icon: 'pen', label: 'tool.pen' },
    { id: 'pointer', icon: 'pointer', label: 'tool.pointer' },
    { id: 'eraser', icon: 'eraser', label: 'tool.eraser' },
    { id: 'capture', icon: 'scissors', label: 'tool.capture' },
    { id: 'bookmark', icon: 'bookmark', label: 'tool.bookmark' }
  ];
  const SHAPES = ['rectangle', 'ellipse', 'line', 'arrow', 'check', 'cross'];
  const shapeLabel = (id) => tr(`shape.${id}`);
  const ERASER_RADIUS = 7;
  const MARKER_MIN = 5, MARKER_MAX = 100, MARKER_STEP = 5;
  const PEN_MIN = 1, PEN_MAX = 30, PEN_STEP = 1;
  const HAND_MIN = 12, HAND_MAX = 72, HAND_STEP = 2;
  const SIZE_TOOLS = new Set(['marker', 'shape', 'shapeFill', 'pen', 'pointer', 'hand']);
  const GRID_STYLES = [
    { id: '', label: 'reader.gridOff' },
    { id: 'lines', label: 'reader.gridLines' },
    { id: 'dotsWide', label: 'reader.gridDotsWide' },
    { id: 'dotsFine', label: 'reader.gridDotsFine' }
  ];
  const PREFS = {
    layout: 'studyos.reader.layout',
    direction: 'studyos.reader.direction',
    mode: 'studyos.reader.mode',
    toolbar: 'studyos.reader.toolbar.v1'
  };
  const BAR_BY_ID = Object.fromEntries(DEFAULT_BAR_ITEMS.map((item) => [item.id, item]));

  let isRestoringScroll = false;

  onDestroy(() => {
    if (positionTimer) {
      clearTimeout(positionTimer);
      positionTimer = null;
    }
    persistPosition();
  });

  function loadPref(key, fallback) {
    try { return globalThis.localStorage?.getItem(key) || fallback; } catch { return fallback; }
  }
  function savePref(key, value) {
    try { globalThis.localStorage?.setItem(key, value); } catch { /* private mode */ }
  }

  let pdfDoc = $state(null);
  let loading = $state(true);
  let loadError = $state('');
  let numPages = $state(0);
  let pageNum = $state(1);
  let scale = $state(1);
  let rotation = $state(0);
  let pageSizes = $state({});
  let annotations = $state([]);
  let pageMeta = $state({});
  let saveState = $state('saved');
  let saveError = $state('');
  let dpr = 1;

  let tool = $state('marker');
  let color = $state('#F4D03F');
  let opacity = $state(1);
  let markerPx = $state(25);
  let penPx = $state(5);
  let shapePx = $state(5);
  let handPx = $state(24);
  let shape = $state('rectangle');
  let fillColor = $state('#3498DB');
  let fillOpacity = $state(0.35);

  let viewFilter = $state('all');
  let pageRender = $state('pdf');
  let gridStyle = $state('');
  let layout = $state(normalizeLayout(loadPref(PREFS.layout, 'continuous')));
  let readingDir = $state(normalizeReadingDirection(loadPref(PREFS.direction, 'rtl')));
  let readingMode = $state(normalizeReadingMode(loadPref(PREFS.mode, 'normal')));
  let sideOpen = $state(false);
  let sideTab = $state('bookmarks');
  let fullscreenAutoHide = $state(false);
  let fsHovered = $state(false);
  let imagePreview = $state(null);
  let bookmarks = $state([]);
  let activeBookmark = $state('');
  let savingCopy = $state(false);
  let fullscreen = $state(false);

  let draft = $state(null);
  let captureRect = $state(null);
  let capturing = false;
  let redPen = $state([]);
  let redPenTimer = null;
  let textRequest = $state(null);

  let barMenu = $state('');
  let exporting = $state('');
  let searchTerm = $state('');
  let searchStatus = $state('');

  let stage = $state();
  let readerRoot = $state();
  let searchInput = $state();
  let scrubTrack = $state();
  let scrubActive = $state(false);
  let scrubPreview = $state(0);
  let thumbCanvases = [];
  let pageRefs = new Map();
  let saveTimer = null;
  let positionTimer = null;
  let scrollFrame = null;
  let loadedDocId = '';
  let loadedDocFilename = '';
  let loadToken = 0;
  let undoVersion = $state(0);
  let toolbarSettingsOpen = $state(false);
  let dragFromIndex = -1;

  const undoState = $derived({
    u: doc ? undoManager.canUndo(doc.id) : false,
    r: doc ? undoManager.canRedo(doc.id) : false,
    _v: undoVersion
  });
  const sizePx = $derived(
    tool === 'marker' ? markerPx
      : (tool === 'shape' || tool === 'shapeFill') ? shapePx
      : tool === 'hand' ? handPx
      : penPx
  );
  const sizeBounds = $derived(
    tool === 'marker'
      ? { min: MARKER_MIN, max: MARKER_MAX, step: MARKER_STEP }
      : tool === 'hand'
        ? { min: HAND_MIN, max: HAND_MAX, step: HAND_STEP }
        : { min: PEN_MIN, max: PEN_MAX, step: PEN_STEP }
  );
  const sizeLabelKey = $derived(
    tool === 'marker' ? 'tool.markerSize'
      : (tool === 'shape' || tool === 'shapeFill') ? 'tool.shapeSize'
      : tool === 'hand' ? 'tool.handSize'
      : 'tool.penSize'
  );
  const docCaptures = $derived((captures || []).filter((c) => c.documentId === doc?.id));
  const sortedBookmarks = $derived([...bookmarks].sort((a, b) => (a.page - b.page) || String(a.createdAt || '').localeCompare(String(b.createdAt || ''))));
  const displayBookmarks = $derived(flattenBookmarkTree(bookmarks));
  const pagesToRender = $derived(pagesForLayout({ layout, page: pageNum, numPages }));
  const spreadView = $derived(layout === 'spread' ? spreadSlots(pageNum, numPages, readingDir) : []);
  const activeSize = $derived(pageSizes[pageNum] || { width: 595, height: 842 });
  const blankSize = $derived(displaySize(activeSize.width, activeSize.height, scale, rotation));
  const prevIcon = $derived(readingDir === 'rtl' ? 'chevron-right' : 'chevron-left');
  const nextIcon = $derived(readingDir === 'rtl' ? 'chevron-left' : 'chevron-right');
  const layoutIcon = $derived(layout === 'spread' ? 'columns' : layout === 'single' ? 'single-page' : 'scroll');
  const modeIcon = $derived(readingMode === 'dark' ? 'moon' : readingMode === 'grey' || readingMode === 'darkgray' ? 'contrast' : readingMode === 'paper' || readingMode === 'amber' ? 'sun' : 'eye');
  const scrubPercent = $derived(numPages > 1 ? ((pageNum - 1) / (numPages - 1)) * 100 : 0);
  const handCursor = $derived(handCursorFor(color, handPx));

  let toolbarConfig = $state(loadToolbarConfig());
  const barOrder = $derived(toolbarConfig.order);
  const orderMap = $derived(barOrderMap(toolbarConfig.order));
  const customPresets = $derived(toolbarConfig.custom || []);
  let presetForm = $state(null);
  // Kept separate from presetForm: closing the form must not null the object
  // while its bound inputs are still mounted, or Svelte reads `.name` on null
  // during teardown and throws.
  let presetOpen = $state(false);

  function clamp(n, lo, hi) { return n < lo ? lo : n > hi ? hi : n; }

  function addBarOrder(styleId) {
    return `order:${orderMap[styleId] ?? 999}`;
  }

  function loadToolbarConfig() {
    const fallback = { order: defaultBarOrder(), custom: [] };
    try {
      const raw = JSON.parse(globalThis.localStorage?.getItem(PREFS.toolbar) || 'null');
      if (!raw) return fallback;
      const custom = Array.isArray(raw.custom)
        ? raw.custom.filter((p) => p && typeof p.id === 'string' && ['shape', 'marker', 'pen'].includes(p.tool))
        : [];
      return { order: normalizeBarOrder(raw.order, custom.map((p) => p.id)), custom };
    } catch {
      return fallback;
    }
  }

  function saveToolbarConfig(next) {
    toolbarConfig = next;
    try { globalThis.localStorage?.setItem(PREFS.toolbar, JSON.stringify(next)); } catch { /* private mode */ }
  }

  function hexToRgba(hex, a) {
    const h = String(hex || '#000').replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    if (Number.isNaN(n)) return `rgba(0,0,0,${a})`;
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  // A filled hand, drawn in the current ink colour with no black outline, replaces
  // the operating-system grab cursor. The hotspot is the fingertip, scaled with hand size.
  function handCursorFor(ink, size = handPx) {
    const s = Math.round(size || 24);
    const hotX = Math.round((s * 9) / 24);
    const hotY = Math.round((s * 3) / 24);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 24 24"><path fill="${ink}" d="M8.2 12.2V5.7a1.55 1.55 0 0 1 3.1 0V11h.6V4.3a1.55 1.55 0 0 1 3.1 0V11h.6V6a1.55 1.55 0 0 1 3.1 0v6h.6V8.6a1.5 1.5 0 0 1 3 0v7.1c0 4.2-3.1 7.6-7.2 7.6h-1.2c-2.4 0-4.3-1.2-5.5-3l-2.2-3.5a1.7 1.7 0 0 1 2.6-2.1l2.2 2.1z"/></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hotX} ${hotY}, grab`;
  }

  function pageSize(page) {
    return pageSizes[page] || { width: 595, height: 842 };
  }

  function pageTransform(page, offsetX = 0, offsetY = 0) {
    const size = pageSize(page);
    return createTransform({ pageWidth: size.width, pageHeight: size.height, scale, rotation, offsetX, offsetY });
  }

  function setPageSize(page, width, height) {
    const prev = pageSizes[page];
    if (prev && Math.abs(prev.width - width) < 0.5 && Math.abs(prev.height - height) < 0.5) return;
    pageSizes = { ...pageSizes, [page]: { width, height } };
    pageMeta = { ...pageMeta, [page]: { ...(pageMeta[page] || {}), width, height } };
  }

  function registerPage(page, refs) {
    pageRefs.set(page, refs);
  }

  // --- lifecycle -------------------------------------------------------------
  onMount(() => {
    dpr = window.devicePixelRatio || 1;
    const handleWheel = (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.15 : -0.15;
        const next = clamp(Math.round((scale + delta) * 100) / 100, 0.3, 5.0);
        setZoom(next);
      }
    };
    stage?.addEventListener('wheel', handleWheel, { passive: false });

    const handleWindowPointerUp = () => {
      if (capturing && captureRect) finishCapture();
      else if (capturing) { capturing = false; captureRect = null; }
      if (panning) endPan();
      if (draft) {
        const finished = draft;
        draft = null;
        if (finished?.points?.length > 1 && finished.page) {
          const ann = finalizeAnnotation(finished, finished.page);
          if (ann) {
            annotations = [...annotations, ann];
            undoManager.recordAdd(doc.id, ann);
            undoVersion++;
            commitAnnotations();
          }
        }
      }
    };
    window.addEventListener('pointerup', handleWindowPointerUp);
    window.addEventListener('pointercancel', handleWindowPointerUp);

    return () => {
      stage?.removeEventListener('wheel', handleWheel);
      window.removeEventListener('pointerup', handleWindowPointerUp);
      window.removeEventListener('pointercancel', handleWindowPointerUp);
      teardown();
      if (positionTimer) clearTimeout(positionTimer);
      if (scrollFrame) cancelAnimationFrame(scrollFrame);
    };
  });

  $effect(() => {
    const id = doc?.id;
    if (!id) return;
    untrack(() => loadForDoc(doc));
  });

  async function loadForDoc(d) {
    const token = ++loadToken;
    teardown();
    loadedDocId = d.id;
    loadedDocFilename = d.filename || d.title || '';
    loading = true;
    loadError = '';
    saveState = 'saved';
    saveError = '';
    annotations = [];
    pageMeta = {};
    pageSizes = {};
    pageRefs = new Map();
    numPages = 0;
    const freshDoc = getDocument(d.id) || d;
    pageNum = freshDoc.lastPage || d.lastPage || 1;
    scale = freshDoc.lastZoom || d.lastZoom || 1;
    rotation = 0;
    imagePreview = null;
    activeBookmark = '';
    textRequest = null;
    barMenu = '';
    bookmarks = loadBookmarks(d.id);
    try {
      const bytes = await readPdfBytes(d.id);
      if (token !== loadToken) return;
      if (!bytes) {
        loadError = tr('reader.fileUnavailable');
        loading = false;
        return;
      }
      pdfDoc = await loadDocument(bytes);
      if (token !== loadToken) return;
      numPages = pdfDoc.numPages;
      pageNum = clamp(pageNum, 1, numPages);
      await loadPageSizes(pdfDoc, numPages, token);
      if (token !== loadToken) return;
      const loaded = await sidecarStore.load(d.id);
      if (token !== loadToken) return;
      if (loaded.sidecar) {
        annotations = loaded.sidecar.annotations.map(fromSidecar);
        pageMeta = { ...(loaded.sidecar.page_metadata || {}), ...pageMeta };
        if (loaded.recovered) notify(tr('toast.recovered'), 'ok');
      }
      loading = false;
      await tick();
      await nextFrame();
      if (sideOpen && sideTab === 'pages') renderThumbs();
      if (layout === 'spread') await fitWidth();
      else if (layout === 'continuous' && pageNum > 1) {
        isRestoringScroll = true;
        scrollToPage(pageNum, 'auto');
        setTimeout(() => {
          isRestoringScroll = false;
        }, 700);
      } else {
        isRestoringScroll = false;
      }
      persistPosition();
      setupAutosave();
    } catch (e) {
      if (token !== loadToken) return;
      loadError = tr('reader.couldNotOpen', { message: e.message });
      loading = false;
    }
  }

  async function loadPageSizes(source, total, token) {
    const sizes = {};
    for (let n = 1; n <= total; n++) {
      if (token !== loadToken) return;
      try {
        const page = await source.getPage(n);
        const base = page.getViewport({ scale: 1, rotation: 0 });
        sizes[n] = { width: base.width, height: base.height };
      } catch {
        sizes[n] = { width: 595, height: 842 };
      }
      if (n % 10 === 0) pageSizes = { ...sizes };
    }
    if (token === loadToken) pageSizes = { ...sizes };
  }

  function teardown() {
    if (positionTimer) {
      clearTimeout(positionTimer);
      positionTimer = null;
    }
    if (autosaveTimer) {
      clearInterval(autosaveTimer);
      autosaveTimer = null;
    }
    if (loadedDocId && !loading && loadedDocId === doc?.id) {
      persistPosition();
    }
    if (redPenTimer) clearTimeout(redPenTimer);
    redPenTimer = null;
    if (scrollFrame) { cancelAnimationFrame(scrollFrame); scrollFrame = null; }
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      if (loadedDocId) {
        try {
          const sidecar = buildSidecar({
            documentId: loadedDocId,
            sourceFilename: loadedDocFilename,
            pageMetadata: pageMeta,
            annotations
          });
          Promise.resolve(sidecarStore.save(loadedDocId, sidecar)).catch(() => {});
        } catch { /* best-effort flush */ }
      }
    }
    loadedDocId = '';
    loadedDocFilename = '';
    redPen = [];
    draft = null;
    textRequest = null;
    captureRect = null;
    capturing = false;
    pageRefs = new Map();
    if (pdfDoc) { try { pdfDoc.destroy(); } catch {} pdfDoc = null; }
  }

  // --- bookmarks -------------------------------------------------------------
  let editingBookmarkId = $state(null);
  let editTitleDraft = $state('');
  let draggedBookmarkId = $state(null);
  let dropTargetId = $state(null);
  let dropPosition = $state(null); // 'before' | 'after' | 'inside'

  function loadBookmarks(id) {
    const list = getDocument(id)?.bookmarks;
    if (!Array.isArray(list)) return [];
    return list
      .filter((b) => b && typeof b.page === 'number' && b.page >= 1)
      .map((b) => ({ ...b, id: b.id || crypto.randomUUID() }));
  }

  function persistBookmarks(next) {
    bookmarks = next;
    if (!doc) return;
    try { setBookmarks(doc.id, next); } catch { /* history stays best-effort */ }
  }

  function bookmarkLabel(b) {
    if (b.title && b.title.trim()) return b.title;
    return typeof b.u === 'number' ? tr('reader.spotBookmark', { n: b.page }) : tr('reader.pageBookmark', { n: b.page });
  }

  function handleBookmarkDragStart(e, b) {
    draggedBookmarkId = b.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', b.id);
  }

  function handleBookmarkDragOver(e, b) {
    if (!draggedBookmarkId || draggedBookmarkId === b.id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const h = rect.height;
    dropTargetId = b.id;
    if (y < h * 0.25) dropPosition = 'before';
    else if (y > h * 0.75) dropPosition = 'after';
    else dropPosition = 'inside';
  }

  function handleBookmarkDragLeave(e) {
    if (e.currentTarget && e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return;
    dropTargetId = null;
    dropPosition = null;
  }

  function handleBookmarkDrop(e, b) {
    e.preventDefault();
    if (draggedBookmarkId && dropTargetId && dropPosition) {
      persistBookmarks(reorderBookmarks(bookmarks, draggedBookmarkId, dropTargetId, dropPosition));
    }
    draggedBookmarkId = null;
    dropTargetId = null;
    dropPosition = null;
  }

  function handleBookmarkDragEnd() {
    draggedBookmarkId = null;
    dropTargetId = null;
    dropPosition = null;
  }

  function startRenameBookmark(b) {
    editingBookmarkId = b.id;
    editTitleDraft = b.title || bookmarkLabel(b);
  }

  function saveRenameBookmark(b) {
    if (editingBookmarkId === b.id) {
      persistBookmarks(setBookmarkTitle(bookmarks, b.id, editTitleDraft));
      editingBookmarkId = null;
    }
  }

  function cancelRenameBookmark() {
    editingBookmarkId = null;
  }

  function toggleCollapseBookmark(b) {
    persistBookmarks(toggleBookmarkCollapse(bookmarks, b.id));
  }

  function doIndentBookmark(b) {
    persistBookmarks(indentBookmark(bookmarks, b.id));
  }

  function doOutdentBookmark(b) {
    persistBookmarks(outdentBookmark(bookmarks, b.id));
  }

  function addPageBookmark() {
    if (!doc) return;
    persistBookmarks([...bookmarks, {
      id: crypto.randomUUID(), page: pageNum, createdAt: new Date().toISOString()
    }]);
    notify(tr('reader.bookmarkAdded'), 'ok');
    sideTab = 'bookmarks';
  }

  function addSpotBookmark(page, u, v) {
    if (!doc) return;
    persistBookmarks([...bookmarks, {
      id: crypto.randomUUID(), page, u, v, createdAt: new Date().toISOString()
    }]);
    notify(tr('reader.bookmarkAdded'), 'ok');
    sideTab = 'bookmarks';
  }

  function removeBookmark(id) {
    persistBookmarks(bookmarks.filter((b) => b.id !== id));
    notify(tr('reader.bookmarkRemoved'), 'ok');
  }

  async function jumpToBookmark(b) {
    if (b.page !== pageNum) await goPage(b.page);
    else await tick();
    if (typeof b.u === 'number' && typeof b.v === 'number') {
      const pin = [...document.querySelectorAll('.bookmark-pin')]
        .find((el) => el.dataset.bookmarkId === b.id);
      if (pin) pin.scrollIntoView({ block: 'center', inline: 'center' });
      else if (layout === 'continuous') scrollToPage(b.page, 'smooth');
    }
    activeBookmark = b.id;
    setTimeout(() => { if (activeBookmark === b.id) activeBookmark = ''; }, 1600);
  }

  function fromSidecar(a) {
    return {
      id: a.id, type: a.type, page: a.page,
      geometry: a.geometry, style: a.style || {}, text: a.text,
      created_at: a.created_at, updated_at: a.updated_at, tags: a.tags || []
    };
  }

  // --- navigation / layout ---------------------------------------------------
  async function goPage(n) {
    const target = clamp(Math.round(Number(n) || 1), 1, Math.max(1, numPages));
    pageNum = target;
    await tick();
    if (layout === 'continuous') scrollToPage(target, 'smooth');
    else stage?.scrollTo({ top: 0 });
    persistPosition();
  }

  function prevPage() {
    goPage(stepPage({ layout, page: pageNum, numPages, delta: -1, direction: readingDir }));
  }
  function nextPage() {
    goPage(stepPage({ layout, page: pageNum, numPages, delta: 1, direction: readingDir }));
  }

  function onPageInput(e) {
    const input = e.currentTarget;
    const raw = String(input.value || '').trim();
    const match = raw.match(/^(\d+)/);
    const value = match ? Math.round(Number(match[1])) : NaN;
    if (Number.isFinite(value) && value >= 1) {
      goPage(value);
    } else {
      input.value = `${pageNum}/${numPages || 1}`;
    }
  }

  function onPageKey(e) {
    if (e.key === 'Enter') { e.preventDefault(); onPageInput(e); e.currentTarget.blur(); }
  }

  function scrollToPage(n, behavior = 'smooth', retry = 0) {
    if (!stage) return;
    const el = stage.querySelector(`.page-wrap[data-page="${n}"]`);
    if (!el) {
      if (retry < 12) {
        requestAnimationFrame(() => scrollToPage(n, behavior, retry + 1));
      }
      return;
    }
    const stageRect = stage.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const top = stage.scrollTop + (elRect.top - stageRect.top) - 12;
    stage.scrollTo({ top: Math.max(0, top), behavior });
  }

  function onStageScroll() {
    if (layout !== 'continuous' || loading || isRestoringScroll) return;
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = null;
      if (!stage) return;
      const bounds = stage.getBoundingClientRect();
      const focus = bounds.top + bounds.height * 0.36;
      let best = pageNum;
      let bestDistance = Infinity;
      for (const el of stage.querySelectorAll('.page-wrap')) {
        const r = el.getBoundingClientRect();
        if (r.bottom < bounds.top || r.top > bounds.bottom) continue;
        const distance = Math.abs((r.top + r.bottom) / 2 - focus);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = Number(el.dataset.page) || best;
        }
      }
      if (best !== pageNum && best >= 1) {
        pageNum = best;
        persistPositionSoon();
      }
    });
  }

  async function nextFrame() {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  async function setLayout(next) {
    layout = normalizeLayout(next);
    savePref(PREFS.layout, layout);
    barMenu = '';
    await tick();
    await nextFrame();
    if (layout === 'continuous') scrollToPage(pageNum, 'auto');
    else if (layout === 'spread') await fitWidth();
    else stage?.scrollTo({ top: 0 });
  }

  function toggleDirection() {
    readingDir = readingDir === 'rtl' ? 'ltr' : 'rtl';
    savePref(PREFS.direction, readingDir);
    barMenu = '';
  }

  function setReadingMode(next) {
    readingMode = normalizeReadingMode(next);
    savePref(PREFS.mode, readingMode);
    barMenu = '';
  }

  function stepSize(dir) {
    const { min, max, step } = sizeBounds;
    const next = clamp(sizePx + dir * step, min, max);
    if (tool === 'marker') markerPx = next;
    else if (tool === 'shape' || tool === 'shapeFill') shapePx = next;
    else if (tool === 'hand') handPx = next;
    else penPx = next;
  }

  async function setZoom(v) {
    scale = clamp(Number(v) || 1, 0.4, 5);
    await tick();
    persistPosition();
  }

  async function fitWidth() {
    if (!stage) return;
    const size = pageSize(pageNum);
    const pageW = rotation === 90 || rotation === 270 ? size.height : size.width;
    const pageH = rotation === 90 || rotation === 270 ? size.width : size.height;
    const pages = layout === 'spread' ? 2 : 1;
    const availW = stage.clientWidth - (pages === 2 ? 70 : 90);
    const byWidth = availW / (pageW * pages + (pages === 2 ? 14 : 0));
    // A book opening must fit BOTH pages; a single page follows the width.
    const byHeight = (stage.clientHeight - 50) / pageH;
    await setZoom(layout === 'spread' ? Math.min(byWidth, byHeight) : byWidth);
  }

  async function setRotation(r) {
    rotation = ((r % 360) + 360) % 360;
    await tick();
  }

  function persistPosition() {
    if (!loadedDocId || loading || !doc?.id || loadedDocId !== doc.id) return;
    try {
      doc.lastPage = pageNum;
      doc.lastZoom = scale;
      setReadingPosition(doc.id, { page: pageNum, zoom: scale });
    } catch { /* best-effort */ }
  }
  function persistPositionSoon() {
    if (positionTimer) clearTimeout(positionTimer);
    positionTimer = setTimeout(() => { positionTimer = null; persistPosition(); }, 350);
  }

  // --- page scrubber ---------------------------------------------------------
  function scrubTo(n) {
    const target = clamp(Math.round(n), 1, Math.max(1, numPages));
    if (target === pageNum) return;
    pageNum = target;
    if (layout === 'continuous') scrollToPage(target, 'auto');
    else stage?.scrollTo({ top: 0 });
    persistPositionSoon();
  }

  function scrubAt(clientY) {
    if (!scrubTrack || numPages < 2) return;
    const rect = scrubTrack.getBoundingClientRect();
    if (!rect.height) return;
    const ratio = clamp((clientY - rect.top) / rect.height, 0, 1);
    const target = Math.round(1 + ratio * (numPages - 1));
    scrubPreview = target;
    scrubTo(target);
  }

  function onScrubDown(e) {
    if (numPages < 2) return;
    e.preventDefault();
    scrubActive = true;
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* no pointer */ }
    scrubAt(e.clientY);
  }
  function onScrubMove(e) {
    if (!scrubActive) return;
    scrubAt(e.clientY);
  }
  function onScrubUp(e) {
    scrubActive = false;
    try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch { /* no capture */ }
  }
  function onScrubKey(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); goPage(pageNum + 1); }
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); goPage(pageNum - 1); }
  }

  function setTool(nextTool) {
    tool = nextTool;
    draft = null;
    capturing = false;
    captureRect = null;
    textRequest = null;
    if (panning) endPan();
  }

  // --- pointer dispatch ------------------------------------------------------
  function baseStyle(page) {
    const size = pageSize(page);
    const style = {
      color,
      opacity,
      thickness: clamp(sizePx / Math.max(1, size.height * scale), 0.001, 0.2)
    };
    if (tool === 'shapeFill') {
      style.fill_color = hexToRgba(fillColor || '#3498DB', fillOpacity || 0.35);
    } else if (tool === 'shape' && fillColor) {
      style.fill_color = hexToRgba(fillColor, fillOpacity);
    }
    return style;
  }

  function onPagePointer(p) {
    const e = p.event;
    if (p.type === 'down') {
      if (!pdfDoc) return;
      if (e.button !== undefined && e.button !== 0) return;
      if (pageNum !== p.page) { pageNum = p.page; persistPositionSoon(); }
      barMenu = '';
      if (tool === 'eraser') { eraseAt(p.page, p.lx, p.ly); return; }
      if (tool === 'hand') { e.preventDefault(); startPan(e); return; }
      if (tool === 'capture') {
        capturing = true;
        captureRect = { page: p.page, lx: p.lx, ly: p.ly, x: p.lx, y: p.ly, w: 0, h: 0 };
        return;
      }
      if (tool === 'text') { e.preventDefault(); openTextRequest(p); return; }
      if (tool === 'bookmark') { e.preventDefault(); addSpotBookmark(p.page, p.u, p.v); return; }
      if (tool === 'marker' || tool === 'pen' || tool === 'pointer') {
        draft = {
          type: tool === 'marker' ? 'marker' : 'pen',
          page: p.page,
          points: [[p.u, p.v]],
          style: baseStyle(p.page)
        };
        return;
      }
      if (tool === 'shape' || tool === 'shapeFill') {
        draft = {
          type: 'shape', page: p.page, start: [p.u, p.v],
          geometry: { shape, points: [[p.u, p.v], [p.u, p.v]] },
          style: baseStyle(p.page)
        };
      }
      return;
    }

    if (p.type === 'move') {
      if (capturing && captureRect && captureRect.page === p.page) {
        captureRect = { ...captureRect, w: p.lx - captureRect.lx, h: p.ly - captureRect.ly };
        return;
      }
      if (panning) { doPan(e); return; }
      if (tool === 'eraser' && e.buttons) { eraseAt(p.page, p.lx, p.ly); return; }
      if (!draft || draft.page !== p.page) return;
      if (draft.type === 'shape') {
        draft = { ...draft, geometry: { ...draft.geometry, points: [draft.start, [p.u, p.v]] } };
      } else {
        draft = { ...draft, points: [...draft.points, [p.u, p.v]] };
      }
      if (tool === 'pointer') resetRedPenTimer();
      return;
    }

    if (p.type === 'up') {
      if (capturing && captureRect) { finishCapture(); return; }
      if (panning) { endPan(); return; }
      if (!draft || draft.page !== p.page) return;
      const finished = draft;
      draft = null;
      if (tool === 'pointer') {
        if (finished.points?.length) {
          redPen = [...redPen, { page: p.page, points: finished.points, style: finished.style }];
          resetRedPenTimer();
        }
        return;
      }
      const ann = finalizeAnnotation(finished, p.page);
      if (ann) {
        annotations = [...annotations, ann];
        undoManager.recordAdd(doc.id, ann);
        undoVersion++;
        commitAnnotations();
      }
    }
  }

  function finalizeAnnotation(d, page) {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    if (d.type === 'marker') {
      return { id, type: 'marker', page, geometry: markerGeometry(d.points), style: d.style, created_at: now, updated_at: now };
    }
    if (d.type === 'pen') {
      if (!d.points || d.points.length < 2) return null;
      return { id, type: 'pen', page, geometry: { points: d.points }, style: d.style, created_at: now, updated_at: now };
    }
    if (d.type === 'shape') {
      const [[u1, v1], [u2, v2]] = d.geometry.points;
      if (Math.hypot(u2 - u1, v2 - v1) < 0.004) return null;
      return { id, type: 'shape', page, geometry: { shape, points: d.geometry.points }, style: d.style, created_at: now, updated_at: now };
    }
    return null;
  }

  function markerGeometry(points) {
    const us = points.map((p) => p[0]);
    const vs = points.map((p) => p[1]);
    const minU = Math.min(...us), maxU = Math.max(...us);
    const minV = Math.min(...vs), maxV = Math.max(...vs);
    const spanU = maxU - minU;
    const spanV = maxV - minV;
    if (spanU < 0.004 && spanV < 0.004) {
      const u = points[0][0];
      const v = points[0][1];
      return { mode: 'point', points: [[u, v], [u, v]] };
    }
    if (spanU >= spanV) {
      const vMid = (minV + maxV) / 2;
      return { mode: 'horizontal', points: [[minU, vMid], [maxU, vMid]] };
    }
    const uMid = (minU + maxU) / 2;
    return { mode: 'vertical', points: [[uMid, minV], [uMid, maxV]] };
  }

  // --- eraser ----------------------------------------------------------------
  function eraseAt(page, lx, ly) {
    const t = pageTransform(page);
    const hit = hitTest(annotations, page, lx, ly, t, ERASER_RADIUS, viewFilter);
    if (!hit) return;
    annotations = annotations.filter((a) => a.id !== hit.id);
    undoManager.recordRemove(doc.id, hit);
    undoVersion++;
    commitAnnotations();
  }

  // --- undo / redo -----------------------------------------------------------
  function undo() {
    const res = undoManager.undo(doc.id, annotations);
    if (!res) return;
    annotations = res.list;
    undoVersion++;
    commitAnnotations();
  }
  function redo() {
    const res = undoManager.redo(doc.id, annotations);
    if (!res) return;
    annotations = res.list;
    undoVersion++;
    commitAnnotations();
  }

  // --- pointer trail (temporary) ---------------------------------------------
  function resetRedPenTimer() {
    if (redPenTimer) clearTimeout(redPenTimer);
    redPenTimer = setTimeout(() => {
      redPen = [];
      redPenTimer = null;
    }, 1500);
  }

  // --- hand / pan ------------------------------------------------------------
  let panning = $state(false);
  let panStart = null;
  function startPan(e) {
    panning = true;
    panStart = { x: e.clientX, y: e.clientY, sl: stage.scrollLeft, st: stage.scrollTop };
  }
  function doPan(e) {
    if (!panStart || !stage) return;
    stage.scrollLeft = panStart.sl - (e.clientX - panStart.x);
    stage.scrollTop = panStart.st - (e.clientY - panStart.y);
  }
  function endPan() { panning = false; panStart = null; }

  // --- text tool -------------------------------------------------------------
  function openTextRequest(p) {
    const t = pageTransform(p.page);
    const w = Math.min(260, Math.max(140, Math.round(t.displayWidth * 0.32)));
    const h = 44;
    const x = clamp(p.lx, 2, Math.max(2, t.displayWidth - w - 2));
    const y = clamp(p.ly, 48, Math.max(48, t.displayHeight - h - 2));
    textRequest = {
      key: crypto.randomUUID(), page: p.page, id: null, text: '',
      lx: x, ly: y, w, h, fontSize: 18, color: '#111827', direction: 'auto'
    };
  }

  function onTextDone(v) {
    textRequest = null;
    if (!v?.text) return;
    const now = new Date().toISOString();
    const ann = {
      id: v.id || crypto.randomUUID(), type: 'text', page: v.page,
      geometry: { points: [[v.u, v.v]], w: v.wNorm, h: v.hNorm },
      style: {
        color: v.color, opacity: 1, font_size: v.fontNorm,
        font_family: v.fontFamily || 'Cairo, sans-serif',
        direction: v.direction, background: 'rgba(255,255,255,0.85)', bg_opacity: 0.85
      },
      text: v.text, created_at: now, updated_at: now
    };
    if (v.id) {
      const before = annotations.find((a) => a.id === v.id);
      annotations = annotations.map((a) => (a.id === v.id ? ann : a));
      undoManager.recordUpdate(doc.id, before, ann);
    } else {
      annotations = [...annotations, ann];
      undoManager.recordAdd(doc.id, ann);
    }
    undoVersion++;
    commitAnnotations();
  }

  // --- capture ---------------------------------------------------------------
  function finishCapture() {
    const r = captureRect;
    capturing = false;
    captureRect = null;
    if (!r || Math.abs(r.w) < 4 || Math.abs(r.h) < 4) return;
    const refs = pageRefs.get(r.page);
    if (!refs?.pdfCanvas) return;
    const t = pageTransform(r.page);
    const x = clamp(Math.min(r.lx, r.lx + r.w), 0, t.displayWidth);
    const y = clamp(Math.min(r.ly, r.ly + r.h), 0, t.displayHeight);
    const w = Math.min(Math.abs(r.w), t.displayWidth - x);
    const h = Math.min(Math.abs(r.h), t.displayHeight - y);
    if (w < 4 || h < 4) return;
    const zoom = 2;
    const crop = document.createElement('canvas');
    crop.width = Math.round(w * zoom);
    crop.height = Math.round(h * zoom);
    const ctx = crop.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, crop.width, crop.height);
    const sx = (x / t.displayWidth) * refs.pdfCanvas.width;
    const sy = (y / t.displayHeight) * refs.pdfCanvas.height;
    const sw = (w / t.displayWidth) * refs.pdfCanvas.width;
    const sh = (h / t.displayHeight) * refs.pdfCanvas.height;
    ctx.drawImage(refs.pdfCanvas, sx, sy, sw, sh, 0, 0, crop.width, crop.height);
    try {
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(refs.markerCanvas, sx, sy, sw, sh, 0, 0, crop.width, crop.height);
      ctx.restore();
    } catch {}
    try { ctx.drawImage(refs.annCanvas, sx, sy, sw, sh, 0, 0, crop.width, crop.height); } catch {}
    const image = canvasCapture(crop);
    if (!image) return;
    const [u, v] = t.fromLocal(x, y);
    const defaultName = `${(doc.title || 'page').replace(/\.[^.]+$/, '')} ${tr('common.pageShort')}${r.page}`;
    // A capture is a screenshot, not a question: save it immediately. Images can
    // be turned into flashcards later from the Gallery or a flashcard set.
    const capture = {
      id: crypto.randomUUID(), documentId: doc.id, source: doc.title || doc.filename,
      page: r.page, rect: { u, v, w: w / t.displayWidth, h: h / t.displayHeight },
      image, name: defaultName, caption: '', tags: '', createdAt: new Date().toISOString()
    };
    onCapture(capture);
    sideTab = 'images';
  }

  // --- exports ---------------------------------------------------------------
  function baseName() {
    return (doc?.title || doc?.filename || 'document')
      .replace(/\.[^.]+$/, '')
      .replace(/(?:\s+[—–-]\s+annotated)+$/i, '');
  }

  function bridge() {
    return globalThis.window?.studyos || null;
  }

  async function runExport(kind, fn) {
    if (exporting) return;
    barMenu = '';
    exporting = kind;
    try {
      const res = await fn();
      notify(res.where === 'file' ? tr('toast.exportedTo', { path: res.path }) : tr('toast.downloaded', { path: res.path }), 'ok');
    } catch (e) {
      notify(tr('toast.exportFailed', { message: e.message }), 'error');
    } finally {
      exporting = '';
    }
  }

  function exportAnnotatedCopy() {
    return runExport('copy', async () => {
      const bytes = await readPdfBytes(doc.id);
      if (!bytes) throw new Error(tr('export.sourceUnavailable'));
      const { bytes: out, stats } = await annotatedCopyPdf({
        sourceBytes: bytes, annotations, renderTextImage: renderTextAnnotationImage
      });
      if (stats.skipped.length) notify(tr('toast.skippedItems', { n: stats.skipped.length, items: stats.skipped.join('; ') }), 'error');
      return deliverBytes(out, `${baseName()} — annotated.pdf`, bridge());
    });
  }

  async function saveAnnotatedToLibrary({ silent = false } = {}) {
    if (!doc || savingCopy) return;
    savingCopy = true;
    if (!silent) barMenu = '';
    try {
      if (typeof onSaveAnnotated !== 'function') throw new Error('library handler unavailable');
      const bytes = await readPdfBytes(doc.id);
      if (!bytes) throw new Error(tr('export.sourceUnavailable'));
      const { bytes: out, stats } = await annotatedCopyPdf({
        sourceBytes: bytes, annotations, renderTextImage: renderTextAnnotationImage
      });
      await onSaveAnnotated(out, `${baseName()} — annotated.pdf`, { docId: doc.id });
      if (silent) {
        notify(tr('reader.autosavedNotice'), 'ok');
      } else {
        notify(tr('reader.saved'), 'ok');
        if (stats.skipped.length) notify(tr('toast.skippedItems', { n: stats.skipped.length, items: stats.skipped.join('; ') }), 'error');
      }
    } catch (e) {
      if (!silent) notify(tr('reader.saveCopyFailed', { message: e.message }), 'error');
    } finally {
      savingCopy = false;
    }
  }

  function exportDocumentImages() {
    return runExport('images', async () => {
      if (!docCaptures.length) throw new Error(tr('side.noImagesExport'));
      const ordered = [...docCaptures].sort((a, b) =>
        (a.page || 0) - (b.page || 0) || String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
      );
      const bytes = await imagesToPdf(
        ordered.map((c) => ({
          image: c.image,
          label: `${c.source || baseName()} · p${c.page || '?'} · ${c.name || ''}`
        })),
        { labels: true, renderLabelImage: labelPng }
      );
      return deliverBytes(bytes, `${baseName()} — images.pdf`, bridge());
    });
  }

  function exportHighlights() {
    return runExport('highlights', async () => {
      if (!pdfDoc) throw new Error(tr('export.documentNotLoaded'));
      const markers = annotations.filter((a) => a.type === 'marker');
      if (!markers.length) throw new Error(tr('export.noMarkers'));
      const out = await excerptsPdf({
        markers, sourceName: doc?.title || doc?.filename || '', rasterizeRegion: rasterizeMarkerRegion,
        renderLabelImage: labelPng
      });
      return deliverBytes(out, `${baseName()} — highlights.pdf`, bridge());
    });
  }

  function exportSidecar() {
    return runExport('json', async () => {
      const sidecar = buildSidecar({ documentId: doc.id, sourceFilename: doc.filename, pageMetadata: pageMeta, annotations });
      const bytes = new TextEncoder().encode(serializeSidecar(sidecar));
      return deliverBytes(bytes, `${baseName()}.annotations.json`, bridge(), 'application/json');
    });
  }

  async function rasterizeMarkerRegion(pageNumber, rect) {
    const page = await pdfDoc.getPage(pageNumber);
    const exportScale = 2;
    const vp = page.getViewport({ scale: exportScale, rotation: 0 });
    const full = document.createElement('canvas');
    full.width = Math.ceil(vp.width);
    full.height = Math.ceil(vp.height);
    await page.render({ canvasContext: full.getContext('2d'), viewport: vp }).promise;
    const sx = Math.max(0, Math.floor(rect.u * vp.width));
    const sy = Math.max(0, Math.floor(rect.v * vp.height));
    const sw = Math.max(1, Math.ceil(rect.w * vp.width));
    const sh = Math.max(1, Math.ceil(rect.h * vp.height));
    const crop = document.createElement('canvas');
    crop.width = sw;
    crop.height = sh;
    const ctx = crop.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, sw, sh);
    ctx.drawImage(full, sx, sy, sw, sh, 0, 0, sw, sh);
    try {
      const pageBase = page.getViewport({ scale: 1, rotation: 0 });
      const t = createTransform({ pageWidth: pageBase.width, pageHeight: pageBase.height, scale: exportScale, rotation: 0 });
      const layer = document.createElement('canvas');
      layer.width = full.width;
      layer.height = full.height;
      const lctx = layer.getContext('2d');
      renderAnnotations(lctx, annotations, pageNumber, t, { filter: 'highlights' });
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(layer, sx, sy, sw, sh, 0, 0, sw, sh);
      ctx.restore();
    } catch { /* crop still valid without overlay */ }
    return crop.toDataURL('image/png');
  }

  function renderTextAnnotationImage(ann, { pageWidth, pageHeight }) {
    try {
      const t = createTransform({ pageWidth, pageHeight, scale: 2, rotation: 0 });
      const g = ann.geometry || {};
      const w = Math.max(2, Math.ceil((g.w ?? 0.25) * pageWidth * 2));
      const h = Math.max(2, Math.ceil((g.h ?? 0.05) * pageHeight * 2));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.translate(-(g.points?.[0]?.[0] ?? 0) * pageWidth * 2, -(g.points?.[0]?.[1] ?? 0) * pageHeight * 2);
      renderAnnotations(ctx, [{ ...ann, page: -1 }], -1, t, { filter: 'all' });
      return canvas.toDataURL('image/png');
    } catch {
      return null;
    }
  }

  // --- view / search ---------------------------------------------------------
  async function setView(mode) {
    if (mode === 'all') { viewFilter = 'all'; pageRender = 'pdf'; }
    else if (mode === 'annotations') { viewFilter = 'annotations'; pageRender = 'blank'; }
    else if (mode === 'highlights') { viewFilter = 'highlights'; pageRender = 'blank'; }
    barMenu = '';
    await tick();
  }

  async function runSearch() {
    if (!pdfDoc || !searchTerm.trim()) { searchStatus = ''; return; }
    const q = searchTerm.trim().toLowerCase();
    for (let n = 1; n <= numPages; n++) {
      try {
        const page = await pdfDoc.getPage(n);
        const text = (await extractPageText(page)).toLowerCase();
        if (text.includes(q)) {
          await goPage(n);
          searchStatus = tr('reader.foundOnPage', { n });
          return;
        }
      } catch {}
    }
    searchStatus = tr('reader.noMatch');
  }

  async function toggleSearch() {
    barMenu = barMenu === 'search' ? '' : 'search';
    if (barMenu === 'search') {
      await tick();
      searchInput?.focus();
    }
  }

  // --- thumbnails / side panel ----------------------------------------------
  async function renderThumbs() {
    if (!pdfDoc || !sideOpen || sideTab !== 'pages') return;
    const source = pdfDoc;
    for (let n = 1; n <= numPages; n++) {
      if (source !== pdfDoc) return;
      const c = thumbCanvases[n - 1];
      if (!c) continue;
      try {
        const page = await source.getPage(n);
        const base = page.getViewport({ scale: 1, rotation: 0 });
        const w = 120;
        const s = w / base.width;
        const vp = page.getViewport({ scale: s, rotation: 0 });
        c.width = Math.floor(vp.width);
        c.height = Math.floor(vp.height);
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      } catch {}
    }
  }

  function setThumbEl(node, n) {
    thumbCanvases[n - 1] = node;
    return { destroy() { thumbCanvases[n - 1] = null; } };
  }

  async function setSideTab(tab) {
    sideTab = tab;
    await tick();
    if (tab === 'pages' && sideOpen) renderThumbs();
  }

  async function toggleSideTab(tab) {
    if (sideOpen && sideTab === tab) { sideOpen = false; return; }
    sideOpen = true;
    sideTab = tab;
    await tick();
    if (tab === 'pages') renderThumbs();
  }

  // --- save ------------------------------------------------------------------
  function commitAnnotations() {
    if (!doc) return;
    saveState = 'saving';
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      saveTimer = null;
      const sidecar = buildSidecar({ documentId: doc.id, sourceFilename: doc.filename, pageMetadata: pageMeta, annotations });
      try {
        const res = await sidecarStore.save(doc.id, sidecar);
        saveState = res.ok ? 'saved' : 'error';
        saveError = res.ok ? '' : res.error || '';
      } catch (e) {
        saveState = 'error';
        saveError = e.message;
      }
    }, 150);
  }

  // --- fullscreen ------------------------------------------------------------
  async function toggleFullscreen() {
    fullscreen = !fullscreen;
    barMenu = '';
    try {
      if (fullscreen && readerRoot?.requestFullscreen) await readerRoot.requestFullscreen();
      else if (!fullscreen && document.fullscreenElement) await document.exitFullscreen();
    } catch {
      /* embedded/blocked fullscreen: the CSS mode alone is still correct */
    }
  }

  function onFullscreenChange() {
    if (!document.fullscreenElement && fullscreen) fullscreen = false;
  }

  function isTypingTarget(target) {
    const tag = target?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!target?.isContentEditable;
  }

  function onKeydown(event) {
    if (imagePreview && event.key === 'Escape') { event.preventDefault(); imagePreview = null; return; }
    if (toolbarSettingsOpen && event.key === 'Escape') { event.preventDefault(); closeToolbarSettings(); return; }
    if (barMenu && event.key === 'Escape') { event.preventDefault(); barMenu = ''; return; }

    const isCtrlOrCmd = event.ctrlKey || event.metaKey;

    if (isCtrlOrCmd) {
      const key = event.key.toLowerCase();
      // Ctrl+S / Cmd+S: Save PDF
      if (key === 's') {
        event.preventDefault();
        saveAnnotatedToLibrary();
        return;
      }
      // Ctrl+Z / Cmd+Z: Undo (or Redo if Shift is held)
      if (key === 'z') {
        if (!isTypingTarget(event.target)) {
          event.preventDefault();
          if (event.shiftKey) redo();
          else undo();
          return;
        }
      }
      // Ctrl+Y / Cmd+Y: Redo
      if (key === 'y') {
        if (!isTypingTarget(event.target)) {
          event.preventDefault();
          redo();
          return;
        }
      }
      return;
    }

    if (event.altKey) return;
    if (imagePreview) return;
    if (isTypingTarget(event.target)) return;
    if (document.querySelector('[role="dialog"]')) return;
    if (event.key === 'f' || event.key === 'F') {
      event.preventDefault();
      toggleFullscreen();
    } else if (event.key === 'Escape' && fullscreen) {
      event.preventDefault();
      toggleFullscreen();
    }
  }

  // --- toolbar customisation -------------------------------------------------
  function barLabel(id) {
    if (id.startsWith('custom:')) {
      return customPresets.find((p) => p.id === id)?.name || tr('reader.customButton');
    }
    const key = BAR_BY_ID[id]?.label;
    return key ? tr(key) : id;
  }

  function moveBar(id, delta) {
    saveToolbarConfig({ ...toolbarConfig, order: moveBarOrder(toolbarConfig.order, id, delta) });
  }

  function addPreset() {
    if (!presetForm) return;
    const form = presetForm;
    const id = `custom:${crypto.randomUUID()}`;
    const preset = {
      id,
      name: form.name.trim() || `${shapeLabel(form.shape)} ${form.size}`,
      tool: form.tool,
      shape: form.tool === 'shape' ? form.shape : '',
      size: Math.max(1, Number(form.size) || (form.tool === 'marker' ? 25 : 5)),
      color: form.color,
      fillColor: form.tool === 'shape' ? form.fillColor : '',
      fillOpacity: form.tool === 'shape' ? Number(form.fillOpacity) || 0 : 0
    };
    saveToolbarConfig({
      order: insertAfterBarItem(toolbarConfig.order, form.afterId, id),
      custom: [...toolbarConfig.custom, preset]
    });
    presetOpen = false;
  }

  function removePreset(id) {
    saveToolbarConfig({
      order: removeBarItem(toolbarConfig.order, id),
      custom: toolbarConfig.custom.filter((p) => p.id !== id)
    });
  }

  function resetToolbar() {
    saveToolbarConfig({ order: defaultBarOrder(), custom: [] });
    presetOpen = false;
  }

  function closeToolbarSettings() {
    presetOpen = false;
    toolbarSettingsOpen = false;
  }

  function openPreset(afterId, baseTool = 'shape') {
    presetOpen = true;
    presetForm = {
      afterId, tool: baseTool,
      shape: 'rectangle',
      size: baseTool === 'marker' ? 25 : 10,
      color: baseTool === 'marker' ? '#F4D03F' : '#EB5757',
      fillColor: '#2F80ED',
      fillOpacity: 0.1,
      name: ''
    };
  }

  function applyPreset(preset) {
    if (preset.tool === 'shape') {
      tool = 'shape';
      shape = SHAPES.includes(preset.shape) ? preset.shape : 'rectangle';
      shapePx = clamp(Number(preset.size) || 5, PEN_MIN, PEN_MAX);
      color = preset.color || '#EB5757';
      fillColor = preset.fillColor || '';
      fillOpacity = clamp(Number(preset.fillOpacity) || 0, 0, 1);
    } else if (preset.tool === 'marker') {
      tool = 'marker';
      markerPx = clamp(Number(preset.size) || 25, MARKER_MIN, MARKER_MAX);
      color = preset.color || '#F4D03F';
      fillColor = '';
    } else if (preset.tool === 'pen') {
      tool = 'pen';
      penPx = clamp(Number(preset.size) || 5, PEN_MIN, PEN_MAX);
      color = preset.color || '#EB5757';
      fillColor = '';
    }
    barMenu = '';
  }

  function onToolbarDragStart(e, index) {
    dragFromIndex = index;
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', String(index)); } catch {}
  }

  function onToolbarDrop(e, index) {
    e.preventDefault();
    const from = dragFromIndex;
    dragFromIndex = -1;
    if (from < 0 || from === index) return;
    const list = [...toolbarConfig.order];
    const [id] = list.splice(from, 1);
    list.splice(index, 0, id);
    saveToolbarConfig({ ...toolbarConfig, order: list });
  }

  let autosaveTimer = null;
  function setupAutosave() {
    if (autosaveTimer) {
      clearInterval(autosaveTimer);
      autosaveTimer = null;
    }
    const config = loadPdfAutosaveSettings();
    if (!config.enabled || !config.interval) return;
    const ms = Math.max(1, config.interval) * 60 * 1000;
    autosaveTimer = setInterval(async () => {
      if (loading || !doc || savingCopy) return;
      try {
        await saveAnnotatedToLibrary({ silent: true });
      } catch { /* background autosave silently */ }
    }, ms);
  }

  function toggleSidebar() {
    sideOpen = !sideOpen;
    if (sideOpen && !sideTab) sideTab = 'bookmarks';
  }

  function presetTitle(preset) {
    const size = `${preset.size}`;
    return preset.tool === 'shape'
      ? `${preset.name} · ${shapeLabel(preset.shape)} · ${size}`
      : `${preset.name} · ${size}`;
  }
</script>

<svelte:window onkeydown={onKeydown} onfullscreenchange={onFullscreenChange} />

<div class="reader" class:is-fullscreen={fullscreen} class:has-tabs={!fullscreen && tabDocs.length > 0} data-reading-mode={readingMode} data-layout={layout} bind:this={readerRoot}>
  {#if !fullscreen && tabDocs.length}
    <div class="doc-tabs" dir="ltr" role="tablist" aria-label={tr('reader.tabs')} use:autoScrollbar>
      {#if onBack}
        <button class="doc-tab-back" onclick={() => onBack?.()} title={tr('common.back')} aria-label={tr('common.back')}>
          <Icon name="arrow-left" size={14} />
          <span>{tr('common.back')}</span>
        </button>
      {/if}
      {#each tabDocs as tab (tab.id)}
        <div class="doc-tab" class:active={tab.id === activeTabId}>
          <button class="doc-tab-main" role="tab" aria-selected={tab.id === activeTabId}
            onclick={() => onSelectTab?.(tab.id)} title={tab.title}>
            <Icon name="reader" size={13} /><span dir="auto">{tab.title}</span>
          </button>
          <button class="doc-tab-close" onclick={(e) => { e.stopPropagation(); onCloseTab?.(tab.id); }}
            title={tr('reader.closeTab')} aria-label={tr('reader.closeTab')}><Icon name="x" size={12} /></button>
        </div>
      {/each}
      <button class="doc-tab-add" onclick={() => onNewTab?.()} title={tr('reader.newTab')} aria-label={tr('reader.newTab')}><Icon name="plus" size={14} /></button>
    </div>
  {/if}

  <!-- One icon-only line, in normal and fullscreen modes alike. Every control is
       a flex item; `order` comes from the saved toolbar customisation. -->
  <div class="fs-bar reader-bar" dir="ltr" role="toolbar" aria-label={tr('reader.fullscreen')} use:autoScrollbar>
    {#if onBack}
      <button style={addBarOrder('back')} onclick={() => onBack?.()} title={tr('common.back')} aria-label={tr('common.back')}>
        <Icon name="arrow-left" size={17} />
      </button>
    {/if}
    {#if fullscreen}
      <button style={addBarOrder('tabs')} class={barMenu === 'tabs' ? 'active' : ''} onclick={() => (barMenu = barMenu === 'tabs' ? '' : 'tabs')}
        title={tr('reader.tabs')} aria-label={tr('reader.tabs')} aria-expanded={barMenu === 'tabs'}><Icon name="tabs" size={17} /></button>
    {/if}
    <button style={addBarOrder('fullscreen')} onclick={toggleFullscreen}
      title={fullscreen ? tr('reader.exitFullscreen') : tr('reader.fullscreen')}
      aria-label={fullscreen ? tr('reader.exitFullscreen') : tr('reader.fullscreen')} aria-pressed={fullscreen}>
      <Icon name={fullscreen ? 'minimize' : 'maximize'} size={17} />
    </button>
    <button style={addBarOrder('side-images')} class={sideOpen && sideTab === 'images' ? 'active' : ''} onclick={() => toggleSideTab('images')}
      title={tr('side.images')} aria-label={tr('side.images')} aria-pressed={sideOpen && sideTab === 'images'}><Icon name="camera" /></button>
    <button style={addBarOrder('side-pages')} class={sideOpen && sideTab === 'pages' ? 'active' : ''} onclick={() => toggleSideTab('pages')}
      title={tr('side.pages')} aria-label={tr('side.pages')} aria-pressed={sideOpen && sideTab === 'pages'}><Icon name="thumbnails" /></button>
    <button style={addBarOrder('side-bookmarks')} class={sideOpen && sideTab === 'bookmarks' ? 'active' : ''} onclick={() => toggleSideTab('bookmarks')}
      title={tr('side.bookmarks')} aria-label={tr('side.bookmarks')} aria-pressed={sideOpen && sideTab === 'bookmarks'}><Icon name="bookmark" /></button>

    <button style={addBarOrder('direction')} onclick={toggleDirection}
      title={`${tr('reader.readingDirection')}: ${readingDir === 'rtl' ? tr('reader.rtl') : tr('reader.ltr')}`}
      aria-label={`${tr('reader.readingDirection')}: ${readingDir === 'rtl' ? tr('reader.rtl') : tr('reader.ltr')}`}>
      <Icon name="arrow-left-right" size={17} />
    </button>
    <button style={addBarOrder('layout')} class={barMenu === 'layout' ? 'active' : ''} onclick={() => (barMenu = barMenu === 'layout' ? '' : 'layout')}
      title={tr('reader.layout')} aria-label={tr('reader.layout')} aria-expanded={barMenu === 'layout'}><Icon name={layoutIcon} /></button>
    <button style={addBarOrder('mode')} class={barMenu === 'mode' ? 'active' : ''} onclick={() => (barMenu = barMenu === 'mode' ? '' : 'mode')}
      title={tr('reader.readingMode')} aria-label={tr('reader.readingMode')} aria-expanded={barMenu === 'mode'}><Icon name={modeIcon} /></button>

    <button style={addBarOrder('prev')} onclick={prevPage} disabled={pageNum <= 1}
      title={tr('reader.previousPage')} aria-label={tr('reader.previousPage')}><Icon name={prevIcon} /></button>
    <input class="fs-page-input" style="{addBarOrder('page')}; width: 68px; text-align: center; font-variant-numeric: tabular-nums;"
      type="text"
      value="{pageNum}/{numPages || 1}"
      onchange={onPageInput}
      onkeydown={onPageKey}
      onfocus={(e) => e.currentTarget.select()}
      title={tr('reader.jumpPage')}
      aria-label={tr('reader.jumpPage')} />
    <button style={addBarOrder('next')} onclick={nextPage} disabled={pageNum >= numPages}
      title={tr('reader.nextPage')} aria-label={tr('reader.nextPage')}><Icon name={nextIcon} /></button>

    <button style={addBarOrder('zoom-out')} onclick={() => setZoom(scale - 0.25)} title={tr('reader.zoomOut')} aria-label={tr('reader.zoomOut')}><Icon name="minus" /></button>
    <span class="fs-zoom" style={addBarOrder('zoom')} dir="ltr">{Math.round(scale * 100)}%</span>
    <button style={addBarOrder('zoom-in')} onclick={() => setZoom(scale + 0.25)} title={tr('reader.zoomIn')} aria-label={tr('reader.zoomIn')}><Icon name="plus" /></button>
    <button style={addBarOrder('fit')} onclick={fitWidth} title={tr('reader.fitWidth')} aria-label={tr('reader.fitWidth')}><Icon name="fit" /></button>
    <button style={addBarOrder('rotate-left')} onclick={() => setRotation(rotation - 90)} title={tr('reader.rotateLeft')} aria-label={tr('reader.rotateLeft')}><Icon name="rotate-left" /></button>
    <button style={addBarOrder('rotate-right')} onclick={() => setRotation(rotation + 90)} title={tr('reader.rotateRight')} aria-label={tr('reader.rotateRight')}><Icon name="rotate-right" /></button>

    {#each TOOLS as def}
      <button style={addBarOrder(`tool-${def.id}`)} class={tool === def.id ? 'active' : ''} onclick={() => setTool(def.id)}
        title={tr(def.label)} aria-label={tr(def.label)} aria-pressed={tool === def.id}><Icon name={def.icon} size={17} /></button>
    {/each}

    <span class="bar-group" style={addBarOrder('colors')}>
      {#each PALETTE as c}
        <button class="swatch {color === c.value ? 'active' : ''}" style="background:{c.value}"
          title={tr(`color.${c.key}`)} aria-label={tr(`color.${c.key}`)} onclick={() => (color = c.value)}></button>
      {/each}
    </span>

    {#if SIZE_TOOLS.has(tool)}
      <span class="bar-group stepper" style={addBarOrder('size')} role="group" aria-label={tr(sizeLabelKey, { n: sizePx })}>
        <button onclick={() => stepSize(-1)} disabled={sizePx <= sizeBounds.min}
          title={tr('tool.sizeDown', { n: sizePx - sizeBounds.step })} aria-label={tr('tool.sizeDown', { n: sizePx - sizeBounds.step })}><Icon name="minus" size={13} /></button>
        <span class="stepper-value" title={tr(sizeLabelKey, { n: sizePx })}>{sizePx}</span>
        <button onclick={() => stepSize(1)} disabled={sizePx >= sizeBounds.max}
          title={tr('tool.sizeUp', { n: sizePx + sizeBounds.step })} aria-label={tr('tool.sizeUp', { n: sizePx + sizeBounds.step })}><Icon name="plus" size={13} /></button>
      </span>
    {/if}

    {#if tool === 'shape' || tool === 'shapeFill'}
      <span class="bar-group" style={addBarOrder('shapes')}>
        {#each SHAPES as s}
          <button class="shape-opt {shape === s ? 'active' : ''}" aria-pressed={shape === s} onclick={() => (shape = s)} title={shapeLabel(s)} aria-label={shapeLabel(s)}>
            <svg viewBox="0 0 24 24" fill={tool === 'shapeFill' && (s === 'rectangle' || s === 'ellipse') ? 'currentColor' : 'none'} fill-opacity={tool === 'shapeFill' ? '0.28' : '0'} stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              {#if s === 'rectangle'}<rect x="3" y="5.5" width="18" height="13" rx="1.5" />
              {:else if s === 'ellipse'}<ellipse cx="12" cy="12" rx="9" ry="6.5" />
              {:else if s === 'line'}<line x1="4" y1="19" x2="20" y2="5" />
              {:else if s === 'arrow'}<line x1="3.5" y1="20" x2="19" y2="5" /><polyline points="12,5 19,5 19,12" />
              {:else if s === 'check'}<polyline points="4,13 9.5,19 20,5" />
              {:else}<line x1="5" y1="5" x2="19" y2="19" /><line x1="19" y1="5" x2="5" y2="19" />{/if}
            </svg>
          </button>
        {/each}
      </span>
      {#if tool === 'shapeFill'}
        <span class="bar-group" style="{addBarOrder('shapes')}; display:inline-flex; align-items:center; gap:4px; padding: 2px 6px;">
          <input type="color" bind:value={fillColor} title={tr('tool.fillColor')} aria-label={tr('tool.fillColor')} style="width:24px; height:24px; padding:0; border:none; border-radius:4px; cursor:pointer;" />
        </span>
      {/if}
    {/if}

    {#each customPresets as preset (preset.id)}
      <button style={addBarOrder(preset.id)} class="custom-tool" onclick={() => applyPreset(preset)}
        title={presetTitle(preset)} aria-label={presetTitle(preset)}>
        <Icon name={preset.tool === 'shape' ? 'shape' : preset.tool === 'marker' ? 'marker' : 'pen'} size={16} />
        <span class="preset-dot" style="background:{preset.fillColor || preset.color}"></span>
      </button>
    {/each}

    <button style={addBarOrder('undo')} onclick={undo} disabled={!undoState.u} title={tr('reader.undo')} aria-label={tr('reader.undo')}><Icon name="undo" /></button>
    <button style={addBarOrder('redo')} onclick={redo} disabled={!undoState.r} title={tr('reader.redo')} aria-label={tr('reader.redo')}><Icon name="redo" /></button>


    <button style={addBarOrder('search')} class={barMenu === 'search' ? 'active' : ''} onclick={toggleSearch}
      title={tr('reader.search')} aria-label={tr('reader.search')} aria-expanded={barMenu === 'search'}><Icon name="search" /></button>
    <button style={addBarOrder('display')} class={barMenu === 'display' ? 'active' : ''} onclick={() => (barMenu = barMenu === 'display' ? '' : 'display')}
      title={tr('reader.display')} aria-label={tr('reader.display')} aria-expanded={barMenu === 'display'}><Icon name="eye" /></button>
    <button style={addBarOrder('export')} class={barMenu === 'export' ? 'active' : ''} disabled={!!exporting}
      onclick={() => (barMenu = barMenu === 'export' ? '' : 'export')} title={tr('common.export')} aria-label={tr('common.export')} aria-expanded={barMenu === 'export'}>
      <Icon name="download" />
    </button>
    <button style={addBarOrder('settings')} onclick={() => { barMenu = ''; presetOpen = false; toolbarSettingsOpen = true; }}
      title={tr('reader.toolbarSettings')} aria-label={tr('reader.toolbarSettings')}><Icon name="settings" /></button>

    <span class="bar-status {saveState}" style={addBarOrder('status')}
      title={saveState === 'saving' ? tr('reader.saving') : saveState === 'error' ? tr('reader.saveFailed', { message: saveError }) : tr('reader.saved')}>
      <span class="dot"></span><span class="sr-only">{saveState === 'saving' ? tr('reader.saving') : tr('reader.saved')}</span>
    </span>
  </div>

  <!-- Menus live outside the scrolling bar so they are never clipped. -->
  {#if barMenu === 'layout'}
    <div class="bar-menu" role="menu" aria-label={tr('reader.layout')}>
      <div class="menu-title">{tr('reader.layout')}</div>
      {#each [
        { id: 'continuous', icon: 'scroll', label: 'reader.continuous', hint: 'reader.continuousHint' },
        { id: 'single', icon: 'single-page', label: 'reader.single', hint: 'reader.singleHint' },
        { id: 'spread', icon: 'columns', label: 'reader.spread', hint: 'reader.spreadHint' }
      ] as option}
        <button role="menuitemradio" aria-checked={layout === option.id} class={layout === option.id ? 'active' : ''} onclick={() => setLayout(option.id)}>
          <Icon name={option.icon} size={16} /><span class="menu-label"><span>{tr(option.label)}</span><small>{tr(option.hint)}</small></span>
          {#if layout === option.id}<Icon name="check" size={14} />{/if}
        </button>
      {/each}
      <button role="menuitem" onclick={toggleDirection}>
        <Icon name="arrow-left-right" size={16} /><span class="menu-label"><span>{tr('reader.readingDirection')}</span><small>{readingDir === 'rtl' ? tr('reader.rtl') : tr('reader.ltr')}</small></span>
      </button>
    </div>
  {:else if barMenu === 'mode'}
    <div class="bar-menu" role="menu" aria-label={tr('reader.readingMode')}>
      <div class="menu-title">{tr('reader.readingMode')}</div>
      {#each [
        { id: 'normal', icon: 'eye', label: 'reader.modeNormal' },
        { id: 'paper', icon: 'sun', label: 'reader.modePaper' },
        { id: 'amber', icon: 'sun', label: 'reader.modeAmber' },
        { id: 'aqua', icon: 'eye', label: 'reader.modeAqua' },
        { id: 'grey', icon: 'contrast', label: 'reader.modeGrey' },
        { id: 'darkgray', icon: 'contrast', label: 'reader.modeDarkGray' },
        { id: 'dark', icon: 'moon', label: 'reader.modeDark' }
      ] as option}
        <button role="menuitemradio" aria-checked={readingMode === option.id} class={readingMode === option.id ? 'active' : ''} onclick={() => setReadingMode(option.id)}>
          <Icon name={option.icon} size={16} /><span class="menu-label"><span>{tr(option.label)}</span>{#if option.id === 'dark'}<small>{tr('reader.darkHint')}</small>{/if}</span>
          {#if readingMode === option.id}<Icon name="check" size={14} />{/if}
        </button>
      {/each}
    </div>
  {:else if barMenu === 'display'}
    <div class="bar-menu" role="menu" aria-label={tr('reader.display')}>
      <div class="menu-title">{tr('reader.display')}</div>
      <button class={viewFilter === 'all' && pageRender === 'pdf' ? 'active' : ''} onclick={() => setView('all')}><Icon name="eye" size={16} /><span class="menu-label"><span>{tr('reader.normal')}</span></span></button>
      <button class={pageRender === 'blank' && viewFilter === 'annotations' ? 'active' : ''} onclick={() => setView('annotations')}><Icon name="pen" size={16} /><span class="menu-label"><span>{tr('reader.annotationsOnly')}</span></span></button>
      <button class={pageRender === 'blank' && viewFilter === 'highlights' ? 'active' : ''} onclick={() => setView('highlights')}><Icon name="marker" size={16} /><span class="menu-label"><span>{tr('reader.highlightsOnly')}</span></span></button>
      <label class="menu-select">{tr('reader.grid')}
        <select bind:value={gridStyle} aria-label={tr('reader.grid')}>
          {#each GRID_STYLES as g}<option value={g.id}>{tr(g.label)}</option>{/each}
        </select>
      </label>
      <button onclick={() => { barMenu = ''; onOpenGallery?.(); }}><Icon name="gallery" size={16} /><span class="menu-label"><span>{tr('reader.gallery')}</span></span></button>
    </div>
  {:else if barMenu === 'export'}
    <div class="bar-menu" role="menu" aria-label={tr('common.export')}>
      <div class="menu-title">{tr('common.export')}</div>
      <button onclick={saveAnnotatedToLibrary} disabled={savingCopy}><Icon name="download" size={16} /><span class="menu-label"><span>{savingCopy ? tr('reader.savingCopy') : tr('reader.saveCopy')}</span></span></button>
      <button onclick={exportAnnotatedCopy}><Icon name="download" size={16} /><span class="menu-label"><span>{tr('reader.annotatedCopy')}</span></span></button>
      <button onclick={exportHighlights}><Icon name="marker" size={16} /><span class="menu-label"><span>{tr('reader.highlightsPdf')}</span></span></button>
      <button onclick={exportSidecar}><Icon name="reader" size={16} /><span class="menu-label"><span>{tr('reader.annotationJson')}</span></span></button>
      <div class="menu-note">{tr('reader.exportNote')}</div>
    </div>
  {:else if barMenu === 'tabs'}
    <div class="bar-menu tabs-menu" role="menu" aria-label={tr('reader.tabs')}>
      <div class="menu-title">{tr('reader.tabs')}</div>
      {#if tabDocs.length === 0}
        <div class="menu-note">{tr('reader.noTabs')}</div>
      {:else}
        {#each tabDocs as tab (tab.id)}
          <button class={tab.id === activeTabId ? 'active' : ''} onclick={() => { onSelectTab?.(tab.id); barMenu = ''; }}>
            <Icon name="reader" size={15} /><span class="menu-label"><span dir="auto">{tab.title}</span></span>
            {#if tab.id === activeTabId}<Icon name="check" size={14} />{/if}
          </button>
        {/each}
      {/if}
    </div>
  {:else if barMenu === 'search'}
    <div class="bar-menu search-menu" role="search">
      <div class="menu-title">{tr('reader.search')}</div>
      <div class="menu-search-row">
        <input bind:this={searchInput} type="text" bind:value={searchTerm} placeholder={tr('reader.searchText')}
          onkeydown={(e) => e.key === 'Enter' && runSearch()} aria-label={tr('reader.searchText')} />
        <button class="primary" onclick={runSearch}>{tr('reader.find')}</button>
      </div>
      {#if searchStatus}<div class="menu-note">{searchStatus}</div>{/if}
    </div>
  {/if}

  <div class="reader-body">
    <div class="stage-host">
      <div class="stage {layout}" bind:this={stage} onscroll={onStageScroll} use:autoScrollbar>
        {#if loading}
          <div class="empty">{tr('reader.loading')}</div>
        {/if}
        {#if loadError}
          <div class="empty">{loadError}</div>
        {/if}
        {#if !loading && !loadError}
          {#if layout === 'spread'}
            <div class="spread-row">
              {#each spreadView as p, i (i)}
                {#if p}
                  <PdfPage
                    {pdfDoc} pageNumber={p} totalPages={numPages} {scale} {rotation}
                    baseWidth={pageSize(p).width} baseHeight={pageSize(p).height}
                    {annotations} {viewFilter} {pageRender} {gridStyle}
                    {bookmarks} {activeBookmark} active={p === pageNum} interactive={true} lazy={false}
                    scrollRoot={stage} {tool} {color} {opacity} sizePx={sizePx}
                    draft={draft?.page === p ? draft : null}
                    captureRect={captureRect?.page === p ? captureRect : null}
                    textRequest={textRequest?.page === p ? textRequest : null}
                    redPen={redPen} handCursor={handCursor} {panning}
                    onpointer={onPagePointer} ontextdone={onTextDone}
                    onsize={setPageSize} onready={registerPage} />
                {:else}
                  <div class="spread-blank" style="width:{Math.round(blankSize.width)}px; height:{Math.round(blankSize.height)}px"></div>
                {/if}
              {/each}
            </div>
          {:else}
            <div class="pages-stack">
              {#each pagesToRender as p (p)}
                <PdfPage
                  {pdfDoc} pageNumber={p} totalPages={numPages} {scale} {rotation}
                  baseWidth={pageSize(p).width} baseHeight={pageSize(p).height}
                  {annotations} {viewFilter} {pageRender} {gridStyle}
                  {bookmarks} {activeBookmark} active={p === pageNum} interactive={true}
                  lazy={layout === 'continuous' && Math.abs(p - pageNum) > 2} scrollRoot={stage} {tool} {color} {opacity} sizePx={sizePx}
                  draft={draft?.page === p ? draft : null}
                  captureRect={captureRect?.page === p ? captureRect : null}
                  textRequest={textRequest?.page === p ? textRequest : null}
                  redPen={redPen} handCursor={handCursor} {panning}
                  onpointer={onPagePointer} ontextdone={onTextDone}
                  onsize={setPageSize} onready={registerPage} />
              {/each}
            </div>
          {/if}
        {/if}
      </div>

      {#if numPages > 1}
        <div class="page-scrubber" class:active={scrubActive}
          bind:this={scrubTrack}
          role="slider" tabindex="0" aria-orientation="vertical"
          aria-valuemin="1" aria-valuemax={numPages} aria-valuenow={pageNum}
          aria-label={tr('reader.pageScrubber')}
          onpointerdown={onScrubDown} onpointermove={onScrubMove} onpointerup={onScrubUp}
          onpointerenter={() => (scrubPreview = pageNum)} onpointerleave={() => { if (!scrubActive) scrubPreview = 0; }}
          onkeydown={onScrubKey}>
          <div class="scrub-track"></div>
          <div class="scrub-thumb" style="top:{scrubPercent}%"></div>
          {#if scrubPreview}<div class="scrub-tip" style="top:{numPages > 1 ? ((scrubPreview - 1) / (numPages - 1)) * 100 : 0}%">{scrubPreview}</div>{/if}
        </div>
      {/if}
    </div>

    {#if sideOpen}
      <aside class="side-panel" aria-label={tr('reader.sidePanels')}>
        <div class="side-tabs" role="tablist">
          <button class={sideTab === 'images' ? 'side-tab active' : 'side-tab'} role="tab" aria-selected={sideTab === 'images'} onclick={() => setSideTab('images')} title={tr('side.images')}>
            <Icon name="camera" size={15} /><span>{tr('side.images')}</span>
          </button>
          <button class={sideTab === 'pages' ? 'side-tab active' : 'side-tab'} role="tab" aria-selected={sideTab === 'pages'} onclick={() => setSideTab('pages')} title={tr('side.pages')}>
            <Icon name="thumbnails" size={15} /><span>{tr('side.pages')}</span>
          </button>
          <button class={sideTab === 'bookmarks' ? 'side-tab active' : 'side-tab'} role="tab" aria-selected={sideTab === 'bookmarks'} onclick={() => setSideTab('bookmarks')} title={tr('side.bookmarks')}>
            <Icon name="bookmark" size={15} /><span>{tr('side.bookmarks')}</span>
          </button>
          <button class="side-close" onclick={() => (sideOpen = false)} title={tr('side.close')} aria-label={tr('side.close')}><Icon name="x" size={14} /></button>
        </div>

        <div class="side-body" use:autoScrollbar>
          {#if sideTab === 'images'}
            {#if docCaptures.length === 0}
              <div class="side-empty">{tr('side.noImages')}</div>
            {:else}
              <div class="side-images">
                {#each docCaptures as c (c.id)}
                  <figure class="side-image">
                    <button class="side-image-open" onclick={() => (imagePreview = c)} title={c.name}>
                      <img src={c.image} alt={c.name} />
                    </button>
                    <figcaption>
                      <span class="side-name" title={c.name}>{c.name}</span>
                      <span class="side-meta">{tr('common.pageShort')}{c.page || '?'}</span>
                      <button class="side-remove" onclick={() => onDeleteCapture?.(c)} title={tr('side.removeImage')} aria-label={tr('side.removeImage')}><Icon name="trash" size={12} /></button>
                    </figcaption>
                  </figure>
                {/each}
              </div>
            {/if}
          {:else if sideTab === 'pages'}
            <div class="side-pages">
              {#if pdfDoc}
                {#each Array(numPages), i}
                  <div class="thumb {i + 1 === pageNum ? 'active' : ''}" role="button" tabindex="0"
                    aria-label={tr('reader.pageOf', { n: i + 1, total: numPages })}
                    aria-current={i + 1 === pageNum ? 'page' : undefined}
                    onclick={() => goPage(i + 1)}
                    onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), goPage(i + 1))}>
                    <canvas use:setThumbEl={i + 1}></canvas>
                    <div class="num">{i + 1}</div>
                  </div>
                {/each}
              {/if}
            </div>
          {:else}
            <div class="side-bookmarks">
              <button class="bookmark-add" onclick={addPageBookmark}>
                <Icon name="bookmark" size={14} /><span>{tr('reader.bookmarkPage')}</span>
              </button>
              {#if displayBookmarks.length === 0}
                <div class="side-empty">{tr('side.noBookmarks')}</div>
              {:else}
                {#each displayBookmarks as b (b.id)}
                  {#if b.visible !== false}
                    <div
                      class="bookmark-row {activeBookmark === b.id ? 'active' : ''} {dropTargetId === b.id ? `drop-${dropPosition}` : ''}"
                      style="margin-inline-start: {b.depth * 14}px"
                      ondragover={(e) => handleBookmarkDragOver(e, b)}
                      ondragleave={handleBookmarkDragLeave}
                      ondrop={(e) => handleBookmarkDrop(e, b)}
                      role="group"
                    >
                      <button
                        class="bookmark-drag"
                        draggable="true"
                        ondragstart={(e) => handleBookmarkDragStart(e, b)}
                        ondragend={handleBookmarkDragEnd}
                        title={tr('reader.dragBookmark')}
                        aria-label={tr('reader.dragBookmark')}
                      >
                        <Icon name="grip" size={13} />
                      </button>

                      {#if b.hasChildren}
                        <button
                          class="bookmark-collapse-btn"
                          onclick={() => toggleCollapseBookmark(b)}
                          title={b.collapsed ? tr('reader.expand') : tr('reader.collapse')}
                          aria-label={b.collapsed ? tr('reader.expand') : tr('reader.collapse')}
                        >
                          <Icon name={b.collapsed ? 'chevron-right' : 'chevron-down'} size={12} />
                        </button>
                      {/if}

                      {#if editingBookmarkId === b.id}
                        <input
                          type="text"
                          class="bookmark-rename-input"
                          bind:value={editTitleDraft}
                          onkeydown={(e) => { if (e.key === 'Enter') saveRenameBookmark(b); else if (e.key === 'Escape') cancelRenameBookmark(); }}
                          onblur={() => saveRenameBookmark(b)}
                        />
                      {:else}
                        <button class="bookmark-jump" onclick={() => jumpToBookmark(b)} title={bookmarkLabel(b)}>
                          <Icon name={typeof b.u === 'number' ? 'bookmark' : 'reader'} size={14} />
                          <span>{bookmarkLabel(b)}</span>
                        </button>
                      {/if}

                      <div class="bookmark-actions">
                        <button
                          class="bookmark-action-btn"
                          onclick={() => startRenameBookmark(b)}
                          title={tr('reader.renameBookmark')}
                          aria-label={tr('reader.renameBookmark')}
                        >
                          <Icon name="pencil" size={12} />
                        </button>
                        <button
                          class="bookmark-action-btn"
                          onclick={() => doIndentBookmark(b)}
                          title={tr('reader.indentBookmark')}
                          aria-label={tr('reader.indentBookmark')}
                        >
                          <Icon name="indent" size={12} />
                        </button>
                        {#if b.depth > 0}
                          <button
                            class="bookmark-action-btn"
                            onclick={() => doOutdentBookmark(b)}
                            title={tr('reader.outdentBookmark')}
                            aria-label={tr('reader.outdentBookmark')}
                          >
                            <Icon name="outdent" size={12} />
                          </button>
                        {/if}
                        <button
                          class="bookmark-del"
                          onclick={() => removeBookmark(b.id)}
                          title={tr('reader.removeBookmark')}
                          aria-label={tr('reader.removeBookmark')}
                        >
                          <Icon name="x" size={12} />
                        </button>
                      </div>
                    </div>
                  {/if}
                {/each}
              {/if}
            </div>
          {/if}
        </div>

        {#if sideTab === 'images'}
          <div class="side-foot">
            <button class="primary" onclick={exportDocumentImages} disabled={!!exporting || docCaptures.length === 0}>
              <Icon name="download" size={14} /><span>{tr('side.exportImages')}</span>
            </button>
          </div>
        {/if}
      </aside>
    {/if}
  </div>

  {#if imagePreview}
    <div class="image-lightbox" role="dialog" aria-modal="true" tabindex="-1" aria-label={imagePreview.name}
      onclick={(e) => { if (e.target === e.currentTarget) imagePreview = null; }}
      onkeydown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); imagePreview = null; } }}>
      <div class="image-lightbox-inner">
        <img src={imagePreview.image} alt={imagePreview.name} />
        <div class="image-lightbox-bar">
          <span>{imagePreview.name}</span>
          <button onclick={() => (imagePreview = null)} title={tr('common.close')} aria-label={tr('common.close')}><Icon name="x" size={16} /></button>
        </div>
      </div>
    </div>
  {/if}

  {#if toolbarSettingsOpen}
    <div class="toolbar-settings" role="dialog" aria-modal="true" aria-label={tr('reader.toolbarSettings')}
      onclick={(e) => { if (e.target === e.currentTarget) closeToolbarSettings(); }}>
      <div class="toolbar-settings-panel">
        <div class="toolbar-settings-head">
          <div>
            <h3>{tr('reader.toolbarSettings')}</h3>
            <p class="muted">{tr('reader.toolbarSettingsHint')}</p>
          </div>
          <button onclick={closeToolbarSettings} title={tr('common.close')} aria-label={tr('common.close')}><Icon name="x" size={16} /></button>
        </div>

        <div class="toolbar-settings-cols">
          <div class="toolbar-order">
            <div class="section-title">{tr('reader.toolbarOrder')}</div>
            <p class="muted settings-hint">{tr('reader.toolbarOrderHint')}</p>
            <div class="order-list">
              {#each barOrder as id, i (id)}
                <div class="order-row" draggable="true"
                  ondragstart={(e) => onToolbarDragStart(e, i)}
                  ondragover={(e) => e.preventDefault()}
                  ondrop={(e) => onToolbarDrop(e, i)}
                  class:custom={id.startsWith('custom:')}>
                  <span class="drag-handle" aria-hidden="true"><Icon name="grip" size={14} /></span>
                  <span class="order-name">{barLabel(id)}</span>
                  {#if BAR_BY_ID[id]?.repeat || id.startsWith('custom:')}
                    {#if id.startsWith('custom:')}
                      <button class="order-btn" onclick={() => removePreset(id)} title={tr('common.remove')} aria-label={tr('common.remove')}><Icon name="trash" size={13} /></button>
                    {:else}
                      <button class="order-btn" onclick={() => openPreset(id, BAR_BY_ID[id].repeat)} title={tr('reader.repeatButton')} aria-label={tr('reader.repeatButton')}><Icon name="repeat" size={13} /></button>
                    {/if}
                  {/if}
                  <button class="order-btn" onclick={() => moveBar(id, -1)} disabled={i === 0} title={tr('reader.moveUp')} aria-label={tr('reader.moveUp')}><Icon name="chevron-up" size={13} /></button>
                  <button class="order-btn" onclick={() => moveBar(id, 1)} disabled={i === barOrder.length - 1} title={tr('reader.moveDown')} aria-label={tr('reader.moveDown')}><Icon name="chevron-down" size={13} /></button>
                </div>
              {/each}
            </div>
          </div>

          <div class="preset-builder">
            <div class="section-title">{tr('reader.repeatButton')}</div>
            <p class="muted settings-hint">{tr('reader.repeatHint')}</p>
            {#if presetOpen && presetForm}
              <div class="preset-form">
                <label>{tr('reader.customTool')}
                  <select bind:value={presetForm.tool}>
                    <option value="shape">{tr('tool.shape')}</option>
                    <option value="marker">{tr('tool.marker')}</option>
                    <option value="pen">{tr('tool.pen')}</option>
                  </select>
                </label>
                {#if presetForm.tool === 'shape'}
                  <label>{tr('reader.customShape')}
                    <select bind:value={presetForm.shape}>
                      {#each SHAPES as s}<option value={s}>{shapeLabel(s)}</option>{/each}
                    </select>
                  </label>
                {/if}
                <label>{tr('reader.customSize')}
                  <input type="number" min="1" max="100" bind:value={presetForm.size} />
                </label>
                <label>{tr('reader.customColor')}
                  <input type="color" bind:value={presetForm.color} />
                </label>
                {#if presetForm.tool === 'shape'}
                  <label>{tr('reader.customFill')}
                    <input type="color" bind:value={presetForm.fillColor} />
                  </label>
                  <label>{tr('reader.customFillOpacity')}
                    <input type="range" min="0" max="1" step="0.05" bind:value={presetForm.fillOpacity} />
                    <span>{Math.round(presetForm.fillOpacity * 100)}%</span>
                  </label>
                {/if}
                <label>{tr('reader.customName')}
                  <input type="text" bind:value={presetForm.name} placeholder={tr('reader.customNamePlaceholder')} />
                </label>
                <div class="hstack">
                  <button class="primary" onclick={addPreset}>{tr('reader.addButton')}</button>
                  <button onclick={() => (presetOpen = false)}>{tr('common.cancel')}</button>
                </div>
              </div>
            {:else}
              <div class="hstack">
                <button onclick={() => openPreset('tool-shape', 'shape')}><Icon name="plus" size={14} />{tr('reader.addButton')}</button>
                <button onclick={() => openPreset('tool-marker', 'marker')}><Icon name="marker" size={14} />{tr('tool.marker')}</button>
                <button onclick={() => openPreset('tool-pen', 'pen')}><Icon name="pen" size={14} />{tr('tool.pen')}</button>
              </div>
            {/if}
            <div class="settings-reset">
              <button onclick={resetToolbar}>{tr('reader.resetToolbar')}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>
