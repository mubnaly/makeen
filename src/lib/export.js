// PDF export actions (plan §7.5). Three distinct operations, kept separate on
// purpose (plan §13: capture/extract/excerpt "are not equivalent"):
//   1. imagesToPdf        — gallery captures combined into one PDF
//   2. excerptsPdf        — one cropped excerpt per marker/highlight
//   3. annotatedCopyPdf   — a NEW flattened copy; the source is never modified
//
// PDF.js rasterization stays out of this module: callers inject a renderer so
// this file stays testable in Node (tests/exports.test.mjs).

import {
  PDFDocument, rgb, LineCapStyle,
  PDFName, PDFDict, pushGraphicsState, popGraphicsState, setGraphicsState
} from 'pdf-lib';

export const A4 = [595, 842];
export const A5 = [420, 595];

// --- color ------------------------------------------------------------------

export function parseColorToRgb(color) {
  if (!color || typeof color !== 'string') return { r: 0, g: 0, b: 0 };
  const hex = color.trim();
  if (hex[0] === '#') {
    let h = hex.slice(1);
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h.slice(0, 6), 16);
    if (Number.isNaN(n)) return { r: 0, g: 0, b: 0 };
    return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
  }
  const m = hex.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (m) return { r: Math.min(255, +m[1]) / 255, g: Math.min(255, +m[2]) / 255, b: Math.min(255, +m[3]) / 255 };
  return { r: 0, g: 0, b: 0 };
}

export function parseAlpha(color, fallback = 1) {
  if (typeof color !== 'string') return fallback;
  const m = color.match(/rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)/i);
  return m ? +m[1] : fallback;
}

function colorOf(style) {
  const { r, g, b } = parseColorToRgb(style && style.color);
  return rgb(r, g, b);
}

// Standard PDF fonts are WinAnsi-only; captions with other scripts are replaced
// (documented limitation — annotation text itself is rasterized instead).
function winAnsi(text) {
  return String(text || '').replace(/[^\u0020-\u00ff]/g, '?');
}

// --- geometry ---------------------------------------------------------------

// Normalized bounding box of a marker including half its stroke width, in the
// 0..1 page space.
//
// `thickness` is a fraction of the page HEIGHT and the annotation stores it on
// STYLE, not geometry (see Reader.finalizeAnnotation + sidecar.normalizeGeometry,
// which drops it from geometry). Reading only geometry meant the padding was
// always 0, so a horizontal/vertical marker — whose points share one v — produced
// a degenerate box: every exported highlight excerpt came out ~1px tall. Take the
// thickness from the style, tolerate a geometry copy, and fall back to the
// renderer's own default.
//
// The pad is applied on both axes. On portrait pages the horizontal pad is
// slightly wider than the exact half-stroke (which needs the page aspect ratio),
// which crops a little extra paper — never the stroke itself.
export function markerBBox(geometry, style = null) {
  const pts = [];
  if (Array.isArray(geometry?.segments)) geometry.segments.forEach((s) => pts.push(...s));
  if (Array.isArray(geometry?.points)) pts.push(...geometry.points);
  if (!pts.length) return null;
  const us = pts.map((p) => p[0]);
  const vs = pts.map((p) => p[1]);
  const raw = style?.thickness ?? geometry?.thickness;
  const thickness = Number.isFinite(Number(raw)) && Number(raw) > 0 ? Number(raw) : 0.012;
  const pad = thickness / 2;
  const u = Math.max(0, Math.min(...us) - pad);
  const v = Math.max(0, Math.min(...vs) - pad);
  const u2 = Math.min(1, Math.max(...us) + pad);
  const v2 = Math.min(1, Math.max(...vs) + pad);
  return { u, v, w: Math.max(1e-4, u2 - u), h: Math.max(1e-4, v2 - v) };
}

function fitInto(box, w, h) {
  const scale = Math.min(box[0] / w, box[1] / h);
  return { width: w * scale, height: h * scale, x: (box[0] - w * scale) / 2, y: (box[1] - h * scale) / 2 };
}

