// src/lib/customReminders.js
// Custom notifications & reminders for Makeen Planner
// Works across Web, Desktop (Tauri/Electron), and Mobile with audio synthesis, system notifications & in-app alerts.

import { playNotificationTone, AVAILABLE_SOUNDS } from './sound.js';

const STORAGE_KEY = 'makeen.custom_reminders.v1';

export const ADVANCE_NOTICE_OPTIONS = [
  { value: 0, labelEn: 'At time of event', labelAr: 'في نفس الموعد بالضبط' },
  { value: 5, labelEn: '5 minutes before', labelAr: 'قبل 5 دقائق' },
  { value: 10, labelEn: '10 minutes before', labelAr: 'قبل 10 دقائق' },
  { value: 15, labelEn: '15 minutes before', labelAr: 'قبل 15 دقيقة' },
  { value: 30, labelEn: '30 minutes before', labelAr: 'قبل 30 دقيقة' },
  { value: 60, labelEn: '1 hour before', labelAr: 'قبل ساعة واحدة' }
];

export const REPEAT_OPTIONS = [
  { value: 'none', labelEn: 'Once (No repeat)', labelAr: 'مرة واحدة (بدون تكرار)' },
  { value: 'daily', labelEn: 'Daily', labelAr: 'يومياً' },
  { value: 'weekly', labelEn: 'Weekly', labelAr: 'أسبوعياً' }
];

export function listCustomReminders() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.error('Failed to load custom reminders:', err);
    return [];
  }
}

export function saveCustomReminders(reminders) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(reminders));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('makeen:reminders-updated', { detail: reminders }));
    }
  } catch (err) {
    console.error('Failed to save custom reminders:', err);
  }
}

