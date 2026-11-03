import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSidecar, validateSidecar, parseSidecar, serializeSidecar } from '../src/lib/sidecar.js';
import { createSidecarStore, memoryKV } from '../src/lib/storage.js';

function ann(id, page = 14, u = 0.4) {
  return {
    id,
    type: 'marker',
    page,
    geometry: { mode: 'horizontal', points: [[u, 0.42], [0.78, 0.42]] },
    style: { color: '#F4D03F', opacity: 0.55, thickness: 0.012 },
    created_at: '2026-10-09T09:00:00Z',
    updated_at: '2026-10-09T09:00:00Z'
  };
}

test('build produces a valid v1 sidecar', () => {
  const s = buildSidecar({
    documentId: 'doc1',
    sourceFilename: 'Biology.pdf',
    pageMetadata: { 14: { width: 612, height: 792, rotation: 0 } },
    annotations: [ann('a1')]
  });
  const v = validateSidecar(s);
  assert.equal(v.ok, true, v.errors.join('; '));
  assert.equal(s.schema_version, 1);
  assert.equal(s.annotations.length, 1);
  assert.deepEqual(s.annotations[0].geometry.points[0], [0.4, 0.42]);
});

test('parse rejects malformed JSON', () => {
  assert.throws(() => parseSidecar('{ not json'), /not valid JSON/);
});

test('parse refuses unsupported major schema without destroying data', () => {
  const s = buildSidecar({ documentId: 'd', annotations: [] });
  const future = { ...s, schema_version: 99 };
  assert.throws(() => parseSidecar(JSON.stringify(future)), /unsupported schema_version 99/);
});

test('parse rejects structurally invalid sidecar', () => {
  const bad = JSON.stringify({ schema_version: 1, document_id: 'd', annotations: [{ id: 'x', page: 'nope', type: 'marker', geometry: {} }] });
  assert.throws(() => parseSidecar(bad), /page must be a number/);
});

test('save is durable across a fresh store over the same kv (restart)', async () => {
  const kv = memoryKV();
  const storeA = createSidecarStore({ kv, bridge: null });
  const payload = buildSidecar({ documentId: 'doc1', annotations: [ann('a1')] });
  const res = await storeA.save('doc1', payload);
  assert.equal(res.ok, true);
  assert.equal(res.storage, 'local');

  // Simulate app restart: new store instance sharing the same underlying kv.
  const storeB = createSidecarStore({ kv, bridge: null });
  const { sidecar, source } = await storeB.load('doc1');
  assert.ok(sidecar, 'sidecar loaded after restart');
  assert.equal(sidecar.document_id, 'doc1');
  assert.equal(sidecar.annotations.length, 1);
  assert.equal(sidecar.annotations[0].geometry.points[0][0], 0.4);
  assert.equal(source, 'local');
});

test('rolling backup recovers when the primary record is corrupted', async () => {
  const kv = memoryKV();
  const store = createSidecarStore({ kv, bridge: null });
  await store.save('doc1', buildSidecar({ documentId: 'doc1', annotations: [ann('a1')] }));
  await store.save('doc1', buildSidecar({ documentId: 'doc1', annotations: [ann('a1'), ann('a2')] }));
  // Corrupt the primary record only.
  kv.set('studyos.sidecar.doc1', '{ broken');
  const { sidecar, source, recovered } = await store.load('doc1');
  assert.ok(sidecar, 'recovered from backup');
  assert.equal(source, 'backup');
  assert.equal(recovered, true);
  assert.equal(sidecar.annotations.length, 1, 'backup holds previous generation');
});

test('desktop file bridge: save writes the file and load prefers it when newer', async () => {
  const kv = memoryKV();
  const files = new Map();
  const bridge = {
    saveSidecarFile: async (id, text) => {
      files.set(id, text);
      return { ok: true, path: `StudyOSData/annotations/${id}.annotations.json` };
    },
    loadSidecarFile: async (id) => files.get(id) ?? null
  };
  const store = createSidecarStore({ kv, bridge });
  const payload = buildSidecar({ documentId: 'doc1', annotations: [ann('a1')] });
  const res = await store.save('doc1', payload);
  assert.equal(res.ok, true);
  assert.equal(res.storage, 'file+local');
  assert.match(res.path, /doc1\.annotations\.json/);
  assert.ok(files.has('doc1'), 'file actually written');

  const { sidecar, source } = await store.load('doc1');
  assert.equal(sidecar.annotations.length, 1);
  assert.equal(source, 'file');
});

test('save reports failure honestly when the file bridge rejects', async () => {
  const kv = memoryKV();
  const bridge = { saveSidecarFile: async () => { throw new Error('disk full'); } };
  const store = createSidecarStore({ kv, bridge });
  const res = await store.save('doc1', buildSidecar({ documentId: 'doc1', annotations: [] }));
  assert.equal(res.ok, false);
  assert.equal(res.storage, 'local');
  assert.match(res.error, /disk full/);
  // Local layer still durable so no data is lost.
  assert.ok(kv.get('studyos.sidecar.doc1'));
});

test('save refuses an invalid sidecar instead of writing garbage', async () => {
  const kv = memoryKV();
  const store = createSidecarStore({ kv, bridge: null });
  await assert.rejects(() => store.save('doc1', { schema_version: 1 }), /refusing to save invalid sidecar/);
  assert.equal(kv.get('studyos.sidecar.doc1'), null, 'nothing written');
});

test('load returns null (not an error) for a document never saved', async () => {
  const store = createSidecarStore({ kv: memoryKV(), bridge: null });
  const { sidecar, source } = await store.load('missing');
  assert.equal(sidecar, null);
  assert.equal(source, null);
});

test('serialize/parse round-trips annotation geometry exactly', () => {
  const payload = buildSidecar({ documentId: 'd', annotations: [ann('a1', 14, 0.123456)] });
  const text = serializeSidecar(payload);
  const back = parseSidecar(text);
  assert.deepEqual(back.annotations[0].geometry, payload.annotations[0].geometry);
  assert.equal(back.annotations[0].style.thickness, 0.012);
});
