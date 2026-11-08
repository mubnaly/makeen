// YouTube links: parse a pasted URL (video, Shorts, embed, playlist, or a bare
// id) into something the Video workspace can study from, plus a lazy loader for
// the IFrame Player API (which gives us real play/seek/bookmark control).
// Parsing is pure so it can be asserted in Node (tests/youtube.test.mjs).

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const PLAYLIST_ID = /^(PL|UU|LL|FL|OLAK|RD|RDMM)[A-Za-z0-9_-]+$/;

function canonicalHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^www\./, '');
  return host === 'youtu.be'
    || host === 'youtube.com' || host.endsWith('.youtube.com')
    || host === 'youtube-nocookie.com' || host.endsWith('.youtube-nocookie.com');
}

// -> null | { type: 'video'|'playlist', id, url, embedUrl }
export function parseYouTube(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;

  const video = (id) => ({
    type: 'video',
    id,
    url: `https://www.youtube.com/watch?v=${id}`,
    embedUrl: `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1`
  });
  const playlist = (id) => ({
    type: 'playlist',
    id,
    url: `https://www.youtube.com/playlist?list=${id}`,
    embedUrl: `https://www.youtube-nocookie.com/embed?listType=playlist&list=${encodeURIComponent(id)}&rel=0`
  });

  let url = null;
  try {
    url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
  } catch {
    url = null;
  }

  if (!url || !canonicalHost(url.hostname)) {
    // A bare id pasted without any URL still works.
    if (VIDEO_ID.test(raw)) return video(raw);
    return null;
  }

  const path = url.pathname;
  const list = url.searchParams.get('list');
  const v = url.searchParams.get('v');

  // /playlist?list=… — the explicit playlist page.
  if (path.startsWith('/playlist')) {
    return list && PLAYLIST_ID.test(list) ? playlist(list) : null;
  }
  // /watch?v=… (a &list=… on a watch URL means "this video inside a playlist";
  // the pasted video is the primary intent, so it wins).
  if (v && VIDEO_ID.test(v)) return video(v);
  // /shorts/ID, /embed/ID, /live/ID, /v/ID
  const seg = path.split('/').filter(Boolean);
  if (seg.length >= 2 && ['shorts', 'embed', 'live', 'v'].includes(seg[0]) && VIDEO_ID.test(seg[1])) {
    return video(seg[1]);
  }
  // youtu.be/ID
  if (url.hostname.replace(/^www\./, '').toLowerCase() === 'youtu.be' && VIDEO_ID.test(seg[0] || '')) {
    return video(seg[0]);
  }
  // A playlist id in ?list= on any other watch-ish URL.
  if (list && PLAYLIST_ID.test(list)) return playlist(list);
  if (seg.length === 1 && VIDEO_ID.test(seg[0])) return video(seg[0]);
  return null;
}

// Stable library id for a parsed link (filesystem/bridge safe: ASCII only).
export function youtubeDocId(parsed) {
  if (!parsed) return '';
  return `yt-${parsed.type === 'playlist' ? 'list' : 'video'}-${parsed.id}`;
}

// --- IFrame Player API ------------------------------------------------------

let apiPromise = null;

export function loadYouTubeApi({ timeoutMs = 12000 } = {}) {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.YT && typeof window.YT.Player === 'function') return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;

  apiPromise = new Promise((resolve, reject) => {
    const done = () => {
      if (window.YT && typeof window.YT.Player === 'function') resolve(window.YT);
      else reject(new Error('YouTube API unavailable'));
    };
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof previous === 'function') previous();
      done();
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => { apiPromise = null; reject(new Error('YouTube API failed to load')); };
    document.head.appendChild(script);
    setTimeout(() => { if (!window.YT) { apiPromise = null; reject(new Error('YouTube API timed out')); } }, timeoutMs);
  });
  return apiPromise;
}

// --- player quality ---------------------------------------------------------

// The IFrame API reports quality levels as these constants. A level YouTube has
// not offered for the current video or size is simply absent from
// getAvailableQualityLevels(); the select is built from that list.
const QUALITY_LABELS = {
  highres: '4K+',
  hd2160: '2160p',
  hd1440: '1440p',
  hd1080: '1080p',
  hd720: '720p',
  large: '480p',
  medium: '360p',
  small: '240p',
  tiny: '144p'
};

export function qualityLabel(level) {
  const key = String(level || '').trim().toLowerCase();
  return QUALITY_LABELS[key] || String(level || '').trim();
}

// Keep only levels the API can actually request, in YouTube's order, without
// duplicates. 'auto' is added by the UI itself, not by this list.
export function normalizeQualities(levels) {
  const allowed = new Set(Object.keys(QUALITY_LABELS));
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(levels) ? levels : []) {
    const level = String(raw || '').trim().toLowerCase();
    if (!allowed.has(level) || seen.has(level)) continue;
    seen.add(level);
    out.push(level);
  }
  return out;
}

