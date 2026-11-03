// Spaced repetition: difficulty scale, review intervals and the daily reminder.
//
// The scale is the teacher-facing one — five levels whose intervals the user owns
// (Settings → Spaced repetition), defaulting to:
//   very easy 4 weeks · easy 2 weeks · moderate 1 week · hard 3 days · very hard 1 day
//
// Everything here is pure: intervals, next due dates, the reminder decision. The
// app owns the timer and the Notification API; this module only decides *what*
// should happen (tests/srs.test.mjs).

import { addDaysIso, todayIso } from './flashcards.js';

export const DIFFICULTIES = ['very_hard', 'hard', 'moderate', 'easy', 'very_easy'];

export const DIFFICULTY_LABELS = {
  very_hard: 'Very hard',
  hard: 'Hard',
  moderate: 'Moderate',
  easy: 'Easy',
  very_easy: 'Very easy'
};

export const DEFAULT_INTERVALS = {
  very_easy: 28,
  easy: 14,
  moderate: 7,
  hard: 3,
  very_hard: 1
};

// Below the "moderate" default, review is due *later*; the review screen shows
// them in this order so the honest "I found this hard" is the leftmost button.
export const DEFAULT_REMINDER_TIME = '09:00';
export const SRS_KEY = 'studyos.srs';
export const MIN_INTERVAL_DAYS = 1;
export const MAX_INTERVAL_DAYS = 365;

export const DEFAULT_SETTINGS = {
  intervals: { ...DEFAULT_INTERVALS },
  reminderOn: false,
  reminderTime: DEFAULT_REMINDER_TIME,
  lastNotified: ''
};

// --- settings ---------------------------------------------------------------

function clampDays(value, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_INTERVAL_DAYS, Math.max(MIN_INTERVAL_DAYS, n));
}

function clampTime(value, fallback = DEFAULT_REMINDER_TIME) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!m) return fallback;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return fallback;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

// Accept anything (missing keys, junk, an older build) and always return a usable
// settings object — the scheduler must never be the reason a review fails.
export function normalizeSettings(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const intervals = {};
  for (const level of DIFFICULTIES) {
    intervals[level] = clampDays(source.intervals?.[level], DEFAULT_INTERVALS[level]);
  }
  return {
    intervals,
    reminderOn: source.reminderOn === true,
    reminderTime: clampTime(source.reminderTime),
    lastNotified: typeof source.lastNotified === 'string' ? source.lastNotified : ''
  };
}

export function loadSrsSettings(kv = globalThis.localStorage) {
  if (!kv) return normalizeSettings(null);
  try {
    const text = kv.getItem(SRS_KEY);
    return normalizeSettings(text ? JSON.parse(text) : null);
  } catch {
    return normalizeSettings(null);
  }
}

export function saveSrsSettings(settings, kv = globalThis.localStorage) {
  const normalized = normalizeSettings(settings);
  try {
    kv?.setItem(SRS_KEY, JSON.stringify(normalized));
  } catch {
    /* quota: settings are best-effort */
  }
  return normalized;
}

// --- intervals --------------------------------------------------------------

// Cards rated before this scale existed carry the old labels; keep their meaning.
const LEGACY_DIFFICULTIES = { again: 'very_hard', good: 'moderate', 'very-good': 'easy' };

export function normalizeDifficulty(value) {
  // "Very easy", "very_easy" and "very-easy" all mean the same level.
  const key = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (DIFFICULTIES.includes(key)) return key;
  if (LEGACY_DIFFICULTIES[key]) return LEGACY_DIFFICULTIES[key];
  return null;
}

export function intervalDaysFor(difficulty, settings = DEFAULT_SETTINGS) {
  const level = normalizeDifficulty(difficulty) || 'moderate';
  return normalizeSettings(settings).intervals[level];
}

// The next review date for a rating: a local calendar day, so a card rated in the
// evening never lands a day off.
export function nextDueIso(difficulty, settings = DEFAULT_SETTINGS, fromIso = todayIso()) {
  return addDaysIso(fromIso, intervalDaysFor(difficulty, settings));
}

// Returns a NEW card (never mutates the caller's object).
export function applyRating(card, difficulty, settings = DEFAULT_SETTINGS, now = new Date()) {
  const level = normalizeDifficulty(difficulty) || 'moderate';
  return {
    ...card,
    difficulty: level,
    due: nextDueIso(level, settings, todayIso(now)),
    lastReviewedAt: now.toISOString()
  };
}

// --- reminder ---------------------------------------------------------------

function minutesOf(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

// Fire once a day, at the first check on or after the chosen time — so opening
// the app at 20:00 after a 09:00 reminder still reminds you.
export function reminderDecision({ settings, now = new Date(), dueCount = 0, lastNotified = '' } = {}) {
  const s = normalizeSettings(settings);
  const today = todayIso(now);
  if (!s.reminderOn) return { fire: false, reason: 'off', today };
  if (dueCount <= 0) return { fire: false, reason: 'nothing-due', today };
  // The argument wins when supplied (callers that track the date elsewhere);
  // otherwise the persisted settings value is the single source of truth.
  const notified = lastNotified || s.lastNotified;
  if (notified && notified >= today) return { fire: false, reason: 'already-notified', today };
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  if (nowMinutes < minutesOf(s.reminderTime)) return { fire: false, reason: 'too-early', today };
  return { fire: true, reason: 'due', today };
}

// { title, body } for the OS notification / in-app toast.
export function formatReminder(dueCards = []) {
  const count = dueCards.length;
  const names = [...new Set(dueCards.map((c) => (Array.isArray(c.sets) && c.sets[0]) || c.deck || 'Default'))];
  const shown = names.slice(0, 3).join(', ');
  const more = names.length > 3 ? ` and ${names.length - 3} more` : '';
  return {
    title: count === 1 ? '1 flashcard is due' : `${count} flashcards are due`,
    body: names.length ? `${shown}${more} · review them in StudyOS.` : 'Review them in StudyOS.'
  };
}
