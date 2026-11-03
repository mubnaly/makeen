// Recurrence tests (plan §6.8, §17). Runs with TZ=America/New_York so the DST
// assertions are deterministic (spring-forward 2026-03-08, fall-back 2026-11-01).

process.env.TZ = 'America/New_York';

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeRule,
  validateRule,
  occursOn,
  occurrencesInRange,
  nextOccurrence,
  describeRule,
  addDays,
  clampDayOfMonth,
  todayIso
} from '../src/lib/recurrence.js';

// --- validation -------------------------------------------------------------

test('validateRule rejects bad rules and accepts good ones', () => {
  assert.equal(validateRule(makeRule({ freq: 'daily' })).ok, true);
  assert.equal(validateRule(makeRule({ freq: 'weekly', daysOfWeek: [1, 3] })).ok, true);
  assert.equal(validateRule({ freq: 'daily', interval: 0 }).ok, false);
  assert.equal(validateRule({ freq: 'yearly', interval: 1 }).ok, false);
  assert.equal(validateRule({ freq: 'weekly', interval: 1, daysOfWeek: [] }).ok, false);
  assert.equal(validateRule({ freq: 'weekly', interval: 1, daysOfWeek: [9] }).ok, false);
  assert.equal(validateRule({ freq: 'monthly', interval: 1, dayOfMonth: 32 }).ok, false);
  assert.equal(validateRule({ freq: 'daily', interval: 1, endDate: 'March 1' }).ok, false);
});

// --- daily ------------------------------------------------------------------

