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
  searchNotes,
  connectNotes,
  disconnectNotes,
  getNoteLinks,
  getKnowledgeGraphData,
  parseWikilinks
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

test('Knowledge Graph: wikilinks, connecting notes and graph data export', () => {
  storage.clear();

  // Test wikilinks parser
  const links = parseWikilinks('Check out [[Quantum Physics]] and [[Linear Algebra|Math]] for details.');
  assert.deepEqual(links, ['Quantum Physics', 'Linear Algebra']);

  // Create notes
  const noteA = createNote({ title: 'Quantum Physics', content: 'Intro to quantum.' });
  const noteB = createNote({ title: 'Linear Algebra', content: 'Vectors and matrices.' });
  const noteC = createNote({ title: 'Machine Learning', content: 'Uses [[Linear Algebra]] heavily.' });

  // Explicit connection between A and B
  const connected = connectNotes(noteA.id, noteB.id);
  assert.equal(connected, true);

  // Check linked notes for noteA
  const linksForA = getNoteLinks(noteA.id);
  assert.equal(linksForA.length, 1);
  assert.equal(linksForA[0].id, noteB.id);

  // Graph data should have 3 nodes and 2 edges (A-B explicit, C-B wikilink)
  const graph = getKnowledgeGraphData();
  assert.equal(graph.nodes.length, 3);
  assert.equal(graph.edges.length, 2);

  // Check degree / connection counts
  const nodeBData = graph.nodes.find((n) => n.id === noteB.id);
  assert.equal(nodeBData.connectionsCount, 2);

  // Test disconnect
  disconnectNotes(noteA.id, noteB.id);
  const graphAfter = getKnowledgeGraphData();
  assert.equal(graphAfter.edges.length, 1);
});