async function embedImage(pdfDoc, dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
    throw new Error('capture image is not a data URL');
  }
  if (/^data:image\/png/i.test(dataUrl)) return pdfDoc.embedPng(dataUrl);
  if (/^data:image\/jpe?g/i.test(dataUrl)) return pdfDoc.embedJpg(dataUrl);
  throw new Error('unsupported image format (need PNG or JPEG)');
}

// --- 1. images -> PDF -------------------------------------------------------

// entries: [{ image: dataURL, label?: string }] in the order they should appear.
// Images FLOW: each one lands in whatever space is left on the current page and
// only opens a new page when it no longer fits — so a page holds a second (or
// third) capture whenever there is room, while every image keeps its aspect
// ratio and is never cut off.
export async function imagesToPdf(entries, { labels = false, box = A4, margin = 24, gap = 14, minBlock = 80, renderLabelImage = null } = {}) {
  if (!entries?.length) throw new Error('no images to export');
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle('StudyOS captures');
  const font = await pdfDoc.embedStandardFont('Helvetica');
  const contentW = box[0] - margin * 2;
  let page = null;
  let y = margin; // distance from the page top to the next free line

  for (const entry of entries) {
    const img = await embedImage(pdfDoc, entry.image);
    const captionH = labels && entry.label ? 14 : 0;
    // Find a page with room: the image plus its caption must fit in what is
    // left below the cursor (or on a fresh page).
    for (;;) {
      const maxH = box[1] - y - margin - captionH;
      if (maxH >= minBlock || !page) break;
      page = null;
      y = margin;
    }
    if (!page) page = pdfDoc.addPage(box);
    const maxH = Math.max(1, box[1] - y - margin - captionH);
    const scale = Math.min(contentW / img.width, maxH / img.height);
    const w = Math.max(1, img.width * scale);
    const h = Math.max(1, img.height * scale);
    const x = margin + (contentW - w) / 2;
    page.drawImage(img, { x, y: box[1] - y - h, width: w, height: h });
    y += h;
    if (captionH) {
      // A rasterized caption preserves Arabic and other non-WinAnsi scripts;
      // the standard-font text remains the fallback (and the test path).
      let drawnLabel = false;
      if (typeof renderLabelImage === 'function') {
        try {
          const dataUrl = await renderLabelImage(entry.label);
          if (dataUrl) {
            const labelImg = await embedImage(pdfDoc, dataUrl);
            const labelH = 12;
            const labelW = Math.min(contentW, labelH * (labelImg.width / labelImg.height));
            page.drawImage(labelImg, {
              x: margin, y: Math.max(8, box[1] - y - labelH - 1),
              width: labelW, height: labelH
            });
            drawnLabel = true;
          }
        } catch { /* fall back to the standard-font caption */ }
      }
      if (!drawnLabel) {
        page.drawText(winAnsi(entry.label).slice(0, 90), {
          x: margin, y: Math.max(10, box[1] - y - 5), size: 9, font,
          color: rgb(0.35, 0.35, 0.38)
        });
      }
      y += captionH;
    }
    y += gap;
  }
  return pdfDoc.save();
}

// --- 2. highlight excerpts -> PDF -------------------------------------------

