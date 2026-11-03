import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransform } from '../src/lib/geometry.js';
import { hitTestAnnotation, hitTest, localGeometry, filterForView } from '../src/lib/annotations.js';

const PAGE = { pageWidth: 612, pageHeight: 792 };
// scale 1 => 1 display px per page unit, so page unit == px and math is legible.
const t = createTransform({ ...PAGE, scale: 1, rotation: 0 });

function marker(over = {}) {
  return {
    id: 'm1',
    type: 'marker',
    page: 14,
    geometry: { mode: 'horizontal', points: [[0.2, 0.5], [0.8, 0.5]] },
    style: { color: '#ff0', opacity: 1, thickness: 40 / 792 }, // 40px wide at scale 1
    ...over
  };
}

test('marker: eraser hits near the centerline, misses far away', () => {
  const ann = marker();
  const g = localGeometry(ann, t);
  const widthPx = g.width;
  assert.ok(Math.abs(widthPx - 40) < 0.01, `stroke width ~40px, got ${widthPx}`);
  const cy = g.strokes[0][0].y; // centerline y
  // 18px from centerline: within halfwidth(20)+radius(6)=26 -> hit
  assert.equal(hitTestAnnotation(ann, 0.5 * 612, cy + 18, t, 6), true, 'within stroke+radius hits');
  // 40px from centerline: beyond 26 -> miss
  assert.equal(hitTestAnnotation(ann, 0.5 * 612, cy + 40, t, 6), false, 'outside stroke+radius misses');
  // left of segment start -> miss (endpoint round cap allows small pad)
  assert.equal(hitTestAnnotation(ann, 0.2 * 612 - 60, cy, t, 6), false, 'beyond segment end misses');
});

test('marker stroke is centered on its centerline (top/bottom equal)', () => {
  const ann = marker();
  const g = localGeometry(ann, t);
  const cy = g.strokes[0][0].y;
  const half = g.width / 2;
  // A point exactly half a stroke width up/down sits on the edge (pad = half+radius>half).
  assert.equal(hitTestAnnotation(ann, 0.5 * 612, cy - (half - 1), t, 1), true, 'just inside top edge');
  assert.equal(hitTestAnnotation(ann, 0.5 * 612, cy + (half - 1), t, 1), true, 'just inside bottom edge');
});

test('pen polyline hits along its path', () => {
  const ann = {
    id: 'p1', type: 'pen', page: 3,
    geometry: { points: [[0.3, 0.3], [0.4, 0.4], [0.5, 0.35]] },
    style: { color: '#f00', thickness: 4 / 792 }
  };
  assert.equal(hitTestAnnotation(ann, 0.4 * 612, 0.4 * 792, t, 6), true, 'on path hits');
  assert.equal(hitTestAnnotation(ann, 0.4 * 612, 0.8 * 792, t, 6), false, 'off path misses');
});

test('line and arrow hit their segment only', () => {
  const line = {
    id: 's1', type: 'shape', page: 1,
    geometry: { shape: 'line', points: [[0.2, 0.2], [0.8, 0.2]] },
    style: { color: '#00f', thickness: 3 / 792 }
  };
  assert.equal(hitTestAnnotation(line, 0.5 * 612, 0.2 * 792, t, 6), true, 'on line hits');
  assert.equal(hitTestAnnotation(line, 0.5 * 612, 0.5 * 792, t, 6), false, 'off line misses');
  const arrow = { ...line, geometry: { ...line.geometry, shape: 'arrow' } };
  assert.equal(hitTestAnnotation(arrow, 0.5 * 612, 0.2 * 792, t, 6), true, 'arrow segment hits');
});

test('rectangle: border hits; fill interior only hits when filled', () => {
  const rect = {
    id: 'r1', type: 'shape', page: 1,
    geometry: { shape: 'rectangle', points: [[0.3, 0.3], [0.6, 0.6]] },
    style: { color: '#00f', thickness: 3 / 792 }
  };
  assert.equal(hitTestAnnotation(rect, 0.3 * 612, 0.45 * 792, t, 6), true, 'left border hits');
  assert.equal(hitTestAnnotation(rect, 0.45 * 612, 0.45 * 792, t, 6), false, 'unfilled interior misses');
  const filled = { ...rect, style: { ...rect.style, fill_color: 'rgba(0,0,255,0.3)' } };
  assert.equal(hitTestAnnotation(filled, 0.45 * 612, 0.45 * 792, t, 6), true, 'filled interior hits');
});

