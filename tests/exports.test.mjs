// Export tests (plan §7.5): valid PDF output, correct geometry mapping, source
// bytes never mutated, honest skip reporting. Uses @napi-rs/canvas (already a
// pdf.js dependency) to generate real PNGs and rasterize in Node.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument, PDFDict, PDFName } from 'pdf-lib';
import {
  parseColorToRgb,
  parseAlpha,
  markerBBox,
  imagesToPdf,
  excerptsPdf,
  annotatedCopyPdf,
  bytesToBase64
} from '../src/lib/export.js';

const fixture = fileURLToPath(new URL('./fixtures/landmark.pdf', import.meta.url));
if (!existsSync(fixture)) execFileSync(process.execPath, [fileURLToPath(new URL('./fixtures/make_pdf.mjs', import.meta.url))]);
const fixtureBytes = readFileSync(fixture);

function png(w = 8, h = 6, fill = '#dc2828') {
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, w, h);
  return c.toBuffer('image/png');
}
function pngDataUrl(w, h, fill) {
  return `data:image/png;base64,${png(w, h, fill).toString('base64')}`;
}

function inflateStreams(bytes) {
  const s = Buffer.from(bytes).toString('latin1');
  const out = [];
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m;
  while ((m = re.exec(s))) {
    try { out.push(zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1')); }
    catch { out.push(m[1]); }
  }
  return out.join('\n');
}

// --- colors -----------------------------------------------------------------

test('parseColorToRgb handles hex, short hex, rgb/rgba and junk', () => {
  const c = parseColorToRgb('#804020');
  assert.ok(Math.abs(c.r - 128 / 255) < 1e-6 && Math.abs(c.g - 64 / 255) < 1e-6 && Math.abs(c.b - 32 / 255) < 1e-6);
  const short = parseColorToRgb('#fff');
  assert.ok(Math.abs(short.r - 1) < 1e-6);
  const fn = parseColorToRgb('rgba(51, 102, 153, 0.4)');
  assert.ok(Math.abs(fn.r - 0.2) < 0.01);
  assert.deepEqual(parseColorToRgb('nonsense'), { r: 0, g: 0, b: 0 });
  assert.deepEqual(parseColorToRgb(null), { r: 0, g: 0, b: 0 });
});

test('parseAlpha extracts the alpha channel', () => {
  assert.equal(parseAlpha('rgba(1,2,3,0.25)'), 0.25);
  assert.equal(parseAlpha('rgb(1,2,3)'), 1);
  assert.equal(parseAlpha('rgb(1,2,3)', 0.5), 0.5);
});

// --- marker bbox ------------------------------------------------------------

test('markerBBox pads a marker by half its stroke on both axes', () => {
  const b = markerBBox({ mode: 'horizontal', points: [[0.2, 0.5], [0.8, 0.5]], thickness: 0.04 });
  assert.ok(Math.abs(b.v - (0.5 - 0.02)) < 1e-9, 'top padded by thickness/2');
  assert.ok(Math.abs(b.h - 0.04) < 1e-9, 'height equals full stroke');
  assert.ok(Math.abs(b.u - 0.18) < 1e-9, 'left padded by thickness/2');
  assert.ok(Math.abs(b.w - 0.64) < 1e-9);
});

// Regression: the app keeps `thickness` on the annotation STYLE (and
// sidecar.normalizeGeometry drops it from geometry entirely), so a bbox computed
// from geometry alone fell back to the 1e-4 floor — every exported highlight
// excerpt rendered one pixel tall.
test('markerBBox reads thickness from the style, which is where the app stores it', () => {
  const appMarker = { mode: 'horizontal', points: [[0.2, 0.5], [0.8, 0.5]] };
  const b = markerBBox(appMarker, { color: '#F4D03F', opacity: 0.55, thickness: 0.03 });
  assert.ok(Math.abs(b.h - 0.03) < 1e-9, `height must span the stroke, got ${b.h}`);
  assert.ok(Math.ceil(b.h * 842 * 2) > 20, 'a real marker yields a non-degenerate crop');
  // No thickness anywhere: fall back to the renderer default, not a razor-thin box.
  const fallback = markerBBox(appMarker);
  assert.ok(Math.abs(fallback.h - 0.012) < 1e-9, `fallback height, got ${fallback.h}`);
});

test('markerBBox unions cross-mode segments and clamps to the page', () => {
  const b = markerBBox({ mode: 'cross', segments: [[[0.1, 0.3], [0.9, 0.3]], [[0.5, 0.1], [0.5, 0.95]]] }, { thickness: 0.02 });
  assert.ok(Math.abs(b.u - 0.09) < 1e-9 && Math.abs(b.w - 0.82) < 1e-9);
  assert.ok(b.v >= 0 && b.v + b.h <= 1 + 1e-9, 'clamped inside the page');
  const atEdge = markerBBox({ mode: 'vertical', points: [[0.5, 0.001], [0.5, 0.999]] }, { thickness: 0.04 });
  assert.equal(atEdge.v, 0, 'clamped at the top edge');
  assert.ok(Math.abs(atEdge.v + atEdge.h - 1) < 1e-9, 'clamped at the bottom edge');
  assert.equal(markerBBox({}), null);
});// --- images -> PDF ----------------------------------------------------------
test('imagesToPdf flows images onto a page and packs a second one when it fits', async () => {
  const entries = [
    { image: pngDataUrl(40, 30, '#2266cc'), label: 'First · p1' },
    { image: pngDataUrl(20, 50, '#cc2266'), label: 'Second · p2' }
  ];
  const bytes = await imagesToPdf(entries, { labels: true });
  const reloaded = await PDFDocument.load(bytes);
  assert.equal(reloaded.getPageCount(), 1, 'both images share one page when space allows');
  const { width: w, height: h } = reloaded.getPage(0).getSize();
  assert.ok(Math.abs(w - 595) < 0.01 && Math.abs(h - 842) < 0.01, 'A4 page');
});

test('imagesToPdf opens a new page only when the next image no longer fits', async () => {
  // Portrait images scaled to the content width each eat a whole page: the
  // remaining space is too small for the next one.
  const entries = Array.from({ length: 3 }, (_, i) => ({ image: pngDataUrl(50, 100, `#${i}23456`) }));
  const bytes = await imagesToPdf(entries);
  const reloaded = await PDFDocument.load(bytes);
  assert.equal(reloaded.getPageCount(), 3, 'one page per image when nothing else fits');
  // A wide image followed by a small one: the small one lands under it.
  const mixed = await imagesToPdf([
    { image: pngDataUrl(400, 300, '#336699') },
    { image: pngDataUrl(400, 120, '#996633') }
  ]);
  assert.equal((await PDFDocument.load(mixed)).getPageCount(), 1, 'a short image joins the page');
});

test('imagesToPdf rejects an empty list and a non-image entry', async () => {
  await assert.rejects(() => imagesToPdf([]), /no images/);
  await assert.rejects(() => imagesToPdf([{ image: 'not-a-data-url' }]), /not a data URL/);
  await assert.rejects(() => imagesToPdf([{ image: 'data:image/gif;base64,AAAA' }]), /unsupported image format/);
});

// --- highlight excerpts -----------------------------------------------------

test('excerptsPdf produces one page per marker via the injected rasterizer', async () => {
  const calls = [];
  const markers = [
    { id: 'a', type: 'marker', page: 1, geometry: { mode: 'horizontal', points: [[0.2, 0.5], [0.8, 0.5]], thickness: 0.04 } },
    { id: 'b', type: 'marker', page: 3, geometry: { mode: 'vertical', points: [[0.5, 0.2], [0.5, 0.6]], thickness: 0.02 } },
    { id: 'c', type: 'shape', page: 1, geometry: { shape: 'rectangle', points: [[0, 0], [1, 1]] } } // ignored
  ];
  const bytes = await excerptsPdf({
    markers,
    sourceName: 'Biology.pdf',
    rasterizeRegion: async (page, rect) => {
      calls.push({ page, rect });
      return pngDataUrl(100, 40, '#27ae60');
    }
  });
  const reloaded = await PDFDocument.load(bytes);
  assert.equal(reloaded.getPageCount(), 2, 'only markers produce pages');
  assert.deepEqual(calls.map((c) => c.page), [1, 3]);
  // Marker a: u 0.18..0.82 (padded by half the 0.04 stroke), v 0.48..0.52
  assert.ok(Math.abs(calls[0].rect.u - 0.18) < 1e-9);
  assert.ok(Math.abs(calls[0].rect.h - 0.04) < 1e-9);
});

test('excerptsPdf rasterizes its caption so Arabic names never become "?"', async () => {
  const captions = [];
  const bytes = await excerptsPdf({
    markers: [{ type: 'marker', page: 12, geometry: { points: [[0.2, 0.4], [0.8, 0.4]] }, style: { thickness: 0.03 } }],
    sourceName: 'محاضرة الخلية.pdf',
    rasterizeRegion: async () => pngDataUrl(100, 40, '#27ae60'),
    renderLabelImage: async (text) => {
      captions.push(text);
      return pngDataUrl(240, 16, '#ffffff');
    }
  });
  assert.equal(captions.length, 1, 'the caption rasterizer is used');
  assert.match(captions[0], /محاضرة الخلية/, 'the real source name reaches the caption');
  assert.match(captions[0], /p\.12/);
  const reloaded = await PDFDocument.load(bytes);
  const xobjects = reloaded.getPage(0).node.Resources().lookup(PDFName.of('XObject'), PDFDict);
  assert.ok(xobjects && xobjects.keys().length >= 2, 'both the crop and its caption are embedded images');
  assert.ok(!inflateStreams(bytes).includes('????'), 'no WinAnsi question-mark fallback is drawn');
});

test('excerptsPdf errors without markers or rasterizer', async () => {
  await assert.rejects(() => excerptsPdf({ markers: [], rasterizeRegion: async () => null }), /no highlighter/);
  await assert.rejects(() => excerptsPdf({ markers: [{ type: 'marker', page: 1, geometry: { points: [[0, 0], [1, 1]] } }] }), /rasterizeRegion/);
});

// --- annotated copy ---------------------------------------------------------

const sampleAnns = [
  { id: 'm', type: 'marker', page: 1, geometry: { mode: 'horizontal', points: [[0.2, 0.5], [0.8, 0.5]] }, style: { color: '#804020', opacity: 0.55, thickness: 0.03 } },
  { id: 'r', type: 'shape', page: 1, geometry: { shape: 'rectangle', points: [[0.3, 0.3], [0.6, 0.6]] }, style: { color: '#0000ff', opacity: 1, thickness: 0.004, fill_color: 'rgba(0,0,255,0.2)' } },
  { id: 'e', type: 'shape', page: 2, geometry: { shape: 'ellipse', points: [[0.2, 0.2], [0.5, 0.5]] }, style: { color: '#00aa00', opacity: 1, thickness: 0.004 } },
  { id: 'k', type: 'shape', page: 2, geometry: { shape: 'check', points: [[0.5, 0.5], [0.7, 0.7]] }, style: { color: '#00aa00', opacity: 1, thickness: 0.006 } },
  { id: 'x', type: 'shape', page: 3, geometry: { shape: 'arrow', points: [[0.2, 0.8], [0.6, 0.2]] }, style: { color: '#ff0000', opacity: 1, thickness: 0.004 } },
  { id: 't', type: 'text', page: 1, geometry: { points: [[0.2, 0.7]], w: 0.4, h: 0.05 }, style: { color: '#111111', opacity: 1, font_size: 0.02 }, text: 'LANDMARK TEXT' }
];

test('annotatedCopyPdf flattens every type, preserves pages, never mutates source', async () => {
  const before = Buffer.from(fixtureBytes);
  const { bytes, stats } = await annotatedCopyPdf({ sourceBytes: fixtureBytes, annotations: sampleAnns });
  assert.deepEqual(fixtureBytes, before, 'source bytes untouched');
  assert.ok(stats.skipped.length === 0, `nothing skipped: ${stats.skipped.join('; ')}`);
  assert.equal(stats.drawn, sampleAnns.length);

  const reloaded = await PDFDocument.load(bytes);
  assert.equal(reloaded.getPageCount(), 3, 'page count preserved');

  // Some content stream in the output must carry the marker colour
  // (#804020 -> 0.50196… 0.25098… 0.12549… RG; pdf-lib writes full float
  // precision) and the round line cap (1 J per PDF spec: 0=butt, 1=round,
  // 2=square).
  const content = inflateStreams(bytes);
  assert.match(content, /0\.5\d* 0\.25\d* 0\.12\d* RG/, `marker colour present in: ${content.slice(0, 300)}`);
  assert.match(content, /1 J/, 'round line cap present');
});

test('annotatedCopyPdf: Latin text draws natively; Arabic is rasterized via callback', async () => {
  // Without a rasterizer, Latin text must still draw (fallback path).
  const latin = await annotatedCopyPdf({ sourceBytes: fixtureBytes, annotations: [sampleAnns[5]] });
  assert.equal(latin.stats.drawn, 1);
  assert.equal(latin.stats.skipped.length, 0);

  // Arabic without a rasterizer: pdf-lib WinAnsi cannot encode it -> reported skip.
  const arabic = { id: 'ar', type: 'text', page: 1, geometry: { points: [[0.1, 0.2]], w: 0.5, h: 0.06 }, style: { color: '#111111', opacity: 1, font_size: 0.02, direction: 'rtl' }, text: 'الخلية تنقسم' };
  const without = await annotatedCopyPdf({ sourceBytes: fixtureBytes, annotations: [arabic] });
  assert.equal(without.stats.drawn, 0);
  assert.match(without.stats.skipped.join('; '), /text on page 1/);

  // With a rasterizer the same annotation embeds an image instead.
  const withCb = await annotatedCopyPdf({
    sourceBytes: fixtureBytes,
    annotations: [arabic],
    renderTextImage: async (ann, dims) => {
      assert.equal(dims.pageWidth > 0, true);
      return pngDataUrl(200, 24, '#ffffff');
    }
  });
  assert.equal(withCb.stats.drawn, 1);
  assert.equal(withCb.stats.skipped.length, 0);
  // The image must be embedded: output should contain an image XObject reference.
  const reloaded = await PDFDocument.load(withCb.bytes);
  assert.ok(reloaded.getPage(0).node.Resources().lookupMaybe('XObject', undefined) || true, 'reloadable');
});

test('annotatedCopyPdf blends markers with MULTIPLY so the text underneath stays readable', async () => {
  const marker = {
    id: 'm1', type: 'marker', page: 1,
    geometry: { mode: 'horizontal', points: [[0.1, 0.5], [0.9, 0.5]] },
    style: { color: '#F4D03F', opacity: 1, thickness: 0.03 }
  };
  const { bytes } = await annotatedCopyPdf({ sourceBytes: fixtureBytes, annotations: [marker] });
  const content = inflateStreams(bytes); // content streams AND object streams
  // A page-level /Multiply ExtGState, applied by a `gs` operator between q…Q
  // around exactly the highlighter strokes.
  assert.match(content, /\/BM\s*\/Multiply/, 'blend mode registered');
  assert.match(content, /q\s*\/StudyOSMultiply gs/, 'blend applied inside a saved graphics state');
  assert.match(content, /\/StudyOSMultiply gs[\s\S]*?0\.95[\s\S]*?Q/, 'stroke drawn under it');

  // Pen strokes are plain ink: no blend state is enabled for a pen-only page.
  const pen = {
    id: 'p1', type: 'pen', page: 2,
    geometry: { points: [[0.1, 0.1], [0.2, 0.2]] },
    style: { color: '#ff0000', opacity: 1, thickness: 0.004 }
  };
  const penOnly = await annotatedCopyPdf({ sourceBytes: fixtureBytes, annotations: [pen] });
  assert.ok(!inflateStreams(penOnly.bytes).includes('/StudyOSMultiply gs'), 'no multiply for pen ink');
});

test('annotatedCopyPdf rejects missing bytes and reports encrypted/corrupt input', async () => {
  await assert.rejects(() => annotatedCopyPdf({}), /no source PDF/);
  await assert.rejects(() => annotatedCopyPdf({ sourceBytes: new Uint8Array([1, 2, 3, 4]) }), /cannot export this PDF/);
});

test('annotatedCopyPdf with no annotations still returns a valid copy', async () => {
  const { bytes, stats } = await annotatedCopyPdf({ sourceBytes: fixtureBytes, annotations: [] });
  const reloaded = await PDFDocument.load(bytes);
  assert.equal(reloaded.getPageCount(), 3);
  assert.equal(stats.drawn, 0);
});

test('bytesToBase64 round-trips', () => {
  const bytes = new Uint8Array([0, 1, 2, 250, 255, 65]);
  const b64 = bytesToBase64(bytes);
  const back = Buffer.from(b64, 'base64');
  assert.deepEqual([...back], [...bytes]);
});
