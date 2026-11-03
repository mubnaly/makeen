// .xlsx writer tests (src/lib/xlsx.js).
//
// The container is checked with an independently written ZIP reader (parsed from
// the spec, not shared with the writer) and a bit-by-bit CRC32, so a bug in the
// writer's table-driven checksum cannot hide behind itself.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sheetToXlsx,
  zipStore,
  crc32,
  escapeXml,
  columnName,
  sanitizeSheetName,
  cellXml,
  imageSize
} from '../src/lib/xlsx.js';

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

function crc32Slow(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function readZip(bytes) {
  const buf = Buffer.from(bytes);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) { eocd = i; break; }
  }
  assert.ok(eocd >= 0, 'end of central directory record present');
  const count = buf.readUInt16LE(eocd + 10);
  assert.equal(buf.readUInt16LE(eocd + 8), count, 'entry count repeated');
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  assert.equal(cdOffset + cdSize, eocd, 'central directory ends where the EOCD starts');

  const entries = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), SIG_CENTRAL, 'central directory entry signature');
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);

    assert.equal(buf.readUInt32LE(localOffset), SIG_LOCAL, `local header for ${name}`);
    assert.equal(buf.readUInt16LE(localOffset + 8), method, 'local and central methods agree');
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    assert.equal(buf.toString('utf8', localOffset + 30, localOffset + 30 + localNameLen), name, 'names agree');
    const dataStart = localOffset + 30 + localNameLen + buf.readUInt16LE(localOffset + 28);
    const data = buf.subarray(dataStart, dataStart + size);

    assert.equal(method, 0, 'entries are STORED');
    assert.equal(buf.readUInt32LE(localOffset + 22), size, 'uncompressed size in the local header');
    assert.equal(crc32Slow(data), crc, `crc32 matches for ${name}`);

    entries.push({ name, text: data.toString('utf8'), bytes: data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  assert.equal(p, eocd, 'central directory consumed exactly');
  return entries;
}

// --- primitives -------------------------------------------------------------

test('crc32 matches a bit-by-bit reference implementation', () => {
  for (const input of ['', 'a', '123456789', 'StudyOS · الخلية تنقسم']) {
    const bytes = new TextEncoder().encode(input);
    assert.equal(crc32(bytes), crc32Slow(bytes), `crc for ${JSON.stringify(input)}`);
  }
  assert.equal(crc32(new Uint8Array(0)), 0, 'empty input');
});

test('columnName counts past Z like a spreadsheet', () => {
  assert.equal(columnName(0), 'A');
  assert.equal(columnName(25), 'Z');
  assert.equal(columnName(26), 'AA');
  assert.equal(columnName(701), 'ZZ');
  assert.equal(columnName(702), 'AAA');
});

test('escapeXml escapes markup and strips control characters', () => {
  assert.equal(escapeXml('a & b < c > d " e \' f'), 'a &amp; b &lt; c &gt; d &quot; e &apos; f');
  assert.equal(escapeXml('tab\there\nnewline'), 'tab\there\nnewline', 'tab/newline are legal in XML 1.0');
  assert.equal(escapeXml('bad\u0007char\u001f'), 'badchar');
  assert.ok(!escapeXml('x\u0000y').includes('\u0000'));
  // Arabic must survive untouched (no numeric entities, no mojibake).
  assert.equal(escapeXml('الخلية'), 'الخلية');
});

test('sanitizeSheetName enforces Excel rules', () => {
  assert.equal(sanitizeSheetName('Chapter 1: Intro'), 'Chapter 1 Intro');
  assert.equal(sanitizeSheetName('a/b\\c[d]e*f?g'), 'a b c d e f g');
  assert.equal(sanitizeSheetName('x'.repeat(60)).length, 31);
  assert.equal(sanitizeSheetName('   '), 'Sheet1');
  assert.equal(sanitizeSheetName(''), 'Sheet1');
  assert.equal(sanitizeSheetName(null, 'Set'), 'Set');
});

test('cellXml writes numbers, booleans, strings and blanks', () => {
  assert.equal(cellXml('A1', 42), '<c r="A1"><v>42</v></c>');
  assert.equal(cellXml('B2', true), '<c r="B2" t="b"><v>1</v></c>');
  assert.match(cellXml('C3', 'hi'), /t="inlineStr"><is><t xml:space="preserve">hi<\/t>/);
  assert.equal(cellXml('D4', ''), '<c r="D4"/>');
  assert.equal(cellXml('E5', null), '<c r="E5"/>');
  assert.equal(cellXml('F6', Number.NaN), '<c r="F6"/>', 'NaN cannot be a number cell');
  assert.equal(cellXml('G7', 0), '<c r="G7"><v>0</v></c>', 'zero is a real value');
  assert.match(cellXml('H8', '<script>'), /&lt;script&gt;/);
});

// --- container --------------------------------------------------------------

test('zipStore produces a readable archive with correct offsets and checksums', () => {
  const zip = zipStore([
    { name: 'a.txt', text: 'hello' },
    { name: 'nested/b.txt', text: '' },
    { name: 'c.bin', bytes: new Uint8Array([1, 2, 3, 250]) }
  ], { now: new Date(2026, 9, 16, 9, 30, 0) });
  const entries = readZip(zip);
  assert.deepEqual(entries.map((e) => e.name), ['a.txt', 'nested/b.txt', 'c.bin']);
  assert.equal(entries[0].text, 'hello');
  assert.equal(entries[1].text, '');
  assert.deepEqual([...entries[2].bytes], [1, 2, 3, 250]);
});

// --- workbook ---------------------------------------------------------------

test('sheetToXlsx writes the required parts with a frozen header row', () => {
  const bytes = sheetToXlsx({
    sheetName: 'Biology',
    columns: [{ label: 'Front', width: 42 }, { label: 'Back' }],
    rows: [['Cell?', 'The unit of life'], ['2 + 2', 4]]
  });
  const entries = readZip(bytes);
  assert.deepEqual(
    entries.map((e) => e.name).sort(),
    ['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml'].sort()
  );
  const types = entries.find((e) => e.name === '[Content_Types].xml').text;
  assert.match(types, /spreadsheetml\.sheet\.main\+xml/);
  assert.match(types, /spreadsheetml\.worksheet\+xml/);

  const workbook = entries.find((e) => e.name === 'xl/workbook.xml').text;
  assert.match(workbook, /<sheet name="Biology" sheetId="1" r:id="rId1"\/>/);
  assert.match(entries.find((e) => e.name === '_rels/.rels').text, /officeDocument.*xl\/workbook\.xml/);
  assert.match(entries.find((e) => e.name === 'xl/_rels/workbook.xml.rels').text, /worksheets\/sheet1\.xml/);

  const sheet = entries.find((e) => e.name === 'xl/worksheets/sheet1.xml').text;
  assert.match(sheet, /<pane ySplit="1"/, 'header row frozen');
  assert.match(sheet, /<col min="1" max="1" width="42" customWidth="1"\/>/);
  assert.match(sheet, /<col min="2" max="2" width="18" customWidth="1"\/>/, 'default width');

  // Header then data rows, addressed by column letter + row number.
  assert.match(sheet, /<c r="A1" t="inlineStr"><is><t xml:space="preserve">Front<\/t><\/is><\/c>/);
  assert.match(sheet, /<c r="B1" t="inlineStr"><is><t xml:space="preserve">Back<\/t><\/is><\/c>/);
  assert.match(sheet, /<row r="2"><c r="A2" t="inlineStr"><is><t xml:space="preserve">Cell\?<\/t><\/is><\/c><c r="B2" t="inlineStr">/);
  assert.match(sheet, /<c r="B3"><v>4<\/v><\/c>/, 'numbers stay numeric');
});

test('sheetToXlsx sanitizes the sheet name and survives a sheet with no columns', () => {
  const named = readZip(sheetToXlsx({ sheetName: 'Set/1 : "x" '.repeat(4), columns: [{ label: 'A' }], rows: [] }));
  // The attribute is XML-escaped in the part, so unescape before measuring.
  const name = named.find((e) => e.name === 'xl/workbook.xml').text
    .match(/<sheet name="([^"]*)"/)[1]
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  assert.ok(name.length <= 31, `name length ${name.length} (${name})`);
  assert.ok(!/[[\]:*?/\\]/.test(name), `no invalid characters in ${name}`);
  assert.equal(name, 'Set 1 "x" Set 1 "x" Set 1 "x" S', 'truncated to 31 characters of the sanitized name');

  const bare = readZip(sheetToXlsx({ rows: [['a']] }));
  const sheet = bare.find((e) => e.name === 'xl/worksheets/sheet1.xml').text;
  assert.ok(!sheet.includes('<cols>'), 'no column block without columns');
  assert.match(sheet, /<c r="A1" t="inlineStr">/, 'first row is data, not a header');
});

