import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UNIFIED_GOOGLE_SCOPES,
  buildGoogleAuthUrl,
  parseTokenFromUrlHash,
  exportMakeenBackupPayload,
  importMakeenBackupPayload,
  saveStoredGoogleAccessToken,
  getStoredGoogleAccessToken
} from '../src/lib/googleDriveSync.js';

// Mock localStorage for Node test runner
const memoryStore = new Map();
globalThis.localStorage = {
  getItem: (k) => memoryStore.get(k) || null,
  setItem: (k, v) => memoryStore.set(k, String(v)),
  removeItem: (k) => memoryStore.delete(k),
  clear: () => memoryStore.clear()
};

test('UNIFIED_GOOGLE_SCOPES contains profile, calendar, and drive.file', () => {
  assert.ok(UNIFIED_GOOGLE_SCOPES.includes('openid'));
  assert.ok(UNIFIED_GOOGLE_SCOPES.includes('email'));
  assert.ok(UNIFIED_GOOGLE_SCOPES.includes('profile'));
  assert.ok(UNIFIED_GOOGLE_SCOPES.includes('https://www.googleapis.com/auth/calendar.events'));
  assert.ok(UNIFIED_GOOGLE_SCOPES.includes('https://www.googleapis.com/auth/drive.file'));
});

test('buildGoogleAuthUrl formats valid OAuth URL with all requested scopes', () => {
  const url = buildGoogleAuthUrl({
    clientId: 'test-client-id.apps.googleusercontent.com',
    redirectUri: 'https://makeen.app/auth/callback',
    state: 'sync-all'
  });

  assert.ok(url.startsWith('https://accounts.google.com/o/oauth2/v2/auth?'));
  assert.ok(url.includes('client_id=test-client-id.apps.googleusercontent.com'));
  assert.ok(url.includes('response_type=token'));
  assert.ok(url.includes('prompt=consent'));
  assert.ok(url.includes(encodeURIComponent('https://www.googleapis.com/auth/drive.file')));
  assert.ok(url.includes(encodeURIComponent('https://www.googleapis.com/auth/calendar.events')));
});

test('parseTokenFromUrlHash and storage helpers save and retrieve access token', () => {
  memoryStore.clear();
  const hash = '#access_token=ya29.test_token_12345&token_type=Bearer&expires_in=3600&state=login';
  const parsed = parseTokenFromUrlHash(hash);

  assert.ok(parsed);
  assert.equal(parsed.token, 'ya29.test_token_12345');
  assert.equal(parsed.expiresIn, 3600);

  const stored = getStoredGoogleAccessToken();
  assert.equal(stored, 'ya29.test_token_12345');

  // Test clear
  saveStoredGoogleAccessToken(null);
  assert.equal(getStoredGoogleAccessToken(), null);
});

test('exportMakeenBackupPayload generates complete structured cloud snapshot', async () => {
  const payload = await exportMakeenBackupPayload();
  assert.equal(payload.app, 'Makeen Study OS');
  assert.equal(payload.version, '2.0.0');
  assert.ok(payload.exportedAt);
  assert.ok(Array.isArray(payload.library));
  assert.ok(Array.isArray(payload.notes));
  assert.ok(Array.isArray(payload.tasks));
  assert.ok(Array.isArray(payload.reminders));
});

test('importMakeenBackupPayload restores notes, tasks, and reminders', async () => {
  const testPayload = {
    app: 'Makeen Study OS',
    version: '2.0.0',
    notes: [{ id: 'n1', title: 'ملخص فيزياء', content: '# درس 1' }],
    tasks: [{ id: 't1', title: 'مذاكرة رياضيات', dueDate: '2026-11-12' }],
    reminders: [{ id: 'r1', title: 'صلاة العصر', time: '15:30', enabled: true }]
  };

  const counts = await importMakeenBackupPayload(testPayload);
  assert.equal(counts.notes, 1);
  assert.equal(counts.tasks, 1);
  assert.equal(counts.reminders, 1);
});
