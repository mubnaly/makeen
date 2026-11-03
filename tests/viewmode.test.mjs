import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VIEW_KEY, SECTIONS, DEFAULT_MODE, normalizeMode, loadViewModes, viewModeFor, setViewMode, toggleViewMode
} from '../src/lib/viewmode.js';

function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v))
  };
}

test('every section defaults to grid view', () => {
  const storage = fakeStorage();
  assert.equal(DEFAULT_MODE, 'grid');
  for (const section of ['library', 'gallery', 'today', 'video', 'flashcards']) {
    assert.equal(viewModeFor(section, storage), 'grid', section);
  }
  assert.deepEqual(loadViewModes(storage), {}, 'nothing is written until the user chooses');
});

test('a choice is remembered per section and others stay at the default', () => {
  const storage = fakeStorage();
  assert.equal(setViewMode('gallery', 'list', storage), 'list');
  assert.equal(viewModeFor('gallery', storage), 'list');
  assert.equal(viewModeFor('library', storage), 'grid', 'library is untouched');
  assert.equal(setViewMode('video', 'grid', storage), 'grid');
  const modes = loadViewModes(storage);
  assert.equal(modes.gallery, 'list');
  assert.equal(modes.video, 'grid');
  assert.ok(storage.getItem(VIEW_KEY).includes('"gallery":"list"'));
});

test('toggle flips only the requested section', () => {
  const storage = fakeStorage();
  assert.equal(toggleViewMode('today', storage), 'list');
  assert.equal(toggleViewMode('today', storage), 'grid');
  assert.equal(viewModeFor('today', storage), 'grid');
});

test('normalizeMode and unknown sections are safe', () => {
  assert.equal(normalizeMode('list'), 'list');
  assert.equal(normalizeMode('grid'), 'grid');
  assert.equal(normalizeMode('banana'), 'grid');
  assert.equal(setViewMode('nope', 'list', storageOf()), 'grid', 'unknown section never persists');
  assert.equal(viewModeFor('nope', fakeStorage()), 'grid');
  function storageOf() { return fakeStorage(); }
});

test('corrupt stored JSON falls back to defaults instead of throwing', () => {
  const storage = { getItem: () => '{"gallery":', setItem: () => {} };
  assert.deepEqual(loadViewModes(storage), {});
  assert.equal(viewModeFor('gallery', storage), 'grid');
  // Nonsense values normalize to grid.
  const weird = { getItem: () => JSON.stringify({ gallery: 'weird', library: 'list' }), setItem: () => {} };
  assert.equal(viewModeFor('gallery', weird), 'grid');
  assert.equal(viewModeFor('library', weird), 'list');
});

test('SECTIONS covers the screens the toggle appears on', () => {
  assert.deepEqual([...SECTIONS].sort(), ['flashcards', 'gallery', 'library', 'today', 'video']);
});
