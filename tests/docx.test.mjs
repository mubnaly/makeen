import test from 'node:test';
import assert from 'node:assert/strict';
import { notesToDocx, buildDocxXml } from '../src/lib/docxExport.js';

test('buildDocxXml generates valid XML with headings, RTL text, and image embeds', () => {
  const items = [
    { text: 'Introduction to Algorithms', heading: 'h1' },
    { text: 'هذه ملاحظة باللغة العربية مع تفاصيل', heading: 'p' },
    {
      text: 'Captured formula diagram',
      heading: 'h3',
      source: 'pdf',
      sourceDetail: 'Page 5',
      image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    }
  ];

  const { docXml, relsXml, images } = buildDocxXml({ title: 'Study Session Notes', items });

  assert.ok(docXml.includes('Introduction to Algorithms'));
  assert.ok(docXml.includes('Heading1'));
  assert.ok(docXml.includes('w:bidi')); // RTL support
  assert.ok(docXml.includes('w:rtl'));
  assert.ok(docXml.includes('Captured formula diagram'));
  assert.ok(docXml.includes('Heading3'));
  assert.ok(docXml.includes('wp:inline')); // DrawingML image
  assert.equal(images.length, 1);
  assert.equal(images[0].name, 'word/media/image1.png');
  assert.ok(relsXml.includes('rIdImg1'));
});

test('notesToDocx outputs a valid OpenXML ZIP archive starting with PK header', () => {
  const items = [
    { text: 'Dual Studio Note 1', heading: 'h2' }
  ];

  const bytes = notesToDocx(items, { title: 'Test Document' });
  assert.ok(bytes instanceof Uint8Array);
  assert.ok(bytes.length > 500);

  // ZIP local file signature: 0x50 0x4B 0x03 0x04 ("PK\x03\x04")
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
  assert.equal(bytes[2], 0x03);
  assert.equal(bytes[3], 0x04);
});
