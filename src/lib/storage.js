// Local persistence (plan §7.2, §7.3, §11.1; fixes gap defect D3).
//
// Guarantees a sidecar is genuinely durable before the UI may claim success:
//   - every save writes a guaranteed key/value record (localStorage) AND, when a
//     desktop file bridge exists, an atomically-written JSON file;
//   - loading prefers the newer of file vs. local record and can recover from a
//     rolling backup copy when both are missing/corrupt.
// No caller can be told "saved" unless one of those layers actually accepted it.

import { parseSidecar, serializeSidecar, validateSidecar } from './sidecar.js';
import { normalizeCard } from './flashcards.js';

const memoryStore = new Map();

// --- key/value adapters ------------------------------------------------------

export function memoryKV() {
  const m = new Map();
  return {
    get: (k) => (m.has(k) ? m.get(k) : null),
    set: (k, v) => m.set(k, v),
    remove: (k) => m.delete(k),
    kind: 'memory'
  };
}

export function webKV() {
  const ls = globalThis.localStorage;
  if (!ls) return memoryKV();
  return {
    get: (k) => ls.getItem(k),
    set: (k, v) => ls.setItem(k, v),
    remove: (k) => ls.removeItem(k),
    kind: 'localStorage'
  };
}

// --- desktop file bridge -----------------------------------------------------
// Exposed by electron/preload.cjs as window.studyos. All methods optional.

export function fileBridge() {
  const api = globalThis.window && globalThis.window.studyos;
  if (api && typeof api.saveSidecarFile === 'function') return api;
  return null;
}

// --- sidecar store -----------------------------------------------------------

const PRIMARY = (id) => `studyos.sidecar.${id}`;
const BACKUP = (id) => `studyos.sidecar.backup.${id}`;

export function createSidecarStore({ kv = webKV(), bridge = fileBridge(), debounceMs = 150 } = {}) {
  const pending = new Map(); // docId -> sidecar object awaiting flush
  let timer = null;
  const onUnload = () => flushNow();

  if (typeof globalThis.addEventListener === 'function') {
    globalThis.addEventListener('beforeunload', onUnload);
  }

  function writeLocal(id, sidecar) {
    const text = serializeSidecar(sidecar);
    // Rolling backup: keep the previous valid record one generation back.
    const prev = kv.get(PRIMARY(id));
    if (prev != null) kv.set(BACKUP(id), prev);
    kv.set(PRIMARY(id), text);
    return text;
  }

  async function writeFile(id, text) {
    if (!bridge) return { written: false };
    try {
      const res = await bridge.saveSidecarFile(id, text);
      if (res && res.ok === false) return { written: false, error: res.error || 'file write rejected' };
      return { written: true, path: res && res.path };
    } catch (e) {
      return { written: false, error: e.message };
    }
  }

  async function save(id, sidecar) {
    const check = validateSidecar(sidecar);
    if (!check.ok) throw new Error(`refusing to save invalid sidecar: ${check.errors.join('; ')}`);
    const text = writeLocal(id, sidecar); // guaranteed durable layer, synchronous
    const file = await writeFile(id, text);
    if (!file.written && bridge && file.error) {
      // Desktop bridge was present but the write failed: report honestly.
      return { ok: false, storage: 'local', error: file.error };
    }
    return {
      ok: true,
      storage: file.written ? 'file+local' : 'local',
      path: file.path || null
    };
  }

  // Debounced save used for rapid interactions; localStorage already written on
  // each commit inside save(), so this only coalesces repeated file writes.
  function schedule(id, sidecar) {
    pending.set(id, sidecar);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      flushNow();
    }, debounceMs);
  }

  function flushNow() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const entries = [...pending.entries()];
    pending.clear();
    const results = [];
    for (const [id, sidecar] of entries) {
      try {
        const text = writeLocal(id, sidecar);
        // Fire-and-forget file write; local record already durable.
        if (bridge) writeFile(id, text);
        results.push({ id, ok: true });
      } catch (e) {
        results.push({ id, ok: false, error: e.message });
      }
    }
    return results;
  }

  function pickNewer(a, b) {
    // a, b are parsed sidecars or null.
    if (!a) return b;
    if (!b) return a;
    return (b.updated_at || '') > (a.updated_at || '') ? b : a;
  }

  function tryParse(text) {
    if (text == null) return { sidecar: null };
    try {
      return { sidecar: parseSidecar(text) };
    } catch (e) {
      return { sidecar: null, error: e.message };
    }
  }

  async function load(id) {
    const errors = [];
    let fromFile = null;
    let fromLocal = null;
    let fromBackup = null;

    if (bridge && typeof bridge.loadSidecarFile === 'function') {
      try {
        const text = await bridge.loadSidecarFile(id);
        const r = tryParse(text);
        fromFile = r.sidecar;
        if (r.error) errors.push(`file: ${r.error}`);
      } catch (e) {
        errors.push(`file: ${e.message}`);
      }
    }
    const local = tryParse(kv.get(PRIMARY(id)));
    fromLocal = local.sidecar;
    if (local.error) errors.push(`local: ${local.error}`);
    const backup = tryParse(kv.get(BACKUP(id)));
    fromBackup = backup.sidecar;
    if (backup.error && !backup.sidecar) errors.push(`backup: ${backup.error}`);

    const primary = pickNewer(fromFile, fromLocal);
    if (primary) {
      return { sidecar: primary, source: fromFile && fromFile === primary ? 'file' : 'local', recovered: false, errors };
    }
    if (fromBackup) {
      return { sidecar: fromBackup, source: 'backup', recovered: true, errors };
    }
    return { sidecar: null, source: null, recovered: false, errors };
  }

  function remove(id) {
    kv.remove(PRIMARY(id));
    kv.remove(BACKUP(id));
    pending.delete(id);
  }

  return { save, schedule, flushNow, load, remove, kv, bridge };
}

