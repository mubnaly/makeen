const { app, BrowserWindow, ipcMain, Notification, dialog, Menu, session } = require('electron');
// Completely disable and destroy the default application menu before app is ready
// so "File Edit View Window Help" is never created or displayed.
Menu.setApplicationMenu(null);
const fs = require('fs/promises');
const path = require('path');
const { safeFileName } = require('./fsnames.cjs');
const transcript = require('./transcript.cjs');
const { fetchTranscriptFromPage } = require('./transcript-window.cjs');
const ytHelper = require('./yt-helper.cjs');
const { startPlayerServer, stopPlayerServer, getPlayerOrigin } = require('./player-server.cjs');
const { spawn } = require('child_process');

function findPdfArg(argv) {
  if (!Array.isArray(argv)) return null;
  for (const arg of argv) {
    if (typeof arg === 'string' && /\.pdf$/i.test(arg.trim())) {
      return arg.trim().replace(/^"|"$/g, '');
    }
  }
  return null;
}

async function loadPdfPayload(filePath) {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return { ok: false, error: 'Not a file' };
    const buffer = await fs.readFile(filePath);
    return {
      ok: true,
      name: path.basename(filePath),
      path: filePath,
      bytes: new Uint8Array(buffer)
    };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

let mainWindow = null;
let pendingInitialPdfPath = findPdfArg(process.argv);

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', async (_event, commandLine) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      const pdfPath = findPdfArg(commandLine);
      if (pdfPath) {
        const payload = await loadPdfPayload(pdfPath);
        if (payload.ok) mainWindow.webContents.send('open-pdf-file', payload);
      }
    }
  });
}

app.on('open-file', async (event, filePath) => {
  event.preventDefault();
  if (/\.pdf$/i.test(filePath)) {
    if (mainWindow && mainWindow.webContents) {
      const payload = await loadPdfPayload(filePath);
      if (payload.ok) mainWindow.webContents.send('open-pdf-file', payload);
    } else {
      pendingInitialPdfPath = filePath;
    }
  }
});

// A study window is often behind another app while a lecture keeps playing, and
// YouTube frame capture reads the compositor. Without these switches Chromium
// stops rendering an occluded window, which freezes playback and yields a black
// screenshot.
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

// Memory optimizations: cap V8 heap to prevent runaway memory usage, enforce 1 renderer process, disable spare renderers
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=256');
app.commandLine.appendSwitch('renderer-process-limit', '1');
app.commandLine.appendSwitch('disable-site-isolation-trials');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,SpareRendererForSitePerProcess');

// StudyOSData/ layout (plan §7.2, §11.1).
function dataRoot() {
  return path.join(app.getPath('documents'), 'StudyOSData');
}
function annotationsDir() {
  return path.join(dataRoot(), 'annotations');
}
function capturesDir() {
  return path.join(dataRoot(), 'screenshots');
}
function exportsDir() {
  return path.join(dataRoot(), 'exports');
}
function videosDir() {
  return path.join(dataRoot(), 'videos');
}

// Document ids and sidecar names stay ASCII, so they use the strict form.
function safeName(value) {
  return String(value || 'file').replace(/[^a-z0-9._-]/gi, '_').slice(0, 120);
}

// Ready-made transcripts and captures are user-visible filenames: keep Arabic,
// but never let a path or a reserved Windows device name through.
function safeOutputName(value, fallback) {
  return safeFileName(value, fallback);
}

const transcriptCache = new Map();
const windowTranscriptCache = new Map();
const TRANSCRIPT_TTL_MS = 10 * 60 * 1000;

// Atomic write: write to a temp file in the same dir, then rename over the target
// so a crash mid-write never leaves a half-written sidecar (plan §7.3).
async function atomicWrite(target, text) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, text, 'utf8');
  await fs.rename(tmp, target);
}

