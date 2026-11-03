<script>
  // Application shell (plan §5, §6.1, §6.2, §6.5, §6.7). Owns global stores
  // (library, captures, cards), navigation, import and the toast, and wires the
  // Reader to the sidecar + undo managers.
  //
  // Every label comes from lib/i18n.js through lib/lang.svelte.js, and every icon
  // is a monochrome SVG from components/Icon.svelte — no emoji, no colour icons.
  import { onMount, untrack } from 'svelte';
  import Icon from './components/Icon.svelte';
  import Reader from './components/Reader.svelte';
  import Projects from './components/Projects.svelte';
  import Planner from './components/Planner.svelte';
  import Video from './components/Video.svelte';
  import Report from './components/Report.svelte';
  import EmptyState from './components/EmptyState.svelte';
  import QuickStart from './components/QuickStart.svelte';
  import HelpDialog from './components/HelpDialog.svelte';
  import DualStudio from './components/DualStudio.svelte';
  import AuthModal from './components/AuthModal.svelte';
  import Profile from './components/Profile.svelte';
  import Trash from './components/Trash.svelte';
  import { getCurrentUser } from './lib/auth.js';
  import { createSidecarStore, fileBridge, listCaptures, listCards, putCapture, putCard, deleteCaptureById, deleteCardById, clearCaptures, clearCards, clearTasks, migrateLocalCollections, listTasks } from './lib/storage.js';
  import { savePdfBytes, deleteFileBytes } from './lib/storage.js';
  import { imagesToPdf, deliverBytes } from './lib/export.js';
  import { labelPng } from './lib/labels.js';
  import { sheetToXlsx } from './lib/xlsx.js';
  import { decksOf, cardsOfDeck, deckSheetRows, deckFileNames, deckAnkiBundle, IMAGE_COLUMN, DECK_COLUMNS, DEFAULT_DECK, TODAY_SET, isTodaySet, isDue, todayIso, setsOf, addCardToSet, removeCardFromSet, renameSet, mergeSets, changedCards, moveCardToSet, duplicateCardInto } from './lib/flashcards.js';
  import { imageFileName, dataImageBytes } from './lib/filenames.js';
  import { trackUsage } from './lib/usage.js';
  import { loadViewModes, setViewMode as persistViewMode } from './lib/viewmode.js';
  import { DIFFICULTIES, DEFAULT_INTERVALS, loadSrsSettings, saveSrsSettings, intervalDaysFor, applyRating, reminderDecision } from './lib/srs.js';
  import { createUndoManager } from './lib/undo.js';
  import * as library from './lib/library.js';
  import { ui, t, setLang, applyLang } from './lib/lang.svelte.js';
  import { LANGS } from './lib/i18n.js';
  import { mediaKindOf, formatTimecode } from './lib/media.js';
  import { DEFAULT_THEME, normalizeTheme, themeMode, themeLabelKey, THEMES } from './lib/themes.js';
  import { DEFAULT_IMAGE_QUALITY, loadImageQuality, saveImageQuality, normalizeImageQuality } from './lib/imageQuality.js';
  import { createProject, listProjects, upsertProject, removeProject, createChannelProject, linkSource } from './lib/projects.js';
  import { parseYouTube, youtubeDocId } from './lib/youtube.js';
  import { moveToTrash, restoreTrashItem, purgeExpiredTrash, loadTrashRetentionDays, saveTrashRetentionDays, emptyAllTrash } from './lib/trash.js';
  import { recordStudyHeartbeat } from './lib/stats.js';

  const NAV = [
    { id: 'Today', icon: 'today' },
    { id: 'Profile', icon: 'user' },
    { id: 'Library', icon: 'library' },
    { id: 'Projects', icon: 'projects' },
    { id: 'Reader', icon: 'reader' },
    { id: 'Video', icon: 'video' },
    { id: 'Studio', icon: 'dualStudio' },
    { id: 'Planner', icon: 'planner' },
    { id: 'Gallery', icon: 'gallery' },
    { id: 'Flashcards', icon: 'flashcards' },
    { id: 'Trash', icon: 'trash' },
    { id: 'Settings', icon: 'settings' }
  ];
  const NAV_LABEL = {
    Today: 'nav.today', Profile: 'nav.profile', Library: 'nav.library', Projects: 'nav.projects', Reader: 'nav.reader', Video: 'nav.video',
    Studio: 'nav.dualStudio', Planner: 'nav.planner', Gallery: 'nav.gallery', Flashcards: 'nav.flashcards', Trash: 'nav.trash', Settings: 'nav.settings'
  };

  let view = $state('Today');
  let railCollapsed = $state(false);
  let theme = $state(initialTheme());
  let imageQuality = $state(loadImageQuality());
  let projects = $state([]);
  let activeProjectId = $state('');
  let docs = $state([]);
  let tasks = $state([]);
  let viewModes = $state({}); // section -> 'grid' | 'list' (default grid)
  let activeDoc = $state(null);
  let openTabs = $state([]);
  let activeVideo = $state(null);
  let captures = $state([]);
  let cards = $state([]);
  let selectedCaptures = $state([]);
  let exportLabels = $state(true);
  let exportingGallery = $state(false);
  let importingVideo = $state(false);
  let reviewQueue = $state([]);
  let reviewIndex = $state(0);
  let reviewRevealed = $state(false);
  let toasts = $state([]);
  let globalSearch = $state('');
  let helpOpen = $state(false);
  let authOpen = $state(false);
  let currentUser = $state(getCurrentUser());

  function handleAuthChange(user) {
    currentUser = user;
    docs = library.listDocuments();
    if (user && user.id !== 'guest') {
      notify(t('auth.welcome', { name: user.name || user.username }), 'ok');
    } else {
      notify(t('auth.signedOut'), 'ok');
    }
  }
  let dropActive = $state(false);
  let dragDepth = 0; // dragenter/dragleave pairs while a file is dragged over the window
  let quickStartDismissed = $state(false);
  let quickStartForced = $state(false); // reopened from Help even after completing the steps
  let openedDoc = $state(false); // "read" step: opening a PDF at least once
  let searchInput = $state();
  let pdfInput = $state();
  let videoInput = $state();
  let activeDeck = $state('');
  let exportingDeck = $state('');
  let srsSettings = $state(loadSrsSettings());
  let reminderTimer = null;
  let cardSetEditor = $state(''); // card id whose set editor is open
  let newSetName = $state('');
  let renamingSet = $state(false); // rename-the-active-set panel
  let renameDraft = $state('');
  let mergingSet = $state(false); // merge-the-active-set panel
  let mergeTarget = $state('');
  let transferTarget = $state(''); // move/duplicate target in a card's set editor

  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  // Documents carry a kind so one library can hold PDFs and videos: records from
  // earlier builds have no kind and are PDFs.
  const kindOf = (d) => (d?.kind === 'video' ? 'video' : 'pdf');
  const videoDocs = $derived(docs.filter((d) => kindOf(d) === 'video'));
  const pdfDocs = $derived(docs.filter((d) => kindOf(d) === 'pdf'));
  const tabDocs = $derived(openTabs
    .map((id) => docs.find((d) => d.id === id && kindOf(d) === 'pdf'))
    .filter(Boolean));

  // Sets (decks). A capture taken from a document creates a set named after that
  // document, so "one set per item" needs no extra bookkeeping. `activeDeck` is
  // the user's choice; it falls back to the first set whenever it goes stale
  // (a set can disappear when its last card is deleted).
  const decks = $derived(decksOf(cards));
  // The Today set is virtual: computed from due dates, never stored on a card,
  // so it fills itself and can never go stale. It leads the strip, real sets
  // follow, and selecting it makes the grid/rail/exports show what is due.
  const stripDecks = $derived([
    { name: TODAY_SET, total: dueCards.length, due: dueCards.length, virtual: true },
    ...decks
  ]);
  const activeDeckName = $derived(
    stripDecks.some((d) => d.name === activeDeck) ? activeDeck : decks[0]?.name || DEFAULT_DECK
  );
  const activeDeckCards = $derived(cardsOfDeck(cards, activeDeckName));
  const activeDeckDue = $derived(activeDeckCards.filter((c) => isDue(c)).length);

  const activeProject = $derived(projects.find((p) => p.id === activeProjectId) || null);
  const sidecarStore = createSidecarStore();
  const undoManager = createUndoManager();

  function initialTheme() {
    try { return normalizeTheme(globalThis.localStorage?.getItem('studyos.theme') || DEFAULT_THEME); }
    catch { return DEFAULT_THEME; }
  }

  // Language is the one setting that changes the document element (lang, dir,
  // title), so it is applied before the first paint as well as on every switch.
  $effect(() => {
    void ui.lang;
    untrack(() => applyLang());
  });

  onMount(async () => {
    docs = library.listDocuments();
    viewModes = loadViewModes();
    // Restore the PDF tabs that were open last time. Only records that still
    // exist count, so deleting a document never leaves a dead tab behind.
    try {
      const savedTabs = JSON.parse(localStorage.getItem('studyos.reader.tabs') || '[]');
      openTabs = Array.isArray(savedTabs)
        ? savedTabs.filter((id) => docs.some((d) => d.id === id && kindOf(d) === 'pdf'))
        : [];
    } catch { openTabs = []; }
    if (openTabs.length) {
      const savedActive = localStorage.getItem('studyos.reader.activeTab');
      activeDoc = docs.find((d) => d.id === savedActive && openTabs.includes(d.id))
        || docs.find((d) => d.id === openTabs[0]) || null;
    }
    theme = initialTheme();
    imageQuality = loadImageQuality();
    projects = listProjects();
    try { purgeExpiredTrash(); } catch {}
    quickStartDismissed = localStorage.getItem('studyos.quickstart.dismissed') === '1';
    // Existing reading history also counts as "read": nobody who already has a
    // last page should be told to open their first PDF.
    openedDoc = localStorage.getItem('studyos.quickstart.opened') === '1'
      || docs.some((d) => kindOf(d) === 'pdf' && (d.lastPage || 0) > 0);
    applyTheme();
    applyLang();
    // Move any captures/cards that older builds kept in localStorage into
    // IndexedDB (large galleries blew the localStorage quota), then load.
    try { await migrateLocalCollections(localStorage); } catch (e) { console.warn('migrate', e); }
    try { captures = await listCaptures(); } catch (e) { notify(t('toast.loadCapturesFailed'), 'error'); }
    try { cards = await listCards(); } catch (e) { notify(t('toast.loadCardsFailed'), 'error'); }
    startDueReminderLoop();
    return () => stopDueReminderLoop();
  });

  // The home page reads tasks freshly every time it is shown (the Planner edits
  // them elsewhere), and its Report reads the usage record on every mount.
  $effect(() => {
    if (view !== 'Today') return;
    listTasks()
      .then((rows) => { tasks = rows; })
      .catch(() => { /* the report just shows zeros */ });
  });

  // Grid or list — remembered per section, defaulting to grid.
  const modeOf = (section) => viewModes[section] || 'grid';
  function setMode(section, mode) {
    viewModes = { ...viewModes, [section]: persistViewMode(section, mode) };
  }

  // Tasks due today (or overdue) — the Today page's work list.
  const todayTasks = $derived(
    tasks
      .filter((task) => task.status !== 'done' && task.dueDate && task.dueDate <= todayIso())
      .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))
  );

  function applyTheme() {
    theme = normalizeTheme(theme);
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.themeMode = themeMode(theme);
    document.documentElement.style.colorScheme = themeMode(theme);
    try { localStorage.setItem('studyos.theme', theme); } catch { /* private mode */ }
  }

  function setTheme(id) {
    theme = normalizeTheme(id);
    applyTheme();
  }

  function setImageQuality(value) {
    imageQuality = saveImageQuality(value);
  }

  function notify(message, kind = '') {
    const id = crypto.randomUUID();
    toasts = [...toasts, { id, message, kind }];
    setTimeout(() => (toasts = toasts.filter((t) => t.id !== id)), 2800);
  }

  // --- keyboard, search and drop --------------------------------------------

  function isTypingTarget(target) {
    const tag = target?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!target?.isContentEditable;
  }

  // Enter/Space on a clickable row or tile should do exactly what a click does.
  // Only when the row itself is focused: a nested button keeps its own keys.
  function onActivate(event, action) {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      action();
    }
  }

  function onSearchInput(event) {
    globalSearch = event.currentTarget.value;
    // Typing in the search box is a request to see matches; the Library is the
    // only place that can show them.
    if (globalSearch.trim() && view !== 'Library') view = 'Library';
  }
  // The topbar field and the mobile Library field are two views of one query;
  // focus the one that is actually on screen.
  function visibleSearchInput() {
    return [...document.querySelectorAll('.topbar .search input, .mobile-search input')]
      .find((input) => input.offsetParent !== null) || searchInput;
  }
  function focusSearch() {
    visibleSearchInput()?.focus();
  }
  function clearSearch(event) {
    globalSearch = '';
    const input = event?.currentTarget?.parentElement?.querySelector('input');
    (input || visibleSearchInput())?.focus();
  }

  function openHelp() { helpOpen = true; }

  // Only file drags belong to the import overlay; the Planner drags tasks with
  // its own text/task-id payload, and must keep working untouched.
  function hasFiles(event) {
    const types = event.dataTransfer?.types;
    return !!types && Array.from(types).includes('Files');
  }
  function onDragEnter(event) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth += 1;
    dropActive = true;
  }
  function onDragOver(event) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    dropActive = true;
  }
  function onDragLeave(event) {
    if (!hasFiles(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropActive = false;
  }
  async function onDrop(event) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth = 0;
    dropActive = false;
    const dropped = [...(event.dataTransfer?.files || [])];
    await importFiles(dropped);
  }

  function onKeydown(event) {
    // The help dialog owns Escape while it is open; other shortcuts stay out of
    // the way so a key press never changes the screen behind a dialog.
    if (helpOpen) {
      if (event.key === 'Escape' || event.key === '?') { event.preventDefault(); helpOpen = false; }
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && (event.key === 'o' || event.key === 'O')) {
      event.preventDefault();
      pickPdf();
      return;
    }
    if (isTypingTarget(event.target)) {
      if (event.key === 'Escape' && event.target === searchInput && globalSearch) {
        event.preventDefault();
        clearSearch();
      }
      return;
    }
    if (event.key === '?') {
      event.preventDefault();
      openHelp();
      return;
    }
    if (event.key === '/') {
      event.preventDefault();
      focusSearch();
      return;
    }
    if (event.key === 'Escape' && globalSearch) clearSearch();
  }

  let navHistory = $state([]);

  function pushHistory(fromView = view) {
    navHistory = [...navHistory, {
      view: fromView,
      activeDocId: activeDoc?.id || null,
      activeVideoId: activeVideo?.id || null,
      activeProjectId
    }].slice(-30);
  }

  function goBack() {
    if (!navHistory.length) return;
    const prev = navHistory[navHistory.length - 1];
    navHistory = navHistory.slice(0, -1);
    if (prev.view === 'Reader') {
      if (prev.activeDocId) {
        activeDoc = library.getDocument(prev.activeDocId) || activeDoc;
      }
    } else if (prev.view === 'Video') {
      if (prev.activeVideoId) {
        activeVideo = library.getDocument(prev.activeVideoId) || activeVideo;
      }
    }
    activeProjectId = prev.activeProjectId || '';
    view = prev.view;
  }

  function nav(id) {
    if (id === view) return;
    pushHistory(view);
    if (id !== 'Projects') activeProjectId = '';
    if (id === 'Reader') {
      if (activeDoc?.id) {
        activeDoc = library.getDocument(activeDoc.id) || activeDoc;
      } else if (tabDocs.length) {
        activeDoc = library.getDocument(tabDocs[0].id) || { ...tabDocs[0] };
      }
    } else if (id === 'Video') {
      if (activeVideo?.id) {
        activeVideo = library.getDocument(activeVideo.id) || activeVideo;
      }
    }
    view = id;
  }

  // --- import ----------------------------------------------------------------
  async function hashId(file) {
    const data = new TextEncoder().encode(`${file.name}|${file.size}|${file.lastModified}`);
    const buf = await crypto.subtle.digest('SHA-1', data);
    return [...new Uint8Array(buf)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  const isPdfFile = (file) => file?.type === 'application/pdf' || /\.pdf$/i.test(file?.name || '');

  function pickPdf() { pdfInput?.click(); }
  function pickVideo() { videoInput?.click(); }

  async function importPdfFile(file, { open = true, quiet = false } = {}) {
    if (!isPdfFile(file)) { notify(t('toast.importFailed', { message: file?.name || '' }), 'error'); return null; }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const id = await hashId(file);
      await savePdfBytes(id, bytes.buffer);
      const doc = library.upsertDocument({ id, kind: 'pdf', title: file.name, filename: file.name, size: file.size, missing: false });
      docs = library.listDocuments();
      if (!quiet) notify(t('toast.imported', { name: file.name }), 'ok');
      if (open) openDoc(doc);
      return doc;
    } catch (e) {
      notify(t('toast.importFailed', { message: e.message }), 'error');
      return null;
    }
  }

  // Videos live in the same byte store as PDFs, so offline playback and resume
  // work exactly like reading a document does.
  async function importVideoFile(file, { open = true, quiet = false } = {}) {
    if (mediaKindOf(file) !== 'video') { notify(t('toast.importFailed', { message: file?.name || '' }), 'error'); return null; }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const id = await hashId(file);
      await savePdfBytes(id, bytes.buffer);
      const doc = library.upsertDocument({
        id, kind: 'video', title: file.name, filename: file.name,
        size: file.size, mime: file.type || 'video/mp4', missing: false
      });
      docs = library.listDocuments();
      if (!quiet) notify(t('video.imported', { title: file.name }), 'ok');
      if (open) openDoc(doc);
      return doc;
    } catch (e) {
      notify(t('video.importFailed', { message: e.message }), 'error');
      return null;
    }
  }

  async function importPdf(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) await importPdfFile(file);
  }

  async function importVideo(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    importingVideo = true;
    try { await importVideoFile(file); } finally { importingVideo = false; }
  }

  // Dropping several files at once imports them all, then opens the first PDF
  // (or the first video if no PDF was dropped) so the user lands on the thing
  // they just brought in.
  async function importFiles(files) {
    const accepted = files.filter((file) => isPdfFile(file) || mediaKindOf(file) === 'video');
    if (!accepted.length) { notify(t('toast.dropUnsupported'), 'error'); return; }
    let firstPdf = null;
    let firstVideo = null;
    let count = 0;
    for (const file of accepted) {
      const doc = isPdfFile(file)
        ? await importPdfFile(file, { open: false, quiet: true })
        : await importVideoFile(file, { open: false, quiet: true });
      if (!doc) continue;
      count += 1;
      if (kindOf(doc) === 'video') firstVideo ??= doc;
      else firstPdf ??= doc;
    }
    if (!count) return;
    notify(t('toast.importedMany', { n: count }), 'ok');
    if (firstPdf) openDoc(firstPdf);
    else if (firstVideo) openDoc(firstVideo);
  }

  function openDoc(doc) {
    pushHistory(view);
    activeProjectId = '';
    if (kindOf(doc) === 'video') { activeVideo = { ...doc }; view = 'Video'; return; }
    if (!openTabs.includes(doc.id)) openTabs = [...openTabs, doc.id];
    activeDoc = library.getDocument(doc.id) || { ...doc };
    view = 'Reader';
    persistTabs();
    // Remember that the first document was actually opened, so the guide's
    // "read" step survives a reload even before a page is turned.
    if (!openedDoc) {
      openedDoc = true;
      try { localStorage.setItem('studyos.quickstart.opened', '1'); } catch { /* private mode */ }
    }
  }

  // --- projects --------------------------------------------------------------
  function selectProject(id) {
    activeProjectId = projects.some((p) => p.id === id) ? id : '';
    view = 'Projects';
  }

  function createProjectRecord(name, description) {
    try {
      const project = upsertProject(createProject(name, description));
      projects = listProjects();
      activeProjectId = project?.id || '';
      view = 'Projects';
      notify(t('toast.projectCreated'), 'ok');
    } catch (e) {
      notify(t('toast.projectFailed', { message: e.message }), 'error');
    }
  }

  function createChannelProjectRecord(channel, channelVideos = []) {
    try {
      const project = upsertProject(createChannelProject(channel, channelVideos));
      projects = listProjects();
      activeProjectId = project?.id || '';
      view = 'Projects';
      notify(t('toast.projectCreated'), 'ok');
    } catch (e) {
      notify(t('toast.projectFailed', { message: e.message }), 'error');
    }
  }

  function playChannelVideo(video, project) {
    if (!video || !video.id) return;
    const ytUrl = video.url || `https://www.youtube.com/watch?v=${video.id}`;
    const parsed = parseYouTube(ytUrl);
    if (!parsed) return;
    const docId = youtubeDocId(parsed);
    const existing = library.getDocument(docId);
    const doc = existing || library.upsertDocument({
      id: docId,
      kind: 'video',
      provider: 'youtube',
      ytType: 'video',
      ytId: video.id,
      title: video.title || ytUrl,
      filename: video.title || ytUrl,
      url: ytUrl,
      embedUrl: parsed.embedUrl,
      size: 0,
      mime: 'text/html',
      thumbnail: video.thumbnail || '',
      missing: false
    });
    if (project && !project.videos.includes(docId)) {
      const updated = linkSource(project, 'videos', docId);
      upsertProject(updated);
      projects = listProjects();
    }
    docs = library.listDocuments();
    activeProjectId = project ? project.id : '';
    activeVideo = { ...doc };
    view = 'Video';
    notify(t('projects.openedProject', { name: video.title }), 'ok');
  }

  function updateProjectRecord(next) {
    if (!next?.id) return;
    try {
      upsertProject(next);
      projects = listProjects();
    } catch (e) {
      notify(t('toast.projectFailed', { message: e.message }), 'error');
    }
  }

  function deleteProjectRecord(id) {
    try {
      removeProject(id);
      projects = listProjects();
      if (activeProjectId === id) activeProjectId = '';
      notify(t('toast.projectDeleted'), 'ok');
    } catch (e) {
      notify(t('toast.projectFailed', { message: e.message }), 'error');
    }
  }

  function openProjectSource(kind, id) {
    const record = library.getDocument(id);
    if (!record) return notify(t('toast.fileMissing', { title: id }), 'error');
    const projectId = activeProjectId;
    if (kind === 'video' || kindOf(record) === 'video') {
      activeProjectId = projectId;
      activeVideo = { ...record };
      view = 'Video';
      return;
    }
    openDoc(record);
    // openDoc intentionally clears project mode for ordinary library opens;
    // opening from a project keeps capture tagging active.
    activeProjectId = projectId;
  }

  function openProjectSet(name) {
    activeDeck = name;
    view = 'Flashcards';
  }

  async function assignCaptureToProject(captureId, projectId = activeProjectId) {
    if (!projectId) return;
    const capture = captures.find((c) => c.id === captureId);
    if (!capture) return;
    const next = { ...capture, projectId };
    captures = captures.map((c) => (c.id === captureId ? next : c));
    try { await putCapture(next); } catch (e) { notify(t('toast.captureSaveFailed', { message: e.message }), 'error'); }
  }

  async function unassignCaptureFromProject(captureId) {
    const capture = captures.find((c) => c.id === captureId);
    if (!capture) return;
    const { projectId, ...rest } = capture;
    const next = { ...rest, projectId: '' };
    captures = captures.map((c) => (c.id === captureId ? next : c));
    try { await putCapture(next); } catch (e) { notify(t('toast.captureSaveFailed', { message: e.message }), 'error'); }
  }

  function persistTabs() {
    try {
      localStorage.setItem('studyos.reader.tabs', JSON.stringify(openTabs));
      if (activeDoc && kindOf(activeDoc) === 'pdf') localStorage.setItem('studyos.reader.activeTab', activeDoc.id);
    } catch { /* private mode: tabs still work for this session */ }
  }

  function selectTab(id) {
    const record = docs.find((d) => d.id === id && kindOf(d) === 'pdf');
    if (!record) return;
    activeDoc = { ...record };
    view = 'Reader';
    persistTabs();
  }

  function closeTab(id) {
    const index = openTabs.indexOf(id);
    if (index < 0) return;
    openTabs = openTabs.filter((tabId) => tabId !== id);
    if (activeDoc?.id === id) {
      const nextId = openTabs[index] || openTabs[index - 1] || '';
      const next = docs.find((d) => d.id === nextId) || null;
      activeDoc = next ? { ...next } : null;
    }
    persistTabs();
  }

  function removeDoc(record) {
    // Preserve content and move to trash instead of permanent loss
    const videoCaps = (captures || []).filter((c) => c.documentId === record.id);
    moveToTrash(record, {
      kind: kindOf(record),
      preservedContent: {
        bookmarks: record.bookmarks || [],
        captures: videoCaps,
        notes: record.notes || [],
        transcript: record.transcript || null
      }
    });

    library.removeDocument(record.id);
    docs = library.listDocuments();
    if (kindOf(record) === 'pdf') {
      const index = openTabs.indexOf(record.id);
      openTabs = openTabs.filter((tabId) => tabId !== record.id);
      if (activeDoc?.id === record.id) {
        const nextId = openTabs[index] || openTabs[index - 1] || '';
        const next = docs.find((d) => d.id === nextId) || null;
        activeDoc = next ? { ...next } : null;
      }
      persistTabs();
    }
    if (activeDoc?.id === record.id) activeDoc = null;
    if (activeVideo?.id === record.id) activeVideo = null;
    notify(t('trash.movedToTrash', { title: record.title || record.filename }), 'ok');
  }

  function openAsProject(item) {
    if (!item) return;
    const title = item.title || item.filename || item.name || 'Project';
    let proj = projects.find((p) => p.name === title || (p.sources && p.sources.some((s) => s.id === item.id)));
    if (!proj) {
      proj = createProject(title, {
        description: `Study project for ${title}`,
        sources: [{ id: item.id, kind: item.kind || kindOf(item), title }]
      });
      projects = listProjects();
    }
    activeProjectId = proj.id;
    view = 'Projects';
    notify(t('projects.openedProject', { name: title }), 'ok');
  }

  // Open a task's linked resource: PDFs resume at the linked page (plan §16
  // Phase 6 exit criterion: a plan can open the exact material location), videos
  // resume at their timecode, and deck links land on the flashcards screen.
  function openResource(link) {
    if (link.kind === 'deck') { view = 'Flashcards'; return; }
    const record = library.getDocument(link.docId);
    if (!record) {
      notify(t('toast.fileMissing', { title: link.title }), 'error');
      return;
    }
    if (record.missing) notify(t('toast.fileMarkedMissing'), 'error');
    if (kindOf(record) === 'video') { activeVideo = { ...record }; view = 'Video'; return; }
    const position = { page: link.page || record.lastPage || 1, zoom: record.lastZoom || 1 };
    library.setReadingPosition(record.id, position);
    openDoc(library.getDocument(record.id));
  }

  // The Library lists every material, filtered by the search box. The title and
  // the stored filename both match, so “lecture-03.pdf” finds the imported file
  // even after it was renamed in the app.
  const searchTerm = $derived(globalSearch.trim().toLowerCase());
  const recentDocs = $derived(
    docs.filter((d) => !searchTerm || [d.title, d.filename]
      .some((value) => String(value || '').toLowerCase().includes(searchTerm)))
  );
  const recentPdfs = $derived(recentDocs.filter((d) => kindOf(d) === 'pdf'));

  // --- first-run guide -------------------------------------------------------
  // Four concrete steps from an empty app to a reviewed card. Each one knows
  // whether it is already done and what action gets the user past it, so the
  // card disappears by itself once the loop is complete.
  const quickStartSteps = $derived([
    {
      key: 'import', title: t('quickstart.importTitle'), hint: t('quickstart.importHint'),
      done: pdfDocs.length > 0, actionLabel: t('topbar.importPdf'), onaction: pickPdf
    },
    {
      key: 'open', title: t('quickstart.openTitle'), hint: t('quickstart.openHint'),
      done: openedDoc,
      actionLabel: t('quickstart.open'),
      onaction: () => (pdfDocs[0] ? openDoc(pdfDocs[0]) : pickPdf())
    },
    {
      key: 'capture', title: t('quickstart.captureTitle'), hint: t('quickstart.captureHint'),
      done: captures.length > 0, actionLabel: t('quickstart.captureAction'),
      onaction: () => (pdfDocs[0] ? openDoc(pdfDocs[0]) : pickPdf())
    },
    {
      key: 'review', title: t('quickstart.reviewTitle'), hint: t('quickstart.reviewHint'),
      done: cards.some((c) => c.difficulty && c.difficulty !== 'new'),
      actionLabel: t('quickstart.reviewAction'),
      onaction: () => (dueCards.length ? startReview() : nav('Flashcards'))
    }
  ]);
  const quickStartDone = $derived(quickStartSteps.filter((step) => step.done).length);
  const quickStartVisible = $derived(quickStartForced || (!quickStartDismissed && quickStartDone < quickStartSteps.length));

  function dismissQuickStart() {
    quickStartDismissed = true;
    quickStartForced = false;
    try { localStorage.setItem('studyos.quickstart.dismissed', '1'); } catch { /* private mode */ }
  }
  function showQuickStart() {
    quickStartDismissed = false;
    quickStartForced = true;
    try { localStorage.removeItem('studyos.quickstart.dismissed'); } catch { /* private mode */ }
    helpOpen = false;
    view = 'Today';
  }

  function docMeta(d) {
    if (kindOf(d) === 'video') {
      return d.lastSeconds ? t('library.resumeVideo', { time: formatTimecode(d.lastSeconds) }) : t('today.notStarted');
    }
    return d.lastPage
      ? `${t('library.resumePage', { page: d.lastPage })}${d.lastZoom ? ` · ${Math.round(d.lastZoom * 100)}%` : ''}`
      : `${(d.size / 1024).toFixed(0)} KB`;
  }

  // --- capture + flashcards --------------------------------------------------
  // Captures and cards embed PNG data URLs, so they persist to IndexedDB (not
  // localStorage) — see lib/storage.js. State is updated optimistically; a
  // failed write surfaces an error toast.
  // The Reader can flatten annotations into a fresh PDF and keep that copy in
  // the library, so "saved with changes" needs no separate download step.
  async function saveAnnotatedCopy(bytes, filename) {
    const id = crypto.randomUUID();
    // Copy exactly this view, never a possibly larger backing buffer.
    const raw = bytes instanceof Uint8Array ? bytes.slice().buffer : bytes;
    await savePdfBytes(id, raw);
    const doc = library.upsertDocument({
      id, kind: 'pdf', title: filename, filename,
      size: bytes.byteLength || 0, missing: false
    });
    docs = library.listDocuments();
    return doc;
  }

  async function onCapture(capture) {
    // A capture made while a project source is open belongs to that project
    // automatically; the source is linked too so the project keeps its context.
    if (activeProjectId) {
      capture = { ...capture, projectId: activeProjectId };
      const project = projects.find((p) => p.id === activeProjectId);
      if (project && capture.documentId) {
        const kind = capture.page ? 'docs' : 'videos';
        if (!project[kind].includes(capture.documentId)) {
          updateProjectRecord({ ...project, [kind]: [...project[kind], capture.documentId] });
        }
      }
    }
    captures = [capture, ...captures];
    trackUsage('captures');
    saveImageFile(capture);
    try { await putCapture(capture); }
    catch (e) { notify(t('toast.captureSaveFailed', { message: e.message }), 'error'); }
    notify(activeProjectId ? t('toast.captureSavedProject') : t('toast.captureSaved'), 'ok');
  }

  async function saveImageFile(capture) {
    // Every saved picture gets a unique name: its base name plus the date AND
    // time it was taken (two captures of the same page never collide). JPEG is
    // the capture format, so the extension follows the data URL.
    const when = capture.createdAt ? new Date(capture.createdAt) : new Date();
    const where = capture.page ? ` p${capture.page}` : capture.timecode ? ` ${capture.timecode}` : '';
    const ext = /^data:image\/jpe?g/i.test(capture.image || '') ? 'jpg' : 'png';
    const filename = imageFileName(`${capture.source || 'capture'}${where}`, when, ext);
    const bridge = window.studyos;
    if (bridge?.saveCapture) { try { await bridge.saveCapture(filename, capture.image); return; } catch {} }
  }

  // "Biology.pdf" -> "Biology": the set name shown on the card and in the rail.
  function deckNameForSource(source) {
    const base = String(source || '').replace(/\.[^.]+$/, '').trim();
    return base || DEFAULT_DECK;
  }

  // Set names are user data: only the built-in default and the virtual Today
  // set are translated.
  function deckLabel(name) {
    if (isTodaySet(name)) return t('flashcards.todaySet');
    return name === DEFAULT_DECK ? t('flashcards.defaultSet') : name;
  }

  async function createCardFromCapture(capture) {
    const card = {
      id: crypto.randomUUID(), deck: capture.deck || deckNameForSource(capture.source),
      front: capture.caption || capture.name, back: '',
      image: capture.image, source: capture.source, page: capture.page,
      timecode: capture.timecode || '',
      difficulty: 'new', due: todayIso(),
      createdAt: capture.createdAt
    };
    cards = [card, ...cards];
    trackUsage('cards');
    try { await putCard(card); }
    catch (e) { notify(t('toast.cardSaveFailed', { message: e.message }), 'error'); }
  }

  async function deleteCapture(capture) {
    captures = captures.filter((c) => c.id !== capture.id);
    selectedCaptures = selectedCaptures.filter((id) => id !== capture.id);
    try { await deleteCaptureById(capture.id); } catch (e) { notify(t('toast.deleteFailed', { message: e.message }), 'error'); }
  }

  async function clearAllData() {
    try {
      // Capture the byte ids before clearing the index; otherwise the imported
      // PDFs and videos stay orphaned in IndexedDB.
      const docIds = docs.map((d) => d.id);
      localStorage.clear();
      await clearCaptures();
      await clearCards();
      await clearTasks();
      for (const id of docIds) await deleteFileBytes(id);
      docs = []; captures = []; cards = []; tasks = []; projects = []; activeProjectId = '';
      activeDoc = null; activeVideo = null; openTabs = [];
      quickStartDismissed = false;
      quickStartForced = false;
      openedDoc = false;
      notify(t('toast.dataCleared'), 'ok');
    } catch (e) {
      notify(t('toast.clearFailed', { message: e.message }), 'error');
    }
  }
  function toggleCaptureSelect(id) {
    selectedCaptures = selectedCaptures.includes(id) ? selectedCaptures.filter((x) => x !== id) : [...selectedCaptures, id];
  }
  async function bulkCreateCards() {
    const chosen = captures.filter((c) => selectedCaptures.includes(c.id));
    if (!chosen.length) return notify(t('toast.selectCapturesFirst'), 'error');
    for (const c of chosen) await createCardFromCapture(c);
    selectedCaptures = [];
    notify(t('toast.createdCards', { n: chosen.length }), 'ok');
  }

  async function exportGalleryPdf() {
    if (exportingGallery) return;
    const chosen = captures.filter((c) => selectedCaptures.includes(c.id));
    const list = chosen.length ? chosen : captures;
    if (!list.length) return notify(t('toast.noCapturesToExport'), 'error');
    exportingGallery = true;
    try {
      const bytes = await imagesToPdf(
        list.map((c) => ({
          image: c.image,
          label: `${c.source || 'capture'}${c.page ? ` · p${c.page}` : c.timecode ? ` · ${c.timecode}` : ''} · ${c.name}`
        })),
        { labels: exportLabels, renderLabelImage: labelPng }
      );
      // Name the export after its source document when every chosen capture
      // comes from one PDF: "Biology — images.pdf" matches the reader's export
      // instead of the generic gallery name.
      const sources = [...new Set(list.map((c) => c.source).filter(Boolean))];
      const filename = sources.length === 1
        ? `${deckNameForSource(sources[0])} — images.pdf`
        : `StudyOS captures (${list.length}).pdf`;
      const res = await deliverBytes(bytes, filename, window.studyos || null);
      trackUsage('exports');
      notify(res.where === 'file' ? t('toast.exportedTo', { path: res.path }) : t('toast.downloaded', { path: res.path }), 'ok');
    } catch (e) {
      notify(t('toast.exportFailed', { message: e.message }), 'error');
    } finally {
      exportingGallery = false;
    }
  }

  // --- flashcard review ------------------------------------------------------
  const dueCards = $derived(cards.filter((c) => isDue(c)));
  // `list` is optional so `onclick={startReview}` still reviews everything due;
  // a click event is not an array and falls back to the due queue.
  function startReview(list) {
    const queue = Array.isArray(list) ? list.filter((c) => c) : dueCards;
    if (!queue.length) return notify(t('toast.noCardsDue'), 'error');
    reviewQueue = [...queue];
    reviewIndex = 0;
    reviewRevealed = false;
    view = 'Review';
  }

  // --- set exports -----------------------------------------------------------
  async function exportDeck(kind) {
    if (exportingDeck) return;
    const list = cardsOfDeck(cards, activeDeckName);
    if (!list.length) return notify(t('toast.noCardsInSet'), 'error');
    exportingDeck = kind;
    try {
      // The virtual set has no real name to export under: "Today" keeps the
      // file and sheet name ASCII so the desktop bridge's safeName cannot mangle
      // them, while the UI keeps showing the translated label.
      const exportBase = isTodaySet(activeDeckName) ? 'Today' : activeDeckName;
      const names = deckFileNames(exportBase);
      let bytes;
      let filename;
      let mime;
      if (kind === 'xlsx') {
        // Pictures ride INSIDE the sheet: each card's image is an embedded
        // drawing anchored over its row in the Image column.
        const rows = deckSheetRows(cards, activeDeckName);
        const images = [];
        list.forEach((card, row) => {
          const parsed = dataImageBytes(card.image);
          if (parsed) images.push({ row, col: IMAGE_COLUMN, data: parsed.bytes, ext: parsed.ext });
        });
        bytes = sheetToXlsx({ sheetName: exportBase, columns: DECK_COLUMNS, rows, images });
        filename = names.xlsx;
        mime = XLSX_MIME;
      } else {
        // The Anki export is a zip: #html:true notes with <img> tags, the
        // pictures themselves in collection.media/, and bilingual instructions.
        const bundle = deckAnkiBundle(cards, activeDeckName);
        bytes = bundle.bytes;
        filename = names.anki;
        mime = 'application/zip';
      }
      const res = await deliverBytes(bytes, filename, window.studyos || null, mime);
      trackUsage('exports');
      notify(res.where === 'file' ? t('toast.exportedTo', { path: res.path }) : t('toast.downloaded', { path: res.path }), 'ok');
    } catch (e) {
      notify(t('toast.exportFailed', { message: e.message }), 'error');
    } finally {
      exportingDeck = '';
    }
  }
  // The rating reschedules through the interval table (Settings → Spaced
  // repetition), so what a button promises is exactly what the due date gets.
  async function rateCard(difficulty) {
    const card = reviewQueue[reviewIndex];
    if (!card) return;
    const updated = applyRating(card, difficulty, srsSettings);
    cards = cards.map((c) => (c.id === card.id ? updated : c));
    reviewQueue = reviewQueue.map((c) => (c.id === card.id ? updated : c));
    trackUsage('reviews');
    try { await putCard(updated); } catch (e) { notify(t('toast.saveCardFailed', { message: e.message }), 'error'); }
    reviewIndex += 1;
    reviewRevealed = false;
    if (reviewIndex >= reviewQueue.length) { notify(t('toast.reviewComplete'), 'ok'); view = 'Flashcards'; }
  }
  function difficultyLabel(level) {
    return t(`srs.${level}`);
  }
  function intervalHint(difficulty) {
    return t('common.daysShort', { n: intervalDaysFor(difficulty, srsSettings) });
  }

  // --- set membership --------------------------------------------------------
  async function saveCard(card) {
    cards = cards.map((c) => (c.id === card.id ? card : c));
    try { await putCard(card); } catch (e) { notify(t('toast.saveCardFailed', { message: e.message }), 'error'); }
  }
  async function addToSet(card, setName) {
    const name = String(setName || '').trim();
    if (!name) return;
    await saveCard(addCardToSet(card, name));
    notify(t('toast.cardSavedOtherSet', { set: deckLabel(name) }), 'ok');
  }
  async function dropFromSet(card, setName) {
    if (setsOf(card).length === 1) return notify(t('toast.keepOneSet'), 'error');
    await saveCard(removeCardFromSet(card, setName));
  }

  // --- rename / merge a whole set -------------------------------------------
  // Both are one membership rewrite for every card, then a write of only the
  // cards that changed: the lib returns untouched cards by identity, so
  // `changedCards` is exactly the list to persist.
  async function persistMembershipChange(before) {
    for (const card of changedCards(before, cards)) {
      try { await putCard(card); } catch (e) { notify(t('toast.saveCardFailed', { message: e.message }), 'error'); break; }
    }
  }
  // Focus (and select) the draft field as soon as the inline panel mounts.
  function focusOnMount(node) {
    node.focus();
    if (typeof node.select === 'function') node.select();
  }
  function openRename() {
    renamingSet = !renamingSet;
    renamingSet && (renameDraft = deckLabel(activeDeckName));
    mergingSet = false;
    mergeTarget = '';
  }
  function openMerge() {
    mergingSet = !mergingSet;
    mergingSet && (mergeTarget = decks.find((d) => d.name !== activeDeckName)?.name || '');
    renamingSet = false;
    renameDraft = '';
  }
  async function applyRename() {
    const from = activeDeckName;
    const to = renameDraft.trim();
    if (!to) return notify(t('toast.setNameInvalid'), 'error');
    if (to === deckLabel(from)) { renamingSet = false; return; } // unchanged
    // Colliding with an existing set is a merge, not a rename.
    if (decks.some((d) => d.name === to)) return notify(t('toast.setNameTaken'), 'error');
    const before = cards;
    cards = renameSet(cards, from, to);
    activeDeck = to;
    await persistMembershipChange(before);
    renamingSet = false;
    renameDraft = '';
    notify(t('toast.setRenamed', { name: deckLabel(to) }), 'ok');
  }
  async function applyMerge() {
    const from = activeDeckName;
    const into = mergeTarget;
    if (!into || into === from || !decks.some((d) => d.name === into)) {
      return notify(t('toast.setNameInvalid'), 'error');
    }
    const before = cards;
    cards = mergeSets(cards, from, into);
    activeDeck = into;
    await persistMembershipChange(before);
    mergingSet = false;
    mergeTarget = '';
    notify(t('toast.setMerged', { from: deckLabel(from), into: deckLabel(into) }), 'ok');
  }

  // --- move / duplicate a card between sets ---------------------------------
  // Targets are the sets the card is NOT in yet: moving there replaces all its
  // memberships, duplicating there adds a second record with its own id and a
  // fresh schedule (the original is never touched).
  function transferTargets(card) {
    return decks.filter((d) => !setsOf(card).includes(d.name));
  }
  async function moveCard(card) {
    const target = transferTarget;
    if (!target) return;
    transferTarget = '';
    await saveCard(moveCardToSet(card, target));
    notify(t('toast.cardMoved', { set: deckLabel(target) }), 'ok');
  }
  async function duplicateCard(card) {
    const target = transferTarget;
    if (!target) return;
    const copy = duplicateCardInto(card, target, crypto.randomUUID());
    if (!copy) return notify(t('toast.setNameInvalid'), 'error');
    transferTarget = '';
    cards = [...cards, copy]; // a new record: append, do not map by id
    try { await putCard(copy); } catch (e) { notify(t('toast.saveCardFailed', { message: e.message }), 'error'); return; }
    notify(t('toast.cardDuplicated', { set: deckLabel(target) }), 'ok');
  }
  async function createSetWith(card) {
    const name = newSetName.trim();
    if (!name) return;
    newSetName = '';
    await addToSet(card, name);
  }

  // --- daily reminder --------------------------------------------------------
  // The intervals decide *when* a card is due; this is the once-a-day nudge that
  // says how many are waiting. Like the planner's reminders it only runs while
  // the app is open, and it fires at the first check on or after the set time.
  function persistSrs(patch = {}) {
    srsSettings = saveSrsSettings({ ...srsSettings, ...patch });
    startDueReminderLoop();
  }
  function startDueReminderLoop() {
    stopDueReminderLoop();
    if (!srsSettings.reminderOn) return;
    checkDueReminder();
    reminderTimer = setInterval(checkDueReminder, 30000);
  }
  function stopDueReminderLoop() {
    if (reminderTimer) clearInterval(reminderTimer);
    reminderTimer = null;
  }
  function deliverReminder(title, body) {
    if (window.studyos?.notify) { window.studyos.notify(title, body); return; }
    if ('Notification' in window && Notification.permission === 'granted') {
      try { new Notification(title, { body }); return; } catch { /* fall through */ }
    }
    // No usable OS notification: the app is open, so say it in-app rather than
    // dropping the reminder silently.
    notify(`${title} — ${body}`, 'ok');
  }
  function reminderText(due) {
    const names = due.slice(0, 3).map((c) => deckLabel(setsOf(c)[0] || DEFAULT_DECK)).join(' · ');
    return {
      title: t('toast.flashcardReminderTitle', { n: due.length }),
      body: t('toast.flashcardReminderBody', { names })
    };
  }
  function checkDueReminder() {
    const due = cards.filter((c) => isDue(c));
    const decision = reminderDecision({ settings: srsSettings, dueCount: due.length, lastNotified: srsSettings.lastNotified });
    if (!decision.fire) return;
    const { title, body } = reminderText(due);
    deliverReminder(title, body);
    srsSettings = saveSrsSettings({ ...srsSettings, lastNotified: decision.today });
  }
  async function toggleDueReminder() {
    if (srsSettings.reminderOn) {
      persistSrs({ reminderOn: false });
      notify(t('toast.reminderOff'), 'ok');
      return;
    }
    if ('Notification' in window && Notification.permission !== 'granted') {
      try { await Notification.requestPermission(); } catch { /* keep going */ }
    }
    persistSrs({ reminderOn: true });
    notify(t('toast.reminderOn'), 'ok');
  }
  function testReminder() {
    const due = cards.filter((c) => isDue(c));
    const { title, body } = reminderText(due.length ? due : [{ sets: [t('flashcards.defaultSet')] }]);
    deliverReminder(title, body);
  }

  // --- stats -----------------------------------------------------------------
  const pagesRead = $derived(docs.reduce((n, d) => n + (d.lastPage || 0), 0));
