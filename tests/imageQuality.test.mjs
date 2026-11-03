import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_IMAGE_QUALITY, IMAGE_QUALITY_KEY, canvasCapture, loadImageQuality,
  normalizeImageQuality, saveImageQuality
} from '../src/lib/imageQuality.js';

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key)
  };
}

test('image quality defaults to 80 and is clamped to 10–100', () => {
  assert.equal(DEFAULT_IMAGE_QUALITY, 80);
  assert.equal(normalizeImageQuality(undefined), 80);
  assert.equal(normalizeImageQuality('not a number'), 80);
  assert.equal(normalizeImageQuality(0), 10);
  assert.equal(normalizeImageQuality(-50), 10);
  assert.equal(normalizeImageQuality(150), 100);
  assert.equal(normalizeImageQuality('72.6'), 73);
});

test('quality persists through the settings key', () => {
  const storage = memoryStorage();
  assert.equal(loadImageQuality(storage), 80);
  assert.equal(saveImageQuality(55, storage), 55);
  assert.equal(storage.getItem(IMAGE_QUALITY_KEY), '55');
  assert.equal(loadImageQuality(storage), 55);
  saveImageQuality(300, storage);
  assert.equal(loadImageQuality(storage), 100);
});

test('canvasCapture returns a JPEG data URL at the requested quality', () => {
  const calls = [];
  const canvas = {
    toDataURL(type, quality) {
      calls.push({ type, quality });
      return 'data:image/jpeg;base64,AAAA';
    }
  };
  assert.equal(canvasCapture(canvas, 80), 'data:image/jpeg;base64,AAAA');
  assert.deepEqual(calls[0], { type: 'image/jpeg', quality: 0.8 });
  assert.equal(canvasCapture(null), null);
});
