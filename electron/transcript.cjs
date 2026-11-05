'use strict';

// YouTube captions, extracted in the MAIN process. The renderer cannot read the
// watch page or timedtext tracks directly because both are cross-origin, so the
// desktop bridge fetches them here (Node's fetch is not subject to CORS).
//
// Everything except fetchCaptionPage/fetchTranscriptFor is pure and is covered
// by tests/youtubeTranscript.test.mjs, so the brittle part (YouTube's HTML) can
// be repaired with a failing fixture instead of by hand.

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const WATCH_HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'accept-language': 'en-US,en;q=0.9',
  // A consent cookie keeps the EU interstitial from replacing the player page
  // (and with it every caption track) with a "before you continue" screen.
  cookie: 'CONSENT=YES+cb; SOCS=CAI'
};

const CAPTION_HEADERS = {
  'user-agent': WATCH_HEADERS['user-agent'],
  'accept-language': 'en-US,en;q=0.9'
};

// --- HTML / JSON extraction -------------------------------------------------

// Return the balanced {...} or [...] starting at `start`, respecting JSON
// strings. YouTube assigns a multi-megabyte object literal; regexes cannot do
// this safely because titles and captions contain braces and quotes.
function balancedSlice(source, start, open, close) {
  let depth = 0;
  let inString = false;
  let quote = '';
  let escaped = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return '';
}

function extractAssignedJson(html, marker) {
  const at = String(html || '').indexOf(marker);
  if (at < 0) return null;
  const start = String(html).indexOf('{', at);
  if (start < 0) return null;
  const json = balancedSlice(String(html), start, '{', '}');
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function extractArrayAfter(html, marker) {
  const at = String(html || '').indexOf(marker);
  if (at < 0) return '';
  const start = String(html).indexOf('[', at);
  if (start < 0) return '';
  return balancedSlice(String(html), start, '[', ']');
}

// --- captions metadata ------------------------------------------------------

function decodeEntities(text) {
  return String(text || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      try { return String.fromCodePoint(parseInt(hex, 16)); } catch { return ''; }
    })
    .replace(/&#(\d+);/g, (_, num) => {
      try { return String.fromCodePoint(parseInt(num, 10)); } catch { return ''; }
    })
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function stripTags(text) {
  return String(text || '').replace(/<[^>]*>/g, '');
}

function trackLabel(track) {
  const name = track && track.name;
  const raw = name && (name.simpleText || (Array.isArray(name.runs) ? name.runs.map((r) => r && r.text).join('') : ''));
  return decodeEntities(stripTags(raw)).trim() || String((track && track.languageCode) || 'Unknown');
}

function normalizeTracks(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((track) => track && typeof track.baseUrl === 'string' && track.baseUrl)
    .map((track) => ({
      languageCode: String(track.languageCode || '').trim(),
      label: trackLabel(track),
      kind: track.kind === 'asr' ? 'asr' : 'manual',
      baseUrl: track.baseUrl.replace(/&amp;/g, '&')
    }))
    .filter((track) => track.languageCode);
}

function tracksOfPlayerResponse(playerResponse) {
  const raw = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  return normalizeTracks(raw);
}

function parseCaptionTracksFromHtml(html) {
  const source = String(html || '');
  const player = extractAssignedJson(source, 'ytInitialPlayerResponse');
  const fromPlayer = tracksOfPlayerResponse(player);
  if (fromPlayer.length) return fromPlayer;
  const array = extractArrayAfter(source, '"captionTracks"');
  if (!array) return [];
  try {
    return normalizeTracks(JSON.parse(array));
  } catch {
    return [];
  }
}

