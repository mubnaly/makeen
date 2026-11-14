// src/lib/communityStore.js — Makeen Community Store with Real Database, Content Gating & Monetization
// Community content is browsable by all learners, with free preview vs paid access, and peer review options.

import { upsertDocument, upsertPlaylist } from './library.js';
import { putCard, putCommunityShare, listCommunitySharesDb, deleteCommunityShareDb } from './storage.js';
import { createNote } from './markdownStore.js';
import { getCurrentUser } from './auth.js';
import { isContentUnlocked } from './sessionStore.js';
import { upsertProject } from './projects.js';
import {
  apiFetchCommunityShares,
  apiPublishCommunityShare,
  apiUpdateCommunityShare,
  apiDeleteCommunityShare,
  apiRecordShareVisit
} from './api.js';

export function normalizeTags(tags) {
  if (Array.isArray(tags)) {
    return tags.map((t) => String(t).trim().replace(/^#+/, '')).filter(Boolean);
  }
  if (typeof tags === 'string') {
    return tags
      .split(/[,،\s]+/)
      .map((t) => t.trim().replace(/^#+/, ''))
      .filter(Boolean);
  }
  return [];
}

const IMPORTED_SHARES_KEY = 'studyos.community.imported_shares';

export function getImportedShareIds() {
  try {
    const raw = localStorage.getItem(IMPORTED_SHARES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function isShareImported(shareId) {
  if (!shareId) return false;
  const list = getImportedShareIds();
  return list.includes(shareId);
}

export function recordShareImported(shareId) {
  if (!shareId) return;
  try {
    const list = getImportedShareIds();
    if (!list.includes(shareId)) {
      list.push(shareId);
      localStorage.setItem(IMPORTED_SHARES_KEY, JSON.stringify(list));
    }
  } catch {}
}

export function formatTotalDuration(seconds, lang = 'ar') {
  const sec = Number(seconds) || 0;
  if (sec <= 0) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (lang === 'en') {
    if (h > 0) return `${h} hr${h > 1 ? 's' : ''}${m > 0 ? ' ' + m + ' min' : ''}`;
    if (m > 0) return `${m} min`;
    return `${s} sec`;
  }
  if (h > 0) return `${h} س${m > 0 ? ' ' + m + ' د' : ''}`;
  if (m > 0) return `${m} دقيقة`;
  return `${s} ثانية`;
}

export function computeShareTotalDuration(share) {
  if (!share) return 0;
  let total = 0;
  if (Array.isArray(share.items)) {
    for (const it of share.items) {
      total += Number(it.duration || it.durationSeconds || it.lengthSeconds || 0);
    }
  }
  if (Array.isArray(share.pathCourses)) {
    for (const c of share.pathCourses) {
      const cDur = Number(c.durationSeconds || c.totalDurationSeconds || c.duration || 0);
      if (cDur > 0) {
        total += cDur;
      } else if (Array.isArray(c.videos)) {
        for (const v of c.videos) {
          total += Number(v.duration || v.durationSeconds || v.lengthSeconds || 0);
        }
      } else if (Array.isArray(c.items)) {
        for (const it of c.items) {
          total += Number(it.duration || it.durationSeconds || it.lengthSeconds || 0);
        }
      }
    }
  }
  if (total <= 0 && share.totalDurationSeconds && Number(share.totalDurationSeconds) > 0) {
    return Number(share.totalDurationSeconds);
  }
  // Smart fallback estimate if durations were not yet indexed (~25 min per lesson/video)
  if (total <= 0) {
    const videoCount = (share.items?.length || share.itemsCount || share.playlistData?.videoUrls?.length || 0);
    if (videoCount > 0) {
      return videoCount * 25 * 60;
    }
    const pathCoursesCount = (share.pathCourses?.length || 0);
    if (pathCoursesCount > 0) {
      return pathCoursesCount * 8 * 25 * 60;
    }
  }
  return total;
}

export async function listUserCommunityShares(userId, authorName) {
  const all = await listCommunityShares();
  return all.filter((s) => {
    if (userId && s.creatorId && String(s.creatorId) === String(userId)) return true;
    if (authorName && s.author && s.author.toLowerCase() === authorName.toLowerCase()) return true;
    return false;
  });
}

const VIEWS_STORAGE_KEY = 'makeen.community.views';
const WIPED_INITIAL_KEY = 'makeen.community.wiped_v2';

/**
 * Checks if old mock data has been wiped. If not, cleans the database once.
 */
export async function ensureFreshCommunityData() {
  // Safe no-op: never wipe user-created community shares
  return;
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
  const tags = updatedData.tags !== undefined ? normalizeTags(updatedData.tags) : (existing.tags || []);
  const isPrivate = updatedData.isPrivate !== undefined ? Boolean(updatedData.isPrivate) : Boolean(existing.isPrivate);
  const teacher = updatedData.teacher !== undefined ? String(updatedData.teacher || '').trim() : (existing.teacher || '');

  const merged = {
    ...existing,
    ...updatedData,
    id: shareId,
    author: authorName,
    authorAvatar,
    teacher,
    isAnonymous,
    isPaid,
    price,
    tags,
    isPrivate,
    items: Array.isArray(updatedData.items) ? updatedData.items : existing.items,
    updatedAt: Date.now()
  };

  try {
    await apiUpdateCommunityShare(shareId, merged);
  } catch {}
  await putCommunityShare(merged);
  return merged;
}

export async function deleteCommunityShare(shareId) {
  try {
    await apiDeleteCommunityShare(shareId);
  } catch {}
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
 * Lists community items sorted and loaded from PostgreSQL backend or IndexedDB fallback.
 */
export async function listCommunityShares() {
  const user = getCurrentUser();
  let remote = [];
  try {
    const res = await apiFetchCommunityShares();
    if (Array.isArray(res)) remote = res;
  } catch {}

  const dbShares = await listCommunitySharesDb();
  const viewsMap = loadViewsMap();

  const map = new Map();
  // 1. Remote shares first
  for (const s of remote) {
    if (s?.id) map.set(s.id, s);
  }
  // 2. Local database shares (ensures user's created and published lists are always preserved)
  for (const s of dbShares) {
    if (s?.id) map.set(s.id, s);
  }

  return Array.from(map.values())
    .filter((s) => !s.isPrivate || isShareOwner(s, user))
    .map((s) => ({
      ...s,
      visits: (s.visits || 0) + (viewsMap[s.id] || 0)
    }));
}

/**
 * Publishes a new community item into PostgreSQL or IndexedDB.
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
  const tags = normalizeTags(shareData.tags);
  const isPrivate = Boolean(shareData.isPrivate);
  const teacher = String(shareData.teacher || '').trim();

  const newShare = {
    id: `comm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: shareData.type || 'playlist', // 'playlist' | 'path' | 'pdf' | 'cards' | 'notes' | 'video'
    title: shareData.title.trim(),
    titleEn: shareData.titleEn || shareData.title.trim(),
    author: authorName,
    authorAvatar,
    teacher,
    creatorId: user?.id || 'guest',
    isAnonymous,
    category: shareData.category || 'general',
    tags,
    isPrivate,
    visits: 1,
    rating: 5.0,
    ratingsCount: 1,
    itemsCount: shareData.itemsCount || 1,
    description: shareData.description || '',
    thumbnail: shareData.thumbnail || '',
    isPaid,
    price,
    currency: shareData.currency || 'EGP',
    totalDurationSeconds: shareData.totalDurationSeconds || computeShareTotalDuration(shareData) || 0,
    pathCourses: Array.isArray(shareData.pathCourses) ? shareData.pathCourses : [],
    // Detailed items with individual free preview toggle
    items: Array.isArray(shareData.items) ? shareData.items : [],
    playlistData: shareData.playlistData || null,
    cardsData: shareData.cardsData || null,
    pdfData: shareData.pdfData || null,
    noteContent: shareData.noteContent || '',
    createdAt: Date.now()
  };

  try {
    await apiPublishCommunityShare(newShare);
  } catch {}
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
    apiRecordShareVisit(shareId);
  } catch {}
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
  recordShareImported(share.id);

  if (share.isPaid && !isContentUnlocked(share)) {
    throw new Error('CONTENT_LOCKED_PAYMENT_REQUIRED');
  }

  if (share.type === 'path') {
    const courses = Array.isArray(share.pathCourses) && share.pathCourses.length ? share.pathCourses : (Array.isArray(share.items) ? share.items : []);
    const projId = `proj-path-${Date.now()}`;
    const projectFolders = [];
    const allProjVideos = [];

    for (let cIdx = 0; cIdx < courses.length; cIdx++) {
      const course = courses[cIdx];
      const folderId = `fld-${cIdx + 1}-${Date.now()}`;
      const folderItems = [];
      const playlistId = `pl-path-${Date.now()}-${cIdx}`;
      const childVideoIds = [];
      const vids = Array.isArray(course.videos) ? course.videos : (Array.isArray(course.items) ? course.items : []);

      for (let i = 0; i < vids.length; i++) {
        const item = vids[i];
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
          title: item.title || `${course.title || 'دورة'} — درس ${i + 1}`,
          filename: url,
          url,
          embedUrl: ytId ? `https://www.youtube-nocookie.com/embed/${ytId}?rel=0&modestbranding=1` : url,
          size: 0,
          mime: 'text/html',
          missing: false,
          playlistId,
          isPlaylistChild: true,
          fromCommunity: true,
          communityShareId: share.id,
          isPaid: !!share.isPaid,
          isProtected: !!share.isPaid || !item.isFreePreview
        });
        if (saved?.id) {
          childVideoIds.push(saved.id);
          allProjVideos.push(saved.id);
          folderItems.push({ type: 'video', refId: saved.id, name: saved.title });
        }
      }

      upsertPlaylist({
        id: playlistId,
        title: `${share.title} — ${course.title || `مرحلة ${cIdx + 1}`}`,
        videoIds: childVideoIds,
        fromCommunity: true,
        communityShareId: share.id,
        isPaid: !!share.isPaid,
        isProtected: !!share.isPaid
      });

      projectFolders.push({
        id: folderId,
        name: course.title || `المرحلة ${cIdx + 1}`,
        items: folderItems
      });
    }

    upsertProject({
      id: projId,
      name: `مسار: ${share.title}`,
      description: share.description || '',
      category: share.category || 'مسار تعليمي',
      videos: allProjVideos,
      folders: projectFolders,
      studyList: allProjVideos
    });

    return { ok: true, type: 'path', coursesCount: courses.length, totalVideos: allProjVideos.length };
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
