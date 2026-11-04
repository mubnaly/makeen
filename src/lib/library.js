// Document library and reading history (plan §6.2): remembers last page, zoom and
// last-opened time so a reader can resume. Kept separate from the sidecars.

const KEY = 'studyos.library';

function read() {
  try {
    const raw = globalThis.localStorage && globalThis.localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function write(list) {
  try {
    if (globalThis.localStorage) globalThis.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* quota: history is best-effort */
  }
  return list;
}

export function isDocumentStarted(doc) {
  if (!doc) return false;
  if (doc.kind === 'video' || doc.provider === 'youtube') {
    return Number(doc.lastSeconds) > 0 || Number(doc.timeSpentSeconds) > 0;
  }
  return Number(doc.lastPage) > 0 || Number(doc.timeSpentSeconds) > 0;
}

export function listDocuments() {
  const rawList = read();
  // Deduplicate entries by unique file key: filePath || filename || id
  const map = new Map();
  for (const doc of rawList) {
    const normName = String(doc.filename || doc.title || '').trim().toLowerCase();
    const key = doc.filePath
      ? `path:${doc.filePath.toLowerCase()}`
      : (normName ? `${doc.kind || 'pdf'}:${normName}` : `id:${doc.id}`);

    const existing = map.get(key);
    if (!existing) {
      map.set(key, doc);
    } else {
      // Pick the most recently updated/opened record, preserving highest progress
      const existingTime = existing.lastOpened || existing.addedAt || 0;
      const docTime = doc.lastOpened || doc.addedAt || 0;
      const bestPage = Math.max(Number(existing.lastPage) || 0, Number(doc.lastPage) || 0);
      const bestSeconds = Math.max(Number(existing.lastSeconds) || 0, Number(doc.lastSeconds) || 0);
      const bestTimeSpent = Math.max(Number(existing.timeSpentSeconds) || 0, Number(doc.timeSpentSeconds) || 0);

      const winner = docTime >= existingTime ? doc : existing;
      const merged = {
        ...existing,
        ...doc,
        id: existing.id, // keep stable ID
        lastPage: bestPage || winner.lastPage || undefined,
        lastSeconds: bestSeconds || winner.lastSeconds || undefined,
        timeSpentSeconds: bestTimeSpent || winner.timeSpentSeconds || undefined,
        lastOpened: Math.max(existing.lastOpened || 0, doc.lastOpened || 0) || undefined
      };
      map.set(key, merged);
    }
  }

  const deduplicated = Array.from(map.values());
  if (deduplicated.length < rawList.length) {
    write(deduplicated);
  }
  return deduplicated.sort((a, b) => (b.lastOpened || b.addedAt || 0) - (a.lastOpened || a.addedAt || 0));
}

export function getDocument(id) {
  return read().find((d) => d.id === id) || null;
}

export function upsertDocument(doc) {
  const list = read();
  const normName = String(doc.filename || doc.title || '').trim().toLowerCase();

  // Find existing by ID OR by filePath OR by normalized filename of same kind
  const idx = list.findIndex((d) => {
    if (d.id === doc.id) return true;
    if (doc.filePath && d.filePath && d.filePath.toLowerCase() === doc.filePath.toLowerCase()) return true;
    if (normName && d.kind === doc.kind) {
      const dNorm = String(d.filename || d.title || '').trim().toLowerCase();
      if (dNorm && dNorm === normName) return true;
    }
    return false;
  });

  const targetId = idx >= 0 ? list[idx].id : (doc.id || crypto.randomUUID());
  const existing = idx >= 0 ? list[idx] : null;

  const merged = existing
    ? {
        ...existing,
        ...doc,
        id: targetId,
        // Preserve and update highest progress values
        lastPage: doc.lastPage !== undefined ? doc.lastPage : existing.lastPage,
        lastSeconds: doc.lastSeconds !== undefined ? doc.lastSeconds : existing.lastSeconds,
        lastOpened: doc.lastOpened || Date.now()
      }
    : {
        addedAt: Date.now(),
        ...doc,
        id: targetId
      };

  if (idx >= 0) list[idx] = merged;
  else list.push(merged);
  write(list);
  return merged;
}

export function touchDocument(id, patch = {}) {
  const list = read();
  const idx = list.findIndex((d) => d.id === id);
  if (idx < 0) return null;
  list[idx] = { ...list[idx], lastOpened: Date.now(), ...patch };
  write(list);
  return list[idx];
}

// Resume position: last page + zoom (plan §6.2 "remember the last page, zoom").
export function setReadingPosition(id, { page, zoom }) {
  const list = read();
  const idx = list.findIndex((d) => d.id === id);
  if (idx < 0) return null;
  list[idx] = { ...list[idx], lastPage: page, lastZoom: zoom, lastOpened: Date.now() };
  write(list);
  return list[idx];
}

// Videos resume at a timecode instead of a page (plan §6.6: timestamps and
// bookmarks are data, not notes pasted into a comment).
export function setPlaybackPosition(id, seconds) {
  const list = read();
  const idx = list.findIndex((d) => d.id === id);
  if (idx < 0) return null;
  const lastSeconds = Math.max(0, Math.round(Number(seconds) || 0));
  list[idx] = { ...list[idx], lastSeconds, lastOpened: Date.now() };
  write(list);
  return list[idx];
}

export function setBookmarks(id, bookmarks) {
  const list = read();
  const idx = list.findIndex((d) => d.id === id);
  if (idx < 0) return null;
  list[idx] = { ...list[idx], bookmarks: bookmarks.map((b) => ({ ...b })) };
  write(list);
  return list[idx];
}

export function markMissing(id, missing = true) {
  const list = read();
  const idx = list.findIndex((d) => d.id === id);
  if (idx < 0) return null;
  list[idx] = { ...list[idx], missing };
  write(list);
  return list[idx];
}

// Clear reading history WITHOUT deleting the library record (plan §6.2).
export function clearHistory() {
  const list = read().map((d) => {
    const { lastPage, lastZoom, lastOpened, ...rest } = d;
    return rest;
  });
  write(list);
}

export function removeDocument(id) {
  write(read().filter((d) => d.id !== id));
}

// --- Custom Playlists -------------------------------------------------------
const PLAYLISTS_KEY = 'studyos.playlists';

function readPlaylists() {
  try {
    const raw = globalThis.localStorage && globalThis.localStorage.getItem(PLAYLISTS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writePlaylists(list) {
  try {
    if (globalThis.localStorage) globalThis.localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(list));
  } catch {}
  return list;
}

export function listPlaylists() {
  return readPlaylists().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export function upsertPlaylist(pl) {
  const list = readPlaylists();
  const id = pl.id || crypto.randomUUID();
  const now = Date.now();
  const idx = list.findIndex((p) => p.id === id);
  const item = {
    id,
    title: pl.title || 'Playlist',
    videoIds: Array.isArray(pl.videoIds) ? pl.videoIds : [],
    createdAt: pl.createdAt || now,
    updatedAt: now
  };
  if (idx >= 0) list[idx] = { ...list[idx], ...item };
  else list.push(item);
  writePlaylists(list);
  return item;
}

export function removePlaylist(id) {
  writePlaylists(readPlaylists().filter((p) => p.id !== id));
}

export function addVideoToPlaylist(playlistId, videoId) {
  const list = readPlaylists();
  const pl = list.find((p) => p.id === playlistId);
  if (!pl) return null;
  if (!pl.videoIds.includes(videoId)) {
    pl.videoIds = [...pl.videoIds, videoId];
    pl.updatedAt = Date.now();
    writePlaylists(list);
  }
  return pl;
}

export function removeVideoFromPlaylist(playlistId, videoId) {
  const list = readPlaylists();
  const pl = list.find((p) => p.id === playlistId);
  if (!pl) return null;
  pl.videoIds = pl.videoIds.filter((id) => id !== videoId);
  pl.updatedAt = Date.now();
  writePlaylists(list);
  return pl;
}

export function moveVideoInPlaylist(playlistId, videoId, delta) {
  const list = readPlaylists();
  const pl = list.find((p) => p.id === playlistId);
  if (!pl) return null;
  const idx = pl.videoIds.indexOf(videoId);
  const target = idx + (Number(delta) || 0);
  if (idx < 0 || target < 0 || target >= pl.videoIds.length) return pl;
  const ids = [...pl.videoIds];
  const [removed] = ids.splice(idx, 1);
  ids.splice(target, 0, removed);
  pl.videoIds = ids;
  pl.updatedAt = Date.now();
  writePlaylists(list);
  return pl;
}
