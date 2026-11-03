import test from 'node:test';
import assert from 'node:assert/strict';
import { notesToPdf } from '../src/lib/studioPdfExport.js';

test('notesToPdf generates a valid PDF buffer with notes and headings', async () => {
  const items = [
    { text: 'Calculus Study Session', heading: 'h1' },
    { text: 'Definition of limits and continuity', heading: 'p', source: 'pdf', sourceDetail: 'Page 3' },
    {
      text: 'Key theorem visual',
      heading: 'h3',
      image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    }
  ];

  const pdfBytes = await notesToPdf(items, { title: 'Math 101 Notes' });
  assert.ok(pdfBytes instanceof Uint8Array);
  assert.ok(pdfBytes.length > 500);

  // PDF header magic bytes: %PDF
  const header = String.fromCharCode(...pdfBytes.subarray(0, 5));
  assert.equal(header, '%PDF-');
});
