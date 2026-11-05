import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const transcript = require('../electron/transcript.cjs');

const ID = 'dQw4w9WgXcQ';
const TRACKS = [
  {
    baseUrl: `https://www.youtube.com/api/timedtext?v=${ID}&lang=ar&kind=asr&fmt=srv3`,
    languageCode: 'ar',
    kind: 'asr',
    name: { simpleText: 'العربية (تلقائي)' }
  },
  {
    baseUrl: `https://www.youtube.com/api/timedtext?v=${ID}&lang=en`,
    languageCode: 'en',
    name: { runs: [{ text: 'English' }] }
  },
  {
    baseUrl: `https://www.youtube.com/api/timedtext?v=${ID}&lang=ar`,
    languageCode: 'ar',
    name: { simpleText: 'العربية' }
  }
];

const PLAYER = {
  videoDetails: { title: 'درس الرياضيات & الجبر', author: 'قناة الدراسة' },
  playabilityStatus: { status: 'OK', reason: 'OK' },
  captions: { playerCaptionsTracklistRenderer: { captionTracks: TRACKS } }
};

const WATCH_HTML = `<!doctype html><html><head><title>Fallback title - YouTube</title></head><body>
<script>var ytInitialPlayerResponse = ${JSON.stringify(PLAYER)};</script>
</body></html>`;

const JSON3 = JSON.stringify({
  events: [
    { tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: 'Hello ' }, { utf8: 'world' }] },
    { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'First' }] },
    { tStartMs: 3000, dDurationMs: 1000, segs: [{ utf8: '\u200b' }] }
  ]
});

const XML = `<transcript>
<text start="0" dur="1.5">Hello &amp; <br/>welcome</text>
<text start="2">Second &lt;line&gt;</text>
</transcript>`;

function fakeFetch({ html = WATCH_HTML, json = JSON3, xml = XML, ok = true, status = 200 } = {}) {
  const calls = [];
  const fn = async (url) => {
    const href = String(url);
    calls.push(href);
    if (href.includes('/watch?')) return { ok, status, text: async () => html };
    if (href.includes('fmt=json3')) return { ok: true, status: 200, text: async () => json };
    return { ok: true, status: 200, text: async () => xml };
  };
  fn.calls = calls;
  return fn;
}

// --- extraction -------------------------------------------------------------

test('balancedSlice stops at the matching brace even inside JSON strings', () => {
  const json = String.raw`{"a":"}","b":{"c":"say \"hi}\""}}`;
  const slice = transcript.balancedSlice(json, 0, '{', '}');
  assert.equal(slice, json);
  assert.equal(JSON.parse(slice).a, '}');
  assert.equal(JSON.parse(slice).b.c, 'say "hi}"');
  assert.equal(transcript.balancedSlice('no object here', 0, '{', '}'), '');
});

test('caption tracks are read from ytInitialPlayerResponse', () => {
  const tracks = transcript.parseCaptionTracksFromHtml(WATCH_HTML);
  assert.equal(tracks.length, 3);
  assert.deepEqual(
    tracks.map((t) => [t.languageCode, t.kind, t.label]),
    [['ar', 'asr', 'العربية (تلقائي)'], ['en', 'manual', 'English'], ['ar', 'manual', 'العربية']]
  );
  assert.ok(tracks[0].baseUrl.includes('lang=ar'));
});

test('caption tracks also survive a bare captionTracks array fallback', () => {
  const html = `<script>window.x = {"captionTracks":${JSON.stringify([
    { baseUrl: 'https://example.test/captions?lang=fr&amp;x=1', languageCode: 'fr', name: { simpleText: 'Français' } }
  ])},"other":true}</script>`;
  const tracks = transcript.parseCaptionTracksFromHtml(html);
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].languageCode, 'fr');
  assert.equal(tracks[0].label, 'Français');
  assert.ok(tracks[0].baseUrl.includes('&x=1'), 'HTML entities in the signed URL are decoded');
});

test('watch page metadata is parsed and playability reasons are kept', () => {
  const page = transcript.parseWatchPage(WATCH_HTML);
  assert.equal(page.title, 'درس الرياضيات & الجبر');
  assert.equal(page.author, 'قناة الدراسة');
  assert.equal(page.reason, 'OK');
  assert.equal(page.tracks.length, 3);
  assert.equal(transcript.parseWatchPage('<title>No captions - YouTube</title>').title, 'No captions');
});

// --- language choice --------------------------------------------------------