// markers: marker annotations (any pages). rasterizeRegion(pageNumber, rect)
// must resolve to a PNG data URL of that page region; rect is normalized.
export async function excerptsPdf({ markers, sourceName = '', rasterizeRegion, labels = true, box = A5, renderLabelImage = null } = {}) {
  const list = (markers || []).filter((a) => a.type === 'marker');
  if (!list.length) throw new Error('no highlighter strokes to export');
  if (typeof rasterizeRegion !== 'function') throw new Error('rasterizeRegion is required');
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(`Highlights — ${sourceName}`);
  const font = await pdfDoc.embedStandardFont('Helvetica');
  let made = 0;
  for (const ann of list) {
    const rect = markerBBox(ann.geometry, ann.style);
    if (!rect) continue;
    const dataUrl = await rasterizeRegion(ann.page, rect);
    if (!dataUrl) continue;
    const img = await embedImage(pdfDoc, dataUrl);
    const landscape = img.width > img.height;
    const page = pdfDoc.addPage(landscape ? [box[1], box[0]] : box);
    const captionH = labels ? 22 : 0;
    const fit = fitInto([page.getWidth() - 24, page.getHeight() - captionH - 24], img.width, img.height);
    page.drawImage(img, { x: fit.x + 12, y: fit.y + captionH, width: fit.width, height: fit.height });
    if (labels) {
      const caption = `${sourceName} · p.${ann.page}`;
      let drawnLabel = false;
      if (typeof renderLabelImage === 'function') {
        try {
          const dataUrl = await renderLabelImage(caption);
          if (dataUrl) {
            const labelImg = await embedImage(pdfDoc, dataUrl);
            const labelH = 12;
            const labelW = Math.min(page.getWidth() - 24, labelH * (labelImg.width / labelImg.height));
            page.drawImage(labelImg, { x: 12, y: 7, width: labelW, height: labelH });
            drawnLabel = true;
          }
        } catch { /* fall back to the standard-font caption */ }
      }
      if (!drawnLabel) {
        page.drawText(winAnsi(caption).slice(0, 90), {
          x: 12, y: 10, size: 9, font, color: rgb(0.35, 0.35, 0.38)
        });
      }
    }
    made++;
  }
  if (!made) throw new Error('no excerpts could be rendered');
  return pdfDoc.save();
}

// --- 3. annotated copy ------------------------------------------------------

// Real highlighter blending inside the exported PDF: a /Multiply ExtGState on
// the page, applied only around marker strokes (q … Q), so the ink multiplies
// with the page's text exactly like the on-screen highlighter layer — the text
// under a highlight stays fully readable even at full opacity. pdf-lib has no
// blend-mode API, so the graphics-state entry is registered directly.
const MULTIPLY_GS = 'StudyOSMultiply';

export function enableMultiplyBlend(pdfDoc, page) {
  try {
    let resources = page.node.Resources();
    if (!resources) {
      const dict = pdfDoc.context.obj({});
      page.node.set(PDFName.of('Resources'), dict);
      resources = dict;
    }
    let ext = pdfDoc.context.lookupMaybe(resources.get(PDFName.of('ExtGState')), PDFDict);
    if (!ext) {
      ext = pdfDoc.context.obj({});
      resources.set(PDFName.of('ExtGState'), ext);
    }
    const key = PDFName.of(MULTIPLY_GS);
    if (!ext.get(key)) {
      ext.set(key, pdfDoc.context.register(pdfDoc.context.obj({
        Type: 'ExtGState',
        BM: PDFName.of('Multiply'),
        ca: 1,
        CA: 1
      })));
    }
    return true;
  } catch {
    return false; // older/unusual page structure: fall back to plain ink
  }
}

// Flattens annotations into a NEW document; sourceBytes are only read.
// Geometry -> drawable stroke segments (shared by marker and pen).
function markerStrokes(g) {
  if (Array.isArray(g.segments)) return g.segments.filter((s) => Array.isArray(s) && s.length >= 2);
  if (Array.isArray(g.points) && g.points.length >= 2) {
    const out = [];
    for (let i = 1; i < g.points.length; i++) out.push([g.points[i - 1], g.points[i]]);
    return out;
  }
  return [];
}

const multiplyTried = new WeakSet();
const multiplyOk = new WeakSet();

// Enable /Multiply on this page at most once; both outcomes are remembered so a
// page that refuses ExtGState is not retried for every stroke.
function multiplyOn(pdfDoc, page) {
  if (multiplyTried.has(page)) return multiplyOk.has(page);
  multiplyTried.add(page);
  const ok = enableMultiplyBlend(pdfDoc, page);
  if (ok) multiplyOk.add(page);
  return ok;
}

