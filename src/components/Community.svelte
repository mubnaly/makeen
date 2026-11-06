<script>
  // src/components/Community.svelte — Makeen Open Community Shares Hub
  // Discover, share, and import playlists, PDFs, flashcard decks, and notes with 1-click.

  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { t, ui } from '../lib/lang.svelte.js';
  import {
    listCommunityShares,
    publishCommunityShare,
    importShareToMyLibrary,
    recordShareVisit
  } from '../lib/communityStore.js';
  import { listPlaylists, listDocuments } from '../lib/library.js';

  let { notify = () => {}, onOpenView = () => {} } = $props();

  let shares = $state([]);
  let searchQuery = $state('');
  let activeFilter = $state('all'); // 'all' | 'playlist' | 'pdf' | 'cards' | 'notes'
  let activeSort = $state('popular'); // 'popular' | 'rating' | 'newest'

  // Sharing Modal State
  let isShareModalOpen = $state(false);
  let newShareType = $state('playlist'); // 'playlist' | 'cards' | 'notes' | 'pdf'
  let newShareTitle = $state('');
  let newShareAuthor = $state('');
  let newShareDescription = $state('');
  let newShareUrls = $state('');
  let importingId = $state(null);

  async function reload() {
    shares = await listCommunityShares();
  }

  onMount(() => {
    reload();
  });

  const filteredShares = $derived.by(() => {
    let list = shares.filter((item) => {
      if (activeFilter !== 'all' && item.type !== activeFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = (item.title || '').toLowerCase().includes(q) || (item.titleEn || '').toLowerCase().includes(q);
        const matchAuthor = (item.author || '').toLowerCase().includes(q);
        const matchDesc = (item.description || '').toLowerCase().includes(q);
        return matchTitle || matchAuthor || matchDesc;
      }
      return true;
    });

    if (activeSort === 'popular') {
      list = [...list].sort((a, b) => (b.visits || 0) - (a.visits || 0));
    } else if (activeSort === 'rating') {
      list = [...list].sort((a, b) => (b.rating || 0) - (a.rating || 0));
    } else if (activeSort === 'newest') {
      list = [...list].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    }

    return list;
  });

  async function handleImport(share) {
    importingId = share.id;
    try {
      const res = await importShareToMyLibrary(share);
      if (res.ok) {
        notify(t('community.addedToLibrary') || 'تمت الإضافة إلى مكتبتك بنجاح!', 'ok');
        reload();
      }
    } catch (e) {
      notify(String(e.message || e), 'error');
    } finally {
      importingId = null;
    }
  }

  async function handlePublish() {
    if (!newShareTitle.trim()) return;

    let playlistData = null;
    if (newShareType === 'playlist') {
      const urls = newShareUrls.split('\n').map((u) => u.trim()).filter(Boolean);
      playlistData = {
        title: newShareTitle.trim(),
        videoUrls: urls.length ? urls : ['https://www.youtube.com/watch?v=zOjov-2OZ0E']
      };
    }

    await publishCommunityShare({
      type: newShareType,
      title: newShareTitle.trim(),
      author: newShareAuthor.trim() || (ui.lang === 'ar' ? 'طالب مَكِين' : 'Makeen Learner'),
      description: newShareDescription.trim(),
      itemsCount: newShareType === 'playlist' ? (playlistData?.videoUrls?.length || 1) : 1,
      playlistData
    });

    newShareTitle = '';
    newShareAuthor = '';
    newShareDescription = '';
    newShareUrls = '';
    isShareModalOpen = false;
    await reload();
    notify(t('community.publishedSuccess') || 'تم نشر المحتوى بنجاح في المجتمع المفتوح!', 'ok');
  }

  function typeIcon(type) {
    if (type === 'playlist') return 'video';
    if (type === 'cards') return 'flashcards';
    if (type === 'notes') return 'file-text';
    return 'reader';
  }

  function typeLabel(type) {
    if (type === 'playlist') return t('community.filterPlaylists');
    if (type === 'cards') return t('community.filterCards');
    if (type === 'notes') return t('community.filterNotes');
    return t('community.filterPdfs');
  }
