// Capture/card IndexedDB store tests (plan §8.1: large artifacts belong in
// IndexedDB, not localStorage). Node has no indexedDB, so these exercise the
// in-memory fallback, which mirrors the same put/get/all/delete contract.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasIndexedDb,
  putCapture,
  listCaptures,
  deleteCaptureById,
  clearCaptures,
  putCard,
  listCards,
  deleteCardById,
  clearCards,
  migrateLocalCollections
} from '../src/lib/storage.js';

function capture(id, extra = {}) {
  return { id, name: `cap ${id}`, page: 1, image: `data:image/png;base64,${id}`, ...extra };
}
function card(id, extra = {}) {
  return { id, front: `card ${id}`, image: `data:image/png;base64,${id}`, due: '2026-10-15', ...extra };
}

// A minimal localStorage stand-in for the migration tests.
function fakeLocalStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
    _dump: () => Object.fromEntries(m)
  };
}

test('hasIndexedDb is false in Node (fallback path is what we test)', () => {
  assert.equal(hasIndexedDb(), false);
});

test('captures: put/list round-trip keeps full records and image data', async () => {
  await clearCaptures();
  await putCapture(capture('a'));
  await putCapture(capture('b', { caption: 'note' }));
  const all = await listCaptures();
  assert.equal(all.length, 2);
  const b = all.find((c) => c.id === 'b');
  assert.equal(b.caption, 'note');
  assert.match(b.image, /^data:image\/png/);
});

test('captures: delete removes one, clear removes all', async () => {
  await clearCaptures();
  await putCapture(capture('x'));
  await putCapture(capture('y'));
  await deleteCaptureById('x');
  let all = await listCaptures();
  assert.deepEqual(all.map((c) => c.id), ['y']);
  await clearCaptures();
  all = await listCaptures();
  assert.equal(all.length, 0);
});

test('cards: put/list/delete/clear', async () => {
  await clearCards();
  await putCard(card('c1', { difficulty: 'good' }));
  await putCard(card('c2'));
  let all = await listCards();
  assert.equal(all.length, 2);
  assert.equal(all.find((c) => c.id === 'c1').difficulty, 'good');
  await deleteCardById('c1');
  all = await listCards();
  assert.deepEqual(all.map((c) => c.id), ['c2']);
  await clearCards();
  assert.equal((await listCards()).length, 0);
});

test('migration moves localStorage captures/cards into the store and clears the keys', async () => {
  await clearCaptures();
  await clearCards();
  const ls = fakeLocalStorage({
    'studyos.captures': JSON.stringify([capture('m1'), capture('m2')]),
    'studyos.cards': JSON.stringify([card('mc1')])
  });
  const moved = await migrateLocalCollections(ls);
  assert.deepEqual(moved, { captures: 2, cards: 1, tasks: 0 });
  // localStorage copies removed after successful write.
  assert.equal(ls.getItem('studyos.captures'), null);
  assert.equal(ls.getItem('studyos.cards'), null);
  // Records now readable from the store.
  assert.equal((await listCaptures()).length, 2);
  assert.equal((await listCards()).length, 1);
});

test('migration is idempotent and tolerates empty/corrupt input', async () => {
  await clearCaptures();
  await clearCards();
  const ls = fakeLocalStorage({
    'studyos.captures': '{ not json',
    'studyos.cards': '[]'
  });
  const first = await migrateLocalCollections(ls);
  assert.deepEqual(first, { captures: 0, cards: 0, tasks: 0 });
  // Running again on now-empty storage is a no-op and does not throw.
  const second = await migrateLocalCollections(ls);
  assert.deepEqual(second, { captures: 0, cards: 0, tasks: 0 });
});

test('captures and cards list newest-first regardless of insert order', async () => {
  await clearCaptures();
  await clearCards();
  await putCapture(capture('old', { createdAt: '2026-10-01T10:00:00Z' }));
  await putCapture(capture('new', { createdAt: '2026-10-09T10:00:00Z' }));
  await putCapture(capture('mid', { createdAt: '2026-10-05T10:00:00Z' }));
  assert.deepEqual((await listCaptures()).map((c) => c.id), ['new', 'mid', 'old']);

  await putCard(card('c-old', { createdAt: '2026-10-01T10:00:00Z' }));
  await putCard(card('c-new', { createdAt: '2026-10-09T10:00:00Z' }));
  assert.deepEqual((await listCards()).map((c) => c.id), ['c-new', 'c-old']);
});

test('cards are normalized to the current shape on write and on read', async () => {
  await clearCards();
  await putCard({ id: 'legacy', deck: 'Biology', front: 'Q', due: '2026-10-15' });
  await putCard({ id: 'multi', sets: ['A', 'B'], front: 'Shared', due: '2026-10-15' });
  const all = await listCards();
  const legacy = all.find((c) => c.id === 'legacy');
  const multi = all.find((c) => c.id === 'multi');
  assert.deepEqual(legacy.sets, ['Biology'], 'a legacy deck is promoted to sets');
  assert.equal(legacy.deck, 'Biology', 'the alias is kept in step');
  assert.deepEqual(multi.sets, ['A', 'B']);
  assert.equal(multi.deck, 'A', 'deck mirrors the primary set');
  await clearCards();
});

test('migration skips malformed entries without a usable id', async () => {
  await clearCaptures();
  const ls = fakeLocalStorage({
    'studyos.captures': JSON.stringify([{ name: 'no-id' }, capture('ok')])
  });
  const moved = await migrateLocalCollections(ls);
  assert.equal(moved.captures, 1);
  const all = await listCaptures();
  assert.deepEqual(all.map((c) => c.id), ['ok']);
});
