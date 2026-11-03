import test from 'node:test';
import assert from 'node:assert/strict';
import {
  READER_LAYOUTS, READING_MODES, normalizeLayout, normalizeReadingMode,
  normalizeReadingDirection, spreadStart, spreadSlots, pagesForLayout, stepPage
} from '../src/lib/readerLayout.js';

test('layout values default safely', () => {
  assert.deepEqual(READER_LAYOUTS, ['continuous', 'single', 'spread']);
  assert.deepEqual(READING_MODES, ['normal', 'paper', 'amber', 'aqua', 'grey', 'darkgray', 'dark']);
  assert.equal(normalizeLayout('spread'), 'spread');
  assert.equal(normalizeLayout('nope'), 'continuous');
  assert.equal(normalizeReadingMode('dark'), 'dark');
  assert.equal(normalizeReadingMode(''), 'normal');
  assert.equal(normalizeReadingDirection('ltr'), 'ltr');
  assert.equal(normalizeReadingDirection('nope'), 'rtl');
});

test('spread openings start on an odd page', () => {
  assert.equal(spreadStart(1, 10), 1);
  assert.equal(spreadStart(2, 10), 1);
  assert.equal(spreadStart(3, 10), 3);
  assert.equal(spreadStart(4, 10), 3);
  assert.equal(spreadStart(10, 10), 9);
  assert.equal(spreadStart(99, 10), 9); // clamped
});

test('RTL put page one on the right and page two on the left', () => {
  assert.deepEqual(spreadSlots(1, 6, 'rtl'), [2, 1]);
  assert.deepEqual(spreadSlots(2, 6, 'rtl'), [2, 1]);
  assert.deepEqual(spreadSlots(4, 6, 'rtl'), [4, 3]);
  // A lone last page stays on the right, like a book cover.
  assert.deepEqual(spreadSlots(5, 5, 'rtl'), [null, 5]);
  assert.deepEqual(spreadSlots(1, 1, 'rtl'), [null, 1]);
});

test('LTR put page one on the left and page two on the right', () => {
  assert.deepEqual(spreadSlots(1, 6, 'ltr'), [1, 2]);
  assert.deepEqual(spreadSlots(2, 6, 'ltr'), [1, 2]);
  assert.deepEqual(spreadSlots(4, 6, 'ltr'), [3, 4]);
  assert.deepEqual(spreadSlots(5, 5, 'ltr'), [5, null]);
  assert.deepEqual(spreadSlots(1, 1, 'ltr'), [1, null]);
});

test('pagesForLayout mounts only what the layout needs', () => {
  assert.deepEqual(pagesForLayout({ layout: 'single', page: 4, numPages: 9 }), [4]);
  assert.deepEqual(pagesForLayout({ layout: 'spread', page: 4, numPages: 9 }), [3, 4]);
  assert.deepEqual(pagesForLayout({ layout: 'spread', page: 9, numPages: 9 }), [9]);
  assert.deepEqual(pagesForLayout({ layout: 'continuous', page: 4, numPages: 3 }), [1, 2, 3]);
  assert.deepEqual(pagesForLayout({ layout: 'continuous', page: 1, numPages: 0 }), []);
});

test('navigation steps by one page or by one opening', () => {
  assert.equal(stepPage({ layout: 'continuous', page: 2, numPages: 5, delta: 1 }), 3);
  assert.equal(stepPage({ layout: 'single', page: 2, numPages: 5, delta: -1 }), 1);
  assert.equal(stepPage({ layout: 'spread', page: 2, numPages: 5, delta: 1 }), 3);
  assert.equal(stepPage({ layout: 'spread', page: 4, numPages: 5, delta: 1 }), 5);
  assert.equal(stepPage({ layout: 'spread', page: 3, numPages: 5, delta: -1 }), 1);
  assert.equal(stepPage({ layout: 'continuous', page: 5, numPages: 5, delta: 1 }), 5);
  assert.equal(stepPage({ layout: 'continuous', page: 1, numPages: 5, delta: -1 }), 1);
});
