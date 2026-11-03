// Usage tracking for the home-page Report: one localStorage record of per-day
// counters (LOCAL calendar days). Pure data shaping with an injectable storage
// so streaks and totals can be asserted in Node (tests/usage.test.mjs).

import { todayIso } from './flashcards.js';

export const USAGE_KEY = 'studyos.usage';
export const USAGE_KINDS = ['reviews', 'captures', 'cards', 'exports', 'opens'];
export const ACTIVITY_DAYS = 7;

function emptyDays() {
  return {};
}

export function loadUsage(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(USAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.days !== 'object' || !parsed.days) {
      return { days: emptyDays() };
    }
    return { days: parsed.days };
  } catch {
    return { days: emptyDays() };
  }
}

export function saveUsage(usage, storage = globalThis.localStorage) {
  try {
    storage?.setItem(USAGE_KEY, JSON.stringify({ days: usage?.days || emptyDays() }));
  } catch {
    /* private mode / quota: the session still counts, it just won't persist */
  }
  return usage;
}

// Bump one counter for today. Unknown kinds are ignored so a typo in a call
// site cannot pollute the record.
export function trackUsage(kind, n = 1, { storage = globalThis.localStorage, now = new Date() } = {}) {
  if (!USAGE_KINDS.includes(kind) || !(n > 0)) return loadUsage(storage);
  const usage = loadUsage(storage);
  const day = todayIso(now);
  const bucket = usage.days[day] || (usage.days[day] = {});
  bucket[kind] = (bucket[kind] || 0) + n;
  saveUsage(usage, storage);
  return usage;
}

export function totalOf(days, kind) {
  return Object.values(days).reduce((sum, bucket) => sum + (Number(bucket?.[kind]) || 0), 0);
}

export function totals(days = {}) {
  return USAGE_KINDS.reduce((acc, kind) => ({ ...acc, [kind]: totalOf(days, kind) }), {});
}

// [{ date, reviews, … }] for the last `n` LOCAL days, oldest first — the shape a
// bar chart wants, with zeros filled so the axis never has holes.
export function lastNDays(days = {}, n = ACTIVITY_DAYS, now = new Date()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const date = todayIso(new Date(now.getTime() - i * 86400000));
    const bucket = days[date] || {};
    const row = { date };
    for (const kind of USAGE_KINDS) row[kind] = Number(bucket[kind]) || 0;
    out.push(row);
  }
  return out;
}

// Consecutive days with at least one review, counting back from today (or from
// yesterday when today's review hasn't happened yet — a streak doesn't break
// just because the day is young).
export function reviewStreak(days = {}, now = new Date()) {
  let streak = 0;
  for (let i = 0; i < 3650; i++) {
    const date = todayIso(new Date(now.getTime() - i * 86400000));
    const reviews = Number(days[date]?.reviews) || 0;
    if (reviews > 0) streak++;
    else if (i === 0) continue; // today still open — look at yesterday
    else break;
  }
  return streak;
}
