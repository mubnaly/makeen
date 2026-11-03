// Native .docx generator for StudyOS Dual Studio notes.
// Packages headings (H1-H6), RTL Arabic/English paragraphs, and embedded study captures into
// a standard OpenXML (.docx) ZIP archive readable by Microsoft Word, LibreOffice, and Google Docs.

import { zipStore } from './xlsx.js';

const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function dataUrlToBytes(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const match = dataUrl.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/);
  if (!match) return null;
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return { bytes, ext: match[1] === 'jpeg' ? 'jpg' : match[1] };
}

export function buildDocxXml({ title = 'StudyOS Notes', items = [], now = new Date() } = {}) {
  const images = [];
  let relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n` +
    `  <Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>\n`;

  let bodyXml = '';

  // Document Title
  const titleRtl = ARABIC_RE.test(title);
  bodyXml += `<w:p><w:pPr><w:pStyle w:val="Title"/>${titleRtl ? '<w:bidi/><w:jc w:val="right"/>' : ''}<w:spacing w:before="240" w:after="240"/></w:pPr>` +
    `<w:r><w:rPr>${titleRtl ? '<w:rtl/>' : ''}<w:b/><w:sz w:val="56"/><w:szCs w:val="56"/></w:rPr><w:t>${escapeXml(title)}</w:t></w:r></w:p>\n`;

  // Date / Subtitle
  const dateStr = now.toLocaleDateString();
  bodyXml += `<w:p><w:pPr><w:spacing w:after="360"/><w:jc w:val="${titleRtl ? 'right' : 'left'}"/></w:pPr>` +
    `<w:r><w:rPr><w:color w:val="666666"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr><w:t>Generated with StudyOS Dual Studio • ${escapeXml(dateStr)}</w:t></w:r></w:p>\n`;

  let imgCounter = 0;

  for (const item of items) {
    if (!item) continue;

    // 1. Heading or Text Paragraph
    if (item.text && item.text.trim()) {
      const heading = (item.heading || 'p').toLowerCase();
      const isHeading = /^h[1-6]$/.test(heading);
      const level = isHeading ? parseInt(heading.slice(1), 10) : 0;
      const isRtl = ARABIC_RE.test(item.text);

      let sz = 24; // 12pt
      let spaceBefore = 80;
      let spaceAfter = 120;
      let isBold = false;

      if (level === 1) { sz = 44; spaceBefore = 360; spaceAfter = 140; isBold = true; }
      else if (level === 2) { sz = 36; spaceBefore = 280; spaceAfter = 120; isBold = true; }
      else if (level === 3) { sz = 30; spaceBefore = 220; spaceAfter = 100; isBold = true; }
      else if (level === 4) { sz = 26; spaceBefore = 180; spaceAfter = 80; isBold = true; }
      else if (level === 5) { sz = 24; spaceBefore = 140; spaceAfter = 60; isBold = true; }
      else if (level === 6) { sz = 22; spaceBefore = 100; spaceAfter = 50; isBold = true; }

      // Source annotation if present
      if (item.source || item.sourceDetail) {
        const sourceLabel = `[${item.source === 'video' ? 'Video' : 'PDF'}${item.sourceDetail ? ': ' + item.sourceDetail : ''}]`;
        bodyXml += `<w:p><w:pPr><w:spacing w:before="120" w:after="40"/><w:jc w:val="${isRtl ? 'right' : 'left'}"/></w:pPr>` +
          `<w:r><w:rPr><w:color w:val="888888"/><w:sz w:val="18"/><w:szCs w:val="18"/><w:i/></w:rPr><w:t>${escapeXml(sourceLabel)}</w:t></w:r></w:p>\n`;
      }

      bodyXml += `<w:p><w:pPr>` +
        (isHeading ? `<w:pStyle w:val="Heading${level}"/>` : '') +
        (isRtl ? `<w:bidi/><w:jc w:val="right"/>` : '') +
        `<w:spacing w:before="${spaceBefore}" w:after="${spaceAfter}"/>` +
        `</w:pPr>` +
        `<w:r><w:rPr>` +
        (isRtl ? `<w:rtl/>` : '') +
        (isBold ? `<w:b/><w:bCs/>` : '') +
        `<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>` +
        `</w:rPr><w:t xml:space="preserve">${escapeXml(item.text)}</w:t></w:r></w:p>\n`;
    }

    // 2. Embedded Image if present
    if (item.image) {
      const parsed = dataUrlToBytes(item.image);
      if (parsed) {
        imgCounter++;
        const relId = `rIdImg${imgCounter}`;
        const filename = `image${imgCounter}.${parsed.ext}`;
        images.push({ name: `word/media/${filename}`, bytes: parsed.bytes });

        relsXml += `  <Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${filename}"/>\n`;

        // Standard image display size: 5.5 inches wide (~5029200 EMUs), aspect-ratio ~16:9 (~2828925 EMUs)
        const cx = 5029200;
        const cy = 2828925;

        bodyXml += `<w:p><w:pPr><w:spacing w:before="120" w:after="240"/><w:jc w:val="center"/></w:pPr><w:r><w:drawing>` +
          `<wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">` +
          `<wp:extent cx="${cx}" cy="${cy}"/>` +
          `<wp:docPr id="${imgCounter}" name="Capture ${imgCounter}"/>` +
          `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
          `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
          `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
          `<pic:nvPicPr><pic:cNvPr id="${imgCounter}" name="Picture ${imgCounter}"/><pic:cNvPicPr/></pic:nvPicPr>` +
          `<pic:blipFill>` +
          `<a:blip r:embed="${relId}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>` +
          `<a:stretch><a:fillRect/></a:stretch>` +
          `</pic:blipFill>` +
          `<pic:spPr>` +
          `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
          `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
          `</pic:spPr>` +
          `</pic:pic>` +
          `</a:graphicData>` +
          `</a:graphic>` +
          `</wp:inline>` +
          `</w:drawing></w:r></w:p>\n`;
      }
    }
  }

  relsXml += `</Relationships>`;

  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">\n` +
    `<w:body>\n${bodyXml}` +
    `  <w:sectPr>` +
    `    <w:pgSz w:w="11906" w:h="16838"/>` + // A4 size
    `    <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>` + // 1 inch margins
    `  </w:sectPr>` +
    `</w:body></w:document>`;

  return { docXml, relsXml, images };
}

export function notesToDocx(items = [], options = {}) {
  const { docXml, relsXml, images } = buildDocxXml({ items, ...options });

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n` +
    `  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n` +
    `  <Default Extension="xml" ContentType="application/xml"/>\n` +
    `  <Default Extension="png" ContentType="image/png"/>\n` +
    `  <Default Extension="jpeg" ContentType="image/jpeg"/>\n` +
    `  <Default Extension="jpg" ContentType="image/jpeg"/>\n` +
    `  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>\n` +
    `  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>\n` +
    `</Types>`;

  const packageRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n` +
    `  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>\n` +
    `</Relationships>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">\n` +
    `  <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Segoe UI" w:hAnsi="Segoe UI" w:cs="Traditional Arabic"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>\n` +
    `</w:styles>`;

  const entries = [
    { name: '[Content_Types].xml', text: contentTypesXml },
    { name: '_rels/.rels', text: packageRelsXml },
    { name: 'word/document.xml', text: docXml },
    { name: 'word/_rels/document.xml.rels', text: relsXml },
    { name: 'word/styles.xml', text: stylesXml },
    ...images
  ];

  return zipStore(entries);
}
