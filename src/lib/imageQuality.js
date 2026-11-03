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
