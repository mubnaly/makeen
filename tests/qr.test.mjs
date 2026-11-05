import test from 'node:test';
import assert from 'node:assert/strict';
import { generateQrDataUrl, buildProjectShareSummary } from '../src/lib/qr.js';

test('generateQrDataUrl generates valid base64 PNG data URL', async () => {
  const url = 'https://www.youtube.com/watch?v=cKkYtPOc9wY';
  const qr = await generateQrDataUrl(url);
  assert.ok(qr.startsWith('data:image/png;base64,'));
  assert.ok(qr.length > 100);
});

test('generateQrDataUrl returns empty string for empty input', async () => {
  const empty = await generateQrDataUrl('');
  assert.equal(empty, '');
});

test('buildProjectShareSummary formats project title, videos, and docs', () => {
  const project = {
    name: 'Physics 101',
    description: 'Mechanics & Thermodynamics',
    videos: ['v1'],
    docs: ['d1'],
    folders: [
      {
        id: 'f1',
        name: 'Unit 1',
        items: [
          { type: 'youtube', title: 'Intro lecture', url: 'https://youtube.com/watch?v=abc' },
          { type: 'pdf', title: 'Chapter 1.pdf' }
        ]
      }
    ]
  };
  const videos = [{ id: 'v1', title: 'Kinematics', url: 'https://youtube.com/watch?v=xyz' }];
  const docs = [{ id: 'd1', title: 'Syllabus.pdf' }];

  const text = buildProjectShareSummary(project, videos, docs);
  assert.ok(text.includes('Physics 101'));
  assert.ok(text.includes('Kinematics'));
  assert.ok(text.includes('Intro lecture'));
  assert.ok(text.includes('Syllabus.pdf'));
  assert.ok(text.includes('Chapter 1.pdf'));
});
