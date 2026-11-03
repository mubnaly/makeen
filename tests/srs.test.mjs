// Spaced-repetition tests (src/lib/srs.js): the difficulty scale, the editable
// interval table, next due dates and the daily reminder decision.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  DEFAULT_INTERVALS,
  DEFAULT_SETTINGS,
  MIN_INTERVAL_DAYS,
  MAX_INTERVAL_DAYS,
  SRS_KEY,
  normalizeSettings,
  loadSrsSettings,
  saveSrsSettings,
  normalizeDifficulty,
  intervalDaysFor,
  nextDueIso,
  applyRating,
  reminderDecision,
  formatReminder
} from '../src/lib/srs.js';

function fakeKv(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _get: (k) => m.get(k)
  };
}

// --- the scale the user asked for -------------------------------------------

test('the default intervals are the requested ones', () => {
  assert.deepEqual(DEFAULT_INTERVALS, { very_easy: 28, easy: 14, moderate: 7, hard: 3, very_hard: 1 });
  assert.equal(DEFAULT_SETTINGS.reminderTime, '09:00', '09:00 by default');
  assert.equal(DEFAULT_SETTINGS.reminderOn, false);
  assert.deepEqual(DIFFICULTIES, ['very_hard', 'hard', 'moderate', 'easy', 'very_easy']);
  assert.equal(new Set(DIFFICULTIES.map((d) => DIFFICULTY_LABELS[d])).size, 5, 'every level has its own label');
});

test('intervalDaysFor reads the table, falling back to moderate', () => {
  assert.equal(intervalDaysFor('very_easy', DEFAULT_SETTINGS), 28);
  assert.equal(intervalDaysFor('easy', DEFAULT_SETTINGS), 14);
  assert.equal(intervalDaysFor('moderate', DEFAULT_SETTINGS), 7);
  assert.equal(intervalDaysFor('hard', DEFAULT_SETTINGS), 3);
  assert.equal(intervalDaysFor('very_hard', DEFAULT_SETTINGS), 1);
  assert.equal(intervalDaysFor('anything-else', DEFAULT_SETTINGS), 7, 'unknown level is neutral');
  assert.equal(intervalDaysFor(null, DEFAULT_SETTINGS), 7);
  const custom = { intervals: { ...DEFAULT_INTERVALS, moderate: 10 } };
  assert.equal(intervalDaysFor('moderate', custom), 10, 'the user owns the numbers');
});

test('normalizeDifficulty understands the old labels so old cards keep meaning', () => {
  assert.equal(normalizeDifficulty('Very easy'), 'very_easy');
  assert.equal(normalizeDifficulty('very-hard'), 'very_hard', 'hyphen or underscore both work');
  assert.equal(normalizeDifficulty('VERY EASY'), 'very_easy');
  assert.equal(normalizeDifficulty('again'), 'very_hard');
  assert.equal(normalizeDifficulty('good'), 'moderate');
  assert.equal(normalizeDifficulty('easy'), 'easy');
  assert.equal(normalizeDifficulty('hard'), 'hard');
  assert.equal(normalizeDifficulty('new'), null);
  assert.equal(normalizeDifficulty(''), null);
  assert.equal(normalizeDifficulty(undefined), null);
});

// --- settings ---------------------------------------------------------------

test('normalizeSettings repairs junk and clamps the interval range', () => {
  const s = normalizeSettings({
    intervals: { very_easy: 0, easy: 999, moderate: 'x', hard: 4.6, very_hard: 1 },
    reminderOn: 'yes',
    reminderTime: '25:99',
    lastNotified: 42
  });
  assert.equal(s.intervals.very_easy, MIN_INTERVAL_DAYS, '0 days is not a schedule');
  assert.equal(s.intervals.easy, MAX_INTERVAL_DAYS, '999 days is capped');
  assert.equal(s.intervals.moderate, DEFAULT_INTERVALS.moderate, 'non-numeric falls back');
  assert.equal(s.intervals.hard, 5, 'rounded');
  assert.equal(s.reminderOn, false, 'only a real boolean enables it');
  assert.equal(s.reminderTime, '09:00', 'invalid time falls back to the default');
  assert.equal(s.lastNotified, '');
  assert.deepEqual(normalizeSettings(null).intervals, DEFAULT_INTERVALS);
  assert.deepEqual(normalizeSettings('nonsense').intervals, DEFAULT_INTERVALS);
});

