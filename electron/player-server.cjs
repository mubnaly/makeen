'use strict';

// The desktop shell loads the app from file://. YouTube refuses to run its
// IFrame player in a document whose origin is file://, so production playback
// failed even though the browser preview worked. This tiny loopback server
// serves ONE static page (dist/yt-player.html) over http://127.0.0.1:<port>.
// The player page is embedded in the app as an iframe, which gives YouTube a
// normal http origin without moving the app itself (and its local library) off
// file://. Nothing else on disk is exposed: unknown paths are 404s, and the
// port is random and bound to the loopback interface.

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const PLAYER_PATHS = new Set(['/', '/yt-player.html']);
const HOST = '127.0.0.1';

let server = null;
let origin = '';

async function startPlayerServer({ distDir } = {}) {
  if (server) return origin;
  const root = distDir || path.join(__dirname, '..', 'dist');
  const html = await fs.readFile(path.join(root, 'yt-player.html'), 'utf8');

  const srv = http.createServer((req, res) => {
    let pathname = '';
    try {
      pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('bad request');
      return;
    }
    if (pathname === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      res.end();
      return;
    }
    if (!PLAYER_PATHS.has(pathname)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Access-Control-Allow-Origin': '*'
    });
    if (req.method === 'HEAD') res.end();
    else res.end(html);
  });

  await new Promise((resolve, reject) => {
    srv.once('error', reject);
    srv.listen(0, HOST, () => {
      srv.removeListener('error', reject);
      resolve();
    });
  });

  const address = srv.address();
  if (!address || typeof address === 'string') {
    srv.close();
    throw new Error('player server did not bind to a TCP port');
  }
  server = srv;
  origin = `http://${HOST}:${address.port}`;
  return origin;
}

function stopPlayerServer() {
  if (server) {
    try {
      server.close();
      // Do not leave keep-alive sockets holding the app (or a test) open.
      server.closeAllConnections?.();
    } catch {
      // Already closed.
    }
    server = null;
    origin = '';
  }
}

function getPlayerOrigin() {
  return origin;
}

module.exports = { startPlayerServer, stopPlayerServer, getPlayerOrigin };
