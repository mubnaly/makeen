import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mediaKindOf, isVideoFilename, formatTimecode, parseTimecode, clampSeek,
  captureFileName, frameCaptureRecord, VIDEO_EXTENSIONS, SPEEDS
} from '../src/lib/media.js';
import { savePdfBytes, readPdfBytes, deleteFileBytes } from '../src/lib/storage.js';

test('video files are recognised by mime type or extension', () => {
  assert.equal(mediaKindOf({ name: 'lecture.mp4', type: '' }), 'video');
  assert.equal(mediaKindOf({ name: 'LECTURE.MKV' }), 'video');
  assert.equal(mediaKindOf({ name: 'no-extension', type: 'video/webm' }), 'video');
  assert.equal(mediaKindOf({ name: 'notes.pdf', type: 'application/pdf' }), 'pdf');
  assert.equal(mediaKindOf({ name: 'notes.PDF' }), 'pdf');
  assert.equal(mediaKindOf({ name: 'photo.png' }), 'other');
  assert.equal(mediaKindOf(null), 'other');
  assert.deepEqual(VIDEO_EXTENSIONS.slice(0, 3), ['mp4', 'm4v', 'webm']);
  assert.equal(isVideoFilename('a/b/lesson 3.MP4'), true);
  assert.equal(isVideoFilename('landmark.pdf'), false);
});

test('timecodes format as m:ss or h:mm:ss and never invent a duration', () => {
  assert.equal(formatTimecode(0), '0:00');
  assert.equal(formatTimecode(9), '0:09');
  assert.equal(formatTimecode(65), '1:05');
  assert.equal(formatTimecode(3725), '1:02:05');
  assert.equal(formatTimecode(Infinity), '—');
  assert.equal(formatTimecode(NaN), '—');
  assert.equal(formatTimecode(-4), '—');
});

test('timecodes parse back exactly', () => {
  for (const seconds of [0, 7, 65, 3599, 3725]) {
    assert.equal(parseTimecode(formatTimecode(seconds)), seconds);
  }
  assert.equal(parseTimecode('1:05'), 65);
  assert.equal(parseTimecode('1:02:05'), 3725);
  assert.equal(parseTimecode(''), null);
  assert.equal(parseTimecode('abc'), null);
  assert.equal(parseTimecode('-1:00'), null);
});

test('seeking stays inside the file, even before the duration is known', () => {
  assert.equal(clampSeek(-5, 100), 0);
  assert.equal(clampSeek(40, 100), 40);
  assert.equal(clampSeek(140, 100), 100);
  assert.equal(clampSeek(140, Infinity), 140, 'a live/unknown duration still allows forward seeking');
  assert.equal(clampSeek('nonsense', 100), 0);
});

test('captured frame names are filesystem safe and keep the timecode', () => {
  const name = captureFileName('محاضرة 01.mp4', 754, 1700000000000);
  assert.equal(name, 'محاضرة_01_12-34_1700000000000.png');
  assert.ok(!/[/\\:*?"<>|]/.test(captureFileName('a/b:c*?"<>|.mp4', 3, 1)));
});

test('a frame capture carries the moment it was taken', () => {
  const record = frameCaptureRecord({
    id: 'c1', documentId: 'v1', title: 'Lecture 3.webm', seconds: 65.4,
    image: 'data:image/png;base64,AAA', createdAt: '2026-10-16T10:00:00.000Z'
  });
  assert.equal(record.timecode, '1:05');
  assert.equal(record.seconds, 65);
  assert.equal(record.page, null);
  assert.equal(record.source, 'Lecture 3.webm');
  assert.equal(record.name, 'Lecture 3 · 1:05');
  assert.equal(record.documentId, 'v1');
  assert.equal(record.createdAt, '2026-10-16T10:00:00.000Z');
});

test('playback speeds are the documented ladder', () => {
  assert.deepEqual(SPEEDS, [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]);
  assert.ok(SPEEDS.includes(1));
});

test('removing a video frees its stored bytes', async () => {
  delete globalThis.indexedDB; // force the in-memory fallback
  await savePdfBytes('v-test', new Uint8Array([1, 2, 3]).buffer);
  assert.ok(await readPdfBytes('v-test'), 'bytes are readable after saving');
  await deleteFileBytes('v-test');
  assert.equal(await readPdfBytes('v-test'), null, 'bytes are gone after deleting');
  await deleteFileBytes('never-stored');
});

test('videos persist a playback position and bookmarks in the library record', async () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
  };
  const library = await import('../src/lib/library.js');
  library.upsertDocument({ id: 'v1', kind: 'video', title: 'Lecture 3.webm', durationSeconds: 3725 });

  const after = library.setPlaybackPosition('v1', 754.6);
  assert.equal(after.lastSeconds, 755, 'position is rounded to whole seconds');
  assert.ok(after.lastOpened > 0);

  library.setBookmarks('v1', [{ id: 'b1', at: 65, note: 'definitions' }, { id: 'b2', at: 300, note: '' }]);
  const record = library.getDocument('v1');
  assert.deepEqual(record.bookmarks.map((b) => b.at), [65, 300]);
  assert.equal(record.lastSeconds, 755);

  // Unknown documents are ignored instead of throwing.
  assert.equal(library.setPlaybackPosition('missing', 10), null);
  assert.equal(library.setBookmarks('missing', []), null);
  delete globalThis.localStorage;
});
