// Trash & Archive management module for StudyOS.
// Preserves deleted videos, documents, projects, and study notes with configurable auto-purge.

const TRASH_KEY = 'studyos.trash';
const RETENTION_KEY = 'studyos.trash.retentionDays';
const ARCHIVE_KEY = 'studyos.archived_content';
const DEFAULT_RETENTION_DAYS = 30;

export function loadTrashRetentionDays() {
  if (typeof localStorage === 'undefined') return DEFAULT_RETENTION_DAYS;
  const raw = localStorage.getItem(RETENTION_KEY);
  if (raw === null || raw === undefined) return DEFAULT_RETENTION_DAYS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : DEFAULT_RETENTION_DAYS;
}

export function saveTrashRetentionDays(days) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(RETENTION_KEY, String(days));
}

export function listTrash() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(TRASH_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function persistTrash(items) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(TRASH_KEY, JSON.stringify(items || []));
  } catch {}
}

export function moveToTrash(item, { kind = 'video', preservedContent = null } = {}) {
  if (!item || !item.id) return null;
  const trashItems = listTrash().filter((t) => t.id !== item.id);
  const trashEntry = {
    id: item.id,
    kind: kind || item.kind || 'video',
    title: item.title || item.filename || item.name || 'Untitled',
    deletedAt: Date.now(),
    originalItem: { ...item },
    preservedContent: preservedContent || {
      bookmarks: item.bookmarks || [],
      captures: item.captures || [],
      notes: item.notes || [],
      transcript: item.transcript || null
    }
  };
  trashItems.unshift(trashEntry);
  persistTrash(trashItems);

  // If item has preserved content (subtitles, notes, markdown, cards, screenshots, marks), preserve in dedicated archive
  if (trashEntry.preservedContent && (
    trashEntry.preservedContent.captures?.length ||
    trashEntry.preservedContent.notes?.length ||
    trashEntry.preservedContent.markdownNotes?.length ||
    trashEntry.preservedContent.cards?.length ||
    trashEntry.preservedContent.annotations?.length ||
    trashEntry.preservedContent.bookmarks?.length ||
    trashEntry.preservedContent.transcript
  )) {
    archiveContent(item.id, {
      id: item.id,
      title: trashEntry.title,
      kind: trashEntry.kind,
      archivedAt: Date.now(),
      content: trashEntry.preservedContent
    });
  }

  return trashEntry;
}

export function restoreTrashItem(id) {
  const items = listTrash();
  const found = items.find((t) => t.id === id);
  if (!found) return null;
  const remaining = items.filter((t) => t.id !== id);
  persistTrash(remaining);
  return found;
}

export function deleteTrashPermanently(id) {
  const items = listTrash().filter((t) => t.id !== id);
  persistTrash(items);
}

export function emptyAllTrash() {
  persistTrash([]);
}

export function purgeExpiredTrash(retentionDays = loadTrashRetentionDays()) {
  if (retentionDays <= 0) return { purged: 0 }; // 0 = never purge
  const items = listTrash();
  const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const kept = [];
  let purgedCount = 0;

  for (const item of items) {
    if (now - (item.deletedAt || 0) > maxAgeMs) {
      purgedCount++;
    } else {
      kept.push(item);
    }
  }

  if (purgedCount > 0) {
    persistTrash(kept);
  }
  return { purged: purgedCount, remaining: kept.length };
}

// --- Archived Preserved Content (accessible even if original file is cleared) ---

export function listArchivedContent() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(ARCHIVE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function archiveContent(id, record) {
  if (typeof localStorage === 'undefined' || !id) return;
  try {
    const list = listArchivedContent().filter((a) => a.id !== id);
    list.unshift(record);
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify(list));
  } catch {}
}

export function removeArchivedContent(id) {
  if (typeof localStorage === 'undefined' || !id) return;
  try {
    const list = listArchivedContent().filter((a) => a.id !== id);
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify(list));
  } catch {}
}
