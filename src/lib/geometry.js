// Canonical annotation coordinate system (fixes gap-analysis defect D2).
//
// Coordinates are stored NORMALIZED to the page's unrotated rectangle:
//   u = horizontal position in [0,1], 0 = left edge
//   v = vertical position in [0,1],   0 = top edge
// The page's intrinsic (unrotated) size is (pageWidth, pageHeight) in page
// units (PDF points). Nothing here ever stores zoom-scaled or screen pixels, so
// annotations stay glued to the same content across zoom, resize, device-pixel
// ratio and rotation (plan §7.1).
//
// A transform converts normalized page coordinates to/from the local display
// pixels of one rendered page canvas at a given `scale` (CSS px per page unit)
// and `rotation` (0/90/180/270, clockwise). Display pixel (0,0) is the top-left
// of the rendered page element.

export const ROTATIONS = [0, 90, 180, 270];

function assertRotation(rotation) {
  if (!ROTATIONS.includes(rotation)) {
    throw new Error(`Unsupported rotation: ${rotation}`);
  }
}

// Displayed page size in CSS pixels for a given scale + rotation.
export function displaySize(pageWidth, pageHeight, scale, rotation = 0) {
  assertRotation(rotation);
  const swapped = rotation === 90 || rotation === 270;
  return {
    width: (swapped ? pageHeight : pageWidth) * scale,
    height: (swapped ? pageWidth : pageHeight) * scale
  };
}

// Map normalized (u,v) -> display pixel (x,y).
export function toDisplayPoint(u, v, { pageWidth, pageHeight, scale, rotation = 0 }) {
  assertRotation(rotation);
  const W = pageWidth * scale;
  const H = pageHeight * scale;
  switch (rotation) {
    case 90:
      return [(1 - v) * H, u * W];
    case 180:
      return [(1 - u) * W, (1 - v) * H];
    case 270:
      return [v * H, (1 - u) * W];
    default:
      return [u * W, v * H];
  }
}

// Map display pixel (x,y) -> normalized (u,v). Exact inverse of toDisplayPoint.
export function toCanonicalPoint(x, y, { pageWidth, pageHeight, scale, rotation = 0 }) {
  assertRotation(rotation);
  const W = pageWidth * scale;
  const H = pageHeight * scale;
  switch (rotation) {
    case 90:
      return [y / W, 1 - x / H];
    case 180:
      return [1 - x / W, 1 - y / H];
    case 270:
      return [1 - y / W, x / H];
    default:
      return [x / W, y / H];
  }
}

// `thickness` is stored as a fraction of the unrotated page height (plan §7.1
// asks for a documented logical/page-unit model). Its rendered stroke width in
// CSS px is thickness * pageHeight * scale, independent of rotation, so the
// stroke stays centered on the pointer at every zoom level.
export function strokeWidthToDisplay(thickness, { pageHeight, scale }) {
  return Math.max(0.25, thickness * pageHeight * scale);
}

export function strokeWidthFromDisplay(px, { pageHeight, scale }) {
  return px / (pageHeight * scale);
}

// Build a reusable transform bound to one rendered page.
export function createTransform({ pageWidth, pageHeight, scale, rotation = 0, offsetX = 0, offsetY = 0 }) {
  if (!(pageWidth > 0) || !(pageHeight > 0)) throw new Error('pageWidth/pageHeight must be positive');
  if (!(scale > 0)) throw new Error('scale must be positive');
  const opts = { pageWidth, pageHeight, scale, rotation };
  const size = displaySize(pageWidth, pageHeight, scale, rotation);
  return {
    pageWidth,
    pageHeight,
    scale,
    rotation,
    offsetX,
    offsetY,
    displayWidth: size.width,
    displayHeight: size.height,
    // Client (viewport) pixel -> normalized page coordinate.
    fromClient(clientX, clientY) {
      const [u, v] = toCanonicalPoint(clientX - offsetX, clientY - offsetY, opts);
      return [clamp01(u), clamp01(v)];
    },
    // Normalized page coordinate -> client (viewport) pixel.
    toClient(u, v) {
      const [x, y] = toDisplayPoint(u, v, opts);
      return [x + offsetX, y + offsetY];
    },
    // Normalized page coordinate -> local display px inside the canvas element.
    toLocal(u, v) {
      return toDisplayPoint(u, v, opts);
    },
    fromLocal(x, y) {
      const [u, v] = toCanonicalPoint(x, y, opts);
      return [clamp01(u), clamp01(v)];
    },
    strokeWidth(thickness) {
      return strokeWidthToDisplay(thickness, { pageHeight, scale });
    },
    thicknessFromWidth(px) {
      return strokeWidthFromDisplay(px, { pageHeight, scale });
    }
  };
}

export function clamp01(n) {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
