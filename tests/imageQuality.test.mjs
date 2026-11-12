import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_IMAGE_QUALITY, IMAGE_QUALITY_KEY, canvasCapture, loadImageQuality,
  normalizeImageQuality, saveImageQuality,
  SCREENSHOT_RES_KEY, DEFAULT_SCREENSHOT_RES, loadScreenshotResolution,
  saveScreenshotResolution, computeTargetDimensions
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

test('screenshot resolution defaults to 360p and persists', () => {
  const storage = memoryStorage();
  assert.equal(loadScreenshotResolution(storage), DEFAULT_SCREENSHOT_RES);
  assert.equal(saveScreenshotResolution('720p', storage), '720p');
  assert.equal(storage.getItem(SCREENSHOT_RES_KEY), '720p');
  assert.equal(loadScreenshotResolution(storage), '720p');
  saveScreenshotResolution('invalid-res', storage);
  assert.equal(loadScreenshotResolution(storage), '360p');
});

test('computeTargetDimensions calculates correct dimensions from 144p or 1440p', () => {
  // 144p video (256x144, 16:9) scaled to 360p medium quality
  const upscaled = computeTargetDimensions(256, 144, '360p');
  assert.equal(upscaled.height, 360);
  assert.equal(upscaled.width, 640);

  // 1440p video (2560x1440, 16:9) scaled to 360p
  const downscaled = computeTargetDimensions(2560, 1440, '360p');
  assert.equal(downscaled.height, 360);
  assert.equal(downscaled.width, 640);

  // Original resolution preserves exact source dimensions
  const orig = computeTargetDimensions(2560, 1440, 'original');
  assert.equal(orig.width, 2560);
  assert.equal(orig.height, 1440);

  // 720p HD option
  const hd = computeTargetDimensions(640, 360, '720p');
  assert.equal(hd.height, 720);
  assert.equal(hd.width, 1280);
});
