// Screenshot quality. PDF and video frames are large by nature; a student can
// trade a little fidelity for much smaller local storage. 80% is the default
// because it is visually lossless for diagrams and text at screenshot size.
//
// Kept free of Svelte so the clamp/persistence rules are unit-testable. The
// canvas helper is guarded so importing this module in Node stays harmless.

export const IMAGE_QUALITY_KEY = 'studyos.capture.quality';
export const DEFAULT_IMAGE_QUALITY = 80;
export const IMAGE_QUALITY_MIN = 10;
export const IMAGE_QUALITY_MAX = 100;

export const SCREENSHOT_RES_KEY = 'studyos.capture.resolution';
export const DEFAULT_SCREENSHOT_RES = '360p';

export const SCREENSHOT_RES_OPTIONS = [
  { id: '360p', labelAr: '360p (متوسطة - افتراضي)', labelEn: '360p (Medium - Default)', height: 360 },
  { id: '480p', labelAr: '480p (جودة جيدة SD)', labelEn: '480p (Good Quality SD)', height: 480 },
  { id: '720p', labelAr: '720p (عالية HD)', labelEn: '720p (High Definition HD)', height: 720 },
  { id: '1080p', labelAr: '1080p (فائقة Full HD)', labelEn: '1080p (Full HD)', height: 1080 },
  { id: 'original', labelAr: 'الأصلية (بدون تغيير)', labelEn: 'Original Resolution', height: 0 }
];

export function loadScreenshotResolution(storage = globalThis.localStorage) {
  try {
    const val = storage?.getItem(SCREENSHOT_RES_KEY);
    return SCREENSHOT_RES_OPTIONS.some((o) => o.id === val) ? val : DEFAULT_SCREENSHOT_RES;
  } catch {
    return DEFAULT_SCREENSHOT_RES;
  }
}

export function saveScreenshotResolution(resId, storage = globalThis.localStorage) {
  const chosen = SCREENSHOT_RES_OPTIONS.some((o) => o.id === resId) ? resId : DEFAULT_SCREENSHOT_RES;
  try { storage?.setItem(SCREENSHOT_RES_KEY, chosen); } catch { /* private mode */ }
  return chosen;
}

export function computeTargetDimensions(srcW, srcH, resId = DEFAULT_SCREENSHOT_RES) {
  const w = Math.max(1, Number(srcW) || 640);
  const h = Math.max(1, Number(srcH) || 360);
  const aspect = w / h;

  if (resId === 'original') {
    return { width: Math.round(w), height: Math.round(h) };
  }

  const option = SCREENSHOT_RES_OPTIONS.find((o) => o.id === resId) || SCREENSHOT_RES_OPTIONS[0];
  const targetH = option.height || 360;
  const targetW = Math.round(targetH * aspect);

  return {
    width: targetW,
    height: targetH
  };
}

export function normalizeImageQuality(value, fallback = DEFAULT_IMAGE_QUALITY) {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(IMAGE_QUALITY_MAX, Math.max(IMAGE_QUALITY_MIN, Math.round(n)));
}

export function loadImageQuality(storage = globalThis.localStorage) {
  try {
    return normalizeImageQuality(storage?.getItem(IMAGE_QUALITY_KEY));
  } catch {
    return DEFAULT_IMAGE_QUALITY;
  }
}

export function saveImageQuality(value, storage = globalThis.localStorage) {
  const quality = normalizeImageQuality(value);
  try { storage?.setItem(IMAGE_QUALITY_KEY, String(quality)); } catch { /* private mode */ }
  return quality;
}

// JPEG has no alpha channel, so every caller paints an opaque background first
// (the PDF page is white already; video frames are opaque). The percentage is
// the browser's own JPEG quality knob.
export function canvasCapture(canvas, quality = loadImageQuality()) {
  if (!canvas || typeof canvas.toDataURL !== 'function') return null;
  try {
    return canvas.toDataURL('image/jpeg', normalizeImageQuality(quality) / 100);
  } catch {
    return null;
  }
}
