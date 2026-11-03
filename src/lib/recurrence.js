// Task recurrence (plan §6.8, §17: "Task recurrence correctly handles
// daylight-saving and timezone transitions").
//
// Design: all date arithmetic happens on plain calendar dates (YYYY-MM-DD)
// using UTC-anchored Date objects, so a "day" is always a calendar day and
// never a fixed 24h span. Wall-clock time (HH:MM) is stored separately from the
// date and is never added/subtracted as milliseconds, so a daily 09:00 task
// stays at 09:00 across DST transitions (the naive +86400000 approach drifts
// to 08:00 or 10:00). Month-end dates clamp (Jan 31 -> Feb 28/29).

export const FREQS = ['daily', 'weekly', 'monthly'];

export function makeRule({ freq = 'daily', interval = 1, daysOfWeek = [], dayOfMonth = null, endDate = null } = {}) {
  return { freq, interval, daysOfWeek: [...daysOfWeek], dayOfMonth, endDate };
}

export function validateRule(rule) {
  const errors = [];
  if (!rule) return { ok: false, errors: ['rule required'] };
  if (!FREQS.includes(rule.freq)) errors.push(`freq must be one of ${FREQS.join('/')}`);
  if (!Number.isInteger(rule.interval) || rule.interval < 1 || rule.interval > 365) errors.push('interval must be an integer 1..365');
  if (rule.freq === 'weekly') {
    if (!Array.isArray(rule.daysOfWeek) || rule.daysOfWeek.length === 0) errors.push('weekly rules need daysOfWeek');
    else if (rule.daysOfWeek.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) errors.push('daysOfWeek entries must be 0..6 (0=Sunday)');
  }
  if (rule.freq === 'monthly') {
    if (rule.dayOfMonth != null && (!Number.isInteger(rule.dayOfMonth) || rule.dayOfMonth < 1 || rule.dayOfMonth > 31)) errors.push('dayOfMonth must be 1..31');
  }
  if (rule.endDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(rule.endDate)) errors.push('endDate must be YYYY-MM-DD');
  return { ok: errors.length === 0, errors };
}

// --- calendar date helpers (UTC-anchored, DST-immune) ----------------------

export function parseDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

export function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso, n) {
  const d = parseDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return formatDate(d);
}

// 0=Sunday .. 6=Saturday (matches <input type=date> and JS getUTCDay).
export function dayOfWeek(iso) {
  return parseDate(iso).getUTCDay();
}

export function daysInMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

// Clamp a day-of-month into a specific month (Jan 31 -> Feb 28/29).
export function clampDayOfMonth(year, monthIndex, day) {
  return Math.min(day, daysInMonth(year, monthIndex));
}

export function todayIso(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// --- occurrence expansion ---------------------------------------------------

// Does the rule produce an occurrence on `iso`? Pure predicate used by the
// range expansion and by "is this task due today".
export function occursOn(rule, seriesStart, iso) {
  if (iso < seriesStart) return false;
  if (rule.endDate && iso > rule.endDate) return false;
  const start = parseDate(seriesStart);
  const date = parseDate(iso);
  const days = Math.round((date - start) / 86400000);

  if (rule.freq === 'daily') {
    return days % rule.interval === 0;
  }
  if (rule.freq === 'weekly') {
    // ISO weeks (Monday-start): a date's week is the Monday-based week it falls
    // in, and intervals count from the week containing seriesStart. This makes
    // "every 2 weeks on Monday" include the Monday two weeks after the start
    // regardless of the start weekday.
    if (!rule.daysOfWeek.includes(dayOfWeek(iso))) return false;
    const weekOf = (d) => addDays(d, -((dayOfWeek(d) + 6) % 7));
    const weeks = Math.round((parseDate(weekOf(iso)) - parseDate(weekOf(seriesStart))) / 604800000);
    return weeks >= 0 && weeks % rule.interval === 0;
  }
  if (rule.freq === 'monthly') {
    const monthDiff = (date.getUTCFullYear() - start.getUTCFullYear()) * 12 + (date.getUTCMonth() - start.getUTCMonth());
    if (monthDiff % rule.interval !== 0) return false;
    const wanted = rule.dayOfMonth ?? start.getUTCDate();
    return date.getUTCDate() === clampDayOfMonth(date.getUTCFullYear(), date.getUTCMonth(), wanted);
  }
  return false;
}

// Expand occurrences of `rule` from `seriesStart` within [fromIso, toIso]
// inclusive. Returns YYYY-MM-DD strings in ascending order.
export function occurrencesInRange(rule, seriesStart, fromIso, toIso, limit = 1000) {
  const out = [];
  if (!seriesStart || !fromIso || !toIso || fromIso > toIso) return out;
  const effEnd = rule.endDate && rule.endDate < toIso ? rule.endDate : toIso;
  const from = fromIso < seriesStart ? seriesStart : fromIso;
  if (from > effEnd) return out;

  // Iterate calendar days; bounded by limit and by an absolute scan cap so a
  // pathological rule cannot hang the UI.
  const scanCap = 366 * 20;
  let iso = from;
  let scanned = 0;
  while (iso <= effEnd && out.length < limit && scanned < scanCap) {
    if (occursOn(rule, seriesStart, iso)) out.push(iso);
    iso = addDays(iso, 1);
    scanned++;
  }
  return out;
}

// Next occurrence strictly after `afterIso` (or today), within `horizonDays`.
export function nextOccurrence(rule, seriesStart, afterIso, horizonDays = 370) {
  const from = afterIso ? addDays(afterIso, 1) : seriesStart;
  const to = addDays(from, horizonDays);
  return occurrencesInRange(rule, seriesStart, from, to, 1)[0] || null;
}

// --- human formatting -------------------------------------------------------

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function describeRule(rule) {
  if (!rule) return 'Never';
  const every = rule.interval === 1 ? '' : `Every ${rule.interval} `;
  let base;
  if (rule.freq === 'daily') base = rule.interval === 1 ? 'Every day' : `${every}days`;
  else if (rule.freq === 'weekly') {
    const days = (rule.daysOfWeek || []).slice().sort((a, b) => a - b).map((d) => DAY_NAMES[d]).join(', ');
    base = rule.interval === 1 ? `Weekly on ${days}` : `Every ${rule.interval} weeks on ${days}`;
  } else if (rule.freq === 'monthly') {
    const dom = rule.dayOfMonth ?? null;
    base = rule.interval === 1 ? `Monthly on day ${dom ?? '?'}` : `Every ${rule.interval} months on day ${dom ?? '?'}`;
  } else return 'Never';
  if (rule.endDate) base += ` until ${rule.endDate}`;
  return base;
}