</script>

<svelte:window onkeydown={onKeydown} ondragenter={onDragEnter} ondragover={onDragOver}
  ondragleave={onDragLeave} ondrop={onDrop}
  onblur={() => { dropActive = false; dragDepth = 0; }} />

<div class="app {railCollapsed ? 'rail-collapsed' : ''}">
  <!-- Navigation rail -->
  <nav class="rail">
    <div class="brand"><span class="logo">S</span><span class="name">{t('app.brand')}</span></div>
    {#each NAV as item}
      <button class="nav {view === item.id ? 'active' : ''}" onclick={() => nav(item.id)} title={t(NAV_LABEL[item.id])}>
        <span class="ico"><Icon name={item.icon} /></span><span class="label">{t(NAV_LABEL[item.id])}</span>
      </button>
    {/each}
    <div class="spacer"></div>
    <button class="nav" onclick={() => (railCollapsed = !railCollapsed)} title={railCollapsed ? t('nav.expand') : t('nav.collapse')}>
      <span class="ico"><Icon name={railCollapsed ? 'chevrons-right' : 'chevrons-left'} /></span>
      <span class="label">{railCollapsed ? t('nav.expand') : t('nav.collapse')}</span>
    </button>
  </nav>

  <div class="main">
    <header class="topbar">
      {#if navHistory.length > 0}
        <button class="icon-btn back-btn" onclick={goBack} title={t('common.back')} aria-label={t('common.back')}>
          <Icon name={ui.dir === 'rtl' ? 'chevron-right' : 'chevron-left'} size={18} />
        </button>
      {/if}
      <div class="search">
        <span class="search-ico"><Icon name="search" size={16} /></span>
        <input bind:this={searchInput} type="text" placeholder={t('topbar.search')}
          value={globalSearch} oninput={onSearchInput} aria-label={t('topbar.search')} />
        {#if globalSearch}
          <button class="search-clear" onclick={clearSearch} title={t('topbar.clearSearch')} aria-label={t('topbar.clearSearch')}>
            <Icon name="x" size={14} />
          </button>
        {/if}
      </div>
      <span style="flex:1"></span>

      <!-- Language switcher: the whole interface follows it. -->
      <label class="lang-picker" title={t('topbar.language')}>
        <Icon name="globe" size={16} />
        <select value={ui.lang} onchange={(e) => setLang(e.currentTarget.value)} aria-label={t('topbar.language')}>
          {#each LANGS as l}<option value={l.code}>{l.label}</option>{/each}
        </select>
      </label>

      <!-- User profile & authentication -->
      <button class="icon-btn user-btn" onclick={() => authOpen = true} title={t('auth.profile')} aria-label={t('auth.profile')}>
        <Icon name="user" size={17} />
        {#if currentUser && currentUser.id !== 'guest'}
          <span class="user-name-tag">{currentUser.name || currentUser.username}</span>
        {/if}
      </button>

      <button class="icon-btn" onclick={openHelp} title={t('topbar.help')} aria-label={t('topbar.help')} aria-haspopup="dialog">
        <Icon name="help" size={18} />
      </button>
      <button class="primary import-btn" onclick={pickPdf} title={`${t('topbar.importPdf')} (Ctrl+O)`}>
        <Icon name="upload" size={15} /><span>{t('topbar.importPdf')}</span>
      </button>
      <button class="import-btn" onclick={pickVideo} title={t('topbar.importVideo')}>
        <Icon name="video" size={15} /><span>{importingVideo ? t('video.importing') : t('topbar.importVideo')}</span>
      </button>
      <input bind:this={pdfInput} type="file" accept="application/pdf" onchange={importPdf} style="display:none" />
      <input bind:this={videoInput} type="file" accept="video/*" onchange={importVideo} style="display:none" />
    </header>

    <main class="view">
      {#if view === 'Today'}
        <div class="hero"><h1>{t('today.welcome')}</h1></div>
        <p class="muted">{t('today.tagline')}</p>

        {#if quickStartVisible}
          <QuickStart steps={quickStartSteps} progressText={t('quickstart.progress', { done: quickStartDone, total: quickStartSteps.length })} ondismiss={dismissQuickStart} />
        {/if}

        {#if docs.length > 0}
          <div class="stat-row">
            <div class="stat"><div class="n">{docs.length}</div><div class="l">{t('today.statDocs')}</div></div>
            <div class="stat"><div class="n">{captures.length}</div><div class="l">{t('today.statCaptures')}</div></div>
            <div class="stat"><div class="n">{cards.length}</div><div class="l">{t('today.statCards')}</div></div>
            <div class="stat"><div class="n">{dueCards.length}</div><div class="l">{t('today.statDue')}</div></div>
          </div>
          <div class="hstack mt">
            <button class="primary" onclick={startReview} disabled={dueCards.length === 0}>{t('today.reviewDue', { n: dueCards.length })}</button>
            {#if pdfDocs[0]}<button onclick={() => openDoc(pdfDocs[0])}>{t('today.continue', { title: pdfDocs[0].title })}</button>{/if}
          </div>
        {/if}

        <!-- Today's tasks: what is due (or late) right now. -->
        <div class="section-title mt">{t('today.tasks')}</div>
        {#if todayTasks.length === 0}
          <div class="muted" style="font-size:13px">{t('today.noTasks')}</div>
        {:else}
          <div class="today-tasks">
            {#each todayTasks as task (task.id)}
              <div class="row clickable" role="button" tabindex="0" onclick={() => nav('Planner')}
                onkeydown={(e) => onActivate(e, () => nav('Planner'))}>
                <span class="row-ico"><Icon name="check-square" size={16} /></span>
                <div class="grow">
                  <div class="title">{task.title}</div>
                  <div class="meta">{task.dueDate}{task.priority === 'high' ? ` · ${t('planner.priorityHigh')}` : ''}</div>
                </div>
                {#if task.dueDate < todayIso()}<span class="badge" style="color:var(--danger)">{t('planner.overdue', { n: 1, titles: '' }).split(':')[0]}</span>{/if}
              </div>
            {/each}
          </div>
        {/if}
        <div class="hstack mt" style="margin-top:8px">
          <button onclick={() => nav('Planner')}><Icon name="planner" size={15} /><span>{t('today.openPlanner')}</span></button>
        </div>

        {#if recentPdfs.length}
          <div class="section-head mt">
            <span class="section-title" style="margin:0">{t('today.recent')}</span>
            <div class="view-toggle" role="group" aria-label={t('common.gridView')}>
              <button class={modeOf('today') === 'grid' ? 'active' : ''} onclick={() => setMode('today', 'grid')} title={t('common.gridView')} aria-label={t('common.gridView')} aria-pressed={modeOf('today') === 'grid'}><Icon name="grid" size={15} /></button>
              <button class={modeOf('today') === 'list' ? 'active' : ''} onclick={() => setMode('today', 'list')} title={t('common.listView')} aria-label={t('common.listView')} aria-pressed={modeOf('today') === 'list'}><Icon name="list" size={15} /></button>
            </div>
          </div>
          {#if modeOf('today') === 'grid'}
            <div class="grid cols-3">
              {#each recentPdfs.slice(0, 6) as d}
                <div class="card clickable" role="button" tabindex="0" onclick={() => openDoc(d)}
                  onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && openDoc(d)}>
                  <div class="hstack"><span class="row-ico"><Icon name="reader" size={16} /></span><div class="title" style="min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">{d.title}</div></div>
                  <div class="meta muted" style="font-size:12px; margin-top:6px">{d.lastPage ? t('today.pageN', { n: d.lastPage }) : t('today.notStarted')}</div>
                </div>
              {/each}
            </div>
          {:else}
            {#each recentPdfs.slice(0, 8) as d}
              <div class="row clickable" style="margin-bottom:8px" role="button" tabindex="0"
                onclick={() => openDoc(d)} onkeydown={(e) => onActivate(e, () => openDoc(d))}>
                <span class="row-ico"><Icon name="reader" size={16} /></span>
                <div class="grow">
                  <div class="title">{d.title}</div>
                  <div class="meta">{d.lastPage ? t('today.pageN', { n: d.lastPage }) : t('today.notStarted')}</div>
                </div>
                <span class="badge">{t('library.badgePdf')}</span>
              </div>
            {/each}
          {/if}
        {/if}

        <!-- Usage report: streak, activity and lifetime totals. A brand-new
             library has nothing to report yet, so the first screen stays focused
             on the getting-started guide instead of nine zeroes. -->
        {#if docs.length || captures.length || cards.length}
          <div class="mt"><Report {docs} {cards} {decks} {tasks} {pagesRead} /></div>
        {/if}

      {:else if view === 'Library'}
        <!-- The topbar search is replaced on narrow screens; searching still
             starts here, where the results appear. -->
        <div class="mobile-search">
          <span class="search-ico"><Icon name="search" size={16} /></span>
          <input type="text" placeholder={t('topbar.search')} value={globalSearch}
            oninput={onSearchInput} aria-label={t('topbar.search')} />
          {#if globalSearch}
            <button class="search-clear" onclick={clearSearch} title={t('topbar.clearSearch')} aria-label={t('topbar.clearSearch')}>
              <Icon name="x" size={14} />
            </button>
          {/if}
        </div>
        <div class="section-head">
          <h2 style="margin:0">{t('library.title')}</h2>
          <div class="view-toggle" role="group" aria-label={t('common.gridView')}>
            <button class={modeOf('library') === 'grid' ? 'active' : ''} onclick={() => setMode('library', 'grid')} title={t('common.gridView')} aria-label={t('common.gridView')} aria-pressed={modeOf('library') === 'grid'}><Icon name="grid" size={15} /></button>
            <button class={modeOf('library') === 'list' ? 'active' : ''} onclick={() => setMode('library', 'list')} title={t('common.listView')} aria-label={t('common.listView')} aria-pressed={modeOf('library') === 'list'}><Icon name="list" size={15} /></button>
          </div>
        </div>
        <div class="mt">
          {#if recentDocs.length === 0}
            {#if searchTerm}
              <EmptyState icon="search" title={t('empty.noResultsTitle')}
                hint={t('empty.noResultsHint', { query: globalSearch.trim() })}
                actionLabel={t('topbar.clearSearch')} onaction={clearSearch} />
            {:else}
              <EmptyState icon="library" title={t('empty.libraryTitle')} hint={t('empty.libraryHint')}
                actionLabel={t('topbar.importPdf')} onaction={pickPdf}
                secondaryLabel={t('topbar.importVideo')} onsecondary={pickVideo} />
            {/if}
          {:else if modeOf('library') === 'grid'}
            <div class="grid cols-3">
              {#each recentDocs as d}
                <div class="card clickable" role="button" tabindex="0" onclick={() => openDoc(d)}
                  onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && openDoc(d)}>
                  <div class="hstack">
                    <span class="row-ico"><Icon name={kindOf(d) === 'video' ? 'video' : 'reader'} size={18} /></span>
                    <div class="grow">
                      <div class="title" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">{d.title}</div>
                      <div class="meta muted" style="font-size:12px; margin-top:2px">{docMeta(d)}</div>
                    </div>
                  </div>
                  <div class="hstack" style="margin-top:10px; justify-content:space-between">
                    <span class="hstack" style="gap:6px">
                      {#if d.missing}<span class="badge" style="color:var(--danger)">{t('library.missing')}</span>{/if}
                      <span class="badge">{kindOf(d) === 'video' ? t('library.badgeVideo') : t('library.badgePdf')}</span>
                    </span>
                    <button onclick={(e) => { e.stopPropagation(); removeDoc(d); }}>{t('common.remove')}</button>
                  </div>
                </div>
              {/each}
            </div>
          {:else}
            {#each recentDocs as d}
              <div class="row clickable" style="margin-bottom:8px" role="button" tabindex="0"
                onclick={() => openDoc(d)} onkeydown={(e) => onActivate(e, () => openDoc(d))}>
                <span class="row-ico"><Icon name={kindOf(d) === 'video' ? 'video' : 'reader'} size={16} /></span>
                <div class="grow">
                  <div class="title">{d.title}</div>
                  <div class="meta">{docMeta(d)}</div>
                </div>
                {#if d.missing}<span class="badge" style="color:var(--danger)">{t('library.missing')}</span>{/if}
                <span class="badge">{kindOf(d) === 'video' ? t('library.badgeVideo') : t('library.badgePdf')}</span>
                <button onclick={(e) => { e.stopPropagation(); removeDoc(d); }}>{t('common.remove')}</button>
              </div>
            {/each}
          {/if}
        </div>

      {:else if view === 'Reader'}
        {#if activeDoc}
          <div style="height:calc(100vh - 92px); margin:-20px;">
            <Reader doc={activeDoc} {sidecarStore} {undoManager} {notify} {onCapture} {captures}
              onDeleteCapture={deleteCapture}
              onSaveAnnotated={saveAnnotatedCopy}
              onOpenGallery={() => (view = 'Gallery')}
              onBack={() => (view = 'Library')}
              {tabDocs} activeTabId={activeDoc?.id || ''}
              onSelectTab={selectTab} onCloseTab={closeTab} onNewTab={pickPdf} />
          </div>
        {:else}
          <EmptyState icon="reader" title={t('empty.readerTitle')} hint={t('empty.readerHint')}
            actionLabel={t('common.openLibrary')} onaction={() => nav('Library')}
            secondaryLabel={t('topbar.importPdf')} onsecondary={pickPdf} />
        {/if}

      {:else if view === 'Video'}
        <Video
          video={activeVideo}
          videos={videoDocs}
          {captures}
          onDeleteCapture={deleteCapture}
          {notify}
          {onCapture}
          onOpen={(record) => { activeVideo = { ...record }; view = 'Video'; }}
          onRemove={removeDoc}
          refreshDocs={() => (docs = library.listDocuments())}
          onImport={pickVideo}
        />

      {:else if view === 'Studio'}
        <div style="height:calc(100vh - 92px); margin:-20px;">
          <DualStudio
            {docs}
            initialDoc={activeDoc}
            initialVideo={activeVideo}
            bridge={fileBridge()}
            {notify}
          />
        </div>

      {:else if view === 'Projects'}
        <Projects
          {projects} {activeProject} docs={pdfDocs} videos={videoDocs} {decks} {captures}
          {notify}
          onSelect={selectProject}
          onCreate={createProjectRecord}
          onCreateChannelProject={createChannelProjectRecord}
          onUpdate={updateProjectRecord}
          onDelete={deleteProjectRecord}
          onBack={() => (activeProjectId = '')}
          onOpenSource={openProjectSource}
          onOpenSet={openProjectSet}
          onAssignCapture={(id) => assignCaptureToProject(id)}
          onUnassignCapture={unassignCaptureFromProject}
          onPlayChannelVideo={playChannelVideo}
          onExported={() => trackUsage('exports')}
        />

      {:else if view === 'Planner'}
        <Planner {notify} docs={pdfDocs} onOpenResource={openResource} />

      {:else if view === 'Gallery'}
        <div class="section-head">
          <h2 style="margin:0">{t('nav.gallery')} ({captures.length})</h2>
          <div class="hstack">
            <div class="view-toggle" role="group" aria-label={t('common.gridView')}>
              <button class={modeOf('gallery') === 'grid' ? 'active' : ''} onclick={() => setMode('gallery', 'grid')} title={t('common.gridView')} aria-label={t('common.gridView')} aria-pressed={modeOf('gallery') === 'grid'}><Icon name="grid" size={15} /></button>
              <button class={modeOf('gallery') === 'list' ? 'active' : ''} onclick={() => setMode('gallery', 'list')} title={t('common.listView')} aria-label={t('common.listView')} aria-pressed={modeOf('gallery') === 'list'}><Icon name="list" size={15} /></button>
            </div>
            <label class="hstack" style="gap:4px; font-size:13px"><input type="checkbox" bind:checked={exportLabels} /> {t('gallery.labels')}</label>
            <button onclick={exportGalleryPdf} disabled={exportingGallery || captures.length === 0}>{exportingGallery ? t('common.exporting') : `${t('common.export')} PDF`}</button>
            <button onclick={bulkCreateCards} disabled={selectedCaptures.length === 0}>
              <Icon name="plus" size={15} />{t('gallery.createCards', { n: selectedCaptures.length })}
            </button>
          </div>
        </div>
        {#if captures.length === 0}
          <EmptyState icon="gallery" title={t('empty.galleryTitle')} hint={t('gallery.empty')}
            actionLabel={pdfDocs[0] ? t('empty.openFirstPdf') : t('topbar.importPdf')}
            onaction={() => (pdfDocs[0] ? openDoc(pdfDocs[0]) : pickPdf())}
            secondaryLabel={t('topbar.importVideo')} onsecondary={pickVideo} />
        {:else if modeOf('gallery') === 'grid'}
          <div class="gallery-grid mt">
            {#each captures as c}
              <div class="gallery-item {selectedCaptures.includes(c.id) ? 'selected' : ''}"
                role="button" tabindex="0" aria-pressed={selectedCaptures.includes(c.id)}
                onclick={() => toggleCaptureSelect(c.id)}
                onkeydown={(e) => onActivate(e, () => toggleCaptureSelect(c.id))}>
                <img src={c.image} alt={c.name} />
                <div class="cap">
                  <div class="title">{c.name}</div>
                  <div class="meta">{c.source}{c.page ? ` · ${t('common.pageShort')}${c.page}` : c.timecode ? ` · ${c.timecode}` : ''}</div>
                  <div class="hstack" style="margin-top:6px">
                    <button onclick={async (e) => { e.stopPropagation(); await createCardFromCapture(c); notify(t('toast.cardCreated'), 'ok'); }}>
                      <Icon name="flashcards" size={14} /><span>{t('gallery.card')}</span>
                    </button>
                    <button onclick={(e) => { e.stopPropagation(); deleteCapture(c); }}>
                      <Icon name="trash" size={14} /><span>{t('common.delete')}</span>
                    </button>
                  </div>
                </div>
              </div>
            {/each}
          </div>
        {:else}
          <div class="mt">
            {#each captures as c}
              <div class="row {selectedCaptures.includes(c.id) ? 'selected' : ''}" style="margin-bottom:8px; cursor:pointer"
                role="button" tabindex="0" aria-pressed={selectedCaptures.includes(c.id)}
                onclick={() => toggleCaptureSelect(c.id)}
                onkeydown={(e) => onActivate(e, () => toggleCaptureSelect(c.id))}>
                <img class="row-thumb" src={c.image} alt={c.name} />
                <div class="grow">
                  <div class="title">{c.name}</div>
                  <div class="meta">{c.source}{c.page ? ` · ${t('common.pageShort')}${c.page}` : c.timecode ? ` · ${c.timecode}` : ''}</div>
                </div>
                <button onclick={async (e) => { e.stopPropagation(); await createCardFromCapture(c); notify(t('toast.cardCreated'), 'ok'); }}>
                  <Icon name="flashcards" size={14} /><span>{t('gallery.card')}</span>
                </button>
                <button onclick={(e) => { e.stopPropagation(); deleteCapture(c); }}>
                  <Icon name="trash" size={14} /><span>{t('common.delete')}</span>
                </button>
              </div>
            {/each}
          </div>
        {/if}

      {:else if view === 'Flashcards'}
        <div class="section-head">
          <h2 style="margin:0">{t('flashcards.title')} ({cards.length})</h2>
          <div class="hstack">
            <div class="view-toggle" role="group" aria-label={t('common.gridView')}>
              <button class={modeOf('flashcards') === 'grid' ? 'active' : ''} onclick={() => setMode('flashcards', 'grid')} title={t('common.gridView')} aria-label={t('common.gridView')} aria-pressed={modeOf('flashcards') === 'grid'}><Icon name="grid" size={15} /></button>
              <button class={modeOf('flashcards') === 'list' ? 'active' : ''} onclick={() => setMode('flashcards', 'list')} title={t('common.listView')} aria-label={t('common.listView')} aria-pressed={modeOf('flashcards') === 'list'}><Icon name="list" size={15} /></button>
            </div>
            <button class="primary" onclick={() => startReview(cardsOfDeck(cards, activeDeckName).filter((c) => isDue(c)))} disabled={activeDeckDue === 0}>
              {t('flashcards.reviewDue', { n: activeDeckDue })}
            </button>
          </div>
        </div>

        <!-- Every set with how many cards it holds (and how many are due),
             visible without opening anything — click one to work in it, or
             rename/merge the selected one. -->
        <div class="set-strip">
          {#each stripDecks as d (d.name)}
            <button class="set-chip" class:active={activeDeckName === d.name} class:today={!!d.virtual}
              aria-pressed={activeDeckName === d.name}
              onclick={() => (activeDeck = d.name)}
              title={d.virtual
                ? `${deckLabel(d.name)} — ${t('flashcards.dueBadge', { n: d.total })}`
                : `${deckLabel(d.name)} — ${t('flashcards.setCount', { n: d.total })}`}>
              <span class="set-name">{deckLabel(d.name)}</span>
              <span class="set-n">{d.total}</span>
              {#if d.due && !d.virtual}<span class="set-due" title={t('flashcards.dueBadge', { n: d.due })}>{d.due}</span>{/if}
            </button>
          {/each}
          {#if decks.length && !isTodaySet(activeDeckName)}
            <span class="set-tools">
              <button class="set-tool" aria-expanded={renamingSet} onclick={openRename} title={t('flashcards.renameSet')}>
                <Icon name="pencil" size={13} /><span>{t('flashcards.renameSet')}</span>
              </button>
              {#if decks.length > 1}
                <button class="set-tool" aria-expanded={mergingSet} onclick={openMerge} title={t('flashcards.mergeSet')}>
                  <Icon name="merge" size={13} /><span>{t('flashcards.mergeSet')}</span>
                </button>
              {/if}
            </span>
          {/if}
        </div>

        {#if renamingSet}
          <div class="inline-panel">
            <span class="muted">{t('flashcards.renameTo', { set: deckLabel(activeDeckName) })}</span>
            <input type="text" bind:value={renameDraft} placeholder={t('flashcards.newName')} use:focusOnMount
              onkeydown={(e) => e.key === 'Enter' && applyRename()} />
            <button class="primary" onclick={applyRename}
              disabled={!renameDraft.trim() || renameDraft.trim() === deckLabel(activeDeckName)}>{t('common.save')}</button>
            <button onclick={() => (renamingSet = false)}>{t('common.cancel')}</button>
            <span class="hint muted">{t('flashcards.renameHint')}</span>
          </div>
        {/if}

        {#if mergingSet}
          <div class="inline-panel">
            <span class="muted">{t('flashcards.mergeFrom', { set: deckLabel(activeDeckName) })}</span>
            <select bind:value={mergeTarget} aria-label={t('flashcards.mergeSet')}>
              {#each decks.filter((d) => d.name !== activeDeckName) as d (d.name)}
                <option value={d.name}>{deckLabel(d.name)} ({d.total})</option>
              {/each}
            </select>
            <button class="primary" onclick={applyMerge} disabled={!mergeTarget}>{t('flashcards.mergeAction')}</button>
            <button onclick={() => (mergingSet = false)}>{t('common.cancel')}</button>
            <span class="hint muted">{t('flashcards.mergeHint', { from: deckLabel(activeDeckName), into: deckLabel(mergeTarget) })}</span>
          </div>
        {/if}
        {#if cards.length === 0}
          <EmptyState icon="flashcards" title={t('empty.cardsTitle')} hint={t('flashcards.empty')}
            actionLabel={captures.length ? t('empty.goGallery') : pdfDocs[0] ? t('empty.openFirstPdf') : t('topbar.importPdf')}
            onaction={() => {
              if (captures.length) view = 'Gallery';
              else if (pdfDocs[0]) openDoc(pdfDocs[0]);
              else pickPdf();
            }} />
        {:else}
          <div class="flashcards-layout mt">
            <div>
              {#if activeDeckCards.length === 0}
                <div class="empty">{isTodaySet(activeDeckName) ? t('flashcards.todayEmpty') : t('flashcards.setEmpty')}</div>
              {:else if modeOf('flashcards') === 'grid'}
                <div class="grid cols-3">
                  {#each activeDeckCards as c}
                    <div class="card clickable" role="button" tabindex="0"
                      onclick={() => startReview([c])}
                      onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && startReview([c])}>
                      {#if c.image}<img src={c.image} alt="" style="width:100%; border-radius:8px; margin-bottom:8px" />{/if}
                      <div class="title">{c.front}</div>
                      <div class="meta muted" style="font-size:12px; margin-top:4px">
                        {c.source}{c.page ? ` · ${t('common.pageShort')}${c.page}` : c.timecode ? ` · ${c.timecode}` : ''} · {t('flashcards.dueOn', { date: c.due })}
                      </div>
                      <div class="chips">{#each setsOf(c) as s}<span class="chip">{deckLabel(s)}</span>{/each}</div>
                    </div>
                  {/each}
                </div>
              {:else}
                <div>
                  {#each activeDeckCards as c}
                    <div class="row clickable" style="margin-bottom:8px" role="button" tabindex="0"
                      onclick={() => startReview([c])}
                      onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && startReview([c])}>
                      {#if c.image}<img class="row-thumb" src={c.image} alt="" />{/if}
                      <div class="grow">
                        <div class="title">{c.front}</div>
                        <div class="meta">
                          {c.source}{c.page ? ` · ${t('common.pageShort')}${c.page}` : c.timecode ? ` · ${c.timecode}` : ''} · {t('flashcards.dueOn', { date: c.due })}
                        </div>
                      </div>
                      <div class="chips">{#each setsOf(c) as s}<span class="chip">{deckLabel(s)}</span>{/each}</div>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>

            <!-- The cards already taken for this item, always visible beside the
                 set so a teacher can see the whole collection at a glance. -->
            <aside class="deck-rail">
              <div class="section-title" style="margin-top:0">{t('flashcards.cardsTaken', { set: deckLabel(activeDeckName) })}</div>
              <div class="muted" style="font-size:12px">{t('flashcards.railCount', { n: activeDeckCards.length, due: activeDeckDue })}</div>
              <div class="deck-list">
                {#each activeDeckCards as c}
                  <div class="deck-item">
                    <button class="deck-open" onclick={() => startReview([c])} title={t('flashcards.reviewThis')}>
                      {#if c.image}<img src={c.image} alt="" />{/if}
                      <span class="grow">
                        <span class="title">{c.front}</span>
                        <span class="meta">
                          {c.source}{c.page ? ` · ${t('common.pageShort')}${c.page}` : c.timecode ? ` · ${c.timecode}` : ''} · {t('flashcards.dueOn', { date: c.due })}
                        </span>
                      </span>
                    </button>
                    <button class="deck-action" aria-expanded={cardSetEditor === c.id}
                      onclick={() => { const next = cardSetEditor === c.id ? '' : c.id; cardSetEditor = next; transferTarget = ''; }}
                      title={t('flashcards.setsFor')}>
                      <Icon name={cardSetEditor === c.id ? 'x' : 'plus'} size={15} />
                    </button>
                  </div>
                  {#if cardSetEditor === c.id}
                    <div class="set-editor">
                      <div class="chips">
                        {#each setsOf(c) as s}
                          <span class="chip">{deckLabel(s)}<button onclick={() => dropFromSet(c, s)} title={t('flashcards.removeFromSet', { set: s })} aria-label={t('flashcards.removeFromSet', { set: s })}><Icon name="x" size={12} /></button></span>
                        {/each}
                      </div>
                      {#if decks.some((d) => !setsOf(c).includes(d.name))}
                        <div class="muted" style="font-size:11px; margin-top:8px">{t('flashcards.addToExisting')}</div>
                        <div class="chips">
                          {#each decks.filter((d) => !setsOf(c).includes(d.name)) as d}
                            <button class="chip-add" onclick={() => addToSet(c, d.name)}>
                              <Icon name="plus" size={12} /> {deckLabel(d.name)}
                            </button>
                          {/each}
                        </div>
                      {/if}
                      {#if transferTargets(c).length}
                        <div class="hstack transfer-row" style="margin-top:8px">
                          <select bind:value={transferTarget} aria-label={t('flashcards.moveTo')} style="flex:1; min-width:0">
                            <option value="">{t('flashcards.moveTo')}</option>
                            {#each transferTargets(c) as d (d.name)}
                              <option value={d.name}>{deckLabel(d.name)} ({d.total})</option>
                            {/each}
                          </select>
                          <button onclick={() => moveCard(c)} disabled={!transferTarget}>{t('flashcards.moveAction')}</button>
                          <button onclick={() => duplicateCard(c)} disabled={!transferTarget}>{t('flashcards.copyAction')}</button>
                        </div>
                        <div class="muted" style="font-size:11px; margin-top:4px">{t('flashcards.moveHint')}</div>
                      {/if}
                      <div class="hstack" style="margin-top:8px">
                        <input type="text" placeholder={t('flashcards.newSetName')} bind:value={newSetName}
                          onkeydown={(e) => e.key === 'Enter' && createSetWith(c)} style="width:100%" />
                        <button onclick={() => createSetWith(c)} disabled={!newSetName.trim()}>{t('common.create')}</button>
                      </div>
                    </div>
                  {/if}
                {/each}
              </div>
              <div class="muted" style="font-size:11px; margin-bottom:8px">{t('flashcards.setsHint')}</div>
              <div class="hstack" style="flex-wrap:wrap">
                <button onclick={() => exportDeck('xlsx')} disabled={!!exportingDeck || activeDeckCards.length === 0}>
                  {exportingDeck === 'xlsx' ? t('common.exporting') : t('flashcards.exportXlsx')}
                </button>
                <button onclick={() => exportDeck('anki')} disabled={!!exportingDeck || activeDeckCards.length === 0}>
                  {exportingDeck === 'anki' ? t('common.exporting') : t('flashcards.exportAnki')}
                </button>
              </div>
              <div class="muted" style="font-size:11px; margin-top:6px">{t('flashcards.ankiHint')}</div>
            </aside>
          </div>
        {/if}

      {:else if view === 'Review'}
        {@const card = reviewQueue[reviewIndex]}
        {#if card}
          <div class="review-stage">
            <div class="muted">
              {t('review.cardOf', { n: reviewIndex + 1, total: reviewQueue.length, sets: setsOf(card).map(deckLabel).join(' · ') })}
            </div>
            {#key reviewIndex}
            <div class="review-scene" class:revealed={reviewRevealed}>
              <div class="review-flip">
                <!-- Front: question (+ picture). -->
                <div class="face front review-card">
                  {#if card.image}<img src={card.image} alt="" />{/if}
                  <div style="margin-top:14px; font-size:16px">{card.front}</div>
                </div>
                <!-- Back: answer — its content only exists once revealed, so the
                     answer cannot leak to screen readers or a stray tab press. -->
                <div class="face back review-card" aria-hidden={!reviewRevealed}>
                  {#if reviewRevealed}
                    {#if card.image}<img src={card.image} alt="" />{/if}
                    <div class="muted" style="font-size:13px; margin-top:14px">{card.front}</div>
                    {#if card.back}<div style="margin-top:8px; font-size:16px">{card.back}</div>{/if}
                  {/if}
                </div>
              </div>
            </div>
            {/key}
            {#if !reviewRevealed}
              <button class="primary" style="padding:12px 26px" onclick={() => (reviewRevealed = true)}>{t('review.showAnswer')}</button>
            {:else}
              <div class="review-actions">
                {#each DIFFICULTIES as level}
                  <button onclick={() => rateCard(level)} title={t('review.nextIn', { hint: intervalHint(level) })}>
                    {difficultyLabel(level)}
                    <span class="muted" style="display:block; font-size:11px; margin-top:2px">{intervalHint(level)}</span>
                  </button>
                {/each}
              </div>
            {/if}
            <button class="muted" onclick={() => (view = 'Flashcards')}>{t('review.endSession')}</button>
          </div>
        {:else}
          <div class="empty">{t('review.finished')}</div>
        {/if}

      {:else if view === 'Settings'}
        <h2>{t('settings.title')}</h2>
        <div class="card mt" style="max-width:560px">
          <div class="section-title" style="margin-top:0">{t('settings.language')}</div>
          <div class="hstack">
            <Icon name="globe" size={16} />
            <select value={ui.lang} onchange={(e) => setLang(e.currentTarget.value)} aria-label={t('settings.language')}>
              {#each LANGS as l}<option value={l.code}>{l.label}</option>{/each}
            </select>
            <span class="muted" style="font-size:12px">{t('settings.languageHelp')}</span>
          </div>

          <div class="section-title mt">{t('settings.appearance')}</div>
          <p class="muted" style="font-size:13px">{t('settings.themeHint')}</p>
          {#each ['light', 'dark'] as mode}
            <div class="theme-group-label">{mode === 'light' ? t('settings.lightThemes') : t('settings.darkThemes')}</div>
            <div class="theme-grid">
              {#each THEMES.filter((th) => th.mode === mode) as th (th.id)}
                <button class="theme-card" class:active={theme === th.id} aria-pressed={theme === th.id}
                  style={`--sw-bg:${th.bg}; --sw-surface:${th.surface}; --sw-accent:${th.accent}`}
                  onclick={() => setTheme(th.id)} title={t(themeLabelKey(th.id))}>
                  <span class="theme-preview" aria-hidden="true">
                    <span class="theme-dot"></span>
                    <span class="theme-line"></span>
                    <span class="theme-line short"></span>
                  </span>
                  <span class="theme-name">{t(themeLabelKey(th.id))}</span>
                </button>
              {/each}
            </div>
          {/each}

          <div class="section-title mt">{t('settings.captures')}</div>
          <p class="muted" style="font-size:13px">{t('settings.imageQualityHelp')}</p>
          <div class="quality-row">
            <input type="range" min="10" max="100" step="1" value={imageQuality}
              aria-label={t('settings.imageQuality')}
              oninput={(e) => setImageQuality(e.currentTarget.value)} />
            <span class="quality-value">{imageQuality}%</span>
          </div>
          <div class="hstack">
            <span class="muted" style="font-size:12px">{t('settings.imageQualityHint')}</span>
            <button onclick={() => setImageQuality(DEFAULT_IMAGE_QUALITY)}>{t('settings.imageQualityReset')}</button>
          </div>

          <div class="section-title mt">{t('settings.srs')}</div>
          <p class="muted" style="font-size:13px">{t('settings.srsHelp')}</p>
          {#each DIFFICULTIES as level}
            <div class="hstack" style="margin:4px 0">
              <span style="flex:1">{difficultyLabel(level)}</span>
              <input type="number" min="1" max="365" style="width:84px" title={t('srs.intervalTitle', { label: difficultyLabel(level) })}
                value={srsSettings.intervals[level]}
                onchange={(e) => persistSrs({ intervals: { ...srsSettings.intervals, [level]: e.currentTarget.value } })} />
              <span class="muted" style="font-size:12px">{t('common.day')}</span>
            </div>
          {/each}
          <button onclick={() => persistSrs({ intervals: { ...DEFAULT_INTERVALS } })}>{t('settings.resetIntervals')}</button>

          <div class="section-title mt">{t('settings.reminder')}</div>
          <label class="hstack" style="gap:8px">
            <input type="checkbox" checked={srsSettings.reminderOn} onchange={toggleDueReminder} />
            <span>{t('settings.reminderToggle')}</span>
          </label>
          <div class="hstack mt">
            <span>{t('settings.time')}</span>
            <input type="time" value={srsSettings.reminderTime} onchange={(e) => persistSrs({ reminderTime: e.currentTarget.value })} />
            <button onclick={testReminder}>{t('settings.testReminder')}</button>
          </div>
          <p class="muted" style="font-size:12px">{t('settings.reminderHint', { n: dueCards.length })}</p>

          <div class="section-title mt">{t('settings.trash')}</div>
          <p class="muted" style="font-size:13px">{t('settings.trashHelp')}</p>
          <div class="hstack" style="gap:10px; margin-bottom:8px">
            <span>{t('settings.autoPurgeAfter')}:</span>
            <select
              value={loadTrashRetentionDays()}
              onchange={(e) => {
                saveTrashRetentionDays(Number(e.currentTarget.value));
                notify(t('settings.saved'), 'ok');
              }}
            >
              <option value="7">7 {t('common.days')}</option>
              <option value="14">14 {t('common.days')}</option>
              <option value="30">30 {t('common.days')} ({t('settings.default')})</option>
              <option value="60">60 {t('common.days')}</option>
              <option value="90">90 {t('common.days')}</option>
              <option value="0">{t('settings.never')}</option>
            </select>
          </div>
          <button onclick={() => {
            if (confirm(t('trash.confirmEmptyAll'))) {
              emptyAllTrash();
              notify(t('trash.emptiedAll'), 'ok');
            }
          }}>
            <Icon name="trash" size={14} />
            <span>{t('trash.emptyAll')}</span>
          </button>

          <div class="section-title mt">{t('settings.data')}</div>
          <p class="muted" style="font-size:13px">{t('settings.dataHelp')}</p>
          <button onclick={clearAllData}>{t('settings.clearData')}</button>
        </div>

      {:else if view === 'Profile'}
        <Profile
          {currentUser}
          {docs}
          videos={videoDocs}
          {decks}
          {projects}
          {notify}
          onOpenAuth={() => (authOpen = true)}
        />

      {:else if view === 'Trash'}
        <Trash
          {notify}
          onRestoreDoc={(doc) => {
            library.upsertDocument(doc);
            docs = library.listDocuments();
          }}
          onRestoreProject={(p) => {
            upsertProject(p);
            projects = listProjects();
          }}
          onRestoreDeck={() => {
            cards = listCards();
          }}
        />
      {/if}
    </main>
  </div>
</div>

{#if dropActive}
  <div class="drop-overlay" aria-hidden="true">
    <div class="drop-card">
      <span class="drop-ico"><Icon name="upload" size={30} /></span>
      <div class="drop-title">{t('drag.title')}</div>
      <div class="muted">{t('drag.hint')}</div>
    </div>
  </div>
{/if}

{#if authOpen}
  <AuthModal bind:open={authOpen} bind:currentUser onAuthChange={handleAuthChange} />
{/if}

{#if helpOpen}
  <HelpDialog onclose={() => (helpOpen = false)} onshowguide={showQuickStart} />
{/if}

<!-- Announced to screen readers: saves, exports and failures are otherwise
     only visible as a toast. -->
<div class="toasts" role="status" aria-live="polite">
  {#each toasts as t}<div class="toast {t.kind}">{t.message}</div>{/each}
</div>
