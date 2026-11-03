import test from 'node:test';
import assert from 'node:assert/strict';
import { stampDateTime, safeBaseName, uniqueFileName, imageFileName, dataImageBytes } from '../src/lib/filenames.js';

test('stampDateTime writes local date and time in a filesystem-safe shape', () => {
  const when = new Date(2026, 9, 16, 14, 25, 8); // local components, no TZ guessing
  assert.equal(stampDateTime(when), '2026-10-16_14-25-08');
  assert.match(stampDateTime(), /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/);
  // No character a filesystem or the desktop bridge's safeName would rewrite.
  assert.ok(!/[^0-9a-z_.-]/i.test(stampDateTime(when)));
  // Invalid input falls back to the current time instead of printing "NaN".
  assert.match(stampDateTime('garbage'), /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/);
  assert.ok(!stampDateTime(new Date(NaN)).includes('NaN'));
});

test('safeBaseName strips the extension and unsafe characters, keeps Arabic', () => {
  assert.equal(safeBaseName('Biology.pdf'), 'Biology');
  assert.equal(safeBaseName('Lecture 3.webm'), 'Lecture 3');
  assert.equal(safeBaseName('a/b:c*?".png'), 'a b c');
  assert.equal(safeBaseName('الخلية.png'), 'الخلية');
  assert.equal(safeBaseName('   '), 'capture');
  assert.equal(safeBaseName(null, 'deck'), 'deck');
  assert.ok(safeBaseName('x'.repeat(200)).length <= 60);
});

test('uniqueFileName dedupes collisions with -2, -3 …', () => {
  const taken = new Set();
  assert.equal(uniqueFileName('a_2026-01-01_10-00-00.png', taken), 'a_2026-01-01_10-00-00.png');
  assert.equal(uniqueFileName('a_2026-01-01_10-00-00.png', taken), 'a_2026-01-01_10-00-00-2.png');
  assert.equal(uniqueFileName('a_2026-01-01_10-00-00.png', taken), 'a_2026-01-01_10-00-00-3.png');
  assert.equal(uniqueFileName('b.png'), 'b.png', 'no taken set = plain passthrough');
});

test('imageFileName is base + date + time + extension', () => {
  const when = new Date(2026, 9, 16, 14, 25, 8);
  assert.equal(imageFileName('Biology.pdf', when), 'Biology_2026-10-16_14-25-08.png');
  assert.equal(imageFileName('Biology', when, 'jpg'), 'Biology_2026-10-16_14-25-08.jpg');
  assert.ok(!/[/\\:*?"<>|]/.test(imageFileName('a/b:c.png', when)));
});

test('dataImageBytes decodes PNG/JPEG data URLs and rejects anything else', () => {
  const png = dataImageBytes('data:image/png;base64,AQID');
  assert.equal(png.ext, 'png');
  assert.deepEqual([...png.bytes], [1, 2, 3]);
  const jpg = dataImageBytes('data:image/jpeg;base64,AP8=');
  assert.equal(jpg.ext, 'jpg');
  // Cross-checked against Node's independent base64 decoder.
  assert.deepEqual([...jpg.bytes], [...Buffer.from('AP8=', 'base64')]);
  assert.equal(dataImageBytes('data:image/gif;base64,AQID'), null, 'gif cannot be embedded');
  assert.equal(dataImageBytes('not a data url'), null);
  assert.equal(dataImageBytes(null), null);
  assert.equal(dataImageBytes('data:image/png;base64,%%%'), null, 'invalid base64');
});
