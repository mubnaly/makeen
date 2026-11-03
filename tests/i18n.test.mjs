import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DICT, LANGS, DEFAULT_LANG, LANG_KEY, dictKeys, translate, pluralCategory, plural,
  normalizeLang, dirFor, isRtl, loadLang, saveLang, docAttrsFor, describeRuleText, hasKey
} from '../src/lib/i18n.js';

const ARABIC_FORMS = ['zero', 'one', 'two', 'few', 'many', 'other'];
const ROOT = fileURLToPath(new URL('../src/', import.meta.url));

test('both dictionaries define exactly the same keys', () => {
  const ar = dictKeys('ar');
  const en = dictKeys('en');
  assert.deepEqual(ar, en);
  assert.ok(ar.length > 250, `expected a full dictionary, got ${ar.length} keys`);
});

test('no translation is empty or a leftover key', () => {
  for (const lang of ['ar', 'en']) {
    for (const key of dictKeys(lang)) {
      const entry = DICT[lang][key];
      const values = typeof entry === 'string' ? [entry] : Object.values(entry);
      for (const value of values) {
        assert.ok(typeof value === 'string', `${lang}.${key} must be a string`);
        assert.ok(value.trim().length > 0, `${lang}.${key} is empty`);
        assert.ok(!value.includes('undefined'), `${lang}.${key} leaked "undefined"`);
      }
    }
  }
});

test('Arabic translations carry every CLDR plural form', () => {
  for (const key of dictKeys('ar')) {
    const entry = DICT.ar[key];
    if (typeof entry === 'string') continue;
    for (const form of ARABIC_FORMS) {
      assert.ok(entry[form], `ar.${key} is missing the "${form}" form`);
    }
  }
});

test('English plural entries define at least one and other', () => {
  for (const key of dictKeys('en')) {
    const entry = DICT.en[key];
    if (typeof entry === 'string') continue;
    assert.ok(entry.one, `en.${key} is missing "one"`);
    assert.ok(entry.other, `en.${key} is missing "other"`);
  }
});

test('every placeholder in English appears in the Arabic text (and vice versa)', () => {
  const placeholders = (value) => {
    const text = typeof value === 'string' ? value : Object.values(value).join(' ');
    return [...new Set(text.match(/\{(\w+)\}/g) || [])].sort();
  };
  for (const key of dictKeys('en')) {
    assert.deepEqual(
      placeholders(DICT.ar[key]),
      placeholders(DICT.en[key]),
      `placeholder mismatch for "${key}"`
    );
  }
});

test('every literal key used by the UI exists in both dictionaries', () => {
  // A missing key silently renders as the key itself, which is easy to miss on
  // a screen nobody happens to open. Scan the shell and every component for
  // t('key') / tr('key') literals and require both languages to define them.
  const files = [
    join(ROOT, 'App.svelte'),
    ...readdirSync(join(ROOT, 'components'))
      .filter((name) => name.endsWith('.svelte'))
      .map((name) => join(ROOT, 'components', name))
  ];
  const missing = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\b(?:t|tr)\(\s*(['"])([^'"]+)\1\s*[,)]/g)) {
      const key = match[2];
      if (!hasKey('en', key) || !hasKey('ar', key)) missing.push(`${key} (${file.split(/[\\/]/).pop()})`);
    }
  }
  assert.deepEqual([...new Set(missing)], [], 'the UI references translation keys that do not exist');
});

test('Arabic picks the CLDR plural category for real counts', () => {
  assert.equal(pluralCategory('ar', 0), 'zero');
  assert.equal(pluralCategory('ar', 1), 'one');
  assert.equal(pluralCategory('ar', 2), 'two');
  assert.equal(pluralCategory('ar', 3), 'few');
  assert.equal(pluralCategory('ar', 10), 'few');
  assert.equal(pluralCategory('ar', 11), 'many');
  assert.equal(pluralCategory('ar', 99), 'many');
  assert.equal(pluralCategory('ar', 100), 'other');
  assert.equal(pluralCategory('en', 1), 'one');
  assert.equal(pluralCategory('en', 0), 'other');
  // plural() picks the form; translate() is what interpolates {n} into it.
  assert.equal(plural('ar', { one: 'بطاقة', other: '{n} بطاقة' }, 1), 'بطاقة');
  assert.equal(plural('en', { one: '{n} card', other: '{n} cards' }, 4), '{n} cards');
  assert.equal(translate('en', 'gallery.createCards', { n: 4 }), 'Create 4 cards');
  assert.equal(translate('ar', 'gallery.createCards', { n: 4 }), 'إنشاء 4 بطاقات');
});

test('unknown keys fall back to English text and never render "undefined"', () => {
  assert.equal(translate('ar', 'no.such.key'), 'no.such.key');
  assert.equal(translate('ar', 'common.save'), 'حفظ');
  assert.equal(translate('en', 'common.save'), 'Save');
});

test('interpolation leaves no braces behind', () => {
  const text = translate('en', 'reader.pageOf', { n: 3, total: 9 });
  assert.equal(text, 'Page 3 of 9');
  assert.ok(!text.includes('{'));
  assert.equal(translate('ar', 'reader.pageOf', { n: 3, total: 9 }), 'صفحة 3 من 9');
});

test('language codes are validated and drive direction', () => {
  assert.equal(normalizeLang('en'), 'en');
  assert.equal(normalizeLang('fr'), DEFAULT_LANG);
  assert.equal(normalizeLang(''), DEFAULT_LANG);
  assert.equal(isRtl('ar'), true);
  assert.equal(isRtl('en'), false);
  assert.equal(dirFor('ar'), 'rtl');
  assert.deepEqual(LANGS.map((l) => l.code), ['ar', 'en']);
});

test('a document element gets lang, dir and a localized title', () => {
  const attrs = docAttrsFor('ar');
  assert.equal(attrs.lang, 'ar');
  assert.equal(attrs.dir, 'rtl');
  assert.match(attrs.title, /StudyOS/);
  assert.equal(docAttrsFor('en').dir, 'ltr');
});

test('the saved language round-trips through storage and defaults to Arabic', () => {
  const store = new Map();
  const fake = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v))
  };
  assert.equal(loadLang(fake), 'ar');
  assert.equal(saveLang('en', fake), 'en');
  assert.equal(store.get(LANG_KEY), 'en');
  assert.equal(loadLang(fake), 'en');
});

test('a broken storage backend cannot break the language', () => {
  const angry = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); }
  };
  assert.equal(loadLang(angry), 'ar');
  assert.equal(saveLang('en', angry), 'en');
});

test('recurrence rules are described in the chosen language', () => {
  const t = (key, params) => translate('ar', key, params);
  const daily = describeRuleText('ar', { freq: 'daily', interval: 1 }, t);
  assert.match(daily, /كل يوم/);
  const every3 = describeRuleText('ar', { freq: 'daily', interval: 3 }, t);
  assert.match(every3, /كل 3 أيام/);
  const weekly = describeRuleText('ar', { freq: 'weekly', interval: 1, daysOfWeek: [0, 2] }, t);
  assert.match(weekly, /كل أسبوع/);
  const monthly = describeRuleText('en', { freq: 'monthly', interval: 1, dayOfMonth: 5 }, (k, p) => translate('en', k, p));
  assert.equal(monthly, 'every month on day 5');
  const withEnd = describeRuleText('en', { freq: 'daily', interval: 1, endDate: '2026-12-31' }, (k, p) => translate('en', k, p));
  assert.match(withEnd, /ends 2026-12-31$/);
  assert.equal(describeRuleText('ar', null, t), '');
});
