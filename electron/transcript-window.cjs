'use strict';

// Some YouTube sessions return empty timedtext bodies even with a valid signed
// URL (the exp=xpe / PO-token experiment). The transcript panel in the watch
// page still asks YouTube with the session's own credentials, so the last-resort
// path is a hidden Chromium window: call the page's get_transcript endpoint with
// its context, and if that is refused, click "Show transcript" and read the
// rendered segment list. It never touches the app's renderer and is destroyed
// after one request.

const { BrowserWindow, session } = require('electron');
const transcript = require('./transcript.cjs');

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const PARTITION = 'studyos-youtube-transcript';
const SEGMENT_SELECTOR = 'ytd-transcript-segment-renderer, yt-transcript-segment-renderer';

const PAGE_SCRIPT = String.raw`(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const textOf = (el) => clean((el && (el.getAttribute('aria-label') || el.textContent)) || '');
  const findEndpoint = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 40) return null;
    if (node.getTranscriptEndpoint && node.getTranscriptEndpoint.params) return node.getTranscriptEndpoint;
    for (const key of Object.keys(node)) {
      const found = findEndpoint(node[key], depth + 1);
      if (found) return found;
    }
    return null;
  };

  const title = clean(document.title).replace(/\s*-\s*YouTube$/, '');
  const lang = document.documentElement.lang || '';
  const cfg = window.ytcfg;
  const endpoint = findEndpoint(window.ytInitialData, 0);
  const apiKey = cfg && cfg.get ? cfg.get('INNERTUBE_API_KEY') : '';
  const context = cfg && cfg.get ? cfg.get('INNERTUBE_CONTEXT') : null;
  if (endpoint && apiKey && context) {
    try {
      const response = await fetch('/youtubei/v1/get_transcript?key=' + encodeURIComponent(apiKey) + '&prettyPrint=false', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ context, params: endpoint.params })
      });
      const text = await response.text();
      if (response.ok && text.indexOf('transcriptSegmentRenderer') >= 0) {
        return { title, lang, apiText: text };
      }
    } catch (error) {
      // Fall through to the rendered panel.
    }
  }

  window.scrollTo(0, 560);
  await wait(700);
  const findButton = () => Array.from(document.querySelectorAll('button, tp-yt-paper-button, ytd-button-renderer')).find((el) => {
    const label = textOf(el);
    return /transcript/i.test(label) && !/search/i.test(label);
  });

  for (let i = 0; i < 8 && !findButton(); i++) {
    const expand = document.querySelector('ytd-text-inline-expander #expand, #expand, tp-yt-paper-button#expand');
    if (expand) {
      try { expand.click(); } catch (error) {}
    }
    window.scrollTo(0, 520);
    await wait(500);
  }

  const button = findButton();
  if (!button) return { title, lang, error: 'noTranscriptButton' };
  try { button.click(); } catch (error) {}

  let segments = [];
  for (let i = 0; i < 64; i++) {
    segments = Array.from(document.querySelectorAll('ytd-transcript-segment-renderer, yt-transcript-segment-renderer'));
    if (segments.length) break;
    await wait(250);
  }
  if (!segments.length) return { title, lang, error: 'noSegments' };

  const read = () => Array.from(document.querySelectorAll('ytd-transcript-segment-renderer, yt-transcript-segment-renderer'))
    .map((el) => {
      const time = el.querySelector('.segment-timestamp, #segment-timestamp');
      const body = el.querySelector('.segment-text, #segment-text');
      return { timestamp: clean((time && time.textContent) || ''), text: clean((body && body.textContent) || '') };
    })
    .filter((row) => row.text);

  let all = read();
  const scroller = document.querySelector('#segments-container')
    || document.querySelector('ytd-transcript-segment-list-renderer')
    || document.querySelector('ytd-transcript-renderer');
  if (scroller) {
    let previous = -1;
    for (let i = 0; i < 20; i++) {
      scroller.scrollTop = scroller.scrollHeight;
      await wait(300);
      const next = read();
      const seen = new Set(all.map((row) => row.timestamp + '|' + row.text));
      let added = 0;
      for (const row of next) {
        const key = row.timestamp + '|' + row.text;
        if (!seen.has(key)) {
          seen.add(key);
          all.push(row);
          added++;
        }
      }
      if (!added && all.length === previous) break;
      previous = all.length;
    }
  }
  return { title, lang, domCues: all };
})()`;

