import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ICONS, ICON_NAMES, iconFill } from '../src/lib/icons.js';

const COMPONENT_DIR = new URL('../src/components/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const ROOT = new URL('../src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function componentFiles() {
  return readdirSync(COMPONENT_DIR).filter((f) => f.endsWith('.svelte')).map((f) => join(COMPONENT_DIR, f));
}

function markupFiles() {
  const files = componentFiles();
  files.push(join(ROOT, 'App.svelte'));
  return files;
}

const PRIMITIVES = new Set(['path', 'line', 'circle', 'rect', 'polyline', 'polygon']);

test('every icon is a well-formed 24x24 primitive list', () => {
  assert.ok(ICON_NAMES.length >= 30, `expected a full icon set, got ${ICON_NAMES.length}`);
  for (const [name, prims] of Object.entries(ICONS)) {
    assert.ok(Array.isArray(prims) && prims.length > 0, `${name} has no geometry`);
    for (const prim of prims) {
      assert.ok(Array.isArray(prim), `${name} primitive must be an array`);
      assert.ok(PRIMITIVES.has(prim[0]), `${name} uses unknown primitive "${prim[0]}"`);
      const expected = { path: 2, line: 5, circle: 4, rect: 5, polyline: 2, polygon: 2 }[prim[0]];
      assert.ok(prim.length >= expected, `${name} ${prim[0]} needs ${expected - 1} coordinates`);
      for (const value of prim.slice(1)) {
        if (typeof value === 'number') {
          assert.ok(Number.isFinite(value), `${name} has a non-finite coordinate`);
        } else {
          assert.ok(typeof value === 'string' && value.trim().length > 0, `${name} has an empty coordinate`);
        }
      }
    }
  }
});

test('only polygons are filled, everything else stays an outline', () => {
  assert.equal(iconFill(['polygon', '5 3 19 12 5 21']), true);
  assert.equal(iconFill(['path', 'M3 3h4']), false);
  assert.equal(iconFill(['rect', 3, 3, 18, 18]), false);
});

test('every icon referenced by a component exists', () => {
  const literals = [];
  for (const file of markupFiles()) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/name="([^"]+)"/g)) literals.push([file, match[1]]);
    // name={cond ? 'a' : 'b'} and name={`color.${x}`} style expressions: every
    // quoted alternative must be a real icon.
    for (const match of source.matchAll(/name=\{([^}]*)\}/g)) {
      // Only the branches of the expression are icon names; the comparison
      // operands ('pdf', 'video') are file kinds, not icons.
      const expr = match[1];
      const parts = /===|!==|==|!=/.test(expr) ? expr.split(/[?:]/).slice(1) : [expr];
      for (const part of parts) {
        for (const quoted of part.matchAll(/'([^']+)'/g)) literals.push([file, quoted[1]]);
      }
    }
    // Icon references kept in data (nav rail, tool bars).
    for (const match of source.matchAll(/\bicon:\s*'([^']+)'/g)) literals.push([file, match[1]]);
  }
  assert.ok(literals.length >= 20, `expected many icon references, found ${literals.length}`);
  const missing = literals.filter(([, name]) => !ICONS[name]).map(([file, name]) => `${name} (${file})`);
  assert.deepEqual([...new Set(missing)], [], 'components reference icons that do not exist');
});

test('components render no emoji: icons are monochrome SVG only', () => {
  // Pictographic ranges — the ones that render as coloured glyphs per platform.
  const emoji = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;
  const offenders = [];
  for (const file of markupFiles()) {
    const source = readFileSync(file, 'utf8');
    source.split('\n').forEach((line, i) => {
      if (emoji.test(line)) offenders.push(`${file.split(/[\\/]/).pop()}:${i + 1} ${line.trim().slice(0, 60)}`);
    });
  }
  assert.deepEqual(offenders, [], 'no component may use emoji as an icon');
});

test('Icon.svelte draws with currentColor and no colour fills', () => {
  const source = readFileSync(join(COMPONENT_DIR, 'Icon.svelte'), 'utf8');
  assert.match(source, /stroke="currentColor"/);
  assert.match(source, /fill="none"/);
  // Strip Svelte block openers ({#each …) before looking for colour literals.
  const withoutBlocks = source.replace(/\{#[a-z]+/g, '{');
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(withoutBlocks), 'Icon.svelte must not hard-code a colour');
  assert.ok(!/(rgb|hsl)\(/.test(withoutBlocks), 'Icon.svelte must not hard-code a colour');
  assert.ok(!/var\(--accent\)|var\(--danger\)/.test(source), 'icons must not use brand colours');
});