export function addCustomReminder(data) {
  const reminders = listCustomReminders();
  const now = new Date();
  const dateStr = data.date || now.toISOString().slice(0, 10);
  const timeStr = data.time || `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const item = {
    id: data.id || crypto.randomUUID(),
    title: (data.title || 'تذكير مخصص').trim(),
    notes: (data.notes || '').trim(),
    date: dateStr,
    time: timeStr,
    advanceMinutes: Number(data.advanceMinutes) || 0,
    repeat: data.repeat || 'none',
    sound: data.sound || 'soft-chime',
    enabled: data.enabled !== false,
    linkedResource: data.linkedResource || null, // { kind: 'pdf'|'video'|'note', id, title, page }
    lastNotifiedCycle: '',
    createdAt: new Date().toISOString()
  };

  reminders.unshift(item);
  saveCustomReminders(reminders);
  return item;
}

export function updateCustomReminder(id, patch) {
  const reminders = listCustomReminders();
  const idx = reminders.findIndex((r) => r.id === id);
  if (idx === -1) return null;

  reminders[idx] = {
    ...reminders[idx],
    ...patch,
    updatedAt: new Date().toISOString()
  };

  saveCustomReminders(reminders);
  return reminders[idx];
}

export function deleteCustomReminder(id) {
  const reminders = listCustomReminders();
  const filtered = reminders.filter((r) => r.id !== id);
  saveCustomReminders(filtered);
}

export function toggleCustomReminder(id) {
  const reminders = listCustomReminders();
  const item = reminders.find((r) => r.id === id);
  if (!item) return;
  item.enabled = !item.enabled;
  saveCustomReminders(reminders);
}

/**
 * Calculates milliseconds until reminder trigger time
 */
export function getRemainingTimeText(reminder, lang = 'ar') {
  if (!reminder || !reminder.enabled) return lang === 'ar' ? 'متوقف' : 'Disabled';

  const [year, month, day] = reminder.date.split('-').map(Number);
  const [hours, minutes] = reminder.time.split(':').map(Number);
  const target = new Date(year, month - 1, day, hours, minutes);
  const alertTime = new Date(target.getTime() - (reminder.advanceMinutes || 0) * 60000);

  const diffMs = alertTime.getTime() - Date.now();
  if (diffMs <= 0) {
    return lang === 'ar' ? 'حان موعده' : 'Due now';
  }

  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) {
    const remHours = diffHours % 24;
    return lang === 'ar'
      ? `بعد ${diffDays} يوم${remHours > 0 ? ` و${remHours} ساعة` : ''}`
      : `in ${diffDays}d ${remHours > 0 ? `${remHours}h` : ''}`;
  }

  if (diffHours > 0) {
    const remMins = diffMins % 60;
    return lang === 'ar'
      ? `بعد ${diffHours} ساعة${remMins > 0 ? ` و${remMins} دقيقة` : ''}`
      : `in ${diffHours}h ${remMins > 0 ? `${remMins}m` : ''}`;
  }

  return lang === 'ar' ? `بعد ${diffMins} دقيقة` : `in ${diffMins} min`;
}

/**
 * Evaluates active custom reminders and fires alerts when due
 */
export function checkDueCustomReminders() {
  const reminders = listCustomReminders();
  const now = new Date();
  const triggered = [];
  let updated = false;

  for (const reminder of reminders) {
    if (!reminder.enabled) continue;

    const [year, month, day] = (reminder.date || '').split('-').map(Number);
    const [hours, minutes] = (reminder.time || '').split(':').map(Number);
    if (isNaN(year) || isNaN(hours)) continue;

    const targetDate = new Date(year, month - 1, day, hours, minutes);
    const alertTime = new Date(targetDate.getTime() - (reminder.advanceMinutes || 0) * 60000);

    const timeDiff = now.getTime() - alertTime.getTime();
    // Fire if due within last 5 minutes (300,000 ms) and not in future
    if (timeDiff >= 0 && timeDiff <= 300000) {
      const cycleKey = `${reminder.date}_${reminder.time}`;
      if (reminder.lastNotifiedCycle !== cycleKey) {
        reminder.lastNotifiedCycle = cycleKey;
        triggered.push(reminder);
        updated = true;

        // If daily or weekly, advance date automatically
        if (reminder.repeat === 'daily') {
          targetDate.setDate(targetDate.getDate() + 1);
          reminder.date = targetDate.toISOString().slice(0, 10);
        } else if (reminder.repeat === 'weekly') {
          targetDate.setDate(targetDate.getDate() + 7);
          reminder.date = targetDate.toISOString().slice(0, 10);
        } else {
          // One-shot reminder is completed
          reminder.enabled = false;
        }
      }
    }
  }

  if (updated) {
    saveCustomReminders(reminders);
  }

  return triggered;
}

/**
 * Executes audiovisual chime, OS notification, and in-app event dispatch
 */
export function fireCustomReminderNotification(reminder) {
  if (!reminder) return;

  // 1. Play offline audio tone
  try {
    playNotificationTone(reminder.sound || 'soft-chime');
  } catch (err) {
    console.warn('Audio tone synthesis failed:', err);
  }

  // 2. Native OS notification
  const title = `مَكِين — ${reminder.title}`;
  const body = reminder.advanceMinutes > 0
    ? `موعد التذكير يبدأ بعد ${reminder.advanceMinutes} دقيقة (${reminder.time})`
    : `حان موعد التذكير الآن (${reminder.time})${reminder.notes ? `\n${reminder.notes}` : ''}`;

  if (typeof window !== 'undefined') {
    if (window.studyos?.notify) {
      window.studyos.notify(title, body);
    } else if (window.__TAURI__?.notification?.sendNotification) {
      window.__TAURI__.notification.sendNotification({ title, body });
    } else if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(title, { body, icon: '/favicon.ico' });
      } catch {}
    }

    // 3. In-App Dispatch for Interactive Dialog
    window.dispatchEvent(new CustomEvent('makeen:show-reminder-alert', {
      detail: { reminder, title, body }
    }));
  }
}
