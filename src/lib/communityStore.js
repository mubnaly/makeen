// src/lib/communityStore.js — Makeen Community Store with Real Database, Content Gating & Monetization
// Community content is browsable by all learners, with free preview vs paid access, and peer review options.

import { upsertDocument, upsertPlaylist } from './library.js';
import { putCard, putCommunityShare, listCommunitySharesDb, deleteCommunityShareDb } from './storage.js';
import { createNote } from './markdownStore.js';
import { getCurrentUser } from './auth.js';
import { isContentUnlocked } from './sessionStore.js';

const VIEWS_STORAGE_KEY = 'makeen.community.views';
const WIPED_INITIAL_KEY = 'makeen.community.wiped_v2';

/**
 * Checks if old mock data has been wiped. If not, cleans the database once.
 */
export async function ensureFreshCommunityData() {
  try {
    if (!localStorage.getItem(WIPED_INITIAL_KEY)) {
      const existing = await listCommunitySharesDb();
      for (const item of existing) {
        await deleteCommunityShareDb(item.id);
      }
      localStorage.setItem(WIPED_INITIAL_KEY, 'true');
    }
  } catch {}
}

export async function updateCommunityShare(shareId, updatedData) {
  const existingList = await listCommunitySharesDb();
  const existing = existingList.find((s) => s.id === shareId);
  if (!existing) return null;

  const user = getCurrentUser();
  const isAnonymous = updatedData.isAnonymous !== undefined ? Boolean(updatedData.isAnonymous) : existing.isAnonymous;
  const authorName = isAnonymous
    ? 'مشارك مجهول (Anonymous)'
    : (updatedData.author || user?.name || user?.username || existing.author || 'طالب مَكِين');

  const authorAvatar = isAnonymous ? '' : (user?.avatar || existing.authorAvatar || '');
  const isPaid = updatedData.isPaid !== undefined ? Boolean(updatedData.isPaid) : existing.isPaid;
  const price = isPaid ? Math.max(0, Math.round(Number(updatedData.price ?? existing.price) * 100) / 100) : 0;

  const merged = {
    ...existing,
    ...updatedData,
    id: shareId,
    author: authorName,
    authorAvatar,
    isAnonymous,
    isPaid,
    price,
    items: Array.isArray(updatedData.items) ? updatedData.items : existing.items,
    updatedAt: Date.now()
  };

  await putCommunityShare(merged);
  return merged;
}

export async function deleteCommunityShare(shareId) {
  await deleteCommunityShareDb(shareId);
  return true;
}

export function isShareOwner(share, user) {
  if (!share || !user) return false;
  if (share.creatorId && user.id && String(share.creatorId) === String(user.id)) return true;
  if (share.author && (share.author === user.name || share.author === user.username)) return true;
  return false;
}

/**
 * Lists community items sorted and loaded from IndexedDB.
 */
export async function listCommunityShares() {
  await ensureFreshCommunityData();
  const dbShares = await listCommunitySharesDb();
  const viewsMap = loadViewsMap();

  return dbShares.map((s) => ({
    ...s,
    visits: (s.visits || 0) + (viewsMap[s.id] || 0)
  }));
}

/**
 * Publishes a new community item into IndexedDB.
 */