// Index of the caption currently being spoken, or -1 in a gap. Binary search
// keeps a two-hour transcript responsive while the player ticks four times a
// second. The cue list is expected to be sorted by start time (the extractor
// sorts it before handing it over).
export function activeCueAt(cues, seconds) {
  if (!Array.isArray(cues) || cues.length === 0) return -1;
  const at = Number(seconds);
  if (!Number.isFinite(at) || at < 0) return -1;
  let low = 0;
  let high = cues.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const start = Number(cues[mid]?.start);
    if (!Number.isFinite(start)) {
      low = mid + 1;
      continue;
    }
    if (start <= at) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  if (found < 0) return -1;
  const cue = cues[found];
  const start = Number(cue.start);
  const duration = Number(cue.duration);
  if (Number.isFinite(duration) && duration > 0 && at >= start + duration) return -1;
  return found;
}

/**
 * Scrape playlist video links, titles, and thumbnails
 * Uses Desktop bridge, Vite dev API, or direct fetch.
 */
export async function fetchPlaylistScrape(playlistUrl) {
  const url = String(playlistUrl || '').trim();
  if (!url) return { ok: false, error: 'emptyUrl' };

  // 1. Desktop Electron Bridge
  const bridge = typeof window !== 'undefined' ? (window.makeen || window.studyos) : null;
  if (bridge?.youtubePlaylist) {
    try {
      const res = await bridge.youtubePlaylist({ url });
      if (res && res.ok && Array.isArray(res.videos) && res.videos.length > 0) {
        return res;
      }
    } catch (e) {
      console.warn('Bridge playlist scrape failed, falling back:', e);
    }
  }

  // 2. Vite media server endpoint
  try {
    const res = await fetch(`/api/playlist?url=${encodeURIComponent(url)}`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.ok && Array.isArray(data.videos) && data.videos.length > 0) {
        return data;
      }
    }
  } catch {}

  // 3. Direct HTML extraction fallback
  try {
    let cleanUrl = url;
    let listId = '';
    try {
      const parsed = new URL(url.startsWith('http') ? url : `https://www.youtube.com/${url}`);
      listId = parsed.searchParams.get('list') || '';
    } catch {}

    if (listId) {
      cleanUrl = `https://www.youtube.com/playlist?list=${listId}`;
    } else if (!cleanUrl.startsWith('http')) {
      cleanUrl = `https://www.youtube.com/playlist?list=${cleanUrl}`;
    }

    const res = await fetch(cleanUrl);
    if (!res.ok) return { ok: false, error: 'fetchFailed', status: res.status };
    const html = await res.text();
    const marker = 'var ytInitialData = ';
    const idx = html.indexOf(marker);
    if (idx === -1) return { ok: false, error: 'noData' };
    const start = idx + marker.length;
    let depth = 0, end = start;
    for (let i = start; i < html.length; i++) {
      if (html[i] === '{') depth++;
      else if (html[i] === '}') {
        depth--;
        if (depth === 0) { end = i + 1; break; }
      }
    }
    const data = JSON.parse(html.slice(start, end));
    const title = data.metadata?.playlistMetadataRenderer?.title ||
                  data.header?.pageHeaderRenderer?.content?.pageHeaderViewModel?.title?.dynamicTextViewModel?.text?.content ||
                  'قائمة تشغيل';

    const videos = [];
    const seen = new Set();
    function walk(node) {
      if (!node || typeof node !== 'object') return;
      if (node.playlistVideoRenderer) {
        const p = node.playlistVideoRenderer;
        if (p.videoId && !seen.has(p.videoId)) {
          seen.add(p.videoId);
          const vTitle = p.title?.runs?.[0]?.text || p.title?.simpleText || 'فيديو';
          const thumb = p.thumbnail?.thumbnails?.slice(-1)[0]?.url || `https://i.ytimg.com/vi/${p.videoId}/hqdefault.jpg`;
          videos.push({
            id: p.videoId,
            title: vTitle,
            url: `https://www.youtube.com/watch?v=${p.videoId}`,
            thumbnail: thumb
          });
        }
        return;
      }
      if (node.lockupViewModel) {
        const l = node.lockupViewModel;
        const vId = l.rendererContext?.commandContext?.onTap?.innertubeCommand?.watchEndpoint?.videoId;
        const vTitle = l.metadata?.lockupMetadataViewModel?.title?.content;
        if (vId && vTitle && !seen.has(vId)) {
          seen.add(vId);
          const thumb = l.contentImage?.thumbnailViewModel?.image?.sources?.slice(-1)[0]?.url || `https://i.ytimg.com/vi/${vId}/hqdefault.jpg`;
          videos.push({
            id: vId,
            title: vTitle,
            url: `https://www.youtube.com/watch?v=${vId}`,
            thumbnail: thumb
          });
        }
        return;
      }
      for (const k of Object.keys(node)) {
        walk(node[k]);
      }
    }
    walk(data);

    if (!videos.length) return { ok: false, error: 'noVideosFound' };
    return {
      ok: true,
      title,
      thumbnail: videos[0]?.thumbnail || '',
      count: videos.length,
      videos
    };
  } catch (err) {
    return { ok: false, error: 'scrapeFailed', message: String(err?.message || err) };
  }
}
