<script>
  import { onMount, tick } from 'svelte';
  import Icon from './Icon.svelte';
  import { t } from '../lib/lang.svelte.js';
  import { renderMarkdown, exportMarkdownFile, exportMarkdownAsPdf } from '../lib/markdown.js';
  import {
    getNote,
    updateNote,
    createNote,
    getOrCreateNoteForMaterial
  } from '../lib/markdownStore.js';

  let {
    note = null,
    noteId = null,
    materialId = null,
    materialType = 'standalone',
    materialTitle = '',
    captures = [],
    notify = null,
    compact = false,
    onNoteChange = null
  } = $props();

  let activeNote = $state(null);
  let mode = $state('editor'); // 'editor' | 'viewer'
  let title = $state('');
  let content = $state('');
  let showScreenshotPicker = $state(false);
  let textareaEl = $state();
  let saveTimer = null;
  let isSaved = $state(true);

  // Initialize or load note
  $effect(() => {
    if (note?.id) {
      loadActiveNote(note);
    } else if (noteId) {
      const found = getNote(noteId);
      if (found) loadActiveNote(found);
    } else if (materialId) {
      const bound = getOrCreateNoteForMaterial(materialId, materialType, materialTitle);
      if (bound) loadActiveNote(bound);
    } else if (!activeNote) {
      const created = createNote({ title: materialTitle || 'New Note', materialType });
      loadActiveNote(created);
    }
  });

  function loadActiveNote(n) {
    if (activeNote?.id === n.id && title === n.title && content === n.content) return;
    activeNote = n;
    title = n.title || '';
    content = n.content || '';
    isSaved = true;
  }

  function handleContentChange(e) {
    content = e.target.value;
    scheduleAutosave();
  }

  function handleTitleChange(e) {
    title = e.target.value;
    scheduleAutosave();
  }

  function scheduleAutosave() {
    isSaved = false;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveNow();
    }, 400);
  }

  function saveNow() {
    if (!activeNote?.id) return;
    const updated = updateNote(activeNote.id, { title, content });
    if (updated) {
      activeNote = updated;
      isSaved = true;
      onNoteChange?.(updated);
    }
  }

  // Insert markdown syntax helper at current cursor position
  function insertFormatting(prefix, suffix = '', placeholder = '') {
    if (!textareaEl) return;
    const start = textareaEl.selectionStart;
    const end = textareaEl.selectionEnd;
    const sel = content.substring(start, end);
    const replacement = prefix + (sel || placeholder) + suffix;

    content = content.substring(0, start) + replacement + content.substring(end);
    scheduleAutosave();

    tick().then(() => {
      if (!textareaEl) return;
      textareaEl.focus();
      const newCursor = start + prefix.length + (sel ? sel.length : placeholder.length);
      textareaEl.setSelectionRange(newCursor, newCursor);
    });
  }

  function insertScreenshot(cap) {
    const src = cap.dataUrl || cap.image || cap.url || cap.src;
    if (!src) return;
    const capTitle = cap.title || cap.timecode ? `Screenshot (${cap.timecode})` : 'Screenshot';
    const mdImage = `\n\n![${capTitle}](${src})\n\n`;
    insertFormatting(mdImage);
    showScreenshotPicker = false;
    notify?.(t('notes.screenshotInserted') || 'Screenshot inserted into markdown', 'ok');
  }

  function handleExportMd() {
    exportMarkdownFile(title, content);
    notify?.(t('notes.exportedMd') || 'Exported as Markdown (.md)', 'ok');
  }

  function handleExportPdf() {
    exportMarkdownAsPdf(title, content);
    notify?.(t('notes.exportingPdf') || 'Opening print dialog for PDF export...', 'ok');
  }
</script>