test('normalizeSettings zero-pads a valid reminder time', () => {
  assert.equal(normalizeSettings({ reminderTime: '9:05' }).reminderTime, '09:05');
  assert.equal(normalizeSettings({ reminderTime: '21:30' }).reminderTime, '21:30');
  assert.equal(normalizeSettings({ reminderTime: ' 7:00 ' }).reminderTime, '07:00');
});

test('loadSrsSettings tolerates missing, empty and corrupt storage', () => {
  assert.deepEqual(loadSrsSettings(fakeKv()).intervals, DEFAULT_INTERVALS);
  assert.deepEqual(loadSrsSettings(fakeKv({ [SRS_KEY]: '{ not json' })).intervals, DEFAULT_INTERVALS);
  assert.deepEqual(loadSrsSettings(null).intervals, DEFAULT_INTERVALS);
  const kv = fakeKv({ [SRS_KEY]: JSON.stringify({ intervals: { moderate: 9 }, reminderOn: true, reminderTime: '18:45' }) });
  const loaded = loadSrsSettings(kv);
  assert.equal(loaded.intervals.moderate, 9);
  assert.equal(loaded.intervals.hard, DEFAULT_INTERVALS.hard, 'unspecified levels keep their default');
  assert.equal(loaded.reminderOn, true);
  assert.equal(loaded.reminderTime, '18:45');
});

test('saveSrsSettings persists the normalized object and never throws', () => {
  const kv = fakeKv();
  const saved = saveSrsSettings({ intervals: { moderate: 8 }, reminderTime: '08:30' }, kv);
  assert.equal(saved.intervals.moderate, 8);
  const roundTrip = JSON.parse(kv._get(SRS_KEY));
  assert.equal(roundTrip.intervals.moderate, 8);
  assert.equal(roundTrip.reminderTime, '08:30');
  const hostile = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
  assert.doesNotThrow(() => saveSrsSettings({}, hostile));
});

// --- scheduling -------------------------------------------------------------

test('nextDueIso counts local calendar days from today', () => {
  assert.equal(nextDueIso('very_hard', DEFAULT_SETTINGS, '2026-10-16'), '2026-10-17');
  assert.equal(nextDueIso('hard', DEFAULT_SETTINGS, '2026-10-16'), '2026-10-19');
  assert.equal(nextDueIso('moderate', DEFAULT_SETTINGS, '2026-10-16'), '2026-10-23');
  assert.equal(nextDueIso('easy', DEFAULT_SETTINGS, '2026-10-16'), '2026-10-30');
  assert.equal(nextDueIso('very_easy', DEFAULT_SETTINGS, '2026-10-16'), '2026-11-13');
  assert.equal(nextDueIso('moderate', DEFAULT_SETTINGS, '2026-12-29'), '2027-01-05', 'year rollover');
});

test('applyRating returns a new card and never mutates the original', () => {
  const card = { id: 'c1', front: 'Q', sets: ['Biology'], due: '2026-10-16', difficulty: 'new' };
  const snapshot = JSON.stringify(card);
  const rated = applyRating(card, 'easy', DEFAULT_SETTINGS, new Date(2026, 9, 16, 22, 30));
  assert.notEqual(rated, card, 'a new object');
  assert.equal(JSON.stringify(card), snapshot, 'the original is untouched');
  assert.equal(rated.difficulty, 'easy');
  assert.equal(rated.due, '2026-10-30');
  assert.match(rated.lastReviewedAt, /^2026-10-16T/);
  assert.deepEqual(rated.sets, ['Biology'], 'membership survives a rating');
});

test('applyRating maps a legacy "again" onto the shortest interval', () => {
  const rated = applyRating({ id: 'x', due: '2026-10-16', difficulty: 'again' }, 'again', DEFAULT_SETTINGS, new Date(2026, 9, 16, 12));
  assert.equal(rated.difficulty, 'very_hard');
  assert.equal(rated.due, '2026-10-17');
});

