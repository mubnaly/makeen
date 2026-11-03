import test from 'node:test';
import assert from 'node:assert/strict';
import {
  USAGE_KEY, USAGE_KINDS, trackUsage, loadUsage, totals, lastNDays, reviewStreak
} from '../src/lib/usage.js';

function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k)
  };
}

test('trackUsage counts per local day and persists', () => {
  const storage = fakeStorage();
  const now = new Date(2026, 9, 16, 9, 0, 0);
  trackUsage('reviews', 1, { storage, now });
  trackUsage('reviews', 2, { storage, now });
  trackUsage('captures', 1, { storage, now });
  const usage = loadUsage(storage);
  assert.equal(usage.days['2026-10-16'].reviews, 3);
  assert.equal(usage.days['2026-10-16'].captures, 1);
  // Stored under the one documented key.
  assert.ok(storage.getItem(USAGE_KEY).includes('"reviews":3'));
});

test('unknown kinds and zero/negative counts never pollute the record', () => {
  const storage = fakeStorage();
  trackUsage('nonsense', 5, { storage });
  trackUsage('reviews', 0, { storage });
  trackUsage('reviews', -3, { storage });
  assert.deepEqual(loadUsage(storage), { days: {} });
  assert.deepEqual(totals(loadUsage(storage).days), { reviews: 0, captures: 0, cards: 0, exports: 0, opens: 0 });
});

test('a broken storage backend never breaks tracking', () => {
  const angry = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.deepEqual(loadUsage(angry), { days: {} });
  // The count still lives for the session; only persistence is skipped.
  const usage = trackUsage('reviews', 1, { storage: angry, now: new Date(2026, 9, 16, 8) });
  assert.equal(usage.days['2026-10-16'].reviews, 1);
});

test('lastNDays fills every day oldest-first with zeros', () => {
  const days = { '2026-10-16': { reviews: 2 } };
  const now = new Date(2026, 9, 16, 20, 0, 0);
  const rows = lastNDays(days, 7, now);
  assert.equal(rows.length, 7);
  assert.equal(rows[6].date, '2026-10-16', 'today is last');
  assert.equal(rows[0].date, '2026-10-10', 'oldest first');
  assert.equal(rows[6].reviews, 2);
  assert.equal(rows[0].reviews, 0, 'empty days are zeros, not holes');
  assert.equal(rows[0].captures, 0);
});

test('reviewStreak counts consecutive review days and forgives a young today', () => {
  const now = new Date(2026, 9, 16, 8, 0, 0);
  assert.equal(reviewStreak({}, now), 0);
  // Today + yesterday + the day before.
  const days = {
    '2026-10-16': { reviews: 1 },
    '2026-10-15': { reviews: 4 },
    '2026-10-14': { reviews: 1 },
    '2026-10-12': { reviews: 9 } // gap on 13 breaks it
  };
  assert.equal(reviewStreak(days, now), 3);
  // Nothing today yet, but yesterday's streak is still alive.
  assert.equal(reviewStreak({ '2026-10-15': { reviews: 1 } }, now), 1);
  // Captures alone never make a review streak.
  assert.equal(reviewStreak({ '2026-10-16': { captures: 5 } }, now), 0);
});

test('USAGE_KINDS covers the counters the report shows', () => {
  assert.deepEqual([...USAGE_KINDS].sort(), ['captures', 'cards', 'exports', 'opens', 'reviews']);
});
