// src/lib/googleCalendar.js
// Google Calendar integration for Makeen Planner
// Supports listing Google Calendar events, creating events via Google Calendar Web Intent,
// synchronizing via iCal (.ics) feed URL, and exporting Planner tasks to Google Calendar.

const GCAL_URL_KEY = 'makeen.gcal.feed_url';
const GCAL_EVENTS_KEY = 'makeen.gcal.cached_events';
const GCAL_LAST_SYNC_KEY = 'makeen.gcal.last_sync';

export function getGoogleCalendarFeedUrl() {
  if (typeof localStorage === 'undefined') return '';
  return localStorage.getItem(GCAL_URL_KEY) || '';
}

export function saveGoogleCalendarFeedUrl(url) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(GCAL_URL_KEY, (url || '').trim());
}

export function getCachedGoogleCalendarEvents() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(GCAL_EVENTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveCachedGoogleCalendarEvents(events) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(GCAL_EVENTS_KEY, JSON.stringify(events));
  localStorage.setItem(GCAL_LAST_SYNC_KEY, new Date().toISOString());
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('makeen:gcal-updated', { detail: events }));
  }
}

/**
 * Builds a direct 1-click Google Calendar Event Creation URL (Web Intent)
 */
export function buildGoogleCalendarUrl({
  title = '',
  date = '',
  startTime = '',
  durationMinutes = 60,
  details = '',
  location = ''
} = {}) {
  const base = 'https://calendar.google.com/calendar/render?action=TEMPLATE';

  // Format date & time into YYYYMMDDTHHmmSS or YYYYMMDD
  let startStr = '';
  let endStr = '';

  const cleanDate = (date || new Date().toISOString().slice(0, 10)).replace(/-/g, '');

  if (startTime) {
    const [hh, mm] = startTime.split(':').map((x) => String(x).padStart(2, '0'));
    startStr = `${cleanDate}T${hh}${mm}00`;

    // Compute end time
    const [y, m, d] = (date || new Date().toISOString().slice(0, 10)).split('-').map(Number);
    const startObj = new Date(y, m - 1, d, parseInt(hh, 10), parseInt(mm, 10));
    const endObj = new Date(startObj.getTime() + (durationMinutes || 60) * 60000);

    const endY = endObj.getFullYear();
    const endM = String(endObj.getMonth() + 1).padStart(2, '0');
    const endD = String(endObj.getDate()).padStart(2, '0');
    const endH = String(endObj.getHours()).padStart(2, '0');
    const endMin = String(endObj.getMinutes()).padStart(2, '0');
    endStr = `${endY}${endM}${endD}T${endH}${endMin}00`;
  } else {
    startStr = cleanDate;
    endStr = cleanDate;
  }

  const params = new URLSearchParams({
    text: title || 'مهمة دراسية في مَكِين',
    dates: `${startStr}/${endStr}`,
    details: details ? `${details}\n\n(مجدول عبر مَكِين - Makeen Study OS)` : '(مجدول عبر مَكِين - Makeen Study OS)'
  });

  if (location) params.set('location', location);

  return `${base}&${params.toString()}`;
}

/**
 * Open Google Calendar Web Event creator in new tab
 */
export function openInGoogleCalendar(eventData) {
  const url = buildGoogleCalendarUrl(eventData);
  if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
  return url;
}

/**
 * Standard iCalendar (.ics) parser for Google Calendar feeds
 */
export function parseIcsCalendar(icsText) {
  if (!icsText || typeof icsText !== 'string') return [];
  const lines = icsText.replace(/\r\n /g, '').replace(/\r/g, '').split('\n');
  const events = [];
  let inEvent = false;
  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === 'BEGIN:VEVENT') {
      inEvent = true;
      current = {
        id: crypto.randomUUID(),
        isGCal: true,
        title: 'حدث تقويم Google',
        notes: '',
        dueDate: '',
        startTime: null,
        durationMinutes: 60,
        status: 'todo',
        priority: 'normal'
      };
      continue;
    }

    if (line === 'END:VEVENT' && inEvent) {
      if (current && current.dueDate) {
        events.push(current);
      }
      inEvent = false;
      current = null;
      continue;
    }

    if (!inEvent || !current) continue;

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const propRaw = line.slice(0, colonIdx);
    const val = line.slice(colonIdx + 1).replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\n/g, '\n');
    const prop = propRaw.split(';')[0].toUpperCase();

    if (prop === 'SUMMARY') {
      current.title = val || 'حدث تقويم Google';
    } else if (prop === 'DESCRIPTION') {
      current.notes = val;
    } else if (prop === 'UID') {
      current.id = `gcal_${val.replace(/[^a-zA-Z0-9_-]/g, '')}`;
    } else if (prop === 'DTSTART') {
      const parsed = parseIcsDateTime(val);
      if (parsed) {
        current.dueDate = parsed.date;
        current.startTime = parsed.time;
      }
    } else if (prop === 'DTEND') {
      const parsed = parseIcsDateTime(val);
      if (parsed && current.startTime && parsed.time) {
        const [sh, sm] = current.startTime.split(':').map(Number);
        const [eh, em] = parsed.time.split(':').map(Number);
        const diff = (eh * 60 + em) - (sh * 60 + sm);
        if (diff > 0) current.durationMinutes = diff;
      }
    }
  }

  return events;
}

