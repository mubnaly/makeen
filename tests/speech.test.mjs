import test from 'node:test';
import assert from 'node:assert/strict';
import { isSpeechAvailable, transcribeAudio } from '../src/lib/speech.js';

test('isSpeechAvailable returns boolean', async () => {
  const avail = await isSpeechAvailable();
  assert.equal(typeof avail, 'boolean');
});

test('transcribeAudio returns error when audio bytes are empty', async () => {
  const result = await transcribeAudio(null);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'emptyAudio');
});

test('transcribeAudio falls back gracefully when bridge is not available', async () => {
  const dummy = new Uint8Array([1, 2, 3]);
  const result = await transcribeAudio(dummy);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'offlineSttUnavailable');
});