function createWindow() {
  Menu.setApplicationMenu(null);
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1000,
    minHeight: 680,
    backgroundColor: '#f7f7fb',
    title: 'StudyOS',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'public', 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });
  win.setMenu(null);
  win.removeMenu();
  win.setAutoHideMenuBar(true);
  win.setMenuBarVisibility(false);
  win.webContents.on('before-input-event', (_event, input) => {
    if (input.key === 'Alt') {
      win.setMenuBarVisibility(false);
    }
  });
  win.on('enter-full-screen', () => {
    win.setMenu(null);
    win.removeMenu();
    win.setMenuBarVisibility(false);
  });
  win.on('leave-full-screen', () => {
    win.setMenu(null);
    win.removeMenu();
    win.setMenuBarVisibility(false);
  });
  mainWindow = win;
  // base './' in the Vite build makes this work over file://.
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

ipcMain.handle('get-initial-pdf', async () => {
  if (pendingInitialPdfPath) {
    const p = pendingInitialPdfPath;
    pendingInitialPdfPath = null;
    return await loadPdfPayload(p);
  }
  return null;
});

ipcMain.handle('read-pdf-file', async (_e, filePath) => {
  return await loadPdfPayload(filePath);
});

ipcMain.handle('write-pdf-file', async (_e, { filePath, bytes }) => {
  try {
    if (!filePath) return { ok: false, error: 'Missing file path' };
    const buf = Buffer.from(bytes);
    await fs.writeFile(filePath, buf);
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle('pick-local-pdf', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open PDF Document',
    filters: [
      { name: 'PDF Documents (*.pdf)', extensions: ['pdf'] }
    ],
    properties: ['openFile']
  });
  if (result.canceled || !result.filePaths || !result.filePaths.length) {
    return { canceled: true };
  }
  return await loadPdfPayload(result.filePaths[0]);
});

