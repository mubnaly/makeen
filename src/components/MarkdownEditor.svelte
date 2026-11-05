<script>
  import { onMount, tick, untrack } from 'svelte';
  import Icon from './Icon.svelte';
  import { t, dir } from '../lib/lang.svelte.js';
  import { renderMarkdown, exportMarkdownFile, exportMarkdownAsPdf } from '../lib/markdown.js';
  import { startSpeechRecording, transcribeAudio } from '../lib/speech.js';
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
  let loadedNoteId = null;
  let loadedMaterialId = null;

  let mode = $state('editor'); // 'editor' | 'viewer'
  let title = $state('');
  let content = $state('');
  let textDirection = $state('rtl'); // default to RTL for seamless Arabic editing
  let textAlign = $state('right');
  let fontSize = $state(15);
  let showCalloutMenu = $state(false);
  let showScreenshotPicker = $state(false);
  let textareaEl = $state();
  let saveTimer = null;
  let isSaved = $state(true);

  // Initialize or load note: strictly untracked, only runs when identity changes!
  $effect(() => {
    const targetNoteId = note?.id || noteId || null;
    const targetMatId = (!targetNoteId && materialId) ? materialId : null;

    untrack(() => {
      if (targetNoteId) {
        if (targetNoteId !== loadedNoteId) {
          loadedNoteId = targetNoteId;
          loadedMaterialId = null;
          const found = (note?.id === targetNoteId ? note : null) || getNote(targetNoteId);
          if (found) loadActiveNote(found);
        }
      } else if (targetMatId) {
        if (targetMatId !== loadedMaterialId) {
          loadedMaterialId = targetMatId;
          loadedNoteId = null;
          const bound = getOrCreateNoteForMaterial(targetMatId, materialType, materialTitle);
          if (bound) loadActiveNote(bound);
        }
      } else if (!activeNote && !loadedNoteId) {
        const created = createNote({ title: materialTitle || 'New Note', materialType });
        loadedNoteId = created.id;
        loadActiveNote(created);
      }
    });
  });

  function loadActiveNote(n) {
    activeNote = n;
    title = n.title || '';
    content = n.content || '';
    if (n.direction) {
      textDirection = n.direction;
      textAlign = n.direction === 'rtl' ? 'right' : 'left';
    } else {
      const hasArabic = /[\u0600-\u06FF]/.test(title + ' ' + content);
      textDirection = hasArabic ? 'rtl' : (dir() === 'rtl' ? 'rtl' : 'ltr');
      textAlign = textDirection === 'rtl' ? 'right' : 'left';
    }
    isSaved = true;
  }

  function scheduleAutosave() {
    isSaved = false;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveNow();
    }, 350);
  }

  function saveNow() {
    if (!activeNote?.id) return;
    const updated = updateNote(activeNote.id, { title, content, direction: textDirection });
    if (updated) {
      activeNote = updated;
      isSaved = true;
      onNoteChange?.(updated);
    }
  }

  function toggleDirection() {
    textDirection = textDirection === 'rtl' ? 'ltr' : 'rtl';
    textAlign = textDirection === 'rtl' ? 'right' : 'left';
    scheduleAutosave();
  }

  function setAlignment(align) {
    textAlign = align;
  }

  function adjustFontSize(delta) {
    fontSize = Math.min(24, Math.max(12, fontSize + delta));
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

  function insertCallout(type) {
    showCalloutMenu = false;
    const templates = {
      NOTE: `> [!NOTE]\n> `,
      TIP: `> [!TIP]\n> `,
      IMPORTANT: `> [!IMPORTANT]\n> `,
      WARNING: `> [!WARNING]\n> `
    };
    insertFormatting(templates[type] || `> [!NOTE]\n> `, '', 'ملاحظة...');
  }

  function insertCurrentTimecode() {
    const latest = captures && captures.length ? captures[captures.length - 1] : null;
    const tc = latest?.timecode ? `[${latest.timecode}] ` : '[00:00] ';
    insertFormatting(tc);
    notify?.(t('notes.timestampInserted') || 'Timestamp inserted', 'ok');
  }

  function insertScreenshot(cap) {
    const src = cap.dataUrl || cap.image || cap.url || cap.src;
    if (!src) return;
    const capTitle = cap.title || (cap.timecode ? `Screenshot (${cap.timecode})` : 'Screenshot');
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

  // Voice Dictation (Offline Speech-to-Text via local Whisper)
  let isRecording = $state(false);
  let recordingTimer = $state(0);
  let recordingInterval = null;
  let activeRecorderInstance = null;
  let isTranscribing = $state(false);

  async function toggleVoiceRecording() {
    if (isTranscribing) return;

    if (!isRecording) {
      try {
        activeRecorderInstance = await startSpeechRecording();
        isRecording = true;
        recordingTimer = 0;
        if (recordingInterval) clearInterval(recordingInterval);
        recordingInterval = setInterval(() => {
          recordingTimer++;
        }, 1000);
        notify?.(t('stt.recording') || 'Listening... click to transcribe', 'info');
      } catch (err) {
        isRecording = false;
        notify?.(t('stt.micDenied') || 'Microphone access denied', 'error');
      }
    } else {
      if (recordingInterval) {
        clearInterval(recordingInterval);
        recordingInterval = null;
      }
      isRecording = false;
      isTranscribing = true;
      notify?.(t('stt.transcribing') || 'Transcribing voice offline...', 'info');

      try {
        const audio = await activeRecorderInstance.stop();
        activeRecorderInstance = null;

        const res = await transcribeAudio(audio.bytes, audio.mimeType, 'ar');
        if (res?.ok && res.text && res.text.trim()) {
          const transcribedText = res.text.trim();
          insertFormatting(transcribedText + ' ');
          notify?.(t('stt.success') || 'Voice transcribed successfully!', 'ok');
        } else if (res?.ok) {
          notify?.(t('stt.noSpeech') || 'No speech detected', 'info');
        } else {
          notify?.(res?.error || t('stt.error') || 'Voice transcription failed', 'error');
        }
      } catch (err) {
        notify?.(t('stt.error') || 'Voice transcription failed', 'error');
      } finally {
        isTranscribing = false;
      }
    }
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
        bind:value={title}
        oninput={scheduleAutosave}
        dir={textDirection}
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
        <!-- Direction Toggle (RTL / LTR) -->
        <button
          type="button"
          class="fmt-btn dir-toggle-btn"
          onclick={toggleDirection}
          title={textDirection === 'rtl' ? (t('notes.dirRtl') || 'RTL Direction') : (t('notes.dirLtr') || 'LTR Direction')}
        >
          <Icon name="arrow-left-right" size={12} />
          <span class="dir-label">{textDirection.toUpperCase()}</span>
        </button>

        <!-- Text Alignment (Right, Center, Left) -->
        <div class="fmt-group">
          <button
            type="button"
            class="fmt-btn {textAlign === 'right' ? 'active-fmt' : ''}"
            onclick={() => setAlignment('right')}
            title={t('notes.alignRight') || 'Align Right'}
          >
            <Icon name="align-right" size={13} />
          </button>
          <button
            type="button"
            class="fmt-btn {textAlign === 'center' ? 'active-fmt' : ''}"
            onclick={() => setAlignment('center')}
            title={t('notes.alignCenter') || 'Align Center'}
          >
            <Icon name="align-center" size={13} />
          </button>
          <button
            type="button"
            class="fmt-btn {textAlign === 'left' ? 'active-fmt' : ''}"
            onclick={() => setAlignment('left')}
            title={t('notes.alignLeft') || 'Align Left'}
          >
            <Icon name="align-left" size={13} />
          </button>
        </div>

        <div class="fmt-divider"></div>

        <!-- Headings -->
        <button type="button" class="fmt-btn" onclick={() => insertFormatting('# ', '', 'عنوان 1')} title="Heading 1">H1</button>
        <button type="button" class="fmt-btn" onclick={() => insertFormatting('## ', '', 'عنوان 2')} title="Heading 2">H2</button>
        <button type="button" class="fmt-btn" onclick={() => insertFormatting('### ', '', 'عنوان 3')} title="Heading 3">H3</button>

        <div class="fmt-divider"></div>

        <!-- Bold, Italic, Strikethrough -->
        <button type="button" class="fmt-btn" onclick={() => insertFormatting('**', '**', 'نص عريض')} title="Bold"><strong>B</strong></button>
        <button type="button" class="fmt-btn" onclick={() => insertFormatting('*', '*', 'نص مائل')} title="Italic"><em>I</em></button>
        <button type="button" class="fmt-btn" onclick={() => insertFormatting('~~', '~~', 'نص مشطوب')} title="Strikethrough"><s>S</s></button>

        <div class="fmt-divider"></div>

        <!-- Arabic Quotation Marks « » -->
        <button
          type="button"
          class="fmt-btn arabic-quotes-btn"
          onclick={() => insertFormatting('« ', ' »', 'اقتباس')}
          title={t('notes.insertArabicQuote') || 'Arabic Quotes « »'}
        >
          « »
        </button>

        <!-- Blockquote -->
        <button
          type="button"
          class="fmt-btn"
          onclick={() => insertFormatting('> ', '', 'اقتباس')}
          title={t('notes.insertQuote') || 'Blockquote'}
        >
          <Icon name="quote" size={13} />
        </button>

        <!-- Callout Alert Boxes (Note, Tip, Important, Warning) -->
        <div class="callout-picker-box">
          <button
            type="button"
            class="fmt-btn callout-toggle-btn"
            onclick={() => (showCalloutMenu = !showCalloutMenu)}
            title={t('notes.insertCallout') || 'Insert Callout'}
          >
            <Icon name="alert" size={13} />
            <span>{t('notes.callout') || 'تنبيه'}</span>
          </button>

          {#if showCalloutMenu}
            <div class="callout-popover">
              <button type="button" class="callout-opt note" onclick={() => insertCallout('NOTE')}>
                <span class="callout-badge note">NOTE</span>
                <span>{t('notes.calloutNote') || 'ملاحظة زرقاء'}</span>
              </button>
              <button type="button" class="callout-opt tip" onclick={() => insertCallout('TIP')}>
                <span class="callout-badge tip">TIP</span>
                <span>{t('notes.calloutTip') || 'فائدة / تلميح أخضر'}</span>
              </button>
              <button type="button" class="callout-opt important" onclick={() => insertCallout('IMPORTANT')}>
                <span class="callout-badge important">IMPORTANT</span>
                <span>{t('notes.calloutImportant') || 'هام جداً بنفسجي'}</span>
              </button>
              <button type="button" class="callout-opt warning" onclick={() => insertCallout('WARNING')}>
                <span class="callout-badge warning">WARNING</span>
                <span>{t('notes.calloutWarning') || 'تحذير أصفر'}</span>
              </button>
            </div>
          {/if}
        </div>

        <div class="fmt-divider"></div>

        <!-- Lists -->
        <button type="button" class="fmt-btn" onclick={() => insertFormatting('- ', '', 'عنصر قائمة')} title="Bullet List">
          <Icon name="list" size={13} />
        </button>
        <button type="button" class="fmt-btn" onclick={() => insertFormatting('1. ', '', 'عنصر مرقم')} title="Numbered List">
          1.
        </button>
        <button type="button" class="fmt-btn" onclick={() => insertFormatting('- [ ] ', '', 'مهمة')} title="Task List">
          <Icon name="check-square" size={13} />
        </button>

        <div class="fmt-divider"></div>

        <!-- Code block & Table -->
        <button type="button" class="fmt-btn" onclick={() => insertFormatting('```\n', '\n```', 'كود')} title="Code Block">
          &lt;/&gt;
        </button>
        <button type="button" class="fmt-btn" onclick={() => insertFormatting('\n| العمود 1 | العمود 2 |\n|---|---|\n| القيمة 1 | القيمة 2 |\n')} title="Table">
          <Icon name="columns" size={13} />
        </button>

        <!-- Video Timecode button -->
        <button
          type="button"
          class="fmt-btn"
          onclick={insertCurrentTimecode}
          title={t('notes.insertTimestamp') || 'Insert Video Timestamp'}
        >
          <Icon name="clock" size={13} />
        </button>

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

        <div class="fmt-divider"></div>

        <!-- Voice Dictation / Speech-to-Text Button -->
        <button
          type="button"
          class="fmt-btn voice-dictation-btn {isRecording ? 'recording' : ''} {isTranscribing ? 'transcribing' : ''}"
          onclick={toggleVoiceRecording}
          disabled={isTranscribing}
          title={isRecording ? (t('stt.recording') || 'Stop & Transcribe') : (t('stt.record') || 'Voice Typing')}
        >
          {#if isTranscribing}
            <Icon name="repeat" size={13} />
            <span class="voice-label">...</span>
          {:else if isRecording}
            <Icon name="mic" size={13} />
            <span class="voice-timer">
              {String(Math.floor(recordingTimer / 60)).padStart(2, '0')}:{String(recordingTimer % 60).padStart(2, '0')}
            </span>
          {:else}
            <Icon name="mic" size={13} />
            {#if !compact}<span class="voice-label">{t('stt.record') || 'إملاء'}</span>{/if}
          {/if}
        </button>

        <div class="fmt-divider"></div>

        <!-- Font Size Zoom -->
        <div class="fmt-group">
          <button type="button" class="fmt-btn zoom-btn" onclick={() => adjustFontSize(1)} title={t('notes.fontSizeIncrease') || 'Increase Font Size'}>A+</button>
          <button type="button" class="fmt-btn zoom-btn" onclick={() => adjustFontSize(-1)} title={t('notes.fontSizeDecrease') || 'Decrease Font Size'}>A-</button>
        </div>
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
          bind:value={content}
          oninput={scheduleAutosave}
          dir={textDirection}
          style:text-align={textAlign}
          style:font-size="{fontSize}px"
          spellcheck="false"
        ></textarea>
      </div>
    {:else}
      <div class="md-viewer-container" dir={textDirection} style:text-align={textAlign}>
        {#if content.trim()}
          <div class="md-rendered-content" style:font-size="{fontSize}px">
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
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Cairo", "Noto Sans Arabic", Tahoma, Arial, sans-serif;
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

  .fmt-group {
    display: inline-flex;
    align-items: center;
    gap: 1px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 1px;
  }

  .fmt-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 3px 6px;
    min-width: 24px;
    height: 24px;
    font-size: 11.5px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
    cursor: pointer;
    transition: all 0.12s ease;
  }
  .fmt-btn:hover {
    background: var(--surface-2);
    border-color: var(--accent);
  }
  .fmt-btn.active-fmt {
    background: var(--accent);
    color: #fff;
    border-color: var(--accent);
  }

  .fmt-group .fmt-btn {
    border: none;
    border-radius: 3px;
    height: 22px;
  }

  .dir-toggle-btn {
    gap: 4px;
    padding: 3px 6px;
    font-weight: 700;
  }
  .dir-label {
    font-size: 10px;
    letter-spacing: 0.5px;
  }

  .arabic-quotes-btn {
    font-weight: 700;
    font-size: 13px;
    color: var(--accent);
  }

  .zoom-btn {
    font-weight: 600;
    font-size: 11px;
  }

  .callout-picker-box {
    position: relative;
  }
  .callout-toggle-btn {
    gap: 4px;
  }
  .callout-popover {
    position: absolute;
    top: calc(100% + 6px);
    inset-inline-start: 0;
    z-index: 120;
    width: 200px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .callout-opt {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
    text-align: start;
    transition: background 0.12s ease;
  }
  .callout-opt:hover {
    background: var(--surface-2);
  }
  .callout-badge {
    font-size: 9px;
    font-weight: 700;
    padding: 2px 5px;
    border-radius: 3px;
  }
  .callout-badge.note { background: #e0f2fe; color: #0369a1; }
  .callout-badge.tip { background: #dcfce7; color: #15803d; }
  .callout-badge.important { background: #f3e8ff; color: #7e22ce; }
  .callout-badge.warning { background: #fef3c7; color: #b45309; }

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
    /* Fluent, cursive Arabic typography stack */
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Cairo", "Noto Sans Arabic", Tahoma, Arial, sans-serif;
    line-height: 1.7;
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
    line-height: 1.7;
    scrollbar-width: thin;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Cairo", "Noto Sans Arabic", Tahoma, Arial, sans-serif;
  }

  :global(.md-rendered-content) {
    color: var(--text);
  }
  :global(.md-rendered-content h1) {
    font-size: 1.6em;
    font-weight: 700;
    margin-top: 1em;
    margin-bottom: 0.5em;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--border);
  }
  :global(.md-rendered-content h2) {
    font-size: 1.35em;
    font-weight: 600;
    margin-top: 1em;
    margin-bottom: 0.5em;
  }
  :global(.md-rendered-content h3) {
    font-size: 1.15em;
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
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    direction: ltr;
    text-align: left;
  }
  :global(.md-rendered-content code) {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.9em;
  }
  :global(.md-rendered-content .md-inline-code) {
    background: var(--surface-2, rgba(0, 0, 0, 0.06));
    padding: 2px 5px;
    border-radius: 4px;
    direction: ltr;
    display: inline-block;
  }
  :global(.md-rendered-content blockquote) {
    border-inline-start: 4px solid var(--accent);
    margin: 0.8em 0;
    padding: 6px 14px;
    background: var(--surface-2, rgba(0,0,0,0.03));
    color: var(--muted);
    border-radius: 0 6px 6px 0;
  }
  :global(.md-rendered-content .md-ar-quote) {
    font-weight: 600;
    color: var(--accent);
    padding: 0 2px;
  }
  :global(.md-rendered-content .md-timestamp) {
    display: inline-block;
    background: rgba(59, 130, 246, 0.12);
    color: #2563eb;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 0.85em;
    font-weight: 600;
    margin: 0 3px;
  }
  :global(.md-rendered-content .md-callout) {
    border-radius: 6px;
    padding: 10px 14px;
    margin: 1em 0;
    border: 1px solid var(--border);
    border-inline-start-width: 4px;
  }
  :global(.md-rendered-content .md-callout-note) {
    background: rgba(2, 132, 199, 0.08);
    border-inline-start-color: #0284c7;
  }
  :global(.md-rendered-content .md-callout-tip) {
    background: rgba(22, 163, 74, 0.08);
    border-inline-start-color: #16a34a;
  }
  :global(.md-rendered-content .md-callout-important) {
    background: rgba(147, 51, 234, 0.08);
    border-inline-start-color: #9333ea;
  }
  :global(.md-rendered-content .md-callout-warning),
  :global(.md-rendered-content .md-callout-caution) {
    background: rgba(217, 119, 6, 0.08);
    border-inline-start-color: #d97706;
  }
  :global(.md-rendered-content .md-callout-tag) {
    font-weight: 700;
    font-size: 0.8em;
    margin-bottom: 4px;
    display: inline-block;
  }
  :global(.md-rendered-content ul),
  :global(.md-rendered-content ol) {
    padding-inline-start: 24px;
    margin: 0.6em 0;
  }
  :global(.md-rendered-content li) {
    margin: 0.25em 0;
  }
  :global(.md-rendered-content .md-task-item) {
    list-style: none;
    margin-inline-start: -20px;
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
    font-size: 0.9em;
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

  /* Voice Dictation (Speech-to-Text) Button Styling */
  .voice-dictation-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px;
    border-radius: 6px;
    font-size: 11.5px;
    font-weight: 600;
    transition: all 0.2s ease;
  }
  .voice-dictation-btn.recording {
    background: #ef4444 !important;
    color: #ffffff !important;
    border-color: #dc2626 !important;
    animation: voice-pulse 1.2s infinite ease-in-out;
  }
  .voice-dictation-btn.transcribing {
    background: var(--accent-soft) !important;
    color: var(--accent) !important;
    opacity: 0.85;
  }
  .voice-timer {
    font-family: monospace;
    font-size: 11px;
    font-weight: 700;
  }
  @keyframes voice-pulse {
    0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.5); }
    50% { transform: scale(1.04); box-shadow: 0 0 0 6px rgba(239, 68, 68, 0); }
    100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
  }
</style>