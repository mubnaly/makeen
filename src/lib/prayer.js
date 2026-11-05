// Prayer Times & Islamic Calendar System for Makeen.
// Features:
//   - Accurate astronomical calculation for popular Egyptian & Arab cities (100% offline).
//   - Once-daily online synchronization with AlAdhan API when connected.
//   - Hijri and Gregorian date formatting (Arabic & English).
//   - Pre-prayer notifications with customizable sound chime & lead time.

export const POPULAR_CITIES = [
  // Egypt (مصر)
  { id: 'cairo', nameAr: 'القاهرة', nameEn: 'Cairo', countryAr: 'مصر', countryEn: 'Egypt', lat: 30.0444, lng: 31.2357, timezone: 2, method: 5 },
  { id: 'alexandria', nameAr: 'الإسكندرية', nameEn: 'Alexandria', countryAr: 'مصر', countryEn: 'Egypt', lat: 31.2001, lng: 29.9187, timezone: 2, method: 5 },
  { id: 'giza', nameAr: 'الجيزة', nameEn: 'Giza', countryAr: 'مصر', countryEn: 'Egypt', lat: 30.0131, lng: 31.2089, timezone: 2, method: 5 },
  { id: 'mansoura', nameAr: 'المنصورة', nameEn: 'Mansoura', countryAr: 'مصر', countryEn: 'Egypt', lat: 31.0409, lng: 31.3785, timezone: 2, method: 5 },
  { id: 'tanta', nameAr: 'طنطا', nameEn: 'Tanta', countryAr: 'مصر', countryEn: 'Egypt', lat: 30.7865, lng: 31.0004, timezone: 2, method: 5 },
  { id: 'zagazig', nameAr: 'الزقازيق', nameEn: 'Zagazig', countryAr: 'مصر', countryEn: 'Egypt', lat: 30.5765, lng: 31.5041, timezone: 2, method: 5 },
  { id: 'ismailia', nameAr: 'الإسماعيلية', nameEn: 'Ismailia', countryAr: 'مصر', countryEn: 'Egypt', lat: 30.6043, lng: 32.2723, timezone: 2, method: 5 },
  { id: 'port-said', nameAr: 'بورسعيد', nameEn: 'Port Said', countryAr: 'مصر', countryEn: 'Egypt', lat: 31.2653, lng: 32.3019, timezone: 2, method: 5 },
  { id: 'suez', nameAr: 'السويس', nameEn: 'Suez', countryAr: 'مصر', countryEn: 'Egypt', lat: 29.9668, lng: 32.5498, timezone: 2, method: 5 },
  { id: 'asyut', nameAr: 'أسيوط', nameEn: 'Asyut', countryAr: 'مصر', countryEn: 'Egypt', lat: 27.1783, lng: 31.1859, timezone: 2, method: 5 },
  { id: 'sohag', nameAr: 'سوهاج', nameEn: 'Sohag', countryAr: 'مصر', countryEn: 'Egypt', lat: 26.5569, lng: 31.6948, timezone: 2, method: 5 },
  { id: 'qena', nameAr: 'قنا', nameEn: 'Qena', countryAr: 'مصر', countryEn: 'Egypt', lat: 26.1551, lng: 32.7160, timezone: 2, method: 5 },
  { id: 'luxor', nameAr: 'الأقصر', nameEn: 'Luxor', countryAr: 'مصر', countryEn: 'Egypt', lat: 25.6872, lng: 32.6396, timezone: 2, method: 5 },
  { id: 'aswan', nameAr: 'أسوان', nameEn: 'Aswan', countryAr: 'مصر', countryEn: 'Egypt', lat: 24.0889, lng: 32.8998, timezone: 2, method: 5 },
  { id: 'hurghada', nameAr: 'الغردقة', nameEn: 'Hurghada', countryAr: 'مصر', countryEn: 'Egypt', lat: 27.2579, lng: 33.8116, timezone: 2, method: 5 },
  { id: 'sharm', nameAr: 'شرم الشيخ', nameEn: 'Sharm El Sheikh', countryAr: 'مصر', countryEn: 'Egypt', lat: 27.9158, lng: 34.3299, timezone: 2, method: 5 },

  // Saudi Arabia (المملكة العربية السعودية)
  { id: 'makkah', nameAr: 'مكة المكرمة', nameEn: 'Makkah', countryAr: 'السعودية', countryEn: 'Saudi Arabia', lat: 21.3891, lng: 39.8579, timezone: 3, method: 4 },
  { id: 'madinah', nameAr: 'المدينة المنورة', nameEn: 'Madinah', countryAr: 'السعودية', countryEn: 'Saudi Arabia', lat: 24.5247, lng: 39.5692, timezone: 3, method: 4 },
  { id: 'riyadh', nameAr: 'الرياض', nameEn: 'Riyadh', countryAr: 'السعودية', countryEn: 'Saudi Arabia', lat: 24.7136, lng: 46.6753, timezone: 3, method: 4 },
  { id: 'jeddah', nameAr: 'جدة', nameEn: 'Jeddah', countryAr: 'السعودية', countryEn: 'Saudi Arabia', lat: 21.5433, lng: 39.1728, timezone: 3, method: 4 },
  { id: 'dammam', nameAr: 'الدمام', nameEn: 'Dammam', countryAr: 'السعودية', countryEn: 'Saudi Arabia', lat: 26.4207, lng: 50.0888, timezone: 3, method: 4 },

  // United Arab Emirates (الإمارات)
  { id: 'dubai', nameAr: 'دبي', nameEn: 'Dubai', countryAr: 'الإمارات', countryEn: 'United Arab Emirates', lat: 25.2048, lng: 55.2708, timezone: 4, method: 4 },
  { id: 'abu-dhabi', nameAr: 'أبوظبي', nameEn: 'Abu Dhabi', countryAr: 'الإمارات', countryEn: 'United Arab Emirates', lat: 24.4539, lng: 54.3773, timezone: 4, method: 4 },
  { id: 'sharjah', nameAr: 'الشارقة', nameEn: 'Sharjah', countryAr: 'الإمارات', countryEn: 'United Arab Emirates', lat: 25.3463, lng: 55.4209, timezone: 4, method: 4 },

  // Other Arab Capitals & Major Cities
  { id: 'kuwait-city', nameAr: 'مدينة الكويت', nameEn: 'Kuwait City', countryAr: 'الكويت', countryEn: 'Kuwait', lat: 29.3759, lng: 47.9774, timezone: 3, method: 4 },
  { id: 'doha', nameAr: 'الدوحة', nameEn: 'Doha', countryAr: 'قطر', countryEn: 'Qatar', lat: 25.2854, lng: 51.5310, timezone: 3, method: 4 },
  { id: 'manama', nameAr: 'المنامة', nameEn: 'Manama', countryAr: 'البحرين', countryEn: 'Bahrain', lat: 26.2285, lng: 50.5860, timezone: 3, method: 4 },
  { id: 'muscat', nameAr: 'مسقط', nameEn: 'Muscat', countryAr: 'عمان', countryEn: 'Oman', lat: 23.5880, lng: 58.3829, timezone: 4, method: 4 },
  { id: 'amman', nameAr: 'عمّان', nameEn: 'Amman', countryAr: 'الأردن', countryEn: 'Jordan', lat: 31.9454, lng: 35.9284, timezone: 3, method: 3 },
  { id: 'jerusalem', nameAr: 'القدس الشريف', nameEn: 'Jerusalem', countryAr: 'فلسطين', countryEn: 'Palestine', lat: 31.7683, lng: 35.2137, timezone: 3, method: 3 },
  { id: 'beirut', nameAr: 'بيروت', nameEn: 'Beirut', countryAr: 'لبنان', countryEn: 'Lebanon', lat: 33.8938, lng: 35.5018, timezone: 3, method: 3 },
  { id: 'damascus', nameAr: 'دمشق', nameEn: 'Damascus', countryAr: 'سوريا', countryEn: 'Syria', lat: 33.5138, lng: 36.2765, timezone: 3, method: 3 },
  { id: 'baghdad', nameAr: 'بغداد', nameEn: 'Baghdad', countryAr: 'العراق', countryEn: 'Iraq', lat: 33.3152, lng: 44.3661, timezone: 3, method: 3 },
  { id: 'sanaa', nameAr: 'صنعاء', nameEn: 'Sanaa', countryAr: 'اليمن', countryEn: 'Yemen', lat: 15.3694, lng: 44.1910, timezone: 3, method: 4 },
  { id: 'tripoli', nameAr: 'طرابلس', nameEn: 'Tripoli', countryAr: 'ليبيا', countryEn: 'Libya', lat: 32.8872, lng: 13.1913, timezone: 2, method: 5 },
  { id: 'tunis', nameAr: 'تونس', nameEn: 'Tunis', countryAr: 'تونس', countryEn: 'Tunisia', lat: 36.8065, lng: 10.1815, timezone: 1, method: 3 },
  { id: 'algiers', nameAr: 'الجزائر العاصمة', nameEn: 'Algiers', countryAr: 'الجزائر', countryEn: 'Algeria', lat: 36.7538, lng: 3.0588, timezone: 1, method: 3 },
  { id: 'rabat', nameAr: 'الرباط', nameEn: 'Rabat', countryAr: 'المغرب', countryEn: 'Morocco', lat: 34.0209, lng: -6.8416, timezone: 1, method: 3 },
  { id: 'khartoum', nameAr: 'الخرطوم', nameEn: 'Khartoum', countryAr: 'السودان', countryEn: 'Sudan', lat: 15.5007, lng: 32.5599, timezone: 2, method: 5 },
  { id: 'istanbul', nameAr: 'إسطنبول', nameEn: 'Istanbul', countryAr: 'تركيا', countryEn: 'Turkey', lat: 41.0082, lng: 28.9784, timezone: 3, method: 13 }
];

