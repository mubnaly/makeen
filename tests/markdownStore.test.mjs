import test from 'node:test';
import assert from 'node:assert/strict';

// Mock localStorage for node environment
const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => storage.get(k) || null,
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
  clear: () => storage.clear()
};

const {
  createFolder,
  renameFolder,
  deleteFolder,
  getSubfolders,
  getFolderBreadcrumbs,
  createNote,
  updateNote,
  deleteNote,
  getOrCreateNoteForMaterial,
  searchNotes
} = await import('../src/lib/markdownStore.js');

test('Folder creation, nested folders and breadcrumbs', () => {
  storage.clear();
  const root = createFolder({ name: 'Root Folder' });
  assert.equal(root.name, 'Root Folder');
  assert.equal(root.parentId, null);

  const sub = createFolder({ name: 'Sub Folder', parentId: root.id });
  assert.equal(sub.parentId, root.id);

  const deep = createFolder({ name: 'Deep Folder', parentId: sub.id });
  assert.equal(deep.parentId, sub.id);

  const subs = getSubfolders(root.id);
  assert.equal(subs.length, 1);
  assert.equal(subs[0].id, sub.id);

  const crumbs = getFolderBreadcrumbs(deep.id);
  assert.equal(crumbs.length, 3);
  assert.equal(crumbs[0].id, root.id);
  assert.equal(crumbs[1].id, sub.id);
  assert.equal(crumbs[2].id, deep.id);
});

test('Folder rename and recursive deletion', () => {
  storage.clear();
  const root = createFolder({ name: 'Parent' });
  const child = createFolder({ name: 'Child', parentId: root.id });
  const noteInside = createNote({ title: 'Inside Child', folderId: child.id, content: 'test' });

  renameFolder(root.id, 'Parent Renamed');
  const subs = getSubfolders(null);
  assert.equal(subs[0].name, 'Parent Renamed');

  // Deleting root should delete child and noteInside
  deleteFolder(root.id);
  assert.equal(getSubfolders(null).length, 0);
  assert.equal(getSubfolders(root.id).length, 0);
});

test('Note create, update, delete and material binding', () => {
  storage.clear();
  const note = createNote({ title: 'My Note', content: 'hello' });
  assert.equal(note.title, 'My Note');

  const updated = updateNote(note.id, { title: 'Updated Title', content: 'new content' });
  assert.equal(updated.title, 'Updated Title');
  assert.equal(updated.content, 'new content');

  // Material binding (PDF/Video)
  const matNote1 = getOrCreateNoteForMaterial('doc-123', 'pdf', 'My Book Notes');
  assert.equal(matNote1.materialId, 'doc-123');
  assert.equal(matNote1.materialType, 'pdf');

  // Subsequent call retrieves existing note
  const matNote2 = getOrCreateNoteForMaterial('doc-123', 'pdf', 'Different Title');
  assert.equal(matNote2.id, matNote1.id);

  // Search
  const searchResults = searchNotes('Updated');
  assert.equal(searchResults.length, 1);
  assert.equal(searchResults[0].id, note.id);

  deleteNote(note.id);
  assert.equal(searchNotes('Updated').length, 0);
});