// renderTextImage(ann, { pageWidth, pageHeight }) -> dataURL lets the browser
// rasterize text boxes (preserves Arabic shaping; standard PDF fonts cannot).
export async function annotatedCopyPdf({ sourceBytes, annotations = [], renderTextImage = null } = {}) {
  if (!sourceBytes) throw new Error('no source PDF bytes');
  let pdfDoc;
  try {
    pdfDoc = await PDFDocument.load(sourceBytes, { ignoreEncryption: false });
  } catch (e) {
    throw new Error(`cannot export this PDF: ${e.message}`);
  }
  const byPage = new Map();
  for (const ann of annotations) {
    if (!byPage.has(ann.page)) byPage.set(ann.page, []);
    byPage.get(ann.page).push(ann);
  }
  const font = await pdfDoc.embedStandardFont('Helvetica');
  let drawn = 0;
  const skipped = [];

  for (const [pageNum, anns] of byPage) {
    const page = pdfDoc.getPage(pageNum - 1);
    if (!page) { skipped.push(`${anns.length} on missing page ${pageNum}`); continue; }
    const { width: W, height: H } = page.getSize();
    const X = (u) => u * W;
    const Y = (v) => (1 - v) * H; // normalized top-left -> PDF bottom-left

    for (const ann of anns) {
      const style = ann.style || {};
      const g = ann.geometry || {};
      const col = colorOf(style);
      const op = style.opacity ?? 1;
      const strokePt = Math.max(0.25, (style.thickness ?? 0.012) * H);
      try {
        if (ann.type === 'marker') {
          const strokes = markerStrokes(g);
          const blended = multiplyOn(pdfDoc, page);
          if (blended) page.pushOperators(pushGraphicsState(), setGraphicsState(MULTIPLY_GS));
          for (const [a, b] of strokes) {
            page.drawLine({
              start: { x: X(a[0]), y: Y(a[1]) },
              end: { x: X(b[0]), y: Y(b[1]) },
              thickness: strokePt, color: col, opacity: op, lineCap: LineCapStyle.Round
            });
          }
          if (blended) page.pushOperators(popGraphicsState());
        } else if (ann.type === 'pen') {
          for (const [a, b] of markerStrokes(g)) {
            page.drawLine({
              start: { x: X(a[0]), y: Y(a[1]) },
              end: { x: X(b[0]), y: Y(b[1]) },
              thickness: strokePt, color: col, opacity: op, lineCap: LineCapStyle.Round
            });
          }
        } else if (ann.type === 'shape' && Array.isArray(g.points) && g.points.length >= 2) {
          drawn += drawShapeFlattened(page, g, style, { X, Y, W, H, strokePt, col, op }) ? 1 : 0;
          continue; // counted inside
        } else if (ann.type === 'text') {
          const ok = await drawTextFlattened(page, pdfDoc, ann, { X, Y, W, H, font, renderTextImage });
          if (ok) { drawn++; continue; }
          skipped.push(`text on page ${ann.page} (unsupported characters)`);
          continue;
        } else {
          skipped.push(`unknown type ${ann.type}`);
          continue;
        }
        drawn++;
      } catch (e) {
        skipped.push(`${ann.type} on page ${ann.page}: ${e.message}`);
      }
    }
  }
  const bytes = await pdfDoc.save();
  return { bytes, stats: { drawn, skipped } };
}

