// Reactive language state for components. The dictionary itself lives in
// lib/i18n.js (pure, unit-tested); this module only holds the current language
// and keeps <html lang/dir> in step so the whole app flips to RTL for Arabic.
import { applyDocumentLang, dirFor, localeFor, loadLang, saveLang, translate } from './i18n.js';

export const ui = $state({ lang: loadLang() });

// Read during render: touching ui.lang here is what makes every label follow a
// language switch without any component wiring.
export function t(key, params) {
  return translate(ui.lang, key, params);
}

export function setLang(code) {
  ui.lang = saveLang(code);
  applyDocumentLang(ui.lang);
  return ui.lang;
}

export function applyLang() {
  applyDocumentLang(ui.lang);
}

export function dir() {
  return dirFor(ui.lang);
}

export function locale() {
  return localeFor(ui.lang);
}
