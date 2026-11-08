<script>
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { t, ui } from '../lib/lang.svelte.js';
  import {
    loadUserAvatar, saveUserAvatar, LEARNER_AVATARS,
    loadStudyStats, computeStudySummary
  } from '../lib/stats.js';
  import { listUserCommunityShares, formatTotalDuration, computeShareTotalDuration } from '../lib/communityStore.js';

  let {
    currentUser = null,
    docs = [],
    videos = [],
    decks = [],
    projects = [],
    notify,
    onOpenAuth = null
  } = $props();

  let avatar = $state(loadUserAvatar());
  let avatarPickerOpen = $state(false);
  let stats = $state(loadStudyStats());
  let fileInputEl = $state();
  let userShares = $state([]);
  let loadingShares = $state(true);

  async function loadShares() {
    loadingShares = true;
    try {
      userShares = await listUserCommunityShares(currentUser?.id, currentUser?.name || currentUser?.username);
    } catch {
      userShares = [];
    } finally {
      loadingShares = false;
    }
  }

  onMount(() => {
    loadShares();
  });

  const activityDays = $derived.by(() => {
    const arr = [];
    const today = new Date();
    const daysMap = stats.days || {};
    // 16 weeks = 112 days
    for (let i = 111; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const dayData = daysMap[key];
      const sec = Number(dayData?.studySec || dayData?.totalSec || 0);
      let level = 0;
      if (sec > 7200) level = 4;
      else if (sec > 3600) level = 3;
      else if (sec > 1200) level = 2;
      else if (sec > 0) level = 1;
      arr.push({ date: key, sec, level });
    }
    return arr;
  });

  const totalCommunityVisits = $derived(userShares.reduce((acc, s) => acc + (s.visits || 0), 0));
  const avgCommunityRating = $derived.by(() => {
    if (!userShares.length) return '5.0';
    const sum = userShares.reduce((acc, s) => acc + (Number(s.rating) || 5), 0);
    return (sum / userShares.length).toFixed(1);
  });

  function refresh() {
    avatar = loadUserAvatar();
    stats = loadStudyStats();
  }

  const summary = $derived(computeStudySummary(stats, docs, videos));

  function selectPresetAvatar(preset) {
    avatar = { ...preset, isCustom: false };
    saveUserAvatar(avatar);
    avatarPickerOpen = false;
    notify(t('profile.avatarUpdated'), 'ok');
  }

  function handleCustomUpload(e) {
    const file = e.target?.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      notify(t('profile.imageOnly'), 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result;
      if (dataUrl) {
        avatar = {
          id: 'custom_' + Date.now(),
          name: 'Custom Avatar',
          dataUrl,
          isCustom: true
        };
        saveUserAvatar(avatar);
        avatarPickerOpen = false;
        notify(t('profile.avatarUpdated'), 'ok');
      }
    };
    reader.readAsDataURL(file);
  }

  function formatSec(sec) {
    if (!sec || sec <= 0) return '0 ' + t('profile.min');
    const m = Math.floor(sec / 60);
    const h = Math.floor(m / 60);
    const remM = m % 60;
    if (h > 0) return `${h} ${t('profile.hours')} ${remM} ${t('profile.min')}`;
    return `${m} ${t('profile.min')}`;
  }

  const credentialId = $derived.by(() => {
    if (currentUser?.id && currentUser.id !== 'guest') {
      const clean = currentUser.id.replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase();
      return `MK-${clean || '7824'}-AC`;
    }
    return 'MK-GUEST-01';
  });

  const academicRank = $derived.by(() => {
    const hours = summary.totalStudyHours || 0;
    if (hours >= 100) return ui.lang === 'ar' ? 'عالم متمرس (Master Scholar)' : 'Master Scholar';
    if (hours >= 40) return ui.lang === 'ar' ? 'باحث معتمد (Senior Researcher)' : 'Senior Researcher';
    if (hours >= 10) return ui.lang === 'ar' ? 'طالب مجتهد (Diligent Learner)' : 'Diligent Learner';
    return ui.lang === 'ar' ? 'متعلم واعد (Aspiring Student)' : 'Aspiring Student';
  });

  const memberSinceFormatted = $derived.by(() => {
    const ts = currentUser?.createdAt || stats?.firstStudyDay || Date.now();
    return new Date(ts).toLocaleDateString(ui.lang === 'ar' ? 'ar-EG' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  });

  function exportLearningPassport() {
    const passportData = {
      makeenVersion: '2.0',
      credentialId,
      user: {
        id: currentUser?.id || 'guest',
        name: currentUser?.name || currentUser?.username || 'Learner',
        email: currentUser?.email || '',
        avatar: avatar.name || 'Default'
      },
      academicRank,
      metrics: {
        totalStudyHours: summary.totalStudyHours,
        totalStudyMinutes: summary.totalStudyMinutes,
        totalReadingHours: summary.totalReadingHours,
        totalPagesRead: summary.totalPagesRead,
        totalVideoHours: summary.totalVideoHours,
        cardsMastered: summary.totalCardsReviewed,
        pomodoroSessions: summary.pomodorosCompleted,
        studyScore: summary.studyScore
      },
      issuedAt: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(passportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Makeen-Learning-Passport-${credentialId}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify?.(ui.lang === 'ar' ? 'تم تصدير جواز مَكِين المعرفي بنجاح!' : 'Passport exported successfully!', 'ok');
  }
</script>

<div class="profile-page" dir={ui.dir}>
  <!-- Profile Hero Header -->
  <header class="profile-hero">
    <div class="avatar-col">
      <div class="avatar-badge" style="background:{avatar.bg || 'var(--primary)'}" onclick={() => avatarPickerOpen = true}>
        {#if avatar.isCustom && avatar.dataUrl}
          <img src={avatar.dataUrl} alt="Avatar" class="avatar-img" />
        {:else}
          <Icon name={avatar.icon || 'user'} size={40} />
        {/if}
        <div class="avatar-overlay">
          <Icon name="camera" size={16} />
        </div>
      </div>
      <button class="change-avatar-btn" onclick={() => avatarPickerOpen = true}>
        <Icon name="repeat" size={13} />
        <span>{t('profile.changeAvatar')}</span>
      </button>
    </div>

    <div class="user-meta-col">
      <div class="user-name-row">
        <h2>{currentUser?.name || currentUser?.username || t('profile.learner')}</h2>
        {#if currentUser && currentUser.id !== 'guest'}
          <span class="user-badge verified"><Icon name="check" size={11} /> <span>{t('auth.verified')}</span></span>
        {:else}
          <button class="user-badge guest-btn" onclick={() => onOpenAuth?.()}>
            {t('auth.signIn')}
          </button>
        {/if}
      </div>

      <p class="user-subtitle">
        {t('profile.learnerSubtitle')} • {summary.ratingLabel}
      </p>

      <!-- Rating Stars & Score -->
      <div class="rating-row">
        <div class="stars">
          {#each [1, 2, 3, 4, 5] as star}
            <span class="star-badge {star <= summary.studyStars ? 'filled' : ''}"><Icon name="check-square" size={14} /></span>
          {/each}
        </div>
        <span class="score-pill">{summary.studyScore}% {t('profile.completionRate')}</span>
      </div>
    </div>
  </header>

  <!-- Key Study Metrics Cards Grid -->
  <div class="metrics-grid">
    <div class="metric-card primary-card">
      <div class="metric-icon"><Icon name="clock" size={24} /></div>
      <div class="metric-info">
        <span class="metric-val">{summary.totalStudyHours}</span>
        <span class="metric-unit">{t('profile.hours')} ({summary.totalStudyMinutes} {t('profile.min')})</span>
        <span class="metric-label">{t('profile.totalStudyTime')}</span>
      </div>
    </div>

    <div class="metric-card">
      <div class="metric-icon"><Icon name="video" size={24} /></div>
      <div class="metric-info">
        <span class="metric-val">{summary.totalVideoHours}</span>
        <span class="metric-unit">{t('profile.hours')} ({summary.totalVideoMinutes} {t('profile.min')})</span>
        <span class="metric-label">{t('profile.totalVideoTime')}</span>
      </div>
    </div>

    <div class="metric-card">
      <div class="metric-icon"><Icon name="reader" size={24} /></div>
      <div class="metric-info">
        <span class="metric-val">{summary.totalReadingHours}</span>
        <span class="metric-unit">{t('profile.hours')} ({summary.totalReadingMinutes} {t('profile.min')})</span>
        <span class="metric-label">{t('profile.totalReadingTime')}</span>
      </div>
    </div>

    <div class="metric-card">
      <div class="metric-icon"><Icon name="file-text" size={24} /></div>
      <div class="metric-info">
        <span class="metric-val">{summary.totalPagesRead}</span>
        <span class="metric-unit">{t('profile.pages')}</span>
        <span class="metric-label">{t('profile.totalPagesDone')}</span>
      </div>
    </div>

    <div class="metric-card">
      <div class="metric-icon"><Icon name="flashcards" size={24} /></div>
      <div class="metric-info">
        <span class="metric-val">{summary.totalCardsReviewed}</span>
        <span class="metric-unit">{t('profile.cards')} ({summary.cardRetentionRate}%)</span>
        <span class="metric-label">{t('profile.cardsMastered')}</span>
      </div>
    </div>

    <div class="metric-card">
      <div class="metric-icon"><Icon name="projects" size={24} /></div>
      <div class="metric-info">
        <span class="metric-val">{projects.length}</span>
        <span class="metric-unit">{t('profile.projects')}</span>
        <span class="metric-label">{t('profile.activeProjects')}</span>
      </div>
    </div>

    <div class="metric-card" style="border-inline-start: 4px solid #ef4444;">
      <div class="metric-icon" style="color: #ef4444;"><Icon name="clock" size={24} /></div>
      <div class="metric-info">
        <span class="metric-val">{summary.pomodorosCompleted}</span>
        <span class="metric-unit">{t('pomodoro.completed')} ({summary.pomodoroFocusHours} {t('profile.hours')})</span>
        <span class="metric-label">{t('pomodoro.today')}: {summary.pomodorosToday}</span>
      </div>
    </div>
  </div>

  <!-- Learning Credential Passport Card -->
  <section class="credential-passport-card card">
    <div class="passport-header">
      <div class="passport-title-wrap">
        <span class="passport-emblem"><Icon name="star" size={20} /></span>
        <div>
          <h3 class="passport-title">{ui.lang === 'ar' ? 'جواز مَكِين المعرفي والوثائق الأكاديمية' : 'Makeen Learning Passport & Credentials'}</h3>
          <p class="passport-desc">{ui.lang === 'ar' ? 'هوية تعليمية موثقة محلياً تُسجّل ساعات دراستك ومشاريعك وبطاقاتك' : 'Local-first verified academic passport recording your study hours, projects, and mastery'}</p>
        </div>
      </div>
      <div class="passport-actions">
        <button class="credential-btn" onclick={exportLearningPassport} title={ui.lang === 'ar' ? 'تصدير الجواز المعرفي' : 'Export Passport'}>
          <Icon name="download" size={14} />
          <span>{ui.lang === 'ar' ? 'تصدير الوثيقة' : 'Export Credential'}</span>
        </button>
      </div>
    </div>

    <div class="passport-body-grid">
      <div class="passport-field">
        <span class="field-label">{ui.lang === 'ar' ? 'رقم الهوية الأكاديمية' : 'Credential ID'}</span>
        <span class="field-value monospace">{credentialId}</span>
      </div>
      <div class="passport-field">
        <span class="field-label">{ui.lang === 'ar' ? 'الرتبة المعرفية' : 'Academic Rank'}</span>
        <span class="field-value accent-text">{academicRank}</span>
      </div>
      <div class="passport-field">
        <span class="field-label">{ui.lang === 'ar' ? 'حالة التوثيق' : 'Verification Status'}</span>
        <span class="field-value status-verified"><Icon name="check" size={13} /> {ui.lang === 'ar' ? 'معتمد محلياً وموثق' : 'Verified & Active'}</span>
      </div>
      <div class="passport-field">
        <span class="field-label">{ui.lang === 'ar' ? 'تاريخ البدء' : 'Member Since'}</span>
        <span class="field-value">{memberSinceFormatted}</span>
      </div>
    </div>
  </section>

  <!-- GitHub-Style Community Contributions & Activity Heatmap -->
  <section class="github-community-section card" style="margin-top:20px; padding:20px;">
    <div class="hstack" style="justify-content:space-between; margin-bottom:16px; flex-wrap:wrap; gap:10px;">
      <div class="hstack" style="gap:10px;">
        <span class="gh-icon-box" style="padding:6px; background:var(--surface-2); border-radius:6px;"><Icon name="globe" size={20} /></span>
        <div>
          <h3 style="margin:0; font-size:17px;">{ui.lang === 'ar' ? 'مساهمات المجتمع والنشاط الأكاديمي' : 'Community Contributions & Activity'}</h3>
          <p class="muted" style="margin:2px 0 0; font-size:12.5px;">
            {ui.lang === 'ar' ? 'سجل مشاركاتك، الكورسات المفتوحة، وتفاعل الطلاب مع محتواك' : 'Your public courses, learning paths, and learner interactions'}
          </p>
        </div>
      </div>

      <!-- Quick Stats Pill Bar -->
      <div class="hstack" style="gap:12px; font-size:13px;">
        <span class="gh-stat-pill hstack" style="gap:5px; background:var(--surface-2); padding:4px 10px; border-radius:999px;">
          <Icon name="layers" size={13} />
          <strong>{userShares.length}</strong> {ui.lang === 'ar' ? 'مساهمات' : 'shares'}
        </span>
        <span class="gh-stat-pill hstack" style="gap:5px; background:var(--surface-2); padding:4px 10px; border-radius:999px;">
          <Icon name="eye" size={13} />
          <strong>{totalCommunityVisits}</strong> {ui.lang === 'ar' ? 'مشاهدة' : 'views'}
        </span>
        <span class="gh-stat-pill hstack" style="gap:5px; background:var(--surface-2); padding:4px 10px; border-radius:999px;">
          <Icon name="star" size={13} />
          <strong>{avgCommunityRating}</strong>
        </span>
      </div>
    </div>

    <!-- GitHub Activity Heat Grid (16 Weeks x 7 Days) -->
    <div class="activity-graph-container card" style="background:var(--surface-2); padding:14px; border-radius:8px; margin-bottom:20px;">
      <div class="hstack" style="justify-content:space-between; margin-bottom:8px; font-size:12px;">
        <span class="muted">{ui.lang === 'ar' ? 'سجل النشاط اليومي للدراسة والمساهمة (16 أسبوعاً)' : '16-Week Daily Study & Contribution Activity'}</span>
        <div class="hstack" style="gap:4px; align-items:center;">
          <span class="muted" style="font-size:11px;">{ui.lang === 'ar' ? 'أقل' : 'Less'}</span>
          <span class="heat-box level-0"></span>
          <span class="heat-box level-1"></span>
          <span class="heat-box level-2"></span>
          <span class="heat-box level-3"></span>
          <span class="heat-box level-4"></span>
          <span class="muted" style="font-size:11px;">{ui.lang === 'ar' ? 'أكثر' : 'More'}</span>
        </div>
      </div>

      <div class="activity-grid">
        {#each activityDays as day}
          <div
            class="heat-square level-{day.level}"
            title="{day.date}: {day.sec > 0 ? formatSec(day.sec) : (ui.lang === 'ar' ? 'لا نشاط' : 'No activity')}"
          ></div>
        {/each}
      </div>
    </div>

    <!-- Pinned / My Community Shared Content (Repositories style) -->
    <div class="my-community-shares">
      <div class="hstack" style="justify-content:space-between; margin-bottom:12px;">
        <strong style="font-size:14px;">{ui.lang === 'ar' ? 'محتواي المنشور في المجتمع' : 'Published Community Content'} ({userShares.length})</strong>
      </div>

      {#if loadingShares}
        <div class="empty-state-small muted">{ui.lang === 'ar' ? 'جارِ تحميل المساهمات…' : 'Loading contributions...'}</div>
      {:else if userShares.length === 0}
        <div class="empty-state-small card" style="text-align:center; padding:16px; background:var(--surface-2); border-radius:8px;">
          <Icon name="globe" size={28} />
          <p class="muted" style="font-size:12.5px; margin:6px 0 0;">
            {ui.lang === 'ar' ? 'لم تقم بمشاركة أي محتوى في المجتمع حتى الآن. شارك قوائمك وكورساتك ومساراتك لتظهر هنا كإنجازات أكاديمية!' : 'No community shares published yet. Share your playlists and learning paths to showcase them here!'}
          </p>
        </div>
      {:else}
        <div class="gh-repo-grid">
          {#each userShares as s (s.id)}
            {@const totalDur = formatTotalDuration(computeShareTotalDuration(s))}
            <div class="gh-repo-card card">
              <div class="hstack" style="justify-content:space-between; align-items:flex-start; gap:8px;">
                <div class="hstack" style="gap:8px; min-width:0;">
                  <span class="gh-repo-icon"><Icon name={s.type === 'path' ? 'layers' : (s.type === 'playlist' ? 'video' : 'reader')} size={15} /></span>
                  <strong class="gh-repo-name truncate" title={s.title}>{s.title}</strong>
                </div>
                <span class="badge" style="font-size:10.5px; padding:2px 8px;">{s.isPaid ? `${s.price} EGP` : 'مجاني'}</span>
              </div>

              {#if s.description}
                <p class="gh-repo-desc muted truncate-2" style="font-size:12px; margin:6px 0 10px; line-height:1.4;">{s.description}</p>
              {/if}

              <div class="gh-repo-meta hstack" style="gap:12px; font-size:11.5px; color:var(--muted); margin-top:auto;">
                <span class="hstack" style="gap:3px;"><Icon name="star" size={12} /> {Number(s.rating || 5).toFixed(1)}</span>
                <span class="hstack" style="gap:3px;"><Icon name="eye" size={12} /> {s.visits || 1}</span>
                {#if totalDur}
                  <span class="hstack" style="gap:3px;"><Icon name="clock" size={12} /> {totalDur}</span>
                {/if}
                <span class="grow"></span>
                <span class="badge" style="background:var(--surface-3); font-size:10.5px;">{s.type === 'path' ? 'مسار' : 'كورس'}</span>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </section>

  <!-- Detailed Study Breakdown Sections -->
  <div class="details-section">
    <!-- Pomodoro Sessions Breakdown -->
    <div class="table-card" style="border-top: 3px solid #ef4444;">
      <div class="table-head">
        <h3><Icon name="clock" size={16} /> <span>{t('pomodoro.analytics')}</span></h3>
        <span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #ef4444;">{summary.pomodorosCompleted} {t('pomodoro.completed')}</span>
      </div>
      {#if !summary.pomodorosHistory || summary.pomodorosHistory.length === 0}
        <div class="empty-state-small">{t('pomodoro.noHistory')}</div>
      {:else}
        <div class="stats-table">
          {#each summary.pomodorosHistory.slice(0, 20) as session}
            <div class="stats-row">
              <span class="row-title" title={session.title || t(`pomodoro.${session.mode}`)}>
                {session.title || t(`pomodoro.${session.mode}`)}
              </span>
              <span class="row-meta muted" style="font-size:11px;">
                {new Date(session.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {new Date(session.timestamp).toLocaleDateString([], { month: 'numeric', day: 'numeric' })}
              </span>
              <span class="row-time">{session.durationMinutes} {t('profile.min')}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
    <!-- Videos Breakdown -->
    <div class="table-card">
      <div class="table-head">
        <h3><Icon name="video" size={16} /> <span>{t('profile.videosBreakdown')}</span></h3>
        <span class="badge">{Object.keys(stats.videos || {}).length} {t('profile.videosTracked')}</span>
      </div>
      {#if Object.keys(stats.videos || {}).length === 0}
        <div class="empty-state-small">{t('profile.noVideoStatsYet')}</div>
      {:else}
        <div class="stats-table">
          {#each Object.values(stats.videos) as v}
            <div class="stats-row">
              <span class="row-title" title={v.title}>{v.title}</span>
              <span class="row-time">{formatSec(v.totalSec)}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Documents Breakdown -->
    <div class="table-card">
      <div class="table-head">
        <h3><Icon name="reader" size={16} /> <span>{t('profile.documentsBreakdown')}</span></h3>
        <span class="badge">{Object.keys(stats.docs || {}).length} {t('profile.docsTracked')}</span>
      </div>
      {#if Object.keys(stats.docs || {}).length === 0}
        <div class="empty-state-small">{t('profile.noDocStatsYet')}</div>
      {:else}
        <div class="stats-table">
          {#each Object.values(stats.docs) as d}
            <div class="stats-row">
              <span class="row-title" title={d.title}>{d.title}</span>
              <span class="row-meta">{d.maxPage || 1} {t('profile.pages')}</span>
              <span class="row-time">{formatSec(d.totalSec)}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>

  <!-- Avatar Selector Modal -->
  {#if avatarPickerOpen}
    <div class="modal-backdrop" onclick={() => avatarPickerOpen = false}>
      <div class="avatar-modal" onclick={(e) => e.stopPropagation()}>
        <header class="modal-head">
          <h3>{t('profile.chooseAvatar')}</h3>
          <button class="icon-btn" onclick={() => avatarPickerOpen = false}><Icon name="x" size={18} /></button>
        </header>

        <div class="modal-body">
          <p class="modal-hint">{t('profile.avatarHint')}</p>

          <div class="presets-grid">
            {#each LEARNER_AVATARS as p}
              <button
                class="preset-item {avatar.id === p.id ? 'active' : ''}"
                style="background:{p.bg}"
                onclick={() => selectPresetAvatar(p)}
                title={ui.lang === 'ar' && p.nameAr ? p.nameAr : p.name}
              >
                <Icon name={p.icon || 'user'} size={28} />
                <span class="preset-name">{ui.lang === 'ar' && p.nameAr ? p.nameAr : p.name}</span>
              </button>
            {/each}
          </div>

          <div class="upload-divider">
            <span>{t('profile.orUploadYourOwn')}</span>
          </div>

          <input
            type="file"
            accept="image/*"
            style="display:none"
            bind:this={fileInputEl}
            onchange={handleCustomUpload}
          />
          <button class="upload-custom-btn" onclick={() => fileInputEl?.click()}>
            <Icon name="camera" size={16} />
            <span>{t('profile.uploadImageFromDevice')}</span>
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .profile-page {
    padding: 32px 40px;
    max-width: 1200px;
    margin: 0 auto;
    min-height: 100vh;
  }
  .profile-hero {
    display: flex;
    align-items: center;
    gap: 28px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 28px 32px;
    margin-bottom: 28px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  }
  .avatar-col {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }
  .avatar-badge {
    position: relative;
    width: 96px;
    height: 96px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    overflow: hidden;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }
  .avatar-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .avatar-overlay {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    opacity: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    transition: opacity 0.2s ease;
  }
  .avatar-badge:hover .avatar-overlay {
    opacity: 1;
  }
  .change-avatar-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    background: transparent;
    border: 0;
    color: var(--primary);
    font-size: 12px;
    cursor: pointer;
    font-weight: 500;
  }
  .user-meta-col {
    flex: 1;
  }
  .user-name-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 4px;
  }
  .user-name-row h2 {
    margin: 0;
    font-size: 26px;
    font-weight: 700;
  }
  .user-badge {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 999px;
    font-weight: 600;
  }
  .user-badge.verified {
    background: rgba(16, 185, 129, 0.12);
    color: #10b981;
  }
  .guest-btn {
    background: var(--surface-2, rgba(0, 0, 0, 0.06));
    border: 1px solid var(--border);
    cursor: pointer;
    color: var(--primary);
  }
  .user-subtitle {
    margin: 0 0 12px;
    font-size: 14px;
    color: var(--muted);
  }
  .rating-row {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .stars {
    display: flex;
    gap: 4px;
    align-items: center;
  }
  .star-badge {
    color: var(--muted, #94a3b8);
    display: inline-flex;
    align-items: center;
  }
  .star-badge.filled {
    color: #f59e0b;
  }
  .score-pill {
    background: var(--surface-2, rgba(0, 0, 0, 0.05));
    border: 1px solid var(--border);
    padding: 3px 10px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
  }

  /* Metrics Grid */
  .metrics-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
    gap: 16px;
    margin-bottom: 28px;
  }

  /* Credential Passport Card */
  .credential-passport-card {
    background: linear-gradient(135deg, var(--surface) 0%, rgba(16, 185, 129, 0.05) 100%);
    border: 1px solid var(--accent, #10b981);
    border-radius: var(--radius);
    padding: 22px 28px;
    margin-bottom: 28px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05);
  }
  .passport-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid var(--border);
    padding-bottom: 16px;
    margin-bottom: 16px;
    flex-wrap: wrap;
    gap: 12px;
  }
  .passport-title-wrap {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .passport-emblem {
    width: 40px;
    height: 40px;
    border-radius: 12px;
    background: var(--accent-soft, rgba(16, 185, 129, 0.15));
    color: var(--accent, #10b981);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .passport-title {
    margin: 0 0 2px 0;
    font-size: 16px;
    font-weight: 700;
  }
  .passport-desc {
    margin: 0;
    font-size: 12px;
    color: var(--muted);
  }
  .credential-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 6px 14px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }
  .credential-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .passport-body-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 16px;
  }
  .passport-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .field-label {
    font-size: 11px;
    color: var(--muted);
    font-weight: 500;
  }
  .field-value {
    font-size: 14px;
    font-weight: 600;
    color: var(--text);
  }
  .field-value.monospace {
    font-family: monospace;
    letter-spacing: 1px;
  }
  .field-value.accent-text {
    color: var(--accent, #10b981);
  }
  .field-value.status-verified {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: #10b981;
  }
  .metric-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 18px;
    display: flex;
    align-items: center;
    gap: 14px;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.03);
  }
  .metric-card.primary-card {
    border-color: rgba(99, 102, 241, 0.4);
    background: linear-gradient(135deg, var(--surface) 0%, rgba(99, 102, 241, 0.05) 100%);
  }
  .metric-icon {
    font-size: 28px;
  }
  .metric-info {
    display: flex;
    flex-direction: column;
  }
  .metric-val {
    font-size: 24px;
    font-weight: 700;
    line-height: 1.1;
  }
  .metric-unit {
    font-size: 11px;
    color: var(--muted);
  }
  .metric-label {
    margin-top: 4px;
    font-size: 12px;
    font-weight: 500;
    color: var(--text);
  }

  /* Details Breakdown */
  .details-section {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
  }
  @media (max-width: 800px) {
    .details-section { grid-template-columns: 1fr; }
  }
  .table-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 20px;
  }
  .table-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--border);
  }
  .table-head h3 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }
  .badge {
    background: var(--surface-2, rgba(0, 0, 0, 0.04));
    border: 1px solid var(--border);
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    color: var(--muted);
  }
  .empty-state-small {
    padding: 30px 0;
    text-align: center;
    font-size: 13px;
    color: var(--muted);
  }
  .stats-table {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .stats-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    font-size: 13px;
    padding: 8px 10px;
    background: var(--surface-2, rgba(0, 0, 0, 0.02));
    border-radius: 6px;
  }
  .row-title {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 500;
  }
  .row-meta {
    font-size: 12px;
    color: var(--muted);
  }
  .row-time {
    font-weight: 600;
    color: var(--primary);
  }

  /* Modal */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 99999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }
  .avatar-modal {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    width: 100%;
    max-width: 520px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
    overflow: hidden;
  }
  .modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border);
  }
  .modal-head h3 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }
  .modal-body {
    padding: 20px;
  }
  .modal-hint {
    margin: 0 0 16px;
    font-size: 13px;
    color: var(--muted);
  }
  .presets-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
    margin-bottom: 20px;
  }
  .preset-item {
    border: 2px solid transparent;
    border-radius: var(--radius);
    padding: 12px 6px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    transition: transform 0.15s ease, border-color 0.15s ease;
  }
  .preset-item:hover {
    transform: scale(1.05);
  }
  .preset-item.active {
    border-color: #fff;
    box-shadow: 0 0 0 2px var(--primary);
  }
  .preset-name {
    font-size: 10px;
    font-weight: 600;
    color: #fff;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    width: 100%;
  }
  .upload-divider {
    text-align: center;
    position: relative;
    margin: 16px 0;
  }
  .upload-divider::before {
    content: '';
    position: absolute;
    top: 50%;
    left: 0;
    right: 0;
    border-top: 1px solid var(--border);
  }
  .upload-divider span {
    position: relative;
    background: var(--surface);
    padding: 0 10px;
    font-size: 12px;
    color: var(--muted);
  }
  .upload-custom-btn {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 10px;
    background: var(--surface-2, rgba(0, 0, 0, 0.04));
    border: 1px dashed var(--border);
    border-radius: var(--radius);
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
  }
  .upload-custom-btn:hover {
    background: var(--surface-3, rgba(0, 0, 0, 0.08));
    border-color: var(--primary);
  }

  /* GitHub-Style Activity Grid & Repositories */
  .activity-grid {
    display: grid;
    grid-template-rows: repeat(7, 12px);
    grid-auto-flow: column;
    grid-auto-columns: 12px;
    gap: 4px;
    overflow-x: auto;
    padding-bottom: 6px;
  }
  .heat-square {
    width: 12px;
    height: 12px;
    border-radius: 2px;
    transition: transform 0.1s ease;
  }
  .heat-square:hover {
    transform: scale(1.3);
  }
  .heat-box {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 2px;
  }
  .level-0 { background: var(--surface-3, rgba(255, 255, 255, 0.08)); }
  .level-1 { background: #0e4429; }
  .level-2 { background: #006d32; }
  .level-3 { background: #26a641; }
  .level-4 { background: #39d353; }

  .gh-repo-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 12px;
  }
  .gh-repo-card {
    padding: 14px;
    display: flex;
    flex-direction: column;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    transition: border-color 0.15s ease, transform 0.15s ease;
  }
  .gh-repo-card:hover {
    border-color: var(--accent);
    transform: translateY(-2px);
  }
  .gh-repo-icon {
    color: var(--accent);
  }
</style>
