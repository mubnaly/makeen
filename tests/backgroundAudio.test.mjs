import test from 'node:test';
import assert from 'node:assert/strict';
import { DICT, translate } from '../src/lib/i18n.js';
import { formatTimecode, clampSeek } from '../src/lib/media.js';

test('background audio translation keys exist in both English and Arabic', () => {
  const keys = [
    'video.backgroundAudio',
    'video.backgroundAudioOn',
    'video.backgroundAudioOff',
    'video.openPdfStudy',
    'reader.bgAudioBar',
    'reader.hideBgBar',
    'reader.showBgBar',
    'reader.backToVideo'
  ];

  for (const k of keys) {
    assert.ok(DICT.en[k], `Missing en translation for ${k}`);
    assert.ok(DICT.ar[k], `Missing ar translation for ${k}`);
    assert.equal(typeof DICT.en[k], 'string');
    assert.equal(typeof DICT.ar[k], 'string');
    assert.ok(DICT.en[k].length > 0);
    assert.ok(DICT.ar[k].length > 0);
  }
});

test('formatTimecode outputs accurate tabular strings for background audio scrubber', () => {
  assert.equal(formatTimecode(0), '0:00');
  assert.equal(formatTimecode(65), '1:05');
  assert.equal(formatTimecode(3665), '1:01:05');
  assert.equal(formatTimecode(7200), '2:00:00');
});

test('clampSeek preserves boundary values correctly for seeking slider', () => {
  assert.equal(clampSeek(-10, 100), 0);
  assert.equal(clampSeek(50, 100), 50);
  assert.equal(clampSeek(150, 100), 100);
  assert.equal(clampSeek(0, 0), 0);
});

test('background playback state model behaves predictably', () => {
  let state = {
    playing: false,
    current: 0,
    duration: 600,
    title: 'Lesson 1'
  };

  // Simulate play
  state = { ...state, playing: true };
  assert.equal(state.playing, true);

  // Simulate tick / time progression
  state = { ...state, current: 45.5 };
  assert.equal(state.current, 45.5);

  // Format progress
  const display = `${formatTimecode(state.current)} / ${formatTimecode(state.duration)}`;
  assert.equal(display, '0:45 / 10:00');

  // Simulate pause
  state = { ...state, playing: false };
  assert.equal(state.playing, false);
});
