// Grid/list preference per section. The DEFAULT everywhere is grid; the choice
// is remembered per section in localStorage so the Gallery can stay a list while
// the Library stays a grid. Injectable storage keeps it testable in Node
// (tests/viewmode.test.mjs).

export const VIEW_KEY = 'studyos.viewmodes';
export const SECTIONS = ['library', 'gallery', 'today', 'video', 'flashcards'];
export const DEFAULT_MODE = 'grid';

export function normalizeMode(mode) {
  return mode === 'list' ? 'list' : 'grid';
}

export function loadViewModes(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(VIEW_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const out = {};
    if (parsed && typeof parsed === 'object') {
      for (const section of SECTIONS) {
        if (parsed[section]) out[section] = normalizeMode(parsed[section]);
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function viewModeFor(section, storage = globalThis.localStorage) {
  return loadViewModes(storage)[section] || DEFAULT_MODE;
}

export function setViewMode(section, mode, storage = globalThis.localStorage) {
  if (!SECTIONS.includes(section)) return DEFAULT_MODE;
  const normalized = normalizeMode(mode);
  const modes = loadViewModes(storage);
  modes[section] = normalized;
  try {
    storage?.setItem(VIEW_KEY, JSON.stringify(modes));
  } catch {
    /* private mode: the session still switches, it just will not persist */
  }
  return normalized;
}

export function toggleViewMode(section, storage = globalThis.localStorage) {
  const next = viewModeFor(section, storage) === 'grid' ? 'list' : 'grid';
  return setViewMode(section, next, storage);
}