test('sheetToXlsx keeps unicode, escapes markup and drops illegal control characters', () => {
  const sheet = readZip(sheetToXlsx({
    sheetName: 'Unicode',
    columns: [{ label: 'Front' }],
    rows: [['الخلية تنقسم'], ['a & b < c'], ['ctrl\u0000\u0007end'], ['quote " and \'']]
  })).find((e) => e.name === 'xl/worksheets/sheet1.xml').text;

  assert.match(sheet, /الخلية تنقسم/);
  assert.match(sheet, /a &amp; b &lt; c/);
  assert.match(sheet, /ctrlend/);
  assert.match(sheet, /quote &quot; and &apos;/);
  assert.ok(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(sheet), 'no XML-illegal characters');
});

// --- embedded images ---------------------------------------------------------

const PNG_1X1 = new Uint8Array(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
));

function fakeJpeg(width, height) {
  const app0 = [0xff, 0xe0, 0x00, 0x04, 0x00, 0x00];
  const sof0 = [
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03
  ];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof0, 0xff, 0xd9]);
}

test('imageSize reads PNG and JPEG headers without a canvas', () => {
  assert.deepEqual(imageSize(PNG_1X1), { width: 1, height: 1, ext: 'png' });
  assert.deepEqual(imageSize(fakeJpeg(640, 480)), { width: 640, height: 480, ext: 'jpg' });
  assert.equal(imageSize(new Uint8Array(10)), null, 'too short');
  assert.equal(imageSize(new Uint8Array(64)), null, 'no known signature');
  assert.equal(imageSize(null), null);
  const notPng = new Uint8Array(PNG_1X1); notPng[0] = 0;
  assert.equal(imageSize(notPng), null, 'signature must match');
});

