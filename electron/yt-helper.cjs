'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

function parseVtt(vttText) {
  const cues = [];
  const lines = vttText.split(/\r?\n/);
  let start = 0;
  let duration = 0;
  let textLines = [];
  const timeRegex = /(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})/;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const match = line.match(timeRegex);
    if (match) {
      if (textLines.length) {
        const text = textLines.join(' ').replace(/\s+/g, ' ').trim();
        if (text) cues.push({ start, duration: Math.max(0.1, duration), text });
        textLines = [];
      }
      const sH = match[1] ? Number(match[1]) : 0;
      const sM = Number(match[2]);
      const sS = Number(match[3]);
      const sMs = Number(match[4]);
      start = sH * 3600 + sM * 60 + sS + sMs / 1000;

      const eH = match[5] ? Number(match[5]) : 0;
      const eM = Number(match[6]);
      const eS = Number(match[7]);
      const eMs = Number(match[8]);
      const end = eH * 3600 + eM * 60 + eS + eMs / 1000;
      duration = Math.max(0.1, end - start);
    } else if (line && !line.startsWith('WEBVTT') && !line.startsWith('Kind:') && !line.startsWith('Language:') && !line.startsWith('NOTE')) {
      const clean = line.replace(/<[^>]+>/g, '').trim();
      if (clean && !textLines.includes(clean)) textLines.push(clean);
    } else if (!line && textLines.length) {
      const text = textLines.join(' ').replace(/\s+/g, ' ').trim();
      if (text) cues.push({ start, duration: Math.max(0.1, duration), text });
      textLines = [];
    }
  }
  if (textLines.length) {
    const text = textLines.join(' ').replace(/\s+/g, ' ').trim();
    if (text) cues.push({ start, duration: Math.max(0.1, duration), text });
  }
  return cues;
}

async function fetchTranscriptYtDlp(videoId, preferredLang = 'ar') {
  return new Promise((resolve) => {
    const tmpdir = os.tmpdir();
    const prefix = `studyos_sub_${videoId}_${Date.now()}`;
    const outTmpl = path.join(tmpdir, prefix);
    const subLangs = `${preferredLang || 'ar'},ar,en`;

    const proc = spawn('python', [
      '-m', 'yt_dlp',
      '--skip-download',
      '--write-sub',
      '--write-auto-sub',
      '--sub-lang', subLangs,
      '--sub-format', 'vtt',
      '-o', `${outTmpl}.%(ext)s`,
      `https://www.youtube.com/watch?v=${videoId}`
    ]);

    let stderr = '';
    proc.stderr?.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      // Find generated vtt files
      try {
        const files = fs.readdirSync(tmpdir).filter((f) => f.startsWith(prefix) && f.endsWith('.vtt'));
        if (!files.length) {
          resolve({ ok: false, error: 'noCaptions', message: 'no captions found for video' });
          return;
        }

        // Collect tracks from all generated vtt files
        const tracks = [];
        const seenCodes = new Set();
        for (const f of files) {
          const m = f.match(/\.([a-z]{2,3}(?:-[A-Za-z0-9]+)?)\.vtt$/i);
          const c = m ? m[1].toLowerCase() : '';
          if (c && !seenCodes.has(c)) {
            seenCodes.add(c);
            tracks.push({
              languageCode: c,
              label: c.startsWith('ar') ? 'العربية' : c.startsWith('en') ? 'English' : c,
              kind: 'asr'
            });
          }
        }

        // Pick matching language or first available
        const chosen = files.find((f) => f.includes(`.${preferredLang}.vtt`)) ||
                       files.find((f) => f.includes(`.${preferredLang}`)) ||
                       files.find((f) => f.includes('.ar')) ||
                       files.find((f) => f.includes('.en')) ||
                       files[0];
        const filePath = path.join(tmpdir, chosen);
        const content = fs.readFileSync(filePath, 'utf8');

        // Cleanup temp files
        for (const f of files) {
          try { fs.unlinkSync(path.join(tmpdir, f)); } catch {}
        }

        const cues = parseVtt(content);
        if (!cues.length) {
          resolve({ ok: false, error: 'noCues', message: 'caption track was empty' });
          return;
        }

        const langMatch = chosen.match(/\.([a-z]{2,3}(?:-[A-Za-z0-9]+)?)\.vtt$/i);
        const resolvedLang = langMatch ? langMatch[1] : (preferredLang || 'ar');

        resolve({
          ok: true,
          cues,
          selected: { languageCode: resolvedLang, label: resolvedLang.startsWith('ar') ? 'العربية' : 'English', kind: 'asr' },
          tracks: tracks.length ? tracks : [{ languageCode: resolvedLang, label: resolvedLang, kind: 'asr' }]
        });
      } catch (err) {
        resolve({ ok: false, error: 'subParseError', message: String(err?.message || err) });
      }
    });

    proc.on('error', (err) => {
      resolve({ ok: false, error: 'spawnError', message: String(err?.message || err) });
    });
  });
}

