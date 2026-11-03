import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadUserAvatar, saveUserAvatar, recordStudyHeartbeat,
  recordCardReview, computeStudySummary, loadStudyStats
} from '../src/lib/stats.js';

const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => storage.get(k) || null,
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
  clear: () => storage.clear()
};

test('recordStudyHeartbeat aggregates time per video and reading', () => {
  storage.clear();
  recordStudyHeartbeat('video', 'vid1', 'Math 101', 60, { duration: 600, current: 60 });
  recordStudyHeartbeat('pdf', 'doc1', 'Physics Book', 120, { page: 5, numPages: 100 });
  recordCardReview('deck1', true);

  const stats = loadStudyStats();
  assert.equal(stats.videos['vid1'].totalSec, 60);
  assert.equal(stats.docs['doc1'].totalSec, 120);
  assert.equal(stats.docs['doc1'].maxPage, 5);
  assert.equal(stats.decks['deck1'].reviewsCount, 1);

  const summary = computeStudySummary(stats);
  assert.equal(summary.totalStudySec, 180);
  assert.equal(summary.totalVideoSec, 60);
  assert.equal(summary.totalReadingSec, 120);
  assert.equal(summary.totalPagesRead, 5);
  assert.ok(summary.studyScore > 0);
});
