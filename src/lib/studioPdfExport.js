// PDF generator for StudyOS Dual Studio & Video Study Notes.
// Supports Arabic, RTL, rich headings (H1-H6), and embedded capture images.

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

function isArabicText(text) {
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(text || '');
}

function safeLatin(text) {
  return String(text || '').replace(/[^\x00-\x7F]/g, '?');
}

// Canvas-based renderer for Browser/Electron environment:
// Uses the browser's native text shaper for perfect Arabic ligatures, RTL alignment, and font families.
async function renderNotesToCanvasPages(items, title) {
  const pages = [];
  const width = 1190; // 2x A4 width (595 * 2)
  const height = 1684; // 2x A4 height (842 * 2)
  const margin = 80;
  const contentWidth = width - margin * 2;

  let canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  let ctx = canvas.getContext('2d');

  function initPage() {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
  }

  initPage();
  let currentY = margin + 40;

  function newPage() {
    pages.push(canvas.toDataURL('image/jpeg', 0.92));
    canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    ctx = canvas.getContext('2d');
    initPage();
    currentY = margin + 40;
  }

  function checkBreak(needed) {
    if (currentY + needed > height - margin) {
      newPage();
    }
  }

  // Draw Header
  const titleRtl = isArabicText(title);
  ctx.direction = titleRtl ? 'rtl' : 'ltr';
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 36px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif';
  ctx.fillText(title, titleRtl ? width - margin : margin, currentY);
  currentY += 46;

  ctx.fillStyle = '#64748b';
  ctx.font = '20px "Cairo", "Segoe UI", Arial, sans-serif';
  const sub = `StudyOS • ${new Date().toLocaleDateString()}`;
  ctx.fillText(sub, titleRtl ? width - margin : margin, currentY);
  currentY += 32;

  // Divider line
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(margin, currentY);
  ctx.lineTo(width - margin, currentY);
  ctx.stroke();
  currentY += 36;

  // Draw Items
  for (const item of items) {
    if (!item) continue;

    // Source tag
    if (item.source || item.sourceDetail) {
      checkBreak(40);
      const tag = `[${item.source === 'video' ? 'Video' : 'PDF'}${item.sourceDetail ? ': ' + item.sourceDetail : ''}]`;
      ctx.direction = 'ltr';
      ctx.fillStyle = '#2563eb';
      ctx.font = 'bold 18px "Cairo", "Segoe UI", Arial, sans-serif';
      ctx.fillText(tag, margin, currentY);
      currentY += 30;
    }

    // Text & Heading
    if (item.text && item.text.trim()) {
      const heading = (item.heading || 'p').toLowerCase();
      let fontSize = 22;
      let fontWeight = 'normal';
      let fontColor = '#1e293b';

      if (heading === 'h1') { fontSize = 34; fontWeight = 'bold'; fontColor = '#0f172a'; }
      else if (heading === 'h2') { fontSize = 28; fontWeight = 'bold'; fontColor = '#1e293b'; }
      else if (heading === 'h3') { fontSize = 25; fontWeight = 'bold'; fontColor = '#334155'; }
      else if (heading === 'h4') { fontSize = 22; fontWeight = 'bold'; }
      else if (heading === 'h5' || heading === 'h6') { fontSize = 20; fontWeight = 'bold'; }

      const isRtl = isArabicText(item.text);
      ctx.direction = isRtl ? 'rtl' : 'ltr';
      ctx.fillStyle = fontColor;
      ctx.font = `${fontWeight} ${fontSize}px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif`;

      const words = item.text.split(/\s+/);
      let line = '';
      const lines = [];
      for (const w of words) {
        const testLine = line ? `${line} ${w}` : w;
        const testWidth = ctx.measureText(testLine).width;
        if (testWidth > contentWidth && line) {
          lines.push(line);
          line = w;
        } else {
          line = testLine;
        }
      }
      if (line) lines.push(line);

      const blockHeight = lines.length * (fontSize * 1.4) + 16;
      checkBreak(blockHeight);

      for (const l of lines) {
        const startX = isRtl ? width - margin : margin;
        ctx.fillText(l, startX, currentY);
        currentY += Math.round(fontSize * 1.4);
      }
      currentY += 16;
    }

    // Image Embed
    if (item.image) {
      try {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        await new Promise((res, rej) => {
          img.onload = res;
          img.onerror = rej;
          img.src = item.image;
        });

        const aspect = img.width / (img.height || 1);
        let imgW = contentWidth;
        let imgH = imgW / aspect;
        if (imgH > 600) {
          imgH = 600;
          imgW = imgH * aspect;
        }

        checkBreak(imgH + 30);
        const imgX = margin + (contentWidth - imgW) / 2;
        ctx.drawImage(img, imgX, currentY, imgW, imgH);
        currentY += imgH + 28;
      } catch (err) {
        console.warn('Canvas image embed skipped:', err);
      }
    }

    currentY += 12;
  }

  pages.push(canvas.toDataURL('image/jpeg', 0.92));
  return pages;
}

export async function notesToPdf(items = [], { title = 'StudyOS Notes' } = {}) {
  const pdfDoc = await PDFDocument.create();

  // If in browser/DOM environment, use the canvas page renderer for 100% Arabic, RTL, and formatting
  if (typeof document !== 'undefined' && typeof Image !== 'undefined') {
    try {
      const pageDataUrls = await renderNotesToCanvasPages(items, title);
      for (const dataUrl of pageDataUrls) {
        const jpgImage = await pdfDoc.embedJpg(dataUrl);
        const page = pdfDoc.addPage([595, 842]);
        page.drawImage(jpgImage, {
          x: 0,
          y: 0,
          width: 595,
          height: 842
        });
      }
      return await pdfDoc.save();
    } catch (e) {
      console.warn('Fallback to standard pdf-lib layout:', e);
    }
  }

  // Headless Node fallback
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const page = pdfDoc.addPage([595, 842]);
  page.drawText(safeLatin(title), { x: 50, y: 800, size: 20, font: boldFont, color: rgb(0.1, 0.1, 0.15) });
  let y = 760;
  for (const item of items) {
    if (item.text) {
      page.drawText(safeLatin(item.text.slice(0, 80)), { x: 50, y, size: 11, font, color: rgb(0.2, 0.2, 0.2) });
      y -= 20;
    }
  }
  return await pdfDoc.save();
}
