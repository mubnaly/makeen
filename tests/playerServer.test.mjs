import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { startPlayerServer, stopPlayerServer, getPlayerOrigin } = require('../electron/player-server.cjs');

test('loopback player server serves only the player page', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'studyos-player-'));
  t.after(async () => {
    stopPlayerServer();
    await rm(dir, { recursive: true, force: true });
  });
  await writeFile(path.join(dir, 'yt-player.html'), '<!doctype html><title>player</title>');

  const origin = await startPlayerServer({ distDir: dir });
  assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(getPlayerOrigin(), origin);

  const page = await fetch(`${origin}/yt-player.html`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /^text\/html/);
  assert.match(page.headers.get('cache-control'), /no-store/);
  assert.match(await page.text(), /<title>player<\/title>/);

  // Both / and the page path serve the player so the iframe can use either.
  assert.equal((await fetch(`${origin}/`)).status, 200);

  // Nothing else on disk is reachable, including traversal attempts.
  for (const target of ['/index.html', '/package.json', '/../package.json', '/%2e%2e/package.json', '/assets/app.js']) {
    const response = await fetch(`${origin}${target}`);
    assert.equal(response.status, 404, target);
  }

  const head = await fetch(`${origin}/yt-player.html`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');

  assert.equal((await fetch(`${origin}/yt-player.html`, { method: 'POST' })).status, 405);
  assert.equal((await fetch(`${origin}/favicon.ico`)).status, 204);

  stopPlayerServer();
  assert.equal(getPlayerOrigin(), '');
});
