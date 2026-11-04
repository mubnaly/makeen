<script>
  // Video workspace (plan §6.6). A player whose primary controls sit on a single bottom row,
  // right-side resizable study sidebar with 5 tabs (videos, bookmarks, captures, transcript, editor),
  // in-place screenshot markup annotation, active subtitle sentence highlighting,
  // and fullscreen auto-hiding study dock.
  import { onDestroy, tick, untrack } from 'svelte';
  import Icon from './Icon.svelte';
  import EmptyState from './EmptyState.svelte';
  import VideoAnnotationModal from './VideoAnnotationModal.svelte';
  import { t, ui } from '../lib/lang.svelte.js';
  import { readPdfBytes } from '../lib/storage.js';
  import { SPEEDS, clampSeek, formatTimecode, frameCaptureRecord } from '../lib/media.js';
  import { canvasCapture, loadImageQuality } from '../lib/imageQuality.js';
  import { setBookmarks, setPlaybackPosition, upsertDocument, listPlaylists, upsertPlaylist, removePlaylist, addVideoToPlaylist, removeVideoFromPlaylist, moveVideoInPlaylist } from '../lib/library.js';
  import { flattenBookmarkTree, indentBookmark, outdentBookmark, toggleBookmarkCollapse } from '../lib/bookmarks.js';
  import {
    parseYouTube, youtubeDocId,
    qualityLabel, normalizeQualities, activeCueAt
  } from '../lib/youtube.js';
  import { deliverBytes } from '../lib/export.js';
  import { safeBaseName } from '../lib/filenames.js';
  import { autoScrollbar } from '../lib/actions.js';
  import { viewModeFor, setViewMode } from '../lib/viewmode.js';
  import { notesToDocx } from '../lib/docxExport.js';
  import { notesToPdf } from '../lib/studioPdfExport.js';
  import { recordStudyHeartbeat } from '../lib/stats.js';
  import { savePdfBytes } from '../lib/storage.js';

  let {
    video = null,
    videos = [],
    notify,
    onCapture,
    onOpen,
    onRemove,
    refreshDocs,
    onImport = null,
    captures = [],
    onDeleteCapture = null
  } = $props();

  let videoEl = $state();
  let srcUrl = $state('');
  let loading = $state(false);
  let loadError = $state('');
  let playing = $state(false);
  let current = $state(0);
  let duration = $state(0);
  let muted = $state(false);
  let rate = $state(1);
  let noteDraft = $state('');
  let bookmarks = $state([]);
  let token = 0;
  let positionTimer = null;

  // --- YouTube (pasted links + playlists) -----------------------------------
  let ytInput = $state('');
  let ytHost = $state();
  let ytFrame = $state();
  let ytFrameUrl = $state('');
  let ytActiveSession = '';
  let ytSessionToken = 0;
  let ytReadyTimer = null;
  let ytError = $state('');
  let ytQualities = $state([]);
  let ytQuality = $state('auto');
  let userSelectedQuality = $state('auto');
  let ytCurrentVideoId = $state('');
  let ytShowNativeControls = $state(false);
  let isAddOpen = $state(false);
  let isPlaylistAddOpen = $state(false);
  let playlistUrlInput = $state('');
  let capturing = $state(false);

  // Subtitles & Annotation (subtitles enabled by default for active study)
  let showSubtitles = $state(true);
  let annotatingCapture = $state(null);

  // Resizable Right Sidebar & Tabs (both normal & fullscreen)
  let sidebarOpen = $state(true);
  let sidebarTab = $state('videos'); // 'videos' | 'chapters' | 'bookmarks' | 'captures' | 'transcript' | 'editor'
  let sidebarWidth = $state(
    typeof window !== 'undefined' ? Math.max(300, Math.round(window.innerWidth * 0.33)) : 420
  );
  let isResizing = false;

  // Black screen mode (video picture off / pure audio, no visualizer effects)
  let isBlackScreen = $state(false);

  // Video chapters / sections
  let chapters = $state([]);
  let chaptersLoading = $state(false);
  let localFileInput;
  let lastHeartbeat = 0;

  // Video study notes editor
  let videoNotes = $state([]);
  let editorNoteText = $state('');
  let editorHeading = $state('p');
  let editorDir = $state('auto');
  const playlistImported = new Set();

  // Fullscreen single-dock & study workspace
  let workspaceEl = $state();
  let isFullscreen = $state(false);
  let fsIdle = $state(false);
  let fsIdleTimer = null;
  let watchTimer = null;
  let playlists = $state(listPlaylists());
  let newPlaylistTitle = $state('');
  let creatingPlaylist = $state(false);

  // Transcript panel
  let transcriptOpen = $state(false);
  let transcriptLoading = $state(false);
  let transcriptError = $state('');
  let transcript = $state(null);
  let transcriptLang = $state('');
  let transcriptToken = 0;

  const isYoutube = $derived(!!video && video.provider === 'youtube');
  const videoCaptures = $derived((captures || []).filter((c) => c.documentId === video?.id));
  const transcriptTracks = $derived(transcript?.tracks || []);
  const transcriptVideoId = $derived(
    isYoutube ? (video?.ytType === 'playlist' ? ytCurrentVideoId : video?.ytId || '') : ''
  );
  const activeCueIndex = $derived(transcript ? activeCueAt(transcript.cues, current) : -1);
  const activeCue = $derived(
    transcript && activeCueIndex >= 0 ? transcript.cues[activeCueIndex] : null
  );
  const displayBookmarks = $derived(flattenBookmarkTree(bookmarks));

  // Grid or list for the video library — grid by default, remembered.
  let mode = $state(viewModeFor('video'));
  function setMode(next) { mode = setViewMode('video', next); }

  const hasDuration = $derived(Number.isFinite(duration) && duration > 0);
  const progress = $derived(hasDuration ? Math.min(100, (current / duration) * 100) : 0);

  // Load the active video's bytes into an object URL.
  let loadedId = null;
  $effect(() => {
    const id = video?.id || null;
    untrack(() => {
      if (id === loadedId) return;
      loadedId = id;
      loadVideo(id);
    });
  });

  onDestroy(() => {
    if (watchTimer) clearInterval(watchTimer);
    if (fsIdleTimer) clearTimeout(fsIdleTimer);
    transcriptToken++;
    if (positionTimer) clearTimeout(positionTimer);
    destroyPlayer();
    revoke();
  });

  // Track study watch time
  $effect(() => {
    if (playing && video?.id) {
      if (!watchTimer) {
        watchTimer = setInterval(() => {
          const rec = currentRecord();
          if (!rec?.id) return;
          const currentSpent = Number(rec.timeSpentSeconds) || 0;
          upsertDocument({ id: rec.id, timeSpentSeconds: currentSpent + 1 });
        }, 1000);
      }
    } else {
      if (watchTimer) {
        clearInterval(watchTimer);
        watchTimer = null;
      }
    }
  });

  // Save last watch position on video change
  $effect(() => {
    if (video?.id && current > 0) {
      schedulePositionSave();
    }
  });

  // Fullscreen idle toolbar timeout (auto-hides after 3 seconds of inactivity)
  function pokeFsToolbar() {
    if (!isFullscreen) return;
    fsIdle = false;
    if (fsIdleTimer) clearTimeout(fsIdleTimer);
    fsIdleTimer = setTimeout(() => {
      fsIdle = true;
    }, 3000);
  }

  function onMouseMove() {
    if (isFullscreen) {
      pokeFsToolbar();
    }
  }

  function toggleFullscreen() {
    if (!workspaceEl) return;
    if (!document.fullscreenElement) {
      workspaceEl.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }

  function onFullscreenChange() {
    isFullscreen = !!document.fullscreenElement;
    if (!isFullscreen) {
      fsIdle = false;
      if (fsIdleTimer) clearTimeout(fsIdleTimer);
    } else {
      fsIdle = false;
      pokeFsToolbar();
    }
  }

  // Draggable right sidebar resize handle
  function startSidebarResize(e) {
    e.preventDefault();
    isResizing = true;
    const onPointerMove = (ev) => {
      if (!isResizing) return;
      const minW = Math.max(260, Math.round(window.innerWidth * 0.20));
      const maxW = Math.round(window.innerWidth * 0.65);
      const newWidth = Math.max(minW, Math.min(maxW, window.innerWidth - ev.clientX));
      sidebarWidth = newWidth;
    };
    const onPointerUp = () => {
      isResizing = false;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  }

  let activePlaylistId = $state('');
  let playlistVideoAddOpen = $state(false);
  let playlistVideoUrlInput = $state('');
  let playlistVideoDocPick = $state('');
  let playlistPlayingIndex = $state(-1);

  function handleCreatePlaylist() {
    if (!newPlaylistTitle.trim()) return;
    const pl = upsertPlaylist({ title: newPlaylistTitle.trim() });
    playlists = listPlaylists();
    newPlaylistTitle = '';
    creatingPlaylist = false;
    activePlaylistId = pl.id;
  }

  function handleSelectPlaylist(plId) {
    activePlaylistId = plId;
  }

  function handleAddVideoToActivePlaylist() {
    if (!activePlaylistId) return;
    if (playlistVideoUrlInput.trim()) {
      const parsed = parseYouTube(playlistVideoUrlInput.trim());
      if (!parsed) return;
      const docId = youtubeDocId(parsed);
      const existing = (videos || []).find((d) => d.id === docId);
      const doc = existing || upsertDocument({
        id: docId,
        kind: 'video',
        provider: 'youtube',
        ytType: 'video',
        ytId: parsed.id,
        title: `YouTube: ${parsed.id}`,
        filename: `YouTube: ${parsed.id}`,
        url: parsed.url,
        embedUrl: parsed.embedUrl,
        size: 0,
        mime: 'text/html',
        missing: false
      });
      addVideoToPlaylist(activePlaylistId, doc.id);
      refreshDocs?.();
      playlists = listPlaylists();
      playlistVideoUrlInput = '';
      playlistVideoAddOpen = false;
      notify(t('video.addToPlaylist'), 'ok');
    } else if (playlistVideoDocPick) {
      addVideoToPlaylist(activePlaylistId, playlistVideoDocPick);
      playlists = listPlaylists();
      playlistVideoDocPick = '';
      playlistVideoAddOpen = false;
      notify(t('video.addToPlaylist'), 'ok');
    }
  }

  function handleRemoveFromPlaylist(plId, vidId) {
    removeVideoFromPlaylist(plId, vidId);
    playlists = listPlaylists();
  }

  function handleMoveInPlaylist(plId, vidId, delta) {
    moveVideoInPlaylist(plId, vidId, delta);
    playlists = listPlaylists();
  }

  function handlePlayAllPlaylist(pl) {
    if (!pl || !pl.videoIds || !pl.videoIds.length) return;
    activePlaylistId = pl.id;
    playlistPlayingIndex = 0;
    const firstVidId = pl.videoIds[0];
    const target = videos.find((v) => v.id === firstVidId);
    if (target) openVideo(target);
  }

  function playPlaylistIndex(pl, idx) {
    if (!pl || !pl.videoIds || idx < 0 || idx >= pl.videoIds.length) return;
    activePlaylistId = pl.id;
    playlistPlayingIndex = idx;
    const vidId = pl.videoIds[idx];
    const target = videos.find((v) => v.id === vidId);
    if (target) openVideo(target);
  }

  function checkPlaylistNext() {
    if (!activePlaylistId || playlistPlayingIndex < 0) return;
    const pl = playlists.find((p) => p.id === activePlaylistId);
    if (!pl || !pl.videoIds) return;
    const nextIdx = playlistPlayingIndex + 1;
    if (nextIdx < pl.videoIds.length) {
      playPlaylistIndex(pl, nextIdx);
    }
  }

  function revoke() {
    if (srcUrl) { try { URL.revokeObjectURL(srcUrl); } catch { /* already gone */ } }
    srcUrl = '';
  }

  function destroyPlayer() {
    if (ytReadyTimer) { clearTimeout(ytReadyTimer); ytReadyTimer = null; }
    ytActiveSession = '';
    ytFrameUrl = '';
  }

  async function loadVideo(id) {
    const my = ++token;
    destroyPlayer();
    revoke();
    playState(false);
    loadError = '';
    ytError = '';
    current = 0;
    duration = 0;
    rate = 1;
    bookmarks = [];
    transcriptToken++;
    transcriptOpen = false;
    transcript = null;
    transcriptError = '';
    transcriptLang = '';
    transcriptLoading = false;
    ytQualities = [];
    userSelectedQuality = 'auto';
    ytQuality = 'auto';
    ytCurrentVideoId = '';
    if (!id) return;
    const record = videos.find((v) => v.id === id) || video;
    bookmarks = (record?.bookmarks || []).map((b) => ({ ...b }));
    if (record?.provider === 'youtube') {
      if (ytHost && ytFrameUrl && record.ytId) {
        ytCurrentVideoId = record.ytId;
        const start = Number(record.lastSeconds) || 0;
        ytPost('loadVideo', { videoId: record.ytId, start });
        loading = false;
        loadChapters(record.ytId);
        loadTranscript();
        return;
      }
      await setupPlayer(record, my);
      loadChapters(record.ytId);
      loadTranscript();
      return;
    }
    loading = true;
    try {
      const bytes = await readPdfBytes(id);
      if (my !== token) return;
      if (!bytes) { loadError = t('video.fileUnavailable'); loading = false; return; }
      srcUrl = URL.createObjectURL(new Blob([bytes], { type: record?.mime || 'video/mp4' }));
      loading = false;
    } catch (e) {
      if (my !== token) return;
      loadError = String(e.message || e);
      loading = false;
    }
  }

  async function setupPlayer(record, my) {
    loading = true;
    await tick();
    if (my !== token) return;
    try {
      const bridge = globalThis.window?.studyos;
      let origin = '';
      if (typeof bridge?.appOrigin === 'function') origin = String(await bridge.appOrigin() || '');
      else origin = String(globalThis.window?.location?.origin || '');
      if (my !== token) return;
      if (!origin || origin === 'null' || origin.startsWith('file:')) {
        throw new Error('player origin unavailable');
      }
      const session = String(++ytSessionToken);
      ytActiveSession = session;
      const params = new URLSearchParams();
      if (record.ytType === 'playlist') {
        params.set('type', 'playlist');
        params.set('list', record.ytId);
      } else {
        params.set('videoId', record.ytId);
      }
      params.set('session', session);
      const start = Number(record.lastSeconds) || 0;
      if (start > 0) params.set('start', String(Math.max(0, Math.floor(start))));
      if (muted) params.set('muted', '1');
      if (rate !== 1) params.set('rate', String(rate));
      if (ytShowNativeControls) params.set('controls', '1');
      ytFrameUrl = `${origin.replace(/\/+$/, '')}/yt-player.html?${params.toString()}`;
      if (ytReadyTimer) clearTimeout(ytReadyTimer);
      ytReadyTimer = setTimeout(() => {
        ytReadyTimer = null;
        if (my !== token || ytError || playing || current > 0) return;
        loading = false;
        ytError = t('video.youtubeFailed');
      }, 50000);
    } catch (e) {
      if (my !== token) return;
      ytError = `${t('video.youtubeFailed')} (${String(e.message || e)})`;
      loading = false;
    }
  }

  function currentRecord() {
    return videos.find((v) => v.id === video?.id) || video;
  }

  function onYtMessage(event) {
    if (!ytFrame || event.source !== ytFrame.contentWindow) return;
    const data = event.data;
    if (!data || data.source !== 'studyos-yt') return;
    if (ytActiveSession && data.session !== ytActiveSession) return;
    if (ytReadyTimer) { clearTimeout(ytReadyTimer); ytReadyTimer = null; }
    if (data.type === 'ready') {
      onYtReady(data, currentRecord());
      return;
    }
    if (data.type === 'error') {
      handleYtError(data);
      return;
    }
    applyYtSnapshot(data);
    if (data.type === 'state' && (data.state === 2 || data.state === 0)) flushPosition();
    if (data.type === 'state' && data.state === 0) checkPlaylistNext();
  }

  function ytPost(command, args) {
    const frame = ytFrame;
    if (!frame?.contentWindow) return false;
    try {
      frame.contentWindow.postMessage({ source: 'studyos-yt-parent', command, args }, '*');
      return true;
    } catch {
      return false;
    }
  }

  function onYtReady(snapshot, record) {
    if (ytReadyTimer) { clearTimeout(ytReadyTimer); ytReadyTimer = null; }
    loading = false;
    ytError = '';
    ytCurrentVideoId = snapshot.videoId || (record?.ytType === 'video' ? record.ytId : '');
    duration = Number(snapshot.duration) || 0;
    const start = Number(record?.lastSeconds) || 0;
    current = start > 0
      ? Math.min(start, duration > 0 ? Math.max(0, duration - 0.1) : start)
      : Number(snapshot.current) || 0;
    ytQualities = normalizeQualities(snapshot.qualities);
    ytQuality = userSelectedQuality;
    if (muted) ytPost('mute');
    if (rate !== 1) ytPost('rate', rate);
    const patch = {};
    if (record?.ytType === 'video' && snapshot.title) patch.title = snapshot.title;
    if (duration > 0 && Math.round(duration) !== record?.durationSeconds) patch.durationSeconds = Math.round(duration);
    if (Object.keys(patch).length && record?.id) {
      const updated = upsertDocument({ id: record.id, ...patch });
      refreshDocs?.();
      onOpen?.(updated);
    }
    schedulePositionSave();
  }

  function tickHeartbeat() {
    if (!playing || !video?.id) return;
    const now = Date.now();
    if (now - lastHeartbeat >= 5000) {
      lastHeartbeat = now;
      recordStudyHeartbeat('video', video.id, video.title || video.filename, 5, { duration, current });
    }
  }

  async function loadChapters(videoId) {
    if (!videoId) return;
    chaptersLoading = true;
    try {
      const bridge = globalThis.window?.studyos;
      if (typeof bridge?.youtubeChapters === 'function') {
        const res = await bridge.youtubeChapters({ videoId });
        if (res?.ok && Array.isArray(res.chapters)) {
          chapters = res.chapters;
          chaptersLoading = false;
          return;
        }
      }
      const res = await fetch(`/api/chapters?videoId=${encodeURIComponent(videoId)}`);
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.chapters)) {
          chapters = data.chapters;
          chaptersLoading = false;
          return;
        }
      }
    } catch {}
    chaptersLoading = false;
    chapters = [];
  }

  function toggleBlackScreen() {
    isBlackScreen = !isBlackScreen;
    if (isBlackScreen && isYoutube) {
      changeQuality('144p');
    }
  }

  async function handleLocalFileSelect(e) {
    const file = e.target?.files?.[0];
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const isAudio = file.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.name);
      const id = crypto.randomUUID();
      await savePdfBytes(id, bytes);
      const newDoc = upsertDocument({
        id,
        kind: 'video',
        title: file.name.replace(/\.[^/.]+$/, ''),
        filename: file.name,
        mime: file.type || (isAudio ? 'audio/mpeg' : 'video/mp4'),
        sizeBytes: file.size,
        dateAdded: Date.now()
      });
      refreshDocs?.();
      onOpen?.(newDoc);
      notify(t('video.fileImportedSuccess', { name: file.name }), 'ok');
    } catch (err) {
      notify(String(err?.message || err), 'error');
    }
  }

  function applyYtSnapshot(snapshot) {
    if (!snapshot) return;
    const nextDuration = Number(snapshot.duration);
    if (Number.isFinite(nextDuration) && nextDuration > 0) duration = nextDuration;
    const nextCurrent = Number(snapshot.current);
    if (Number.isFinite(nextCurrent) && nextCurrent >= 0) current = nextCurrent;
    playState(snapshot.state === 1);
    if (snapshot.state === 1) tickHeartbeat();
    if (snapshot.videoId && snapshot.videoId !== ytCurrentVideoId) {
      ytCurrentVideoId = snapshot.videoId;
      transcript = null;
      transcriptError = '';
      transcriptLang = '';
      transcriptToken++;
      loadChapters(snapshot.videoId);
      if (showSubtitles || transcriptOpen) loadTranscript();
    }
    const levels = normalizeQualities(snapshot.qualities);
    if (levels.length) {
      ytQualities = levels;
    }
    if (snapshot.playlist && Array.isArray(snapshot.playlist) && snapshot.playlist.length > 0) {
      handlePlaylistLoaded(snapshot.playlist, snapshot.title);
    }
    schedulePositionSave();
  }


  function handlePlaylistLoaded(videoIds, playlistTitle) {
    if (!video?.id || playlistImported.has(video.id)) return;
    playlistImported.add(video.id);
    let count = 0;
    for (const vid of videoIds) {
      if (!vid || typeof vid !== 'string') continue;
      const childDocId = `yt-video-${vid}`;
      if (!videos.some((v) => v.id === childDocId)) {
        upsertDocument({
          id: childDocId,
          kind: 'video',
          provider: 'youtube',
          ytType: 'video',
          ytId: vid,
          title: `YouTube Video (${vid})`,
          filename: `https://www.youtube.com/watch?v=${vid}`,
          url: `https://www.youtube.com/watch?v=${vid}`,
          embedUrl: `https://www.youtube-nocookie.com/embed/${vid}?rel=0&modestbranding=1`,
          size: 0,
          mime: 'text/html',
          missing: false,
          playlistId: video.id
        });
        count++;
      }
    }
    if (count > 0) {
      refreshDocs?.();
      notify(t('video.playlistImported') || `Imported ${count} videos from playlist`, 'ok');
    }
  }

  function handleYtError(data) {
    if (ytReadyTimer) { clearTimeout(ytReadyTimer); ytReadyTimer = null; }
    loading = false;
    try { console.warn('StudyOS YouTube player error:', data?.code, data?.message || ''); } catch { /* no console */ }
    if (video?.ytType === 'playlist') {
      notify(t('video.youtubeFailed'), 'error');
      return;
    }
    ytError = t('video.youtubeFailed');
  }

  function setQuality(value) {
    userSelectedQuality = String(value || 'auto');
    ytQuality = userSelectedQuality;
    ytPost('quality', ytQuality === 'auto' ? 'default' : ytQuality);
  }

  function toggleNativeControls() {
    ytShowNativeControls = !ytShowNativeControls;
    const record = currentRecord();
    if (record?.provider === 'youtube') {
      setupPlayer(record, ++token);
    }
  }

  function addYoutube() {
    const parsed = parseYouTube(ytInput);
    if (!parsed) { notify(t('video.youtubeInvalid'), 'error'); return; }
    const id = youtubeDocId(parsed);
    const doc = upsertDocument({
      id,
      kind: 'video',
      provider: 'youtube',
      ytType: parsed.type,
      ytId: parsed.id,
      title: parsed.url,
      filename: parsed.url,
      url: parsed.url,
      embedUrl: parsed.embedUrl,
      size: 0,
      mime: 'text/html',
      missing: false
    });
    ytInput = '';
    isAddOpen = false;
    refreshDocs?.();
    notify(t('video.youtubeAdded', { title: doc.ytType === 'playlist' ? t('video.playlist') : doc.title }), 'ok');
    onOpen?.(doc);
  }

  function handleAddPlaylistDirect() {
    const parsed = parseYouTube(playlistUrlInput);
    if (!parsed || parsed.type !== 'playlist') {
      notify(t('video.youtubeInvalid'), 'error');
      return;
    }
    const doc = upsertDocument({
      id: youtubeDocId(parsed),
      kind: 'video',
      provider: 'youtube',
      ytType: 'playlist',
      ytId: parsed.id,
      title: parsed.url,
      filename: parsed.url,
      url: parsed.url,
      embedUrl: parsed.embedUrl,
      size: 0,
      mime: 'text/html',
      missing: false
    });
    playlistUrlInput = '';
    isPlaylistAddOpen = false;
    refreshDocs?.();
    notify(t('video.youtubeAdded', { title: t('video.playlist') }), 'ok');
    onOpen?.(doc);
  }

  // --- Captions & Subtitles (Works seamlessly in Browser & Electron) ---------

  function transcriptSourceId() {
    return ytCurrentVideoId || transcriptVideoId || '';
  }

  async function toggleSubtitles() {
    showSubtitles = !showSubtitles;
    if (showSubtitles && !transcript && !transcriptLoading) {
      await loadTranscript(transcriptLang || '');
    }
  }

  function handleTranscriptResult(result, preferred) {
    if (!result || result.ok === false) {
      transcript = null;
      transcriptError = result?.error === 'noCaptions' || result?.error === 'noCues'
        ? t('video.transcriptNone')
        : result?.error === 'captionsBlocked'
          ? t('video.transcriptBlocked', { message: result.message || '' })
          : t('video.transcriptError', {
              message: result?.message || result?.error || t('video.transcriptUnknown')
            });
      return;
    }
    transcript = result;
    transcriptLang = result.selected?.languageCode || preferred;
    transcriptError = '';
  }

  async function loadTranscript(lang = '') {
    if (!isYoutube) return;
    const videoId = transcriptSourceId();
    if (!videoId) { transcriptError = t('video.transcriptNotReady'); return; }
    const my = ++transcriptToken;
    const preferred = lang || ui.lang;
    transcriptLoading = true;
    transcriptError = '';

    // 1. Desktop Electron bridge
    const bridge = globalThis.window?.studyos;
    if (typeof bridge?.youtubeTranscript === 'function') {
      try {
        const result = await bridge.youtubeTranscript({ videoId, lang: preferred });
        if (my !== transcriptToken) return;
        if (result && result.ok) {
          handleTranscriptResult(result, preferred);
          transcriptLoading = false;
          return;
        }
      } catch (e) { /* fallback below */ }
    }

    // 2. Vite dev server endpoint (runs in Node so bypasses browser CORS)
    try {
      const res = await fetch(`/api/transcript?videoId=${encodeURIComponent(videoId)}&lang=${encodeURIComponent(preferred)}`);
      if (res.ok) {
        const result = await res.json();
        if (my !== transcriptToken) return;
        if (result && result.ok) {
          handleTranscriptResult(result, preferred);
          transcriptLoading = false;
          return;
        }
      }
    } catch { /* fallback to public API */ }

    // 3. Direct timedtext endpoint
    try {
      const res = await fetch(`https://www.youtube.com/api/timedtext?v=${encodeURIComponent(videoId)}&lang=${encodeURIComponent(preferred)}&fmt=json3`);
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.events)) {
          const cues = [];
          for (const ev of data.events) {
            if (!ev.segs) continue;
            const line = ev.segs.map((s) => s.utf8 || '').join('').trim();
            if (line) cues.push({ start: (ev.tStartMs || 0) / 1000, duration: (ev.dDurationMs || 0) / 1000, text: line });
          }
          if (cues.length) {
            handleTranscriptResult({ ok: true, cues, tracks: [{ languageCode: preferred, label: preferred }], title: video?.title || '' }, preferred);
            transcriptLoading = false;
            return;
          }
        }
      }
    } catch { /* proceed */ }

    if (my !== transcriptToken) return;
    transcriptLoading = false;
    transcript = null;
    transcriptError = t('video.transcriptNone');
  }

  function changeTranscriptLang(event) {
    const code = event.currentTarget.value;
    transcriptLang = code;
    loadTranscript(code);
  }

  function transcriptBaseName() {
    return safeBaseName(video?.title || transcript?.title || 'video', 'transcript');
  }

  async function exportTranscriptTxt() {
    if (!transcript?.text) return;
    const filename = `${transcriptBaseName()} — transcript.txt`;
    try {
      const result = await deliverBytes(
        new TextEncoder().encode(transcript.text),
        filename,
        globalThis.window?.studyos,
        'text/plain;charset=utf-8'
      );
      notify(t('video.transcriptSavedTxt', { path: result.path }), 'ok');
    } catch (error) {
      notify(t('video.transcriptExportFailed', { message: String(error?.message || error) }), 'error');
    }
  }

  async function exportTranscriptPdf() {
    if (!transcript?.cues?.length) return;
    const filename = `${transcriptBaseName()} — transcript.pdf`;
    const bridge = globalThis.window?.studyos;
    if (typeof bridge?.exportTranscriptPdf === 'function') {
      try {
        const result = await bridge.exportTranscriptPdf({
          title: video?.title || transcript.title || '',
          url: transcript.url || '',
          lang: transcript.selected?.languageCode || '',
          cues: transcript.cues,
          filename
        });
        if (result?.ok) {
          notify(t('video.transcriptSavedPdf', { path: result.path }), 'ok');
          return;
        }
      } catch { /* proceed to universal fallback below */ }
    }

    try {
      const items = transcript.cues.map((c) => ({
        type: 'quote',
        text: `[${formatTimecode(c.start)}] ${c.text}`
      }));
      const bytes = await notesToPdf(items, {
        title: video?.title || transcript.title || 'Transcript'
      });
      const result = await deliverBytes(bytes, filename, bridge, 'application/pdf');
      notify(t('video.transcriptSavedPdf', { path: result.path || filename }), 'ok');
    } catch (error) {
      notify(t('video.transcriptExportFailed', { message: String(error?.message || error) }), 'error');
    }
  }

  function playState(next) {
    playing = next;
    if (next) schedulePositionSave();
  }

  async function togglePlay() {
    pokeFsToolbar();
    if (isYoutube) {
      if (!ytFrame) return;
      ytPost(playing ? 'pause' : 'play');
      return;
    }
    if (!videoEl) return;
    try {
      if (videoEl.paused) await videoEl.play();
      else videoEl.pause();
    } catch (e) {
      notify(t('video.frameFailed'), 'error');
    }
  }

  async function seekBy(seconds) {
    pokeFsToolbar();
    if (isYoutube) { seekTarget(current + seconds); return; }
    if (!videoEl) return;
    videoEl.currentTime = clampSeek(videoEl.currentTime + seconds, duration);
    await tick();
    current = videoEl.currentTime;
    schedulePositionSave();
  }


  function seekTo(seconds) {
    pokeFsToolbar();
    if (isYoutube) { seekTarget(seconds); return; }
    if (!videoEl) return;
    videoEl.currentTime = clampSeek(seconds, duration);
    current = videoEl.currentTime;
    schedulePositionSave();
  }


  function seekTarget(targetSeconds) {
    const target = clampSeek(targetSeconds, duration);
    current = target;
    ytPost('seek', target);
    schedulePositionSave();
  }


  function toggleMute() {
    pokeFsToolbar();
    muted = !muted;
    if (isYoutube) ytPost(muted ? 'mute' : 'unmute');
    else if (videoEl) videoEl.muted = muted;
  }

  function setRate(val) {
    pokeFsToolbar();
    rate = Number(val);
    if (isYoutube) ytPost('rate', rate);
    else if (videoEl) videoEl.playbackRate = rate;
  }

  function onScrub(event) {
    pokeFsToolbar();
    const val = Number(event.currentTarget.value);
    const target = (val / 1000) * duration;
    seekTo(target);
  }

  function onLoadedMetadata() {
    if (!videoEl) return;
    duration = videoEl.duration || 0;
    if (video?.lastSeconds) {
      videoEl.currentTime = clampSeek(video.lastSeconds, duration);
      current = videoEl.currentTime;
    }
  }

  function onTimeUpdate() {
    if (!videoEl) return;
    current = videoEl.currentTime;
    schedulePositionSave();
  }


  function schedulePositionSave() {
    if (!video?.id || positionTimer) return;
    positionTimer = setTimeout(() => {
      positionTimer = null;
      flushPosition();
    }, 4000);
  }

  function flushPosition() {
    if (!video?.id) return;
    if (isYoutube) {
      if (!ytFrame) return;
      setPlaybackPosition(video.id, current);
      refreshDocs?.();
      return;
    }
    if (!videoEl) return;
    setPlaybackPosition(video.id, videoEl.currentTime);
    refreshDocs?.();
  }

  function keepsOwnKeys(node) {
    const tag = String(node?.tagName || '').toLowerCase();
    return ['input', 'select', 'textarea', 'button', 'a'].includes(tag) || node?.isContentEditable;
  }

  function onKeydown(event) {
    if (!video || keepsOwnKeys(event.target)) return;
    if (event.key === ' ' || event.key === 'k') { event.preventDefault(); togglePlay(); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); seekBy(5); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); seekBy(-5); }
  }

  // --- Screenshot with In-Place Annotation Markup --------------------------

  async function triggerScreenshotAnnotation() {
    if (capturing) return;
    pokeFsToolbar();

    // 1. Pause video
    if (playing) {
      if (isYoutube) ytPost('pause');
      else videoEl?.pause();
      playing = false;
    }

    const captureSec = current;
    capturing = true;

    try {
      let dataUrl = null;
      if (isYoutube) {
        const bridge = globalThis.window?.studyos;
        if (typeof bridge?.captureRegion === 'function' && ytHost) {
          try {
            const rect = ytHost.getBoundingClientRect();
            if (rect.width >= 16 && rect.height >= 16) {
              const res = await bridge.captureRegion(
                { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
                loadImageQuality()
              );
              if (res?.ok && res.dataUrl) dataUrl = res.dataUrl;
            }
          } catch { /* fallback to thumbnail */ }
        }
        if (!dataUrl) {
          const vid = transcriptSourceId();
          if (vid) {
            dataUrl = await getYouTubeFallbackImage(vid, captureSec, duration);
          }
        }
      } else if (videoEl && videoEl.videoWidth) {
        const scale = Math.min(1, 1280 / videoEl.videoWidth);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(videoEl.videoWidth * scale);
        canvas.height = Math.round(videoEl.videoHeight * scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
        dataUrl = canvasCapture(canvas, loadImageQuality());
      }

      if (!dataUrl) {
        notify(t('video.frameFailed'), 'error');
        return;
      }

      // Open in-place annotation markup modal (rendered INSIDE workspaceEl so it works in Fullscreen!)
      annotatingCapture = { image: dataUrl, seconds: captureSec };
    } catch (e) {
      notify(t('video.frameFailed'), 'error');
    } finally {
      capturing = false;
    }
  }

  function handleSaveAnnotated(dataUrl) {
    if (!annotatingCapture || !video?.id) return;
    const capture = frameCaptureRecord({
      id: crypto.randomUUID(),
      documentId: video.id,
      title: video.title || video.filename || 'Screenshot',
      seconds: annotatingCapture.seconds,
      image: dataUrl
    });
    onCapture?.(capture);
    annotatingCapture = null;
    notify(t('video.saved'), 'ok');
  }

  function handleCancelAnnotated() {
    annotatingCapture = null;
  }

  async function getYouTubeFallbackImage(videoId, seconds = 0, totalDuration = 0) {
    if (!videoId) return createPlaceholderFrame('YouTube Frame');
    return new Promise((resolve) => {
      const ratio = totalDuration > 0 ? (seconds / totalDuration) : 0;
      let frameName = '2.jpg';
      if (ratio < 0.35) frameName = '1.jpg';
      else if (ratio > 0.65) frameName = '3.jpg';

      const candidateUrls = [
        `https://img.youtube.com/vi/${videoId}/${frameName}`,
        `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
        `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`
      ];

      function tryLoad(index) {
        if (index >= candidateUrls.length) {
          resolve(createPlaceholderFrame(video?.title || 'YouTube Frame'));
          return;
        }
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth || 1280;
            canvas.height = img.naturalHeight || 720;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/png'));
          } catch {
            resolve(createPlaceholderFrame(video?.title || 'YouTube Frame'));
          }
        };
        img.onerror = () => tryLoad(index + 1);
        img.src = candidateUrls[index];
      }

      tryLoad(0);
    });
  }

  function createPlaceholderFrame(label) {
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label || 'Video Frame', canvas.width / 2, canvas.height / 2);
    ctx.font = '24px sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(formatTimecode(current), canvas.width / 2, canvas.height / 2 + 50);
    return canvas.toDataURL('image/png');
  }

  // --- Bookmarks -------------------------------------------------------------

  function addBookmark() {
    if (!video?.id || (!videoEl && !ytFrame)) return;
    const at = Math.round(videoEl ? videoEl.currentTime : current);
    const entry = {
      id: crypto.randomUUID(),
      at,
      note: noteDraft.trim(),
      parentId: null,
      order: (bookmarks.length + 1) * 10,
      collapsed: false,
      createdAt: new Date().toISOString()
    };
    bookmarks = [...bookmarks, entry];
    noteDraft = '';
    setBookmarks(video.id, bookmarks);
    refreshDocs?.();
  }

  function doIndentBookmark(b) {
    bookmarks = indentBookmark(bookmarks, b.id);
    if (video?.id) setBookmarks(video.id, bookmarks);
    refreshDocs?.();
  }

  function doOutdentBookmark(b) {
    bookmarks = outdentBookmark(bookmarks, b.id);
    if (video?.id) setBookmarks(video.id, bookmarks);
    refreshDocs?.();
  }

  function toggleCollapseBookmark(b) {
    bookmarks = toggleBookmarkCollapse(bookmarks, b.id);
    if (video?.id) setBookmarks(video.id, bookmarks);
    refreshDocs?.();
  }

  function removeBookmark(entry) {
    if (!video?.id) return;
    bookmarks = bookmarks.filter((b) => b.id !== entry.id);
    setBookmarks(video.id, bookmarks);
    refreshDocs?.();
  }

  function openVideo(record) {
    onOpen?.(record);
  }

  function retryYoutube() {
    const record = currentRecord();
    if (!record?.id) return;
    ytError = '';
    loading = true;
    setupPlayer(record, ++token);
  }

  // --- Study Notes Editor Tab ------------------------------------------------

  function insertScreenshotIntoEditor(imgSrc) {
    const img = imgSrc || videoCaptures[videoCaptures.length - 1]?.image;
    if (!img) {
      notify(t('video.frameFailed'), 'error');
      return;
    }
    videoNotes = [...videoNotes, {
      id: crypto.randomUUID(),
      type: 'image',
      image: img,
      text: `${video?.title || ''} (${formatTimecode(current)})`,
      createdAt: new Date().toISOString()
    }];
    sidebarTab = 'editor';
    sidebarOpen = true;
    notify(t('video.insertScreenshot'), 'ok');
  }

  function insertSubtitleIntoEditor() {
    if (!activeCue?.text) {
      notify(t('video.transcriptNone'), 'error');
      return;
    }
    videoNotes = [...videoNotes, {
      id: crypto.randomUUID(),
      type: 'quote',
      text: `[${formatTimecode(activeCue.start)}] ${activeCue.text}`,
      createdAt: new Date().toISOString()
    }];
    sidebarTab = 'editor';
    sidebarOpen = true;
    notify(t('video.insertSubtitle'), 'ok');
  }

  function addEditorNote() {
    if (!editorNoteText.trim()) return;
    const isHeading = editorHeading.startsWith('h');
    const level = isHeading ? Number(editorHeading.replace('h', '')) : 0;
    videoNotes = [...videoNotes, {
      id: crypto.randomUUID(),
      type: isHeading ? 'heading' : 'paragraph',
      level,
      text: editorNoteText.trim(),
      isRtl: editorDir === 'rtl',
      createdAt: new Date().toISOString()
    }];
    editorNoteText = '';
  }

  function removeEditorNote(id) {
    videoNotes = videoNotes.filter((n) => n.id !== id);
  }

  async function exportEditorWord() {
    if (!videoNotes.length) return;
    try {
      const bytes = notesToDocx(videoNotes, { title: `${video?.title || 'Video'} - Notes` });
      const filename = `${safeBaseName(video?.title || 'video', 'notes')} — notes.docx`;
      const bridge = globalThis.window?.studyos;
      await deliverBytes(bytes, filename, bridge, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      notify(t('video.saved'), 'ok');
    } catch (err) {
      notify(String(err?.message || err), 'error');
    }
  }

  async function exportEditorPdf() {
    if (!videoNotes.length) return;
    try {
      const bytes = await notesToPdf(videoNotes, { title: `${video?.title || 'Video'} - Notes` });
      const filename = `${safeBaseName(video?.title || 'video', 'notes')} — notes.pdf`;
      const bridge = globalThis.window?.studyos;
      await deliverBytes(bytes, filename, bridge, 'application/pdf');
      notify(t('video.saved'), 'ok');
    } catch (err) {
      notify(String(err?.message || err), 'error');
    }
  }
</script>

<svelte:window onkeydown={onKeydown} onmessage={onYtMessage} onfullscreenchange={onFullscreenChange} onmousemove={onMouseMove} />

<!-- Fullscreen & Standard Study Workspace Wrapper -->
<div
  class="video-workspace"
  bind:this={workspaceEl}
  class:is-fullscreen={isFullscreen}
  class:has-subtitles={showSubtitles}
  class:idle={fsIdle}
  class:sidebar-open={sidebarOpen}
  style="--sidebar-w:{sidebarWidth}px"
>

  <!-- Left: Video Player Stage (Expands to 100% when sidebar is closed, shrinks flexibly when opened) -->
  <section class="video-stage">
    {#if !video && videos.length === 0}
      <EmptyState icon="video" title={t('empty.videoTitle')} hint={t('video.empty')}
        actionLabel={t('video.import')} onaction={onImport} />
    {:else if !video}
      <div class="empty">{t('video.select')}</div>
    {:else if loading && !isYoutube}
      <div class="empty">{t('video.loading')}</div>
    {:else if loadError}
      <div class="empty">{loadError}</div>
    {:else}
      <div class="player-card">
        {#if !isFullscreen}
          <div class="player-head">
            <span class="ph-title">{video.title}</span>
            <span class="muted" style="font-size:12px">
              {hasDuration ? formatTimecode(duration) : t('video.unknownDuration')}
            </span>
          </div>
        {/if}

        <div class="video-frame">
          {#if isBlackScreen}
            <div class="audio-black-cover" onclick={toggleBlackScreen} role="button" tabindex="0"
              onkeydown={(e) => e.key === 'Enter' && toggleBlackScreen()}
              title={t('video.showVideo')}>
              <div class="audio-black-indicator">
                <Icon name="headphones" size={40} />
                <span class="audio-black-title">{video?.title || video?.filename || 'شاشة سوداء (صوت فقط)'}</span>
                <span class="audio-black-hint">{t('video.blackScreenHint')}</span>
              </div>
            </div>
          {/if}
          {#if isYoutube}
            {#if ytError}
              <div class="empty yt-error">
                <span>{ytError}</span>
                <div class="hstack" style="gap:8px; justify-content:center; flex-wrap:wrap;">
                  <button class="primary" onclick={retryYoutube}>
                    <Icon name="repeat" size={15} /><span>{t('video.retry')}</span>
                  </button>
                  {#if video?.url}
                    <a class="button secondary" href={video.url} target="_blank" rel="noopener noreferrer" style="text-decoration:none; display:inline-flex; align-items:center; gap:6px;">
                      <Icon name="play" size={14} /><span>{t('video.openInBrowser')}</span>
                    </a>
                  {/if}
                </div>
              </div>
            {:else}
              <div class="yt-host" bind:this={ytHost}>
                <iframe
                  bind:this={ytFrame}
                  class="yt-embed"
                  src={ytFrameUrl || 'about:blank'}
                  title={video.title || 'YouTube'}
                  allow="autoplay; encrypted-media; picture-in-picture"
                  referrerpolicy="strict-origin-when-cross-origin"></iframe>
              </div>
            {/if}
            {#if loading}<div class="yt-loading">{t('video.loading')}</div>{/if}
          {:else}
            <!-- svelte-ignore a11y_media_has_caption -->
            <video
              bind:this={videoEl}
              src={srcUrl}
              preload="metadata"
              playsinline
              onloadedmetadata={onLoadedMetadata}
              ontimeupdate={onTimeUpdate}
              onplay={() => playState(true)}
              onpause={() => { playState(false); flushPosition(); }}
              onended={() => { playState(false); checkPlaylistNext(); }}
              onclick={togglePlay}
            ></video>
          {/if}
        </div>

        <!-- Controls Dock Toolbar (Auto-hides in fullscreen after 3s inactivity) -->
        <div class="controls" dir="ltr">
          <div class="timeline-row">
            <input class="scrub" type="range" min="0" max="1000" value={hasDuration ? (current / duration) * 1000 : 0}
              disabled={!hasDuration} oninput={onScrub} aria-label={t('video.position')} />
            <span class="timecode">{formatTimecode(current)} / {hasDuration ? formatTimecode(duration) : '—'}</span>
          </div>
          <div class="control-row">
            <button onclick={togglePlay} title={playing ? t('video.pause') : t('video.play')} aria-label={playing ? t('video.pause') : t('video.play')}>
              <Icon name={playing ? 'pause' : 'play'} size={17} />
            </button>
            <button onclick={() => seekBy(-5)} title={t('video.back5')} aria-label={t('video.back5')}><Icon name="rewind" size={17} /></button>
            <button onclick={() => seekBy(5)} title={t('video.forward5')} aria-label={t('video.forward5')}><Icon name="forward" size={17} /></button>
            <button onclick={toggleMute} title={muted ? t('video.unmute') : t('video.mute')} aria-label={muted ? t('video.unmute') : t('video.mute')}>
              <Icon name={muted ? 'mute' : 'volume'} size={17} />
            </button>
            <label class="speed" title={t('video.speed')}>
              <select value={rate} onchange={(e) => setRate(e.currentTarget.value)} aria-label={t('video.speed')}>
                {#each SPEEDS as s}<option value={s}>{s}×</option>{/each}
              </select>
            </label>
            <div class="tool-group">
              {#if isYoutube}
                <label class="quality" title={t('video.quality')}>
                  <select value={userSelectedQuality} onchange={(e) => setQuality(e.currentTarget.value)}
                    aria-label={t('video.quality')}>
                    <option value="auto">{t('video.qualityAuto')}</option>
                    {#each (ytQualities.length ? ytQualities : ['highres', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny']) as quality (quality)}
                      <option value={quality}>{qualityLabel(quality)}</option>
                    {/each}
                  </select>
                </label>
                <button class={isBlackScreen ? 'active' : ''} onclick={toggleBlackScreen}
                  title={isBlackScreen ? t('video.showVideo') : t('video.blackScreen')}
                  aria-pressed={isBlackScreen}>
                  <Icon name={isBlackScreen ? 'video' : 'eyeOff'} size={16} />
                  <span>{isBlackScreen ? t('video.showVideo') : t('video.blackScreen')}</span>
                </button>
              {/if}
              <button onclick={triggerScreenshotAnnotation} title={t('video.captureFrame')} disabled={capturing}>
                <Icon name="camera" size={17} /><span>{t('video.captureFrame')}</span>
              </button>
              <!-- Sidebar Toggle Button (Opens/closes the full 5-tab sidebar in standard & fullscreen) -->
              <button class={sidebarOpen ? 'active' : ''} onclick={() => (sidebarOpen = !sidebarOpen)}
                title={t('video.drawer')} aria-label={t('video.drawer')} aria-expanded={sidebarOpen}>
                <Icon name="burger" size={17} />
                {#if bookmarks.length > 0}<span class="fs-badge">{bookmarks.length}</span>{/if}
              </button>
              <button onclick={toggleFullscreen}
                title={isFullscreen ? t('video.exitFullscreen') : t('video.fullscreen')}
                aria-label={isFullscreen ? t('video.exitFullscreen') : t('video.fullscreen')}>
                <Icon name={isFullscreen ? 'minimize' : 'maximize'} size={17} />
              </button>
            </div>
          </div>
        </div>

      </div>
    {/if}
  </section>

  <!-- Resizer Splitter Bar (Flexible divider, works in standard & fullscreen) -->
  {#if sidebarOpen}
    <div class="sidebar-resizer" onpointerdown={startSidebarResize} role="separator" aria-orientation="vertical" tabindex="0">
      <div class="resizer-bar"></div>
    </div>

    <!-- Right: The 5-Tab Study Sidebar (Present in both normal & fullscreen mode!) -->
    <aside class="video-sidebar" style="width:var(--sidebar-w)">

      <!-- Top Tab Navigation Switcher with Horizontal Scroll -->
      <div class="sidebar-tabs-bar" role="tablist">
        <button class={sidebarTab === 'videos' ? 'active' : ''} onclick={() => (sidebarTab = 'videos')} title={t('video.drawerVideos')}>
          <Icon name="video" size={15} /><span>{t('video.drawerVideos')}</span>
        </button>
        <button class={sidebarTab === 'playlists' ? 'active' : ''} onclick={() => (sidebarTab = 'playlists')} title={t('video.playlists')}>
          <Icon name="list" size={15} /><span>{t('video.playlists')}</span>
          {#if playlists.length}<span class="tab-badge">{playlists.length}</span>{/if}
        </button>
        <button class={sidebarTab === 'chapters' ? 'active' : ''} onclick={() => (sidebarTab = 'chapters')} title={t('video.chapters')}>
          <Icon name="columns" size={15} /><span>{t('video.chapters')}</span>
          {#if chapters.length}<span class="tab-badge">{chapters.length}</span>{/if}
        </button>
        <button class={sidebarTab === 'bookmarks' ? 'active' : ''} onclick={() => (sidebarTab = 'bookmarks')} title={t('video.drawerBookmarks')}>
          <Icon name="bookmark" size={15} /><span>{t('video.drawerBookmarks')}</span>
          {#if bookmarks.length}<span class="tab-badge">{bookmarks.length}</span>{/if}
        </button>
        <button class={sidebarTab === 'captures' ? 'active' : ''} onclick={() => (sidebarTab = 'captures')} title={t('video.drawerCaptures')}>
          <Icon name="camera" size={15} /><span>{t('video.drawerCaptures')}</span>
          {#if videoCaptures.length}<span class="tab-badge">{videoCaptures.length}</span>{/if}
        </button>
        <button class={sidebarTab === 'transcript' ? 'active' : ''} onclick={() => (sidebarTab = 'transcript')} title={t('video.drawerSubtitles')}>
          <Icon name="scroll" size={15} /><span>{t('video.drawerSubtitles')}</span>
        </button>
        <button class={sidebarTab === 'editor' ? 'active' : ''} onclick={() => (sidebarTab = 'editor')} title={t('video.drawerEditor')}>
          <Icon name="file-text" size={15} /><span>{t('video.drawerEditor')}</span>
          {#if videoNotes.length}<span class="tab-badge">{videoNotes.length}</span>{/if}
        </button>
      </div>

      <!-- Sidebar Body Content per Tab -->
      <div class="sidebar-body" use:autoScrollbar>

        <!-- TAB 1: VIDEOS (List + Add Video Link + Add Playlist Direct) -->
        {#if sidebarTab === 'videos'}
          <div class="tab-panel">
            <div class="panel-header hstack" style="justify-content:space-between">
              <span class="section-title" style="margin:0">{t('video.drawerVideos')} ({videos.length})</span>
              <button class="primary small" onclick={onImport} title={t('video.import')}>
                <Icon name="upload" size={14} /><span>{t('video.import')}</span>
              </button>
            </div>

            <!-- Collapsible Add Video Link Field -->
            <div class="add-section-box">
              <button class="toggle-add-btn hstack" onclick={() => (isAddOpen = !isAddOpen)} aria-expanded={isAddOpen}>
                <Icon name={isAddOpen ? 'chevron-up' : 'plus'} size={14} />
                <span>{t('video.toggleAdd')}</span>
              </button>
              {#if isAddOpen}
                <div class="add-subcard">
                  <div class="yt-add">
                    <input type="text" placeholder={t('video.youtubePlaceholder')} bind:value={ytInput}
                      onkeydown={(e) => e.key === 'Enter' && addYoutube()} aria-label={t('video.addYoutube')} />
                    <button class="primary small" onclick={addYoutube} disabled={!ytInput.trim()} title={t('video.addYoutube')}>
                      <Icon name="play" size={13} /><span>{t('video.addYoutube')}</span>
                    </button>
                  </div>
                </div>
              {/if}
            </div>

            <!-- YouTube Full Playlist Direct Import Section -->
            <div class="add-section-box" style="margin-top:6px">
              <button class="toggle-add-btn hstack" onclick={() => (isPlaylistAddOpen = !isPlaylistAddOpen)} aria-expanded={isPlaylistAddOpen}>
                <Icon name={isPlaylistAddOpen ? 'chevron-up' : 'plus'} size={14} />
                <span>{t('video.addPlaylistDirect')}</span>
              </button>
              {#if isPlaylistAddOpen}
                <div class="add-subcard">
                  <div class="yt-add">
                    <input type="text" placeholder={t('video.playlistUrl')} bind:value={playlistUrlInput}
                      onkeydown={(e) => e.key === 'Enter' && handleAddPlaylistDirect()} aria-label={t('video.addPlaylistDirect')} />
                    <button class="primary small" onclick={handleAddPlaylistDirect} disabled={!playlistUrlInput.trim()}>
                      <Icon name="plus" size={13} /><span>{t('common.add')}</span>
                    </button>
                  </div>
                </div>
              {/if}
            </div>

            <!-- Video Library List -->
            {#if videos.length === 0}
              <div class="empty muted" style="margin-top:20px">{t('video.empty')}</div>
            {:else}
              <div class="sidebar-video-list">
                {#each videos as v (v.id)}
                  <div class="video-row {v.id === video?.id ? 'active' : ''}">
                    <button class="video-click" onclick={() => openVideo(v)}>
                      <Icon name={v.provider === 'youtube' ? 'play' : 'video'} size={16} />
                      <div class="grow" style="text-align:start">
                        <div class="vrow-title">{v.title}</div>
                        <div class="vrow-meta muted">
                          {#if v.ytType === 'playlist'}<span class="badge">{t('video.playlist')}</span> {:else if v.provider === 'youtube'}<span class="badge">YouTube</span> {/if}
                          {#if v.lastSeconds}{t('video.resumeAt', { time: formatTimecode(v.lastSeconds) })} · {/if}
                          {formatTimecode(v.durationSeconds)}
                        </div>
                      </div>
                    </button>
                    <button class="deck-action" onclick={() => onRemove?.(v)} title={t('video.remove')}>
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                {/each}
              </div>
            {/if}
          </div>

        <!-- TAB: PLAYLISTS (Unlimited custom playlists & unlimited videos) -->
        {:else if sidebarTab === 'playlists'}
          <div class="tab-panel">
            {#if activePlaylistId}
              {@const currentPl = playlists.find((p) => p.id === activePlaylistId)}
              {@const plVideoIds = currentPl?.videoIds || []}
              {@const plVideos = plVideoIds.map((id) => videos.find((v) => v.id === id)).filter(Boolean)}
              <div class="panel-header hstack" style="justify-content:space-between">
                <button class="small hstack" onclick={() => (activePlaylistId = '')}>
                  <Icon name="chevron-left" size={14} /><span>{t('projects.back')}</span>
                </button>
                <div class="hstack" style="gap:6px">
                  <button class="primary small" onclick={() => handlePlayAllPlaylist(currentPl)} disabled={!plVideos.length}>
                    <Icon name="play" size={13} /><span>{t('video.playAll')}</span>
                  </button>
                  <button class="icon-btn" onclick={() => { removePlaylist(currentPl.id); playlists = listPlaylists(); activePlaylistId = ''; }} title={t('video.deletePlaylist')}>
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              </div>

              <div class="pl-header-box mt" style="padding:10px 14px; background:var(--surface-2); border-radius:8px; margin-bottom:12px;">
                <h4 style="margin:0 0 4px 0;">{currentPl?.title}</h4>
                <div class="meta muted" style="font-size:12px;">{plVideos.length} {t('projects.videoCount', { n: plVideos.length })}</div>
              </div>

              <!-- Add Video to this playlist -->
              <div class="add-section-box" style="margin-bottom:12px;">
                <button class="toggle-add-btn hstack" onclick={() => (playlistVideoAddOpen = !playlistVideoAddOpen)} aria-expanded={playlistVideoAddOpen}>
                  <Icon name={playlistVideoAddOpen ? 'chevron-up' : 'plus'} size={14} />
                  <span>{t('video.addVideoToPlaylist')}</span>
                </button>
                {#if playlistVideoAddOpen}
                  <div class="add-subcard">
                    <div style="display:flex; flex-direction:column; gap:8px;">
                      <div class="yt-add">
                        <input type="text" placeholder={t('video.youtubePlaceholder')} bind:value={playlistVideoUrlInput}
                          onkeydown={(e) => e.key === 'Enter' && handleAddVideoToActivePlaylist()} />
                        <button class="primary small" onclick={handleAddVideoToActivePlaylist} disabled={!playlistVideoUrlInput.trim()}>
                          <Icon name="plus" size={13} /><span>{t('common.add')}</span>
                        </button>
                      </div>
                      {#if videos.length > 0}
                        <div class="hstack" style="gap:6px;">
                          <select bind:value={playlistVideoDocPick} class="grow" style="font-size:12px;">
                            <option value="">{t('projects.addVideo')}</option>
                            {#each videos.filter((v) => !plVideoIds.includes(v.id)) as v (v.id)}
                              <option value={v.id}>{v.title}</option>
                            {/each}
                          </select>
                          <button class="small" onclick={handleAddVideoToActivePlaylist} disabled={!playlistVideoDocPick}>
                            <Icon name="plus" size={13} /><span>{t('common.add')}</span>
                          </button>
                        </div>
                      {/if}
                    </div>
                  </div>
                {/if}
              </div>

              <!-- Playlist Videos List -->
              {#if plVideos.length === 0}
                <div class="empty muted" style="margin-top:20px; text-align:center;">{t('video.noPlaylistVideos')}</div>
              {:else}
                <div class="sidebar-video-list">
                  {#each plVideos as v, idx (v.id)}
                    <div class="video-row {v.id === video?.id ? 'active' : ''}">
                      <button class="video-click" onclick={() => playPlaylistIndex(currentPl, idx)}>
                        <span class="chapter-idx">{idx + 1}</span>
                        <Icon name={v.provider === 'youtube' ? 'play' : 'video'} size={15} />
                        <div class="grow" style="text-align:start;">
                          <div class="vrow-title">{v.title}</div>
                          <div class="vrow-meta muted">{formatTimecode(v.durationSeconds)}</div>
                        </div>
                      </button>
                      <div class="hstack" style="gap:2px;">
                        <button class="icon-btn" onclick={() => handleMoveInPlaylist(currentPl.id, v.id, -1)} disabled={idx === 0} title="Move Up">
                          <Icon name="chevron-up" size={13} />
                        </button>
                        <button class="icon-btn" onclick={() => handleMoveInPlaylist(currentPl.id, v.id, 1)} disabled={idx === plVideos.length - 1} title="Move Down">
                          <Icon name="chevron-down" size={13} />
                        </button>
                        <button class="icon-btn" onclick={() => handleRemoveFromPlaylist(currentPl.id, v.id)} title={t('common.remove')}>
                          <Icon name="x" size={13} />
                        </button>
                      </div>
                    </div>
                  {/each}
                </div>
              {/if}

            {:else}
              <!-- All Playlists View -->
              <div class="panel-header hstack" style="justify-content:space-between">
                <span class="section-title" style="margin:0">{t('video.playlists')} ({playlists.length})</span>
                <button class="primary small" onclick={() => (creatingPlaylist = true)}>
                  <Icon name="plus" size={14} /><span>{t('video.newPlaylist')}</span>
                </button>
              </div>

              {#if creatingPlaylist}
                <div class="add-subcard mt" style="margin-bottom:12px;">
                  <div class="yt-add">
                    <input type="text" placeholder={t('video.playlistNamePlaceholder')} bind:value={newPlaylistTitle}
                      onkeydown={(e) => e.key === 'Enter' && handleCreatePlaylist()} />
                    <button class="primary small" onclick={handleCreatePlaylist} disabled={!newPlaylistTitle.trim()}>
                      <Icon name="check" size={13} /><span>{t('common.add')}</span>
                    </button>
                    <button class="small" onclick={() => { creatingPlaylist = false; newPlaylistTitle = ''; }}>
                      <Icon name="x" size={13} />
                    </button>
                  </div>
                </div>
              {/if}

              {#if playlists.length === 0}
                <div class="empty muted" style="margin-top:20px; text-align:center;">{t('video.noPlaylists')}</div>
              {:else}
                <div class="sidebar-video-list mt">
                  {#each playlists as pl (pl.id)}
                    <div class="playlist-row card" style="padding:10px 14px; margin-bottom:8px; background:var(--surface-2); border:1px solid var(--border);">
                      <div class="hstack" style="justify-content:space-between; align-items:center;">
                        <button class="grow hstack" onclick={() => handleSelectPlaylist(pl.id)} style="background:transparent; border:none; cursor:pointer; text-align:start; gap:8px;">
                          <Icon name="list" size={18} />
                          <div>
                            <div class="vrow-title" style="font-weight:600;">{pl.title}</div>
                            <div class="meta muted" style="font-size:11px;">{pl.videoIds?.length || 0} {t('projects.videoCount', { n: pl.videoIds?.length || 0 })}</div>
                          </div>
                        </button>
                        <div class="hstack" style="gap:4px;">
                          <button class="small primary" onclick={() => handlePlayAllPlaylist(pl)} disabled={!pl.videoIds?.length} title={t('video.playAll')}>
                            <Icon name="play" size={12} /><span>{t('video.playAll')}</span>
                          </button>
                          <button class="icon-btn" onclick={() => { removePlaylist(pl.id); playlists = listPlaylists(); }} title={t('video.deletePlaylist')}>
                            <Icon name="trash" size={13} />
                          </button>
                        </div>
                      </div>
                    </div>
                  {/each}
                </div>
              {/if}
            {/if}
          </div>

        <!-- TAB: CHAPTERS / SECTIONS -->
        {:else if sidebarTab === 'chapters'}
          <div class="tab-panel">
            <div class="panel-header">
              <span class="section-title" style="margin:0">{t('video.chapters')} ({chapters.length})</span>
            </div>
            {#if chaptersLoading}
              <div class="empty muted" style="margin-top:20px">{t('video.transcriptLoading')}</div>
            {:else if chapters.length === 0}
              <div class="empty muted" style="margin-top:20px">{t('video.noChapters')}</div>
            {:else}
              <div class="sidebar-bm-list">
                {#each chapters as ch, idx (idx)}
                  <div class="bm-row chapter-row {current >= ch.start && (!ch.end || current < ch.end) ? 'active' : ''}">
                    <button class="bm-jump" onclick={() => seekTo(ch.start)} title={ch.title}>
                      <span class="chapter-idx">{idx + 1}</span>
                      <span class="mono">{formatTimecode(ch.start)}</span>
                      <span class="bm-note chapter-title" dir="auto">{ch.title}</span>
                    </button>
                  </div>
                {/each}
              </div>
            {/if}
          </div>

        <!-- TAB 2: BOOKMARKS -->
        {:else if sidebarTab === 'bookmarks'}
          <div class="tab-panel">
            <div class="panel-header">
              <span class="section-title" style="margin:0">{t('video.drawerBookmarks')} ({bookmarks.length})</span>
            </div>
            <div class="hstack" style="margin-top:8px">
              <input type="text" placeholder={t('video.bookmarkNote')} bind:value={noteDraft}
                onkeydown={(e) => e.key === 'Enter' && addBookmark()} style="flex:1" />
              <button class="primary small" onclick={addBookmark}>
                <Icon name="bookmark" size={14} /><span>{t('video.addBookmark')}</span>
              </button>
            </div>
            {#if displayBookmarks.length === 0}
              <div class="empty muted" style="margin-top:20px">{t('video.noBookmarks')}</div>
            {:else}
              <div class="sidebar-bm-list">
                {#each displayBookmarks as b (b.id)}
                  {#if b.visible !== false}
                    <div class="bm-row {b.depth > 0 ? 'sub-bm' : ''}" style="margin-inline-start: {b.depth * 18}px">
                      {#if b.hasChildren}
                        <button class="bm-collapse-btn" onclick={() => toggleCollapseBookmark(b)}
                          title={b.collapsed ? (t('reader.expand') || 'توسيع') : (t('reader.collapse') || 'طي')}>
                          <Icon name={b.collapsed ? 'chevron-right' : 'chevron-down'} size={12} />
                        </button>
                      {/if}
                      <button class="bm-jump" onclick={() => seekTo(b.at)} title={b.note || formatTimecode(b.at)}>
                        <Icon name="clock" size={13} />
                        <span class="mono">{formatTimecode(b.at)}</span>
                        {#if b.note}<span class="bm-note" dir="auto">{b.note}</span>{/if}
                      </button>
                      <div class="bm-row-actions">
                        <button class="bm-action-btn" onclick={() => doIndentBookmark(b)}
                          title={t('reader.indentBookmark') || 'إزاحة للداخل (عنصر فرعي)'}>
                          <Icon name="indent" size={12} />
                        </button>
                        {#if b.depth > 0}
                          <button class="bm-action-btn" onclick={() => doOutdentBookmark(b)}
                            title={t('reader.outdentBookmark') || 'إزاحة للخارج'}>
                            <Icon name="outdent" size={12} />
                          </button>
                        {/if}
                        <button class="deck-action" onclick={() => removeBookmark(b)} title={t('common.remove')}>
                          <Icon name="x" size={13} />
                        </button>
                      </div>
                    </div>
                  {/if}
                {/each}
              </div>
            {/if}
          </div>

        <!-- TAB 3: SCREENSHOT CAPTURES GALLERY -->
        {:else if sidebarTab === 'captures'}
          <div class="tab-panel">
            <div class="panel-header hstack" style="justify-content:space-between">
              <span class="section-title" style="margin:0">{t('video.drawerCaptures')} ({videoCaptures.length})</span>
              <button class="primary small" onclick={triggerScreenshotAnnotation} title={t('video.captureFrame')}>
                <Icon name="camera" size={14} /><span>{t('video.captureFrame')}</span>
              </button>
            </div>
            {#if videoCaptures.length === 0}
              <div class="empty muted" style="margin-top:20px">{t('gallery.empty')}</div>
            {:else}
              <div class="captures-gallery-grid">
                {#each videoCaptures as cap (cap.id)}
                  <div class="cap-card">
                    <img src={cap.image} alt={cap.title} class="cap-img" />
                    <div class="cap-footer hstack" style="justify-content:space-between">
                      <span class="mono text-xs">{formatTimecode(cap.seconds)}</span>
                      <div class="hstack" style="gap:4px">
                        <button class="icon-btn" onclick={() => insertScreenshotIntoEditor(cap.image)} title={t('video.insertScreenshot')}>
                          <Icon name="file-text" size={13} />
                        </button>
                        <button class="deck-action" onclick={() => onDeleteCapture?.(cap.id)} title={t('common.delete')}>
                          <Icon name="trash" size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </div>

        <!-- TAB 4: TRANSCRIPT & SUBTITLES -->
        {:else if sidebarTab === 'transcript'}
          <div class="tab-panel">
            <div class="panel-header hstack" style="justify-content:space-between">
              <span class="section-title" style="margin:0">{t('video.drawerSubtitles')}</span>
              <div class="hstack" style="gap:6px">
                {#if transcript}
                  <button class="small" onclick={exportTranscriptTxt} title={t('video.downloadTxt')}>
                    <Icon name="download" size={13} /><span>TXT</span>
                  </button>
                  <button class="small" onclick={exportTranscriptPdf} title={t('video.exportPdf')}>
                    <Icon name="scroll" size={13} /><span>PDF</span>
                  </button>
                {/if}
              </div>
            </div>

            {#if transcriptTracks.length > 1}
              <label class="transcript-lang" style="margin-top:8px; display:block">
                <select value={transcriptLang} onchange={changeTranscriptLang} disabled={transcriptLoading}>
                  {#each transcriptTracks as track (track.languageCode)}
                    <option value={track.languageCode}>{track.label}{track.kind === 'asr' ? ` · ${t('video.transcriptAuto')}` : ''}</option>
                  {/each}
                </select>
              </label>
            {/if}

            {#if transcriptLoading}
              <div class="transcript-state">{t('video.transcriptLoading')}</div>
            {:else if transcriptError}
              <div class="transcript-state error" role="alert">
                <Icon name="alert" size={14} />
                <span class="grow">{transcriptError}</span>
                <button class="small" onclick={() => loadTranscript(transcriptLang)}>{t('video.transcriptRetry')}</button>
              </div>
            {:else if !transcript}
              <div class="transcript-state">
                <span class="grow">{t('video.transcriptHint')}</span>
                <button class="primary small" onclick={() => loadTranscript(transcriptLang)}>
                  <Icon name="scroll" size={13} /><span>{t('video.loadTranscript')}</span>
                </button>
              </div>
            {:else}
              <div class="transcript-list" use:autoScrollbar>
                {#each transcript.cues as cue, i (i)}
                  <button class="cue {i === activeCueIndex ? 'active' : ''}" onclick={() => seekTo(cue.start)}>
                    <span class="cue-time">{formatTimecode(cue.start)}</span>
                    <span class="cue-text" dir="auto">{cue.text}</span>
                  </button>
                {/each}
              </div>
            {/if}
          </div>

        <!-- TAB 5: STUDY NOTES EDITOR (Word-like side editor) -->
        {:else if sidebarTab === 'editor'}
          <div class="tab-panel editor-panel">
            <div class="panel-header hstack" style="justify-content:space-between">
              <span class="section-title" style="margin:0">{t('video.drawerEditor')}</span>
              <div class="hstack" style="gap:6px">
                <button class="small" onclick={exportEditorWord} disabled={!videoNotes.length} title="Export to Word (.docx)">
                  <Icon name="download" size={13} /><span>Word</span>
                </button>
                <button class="small" onclick={exportEditorPdf} disabled={!videoNotes.length} title="Export to PDF">
                  <Icon name="file-text" size={13} /><span>PDF</span>
                </button>
              </div>
            </div>

            <!-- Quick Action Buttons: Insert Active Subtitle or Current Screenshot -->
            <div class="editor-quick-row hstack" style="gap:6px; margin-top:8px;">
              <button class="small" onclick={() => insertScreenshotIntoEditor()} title={t('video.insertScreenshot')}>
                <Icon name="camera" size={13} /><span>{t('video.insertScreenshot')}</span>
              </button>
              <button class="small" onclick={insertSubtitleIntoEditor} title={t('video.insertSubtitle')}>
                <Icon name="scroll" size={13} /><span>{t('video.insertSubtitle')}</span>
              </button>
              <button class="small" onclick={() => (editorDir = editorDir === 'rtl' ? 'ltr' : 'rtl')} title="Toggle RTL/LTR">
                <Icon name="arrow-left-right" size={13} /><span>{editorDir.toUpperCase()}</span>
              </button>
            </div>

            <!-- Note Composition Input Box -->
            <div class="editor-input-box" style="margin-top:10px;">
              <div class="editor-tools-row hstack" style="gap:6px; margin-bottom:6px;">
                <select bind:value={editorHeading} class="heading-select">
                  <option value="p">Paragraph</option>
                  <option value="h1">Heading 1</option>
                  <option value="h2">Heading 2</option>
                  <option value="h3">Heading 3</option>
                </select>
                <button class="primary small grow" onclick={addEditorNote} disabled={!editorNoteText.trim()}>
                  <Icon name="plus" size={13} /><span>{t('common.add')}</span>
                </button>
              </div>
              <textarea
                class="editor-textarea"
                dir={editorDir}
                placeholder="Type your study notes here..."
                bind:value={editorNoteText}
                onkeydown={(e) => e.key === 'Enter' && e.ctrlKey && addEditorNote()}
              ></textarea>
            </div>

            <!-- Committed Document Notes Sequence -->
            <div class="editor-notes-list" use:autoScrollbar>
              {#if videoNotes.length === 0}
                <div class="empty muted" style="margin-top:20px; font-size:12px">No notes yet. Add headings, text, screenshots or subtitles to build your study document.</div>
              {:else}
                {#each videoNotes as note (note.id)}
                  <div class="note-block" class:is-heading={note.type === 'heading'} class:is-quote={note.type === 'quote'}>
                    <div class="note-block-body">
                      {#if note.type === 'heading'}
                        <h4 class="note-h{note.level || 2}" dir={note.isRtl ? 'rtl' : 'ltr'}>{note.text}</h4>
                      {:else if note.type === 'image'}
                        <img src={note.image} alt="Screenshot note" class="note-embedded-img" />
                        {#if note.text}<div class="note-caption muted">{note.text}</div>{/if}
                      {:else if note.type === 'quote'}
                        <blockquote class="note-quote" dir="auto">{note.text}</blockquote>
                      {:else}
                        <p class="note-p" dir={note.isRtl ? 'rtl' : 'ltr'}>{note.text}</p>
                      {/if}
                    </div>
                    <button class="deck-action note-del" onclick={() => removeEditorNote(note.id)} title={t('common.delete')}>
                      <Icon name="trash" size={12} />
                    </button>
                  </div>
                {/each}
              {/if}
            </div>
          </div>
        {/if}

      </div>
    </aside>
  {/if}

  <!-- In-Place Screenshot Markup & Annotation Modal Overlay (Rendered inside workspaceEl so it works in Fullscreen!) -->
  {#if annotatingCapture}
    <VideoAnnotationModal
      imageSrc={annotatingCapture.image}
      timecode={formatTimecode(annotatingCapture.seconds)}
      onSave={handleSaveAnnotated}
      onCancel={handleCancelAnnotated}
    />
  {/if}

</div>

<style>
  .video-workspace {
    position: relative;
    display: flex;
    flex-direction: row !important;
    direction: ltr !important;
    align-items: stretch;
    width: 100%;
    min-height: calc(100vh - 120px);
    overflow: hidden;
  }

  .video-stage {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    transition: flex 0.2s ease;
  }

  /* Player Card */
  .player-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    flex: 1;
  }
  .player-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
  }
  .ph-title {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .video-frame {
    position: relative;
    background: #000;
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .video-frame video {
    display: block;
    width: 100%;
    max-height: 60vh;
    object-fit: contain;
  }

  /* Audio-only screen off cover */
  .audio-only-cover {
    position: absolute;
    inset: 0;
    z-index: 5;
    background: radial-gradient(circle at center, #1e1b4b 0%, #09090b 100%);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    padding: 24px;
    text-align: center;
  }
  .audio-waves {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 48px;
  }
  .w-bar {
    width: 6px;
    background: #6366f1;
    border-radius: 999px;
    animation: wave 1.2s ease-in-out infinite alternate;
  }
  .w-bar.b1 { height: 16px; animation-delay: 0.1s; }
  .w-bar.b2 { height: 36px; animation-delay: 0.3s; }
  .w-bar.b3 { height: 48px; animation-delay: 0.5s; }
  .w-bar.b4 { height: 28px; animation-delay: 0.2s; }
  .w-bar.b5 { height: 14px; animation-delay: 0.4s; }
  @keyframes wave {
    0% { transform: scaleY(0.4); opacity: 0.6; }
    100% { transform: scaleY(1.1); opacity: 1; }
  }
  .audio-title {
    font-size: 18px;
    font-weight: 600;
    color: #f8fafc;
    max-width: 80%;
  }
  .audio-hint {
    font-size: 13px;
    color: #94a3b8;
  }
  .audio-black-cover {
    position: absolute;
    inset: 0;
    z-index: 5;
    background: #000000;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    user-select: none;
  }
  .audio-black-indicator {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    color: #64748b;
    text-align: center;
    max-width: 80%;
  }
  .audio-black-title {
    font-size: 15px;
    font-weight: 500;
    color: #cbd5e1;
  }
  .audio-black-hint {
    font-size: 12px;
    color: #64748b;
  }
  .w-bar.b6 { height: 42px; animation-delay: 0.15s; }
  .w-bar.b7 { height: 20px; animation-delay: 0.35s; }
  .chapter-row.active {
    border-color: var(--primary, #3b82f6);
    background: var(--surface-hover, rgba(59, 130, 246, 0.12));
  }
  .chapter-idx {
    font-size: 11px;
    font-weight: 700;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--surface-raised, rgba(255, 255, 255, 0.1));
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted, #94a3b8);
    flex-shrink: 0;
  }
  .chapter-row.active .chapter-idx {
    background: var(--primary, #3b82f6);
    color: #fff;
  }
  .chapter-title {
    font-size: 13px;
    line-height: 1.4;
    word-break: break-word;
    text-align: start;
  }

  /* Chapters List */
  .chapters-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 0;
  }
  .chapter-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    background: var(--surface-2, rgba(0, 0, 0, 0.03));
    border: 1px solid var(--border);
    border-radius: var(--radius-sm, 6px);
    cursor: pointer;
    text-align: right;
    transition: background 0.15s ease, border-color 0.15s ease;
  }
  .chapter-row:hover {
    background: var(--surface-3, rgba(0, 0, 0, 0.06));
    border-color: var(--primary);
  }
  .chapter-row.active {
    background: rgba(99, 102, 241, 0.12);
    border-color: var(--primary);
  }
  .ch-time {
    font-family: monospace;
    font-size: 12px;
    font-weight: 600;
    color: var(--primary);
    background: rgba(99, 102, 241, 0.1);
    padding: 2px 6px;
    border-radius: 4px;
    flex-shrink: 0;
  }
  .ch-title {
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
  }
  .yt-shield {
    position: absolute;
    inset: 0;
    z-index: 2;
    width: 100%;
    height: 100%;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
  }
  .yt-shield:focus, .yt-shield:focus-visible { outline: none; }
  .yt-loading { z-index: 4; }
  .yt-error {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    min-height: 260px;
    padding: 40px 20px;
    text-align: center;
  }

  /* Controls */
  .controls {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 12px 10px;
    border-top: 1px solid var(--border);
  }
  .timeline-row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
  }
  .scrub {
    flex: 1;
    width: 100%;
    min-width: 0;
    height: 22px;
    accent-color: var(--accent);
    cursor: pointer;
  }
  .timecode {
    flex: none;
    min-width: 92px;
    text-align: end;
    font-variant-numeric: tabular-nums;
    font-size: 12px;
    color: var(--muted);
  }
  .control-row {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .control-row button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .control-row .tool-group {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
    flex-wrap: wrap;
  }
  .control-row .tool-group button.active {
    border-color: var(--accent);
    color: var(--accent);
    background: var(--accent-soft);
  }
  .speed select, .quality select { padding: 4px 6px; }
  .quality select { max-width: 96px; }

  /* Resizer Splitter */
  .sidebar-resizer {
    flex: none;
    width: 10px;
    cursor: col-resize;
    display: flex;
    align-items: center;
    justify-content: center;
    user-select: none;
    touch-action: none;
    background: transparent;
    z-index: 15;
  }
  .resizer-bar {
    width: 3px;
    height: 48px;
    border-radius: 99px;
    background: var(--border);
    transition: background 0.2s;
  }
  .sidebar-resizer:hover .resizer-bar {
    background: var(--accent);
  }

  /* 5-Tab Sidebar */
  .video-sidebar {
    direction: rtl;
    flex: none;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: var(--shadow);
    z-index: 10;
  }
  .sidebar-tabs-bar {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 6px;
    background: var(--surface-2, rgba(0, 0, 0, 0.04));
    border-bottom: 1px solid var(--border);
    overflow-x: auto;
    overflow-y: hidden;
    white-space: nowrap;
    scrollbar-width: thin;
  }
  .sidebar-tabs-bar button {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 6px 10px;
    font-size: 11.5px;
    font-weight: 500;
    border-radius: 6px;
    border: 1px solid transparent;
    cursor: pointer;
    white-space: nowrap;
    background: transparent;
    color: var(--text);
  }
  .sidebar-tabs-bar button:hover {
    background: var(--surface);
  }
  .sidebar-tabs-bar button.active {
    background: var(--surface);
    border-color: var(--border);
    color: var(--accent);
    box-shadow: 0 1px 3px rgba(0,0,0,0.06);
  }
  .tab-badge {
    background: var(--accent);
    color: #fff;
    border-radius: 99px;
    font-size: 9.5px;
    padding: 0 4px;
    font-weight: 700;
  }

  .sidebar-body {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
  }
  .tab-panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  /* Fullscreen Workspace Styles */
  .video-workspace.is-fullscreen {
    position: fixed;
    inset: 0;
    z-index: 99999;
    width: 100vw;
    height: 100vh;
    max-width: 100vw;
    max-height: 100vh;
    background: #000;
    direction: ltr !important;
  }
  .video-workspace.is-fullscreen .player-card {
    border: 0;
    border-radius: 0;
    background: #000;
    box-shadow: none;
    height: 100%;
  }
  .video-workspace.is-fullscreen .player-head {
    display: none;
  }
  .video-workspace.is-fullscreen .video-frame {
    flex: 1;
    height: 100%;
    width: 100%;
  }
  .video-workspace.is-fullscreen .video-frame video,
  .video-workspace.is-fullscreen .yt-host {
    width: 100%;
    height: 100%;
    max-height: 100% !important;
    max-width: 100% !important;
  }

  .video-workspace.is-fullscreen .fullscreen-subtitles-area {
    flex: 1;
    height: 25vh;
    min-height: 120px;
    background: #090d16;
    border-top: 1px solid #1e293b;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px 28px 75px;
    text-align: center;
  }
  .fs-active-sentence {
    cursor: pointer;
    max-width: 960px;
  }
  .fs-cue-time {
    font-size: 13px;
    color: #94a3b8;
    margin-right: 8px;
    font-family: monospace;
  }
  .fs-cue-text {
    font-size: 23px;
    font-weight: 700;
    line-height: 1.6;
    color: #fde047;
    text-shadow: 0 2px 10px rgba(0,0,0,0.8);
  }
  .fs-cue-muted {
    font-size: 14px;
    color: #64748b;
  }

  /* Fullscreen single-line bottom dock auto-hides after 3 seconds */
  .video-workspace.is-fullscreen .controls {
    position: absolute;
    bottom: 0;
    inset-inline: 0;
    z-index: 30;
    background: linear-gradient(transparent, rgba(0, 0, 0, 0.88) 45%, rgba(0, 0, 0, 0.98));
    border-top: none;
    padding: 14px 20px 18px;
    color: #fff;
    transition: opacity 0.35s cubic-bezier(0.16, 1, 0.3, 1), transform 0.35s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .video-workspace.is-fullscreen .controls button {
    color: #fff;
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.2);
  }
  .video-workspace.is-fullscreen .controls button:hover {
    background: rgba(255, 255, 255, 0.25);
  }
  .video-workspace.is-fullscreen .controls button.active {
    background: var(--accent);
    border-color: var(--accent);
  }
  .video-workspace.is-fullscreen .controls select {
    background: rgba(255, 255, 255, 0.12);
    color: #fff;
    border-color: rgba(255, 255, 255, 0.2);
  }
  .video-workspace.is-fullscreen .controls select option {
    background: #222;
    color: #fff;
  }
  .video-workspace.is-fullscreen .timecode {
    color: rgba(255, 255, 255, 0.7);
  }
  .video-workspace.is-fullscreen.idle .controls {
    opacity: 0;
    transform: translateY(100%);
    pointer-events: none;
  }

  /* Fullscreen Sidebar Styling: Sits beside the video stage gracefully */
  .video-workspace.is-fullscreen .video-sidebar {
    border-radius: 0;
    border-top: none;
    border-bottom: none;
    border-inline-end: none;
    background: var(--surface);
    height: 100vh;
  }
  .video-workspace.is-fullscreen .sidebar-resizer {
    background: rgba(255, 255, 255, 0.08);
  }

  /* Sidebar Subcards & Add Sections */
  .toggle-add-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 100%;
    padding: 6px 10px;
    border-radius: 6px;
    border: 1px dashed var(--border);
    background: var(--surface-soft, rgba(0, 0, 0, 0.02));
    color: var(--text);
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
  }
  .toggle-add-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .add-subcard {
    margin-top: 6px;
    padding: 8px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
  }
  .yt-add { display: flex; gap: 6px; width: 100%; }
  .yt-add input { flex: 1; min-width: 0; width: 100%; padding: 4px 8px; font-size: 12px; }

  .sidebar-video-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 8px;
  }
  .video-row {
    display: flex;
    align-items: center;
    gap: 4px;
    border-radius: 6px;
    border: 1px solid transparent;
  }
  .video-row.active {
    background: var(--accent-soft);
    border-color: var(--accent);
  }
  .video-click {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
    padding: 6px 8px;
    border: none;
    background: transparent;
    cursor: pointer;
  }
  .vrow-title {
    font-weight: 600;
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .vrow-meta {
    font-size: 10.5px;
    margin-top: 2px;
  }

  .sidebar-bm-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 8px;
  }
  .bm-row {
    display: flex;
    gap: 4px;
    align-items: center;
    position: relative;
    transition: margin-inline-start 0.15s ease;
  }
  .bm-row.sub-bm {
    border-inline-start: 2px solid var(--border);
    padding-inline-start: 6px;
  }
  .bm-collapse-btn {
    width: 22px;
    height: 22px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--muted);
    flex-shrink: 0;
  }
  .bm-collapse-btn:hover {
    color: var(--text);
  }
  .bm-row-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }
  .bm-action-btn {
    width: 24px;
    height: 24px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm, 4px);
    cursor: pointer;
    color: var(--muted);
  }
  .bm-action-btn:hover {
    color: var(--text);
    background: var(--surface-hover, rgba(255, 255, 255, 0.08));
    border-color: var(--border);
  }
  .bm-jump {
    display: flex;
    gap: 8px;
    align-items: center;
    flex: 1;
    min-width: 0;
    text-align: start;
    padding: 6px 8px;
  }
  .bm-note {
    color: var(--muted);
    font-size: 11.5px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mono {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }

  /* Captures Gallery */
  .captures-gallery-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    gap: 8px;
    margin-top: 8px;
  }
  .cap-card {
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
    background: var(--bg);
  }
  .cap-img {
    width: 100%;
    aspect-ratio: 16 / 9;
    object-fit: cover;
    display: block;
  }
  .cap-footer {
    padding: 4px 6px;
    border-top: 1px solid var(--border);
    background: var(--surface);
  }

  /* Transcript List */
  .transcript-list {
    max-height: 48vh;
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    margin-top: 8px;
  }
  .cue {
    display: flex;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    border: 0;
    border-bottom: 1px solid var(--border);
    background: transparent;
    text-align: start;
    cursor: pointer;
    font-size: 12px;
  }
  .cue:last-child { border-bottom: 0; }
  .cue:hover { background: var(--accent-soft); }
  .cue.active {
    background: var(--accent-soft);
    border-inline-start: 3px solid var(--accent);
    font-weight: 600;
  }
  .cue-time {
    flex: none;
    min-width: 42px;
    color: var(--muted);
    font-size: 10.5px;
    font-family: monospace;
  }
  .cue-text {
    flex: 1;
    min-width: 0;
    line-height: 1.45;
  }
  .transcript-state {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border: 1px dashed var(--border);
    border-radius: 8px;
    color: var(--muted);
    font-size: 11.5px;
    margin-top: 8px;
  }
  .transcript-state.error {
    color: var(--danger, #ef4444);
    border-color: var(--danger, #ef4444);
  }

  /* Study Notes Editor */
  .editor-textarea {
    width: 100%;
    min-height: 70px;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 12.5px;
    font-family: inherit;
    resize: vertical;
    background: var(--bg);
    color: var(--text);
  }
  .heading-select {
    padding: 3px 6px;
    font-size: 11.5px;
  }
  .editor-notes-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 10px;
    max-height: 42vh;
    overflow-y: auto;
  }
  .note-block {
    position: relative;
    padding: 8px 10px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
  }
  .note-block.is-heading {
    background: var(--surface);
    border-inline-start: 3px solid var(--accent);
  }
  .note-block.is-quote {
    background: var(--surface-soft, rgba(0,0,0,0.02));
    border-inline-start: 3px solid #f59e0b;
  }
  .note-h1 { font-size: 16px; font-weight: 700; margin: 0; }
  .note-h2 { font-size: 14.5px; font-weight: 700; margin: 0; }
  .note-h3 { font-size: 13px; font-weight: 600; margin: 0; }
  .note-p { font-size: 12.5px; line-height: 1.5; margin: 0; white-space: pre-wrap; }
  .note-quote { margin: 0; font-style: italic; font-size: 12px; color: var(--text); }
  .note-embedded-img { width: 100%; border-radius: 4px; display: block; margin-bottom: 4px; }
  .note-caption { font-size: 10.5px; }
  .note-del {
    position: absolute;
    top: 4px;
    right: 4px;
    opacity: 0.7;
  }
  .note-del:hover { opacity: 1; }

  .fs-badge {
    background: var(--accent);
    color: #fff;
    border-radius: 99px;
    font-size: 10px;
    padding: 1px 5px;
    font-weight: 700;
    margin-left: 2px;
  }
</style>
