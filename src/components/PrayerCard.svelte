<script>
  // PrayerCard.svelte — Dedicated widget displaying daily Islamic prayer times and Hijri/Gregorian date.
  // Settings (city, alert minutes, sound tone) are managed in Settings.

  import { onMount, onDestroy } from 'svelte';
  import Icon from './Icon.svelte';
  import { t, ui } from '../lib/lang.svelte.js';
  import {
    getPrayerTimes,
    getNextPrayerInfo,
    getFormattedDates,
    loadPrayerSettings,
    getSelectedCity,
    PRAYER_NAMES
  } from '../lib/prayer.js';
  import { playNotificationTone } from '../lib/sound.js';

  let { notify = null, onOpenSettings = null } = $props();

  let settings = $state(loadPrayerSettings());
  let timings = $state(null);
  let nextInfo = $state(null);
  let dateInfo = $state({ gregorian: '', hijri: '' });
  let activeCity = $state(getSelectedCity());
  let remindedPrayers = new Set();
  let timerInterval = null;

  async function updateTimes() {
    settings = loadPrayerSettings();
    activeCity = getSelectedCity(settings.cityId);
    dateInfo = getFormattedDates(new Date(), ui.lang);

    const res = await getPrayerTimes(new Date(), activeCity);
    if (res?.timings) {
      timings = res.timings;
      nextInfo = getNextPrayerInfo(timings, new Date());
      checkReminders();
    }
  }

  function checkReminders() {
    if (!settings.reminderEnabled || !nextInfo || !nextInfo.next) return;

    const leadMins = Number(settings.reminderMinutes) || 5;
    const diff = nextInfo.minutesUntilNext;
    const prayerKey = `${nextInfo.next.key}-${new Date().toDateString()}`;

    // Trigger reminder within the designated alert window (e.g., 5 minutes before)
    if (diff > 0 && diff <= leadMins && !remindedPrayers.has(prayerKey)) {
      remindedPrayers.add(prayerKey);
      const prayerName = ui.lang === 'ar' ? nextInfo.next.nameAr : nextInfo.next.nameEn;
      const msg = ui.lang === 'ar'
        ? `اقترب موعد صلاة ${prayerName} (${nextInfo.next.time}) — متبقي ${diff} د`
        : `Upcoming prayer: ${prayerName} (${nextInfo.next.time}) — ${diff}m remaining`;

      notify?.(msg, 'info');
      playNotificationTone(settings.soundTone);

      // Desktop system notification
      try {
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification(prayerName, { body: msg });
        }
      } catch {}
    }
  }

  onMount(() => {
    updateTimes();
    timerInterval = setInterval(() => {
      dateInfo = getFormattedDates(new Date(), ui.lang);
      if (timings) {
        nextInfo = getNextPrayerInfo(timings, new Date());
        checkReminders();
      }
    }, 30000); // Check every 30s
  });

  onDestroy(() => {
    if (timerInterval) clearInterval(timerInterval);
  });
</script>