test('sheetToXlsx embeds pictures as a drawing layer anchored to their cell', () => {
  const bytes = sheetToXlsx({
    sheetName: 'Biology',
    columns: [{ label: 'Front', width: 42 }, { label: 'Image', width: 24 }],
    rows: [['Cell?', ''], ['DNA?', '']],
    images: [{ row: 0, col: 1, data: PNG_1X1 }]
  });
  const entries = readZip(bytes);
  const names = entries.map((e) => e.name);
  for (const part of [
    'xl/media/image1.png',
    'xl/drawings/drawing1.xml',
    'xl/drawings/_rels/drawing1.xml.rels',
    'xl/worksheets/_rels/sheet1.xml.rels'
  ]) assert.ok(names.includes(part), `missing ${part}`);

  const types = entries.find((e) => e.name === '[Content_Types].xml').text;
  assert.match(types, /Extension="png" ContentType="image\/png"/);
  assert.match(types, /drawings\/drawing1\.xml/);

  const sheet = entries.find((e) => e.name === 'xl/worksheets/sheet1.xml').text;
  assert.match(sheet, /<drawing r:id="rId1"\/>/, 'drawing declared after sheetData');
  assert.match(sheet, /xmlns:r="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships"/, 'r namespace declared');
  assert.match(sheet, /<row r="2" ht="\d+\.\d+" customHeight="1">/, 'the image row is tall enough');

  const drawing = entries.find((e) => e.name === 'xl/drawings/drawing1.xml').text;
  assert.match(drawing, /<xdr:col>1<\/xdr:col>/, 'anchored to the Image column');
  assert.match(drawing, /<xdr:row>1<\/xdr:row>/, 'anchored to the first data row (header is row 1)');
  assert.match(drawing, /r:embed="rId1"/);
  assert.match(drawing, /<xdr:ext cx="\d+" cy="\d+"\/>/, 'size in EMU');

  const rels = entries.find((e) => e.name === 'xl/drawings/_rels/drawing1.xml.rels').text;
  assert.match(rels, /Target="\.\.\/media\/image1\.png"/);
  const sheetRels = entries.find((e) => e.name === 'xl/worksheets/_rels/sheet1.xml.rels').text;
  assert.match(sheetRels, /relationships\/drawing" Target="\.\.\/drawings\/drawing1\.xml"/);

  const media = entries.find((e) => e.name === 'xl/media/image1.png');
  assert.deepEqual([...media.bytes], [...PNG_1X1], 'bytes travel unmodified');
});

test('an unplaceable image never breaks the sheet', () => {
  const bytes = sheetToXlsx({
    columns: [{ label: 'A' }],
    rows: [['x']],
    images: [{ row: 0, col: 0, data: new Uint8Array([1, 2, 3]) }]
  });
  const names = readZip(bytes).map((e) => e.name);
  assert.ok(!names.some((n) => n.startsWith('xl/drawings/')), 'no drawing layer without a readable image');
  assert.ok(!names.some((n) => n.startsWith('xl/media/')));
});

test('sheetToXlsx output is deterministic for a fixed timestamp', () => {
  const opts = { sheetName: 'Same', columns: [{ label: 'A' }], rows: [['x']], now: new Date(2026, 0, 2, 3, 4, 5) };
  const a = sheetToXlsx(opts);
  const b = sheetToXlsx(opts);
  assert.deepEqual([...a], [...b]);
});
