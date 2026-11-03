import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadTrashRetentionDays, saveTrashRetentionDays,
  listTrash, persistTrash, moveToTrash, restoreTrashItem,
  deleteTrashPermanently, emptyAllTrash, purgeExpiredTrash
} from '../src/lib/trash.js';

// Mock localStorage for node test
const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => storage.get(k) || null,
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
  clear: () => storage.clear()
};

test('trash retention days defaults to 30 and can be customized', () => {
  storage.clear();
  assert.equal(loadTrashRetentionDays(), 30);
  saveTrashRetentionDays(60);
  assert.equal(loadTrashRetentionDays(), 60);
});

test('move item to trash and restore', () => {
  storage.clear();
  const item = { id: 'v1', title: 'Calculus Lecture 1', kind: 'video', bookmarks: [{ seconds: 120, note: 'Intro' }] };
  const entry = moveToTrash(item, { kind: 'video' });
  assert.ok(entry);
  assert.equal(entry.id, 'v1');
  assert.equal(entry.title, 'Calculus Lecture 1');
  assert.equal(entry.preservedContent.bookmarks.length, 1);

  const list = listTrash();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'v1');

  const restored = restoreTrashItem('v1');
  assert.equal(restored.id, 'v1');
  assert.equal(listTrash().length, 0);
});

test('purge expired trash respects retention window', () => {
  storage.clear();
  const oldItem = { id: 'old1', title: 'Old item', kind: 'pdf' };
  moveToTrash(oldItem);
  const list = listTrash();
  // Manually set deletedAt to 35 days ago
  list[0].deletedAt = Date.now() - (35 * 24 * 60 * 60 * 1000);
  persistTrash(list);

  const res = purgeExpiredTrash(30);
  assert.equal(res.purged, 1);
  assert.equal(listTrash().length, 0);
});
