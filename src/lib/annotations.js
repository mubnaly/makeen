// Annotation rendering + geometric hit testing (plan §6.4, §7.4).
//
// Everything is expressed through the canonical transform so strokes are centered
// on the pointer and stay put across zoom/rotation. Rendering takes normalized
// coordinates and produces local canvas pixels; hit testing works on that same
// rendered geometry (distance to segments, ellipse/rect border + fill, text box).

import { toDisplayPoint, strokeWidthToDisplay } from './geometry.js';

const TAU = Math.PI * 2;

function pt(u, v, t) {
  const [x, y] = toDisplayPoint(u, v, t);
  return { x, y };
}

function widthOf(style, t) {
  return strokeWidthToDisplay((style && style.thickness) || 0.012, { pageHeight: t.pageHeight, scale: t.scale });
}

// Convert an annotation's canonical geometry to rendered local-pixel primitives.
export function localGeometry(ann, t) {
  const g = ann.geometry || {};
  const style = ann.style || {};
  const w = widthOf(style, t);

  if (ann.type === 'marker') {
    const strokes = [];
    if (Array.isArray(g.segments)) {
      for (const seg of g.segments) strokes.push(seg.map((p) => pt(p[0], p[1], t)));
    } else if (Array.isArray(g.points) && g.points.length >= 2) {
      // points is a polyline; for h/v markers it's a single segment.
      const pts = g.points.map((p) => pt(p[0], p[1], t));
      for (let i = 1; i < pts.length; i++) strokes.push([pts[i - 1], pts[i]]);
    } else if (Array.isArray(g.points) && g.points.length === 1) {
      const a = pt(g.points[0][0], g.points[0][1], t);
      strokes.push([a, { x: a.x + 1, y: a.y }]);
    }
    return { kind: 'stroke', width: w, strokes };
  }

  if (ann.type === 'pen') {
    const pts = (g.points || []).map((p) => pt(p[0], p[1], t));
    const strokes = [];
    for (let i = 1; i < pts.length; i++) strokes.push([pts[i - 1], pts[i]]);
    return { kind: 'stroke', width: w, strokes };
  }

  if (ann.type === 'shape') {
    const p1 = pt(g.points[0][0], g.points[0][1], t);
    const p2 = pt(g.points[1][0], g.points[1][1], t);
    const bbox = {
      x: Math.min(p1.x, p2.x),
      y: Math.min(p1.y, p2.y),
      w: Math.abs(p2.x - p1.x),
      h: Math.abs(p2.y - p1.y)
    };
    return { kind: 'shape', shape: g.shape || 'rectangle', p1, p2, bbox, width: w };
  }

  if (ann.type === 'text') {
    const anchor = Array.isArray(g.points) && g.points[0] ? g.points[0] : [0, 0];
    const a = pt(anchor[0], anchor[1], t);
    const bw = (g.w || 0.25) * (t.pageWidth * t.scale);
    const bh = (g.h || 0.05) * (t.pageHeight * t.scale);
    const fontSize = ((style.font_size || 0.02) * t.pageHeight * t.scale);
    return { kind: 'text', anchor: a, box: { x: a.x, y: a.y, w: bw, h: bh }, width: w, fontSize };
  }

  return { kind: 'none' };
}