// --- IndexedDB: PDF bytes, captures, cards ---------------------------------
//
// Large binary-ish records (PDF bytes, screenshot data URLs, cards with
// embedded images) must NOT live in localStorage: it is synchronous, string-
// only and quota'd to a few MB (plan §8.1 puts large artifacts in files/
// IndexedDB). Bumping DB_VERSION adds stores; onupgradeneeded creates any
// missing ones so existing user data survives.

const DB_NAME = 'studyos-files';
const STORES = ['pdfs', 'captures', 'cards', 'tasks'];
const DB_VERSION = 3;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = globalThis.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(store, value, key) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

function idbGet(store, key) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  }));
}

function idbAll(store) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  }));
}

function idbDelete(store, key) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

export function hasIndexedDb() {
  return typeof globalThis.indexedDB !== 'undefined';
}

// Gallery/flashcard lists have always shown newest-first; IndexedDB getAll
// returns key (UUID) order, so restore the display order explicitly.
function byNewest(a, b) {
  return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
}

// Svelte 5 $state deep-proxies records; structured clone (IDB put) cannot clone
// Proxies, and a shallow spread keeps nested Proxy references. Strip them once
// at the storage boundary so every call site is safe. These records are pure
// JSON (strings/numbers/arrays/objects), so a JSON round-trip is lossless.
function toPlain(value) {
  return JSON.parse(JSON.stringify(value));
}

// --- PDF bytes ---------------------------------------------------------------

export async function savePdfBytes(id, bytes) {
  if (!hasIndexedDb()) {
    memoryStore.set(`pdf:${id}`, bytes);
    return;
  }
  await idbPut('pdfs', bytes, id);
}

export async function readPdfBytes(id) {
  if (!hasIndexedDb()) return memoryStore.get(`pdf:${id}`) || null;
  const val = await idbGet('pdfs', id);
  return val ?? memoryStore.get(`pdf:${id}`) ?? null;
}

// Videos share the same byte store, and a lecture recording is often hundreds of
// megabytes, so removing one has to free its bytes as well.
export async function deleteFileBytes(id) {
  memoryStore.delete(`pdf:${id}`);
  if (!hasIndexedDb()) return;
  try { await idbDelete('pdfs', id); } catch (e) { console.warn('delete bytes', e); }
}

// --- captures ----------------------------------------------------------------
// Capture records hold the full PNG data URL, so they go in IndexedDB only.

export async function putCapture(capture) {
  const record = toPlain(capture);
  if (!hasIndexedDb()) {
    memoryStore.set(`capture:${record.id}`, record);
    return;
  }
  await idbPut('captures', record, record.id);
}

export async function listCaptures() {
  if (!hasIndexedDb()) {
    return [...memoryStore.entries()].filter(([k]) => k.startsWith('capture:')).map(([, v]) => v).sort(byNewest);
  }
  return (await idbAll('captures')).sort(byNewest);
}

