<script>
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import MarkdownEditor from './MarkdownEditor.svelte';
  import MarkdownBrainGraph from './MarkdownBrainGraph.svelte';
  import { t, ui } from '../lib/lang.svelte.js';
  import {
    listFolders,
    listAllNotes,
    createFolder,
    renameFolder,
    deleteFolder,
    createNote,
    deleteNote,
    moveNoteToFolder,
    moveFolder,
    searchNotes,
    getFolderBreadcrumbs,
    ensureDailyFolderAndNote
  } from '../lib/markdownStore.js';

  let { notify = null, captures = [] } = $props();

  let folders = $state([]);
  let notes = $state([]);
  let activeNoteId = $state(null);
  let selectedFolderId = $state(null); // null means root/all
  let searchQuery = $state('');
  let viewMode = $state('editor'); // 'editor' | 'graph'
  let mobileView = $state('tree'); // 'tree' | 'editor' on mobile screens

  // Folder creation & editing state
  let isCreatingFolder = $state(false);
  let newFolderName = $state('');
  let createFolderParentId = $state(null);
  let editingFolderId = $state(null);
  let editingFolderName = $state('');
  let expandedFolderIds = $state(new Set());
  let mdFileInput = $state();

  // Drag & Drop and Move Hierarchy State
  let draggedItem = $state(null); // { type: 'note' | 'folder', id: string, name: string }
  let dragOverTargetId = $state(null); // folder id or null for root
  let moveModalNote = $state(null);

  function handleDragStartNote(e, note) {
    draggedItem = { type: 'note', id: note.id, name: note.title };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', note.id);
  }

  function handleDragStartFolder(e, folder) {
    if (folder.isProtected || folder.isDaily) return;
    draggedItem = { type: 'folder', id: folder.id, name: folder.name };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', folder.id);
  }

  function handleDragOverFolder(e, targetFolderId) {
    if (!draggedItem) return;
    if (draggedItem.type === 'folder' && draggedItem.id === targetFolderId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    dragOverTargetId = targetFolderId;
  }

  function handleDragLeaveFolder() {
    dragOverTargetId = null;
  }

  function handleDropOnFolder(e, targetFolderId) {
    e.preventDefault();
    e.stopPropagation();
    if (!draggedItem) return;

    if (draggedItem.type === 'note') {
      moveNoteToFolder(draggedItem.id, targetFolderId);
      if (targetFolderId) {
        expandedFolderIds = new Set([...expandedFolderIds, targetFolderId]);
      }
      notify?.(t('notes.movedSuccess') || 'تم نقل الملاحظة بنجاح', 'ok');
    } else if (draggedItem.type === 'folder') {
      const res = moveFolder(draggedItem.id, targetFolderId);
      if (res) {
        if (targetFolderId) {
          expandedFolderIds = new Set([...expandedFolderIds, targetFolderId]);
        }
        notify?.(t('notes.folderMovedSuccess') || 'تم نقل المجلد بنجاح', 'ok');
      }
    }

    draggedItem = null;
    dragOverTargetId = null;
    reloadData();
  }

  function openMoveModal(note) {
    moveModalNote = note;
  }

  function executeMoveNote(targetFolderId) {
    if (!moveModalNote) return;
    moveNoteToFolder(moveModalNote.id, targetFolderId);
    if (targetFolderId) {
      expandedFolderIds = new Set([...expandedFolderIds, targetFolderId]);
    }
    const title = moveModalNote.title;
    moveModalNote = null;
    reloadData();
    notify?.(`تم نقل "${title}" بنجاح`, 'ok');
  }

  async function handleImportMdFile(e) {
    const file = e.target?.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const rawName = file.name.replace(/\.(md|markdown|txt)$/i, '');
      const note = createNote({
        title: rawName || 'Imported Note',
        content: text,
        folderId: selectedFolderId === '__ALL__' ? null : selectedFolderId
      });
      reloadData();
      activeNoteId = note.id;
      mobileView = 'editor';
      notify?.(t('notes.importedSuccess', { title: note.title }) || `Imported ${note.title}`, 'ok');
    } catch (err) {
      notify?.(t('notes.importFailed') || 'Failed to import markdown file', 'error');
    } finally {
      if (mdFileInput) mdFileInput.value = '';
    }
  }

  function reloadData() {
    folders = listFolders();
    notes = listAllNotes();
    if (!activeNoteId && notes.length > 0) {
      activeNoteId = notes[0].id;
    }
  }

  onMount(() => {
    try {
      const res = ensureDailyFolderAndNote();
      if (res?.dailyFolder?.id) {
        const next = new Set(expandedFolderIds);
        next.add(res.dailyFolder.id);
        expandedFolderIds = next;
      }
      reloadData();
      if (res?.todayNote?.id && !activeNoteId) {
        activeNoteId = res.todayNote.id;
      }
    } catch {
      reloadData();
    }
  });

  const activeNote = $derived(notes.find((n) => n.id === activeNoteId) || null);

  const filteredNotes = $derived(
    searchQuery.trim()
      ? searchNotes(searchQuery)
      : selectedFolderId === '__ALL__'
        ? notes
        : selectedFolderId === null
          ? notes.filter((n) => !n.folderId)
          : notes.filter((n) => n.folderId === selectedFolderId)
  );

  function toggleFolder(fId) {
    const next = new Set(expandedFolderIds);
    if (next.has(fId)) next.delete(fId);
    else next.add(fId);
    expandedFolderIds = next;
  }

  function handleCreateFolder() {
    if (!newFolderName.trim()) return;
    const created = createFolder({
      name: newFolderName.trim(),
      parentId: createFolderParentId
    });
    if (createFolderParentId) {
      const next = new Set(expandedFolderIds);
      next.add(createFolderParentId);
      expandedFolderIds = next;
    }
    newFolderName = '';
    isCreatingFolder = false;
    createFolderParentId = null;
    reloadData();
    selectedFolderId = created.id;
    notify?.(t('notes.folderCreated') || 'Folder created successfully', 'ok');
  }

  function handleStartRename(f) {
    editingFolderId = f.id;
    editingFolderName = f.name;
  }

  function handleSaveRename() {
    if (!editingFolderId) return;
    if (editingFolderName.trim()) {
      renameFolder(editingFolderId, editingFolderName.trim());
      reloadData();
      notify?.(t('notes.folderRenamed') || 'Folder renamed', 'ok');
    }
    editingFolderId = null;
    editingFolderName = '';
  }

  function handleDeleteFolder(fId) {
    if (confirm(t('notes.confirmDeleteFolder') || 'Delete this folder and all its contents?')) {
      deleteFolder(fId);
      if (selectedFolderId === fId) selectedFolderId = null;
      reloadData();
      notify?.(t('notes.folderDeleted') || 'Folder deleted', 'ok');
    }
  }

  function handleCreateNote(fId = selectedFolderId) {
    const targetFolder = fId === '__ALL__' ? null : fId;
    const newNote = createNote({
      title: 'Untitled Note',
      folderId: targetFolder,
      content: '# Untitled Note\n\n'
    });
    reloadData();
    activeNoteId = newNote.id;
    mobileView = 'editor';
    notify?.(t('notes.noteCreated') || 'New note created', 'ok');
  }

  function handleDeleteNote(nId) {
    deleteNote(nId);
    reloadData();
    if (activeNoteId === nId) {
      activeNoteId = notes.length > 0 ? notes[0].id : null;
    }
    notify?.(t('notes.noteDeleted') || 'Note deleted', 'ok');
  }

  function getFolderChildren(parentId) {
    return folders.filter((f) => (f.parentId || null) === (parentId || null));
  }

  function getFolderNotes(folderId) {
    return notes.filter((n) => (n.folderId || null) === (folderId || null));
  }