test('ellipse: border hits, unfilled center misses, filled center hits', () => {
  const ell = {
    id: 'e1', type: 'shape', page: 1,
    geometry: { shape: 'ellipse', points: [[0.3, 0.3], [0.7, 0.7]] },
    style: { color: '#00f', thickness: 3 / 792 }
  };
  const cx = 0.5 * 612, cy = 0.5 * 792;
  assert.equal(hitTestAnnotation(ell, 0.3 * 612, cy, t, 6), true, 'left border point hits');
  assert.equal(hitTestAnnotation(ell, cx, cy, t, 6), false, 'unfilled center misses');
  const filled = { ...ell, style: { ...ell.style, fill_color: 'rgba(0,0,255,0.3)' } };
  assert.equal(hitTestAnnotation(filled, cx, cy, t, 6), true, 'filled center hits');
});

test('check and cross hit their drawn strokes, not just bbox center', () => {
  const check = {
    id: 'c1', type: 'shape', page: 1,
    geometry: { shape: 'check', points: [[0.3, 0.3], [0.7, 0.7]] },
    style: { color: '#0a0', thickness: 4 / 792 }
  };
  // Midpoint of the check's first stroke segment (bbox-defined in hitTest).
  const bbox = { x: 0.3 * 612, y: 0.3 * 792, w: (0.7 - 0.3) * 612, h: (0.7 - 0.3) * 792 };
  const a = { x: bbox.x + bbox.w * 0.15, y: bbox.y + bbox.h * 0.55 };
  const b = { x: bbox.x + bbox.w * 0.42, y: bbox.y + bbox.h * 0.82 };
  const onArm = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  assert.equal(hitTestAnnotation(check, onArm.x, onArm.y, t, 8), true, 'on check stroke hits');
  const cross = { ...check, geometry: { ...check.geometry, shape: 'cross' } };
  // Center of an X is on both diagonals -> hits.
  assert.equal(hitTestAnnotation(cross, 0.5 * 612, 0.5 * 792, t, 6), true, 'cross center hits');
});

test('text: hits inside its box, misses outside', () => {
  const txt = {
    id: 't1', type: 'text', page: 2,
    geometry: { points: [[0.3, 0.4]], w: 0.3, h: 0.06 },
    style: { color: '#111', font_size: 0.02 },
    text: 'note'
  };
  assert.equal(hitTestAnnotation(txt, 0.4 * 612, 0.43 * 792, t, 6), true, 'inside box hits');
  assert.equal(hitTestAnnotation(txt, 0.4 * 612, 0.7 * 792, t, 6), false, 'outside box misses');
});

test('hitTest returns topmost and respects page + view filter', () => {
  const lower = marker({ id: 'lower' });
  const upper = marker({ id: 'upper', style: { color: '#0f0', opacity: 1, thickness: 6 / 792 } });
  const otherPage = marker({ id: 'other', page: 99 });
  const list = [lower, upper, otherPage];
  const cy = localGeometry(lower, t).strokes[0][0].y;
  const hit = hitTest(list, 14, 0.5 * 612, cy, t, 4, 'all');
  assert.equal(hit && hit.id, 'upper', 'topmost wins');
  assert.equal(hitTest(list, 50, 0.5 * 612, cy, t, 4, 'all'), null, 'empty page -> null');
  assert.equal(hitTest(list, 99, 0.5 * 612, cy, t, 4, 'all').id, 'other', 'other page annotation found on its own page');
});

test('filterForView separates highlights from annotations', () => {
  const m = marker({ id: 'm' });
  const p = { id: 'p', type: 'pen', page: 14, geometry: { points: [[0.1, 0.1], [0.2, 0.2]] }, style: {} };
  const list = [m, p];
  assert.equal(filterForView(list, 14, 'highlights').length, 1);
  assert.equal(filterForView(list, 14, 'highlights')[0].id, 'm');
  assert.equal(filterForView(list, 14, 'annotations').length, 1);
  assert.equal(filterForView(list, 14, 'annotations')[0].id, 'p');
  assert.equal(filterForView(list, 14, 'all').length, 2);
});
