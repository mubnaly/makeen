// PDF.js wiring: worker setup, document load, page render (DPR-aware) and the
// text layer (fixes gap defect D6: selection + search + AI-citable text).

import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerSrc from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

export { pdfjsLib };

export async function loadDocument(bytes) {
  // Copy to a fresh ArrayBuffer so PDF.js can take ownership without detaching
  // a buffer the caller may reuse.
  const copy = bytes.slice ? bytes.slice(0) : bytes;
  return pdfjsLib.getDocument({ data: copy }).promise;
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
