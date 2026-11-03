// Generates a small 3-page A4 PDF with a landmark rectangle at known page
// coordinates (page 1) plus text, for manual and automated verification.
// Usage: node tests/fixtures/make_pdf.mjs [outfile]
import { writeFileSync } from 'node:fs';

const out = process.argv[2] || new URL('./landmark.pdf', import.meta.url);

function contentStream(n) {
  const lines = [
    'BT /F1 24 Tf 60 780 Td (StudyOS fixture page ' + n + ') Tj ET',
    'BT /F1 14 Tf 60 740 Td (Cell division overview) Tj ET',
    'BT /F1 14 Tf 60 700 Td (Mitosis and meiosis stages follow.) Tj ET'
  ];
  if (n === 1) {
    // Landmark rectangle around page px ~ (100..300, 692..741) in a 595x842 page.
    lines.push('0.9 0.2 0.2 rg 100 101 200 49 re f');
    lines.push('BT /F1 12 Tf 104 118 Td (LANDMARK) Tj ET');
  }
  return lines.join('\n');
}

// Build a minimal PDF with explicit object numbering.
const objs = [];
objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
objs[2] = '<< /Type /Pages /Kids [4 0 R 5 0 R 6 0 R] /Count 3 >>';
objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
objs[4] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 7 0 R /Resources << /Font << /F1 3 0 R >> >> >>';
objs[5] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 8 0 R /Resources << /Font << /F1 3 0 R >> >> >>';
objs[6] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 9 0 R /Resources << /Font << /F1 3 0 R >> >> >>';
for (let i = 0; i < 3; i++) {
  const body = contentStream(i + 1);
  objs[7 + i] = `<< /Length ${Buffer.byteLength(body)} >>\nstream\n${body}\nendstream`;
}

let pdf = '%PDF-1.4\n';
const offsets = [0];
for (let n = 1; n < objs.length; n++) {
  offsets[n] = Buffer.byteLength(pdf);
  pdf += `${n} 0 obj\n${objs[n]}\nendobj\n`;
}
const xrefPos = Buffer.byteLength(pdf);
pdf += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
for (let n = 1; n < objs.length; n++) {
  pdf += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
}
pdf += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;

writeFileSync(out, pdf, 'latin1');
console.log('wrote', out, Buffer.byteLength(pdf), 'bytes');