test('the requested language wins and a human track beats an auto one', () => {
  const tracks = transcript.parseCaptionTracksFromHtml(WATCH_HTML);
  assert.equal(transcript.pickCaptionTrack(tracks, 'ar').kind, 'manual');
  assert.equal(transcript.pickCaptionTrack(tracks, 'AR').languageCode, 'ar');
  assert.equal(transcript.pickCaptionTrack(tracks, 'en-GB').languageCode, 'en');
  assert.equal(transcript.pickCaptionTrack(tracks, 'fr').languageCode, 'en');
  assert.equal(transcript.pickCaptionTrack([], 'en'), null);

  const deduped = transcript.dedupeTracks(tracks);
  assert.equal(deduped.filter((t) => t.languageCode === 'ar').length, 1);
  assert.equal(deduped.find((t) => t.languageCode === 'ar').kind, 'manual');
  assert.ok(!('baseUrl' in deduped[0]), 'signed URLs never leave the main process');
});

// --- cue parsing ------------------------------------------------------------

test('json3 cues are joined, cleaned, sorted and timed', () => {
  const cues = transcript.parseTimedTextJson(JSON3);
  assert.deepEqual(cues, [
    { start: 0, duration: 1, text: 'First' },
    { start: 1, duration: 2, text: 'Hello world' }
  ]);
  assert.deepEqual(transcript.parseTimedTextJson('not json'), []);
  assert.deepEqual(transcript.parseTimedTextJson('{"events":[]}'), []);
});

test('xml cues decode entities and fill a missing duration from the next cue', () => {
  const cues = transcript.parseTimedTextXml(XML);
  assert.equal(cues[0].start, 0);
  assert.equal(cues[0].duration, 1.5);
  assert.equal(cues[0].text, 'Hello &\nwelcome');
  assert.equal(cues[1].start, 2);
  assert.equal(cues[1].text, 'Second <line>');
  assert.equal(transcript.parseTimedTextXml('<transcript></transcript>').length, 0);
});

test('a missing duration is derived from the next cue', () => {
  const cues = transcript.parseTimedTextXml('<text start="5">A</text><text start="8" dur="2">B</text>');
  assert.equal(cues[0].duration, 3);
  assert.equal(cues[1].duration, 2);
});

test('captions scraped from the transcript panel get timings and durations', () => {
  assert.equal(transcript.parseTimestamp('0:05'), 5);
  assert.equal(transcript.parseTimestamp('1:02:05'), 3725);
  assert.equal(transcript.parseTimestamp('65.2'), 65.2);
  assert.ok(Number.isNaN(transcript.parseTimestamp('soon')));
  const cues = transcript.cuesFromDom([
    { timestamp: '1:10', text: ' second ' },
    { timestamp: '1:05', text: 'first' },
    { timestamp: 'bad', text: 'skipped' },
    { timestamp: '2:00', text: '' }
  ]);
  assert.deepEqual(cues.map((c) => [c.start, c.duration, c.text]), [
    [65, 5, 'first'],
    [70, 0, 'second']
  ]);
});

test('get_transcript JSON segments are found regardless of nesting', () => {
  const json = {
    actions: [{ appendContinuationItemsAction: { continuationItems: [{ transcriptSegmentRenderer: {
      startTimeText: { simpleText: '0:07' },
      snippet: { runs: [{ text: 'Hello ' }, { text: 'there' }] }
    } }] } }],
    other: { deeply: { nested: { transcriptSegmentRenderer: {
      startTimeText: { runs: [{ text: '1:05' }] },
      snippet: { simpleText: 'Second line' }
    } } } }
  };
  const cues = transcript.cuesFromTranscriptJson(JSON.stringify(json));
  assert.deepEqual(cues.map((c) => [c.start, c.duration, c.text]), [
    [7, 58, 'Hello there'],
    [65, 0, 'Second line']
  ]);
  assert.deepEqual(transcript.cuesFromTranscriptJson('not json'), []);
  assert.deepEqual(transcript.cuesFromTranscriptJson({}), []);
});

// --- text and PDF -----------------------------------------------------------

test('plain text keeps a header and timestamps', () => {
  const text = transcript.transcriptText({
    title: 'Lecture',
    url: 'https://youtu.be/x',
    cues: [{ start: 65, text: 'A point' }, { start: 3725, text: 'An hour later' }]
  });
  assert.match(text, /^Lecture\nhttps:\/\/youtu\.be\/x\n2 captions\n\n/);
  assert.match(text, /\[1:05\] A point/);
  assert.match(text, /\[1:02:05\] An hour later/);
  assert.ok(text.endsWith('\n'));
  assert.equal(transcript.formatStamp(0), '0:00');
  assert.equal(transcript.formatStamp(65), '1:05');
});