function drawShapeFlattened(page, g, style, ctx) {
  const { X, Y, W, H, strokePt, col, op } = ctx;
  const [p1, p2] = g.points;
  const shape = g.shape || 'rectangle';
  const x = X(Math.min(p1[0], p2[0]));
  const yTop = Y(Math.max(p1[1], p2[1]));
  const w = Math.abs(p2[0] - p1[0]) * W;
  const h = Math.abs(p2[1] - p1[1]) * H;
  const { r, g: gg, b } = parseColorToRgb(style.fill_color);
  const fillA = style.fill_color ? parseAlpha(style.fill_color, 0.28) : 0;
  const fill = fillA > 0 ? rgb(r, gg, b) : undefined;

  if (shape === 'line' || shape === 'arrow') {
    page.drawLine({ start: { x: X(p1[0]), y: Y(p1[1]) }, end: { x: X(p2[0]), y: Y(p2[1]) }, thickness: strokePt, color: col, opacity: op, lineCap: LineCapStyle.Round });
    if (shape === 'arrow') {
      const ang = Math.atan2(-(p2[1] - p1[1]) * H, (p2[0] - p1[0]) * W);
      const head = Math.max(6, strokePt * 2.5);
      for (const da of [Math.PI / 7, -Math.PI / 7]) {
        page.drawLine({
          start: { x: X(p2[0]), y: Y(p2[1]) },
          end: { x: X(p2[0]) - head * Math.cos(ang + da), y: Y(p2[1]) - head * Math.sin(ang + da) },
          thickness: strokePt, color: col, opacity: op, lineCap: LineCapStyle.Round
        });
      }
    }
    return true;
  }
  if (shape === 'rectangle') {
    page.drawRectangle({ x, y: yTop, width: w, height: h, borderColor: col, borderWidth: strokePt, borderOpacity: op, color: fill, opacity: fill ? fillA : undefined });
    return true;
  }
  if (shape === 'ellipse') {
    page.drawEllipse({ x: x + w / 2, y: yTop + h / 2, xScale: w / 2, yScale: h / 2, borderColor: col, borderWidth: strokePt, borderOpacity: op, color: fill, opacity: fill ? fillA : undefined });
    return true;
  }
  // check / cross as line segments
  const segs = shape === 'check'
    ? [[[0.15, 0.55], [0.42, 0.82]], [[0.42, 0.82], [0.88, 0.2]]]
    : [[[0.15, 0.15], [0.85, 0.85]], [[0.85, 0.15], [0.15, 0.85]]];
  for (const [[fu1, fv1], [fu2, fv2]] of segs) {
    page.drawLine({
      start: { x: x + fu1 * w, y: yTop + (1 - fv1) * h },
      end: { x: x + fu2 * w, y: yTop + (1 - fv2) * h },
      thickness: strokePt, color: col, opacity: op, lineCap: LineCapStyle.Round
    });
  }
  return true;
}

async function drawTextFlattened(page, pdfDoc, ann, ctx) {
  const { X, Y, W, H, font, renderTextImage } = ctx;
  const g = ann.geometry || {};
  const u = g.points?.[0]?.[0] ?? 0;
  const v = g.points?.[0]?.[1] ?? 0;
  const wPt = (g.w ?? 0.25) * W;
  const hPt = (g.h ?? 0.05) * H;

  if (typeof renderTextImage === 'function') {
    const dataUrl = await renderTextImage(ann, { pageWidth: W, pageHeight: H });
    if (dataUrl) {
      const img = await pdfDoc.embedPng(dataUrl);
      page.drawImage(img, { x: X(u), y: Y(v) - hPt, width: wPt, height: hPt, opacity: 1 });
      return true;
    }
  }
  // Fallback: native text (WinAnsi/Latin only; throws for Arabic etc.)
  const size = Math.max(4, (ann.style?.font_size ?? 0.02) * H);
  const rtl = ann.style?.direction === 'rtl';
  page.drawText(String(ann.text || ''), {
    x: rtl ? X(u) + wPt - 2 : X(u) + 2,
    y: Y(v) - size - 2,
    size, font, color: colorOf(ann.style || {})
  });
  return true;
}

// --- delivery helpers -------------------------------------------------------

export function bytesToBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

// Desktop bridge writes to StudyOSData/exports/; otherwise download in-app.
export async function deliverBytes(bytes, filename, bridge, mime = 'application/pdf') {
  if (bridge && typeof bridge.saveExportFile === 'function') {
    const res = await bridge.saveExportFile(filename, bytesToBase64(bytes));
    if (res && res.ok) return { where: 'file', path: res.path };
    throw new Error(res?.error || 'desktop export failed');
  }
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return { where: 'download', path: filename };
}
