// Local video helpers (plan §6.6). Pure functions only — the player itself lives
// in components/Video.svelte — so the timecode and file-kind rules can be tested.

export const VIDEO_EXTENSIONS = ['mp4', 'm4v', 'webm', 'mkv', 'mov', 'ogv', 'ogg', 'avi', 'mpeg', 'mpg', '3gp'];
export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'oga', 'opus'];

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

// What kind of resource is this file? MIME first (browsers are reliable for
// files with no extension), extension as the fallback.
export function mediaKindOf(file) {
  const type = String(file?.type || '').toLowerCase();
  if (type.startsWith('video/') || type.startsWith('audio/')) return 'video';
  if (type === 'application/pdf') return 'pdf';
  const name = String(file?.name || '').toLowerCase();
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  if (VIDEO_EXTENSIONS.includes(ext) || AUDIO_EXTENSIONS.includes(ext)) return 'video';
  if (ext === 'pdf') return 'pdf';
  return 'other';
}

export function isVideoFilename(name) {
  const lower = String(name || '').toLowerCase();
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : '';
  return VIDEO_EXTENSIONS.includes(ext) || AUDIO_EXTENSIONS.includes(ext);
}

// 0 -> "0:00", 65 -> "1:05", 3725 -> "1:02:05". Unknown/Infinity durations are
// shown honestly as an em dash instead of a made-up number.
export function formatTimecode(seconds) {
  const total = Number(seconds);
  if (!Number.isFinite(total) || total < 0) return '—';
  const s = Math.floor(total % 60);
  const m = Math.floor((total / 60) % 60);
  const h = Math.floor(total / 3600);
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// "1:02:05" / "1:05" / "65" -> seconds. Returns null for anything unreadable.
export function parseTimecode(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const parts = raw.split(':').map((p) => Number(p));
  if (parts.some((p) => !Number.isFinite(p) || p < 0)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return null;
}

// Seeking stays inside the file; an unknown (Infinity) duration still allows
// forward seeking, which is what a recorded lecture needs.
export function clampSeek(seconds, duration) {
  const value = Number(seconds);
  const safe = Number.isFinite(value) ? value : 0;
  const max = Number.isFinite(duration) && duration > 0 ? duration : Infinity;
  return Math.min(Math.max(safe, 0), max);
}

export function captureFileName(title, seconds, stamp = Date.now()) {
  const base = String(title || 'video').replace(/\.[^.]+$/, '').replace(/[^a-z0-9\u0600-\u06FF_-]+/gi, '_');
  return `${base}_${formatTimecode(seconds).replace(/:/g, '-')}_${stamp}.png`;
}

// A frame capture is stored as a gallery capture, so it carries the same fields
// the PDF captures do plus the moment it was taken.
export function frameCaptureRecord({ id, documentId, title, seconds, image, createdAt, name }) {
  return {
    id,
    documentId,
    source: title,
    page: null,
    timecode: formatTimecode(seconds),
    seconds: Math.round(Number(seconds) || 0),
    image,
    name: name || `${String(title || 'video').replace(/\.[^.]+$/, '')} · ${formatTimecode(seconds)}`,
    caption: '',
    tags: '',
    createdAt: createdAt || new Date().toISOString()
  };
}