{#if timings}
  <div class="prayer-card-container">
    <!-- Header: Hijri/Gregorian Date + Location + Countdown Badge -->
    <div class="prayer-header">
      <div class="date-col">
        <div class="hijri-badge">
          <Icon name="moon" size={14} />
          <span class="hijri-text">{dateInfo.hijri}</span>
        </div>
        <div class="gregorian-text">{dateInfo.gregorian}</div>
      </div>

      <div class="meta-col">
        <div class="city-pill" onclick={onOpenSettings} title={t('settings.prayerSettings') || 'Prayer Settings'}>
          <Icon name="globe" size={13} />
          <span>{ui.lang === 'ar' ? activeCity.nameAr : activeCity.nameEn} ({ui.lang === 'ar' ? activeCity.countryAr : activeCity.countryEn})</span>
        </div>

        {#if nextInfo && nextInfo.next}
          <div class="countdown-badge">
            <span class="countdown-pulse"></span>
            <span class="countdown-label">
              {ui.lang === 'ar' ? `القادمة: ${nextInfo.next.nameAr} بعد ${nextInfo.formattedUntil.ar}` : `Next: ${nextInfo.next.nameEn} in ${nextInfo.formattedUntil.en}`}
            </span>
          </div>
        {/if}
      </div>
    </div>

    <!-- 6 Prayer Items Grid -->
    <div class="prayers-grid">
      {#each [
        { key: 'fajr', label: PRAYER_NAMES.fajr, time: timings.fajr },
        { key: 'sunrise', label: PRAYER_NAMES.sunrise, time: timings.sunrise },
        { key: 'dhuhr', label: PRAYER_NAMES.dhuhr, time: timings.dhuhr },
        { key: 'asr', label: PRAYER_NAMES.asr, time: timings.asr },
        { key: 'maghrib', label: PRAYER_NAMES.maghrib, time: timings.maghrib },
        { key: 'isha', label: PRAYER_NAMES.isha, time: timings.isha }
      ] as item}
        {@const isNext = nextInfo?.next?.key === item.key}
        {@const isPassed = !isNext && nextInfo && nextInfo.current?.key !== item.key && nextInfo.minutesUntilNext > 0}
        <div class="prayer-tile {isNext ? 'is-next' : ''}">
          <div class="tile-icon-row">
            <Icon name={item.label.icon} size={15} />
            {#if isNext}
              <span class="next-tag">{ui.lang === 'ar' ? 'القادمة' : 'Next'}</span>
            {/if}
          </div>
          <div class="prayer-name">{ui.lang === 'ar' ? item.label.ar : item.label.en}</div>
          <div class="prayer-time">{item.time}</div>
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  .prayer-card-container {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 16px 20px;
    margin-bottom: 20px;
    box-shadow: var(--shadow);
    display: flex;
    flex-direction: column;
    gap: 14px;
    transition: border-color 0.2s;
  }

  .prayer-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
    border-bottom: 1px solid var(--border);
    padding-bottom: 12px;
  }

  .date-col {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .hijri-badge {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--accent);
    font-size: 14px;
    font-weight: 700;
  }

  .gregorian-text {
    font-size: 12px;
    color: var(--muted);
  }

  .meta-col {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .city-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 20px;
    padding: 4px 12px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }

  .city-pill:hover {
    background: var(--border);
  }

  .countdown-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--accent-soft);
    color: var(--accent);
    border-radius: 20px;
    padding: 4px 12px;
    font-size: 12px;
    font-weight: 700;
  }

  .countdown-pulse {
    width: 7px;
    height: 7px;
    background: var(--accent);
    border-radius: 50%;
    animation: pulse 1.8s infinite;
  }

  @keyframes pulse {
    0% { transform: scale(0.9); opacity: 0.7; }
    50% { transform: scale(1.3); opacity: 1; }
    100% { transform: scale(0.9); opacity: 0.7; }
  }

  /* Grid of 6 prayers */
  .prayers-grid {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 10px;
  }

  @media (max-width: 860px) {
    .prayers-grid {
      grid-template-columns: repeat(3, 1fr);
    }
  }

  .prayer-tile {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 4px;
    transition: transform 0.15s, border-color 0.15s, background 0.15s;
  }

  .prayer-tile.is-next {
    background: var(--accent-soft);
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
    transform: translateY(-2px);
  }

  .tile-icon-row {
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--muted);
  }

  .prayer-tile.is-next .tile-icon-row {
    color: var(--accent);
  }

  .next-tag {
    font-size: 10px;
    background: var(--accent);
    color: #fff;
    border-radius: 4px;
    padding: 1px 4px;
    font-weight: 700;
  }

  .prayer-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
  }

  .prayer-tile.is-next .prayer-name {
    color: var(--accent);
    font-weight: 700;
  }

  .prayer-time {
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.5px;
    color: var(--text);
  }

  .prayer-tile.is-next .prayer-time {
    color: var(--accent);
  }
</style>
