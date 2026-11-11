// src/lib/api.js — PostgreSQL Real Database Client Adapter for Makeen
// Seamlessly syncs community shares, learning paths, orders, and reviews with PostgreSQL backend.

const DEFAULT_API_URL = 'http://localhost:4000/api';

export function getApiBaseUrl() {
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem('makeen:api_url');
    if (saved && saved.trim()) return saved.trim().replace(/\/+$/, '');
  }
  return (import.meta.env?.VITE_API_URL || DEFAULT_API_URL).replace(/\/+$/, '');
}

export function setApiBaseUrl(url) {
  if (typeof localStorage !== 'undefined') {
    if (url && url.trim()) {
      localStorage.setItem('makeen:api_url', url.trim());
    } else {
      localStorage.removeItem('makeen:api_url');
    }
  }
}

export async function checkBackendHealth() {
  try {
    const baseUrl = getApiBaseUrl();
    const res = await fetch(`${baseUrl}/health`, {
      signal: AbortSignal.timeout ? AbortSignal.timeout(3000) : undefined
    });
    if (res.ok) {
      const data = await res.json();
      return { ok: true, data };
    }
  } catch {}
  return { ok: false };
}

export async function apiFetchCommunityShares(params = {}) {
  const baseUrl = getApiBaseUrl();
  const query = new URLSearchParams();
  if (params.type && params.type !== 'all') query.set('type', params.type);
  if (params.sort) query.set('sort', params.sort);
  if (params.q) query.set('q', params.q);

  const res = await fetch(`${baseUrl}/community?${query.toString()}`, {
    signal: AbortSignal.timeout ? AbortSignal.timeout(6000) : undefined
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const data = await res.json();
  return data.shares || [];
}

export async function apiPublishCommunityShare(shareData) {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/community`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(shareData),
    signal: AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const data = await res.json();
  return data.share;
}

export async function apiUpdateCommunityShare(shareId, patch) {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/community/${encodeURIComponent(shareId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
    signal: AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const data = await res.json();
  return data.share;
}

export async function apiDeleteCommunityShare(shareId) {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/community/${encodeURIComponent(shareId)}`, {
    method: 'DELETE',
    signal: AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return true;
}

export async function apiRecordShareVisit(shareId) {
  try {
    const baseUrl = getApiBaseUrl();
    await fetch(`${baseUrl}/community/${encodeURIComponent(shareId)}/visit`, {
      method: 'POST',
      signal: AbortSignal.timeout ? AbortSignal.timeout(3000) : undefined
    });
  } catch {}
}

export async function apiSyncUserData({ userId, library = [], tasks = [], notes = [] }) {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/user/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, library, tasks, notes }),
    signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return await res.json();
}

export async function apiFetchUserData(userId) {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/user/sync?userId=${encodeURIComponent(userId)}`, {
    signal: AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return await res.json();
}

export async function apiSaveUserBackup({ userId, backupType = 'full', data, deviceInfo = '' }) {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/user/backup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, backupType, data, deviceInfo }),
    signal: AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return await res.json();
}

export async function apiFetchUserBackup(userId) {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/user/backup?userId=${encodeURIComponent(userId)}`, {
    signal: AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return await res.json();
}