app.whenReady().then(async () => {
  // Production loads over file://, which YouTube rejects as a player origin.
  // Serve only the player page on loopback so the iframe has an http origin.
  try {
    await startPlayerServer();
  } catch (error) {
    console.error('YouTube player server failed to start:', error);
  }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

ipcMain.handle('app-origin', () => getPlayerOrigin());

app.on('before-quit', () => stopPlayerServer());

ipcMain.handle('save-capture', async (_e, { filename, dataUrl }) => {
  const folder = capturesDir();
  await fs.mkdir(folder, { recursive: true });
  const output = path.join(folder, safeOutputName(filename, 'capture.jpg'));
  const base64 = String(dataUrl).replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '');
  await fs.writeFile(output, Buffer.from(base64, 'base64'));
  return { ok: true, path: output };
});

ipcMain.handle('save-sidecar', async (_e, { documentId, text }) => {
  const id = safeName(documentId);
  const target = path.join(annotationsDir(), `${id}.annotations.json`);
  await atomicWrite(target, text);
  return { ok: true, path: target };
});

ipcMain.handle('load-sidecar', async (_e, { documentId }) => {
  const id = safeName(documentId);
  const target = path.join(annotationsDir(), `${id}.annotations.json`);
  try {
    return await fs.readFile(target, 'utf8');
  } catch {
    return null;
  }
});

ipcMain.handle('save-export', async (_e, { filename, dataBase64 }) => {
  const folder = exportsDir();
  await fs.mkdir(folder, { recursive: true });
  const output = path.join(folder, safeOutputName(filename, 'export.pdf'));
  await fs.writeFile(output, Buffer.from(String(dataBase64), 'base64'));
  return { ok: true, path: output };
});

// A YouTube frame cannot be read through the cross-origin iframe, but Electron
// can capture the pixels the window is actually showing. The renderer passes
// the video's viewport rect; this crops exactly that area and encodes JPEG at
// the user's screenshot-quality setting.
ipcMain.handle('capture-region', async (event, payload = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return { ok: false, error: 'window unavailable' };
  const [contentW, contentH] = win.getContentSize();
  const rect = payload.rect || {};
  const rawX = Number(rect.x);
  const rawY = Number(rect.y);
  const rawW = Number(rect.width);
  const rawH = Number(rect.height);
  if (![rawX, rawY, rawW, rawH].every(Number.isFinite)) return { ok: false, error: 'invalid region' };
  const x = Math.max(0, Math.min(contentW - 1, Math.round(rawX)));
  const y = Math.max(0, Math.min(contentH - 1, Math.round(rawY)));
  const width = Math.min(contentW - x, Math.round(rawW));
  const height = Math.min(contentH - y, Math.round(rawH));
  if (width < 2 || height < 2) return { ok: false, error: 'invalid region' };
  try {
    const fullImage = await win.webContents.capturePage();
    if (!fullImage || fullImage.isEmpty()) return { ok: false, error: 'empty capture' };
    const fullSize = fullImage.getSize();
    const scaleX = fullSize.width / Math.max(1, contentW);
    const scaleY = fullSize.height / Math.max(1, contentH);
    const cropX = Math.max(0, Math.min(fullSize.width - 10, Math.floor(x * scaleX)));
    const cropY = Math.max(0, Math.min(fullSize.height - 10, Math.floor(y * scaleY)));
    const cropW = Math.max(2, Math.min(fullSize.width - cropX, Math.floor(width * scaleX)));
    const cropH = Math.max(2, Math.min(fullSize.height - cropY, Math.floor(height * scaleY)));
    const image = fullImage.crop({ x: cropX, y: cropY, width: cropW, height: cropH });
    if (!image || image.isEmpty()) return { ok: false, error: 'empty capture' };
    const quality = Math.min(100, Math.max(10, Math.round(Number(payload.quality) || 85)));
    const jpeg = image.toJPEG(quality);
    return {
      ok: true,
      dataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
      width: image.getSize().width,
      height: image.getSize().height
    };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
});

ipcMain.handle('youtube-transcript', async (_e, payload = {}) => {
  const videoId = String(payload.videoId || '').trim();
  if (!transcript.VIDEO_ID.test(videoId)) {
    return { ok: false, error: 'invalidVideo', message: 'invalid YouTube video id' };
  }

  // Fast path: the signed timedtext URL from the watch page. On some sessions
  // YouTube requires a PO token here and returns an empty body.
  let direct = null;
  let entry = null;
  try {
    entry = transcriptCache.get(videoId);
    if (!entry || Date.now() - entry.at > TRANSCRIPT_TTL_MS) {
      const page = await transcript.fetchCaptionPage(videoId);
      entry = { at: Date.now(), page };
      transcriptCache.delete(videoId);
      transcriptCache.set(videoId, entry);
      while (transcriptCache.size > 20) {
        transcriptCache.delete(transcriptCache.keys().next().value);
      }
    }
    direct = await transcript.fetchTranscriptFor(entry.page, String(payload.lang || ''));
  } catch (error) {
    direct = { ok: false, error: 'fetchFailed', message: String(error?.message || error) };
  }
  if (direct?.ok) return direct;

  // Fast secondary: yt-dlp extractor
  try {
    const ytDlpRes = await ytHelper.fetchTranscriptYtDlp(videoId, String(payload.lang || 'ar'));
    if (ytDlpRes?.ok) {
      if (entry?.page?.title && !ytDlpRes.title) ytDlpRes.title = entry.page.title;
      return ytDlpRes;
    }
  } catch {}

  // Slow path: let YouTube's own watch page use its session and transcript
  // panel. Cached because it loads a whole page.
  const cached = windowTranscriptCache.get(videoId);
  if (cached && Date.now() - cached.at < TRANSCRIPT_TTL_MS) return cached.result;
  const fallback = await fetchTranscriptFromPage(videoId);
  if (fallback?.ok) {
    windowTranscriptCache.set(videoId, { at: Date.now(), result: fallback });
    while (windowTranscriptCache.size > 10) {
      windowTranscriptCache.delete(windowTranscriptCache.keys().next().value);
    }
    return fallback;
  }

  // Keep the specific reason from the fast path: "no captions" reads better
  // than "the transcript panel had no readable lines".
  return direct;
});

ipcMain.handle('youtube-playlist', async (_e, payload = {}) => {
  const url = String(payload.url || '').trim();
  if (!url) return { ok: false, error: 'missingUrl' };
  return ytHelper.fetchPlaylistInfo(url);
});

ipcMain.handle('youtube-channel', async (_e, payload = {}) => {
  const url = String(payload.url || '').trim();
  if (!url) return { ok: false, error: 'missingUrl' };
  return ytHelper.fetchChannelInfo(url, payload.limit || 50);
});

ipcMain.handle('youtube-chapters', async (_e, payload = {}) => {
  const videoId = String(payload.videoId || '').trim();
  if (!videoId) return { ok: false, chapters: [] };
  return ytHelper.fetchVideoChapters(videoId);
});

ipcMain.handle('youtube-capture-frame', async (_e, payload = {}) => {
  const videoId = String(payload.videoId || '').trim();
  const seconds = Number(payload.seconds || 0);
  if (!videoId) return { ok: false, error: 'missingVideoId' };
  return ytHelper.captureYoutubeFrame(videoId, seconds);
});

ipcMain.handle('video-download', async (_e, payload = {}) => {
  const rawUrl = String(payload.url || '').trim();
  const videoId = String(payload.videoId || '').trim();
  const targetUrl = rawUrl || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : '');
  const quality = String(payload.quality || '144p');
  if (!targetUrl) return { ok: false, error: 'missingUrl' };

  const folder = videosDir();
  await fs.mkdir(folder, { recursive: true });

  const { format, audioOnly } = ytHelper.getFormatArg(quality);
  const baseName = `video_${videoId || Date.now()}_${quality}`;
  const outTmpl = path.join(folder, `${baseName}.%(ext)s`);

  return new Promise((resolve) => {
    const args = ['-m', 'yt_dlp', '-f', format, '-o', outTmpl];
    if (audioOnly) args.push('-x', '--audio-format', 'mp3');
    else args.push('--merge-output-format', 'mp4');
    args.push(targetUrl);

    const proc = spawn('python', args);
    let stderr = '';
    proc.stderr?.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', async (code) => {
      try {
        const files = (await fs.readdir(folder)).filter((f) => f.startsWith(baseName));
        if (!files.length) {
          resolve({ ok: false, error: 'downloadFailed', message: stderr.slice(0, 300) });
          return;
        }
        const filename = files[0];
        const fullPath = path.join(folder, filename);
        resolve({ ok: true, filename, path: fullPath });
      } catch (err) {
        resolve({ ok: false, error: String(err?.message || err) });
      }
    });

    proc.on('error', (err) => {
      resolve({ ok: false, error: String(err?.message || err) });
    });
  });
});

