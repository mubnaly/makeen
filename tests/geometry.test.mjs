import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTransform,
  toDisplayPoint,
  toCanonicalPoint,
  displaySize,
  strokeWidthToDisplay
} from '../src/lib/geometry.js';

// The page canvas's client rect in a layout, to prove offsets are handled.
const PAGE = { pageWidth: 612, pageHeight: 792 };

function near(a, b, eps, msg) {
  assert.ok(Math.abs(a - b) <= eps, `${msg}: expected ${a} ~= ${b} (eps ${eps})`);
}

test('normalized coords round-trip at every zoom and rotation', () => {
  for (const scale of [0.5, 1, 2, 2.4]) {
    for (const rotation of [0, 90, 180, 270]) {
      const t = createTransform({ ...PAGE, scale, rotation });
      for (const [u, v] of [[0.1, 0.2], [0.5, 0.5], [0.98, 0.03], [0, 0], [1, 1]]) {
        const [x, y] = t.toLocal(u, v);
        const [u2, v2] = t.fromLocal(x, y);
        near(u2, u, 1e-9, `u @${scale}/${rotation}`);
        near(v2, v, 1e-9, `v @${scale}/${rotation}`);
      }
    }
  }
});

test('same content point maps to proportional display position at any zoom', () => {
  // This is the D2 regression: a point stored at (0.555, 0.238) must land at the
  // same FRACTION of the page at 100% and 200%, not at half the distance.
  const u = 0.555, v = 0.238;
  const t1 = createTransform({ ...PAGE, scale: 1, rotation: 0 });
  const t2 = createTransform({ ...PAGE, scale: 2, rotation: 0 });
  const [x1, y1] = t1.toLocal(u, v);
  const [x2, y2] = t2.toLocal(u, v);
  near(x1 / t1.displayWidth, x2 / t2.displayWidth, 1e-9, 'x fraction stable across zoom');
  near(y1 / t1.displayHeight, y2 / t2.displayHeight, 1e-9, 'y fraction stable across zoom');
  near(x2, 2 * x1, 1e-6, 'display x doubles when scale doubles');
});

test('client offset (scroll/padding) is absorbed', () => {
  const t = createTransform({ ...PAGE, scale: 2, rotation: 0, offsetX: 137, offsetY: 41 });
  const [cx, cy] = t.toClient(0.4, 0.6);
  const [u, v] = t.fromClient(cx, cy);
  near(u, 0.4, 1e-9, 'u via client');
  near(v, 0.6, 1e-9, 'v via client');
});

test('marker stroke is centered on pointer: extends thickness/2 each side', () => {
  // thickness is a fraction of page height; at scale S the rendered width in px
  // is thickness*pageHeight*S, and the stroke straddles the centerline evenly.
  const thickness = 40 / PAGE.pageHeight; // yields 40px at scale 1
  for (const scale of [1, 2]) {
    const width = strokeWidthToDisplay(thickness, { pageHeight: PAGE.pageHeight, scale });
    near(width, 40 * scale, 1e-6, `stroke width @${scale}`);
    const t = createTransform({ ...PAGE, scale });
    const [u, v] = [0.5, 0.5];
    const [, yCenter] = t.toLocal(u, v);
    const half = width / 2;
    near(yCenter - half, yCenter - half, 1e-9, 'top edge above centerline');
    near((yCenter + half) - yCenter, half, 1e-9, 'bottom edge below centerline');
    assert.equal((yCenter + half) - (yCenter - half), width, 'total extent equals stroke width');
  }
});

test('a picked pixel size survives the round trip the size ring relies on', () => {
  // The reader turns the number the user picked (5…100) into a normalized
  // thickness and then draws BOTH the stroke and the pointer ring through the
  // transform's strokeWidth. The ring can only promise "this is the real size"
  // if picked px -> thickness -> px is exact at every zoom and page size.
  for (const pageHeight of [612, 792, 1052]) {
    for (const scale of [0.4, 1, 1.25, 3]) {
      const t = createTransform({ pageWidth: 612, pageHeight, scale, rotation: 90 });
      for (const px of [5, 25, 40, 100]) {
        near(t.strokeWidth(t.thicknessFromWidth(px)), px, 1e-6, `${px}px @${scale} scale, ${pageHeight}pt page`);
      }
    }
  }
});

test('display size swaps under 90/270 rotation', () => {
  const s0 = displaySize(612, 792, 1, 0);
  const s90 = displaySize(612, 792, 1, 90);
  assert.equal(s0.width, 612);
  assert.equal(s0.height, 792);
  assert.equal(s90.width, 792);
  assert.equal(s90.height, 612);
});

test('raw point converters are exact inverses', () => {
  const opts = { pageWidth: 612, pageHeight: 792, scale: 1.75, rotation: 180 };
  const [u, v] = [0.33, 0.77];
  const [x, y] = toDisplayPoint(u, v, opts);
  const [u2, v2] = toCanonicalPoint(x, y, opts);
  near(u2, u, 1e-9, 'u inverse');
  near(v2, v, 1e-9, 'v inverse');
});

test('rejects invalid rotation and dimensions', () => {
  assert.throws(() => displaySize(100, 100, 1, 45), /Unsupported rotation/);
  assert.throws(() => createTransform({ pageWidth: 0, pageHeight: 100, scale: 1 }), /positive/);
  assert.throws(() => createTransform({ pageWidth: 100, pageHeight: 100, scale: 0 }), /positive/);
});
