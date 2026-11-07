<script>
  // src/components/Community.svelte — Makeen Open Community Marketplace & Learning Hub
  // Discover, share, review, monetize, and import study resources.
  // Supports free preview vs paid access, receipt image verification, and anonymous publishing.

  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { t, ui } from '../lib/lang.svelte.js';
  import {
    listCommunityShares,
    publishCommunityShare,
    importShareToMyLibrary,
    recordShareVisit,
    clearAllCommunityData
  } from '../lib/communityStore.js';
  import {
    isContentUnlocked,
    submitPaymentOrder,
    listOrders,
    updateOrderStatus,
    addShareReview,
    getShareReviews
  } from '../lib/sessionStore.js';
  import { getCurrentUser } from '../lib/auth.js';

  let { notify = () => {}, onOpenView = () => {}, onRequestAuth = () => {} } = $props();

  let shares = $state([]);
  let searchQuery = $state('');
  let activeFilter = $state('all'); // 'all' | 'playlist' | 'pdf' | 'cards' | 'notes' | 'video'
  let activeSort = $state('popular'); // 'popular' | 'rating' | 'newest'

  // Sharing Modal State
  let isShareModalOpen = $state(false);
  let newShareType = $state('playlist'); // 'playlist' | 'pdf' | 'cards' | 'video' | 'notes'
  let newShareTitle = $state('');
  let newShareAuthor = $state('');
  let newShareDescription = $state('');
  let newShareUrls = $state('');
  let newShareIsPaid = $state(false);
  let newSharePrice = $state(50);
  let newShareIsAnonymous = $state(false);
  let newShareFile = $state(null);
  let newShareItems = $state([]); // [{ title, url, isFreePreview: true }]
  let isPublishing = $state(false);

  // Payment / Receipt Upload Modal State
  let isPaymentModalOpen = $state(false);
  let selectedShareForPayment = $state(null);
  let receiptImageBase64 = $state('');
  let buyerNote = $state('');
  let isSubmittingReceipt = $state(false);

  // Creator Order Verification Modal State
  let isOrdersModalOpen = $state(false);
  let pendingOrders = $state([]);
  let previewReceiptImg = $state(null);

  // Reviews Modal / State
  let activeReviewShare = $state(null);
  let reviewRating = $state(5);
  let reviewComment = $state('');
  let activeShareReviews = $state([]);

  let importingId = $state(null);

  const currentUser = $derived(getCurrentUser());
  const isGuest = $derived(!currentUser || currentUser.id === 'guest');

  async function reload() {
    shares = await listCommunityShares();
    pendingOrders = listOrders();
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

  // Count pending payments for creator's items
  const myPendingOrdersCount = $derived.by(() => {
    if (isGuest) return 0;
    const myShareIds = shares.filter((s) => s.creatorId === currentUser.id).map((s) => s.id);
    return pendingOrders.filter((o) => myShareIds.includes(o.shareId) && o.status === 'pending').length;
  });

  async function handleImport(share) {
    if (share.isPaid && !isContentUnlocked(share, currentUser)) {
      openPaymentModal(share);
      return;
    }

    importingId = share.id;
    try {
      const res = await importShareToMyLibrary(share);
      if (res.ok) {
        notify(t('community.addedToLibrary') || 'تمت الإضافة إلى مكتبتك بنجاح!', 'ok');
        await reload();
      }
    } catch (e) {
      if (e.message === 'CONTENT_LOCKED_PAYMENT_REQUIRED') {
        openPaymentModal(share);
      } else {
        notify(String(e.message || e), 'error');
      }
    } finally {
      importingId = null;
    }
  }

  function handleFileSelected(e) {
    const file = e.target?.files?.[0];
    if (!file) return;
    newShareFile = file;
    if (!newShareTitle.trim()) {
      newShareTitle = file.name.replace(/\.[^/.]+$/, '');
    }
  }

  function handleReceiptImageSelected(e) {
    const file = e.target?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      receiptImageBase64 = String(reader.result);
    };
    reader.readAsDataURL(file);
  }

  function openPaymentModal(share) {
    if (isGuest) {
      notify('يرجى تسجيل الدخول أو إنشاء حساب أولاً لحفظ المشتريات بحسابك', 'error');
      onRequestAuth?.();
      return;
    }
    selectedShareForPayment = share;
    receiptImageBase64 = '';
    buyerNote = '';
    isPaymentModalOpen = true;
  }

  async function handleSendReceipt() {
    if (!receiptImageBase64) {
      notify('يرجى اختيار صورة الإيصال أولاً', 'error');
      return;
    }
    isSubmittingReceipt = true;
    try {
      submitPaymentOrder({
        shareId: selectedShareForPayment.id,
        shareTitle: selectedShareForPayment.title,
        sharePrice: selectedShareForPayment.price,
        receiptImage: receiptImageBase64,
        buyerNote
      });
      notify('تم إرسال إيصال الدفع بنجاح! سيتم تفعيل المحتوى فور مراجعة الناشر.', 'ok');
      isPaymentModalOpen = false;
      await reload();
    } catch (err) {
      notify(String(err.message || err), 'error');
    } finally {
      isSubmittingReceipt = false;
    }
  }

  function handleOrderDecision(orderId, status) {
    const updated = updateOrderStatus(orderId, status);
    if (updated) {
      notify(status === 'accepted' ? 'تم قبول الإيصال وتفعيل المحتوى للطالب بنجاح!' : 'تم رفض الإيصال', 'ok');
      reload();
    }
  }

  function openReviewsModal(share) {
    activeReviewShare = share;
    activeShareReviews = getShareReviews(share.id);
    reviewRating = 5;
    reviewComment = '';
  }

  function handleAddReview() {
    if (!reviewComment.trim()) {
      notify('يرجى كتابة رأيك أو تعليقك قبل الإرسال', 'error');
      return;
    }
    addShareReview({
      shareId: activeReviewShare.id,
      rating: reviewRating,
      comment: reviewComment
    });
    notify('شكراً لمشاركتك! تم إضافة تقييمك للمجتمع.', 'ok');
    activeShareReviews = getShareReviews(activeReviewShare.id);
    reviewComment = '';
  }

  async function handlePublish() {
    if (!newShareTitle.trim()) return;

    isPublishing = true;
    try {
      let playlistData = null;
      let items = [];

      if (newShareType === 'playlist' || newShareType === 'video') {
        const rawUrls = newShareUrls.split('\n').map((u) => u.trim()).filter(Boolean);
        const finalUrls = rawUrls.length ? rawUrls : ['https://www.youtube.com/watch?v=zOjov-2OZ0E'];
        playlistData = {
          title: newShareTitle.trim(),
          videoUrls: finalUrls
        };
        // By default, the first item is marked as Free Preview so learners can try it
        items = finalUrls.map((u, i) => ({
          title: `${newShareTitle.trim()} - درس ${i + 1}`,
          url: u,
          isFreePreview: i === 0 || !newShareIsPaid
        }));
      }

      await publishCommunityShare({
        type: newShareType,
        title: newShareTitle.trim(),
        author: newShareAuthor.trim(),
        description: newShareDescription.trim(),
        isPaid: newShareIsPaid,
        price: newSharePrice,
        isAnonymous: newShareIsAnonymous,
        itemsCount: items.length || 1,
        items,
        playlistData,
        pdfData: newShareFile ? { name: newShareFile.name, size: newShareFile.size } : null
      });

      newShareTitle = '';
      newShareAuthor = '';
      newShareDescription = '';
      newShareUrls = '';
      newShareFile = null;
      newShareIsPaid = false;
      newShareIsAnonymous = false;
      isShareModalOpen = false;
      await reload();
      notify(t('community.publishedSuccess') || 'تم نشر المحتوى بنجاح في المجتمع المفتوح!', 'ok');
    } catch (e) {
      notify(String(e.message || e), 'error');
    } finally {
      isPublishing = false;
    }
  }

  async function handleClearData() {
    if (!confirm(t('community.clearDataConfirm') || 'هل أنت متأكد من حذف كافة بيانات المجتمع؟')) return;
    await clearAllCommunityData();
    await reload();
    notify('تم مسح بيانات المجتمع بنجاح', 'ok');
  }

  function typeIcon(type) {
    if (type === 'playlist' || type === 'video') return 'video';
    if (type === 'cards') return 'flashcards';
    if (type === 'notes') return 'file-text';
    return 'reader';
  }

  function typeLabel(type) {
    if (type === 'playlist') return t('community.filterPlaylists');
    if (type === 'cards') return t('community.filterCards');
    if (type === 'notes') return t('community.filterNotes');
    if (type === 'video') return 'فيديو فردي';
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

    <div class="hstack" style="gap:10px; flex-wrap:wrap;">
      {#if !isGuest}
        <button class="secondary hstack orders-badge-btn" onclick={() => (isOrdersModalOpen = true)}>
          <Icon name="check" size={15} />
          <span>{t('community.paymentRequests')}</span>
          {#if myPendingOrdersCount > 0}
            <span class="badge-pill">{myPendingOrdersCount}</span>
          {/if}
        </button>
      {/if}

      <button class="primary share-trigger-btn hstack" onclick={() => (isShareModalOpen = true)}>
        <Icon name="plus" size={16} />
        <span>{t('community.shareContent')}</span>
      </button>

      <button class="icon-btn danger" onclick={handleClearData} title="مسح محتوى المجتمع والبدء من جديد">
        <Icon name="trash" size={16} />
      </button>
    </div>
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
          class="sort-pill {activeSort === 'popular' ? 'active' : ''}"
          onclick={() => (activeSort = 'popular')}
        >
          <Icon name="flame" size={13} />
          <span>{t('community.sortMostPopular')}</span>
        </button>
        <button
          class="sort-pill {activeSort === 'rating' ? 'active' : ''}"
          onclick={() => (activeSort = 'rating')}
        >
          <Icon name="star" size={13} />
          <span>{t('community.sortTopRated')}</span>
        </button>
        <button
          class="sort-pill {activeSort === 'newest' ? 'active' : ''}"
          onclick={() => (activeSort = 'newest')}
        >
          <Icon name="clock" size={13} />
          <span>{t('community.sortNewest')}</span>
        </button>
      </div>
    </div>

    <!-- Filter Buttons Bar with Horizontal Scroll for Mobile -->
    <div class="filter-bar">
      <button
        class="filter-pill {activeFilter === 'all' ? 'active' : ''}"
        onclick={() => (activeFilter = 'all')}
      >
        <span>{t('community.filterAll')}</span>
        <span class="count-bubble">{shares.length}</span>
      </button>

      <button
        class="filter-pill {activeFilter === 'playlist' ? 'active' : ''}"
        onclick={() => (activeFilter = 'playlist')}
      >
        <Icon name="video" size={14} />
        <span>{t('community.filterPlaylists')}</span>
      </button>

      <button
        class="filter-pill {activeFilter === 'pdf' ? 'active' : ''}"
        onclick={() => (activeFilter = 'pdf')}
      >
        <Icon name="reader" size={14} />
        <span>{t('community.filterPdfs')}</span>
      </button>

      <button
        class="filter-pill {activeFilter === 'cards' ? 'active' : ''}"
        onclick={() => (activeFilter = 'cards')}
      >
        <Icon name="flashcards" size={14} />
        <span>{t('community.filterCards')}</span>
      </button>

      <button
        class="filter-pill {activeFilter === 'notes' ? 'active' : ''}"
        onclick={() => (activeFilter = 'notes')}
      >
        <Icon name="file-text" size={14} />
        <span>{t('community.filterNotes')}</span>
      </button>
    </div>
  </div>

  <!-- Shares Grid -->
  {#if filteredShares.length === 0}
    <div class="empty-state card">
      <Icon name="globe" size={42} />
      <h3>{t('community.empty')}</h3>
      <p class="muted">كن أول من يشارك محتوى تعليمي مفيد مع زملائك بالضغط على زر "مشاركة محتوى في المجتمع".</p>
      <button class="primary mt" onclick={() => (isShareModalOpen = true)}>
        <Icon name="plus" size={15} />
        <span>{t('community.shareContent')}</span>
      </button>
    </div>
  {:else}
    <div class="shares-grid">
      {#each filteredShares as item (item.id)}
        {@const unlocked = isContentUnlocked(item, currentUser)}
        <div class="share-card card">
          <!-- Thumbnail & Badges -->
          <div class="share-media-container">
            {#if item.thumbnail}
              <img src={item.thumbnail} alt={item.title} class="share-thumb-img" loading="lazy" />
            {:else}
              <div class="share-thumb-placeholder">
                <Icon name={typeIcon(item.type)} size={32} />
              </div>
            {/if}

            <span class="type-badge-floating hstack">
              <Icon name={typeIcon(item.type)} size={12} />
              <span>{typeLabel(item.type)}</span>
            </span>

            {#if item.isPaid}
              <span class="price-badge-floating {unlocked ? 'unlocked' : 'locked'}">
                {#if unlocked}
                  <Icon name="check" size={12} />
                  <span>مُفعل</span>
                {:else}
                  <span>{item.price} {item.currency || 'EGP'}</span>
                {/if}
              </span>
            {:else}
              <span class="price-badge-floating free">
                <span>{t('community.free')}</span>
              </span>
            {/if}
          </div>

          <div class="share-card-body">
            <h4 class="share-title">{ui.lang === 'en' && item.titleEn ? item.titleEn : item.title}</h4>
            <p class="share-description muted">{ui.lang === 'en' && item.descriptionEn ? item.descriptionEn : item.description}</p>

            <!-- Free Preview Items Pill List (if paid) -->
            {#if item.items && item.items.length > 0}
              <div class="preview-items-row">
                {#each item.items.slice(0, 3) as subItem, idx}
                  <span class="subitem-pill {subItem.isFreePreview ? 'free-preview' : 'paid-locked'}">
                    <Icon name={subItem.isFreePreview ? 'play' : 'lock'} size={11} />
                    <span>{subItem.title || `درس ${idx + 1}`}</span>
                    {#if subItem.isFreePreview}
                      <small class="free-tag">مجاني</small>
                    {/if}
                  </span>
                {/each}
                {#if item.items.length > 3}
                  <span class="more-subitems">+{item.items.length - 3} دروس أخرى</span>
                {/if}
              </div>
            {/if}

            <div class="share-author-row hstack">
              <div class="author-avatar-circle">
                {#if item.isAnonymous}
                  <Icon name="user" size={13} />
                {:else if item.authorAvatar}
                  <img src={item.authorAvatar} alt="Avatar" class="avatar-mini" />
                {:else}
                  <Icon name="user" size={13} />
                {/if}
              </div>
              <span class="author-name">{item.author}</span>
            </div>
          </div>

          <div class="share-card-footer">
            <div class="share-stats hstack">
              <button class="review-stat-btn hstack" onclick={() => openReviewsModal(item)} title="عرض التقييمات والآراء">
                <Icon name="star" size={13} />
                <span>{Number(item.rating || 5).toFixed(1)}</span>
              </button>
              <span class="meta-dot">·</span>
              <span class="stat-item hstack" title="عدد الزيارات">
                <Icon name="eye" size={13} />
                <span>{item.visits || 1}</span>
              </span>
            </div>

            <div class="hstack" style="gap:6px;">
              {#if item.isPaid && !unlocked}
                <button
                  class="secondary small buy-btn hstack"
                  onclick={() => openPaymentModal(item)}
                >
                  <Icon name="upload" size={13} />
                  <span>شراء / رفع إيصال</span>
                </button>
              {/if}

              <button
                class="primary small import-btn hstack"
                onclick={() => handleImport(item)}
                disabled={importingId === item.id}
              >
                <Icon name={importingId === item.id ? 'check' : (item.isPaid && !unlocked ? 'unlock' : 'plus')} size={14} />
                <span>
                  {#if importingId === item.id}
                    {ui.lang === 'ar' ? 'تمت الإضافة' : 'Added'}
                  {:else if item.isPaid && !unlocked}
                    {ui.lang === 'ar' ? 'معاينة مجانية' : 'Free Preview'}
                  {:else}
                    {t('community.addToMyLibrary')}
                  {/if}
                </span>
              </button>
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  <!-- 1. SHARE CONTENT MODAL DIALOG -->
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
            <span>قائمة يوتيوب / فيديوهات</span>
          </button>
          <button
            type="button"
            class="type-pill {newShareType === 'video' ? 'active' : ''}"
            onclick={() => (newShareType = 'video')}
          >
            <Icon name="video" size={14} />
            <span>فيديو مفرد</span>
          </button>
          <button
            type="button"
            class="type-pill {newShareType === 'pdf' ? 'active' : ''}"
            onclick={() => (newShareType = 'pdf')}
          >
            <Icon name="reader" size={14} />
            <span>ملف PDF</span>
          </button>
          <button
            type="button"
            class="type-pill {newShareType === 'cards' ? 'active' : ''}"
            onclick={() => (newShareType = 'cards')}
          >
            <Icon name="flashcards" size={14} />
            <span>بطاقات Anki / Excel</span>
          </button>
        </div>

        <label class="field-label" for="share-title">{t('community.shareTitle')}</label>
        <input
          id="share-title"
          type="text"
          placeholder="مثال: كورس الرياضيات المتقدمة أو ملخص الفيزياء"
          bind:value={newShareTitle}
        />

        <label class="field-label" for="share-author">{t('community.shareAuthor')}</label>
        <input
          id="share-author"
          type="text"
          placeholder={currentUser?.name || 'اسمك أو اسم القناة / المحاضر'}
          bind:value={newShareAuthor}
        />

        <!-- Anonymity Option -->
        <label class="checkbox-label hstack">
          <input type="checkbox" bind:checked={newShareIsAnonymous} />
          <span>{t('community.anonymous')} (إخفاء اسمي وصورتي ونشر المحتوى كعضو مجهول)</span>
        </label>

        <!-- Dynamic Content Inputs -->
        {#if newShareType === 'playlist' || newShareType === 'video'}
          <label class="field-label" for="share-urls">
            روابط الفيديوهات (رابط لكل سطر — يدعم يوتيوب، وفيديوهات غير مدرجة Unlisted)
          </label>
          <textarea
            id="share-urls"
            rows="4"
            placeholder="https://www.youtube.com/watch?v=...&#10;https://www.youtube.com/watch?v=..."
            bind:value={newShareUrls}
          ></textarea>
        {:else if newShareType === 'pdf'}
          <label class="field-label">رفع ملف المستند (PDF)</label>
          <input type="file" accept="application/pdf" onchange={handleFileSelected} />
        {:else if newShareType === 'cards'}
          <label class="field-label">رفع بطاقات استذكار (Anki .apkg/.txt أو Excel .xlsx/.csv)</label>
          <input type="file" accept=".apkg,.txt,.csv,.xlsx,.tsv" onchange={handleFileSelected} />
        {/if}

        <!-- Pricing & Access Section -->
        <div class="pricing-section card">
          <div class="hstack" style="justify-content:space-between; align-items:center;">
            <div>
              <div class="field-label" style="margin:0;">نوع الوصول والتسعير</div>
              <small class="muted">حدد ما إذا كان المحتوى مجانياً بالكامل أو مدفوعاً مع إتاحة أول درس كمعاينة مجانية</small>
            </div>
            <div class="pricing-toggle-group">
              <button
                type="button"
                class="price-toggle-btn {!newShareIsPaid ? 'active' : ''}"
                onclick={() => (newShareIsPaid = false)}
              >
                مجاني
              </button>
              <button
                type="button"
                class="price-toggle-btn {newShareIsPaid ? 'active' : ''}"
                onclick={() => (newShareIsPaid = true)}
              >
                مدفوع
              </button>
            </div>
          </div>

          {#if newShareIsPaid}
            <div class="paid-price-input mt hstack">
              <label for="share-price" class="field-label" style="margin:0; white-space:nowrap;">السعر المقترح:</label>
              <input
                id="share-price"
                type="number"
                min="5"
                step="5"
                style="width:120px;"
                bind:value={newSharePrice}
              />
              <span class="currency-tag">جنيه مصري / EGP</span>
            </div>
          {/if}
        </div>

        <label class="field-label" for="share-desc">{t('community.shareDescription')}</label>
        <textarea
          id="share-desc"
          rows="3"
          placeholder="نبذة عن المنهج، الفصول الدراسية المغطاة، وطريقة المذاكرة المقترحة…"
          bind:value={newShareDescription}
        ></textarea>
      </div>

      <div class="modal-footer hstack" style="justify-content:flex-end; gap:8px;">
        <button type="button" class="secondary" onclick={() => (isShareModalOpen = false)}>
          {t('common.cancel')}
        </button>
        <button
          type="button"
          class="primary"
          onclick={handlePublish}
          disabled={!newShareTitle.trim() || isPublishing}
        >
          <Icon name="upload" size={14} />
          <span>{isPublishing ? 'جاري النشر…' : t('community.publishShare')}</span>
        </button>
      </div>
    </div>
  {/if}

  <!-- 2. PAYMENT RECEIPT UPLOAD MODAL -->
  {#if isPaymentModalOpen && selectedShareForPayment}
    <div class="modal-backdrop" onclick={() => (isPaymentModalOpen = false)} role="presentation"></div>
    <div class="share-modal card" role="dialog" aria-modal="true" aria-label="شراء المحتوى ورفع الإيصال">
      <div class="modal-header">
        <div class="hstack" style="gap:8px;">
          <Icon name="creditCard" size={18} />
          <h3>شراء وتفعيل: {selectedShareForPayment.title}</h3>
        </div>
        <button class="icon-btn" onclick={() => (isPaymentModalOpen = false)}>
          <Icon name="x" size={16} />
        </button>
      </div>

      <div class="modal-body">
        <div class="payment-instructions card">
          <div class="ph-price">السعر المطلوب: <strong>{selectedShareForPayment.price} {selectedShareForPayment.currency || 'EGP'}</strong></div>
          <p class="muted" style="font-size:12.5px; margin:4px 0 0;">
            يرجى تحويل المبلغ عبر فودافون كاش / إنستاباي / التحويل البنكي لصاحب الكورس ({selectedShareForPayment.author}) ثم رفع لقطة شاشة للإيصال أدناه:
          </p>
        </div>

        <label class="field-label">رفع صورة إيصال التحويل (Screenshot)</label>
        <input type="file" accept="image/*" onchange={handleReceiptImageSelected} />

        {#if receiptImageBase64}
          <div class="receipt-preview-box">
            <img src={receiptImageBase64} alt="Receipt Preview" class="receipt-thumbnail" />
            <span class="preview-badge">تم اختيار صورة الإيصال</span>
          </div>
        {/if}

        <label class="field-label" for="buyer-note">ملاحظة إضافية للناشر (اختياري)</label>
        <input
          id="buyer-note"
          type="text"
          placeholder="مثال: تم التحويل من رقم 010... باسم أحمد"
          bind:value={buyerNote}
        />
      </div>

      <div class="modal-footer hstack" style="justify-content:flex-end; gap:8px;">
        <button type="button" class="secondary" onclick={() => (isPaymentModalOpen = false)}>
          {t('common.cancel')}
        </button>
        <button
          type="button"
          class="primary"
          onclick={handleSendReceipt}
          disabled={!receiptImageBase64 || isSubmittingReceipt}
        >
          <Icon name="check" size={14} />
          <span>{isSubmittingReceipt ? 'جاري الإرسال…' : 'إرسال الإيصال للمراجعة'}</span>
        </button>
      </div>
    </div>
  {/if}

  <!-- 3. CREATOR PAYMENT REQUESTS VERIFICATION MODAL -->
  {#if isOrdersModalOpen}
    <div class="modal-backdrop" onclick={() => (isOrdersModalOpen = false)} role="presentation"></div>
    <div class="share-modal card wide" role="dialog" aria-modal="true" aria-label="مراجعة طلبات الدفع">
      <div class="modal-header">
        <div class="hstack" style="gap:8px;">
          <Icon name="check" size={18} />
          <h3>طلبات الدفع والاشتراكات المقدمة</h3>
        </div>
        <button class="icon-btn" onclick={() => (isOrdersModalOpen = false)}>
          <Icon name="x" size={16} />
        </button>
      </div>

      <div class="modal-body">
        {#if pendingOrders.length === 0}
          <div class="empty-state">
            <Icon name="clock" size={36} />
            <p>لا توجد طلبات اشتراك أو إيصالات بانتظار المراجعة حالياً.</p>
          </div>
        {:else}
          <div class="orders-table">
            {#each pendingOrders as ord (ord.id)}
              <div class="order-row card">
                <div class="hstack" style="justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                  <div>
                    <div style="font-weight:700; font-size:14px;">{ord.shareTitle}</div>
                    <div class="muted" style="font-size:12px;">
                      الطالب: <strong>{ord.buyerName}</strong> ({ord.buyerEmail || 'مستخدم مسجل'}) · المبلغ: {ord.sharePrice} EGP
                    </div>
                    {#if ord.buyerNote}
                      <div class="buyer-note-text">ملاحظة الطالب: {ord.buyerNote}</div>
                    {/if}
                  </div>

                  <div class="hstack" style="gap:8px;">
                    {#if ord.receiptImage}
                      <button class="secondary small hstack" onclick={() => (previewReceiptImg = ord.receiptImage)}>
                        <Icon name="image" size={13} />
                        <span>معاينة الإيصال</span>
                      </button>
                    {/if}

                    {#if ord.status === 'pending'}
                      <button class="primary small hstack" onclick={() => handleOrderDecision(ord.id, 'accepted')}>
                        <Icon name="check" size={13} />
                        <span>قبول وتفعيل</span>
                      </button>
                      <button class="secondary small danger hstack" onclick={() => handleOrderDecision(ord.id, 'rejected')}>
                        <Icon name="x" size={13} />
                        <span>رفض</span>
                      </button>
                    {:else}
                      <span class="status-badge {ord.status}">
                        {ord.status === 'accepted' ? 'تم التفعيل' : 'مرفوض'}
                      </span>
                    {/if}
                  </div>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <!-- 4. FULL-SIZE RECEIPT IMAGE PREVIEW DIALOG -->
  {#if previewReceiptImg}
    <div class="modal-backdrop receipt-zoom-backdrop" onclick={() => (previewReceiptImg = null)} role="presentation">
      <div class="receipt-zoom-container" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div class="hstack" style="justify-content:space-between; margin-bottom:8px;">
          <span style="color:#fff; font-weight:700;">صورة إيصال التحويل</span>
          <button class="icon-btn" style="color:#fff;" onclick={() => (previewReceiptImg = null)}>
            <Icon name="x" size={18} />
          </button>
        </div>
        <img src={previewReceiptImg} alt="Receipt Fullscreen" class="receipt-full-img" />
      </div>
    </div>
  {/if}

  <!-- 5. REVIEWS & RATINGS MODAL -->
  {#if activeReviewShare}
    <div class="modal-backdrop" onclick={() => (activeReviewShare = null)} role="presentation"></div>
    <div class="share-modal card" role="dialog" aria-modal="true" aria-label="التقييمات والآراء">
      <div class="modal-header">
        <div class="hstack" style="gap:8px;">
          <Icon name="star" size={18} />
          <h3>آراء وتقييمات: {activeReviewShare.title}</h3>
        </div>
        <button class="icon-btn" onclick={() => (activeReviewShare = null)}>
          <Icon name="x" size={16} />
        </button>
      </div>

      <div class="modal-body">
        <!-- New Review Form -->
        <div class="add-review-box card">
          <div class="field-label">أضف تقييمك ورأيك:</div>
          <div class="stars-picker hstack">
            {#each [1, 2, 3, 4, 5] as starVal}
              <button
                type="button"
                class="star-btn {reviewRating >= starVal ? 'selected' : ''}"
                onclick={() => (reviewRating = starVal)}
              >
                <Icon name="star" size={20} />
              </button>
            {/each}
            <span class="star-rating-text">{reviewRating} من 5</span>
          </div>
          <textarea
            rows="2"
            placeholder="اكتب تعليقك وتجربتك مع المحتوى…"
            bind:value={reviewComment}
          ></textarea>
          <div class="hstack" style="justify-content:flex-end;">
            <button class="primary small" onclick={handleAddReview}>
              <Icon name="check" size={13} />
              <span>{t('community.submitReview')}</span>
            </button>
          </div>
        </div>

        <!-- Existing Reviews List -->
        <div class="reviews-list">
          <div class="field-label">جميع التقييمات ({activeShareReviews.length})</div>
          {#if activeShareReviews.length === 0}
            <div class="empty muted" style="padding:15px; text-align:center;">لا توجد تقييمات سابقة. كن أول من يقيّم هذا المحتوى!</div>
          {:else}
            {#each activeShareReviews as rev (rev.id)}
              <div class="review-item card">
                <div class="hstack" style="justify-content:space-between;">
                  <span class="rev-user">{rev.userName}</span>
                  <span class="rev-stars hstack" style="gap:2px;">
                    {#each Array(rev.rating) as _}
                      <Icon name="star" size={12} />
                    {/each}
                  </span>
                </div>
                <div class="rev-text">{rev.comment}</div>
              </div>
            {/each}
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .community-page {
    max-width: 1100px;
    margin: 0 auto;
    padding-bottom: 50px;
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
  }
  .community-hero p {
    margin: 0;
    font-size: 13.5px;
  }

  .orders-badge-btn {
    position: relative;
  }
  .badge-pill {
    background: var(--accent);
    color: #fff;
    font-size: 11px;
    font-weight: 700;
    padding: 1px 7px;
    border-radius: 99px;
    margin-inline-start: 4px;
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
    padding: 6px 12px;
    flex: 1;
    min-width: 220px;
  }
  .search-input-box input {
    border: none;
    background: transparent;
    outline: none;
    width: 100%;
    color: var(--text);
    font-size: 13.5px;
  }
  .clear-btn {
    background: transparent;
    border: none;
    color: var(--muted);
    cursor: pointer;
    padding: 2px;
  }

  .sort-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    overflow-x: auto;
    white-space: nowrap;
    scrollbar-width: none;
  }
  .sort-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--surface-2);
    color: var(--muted);
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;
    flex: none;
  }
  .sort-pill.active {
    background: var(--accent-soft);
    color: var(--accent);
    border-color: var(--accent);
    font-weight: 600;
  }

  /* Horizontal Filter Bar with Mobile Touch Scroll */
  .filter-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    overflow-x: auto;
    white-space: nowrap;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
    padding-bottom: 2px;
  }
  .filter-bar::-webkit-scrollbar {
    display: none;
  }
  .filter-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--surface-2);
    color: var(--text);
    font-size: 12.5px;
    cursor: pointer;
    transition: all 0.15s;
    flex: none;
  }
  .filter-pill.active {
    background: var(--accent);
    color: #fff;
    border-color: var(--accent);
    font-weight: 600;
  }
  .count-bubble {
    background: rgba(0, 0, 0, 0.1);
    padding: 1px 6px;
    border-radius: 999px;
    font-size: 11px;
  }

  /* Grid of Shares */
  .shares-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 16px;
  }

  .share-card {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
    transition: transform 0.15s ease, box-shadow 0.15s ease;
  }
  .share-card:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-glass);
  }

  .share-media-container {
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 9;
    background: var(--surface-2);
    overflow: hidden;
  }
  .share-thumb-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .share-thumb-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--muted);
  }

  .type-badge-floating {
    position: absolute;
    top: 8px;
    inset-inline-start: 8px;
    background: rgba(0, 0, 0, 0.72);
    color: #fff;
    backdrop-filter: blur(4px);
    padding: 3px 8px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 600;
  }

  .price-badge-floating {
    position: absolute;
    top: 8px;
    inset-inline-end: 8px;
    background: #e74c3c;
    color: #fff;
    padding: 3px 8px;
    border-radius: 6px;
    font-size: 11.5px;
    font-weight: 700;
  }
  .price-badge-floating.free {
    background: #27ae60;
  }
  .price-badge-floating.unlocked {
    background: var(--accent);
  }

  .share-card-body {
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex: 1;
  }
  .share-title {
    margin: 0;
    font-size: 15px;
    font-weight: 700;
    line-height: 1.4;
  }
  .share-description {
    margin: 0;
    font-size: 12.5px;
    line-height: 1.5;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .preview-items-row {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-top: 4px;
  }
  .subitem-pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: var(--surface-2);
    padding: 2px 7px;
    border-radius: 5px;
    font-size: 11px;
    border: 1px solid var(--border);
  }
  .subitem-pill.free-preview {
    border-color: #27ae60;
    color: var(--text);
  }
  .free-tag {
    color: #27ae60;
    font-weight: 700;
    margin-inline-start: 2px;
  }
  .more-subitems {
    font-size: 11px;
    color: var(--muted);
    align-self: center;
  }

  .share-author-row {
    margin-top: auto;
    gap: 7px;
    align-items: center;
    font-size: 12px;
    color: var(--muted);
  }
  .author-avatar-circle {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--surface-2);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  .avatar-mini {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .share-card-footer {
    padding: 10px 14px;
    border-top: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    background: var(--surface-2);
  }
  .share-stats {
    font-size: 12px;
    color: var(--muted);
    gap: 4px;
    align-items: center;
  }
  .review-stat-btn {
    background: transparent;
    border: none;
    color: var(--accent);
    cursor: pointer;
    font-weight: 600;
    padding: 0;
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }

  /* Modals */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(4px);
    z-index: 9998;
  }
  .share-modal {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(560px, 92vw);
    max-height: 88vh;
    overflow-y: auto;
    z-index: 9999;
    padding: 20px;
    border-radius: var(--radius-lg);
    display: flex;
    flex-direction: column;
    gap: 14px;
    box-shadow: 0 12px 36px rgba(0, 0, 0, 0.28);
    background: var(--surface);
  }
  .share-modal.wide {
    width: min(720px, 94vw);
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
    font-size: 16.5px;
  }
  .modal-body {
    display: flex;
    flex-direction: column;
    gap: 12px;
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
    padding: 7px 12px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--surface-2);
    color: var(--text);
    cursor: pointer;
    font-size: 12px;
  }
  .type-pill.active {
    background: var(--accent);
    color: #fff;
    border-color: var(--accent);
  }

  .share-modal input[type="text"],
  .share-modal input[type="number"],
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

  .pricing-section {
    padding: 12px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  .pricing-toggle-group {
    display: flex;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }
  .price-toggle-btn {
    border: none;
    background: transparent;
    padding: 5px 12px;
    font-size: 12px;
    cursor: pointer;
    color: var(--text);
  }
  .price-toggle-btn.active {
    background: var(--accent);
    color: #fff;
    font-weight: 600;
  }

  .receipt-preview-box {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px;
    background: var(--surface-2);
    border-radius: 6px;
  }
  .receipt-thumbnail {
    width: 60px;
    height: 60px;
    object-fit: cover;
    border-radius: 4px;
    border: 1px solid var(--border);
  }

  .receipt-zoom-backdrop {
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10005;
  }
  .receipt-zoom-container {
    max-width: 90vw;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
  }
  .receipt-full-img {
    max-width: 100%;
    max-height: 80vh;
    object-fit: contain;
    border-radius: 8px;
  }

  .orders-table {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .order-row {
    padding: 12px 14px;
    background: var(--surface-2);
    border: 1px solid var(--border);
  }
  .buyer-note-text {
    font-size: 12px;
    color: var(--accent);
    margin-top: 4px;
  }
  .status-badge {
    padding: 3px 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 700;
  }
  .status-badge.accepted {
    background: #27ae60;
    color: #fff;
  }
  .status-badge.rejected {
    background: #e74c3c;
    color: #fff;
  }

  .stars-picker {
    gap: 4px;
    align-items: center;
    margin-bottom: 8px;
  }
  .star-btn {
    background: transparent;
    border: none;
    font-size: 24px;
    cursor: pointer;
    color: #ccc;
    padding: 0 2px;
    line-height: 1;
  }
  .star-btn.selected {
    color: #f39c12;
  }
  .star-rating-text {
    font-size: 13px;
    font-weight: 700;
    margin-inline-start: 8px;
  }

  .reviews-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 8px;
  }
  .review-item {
    padding: 10px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .rev-user {
    font-weight: 600;
    font-size: 13px;
  }
  .rev-stars {
    color: #f39c12;
    font-size: 13px;
  }
  .rev-text {
    font-size: 12.5px;
    color: var(--text);
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
  }
</style>
