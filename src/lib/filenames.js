// File naming for saved images (captures, Anki media): every image gets a name
// of `<base>_<date>_<time>` so two captures of the same page never collide and
// the name itself says when the picture was taken. Pure string work — testable
// in Node (tests/filenames.test.mjs).

// 2026-10-16_14-25-08 in LOCAL time (the moment matters to the student, not UTC).
export function stampDateTime(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const src = Number.isNaN(d.getTime()) ? new Date() : d;
  const p = (n) => String(n).padStart(2, '0');
  return `${src.getFullYear()}-${p(src.getMonth() + 1)}-${p(src.getDate())}_${p(src.getHours())}-${p(src.getMinutes())}-${p(src.getSeconds())}`;
}

// "Biology.pdf" -> "Biology"; strips characters a filesystem (or the desktop
// bridge's safeName) would mangle, keeps Arabic letters, caps the length.
export function safeBaseName(name, fallback = 'capture') {
  const base = String(name || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return base || fallback;
}

// `taken` is an optional Set of names already used: a second image whose
// base+time would collide gets -2, -3, … instead of overwriting the first.
export function uniqueFileName(name, taken) {
  if (!taken || !taken.has(name)) {
    if (taken) taken.add(name);
    return name;
  }
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const tail = dot > 0 ? name.slice(dot) : '';
  let n = 2;
  while (taken.has(`${stem}-${n}${tail}`)) n++;
  const out = `${stem}-${n}${tail}`;
  taken.add(out);
  return out;
}

// data:image/(png|jpe?g);base64,… -> { bytes, ext } for embedders (xlsx/Anki),
// or null for anything we cannot place.
export function dataImageBytes(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const m = dataUrl.match(/^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=]+)$/i);
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, ext: /^png$/i.test(m[1]) ? 'png' : 'jpg' };
}

export function imageFileName(base, date = new Date(), ext = 'png') {
  return `${safeBaseName(base)}_${stampDateTime(date)}.${String(ext || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png'}`;
}
