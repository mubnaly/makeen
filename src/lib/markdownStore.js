// Markdown notes and unlimited nested folders store for StudyOS.
// Backed by localStorage and supports unlimited folder hierarchy.

const STORAGE_KEY = 'studyos.markdown.store.v1';

function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'id_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function loadState() {
  if (typeof localStorage === 'undefined') {
    return { folders: [], notes: [] };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { folders: [], notes: [] };
    const data = JSON.parse(raw);
    return {
      folders: Array.isArray(data?.folders) ? data.folders : [],
      notes: Array.isArray(data?.notes) ? data.notes : []
    };
  } catch {
    return { folders: [], notes: [] };
  }
}

function persistState(state) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

// --- Folder API -------------------------------------------------------------

export function listFolders() {
  return loadState().folders;
}

export function getSubfolders(parentId = null) {
  const folders = listFolders();
  return folders.filter((f) => (f.parentId || null) === (parentId || null));
}

export function getFolder(id) {
  if (!id) return null;
  return listFolders().find((f) => f.id === id) || null;
}

export function createFolder({ name, parentId = null }) {
  const state = loadState();
  const folder = {
    id: uid(),
    name: (name || 'New Folder').trim() || 'New Folder',
    parentId: parentId || null,
    createdAt: Date.now()
  };
  state.folders.push(folder);
  persistState(state);
  return folder;
}

export function renameFolder(id, newName) {
  const state = loadState();
  const folder = state.folders.find((f) => f.id === id);
  if (!folder) return null;
  folder.name = (newName || folder.name).trim();
  persistState(state);
  return folder;
}

export function deleteFolder(id) {
  const state = loadState();
  // Collect all descendant folder IDs recursively
  const toDelete = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of state.folders) {
      if (f.parentId && toDelete.has(f.parentId) && !toDelete.has(f.id)) {
        toDelete.add(f.id);
        changed = true;
      }
    }
  }

  // Remove folders
  state.folders = state.folders.filter((f) => !toDelete.has(f.id));
  // Remove notes inside deleted folders
  state.notes = state.notes.filter((n) => !toDelete.has(n.folderId));
  persistState(state);
  return true;
}

export function getFolderBreadcrumbs(folderId) {
  if (!folderId) return [];
  const folders = listFolders();
  const crumbs = [];
  let cur = folders.find((f) => f.id === folderId);
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    crumbs.unshift(cur);
    cur = cur.parentId ? folders.find((f) => f.id === cur.parentId) : null;
  }
  return crumbs;
}

// --- Notes API --------------------------------------------------------------

export function listAllNotes() {
  return loadState().notes;
}

export function getNotesInFolder(folderId = null) {
  const notes = listAllNotes();
  return notes.filter((n) => (n.folderId || null) === (folderId || null));
}

export function getNote(id) {
  if (!id) return null;
  return listAllNotes().find((n) => n.id === id) || null;
}

export function createNote({
  title = 'Untitled Note',
  folderId = null,
  content = '',
  materialId = null,
  materialType = 'standalone'
}) {
  const state = loadState();
  const note = {
    id: uid(),
    folderId: folderId || null,
    title: (title || 'Untitled Note').trim() || 'Untitled Note',
    content: content || '',
    materialId: materialId || null,
    materialType: materialType || 'standalone',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  state.notes.push(note);
  persistState(state);
  return note;
}

export function updateNote(id, patch = {}) {
  const state = loadState();
  const note = state.notes.find((n) => n.id === id);
  if (!note) return null;

  if (patch.title !== undefined) note.title = (patch.title || '').trim() || 'Untitled Note';
  if (patch.content !== undefined) note.content = String(patch.content);
  if (patch.folderId !== undefined) note.folderId = patch.folderId || null;
  note.updatedAt = Date.now();

  persistState(state);
  return note;
}

export function deleteNote(id) {
  const state = loadState();
  const beforeLen = state.notes.length;
  state.notes = state.notes.filter((n) => n.id !== id);
  if (state.notes.length !== beforeLen) {
    persistState(state);
    return true;
  }
  return false;
}

// Get or create a note linked to a PDF or Video
export function getOrCreateNoteForMaterial(materialId, materialType = 'pdf', defaultTitle = '') {
  if (!materialId) return null;
  const state = loadState();
  let note = state.notes.find((n) => n.materialId === materialId);
  if (note) return note;

  note = {
    id: uid(),
    folderId: null,
    title: defaultTitle || `${materialType.toUpperCase()} Notes`,
    content: `# ${defaultTitle || `${materialType.toUpperCase()} Notes`}\n\n`,
    materialId,
    materialType,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  state.notes.push(note);
  persistState(state);
  return note;
}

export function searchNotes(query) {
  if (!query || !query.trim()) return listAllNotes();
  const q = query.trim().toLowerCase();
  return listAllNotes().filter((n) => {
    return (n.title && n.title.toLowerCase().includes(q)) ||
           (n.content && n.content.toLowerCase().includes(q));
  });
}