<div class="markdown-editor-root" class:is-compact={compact}>
  <!-- Top Navigation & Action Toolbar -->
  <header class="md-header">
    <div class="md-title-row">
      <input
        type="text"
        class="md-title-input"
        placeholder={t('notes.noteTitlePlaceholder') || 'Note title...'}
        value={title}
        oninput={handleTitleChange}
      />
      <div class="md-header-actions">
        <!-- Save indicator -->
        <span class="save-indicator {isSaved ? 'saved' : 'saving'}" title={isSaved ? (t('notes.saved') || 'Saved') : (t('notes.saving') || 'Saving...')}>
          <Icon name={isSaved ? 'check' : 'repeat'} size={13} />
        </span>

        <!-- Mode Switcher: Editor vs Viewer -->
        <div class="mode-switcher" role="group" aria-label="Mode">
          <button
            type="button"
            class="mode-btn {mode === 'editor' ? 'active' : ''}"
            onclick={() => (mode = 'editor')}
            title={t('notes.editorMode') || 'Editor Mode (Markdown)'}
          >
            <Icon name="pencil" size={13} />
            {#if !compact}<span>{t('notes.modeEditor') || 'Editor'}</span>{/if}
          </button>
          <button
            type="button"
            class="mode-btn {mode === 'viewer' ? 'active' : ''}"
            onclick={() => (mode = 'viewer')}
            title={t('notes.viewerMode') || 'Viewer Mode (Rendered)'}
          >
            <Icon name="eye" size={13} />
            {#if !compact}<span>{t('notes.modeViewer') || 'Viewer'}</span>{/if}
          </button>
        </div>

        <!-- Export Dropdown / Actions -->
        <div class="export-actions">
          <button
            type="button"
            class="action-btn"
            onclick={handleExportMd}
            title={t('notes.exportMd') || 'Export as Markdown (.md)'}
          >
            <Icon name="file-text" size={13} />
            {#if !compact}<span>.MD</span>{/if}
          </button>
          <button
            type="button"
            class="action-btn primary"
            onclick={handleExportPdf}
            title={t('notes.exportPdf') || 'Export as PDF'}
          >
            <Icon name="download" size={13} />
            {#if !compact}<span>PDF</span>{/if}
          </button>
        </div>
      </div>
    </div>

    <!-- Quick Markdown Formatting Bar (in Editor mode) -->
    {#if mode === 'editor'}
      <div class="md-format-bar">
        <button type="button" class="fmt-btn" onclick={() => insertFormatting('# ', '', 'Heading 1')} title="Heading 1">H1</button>
        <button type="button" class="fmt-btn" onclick={() => insertFormatting('## ', '', 'Heading 2')} title="Heading 2">H2</button>
        <button type="button" class="fmt-btn" onclick={() => insertFormatting('### ', '', 'Heading 3')} title="Heading 3">H3</button>
        <div class="fmt-divider"></div>
        <button type="button" class="fmt-btn" onclick={() => insertFormatting('**', '**', 'bold')} title="Bold"><strong>B</strong></button>
        <button type="button" class="fmt-btn" onclick={() => insertFormatting('*', '*', 'italic')} title="Italic"><em>I</em></button>
        <button type="button" class="fmt-btn" onclick={() => insertFormatting('~~', '~~', 'strikethrough')} title="Strikethrough"><s>S</s></button>
        <div class="fmt-divider"></div>
        <button type="button" class="fmt-btn" onclick={() => insertFormatting('- ', '', 'List item')} title="Bullet List">
          <Icon name="list" size={13} />
        </button>
        <button type="button" class="fmt-btn" onclick={() => insertFormatting('- [ ] ', '', 'Task')} title="Task List">
          <Icon name="check-square" size={13} />
        </button>
        <button type="button" class="fmt-btn" onclick={() => insertFormatting('> ', '', 'Quote')} title="Quote">
          &ldquo;
        </button>
        <button type="button" class="fmt-btn" onclick={() => insertFormatting('```\n', '\n```', 'code')} title="Code Block">
          &lt;/&gt;
        </button>
        <button type="button" class="fmt-btn" onclick={() => insertFormatting('\n| Col 1 | Col 2 |\n|---|---|\n| Item 1 | Item 2 |\n')} title="Table">
          <Icon name="columns" size={13} />
        </button>
        <div class="fmt-divider"></div>

        <!-- Insert Screenshot Action -->
        {#if captures && captures.length > 0}
          <div class="screenshot-picker-box">
            <button
              type="button"
              class="fmt-btn screenshot-btn"
              onclick={() => (showScreenshotPicker = !showScreenshotPicker)}
              title={t('notes.insertScreenshot') || 'Insert Screenshot'}
            >
              <Icon name="camera" size={13} />
              <span>{t('notes.insertScreenshot') || 'Screenshot'}</span>
              <span class="cap-count">({captures.length})</span>
            </button>

            {#if showScreenshotPicker}
              <div class="screenshot-popover">
                <div class="popover-header">
                  <span>{t('notes.pickScreenshot') || 'Select Screenshot to Insert'}</span>
                  <button type="button" class="close-btn" onclick={() => (showScreenshotPicker = false)}>
                    <Icon name="x" size={12} />
                  </button>
                </div>
                <div class="popover-grid">
                  {#each captures as cap (cap.id || cap.dataUrl || cap.image)}
                    {@const src = cap.dataUrl || cap.image || cap.url || cap.src}
                    {#if src}
                      <button type="button" class="thumb-btn" onclick={() => insertScreenshot(cap)}>
                        <img src={src} alt="Capture" loading="lazy" />
                        {#if cap.timecode}<span class="thumb-time">{cap.timecode}</span>{/if}
                      </button>
                    {/if}
                  {/each}
                </div>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  </header>

  <!-- Main Body: Editor or Viewer -->
  <main class="md-body">
    {#if mode === 'editor'}
      <div class="md-editor-container">
        <textarea
          bind:this={textareaEl}
          class="md-textarea"
          placeholder={t('notes.editorPlaceholder') || 'Write your markdown notes here... (# Heading, **bold**, - list, ![screenshot](url))'}
          value={content}
          oninput={handleContentChange}
          dir="auto"
          spellcheck="false"
        ></textarea>
      </div>
    {:else}
      <div class="md-viewer-container" dir="auto">
        {#if content.trim()}
          <div class="md-rendered-content">
            {@html renderMarkdown(content)}
          </div>
        {:else}
          <div class="empty-viewer muted">
            <Icon name="file-text" size={32} />
            <p>{t('notes.emptyNote') || 'This note is empty. Switch to Editor mode to write.'}</p>
          </div>
        {/if}
      </div>
    {/if}
  </main>
</div>

<style>
  .markdown-editor-root {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    background: var(--surface);
    color: var(--text);
    overflow: hidden;
  }

  .md-header {
    flex: none;
    background: var(--surface-2, rgba(0, 0, 0, 0.02));
    border-bottom: 1px solid var(--border);
    padding: 8px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .md-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .md-title-input {
    flex: 1;
    min-width: 0;
    font-size: 15px;
    font-weight: 600;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 4px 8px;
    color: var(--text);
    outline: none;
    transition: border-color 0.15s ease, background 0.15s ease;
  }
  .md-title-input:hover,
  .md-title-input:focus {
    border-color: var(--border);
    background: var(--surface);
  }

  .md-header-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .save-indicator {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    color: var(--muted);
  }
  .save-indicator.saved {
    color: #10b981;
  }
  .save-indicator.saving {
    color: #f59e0b;
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    100% { transform: rotate(360deg); }
  }

  .mode-switcher {
    display: inline-flex;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 2px;
    gap: 2px;
  }

  .mode-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    font-size: 11.5px;
    font-weight: 500;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .mode-btn.active {
    background: var(--accent);
    color: #fff;
  }

  .export-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .action-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    font-size: 11.5px;
    font-weight: 500;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
    color: var(--text);
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .action-btn:hover {
    background: var(--surface-2);
  }
  .action-btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .action-btn.primary:hover {
    opacity: 0.9;
  }

  .md-format-bar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px;
    padding-top: 4px;
    border-top: 1px solid var(--border-light, rgba(0, 0, 0, 0.05));
  }

  .fmt-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 3px 6px;
    min-width: 24px;
    height: 24px;
    font-size: 12px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
    cursor: pointer;
    transition: background 0.12s ease;
  }
  .fmt-btn:hover {
    background: var(--surface-2);
    border-color: var(--accent);
  }

  .fmt-divider {
    width: 1px;
    height: 16px;
    background: var(--border);
    margin: 0 2px;
  }

  .screenshot-picker-box {
    position: relative;
  }
  .screenshot-btn {
    gap: 4px;
    padding: 3px 8px;
    background: rgba(59, 130, 246, 0.08);
    border-color: rgba(59, 130, 246, 0.3);
    color: #3b82f6;
  }
  .cap-count {
    font-size: 10px;
    opacity: 0.8;
  }

  .screenshot-popover {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 100;
    width: 280px;
    max-height: 260px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: var(--shadow-lg, 0 8px 24px rgba(0,0,0,0.15));
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .popover-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 12px;
    font-weight: 600;
  }
  .close-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--muted);
  }
  .popover-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 6px;
    overflow-y: auto;
    max-height: 200px;
  }
  .thumb-btn {
    position: relative;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 4px;
    overflow: hidden;
    background: #000;
    cursor: pointer;
    transition: border-color 0.15s ease;
  }
  .thumb-btn:hover {
    border-color: var(--accent);
  }
  .thumb-btn img {
    width: 100%;
    height: 70px;
    object-fit: cover;
    display: block;
  }
  .thumb-time {
    position: absolute;
    bottom: 2px;
    right: 2px;
    background: rgba(0, 0, 0, 0.7);
    color: #fff;
    font-size: 9px;
    padding: 1px 4px;
    border-radius: 3px;
  }

  .md-body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .md-editor-container {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    padding: 12px;
  }

  .md-textarea {
    flex: 1;
    min-height: 0;
    width: 100%;
    box-sizing: border-box;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 14px;
    background: var(--surface);
    color: var(--text);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    font-size: 13.5px;
    line-height: 1.6;
    resize: none;
    outline: none;
    overflow-y: auto;
    scrollbar-width: thin;
    transition: border-color 0.15s ease;
  }
  .md-textarea:focus {
    border-color: var(--accent);
  }

  .md-viewer-container {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 16px 20px;
    line-height: 1.65;
    scrollbar-width: thin;
  }

  :global(.md-rendered-content) {
    font-size: 14px;
    color: var(--text);
  }
  :global(.md-rendered-content h1) {
    font-size: 22px;
    font-weight: 700;
    margin-top: 1em;
    margin-bottom: 0.5em;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--border);
  }
  :global(.md-rendered-content h2) {
    font-size: 18px;
    font-weight: 600;
    margin-top: 1em;
    margin-bottom: 0.5em;
  }
  :global(.md-rendered-content h3) {
    font-size: 15px;
    font-weight: 600;
    margin-top: 0.8em;
    margin-bottom: 0.4em;
  }
  :global(.md-rendered-content p) {
    margin: 0.6em 0;
  }
  :global(.md-rendered-content pre) {
    background: var(--surface-2, #1e293b);
    border-radius: 6px;
    padding: 12px;
    overflow-x: auto;
  }
  :global(.md-rendered-content code) {
    font-family: monospace;
    font-size: 12.5px;
  }
  :global(.md-rendered-content .md-inline-code) {
    background: var(--surface-2, rgba(0, 0, 0, 0.06));
    padding: 2px 5px;
    border-radius: 4px;
  }
  :global(.md-rendered-content blockquote) {
    border-inline-start: 4px solid var(--accent);
    margin: 0.8em 0;
    padding: 4px 12px;
    background: var(--surface-2, rgba(0,0,0,0.03));
    color: var(--muted);
  }
  :global(.md-rendered-content ul),
  :global(.md-rendered-content ol) {
    padding-inline-start: 20px;
    margin: 0.6em 0;
  }
  :global(.md-rendered-content li) {
    margin: 0.25em 0;
  }
  :global(.md-rendered-content .md-task-item) {
    list-style: none;
    margin-inline-start: -18px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  :global(.md-rendered-content .md-img) {
    max-width: 100%;
    height: auto;
    border-radius: 6px;
    margin: 8px 0;
    border: 1px solid var(--border);
    box-shadow: 0 2px 6px rgba(0,0,0,0.05);
  }
  :global(.md-rendered-content table) {
    width: 100%;
    border-collapse: collapse;
    margin: 1em 0;
  }
  :global(.md-rendered-content th),
  :global(.md-rendered-content td) {
    border: 1px solid var(--border);
    padding: 6px 10px;
    text-align: start;
    font-size: 13px;
  }
  :global(.md-rendered-content th) {
    background: var(--surface-2);
    font-weight: 600;
  }

  .empty-viewer {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    text-align: center;
    gap: 8px;
  }

  .is-compact .md-header {
    padding: 6px 8px;
  }
  .is-compact .md-editor-container {
    padding: 8px;
  }
  .is-compact .md-viewer-container {
    padding: 10px 12px;
  }
</style>
