// Minimal .xlsx writer (plan §7.5: local exports, no network, no account).
//
// An .xlsx is a ZIP archive of XML parts. This writer depends on nothing: it
// emits STORED (uncompressed) entries, which the spec allows and which needs no
// deflate, and uses inline strings so there is no sharedStrings part. Excel,
// LibreOffice and Google Sheets all open the result.
//
// The module is deliberately DOM-free (TextEncoder only) so the container and the
// worksheet XML can be asserted in Node (tests/xlsx.test.mjs) and validated with
// an independent unzipper (Windows Expand-Archive).

const encoder = new TextEncoder();

// --- checksums --------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// --- ZIP (stored entries) ---------------------------------------------------

function dosDateTime(date) {
  // MS-DOS packed time/date. Years before 1980 cannot be represented.
  const y = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((y - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

// entries: [{ name, text }] -> Uint8Array of a complete .zip
export function zipStore(entries, { now = new Date() } = {}) {
  const { time, date } = dosDateTime(now);
  const local = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const data = entry.bytes || encoder.encode(entry.text || '');
    const crc = crc32(data);

    const header = new Uint8Array(30 + nameBytes.length);
    const hv = new DataView(header.buffer);
    hv.setUint32(0, 0x04034b50, true); // local file header
    hv.setUint16(4, 20, true); // version needed
    hv.setUint16(6, 0, true); // flags (names are ASCII)
    hv.setUint16(8, 0, true); // method 0 = stored
    hv.setUint16(10, time, true);
    hv.setUint16(12, date, true);
    hv.setUint32(14, crc, true);
    hv.setUint32(18, data.length, true); // compressed size
    hv.setUint32(22, data.length, true); // uncompressed size
    hv.setUint16(26, nameBytes.length, true);
    hv.setUint16(28, 0, true); // extra field length
    header.set(nameBytes, 30);

    local.push(header, data);
    central.push({ nameBytes, crc, size: data.length, offset });
    offset += header.length + data.length;
  }

  const centralChunks = [];
  let centralSize = 0;
  for (const c of central) {
    const dir = new Uint8Array(46 + c.nameBytes.length);
    const dv = new DataView(dir.buffer);
    dv.setUint32(0, 0x02014b50, true); // central directory header
    dv.setUint16(4, 20, true); // version made by
    dv.setUint16(6, 20, true); // version needed
    dv.setUint16(8, 0, true); // flags
    dv.setUint16(10, 0, true); // method: stored
    dv.setUint16(12, time, true);
    dv.setUint16(14, date, true);
    dv.setUint32(16, c.crc, true);
    dv.setUint32(20, c.size, true);
    dv.setUint32(24, c.size, true);
    dv.setUint16(28, c.nameBytes.length, true);
    dv.setUint16(30, 0, true); // extra
    dv.setUint16(32, 0, true); // comment
    dv.setUint16(34, 0, true); // disk number
    dv.setUint16(36, 0, true); // internal attributes
    dv.setUint32(38, 0, true); // external attributes
    dv.setUint32(42, c.offset, true);
    dir.set(c.nameBytes, 46);
    centralChunks.push(dir);
    centralSize += dir.length;
  }

  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); // end of central directory
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, central.length, true);
  ev.setUint16(10, central.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true); // comment length

  const parts = [...local, ...centralChunks, end];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// --- worksheet --------------------------------------------------------------

// Control characters are illegal in XML 1.0 even escaped, so drop them.
export function escapeXml(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// 0-based column index -> spreadsheet column letters (0 -> A, 26 -> AA).
export function columnName(index) {
  let n = Math.max(0, Math.floor(index)) + 1;
  let name = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

// Excel rejects []:*?/\ in sheet names and caps them at 31 characters.
export function sanitizeSheetName(name, fallback = 'Sheet1') {
  const cleaned = String(name || '').replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31);
  return cleaned || fallback;
}

// --- embedded images --------------------------------------------------------

function readU32(bytes, at) {
  return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
}

// Natural size of a PNG or JPEG read straight from its header — no canvas, no
// DOM — so image placement can be decided (and tested) in Node.
//   PNG: 8-byte signature, then IHDR with big-endian width/height at 16/20.
//   JPEG: SOFn markers (C0-CF except C4/C8/CC) carry height then width.
export function imageSize(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4) return null;
  const pngSig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (pngSig.every((b, i) => bytes[i] === b)) {
    // IHDR width/height live at 16..23 — a real PNG always has those bytes.
    if (bytes.length < 24) return null;
    return { width: readU32(bytes, 16), height: readU32(bytes, 20), ext: 'png' };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let at = 2;
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) { at++; continue; }
      const marker = bytes[at + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { at += 2; continue; }
      const len = (bytes[at + 2] << 8) | bytes[at + 3];
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        return {
          height: (bytes[at + 5] << 8) | bytes[at + 6],
          width: (bytes[at + 7] << 8) | bytes[at + 8],
          ext: 'jpg'
        };
      }
      if (len < 2) return null;
      at += 2 + len;
    }
    return null;
  }
  return null;
}