export const PRAYER_NAMES = {
  fajr: { ar: 'الفجر', en: 'Fajr', icon: 'moon', isPrayer: true },
  sunrise: { ar: 'الشروق', en: 'Sunrise', icon: 'sun', isPrayer: false },
  duha: { ar: 'الضحى', en: 'Duha', icon: 'sun', isPrayer: true },
  dhuhr: { ar: 'الظهر', en: 'Dhuhr', icon: 'sun', isPrayer: true },
  asr: { ar: 'العصر', en: 'Asr', icon: 'sun', isPrayer: true },
  maghrib: { ar: 'المغرب', en: 'Maghrib', icon: 'moon', isPrayer: true },
  isha: { ar: 'العشاء', en: 'Isha', icon: 'moon', isPrayer: true }
};

const SETTINGS_KEY = 'makeen.prayer.settings';
const CACHE_KEY = 'makeen.prayer.cache';

export const DEFAULT_PRAYER_SETTINGS = {
  cityId: 'cairo',
  reminderEnabled: true,
  reminderMinutes: 5,
  soundTone: 'soft-chime',
  soundVolume: 0.7,
  hijriAdjustment: 0
};

export function loadPrayerSettings() {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_PRAYER_SETTINGS };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_PRAYER_SETTINGS };
    return { ...DEFAULT_PRAYER_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_PRAYER_SETTINGS };
  }
}