async function fetchPlaylistInfo(playlistUrl) {
  return new Promise((resolve) => {
    const proc = spawn('python', [
      '-m', 'yt_dlp',
      '--flat-playlist',
      '-J',
      playlistUrl
    ]);

    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (d) => { stdout += d.toString(); });
    proc.stderr?.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      if (code !== 0 || !stdout.trim()) {
        resolve({ ok: false, error: 'playlistFailed', message: stderr.slice(0, 300) });
        return;
      }
      try {
        const data = JSON.parse(stdout);
        const entries = (data.entries || []).map((e) => ({
          id: e.id || e.url,
          title: e.title || 'Video',
          duration: e.duration || 0,
          url: e.url && e.url.startsWith('http') ? e.url : `https://www.youtube.com/watch?v=${e.id}`
        }));
        resolve({
          ok: true,
          title: data.title || 'Playlist',
          count: entries.length,
          videos: entries
        });
      } catch (err) {
        resolve({ ok: false, error: 'jsonError', message: String(err?.message || err) });
      }
    });

    proc.on('error', (err) => {
      resolve({ ok: false, error: 'spawnError', message: String(err?.message || err) });
    });
  });
}

function getFormatArg(quality) {
  const q = String(quality || '144p').toLowerCase();
  if (q.includes('audio') || q === 'mp3') {
    return { format: 'bestaudio/best', audioOnly: true };
  }
  if (q.includes('144') || q === '144p') {
    return { format: 'bestvideo[height<=144]+bestaudio/best[height<=144]/best', audioOnly: false };
  }
  if (q.includes('360') || q === '360p') {
    return { format: 'bestvideo[height<=360]+bestaudio/best[height<=360]/best', audioOnly: false };
  }
  if (q.includes('720') || q === '720p') {
    return { format: 'bestvideo[height<=720]+bestaudio/best[height<=720]/best', audioOnly: false };
  }
  return { format: 'bestvideo[height<=480]+bestaudio/best[height<=480]/best', audioOnly: false };
}

async function fetchVideoChapters(videoId) {
  return new Promise((resolve) => {
    const proc = spawn('python', [
      '-m', 'yt_dlp',
      '--skip-download',
      '--dump-single-json',
      `https://www.youtube.com/watch?v=${videoId}`
    ]);
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (d) => { stdout += d.toString(); });
    proc.stderr?.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      if (code !== 0 || !stdout.trim()) {
        resolve({ ok: false, chapters: [] });
        return;
      }
      try {
        const data = JSON.parse(stdout);
        const rawChapters = data.chapters || [];
        const chapters = rawChapters.map((c) => ({
          title: c.title || 'Section',
          start: Math.max(0, Math.round(c.start_time || 0)),
          end: Math.max(0, Math.round(c.end_time || 0))
        }));
        resolve({ ok: true, chapters, title: data.title || '' });
      } catch {
        resolve({ ok: false, chapters: [] });
      }
    });

    proc.on('error', () => {
      resolve({ ok: false, chapters: [] });
    });
  });
}