test('PDF HTML is escaped, print-sized and RTL for Arabic captions', () => {
  const html = transcript.transcriptHtml({
    title: '<Transcript> & "quotes"',
    url: 'https://www.youtube.com/watch?v=x&t=1',
    lang: 'ar',
    cues: [
      { start: 0, text: 'مرحبا <script>alert(1)</script>' },
      { start: 65, text: 'Hello & goodbye' }
    ]
  });
  assert.match(html, /<html lang="ar" dir="rtl">/);
  assert.match(html, /@page \{ size: A4;/);
  assert.ok(html.includes('1:05'));
  assert.ok(html.includes('مرحبا &lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;Transcript&gt; &amp; &quot;quotes&quot;'));
  assert.ok(html.includes('https://www.youtube.com/watch?v=x&amp;t=1'));

  const english = transcript.transcriptHtml({ title: 'Hello', lang: 'en', cues: [{ start: 0, text: 'Hi' }] });
  assert.match(english, /dir="ltr"/);
  assert.ok(english.includes('1 caption'));
});

// --- fetching ---------------------------------------------------------------

test('fetchCaptionPage parses a watch page and records its public URL', async () => {
  const fetchImpl = fakeFetch();
  const page = await transcript.fetchCaptionPage(ID, fetchImpl);
  assert.equal(page.title, 'درس الرياضيات & الجبر');
  assert.equal(page.url, `https://www.youtube.com/watch?v=${ID}`);
  assert.equal(page.tracks.length, 3);
  assert.ok(fetchImpl.calls[0].includes(`v=${ID}`));
  await assert.rejects(() => transcript.fetchCaptionPage('short', fetchImpl), /invalid video id/);
});

test('fetchTranscriptFor picks a track, requests json3 and returns cues', async () => {
  const fetchImpl = fakeFetch();
  const page = await transcript.fetchCaptionPage(ID, fetchImpl);
  const result = await transcript.fetchTranscriptFor(page, 'ar', fetchImpl);
  assert.equal(result.ok, true);
  assert.equal(result.selected.languageCode, 'ar');
  assert.equal(result.selected.kind, 'manual');
  assert.equal(result.cues.length, 2);
  assert.ok(result.text.startsWith('درس الرياضيات'));
  assert.ok(result.text.includes(result.url));
  assert.ok(result.url.includes(`v=${ID}`));
  const captionCall = fetchImpl.calls.find((url) => url.includes('timedtext'));
  assert.ok(captionCall.includes('fmt=json3'));
  assert.ok(!captionCall.includes('fmt=srv3'), 'the old fmt parameter is replaced');
});

test('a video without captions reports that honestly', async () => {
  const noCaptions = `<!doctype html><html><head><title>Still a title - YouTube</title></head><body>
<script>var ytInitialPlayerResponse = ${JSON.stringify({
    videoDetails: { title: 'درس بلا ترجمة', author: 'قناة' },
    playabilityStatus: { status: 'OK' }
  })};</script></body></html>`;
  const fetchImpl = fakeFetch({ html: noCaptions });
  const page = await transcript.fetchCaptionPage(ID, fetchImpl);
  assert.equal(page.tracks.length, 0);
  const result = await transcript.fetchTranscriptFor(page, 'en', fetchImpl);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'noCaptions');
  assert.equal(result.title, 'درس بلا ترجمة');
});

test('an HTTP failure and an empty caption track are surfaced, not thrown', async () => {
  await assert.rejects(() => transcript.fetchCaptionPage(ID, fakeFetch({ ok: false, status: 403 })), /403/);

  const page = await transcript.fetchCaptionPage(ID, fakeFetch());
  const empty = await transcript.fetchTranscriptFor(page, 'en', fakeFetch({ json: '{"events":[]}', xml: '<transcript></transcript>' }));
  assert.equal(empty.ok, false);
  assert.equal(empty.error, 'noCues');
});

test('a refused caption download reports the status instead of an empty video', async () => {
  const page = await transcript.fetchCaptionPage(ID, fakeFetch());
  const refused = async () => ({ ok: false, status: 429, text: async () => '<html>Sorry...</html>' });
  const result = await transcript.fetchTranscriptFor(page, 'en', refused);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'captionsBlocked');
  assert.equal(result.message, 'HTTP 429');
  assert.equal(result.title, 'درس الرياضيات & الجبر');
});

test('fetchTranscript composes the whole flow', async () => {
  const result = await transcript.fetchTranscript(ID, 'en', fakeFetch());
  assert.equal(result.ok, true);
  assert.equal(result.selected.languageCode, 'en');
  assert.equal(result.cues[1].text, 'Hello world');
});

test('groupCuesBySentence merges fragmented phrases into complete sentences', () => {
  const cues = [
    { start: 0, duration: 1, text: 'This is the' },
    { start: 1, duration: 1, text: 'first sentence.' },
    { start: 2.5, duration: 1, text: 'Here is sentence number' },
    { start: 3.5, duration: 1, text: 'two!' }
  ];
  const sentences = transcript.groupCuesBySentence(cues);
  assert.equal(sentences.length, 2);
  assert.equal(sentences[0].text, 'This is the first sentence.');
  assert.equal(sentences[0].start, 0);
  assert.equal(sentences[1].text, 'Here is sentence number two!');
  assert.equal(sentences[1].start, 2.5);
});
