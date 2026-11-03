import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_BAR_ITEMS, BAR_ITEM_IDS, defaultBarOrder, normalizeBarOrder,
  moveBarOrder, insertAfterBarItem, removeBarItem, barOrderMap
} from '../src/lib/toolbar.js';

test('every toolbar item has a unique id and a label', () => {
  const ids = DEFAULT_BAR_ITEMS.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const item of DEFAULT_BAR_ITEMS) {
    assert.ok(item.id);
    assert.ok(item.label);
    assert.ok(item.kind);
  }
  assert.deepEqual(defaultBarOrder(), BAR_ITEM_IDS);
});

test('saved order keeps known items once and appends new or custom ones', () => {
  const custom = 'custom:abc';
  const saved = ['save', 'prev', 'save', 'ghost', custom, 'colors'];
  const order = normalizeBarOrder(saved, [custom]);
  assert.deepEqual(order.slice(0, 4), ['save', 'prev', custom, 'colors']);
  for (const id of BAR_ITEM_IDS) assert.equal(order.filter((x) => x === id).length, 1);
  assert.equal(order.filter((x) => x === custom).length, 1);
  assert.ok(!order.includes('ghost'));
});

test('a missing or broken saved order falls back to the full catalogue', () => {
  assert.deepEqual(normalizeBarOrder(null), BAR_ITEM_IDS);
  assert.deepEqual(normalizeBarOrder('nope'), BAR_ITEM_IDS);
});

test('move and insert keep the item exactly once', () => {
  const base = defaultBarOrder();
  const moved = moveBarOrder(base, 'prev', 3);
  assert.ok(moved.indexOf('prev') > moved.indexOf('page'));
  assert.equal(moved.length, base.length);
  assert.equal(moved.filter((x) => x === 'prev').length, 1);
  assert.deepEqual(moveBarOrder(base, 'tabs', -999), base); // already first

  const inserted = insertAfterBarItem(base, 'tool-shape', 'custom:rect');
  assert.equal(inserted.indexOf('custom:rect'), inserted.indexOf('tool-shape') + 1);
  assert.equal(inserted.length, base.length + 1);
  assert.equal(insertAfterBarItem(inserted, 'tool-shape', 'custom:rect').length, inserted.length);
});

test('remove drops one item and barOrderMap reflects order', () => {
  const after = removeBarItem(defaultBarOrder(), 'status');
  assert.ok(!after.includes('status'));
  const map = barOrderMap(after);
  assert.equal(map.prev, 6);
  assert.equal(map.search > map.prev, true);
});