export function cellXml(ref, value) {
  if (value == null || value === '') return `<c r="${ref}"/>`;
  // NaN/Infinity are numbers JavaScript-side but not in a spreadsheet: a blank
  // cell is honest, writing the text "NaN" is not.
  if (typeof value === 'number') {
    return Number.isFinite(value) ? `<c r="${ref}"><v>${value}</v></c>` : `<c r="${ref}"/>`;
  }
  if (typeof value === 'boolean') return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
  const text = value instanceof Date ? value.toISOString() : value;
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
}

function worksheetXml({ columns = [], rows = [], frozen = true, rowHeights = null, drawing = false }) {
  const cols = columns.length
    ? `<cols>${columns.map((c, i) => {
        const width = Number(c.width) > 0 ? Number(c.width) : 18;
        return `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`;
      }).join('')}</cols>`
    : '';
  const colsElement = cols ? `${frozen ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : ''}${cols}` : '';
  const body = rows.map((row, r) => {
    const n = r + 1;
    const cells = row.map((value, c) => cellXml(`${columnName(c)}${n}`, value)).join('');
    // Rows carrying an image declare a tall enough height so the picture sits
    // inside its own row instead of spilling over the next one.
    const ht = rowHeights && rowHeights.get(n);
    const attrs = ht ? ` ht="${ht.toFixed(2)}" customHeight="1"` : '';
    return `<row r="${n}"${attrs}>${cells}</row>`;
  }).join('');
  const xmlnsR = drawing
    ? ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
    : '';
  const drawingEl = drawing ? '<drawing r:id="rId1"/>' : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"${xmlnsR}>${colsElement}<sheetData>${body}</sheetData>${drawingEl}</worksheet>`;
}

// --- drawing layer ----------------------------------------------------------

const EMU_PER_PX = 9525; // 96 dpi

function colPixelWidth(columns, index) {
  const width = Number(columns[index]?.width) > 0 ? Number(columns[index].width) : 18;
  return Math.round(width * 7 + 5); // Excel's default char width + cell padding
}

