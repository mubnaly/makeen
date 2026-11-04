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

export function listDocuments() {
  return read().sort((a, b) => (b.lastOpened || b.addedAt || 0) - (a.lastOpened || a.addedAt || 0));
}

export function getDocument(id) {
  return read().find((d) => d.id === id) || null;
}

export function upsertDocument(doc) {
  const list = read();
  const idx = list.findIndex((d) => d.id === doc.id);
  const merged = idx >= 0 ? { ...list[idx], ...doc } : { addedAt: Date.now(), ...doc };
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
