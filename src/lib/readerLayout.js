// Reader layout maths, kept pure so the page-strip, spread pairing and
// navigation rules can be tested without a browser.
//
// `continuous` is the default: one page after another in a scrolling strip.
// `single` shows exactly one page. `spread` shows a real two-page opening:
// the first page of the pair is on the RIGHT for RTL and on the LEFT for LTR.
// Page numbers always increase in reading order; only the visual slots swap.

export const READER_LAYOUTS = ['continuous', 'single', 'spread'];
export const READING_MODES = ['normal', 'paper', 'amber', 'aqua', 'grey', 'darkgray', 'dark'];

export function normalizeLayout(value) {
  return READER_LAYOUTS.includes(value) ? value : 'continuous';
}

export function normalizeReadingMode(value) {
  return READING_MODES.includes(value) ? value : 'normal';
}

export function normalizeReadingDirection(value) {
  return value === 'ltr' ? 'ltr' : 'rtl';
}

// Opening pairs start on an odd page: 1–2, 3–4, … no matter which page inside
// the pair the reader selected.
export function spreadStart(page, numPages) {
  const total = Math.max(1, Number(numPages) || 1);
  const p = Math.max(1, Math.min(total, Number(page) || 1));
  const start = p % 2 === 0 ? p - 1 : p;
  return Math.max(1, Math.min(start, total));
}

// The two slots of the current opening, in physical left-to-right order.
// A missing facing page becomes `null` so the cover stays on its correct side.
export function spreadSlots(page, numPages, direction = 'rtl') {
  const total = Math.max(1, Number(numPages) || 1);
  if (total === 1) return direction === 'ltr' ? [1, null] : [null, 1];
  const start = spreadStart(page, total);
  const first = start;
  const second = start + 1 <= total ? start + 1 : null;
  if (!second) return direction === 'ltr' ? [first, null] : [null, first];
  return direction === 'ltr' ? [first, second] : [second, first];
}

// Page numbers that must be mounted for a layout.
export function pagesForLayout({ layout, page, numPages }) {
  const total = Math.max(0, Number(numPages) || 0);
  if (!total) return [];
  const current = Math.max(1, Math.min(total, Number(page) || 1));
  if (layout === 'single') return [current];
  if (layout === 'spread') {
    const start = spreadStart(current, total);
    return start + 1 <= total ? [start, start + 1] : [start];
  }
  return Array.from({ length: total }, (_, i) => i + 1);
}

// What one "next" / "previous" press means in the current layout.
export function stepPage({ layout, page, numPages, delta, direction = 'rtl' }) {
  const total = Math.max(1, Number(numPages) || 1);
  const current = Math.max(1, Math.min(total, Number(page) || 1));
  let next;
  if (layout === 'spread') {
    const start = spreadStart(current, total);
    next = start + (delta > 0 ? 2 : -2);
  } else {
    next = current + (delta > 0 ? 1 : -1);
  }
  return Math.max(1, Math.min(total, next));
}
