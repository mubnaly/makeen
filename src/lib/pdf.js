// PDF.js wiring: worker setup, document load, page render (DPR-aware) and the
// text layer (fixes gap defect D6: selection + search + AI-citable text).

import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerSrc from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

export { pdfjsLib };

// LRU Document cache to make opening and switching between 20-30 PDF tabs instantaneous
const MAX_CACHED_DOCS = 40;
const pdfDocCache = new Map();

export function evictPdfDocCache(docId) {
  if (!docId) return;
  const cached = pdfDocCache.get(docId);
  if (cached) {
    pdfDocCache.delete(docId);
    try { cached.destroy(); } catch {}
  }
}

export function clearPdfDocCache() {
  for (const doc of pdfDocCache.values()) {
    try { doc?.destroy(); } catch {}
  }
  pdfDocCache.clear();
}

export async function loadDocument(bytes, docId = null) {
  if (docId && pdfDocCache.has(docId)) {
    const cached = pdfDocCache.get(docId);
    if (cached && !cached._transport?.destroyed) {
      // Refresh LRU ordering
      pdfDocCache.delete(docId);
      pdfDocCache.set(docId, cached);
      return cached;
    }
    pdfDocCache.delete(docId);
  }

  // Normalize any view/typed array into a clean standalone ArrayBuffer
  let data;
  if (bytes instanceof ArrayBuffer) {
    data = bytes.slice(0);
  } else if (ArrayBuffer.isView(bytes)) {
    data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  } else if (bytes?.data && Array.isArray(bytes.data)) {
    data = new Uint8Array(bytes.data).buffer;
  } else if (Array.isArray(bytes)) {
    data = new Uint8Array(bytes).buffer;
  } else {
    data = bytes;
  }

  let doc = null;
  try {
    doc = await pdfjsLib.getDocument({ data }).promise;
  } catch (err) {
    console.warn('PDF.js worker initialization failed, falling back to main-thread parser:', err);
    // If worker spawn is blocked by file:// origin or WebView2 custom protocol:
    const prevSrc = pdfjsLib.GlobalWorkerOptions.workerSrc;
    pdfjsLib.GlobalWorkerOptions.workerSrc = '';
    try {
      doc = await pdfjsLib.getDocument({ data }).promise;
    } catch (fallbackErr) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = prevSrc;
      throw fallbackErr;
    }
  }

  if (doc && docId) {
    if (pdfDocCache.size >= MAX_CACHED_DOCS) {
      const oldestKey = pdfDocCache.keys().next().value;
      const oldestDoc = pdfDocCache.get(oldestKey);
      pdfDocCache.delete(oldestKey);
      try { oldestDoc?.destroy(); } catch {}
    }
    pdfDocCache.set(docId, doc);
  }

  return doc;
}

// Render one page into a canvas at scale * devicePixelRatio, CSS-sized to the
// logical scale so coordinates map cleanly through the transform.
export async function renderPageToCanvas(page, { scale, rotation, canvas, dpr = window.devicePixelRatio || 1, onTask = null }) {
  if (!canvas) return null;
  const viewport = page.getViewport({ scale, rotation });
  const maxDim = Math.max(viewport.width, viewport.height);
  // Cap effective DPR so total pixel dimension stays within GPU limits (prevents canvas context loss)
  const safeDpr = maxDim * dpr > 3800 ? Math.max(1, 3800 / maxDim) : dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  canvas.width = Math.max(1, Math.floor(viewport.width * safeDpr));
  canvas.height = Math.max(1, Math.floor(viewport.height * safeDpr));
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;

  const task = page.render({
    canvasContext: ctx,
    viewport,
    transform: safeDpr !== 1 ? [safeDpr, 0, 0, safeDpr, 0, 0] : null
  });

  if (typeof onTask === 'function') onTask(task);

  try {
    await task.promise;
  } catch (err) {
    if (err?.name === 'RenderingCancelledException') {
      return null;
    }
    throw err;
  }

  return viewport;
}

// Render the selectable text layer (D6). Uses the modern TextLayer API. Failures
// are non-fatal: the PDF still renders without text selection.
export async function renderTextLayer(page, { scale, rotation, container }) {
  try {
    if (!container) return false;
    container.replaceChildren();
    const viewport = page.getViewport({ scale, rotation });
    const layer = new pdfjsLib.TextLayer({
      // TextLayer consumes the page's text *stream*; a plain getTextContent()
      // result is not a stream and its render() never settles, leaving the
      // page stuck without a selectable text layer.
      textContentSource: page.streamTextContent(),
      container,
      viewport
    });
    await layer.render();
    return true;
  } catch {
    return false;
  }
}

export async function extractPageText(page) {
  try {
    const content = await page.getTextContent();
    return content.items.map((it) => it.str).join(' ');
  } catch {
    return '';
  }
}