function parseIcsDateTime(val) {
  if (!val) return null;
  // Format: 20261111T090000Z or 20261111
  const clean = val.replace(/[^0-9T]/g, '');
  if (clean.length >= 8) {
    const y = clean.slice(0, 4);
    const m = clean.slice(4, 6);
    const d = clean.slice(6, 8);
    const date = `${y}-${m}-${d}`;

    let time = null;
    const tIdx = clean.indexOf('T');
    if (tIdx !== -1 && clean.length >= tIdx + 5) {
      const hh = clean.slice(tIdx + 1, tIdx + 3);
      const mm = clean.slice(tIdx + 3, tIdx + 5);
      time = `${hh}:${mm}`;
    }
    return { date, time };
  }
  return null;
}

/**
 * Fetch and synchronize Google Calendar feed
 */
export async function syncGoogleCalendarFeed(customUrl = null) {
  const url = customUrl || getGoogleCalendarFeedUrl();
  if (!url) return { ok: false, error: 'noUrl' };

  try {
    let icsText = '';

    // Check Tauri Desktop bridge if present
    const tauriInvoke = typeof window !== 'undefined' && (
      window.__TAURI__?.core?.invoke ||
      window.__TAURI__?.invoke ||
      window.__TAURI_INTERNALS__?.invoke
    );

    if (tauriInvoke) {
      try {
        icsText = await tauriInvoke('fetch_url_content', { url });
      } catch (err) {
        console.warn('Tauri fetch_url_content failed for calendar, trying fetch:', err);
      }
    }

    if (!icsText) {
      // Direct fetch or public CORS proxy
      try {
        const res = await fetch(url);
        if (res.ok) icsText = await res.text();
      } catch {
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
        const res = await fetch(proxyUrl);
        if (res.ok) icsText = await res.text();
      }
    }

    if (!icsText || !icsText.includes('BEGIN:VCALENDAR')) {
      return { ok: false, error: 'invalidCalendarData' };
    }

    const events = parseIcsCalendar(icsText);
    saveCachedGoogleCalendarEvents(events);
    return { ok: true, count: events.length, events };
  } catch (err) {
    console.error('Google Calendar sync failed:', err);
    return { ok: false, error: err.message || String(err) };
  }
}

/**
 * Export Planner tasks as an iCalendar (.ics) file to import into Google Calendar
 */
export function exportTasksToIcs(tasks = []) {
  const now = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  let ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Makeen//Makeen Study OS//AR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Makeen Study Planner'
  ];

  for (const t of tasks) {
    if (!t.dueDate) continue;
    const cleanDate = t.dueDate.replace(/-/g, '');
    let dtStart = cleanDate;
    let dtEnd = cleanDate;

    if (t.startTime) {
      const [hh, mm] = t.startTime.split(':').map((x) => String(x).padStart(2, '0'));
      dtStart = `${cleanDate}T${hh}${mm}00`;
      const dur = t.durationMinutes || 60;
      const [y, m, d] = t.dueDate.split('-').map(Number);
      const startObj = new Date(y, m - 1, d, parseInt(hh, 10), parseInt(mm, 10));
      const endObj = new Date(startObj.getTime() + dur * 60000);
      const endY = endObj.getFullYear();
      const endM = String(endObj.getMonth() + 1).padStart(2, '0');
      const endD = String(endObj.getDate()).padStart(2, '0');
      const endH = String(endObj.getHours()).padStart(2, '0');
      const endMin = String(endObj.getMinutes()).padStart(2, '0');
      dtEnd = `${endY}${endM}${endD}T${endH}${endMin}00`;
    }

    ics.push('BEGIN:VEVENT');
    ics.push(`UID:${t.id}@makeen.app`);
    ics.push(`DTSTAMP:${now}`);
    ics.push(`DTSTART:${dtStart}`);
    ics.push(`DTEND:${dtEnd}`);
    ics.push(`SUMMARY:${t.title || 'مهمة دراسية'}`);
    if (t.notes) ics.push(`DESCRIPTION:${t.notes.replace(/\n/g, '\\n')}`);
    ics.push('STATUS:CONFIRMED');
    ics.push('END:VEVENT');
  }

  ics.push('END:VCALENDAR');
  return ics.join('\r\n');
}

/**
 * Downloads tasks as a .ics file
 */
export function downloadTasksIcs(tasks) {
  const icsData = exportTasksToIcs(tasks);
  const blob = new Blob([icsData], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `makeen-planner-${new Date().toISOString().slice(0, 10)}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