export function savePrayerSettings(patch) {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_PRAYER_SETTINGS };
  const current = loadPrayerSettings();
  const next = { ...current, ...patch };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch {}
  return next;
}

export function getSelectedCity(cityId = null) {
  const targetId = cityId || loadPrayerSettings().cityId;
  return POPULAR_CITIES.find((c) => c.id === targetId) || POPULAR_CITIES[0];
}

// --- Astronomical Offline Prayer Times Calculation ---
function toRadians(deg) { return (deg * Math.PI) / 180.0; }
function toDegrees(rad) { return (rad * 180.0) / Math.PI; }
function fixAngle(a) { a = a % 360.0; return a < 0 ? a + 360.0 : a; }
function fixHour(a) { a = a % 24.0; return a < 0 ? a + 24.0 : a; }

/**
 * Calculates exact prayer times astronomically for any date and coordinates.
 */
export function calculateAstronomicalTimings(date, city) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();

  // Julian day calculation
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  const jd = day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
  const d = jd - 2451545.0;

  // Sun's mean anomaly & ecliptic coordinates
  const g = fixAngle(357.529 + 0.98560028 * d);
  const q = fixAngle(280.459 + 0.98564736 * d);
  const L = fixAngle(q + 1.915 * Math.sin(toRadians(g)) + 0.020 * Math.sin(toRadians(2 * g)));
  const e = 23.439 - 0.00000036 * d; // Obliquity of ecliptic

  // Right ascension and declination
  const RA = toDegrees(Math.atan2(Math.cos(toRadians(e)) * Math.sin(toRadians(L)), Math.cos(toRadians(L)))) / 15.0;
  const delta = Math.asin(Math.sin(toRadians(e)) * Math.sin(toRadians(L))); // in radians
  const dec = toDegrees(delta);

  // Equation of Time (EoT)
  const EqT = (q / 15.0) - fixHour(RA);

  // Timezone offset in hours
  const timezone = city.timezone || -date.getTimezoneOffset() / 60;
  const noon = fixHour(12 + timezone - (city.lng / 15.0) - EqT);

  // Hour angles for sunrise/sunset and prayers
  function hourAngle(altitudeAngle) {
    const latRad = toRadians(city.lat);
    const top = Math.sin(toRadians(altitudeAngle)) - Math.sin(latRad) * Math.sin(delta);
    const bottom = Math.cos(latRad) * Math.cos(delta);
    const cosAngle = top / bottom;
    if (cosAngle > 1.0 || cosAngle < -1.0) return 0; // polar day/night safeguard
    return toDegrees(Math.acos(cosAngle)) / 15.0;
  }

  // Fajr: Egyptian General Authority (19.5 deg) or Umm Al Qura (18.5 deg)
  const fajrAngle = city.method === 4 ? -18.5 : -19.5;
  const ishaAngle = city.method === 4 ? -18.5 : -17.5;

  const haSunrise = hourAngle(-0.8333);
  const haFajr = hourAngle(fajrAngle);
  const haIsha = hourAngle(ishaAngle);

  // Asr altitude: Shadow factor = 1 (Shafi'i/Maliki/Hanbali standard)
  const asrAltitude = toDegrees(Math.atan(1.0 / (1.0 + Math.tan(Math.abs(toRadians(city.lat) - delta)))));
  const haAsr = hourAngle(asrAltitude);

  function formatTime(hours) {
    const totalMinutes = Math.round(hours * 60);
    const h = Math.floor(totalMinutes / 60) % 24;
    const min = totalMinutes % 60;
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  }

  const resTimings = {
    fajr: formatTime(noon - haFajr),
    sunrise: formatTime(noon - haSunrise),
    duha: formatTime(noon - haSunrise + 20 / 60),
    dhuhr: formatTime(noon),
    asr: formatTime(noon + haAsr),
    maghrib: formatTime(noon + haSunrise),
    isha: formatTime(noon + haIsha)
  };
  return resTimings;
}

