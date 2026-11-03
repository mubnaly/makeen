import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const require = createRequire(import.meta.url);

function studyMediaPlugin() {
  const downloadsDir = path.resolve('downloads');
  if (!fs.existsSync(downloadsDir)) {
    try { fs.mkdirSync(downloadsDir, { recursive: true }); } catch {}
  }

  return {
    name: 'studyos-media-server',
    configureServer(server) {
      // 1. Transcript endpoint
      server.middlewares.use('/api/transcript', async (req, res) => {
        try {
          const url = new URL(req.url, 'http://localhost');
          const videoId = url.searchParams.get('videoId');
          const lang = url.searchParams.get('lang') || 'ar';
          const ytHelper = require('./electron/yt-helper.cjs');

          // Primary: yt-dlp
          let result = await ytHelper.fetchTranscriptYtDlp(videoId, lang);

          // Fallback: direct watch page
          if (!result || !result.ok) {
            const transcript = require('./electron/transcript.cjs');
            const fallback = await transcript.fetchTranscript(videoId, lang);
            if (fallback && fallback.ok) result = fallback;
          }

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result || { ok: false, error: 'noCaptions' }));
        } catch (err) {
          res.setHeader('Content-Type', 'application/json');
          res.statusCode = 200;
          res.end(JSON.stringify({ ok: false, error: 'fetchFailed', message: String(err?.message || err) }));
        }
      });

      // 2. Playlist info endpoint
      server.middlewares.use('/api/playlist', async (req, res) => {
        try {
          const url = new URL(req.url, 'http://localhost');
          const playlistUrl = url.searchParams.get('url');
          if (!playlistUrl) {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: 'missingUrl' }));
            return;
          }
          const ytHelper = require('./electron/yt-helper.cjs');
          const result = await ytHelper.fetchPlaylistInfo(playlistUrl);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result));
        } catch (err) {
          res.setHeader('Content-Type', 'application/json');
          res.statusCode = 200;
          res.end(JSON.stringify({ ok: false, error: 'playlistFailed', message: String(err?.message || err) }));
        }
      });

      // 2a. Channel info and videos endpoint
      server.middlewares.use('/api/channel', async (req, res) => {
        try {
          const url = new URL(req.url, 'http://localhost');
          const channelUrl = url.searchParams.get('url');
          const limit = url.searchParams.get('limit') || 50;
          if (!channelUrl) {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: 'missingUrl' }));
            return;
          }
          const ytHelper = require('./electron/yt-helper.cjs');
          const result = await ytHelper.fetchChannelInfo(channelUrl, limit);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result));
        } catch (err) {
          res.setHeader('Content-Type', 'application/json');
          res.statusCode = 200;
          res.end(JSON.stringify({ ok: false, error: 'channelFailed', message: String(err?.message || err) }));
        }
      });

      // 2b. Chapters / Sections endpoint
      server.middlewares.use('/api/chapters', async (req, res) => {
        try {
          const url = new URL(req.url, 'http://localhost');
          const videoId = url.searchParams.get('videoId');
          if (!videoId) {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, chapters: [] }));
            return;
          }
          const ytHelper = require('./electron/yt-helper.cjs');
          const result = await ytHelper.fetchVideoChapters(videoId);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result));
        } catch (err) {
          res.setHeader('Content-Type', 'application/json');
          res.statusCode = 200;
          res.end(JSON.stringify({ ok: false, chapters: [] }));
        }
      });

      // 2c. Video Frame Capture endpoint
      server.middlewares.use('/api/capture-frame', async (req, res) => {
        try {
          const url = new URL(req.url, 'http://localhost');
          const videoId = url.searchParams.get('videoId');
          const seconds = url.searchParams.get('seconds') || 0;
          if (!videoId) {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: 'missingVideoId' }));
            return;
          }
          const ytHelper = require('./electron/yt-helper.cjs');
          const result = await ytHelper.captureYoutubeFrame(videoId, seconds);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result));
        } catch (err) {
          res.setHeader('Content-Type', 'application/json');
          res.statusCode = 200;
          res.end(JSON.stringify({ ok: false, error: 'captureFailed', message: String(err?.message || err) }));
        }
      });

      // 3. Download endpoint
      server.middlewares.use('/api/download', async (req, res) => {
        try {
          const url = new URL(req.url, 'http://localhost');
          const videoId = url.searchParams.get('videoId') || '';
          const rawUrl = url.searchParams.get('url') || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : '');
          const quality = url.searchParams.get('quality') || '144p';

          if (!rawUrl) {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: 'missingUrl' }));
            return;
          }

          const ytHelper = require('./electron/yt-helper.cjs');
          const { format, audioOnly } = ytHelper.getFormatArg(quality);
          const ext = audioOnly ? 'mp3' : 'mp4';
          const baseName = `video_${videoId || Date.now()}_${quality}`;
          const outTmpl = path.join(downloadsDir, `${baseName}.%(ext)s`);

          const args = [
            '-m', 'yt_dlp',
            '-f', format,
            '-o', outTmpl
          ];
          if (audioOnly) {
            args.push('-x', '--audio-format', 'mp3');
          } else {
            args.push('--merge-output-format', 'mp4');
          }
          args.push(rawUrl);

          const proc = spawn('python', args);
          let stderr = '';
          proc.stderr?.on('data', (d) => { stderr += d.toString(); });

          proc.on('close', (code) => {
            // Find downloaded file
            const files = fs.readdirSync(downloadsDir).filter((f) => f.startsWith(baseName));
            if (!files.length) {
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: false, error: 'downloadFailed', message: stderr.slice(0, 300) }));
              return;
            }
            const filename = files[0];
            const stat = fs.statSync(path.join(downloadsDir, filename));
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              ok: true,
              filename,
              size: stat.size,
              streamUrl: `/api/downloads/${encodeURIComponent(filename)}`
            }));
          });

          proc.on('error', (err) => {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: 'procError', message: String(err?.message || err) }));
          });
        } catch (err) {
          res.setHeader('Content-Type', 'application/json');
          res.statusCode = 200;
          res.end(JSON.stringify({ ok: false, error: 'downloadFailed', message: String(err?.message || err) }));
        }
      });

      // 4. Serve downloaded media
      server.middlewares.use('/api/downloads', (req, res, next) => {
        try {
          const rawName = decodeURIComponent(req.url.replace(/^\//, ''));
          const safeName = path.basename(rawName);
          const fullPath = path.join(downloadsDir, safeName);
          if (!fs.existsSync(fullPath)) {
            res.statusCode = 404;
            res.end('Not found');
            return;
          }
          const stat = fs.statSync(fullPath);
          const ext = path.extname(fullPath).toLowerCase();
          const mime = ext === '.mp3' ? 'audio/mpeg' : ext === '.mp4' ? 'video/mp4' : 'application/octet-stream';
          res.setHeader('Content-Type', mime);
          res.setHeader('Content-Length', stat.size);
          fs.createReadStream(fullPath).pipe(res);
        } catch {
          next();
        }
      });
    }
  };
}

// base './' so the built app boots over file:// inside the Electron shell (gap D5).
export default defineConfig({
  base: './',
  plugins: [svelte(), studyMediaPlugin()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600
  }
});