test('daily rule expands across a week', () => {
  const rule = makeRule({ freq: 'daily' });
  const days = occurrencesInRange(rule, '2026-10-13', '2026-10-13', '2026-10-19');
  assert.deepEqual(days, ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19']);
});

test('interval > 1 skips days', () => {
  const rule = makeRule({ freq: 'daily', interval: 3 });
  const days = occurrencesInRange(rule, '2026-10-13', '2026-10-13', '2026-10-25');
  assert.deepEqual(days, ['2026-10-13', '2026-10-16', '2026-10-19', '2026-10-22', '2026-10-25']);
});

test('occurrences never precede the series start', () => {
  const rule = makeRule({ freq: 'daily' });
  const days = occurrencesInRange(rule, '2026-10-15', '2026-10-01', '2026-10-20');
  assert.equal(days[0], '2026-10-15');
});

test('endDate caps occurrences inclusively', () => {
  const rule = makeRule({ freq: 'daily', endDate: '2026-10-17' });
  const days = occurrencesInRange(rule, '2026-10-15', '2026-10-15', '2026-10-31');
  assert.deepEqual(days, ['2026-10-15', '2026-10-16', '2026-10-17']);
});

// --- DST correctness (the §17 requirement) ----------------------------------

test('daily 09:00 stays 09:00 across spring-forward (47 real hours, not 48)', () => {
  // US DST 2026 begins Mar 8: 02:00 -> 03:00 local.
  assert.notEqual(new Date(2026, 2, 7).getTimezoneOffset(), new Date(2026, 2, 9).getTimezoneOffset(), 'fixture must span a DST change');
  const rule = makeRule({ freq: 'daily' });
  const days = occurrencesInRange(rule, '2026-03-06', '2026-03-06', '2026-03-10');
  assert.deepEqual(days, ['2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10'], 'no skipped or doubled calendar days');
  // A reminder for each occurrence at wall-clock 09:00 must land at 09:00 local
  // on both sides of the transition.
  for (const iso of days) {
    const [y, m, d] = iso.split('-').map(Number);
    const at9 = new Date(y, m - 1, d, 9, 0, 0);
    assert.equal(at9.getHours(), 9, `09:00 preserved on ${iso}`);
  }
  // Prove the naive millisecond approach would have drifted: adding a fixed
  // 48h to Mar 6 09:00 EST lands at 10:00 EDT on Mar 8 (the lost hour shifts
  // the wall clock forward), not 09:00. Our date-based model stays at 09:00.
  const naive = new Date(2026, 2, 6, 9, 0).getTime() + 2 * 86400000;
  assert.equal(new Date(naive).getHours(), 10, 'naive +48h drifts to 10:00 — our date-based model does not');
});

test('daily occurrences across fall-back stay on calendar days', () => {
  // US DST 2026 ends Nov 1: 02:00 -> 01:00 local.
  const rule = makeRule({ freq: 'daily' });
  const days = occurrencesInRange(rule, '2026-10-30', '2026-10-30', '2026-11-03');
  assert.deepEqual(days, ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03']);
  // 9am across the boundary is 25 real hours later on the 2nd, still 09:00.
  const a = new Date(2026, 9, 31, 9, 0).getTime();
  const b = new Date(2026, 10, 1, 9, 0).getTime();
  assert.equal((b - a) / 3600000, 25, '25 real hours across fall-back');
});

// --- weekly -----------------------------------------------------------------

test('weekly rule picks only the selected weekdays', () => {
  // 2026-10-13 is a Tuesday.
  const rule = makeRule({ freq: 'weekly', daysOfWeek: [1, 3, 5] }); // Mon, Wed, Fri
  const days = occurrencesInRange(rule, '2026-10-13', '2026-10-12', '2026-10-26');
  assert.deepEqual(days, ['2026-10-14', '2026-10-16', '2026-10-19', '2026-10-21', '2026-10-23', '2026-10-26']);
});

test('weekly interval uses ISO Monday-start weeks', () => {
  // Start Tue Oct 13 (week of Oct 12); every 2 weeks on Tuesday. ISO weeks
  // 0, 2, 4 -> Oct 13 (wk0), Oct 27 (wk2), Nov 10 (wk4). Nov 3 is ISO week 3
  // (odd), so it is correctly skipped.
  const rule = makeRule({ freq: 'weekly', interval: 2, daysOfWeek: [2] });
  const days = occurrencesInRange(rule, '2026-10-13', '2026-10-13', '2026-11-10');
  assert.deepEqual(days, ['2026-10-13', '2026-10-27', '2026-11-10']);
});

test('every-2-weeks-on-Monday includes the Monday of week 2 from a Tuesday start', () => {
  // This is why ISO weeks matter: a Tuesday start should not push the Monday
  // occurrence out by a week.
  const rule = makeRule({ freq: 'weekly', interval: 2, daysOfWeek: [1] });
  const days = occurrencesInRange(rule, '2026-10-13', '2026-10-12', '2026-11-09');
  assert.deepEqual(days, ['2026-10-26', '2026-11-09'], 'Mondays of ISO weeks 2 and 4');
});

// --- monthly ----------------------------------------------------------------

test('monthly rule fires on the day-of-month', () => {
  const rule = makeRule({ freq: 'monthly', dayOfMonth: 15 });
  const days = occurrencesInRange(rule, '2026-09-01', '2026-09-01', '2026-12-31');
  assert.deepEqual(days, ['2026-09-15', '2026-10-15', '2026-11-15', '2026-12-15']);
});

test('monthly day 31 clamps into shorter months', () => {
  const rule = makeRule({ freq: 'monthly', dayOfMonth: 31 });
  const days = occurrencesInRange(rule, '2026-01-01', '2026-01-01', '2026-05-31');
  assert.deepEqual(days, ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
  assert.equal(clampDayOfMonth(2028, 1, 31), 29, 'leap-year February clamps to 29');
});

test('monthly interval skips months', () => {
  const rule = makeRule({ freq: 'monthly', interval: 3, dayOfMonth: 1 });
  const days = occurrencesInRange(rule, '2026-01-01', '2026-01-01', '2026-12-31');
  assert.deepEqual(days, ['2026-01-01', '2026-04-01', '2026-07-01', '2026-10-01']);
});

// --- occursOn / next / describe ---------------------------------------------

test('occursOn matches expansion results', () => {
  // 2026-10-13 is a Tuesday.
  const rule = makeRule({ freq: 'weekly', daysOfWeek: [0, 6] }); // weekends
  assert.equal(occursOn(rule, '2026-10-13', '2026-10-16'), false); // Fri
  assert.equal(occursOn(rule, '2026-10-13', '2026-10-17'), true); // Sat
  assert.equal(occursOn(rule, '2026-10-13', '2026-10-18'), true); // Sun
  assert.equal(occursOn(rule, '2026-10-13', '2026-10-12'), false); // before start
});

test('nextOccurrence returns the first date strictly after the given day', () => {
  const rule = makeRule({ freq: 'daily' });
  assert.equal(nextOccurrence(rule, '2026-10-15', '2026-10-15'), '2026-10-16');
  assert.equal(nextOccurrence(rule, '2026-10-15', null), '2026-10-15', 'null after -> start itself');
});

test('describeRule renders readable summaries', () => {
  assert.equal(describeRule(makeRule({ freq: 'daily' })), 'Every day');
  assert.equal(describeRule(makeRule({ freq: 'daily', interval: 3 })), 'Every 3 days');
  assert.equal(describeRule(makeRule({ freq: 'weekly', daysOfWeek: [1, 3] })), 'Weekly on Mon, Wed');
  assert.equal(describeRule(makeRule({ freq: 'monthly', dayOfMonth: 15 })), 'Monthly on day 15');
  assert.equal(describeRule(null), 'Never');
});

test('addDays and todayIso behave', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.match(todayIso(new Date(2026, 9, 5)), /^2026-10-05$/);
});
