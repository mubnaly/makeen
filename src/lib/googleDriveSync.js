// src/lib/googleDriveSync.js
// Makeen Cloud Sync with Google Account (Google Drive Backup & Two-Way Calendar Sync)
// Uses Google OAuth 2.0 with unified scopes: profile, drive.file, calendar.events.

import * as library from './library.js';
import { listAllNotes, createNote, updateNote, listFolders, createFolder } from './markdownStore.js';
import { listTasks, putTask } from './storage.js';
import { listCustomReminders, saveCustomReminders } from './customReminders.js';
import { saveCachedGoogleCalendarEvents } from './googleCalendar.js';

const GOOGLE_TOKEN_STORAGE = 'makeen.google.access_token';
const GOOGLE_TOKEN_EXPIRY = 'makeen.google.token_expiry';
const GOOGLE_CLIENT_ID_STORAGE = 'makeen.google.client_id';

export const UNIFIED_GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/drive.file'
];

export function getGoogleOAuthClientId() {
  if (typeof localStorage === 'undefined') return '';
  return localStorage.getItem(GOOGLE_CLIENT_ID_STORAGE) || import.meta.env?.VITE_GOOGLE_CLIENT_ID || '';
}

export function saveGoogleOAuthClientId(clientId) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(GOOGLE_CLIENT_ID_STORAGE, (clientId || '').trim());
}

export function getStoredGoogleAccessToken() {
  if (typeof localStorage === 'undefined') return null;
  const token = localStorage.getItem(GOOGLE_TOKEN_STORAGE);
  const expiry = Number(localStorage.getItem(GOOGLE_TOKEN_EXPIRY) || 0);
  if (!token) return null;
  if (expiry && Date.now() > expiry) {
    // Token expired
    return null;
  }
  return token;
}

export function saveStoredGoogleAccessToken(token, expiresInSeconds = 3600) {
  if (typeof localStorage === 'undefined') return;
  if (!token) {
    localStorage.removeItem(GOOGLE_TOKEN_STORAGE);
    localStorage.removeItem(GOOGLE_TOKEN_EXPIRY);
    return;
  }
  localStorage.setItem(GOOGLE_TOKEN_STORAGE, token);
  localStorage.setItem(GOOGLE_TOKEN_EXPIRY, String(Date.now() + expiresInSeconds * 1000));
}

/**
 * Builds the Google OAuth 2.0 Authorization URL with all unified scopes
 */