</script>

<!-- Recursive Snippet for Nested Folders (unlimited nesting) -->
{#snippet folderNode(folder, depth = 0)}
  {@const childFolders = getFolderChildren(folder.id)}
  {@const childNotes = getFolderNotes(folder.id)}
  {@const isExpanded = expandedFolderIds.has(folder.id)}
  {@const isSelected = selectedFolderId === folder.id}

  <div class="folder-tree-item" style="--depth:{depth}">
    <div
      class="folder-row {isSelected ? 'selected' : ''} {dragOverTargetId === folder.id ? 'drag-over' : ''}"
      draggable={!folder.isProtected && !folder.isDaily}
      ondragstart={(e) => handleDragStartFolder(e, folder)}
      ondragover={(e) => handleDragOverFolder(e, folder.id)}
      ondragleave={handleDragLeaveFolder}
      ondrop={(e) => handleDropOnFolder(e, folder.id)}
      role="treeitem"
      aria-expanded={isExpanded}
    >
      <button
        type="button"
        class="tree-arrow-btn"
        onclick={() => toggleFolder(folder.id)}
        aria-label="Toggle folder"
      >
        {#if childFolders.length > 0 || childNotes.length > 0}
          <Icon name={isExpanded ? 'chevron-down' : 'chevron-right'} size={12} />
        {:else}
          <span class="tree-bullet">·</span>
        {/if}
      </button>

      <button
        type="button"
        class="folder-label-btn"
        onclick={() => {
          selectedFolderId = folder.id;
          toggleFolder(folder.id);
        }}
      >
        <Icon name={folder.isDaily || folder.isProtected ? 'planner' : 'folder'} size={14} />
        {#if editingFolderId === folder.id}
          <input
            type="text"
            class="rename-input"
            bind:value={editingFolderName}
            onkeydown={(e) => {
              if (e.key === 'Enter') handleSaveRename();
              if (e.key === 'Escape') editingFolderId = null;
            }}
            onblur={handleSaveRename}
            autofocus
          />
        {:else}
          <span class="folder-name">{folder.isDaily || folder.name === 'Daily' ? (t('notes.dailyFolder') || 'Daily') : folder.name}</span>
          <span class="item-count">({childNotes.length})</span>
        {/if}
      </button>

      <div class="folder-hover-actions">
        <!-- Add subfolder inside this folder -->
        {#if !folder.isDaily && !folder.isProtected}
          <button
            type="button"
            class="mini-action"
            onclick={() => {
              createFolderParentId = folder.id;
              isCreatingFolder = true;
            }}
            title={t('notes.newSubfolder') || 'New Subfolder'}
          >
            <Icon name="folderPlus" size={12} />
          </button>
        {/if}
        <!-- Add note inside this folder -->
        <button
          type="button"
          class="mini-action"
          onclick={() => handleCreateNote(folder.id)}
          title={t('notes.newNoteInFolder') || 'New Note here'}
        >
          <Icon name="plus" size={12} />
        </button>
        {#if !folder.isDaily && !folder.isProtected}
          <!-- Rename -->
          <button
            type="button"
            class="mini-action"
            onclick={() => handleStartRename(folder)}
            title={t('common.rename') || 'Rename'}
          >
            <Icon name="pencil" size={11} />
          </button>
          <!-- Delete -->
          <button
            type="button"
            class="mini-action danger"
            onclick={() => handleDeleteFolder(folder.id)}
            title={t('common.delete') || 'Delete'}
          >
            <Icon name="trash" size={11} />
          </button>
        {/if}
      </div>
    </div>

    <!-- Children: Subfolders and Notes (rendered recursively) -->
    {#if isExpanded}
      <div class="folder-children">
        {#each childFolders as sub (sub.id)}
          {@render folderNode(sub, depth + 1)}
        {/each}
        {#each childNotes as note (note.id)}
          <div
            class="note-tree-leaf {activeNoteId === note.id ? 'active' : ''}"
            style="--depth:{depth + 1}"
            draggable="true"
            ondragstart={(e) => handleDragStartNote(e, note)}
            onclick={() => {
              activeNoteId = note.id;
              mobileView = 'editor';
            }}
            role="button"
            tabindex="0"
            onkeydown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                activeNoteId = note.id;
                mobileView = 'editor';
              }
            }}
          >
            <Icon name="file-text" size={13} />
            <span class="leaf-title">{note.title || 'Untitled Note'}</span>
            <div class="leaf-actions hstack" style="gap:2px;">
              <button
                type="button"
                class="leaf-action-btn"
                onclick={(e) => {
                  e.stopPropagation();
                  openMoveModal(note);
                }}
                title={t('notes.moveToFolder') || 'نقل لمجلد آخر'}
              >
                <Icon name="folder" size={11} />
              </button>
              <button
                type="button"
                class="leaf-delete"
                onclick={(e) => {
                  e.stopPropagation();
                  handleDeleteNote(note.id);
                }}
                title={t('common.delete')}
              >
                <Icon name="trash" size={11} />
              </button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/snippet}

<div class="notes-workspace" class:mobile-show-tree={mobileView === 'tree'} class:mobile-show-editor={mobileView === 'editor'}>
  <!-- Left Column: Folders & Notes Navigation Explorer -->
  <aside class="notes-sidebar">
    <div class="sidebar-header">
      <div class="hstack" style="justify-content:space-between; align-items:center;">
        <span class="sidebar-title hstack" style="gap:6px;">
          <Icon name="file-text" size={16} />
          <span>{t('notes.sectionTitle') || 'Markdown Notes'}</span>
          <span class="badge">{notes.length}</span>
        </span>
        <div class="hstack" style="gap:4px;">
          <button
            type="button"
            class="icon-action-btn"
            onclick={() => {
              createFolderParentId = null;
              isCreatingFolder = true;
            }}
            title={t('notes.newFolder') || 'New Folder'}
          >
            <Icon name="folderPlus" size={15} />
          </button>
          <button
            type="button"
            class="icon-action-btn"
            onclick={() => mdFileInput?.click()}
            title={t('notes.importMd') || 'Import Markdown File (.md)'}
          >
            <Icon name="upload" size={14} />
          </button>
          <input
            bind:this={mdFileInput}
            type="file"
            accept=".md,.markdown,.txt"
            onchange={handleImportMdFile}
            style="display:none;"
          />
          <button
            type="button"
            class="primary small hstack new-note-btn"
            style="gap:4px; padding:3px 8px; height:26px; font-size:11.5px; white-space:nowrap; border-radius:6px; flex-shrink:0;"
            onclick={() => handleCreateNote(selectedFolderId)}
            title={t('notes.newNote') || 'New Note'}
          >
            <Icon name="plus" size={13} />
            <span>{ui.lang === 'ar' ? 'ملاحظة' : 'Note'}</span>
          </button>
        </div>
      </div>

      <!-- Quick Search Filter -->
      <div class="search-box">
        <Icon name="search" size={13} />
        <input
          type="text"
          placeholder={t('notes.searchNotes') || 'Search notes...'}
          bind:value={searchQuery}
        />
        {#if searchQuery}
          <button type="button" class="clear-search" onclick={() => (searchQuery = '')}>
            <Icon name="x" size={11} />
          </button>
        {/if}
      </div>

      <!-- View Switcher (Editor vs Brain Graph) -->
      <div class="view-mode-bar hstack">
        <button
          type="button"
          class="view-tab-btn {viewMode === 'editor' ? 'active' : ''}"
          onclick={() => {
            viewMode = 'editor';
            mobileView = 'editor';
          }}
        >
          <Icon name="file-text" size={13} />
          <span>{t('notes.viewEditor') || 'Editor'}</span>
        </button>
        <button
          type="button"
          class="view-tab-btn {viewMode === 'graph' ? 'active' : ''}"
          onclick={() => {
            viewMode = 'graph';
            mobileView = 'editor';
          }}
        >
          <Icon name="brain" size={13} />
          <span>{t('notes.viewGraph') || 'Brain Graph'}</span>
        </button>
      </div>
    </div>

    <!-- Create Folder Modal / Input bar -->
    {#if isCreatingFolder}
      <div class="create-folder-card">
        <div class="card-caption">
          {createFolderParentId ? (t('notes.newSubfolder') || 'New Subfolder') : (t('notes.newFolder') || 'New Folder')}
        </div>
        <div class="hstack" style="gap:4px;">
          <input
            type="text"
            placeholder={t('notes.folderNamePlaceholder') || 'Folder name...'}
            bind:value={newFolderName}
            onkeydown={(e) => {
              if (e.key === 'Enter') handleCreateFolder();
              if (e.key === 'Escape') isCreatingFolder = false;
            }}
            autofocus
          />
          <button type="button" class="primary small" onclick={handleCreateFolder}>
            <Icon name="check" size={13} />
          </button>
          <button type="button" class="small" onclick={() => (isCreatingFolder = false)}>
            <Icon name="x" size={13} />
          </button>
        </div>
      </div>
    {/if}

    <!-- Folders & Notes Hierarchy List -->
    <div class="tree-container">
      <!-- Quick Navigation Category: All Notes -->
      <div
        class="tree-root-item {selectedFolderId === '__ALL__' ? 'selected' : ''}"
        onclick={() => (selectedFolderId = selectedFolderId === '__ALL__' ? null : '__ALL__')}
      >
        <Icon name="list" size={14} />
        <span>{t('notes.allNotes') || 'All Notes'}</span>
        <span class="item-count">({notes.length})</span>
      </div>

      {#if searchQuery.trim() || selectedFolderId === '__ALL__'}
        <!-- Search Results or All Notes flat list -->
        <div class="section-divider">
          <span>{searchQuery.trim() ? (ui.lang === 'ar' ? `نتائج البحث (${filteredNotes.length})` : `Search Results (${filteredNotes.length})`) : (t('notes.allNotes') || 'All Notes')}</span>
        </div>
        {#if filteredNotes.length === 0}
          <div class="muted" style="padding:12px; font-size:12px; text-align:center;">
            {ui.lang === 'ar' ? 'لا توجد ملاحظات' : 'No notes found'}
          </div>
        {:else}
          {#each filteredNotes as fnote (fnote.id)}
            <div
              class="note-tree-leaf {activeNoteId === fnote.id ? 'active' : ''}"
              style="--depth:0"
              draggable="true"
              ondragstart={(e) => handleDragStartNote(e, fnote)}
              onclick={() => {
                activeNoteId = fnote.id;
                mobileView = 'editor';
              }}
              role="button"
              tabindex="0"
              onkeydown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  activeNoteId = fnote.id;
                  mobileView = 'editor';
                }
              }}
            >
              <Icon name="file-text" size={13} />
              <span class="leaf-title">{fnote.title || 'Untitled Note'}</span>
              <div class="leaf-actions hstack" style="gap:2px;">
                <button
                  type="button"
                  class="leaf-action-btn"
                  onclick={(e) => {
                    e.stopPropagation();
                    openMoveModal(fnote);
                  }}
                  title={t('notes.moveToFolder') || 'نقل لمجلد آخر'}
                >
                  <Icon name="folder" size={11} />
                </button>
                <button
                  type="button"
                  class="leaf-delete"
                  onclick={(e) => {
                    e.stopPropagation();
                    handleDeleteNote(fnote.id);
                  }}
                  title={t('common.delete')}
                >
                  <Icon name="trash" size={11} />
                </button>
              </div>
            </div>
          {/each}
        {/if}
      {:else}
        <!-- Root Folder Items -->
        <div class="section-divider">
          <span>{t('notes.folders') || 'Folders & Notes'}</span>
        </div>

        {#each getFolderChildren(null) as rootFolder (rootFolder.id)}
          {@render folderNode(rootFolder, 0)}
        {/each}

        <!-- Loose Root Notes (not inside any folder) -->
        <div
          class="section-divider root-drop-zone {dragOverTargetId === '__ROOT__' ? 'drag-over' : ''}"
          style="margin-top:12px; cursor:default; border-radius:6px; padding:4px 6px; transition: background 0.15s ease;"
          ondragover={(e) => handleDragOverFolder(e, null)}
          ondragleave={handleDragLeaveFolder}
          ondrop={(e) => handleDropOnFolder(e, null)}
          role="region"
          aria-label={t('notes.rootNotes') || 'Root Notes'}
        >
          <span>{t('notes.rootNotes') || 'Root Notes'} ({getFolderNotes(null).length})</span>
        </div>
        {#if getFolderNotes(null).length > 0}
          {#each getFolderNotes(null) as rootNote (rootNote.id)}
            <div
              class="note-tree-leaf {activeNoteId === rootNote.id ? 'active' : ''}"
              style="--depth:0"
              draggable="true"
              ondragstart={(e) => handleDragStartNote(e, rootNote)}
              onclick={() => {
                activeNoteId = rootNote.id;
                mobileView = 'editor';
              }}
              role="button"
              tabindex="0"
              onkeydown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  activeNoteId = rootNote.id;
                  mobileView = 'editor';
                }
              }}
            >
              <Icon name="file-text" size={13} />
              <span class="leaf-title">{rootNote.title || 'Untitled Note'}</span>
              <div class="leaf-actions hstack" style="gap:2px;">
                <button
                  type="button"
                  class="leaf-action-btn"
                  onclick={(e) => {
                    e.stopPropagation();
                    openMoveModal(rootNote);
                  }}
                  title={t('notes.moveToFolder') || 'نقل لمجلد آخر'}
                >
                  <Icon name="folder" size={11} />
                </button>
                <button
                  type="button"
                  class="leaf-delete"
                  onclick={(e) => {
                    e.stopPropagation();
                    handleDeleteNote(rootNote.id);
                  }}
                  title={t('common.delete')}
                >
                  <Icon name="trash" size={11} />
                </button>
              </div>
            </div>
          {/each}
        {/if}
      {/if}
    </div>
  </aside>

  <!-- Right Column: Note Editor & Viewer OR Brain Knowledge Graph -->
  <main class="notes-main-pane">
    <div class="mobile-back-bar">
      <button type="button" class="back-to-tree-btn hstack" onclick={() => (mobileView = 'tree')}>
        <Icon name={ui.dir === 'rtl' ? 'chevron-right' : 'chevron-left'} size={15} />
        <span>{t('notes.backToTree') || 'العودة للمجلدات والملاحظات'}</span>
      </button>
    </div>
    {#if viewMode === 'graph'}
      <MarkdownBrainGraph
        {activeNoteId}
        {notify}
        onOpenNote={(noteId) => {
          activeNoteId = noteId;
          viewMode = 'editor';
        }}
        onClose={() => (viewMode = 'editor')}
      />
    {:else if activeNote}
      <MarkdownEditor
        note={activeNote}
        {captures}
        {notify}
        onNoteChange={() => reloadData()}
      />
    {:else}
      <div class="no-note-selected">
        <Icon name="file-text" size={48} />
        <h3>{t('notes.noNoteSelected') || 'No note selected'}</h3>
        <p>{t('notes.noNoteSelectedDesc') || 'Select a note from the left sidebar or create a new one.'}</p>
        <button type="button" class="primary" onclick={() => handleCreateNote()}>
          <Icon name="plus" size={15} />
          <span>{t('notes.newNote') || 'Create New Note'}</span>
        </button>
      </div>
    {/if}
  </main>
</div>

{#if moveModalNote}
  <div class="modal-backdrop" onclick={() => (moveModalNote = null)} role="presentation">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="card" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" style="width:min(400px, 92vw); padding:16px; border-radius:12px; background:var(--surface); border:1px solid var(--border); box-shadow:var(--shadow-glass);">
      <div class="hstack" style="justify-content:space-between; margin-bottom:12px;">
        <strong style="font-size:14px;">{ui.lang === 'ar' ? 'نقل الملاحظة إلى مجلد' : 'Move Note to Folder'}</strong>
        <button class="icon-btn" onclick={() => (moveModalNote = null)} aria-label="إغلاق">
          <Icon name="x" size={15} />
        </button>
      </div>
      <p class="muted" style="font-size:12px; margin:0 0 10px;">
        {ui.lang === 'ar' ? 'الملاحظة:' : 'Note:'} <strong>{moveModalNote.title}</strong>
      </p>
      <div style="display:flex; flex-direction:column; gap:6px; max-height:260px; overflow-y:auto;">
        <button
          type="button"
          class="row clickable"
          style="padding:8px 10px; border-radius:6px; justify-content:flex-start; gap:8px;"
          onclick={() => executeMoveNote(null)}
        >
          <Icon name="file-text" size={14} />
          <span>{ui.lang === 'ar' ? 'الملاحظات الرئيسية (خارج أي مجلد)' : 'Root Notes (No Folder)'}</span>
        </button>
        {#each folders.filter((f) => !f.isProtected && !f.isDaily) as f (f.id)}
          <button
            type="button"
            class="row clickable"
            style="padding:8px 10px; border-radius:6px; justify-content:flex-start; gap:8px;"
            onclick={() => executeMoveNote(f.id)}
          >
            <Icon name="folder" size={14} />
            <span>{f.name}</span>
          </button>
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  .notes-workspace {
    display: flex;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: var(--bg);
  }

  .notes-sidebar {
    width: 320px;
    flex: none;
    border-inline-end: 1px solid var(--border);
    background: var(--surface);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .sidebar-header {
    padding: 12px;
    border-bottom: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: var(--surface-2, rgba(0,0,0,0.02));
  }
  .sidebar-title {
    font-size: 14px;
    font-weight: 600;
  }
  .badge {
    background: var(--surface-3, rgba(0,0,0,0.08));
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 99px;
  }

  .icon-action-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    cursor: pointer;
  }
  .new-note-btn {
    height: 26px !important;
    min-height: 26px !important;
    max-height: 26px !important;
    line-height: 1 !important;
    padding: 0 8px !important;
    font-size: 11.5px !important;
    white-space: nowrap !important;
    border-radius: 6px !important;
    flex-shrink: 0 !important;
    align-self: center !important;
  }

  .folder-row.drag-over {
    background: var(--accent-soft) !important;
    border: 1px dashed var(--accent) !important;
  }
  .folder-row.drag-over * {
    pointer-events: none;
  }

  .search-box {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
  }

  .view-mode-bar {
    display: flex;
    gap: 4px;
    background: var(--surface-3, rgba(0, 0, 0, 0.06));
    padding: 2px;
    border-radius: 7px;
  }
  .view-tab-btn {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    padding: 5px 8px;
    font-size: 11.5px;
    font-weight: 500;
    border-radius: 5px;
    border: none;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .view-tab-btn:hover {
    color: var(--text);
  }
  .view-tab-btn.active {
    background: var(--surface);
    color: var(--accent);
    font-weight: 600;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  }

  .search-box input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    font-size: 12px;
    color: var(--text);
  }
  .clear-search {
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--muted);
  }

  .create-folder-card {
    padding: 8px 12px;
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .card-caption {
    font-size: 11px;
    font-weight: 600;
    color: var(--accent);
  }
  .create-folder-card input {
    flex: 1;
    font-size: 12px;
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
  }

  .tree-container {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    scrollbar-width: thin;
  }

  .tree-root-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 12.5px;
    font-weight: 500;
    color: var(--text);
    transition: background 0.12s ease;
  }
  .tree-root-item:hover {
    background: var(--surface-2);
  }
  .tree-root-item.selected {
    background: var(--accent-light, rgba(59, 130, 246, 0.1));
    color: var(--accent);
    font-weight: 600;
  }

  .section-divider {
    font-size: 10.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--muted);
    padding: 6px 8px 2px;
  }

  .folder-tree-item {
    display: flex;
    flex-direction: column;
  }

  .folder-row {
    display: flex;
    align-items: center;
    padding: 4px 6px;
    border-radius: 6px;
    position: relative;
    padding-inline-start: calc(var(--depth) * 14px + 4px);
    transition: background 0.12s ease;
  }
  .folder-row:hover {
    background: var(--surface-2);
  }
  .folder-row.selected {
    background: var(--accent-light, rgba(59, 130, 246, 0.1));
    color: var(--accent);
  }

  .tree-arrow-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--muted);
  }
  .tree-bullet {
    font-weight: bold;
    font-size: 14px;
    color: var(--muted);
  }

  .folder-label-btn {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    background: transparent;
    border: none;
    cursor: pointer;
    color: inherit;
    text-align: start;
    font-size: 12.5px;
  }
  .folder-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .item-count {
    font-size: 11px;
    color: var(--muted);
  }

  .rename-input {
    flex: 1;
    font-size: 12px;
    padding: 2px 4px;
    border: 1px solid var(--accent);
    border-radius: 3px;
    background: var(--surface);
    color: var(--text);
  }

  .folder-hover-actions {
    display: none;
    align-items: center;
    gap: 2px;
  }
  .folder-row:hover .folder-hover-actions {
    display: flex;
  }

  .mini-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    background: transparent;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    color: var(--muted);
  }
  .mini-action:hover {
    background: var(--surface-3, rgba(0,0,0,0.1));
    color: var(--text);
  }
  .mini-action.danger:hover {
    color: #ef4444;
  }

  .folder-children {
    display: flex;
    flex-direction: column;
  }

  .note-tree-leaf {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    padding-inline-start: calc(var(--depth) * 14px + 22px);
    border-radius: 6px;
    font-size: 12px;
    cursor: pointer;
    color: var(--text);
    transition: background 0.12s ease;
  }
  .note-tree-leaf:hover {
    background: var(--surface-2);
  }
  .note-tree-leaf.active {
    background: var(--accent);
    color: #fff;
  }
  .leaf-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .leaf-delete {
    display: none;
    background: transparent;
    border: none;
    cursor: pointer;
    color: inherit;
    opacity: 0.7;
  }
  .note-tree-leaf:hover .leaf-delete {
    display: inline-flex;
  }
  .leaf-delete:hover {
    opacity: 1;
  }

  .notes-main-pane {
    flex: 1;
    min-width: 0;
    height: 100%;
    overflow: hidden;
  }

  .no-note-selected {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 12px;
    color: var(--muted);
    text-align: center;
    padding: 24px;
  }
  .no-note-selected h3 {
    margin: 0;
    color: var(--text);
  }
  .no-note-selected p {
    margin: 0;
    font-size: 13px;
    max-width: 320px;
  }
  .mobile-back-bar {
    display: none;
  }

  /* Mobile screen splitting rule: Never split vertically into columns on portrait phones! */
  @media (max-width: 768px) {
    .notes-workspace {
      position: relative;
    }
    .notes-workspace.mobile-show-tree .notes-sidebar {
      display: flex !important;
      width: 100% !important;
      flex: 1 !important;
      border-inline-end: none !important;
    }
    .notes-workspace.mobile-show-tree .notes-main-pane {
      display: none !important;
    }
    .notes-workspace.mobile-show-editor .notes-sidebar {
      display: none !important;
    }
    .notes-workspace.mobile-show-editor .notes-main-pane {
      display: flex !important;
      flex-direction: column !important;
      width: 100% !important;
      flex: 1 !important;
    }
    .mobile-back-bar {
      display: flex !important;
      align-items: center;
      padding: 6px 10px;
      background: var(--surface-2);
      border-bottom: 1px solid var(--border);
    }
    .back-to-tree-btn {
      background: transparent;
      border: none;
      color: var(--accent);
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
      border-radius: 6px;
    }
    .back-to-tree-btn:hover {
      background: var(--accent-soft);
    }
  }
</style>
