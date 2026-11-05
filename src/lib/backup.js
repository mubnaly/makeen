// src/lib/backup.js — Full Database Backup & Restore for Makeen
// Exports and imports all workspace data: documents, projects, markdown notes & folders, habits, flashcards, settings.

import { listFolders, listAllNotes } from './markdownStore.js';
import { listHabits, getAllGoals } from './habits.js';

export function createFullBackupPayload() {
  const payload = {
    version: 1,
    appName: 'Makeen',
    exportedAt: new Date().toISOString(),
    storage: {}
  };

  if (typeof localStorage !== 'undefined') {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('studyos.') || key.startsWith('makeen.'))) {
        try {
          payload.storage[key] = localStorage.getItem(key);
        } catch {}
      }
    }
  }

  // Also structured data snapshot
  payload.data = {
    notes: listAllNotes(),
    folders: listFolders(),
    habits: listHabits(),
    goals: getAllGoals()
  };

  return payload;
}

export function exportFullBackup() {
  const payload = createFullBackupPayload();
  const jsonStr = JSON.stringify(payload, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const d = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `makeen-backup-${d}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function restoreFullBackup(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result || '');
        const json = JSON.parse(text);
        if (!json || typeof json !== 'object') {
          throw new Error('Invalid JSON structure');
        }

        let restoredKeys = 0;
        if (json.storage && typeof json.storage === 'object') {
          for (const [key, value] of Object.entries(json.storage)) {
            if (typeof value === 'string') {
              try {
                localStorage.setItem(key, value);
                restoredKeys++;
              } catch {}
            }
          }
        }

        resolve({ success: true, restoredKeys, exportedAt: json.exportedAt || null });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('File reading error'));
    reader.readAsText(file);
  });
}
