import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeBookmark,
  normalizeBookmarks,
  buildBookmarkTree,
  flattenBookmarkTree,
  reorderBookmarks,
  indentBookmark,
  outdentBookmark,
  setBookmarkTitle,
  toggleBookmarkCollapse
} from '../src/lib/bookmarks.js';

test('normalizeBookmark validates page and fields', () => {
  assert.equal(normalizeBookmark(null), null);
  assert.equal(normalizeBookmark({ page: 0 }), null);
  const valid = normalizeBookmark({ page: 5, title: 'Chapter 1' });
  assert.equal(valid.page, 5);
  assert.equal(valid.title, 'Chapter 1');
  assert.equal(valid.parentId, null);
  assert.equal(valid.collapsed, false);
});

test('buildBookmarkTree and flattenBookmarkTree build clean hierarchy', () => {
  const bookmarks = [
    { id: 'b1', page: 1, title: 'Chapter 1', order: 10 },
    { id: 'b2', page: 5, title: 'Section 1.1', parentId: 'b1', order: 10 },
    { id: 'b3', page: 8, title: 'Section 1.2', parentId: 'b1', order: 20 },
    { id: 'b4', page: 12, title: 'Chapter 2', order: 20 }
  ];

  const tree = buildBookmarkTree(bookmarks);
  assert.equal(tree.length, 2);
  assert.equal(tree[0].id, 'b1');
  assert.equal(tree[0].children.length, 2);
  assert.equal(tree[0].children[0].id, 'b2');
  assert.equal(tree[0].children[1].id, 'b3');
  assert.equal(tree[1].id, 'b4');

  const flat = flattenBookmarkTree(bookmarks);
  assert.equal(flat.length, 4);
  assert.equal(flat[0].id, 'b1');
  assert.equal(flat[0].depth, 0);
  assert.equal(flat[0].hasChildren, true);

  assert.equal(flat[1].id, 'b2');
  assert.equal(flat[1].depth, 1);
  assert.equal(flat[1].hasChildren, false);
});

test('collapsed parent hides descendants in flat view', () => {
  const bookmarks = [
    { id: 'b1', page: 1, title: 'Chapter 1', collapsed: true },
    { id: 'b2', page: 5, title: 'Section 1.1', parentId: 'b1' }
  ];

  const flat = flattenBookmarkTree(bookmarks);
  assert.equal(flat[0].visible, true);
  assert.equal(flat[1].visible, false);
});

test('reordering inside nests as child and prevents circular loops', () => {
  const bookmarks = [
    { id: 'b1', page: 1, title: 'Part 1', order: 10 },
    { id: 'b2', page: 10, title: 'Part 2', order: 20 }
  ];

  const nested = reorderBookmarks(bookmarks, 'b2', 'b1', 'inside');
  const target = nested.find((b) => b.id === 'b2');
  assert.equal(target.parentId, 'b1');

  // Attempting circular nesting (nesting parent b1 inside child b2) is blocked
  const circularAttempt = reorderBookmarks(nested, 'b1', 'b2', 'inside');
  assert.deepEqual(circularAttempt, nested);
});

test('indentBookmark and outdentBookmark adjust depth', () => {
  const bookmarks = [
    { id: 'b1', page: 1, title: 'Chapter 1', order: 10 },
    { id: 'b2', page: 5, title: 'Section 1', order: 20 }
  ];

  const indented = indentBookmark(bookmarks, 'b2');
  assert.equal(indented.find((b) => b.id === 'b2').parentId, 'b1');

  const outdented = outdentBookmark(indented, 'b2');
  assert.equal(outdented.find((b) => b.id === 'b2').parentId, null);
});

test('renaming bookmark updates title', () => {
  const bookmarks = [{ id: 'b1', page: 1, title: 'Intro' }];
  const updated = setBookmarkTitle(bookmarks, 'b1', 'Introduction to Analysis');
  assert.equal(updated[0].title, 'Introduction to Analysis');
});