</script>

<div class="community-page" dir={ui.dir}>
  <!-- Header Banner -->
  <header class="community-header">
    <div class="community-hero">
      <div class="hero-badge">
        <Icon name="globe" size={14} />
        <span>{ui.lang === 'ar' ? 'محتوى مفتوح وتشاركي للجميع' : 'Open Community Hub'}</span>
      </div>
      <h2>{t('community.title')}</h2>
      <p class="muted">{t('community.subtitle')}</p>
    </div>
    <button class="primary share-trigger-btn hstack" onclick={() => (isShareModalOpen = true)}>
      <Icon name="plus" size={16} />
      <span>{t('community.shareContent')}</span>
    </button>
  </header>

  <!-- Search & Filter Controls -->
  <div class="controls-card card">
    <div class="search-row">
      <div class="search-input-box">
        <Icon name="search" size={16} />
        <input
          type="text"
          placeholder={t('community.searchPlaceholder')}
          bind:value={searchQuery}
        />
        {#if searchQuery}
          <button class="clear-btn" onclick={() => (searchQuery = '')}>
            <Icon name="x" size={13} />
          </button>
        {/if}
      </div>

      <!-- Sorting Pill Bar -->
      <div class="sort-bar">
        <button
          class="sort-btn {activeSort === 'popular' ? 'active' : ''}"
          onclick={() => (activeSort = 'popular')}
        >
          <Icon name="flame" size={13} />
          <span>{t('community.sortMostPopular')}</span>
        </button>
        <button
          class="sort-btn {activeSort === 'rating' ? 'active' : ''}"
          onclick={() => (activeSort = 'rating')}
        >
          <Icon name="star" size={13} />
          <span>{t('community.sortTopRated')}</span>
        </button>
        <button
          class="sort-btn {activeSort === 'newest' ? 'active' : ''}"
          onclick={() => (activeSort = 'newest')}
        >
          <span>{t('community.sortNewest')}</span>
        </button>
      </div>
    </div>

    <!-- Category Type Filters -->
    <div class="filter-tabs-row">
      <button
        class="tab-btn {activeFilter === 'all' ? 'active' : ''}"
        onclick={() => (activeFilter = 'all')}
      >
        {t('community.filterAll')}
      </button>
      <button
        class="tab-btn {activeFilter === 'playlist' ? 'active' : ''}"
        onclick={() => (activeFilter = 'playlist')}
      >
        <Icon name="video" size={13} />
        <span>{t('community.filterPlaylists')}</span>
      </button>
      <button
        class="tab-btn {activeFilter === 'cards' ? 'active' : ''}"
        onclick={() => (activeFilter = 'cards')}
      >
        <Icon name="flashcards" size={13} />
        <span>{t('community.filterCards')}</span>
      </button>
      <button
        class="tab-btn {activeFilter === 'pdf' ? 'active' : ''}"
        onclick={() => (activeFilter = 'pdf')}
      >
        <Icon name="reader" size={13} />
        <span>{t('community.filterPdfs')}</span>
      </button>
      <button
        class="tab-btn {activeFilter === 'notes' ? 'active' : ''}"
        onclick={() => (activeFilter = 'notes')}
      >
        <Icon name="file-text" size={13} />
        <span>{t('community.filterNotes')}</span>
      </button>
    </div>
  </div>

  <!-- Shares Grid -->
  {#if filteredShares.length === 0}
    <div class="empty-state card">
      <Icon name="search" size={40} />
      <h3>{t('community.empty')}</h3>
      <p class="muted">{ui.lang === 'ar' ? 'جرب كلمات بحث مختلفة أو شارك أول حزمة في هذا التصنيف!' : 'Try different keywords or share the first item in this category!'}</p>
    </div>
  {:else}
    <div class="shares-grid">
      {#each filteredShares as item (item.id)}
        <div class="share-card card">
          {#if item.thumbnail}
            <div class="share-thumbnail-box">
              <img src={item.thumbnail} alt={item.title} class="share-thumbnail-img" loading="lazy" />
              <div class="thumbnail-overlay-badges">
                {#if item.badge}
                  <span class="highlight-badge">{item.badge}</span>
                {/if}
                <span class="type-badge youtube-badge"><Icon name="video" size={12} /> {item.channel || 'YouTube'}</span>
              </div>
            </div>
          {:else}
            <div class="share-card-top">
              <div class="share-icon-wrap {item.type}">
                <Icon name={typeIcon(item.type)} size={22} />
              </div>
              <div class="share-badges hstack" style="gap:6px;">
                {#if item.badge}
                  <span class="highlight-badge">{item.badge}</span>
                {/if}
                <span class="type-badge">{typeLabel(item.type)}</span>
              </div>
            </div>
          {/if}

          <div class="share-card-body">
            <h4 class="share-title">{ui.lang === 'ar' ? item.title : (item.titleEn || item.title)}</h4>
            <div class="share-author muted">
              <Icon name="user" size={12} />
              <span>{ui.lang === 'ar' ? item.author : (item.authorEn || item.author)}</span>
            </div>
            <p class="share-desc">{ui.lang === 'ar' ? item.description : (item.descriptionEn || item.description)}</p>
          </div>

          <div class="share-card-footer">
            <div class="share-meta hstack" style="gap:12px;">
              <span class="meta-item hstack" style="gap:4px;" title={t('community.viewsCount', { n: item.visits })}>
                <Icon name="eye" size={13} />
                <span>{item.visits}</span>
              </span>
              <span class="meta-item hstack" style="gap:3px;" title="Rating">
                <Icon name="star" size={13} />
                <span>{item.rating}</span>
              </span>
              <span class="meta-item hstack" style="gap:4px;">
                <span>{t('community.itemsCount', { n: item.itemsCount })}</span>
              </span>
            </div>

            <button
              class="primary small import-btn hstack"
              onclick={() => handleImport(item)}
              disabled={importingId === item.id}
            >
              <Icon name={importingId === item.id ? 'check' : 'plus'} size={14} />
              <span>{importingId === item.id ? (ui.lang === 'ar' ? 'تمت الإضافة' : 'Added') : t('community.addToMyLibrary')}</span>
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  <!-- Share Content Modal Dialog -->
  {#if isShareModalOpen}
    <div class="modal-backdrop" onclick={() => (isShareModalOpen = false)} role="presentation"></div>
    <div class="share-modal card" role="dialog" aria-modal="true" aria-label={t('community.shareModalTitle')}>
      <div class="modal-header">
        <div class="hstack" style="gap:8px;">
          <Icon name="globe" size={18} />
          <h3>{t('community.shareModalTitle')}</h3>
        </div>
        <button class="icon-btn" onclick={() => (isShareModalOpen = false)}>
          <Icon name="x" size={16} />
        </button>
      </div>

      <div class="modal-body">
        <label class="field-label">{t('community.shareType')}</label>
        <div class="type-picker-row">
          <button
            type="button"
            class="type-pill {newShareType === 'playlist' ? 'active' : ''}"
            onclick={() => (newShareType = 'playlist')}
          >
            <Icon name="video" size={14} />
            <span>{t('community.filterPlaylists')}</span>
          </button>
          <button
            type="button"
            class="type-pill {newShareType === 'cards' ? 'active' : ''}"
            onclick={() => (newShareType = 'cards')}
          >
            <Icon name="flashcards" size={14} />
            <span>{t('community.filterCards')}</span>
          </button>
          <button
            type="button"
            class="type-pill {newShareType === 'notes' ? 'active' : ''}"
            onclick={() => (newShareType = 'notes')}
          >
            <Icon name="file-text" size={14} />
            <span>{t('community.filterNotes')}</span>
          </button>
        </div>

        <label class="field-label">{t('community.shareTitle')}</label>
        <input
          type="text"
          placeholder={ui.lang === 'ar' ? 'مثال: سلسلة شرح الرياضيات للمرحلة الجامعية…' : 'e.g. Calculus & Linear Algebra Mastery…'}
          bind:value={newShareTitle}
        />

        <label class="field-label">{t('community.shareAuthor')}</label>
        <input
          type="text"
          placeholder={ui.lang === 'ar' ? 'اسمك أو اسم القناة/المعلم…' : 'Your name or channel name…'}
          bind:value={newShareAuthor}
        />

        <label class="field-label">{t('community.shareDescription')}</label>
        <textarea
          rows="3"
          placeholder={ui.lang === 'ar' ? 'اكتب نبذة عن هذا المحتوى وما سيتعلمه الطالب منه…' : 'Brief overview of this curriculum…'}
          bind:value={newShareDescription}
        ></textarea>

        {#if newShareType === 'playlist'}
          <label class="field-label">{ui.lang === 'ar' ? 'روابط الفيديوهات (رابط في كل سطر)' : 'Video URLs (one per line)'}</label>
          <textarea
            rows="3"
            placeholder="https://www.youtube.com/watch?v=...&#10;https://www.youtube.com/watch?v=..."
            bind:value={newShareUrls}
          ></textarea>
        {/if}
      </div>

      <div class="modal-footer hstack" style="justify-content:flex-end; gap:8px;">
        <button type="button" class="secondary" onclick={() => (isShareModalOpen = false)}>
          {t('common.cancel')}
        </button>
        <button
          type="button"
          class="primary"
          onclick={handlePublish}
          disabled={!newShareTitle.trim()}
        >
          <Icon name="upload" size={14} />
          <span>{t('community.publishShare')}</span>
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .community-page {
    max-width: 1080px;
    margin: 0 auto;
    padding-bottom: 40px;
  }

  .community-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 20px;
    flex-wrap: wrap;
  }
  .community-hero {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .hero-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--accent-soft);
    color: var(--accent);
    padding: 3px 10px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
    width: fit-content;
  }
  .community-hero h2 {
    margin: 0;
    font-size: 24px;
    font-weight: 800;
    letter-spacing: -0.5px;
  }
  .community-hero p {
    margin: 0;
    font-size: 13.5px;
  }

  .controls-card {
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-bottom: 20px;
  }
  .search-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }
  .search-input-box {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 8px 12px;
    flex: 1;
    min-width: 240px;
  }
  .search-input-box input {
    background: transparent;
    border: none;
    outline: none;
    width: 100%;
    font-size: 13.5px;
    color: var(--text);
  }
  .clear-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--muted);
    padding: 2px;
  }

  .sort-bar {
    display: flex;
    align-items: center;
    gap: 4px;
    background: var(--surface-2);
    padding: 3px;
    border-radius: var(--radius);
    overflow-x: auto;
  }
  .sort-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: transparent;
    border: none;
    color: var(--muted);
    font-size: 12px;
    font-weight: 500;
    padding: 6px 10px;
    border-radius: 7px;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.15s;
  }
  .sort-btn.active {
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
    font-weight: 600;
  }

  .filter-tabs-row {
    display: flex;
    align-items: center;
    gap: 6px;
    overflow-x: auto;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
    padding-top: 4px;
  }
  .filter-tabs-row::-webkit-scrollbar {
    display: none;
  }
  .tab-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 5px 12px;
    font-size: 12.5px;
    font-weight: 500;
    color: var(--muted);
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.15s;
    flex: none;
  }
  .tab-btn:hover {
    color: var(--text);
    border-color: var(--accent);
  }
  .tab-btn.active {
    background: var(--accent);
    color: #fff;
    border-color: var(--accent);
    font-weight: 600;
  }

  /* Shares Grid */
  .shares-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 16px;
  }
  .share-card {
    display: flex;
    flex-direction: column;
    padding: 18px;
    border-radius: var(--radius-lg);
    background: var(--surface);
    border: 1px solid var(--border);
    transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .share-card:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-glass, var(--shadow));
  }
  .share-thumbnail-box {
    position: relative;
    width: 100%;
    height: 150px;
    border-radius: var(--radius);
    overflow: hidden;
    margin-bottom: 12px;
    background: #000;
  }
  .share-thumbnail-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 0.3s ease;
  }
  .share-card:hover .share-thumbnail-img {
    transform: scale(1.04);
  }
  .thumbnail-overlay-badges {
    position: absolute;
    bottom: 8px;
    left: 8px;
    right: 8px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    pointer-events: none;
    gap: 6px;
  }
  .type-badge.youtube-badge {
    background: rgba(0, 0, 0, 0.75);
    color: #fff;
    border: 1px solid rgba(255, 255, 255, 0.2);
    backdrop-filter: blur(8px);
  }
  .share-card-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }
  .share-icon-wrap {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    display: grid;
    place-items: center;
    background: var(--surface-2);
    color: var(--accent);
  }
  .share-icon-wrap.playlist { background: rgba(59, 130, 246, 0.12); color: #3b82f6; }
  .share-icon-wrap.cards { background: rgba(16, 185, 129, 0.12); color: #10b981; }
  .share-icon-wrap.notes { background: rgba(168, 85, 247, 0.12); color: #a855f7; }
  .share-icon-wrap.pdf { background: rgba(245, 158, 11, 0.12); color: #f59e0b; }

  .highlight-badge {
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 11px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 999px;
  }
  .type-badge {
    background: var(--surface-2);
    color: var(--muted);
    font-size: 11px;
    font-weight: 500;
    padding: 2px 8px;
    border-radius: 999px;
  }

  .share-card-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .share-title {
    margin: 0;
    font-size: 15.5px;
    font-weight: 700;
    line-height: 1.4;
  }
  .share-author {
    font-size: 12px;
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .share-desc {
    margin: 4px 0 0;
    font-size: 12.5px;
    color: var(--muted);
    line-height: 1.5;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .share-card-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 16px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
    flex-wrap: wrap;
    gap: 10px;
  }
  .share-meta {
    font-size: 12px;
    color: var(--muted);
  }

  /* Modal */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
    z-index: 1500;
  }
  .share-modal {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(520px, 92vw);
    max-height: 90vh;
    overflow-y: auto;
    z-index: 1600;
    padding: 20px;
    border-radius: var(--radius-lg);
    display: flex;
    flex-direction: column;
    gap: 14px;
    box-shadow: var(--shadow-glass);
    animation: modal-scale-in 0.25s cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--border);
  }
  .modal-header h3 {
    margin: 0;
    font-size: 17px;
  }
  .modal-body {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .field-label {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text);
  }
  .type-picker-row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .type-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--surface-2);
    color: var(--text);
    cursor: pointer;
    font-size: 12.5px;
    transition: all 0.15s;
  }
  .type-pill.active {
    background: var(--accent);
    color: #fff;
    border-color: var(--accent);
  }

  .share-modal input,
  .share-modal textarea {
    width: 100%;
    padding: 8px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface-2);
    color: var(--text);
    font-family: inherit;
    font-size: 13px;
    box-sizing: border-box;
  }

  .icon-btn {
    background: transparent;
    border: none;
    color: var(--muted);
    cursor: pointer;
    padding: 4px;
  }

  .empty-state {
    text-align: center;
    padding: 40px 20px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    color: var(--muted);
  }

  @media (max-width: 640px) {
    .shares-grid {
      grid-template-columns: 1fr;
    }
    .share-card-footer {
      flex-direction: column;
      align-items: stretch;
    }
    .import-btn {
      width: 100%;
      justify-content: center;
    }
  }
</style>
