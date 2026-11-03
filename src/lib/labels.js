// PDF captions are rasterized through the browser's own text shaping. The PDF
// standard fonts bundled with pdf-lib are WinAnsi-only, so a caption such as
// "محاضرة.pdf · ص12 · ملاحظات" used to become "???.pdf · p12 · ??? ?12".
// Canvas keeps Arabic joining, RTL order and mixed digits intact, and the PNG is
// embedded by imagesToPdf.
export function labelPng(text, {
  width = 1600,
  height = 64,
  font = '30px system-ui, -apple-system, "Segoe UI", "Noto Sans Arabic", sans-serif',
  color = '#595a63',
  padding = 10
} = {}) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.round(width));
  canvas.height = Math.max(2, Math.round(height));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  const rtl = /[\u0590-\u08FF]/.test(String(text || ''));
  ctx.direction = rtl ? 'rtl' : 'ltr';
  ctx.textAlign = rtl ? 'right' : 'left';
  const x = rtl ? canvas.width - padding : padding;
  ctx.fillText(String(text || ''), x, canvas.height / 2, canvas.width - padding * 2);
  return canvas.toDataURL('image/png');
}
