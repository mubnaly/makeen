import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { safeFileName } = require('../electron/fsnames.cjs');

test('export filenames keep Arabic and other Unicode', () => {
  assert.equal(safeFileName('محاضرة — transcript.pdf'), 'محاضرة — transcript.pdf');
  assert.equal(safeFileName('Cours — résumé.pdf'), 'Cours — résumé.pdf');
  assert.equal(safeFileName('درس/ملاحظات.pdf'), 'ملاحظات.pdf');
});

test('a path can never escape the exports folder', () => {
  assert.equal(safeFileName('../../etc/passwd'), 'passwd');
  assert.equal(safeFileName('..\\..\\Windows\\system.ini'), 'system.ini');
  assert.equal(safeFileName('/absolute/file.pdf'), 'file.pdf');
  assert.equal(safeFileName('...hidden.pdf'), 'hidden.pdf');
});

test('reserved and illegal Windows names are neutralised', () => {
  assert.equal(safeFileName('CON'), '_CON');
  assert.equal(safeFileName('nul.pdf'), '_nul.pdf');
  assert.equal(safeFileName('a<b>c:d"e?f*g|h.pdf'), 'a b c d e f g h.pdf');
  assert.equal(safeFileName('line\u0000break\u001f.pdf'), 'line break.pdf');
});

test('empty, whitespace and missing names fall back', () => {
  assert.equal(safeFileName('', 'transcript.pdf'), 'transcript.pdf');
  assert.equal(safeFileName('   ', 'transcript.pdf'), 'transcript.pdf');
  assert.equal(safeFileName(null, 'transcript.pdf'), 'transcript.pdf');
  assert.equal(safeFileName('x'.repeat(300)).length, 120);
});