export async function deleteCaptureById(id) {
  if (!hasIndexedDb()) {
    memoryStore.delete(`capture:${id}`);
    return;
  }
  await idbDelete('captures', id);
}

export async function clearCaptures() {
  if (!hasIndexedDb()) {
    for (const k of [...memoryStore.keys()]) if (k.startsWith('capture:')) memoryStore.delete(k);
    return;
  }
  for (const c of await idbAll('captures')) await idbDelete('captures', c.id);
}

// --- cards -------------------------------------------------------------------

// Cards are normalized at the storage boundary so every card in the store carries
// both `sets` and the legacy `deck` alias, whichever shape the caller supplied.
export async function putCard(card) {
  const record = normalizeCard(toPlain(card));
  if (!hasIndexedDb()) {
    memoryStore.set(`card:${record.id}`, record);
    return;
  }
  await idbPut('cards', record, record.id);
}

export async function listCards() {
  if (!hasIndexedDb()) {
    return [...memoryStore.entries()].filter(([k]) => k.startsWith('card:')).map(([, v]) => normalizeCard(v)).sort(byNewest);
  }
  return (await idbAll('cards')).map(normalizeCard).sort(byNewest);
}

export async function deleteCardById(id) {
  if (!hasIndexedDb()) {
    memoryStore.delete(`card:${id}`);
    return;
  }
  await idbDelete('cards', id);
}

export async function clearCards() {
  if (!hasIndexedDb()) {
    for (const k of [...memoryStore.keys()]) if (k.startsWith('card:')) memoryStore.delete(k);
    return;
  }
  for (const c of await idbAll('cards')) await idbDelete('cards', c.id);
}

// --- tasks ------------------------------------------------------------------

export async function putTask(task) {
  const record = toPlain(task);
  if (!hasIndexedDb()) {
    memoryStore.set(`task:${record.id}`, record);
    return;
  }
  await idbPut('tasks', record, record.id);
}

export async function listTasks() {
  if (!hasIndexedDb()) {
    return [...memoryStore.entries()].filter(([k]) => k.startsWith('task:')).map(([, v]) => v).sort(byNewest);
  }
  return (await idbAll('tasks')).sort(byNewest);
}

export async function deleteTaskById(id) {
  if (!hasIndexedDb()) {
    memoryStore.delete(`task:${id}`);
    return;
  }
  await idbDelete('tasks', id);
}

export async function clearTasks() {
  if (!hasIndexedDb()) {
    for (const k of [...memoryStore.keys()]) if (k.startsWith('task:')) memoryStore.delete(k);
    return;
  }
  for (const t of await idbAll('tasks')) await idbDelete('tasks', t.id);
}

// Legacy prototype tasks were { id, title, done, due }; normalize them to the
// current task shape so the planner never sees the old format.
function normalizeLegacyTask(item) {
  const now = new Date().toISOString();
  return {
    id: item.id,
    title: String(item.title || 'Untitled task'),
    notes: '',
    status: item.done ? 'done' : 'todo',
    estimateMinutes: null,
    dueDate: item.due || null,
    startTime: null,
    durationMinutes: null,
    recurrence: null,
    priority: 'normal',
    checklist: [],
    links: [],
    completedOccurrences: [],
    createdAt: now,
    updatedAt: now
  };
}

// One-time migration of captures/cards/tasks that older builds kept in
// localStorage (the reason large galleries hit the quota). Safe to run
// repeatedly; it removes the localStorage copies only after a successful write.
export async function migrateLocalCollections(localStorage) {
  const moved = { captures: 0, cards: 0, tasks: 0 };
  const ls = localStorage || globalThis.localStorage;
  if (!ls) return moved;
  for (const [key, store, save] of [
    ['studyos.captures', 'captures', putCapture],
    ['studyos.cards', 'cards', putCard],
    ['studyos.tasks', 'tasks', putTask],
    ['studyos-tasks', 'tasks', putTask]
  ]) {
    let items = [];
    try { items = JSON.parse(ls.getItem(key) || '[]'); } catch { items = []; }
    if (!Array.isArray(items) || !items.length) { ls.removeItem(key); continue; }
    for (const item of items) {
      if (item && item.id) {
        await save(store === 'tasks' ? normalizeLegacyTask(item) : item);
        moved[store]++;
      }
    }
    ls.removeItem(key);
  }
  return moved;
}