export function buildGoogleAuthUrl({ clientId, redirectUri, state = 'login' } = {}) {
  const cid = clientId || getGoogleOAuthClientId();
  const rUri = redirectUri || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173');

  const params = new URLSearchParams({
    client_id: cid,
    redirect_uri: rUri,
    response_type: 'token',
    scope: UNIFIED_GOOGLE_SCOPES.join(' '),
    include_granted_scopes: 'true',
    state,
    prompt: 'consent'
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * Parses access token from OAuth redirect URL hash (#access_token=...&expires_in=...)
 */
export function parseTokenFromUrlHash(hashStr) {
  if (!hashStr || !hashStr.includes('access_token')) return null;
  const raw = hashStr.startsWith('#') ? hashStr.slice(1) : hashStr;
  const params = new URLSearchParams(raw);
  const token = params.get('access_token');
  const expiresIn = Number(params.get('expires_in') || 3600);
  const state = params.get('state');

  if (token) {
    saveStoredGoogleAccessToken(token, expiresIn);
    return { token, expiresIn, state };
  }
  return null;
}

/**
 * Gathers all local user data into a clean JSON backup payload
 */
export async function exportMakeenBackupPayload() {
  const docs = library.listDocuments() || [];
  const playlists = library.listPlaylists ? library.listPlaylists() : [];
  const notes = listAllNotes() || [];
  const folders = listFolders() || [];
  let tasks = [];
  try {
    tasks = await listTasks();
  } catch {}
  const reminders = listCustomReminders() || [];

  return {
    app: 'Makeen Study OS',
    version: '2.0.0',
    exportedAt: new Date().toISOString(),
    library: docs.map((d) => ({
      id: d.id,
      kind: d.kind || 'pdf',
      title: d.title || d.filename,
      filename: d.filename,
      url: d.url || '',
      lastPage: d.lastPage || 1,
      totalPages: d.totalPages || d.pageCount || 0,
      lastSeconds: d.lastSeconds || 0,
      duration: d.duration || 0,
      bookmarks: d.bookmarks || [],
      notes: d.notes || [],
      highlights: d.highlights || [],
      metadata: d.metadata || {}
    })),
    playlists,
    notes,
    folders,
    tasks,
    reminders
  };
}

/**
 * Restores local user data from a Makeen backup payload
 */
export async function importMakeenBackupPayload(payload) {
  if (!payload || !payload.app) {
    throw new Error('الملف غير صالح أو لا يحتوي على بنية بيانات مَكِين');
  }

  let restoredCounts = { docs: 0, notes: 0, tasks: 0, reminders: 0 };

  // Restore notes & folders
  if (Array.isArray(payload.folders)) {
    for (const f of payload.folders) {
      if (f.name) createFolder({ name: f.name, parentId: f.parentId });
    }
  }
  if (Array.isArray(payload.notes)) {
    for (const n of payload.notes) {
      if (n.title || n.content) {
        createNote({ title: n.title, content: n.content, folderId: n.folderId });
        restoredCounts.notes++;
      }
    }
  }

  // Restore tasks
  if (Array.isArray(payload.tasks)) {
    for (const t of payload.tasks) {
      await putTask(t);
      restoredCounts.tasks++;
    }
  }

  // Restore reminders
  if (Array.isArray(payload.reminders)) {
    saveCustomReminders(payload.reminders);
    restoredCounts.reminders = payload.reminders.length;
  }

  return restoredCounts;
}

/**
 * Uploads Makeen backup file directly to the user's Google Drive
 */
export async function uploadBackupToGoogleDrive(token = null) {
  const authToken = token || getStoredGoogleAccessToken();
  if (!authToken) throw new Error('يرجى تسجيل الدخول بحساب Google أولاً لتفعيل المزامنة مع Drive');

  const backupData = await exportMakeenBackupPayload();
  const fileContent = JSON.stringify(backupData, null, 2);
  const fileName = 'makeen_cloud_backup.json';

  // 1. Search if backup file already exists in user's Drive
  let existingFileId = null;
  try {
    const searchRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=name='${fileName}' and trashed=false&fields=files(id,name,modifiedTime)`,
      { headers: { Authorization: `Bearer ${authToken}` } }
    );
    if (searchRes.ok) {
      const searchData = await searchRes.json();
      if (searchData.files && searchData.files.length > 0) {
        existingFileId = searchData.files[0].id;
      }
    }
  } catch {}

  // 2. Create or Update file via Multipart Upload
  const boundary = '-------314159265358979323846';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const metadata = {
    name: fileName,
    mimeType: 'application/json',
    description: 'Makeen Study OS Cloud Backup Snapshot'
  };

  const multipartRequestBody =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    'Content-Type: application/json\r\n\r\n' +
    fileContent +
    closeDelimiter;

  let url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
  let method = 'POST';

  if (existingFileId) {
    url = `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart`;
    method = 'PATCH';
  }

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`
    },
    body: multipartRequestBody
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`فشل رفع النسخة الاحتياطية إلى Google Drive: ${res.status} - ${errText}`);
  }

  const result = await res.json();
  return { ok: true, fileId: result.id, name: result.name, modifiedTime: new Date().toISOString() };
}

/**
 * Downloads latest Makeen backup file from Google Drive and restores it
 */
export async function restoreBackupFromGoogleDrive(token = null) {
  const authToken = token || getStoredGoogleAccessToken();
  if (!authToken) throw new Error('يرجى تسجيل الدخول بحساب Google أولاً');

  const fileName = 'makeen_cloud_backup.json';

  // 1. Find file id
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=name='${fileName}' and trashed=false&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc`,
    { headers: { Authorization: `Bearer ${authToken}` } }
  );

  if (!searchRes.ok) throw new Error('تعذر البحث عن ملف النسخة الاحتياطية في Google Drive');
  const searchData = await searchRes.json();
  if (!searchData.files || searchData.files.length === 0) {
    throw new Error('لم يتم العثور على أي نسخة احتياطية سابقة لمَكِين في حسابك على Google Drive');
  }

  const fileId = searchData.files[0].id;

  // 2. Download file contents
  const dlRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${authToken}` }
  });

  if (!dlRes.ok) throw new Error('تعذر تنزيل ملف النسخة الاحتياطية من Google Drive');
  const backupJson = await dlRes.json();

  // 3. Restore data
  const counts = await importMakeenBackupPayload(backupJson);
  return { ok: true, counts, modifiedTime: searchData.files[0].modifiedTime };
}

/**
 * Syncs Google Calendar directly using Google Calendar REST API v3
 */
export async function syncGoogleCalendarViaOAuth(token = null) {
  const authToken = token || getStoredGoogleAccessToken();
  if (!authToken) return { ok: false, error: 'no_token' };

  try {
    const now = new Date();
    const timeMin = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
    const timeMax = new Date(now.getFullYear(), now.getMonth() + 2, 1).toISOString();

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime`,
      { headers: { Authorization: `Bearer ${authToken}` } }
    );

    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    const items = data.items || [];

    const mapped = items.map((ev) => {
      const startIso = ev.start?.dateTime || ev.start?.date || '';
      const endIso = ev.end?.dateTime || ev.end?.date || '';
      const dueDate = startIso.slice(0, 10);
      const startTime = startIso.includes('T') ? startIso.slice(11, 16) : '';
      let durationMinutes = 60;
      if (startIso.includes('T') && endIso.includes('T')) {
        const s = new Date(startIso).getTime();
        const e = new Date(endIso).getTime();
        if (e > s) durationMinutes = Math.round((e - s) / 60000);
      }

      return {
        id: `gcal-${ev.id}`,
        title: ev.summary || 'حدث بدون عنوان',
        dueDate,
        startTime,
        durationMinutes,
        source: 'google',
        htmlLink: ev.htmlLink,
        status: 'todo'
      };
    });

    saveCachedGoogleCalendarEvents(mapped);
    return { ok: true, events: mapped, count: mapped.length };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