function metaContent(html, name) {
  const source = String(html || '');
  const patterns = [
    new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`, 'i')
  ];
  for (const re of patterns) {
    const match = source.match(re);
    if (match) return decodeEntities(match[1]);
  }
  return '';
}

function pageTitle(html) {
  const source = String(html || '');
  const og = metaContent(source, 'og:title') || metaContent(source, 'title');
  if (og) return og;
  const match = source.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeEntities(stripTags(match[1])).replace(/\s*-\s*YouTube\s*$/i, '').trim() : '';
}

// -> { title, author, tracks, reason }
function parseWatchPage(html) {
  const source = String(html || '');
  const player = extractAssignedJson(source, 'ytInitialPlayerResponse');
  const tracks = parseCaptionTracksFromHtml(source);
  return {
    title: decodeEntities(String(player?.videoDetails?.title || pageTitle(source) || '')).trim(),
    author: decodeEntities(String(player?.videoDetails?.author || '')).trim(),
    tracks,
    reason: decodeEntities(String(player?.playabilityStatus?.reason || '')).trim()
  };
}

// Choose the requested language when present, preferring a human track over an
// auto-generated one. Without a match, the first human track wins, then the
// first track of any kind.
function pickCaptionTrack(tracks, preferred) {
  const list = Array.isArray(tracks) ? tracks.filter(Boolean) : [];
  if (!list.length) return null;
  const pref = String(preferred || '').toLowerCase().trim();
  const code = (track) => String(track.languageCode || '').toLowerCase();
  const manual = list.filter((track) => track.kind !== 'asr');
  if (pref) {
    for (const pool of [manual, list]) {
      const exact = pool.find((track) => code(track) === pref);
      if (exact) return exact;
      const regional = pool.find((track) => code(track).startsWith(`${pref}-`) || pref.startsWith(`${code(track)}-`));
      if (regional) return regional;
    }
  }
  return manual[0] || list[0];
}

// One option per language, preferring the human track over the ASR track.
function dedupeTracks(tracks) {
  const byLanguage = new Map();
  for (const track of Array.isArray(tracks) ? tracks : []) {
    if (!track || !track.languageCode) continue;
    const key = track.languageCode.toLowerCase();
    const previous = byLanguage.get(key);
    if (!previous || (previous.kind === 'asr' && track.kind !== 'asr')) byLanguage.set(key, track);
  }
  return [...byLanguage.values()].map((track) => ({
    languageCode: track.languageCode,
    label: track.label,
    kind: track.kind
  }));
}

// --- cue parsing ------------------------------------------------------------

function normalizeCueText(text) {
  return String(text || '')
    .replace(/\u200b/g, '')
    .replace(/\r/g, '')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sortCues(cues) {
  return cues
    .filter((cue) => cue && Number.isFinite(cue.start) && cue.text)
    .sort((a, b) => a.start - b.start)
    .map((cue) => ({
      start: Math.max(0, cue.start),
      duration: Math.max(0, Number(cue.duration) || 0),
      text: cue.text
    }));
}

function groupCuesBySentence(cues) {
  if (!Array.isArray(cues) || !cues.length) return [];
  const sentences = [];
  let currentGroup = [];
  let groupStart = null;
  let groupEnd = null;

  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    if (!cue || !cue.text) continue;
    const cleanText = String(cue.text).replace(/\s+/g, ' ').trim();
    if (!cleanText) continue;

    if (currentGroup.length > 0) {
      const prev = currentGroup[currentGroup.length - 1];
      if (cleanText === prev || (cleanText.length > prev.length && cleanText.startsWith(prev))) {
        currentGroup[currentGroup.length - 1] = cleanText;
        groupEnd = Math.max(groupEnd || 0, cue.start + (cue.duration || 0));
        continue;
      }
    }

    if (groupStart === null) groupStart = cue.start;
    groupEnd = cue.start + (cue.duration || 0);
    currentGroup.push(cleanText);

    const fullText = currentGroup.join(' ').replace(/\s+/g, ' ').replace(/\s+([,.;!?؛؟])/g, '$1').trim();
    const hasTerminator = /[.!?؛؟](\s|$)/.test(cleanText) || /[.!?؛؟]$/.test(fullText);
    const nextCue = cues[i + 1];
    const hasPause = nextCue && (nextCue.start - groupEnd > 1.2);
    const isLong = currentGroup.length >= 14;

    if (hasTerminator || hasPause || isLong) {
      sentences.push({
        start: Number(groupStart.toFixed(3)),
        duration: Math.max(0.5, Number((groupEnd - groupStart).toFixed(3))),
        text: fullText
      });
      currentGroup = [];
      groupStart = null;
      groupEnd = null;
    }
  }

  if (currentGroup.length) {
    const fullText = currentGroup.join(' ').replace(/\s+/g, ' ').replace(/\s+([,.;!?؛؟])/g, '$1').trim();
    if (fullText) {
      sentences.push({
        start: Number((groupStart || 0).toFixed(3)),
        duration: Math.max(0.5, Number(((groupEnd || groupStart || 0) - (groupStart || 0)).toFixed(3))),
        text: fullText
      });
    }
  }

  return sentences;
}

// YouTube's fmt=json3 response.
function parseTimedTextJson(text) {
  let data;
  try {
    data = JSON.parse(String(text || ''));
  } catch {
    return [];
  }
  const cues = [];
  for (const event of Array.isArray(data?.events) ? data.events : []) {
    if (!event || !Array.isArray(event.segs)) continue;
    const line = normalizeCueText(event.segs.map((seg) => (seg && seg.utf8) || '').join(''));
    if (!line) continue;
    const start = Number(event.tStartMs);
    const duration = Number(event.dDurationMs);
    cues.push({
      start: Number.isFinite(start) ? start / 1000 : 0,
      duration: Number.isFinite(duration) ? duration / 1000 : 0,
      text: line
    });
  }
  return sortCues(cues);
}

function attributeOf(attrs, name) {
  const match = String(attrs || '').match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return match ? decodeEntities(match[1]) : '';
}

// The older XML timedtext response.
function parseTimedTextXml(xml) {
  const source = String(xml || '');
  const cues = [];
  const re = /<text\b([^>]*)>([\s\S]*?)<\/text>/gi;
  let match;
  while ((match = re.exec(source))) {
    const start = Number(attributeOf(match[1], 'start'));
    const duration = Number(attributeOf(match[1], 'dur'));
    const text = normalizeCueText(
      decodeEntities(match[2].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ''))
    );
    if (!text) continue;
    cues.push({
      start: Number.isFinite(start) ? start : 0,
      duration: Number.isFinite(duration) ? duration : 0,
      text
    });
  }
  const sorted = sortCues(cues);
  // <text> without dur is legal; fill it from the next cue so gaps still behave.
  for (let i = 0; i < sorted.length; i++) {
    if (!sorted[i].duration && sorted[i + 1]) {
      sorted[i].duration = Math.max(0, sorted[i + 1].start - sorted[i].start);
    }
  }
  return sorted;
}

// Caption timestamps arrive in three shapes: "65.2", "1:05" and "1:02:05".
// The transcript panel uses the display form, timedtext uses seconds.
function parseTimestamp(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return NaN;
  const parts = raw.split(':').map((part) => Number(part));
  if (!parts.length || parts.some((part) => !Number.isFinite(part) || part < 0)) return NaN;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return NaN;
}

// Rows scraped from the visible transcript panel:
// [{ timestamp: '1:05', text: '…' }, …]. Durations are filled from the next
// cue because the panel does not expose them.
function cuesFromDom(rows) {
  const cues = (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      start: parseTimestamp(row?.timestamp),
      duration: 0,
      text: normalizeCueText(row?.text)
    }))
    .filter((cue) => Number.isFinite(cue.start) && cue.text)
    .sort((a, b) => a.start - b.start);
  for (let i = 0; i < cues.length - 1; i++) {
    cues[i].duration = Math.max(0, cues[i + 1].start - cues[i].start);
  }
  return cues;
}

// The get_transcript JSON wraps each line in transcriptSegmentRenderer. Walking
// the response instead of hard-coding its current nesting survives UI restyles.
function cuesFromTranscriptJson(json) {
  let data = json;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { return []; }
  }
  const rows = [];
  const seen = new Set();
  const visit = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 50) return;
    if (node.transcriptSegmentRenderer) {
      const segment = node.transcriptSegmentRenderer;
      const snippet = segment.snippet || {};
      const stamp = segment.startTimeText || {};
      const text = snippet.simpleText
        || (Array.isArray(snippet.runs) ? snippet.runs.map((run) => run?.text || '').join('') : '');
      const timestamp = stamp.simpleText
        || (Array.isArray(stamp.runs) ? stamp.runs.map((run) => run?.text || '').join('') : '');
      const key = `${timestamp}|${text}`;
      if (text && !seen.has(key)) {
        seen.add(key);
        rows.push({ timestamp, text });
      }
    }
    for (const value of Object.values(node)) visit(value, depth + 1);
  };
  visit(data);
  return cuesFromDom(rows);
}

function formatStamp(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// Plain text for the TXT export. Timestamps make the text useful later even
// after it is out of this app.
function transcriptText({ title, url, cues } = {}) {
  const list = Array.isArray(cues) ? cues : [];
  const header = [];
  if (title) header.push(String(title));
  if (url) header.push(String(url));
  header.push(`${list.length} caption${list.length === 1 ? '' : 's'}`);
  const lines = list.map((cue) => `[${formatStamp(cue.start)}] ${cue.text}`);
  return `${header.join('\n')}\n\n${lines.join('\n')}`.trim() + '\n';
}

// --- printable PDF document -------------------------------------------------

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isArabicText(text) {
  return /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/.test(String(text || ''));
}

// Everything here is rendered by Chromium's own print pipeline, which shapes
// Arabic and mixed scripts correctly. pdf-lib's standard fonts cannot.
function transcriptHtml({ title, url, cues, lang, generatedAt } = {}) {
  const list = (Array.isArray(cues) ? cues : [])
    .slice(0, 20000)
    .map((cue) => ({
      start: Math.max(0, Number(cue?.start) || 0),
      text: String(cue?.text ?? '').slice(0, 4000)
    }));
  const heading = String(title || 'YouTube transcript').slice(0, 300);
  const source = String(url || '').slice(0, 500);
  const rtl = /^ar/i.test(String(lang || '')) || isArabicText(list.map((cue) => cue.text).join(' '));
  const rows = list
    .map((cue) => {
      return `<tr><td class="t">${escapeHtml(formatStamp(cue.start))}</td><td class="x" dir="auto">${escapeHtml(cue.text)}</td></tr>`;
    })
    .join('');
  const meta = [
    source ? `<div class="source">${escapeHtml(source)}</div>` : '',
    `<div class="count">${list.length} caption${list.length === 1 ? '' : 's'}${generatedAt ? ` · ${escapeHtml(generatedAt)}` : ''}</div>`
  ].join('');
  return `<!doctype html>
<html lang="${rtl ? 'ar' : 'en'}" dir="${rtl ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(heading)}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0; color: #15161c; background: #fff;
    font-family: "Segoe UI", "Noto Naskh Arabic", Tahoma, Arial, sans-serif;
    font-size: 13px; line-height: 1.6;
  }
  h1 { font-size: 21px; line-height: 1.35; margin: 0 0 4px; }
  .source { color: #4d5262; font-size: 10.5px; word-break: break-all; }
  .count { color: #737887; font-size: 10.5px; margin-top: 2px; }
  .rule { height: 2px; background: #6d5efc; border-radius: 2px; margin: 12px 0 6px; width: 56px; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  td { vertical-align: top; padding: 5px 0; border-bottom: 1px solid #ececf2; }
  td.t {
    width: 62px; padding-inline-end: 10px; color: #7a7f8e;
    font-size: 10.5px; font-variant-numeric: tabular-nums; direction: ltr; text-align: left;
  }
  html[dir="rtl"] td.t { text-align: right; }
  td.x { font-size: 13px; white-space: pre-wrap; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  .footer { margin-top: 18px; color: #9a9eab; font-size: 9.5px; }
</style>
</head>
<body>
  <h1>${escapeHtml(heading)}</h1>
  ${meta}
  <div class="rule"></div>
  <table><tbody>${rows}</tbody></table>
  <div class="footer">Makeen · YouTube transcript</div>
</body>
</html>`;
}

// --- network ----------------------------------------------------------------

function captionUrl(baseUrl) {
  let url = String(baseUrl || '').trim();
  if (url.startsWith('//')) url = `https:${url}`;
  // The signed URL may already carry fmt=; replace it rather than duplicating.
  url = url.replace(/([?&])fmt=[^&]*/g, '$1').replace(/[?&]$/, '');
  return url;
}

async function fetchCaptionPage(videoId, fetchImpl = globalThis.fetch) {
  const id = String(videoId || '').trim();
  if (!VIDEO_ID.test(id)) throw new Error('invalid video id');
  if (typeof fetchImpl !== 'function') throw new Error('network unavailable');
  const response = await fetchImpl(`https://www.youtube.com/watch?v=${encodeURIComponent(id)}&hl=en&gl=US`, {
    headers: WATCH_HEADERS,
    redirect: 'follow'
  });
  if (!response || !response.ok) throw new Error(`YouTube returned HTTP ${response?.status || 'error'}`);
  const page = parseWatchPage(await response.text());
  page.url = `https://www.youtube.com/watch?v=${id}`;
  return page;
}

async function fetchTranscriptFor(page, preferredLang, fetchImpl = globalThis.fetch) {
  const tracks = Array.isArray(page?.tracks) ? page.tracks : [];
  const track = pickCaptionTrack(tracks, preferredLang);
  if (!track) {
    return {
      ok: false,
      error: 'noCaptions',
      title: page?.title || '',
      message: page?.reason || ''
    };
  }
  const base = captionUrl(track.baseUrl);
  const separator = base.includes('?') ? '&' : '?';
  let cues = [];
  // YouTube sometimes answers 429 (or 403) instead of the caption body. That is
  // a refusal to serve, not an empty track, and the UI should say so.
  let blockedStatus = 0;
  try {
    const jsonResponse = await fetchImpl(`${base}${separator}fmt=json3`, { headers: CAPTION_HEADERS });
    if (jsonResponse && jsonResponse.ok) cues = parseTimedTextJson(await jsonResponse.text());
    else if (jsonResponse) blockedStatus = Number(jsonResponse.status) || -1;
    if (!cues.length) {
      const xmlResponse = await fetchImpl(base, { headers: CAPTION_HEADERS });
      if (xmlResponse && xmlResponse.ok) cues = parseTimedTextXml(await xmlResponse.text());
      else if (xmlResponse && !blockedStatus) blockedStatus = Number(xmlResponse.status) || -1;
    }
  } catch (error) {
    return {
      ok: false,
      error: 'fetchFailed',
      title: page?.title || '',
      message: String(error?.message || error)
    };
  }
  if (!cues.length && blockedStatus) {
    return {
      ok: false,
      error: 'captionsBlocked',
      title: page?.title || '',
      message: blockedStatus > 0 ? `HTTP ${blockedStatus}` : 'the request was refused'
    };
  }
  if (!cues.length) {
    return {
      ok: false,
      error: 'noCues',
      title: page?.title || '',
      message: 'the caption track was empty'
    };
  }
  const result = {
    title: page?.title || '',
    author: page?.author || '',
    url: page?.url || '',
    tracks: dedupeTracks(tracks),
    selected: {
      languageCode: track.languageCode,
      label: track.label,
      kind: track.kind
    },
    cues
  };
  result.text = transcriptText(result);
  return { ok: true, ...result };
}

async function fetchTranscript(videoId, preferredLang, fetchImpl = globalThis.fetch) {
  const page = await fetchCaptionPage(videoId, fetchImpl);
  return fetchTranscriptFor(page, preferredLang, fetchImpl);
}

module.exports = {
  VIDEO_ID,
  balancedSlice,
  parseWatchPage,
  parseCaptionTracksFromHtml,
  pickCaptionTrack,
  dedupeTracks,
  parseTimedTextJson,
  parseTimedTextXml,
  parseTimestamp,
  groupCuesBySentence,
  cuesFromDom,
  cuesFromTranscriptJson,
  formatStamp,
  transcriptText,
  transcriptHtml,
  fetchCaptionPage,
  fetchTranscriptFor,
  fetchTranscript
};
