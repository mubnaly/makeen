<script>
  // Report section on the home page: everything about how StudyOS is used —
  // review streak, per-day activity and lifetime totals, computed from the
  // persisted usage record (lib/usage.js) plus the live library counts.
  import { t } from '../lib/lang.svelte.js';
  import { loadUsage, lastNDays, totals, reviewStreak, ACTIVITY_DAYS } from '../lib/usage.js';

  let { docs = [], cards = [], decks = [], tasks = [], pagesRead = 0 } = $props();

  const usage = $derived(loadUsage());
  const tot = $derived(totals(usage.days));
  const streak = $derived(reviewStreak(usage.days));
  const days = $derived(lastNDays(usage.days, ACTIVITY_DAYS));
  const dayValue = (d) => d.reviews + d.captures + d.cards + d.exports;
  const maxDay = $derived(Math.max(1, ...days.map(dayValue)));
  const activityTotal = $derived(days.reduce((n, d) => n + dayValue(d), 0));
  const todayRow = $derived(days[days.length - 1] || { reviews: 0 });
  const tasksDone = $derived(tasks.filter((x) => x.status === 'done').length);
  const videoCount = $derived(docs.filter((d) => d.kind === 'video').length);

  function tip(d) {
    return `${d.date} · ${t('report.reviews')}: ${d.reviews} · ${t('today.statCaptures')}: ${d.captures} · ${t('report.cardsMade')}: ${d.cards} · ${t('report.exports')}: ${d.exports}`;
  }
</script>

<section class="report card">
  <div class="report-head">
    <span class="section-title" style="margin:0">{t('report.title')}</span>
    <span class="muted" style="font-size:12px">{t('report.subtitle')}</span>
  </div>

  <div class="report-grid">
    <div class="r-tile"><div class="n">{tot.reviews}</div><div class="l">{t('report.reviews')}</div></div>
    <div class="r-tile"><div class="n">{todayRow.reviews}</div><div class="l">{t('report.reviewsToday')}</div></div>
    <div class="r-tile accent">
      <div class="n">{streak > 0 ? streak : '—'}</div>
      <div class="l">{streak > 0 ? t('report.streak', { n: streak }) : t('report.noStreak')}</div>
    </div>
    <div class="r-tile"><div class="n">{tot.exports}</div><div class="l">{t('report.exports')}</div></div>
    <div class="r-tile"><div class="n">{cards.length}</div><div class="l">{t('today.statCards')}</div></div>
    <div class="r-tile"><div class="n">{tasksDone}/{tasks.length}</div><div class="l">{t('report.tasksDone')}</div></div>
    <div class="r-tile"><div class="n">{pagesRead}</div><div class="l">{t('report.pagesRead')}</div></div>
    <div class="r-tile"><div class="n">{decks.length}</div><div class="l">{t('report.sets')}</div></div>
    <div class="r-tile"><div class="n">{videoCount}</div><div class="l">{t('report.videos')}</div></div>
  </div>

  <div class="section-title">{t('report.activity')}</div>
  {#if activityTotal === 0}
    <div class="muted" style="font-size:13px">{t('report.noActivity')}</div>
  {:else}
    <div class="bars" role="img" aria-label={t('report.activity')}>
      {#each days as d (d.date)}
        <div class="bar-col" title={tip(d)}>
          <div class="bar" style="height:{Math.max(4, Math.round((dayValue(d) / maxDay) * 100))}%"></div>
          <div class="bar-day">{Number(d.date.slice(8))}</div>
        </div>
      {/each}
    </div>
  {/if}
</section>