export async function publishCommunityShare(shareData) {
  const user = getCurrentUser();
  const isAnonymous = Boolean(shareData.isAnonymous);

  const authorName = isAnonymous
    ? 'مشارك مجهول (Anonymous)'
    : (shareData.author || user?.name || user?.username || 'طالب مَكِين');

  const authorAvatar = isAnonymous ? '' : (user?.avatar || '');

  const isPaid = Boolean(shareData.isPaid && Number(shareData.price) > 0);
  const price = isPaid ? Math.max(0, Math.round(Number(shareData.price) * 100) / 100) : 0;

  const newShare = {
    id: `comm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: shareData.type || 'playlist', // 'playlist' | 'pdf' | 'cards' | 'notes' | 'video'
    title: shareData.title.trim(),
    titleEn: shareData.titleEn || shareData.title.trim(),
    author: authorName,
    authorAvatar,
    creatorId: user?.id || 'guest',
    isAnonymous,
    category: shareData.category || 'general',
    visits: 1,
    rating: 5.0,
    ratingsCount: 1,
    itemsCount: shareData.itemsCount || 1,
    description: shareData.description || '',
    thumbnail: shareData.thumbnail || '',
    isPaid,
    price,
    currency: shareData.currency || 'EGP',
    // Detailed items with individual free preview toggle
    items: Array.isArray(shareData.items) ? shareData.items : [],
    playlistData: shareData.playlistData || null,
    cardsData: shareData.cardsData || null,
    pdfData: shareData.pdfData || null,
    noteContent: shareData.noteContent || '',
    createdAt: Date.now()
  };

  await putCommunityShare(newShare);
  return newShare;
}

function loadViewsMap() {
  try {
    const raw = localStorage.getItem(VIEWS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function recordShareVisit(shareId) {
  try {
    const map = loadViewsMap();
    map[shareId] = (map[shareId] || 0) + 1;
    localStorage.setItem(VIEWS_STORAGE_KEY, JSON.stringify(map));
  } catch {}
}

/**
 * Imports community share into local library.
 * If paid and locked, throws an error requiring payment.
 */
export async function importShareToMyLibrary(share) {
  recordShareVisit(share.id);

  if (share.isPaid && !isContentUnlocked(share)) {
    throw new Error('CONTENT_LOCKED_PAYMENT_REQUIRED');
  }

  if (share.type === 'playlist') {
    const urls = share.playlistData?.videoUrls || [];
    const items = Array.isArray(share.items) && share.items.length ? share.items : urls.map((u, idx) => ({ title: `${share.title} - ${idx + 1}`, url: u, isFreePreview: true }));
    const playlistId = `pl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const childVideoIds = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const url = item.url || item;
      const vidMatch = String(url).match(/(?:v=|\/embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
      const ytId = vidMatch ? vidMatch[1] : '';
      const docId = `yt-video-${ytId || Math.random().toString(36).slice(2)}`;

      const saved = upsertDocument({
        id: docId,
        kind: 'video',
        provider: ytId ? 'youtube' : 'local',
        ytType: 'video',
        ytId,
        title: item.title || `${share.title} — درس ${i + 1}`,
        filename: url,
        url,
        embedUrl: ytId ? `https://www.youtube-nocookie.com/embed/${ytId}?rel=0&modestbranding=1` : url,
        size: 0,
        mime: 'text/html',
        missing: false,
        playlistId,
        isPlaylistChild: true, // Stays in Playlists tab, avoids polluting flat individual videos
        fromCommunity: true,
        communityShareId: share.id,
        isPaid: !!share.isPaid,
        isProtected: !!share.isPaid || !item.isFreePreview
      });
      if (saved?.id) {
        childVideoIds.push(saved.id);
      }
    }

    upsertPlaylist({
      id: playlistId,
      title: share.title,
      videoIds: childVideoIds,
      fromCommunity: true,
      communityShareId: share.id,
      isPaid: !!share.isPaid,
      isProtected: !!share.isPaid
    });
    return { ok: true, type: 'playlist', count: childVideoIds.length };
  }

  if (share.type === 'cards') {
    const cards = share.cardsData || [];
    let count = 0;
    for (const c of cards) {
      await putCard({
        id: crypto.randomUUID ? crypto.randomUUID() : `card-${Math.random().toString(36).slice(2)}`,
        front: c.front,
        back: c.back,
        source: share.title,
        tags: [share.title],
        due: new Date().toISOString().slice(0, 10),
        deck: share.title,
        createdAt: new Date().toISOString()
      });
      count++;
    }
    return { ok: true, type: 'cards', count };
  }

  if (share.type === 'notes') {
    const note = createNote({
      title: share.title,
      content: share.noteContent || `# ${share.title}\n\n`
    });
    return { ok: true, type: 'notes', noteId: note.id };
  }

  if (share.type === 'pdf') {
    upsertDocument({
      id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      kind: 'pdf',
      title: share.title,
      filename: `${share.title}.pdf`,
      url: share.pdfData?.url || share.pdfUrl || '',
      sizeBytes: share.pdfData?.size || 1024 * 500,
      dateAdded: Date.now()
    });
    return { ok: true, type: 'pdf' };
  }

  return { ok: false };
}