// One <xdr:oneCellAnchor> per image, sized to fit its column (never wider than
// the column, never taller than MAX_IMAGE_PX) and centred horizontally in it.
function drawingXml(images, layout) {
  const anchors = images.map((img, i) => {
    const l = layout[i];
    const cx = Math.round(l.w * EMU_PER_PX);
    const cy = Math.round(l.h * EMU_PER_PX);
    return `<xdr:oneCellAnchor><xdr:from><xdr:col>${img.col}</xdr:col><xdr:colOff>${Math.round(l.left * EMU_PER_PX)}</xdr:colOff><xdr:row>${l.sheetRow - 1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="${cx}" cy="${cy}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${i + 1}" name="image${i + 1}"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId${i + 1}"/><xdr:stretch><a:fillRect/></xdr:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${anchors}</xdr:wsDr>`;
}

function drawingRelsXml(images) {
  const rels = images.map((img, i) =>
    `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${i + 1}.${img.ext}"/>`
  ).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`;
}

const MAX_IMAGE_PX = 260;

// Decide each image's on-sheet size/position: fit the column width (allowing a
// modest upscale for small captures) and the row height, keep the aspect ratio,
// and give the row an explicit height in points (1 px = 0.75 pt).
function planImageLayout(images, columns, rowsBeforeImages, headerRows) {
  return images.map((img) => {
    const natural = img.width && img.height ? { width: img.width, height: img.height } : imageSize(img.data);
    if (!natural || !natural.width || !natural.height) return null;
    const availW = colPixelWidth(columns, img.col);
    const scale = Math.min(availW / natural.width, MAX_IMAGE_PX / natural.height, 2);
    const w = Math.max(8, natural.width * scale);
    const h = Math.max(8, natural.height * scale);
    const sheetRow = headerRows + 1 + img.row; // img.row is 0-based into `rows`
    if (sheetRow < 1 || sheetRow - headerRows - 1 >= rowsBeforeImages) return null;
    return { w, h, left: (availW - w) / 2, sheetRow, ext: img.ext || natural.ext || 'png' };
  });
}

// --- workbook ---------------------------------------------------------------

// columns: [{ label, width? }]; rows: array of arrays (strings, numbers, dates).
// images: [{ row, col, data:Uint8Array, ext?, width?, height? }] — `row` is the
// 0-based index into `rows` (header excluded), `col` the 0-based column. Images
// are written as a drawing layer over their cell, which is how Excel embeds
// pictures "inside the sheet" while the cells stay real text.
export function sheetToXlsx({ sheetName = 'Sheet1', columns = [], rows = [], images = [], now = new Date() } = {}) {
  const sheet = sanitizeSheetName(sheetName);
  const header = columns.length ? [columns.map((c) => c.label ?? '')] : [];
  const headerRows = header.length;
  const allRows = [...header, ...rows];

  // Keep images whose layout resolved, with their positional index for the
  // drawing/media parts (rIdN and imageN must line up).
  const fullLayout = planImageLayout(images, columns, rows.length, headerRows);
  const indexed = images.map((img, i) => ({ img, l: fullLayout[i], i })).filter((x) => x.l);
  const rowHeights = new Map();
  for (const { l } of indexed) {
    const pt = l.h * 0.75 + 4;
    rowHeights.set(l.sheetRow, Math.max(rowHeights.get(l.sheetRow) || 0, pt));
  }
  const mediaEntries = indexed.map(({ img, l }, n) => ({
    name: `xl/media/image${n + 1}.${l.ext}`,
    bytes: img.data
  }));
  const hasImages = indexed.length > 0;

  const entries = [
    {
      name: '[Content_Types].xml',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>${
        hasImages
          ? `\n<Default Extension="png" ContentType="image/png"/>\n<Default Extension="jpg" ContentType="image/jpeg"/>\n<Default Extension="jpeg" ContentType="image/jpeg"/>\n<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`
          : ''
      }
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`
    },
    {
      name: '_rels/.rels',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`
    },
    {
      name: 'xl/workbook.xml',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${escapeXml(sheet)}" sheetId="1" r:id="rId1"/></sheets></workbook>`
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`
    },
    { name: 'xl/worksheets/sheet1.xml', text: worksheetXml({ columns, rows: allRows, frozen: columns.length > 0, rowHeights, drawing: hasImages }) }
  ];

  if (hasImages) {
    entries.push(
      {
        name: 'xl/worksheets/_rels/sheet1.xml.rels',
        text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>
</Relationships>`
      },
      { name: 'xl/drawings/drawing1.xml', text: drawingXml(indexed.map(({ img, l }) => ({ ...img, ext: l.ext })), indexed.map(({ l }) => l)) },
      { name: 'xl/drawings/_rels/drawing1.xml.rels', text: drawingRelsXml(indexed.map(({ l }) => l)) },
      ...mediaEntries
    );
  }

  return zipStore(entries, { now });
}
