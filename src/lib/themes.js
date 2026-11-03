// Theme catalogue. The palette itself lives in styles.css as CSS variables keyed
// by `data-theme`; this module is the single source of truth for the picker,
// validation and the pre-paint boot script. Adding a theme is one entry here and
// one matching block in styles.css.
//
// Every theme sets the same variables, so icons (which are drawn with
// `currentColor`) and every surface follow the palette automatically.

export const DEFAULT_THEME = 'light';

export const THEMES = [
  { id: 'light', mode: 'light', label: 'theme.light', accent: '#4f6bff', bg: '#f7f7fb', surface: '#ffffff' },
  { id: 'sand', mode: 'light', label: 'theme.sand', accent: '#b45309', bg: '#f7f1e3', surface: '#fffaf0' },
  { id: 'mint', mode: 'light', label: 'theme.mint', accent: '#0f766e', bg: '#f2f8f5', surface: '#ffffff' },
  { id: 'sky', mode: 'light', label: 'theme.sky', accent: '#2563eb', bg: '#f3f7fb', surface: '#ffffff' },
  { id: 'rose', mode: 'light', label: 'theme.rose', accent: '#be185d', bg: '#fbf5f7', surface: '#ffffff' },
  { id: 'dark', mode: 'dark', label: 'theme.dark', accent: '#6f86ff', bg: '#14151c', surface: '#1c1d26' },
  { id: 'midnight', mode: 'dark', label: 'theme.midnight', accent: '#38bdf8', bg: '#0a1220', surface: '#111c2e' },
  { id: 'forest', mode: 'dark', label: 'theme.forest', accent: '#4ade80', bg: '#0c1511', surface: '#12201a' },
  { id: 'plum', mode: 'dark', label: 'theme.plum', accent: '#c084fc', bg: '#150f1b', surface: '#1e1626' },
  { id: 'graphite', mode: 'dark', label: 'theme.graphite', accent: '#f59e0b', bg: '#101010', surface: '#191919' }
];

const BY_ID = new Map(THEMES.map((theme) => [theme.id, theme]));

export function normalizeTheme(id) {
  return BY_ID.has(String(id || '')) ? String(id) : DEFAULT_THEME;
}

export function themeById(id) {
  return BY_ID.get(normalizeTheme(id));
}

export function themeMode(id) {
  return themeById(id).mode;
}

export function isDarkTheme(id) {
  return themeMode(id) === 'dark';
}

export function themesByMode(mode) {
  return THEMES.filter((theme) => theme.mode === mode);
}

export function themeLabelKey(id) {
  return themeById(id).label;
}