// Chromium's print pipeline shapes Arabic and mixed scripts correctly, unlike
// pdf-lib's standard fonts. Render a hidden, script-free document and print it
// straight to the exports folder.
ipcMain.handle('export-transcript-pdf', async (_e, payload = {}) => {
  let win = null;
  let tmpFile = '';
  try {
    const cues = Array.isArray(payload.cues) ? payload.cues.slice(0, 20000) : [];
    if (!cues.length) return { ok: false, error: 'the transcript is empty' };
    const html = transcript.transcriptHtml({
      title: payload.title,
      url: payload.url,
      lang: payload.lang,
      cues,
      generatedAt: new Date().toLocaleDateString('en-GB')
    });
    const folder = exportsDir();
    await fs.mkdir(folder, { recursive: true });
    let filename = safeOutputName(payload.filename, 'transcript.pdf');
    if (!/\.pdf$/i.test(filename)) filename += '.pdf';
    const output = path.join(folder, filename);
    tmpFile = path.join(app.getPath('temp'), `studyos-transcript-${process.pid}-${Date.now()}.html`);
    await fs.writeFile(tmpFile, html, 'utf8');
    win = new BrowserWindow({
      show: false,
      width: 900,
      height: 1200,
      backgroundColor: '#ffffff',
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
    });
    await win.loadFile(tmpFile);
    try {
      await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
    } catch {
      // Fonts are system fonts; a failed readiness probe must not block the PDF.
    }
    const pdf = await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
    if (!pdf || pdf.length < 100) throw new Error('the print dialog produced an empty PDF');
    await fs.writeFile(output, pdf);
    return { ok: true, path: output };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
    if (tmpFile) fs.unlink(tmpFile).catch(() => {});
  }
});

ipcMain.handle('notify', (_e, { title, body }) => {
  if (Notification.isSupported()) new Notification({ title: String(title || 'StudyOS'), body: String(body || '') }).show();
  return true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
