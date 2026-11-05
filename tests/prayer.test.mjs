import test from 'node:test';
import assert from 'node:assert/strict';
import {
  POPULAR_CITIES,
  calculateAstronomicalTimings,
  getNextPrayerInfo,
  getFormattedDates,
  loadPrayerSettings,
  savePrayerSettings,
  getSelectedCity
} from '../src/lib/prayer.js';
import { AVAILABLE_SOUNDS, loadPreferredSound, savePreferredSound } from '../src/lib/sound.js';

// Mock localStorage
const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => storage.get(k) || null,
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
  clear: () => storage.clear()
};

test('POPULAR_CITIES contains Cairo, Alexandria, Makkah, Riyadh and Arab cities', () => {
  assert.ok(POPULAR_CITIES.length >= 20);
  const cairo = POPULAR_CITIES.find((c) => c.id === 'cairo');
  assert.ok(cairo);
  assert.equal(cairo.nameAr, 'القاهرة');
  assert.equal(cairo.countryAr, 'مصر');

  const makkah = POPULAR_CITIES.find((c) => c.id === 'makkah');
  assert.ok(makkah);
  assert.equal(makkah.nameAr, 'مكة المكرمة');
});

test('calculateAstronomicalTimings returns all 6 prayer/sun events in valid HH:MM', () => {
  const cairo = getSelectedCity('cairo');
  const fixedDate = new Date('2026-11-05T12:00:00Z');
  const timings = calculateAstronomicalTimings(fixedDate, cairo);

  assert.ok(timings.fajr);
  assert.ok(timings.sunrise);
  assert.ok(timings.dhuhr);
  assert.ok(timings.asr);
  assert.ok(timings.maghrib);
  assert.ok(timings.isha);

  const timeRegex = /^\d{2}:\d{2}$/;
  assert.match(timings.fajr, timeRegex);
  assert.match(timings.sunrise, timeRegex);
  assert.match(timings.dhuhr, timeRegex);
  assert.match(timings.asr, timeRegex);
  assert.match(timings.maghrib, timeRegex);
  assert.match(timings.isha, timeRegex);
});

test('getNextPrayerInfo identifies upcoming prayer and remaining minutes', () => {
  const timings = {
    fajr: '04:30',
    sunrise: '06:00',
    dhuhr: '12:00',
    asr: '15:15',
    maghrib: '17:30',
    isha: '19:00'
  };

  // 11:30 -> Next should be Dhuhr with 30 mins
  const testNow = new Date('2026-11-05T11:30:00');
  testNow.setHours(11, 30, 0, 0);

  const info = getNextPrayerInfo(timings, testNow);
  assert.ok(info);
  assert.equal(info.next.key, 'dhuhr');
  assert.equal(info.minutesUntilNext, 30);
});

test('getFormattedDates formats Gregorian and Hijri dates', () => {
  const testDate = new Date('2026-11-05T12:00:00Z');
  const datesAr = getFormattedDates(testDate, 'ar');
  assert.ok(datesAr.gregorian.length > 5);
  assert.ok(datesAr.hijri.length > 3);

  const datesEn = getFormattedDates(testDate, 'en');
  assert.ok(datesEn.gregorian.length > 5);
});

test('loadPrayerSettings and savePrayerSettings round-trip correctly', () => {
  storage.clear();
  const initial = loadPrayerSettings();
  assert.equal(initial.cityId, 'cairo');
  assert.equal(initial.reminderMinutes, 5);

  savePrayerSettings({ cityId: 'alexandria', reminderMinutes: 10 });
  const updated = loadPrayerSettings();
  assert.equal(updated.cityId, 'alexandria');
  assert.equal(updated.reminderMinutes, 10);
});

test('sound tones list and persistence', () => {
  storage.clear();
  assert.ok(AVAILABLE_SOUNDS.length >= 4);
  assert.equal(loadPreferredSound(), 'soft-chime');

  savePreferredSound('gentle-bell');
  assert.equal(loadPreferredSound(), 'gentle-bell');
});
