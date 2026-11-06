<script>
  import Icon from './Icon.svelte';
  import EmptyState from './EmptyState.svelte';
  import { t, ui } from '../lib/lang.svelte.js';
  import {
    listTrash, restoreTrashItem, deleteTrashPermanently, emptyAllTrash,
    loadTrashRetentionDays, listArchivedContent, removeArchivedContent
  } from '../lib/trash.js';

  let {
    notify,
    onRestoreDoc = null,
    onRestoreProject = null,
    onRestoreDeck = null
  } = $props();

  let trashItems = $state(listTrash());
  let archivedItems = $state(listArchivedContent());
  let retentionDays = $state(loadTrashRetentionDays());
  let filterKind = $state('all'); // 'all' | 'video' | 'pdf' | 'project' | 'deck'
  let searchQuery = $state('');
  let previewItem = $state(null);

  function refresh() {
    trashItems = listTrash();
    archivedItems = listArchivedContent();
    retentionDays = loadTrashRetentionDays();
  }

  const filteredTrash = $derived(
    trashItems.filter((item) => {
      if (filterKind !== 'all' && item.kind !== filterKind) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (item.title || '').toLowerCase().includes(q);
      }
      return true;
    })
  );

  function handleRestore(item) {
    const restored = restoreTrashItem(item.id);
    if (!restored) return;
    refresh();
    if (item.kind === 'project') {
      onRestoreProject?.(item.originalItem);
    } else if (item.kind === 'deck') {
      onRestoreDeck?.(item.originalItem);
    } else {
      onRestoreDoc?.(item.originalItem);
    }
    notify(t('trash.restoredSuccess', { title: item.title }), 'ok');
  }

  function handleDelete(item) {
    if (!confirm(t('trash.confirmDeleteOne', { title: item.title }))) return;
    deleteTrashPermanently(item.id);
    refresh();
    notify(t('trash.deletedPermanently'), 'ok');
  }

  function handleEmptyAll() {
    if (!trashItems.length) return;
    if (!confirm(t('trash.confirmEmptyAll'))) return;
    emptyAllTrash();
    refresh();
    notify(t('trash.emptiedAll'), 'ok');
  }

  function handleRemoveArchive(id) {
    removeArchivedContent(id);
    refresh();
    notify(t('trash.archiveRemoved'), 'ok');
  }

  function formatDaysRemaining(deletedAt, daysLimit) {
    if (!daysLimit || daysLimit <= 0) return t('trash.neverExpires');
    const elapsedMs = Date.now() - (deletedAt || 0);
    const totalMs = daysLimit * 24 * 60 * 60 * 1000;
    const remainingMs = Math.max(0, totalMs - elapsedMs);
    const remDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
    return t('trash.daysRemaining', { count: remDays });
  }

  function formatDate(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleDateString(ui.lang === 'ar' ? 'ar-EG' : 'en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }
</script>

<div class="trash-page" dir={ui.dir}>
  <header class="trash-header">
    <div class="header-titles">
      <div class="title-with-badge">
        <h2>{t('trash.title')}</h2>
        {#if trashItems.length}
          <span class="count-badge">{trashItems.length}</span>
        {/if}
      </div>
      <p class="subtitle">
        {retentionDays > 0 ? t('trash.autoPurgeInfo', { days: retentionDays }) : t('trash.noAutoPurgeInfo')}
      </p>
    </div>

    <div class="header-actions">
      {#if trashItems.length}
        <button class="danger-btn" onclick={handleEmptyAll}>
          <Icon name="trash" size={15} />
          <span>{t('trash.emptyAll')}</span>
        </button>
      {/if}
    </div>
  </header>

  <!-- Filter & Search Toolbar -->
  <div class="toolbar">
    <div class="filter-tabs">
      <button class={filterKind === 'all' ? 'active' : ''} onclick={() => filterKind = 'all'}>
        {t('trash.all')} ({trashItems.length})
      </button>
      <button class={filterKind === 'video' ? 'active' : ''} onclick={() => filterKind = 'video'}>
        <Icon name="video" size={14} /> {t('trash.videos')}
      </button>
      <button class={filterKind === 'pdf' ? 'active' : ''} onclick={() => filterKind = 'pdf'}>
        <Icon name="reader" size={14} /> {t('trash.pdfs')}
      </button>
      <button class={filterKind === 'project' ? 'active' : ''} onclick={() => filterKind = 'project'}>
        <Icon name="projects" size={14} /> {t('trash.projects')}
      </button>
    </div>

    <div class="search-box">
      <Icon name="search" size={14} />
      <input type="text" placeholder={t('trash.searchPlaceholder')} bind:value={searchQuery} />
    </div>
  </div>

  <!-- Trash Items Grid -->
  {#if filteredTrash.length === 0}
    <div class="empty-wrap">
      <EmptyState
        icon="trash"
        title={t('trash.emptyTitle')}
        description={t('trash.emptyDescription')}
      />
    </div>
  {:else}
    <div class="trash-grid">
      {#each filteredTrash as item (item.id)}
        <div class="trash-card">
          <div class="card-icon">
            <Icon name={item.kind === 'video' ? 'video' : item.kind === 'project' ? 'projects' : 'reader'} size={24} />
          </div>

          <div class="card-info">
            <h4 class="card-title" title={item.title}>{item.title}</h4>
            <div class="card-meta">
              <span class="meta-date">{t('trash.deletedAt')}: {formatDate(item.deletedAt)}</span>
              <span class="meta-rem">{formatDaysRemaining(item.deletedAt, retentionDays)}</span>
            </div>

            <!-- Preserved study content tags -->
            {#if item.preservedContent}
              <div class="preserved-tags">
                {#if item.preservedContent.notes?.length}
                  <span class="badge" title={t('trash.notesCount')}>
                    <Icon name="file-text" size={12} /> {item.preservedContent.notes.length} {t('trash.notes')}
                  </span>
                {/if}
                {#if item.preservedContent.captures?.length}
                  <span class="badge" title={t('trash.capturesCount')}>
                    <Icon name="camera" size={12} /> {item.preservedContent.captures.length} {t('trash.captures')}
                  </span>
                {/if}
                {#if item.preservedContent.bookmarks?.length}
                  <span class="badge" title={t('trash.bookmarksCount')}>
                    <Icon name="bookmark" size={12} /> {item.preservedContent.bookmarks.length} {t('trash.bookmarks')}
                  </span>
                {/if}
              </div>
            {/if}
          </div>

          <div class="card-actions">
            {#if item.preservedContent && (item.preservedContent.notes?.length || item.preservedContent.captures?.length)}
              <button class="secondary small" onclick={() => previewItem = item} title={t('trash.previewContent')}>
                <Icon name="eye" size={14} />
                <span>{t('trash.preview')}</span>
              </button>
            {/if}

            <button class="primary small" onclick={() => handleRestore(item)} title={t('trash.restore')}>
              <Icon name="check" size={14} />
              <span>{t('trash.restore')}</span>
            </button>

            <button class="icon-btn small danger" onclick={() => handleDelete(item)} title={t('trash.deletePermanently')}>
              <Icon name="trash" size={14} />
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  <!-- Preserved Archived Content Section (Past completed videos) -->
  {#if archivedItems.length > 0}
    <section class="archived-section">
      <div class="section-head">
        <div class="title-with-badge">
          <h3><Icon name="projects" size={16} /> <span>{t('trash.archivedTitle')}</span></h3>
          <span class="count-badge">{archivedItems.length}</span>
        </div>
        <p class="subtitle">{t('trash.archivedSubtitle')}</p>
      </div>

      <div class="archived-grid">
        {#each archivedItems as arch (arch.id)}
          <div class="arch-card">
            <div class="arch-info">
              <h4>{arch.title}</h4>
              <div class="preserved-tags">
                {#if arch.content?.notes?.length}
                  <span class="badge"><Icon name="file-text" size={12} /> {arch.content.notes.length} {t('trash.notes')}</span>
                {/if}
                {#if arch.content?.captures?.length}
                  <span class="badge"><Icon name="camera" size={12} /> {arch.content.captures.length} {t('trash.captures')}</span>
                {/if}
                {#if arch.content?.cards?.length}
                  <span class="badge"><Icon name="flashcards" size={12} /> {arch.content.cards.length} {t('nav.flashcards')}</span>
                {/if}
              </div>
            </div>
            <div class="arch-actions">
              <button class="secondary small" onclick={() => previewItem = { title: arch.title, preservedContent: arch.content }}>
                <Icon name="eye" size={14} /> <span>{t('trash.preview')}</span>
              </button>
              <button class="icon-btn small danger" onclick={() => handleRemoveArchive(arch.id)}>
                <Icon name="trash" size={14} />
              </button>
            </div>
          </div>
        {/each}
      </div>
    </section>
  {/if}

  <!-- Preserved Content Preview Modal -->
  {#if previewItem}
    <div class="modal-backdrop" onclick={() => previewItem = null}>
      <div class="preview-modal" onclick={(e) => e.stopPropagation()}>
        <header class="modal-head">
          <div class="modal-title">
            <Icon name="library" size={18} />
            <h3>{previewItem.title} — {t('trash.preservedContentTitle')}</h3>
          </div>
          <button class="icon-btn" onclick={() => previewItem = null}><Icon name="x" size={18} /></button>
        </header>

        <div class="modal-body" use:autoScrollbar>
          <!-- Notes -->
          {#if previewItem.preservedContent?.notes?.length}
            <div class="content-group">
              <h4><Icon name="file-text" size={14} /> <span>{t('trash.notes')} ({previewItem.preservedContent.notes.length})</span></h4>
              <div class="notes-list">
                {#each previewItem.preservedContent.notes as note}
                  <div class="note-box">
                    {#if note.heading && note.heading !== 'p'}
                      <div class="note-heading">{note.heading.toUpperCase()}: {note.text}</div>
                    {:else}
                      <p class="note-text">{note.text}</p>
                    {/if}
                    {#if note.image}
                      <img class="note-img" src={note.image} alt="Note capture" />
                    {/if}
                  </div>
                {/each}
              </div>
            </div>
          {/if}

          <!-- Captures -->
          {#if previewItem.preservedContent?.captures?.length}
            <div class="content-group">
              <h4><Icon name="camera" size={14} /> <span>{t('trash.captures')} ({previewItem.preservedContent.captures.length})</span></h4>
              <div class="captures-gallery">
                {#each previewItem.preservedContent.captures as cap}
                  <div class="cap-card">
                    <img src={cap.image} alt={cap.title || 'Capture'} />
                    {#if cap.title}
                      <span class="cap-label">{cap.title}</span>
                    {/if}
                  </div>
                {/each}
              </div>
            </div>
          {/if}

          <!-- Flashcards -->
          {#if previewItem.preservedContent?.cards?.length}
            <div class="content-group">
              <h4><Icon name="flashcards" size={14} /> <span>{t('nav.flashcards')} ({previewItem.preservedContent.cards.length})</span></h4>
              <div class="cards-preview-list">
                {#each previewItem.preservedContent.cards as card}
                  <div class="card-mini-box">
                    <div class="card-q"><strong>Q:</strong> {card.front || card.question || '...'}</div>
                    <div class="card-a"><strong>A:</strong> {card.back || card.answer || '...'}</div>
                  </div>
                {/each}
              </div>
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .trash-page {
    padding: 28px 36px;
    max-width: 1280px;
    margin: 0 auto;
    min-height: 100vh;
  }
  .trash-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 24px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--border);
  }
  .title-with-badge {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .title-with-badge h2 {
    margin: 0;
    font-size: 24px;
    font-weight: 700;
  }
  .title-with-badge h3 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
  }
  .count-badge {
    background: var(--surface-3, rgba(239, 68, 68, 0.15));
    color: #ef4444;
    font-size: 13px;
    font-weight: 600;
    padding: 2px 9px;
    border-radius: 999px;
  }
  .subtitle {
    margin: 4px 0 0;
    font-size: 13px;
    color: var(--muted);
  }
  .danger-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    background: rgba(239, 68, 68, 0.1);
    color: #ef4444;
    border: 1px solid rgba(239, 68, 68, 0.25);
    padding: 8px 14px;
    border-radius: var(--radius);
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
  }
  .danger-btn:hover {
    background: #ef4444;
    color: #fff;
  }
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 20px;
    flex-wrap: wrap;
  }
  .filter-tabs {
    display: flex;
    align-items: center;
    gap: 6px;
    background: var(--surface-2, rgba(0, 0, 0, 0.04));
    padding: 4px;
    border-radius: var(--radius);
    overflow-x: auto;
    max-width: 100%;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
    flex-wrap: nowrap;
  }
  .filter-tabs::-webkit-scrollbar {
    display: none;
  }
  .filter-tabs button {
    display: flex;
    align-items: center;
    gap: 6px;
    background: transparent;
    border: 0;
    color: var(--muted);
    padding: 6px 12px;
    font-size: 13px;
    border-radius: var(--radius-sm, 6px);
    cursor: pointer;
    font-weight: 500;
    flex: none;
    white-space: nowrap;
  }
  .filter-tabs button.active {
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  }
  .search-box {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 6px 12px;
    width: 260px;
    max-width: 100%;
  }
  .search-box input {
    background: transparent;
    border: 0;
    outline: none;
    font-size: 13px;
    width: 100%;
    color: var(--text);
  }
  .trash-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 14px;
  }
  .trash-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 16px;
    display: flex;
    gap: 14px;
    align-items: flex-start;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
  }
  .card-icon {
    width: 44px;
    height: 44px;
    border-radius: var(--radius);
    background: var(--surface-2, rgba(0, 0, 0, 0.04));
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--muted);
    flex-shrink: 0;
  }
  .card-info {
    flex: 1;
    min-width: 0;
  }
  .card-title {
    margin: 0 0 6px;
    font-size: 14px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .card-meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 12px;
    color: var(--muted);
    margin-bottom: 8px;
  }
  .meta-rem {
    color: #eab308;
    font-weight: 500;
  }
  .preserved-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .badge {
    background: var(--surface-2, rgba(0, 0, 0, 0.04));
    border: 1px solid var(--border);
    padding: 2px 7px;
    border-radius: 4px;
    font-size: 11px;
    color: var(--text);
  }
  .card-actions {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex-shrink: 0;
  }
  .card-actions button {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 6px 10px;
    font-size: 12px;
    border-radius: var(--radius-sm, 6px);
    cursor: pointer;
  }
  .archived-section {
    margin-top: 40px;
    padding-top: 24px;
    border-top: 1px solid var(--border);
  }
  .section-head {
    margin-bottom: 16px;
  }
  .archived-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 14px;
  }
  .arch-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 14px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .arch-info h4 {
    margin: 0 0 4px;
    font-size: 13px;
    font-weight: 600;
  }
  .arch-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .empty-wrap {
    padding: 60px 0;
  }

  /* Modal */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 99999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }
  .preview-modal {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    width: 100%;
    max-width: 800px;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
  }
  .modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border);
  }
  .modal-title {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .modal-title h3 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }
  .modal-body {
    padding: 20px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 24px;
  }
  .content-group h4 {
    margin: 0 0 12px;
    font-size: 14px;
    font-weight: 600;
    color: var(--muted);
  }
  .notes-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .note-box {
    background: var(--surface-2, rgba(0, 0, 0, 0.04));
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 12px;
  }
  .note-heading {
    font-weight: 700;
    margin-bottom: 6px;
  }
  .note-text {
    margin: 0;
    font-size: 13px;
    line-height: 1.6;
  }
  .note-img {
    max-width: 100%;
    border-radius: 6px;
    margin-top: 8px;
  }
  .captures-gallery {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 12px;
  }
  .cap-card {
    background: var(--surface-2, rgba(0, 0, 0, 0.04));
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }
  .cap-card img {
    width: 100%;
    aspect-ratio: 16 / 9;
    object-fit: cover;
    display: block;
  }
  .cap-label {
    display: block;
    padding: 6px 8px;
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cards-preview-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .card-mini-box {
    background: var(--surface-2, rgba(0, 0, 0, 0.04));
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 10px 14px;
    font-size: 13px;
  }
  .card-q {
    margin-bottom: 4px;
    color: var(--fg);
  }
  .card-a {
    color: var(--muted);
  }
</style>
