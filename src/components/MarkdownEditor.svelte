<script>
  import { onMount, tick, untrack } from 'svelte';
  import Icon from './Icon.svelte';
  import PomodoroWidget from './PomodoroWidget.svelte';
  import { t, dir } from '../lib/lang.svelte.js';
  import { renderMarkdown, exportMarkdownFile, exportMarkdownAsPdf, toggleMarkdownTask } from '../lib/markdown.js';
  import { EMOJI_CATEGORIES } from '../lib/emojis.js';
  import { processMarkdownEnter, processMarkdownTab } from '../lib/markdownEditorUtils.js';
  import { startRealtimeSpeech, startSpeechRecording, transcribeAudio } from '../lib/speech.js';
  import {
    getNote,
    updateNote,
    createNote,
    getOrCreateNoteForMaterial,
    listAllNotes,
    connectNotes,
    getNoteLinks
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
  let showFormattingTools = $state(false);
  let showNoteLinkPicker = $state(false);
  let showIconPicker = $state(false);
  let currentLinks = $state([]);
  let allAvailableNotes = $derived(listAllNotes().filter((n) => n.id !== activeNote?.id));

  // --- Undo / Redo History Stack ---
  let historyStack = $state([]);
  let historyIndex = $state(-1);
  let isPerformingUndoRedo = false;

  function pushHistory(newContent, selStart = null, selEnd = null) {
    if (isPerformingUndoRedo) return;
    const currentEntry = historyIndex >= 0 ? historyStack[historyIndex] : null;
    if (currentEntry && currentEntry.content === newContent) return;

    const start = selStart ?? (textareaEl ? textareaEl.selectionStart : 0);
    const end = selEnd ?? (textareaEl ? textareaEl.selectionEnd : 0);

    // Truncate future if branched
    const nextStack = historyStack.slice(0, historyIndex + 1);
    nextStack.push({ content: newContent, selectionStart: start, selectionEnd: end });
    if (nextStack.length > 80) nextStack.shift();

    historyStack = nextStack;
    historyIndex = historyStack.length - 1;
  }

  function handleUndo() {
    if (historyIndex > 0) {
      isPerformingUndoRedo = true;
      historyIndex -= 1;
      const entry = historyStack[historyIndex];
      content = entry.content;
      scheduleAutosave();
      tick().then(() => {
        if (textareaEl) {
          textareaEl.focus();
          textareaEl.setSelectionRange(entry.selectionStart, entry.selectionEnd);
        }
        isPerformingUndoRedo = false;
      });
    }
  }

  function handleRedo() {
    if (historyIndex < historyStack.length - 1) {
      isPerformingUndoRedo = true;
      historyIndex += 1;
      const entry = historyStack[historyIndex];
      content = entry.content;
      scheduleAutosave();
      tick().then(() => {
        if (textareaEl) {
          textareaEl.focus();
          textareaEl.setSelectionRange(entry.selectionStart, entry.selectionEnd);
        }
        isPerformingUndoRedo = false;
      });
    }
  }

  function insertEmoji(emoji) {
    insertFormatting(emoji + ' ');
  }

  function handleRenderedClick(e) {
    const checkbox = e.target.closest('.md-task-checkbox');
    if (checkbox) {
      const idx = parseInt(checkbox.dataset.taskIndex, 10);
      if (!isNaN(idx)) {
        content = toggleMarkdownTask(content, idx);
        scheduleAutosave();
        if (activeNote) {
          activeNote.content = content;
          onNoteChange?.(activeNote);
        }
      }
    }
  }

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
    if (!n) return;
    activeNote = n;
    title = n.title || '';
    content = n.content || '';
    historyStack = [{ content: content, selectionStart: 0, selectionEnd: 0 }];
    historyIndex = 0;
    try {
      if (n?.id) {
        currentLinks = getNoteLinks(n.id) || [];
      } else {
        currentLinks = [];
      }
    } catch {
      currentLinks = [];
    }
    if (n.direction) {
      textDirection = n.direction;
      textAlign = n.direction === 'rtl' ? 'right' : 'left';
    } else {
      const hasArabic = /[\u0600-\u06FF]/.test((title || '') + ' ' + (content || ''));
      textDirection = hasArabic ? 'rtl' : (dir() === 'rtl' ? 'rtl' : 'ltr');
      textAlign = textDirection === 'rtl' ? 'right' : 'left';
    }
    isSaved = true;
  }

  function handleInsertNoteLink(otherNote) {
    if (!otherNote) return;
    showNoteLinkPicker = false;
    insertFormatting(`[[${otherNote.title}]] `);
    if (activeNote?.id) {
      connectNotes(activeNote.id, otherNote.id);
      currentLinks = getNoteLinks(activeNote.id);
      notify?.(t('notes.saved') || 'Linked to note', 'ok');
    }
  }

  // Extract first H1 heading (# ...) from markdown to synchronize title
  function syncTitleFromFirstH1(mdContent) {
    if (!mdContent) return;
    const match = mdContent.match(/^\s*#\s+([^\n\r]+)/m);
    if (match) {
      const extracted = match[1].trim();
      if (extracted && extracted !== title) {
        title = extracted;
        if (activeNote) {
          activeNote.title = extracted;
        }
      }
    }
  }

  function handleTitleInput(e) {
    title = e.target.value;
    const h1Regex = /^(\s*#\s+)[^\n\r]+/m;
    if (h1Regex.test(content)) {
      content = content.replace(h1Regex, `$1${title}`);
    }
    scheduleAutosave();
  }

  function scheduleAutosave() {
    isSaved = false;
    syncTitleFromFirstH1(content);
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveNow();
    }, 350);
  }

  function saveNow() {
    if (!activeNote?.id) return;
    syncTitleFromFirstH1(content);
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
    const savedScrollTop = textareaEl.scrollTop;
    const sel = content.substring(start, end);
    const replacement = prefix + (sel || placeholder) + suffix;

    // Save previous state to history if not empty
    pushHistory(content, start, end);

    content = content.substring(0, start) + replacement + content.substring(end);
    scheduleAutosave();

    // Determine new selection boundaries
    let newStart, newEnd;
    if (sel) {
      newStart = start + prefix.length;
      newEnd = newStart + sel.length;
    } else if (placeholder) {
      newStart = start + prefix.length;
      newEnd = newStart + placeholder.length;
    } else {
      newStart = start + prefix.length;
      newEnd = newStart;
    }

    pushHistory(content, newStart, newEnd);

    tick().then(() => {
      if (!textareaEl) return;
      textareaEl.focus();
      textareaEl.setSelectionRange(newStart, newEnd);
      textareaEl.scrollTop = savedScrollTop;
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

  // Keyboard enhancements: auto-continue lists/tasks on Enter, indent/outdent on Tab, Undo/Redo
  function handleTextareaKeydown(e) {
    // Keyboard shortcuts for Undo and Redo
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      if (e.key === 'z' || e.key === 'Z') {
        if (e.shiftKey) {
          // Ctrl+Shift+Z => Redo
          e.preventDefault();
          handleRedo();
          return;
        } else {
          // Ctrl+Z => Undo
          e.preventDefault();
          handleUndo();
          return;
        }
      } else if (e.key === 'y' || e.key === 'Y') {
        // Ctrl+Y => Redo
        e.preventDefault();
        handleRedo();
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      if (!textareaEl) return;
      const res = processMarkdownEnter(content, textareaEl.selectionStart, textareaEl.selectionEnd);
      if (res) {
        e.preventDefault();
        pushHistory(content, textareaEl.selectionStart, textareaEl.selectionEnd);
        content = res.content;
        scheduleAutosave();
        setTimeout(() => {
          if (textareaEl) {
            textareaEl.selectionStart = textareaEl.selectionEnd = res.newCursor;
            pushHistory(content, res.newCursor, res.newCursor);
          }
        }, 0);
      }
    } else if (e.key === 'Tab') {
      if (!textareaEl) return;
      const res = processMarkdownTab(content, textareaEl.selectionStart, textareaEl.selectionEnd, e.shiftKey);
      if (res) {
        e.preventDefault();
        pushHistory(content, textareaEl.selectionStart, textareaEl.selectionEnd);
        content = res.content;
        scheduleAutosave();
        setTimeout(() => {
          if (textareaEl) {
            textareaEl.selectionStart = res.newStart;
            textareaEl.selectionEnd = res.newEnd;
            pushHistory(content, res.newStart, res.newEnd);
          }
        }, 0);
      }
    }
  }

  // Voice Dictation (Realtime Speech-to-Text via Web Speech API with fallback)
  let isRecording = $state(false);
  let recordingTimer = $state(0);
  let recordingInterval = null;
  let activeRecorderInstance = null;
  let isTranscribing = $state(false);

  // Markdown statistics
  const wordCount = $derived.by(() => {
    const txt = (content || '').trim();
    if (!txt) return 0;
    return txt.split(/\s+/).filter(Boolean).length;
  });
  const charCount = $derived((content || '').length);

  function copyMarkdownContent() {
    if (!content) return;
    try {
      navigator.clipboard?.writeText(content);
      notify?.(t('notes.copied') || 'Markdown copied to clipboard!', 'ok');
    } catch {
      notify?.(t('common.error') || 'Error copying text', 'error');
    }
  }

  async function toggleVoiceRecording() {
    if (isTranscribing) return;

    if (!isRecording) {
      // 1. Try real-time Web Speech API first
      let pendingInterim = '';
      const realtimeEngine = startRealtimeSpeech({
        lang: dir() === 'rtl' ? 'ar-SA' : 'en-US',
        onResult: ({ final, interim }) => {
          if (final && final.trim()) {
            pendingInterim = '';
            insertFormatting(final.trim() + ' ');
            scheduleAutosave();
          } else if (interim) {
            pendingInterim = interim.trim();
          }
        },
        onError: (err) => {
          console.warn('Realtime speech error:', err);
        },
        onEnd: () => {
          if (pendingInterim) {
            insertFormatting(pendingInterim + ' ');
            pendingInterim = '';
            scheduleAutosave();
          }
          if (isRecording) {
            isRecording = false;
            if (recordingInterval) clearInterval(recordingInterval);
          }
        }
      });

      if (realtimeEngine) {
        activeRecorderInstance = realtimeEngine;
        isRecording = true;
        recordingTimer = 0;
        recordingInterval = setInterval(() => { recordingTimer++; }, 1000);
        notify?.(t('stt.recording') || 'Listening in real-time... speak now', 'info');
        return;
      }

      // 2. Fallback to MediaRecorder + local bridge
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

      if (activeRecorderInstance?.stop) {
        // If it's the realtime speech engine
        if (typeof activeRecorderInstance.abort === 'function') {
          activeRecorderInstance.stop();
          activeRecorderInstance = null;
          notify?.(t('stt.success') || 'Voice captured successfully!', 'ok');
          return;
        }

        // If it was the fallback MediaRecorder
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
        oninput={handleTitleInput}
        dir={textDirection}
      />
      <div class="md-header-actions">
        <!-- Word count badge -->
        <span class="md-stats-badge" title={`${charCount} حرف`}>
          {wordCount} {t('notes.words') || 'كلمة'}
        </span>

        <!-- Save indicator -->
        <span class="save-indicator {isSaved ? 'saved' : 'saving'}" title={isSaved ? (t('notes.saved') || 'Saved') : (t('notes.saving') || 'Saving...')}>
          <Icon name={isSaved ? 'check' : 'repeat'} size={13} />
        </span>

        <!-- Pomodoro Timer in Header -->
        {#if !compact}
          <div class="header-pomodoro-wrapper">
            <PomodoroWidget materialTitle={title || 'ملاحظة'} compact={true} />
          </div>
        {/if}

        <!-- Mode Switcher: Single button toggle (Eye for Viewer, Pencil for Editor) -->
        <button
          type="button"
          class="mode-toggle-single-btn {mode === 'viewer' ? 'active-viewer' : ''}"
          onclick={() => (mode = mode === 'editor' ? 'viewer' : 'editor')}
          title={mode === 'editor' ? (t('notes.viewerMode') || 'Viewer Mode (Rendered)') : (t('notes.editorMode') || 'Editor Mode (Markdown)')}
          aria-label="Toggle editor and viewer"
        >
          <Icon name={mode === 'editor' ? 'eye' : 'pencil'} size={14} />
        </button>

        <!-- All Options / Tools Toggle Button -->
        <button
          type="button"
          class="action-btn toggle-tools-btn {showFormattingTools ? 'active-tools' : ''}"
          onclick={() => (showFormattingTools = !showFormattingTools)}
          title={t('notes.toggleTools') || 'All Options'}
          aria-pressed={showFormattingTools}
        >
          <Icon name="sliders" size={14} />
        </button>
      </div>
    </div>

    <!-- Quick Markdown Formatting & Export Bar (Shown when All Options is toggled) -->
    {#if showFormattingTools}
      <div class="md-format-bar">
        <!-- Undo / Redo Actions -->
        <button
          type="button"
          class="fmt-btn"
          onmousedown={(e) => e.preventDefault()}
          onclick={handleUndo}
          disabled={historyIndex <= 0}
          title={`${t('common.undo') || 'Undo'} (Ctrl+Z)`}
        >
          <Icon name="undo" size={13} />
          <span>{t('common.undo') || 'تراجع'}</span>
        </button>
        <button
          type="button"
          class="fmt-btn"
          onmousedown={(e) => e.preventDefault()}
          onclick={handleRedo}
          disabled={historyIndex >= historyStack.length - 1}
          title={`${t('common.redo') || 'Redo'} (Ctrl+Y / Ctrl+Shift+Z)`}
        >
          <Icon name="redo" size={13} />
          <span>{t('common.redo') || 'إعادة'}</span>
        </button>

        <div class="fmt-divider"></div>

        <!-- Export Actions (.MD & PDF) -->
        <button
          type="button"
          class="fmt-btn"
          onmousedown={(e) => e.preventDefault()}
          onclick={handleExportMd}
          title={t('notes.exportMd') || 'Export as Markdown (.md)'}
        >
          <Icon name="file-text" size={13} />
          <span>.MD</span>
        </button>
        <button
          type="button"
          class="fmt-btn primary-fmt"
          onmousedown={(e) => e.preventDefault()}
          onclick={handleExportPdf}
          title={t('notes.exportPdf') || 'Export as PDF'}
        >
          <Icon name="download" size={13} />
          <span>PDF</span>
        </button>
        <button
          type="button"
          class="fmt-btn"
          onmousedown={(e) => e.preventDefault()}
          onclick={copyMarkdownContent}
          title={t('notes.copyMarkdown') || 'Copy Markdown'}
        >
          <Icon name="copy" size={13} />
          <span>{t('common.copy') || 'Copy'}</span>
        </button>

        <div class="fmt-divider"></div>

        <!-- Direction Toggle (RTL / LTR) -->
        <button
          type="button"
          class="fmt-btn dir-toggle-btn"
          onmousedown={(e) => e.preventDefault()}
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
            onmousedown={(e) => e.preventDefault()}
            onclick={() => setAlignment('right')}
            title={t('notes.alignRight') || 'Align Right'}
          >
            <Icon name="align-right" size={13} />
          </button>
          <button
            type="button"
            class="fmt-btn {textAlign === 'center' ? 'active-fmt' : ''}"
            onmousedown={(e) => e.preventDefault()}
            onclick={() => setAlignment('center')}
            title={t('notes.alignCenter') || 'Align Center'}
          >
            <Icon name="align-center" size={13} />
          </button>
          <button
            type="button"
            class="fmt-btn {textAlign === 'left' ? 'active-fmt' : ''}"
            onmousedown={(e) => e.preventDefault()}
            onclick={() => setAlignment('left')}
            title={t('notes.alignLeft') || 'Align Left'}
          >
            <Icon name="align-left" size={13} />
          </button>
        </div>

        <div class="fmt-divider"></div>

        <!-- Icon / Emoji Picker -->
        <div class="emoji-picker-box">
          <button
            type="button"
            class="fmt-btn emoji-toggle-btn"
            onmousedown={(e) => e.preventDefault()}
            onclick={() => (showIconPicker = !showIconPicker)}
            title={t('notes.insertEmoji') || 'Insert Icon / Emoji'}
          >
            <Icon name="star" size={13} />
            <span>{t('notes.icons') || 'أيقونة'}</span>
          </button>

          {#if showIconPicker}
            <div class="emoji-popover">
              <div class="emoji-popover-header">
                <span>{t('notes.pickEmoji') || 'اختر أيقونة / إيموجي'}</span>
                <button type="button" class="close-btn" onclick={() => (showIconPicker = false)}>
                  <Icon name="x" size={12} />
                </button>
              </div>
              <div class="emoji-categories-list">
                {#each EMOJI_CATEGORIES as cat}
                  <div class="emoji-cat-title">{cat.name}</div>
                  <div class="emoji-grid">
                    {#each cat.emojis as em}
                      <button
                        type="button"
                        class="emoji-item-btn"
                        onmousedown={(e) => e.preventDefault()}
                        onclick={() => { insertEmoji(em); showIconPicker = false; }}
                        title={em}
                      >
                        {em}
                      </button>
                    {/each}
                  </div>
                {/each}
              </div>
            </div>
          {/if}
        </div>

        <div class="fmt-divider"></div>

        <!-- Headings -->
        <button type="button" class="fmt-btn" onmousedown={(e) => e.preventDefault()} onclick={() => insertFormatting('# ', '', 'عنوان 1')} title="Heading 1">H1</button>
        <button type="button" class="fmt-btn" onmousedown={(e) => e.preventDefault()} onclick={() => insertFormatting('## ', '', 'عنوان 2')} title="Heading 2">H2</button>
        <button type="button" class="fmt-btn" onmousedown={(e) => e.preventDefault()} onclick={() => insertFormatting('### ', '', 'عنوان 3')} title="Heading 3">H3</button>

        <div class="fmt-divider"></div>

        <!-- Bold, Italic, Underline, Strikethrough, Highlight -->
        <button type="button" class="fmt-btn" onmousedown={(e) => e.preventDefault()} onclick={() => insertFormatting('**', '**', 'نص عريض')} title="Bold (عريض)"><strong>B</strong></button>
        <button type="button" class="fmt-btn" onmousedown={(e) => e.preventDefault()} onclick={() => insertFormatting('*', '*', 'نص مائل')} title="Italic (مائل)"><em>I</em></button>
        <button type="button" class="fmt-btn" onmousedown={(e) => e.preventDefault()} onclick={() => insertFormatting('<u>', '</u>', 'نص مسطر')} title="Underline (تسطير)"><u>U</u></button>
        <button type="button" class="fmt-btn" onmousedown={(e) => e.preventDefault()} onclick={() => insertFormatting('~~', '~~', 'نص مشطوب')} title="Strikethrough (شطب)"><s>S</s></button>
        <button type="button" class="fmt-btn highlight-btn hstack" style="gap:2px;" onmousedown={(e) => e.preventDefault()} onclick={() => insertFormatting('==', '==', 'نص مميز')} title="Highlight (تمييز / تظليل)">
          <Icon name="marker" size={13} />
          <span style="background:#fef08a; color:#1e293b; padding:0 3px; border-radius:3px; font-weight:700; font-size:10.5px;">H</span>
        </button>
        <button type="button" class="fmt-btn" onmousedown={(e) => e.preventDefault()} onclick={() => insertFormatting('`', '`', 'كود')} title="Inline Code (كود مضمن)"><code>`C`</code></button>
        <button type="button" class="fmt-btn" onmousedown={(e) => e.preventDefault()} onclick={() => insertFormatting('||', '||', 'نص مخفي')} title="Spoiler (نص مخفي / تعتيم)">||?||</button>

        <div class="fmt-divider"></div>

        <!-- Arabic Quotation Marks « » -->
        <button
          type="button"
          class="fmt-btn arabic-quotes-btn"
          onmousedown={(e) => e.preventDefault()}
          onclick={() => insertFormatting('« ', ' »', 'اقتباس')}
          title={t('notes.insertArabicQuote') || 'Arabic Quotes « »'}
        >
          « »
        </button>

        <!-- Blockquote -->
        <button
          type="button"
          class="fmt-btn"
          onmousedown={(e) => e.preventDefault()}
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
            onmousedown={(e) => e.preventDefault()}
            onclick={() => (showCalloutMenu = !showCalloutMenu)}
            title={t('notes.insertCallout') || 'Insert Callout'}
          >
            <Icon name="alert" size={13} />
            <span>{t('notes.callout') || 'تنبيه'}</span>
          </button>

          {#if showCalloutMenu}
            <div class="callout-popover">
              <button type="button" class="callout-opt note" onmousedown={(e) => e.preventDefault()} onclick={() => insertCallout('NOTE')}>
                <span class="callout-badge note">NOTE</span>
                <span>{t('notes.calloutNote') || 'ملاحظة زرقاء'}</span>
              </button>
              <button type="button" class="callout-opt tip" onmousedown={(e) => e.preventDefault()} onclick={() => insertCallout('TIP')}>
                <span class="callout-badge tip">TIP</span>
                <span>{t('notes.calloutTip') || 'فائدة / تلميح أخضر'}</span>
              </button>
              <button type="button" class="callout-opt important" onmousedown={(e) => e.preventDefault()} onclick={() => insertCallout('IMPORTANT')}>
                <span class="callout-badge important">IMPORTANT</span>
                <span>{t('notes.calloutImportant') || 'هام جداً بنفسجي'}</span>
              </button>
              <button type="button" class="callout-opt warning" onmousedown={(e) => e.preventDefault()} onclick={() => insertCallout('WARNING')}>
                <span class="callout-badge warning">WARNING</span>
                <span>{t('notes.calloutWarning') || 'تحذير أصفر'}</span>
              </button>
            </div>
          {/if}
        </div>

        <div class="fmt-divider"></div>

        <!-- Lists -->
        <button type="button" class="fmt-btn" onmousedown={(e) => e.preventDefault()} onclick={() => insertFormatting('- ', '', 'عنصر قائمة')} title="Bullet List">
          <Icon name="list" size={13} />
        </button>
        <button type="button" class="fmt-btn" onmousedown={(e) => e.preventDefault()} onclick={() => insertFormatting('1. ', '', 'عنصر مرقم')} title="Numbered List">
          1.
        </button>
        <button type="button" class="fmt-btn" onmousedown={(e) => e.preventDefault()} onclick={() => insertFormatting('- [ ] ', '', 'مهمة')} title="Task List">
          <Icon name="check-square" size={13} />
        </button>

        <div class="fmt-divider"></div>

        <!-- Code block, Table, Math & Divider -->
        <button type="button" class="fmt-btn" onmousedown={(e) => e.preventDefault()} onclick={() => insertFormatting('```\n', '\n```', 'كود')} title="Code Block">
          &lt;/&gt;
        </button>
        <button type="button" class="fmt-btn" onmousedown={(e) => e.preventDefault()} onclick={() => insertFormatting('\n| العمود 1 | العمود 2 |\n|---|---|\n| القيمة 1 | القيمة 2 |\n')} title="Table">
          <Icon name="columns" size={13} />
        </button>
        <button type="button" class="fmt-btn" onmousedown={(e) => e.preventDefault()} onclick={() => insertFormatting('$ ', ' $', 'E = mc^2')} title="Math Formula ($...$)">
          $$
        </button>
        <button type="button" class="fmt-btn" onmousedown={(e) => e.preventDefault()} onclick={() => insertFormatting('\n\n---\n\n')} title="Horizontal Line (---)">
          <Icon name="minus" size={13} />
        </button>

        <!-- Link Note Button -->
        <div class="note-link-picker-box">
          <button
            type="button"
            class="fmt-btn"
            onmousedown={(e) => e.preventDefault()}
            onclick={() => (showNoteLinkPicker = !showNoteLinkPicker)}
            title={t('notes.connect') || 'Link Note'}
          >
            <Icon name="link" size={13} />
            <span>{t('notes.connect') || 'Link'}</span>
          </button>
          {#if showNoteLinkPicker}
            <div class="note-link-popover">
              <div class="popover-heading">{t('notes.connectPlaceholder') || 'Select note to link:'}</div>
              <div class="popover-notes-list">
                {#each allAvailableNotes as optNote (optNote.id)}
                  <button type="button" class="link-item-row" onmousedown={(e) => e.preventDefault()} onclick={() => handleInsertNoteLink(optNote)}>
                    <Icon name="file-text" size={12} />
                    <span class="link-item-title">{optNote.title}</span>
                  </button>
                {:else}
                  <div class="empty-muted-popover">{t('notes.noConnections') || 'No other notes yet'}</div>
                {/each}
              </div>
            </div>
          {/if}
        </div>

        <!-- Video Timecode button -->
        <button
          type="button"
          class="fmt-btn"
          onmousedown={(e) => e.preventDefault()}
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
              onmousedown={(e) => e.preventDefault()}
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
                      <button type="button" class="thumb-btn" onmousedown={(e) => e.preventDefault()} onclick={() => insertScreenshot(cap)}>
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
          onmousedown={(e) => e.preventDefault()}
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
          <button type="button" class="fmt-btn zoom-btn" onmousedown={(e) => e.preventDefault()} onclick={() => adjustFontSize(1)} title={t('notes.fontSizeIncrease') || 'Increase Font Size'}>A+</button>
          <button type="button" class="fmt-btn zoom-btn" onmousedown={(e) => e.preventDefault()} onclick={() => adjustFontSize(-1)} title={t('notes.fontSizeDecrease') || 'Decrease Font Size'}>A-</button>
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
          onkeydown={handleTextareaKeydown}
          dir={textDirection}
          style:text-align={textAlign}
          style:font-size="{fontSize}px"
          spellcheck="false"
        ></textarea>
      </div>
    {:else}
      <div class="md-viewer-container" dir={textDirection} style:text-align={textAlign}>
        {#if content.trim()}
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
          <div
            class="md-rendered-content"
            style:font-size="{fontSize}px"
            onclick={handleRenderedClick}
            role="region"
            aria-label="Rendered Markdown"
          >
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

  <!-- Connected Notes Knowledge Graph Bar -->
  {#if currentLinks.length > 0}
    <footer class="md-connected-bar hstack">
      <div class="hstack" style="gap:6px">
        <Icon name="brain" size={14} />
        <span class="connected-bar-title">{t('notes.connectedNotes', { n: currentLinks.length })}:</span>
      </div>
      <div class="connected-pills-row hstack">
        {#each currentLinks as lnk (lnk.id)}
          <span class="connected-pill-tag">
            <Icon name="link" size={11} />
            <span>{lnk.title}</span>
          </span>
        {/each}
      </div>
    </footer>
  {/if}
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

  .md-stats-badge {
    font-size: 11px;
    color: var(--muted);
    background: rgba(125, 125, 125, 0.08);
    border: 1px solid var(--border);
    padding: 2px 8px;
    border-radius: 99px;
    white-space: nowrap;
    user-select: none;
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

  .mode-toggle-single-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
    color: var(--text);
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .mode-toggle-single-btn:hover {
    background: var(--surface-2);
    border-color: var(--accent);
  }
  .mode-toggle-single-btn.active-viewer {
    background: var(--accent-soft);
    color: var(--accent);
    border-color: var(--accent);
  }

  :global(.md-task-checkbox) {
    cursor: pointer;
    width: 15px;
    height: 15px;
    accent-color: var(--accent, #4f6bff);
    vertical-align: -2px;
    margin-inline-end: 8px;
  }
  :global(.md-task-done) {
    text-decoration: line-through;
    opacity: 0.6;
  }

  .primary-fmt {
    background: var(--accent) !important;
    color: #fff !important;
    border-color: var(--accent) !important;
  }
  .primary-fmt:hover {
    opacity: 0.9;
  }

  /* Emoji / Icon Picker */
  .emoji-picker-box {
    position: relative;
  }
  .emoji-toggle-btn {
    gap: 4px;
    font-size: 11px;
    font-weight: 600;
  }
  .emoji-popover {
    position: absolute;
    top: calc(100% + 6px);
    inset-inline-start: 0;
    width: 250px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
    padding: 10px;
    z-index: 50;
    max-height: 280px;
    overflow-y: auto;
  }
  .emoji-popover-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 11.5px;
    font-weight: 700;
    color: var(--text);
    margin-bottom: 8px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--border);
  }
  .emoji-cat-title {
    font-size: 11px;
    font-weight: 600;
    color: var(--muted);
    margin: 6px 0 4px;
  }
  .emoji-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 4px;
  }
  .emoji-item-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    height: 32px;
    background: var(--surface-2);
    border: 1px solid transparent;
    border-radius: 6px;
    cursor: pointer;
    transition: transform 0.1s ease, background 0.15s ease;
  }
  .emoji-item-btn:hover {
    background: var(--accent-soft);
    border-color: var(--accent);
    transform: scale(1.15);
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
  .action-btn.active-tools {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent);
  }
  .action-btn:hover {
    background: var(--surface-2);
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

  /* Note Link Picker Popover */
  .note-link-picker-box {
    position: relative;
    display: inline-flex;
  }
  .note-link-popover {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    width: 240px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: var(--shadow);
    z-index: 100;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .popover-heading {
    font-size: 11px;
    color: var(--muted);
    font-weight: 600;
  }
  .popover-notes-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 160px;
    overflow-y: auto;
  }
  .link-item-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    border-radius: 5px;
    border: none;
    background: transparent;
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
    text-align: start;
  }
  .link-item-row:hover {
    background: var(--surface-2);
    color: var(--accent);
  }
  .link-item-title {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .empty-muted-popover {
    font-size: 11px;
    color: var(--muted);
    font-style: italic;
    padding: 4px;
  }

  /* Connected Notes Footer Bar */
  .md-connected-bar {
    padding: 6px 14px;
    background: var(--surface-2);
    border-top: 1px solid var(--border);
    font-size: 12px;
    gap: 12px;
    flex: none;
    overflow-x: auto;
  }
  .connected-bar-title {
    font-weight: 600;
    color: var(--accent);
    font-size: 11.5px;
    white-space: nowrap;
  }
  .connected-pills-row {
    gap: 6px;
    flex-wrap: wrap;
  }
  .connected-pill-tag {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 99px;
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text);
    font-size: 11px;
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
  :global(.md-rendered-content mark.md-highlight) {
    background: #fef08a;
    color: #1e293b;
    padding: 1px 6px;
    border-radius: 4px;
    font-weight: 600;
  }
  :global(.md-rendered-content .md-underline) {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  :global(.md-rendered-content .md-spoiler) {
    background: var(--surface-3, rgba(0,0,0,0.1));
    filter: blur(5px);
    cursor: pointer;
    user-select: none;
    transition: filter 0.2s ease, background 0.2s ease;
    padding: 1px 5px;
    border-radius: 3px;
    display: inline-block;
  }
  :global(.md-rendered-content .md-spoiler:hover),
  :global(.md-rendered-content .md-spoiler.revealed) {
    filter: none;
    background: transparent;
    user-select: auto;
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