let transcriptSession = null;

function pageSession() {
  if (!transcriptSession) transcriptSession = session.fromPartition(PARTITION);
  return transcriptSession;
}

async function setConsentCookies(ses) {
  for (const [name, value] of [['CONSENT', 'YES+cb'], ['SOCS', 'CAI']]) {
    try {
      await ses.cookies.set({
        url: 'https://www.youtube.com',
        name,
        value,
        domain: '.youtube.com',
        path: '/',
        secure: true,
        sameSite: 'no_restriction'
      });
    } catch {
      // A failed consent cookie is not fatal; the page may still render.
    }
  }
}

function tidyTitle(title) {
  return String(title || '').replace(/\s*-\s*YouTube\s*$/i, '').trim();
}

function buildResult({ cues, title, lang, videoId }) {
  if (!cues.length) return null;
  const result = {
    title: tidyTitle(title) || 'YouTube',
    url: `https://www.youtube.com/watch?v=${videoId}`,
    tracks: [],
    selected: { languageCode: String(lang || ''), label: 'YouTube', kind: 'manual' },
    cues
  };
  result.text = transcript.transcriptText(result);
  return result;
}

async function fetchTranscriptFromPage(videoId, { timeoutMs = 28000 } = {}) {
  let win = null;
  let timer = null;
  try {
    const ses = pageSession();
    ses.setUserAgent(CHROME_UA);
    await setConsentCookies(ses);
    win = new BrowserWindow({
      show: false,
      width: 1440,
      height: 1000,
      backgroundColor: '#ffffff',
      webPreferences: {
        partition: PARTITION,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false
      }
    });
    win.webContents.setUserAgent(CHROME_UA);
    win.webContents.setAudioMuted(true);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-attach-webview', (event) => event.preventDefault());

    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('transcript page timed out')), timeoutMs);
    });
    const load = win
      .loadURL(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en&gl=US`)
      .catch((error) => {
        if (error && error.code !== 'ERR_ABORTED') throw error;
      });
    await Promise.race([load, timeout]);
    await new Promise((resolve) => setTimeout(resolve, 1800));

    const extracted = await Promise.race([
      win.webContents.executeJavaScript(PAGE_SCRIPT, true),
      timeout
    ]);
    if (!extracted || typeof extracted !== 'object') {
      return { ok: false, error: 'windowFailed', message: 'the transcript page returned no data' };
    }

    if (extracted.apiText) {
      const cues = transcript.cuesFromTranscriptJson(extracted.apiText);
      const fromApi = buildResult({
        cues,
        title: extracted.title,
        lang: extracted.lang,
        videoId
      });
      if (fromApi) return { ok: true, ...fromApi };
    }

    const cues = transcript.cuesFromDom(extracted.domCues);
    const fromDom = buildResult({
      cues,
      title: extracted.title,
      lang: extracted.lang,
      videoId
    });
    if (fromDom) return { ok: true, ...fromDom };

    return {
      ok: false,
      error: extracted.error === 'noTranscriptButton' ? 'noTranscriptButton' : 'noCues',
      message: extracted.error || 'the transcript panel had no readable lines'
    };
  } catch (error) {
    return { ok: false, error: 'windowFailed', message: String(error?.message || error) };
  } finally {
    if (timer) clearTimeout(timer);
    if (win && !win.isDestroyed()) win.destroy();
  }
}

module.exports = { fetchTranscriptFromPage };