test('applyRating honours user intervals and an unknown rating', () => {
  const settings = { intervals: { ...DEFAULT_INTERVALS, very_hard: 2 } };
  assert.equal(applyRating({ id: 'x' }, 'very_hard', settings, new Date(2026, 9, 16, 12)).due, '2026-10-18');
  const unknown = applyRating({ id: 'x' }, 'banana', DEFAULT_SETTINGS, new Date(2026, 9, 16, 12));
  assert.equal(unknown.difficulty, 'moderate');
  assert.equal(unknown.due, '2026-10-23');
});

// --- reminder ---------------------------------------------------------------

const ON = { ...DEFAULT_SETTINGS, reminderOn: true };
const at = (h, m) => new Date(2026, 9, 16, h, m, 0);

test('the reminder stays quiet when it is off or nothing is due', () => {
  assert.equal(reminderDecision({ settings: DEFAULT_SETTINGS, now: at(10, 0), dueCount: 5 }).fire, false);
  assert.equal(reminderDecision({ settings: DEFAULT_SETTINGS, now: at(10, 0), dueCount: 5 }).reason, 'off');
  assert.equal(reminderDecision({ settings: ON, now: at(10, 0), dueCount: 0 }).reason, 'nothing-due');
});

test('the reminder fires at the set time, not before, and only once a day', () => {
  assert.equal(reminderDecision({ settings: ON, now: at(8, 59), dueCount: 3 }).reason, 'too-early');
  assert.equal(reminderDecision({ settings: ON, now: at(9, 0), dueCount: 3 }).fire, true, 'exactly at 09:00');
  assert.equal(reminderDecision({ settings: ON, now: at(21, 15), dueCount: 3 }).fire, true, 'a late start still reminds');
  const already = reminderDecision({ settings: ON, now: at(21, 15), dueCount: 3, lastNotified: '2026-10-16' });
  assert.equal(already.fire, false);
  assert.equal(already.reason, 'already-notified');
  assert.equal(reminderDecision({ settings: ON, now: at(21, 15), dueCount: 3, lastNotified: '2026-10-15' }).fire, true, 'yesterday does not block today');
});

test('the reminder respects a custom time and a stored lastNotified', () => {
  const evening = { ...ON, reminderTime: '18:45' };
  assert.equal(reminderDecision({ settings: evening, now: at(18, 44), dueCount: 1 }).fire, false);
  assert.equal(reminderDecision({ settings: evening, now: at(18, 45), dueCount: 1 }).fire, true);
  // lastNotified lives in the settings object, so a reload cannot double-notify.
  const stored = normalizeSettings({ ...ON, lastNotified: '2026-10-16' });
  assert.equal(reminderDecision({ settings: stored, now: at(23, 0), dueCount: 4 }).fire, false);
});

test('reminderDecision survives junk settings', () => {
  assert.doesNotThrow(() => reminderDecision({ settings: { reminderOn: true, reminderTime: 'nope' }, now: at(10, 0), dueCount: 1 }));
  assert.equal(reminderDecision({ settings: null, now: at(10, 0), dueCount: 1 }).fire, false);
});

test('formatReminder names the sets and agrees in number', () => {
  assert.deepEqual(formatReminder([{ sets: ['Biology'] }]), {
    title: '1 flashcard is due',
    body: 'Biology · review them in StudyOS.'
  });
  const many = formatReminder([
    { sets: ['Biology'] },
    { sets: ['Biology', 'Chemistry'] },
    { sets: ['Chemistry'] },
    { sets: ['History'] },
    { sets: ['Maths'] }
  ]);
  assert.equal(many.title, '5 flashcards are due');
  assert.match(many.body, /^Biology, Chemistry, History and 1 more · /, 'sets are deduped (4 distinct) and only three names are shown');
  assert.equal(formatReminder([]).body, 'Review them in StudyOS.');
  assert.equal(formatReminder([{ deck: 'Legacy' }]).body, 'Legacy · review them in StudyOS.', 'legacy deck field still names the set');
});
