import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AVAILABLE_AMBIENT_SOUNDS,
  AVAILABLE_SOUNDS,
  loadPomodoroSoundPrefs,
  savePomodoroSoundPrefs,
  playClockTick,
  startAmbientSound,
  stopAmbientSound,
  setAmbientVolume,
  isAmbientSoundActive
} from '../src/lib/sound.js';

// Setup mock localStorage
const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => storage.get(k) || null,
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
  clear: () => storage.clear()
};

test('AVAILABLE_AMBIENT_SOUNDS lists all required ambient focus sounds', () => {
  assert.ok(AVAILABLE_AMBIENT_SOUNDS.length >= 7);
  const ids = AVAILABLE_AMBIENT_SOUNDS.map((s) => s.id);
  assert.ok(ids.includes('none'));
  assert.ok(ids.includes('clock'));
  assert.ok(ids.includes('rain'));
  assert.ok(ids.includes('brown'));
  assert.ok(ids.includes('white'));
  assert.ok(ids.includes('waves'));
  assert.ok(ids.includes('campfire'));
  assert.ok(ids.includes('zen'));

  // Ensure every sound has Arabic and English names
  for (const s of AVAILABLE_AMBIENT_SOUNDS) {
    assert.ok(s.nameAr && s.nameAr.length > 0);
    assert.ok(s.nameEn && s.nameEn.length > 0);
  }
});

test('Pomodoro sound preferences defaults: tick is DISABLED by default', () => {
  storage.clear();
  const prefs = loadPomodoroSoundPrefs();
  assert.equal(prefs.tickEnabled, false, 'Clock tick must be disabled by default');
  assert.equal(prefs.ambientSound, 'none', 'Ambient sound must be none by default');
  assert.equal(prefs.ambientMode, 'timer');
  assert.ok(prefs.tickVolume > 0 && prefs.tickVolume <= 1);
  assert.ok(prefs.ambientVolume > 0 && prefs.ambientVolume <= 1);
});

test('savePomodoroSoundPrefs saves and loadPomodoroSoundPrefs restores settings', () => {
  storage.clear();
  savePomodoroSoundPrefs({
    tickEnabled: true,
    tickVolume: 0.6,
    ambientSound: 'rain',
    ambientVolume: 0.75,
    ambientMode: 'always'
  });

  const updated = loadPomodoroSoundPrefs();
  assert.equal(updated.tickEnabled, true);
  assert.equal(updated.tickVolume, 0.6);
  assert.equal(updated.ambientSound, 'rain');
  assert.equal(updated.ambientVolume, 0.75);
  assert.equal(updated.ambientMode, 'always');
});

test('Web Audio synthesis calls do not throw in non-browser environment', () => {
  assert.doesNotThrow(() => {
    playClockTick(0.5);
    startAmbientSound('none', 0.5);
    startAmbientSound('rain', 0.5);
    setAmbientVolume(0.8);
    stopAmbientSound();
  });
});
