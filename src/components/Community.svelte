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
    updateCommunityShare,
    deleteCommunityShare,
    isShareOwner,
    importShareToMyLibrary,
    recordShareVisit,
    formatTotalDuration,
    computeShareTotalDuration,
    isShareImported,
    getImportedShareIds,
    normalizeTags,
    generateCouponBatch,
    setShareMasterPasscode,
    redeemShareCoupon,
    insertResourceIntoShare,
    getShareDeepLink
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
  import { fetchPlaylistScrape, fetchYouTubeVideoMetadata } from '../lib/youtube.js';

  let {
    notify = () => {},
    onOpenView = () => {},
    onRequestAuth = () => {},
    onImported = () => {},
    onOpenVideoDirectly = () => {},
    initialShare = null,
    onClearInitialShare = () => {}
  } = $props();

  $effect(() => {
    if (initialShare) {
      selectedShareDetails = initialShare;
    }
  });

  function closeShareDetails() {
    selectedShareDetails = null;
    onClearInitialShare?.();
  }

  let shares = $state([]);
  let searchQuery = $state('');
  let selectedTagFilter = $state('');
  let activeFilter = $state('all'); // 'all' | 'my_shares' | 'private' | 'path' | 'playlist' | 'pdf' | 'cards' | 'notes' | 'video'
  let activeSort = $state('popular'); // 'popular' | 'rating' | 'newest'
  let pricingFilter = $state('all'); // 'all' | 'free' | 'paid'
  let filterDropdownOpen = $state(false);

  const activeFilterCount = $derived(
    (activeFilter !== 'all' ? 1 : 0) +
    (pricingFilter !== 'all' ? 1 : 0) +
    (selectedTagFilter ? 1 : 0)
  );

  // Dedicated Course / Playlist Details View State
  let selectedShareDetails = $state(null);

  // Sharing & Edit Modal State
  let isShareModalOpen = $state(false);
  let editingShareId = $state(null); // When editing existing share
  let newShareType = $state('playlist'); // 'playlist' | 'path' | 'pdf' | 'cards' | 'video' | 'notes'
  let newShareTitle = $state('');
  let newShareAuthor = $state('');
  let newShareTeacher = $state('');
  let newShareDescription = $state('');
  let newShareTags = $state('');
  let newShareIsPrivate = $state(false);
  let newShareUrls = $state('');
  let newShareIsPaid = $state(false);
  let newSharePrice = $state(50);
  let newShareIsAnonymous = $state(false);
  let newShareFile = $state(null);
  let newShareItems = $state([]); // [{ title, url, isFreePreview: true, kind: 'video' | 'book' }]
  let newVideoUrlInput = $state('');
  let newVideoTitleInput = $state('');
  let newVideoKindInput = $state('video');
  let playlistScrapeUrl = $state('');
  let isScrapingPlaylist = $state(false);
  let newShareThumbnail = $state('');
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

  // Preview Mode for Owner & URL Concealment
  let previewModeActive = $state(false);
  let showOwnerRawUrls = $state(false);

  // Enroll First Gate Prompt Modal
  let enrollPromptItem = $state(null);

  // Resource Insertion Modal State
  let isInsertResourceModalOpen = $state(false);
  let insertResourceType = $state('video');
  let insertResourceTitle = $state('');
  let insertResourceUrl = $state('');
  let insertResourceContent = $state('');
  let insertResourcePosition = $state(-1);
  let insertResourceIsFreePreview = $state(false);
  let isInsertingResource = $state(false);

  // Coupons Management Modal State (Owner)
  let isCouponsModalOpen = $state(false);
  let couponBatchCount = $state(20);
  let isGeneratingCoupons = $state(false);
  let masterPasscodeDraft = $state('');
  let isSavingPasscode = $state(false);

  // Student Coupon Redemption Modal State
  let isRedeemModalOpen = $state(false);
  let redeemCodeInput = $state('');
  let isRedeemingCoupon = $state(false);

  // Learning Path Courses State
  let newSharePathCourses = $state([]);
  let newPathCourseTitle = $state('');
  let newPathCourseUrl = $state('');
  let isAddingPathCourse = $state(false);

  async function handleAddCourseToPath() {
    const url = newPathCourseUrl.trim();
    const title = newPathCourseTitle.trim();
    if (!url && !title) return;
    isAddingPathCourse = true;
    notify('جارِ استخراج محتوى الكورس للمسار...', 'info');
    try {
      const scraped = await fetchPlaylistScrape(url);
      if (scraped && scraped.ok && Array.isArray(scraped.videos) && scraped.videos.length > 0) {
        newSharePathCourses = [...newSharePathCourses, {
          id: `pc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          title: title || scraped.title || `كورس ${newSharePathCourses.length + 1}`,
          url,
          thumbnail: scraped.thumbnail || scraped.videos[0]?.thumbnail || '',
          videos: scraped.videos,
          videoCount: scraped.videos.length,
          durationSeconds: scraped.videos.reduce((acc, v) => acc + (Number(v.duration || v.lengthSeconds) || 0), 0)
        }];
        if (!newShareThumbnail && scraped.thumbnail) {
          newShareThumbnail = scraped.thumbnail;
        }
        newPathCourseTitle = '';
        newPathCourseUrl = '';
        notify(`تمت إضافة "${title || scraped.title}" (${scraped.videos.length} درس) إلى المسار!`, 'ok');
      } else {
        newSharePathCourses = [...newSharePathCourses, {
          id: `pc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          title: title || `كورس ${newSharePathCourses.length + 1}`,
          url,
          thumbnail: '',
          videos: url ? [{ id: '1', title, url }] : [],
          videoCount: 1,
          durationSeconds: 0
        }];
        newPathCourseTitle = '';
        newPathCourseUrl = '';
        notify('تمت إضافة الكورس إلى المسار بنجاح', 'ok');
      }
    } catch (e) {
      notify('تعذر استخراج الكورس تلقائياً، يمكنك إضافته يدوياً', 'warn');
    } finally {
      isAddingPathCourse = false;
    }
  }

  function handleRemovePathCourse(idx) {
    newSharePathCourses = newSharePathCourses.filter((_, i) => i !== idx);
  }

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
    if (!Array.isArray(shares) || shares.length === 0) return [];

    let list = shares.filter((item) => {
      if (!item) return false;

      if (activeFilter === 'my_shares') {
        return isShareOwner(item, currentUser);
      }
      if (activeFilter === 'private') {
        return Boolean(item.isPrivate) && isShareOwner(item, currentUser);
      }
      if (pricingFilter === 'free' && item.isPaid) return false;
      if (pricingFilter === 'paid' && !item.isPaid) return false;

      // Category matching
      if (activeFilter !== 'all') {
        const t = String(item.type || 'playlist').toLowerCase();
        if (activeFilter === 'playlist' && (t === 'playlist' || t === 'video')) {
          // matches playlist
        } else if (t !== activeFilter.toLowerCase()) {
          return false;
        }
      }

      // Tag filter (case-insensitive & hash-stripped)
      if (selectedTagFilter && selectedTagFilter.trim()) {
        const targetTag = selectedTagFilter.trim().replace(/^#+/, '').toLowerCase();
        const rawTags = Array.isArray(item.tags)
          ? item.tags
          : (typeof item.tags === 'string' ? item.tags.split(/[,،\s]+/) : []);
        const normItemTags = rawTags.map((tg) => String(tg).trim().replace(/^#+/, '').toLowerCase()).filter(Boolean);
        if (!normItemTags.includes(targetTag)) return false;
      }

      // Search query
      if (searchQuery && searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchTitle = (item.title || '').toLowerCase().includes(q) || (item.titleEn || '').toLowerCase().includes(q);
        const matchAuthor = (item.author || '').toLowerCase().includes(q);
        const matchTeacher = (item.teacher || '').toLowerCase().includes(q);
        const matchDesc = (item.description || '').toLowerCase().includes(q);
        const rawTags = Array.isArray(item.tags) ? item.tags : (typeof item.tags === 'string' ? item.tags.split(/[,،\s]+/) : []);
        const matchTags = rawTags.some((tg) => String(tg).trim().replace(/^#+/, '').toLowerCase().includes(q));
        return matchTitle || matchAuthor || matchTeacher || matchDesc || matchTags;
      }
      return true;
    });

    if (activeSort === 'rating') {
      list = [...list].sort((a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0));
    } else if (activeSort === 'newest') {
      list = [...list].sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
    } else {
      list = [...list].sort((a, b) => (Number(b.visits) || 0) - (Number(a.visits) || 0));
    }

    return list;
  });

  // Count user's own shares
  const mySharesCount = $derived.by(() => {
    return shares.filter((s) => isShareOwner(s, currentUser)).length;
  });

  // Count user's private items
  const privateSharesCount = $derived.by(() => {
    return shares.filter((s) => s.isPrivate && isShareOwner(s, currentUser)).length;
  });

  // Category counts
  const pathsCount = $derived.by(() => {
    return shares.filter((s) => (s.type || '').toLowerCase() === 'path').length;
  });

  const playlistsCount = $derived.by(() => {
    return shares.filter((s) => {
      const t = (s.type || 'playlist').toLowerCase();
      return t === 'playlist' || t === 'video';
    }).length;
  });

  const pdfsCount = $derived.by(() => {
    return shares.filter((s) => (s.type || '').toLowerCase() === 'pdf').length;
  });

  const cardsCount = $derived.by(() => {
    return shares.filter((s) => (s.type || '').toLowerCase() === 'cards').length;
  });

  const notesCount = $derived.by(() => {
    return shares.filter((s) => (s.type || '').toLowerCase() === 'notes').length;
  });

  // Unique tags with counts for quick discovery (properly hash-stripped)
  const availableTags = $derived.by(() => {
    const counts = {};
    for (const item of shares) {
      const rawTags = Array.isArray(item.tags)
        ? item.tags
        : (typeof item.tags === 'string' ? item.tags.split(/[,،\s]+/) : []);
      for (const t of rawTags) {
        const norm = String(t).trim().replace(/^#+/, '');
        if (norm) counts[norm] = (counts[norm] || 0) + 1;
      }
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  });

  // Count pending payments for creator's items
  const myPendingOrdersCount = $derived.by(() => {
    if (isGuest) return 0;
    const myShareIds = shares.filter((s) => s.creatorId === currentUser.id).map((s) => s.id);
    return pendingOrders.filter((o) => myShareIds.includes(o.shareId) && o.status === 'pending').length;
  });

  // Reactive imported shares tracking
  let importedShareIds = $state(getImportedShareIds());

  function checkIsImported(shareId) {
    if (!shareId) return false;
    return importedShareIds.includes(shareId) || isShareImported(shareId);
  }

  async function handleImport(share) {
    if (share.isPaid && !isContentUnlocked(share, currentUser)) {
      openPaymentModal(share);
      return;
    }

    importingId = share.id;
    try {
      const res = await importShareToMyLibrary(share);
      if (res.ok) {
        importedShareIds = Array.from(new Set([...getImportedShareIds(), share.id]));
        window.dispatchEvent(new CustomEvent('studyos:library-changed'));
        onImported?.(res);
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

  async function handleShareCourseLink(share) {
    if (!share) return;
    const link = getShareDeepLink(share.id);
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: share.title,
          text: `شاهد دورة "${share.title}" على مَكِين:`,
          url: link
        });
        notify('تمت مشاركة رابط الدورة بنجاح', 'ok');
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(link);
        notify('تم نسخ رابط الدورة بنجاح!', 'ok');
        return;
      } catch {}
    }
    notify(link, 'info');
  }

  function handleLessonClick(subItem, share) {
    if (!subItem) return;
    const isOwner = isShareOwner(share, currentUser);
    const enrolled = checkIsImported(share.id);
    const unlocked = isContentUnlocked(share, currentUser) || isOwner || !share.isPaid;

    if (!unlocked) {
      openPaymentModal(share);
      return;
    }

    if (enrolled || isOwner) {
      playLessonVideo(subItem, share);
      return;
    }

    if (subItem.isFreePreview) {
      notify('تشغيل درس المعاينة المجانية — يمكنك استيراد الدورة كاملة في أي وقت', 'info');
      playLessonVideo(subItem, share);
      return;
    }

    enrollPromptItem = { subItem, share };
  }

  async function handleConfirmEnrollAndPlay() {
    if (!enrollPromptItem) return;
    const { subItem, share } = enrollPromptItem;
    enrollPromptItem = null;
    await handleImport(share);
    playLessonVideo(subItem, share);
  }

  function playLessonVideo(subItem, share) {
    if (subItem.type === 'pdf') {
      onOpenView?.('Reader');
      return;
    }
    if (subItem.type === 'notes') {
      onOpenView?.('Notes');
      return;
    }
    if (subItem.type === 'cards') {
      onOpenView?.('Cards');
      return;
    }
    onOpenVideoDirectly({
      id: subItem.id || `yt-${(subItem.url.match(/(?:v=|\/embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/) || [])[1] || Date.now()}`,
      url: subItem.url,
      title: subItem.title,
      docId: share.id,
      provider: 'youtube'
    });
  }

  async function handleGenerateCoupons(shareId) {
    if (!shareId) return;
    isGeneratingCoupons = true;
    try {
      const res = await generateCouponBatch(shareId, couponBatchCount || 20, 1);
      if (res.ok) {
        notify(`تم توليد ${res.generated.length} كوبون بنجاح!`, 'ok');
        selectedShareDetails = { ...res.share };
        shares = shares.map((s) => s.id === shareId ? { ...res.share } : s);
      } else {
        notify(res.error || 'فشل توليد الكوبونات', 'error');
      }
    } catch {
      notify('حدث خطأ أثناء توليد الكوبونات', 'error');
    } finally {
      isGeneratingCoupons = false;
    }
  }

  async function handleSaveMasterPasscode(shareId) {
    if (!shareId) return;
    isSavingPasscode = true;
    try {
      const res = await setShareMasterPasscode(shareId, masterPasscodeDraft);
      if (res.ok) {
        notify('تم حفظ كلمة المرور الموحدة للدورة بنجاح!', 'ok');
        selectedShareDetails = { ...res.share };
        shares = shares.map((s) => s.id === shareId ? { ...res.share } : s);
      } else {
        notify('فشل حفظ كلمة المرور', 'error');
      }
    } catch {
      notify('حدث خطأ أثناء حفظ كلمة المرور', 'error');
    } finally {
      isSavingPasscode = false;
    }
  }

  async function handleRedeemCoupon(shareId) {
    if (!redeemCodeInput.trim()) {
      notify('يرجى إدخال كود الكوبون أو كلمة المرور', 'warn');
      return;
    }
    isRedeemingCoupon = true;
    try {
      const res = await redeemShareCoupon(shareId, redeemCodeInput.trim(), currentUser);
      if (res.ok) {
        notify(res.message || 'تم تفعيل الدورة بنجاح!', 'ok');
        isRedeemModalOpen = false;
        redeemCodeInput = '';
        shares = await listCommunityShares();
        const updated = shares.find((s) => s.id === shareId);
        if (updated) selectedShareDetails = { ...updated };
      } else {
        notify(res.error || 'كود الكوبون أو كلمة المرور غير صحيحة', 'error');
      }
    } catch {
      notify('حدث خطأ أثناء تفعيل الكوبون', 'error');
    } finally {
      isRedeemingCoupon = false;
    }
  }

  async function handleInsertResource(shareId) {
    if (!insertResourceTitle.trim()) {
      notify('يرجى إدخال عنوان المورد', 'warn');
      return;
    }
    isInsertingResource = true;
    try {
      const res = await insertResourceIntoShare(
        shareId,
        {
          type: insertResourceType,
          title: insertResourceTitle.trim(),
          url: insertResourceUrl.trim(),
          content: insertResourceContent.trim(),
          isFreePreview: insertResourceIsFreePreview
        },
        Number(insertResourcePosition)
      );
      if (res.ok) {
        notify('تمت إضافة المورد للدورة بنجاح!', 'ok');
        isInsertResourceModalOpen = false;
        insertResourceTitle = '';
        insertResourceUrl = '';
        insertResourceContent = '';
        selectedShareDetails = { ...res.share };
        shares = shares.map((s) => s.id === shareId ? { ...res.share } : s);
      } else {
        notify(res.error || 'فشلت إضافة المورد', 'error');
      }
    } catch {
      notify('حدث خطأ أثناء إضافة المورد', 'error');
    } finally {
      isInsertingResource = false;
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
    setTimeout(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      document.querySelector('.view')?.scrollTo({ top: 0, behavior: 'smooth' });
    }, 20);
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

  function openCreateShare() {
    editingShareId = null;
    newShareType = 'playlist';
    newShareTitle = '';
    newShareAuthor = currentUser?.name || '';
    newShareTeacher = '';
    newShareDescription = '';
    newShareTags = '';
    newShareIsPrivate = false;
    newShareUrls = '';
    newShareFile = null;
    newShareIsPaid = false;
    newSharePrice = 50;
    newShareIsAnonymous = false;
    newShareItems = [];
    newVideoUrlInput = '';
    newVideoTitleInput = '';
    playlistScrapeUrl = '';
    isScrapingPlaylist = false;
    newShareThumbnail = '';
    newSharePathCourses = [];
    newPathCourseTitle = '';
    newPathCourseUrl = '';
    isShareModalOpen = true;
    setTimeout(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      document.querySelector('.view')?.scrollTo({ top: 0, behavior: 'smooth' });
    }, 20);
  }

  function openEditShare(share) {
    editingShareId = share.id;
    newShareType = share.type || 'playlist';
    newShareTitle = share.title || '';
    newShareAuthor = share.author || '';
    newShareTeacher = share.teacher || '';
    newShareDescription = share.description || '';
    newShareTags = Array.isArray(share.tags) ? share.tags.join('، ') : (share.tags || '');
    newShareIsPrivate = Boolean(share.isPrivate);
    newShareIsPaid = !!share.isPaid;
    newSharePrice = share.price || 50;
    newShareIsAnonymous = !!share.isAnonymous;
    newShareFile = null;
    newShareItems = Array.isArray(share.items) && share.items.length > 0
      ? JSON.parse(JSON.stringify(share.items))
      : (share.playlistData?.videoUrls || []).map((u, i) => ({
          title: `${share.title || 'فيديو'} - درس ${i + 1}`,
          url: u,
          isFreePreview: i === 0 || !share.isPaid
        }));
    newShareUrls = newShareItems.map((it) => it.url).join('\n');
    newVideoUrlInput = '';
    newVideoTitleInput = '';
    playlistScrapeUrl = '';
    isScrapingPlaylist = false;
    newShareThumbnail = share.thumbnail || '';
    newSharePathCourses = Array.isArray(share.pathCourses) ? JSON.parse(JSON.stringify(share.pathCourses)) : [];
    newPathCourseTitle = '';
    newPathCourseUrl = '';
    isShareModalOpen = true;
    setTimeout(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      document.querySelector('.view')?.scrollTo({ top: 0, behavior: 'smooth' });
    }, 20);
  }

  async function handleDeleteShare(share) {
    if (!confirm(`هل أنت متأكد من حذف "${share.title}" من المجتمع نهائياً؟`)) return;
    try {
      await deleteCommunityShare(share.id);
      notify('تم حذف المشاركة من المجتمع بنجاح', 'ok');
      if (selectedShareDetails?.id === share.id) {
        selectedShareDetails = null;
      }
      await reload();
    } catch (err) {
      notify(String(err.message || err), 'error');
    }
  }

  async function addPlaylistItem() {
    const url = newVideoUrlInput.trim();
    if (!url) return;

    // Detect if user pasted a playlist URL into this single video input
    if (url.includes('list=') || url.includes('/playlist')) {
      playlistScrapeUrl = url;
      newVideoUrlInput = '';
      newVideoTitleInput = '';
      await handleScrapePlaylist(url);
      return;
    }

    const title = newVideoTitleInput.trim() || `درس ${newShareItems.length + 1}`;
    const itemIndex = newShareItems.length;
    newShareItems = [
      ...newShareItems,
      {
        title,
        url,
        isFreePreview: newShareItems.length === 0 || !newShareIsPaid
      }
    ];
    newVideoUrlInput = '';
    newVideoTitleInput = '';

    // If user didn't enter a custom title, fetch the real YouTube video title automatically
    if (title.startsWith('درس ')) {
      fetchYouTubeVideoMetadata(url).then((meta) => {
        if (meta && meta.title) {
          newShareItems = newShareItems.map((it, idx) =>
            idx === itemIndex && it.title.startsWith('درس ')
              ? { ...it, title: meta.title, thumbnail: meta.thumbnail || it.thumbnail }
              : it
          );
        }
      }).catch(() => {});
    }
  }

  function removePlaylistItem(idx) {
    newShareItems = newShareItems.filter((_, i) => i !== idx);
  }

  function movePlaylistItem(idx, delta) {
    const target = idx + delta;
    if (target < 0 || target >= newShareItems.length) return;
    const copy = [...newShareItems];
    const temp = copy[idx];
    copy[idx] = copy[target];
    copy[target] = temp;
    newShareItems = copy;
  }

  function togglePlaylistItemPreview(idx) {
    newShareItems = newShareItems.map((it, i) =>
      i === idx ? { ...it, isFreePreview: !it.isFreePreview } : it
    );
  }

  async function convertUrlsToItems() {
    const rawUrls = newShareUrls.split('\n').map((u) => u.trim()).filter(Boolean);
    if (!rawUrls.length) return;
    const existingUrls = new Set(newShareItems.map((it) => it.url));
    const added = [];
    rawUrls.forEach((u) => {
      if (!existingUrls.has(u)) {
        added.push({
          title: `فيديو ${newShareItems.length + added.length + 1}`,
          url: u,
          isFreePreview: (newShareItems.length + added.length) === 0 || !newShareIsPaid
        });
      }
    });
    const startIndex = newShareItems.length;
    newShareItems = [...newShareItems, ...added];
    newShareUrls = '';

    // Automatically resolve titles for all pasted URLs in the background
    added.forEach((item, i) => {
      const idx = startIndex + i;
      fetchYouTubeVideoMetadata(item.url).then((meta) => {
        if (meta && meta.title) {
          newShareItems = newShareItems.map((it, curIdx) =>
            curIdx === idx && it.title.startsWith('فيديو ')
              ? { ...it, title: meta.title, thumbnail: meta.thumbnail || it.thumbnail }
              : it
          );
        }
      }).catch(() => {});
    });
  }

  async function handleScrapePlaylist(forcedUrl) {
    const rawUrl = (typeof forcedUrl === 'string' && forcedUrl) ? forcedUrl.trim() : playlistScrapeUrl.trim();
    if (!rawUrl) {
      notify('يرجى إدخال رابط قائمة تشغيل يوتيوب صالحة', 'error');
      return;
    }
    isScrapingPlaylist = true;
    try {
      const res = await fetchPlaylistScrape(rawUrl);
      if (!res || !res.ok || !Array.isArray(res.videos) || res.videos.length === 0) {
        notify('تعذر استخراج الفيديوهات من الرابط. تأكد أن القائمة عامة أو غير مدرجة (Unlisted).', 'error');
        return;
      }

      if (!newShareTitle.trim() && res.title) {
        newShareTitle = res.title;
      }

      if (res.thumbnail) {
        newShareThumbnail = res.thumbnail;
      }

      const existingUrls = new Set(newShareItems.map((it) => it.url));
      const newItems = [];
      res.videos.forEach((v) => {
        if (!existingUrls.has(v.url)) {
          newItems.push({
            title: v.title || `فيديو ${newShareItems.length + newItems.length + 1}`,
            url: v.url,
            thumbnail: v.thumbnail || '',
            duration: v.duration || 0,
            isFreePreview: (newShareItems.length + newItems.length) === 0 || !newShareIsPaid
          });
        }
      });

      if (newItems.length > 0) {
        newShareItems = [...newShareItems, ...newItems];
        notify(`تم استخراج ${newItems.length} فيديو بنجاح مع العناوين والصور المصغرة!`, 'ok');
      } else {
        notify('جميع الفيديوهات المستخرجة مضافة بالفعل إلى القائمة', 'ok');
      }
    } catch (err) {
      notify('حدث خطأ أثناء الاستخراج: ' + String(err?.message || err), 'error');
    } finally {
      isScrapingPlaylist = false;
    }
  }

  async function handlePublish() {
    if (!newShareTitle.trim()) return;

    isPublishing = true;
    try {
      let playlistData = null;
      let items = [...newShareItems];

      if (newShareType === 'playlist' || newShareType === 'video') {
        if (items.length === 0) {
          const rawUrls = newShareUrls.split('\n').map((u) => u.trim()).filter(Boolean);
          const finalUrls = rawUrls.length ? rawUrls : ['https://www.youtube.com/watch?v=zOjov-2OZ0E'];
          items = finalUrls.map((u, i) => ({
            title: `${newShareTitle.trim()} - درس ${i + 1}`,
            url: u,
            isFreePreview: i === 0 || !newShareIsPaid
          }));
        }
        playlistData = {
          title: newShareTitle.trim(),
          videoUrls: items.map((it) => it.url)
        };
      }

      let thumb = newShareThumbnail || '';
      if (!thumb && items.length > 0) {
        const first = items[0];
        if (first?.thumbnail) {
          thumb = first.thumbnail;
        } else if (first?.url) {
          const m = String(first.url).match(/(?:v=|\/embed\/|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
          if (m) thumb = `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg`;
        }
      }

      const totalDuration = newShareType === 'path'
        ? newSharePathCourses.reduce((acc, c) => acc + (Number(c.durationSeconds || c.totalDurationSeconds) || 0), 0)
        : items.reduce((acc, it) => acc + Number(it.duration || it.durationSeconds || it.lengthSeconds || 0), 0);

      const payload = {
        type: newShareType,
        title: newShareTitle.trim(),
        author: newShareAuthor.trim(),
        teacher: newShareTeacher.trim(),
        description: newShareDescription.trim(),
        tags: newShareTags,
        isPrivate: newShareIsPrivate,
        thumbnail: thumb,
        isPaid: newShareIsPaid,
        price: newSharePrice,
        isAnonymous: newShareIsAnonymous,
        itemsCount: newShareType === 'path' ? newSharePathCourses.reduce((acc, c) => acc + (c.videoCount || 1), 0) : (items.length || 1),
        items: newShareType === 'path' ? newSharePathCourses : items,
        pathCourses: newShareType === 'path' ? newSharePathCourses : [],
        totalDurationSeconds: totalDuration,
        playlistData,
        pdfData: newShareFile ? { name: newShareFile.name, size: newShareFile.size } : null
      };

      if (editingShareId) {
        await updateCommunityShare(editingShareId, payload);
        notify('تم تحديث المحتوى في المجتمع بنجاح!', 'ok');
      } else {
        await publishCommunityShare(payload);
        notify(t('community.publishedSuccess') || 'تم نشر المحتوى بنجاح في المجتمع المفتوح!', 'ok');
      }

      editingShareId = null;
      newShareTitle = '';
      newShareAuthor = '';
      newShareTeacher = '';
      newShareDescription = '';
      newShareTags = '';
      newShareIsPrivate = false;
      newShareUrls = '';
      newShareFile = null;
      newShareIsPaid = false;
      newShareIsAnonymous = false;
      newShareItems = [];
      newVideoUrlInput = '';
      newVideoTitleInput = '';
      playlistScrapeUrl = '';
      newShareThumbnail = '';
      newSharePathCourses = [];
      newPathCourseTitle = '';
      newPathCourseUrl = '';
      isShareModalOpen = false;
      await reload();
      if (selectedShareDetails && selectedShareDetails.id === editingShareId) {
        selectedShareDetails = shares.find((s) => s.id === editingShareId) || null;
      }
    } catch (e) {
      notify(String(e.message || e), 'error');
    } finally {
      isPublishing = false;
    }
  }

  function typeIcon(type) {
    if (type === 'path') return 'layers';
    if (type === 'playlist' || type === 'video') return 'video';
    if (type === 'cards') return 'flashcards';
    if (type === 'notes') return 'file-text';
    return 'reader';
  }

  function lessonIcon(item) {
    if (!item?.type || item.type === 'video') return 'play';
    if (item.type === 'pdf') return 'book-open';
    return 'file-text';
  }

  function typeLabel(type) {
    if (type === 'path') return ui.lang === 'ar' ? 'مسار تعليمي' : 'Learning Path';
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

      <button class="primary share-trigger-btn hstack" onclick={openCreateShare}>
        <Icon name="plus" size={16} />
        <span>{t('community.shareContent')}</span>
      </button>
    </div>
  </header>

  <!-- Search & Filter Controls -->
  <div class="controls-card card">
    <div class="search-row" style="display:flex; gap:10px; align-items:center;">
      <div class="search-input-box" style="flex:1;">
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

      <!-- Unified Filter Toggle Button -->
      <button
        type="button"
        class="filter-dropdown-btn hstack {activeFilterCount > 0 ? 'active' : ''}"
        onclick={() => (filterDropdownOpen = !filterDropdownOpen)}
        title="تصفية المحتوى والخيارات"
        style="gap:6px; padding:8px 14px; border-radius:8px; border:1px solid var(--border); background:{filterDropdownOpen ? 'var(--accent-soft)' : 'var(--surface-2)'}; color:{filterDropdownOpen ? 'var(--accent)' : 'var(--text)'}; font-size:13px; font-weight:600; cursor:pointer; flex-shrink:0;"
      >
        <Icon name="filter" size={15} />
        <span>{ui.lang === 'ar' ? 'تصفية' : 'Filter'}</span>
        {#if activeFilterCount > 0}
          <span class="count-bubble" style="background:var(--accent); color:#fff; font-size:10.5px; padding:1px 6px; border-radius:999px;">{activeFilterCount}</span>
        {/if}
        <Icon name={filterDropdownOpen ? 'chevron-up' : 'chevron-down'} size={13} />
      </button>
    </div>

    <!-- Collapsible Full Filters Panel: appears when clicking "تصفية" -->
    {#if filterDropdownOpen}
      <div class="filters-expanded-panel mt" style="padding:14px; background:var(--surface-2); border-radius:10px; border:1px solid var(--border); display:flex; flex-direction:column; gap:12px;">
        <!-- Header with Reset -->
        <div class="hstack" style="justify-content:space-between; align-items:center;">
          <strong style="font-size:13px; display:inline-flex; align-items:center; gap:6px;">
            <Icon name="filter" size={14} />
            <span>{ui.lang === 'ar' ? 'خيارات التصفية والفرز' : 'Filter & Sort Options'}</span>
          </strong>
          {#if activeFilterCount > 0}
            <button
              type="button"
              class="small secondary"
              style="font-size:11.5px; padding:3px 10px; border-radius:6px;"
              onclick={() => { activeFilter = 'all'; pricingFilter = 'all'; selectedTagFilter = ''; activeSort = 'popular'; }}
            >
              {ui.lang === 'ar' ? 'إعادة ضبط الكل' : 'Reset All'}
            </button>
          {/if}
        </div>

        <!-- 1. Content Categories / Types -->
        <div class="filter-section">
          <span class="filter-section-title muted" style="font-size:11.5px; font-weight:600; margin-bottom:6px; display:block;">
            {ui.lang === 'ar' ? 'نوع المحتوى والقسم:' : 'Content Type & Category:'}
          </span>
          <div class="filter-bar" style="margin:0; padding:0; flex-wrap:wrap;">
            <button
              type="button"
              class="filter-pill {activeFilter === 'all' ? 'active' : ''}"
              onclick={() => (activeFilter = 'all')}
            >
              <span>{t('community.filterAll')}</span>
              <span class="count-bubble">{shares.length}</span>
            </button>

            <button
              type="button"
              class="filter-pill {activeFilter === 'my_shares' ? 'active my-shares-active' : ''}"
              onclick={() => (activeFilter = 'my_shares')}
            >
              <Icon name="user" size={14} />
              <span>{ui.lang === 'ar' ? 'محتواي ومشاركاتي' : 'My Content'}</span>
              {#if mySharesCount > 0}
                <span class="count-bubble">{mySharesCount}</span>
              {/if}
            </button>

            {#if privateSharesCount > 0}
              <button
                type="button"
                class="filter-pill {activeFilter === 'private' ? 'active' : ''}"
                onclick={() => (activeFilter = 'private')}
              >
                <Icon name="lock" size={14} />
                <span>{ui.lang === 'ar' ? 'محتواي الخاص' : 'Private'}</span>
                <span class="count-bubble">{privateSharesCount}</span>
              </button>
            {/if}

            <button
              type="button"
              class="filter-pill {activeFilter === 'path' ? 'active' : ''}"
              onclick={() => (activeFilter = 'path')}
            >
              <Icon name="layers" size={14} />
              <span>{ui.lang === 'ar' ? 'المسارات التعليمية' : 'Learning Paths'}</span>
              {#if pathsCount > 0}
                <span class="count-bubble">{pathsCount}</span>
              {/if}
            </button>

            <button
              type="button"
              class="filter-pill {activeFilter === 'playlist' ? 'active' : ''}"
              onclick={() => (activeFilter = 'playlist')}
            >
              <Icon name="video" size={14} />
              <span>{t('community.filterPlaylists')}</span>
              {#if playlistsCount > 0}
                <span class="count-bubble">{playlistsCount}</span>
              {/if}
            </button>

            <button
              type="button"
              class="filter-pill {activeFilter === 'pdf' ? 'active' : ''}"
              onclick={() => (activeFilter = 'pdf')}
            >
              <Icon name="reader" size={14} />
              <span>{t('community.filterPdfs')}</span>
              {#if pdfsCount > 0}
                <span class="count-bubble">{pdfsCount}</span>
              {/if}
            </button>

            <button
              type="button"
              class="filter-pill {activeFilter === 'cards' ? 'active' : ''}"
              onclick={() => (activeFilter = 'cards')}
            >
              <Icon name="flashcards" size={14} />
              <span>{t('community.filterCards')}</span>
              {#if cardsCount > 0}
                <span class="count-bubble">{cardsCount}</span>
              {/if}
            </button>

            <button
              type="button"
              class="filter-pill {activeFilter === 'notes' ? 'active' : ''}"
              onclick={() => (activeFilter = 'notes')}
            >
              <Icon name="file-text" size={14} />
              <span>{t('community.filterNotes')}</span>
              {#if notesCount > 0}
                <span class="count-bubble">{notesCount}</span>
              {/if}
            </button>
          </div>
        </div>

        <!-- 2. Sort by & Pricing -->
        <div class="hstack" style="gap:16px; flex-wrap:wrap; align-items:flex-start;">
          <!-- Sorting -->
          <div style="flex:1; min-width:220px;">
            <span class="filter-section-title muted" style="font-size:11.5px; font-weight:600; margin-bottom:6px; display:block;">
              {ui.lang === 'ar' ? 'ترتيب النتائج:' : 'Sort By:'}
            </span>
            <div class="sort-bar" style="margin:0;">
              <button
                type="button"
                class="sort-pill {activeSort === 'popular' ? 'active' : ''}"
                onclick={() => (activeSort = 'popular')}
              >
                <Icon name="flame" size={13} />
                <span>{t('community.sortMostPopular')}</span>
              </button>
              <button
                type="button"
                class="sort-pill {activeSort === 'rating' ? 'active' : ''}"
                onclick={() => (activeSort = 'rating')}
              >
                <Icon name="star" size={13} />
                <span>{t('community.sortTopRated')}</span>
              </button>
              <button
                type="button"
                class="sort-pill {activeSort === 'newest' ? 'active' : ''}"
                onclick={() => (activeSort = 'newest')}
              >
                <Icon name="clock" size={13} />
                <span>{t('community.sortNewest')}</span>
              </button>
            </div>
          </div>

          <!-- Pricing -->
          <div style="flex:1; min-width:200px;">
            <span class="filter-section-title muted" style="font-size:11.5px; font-weight:600; margin-bottom:6px; display:block;">
              {ui.lang === 'ar' ? 'التسعير:' : 'Pricing:'}
            </span>
            <div class="pricing-filter-group hstack">
              <button
                type="button"
                class="price-filter-pill {pricingFilter === 'all' ? 'active' : ''}"
                onclick={() => (pricingFilter = 'all')}
              >
                {ui.lang === 'ar' ? 'الكل' : 'All'}
              </button>
              <button
                type="button"
                class="price-filter-pill {pricingFilter === 'free' ? 'active' : ''}"
                onclick={() => (pricingFilter = 'free')}
              >
                <span class="dot-free"></span>
                <span>{ui.lang === 'ar' ? 'مجاني فقط' : 'Free'}</span>
              </button>
              <button
                type="button"
                class="price-filter-pill {pricingFilter === 'paid' ? 'active' : ''}"
                onclick={() => (pricingFilter = 'paid')}
              >
                <span class="dot-paid"></span>
                <span>{ui.lang === 'ar' ? 'مدفوع فقط' : 'Paid'}</span>
              </button>
            </div>
          </div>
        </div>

        <!-- 3. Popular Tags -->
        {#if availableTags && availableTags.length > 0}
          <div class="filter-section">
            <span class="filter-section-title muted" style="font-size:11.5px; font-weight:600; margin-bottom:6px; display:block;">
              {ui.lang === 'ar' ? 'الوسوم الشائعة:' : 'Popular Tags:'}
            </span>
            <div class="hstack" style="gap:6px; flex-wrap:wrap;">
              {#each availableTags.slice(0, 10) as [tag, count]}
                <button
                  type="button"
                  class="tag-pill-btn {selectedTagFilter === tag ? 'active' : ''}"
                  style="border-radius:999px; padding:3px 10px; font-size:11.5px; border:1px solid var(--border); background:{selectedTagFilter === tag ? 'var(--accent)' : 'var(--surface)'}; color:{selectedTagFilter === tag ? '#fff' : 'var(--text)'}; cursor:pointer;"
                  onclick={() => (selectedTagFilter = selectedTagFilter === tag ? '' : tag)}
                >
                  #{tag} ({count})
                </button>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    {/if}
  </div>

    <!-- Active Tag Filter Indicator -->
    {#if selectedTagFilter}
      <div class="active-tag-filter-bar hstack" style="gap:8px; margin:6px 0 10px; align-items:center;">
        <span class="muted" style="font-size:12px;">{ui.lang === 'ar' ? 'تصفية حسب الوسم:' : 'Filter by tag:'}</span>
        <span class="active-tag-chip hstack" style="gap:6px; background:var(--accent); color:#ffffff; padding:2px 10px; border-radius:12px; font-size:12px; font-weight:700;">
          <span>#{selectedTagFilter}</span>
          <button type="button" class="icon-btn tiny" style="color:#ffffff; background:transparent; border:none; padding:0; cursor:pointer;" onclick={() => (selectedTagFilter = '')} title="إلغاء الفلترة بالوسم">
            <Icon name="x" size={11} />
          </button>
        </span>
      </div>
    {:else if availableTags.length > 0}
      <!-- Popular Tags Bar for Quick Click Discovery -->
      <div class="community-tags-bar hstack" style="gap:6px; flex-wrap:wrap; margin:6px 0 12px; align-items:center;">
        <span class="muted" style="font-size:11.5px; display:inline-flex; align-items:center; gap:4px;">
          <Icon name="tag" size={12} /> {ui.lang === 'ar' ? 'الوسوم:' : 'Tags:'}
        </span>
        {#each availableTags.slice(0, 10) as [tg, count]}
          <button
            type="button"
            class="tag-pill-btn"
            onclick={() => (selectedTagFilter = tg)}
            title={`تصفية بالوسم #${tg}`}
          >
            #{tg} <span class="tag-count" style="opacity:0.75; font-size:10px;">({count})</span>
          </button>
        {/each}
      </div>
    {/if}

  <!-- Shares Grid -->
  <!-- Course / Playlist Dedicated Details View -->
  {#if selectedShareDetails}
    {@const share = selectedShareDetails}
    {@const unlocked = isContentUnlocked(share, currentUser)}
    {@const isOwner = isShareOwner(share, currentUser)}
    <div class="share-details-page">
      <div class="details-nav-bar hstack" style="justify-content:space-between; margin-bottom:16px;">
        <button class="secondary hstack" onclick={closeShareDetails}>
          <Icon name={ui.dir === 'rtl' ? 'arrow-right' : 'arrow-left'} size={15} />
          <span>{ui.lang === 'ar' ? 'العودة إلى قائمة المجتمع' : 'Back to Community'}</span>
        </button>

        {#if isOwner}
          <div class="hstack" style="gap:8px;">
            <button
              type="button"
              class="secondary small hstack"
              style={previewModeActive ? 'background:rgba(37,99,235,0.15); border-color:var(--accent); font-weight:700;' : ''}
              onclick={() => (previewModeActive = !previewModeActive)}
              title="معاينة محتوى وتفاصيل الدورة كما يراها الطلاب"
            >
              <Icon name={previewModeActive ? 'pencil' : 'eye'} size={14} />
              <span>{previewModeActive ? (ui.lang === 'ar' ? 'وضع المالك والتعديل' : 'Owner Edit Mode') : (ui.lang === 'ar' ? 'معاينة كما يراها الطالب' : 'Preview as Student')}</span>
            </button>
            {#if !previewModeActive}
              <button class="secondary small hstack" onclick={() => openEditShare(share)}>
                <Icon name="pencil" size={14} />
                <span>{ui.lang === 'ar' ? 'تعديل المحتوى' : 'Edit Share'}</span>
              </button>
              <button class="danger small hstack" onclick={() => handleDeleteShare(share)}>
                <Icon name="trash" size={14} />
                <span>{ui.lang === 'ar' ? 'حذف من المجتمع' : 'Delete'}</span>
              </button>
            {/if}
          </div>
        {/if}
      </div>

      <!-- Hero Header Card -->
      <div class="details-hero card">
        <div class="details-hero-layout" style="display:flex; gap:20px; flex-wrap:wrap; align-items:flex-start;">
          <div class="details-hero-thumb-wrapper" style="width:240px; max-width:100%; border-radius:10px; overflow:hidden; border:1px solid var(--border); flex-shrink:0;">
            {#if share.thumbnail}
              <img src={share.thumbnail} alt={share.title} style="width:100%; height:160px; object-fit:cover; display:block;" />
            {:else}
              <div style="width:100%; height:160px; display:flex; align-items:center; justify-content:center; background:var(--surface-2);">
                <Icon name={typeIcon(share.type)} size={48} />
              </div>
            {/if}
          </div>

          <div class="details-hero-info" style="flex:1; min-width:280px;">
            <div class="hstack" style="gap:8px; margin-bottom:8px; flex-wrap:wrap;">
              <span class="type-badge-pill hstack" style="padding:3px 10px; background:var(--surface-2); border-radius:999px; font-size:12px; gap:5px;">
                <Icon name={typeIcon(share.type)} size={12} />
                <span>{typeLabel(share.type)}</span>
              </span>

              {#if share.isPaid}
                <span class="price-badge-pill {unlocked ? 'unlocked' : 'locked'}" style="padding:3px 10px; border-radius:999px; font-size:12px; font-weight:700; background:{unlocked ? '#27ae60' : 'var(--accent)'}; color:#fff;">
                  {unlocked ? (ui.lang === 'ar' ? 'مُفعل بحسابك' : 'Enrolled') : `${share.price} ${share.currency || 'EGP'}`}
                </span>
              {:else}
                <span class="price-badge-pill free" style="padding:3px 10px; border-radius:999px; font-size:12px; font-weight:700; background:var(--surface-2); color:var(--text);">
                  {t('community.free')}
                </span>
              {/if}
            </div>

            <h2 class="details-title" style="margin:0 0 10px; font-size:20px;">{share.title}</h2>

            <div class="details-author-row hstack" style="gap:12px; margin-bottom:12px; font-size:13px; flex-wrap:wrap;">
              {#if share.teacher}
                <span class="hstack" style="gap:5px;">
                  <Icon name="graduation" size={14} style="color:var(--accent);" />
                  <span class="muted">{ui.lang === 'ar' ? 'المحاضر / المعلم:' : 'Instructor:'}</span>
                  <strong style="color:var(--text);">{share.teacher}</strong>
                </span>
                <span class="meta-dot">·</span>
              {/if}
              <span class="hstack" style="gap:5px;">
                <span class="muted">{ui.lang === 'ar' ? 'المشارك:' : 'Shared by:'}</span>
                <strong style="color:var(--text);">{share.author}</strong>
              </span>
              <span class="meta-dot">·</span>
              <button class="review-stat-btn hstack" onclick={() => openReviewsModal(share)} style="background:transparent; border:none; cursor:pointer; color:var(--text); gap:4px; padding:0;">
                <Icon name="star" size={13} />
                <span>{Number(share.rating || 5).toFixed(1)}</span>
              </button>
              <span class="meta-dot">·</span>
              <span class="stat-item hstack" style="gap:4px; color:var(--muted);">
                <Icon name="eye" size={13} />
                <span>{share.visits || 1} {ui.lang === 'ar' ? 'زيارة' : 'views'}</span>
              </span>
              {#if share.tags && share.tags.length > 0}
                <span class="meta-dot">·</span>
                <div class="hstack" style="gap:4px; flex-wrap:wrap;">
                  {#each share.tags as tg}
                    <span class="tag-pill-btn">#{tg}</span>
                  {/each}
                </div>
              {/if}
            </div>

            <p class="details-desc muted" style="font-size:13.5px; line-height:1.6; margin:0 0 16px; white-space:pre-wrap;">{share.description || 'لا يوجد وصف مضاف لهذا المحتوى.'}</p>

            <div class="details-actions-bar hstack" style="gap:10px; flex-wrap:wrap;">
              {#if share.isPaid && !unlocked && !isOwner}
                <button class="primary hstack" onclick={() => openPaymentModal(share)}>
                  <Icon name="upload" size={14} />
                  <span>{ui.lang === 'ar' ? 'شراء ورفع إيصال الدفع' : 'Enroll / Upload Receipt'}</span>
                </button>
                <button class="secondary hstack" onclick={() => (isRedeemModalOpen = true)}>
                  <Icon name="unlock" size={14} />
                  <span>{ui.lang === 'ar' ? 'تفعيل بكوبون / كلمة مرور' : 'Redeem Coupon'}</span>
                </button>
              {/if}

              {#if checkIsImported(share.id)}
                <button
                  class="secondary hstack in-library-btn"
                  disabled={true}
                  style="border-color:var(--accent); color:var(--accent); opacity:0.95; cursor:default; background:rgba(37,99,235,0.08);"
                  title="موجود في مكتبتك"
                >
                  <Icon name="check" size={14} />
                  <span>{ui.lang === 'ar' ? 'في مكتبتك' : 'In Library'}</span>
                </button>
              {:else}
                <button
                  class="{share.isPaid && !unlocked ? 'secondary' : 'primary'} hstack"
                  onclick={() => handleImport(share)}
                  disabled={importingId === share.id}
                >
                  <Icon name={importingId === share.id ? 'check' : 'plus'} size={14} />
                  <span>{importingId === share.id ? (ui.lang === 'ar' ? 'تمت الإضافة' : 'Added') : (ui.lang === 'ar' ? 'استيراد إلى قوائمي' : 'Import to My Playlists')}</span>
                </button>
              {/if}

              <!-- Share Direct Link Button -->
              <button class="secondary hstack" onclick={() => handleShareCourseLink(share)} title="مشاركة رابط الدورة المباشر">
                <Icon name="share" size={14} />
                <span>{ui.lang === 'ar' ? 'مشاركة' : 'Share'}</span>
              </button>

              {#if isOwner && !previewModeActive}
                {#if share.isPaid}
                  <button class="secondary hstack" onclick={() => { masterPasscodeDraft = share.masterPasscode || ''; isCouponsModalOpen = true; }}>
                    <Icon name="tag" size={14} />
                    <span>{ui.lang === 'ar' ? 'إدارة الكوبونات (20+)' : 'Coupons & Passcode'}</span>
                  </button>
                {/if}
                <button class="secondary hstack" onclick={() => (isInsertResourceModalOpen = true)}>
                  <Icon name="plus" size={14} />
                  <span>{ui.lang === 'ar' ? 'إدراج مورد / درس جديد' : 'Insert Resource'}</span>
                </button>
                <button
                  type="button"
                  class="secondary small hstack"
                  onclick={() => (showOwnerRawUrls = !showOwnerRawUrls)}
                  title="إظهار أو إخفاء الروابط الخام للمالك"
                  style="opacity:0.85;"
                >
                  <Icon name={showOwnerRawUrls ? 'eye-slash' : 'link'} size={13} />
                  <span>{showOwnerRawUrls ? 'إخفاء الروابط' : 'عرض الروابط'}</span>
                </button>
              {/if}

              <button class="secondary hstack" onclick={() => openReviewsModal(share)}>
                <Icon name="star" size={14} />
                <span>{ui.lang === 'ar' ? 'التقييمات والآراء' : 'Reviews'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Curriculum / Videos List Section -->
      {#if share.type === 'path'}
        <div class="curriculum-card card" style="margin-top:20px; padding:18px;">
          <div class="curriculum-header hstack" style="justify-content:space-between; margin-bottom:14px; flex-wrap:wrap; gap:8px;">
            <div class="hstack" style="gap:8px;">
              <Icon name="layers" size={18} />
              <h3 style="margin:0; font-size:16px;">
                مراحل وكورسات المسار التعليمي ({share.pathCourses?.length || share.items?.length || 0} دورات)
              </h3>
            </div>
            <small class="muted">
              مسار متسلسل يجمع عدة دورات لتحقيق إتقان كامل للمجال
            </small>
          </div>

          <div class="path-stages-display" style="display:flex; flex-direction:column; gap:12px;">
            {#each (share.pathCourses || share.items || []) as courseStage, sIdx}
              <div class="stage-block card" style="padding:14px; background:var(--surface-2); border:1px solid var(--border); border-radius:8px;">
                <div class="hstack" style="justify-content:space-between; margin-bottom:8px; flex-wrap:wrap; gap:6px;">
                  <div class="hstack" style="gap:10px;">
                    <span class="badge" style="font-weight:700; font-size:13px; padding:4px 10px; background:var(--accent); color:#fff; border-radius:6px;">المرحلة {sIdx + 1}</span>
                    <strong style="font-size:15px;">{courseStage.title}</strong>
                  </div>
                  <span class="muted" style="font-size:12px;">{courseStage.videoCount || courseStage.videos?.length || 1} فيديوهات · {formatTotalDuration(courseStage.durationSeconds) || ''}</span>
                </div>
                {#if courseStage.videos && courseStage.videos.length > 0}
                  <div class="stage-videos-list" style="display:flex; flex-direction:column; gap:4px; margin-top:8px;">
                    {#each courseStage.videos.slice(0, 5) as sv, vIdx}
                      <div class="stage-v-item hstack muted" style="font-size:12px; gap:8px; padding:4px 8px; background:var(--surface-1); border-radius:4px;">
                        <span class="idx">{vIdx + 1}.</span>
                        <span class="truncate grow">{sv.title}</span>
                        <span>{formatTotalDuration(sv.duration || sv.lengthSeconds) || ''}</span>
                      </div>
                    {/each}
                    {#if courseStage.videos.length > 5}
                      <small class="muted" style="text-align:center; padding:4px;">+{courseStage.videos.length - 5} فيديوهات أخرى داخل هذه المرحلة</small>
                    {/if}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {:else}
        <div class="curriculum-card card" style="margin-top:20px; padding:18px;">
          <div class="curriculum-header hstack" style="justify-content:space-between; margin-bottom:14px; flex-wrap:wrap; gap:8px;">
            <div class="hstack" style="gap:8px;">
              <Icon name="video" size={18} />
              <h3 style="margin:0; font-size:16px;">
                {ui.lang === 'ar' ? 'فيديوهات ودروس القائمة' : 'Course Lessons'} ({share.items?.length || share.playlistData?.videoUrls?.length || 1})
              </h3>
            </div>
            <small class="muted">
              {unlocked ? (ui.lang === 'ar' ? 'كافة الدروس مفتوحة لك للمشاهدة' : 'All lessons unlocked') : (ui.lang === 'ar' ? 'الدروس المميزة بـ "معاينة مجانية" متاحة للجميع' : 'Preview lessons are free to watch')}
            </small>
          </div>

          <div class="curriculum-list" style="display:flex; flex-direction:column; gap:8px;">
            {#each (share.items || (share.playlistData?.videoUrls || []).map((u, i) => ({ title: `${share.title} - درس ${i + 1}`, url: u, isFreePreview: i === 0 || !share.isPaid }))) as subItem, idx}
              {@const isSubVideo = !subItem.type || subItem.type === 'video'}
              {@const canWatch = unlocked || subItem.isFreePreview || !share.isPaid || (isOwner && !previewModeActive)}
              <div class="curriculum-item-row card hstack" style="padding:10px 14px; gap:12px; background:var(--surface-2); border:1px solid var(--border); border-radius:8px; align-items:center;">
              <div class="lesson-num-badge" style="width:26px; height:26px; border-radius:50%; background:var(--surface-1); border:1px solid var(--border); display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:700;">
                {idx + 1}
              </div>

              <div class="lesson-info" style="flex:1; min-width:0;">
                <div class="lesson-title hstack" style="gap:8px; margin-bottom:3px; flex-wrap:wrap;">
                  <span style="font-weight:600; font-size:13.5px;">{subItem.title}</span>
                  {#if subItem.type && subItem.type !== 'video'}
                    <span class="badge" style="font-size:11px; padding:2px 8px; border-radius:999px;">
                      {subItem.type === 'pdf' ? 'ملف PDF' : (subItem.type === 'notes' ? 'ملاحظة دراسية' : (subItem.type === 'cards' ? 'بطاقات استذكار' : subItem.type))}
                    </span>
                  {/if}
                  {#if subItem.isFreePreview && share.isPaid}
                    <span class="preview-tag-chip" style="padding:2px 8px; border-radius:999px; font-size:11px; background:#27ae6022; color:#27ae60; font-weight:700;">
                      {ui.lang === 'ar' ? 'معاينة مجانية' : 'Free Preview'}
                    </span>
                  {:else if !canWatch}
                    <span class="locked-tag-chip hstack" style="padding:2px 8px; border-radius:999px; font-size:11px; background:var(--surface-1); border:1px solid var(--border); color:var(--muted); gap:4px;">
                      <Icon name="lock" size={11} />
                      <span>{ui.lang === 'ar' ? 'مغلق للمشتركين' : 'Locked'}</span>
                    </span>
                  {/if}
                </div>
                {#if isOwner && !previewModeActive && showOwnerRawUrls}
                  <div class="lesson-url muted" style="font-size:11.5px; direction:ltr; text-align:left; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                    {subItem.url || subItem.pdfUrl || ''}
                  </div>
                {/if}
              </div>

              <div class="lesson-action">
                {#if canWatch}
                  <button
                    class="primary small hstack"
                    onclick={() => handleLessonClick(subItem, share)}
                  >
                    <Icon name={lessonIcon(subItem)} size={13} />
                    <span>{isSubVideo ? (ui.lang === 'ar' ? 'تشغيل' : 'Play') : (ui.lang === 'ar' ? 'فتح' : 'Open')}</span>
                  </button>
                {:else}
                  <button
                    class="secondary small hstack"
                    onclick={() => openPaymentModal(share)}
                  >
                    <Icon name="lock" size={13} />
                    <span>{ui.lang === 'ar' ? 'فتح الدرس' : 'Unlock'}</span>
                  </button>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      </div>
      {/if}
    </div>
  {:else if filteredShares.length === 0}
    <div class="empty-state card">
      <Icon name={activeFilter === 'my_shares' ? 'user' : 'globe'} size={42} />
      <h3>{activeFilter === 'my_shares' ? (ui.lang === 'ar' ? 'لم تنشر أي محتوى بعد' : 'No content published yet') : t('community.empty')}</h3>
      <p class="muted">
        {#if shares.length > 0}
          {ui.lang === 'ar' ? 'لا توجد نتائج تطابق خيارات التصفية أو البحث الحالية. يمكنك إظهار كافة المحتوى والدروس بالضغط على الزر أدناه.' : 'No items match your active filters or search. Click below to show all content.'}
        {:else if activeFilter === 'my_shares'}
          {ui.lang === 'ar' ? 'يمكنك مشاركة كورسات، قوائم يوتيوب، ملفات PDF، أو بطاقات استذكار باسمك وإدارتها وتعديلها من هنا بكل سهولة.' : 'You can publish and manage your courses, playlists, PDFs, and flashcards here.'}
        {:else}
          {ui.lang === 'ar' ? 'كن أول من يشارك محتوى تعليمي مفيد مع زملائك بالضغط على زر "مشاركة محتوى في المجتمع".' : 'Be the first to share useful educational content with your peers!'}
        {/if}
      </p>

      <div class="hstack" style="gap:10px; flex-wrap:wrap; justify-content:center; margin-top:14px;">
        {#if shares.length > 0}
          <button
            type="button"
            class="secondary hstack"
            onclick={() => { activeFilter = 'all'; pricingFilter = 'all'; selectedTagFilter = ''; searchQuery = ''; activeSort = 'popular'; }}
          >
            <Icon name="rotate-right" size={14} />
            <span>{ui.lang === 'ar' ? `عرض كل المحتوى (${shares.length} مشاركة)` : `Show All Content (${shares.length})`}</span>
          </button>
        {/if}
        <button class="primary hstack" onclick={openCreateShare}>
          <Icon name="plus" size={15} />
          <span>{t('community.shareContent')}</span>
        </button>
      </div>
    </div>
  {:else}
    <div class="shares-grid">
      {#each filteredShares as item (item.id)}
        {@const unlocked = isContentUnlocked(item, currentUser)}
        {@const isOwner = isShareOwner(item, currentUser)}
        {@const totalDur = formatTotalDuration(computeShareTotalDuration(item))}
        {@const displayTags = (item.tags && item.tags.length > 0) ? item.tags : (item.type === 'path' ? ['مسار', 'تعليمي'] : (item.type === 'pdf' ? ['ملخص', 'PDF'] : (item.type === 'cards' ? ['بطاقات', 'مراجعة'] : ['قائمة', 'دروس'])))}
        {@const displayTeacher = item.teacher || (item.author ? `أ. ${item.author}` : null)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
          class="share-card card clickable-card"
          role="button"
          tabindex="0"
          onclick={() => { selectedShareDetails = item; recordShareVisit(item.id); }}
        >
          <!-- Thumbnail & Badges -->
          <div class="share-media-container" style="position:relative;">
            {#if item.thumbnail}
              <img src={item.thumbnail} alt={item.title} class="share-thumb-img" loading="lazy" />
            {:else}
              <div class="share-thumb-placeholder">
                <Icon name={typeIcon(item.type)} size={32} />
              </div>
            {/if}

            <!-- Top Start: Price Badge (Free / Paid) -->
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

            <!-- Top End: Owner Edit & Delete Actions (NO OVERLAP) -->
            {#if isOwner}
              <div class="owner-floating-actions hstack">
                <button
                  type="button"
                  class="icon-btn small"
                  style="color:#fff;"
                  title="تعديل المشاركة"
                  onclick={(e) => { e.stopPropagation(); openEditShare(item); }}
                >
                  <Icon name="pencil" size={12} />
                </button>
                <button
                  type="button"
                  class="icon-btn danger small"
                  style="color:#ff6b6b;"
                  title="حذف المشاركة"
                  onclick={(e) => { e.stopPropagation(); handleDeleteShare(item); }}
                >
                  <Icon name="trash" size={12} />
                </button>
              </div>
            {/if}

            <!-- Bottom Start: Content Type Badge -->
            <span class="type-badge-floating hstack">
              <Icon name={typeIcon(item.type)} size={12} />
              <span>{typeLabel(item.type)}</span>
            </span>

            <!-- Bottom End: Total Duration Badge -->
            {#if totalDur}
              <span class="duration-badge-floating hstack">
                <Icon name="clock" size={11} />
                <span>{totalDur}</span>
              </span>
            {/if}
          </div>

          <div class="share-card-body">
            <h4 class="share-title">{ui.lang === 'en' && item.titleEn ? item.titleEn : item.title}</h4>
            <p class="share-description muted">{ui.lang === 'en' && item.descriptionEn ? item.descriptionEn : item.description}</p>

            <div class="card-meta-line hstack muted" style="font-size:12px; gap:8px; margin:4px 0 8px 0; justify-content:space-between; align-items:center;">
              <div class="hstack" style="gap:6px; min-width:0; flex-shrink:1;">
                {#if item.type === 'playlist' || item.type === 'video'}
                  <span class="hstack" style="gap:4px;"><Icon name="video" size={12} /> {item.items?.length || item.itemsCount || 1} دروس</span>
                {:else if item.type === 'path'}
                  <span class="hstack" style="gap:4px;"><Icon name="layers" size={12} /> {item.pathCourses?.length || item.items?.length || 0} دورات</span>
                {:else if item.type === 'pdf'}
                  <span class="hstack" style="gap:4px;"><Icon name="reader" size={12} /> PDF</span>
                {:else if item.type === 'cards'}
                  <span class="hstack" style="gap:4px;"><Icon name="flashcards" size={12} /> بطاقات</span>
                {:else if item.type === 'notes'}
                  <span class="hstack" style="gap:4px;"><Icon name="file-text" size={12} /> ملاحظات</span>
                {/if}
                {#if totalDur}
                  <span class="meta-dot">·</span>
                  <span class="hstack" style="gap:4px; font-weight:600;"><Icon name="clock" size={12} /> {totalDur}</span>
                {/if}
              </div>

              <!-- Tags on the other side of information -->
              {#if displayTags && displayTags.length > 0}
                <div class="card-tags-list hstack" style="gap:4px; flex-wrap:wrap; justify-content:flex-end;">
                  {#each displayTags.slice(0, 2) as tag}
                    <button
                      type="button"
                      class="tag-pill-btn"
                      onclick={(e) => { e.stopPropagation(); selectedTagFilter = (selectedTagFilter === tag ? '' : tag); }}
                      title={`تصفية حسب الوسم #${tag}`}
                    >
                      #{tag}
                    </button>
                  {/each}
                  {#if item.tags.length > 2}
                    <span class="tag-pill-more" title={item.tags.slice(2).join(', ')}>+{item.tags.length - 2}</span>
                  {/if}
                </div>
              {/if}
            </div>

            <!-- Author & Teacher Row -->
            <div class="share-author-row hstack" style="justify-content:space-between; align-items:center; margin-top:6px; flex-wrap:wrap; gap:6px;">
              <div class="hstack" style="gap:8px; font-size:12px; color:var(--text); flex-wrap:wrap;">
                {#if displayTeacher}
                  <div class="teacher-info hstack" style="gap:4px;" title="المحاضر / المعلم">
                    <Icon name="graduation" size={13} style="color:var(--accent);" />
                    <span style="font-weight:600; color:var(--text);">{displayTeacher}</span>
                  </div>
                  <span class="meta-dot" style="opacity:0.6;">·</span>
                {/if}
                <div class="hstack" style="gap:5px; color:var(--muted);" title="مشارك المحتوى">
                  <div class="author-avatar-circle">
                    {#if item.isAnonymous}
                      <Icon name="user" size={12} />
                    {:else if item.authorAvatar}
                      <img src={item.authorAvatar} alt="Avatar" class="avatar-mini" />
                    {:else}
                      <Icon name="user" size={12} />
                    {/if}
                  </div>
                  <span class="author-name" style="font-size:11.5px;">{item.author}</span>
                </div>
              </div>

              {#if item.isPrivate}
                <span class="private-badge hstack" title="محتوى خاص غير معروض للعامة">
                  <Icon name="lock" size={11} />
                  <span>خاص</span>
                </span>
              {/if}
            </div>
          </div>

          <div class="share-card-footer">
            <div class="share-stats hstack">
              <button
                class="review-stat-btn hstack"
                onclick={(e) => { e.stopPropagation(); openReviewsModal(item); }}
                title="عرض التقييمات والآراء"
              >
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
                  onclick={(e) => { e.stopPropagation(); openPaymentModal(item); }}
                >
                  <Icon name="upload" size={13} />
                  <span>شراء / رفع إيصال</span>
                </button>
              {/if}

              {#if checkIsImported(item.id)}
                <button
                  class="secondary small hstack in-library-btn"
                  disabled={true}
                  style="border-color:var(--accent); color:var(--accent); opacity:0.95; cursor:default; background:rgba(37,99,235,0.08);"
                  title="موجود بالفعل في مكتبتك"
                >
                  <Icon name="check" size={13} />
                  <span>{ui.lang === 'ar' ? 'في مكتبتك' : 'In Library'}</span>
                </button>
              {:else}
                <button
                  class="primary small import-btn hstack"
                  onclick={(e) => { e.stopPropagation(); handleImport(item); }}
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
              {/if}
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  <!-- 1. SHARE / EDIT CONTENT MODAL DIALOG -->
  {#if isShareModalOpen}
    <div class="modal-root" role="dialog" aria-modal="true">
      <div class="modal-backdrop" onclick={() => (isShareModalOpen = false)} role="presentation"></div>
      <div class="share-modal card" aria-label={editingShareId ? 'تعديل مشاركة المجتمع' : t('community.shareModalTitle')}>
        <div class="modal-header">
          <div class="hstack" style="gap:8px;">
            <Icon name={editingShareId ? 'pencil' : 'globe'} size={18} />
            <h3>{editingShareId ? (ui.lang === 'ar' ? 'تعديل المحتوى المشترك' : 'Edit Shared Content') : t('community.shareModalTitle')}</h3>
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
            class="type-pill {newShareType === 'path' ? 'active' : ''}"
            onclick={() => (newShareType = 'path')}
          >
            <Icon name="layers" size={14} />
            <span>مسار تعليمي متكامل</span>
          </button>
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

        <div class="hstack" style="gap:12px;">
          <div style="flex:1;">
            <label class="field-label" for="share-author">{t('community.shareAuthor')}</label>
            <input
              id="share-author"
              type="text"
              placeholder={currentUser?.name || 'اسمك أو اسم حسابك'}
              bind:value={newShareAuthor}
            />
          </div>
          <div style="flex:1;">
            <label class="field-label" for="share-teacher">اسم المحاضر / المعلم أو الشيخ (Teacher)</label>
            <input
              id="share-teacher"
              type="text"
              placeholder="مثال: د. إياد قنيبي أو م. أحمد حسام"
              bind:value={newShareTeacher}
            />
          </div>
        </div>

        <!-- Anonymity Option -->
        <label class="checkbox-label hstack">
          <input type="checkbox" bind:checked={newShareIsAnonymous} />
          <span>{t('community.anonymous')} (إخفاء اسمي وصورتي ونشر المحتوى كعضو مجهول)</span>
        </label>

        <!-- Dynamic Content Inputs -->
        {#if newShareType === 'playlist' || newShareType === 'video'}
          <div class="playlist-interactive-editor card" style="margin: 12px 0; padding: 12px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px;">
            <div class="hstack" style="justify-content:space-between; margin-bottom:10px;">
              <label class="field-label" style="margin:0; font-weight:700;">
                {newShareType === 'playlist' ? 'قائمة فيديوهات الكورس (إضافة وترتيب وتحديد المجاني)' : 'فيديو الدرس'}
              </label>
              <span class="badge-pill">{newShareItems.length} فيديو</span>
            </div>

            <!-- Inner Playlist Scraper Tool -->
            <div class="playlist-scraper-box" style="margin-bottom: 12px; padding: 12px; background: rgba(59, 130, 246, 0.08); border: 1px solid rgba(59, 130, 246, 0.28); border-radius: 8px;">
              <div class="hstack" style="justify-content:space-between; margin-bottom: 8px; flex-wrap: wrap; gap: 6px;">
                <span style="font-size: 13px; font-weight: 700; color: var(--accent, #3b82f6);" class="hstack">
                  <Icon name="link" size={15} />
                  <span>أداة الاستخراج الذكي لقوائم يوتيوب (Inner Playlist Scraper)</span>
                </span>
                <span class="muted" style="font-size: 11.5px;">استخراج كافة العناوين والروابط والغلاف تلقائياً</span>
              </div>
              <div class="hstack" style="gap: 8px;">
                <input
                  type="url"
                  placeholder="ضع رابط قائمة يوتيوب: https://www.youtube.com/playlist?list=..."
                  bind:value={playlistScrapeUrl}
                  onkeydown={(e) => { if (e.key === 'Enter') handleScrapePlaylist(); }}
                  style="flex: 1; font-size: 12.5px;"
                />
                <button
                  type="button"
                  class="primary small hstack"
                  disabled={isScrapingPlaylist || !playlistScrapeUrl.trim()}
                  onclick={handleScrapePlaylist}
                  style="white-space: nowrap; min-width: 140px; justify-content: center;"
                >
                  {#if isScrapingPlaylist}
                    <Icon name="rotate-right" size={13} class="spin" />
                    <span>جارِ الاستخراج...</span>
                  {:else}
                    <Icon name="download" size={13} />
                    <span>استخراج الفيديوهات والغلاف</span>
                  {/if}
                </button>
              </div>
            </div>

            <!-- Thumbnail Preview Banner -->
            {#if newShareThumbnail}
              <div class="thumbnail-preview-banner hstack" style="margin-bottom: 12px; padding: 8px 12px; background: var(--surface-1); border: 1px solid var(--border); border-radius: 6px; gap: 12px; align-items: center;">
                <img
                  src={newShareThumbnail}
                  alt="غلاف المحتوى"
                  style="width: 76px; height: 44px; object-fit: cover; border-radius: 4px; border: 1px solid var(--border); flex-shrink: 0;"
                />
                <div style="flex: 1; min-width: 0;">
                  <div style="font-size: 12px; font-weight: 700;" class="hstack">
                    <Icon name="check" size={13} />
                    <span>تم استخراج غلاف القائمة بنجاح</span>
                  </div>
                  <div class="muted truncate" style="font-size: 11px;" title={newShareThumbnail}>{newShareThumbnail}</div>
                </div>
                <button
                  type="button"
                  class="icon-btn small danger"
                  title="إزالة صورة الغلاف"
                  onclick={() => (newShareThumbnail = '')}
                >
                  <Icon name="trash" size={13} />
                </button>
              </div>
            {/if}

            <!-- Single Video Quick Add -->
            <div class="add-video-grid" style="display:grid; grid-template-columns: 1fr 1.5fr auto; gap: 8px; margin-bottom: 12px;">
              <input
                type="text"
                placeholder="عنوان الدرس (مثال: الدرس 1: مقدمة)"
                bind:value={newVideoTitleInput}
              />
              <input
                type="text"
                placeholder="رابط يوتيوب (يدعم unlisted)"
                bind:value={newVideoUrlInput}
                onkeydown={(e) => { if (e.key === 'Enter') addPlaylistItem(); }}
              />
              <button type="button" class="primary small hstack" onclick={addPlaylistItem}>
                <Icon name="plus" size={13} />
                <span>إضافة</span>
              </button>
            </div>

            <!-- Bulk Paste Accordion / Field -->
            <details class="bulk-urls-accordion" style="margin-bottom: 12px;">
              <summary class="muted" style="cursor:pointer; font-size:12px; user-select:none;">
                + أو استيراد روابط متعددة معاً (رابط لكل سطر)
              </summary>
              <div style="margin-top:8px;">
                <textarea
                  rows="3"
                  placeholder="https://www.youtube.com/watch?v=...&#10;https://www.youtube.com/watch?v=..."
                  bind:value={newShareUrls}
                ></textarea>
                <button type="button" class="secondary small mt" onclick={convertUrlsToItems}>
                  تحويل الروابط إلى قائمة قابلة للترتيب
                </button>
              </div>
            </details>

            <!-- Reorderable List of Playlist Items -->
            {#if newShareItems.length === 0}
              <div class="empty-items-hint muted" style="text-align:center; padding:16px; border:1px dashed var(--border); border-radius:6px; font-size:12.5px;">
                لم يتم إضافة فيديوهات بعد. أدخل رابط يوتيوب واضغط "إضافة" أعلاه.
              </div>
            {:else}
              <div class="playlist-items-table" style="display:flex; flex-direction:column; gap:6px; max-height:260px; overflow-y:auto;">
                {#each newShareItems as it, idx}
                  <div class="playlist-item-row card hstack" style="padding:6px 10px; gap:8px; background:var(--surface-1); border:1px solid var(--border); border-radius:6px; align-items:center;">
                    <!-- Order Reorder Controls -->
                    <div class="reorder-btns hstack" style="gap:2px;">
                      <button
                        type="button"
                        class="icon-btn small"
                        disabled={idx === 0}
                        title="تحريك لأعلى"
                        onclick={() => movePlaylistItem(idx, -1)}
                      >
                        <Icon name="chevron-up" size={13} />
                      </button>
                      <button
                        type="button"
                        class="icon-btn small"
                        disabled={idx === newShareItems.length - 1}
                        title="تحريك لأسفل"
                        onclick={() => movePlaylistItem(idx, 1)}
                      >
                        <Icon name="chevron-down" size={13} />
                      </button>
                    </div>

                    <span class="item-order-idx" style="font-size:12px; font-weight:700; min-width:20px; text-align:center;">{idx + 1}</span>

                    {#if it.thumbnail}
                      <img
                        src={it.thumbnail}
                        alt=""
                        style="width: 44px; height: 26px; object-fit: cover; border-radius: 4px; border: 1px solid var(--border); flex-shrink: 0;"
                        loading="lazy"
                      />
                    {/if}

                    <!-- Editable Title -->
                    <input
                      type="text"
                      style="flex:1; min-width:140px; padding:4px 8px; font-size:12.5px;"
                      bind:value={it.title}
                      placeholder="عنوان الفيديو"
                    />

                    <!-- Visibility Toggle (Free Preview vs Restricted) -->
                    <button
                      type="button"
                      class="visibility-toggle-btn hstack {it.isFreePreview ? 'preview-mode' : 'locked-mode'}"
                      onclick={() => togglePlaylistItemPreview(idx)}
                      title={it.isFreePreview ? 'متاح للمعاينة المجانية لكافة الطلاب' : 'مغلق ومخصص فقط للمشتركين بعد الدفع'}
                    >
                      <Icon name={it.isFreePreview ? 'unlock' : 'lock'} size={12} />
                      <span>{it.isFreePreview ? 'معاينة مجانية' : 'مغلق للمشتركين'}</span>
                    </button>

                    <!-- Remove Item -->
                    <button
                      type="button"
                      class="icon-btn danger small"
                      title="حذف هذا الفيديو من القائمة"
                      onclick={() => removePlaylistItem(idx)}
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {:else if newShareType === 'path'}
          <div class="path-courses-editor card" style="margin: 12px 0; padding: 14px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px;">
            <div class="hstack" style="justify-content:space-between; margin-bottom:10px;">
              <label class="field-label" style="margin:0; font-weight:700;">
                مراحل وكورسات المسار التعليمي ({newSharePathCourses.length} كورسات)
              </label>
              <span class="badge-pill">{newSharePathCourses.reduce((acc, c) => acc + (c.videoCount || 1), 0)} فيديو إجمالي</span>
            </div>

            <!-- Add Course to Path Input Bar -->
            <div class="path-add-box" style="padding:10px; background:rgba(59, 130, 246, 0.08); border:1px solid rgba(59, 130, 246, 0.28); border-radius:6px; margin-bottom:12px;">
              <div style="display:flex; flex-direction:column; gap:8px;">
                <input
                  type="text"
                  placeholder="اسم المرحلة / الكورس (مثال: المرحلة الأولى - الأساسيات)"
                  bind:value={newPathCourseTitle}
                />
                <div class="hstack" style="gap:8px;">
                  <input
                    type="url"
                    placeholder="رابط قائمة تشغيل يوتيوب للكورس..."
                    bind:value={newPathCourseUrl}
                    style="flex:1;"
                    onkeydown={(e) => { if (e.key === 'Enter') handleAddCourseToPath(); }}
                  />
                  <button
                    type="button"
                    class="primary small hstack"
                    disabled={isAddingPathCourse || (!newPathCourseTitle.trim() && !newPathCourseUrl.trim())}
                    onclick={handleAddCourseToPath}
                  >
                    {#if isAddingPathCourse}
                      <Icon name="rotate-right" size={13} class="spin" />
                      <span>جارِ الاستخراج...</span>
                    {:else}
                      <Icon name="plus" size={13} />
                      <span>إضافة الكورس</span>
                    {/if}
                  </button>
                </div>
              </div>
            </div>

            <!-- List of Added Courses in Path -->
            {#if newSharePathCourses.length === 0}
              <div class="empty muted" style="text-align:center; padding:12px; font-size:12.5px;">
                لم تقم بإضافة كورسات للمسار بعد. أضف روابط قوائم التشغيل للمراحل التعليمية أعلاه.
              </div>
            {:else}
              <div class="path-courses-list" style="display:flex; flex-direction:column; gap:8px;">
                {#each newSharePathCourses as c, idx (c.id)}
                  <div class="path-course-row hstack card" style="padding:8px 12px; justify-content:space-between; align-items:center;">
                    <div class="hstack" style="gap:10px; min-width:0;">
                      <span class="badge" style="font-weight:700;">{idx + 1}</span>
                      {#if c.thumbnail}
                        <img src={c.thumbnail} alt="" style="width:50px; height:30px; object-fit:cover; border-radius:4px;" />
                      {/if}
                      <div style="min-width:0;">
                        <div style="font-weight:700; font-size:13px;" class="truncate">{c.title}</div>
                        <div class="muted" style="font-size:11.5px;">{c.videoCount || 1} فيديوهات · {formatTotalDuration(c.durationSeconds) || 'مدد متنوعة'}</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      class="icon-btn small danger"
                      onclick={() => handleRemovePathCourse(idx)}
                      title="إزالة هذا الكورس من المسار"
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {:else if newShareType === 'pdf'}
          <label class="field-label">رفع ملف المستند (PDF)</label>
          <input type="file" accept="application/pdf" onchange={handleFileSelected} />
        {:else if newShareType === 'cards'}
          <label class="field-label">رفع بطاقات استذكار (Anki .apkg/.txt أو Excel .xlsx/.csv)</label>
          <input type="file" accept=".apkg,.txt,.csv,.xlsx,.tsv" onchange={handleFileSelected} />
        {/if}

        <!-- Pricing & Access Section -->
        <div class="pricing-section card">
          <div class="pricing-header-row hstack" style="justify-content:space-between; align-items:center; gap:16px; flex-wrap:wrap;">
            <div style="flex:1; min-width:200px;">
              <div class="field-label" style="margin:0 0 2px 0;">نوع الوصول والتسعير</div>
              <small class="muted" style="line-height:1.4; display:block;">حدد ما إذا كان المحتوى مجانياً بالكامل أو مدفوعاً مع إتاحة أول درس كمعاينة مجانية</small>
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

        <!-- Tags & Privacy Options -->
        <label class="field-label" for="share-tags" style="margin-top:12px;">الوسوم والتصنيفات (Tags)</label>
        <input
          id="share-tags"
          type="text"
          placeholder="أدخل وسوماً مفصولة بفاصلة، مثال: فكر، عقيدة، برمجة"
          bind:value={newShareTags}
        />
        {#if newShareTags.trim()}
          <div class="hstack" style="gap:6px; flex-wrap:wrap; margin-top:4px;">
            {#each normalizeTags(newShareTags) as tg}
              <span class="tag-pill-btn">#{tg}</span>
            {/each}
          </div>
        {/if}

        <label class="checkbox-label hstack" style="gap:8px; cursor:pointer; margin-top:12px;">
          <input type="checkbox" bind:checked={newShareIsPrivate} />
          <span>محتوى خاص بي فقط (غير معروض للعامة في المجتمع - خاص لمكتبتي)</span>
        </label>
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
          <Icon name={editingShareId ? 'check' : 'upload'} size={14} />
          <span>
            {#if isPublishing}
              {ui.lang === 'ar' ? 'جاري الحفظ…' : 'Saving...'}
            {:else if editingShareId}
              {ui.lang === 'ar' ? 'حفظ التعديلات' : 'Save Changes'}
            {:else}
              {t('community.publishShare')}
            {/if}
          </span>
        </button>
      </div>
    </div>
  </div>
  {/if}

  <!-- 2. PAYMENT RECEIPT UPLOAD MODAL -->
  {#if isPaymentModalOpen && selectedShareForPayment}
    <div class="modal-root" role="dialog" aria-modal="true">
      <div class="modal-backdrop" onclick={() => (isPaymentModalOpen = false)} role="presentation"></div>
      <div class="share-modal card" aria-label="شراء المحتوى ورفع الإيصال">
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
  </div>
  {/if}

  <!-- 3. CREATOR PAYMENT REQUESTS VERIFICATION MODAL -->
  {#if isOrdersModalOpen}
    <div class="modal-root" role="dialog" aria-modal="true">
      <div class="modal-backdrop" onclick={() => (isOrdersModalOpen = false)} role="presentation"></div>
      <div class="share-modal card wide" aria-label="مراجعة طلبات الدفع">
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
    </div>
  {/if}

  <!-- 4. FULL-SIZE RECEIPT IMAGE PREVIEW DIALOG -->
  {#if previewReceiptImg}
    <div class="modal-root" role="dialog" aria-modal="true">
      <div class="modal-backdrop receipt-zoom-backdrop" onclick={() => (previewReceiptImg = null)} role="presentation"></div>
      <div class="receipt-zoom-container" onclick={(e) => e.stopPropagation()}>
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
    <div class="modal-root" role="dialog" aria-modal="true">
      <div class="modal-backdrop" onclick={() => (activeReviewShare = null)} role="presentation"></div>
      <div class="share-modal card" aria-label="التقييمات والآراء">
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
    </div>
  {/if}

  <!-- Enroll First Confirmation Modal -->
  {#if enrollPromptItem}
    <div class="modal-root" role="dialog" aria-modal="true">
      <div class="modal-backdrop" onclick={() => (enrollPromptItem = null)} role="presentation"></div>
      <div class="share-modal card" style="max-width:440px;" aria-label="استيراد الدورة أولاً">
        <div class="modal-header">
          <div class="hstack" style="gap:8px;">
            <Icon name="bookmark" size={18} />
            <h3 style="margin:0;">استيراد الدورة أولاً</h3>
          </div>
          <button class="icon-btn" onclick={() => (enrollPromptItem = null)}>
            <Icon name="x" size={16} />
          </button>
        </div>
        <div class="modal-body" style="padding:16px 0; font-size:14px; line-height:1.6;">
          <p style="margin:0 0 12px;">
            لمتابعة كافة دروس دورة <strong>"{enrollPromptItem.share.title}"</strong> وحفظ تقدمك الدراسي وملاحظاتك في مكتبتك، يرجى استيراد الدورة أولاً.
          </p>
          <div class="hstack muted" style="font-size:12.5px; gap:6px;">
            <Icon name="check" size={14} />
            <span>الدرس المطلوب: {enrollPromptItem.subItem.title}</span>
          </div>
        </div>
        <div class="modal-footer hstack" style="justify-content:flex-end; gap:8px;">
          <button type="button" class="secondary" onclick={() => (enrollPromptItem = null)}>
            {t('common.cancel')}
          </button>
          <button type="button" class="primary hstack" onclick={handleConfirmEnrollAndPlay}>
            <Icon name="plus" size={14} />
            <span>استيراد ومتابعة التشغيل</span>
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Coupons & Passcode Management Modal (Owner) -->
  {#if isCouponsModalOpen && selectedShareDetails}
    {@const share = selectedShareDetails}
    {@const coupons = share.coupons || []}
    <div class="modal-root" role="dialog" aria-modal="true">
      <div class="modal-backdrop" onclick={() => (isCouponsModalOpen = false)} role="presentation"></div>
      <div class="share-modal card wide" style="max-width:680px;" aria-label="إدارة الكوبونات وأكواد التفعيل">
        <div class="modal-header">
          <div class="hstack" style="gap:8px;">
            <Icon name="tag" size={18} />
            <h3 style="margin:0;">إدارة الكوبونات وأكواد التفعيل: {share.title}</h3>
          </div>
          <button class="icon-btn" onclick={() => (isCouponsModalOpen = false)}>
            <Icon name="x" size={16} />
          </button>
        </div>

        <div class="modal-body" style="display:flex; flex-direction:column; gap:16px;">
          <!-- Master Passcode Section -->
          <div class="card" style="padding:14px; background:var(--surface-2); border:1px solid var(--border); border-radius:8px;">
            <div class="hstack" style="gap:8px; margin-bottom:6px;">
              <Icon name="unlock" size={15} />
              <strong style="font-size:14px;">كلمة المرور الموحدة للدورة (Master Passcode)</strong>
            </div>
            <p class="muted" style="font-size:12px; margin:0 0 10px;">
              كلمة مرور أو كود تفعيل موحد، يمكن لأي طالب يملك هذه الكلمة إدخالها ليتم تفعيل الدورة له مباشرة دون الحاجة لكوبون فردي.
            </p>
            <div class="hstack" style="gap:8px;">
              <input
                type="text"
                placeholder="مثال: ALLAMA2026 أو PASS-PHYSICS"
                bind:value={masterPasscodeDraft}
                style="flex:1;"
              />
              <button
                type="button"
                class="primary small hstack"
                onclick={() => handleSaveMasterPasscode(share.id)}
                disabled={isSavingPasscode}
              >
                <Icon name="check" size={13} />
                <span>حفظ كلمة المرور</span>
              </button>
            </div>
          </div>

          <!-- Batch Coupon Generator -->
          <div class="card" style="padding:14px; background:var(--surface-2); border:1px solid var(--border); border-radius:8px;">
            <div class="hstack" style="gap:8px; margin-bottom:6px;">
              <Icon name="plus" size={15} />
              <strong style="font-size:14px;">توليد دفعة كوبونات جديدة</strong>
            </div>
            <p class="muted" style="font-size:12px; margin:0 0 10px;">
              توليد أكواد فريدة مشفرة بنقرة واحدة (مثلاً 20 كوبون)، كل كوبون صالح لاستخدام طالب واحد ويتم تحديث حالته فوراً.
            </p>
            <div class="hstack" style="gap:8px;">
              <input
                type="number"
                min="1"
                max="100"
                placeholder="عدد الكوبونات"
                bind:value={couponBatchCount}
                style="width:120px;"
              />
              <button
                type="button"
                class="primary small hstack"
                onclick={() => handleGenerateCoupons(share.id)}
                disabled={isGeneratingCoupons}
              >
                <Icon name="sparkles" size={13} />
                <span>{isGeneratingCoupons ? 'جارِ التوليد...' : `توليد ${couponBatchCount || 20} كوبون الآن`}</span>
              </button>
            </div>
          </div>

          <!-- Coupons List & Status Table -->
          <div class="coupons-list-wrapper">
            <div class="hstack" style="justify-content:space-between; margin-bottom:8px;">
              <strong style="font-size:13.5px;">قائمة الكوبونات المنشأة ({coupons.length})</strong>
              <small class="muted">
                {coupons.filter(c => (c.usedCount || 0) >= (c.maxUses || 1)).length} مُستخدمة · {coupons.filter(c => (c.usedCount || 0) < (c.maxUses || 1)).length} متاحة
              </small>
            </div>

            {#if coupons.length === 0}
              <div class="empty muted" style="padding:20px; text-align:center; background:var(--surface-1); border-radius:8px;">
                لم يتم إنشاء أي كوبونات بعد. اضغط على زر التوليد أعلاه لإنشاء دفعة جديدة.
              </div>
            {:else}
              <div style="max-height:240px; overflow-y:auto; display:flex; flex-direction:column; gap:6px;">
                {#each coupons as cpn}
                  {@const isUsed = (cpn.usedCount || 0) >= (cpn.maxUses || 1)}
                  <div class="coupon-item-row hstack card" style="padding:8px 12px; background:var(--surface-1); border-radius:6px; justify-content:space-between; border:1px solid {isUsed ? 'rgba(39, 174, 96, 0.4)' : 'var(--border)'};">
                    <div class="hstack" style="gap:10px;">
                      <code style="font-size:13px; font-weight:700; color:var(--text); letter-spacing:0.5px;">{cpn.code}</code>
                      <button
                        type="button"
                        class="icon-btn tiny"
                        onclick={() => { navigator.clipboard?.writeText(cpn.code); notify('تم نسخ الكود!', 'ok'); }}
                        title="نسخ الكود"
                      >
                        <Icon name="copy" size={12} />
                      </button>
                    </div>

                    <div class="hstack" style="gap:8px;">
                      {#if isUsed}
                        <span class="badge" style="background:#27ae60; color:#fff; font-size:11px; padding:2px 8px; border-radius:999px; font-weight:700;">
                          مُستخدم ({cpn.usedBy?.[0]?.username || 'طالب'})
                        </span>
                      {:else}
                        <span class="badge" style="background:var(--accent); color:#fff; font-size:11px; padding:2px 8px; border-radius:999px;">
                          متاح للاستخدام
                        </span>
                      {/if}
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        </div>

        <div class="modal-footer hstack" style="justify-content:flex-end;">
          <button type="button" class="secondary" onclick={() => (isCouponsModalOpen = false)}>
            إغلاق
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Student Coupon Redemption Modal -->
  {#if isRedeemModalOpen && selectedShareDetails}
    {@const share = selectedShareDetails}
    <div class="modal-root" role="dialog" aria-modal="true">
      <div class="modal-backdrop" onclick={() => (isRedeemModalOpen = false)} role="presentation"></div>
      <div class="share-modal card" style="max-width:440px;" aria-label="تفعيل الدورة بكوبون أو كلمة مرور">
        <div class="modal-header">
          <div class="hstack" style="gap:8px;">
            <Icon name="unlock" size={18} />
            <h3 style="margin:0;">تفعيل الدورة بكوبون أو كلمة مرور</h3>
          </div>
          <button class="icon-btn" onclick={() => (isRedeemModalOpen = false)}>
            <Icon name="x" size={16} />
          </button>
        </div>

        <div class="modal-body" style="padding:16px 0; display:flex; flex-direction:column; gap:12px;">
          <p class="muted" style="font-size:13px; margin:0;">
            أدخل كود الكوبون المخصص لك أو كلمة المرور الخاصة بالدورة <strong>"{share.title}"</strong> لفتح المحتوى فوراً:
          </p>
          <input
            type="text"
            placeholder="أدخل كود الكوبون (مثال: MK-XXXX-YYYY) أو كلمة المرور..."
            bind:value={redeemCodeInput}
            onkeydown={(e) => { if (e.key === 'Enter') handleRedeemCoupon(share.id); }}
            style="direction:ltr; text-align:center; font-weight:700; letter-spacing:1px;"
          />
        </div>

        <div class="modal-footer hstack" style="justify-content:flex-end; gap:8px;">
          <button type="button" class="secondary" onclick={() => (isRedeemModalOpen = false)}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            class="primary hstack"
            onclick={() => handleRedeemCoupon(share.id)}
            disabled={isRedeemingCoupon || !redeemCodeInput.trim()}
          >
            <Icon name="check" size={14} />
            <span>{isRedeemingCoupon ? 'جارِ التحقق...' : 'تفعيل وفتح المحتوى'}</span>
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Owner Resource Insertion Modal -->
  {#if isInsertResourceModalOpen && selectedShareDetails}
    {@const share = selectedShareDetails}
    {@const itemsCount = share.items?.length || share.playlistData?.videoUrls?.length || 0}
    <div class="modal-root" role="dialog" aria-modal="true">
      <div class="modal-backdrop" onclick={() => (isInsertResourceModalOpen = false)} role="presentation"></div>
      <div class="share-modal card" style="max-width:520px;" aria-label="إدراج مورد جديد داخل الدورة">
        <div class="modal-header">
          <div class="hstack" style="gap:8px;">
            <Icon name="plus" size={18} />
            <h3 style="margin:0;">إدراج مورد جديد داخل الدورة</h3>
          </div>
          <button class="icon-btn" onclick={() => (isInsertResourceModalOpen = false)}>
            <Icon name="x" size={16} />
          </button>
        </div>

        <div class="modal-body" style="display:flex; flex-direction:column; gap:12px;">
          <!-- Resource Type Selector -->
          <div>
            <label class="field-label" style="display:block; margin-bottom:6px; font-weight:600;">نوع المورد التعليمي:</label>
            <div class="hstack" style="gap:6px; flex-wrap:wrap;">
              <button
                type="button"
                class="filter-pill {insertResourceType === 'video' ? 'active' : ''}"
                onclick={() => (insertResourceType = 'video')}
              >
                <Icon name="video" size={13} />
                <span>فيديو يوتيوب</span>
              </button>
              <button
                type="button"
                class="filter-pill {insertResourceType === 'pdf' ? 'active' : ''}"
                onclick={() => (insertResourceType = 'pdf')}
              >
                <Icon name="book-open" size={13} />
                <span>ملف PDF / مذكرة</span>
              </button>
              <button
                type="button"
                class="filter-pill {insertResourceType === 'notes' ? 'active' : ''}"
                onclick={() => (insertResourceType = 'notes')}
              >
                <Icon name="file-text" size={13} />
                <span>ملاحظات دراسية</span>
              </button>
              <button
                type="button"
                class="filter-pill {insertResourceType === 'cards' ? 'active' : ''}"
                onclick={() => (insertResourceType = 'cards')}
              >
                <Icon name="layers" size={13} />
                <span>بطاقات استذكار</span>
              </button>
            </div>
          </div>

          <!-- Title Input -->
          <div>
            <label class="field-label" style="display:block; margin-bottom:4px; font-weight:600;">عنوان المورد:</label>
            <input
              type="text"
              placeholder="مثال: مذكرة شرح الدرس الأول أو فيديو ملخص..."
              bind:value={insertResourceTitle}
            />
          </div>

          <!-- URL or Content Input -->
          <div>
            <label class="field-label" style="display:block; margin-bottom:4px; font-weight:600;">
              {insertResourceType === 'notes' ? 'محتوى الملاحظة (نص / Markdown):' : 'الرابط أو المسار:'}
            </label>
            {#if insertResourceType === 'notes'}
              <textarea
                rows="3"
                placeholder="اكتب الملاحظات أو النقاط الملخصة هنا..."
                bind:value={insertResourceContent}
              ></textarea>
            {:else}
              <input
                type="url"
                placeholder={insertResourceType === 'pdf' ? 'رابط ملف PDF أو مستند...' : 'رابط الفيديو على يوتيوب...'}
                bind:value={insertResourceUrl}
              />
            {/if}
          </div>

          <!-- Position Selector -->
          <div>
            <label class="field-label" style="display:block; margin-bottom:4px; font-weight:600;">موضع الإدراج داخل القائمة:</label>
            <select bind:value={insertResourcePosition} style="width:100%;">
              <option value={-1}>في نهاية الدورة (بعد العنصر الأخير)</option>
              <option value={0}>في البداية (قبل الدرس الأول)</option>
              {#each Array(itemsCount) as _, pIdx}
                <option value={pIdx + 1}>بعد العنصر رقم {pIdx + 1}</option>
              {/each}
            </select>
          </div>

          <!-- Free Preview Checkbox -->
          {#if share.isPaid}
            <label class="hstack" style="gap:8px; cursor:pointer; font-size:13px; margin-top:4px;">
              <input type="checkbox" bind:checked={insertResourceIsFreePreview} />
              <span>متاح للمعاينة المجانية لكافة الطلاب</span>
            </label>
          {/if}
        </div>

        <div class="modal-footer hstack" style="justify-content:flex-end; gap:8px;">
          <button type="button" class="secondary" onclick={() => (isInsertResourceModalOpen = false)}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            class="primary hstack"
            onclick={() => handleInsertResource(share.id)}
            disabled={isInsertingResource || !insertResourceTitle.trim()}
          >
            <Icon name="check" size={14} />
            <span>{isInsertingResource ? 'جارِ الإدراج...' : 'إدراج المورد'}</span>
          </button>
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
    transform: none !important;
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

  .pricing-filter-group {
    gap: 3px;
    background: var(--surface-2);
    padding: 3px;
    border-radius: 999px;
    border: 1px solid var(--border);
  }
  .price-filter-pill {
    border: none;
    background: transparent;
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 11.5px;
    color: var(--text-muted);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    transition: all 0.15s ease;
  }
  .price-filter-pill.active {
    background: var(--surface);
    color: var(--text);
    font-weight: 600;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
  }
  .dot-free {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #10b981;
  }
  .dot-paid {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #f59e0b;
  }

  /* Grid of Shares: 3 cards per row on desktop & laptop, 2 on tablet, 1 on mobile */
  .shares-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 14px;
  }
  @media (max-width: 860px) and (min-width: 540px) {
    .shares-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }
  }
  @media (max-width: 539px) {
    .shares-grid {
      grid-template-columns: 1fr;
      gap: 10px;
    }
  }

  .tag-pill-btn {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 2px 7px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    background: var(--surface-2, rgba(255, 255, 255, 0.05));
    border: 1px solid var(--border);
    color: var(--accent);
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
  }
  .tag-pill-btn:hover {
    background: var(--accent);
    color: #ffffff;
    border-color: var(--accent);
  }
  .tag-pill-btn.active {
    background: var(--accent);
    color: #ffffff;
    border-color: var(--accent);
  }
  .tag-pill-more {
    font-size: 10px;
    color: var(--muted);
    padding: 1px 4px;
    border-radius: 3px;
    background: var(--surface-2);
  }
  .teacher-info {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
  }
  .private-badge {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 10.5px;
    font-weight: 600;
    color: var(--muted);
    background: var(--surface-2);
    border: 1px solid var(--border);
    padding: 1px 6px;
    border-radius: 4px;
  }
  .in-library-btn {
    opacity: 0.95;
    background: rgba(37, 99, 235, 0.08) !important;
    border-color: var(--accent) !important;
    color: var(--accent) !important;
    font-weight: 600 !important;
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
    bottom: 8px;
    inset-inline-start: 8px;
    background: rgba(0, 0, 0, 0.75);
    color: #fff;
    backdrop-filter: blur(4px);
    padding: 3px 8px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 600;
    z-index: 3;
  }

  .duration-badge-floating {
    position: absolute;
    bottom: 8px;
    inset-inline-end: 8px;
    background: rgba(0, 0, 0, 0.75);
    color: #fff;
    backdrop-filter: blur(4px);
    padding: 3px 8px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 600;
    z-index: 3;
  }

  .price-badge-floating {
    position: absolute;
    top: 8px;
    inset-inline-start: 8px;
    background: #e74c3c;
    color: #fff;
    padding: 3px 8px;
    border-radius: 6px;
    font-size: 11.5px;
    font-weight: 700;
    z-index: 3;
  }
  .owner-floating-actions {
    position: absolute;
    top: 8px;
    inset-inline-end: 8px;
    z-index: 4;
    gap: 4px;
    background: rgba(0, 0, 0, 0.65);
    padding: 3px 6px;
    border-radius: 6px;
  }
  .filter-dropdown-btn.active {
    background: var(--accent-light, rgba(59, 130, 246, 0.15)) !important;
    border-color: var(--accent) !important;
    color: var(--accent) !important;
  }
  .opt-btn {
    padding: 5px 8px;
    font-size: 11.5px;
    font-weight: 500;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--surface-2);
    color: var(--text);
    cursor: pointer;
    text-align: center;
    transition: all 0.12s ease;
  }
  .opt-btn:hover {
    background: var(--surface-3);
  }
  .opt-btn.active {
    background: var(--accent);
    color: #fff;
    border-color: var(--accent);
    font-weight: 600;
  }
  .price-badge-floating.free {
    background: #27ae60;
  }
  .price-badge-floating.unlocked {
    background: var(--accent);
  }

  .share-card-body {
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1;
  }
  .share-title {
    margin: 0;
    font-size: 13.5px;
    font-weight: 700;
    line-height: 1.35;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .share-description {
    margin: 0;
    font-size: 11.5px;
    line-height: 1.4;
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
  .modal-root {
    position: fixed;
    inset: 0;
    z-index: 99999;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow-y: auto;
    padding: 20px 14px;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(5px);
  }
  .modal-root > .modal-backdrop {
    position: fixed !important;
    inset: 0 !important;
    background: transparent !important;
    z-index: 1 !important;
    pointer-events: auto !important;
  }
  .modal-root > *:not(.modal-backdrop),
  .share-modal,
  .payment-modal,
  .orders-modal,
  .review-modal,
  .receipt-zoom-container {
    position: relative !important;
    top: auto;
    left: auto;
    transform: none;
    margin: auto;
    z-index: 100000 !important;
    pointer-events: auto !important;
  }
  .share-modal {
    width: min(580px, 94vw);
    max-height: calc(100vh - 40px);
    overflow-y: auto;
    padding: 22px;
    border-radius: var(--radius-lg);
    display: flex;
    flex-direction: column;
    gap: 14px;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.35);
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
    padding: 12px 14px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-md, 8px);
  }
  .pricing-toggle-group {
    display: inline-flex;
    flex-shrink: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm, 6px);
    overflow: hidden;
    background: var(--surface-1);
  }
  .price-toggle-btn {
    border: none;
    background: transparent;
    padding: 7px 18px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    color: var(--text-muted);
    white-space: nowrap;
    min-width: 70px;
    text-align: center;
    transition: background 0.15s ease, color 0.15s ease;
  }
  .price-toggle-btn.active {
    background: var(--accent);
    color: #fff;
    font-weight: 700;
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

  .clickable-card {
    cursor: pointer;
    transition: transform 0.15s ease, box-shadow 0.15s ease;
  }
  .clickable-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.12);
  }

  .visibility-toggle-btn {
    border: none;
    border-radius: 999px;
    padding: 3px 10px;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    gap: 4px;
    transition: all 0.15s ease;
  }
  .visibility-toggle-btn.preview-mode {
    background: #27ae6022;
    color: #27ae60;
    border: 1px solid #27ae6088;
  }
  .visibility-toggle-btn.locked-mode {
    background: var(--surface-2);
    color: var(--muted);
    border: 1px solid var(--border);
  }
  .visibility-toggle-btn:hover {
    filter: brightness(1.1);
  }

  .share-details-page {
    display: flex;
    flex-direction: column;
    animation: fadeIn 0.2s ease;
  }
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }
</style>
