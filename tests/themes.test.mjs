import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_THEME, THEMES, isDarkTheme, normalizeTheme, themeById, themeLabelKey,
  themeMode, themesByMode
} from '../src/lib/themes.js';

test('theme catalogue has five light and five dark palettes', () => {
  assert.equal(THEMES.length, 10);
  assert.equal(themesByMode('light').length, 5);
  assert.equal(themesByMode('dark').length, 5);
  assert.equal(new Set(THEMES.map((theme) => theme.id)).size, THEMES.length);
  for (const theme of THEMES) {
    assert.ok(theme.accent && theme.bg && theme.surface, `${theme.id} has swatches`);
    assert.ok(theme.label.startsWith('theme.'), `${theme.id} has a translation key`);
  }
});

test('normalizeTheme keeps known ids and falls back to light', () => {
  for (const theme of THEMES) assert.equal(normalizeTheme(theme.id), theme.id);
  assert.equal(normalizeTheme('not-a-theme'), DEFAULT_THEME);
  assert.equal(normalizeTheme(null), DEFAULT_THEME);
  assert.equal(themeById('unknown').id, DEFAULT_THEME);
});

test('theme mode and label helpers are consistent', () => {
  assert.equal(themeMode('midnight'), 'dark');
  assert.equal(themeMode('sand'), 'light');
  assert.equal(isDarkTheme('graphite'), true);
  assert.equal(isDarkTheme('rose'), false);
  assert.equal(themeLabelKey('forest'), 'theme.forest');
  assert.equal(themeLabelKey('missing'), 'theme.light');
});
