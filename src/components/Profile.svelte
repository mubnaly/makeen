<script>
  import Icon from './Icon.svelte';
  import { t, ui } from '../lib/lang.svelte.js';
  import {
    loadUserAvatar, saveUserAvatar, LEARNER_AVATARS,
    loadStudyStats, computeStudySummary
  } from '../lib/stats.js';

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
  </div>

  <!-- Detailed Study Breakdown Sections -->
  <div class="details-section">
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
                title={p.name}
              >
                <Icon name={p.icon || 'user'} size={28} />
                <span class="preset-name">{p.name}</span>
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
</style>