function drawStrokeSegs(ctx, strokes, width, style) {
  ctx.save();
  ctx.globalAlpha = style.opacity ?? 1;
  ctx.strokeStyle = style.color || '#F4D03F';
  ctx.fillStyle = style.color || '#F4D03F';
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [a, b] of strokes) {
    if (Math.abs(b.x - a.x) < 0.2 && Math.abs(b.y - a.y) < 0.2) {
      ctx.beginPath();
      ctx.arc(a.x, a.y, Math.max(1, width / 2), 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawShape(ctx, g, style) {
  const { shape, p1, p2, bbox, width } = g;
  ctx.save();
  ctx.globalAlpha = style.opacity ?? 1;
  ctx.strokeStyle = style.color || '#e74c3c';
  ctx.fillStyle = style.fill_color || style.color || 'rgba(231,76,60,0.22)';
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const filled = !!style.fill_color;
  if (filled) {
    ctx.globalCompositeOperation = 'multiply';
  }

  switch (shape) {
    case 'line':
    case 'arrow': {
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      if (shape === 'arrow') {
        const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x);
        const head = Math.max(8, width * 2.5);
        ctx.beginPath();
        ctx.moveTo(p2.x, p2.y);
        ctx.lineTo(p2.x - head * Math.cos(ang - Math.PI / 7), p2.y - head * Math.sin(ang - Math.PI / 7));
        ctx.moveTo(p2.x, p2.y);
        ctx.lineTo(p2.x - head * Math.cos(ang + Math.PI / 7), p2.y - head * Math.sin(ang + Math.PI / 7));
        ctx.stroke();
      }
      break;
    }
    case 'rectangle': {
      if (filled) ctx.fillRect(bbox.x, bbox.y, bbox.w, bbox.h);
      ctx.strokeRect(bbox.x, bbox.y, bbox.w, bbox.h);
      break;
    }
    case 'ellipse': {
      ctx.beginPath();
      ctx.ellipse(bbox.x + bbox.w / 2, bbox.y + bbox.h / 2, bbox.w / 2, bbox.h / 2, 0, 0, TAU);
      if (filled) ctx.fill();
      ctx.stroke();
      break;
    }
    case 'check': {
      ctx.beginPath();
      ctx.moveTo(bbox.x + bbox.w * 0.15, bbox.y + bbox.h * 0.55);
      ctx.lineTo(bbox.x + bbox.w * 0.42, bbox.y + bbox.h * 0.82);
      ctx.lineTo(bbox.x + bbox.w * 0.88, bbox.y + bbox.h * 0.2);
      ctx.stroke();
      break;
    }
    case 'cross': {
      ctx.beginPath();
      ctx.moveTo(bbox.x + bbox.w * 0.15, bbox.y + bbox.h * 0.15);
      ctx.lineTo(bbox.x + bbox.w * 0.85, bbox.y + bbox.h * 0.85);
      ctx.moveTo(bbox.x + bbox.w * 0.85, bbox.y + bbox.h * 0.15);
      ctx.lineTo(bbox.x + bbox.w * 0.15, bbox.y + bbox.h * 0.85);
      ctx.stroke();
      break;
    }
    default:
      break;
  }
  ctx.restore();
}

function wrapText(ctx, text, maxWidth) {
  const paragraphs = String(text).split('\n');
  const lines = [];
  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push('');
      continue;
    }
    let line = words[0];
    for (let i = 1; i < words.length; i++) {
      const test = `${line} ${words[i]}`;
      if (ctx.measureText(test).width > maxWidth) {
        lines.push(line);
        line = words[i];
      } else {
        line = test;
      }
    }
    lines.push(line);
  }
  return lines;
}

function drawText(ctx, g, ann, style) {
  const dir = style.direction && style.direction !== 'auto' ? style.direction : detectDir(ann.text);
  ctx.save();
  ctx.globalAlpha = style.opacity ?? 1;
  ctx.font = `${Math.max(6, g.fontSize)}px ${style.font_family || 'system-ui, sans-serif'}`;
  ctx.textBaseline = 'top';
  ctx.direction = dir;
  ctx.fillStyle = style.color || '#111';
  if (style.background) {
    ctx.save();
    ctx.globalAlpha = (style.bg_opacity ?? 0.6);
    ctx.fillStyle = style.background;
    ctx.fillRect(g.box.x, g.box.y, g.box.w, g.box.h);
    ctx.restore();
    ctx.fillStyle = style.color || '#111';
  }
  const lines = wrapText(ctx, ann.text || '', g.box.w - 4);
  const lh = g.fontSize * 1.25;
  ctx.textAlign = dir === 'rtl' ? 'right' : 'left';
  const x = dir === 'rtl' ? g.box.x + g.box.w - 2 : g.box.x + 2;
  lines.forEach((ln, i) => ctx.fillText(ln, x, g.box.y + 2 + i * lh));
  ctx.restore();
}

function detectDir(text) {
  return /[\u0600-\u06FF]/.test(String(text || '')) ? 'rtl' : 'ltr';
}

// Render one annotation in local canvas pixels.
export function renderAnnotation(ctx, ann, t) {
  const style = ann.style || {};
  const g = localGeometry(ann, t);
  if (g.kind === 'stroke') drawStrokeSegs(ctx, g.strokes, g.width, style);
  else if (g.kind === 'shape') drawShape(ctx, g, style);
  else if (g.kind === 'text') drawText(ctx, g, ann, style);
}

// Filter by view mode: 'all' | 'highlights' | 'annotations'.
export function filterForView(list, page, filter) {
  return list.filter((a) => {
    if (a.page !== page) return false;
    if (filter === 'highlights') return a.type === 'marker';
    if (filter === 'annotations') return a.type !== 'marker';
    return true;
  });
}

