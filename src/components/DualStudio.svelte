<script>
  // Dual Studio: Simultaneous Video/Playlist and PDF study with rich notes (plan Phase 4).
  // Features:
  //   - Split pane workspace (side-by-side or stacked).
  //   - Synchronized study from both video and PDF.
  //   - One-click snapshot capture from video frame and PDF page.
  //   - Structured notes stream with headings H1 through H6, RTL Arabic/English support.
  //   - Direct export to Microsoft Word (.docx) and PDF.
  //   - In-app session saving.

  import { onMount, tick } from 'svelte';
  import Icon from './Icon.svelte';
  import { t } from '../lib/lang.svelte.js';
  import { loadDocument, renderPageToCanvas } from '../lib/pdf.js';
  import { readPdfBytes } from '../lib/storage.js';
  import { parseYouTube } from '../lib/youtube.js';
  import { notesToDocx } from '../lib/docxExport.js';
  import { notesToPdf } from '../lib/studioPdfExport.js';
  import { deliverBytes } from '../lib/export.js';
  import { formatTimecode } from '../lib/media.js';

  let {
    docs = [],
    initialDoc = null,
    initialVideo = null,
    bridge = null,
    notify = () => {}
  } = $props();

  const tr = (k, p) => t(k, p);

  // --- Panes & Layout ---
  let splitLayout = $state('horizontal'); // 'horizontal' | 'vertical'
  let notesOpen = $state(true);

  // --- Document Selection ---
  const pdfDocs = $derived((docs || []).filter((d) => !d.kind || d.kind === 'pdf'));
  const videoDocs = $derived((docs || []).filter((d) => d.kind === 'video'));

  let selectedPdfId = $state('');
  let selectedVideoId = $state('');

  $effect(() => {
    if (!selectedPdfId && initialDoc?.id) selectedPdfId = initialDoc.id;
  });
  $effect(() => {
    if (!selectedVideoId && initialVideo?.id) selectedVideoId = initialVideo.id;
  });

  const activePdf = $derived(pdfDocs.find((d) => d.id === selectedPdfId) || pdfDocs[0] || null);
  const activeVideo = $derived(videoDocs.find((d) => d.id === selectedVideoId) || videoDocs[0] || null);

  // --- Video State ---
  let videoEl = $state(null);
  let videoCurrentTime = $state(0);
  let videoDuration = $state(0);
  let isVideoPlaying = $state(false);

  const youtubeInfo = $derived(activeVideo ? parseYouTube(activeVideo.url || activeVideo.path || activeVideo.id || '') : null);

  // --- PDF Viewer State ---
  let pdfCanvas = $state(null);
  let pdfDocProxy = $state(null);
  let pdfPageNum = $state(1);
  let pdfTotalPages = $state(1);
  let pdfZoom = $state(1.0);
  let isPdfLoading = $state(false);

  // --- Studio Notes Stream ---
  let sessionTitle = $state('Study Session');
  let notes = $state([]);
  let nextNoteText = $state('');
  let nextNoteHeading = $state('p');

  const STORAGE_KEY = 'studyos.dual_studio.session';

  onMount(() => {
    loadSavedSession();
  });

  $effect(() => {
    if (activePdf) {
      loadPdf(activePdf);
    }
  });

  $effect(() => {
    if (pdfDocProxy && pdfPageNum) {
      renderCurrentPdfPage();
    }
  });

  async function loadPdf(doc) {
    if (!doc) return;
    isPdfLoading = true;
    try {
      let bytes = null;
      try { bytes = await readPdfBytes(doc.id); } catch {}
      if (!bytes && doc.dataUrl) {
        const m = doc.dataUrl.match(/^data:application\/pdf;base64,(.+)$/);
        if (m) {
          const bin = atob(m[1]);
          const arr = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          bytes = arr;
        }
      }
      if (!bytes) return;
      pdfDocProxy = await loadDocument(bytes);
      pdfTotalPages = pdfDocProxy.numPages;
      pdfPageNum = Math.min(Math.max(1, doc.lastPage || 1), pdfTotalPages);
      await tick();
      await renderCurrentPdfPage();
    } catch (e) {
      console.warn('Could not load PDF in Dual Studio:', e);
    } finally {
      isPdfLoading = false;
    }
  }

  async function renderCurrentPdfPage() {
    if (!pdfDocProxy || !pdfCanvas) return;
    try {
      const page = await pdfDocProxy.getPage(pdfPageNum);
      await renderPageToCanvas(page, { scale: pdfZoom, rotation: 0, canvas: pdfCanvas });
    } catch (e) {
      if (e?.name !== 'RenderingCancelledException') {
        console.warn('Dual Studio PDF render error:', e);
      }
    }
  }

  function prevPdfPage() {
    if (pdfPageNum > 1) pdfPageNum--;
  }

  function nextPdfPage() {
    if (pdfPageNum < pdfTotalPages) pdfPageNum++;
  }

  // --- Capture Actions ---
  function captureVideoFrame() {
    let capturedDataUrl = null;
    let detail = '';

    if (videoEl && !youtubeInfo) {
      try {
        const c = document.createElement('canvas');
        c.width = videoEl.videoWidth || 640;
        c.height = videoEl.videoHeight || 360;
        const ctx = c.getContext('2d');
        ctx.drawImage(videoEl, 0, 0, c.width, c.height);
        capturedDataUrl = c.toDataURL('image/png');
        detail = formatTimecode(videoEl.currentTime || 0);
      } catch (e) {
        console.warn('HTML5 Video capture cross-origin or buffer issue:', e);
      }
    }

    if (!capturedDataUrl && youtubeInfo?.id) {
      capturedDataUrl = `https://img.youtube.com/vi/${youtubeInfo.id}/hqdefault.jpg`;
      detail = formatTimecode(videoCurrentTime || 0);
    }

    const newNote = {
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      source: 'video',
      sourceDetail: detail,
      image: capturedDataUrl,
      heading: 'p',
      text: '',
      createdAt: Date.now()
    };

    notes = [...notes, newNote];
    notesOpen = true;
    notify(tr('studio.captureVideo'), 'ok');
  }

  function capturePdfPage() {
    if (!pdfCanvas) return;
    try {
      const capturedDataUrl = pdfCanvas.toDataURL('image/png');
      const newNote = {
        id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
        source: 'pdf',
        sourceDetail: `Page ${pdfPageNum}`,
        image: capturedDataUrl,
        heading: 'p',
        text: '',
        createdAt: Date.now()
      };

      notes = [...notes, newNote];
      notesOpen = true;
      notify(tr('studio.capturePdf'), 'ok');
    } catch (e) {
      console.warn('PDF canvas capture error:', e);
    }
  }

  function addTextNote() {
    const text = nextNoteText.trim();
    if (!text) return;
    const newNote = {
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      source: 'note',
      sourceDetail: '',
      image: null,
      heading: nextNoteHeading,
      text,
      createdAt: Date.now()
    };

    notes = [...notes, newNote];
    nextNoteText = '';
    notify(tr('studio.savedInApp'), 'ok');
  }

  function deleteNote(id) {
    notes = notes.filter((n) => n.id !== id);
  }

  function moveNote(index, direction) {
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= notes.length) return;
    const copy = [...notes];
    const temp = copy[index];
    copy[index] = copy[targetIdx];
    copy[targetIdx] = temp;
    notes = copy;
  }

  // --- Export Actions ---
  async function exportToWord() {
    try {
      const bytes = notesToDocx(notes, { title: sessionTitle });
      const filename = `${sessionTitle.replace(/[^a-zA-Z0-9_\-\u0600-\u06FF]/g, '_')}.docx`;
      await deliverBytes(bytes, filename, bridge, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      notify(tr('studio.exportSuccess'), 'ok');
    } catch (e) {
      console.error('Word export error:', e);
      notify(e.message, 'err');
    }
  }

  async function exportToPdfDoc() {
    try {
      const bytes = await notesToPdf(notes, { title: sessionTitle });
      const filename = `${sessionTitle.replace(/[^a-zA-Z0-9_\-\u0600-\u06FF]/g, '_')}.pdf`;
      await deliverBytes(bytes, filename, bridge, 'application/pdf');
      notify(tr('studio.exportSuccess'), 'ok');
    } catch (e) {
      console.error('PDF export error:', e);
      notify(e.message, 'err');
    }
  }

  // --- Session Storage ---
  function saveSession() {
    const session = {
      title: sessionTitle,
      pdfId: selectedPdfId,
      videoId: selectedVideoId,
      notes,
      savedAt: Date.now()
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
      notify(tr('studio.savedInApp'), 'ok');
    } catch (e) {
      console.warn('Storage save failed:', e);
    }
  }

  function loadSavedSession() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s.title) sessionTitle = s.title;
      if (s.pdfId) selectedPdfId = s.pdfId;
      if (s.videoId) selectedVideoId = s.videoId;
      if (Array.isArray(s.notes)) notes = s.notes;
    } catch {}
  }

  function getSourceIcon(source) {
    if (source === 'video') return 'video';
    if (source === 'pdf') return 'reader';
    return 'file-text';
  }