export function calculateDuhaTime(sunriseStr) {
  if (!sunriseStr) return '06:30';
  const [h, m] = sunriseStr.split(':').map(Number);
  const total = (h * 60 + m + 20) % (24 * 60);
  const dh = Math.floor(total / 60);
  const dm = total % 60;
  return `${String(dh).padStart(2, '0')}:${String(dm).padStart(2, '0')}`;
}

/**
 * Gets prayer times for today.
 * Tries local cache first; if cache is stale or missing, fetches once from AlAdhan API.
 * Always falls back cleanly to offline astronomical calculations.
 */
export async function getPrayerTimes(date = new Date(), customCity = null) {
  const city = customCity || getSelectedCity();
  const dateKey = date.toISOString().slice(0, 10);
  const cacheKey = `${city.id}-${dateKey}`;

  // Check localStorage cache
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const cached = JSON.parse(raw);
        if (cached && cached.key === cacheKey && cached.timings) {
          return { timings: cached.timings, source: 'cache', hijri: cached.hijri || null };
        }
      }
    } catch {}
  }

  // Try online sync (1 request per day)
  try {
    const url = `https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(city.nameEn)}&country=${encodeURIComponent(city.countryEn)}&method=${city.method || 5}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (res.ok) {
      const json = await res.json();
      if (json?.data?.timings) {
        const rawT = json.data.timings;
        const sunrise = rawT.Sunrise?.slice(0, 5) || '06:10';
        const timings = {
          fajr: rawT.Fajr?.slice(0, 5) || '04:40',
          sunrise,
          duha: calculateDuhaTime(sunrise),
          dhuhr: rawT.Dhuhr?.slice(0, 5) || '11:45',
          asr: rawT.Asr?.slice(0, 5) || '15:00',
          maghrib: rawT.Maghrib?.slice(0, 5) || '17:30',
          isha: rawT.Isha?.slice(0, 5) || '18:50'
        };
        const hijri = json.data.date?.hijri || null;

        if (typeof localStorage !== 'undefined') {
          try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({ key: cacheKey, timings, hijri }));
          } catch {}
        }
        return { timings, source: 'online', hijri };
      }
    }
  } catch (err) {
    // Network offline or failed: proceed seamlessly with offline calculation
  }

  // Offline astronomical calculation fallback
  const timings = calculateAstronomicalTimings(date, city);
  return { timings, source: 'astronomical', hijri: null };
}

/**
 * Calculates current and next prayer relative to current time.
 */
export function getNextPrayerInfo(timings, now = new Date()) {
  if (!timings) return null;

  const currentHours = now.getHours();
  const currentMinutes = now.getMinutes();
  const currentTotalMins = currentHours * 60 + currentMinutes;

  const prayers = [
    { key: 'fajr', nameAr: 'الفجر', nameEn: 'Fajr', time: timings.fajr, isPrayer: true },
    { key: 'sunrise', nameAr: 'شروق الشمس', nameEn: 'Sunrise', time: timings.sunrise, isPrayer: false },
    { key: 'duha', nameAr: 'صلاة الضحى', nameEn: 'Duha', time: timings.duha || calculateDuhaTime(timings.sunrise), isPrayer: true },
    { key: 'dhuhr', nameAr: 'الظهر', nameEn: 'Dhuhr', time: timings.dhuhr, isPrayer: true },
    { key: 'asr', nameAr: 'العصر', nameEn: 'Asr', time: timings.asr, isPrayer: true },
    { key: 'maghrib', nameAr: 'المغرب', nameEn: 'Maghrib', time: timings.maghrib, isPrayer: true },
    { key: 'isha', nameAr: 'العشاء', nameEn: 'Isha', time: timings.isha, isPrayer: true }
  ];

  function parseMins(timeStr) {
    if (!timeStr) return 0;
    const [h, m] = timeStr.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  }

  // Find next upcoming prayer
  let nextPrayer = null;
  let currentPrayer = prayers[prayers.length - 1]; // default Isha of yesterday

  for (let i = 0; i < prayers.length; i++) {
    const pMins = parseMins(prayers[i].time);
    if (currentTotalMins < pMins) {
      nextPrayer = prayers[i];
      currentPrayer = i > 0 ? prayers[i - 1] : prayers[prayers.length - 1];
      break;
    }
  }

  // If past Isha, next prayer is Fajr tomorrow
  if (!nextPrayer) {
    nextPrayer = { ...prayers[0], isTomorrow: true };
    currentPrayer = prayers[prayers.length - 1];
  }

  const nextMins = parseMins(nextPrayer.time);
  let diffMins = nextPrayer.isTomorrow
    ? (24 * 60 - currentTotalMins) + nextMins
    : nextMins - currentTotalMins;

  return {
    current: currentPrayer,
    next: nextPrayer,
    minutesUntilNext: diffMins,
    formattedUntil: formatRemainingDuration(diffMins)
  };
}

function formatRemainingDuration(diffMins) {
  if (diffMins <= 0) return { ar: 'الآن', en: 'Now' };
  const hours = Math.floor(diffMins / 60);
  const mins = diffMins % 60;
  if (hours > 0) {
    return {
      ar: `${hours} س و ${mins} د`,
      en: `${hours}h ${mins}m`
    };
  }
  return {
    ar: `${mins} دقيقة`,
    en: `${mins} min`
  };
}

/**
 * Returns localized Gregorian and Hijri date representations.
 */
export function getFormattedDates(date = new Date(), lang = 'ar') {
  // Gregorian Date
  const gregFormatter = new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  const gregorianStr = gregFormatter.format(date);

  // Hijri Date using native Intl Islamic calendar
  let hijriStr = '';
  try {
    const hijriFormatter = new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA-u-ca-islamic-umalqura' : 'en-US-u-ca-islamic-umalqura', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
    hijriStr = hijriFormatter.format(date);
    if (lang === 'ar' && !hijriStr.includes('هـ')) {
      hijriStr += ' هـ';
    } else if (lang !== 'ar' && !hijriStr.includes('AH')) {
      hijriStr += ' AH';
    }
  } catch {
    hijriStr = '';
  }

  return {
    gregorian: gregorianStr,
    hijri: hijriStr
  };
}