async function fetchChannelInfo(channelUrl, limit = 50) {
  return new Promise((resolve) => {
    let cleanUrl = String(channelUrl || '').trim();
    if (!cleanUrl) {
      resolve({ ok: false, error: 'emptyUrl', message: 'Channel URL is required' });
      return;
    }
    // Normalize handle or short form: @handle or youtube.com/@handle
    if (cleanUrl.startsWith('@')) {
      cleanUrl = `https://www.youtube.com/${cleanUrl}`;
    }
    if (!cleanUrl.startsWith('http')) {
      cleanUrl = `https://www.youtube.com/@${cleanUrl.replace(/^@+/, '')}`;
    }
    if (!cleanUrl.includes('/videos') && !cleanUrl.includes('/streams') && !cleanUrl.includes('/shorts')) {
      cleanUrl = cleanUrl.replace(/\/+$/, '') + '/videos';
    }

    const maxItems = Math.max(5, Math.min(100, Number(limit) || 50));
    const proc = spawn('python', [
      '-m', 'yt_dlp',
      '--flat-playlist',
      '--playlist-end', String(maxItems),
      '-J',
      '--js-runtimes', 'node:node',
      cleanUrl
    ]);

    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (d) => { stdout += d.toString(); });
    proc.stderr?.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      if (code !== 0 || !stdout.trim()) {
        resolve({ ok: false, error: 'channelFailed', message: stderr.slice(0, 300) || 'Failed to fetch channel' });
        return;
      }
      try {
        const data = JSON.parse(stdout);
        const entries = (data.entries || []).map((e) => {
          const id = e.id || '';
          const thumbs = Array.isArray(e.thumbnails) ? e.thumbnails : [];
          const thumb = thumbs[thumbs.length - 1]?.url || (id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : '');
          return {
            id,
            title: e.title || 'Video',
            duration: Number(e.duration) || 0,
            thumbnail: thumb,
            url: e.url && e.url.startsWith('http') ? e.url : (id ? `https://www.youtube.com/watch?v=${id}` : '')
          };
        }).filter((e) => e.id);

        const channelThumbs = Array.isArray(data.thumbnails) ? data.thumbnails : [];
        const avatar = channelThumbs.find((t) => t.id === 'avatar_uncropped' || (t.width && t.width === t.height))?.url ||
                       channelThumbs[channelThumbs.length - 1]?.url || '';

        resolve({
          ok: true,
          channel: {
            id: data.channel_id || data.id || '',
            title: data.channel || data.uploader || data.title?.replace(/ - Videos$/i, '') || 'YouTube Channel',
            description: (data.description || '').slice(0, 600),
            uploader: data.uploader || data.channel || '',
            avatar,
            url: data.channel_url || data.uploader_url || cleanUrl
          },
          videos: entries
        });
      } catch (err) {
        resolve({ ok: false, error: 'jsonError', message: String(err?.message || err) });
      }
    });

    proc.on('error', (err) => {
      resolve({ ok: false, error: 'spawnError', message: String(err?.message || err) });
    });
  });
}

async function captureYoutubeFrame(videoId, seconds = 0) {
  return new Promise((resolve) => {
    const tmpdir = os.tmpdir();
    const sec = Math.max(0, Math.floor(Number(seconds) || 0));
    const prefix = `studyos_cap_${videoId}_${sec}_${Date.now()}`;
    const outClip = path.join(tmpdir, `${prefix}.mp4`);
    const outImg = path.join(tmpdir, `${prefix}.jpg`);

    const proc = spawn('python', [
      '-m', 'yt_dlp',
      '--js-runtimes', 'node:node',
      '--download-sections', `*${sec}-${sec + 2}`,
      '-f', 'bestvideo[height<=720]/bestvideo/best',
      '--force-overwrites',
      '-o', outClip,
      `https://www.youtube.com/watch?v=${videoId}`
    ]);

    const timeoutTimer = setTimeout(() => {
      try { proc.kill(); } catch {}
      resolve({ ok: false, error: 'timeout' });
    }, 3500);

    proc.on('close', () => {
      clearTimeout(timeoutTimer);
      try {
        const files = fs.readdirSync(tmpdir).filter((f) => f.startsWith(prefix) && (f.endsWith('.mp4') || f.endsWith('.webm')));
        if (!files.length) {
          resolve({ ok: false, error: 'clipFailed' });
          return;
        }
        const clipPath = path.join(tmpdir, files[0]);
        const ff = spawn('ffmpeg', [
          '-i', clipPath,
          '-frames:v', '1',
          '-q:v', '2',
          '-y',
          outImg
        ]);

        ff.on('close', () => {
          try { fs.unlinkSync(clipPath); } catch {}
          if (fs.existsSync(outImg)) {
            const buf = fs.readFileSync(outImg);
            try { fs.unlinkSync(outImg); } catch {}
            resolve({ ok: true, dataUrl: `data:image/jpeg;base64,${buf.toString('base64')}` });
          } else {
            resolve({ ok: false, error: 'ffmpegFailed' });
          }
        });
      } catch (err) {
        resolve({ ok: false, error: 'extractError', message: String(err?.message || err) });
      }
    });

    proc.on('error', (err) => {
      resolve({ ok: false, error: 'spawnError', message: String(err?.message || err) });
    });
  });
}

module.exports = {
  parseVtt,
  fetchTranscriptYtDlp,
  fetchPlaylistInfo,
  fetchChannelInfo,
  fetchVideoChapters,
  captureYoutubeFrame,
  getFormatArg
};