export function renderAnnotations(ctx, list, page, t, { filter = 'all' } = {}) {
  for (const ann of filterForView(list, page, filter)) {
    renderAnnotation(ctx, ann, t);
  }
}

// --- eraser hit testing (plan §7.4) -----------------------------------------

function distToSeg(px, py, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const tt = len2 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2)) : 0;
  return Math.hypot(px - (a.x + tt * dx), py - (a.y + tt * dy));
}

function distToEllipseBorder(px, py, bbox) {
  const cx = bbox.x + bbox.w / 2;
  const cy = bbox.y + bbox.h / 2;
  const rx = Math.max(1e-3, bbox.w / 2);
  const ry = Math.max(1e-3, bbox.h / 2);
  const nx = (px - cx) / rx;
  const ny = (py - cy) / ry;
  const n = Math.hypot(nx, ny);
  // Approximate distance from the point to the ellipse border in pixels.
  return Math.abs(n - 1) * Math.min(rx, ry);
}

function inRect(px, py, bbox, pad) {
  return px >= bbox.x - pad && px <= bbox.x + bbox.w + pad && py >= bbox.y - pad && py <= bbox.y + bbox.h + pad;
}

// Does the eraser at local point (lx,ly) with radius touch this annotation?
export function hitTestAnnotation(ann, lx, ly, t, radius = 6) {
  const g = localGeometry(ann, t);

  if (g.kind === 'stroke') {
    const pad = g.width / 2 + radius;
    return g.strokes.some(([a, b]) => distToSeg(lx, ly, a, b) <= pad);
  }

  if (g.kind === 'shape') {
    const style = ann.style || {};
    const pad = g.width / 2 + radius;
    const { shape, p1, p2, bbox } = g;
    if (shape === 'line' || shape === 'arrow') return distToSeg(lx, ly, p1, p2) <= pad;
    if (shape === 'rectangle') {
      if (style.fill_color && inRect(lx, ly, bbox, 0)) return true;
      const edges = [
        [{ x: bbox.x, y: bbox.y }, { x: bbox.x + bbox.w, y: bbox.y }],
        [{ x: bbox.x + bbox.w, y: bbox.y }, { x: bbox.x + bbox.w, y: bbox.y + bbox.h }],
        [{ x: bbox.x + bbox.w, y: bbox.y + bbox.h }, { x: bbox.x, y: bbox.y + bbox.h }],
        [{ x: bbox.x, y: bbox.y + bbox.h }, { x: bbox.x, y: bbox.y }]
      ];
      return edges.some(([a, b]) => distToSeg(lx, ly, a, b) <= pad);
    }
    if (shape === 'ellipse') {
      if (style.fill_color && inRect(lx, ly, bbox, 0)) return true;
      return distToEllipseBorder(lx, ly, bbox) <= pad;
    }
    // check / cross: test their path segments.
    const segs = shape === 'check'
      ? [
          [{ x: bbox.x + bbox.w * 0.15, y: bbox.y + bbox.h * 0.55 }, { x: bbox.x + bbox.w * 0.42, y: bbox.y + bbox.h * 0.82 }],
          [{ x: bbox.x + bbox.w * 0.42, y: bbox.y + bbox.h * 0.82 }, { x: bbox.x + bbox.w * 0.88, y: bbox.y + bbox.h * 0.2 }]
        ]
      : [
          [{ x: bbox.x + bbox.w * 0.15, y: bbox.y + bbox.h * 0.15 }, { x: bbox.x + bbox.w * 0.85, y: bbox.y + bbox.h * 0.85 }],
          [{ x: bbox.x + bbox.w * 0.85, y: bbox.y + bbox.h * 0.15 }, { x: bbox.x + bbox.w * 0.15, y: bbox.y + bbox.h * 0.85 }]
        ];
    return segs.some(([a, b]) => distToSeg(lx, ly, a, b) <= pad);
  }

  if (g.kind === 'text') {
    return inRect(lx, ly, g.box, radius);
  }

  return false;
}

// Find the topmost annotation under the eraser on this page.
export function hitTest(list, page, lx, ly, t, radius = 6, filter = 'all') {
  const pageAnns = filterForView(list, page, filter);
  for (let i = pageAnns.length - 1; i >= 0; i--) {
    if (hitTestAnnotation(pageAnns[i], lx, ly, t, radius)) return pageAnns[i];
  }
  return null;
}