</script>

<div class="dual-studio">
  <!-- Top Studio Control Bar -->
  <header class="studio-topbar">
    <div class="studio-title-group">
      <Icon name="dualStudio" size={20} />
      <input
        type="text"
        class="session-title-input"
        bind:value={sessionTitle}
        placeholder={tr('studio.title')}
      />
    </div>

    <!-- Document Pickers -->
    <div class="studio-pickers">
      <div class="picker-group">
        <Icon name="video" size={16} />
        <select bind:value={selectedVideoId} class="studio-select" title={tr('studio.selectVideo')}>
          {#if videoDocs.length === 0}
            <option value="">{tr('studio.noVideo')}</option>
          {/if}
          {#each videoDocs as v (v.id)}
            <option value={v.id}>{v.title || v.name || 'Video'}</option>
          {/each}
        </select>
      </div>

      <div class="picker-group">
        <Icon name="reader" size={16} />
        <select bind:value={selectedPdfId} class="studio-select" title={tr('studio.selectPdf')}>
          {#if pdfDocs.length === 0}
            <option value="">{tr('studio.noPdf')}</option>
          {/if}
          {#each pdfDocs as p (p.id)}
            <option value={p.id}>{p.title || p.name || 'PDF'}</option>
          {/each}
        </select>
      </div>
    </div>

    <!-- Studio Actions -->
    <div class="studio-actions">
      <!-- Layout Toggle -->
      <button
        class="studio-btn"
        onclick={() => splitLayout = splitLayout === 'horizontal' ? 'vertical' : 'horizontal'}
        title="Toggle Split Layout"
      >
        <Icon name="columns" size={16} />
      </button>

      <!-- Notes Panel Toggle -->
      <button
        class="studio-btn {notesOpen ? 'active' : ''}"
        onclick={() => notesOpen = !notesOpen}
        title={tr('studio.notes')}
      >
        <Icon name="bookmark" size={16} />
        <span>{notes.length}</span>
      </button>

      <!-- Save Session -->
      <button class="studio-btn" onclick={saveSession} title={tr('studio.saveSession')}>
        <Icon name="check" size={16} />
        <span>{tr('common.save')}</span>
      </button>

      <!-- Export Word -->
      <button class="studio-btn primary" onclick={exportToWord} title={tr('studio.exportDocx')}>
        <Icon name="file-text" size={16} />
        <span>Word (.docx)</span>
      </button>

      <!-- Export PDF -->
      <button class="studio-btn primary" onclick={exportToPdfDoc} title={tr('studio.exportPdf')}>
        <Icon name="download" size={16} />
        <span>PDF</span>
      </button>
    </div>
  </header>

  <!-- Main Split Studio Workspace -->
  <div class="studio-workspace {splitLayout}">
    <!-- Video Half -->
    <section class="studio-pane video-pane">
      <div class="pane-header">
        <div class="pane-title">
          <Icon name="video" size={16} />
          <span>{activeVideo?.title || activeVideo?.name || tr('studio.noVideo')}</span>
        </div>
        <button class="capture-btn" onclick={captureVideoFrame} title={tr('studio.captureVideo')}>
          <Icon name="camera" size={15} />
          <span>{tr('studio.captureVideo')}</span>
        </button>
      </div>

      <div class="pane-content video-content">
        {#if youtubeInfo?.id}
          <iframe
            class="youtube-frame"
            src="https://www.youtube-nocookie.com/embed/{youtubeInfo.id}?enablejsapi=1&rel=0"
            title="YouTube Video"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowfullscreen
          ></iframe>
        {:else if activeVideo}
          <video
            bind:this={videoEl}
            src={activeVideo.url || activeVideo.path}
            controls
            class="native-video"
            ontimeupdate={() => videoCurrentTime = videoEl?.currentTime || 0}
          >
            <track kind="captions" />
          </video>
        {:else}
          <div class="pane-empty">
            <Icon name="video" size={36} />
            <p>{tr('studio.noVideo')}</p>
          </div>
        {/if}
      </div>
    </section>

    <!-- PDF Half -->
    <section class="studio-pane pdf-pane">
      <div class="pane-header">
        <div class="pane-title">
          <Icon name="reader" size={16} />
          <span>{activePdf?.title || activePdf?.name || tr('studio.noPdf')}</span>
        </div>

        <!-- PDF Nav Controls -->
        <div class="pdf-controls">
          <button class="icon-btn" onclick={prevPdfPage} disabled={pdfPageNum <= 1} title="Previous Page">
            <Icon name="chevron-left" size={14} />
          </button>
          <span class="pdf-page-indicator">{pdfPageNum} / {pdfTotalPages}</span>
          <button class="icon-btn" onclick={nextPdfPage} disabled={pdfPageNum >= pdfTotalPages} title="Next Page">
            <Icon name="chevron-right" size={14} />
          </button>

          <!-- Zoom -->
          <button class="icon-btn" onclick={() => { pdfZoom = Math.max(0.6, pdfZoom - 0.2); renderCurrentPdfPage(); }}>
            <Icon name="minus" size={13} />
          </button>
          <span class="pdf-zoom-val">{Math.round(pdfZoom * 100)}%</span>
          <button class="icon-btn" onclick={() => { pdfZoom = Math.min(2.5, pdfZoom + 0.2); renderCurrentPdfPage(); }}>
            <Icon name="plus" size={13} />
          </button>
        </div>

        <button class="capture-btn" onclick={capturePdfPage} title={tr('studio.capturePdf')}>
          <Icon name="camera" size={15} />
          <span>{tr('studio.capturePdf')}</span>
        </button>
      </div>

      <div class="pane-content pdf-content">
        {#if activePdf}
          <div class="pdf-canvas-wrap">
            <canvas bind:this={pdfCanvas} class="pdf-stage-canvas"></canvas>
          </div>
        {:else}
          <div class="pane-empty">
            <Icon name="reader" size={36} />
            <p>{tr('studio.noPdf')}</p>
          </div>
        {/if}
      </div>
    </section>

    <!-- Studio Notes Drawer / Side Stream -->
    {#if notesOpen}
      <aside class="studio-notes-sidebar">
        <div class="notes-header">
          <div class="notes-header-title">
            <Icon name="file-text" size={16} />
            <h3>{tr('studio.notes')}</h3>
          </div>
          <button class="icon-btn" onclick={() => notesOpen = false} title="Close Notes">
            <Icon name="x" size={14} />
          </button>
        </div>

        <!-- Fast Text Note Creator -->
        <div class="note-creator">
          <div class="creator-row">
            <select bind:value={nextNoteHeading} class="heading-select" title={tr('studio.heading')}>
              <option value="p">{tr('studio.paragraph')}</option>
              <option value="h1">{tr('studio.h1')}</option>
              <option value="h2">{tr('studio.h2')}</option>
              <option value="h3">{tr('studio.h3')}</option>
              <option value="h4">{tr('studio.h4')}</option>
              <option value="h5">{tr('studio.h5')}</option>
              <option value="h6">{tr('studio.h6')}</option>
            </select>
            <button class="add-note-btn" onclick={addTextNote} title={tr('studio.addNote')}>
              <Icon name="plus" size={14} />
              <span>{tr('studio.addNote')}</span>
            </button>
          </div>
          <textarea
            bind:value={nextNoteText}
            placeholder={tr('studio.notePlaceholder')}
            dir="auto"
            class="note-textarea"
            rows="2"
          ></textarea>
        </div>

        <!-- Notes & Captures Stream -->
        <div class="notes-stream">
          {#if notes.length === 0}
            <div class="notes-empty">
              <Icon name="camera" size={28} />
              <p>{tr('studio.noNotes')}</p>
            </div>
          {:else}
            {#each notes as note, idx (note.id)}
              <div class="note-card">
                <div class="note-card-bar">
                  <span class="source-tag {note.source}">
                    <Icon name={getSourceIcon(note.source)} size={12} />
                    <span>{note.source === 'video' ? tr('studio.sourceVideo') : note.source === 'pdf' ? tr('studio.sourcePdf') : 'Note'} {note.sourceDetail ? `(${note.sourceDetail})` : ''}</span>
                  </span>

                  <!-- Card Actions -->
                  <div class="card-actions">
                    <button class="icon-btn" onclick={() => moveNote(idx, -1)} disabled={idx === 0} title={tr('studio.moveUp')}>
                      <Icon name="chevron-up" size={12} />
                    </button>
                    <button class="icon-btn" onclick={() => moveNote(idx, 1)} disabled={idx === notes.length - 1} title={tr('studio.moveDown')}>
                      <Icon name="chevron-down" size={12} />
                    </button>
                    <button class="icon-btn del" onclick={() => deleteNote(note.id)} title={tr('studio.deleteItem')}>
                      <Icon name="trash" size={12} />
                    </button>
                  </div>
                </div>

                <!-- Captured Image Preview -->
                {#if note.image}
                  <div class="note-img-wrap">
                    <img src={note.image} alt="Study capture" class="note-img" />
                  </div>
                {/if}

                <!-- Heading Selector & Editable Text -->
                <div class="note-body">
                  <div class="heading-picker-row">
                    <select bind:value={note.heading} class="heading-select-mini">
                      <option value="p">{tr('studio.paragraph')}</option>
                      <option value="h1">{tr('studio.h1')}</option>
                      <option value="h2">{tr('studio.h2')}</option>
                      <option value="h3">{tr('studio.h3')}</option>
                      <option value="h4">{tr('studio.h4')}</option>
                      <option value="h5">{tr('studio.h5')}</option>
                      <option value="h6">{tr('studio.h6')}</option>
                    </select>
                  </div>

                  <textarea
                    bind:value={note.text}
                    placeholder={tr('studio.notePlaceholder')}
                    dir="auto"
                    class="note-edit-text {note.heading}"
                    rows="2"
                  ></textarea>
                </div>
              </div>
            {/each}
          {/if}
        </div>
      </aside>
    {/if}
  </div>
</div>

<style>
  .dual-studio {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    overflow: hidden;
    background: var(--bg);
    color: var(--text);
  }

  .studio-topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 16px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    gap: 12px;
    flex-wrap: wrap;
  }

  .studio-title-group {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .session-title-input {
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    font-size: 14px;
    font-weight: 600;
    color: inherit;
    padding: 4px 8px;
    min-width: 140px;
  }

  .session-title-input:hover,
  .session-title-input:focus {
    border-color: var(--border);
    background: var(--surface-2);
  }

  .studio-pickers {
    display: flex;
    align-items: center;
    gap: 12px;
    flex: 1;
    min-width: 260px;
  }

  .picker-group {
    display: flex;
    align-items: center;
    gap: 6px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 2px 8px;
    flex: 1;
  }

  .studio-select {
    background: transparent;
    border: none;
    color: inherit;
    font-size: 12px;
    width: 100%;
    outline: none;
    cursor: pointer;
  }

  .studio-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .studio-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    font-size: 12px;
    font-weight: 500;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: inherit;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }

  .studio-btn:hover {
    background: var(--surface-2);
  }

  .studio-btn.active {
    border-color: var(--accent);
    color: var(--accent);
    background: var(--accent-soft);
  }

  .studio-btn.primary {
    background: var(--accent);
    color: var(--accent-contrast, #fff);
    border-color: var(--accent);
  }

  .studio-btn.primary:hover {
    opacity: 0.9;
  }

  /* Workspace Layout */
  .studio-workspace {
    display: flex;
    flex: 1;
    height: calc(100% - 50px);
    overflow: hidden;
  }

  .studio-workspace.horizontal {
    flex-direction: row;
  }

  .studio-workspace.vertical {
    flex-direction: column;
  }

  .studio-pane {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    border-inline-end: 1px solid var(--border);
    background: var(--surface-2);
  }

  .studio-workspace.vertical .studio-pane {
    border-inline-end: none;
    border-bottom: 1px solid var(--border);
  }

  .pane-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    font-size: 13px;
  }

  .pane-title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 50%;
  }

  .capture-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    background: var(--accent-soft);
    border: 1px solid var(--accent);
    color: var(--accent);
    border-radius: 5px;
    padding: 4px 10px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
  }

  .capture-btn:hover {
    background: var(--accent);
    color: var(--accent-contrast, #fff);
  }

  .pane-content {
    flex: 1;
    overflow: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 12px;
  }

  .video-content {
    background: #000;
    padding: 0;
  }

  .youtube-frame {
    width: 100%;
    height: 100%;
    border: none;
  }

  .native-video {
    width: 100%;
    height: 100%;
    max-height: 100%;
  }

  .pdf-controls {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .pdf-page-indicator,
  .pdf-zoom-val {
    font-size: 11px;
    color: var(--muted);
  }

  .pdf-canvas-wrap {
    display: flex;
    justify-content: center;
    box-shadow: 0 4px 16px rgba(0,0,0,0.12);
    background: #fff;
    max-width: 100%;
  }

  .pdf-stage-canvas {
    display: block;
    max-width: 100%;
    height: auto;
  }

  .pane-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    color: var(--muted);
  }

  /* Sidebar Notes Stream */
  .studio-notes-sidebar {
    width: 360px;
    flex: none;
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border-inline-start: 1px solid var(--border);
    height: 100%;
  }

  .notes-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
  }

  .notes-header-title {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .notes-header h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
  }

  .note-creator {
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: var(--surface-2);
  }

  .creator-row {
    display: flex;
    justify-content: space-between;
    gap: 8px;
  }

  .heading-select,
  .heading-select-mini {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: inherit;
    font-size: 11px;
    padding: 2px 6px;
  }

  .add-note-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    font-size: 11px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: inherit;
    border-radius: 4px;
    cursor: pointer;
  }

  .add-note-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .note-textarea {
    width: 100%;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 6px 8px;
    color: inherit;
    font-size: 12px;
    resize: vertical;
    font-family: inherit;
  }

  .notes-stream {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .notes-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 180px;
    text-align: center;
    color: var(--muted);
    font-size: 12px;
  }

  .note-card {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .note-card-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }

  .source-tag {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    font-weight: 600;
    color: var(--muted);
  }

  .source-tag.video { color: #3b82f6; }
  .source-tag.pdf { color: #10b981; }

  .card-actions {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .icon-btn {
    background: transparent;
    border: none;
    color: var(--muted);
    cursor: pointer;
    padding: 3px 5px;
    border-radius: 3px;
    display: flex;
    align-items: center;
  }

  .icon-btn:hover:not(:disabled) {
    color: var(--text);
    background: var(--surface-2);
  }

  .icon-btn.del:hover {
    color: var(--danger, #ef4444);
  }

  .note-img-wrap {
    width: 100%;
    background: #000;
    max-height: 180px;
    overflow: hidden;
    display: flex;
    justify-content: center;
  }

  .note-img {
    max-width: 100%;
    max-height: 180px;
    object-fit: contain;
  }

  .note-body {
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .note-edit-text {
    width: 100%;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    color: inherit;
    font-family: inherit;
    font-size: 12px;
    padding: 4px;
    resize: vertical;
  }

  .note-edit-text:focus,
  .note-edit-text:hover {
    border-color: var(--border);
    background: var(--surface);
  }

  .note-edit-text.h1 { font-size: 18px; font-weight: 700; }
  .note-edit-text.h2 { font-size: 16px; font-weight: 700; }
  .note-edit-text.h3 { font-size: 14px; font-weight: 600; }
  .note-edit-text.h4 { font-size: 13px; font-weight: 600; }
  .note-edit-text.h5 { font-size: 12px; font-weight: 600; }
  .note-edit-text.h6 { font-size: 11px; font-weight: 600; }
</style>
