<script>
  import Icon from './Icon.svelte';
  import { t } from '../lib/lang.svelte.js';
  import {
    pomodoroSoundOptions,
    setTickEnabled,
    setTickVolume,
    setAmbientSound,
    setAmbientVolumeLevel,
    setAmbientMode,
    setChimeSound,
    setChimeVolume,
    toggleAmbientPlayback,
    testTickSound,
    testChimeSound,
    testAmbientPreview,
    AVAILABLE_AMBIENT_SOUNDS,
    AVAILABLE_SOUNDS
  } from '../lib/pomodoro.svelte.js';

  let { open = $bindable(false) } = $props();

  function close() {
    open = false;
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') close();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_interactive_supports_focus -->
  <div class="modal-backdrop" onclick={close}>
    <div class="pomo-sound-modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="sound-modal-title" tabindex="-1">
      <!-- Header -->
      <header class="modal-header">
        <div class="header-title">
          <span class="header-icon"><Icon name="volume" size={18} /></span>
          <h2 id="sound-modal-title">{t('pomodoro.soundOptions')}</h2>
        </div>
        <button class="close-btn" onclick={close} title={t('common.close') || 'إغلاق'} aria-label={t('common.close') || 'إغلاق'}>
          <Icon name="x" size={16} />
        </button>
      </header>

      <div class="modal-body">
        <!-- 1. Clock Ticking Sound (Per Second) -->
        <section class="sound-section tick-section">
          <div class="section-top">
            <div class="section-info">
              <div class="section-title-row">
                <Icon name="clock" size={16} />
                <span class="section-title">{t('pomodoro.tickTitle')}</span>
                {#if !pomodoroSoundOptions.tickEnabled}
                  <span class="badge-disabled">معطل افتراضياً</span>
                {/if}
              </div>
              <p class="section-desc">{t('pomodoro.tickDesc')}</p>
            </div>
            <label class="switch-toggle" title={t('pomodoro.tickToggle')}>
              <input
                type="checkbox"
                checked={pomodoroSoundOptions.tickEnabled}
                onchange={(e) => setTickEnabled(e.currentTarget.checked)}
              />
              <span class="slider"></span>
            </label>
          </div>

          {#if pomodoroSoundOptions.tickEnabled}
            <div class="tick-controls">
              <div class="control-row">
                <span class="ctrl-label">{t('pomodoro.tickVolume')}:</span>
                <input
                  type="range"
                  min="0.05"
                  max="1.0"
                  step="0.05"
                  value={pomodoroSoundOptions.tickVolume}
                  oninput={(e) => setTickVolume(parseFloat(e.currentTarget.value))}
                  class="volume-slider"
                />
                <span class="vol-num">{Math.round(pomodoroSoundOptions.tickVolume * 100)}%</span>
                <button class="action-pill-btn" onclick={testTickSound} title={t('pomodoro.testTick')}>
                  <Icon name="play" size={12} />
                  <span>{t('pomodoro.testTick')}</span>
                </button>
              </div>
            </div>
          {/if}
        </section>

        <!-- 2. Ambient Focus & Background Sounds -->
        <section class="sound-section ambient-section">
          <div class="section-info">
            <div class="section-title-row">
              <Icon name="sliders" size={16} />
              <span class="section-title">{t('pomodoro.ambientTitle')}</span>
              {#if pomodoroSoundOptions.isAmbientPlaying}
                <span class="live-pill active">
                  <span class="pulse-dot"></span>
                  <span>يعمل الآن</span>
                </span>
              {/if}
            </div>
            <p class="section-desc">{t('pomodoro.ambientDesc')}</p>
          </div>

          <!-- Sound Grid Selection -->
          <div class="ambient-grid">
            {#each AVAILABLE_AMBIENT_SOUNDS as snd}
              <button
                class="ambient-card {pomodoroSoundOptions.ambientSound === snd.id ? 'active' : ''}"
                onclick={() => {
                  setAmbientSound(snd.id);
                  if (snd.id !== 'none') testAmbientPreview(snd.id);
                }}
              >
                <div class="card-icon"><Icon name={snd.icon || 'volume'} size={18} /></div>
                <div class="card-text">
                  <div class="card-name-ar">{snd.nameAr}</div>
                  <div class="card-name-en">{snd.nameEn}</div>
                </div>
                {#if pomodoroSoundOptions.ambientSound === snd.id}
                  <span class="card-check"><Icon name="check" size={14} /></span>
                {/if}
              </button>
            {/each}
          </div>

          <!-- Ambient Volume & Play Mode -->
          <div class="ambient-settings">
            <div class="control-row">
              <span class="ctrl-label">{t('pomodoro.ambientVolume')}:</span>
              <input
                type="range"
                min="0.05"
                max="1.0"
                step="0.05"
                value={pomodoroSoundOptions.ambientVolume}
                oninput={(e) => setAmbientVolumeLevel(parseFloat(e.currentTarget.value))}
                class="volume-slider"
                disabled={pomodoroSoundOptions.ambientSound === 'none'}
              />
              <span class="vol-num">{Math.round(pomodoroSoundOptions.ambientVolume * 100)}%</span>
            </div>

            <!-- Playback Mode -->
            <div class="mode-toggle-group">
              <span class="ctrl-label">{t('pomodoro.ambientPlayMode')}:</span>
              <div class="mode-pills">
                <button
                  class="mode-pill {pomodoroSoundOptions.ambientMode === 'timer' ? 'active' : ''}"
                  onclick={() => setAmbientMode('timer')}
                >
                  {t('pomodoro.modeTimerOnly')}
                </button>
                <button
                  class="mode-pill {pomodoroSoundOptions.ambientMode === 'always' ? 'active' : ''}"
                  onclick={() => setAmbientMode('always')}
                >
                  {t('pomodoro.modeAlways')}
                </button>
              </div>
            </div>

            <!-- Master Manual Play/Stop Button -->
            <div class="ambient-actions-row">
              <button
                class="ambient-toggle-btn {pomodoroSoundOptions.isAmbientPlaying ? 'playing' : ''}"
                onclick={toggleAmbientPlayback}
              >
                <Icon name={pomodoroSoundOptions.isAmbientPlaying ? 'pause' : 'play'} size={15} />
                <span>
                  {pomodoroSoundOptions.isAmbientPlaying ? t('pomodoro.stopAmbient') : t('pomodoro.playAmbientNow')}
                </span>
              </button>
            </div>
          </div>
        </section>

        <!-- 3. Completion Chime Tone -->
        <section class="sound-section chime-section">
          <div class="section-info">
            <div class="section-title-row">
              <Icon name="bell" size={16} />
              <span class="section-title">{t('pomodoro.chimeTitle')}</span>
            </div>
            <p class="section-desc">{t('pomodoro.chimeDesc')}</p>
          </div>

          <div class="chime-selector-row">
            <select
              class="chime-select"
              value={pomodoroSoundOptions.chimeSound}
              onchange={(e) => {
                setChimeSound(e.currentTarget.value);
                testChimeSound();
              }}
            >
              {#each AVAILABLE_SOUNDS as snd}
                <option value={snd.id}>{snd.nameAr} ({snd.nameEn})</option>
              {/each}
            </select>

            <button class="action-pill-btn" onclick={testChimeSound} title={t('pomodoro.testChime')}>
              <Icon name="play" size={12} />
              <span>{t('pomodoro.testChime')}</span>
            </button>
          </div>
        </section>
      </div>

      <!-- Footer -->
      <footer class="modal-footer">
        <button class="btn-primary" onclick={close}>
          <Icon name="check" size={15} />
          <span>حفظ وإغلاق</span>
        </button>
      </footer>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 16px;
    animation: fadeIn 0.15s ease-out;
  }

  .pomo-sound-modal {
    background: var(--surface, #1e293b);
    border: 1px solid var(--border, rgba(255, 255, 255, 0.15));
    border-radius: 16px;
    width: 100%;
    max-width: 620px;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid var(--border, rgba(255, 255, 255, 0.1));
    background: rgba(255, 255, 255, 0.02);
  }
  .header-title {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .header-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    background: rgba(234, 179, 8, 0.15);
    color: #fbbf24;
  }
  .header-title h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 700;
    color: var(--text, #f1f5f9);
  }
  .close-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 6px;
    border-radius: 8px;
    color: var(--text-muted, #94a3b8);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s, color 0.15s;
  }
  .close-btn:hover {
    background: var(--surface-2, rgba(255, 255, 255, 0.1));
    color: var(--text, #f1f5f9);
  }

  .modal-body {
    padding: 16px 18px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .sound-section {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid var(--border, rgba(255, 255, 255, 0.08));
    border-radius: 12px;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .sound-section:hover {
    border-color: rgba(255, 255, 255, 0.14);
  }

  .section-top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }
  .section-info {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
  }
  .section-title-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 700;
    color: var(--text, #f1f5f9);
  }
  .badge-disabled {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 6px;
    background: rgba(148, 163, 184, 0.15);
    color: #94a3b8;
    font-weight: 500;
  }
  .live-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 10px;
    background: rgba(34, 197, 94, 0.15);
    color: #4ade80;
    font-weight: 600;
  }
  .pulse-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #4ade80;
    animation: pulse 1.4s infinite;
  }
  .section-desc {
    margin: 0;
    font-size: 12px;
    color: var(--text-muted, #94a3b8);
    line-height: 1.4;
  }

  /* Toggle Switch */
  .switch-toggle {
    position: relative;
    display: inline-block;
    width: 44px;
    height: 24px;
    flex-shrink: 0;
  }
  .switch-toggle input {
    opacity: 0;
    width: 0;
    height: 0;
  }
  .switch-toggle .slider {
    position: absolute;
    cursor: pointer;
    inset: 0;
    background-color: rgba(255, 255, 255, 0.15);
    transition: 0.2s;
    border-radius: 24px;
  }
  .switch-toggle .slider:before {
    position: absolute;
    content: "";
    height: 18px;
    width: 18px;
    left: 3px;
    bottom: 3px;
    background-color: #fff;
    transition: 0.2s;
    border-radius: 50%;
  }
  .switch-toggle input:checked + .slider {
    background-color: #10b981;
  }
  .switch-toggle input:checked + .slider:before {
    transform: translateX(20px);
  }

  .control-row {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 12px;
  }
  .ctrl-label {
    color: var(--text, #f1f5f9);
    font-weight: 600;
    white-space: nowrap;
  }
  .volume-slider {
    flex: 1;
    accent-color: #10b981;
    cursor: pointer;
  }
  .vol-num {
    font-variant-numeric: tabular-nums;
    font-size: 12px;
    color: var(--text-muted, #94a3b8);
    min-width: 34px;
    text-align: end;
  }

  .action-pill-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
    border-radius: 8px;
    border: 1px solid var(--border, rgba(255, 255, 255, 0.2));
    background: var(--surface-2, rgba(255, 255, 255, 0.08));
    color: var(--text, #f1f5f9);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .action-pill-btn:hover {
    background: rgba(255, 255, 255, 0.15);
    border-color: rgba(255, 255, 255, 0.3);
  }

  /* Ambient Grid */
  .ambient-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    gap: 8px;
  }
  .ambient-card {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
    background: rgba(0, 0, 0, 0.15);
    color: var(--text, #f1f5f9);
    cursor: pointer;
    transition: all 0.15s ease;
    text-align: start;
  }
  .ambient-card:hover {
    border-color: rgba(255, 255, 255, 0.25);
    background: rgba(255, 255, 255, 0.05);
  }
  .ambient-card.active {
    border-color: #10b981;
    background: rgba(16, 185, 129, 0.12);
  }
  .card-icon {
    color: var(--accent, #eab308);
  }
  .ambient-card.active .card-icon {
    color: #34d399;
  }
  .card-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .card-name-ar {
    font-size: 12px;
    font-weight: 600;
  }
  .card-name-en {
    font-size: 10px;
    color: var(--text-muted, #94a3b8);
  }
  .card-check {
    position: absolute;
    top: 8px;
    inset-inline-end: 8px;
    color: #10b981;
  }

  .ambient-settings {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding-top: 6px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }

  .mode-toggle-group {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .mode-pills {
    display: flex;
    gap: 6px;
  }
  .mode-pill {
    padding: 4px 10px;
    border-radius: 8px;
    font-size: 11px;
    border: 1px solid var(--border, rgba(255, 255, 255, 0.15));
    background: transparent;
    color: var(--text-muted, #94a3b8);
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .mode-pill.active {
    background: #10b981;
    color: #fff;
    border-color: #10b981;
    font-weight: 600;
  }

  .ambient-actions-row {
    display: flex;
    justify-content: flex-end;
  }
  .ambient-toggle-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 7px 16px;
    border-radius: 10px;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    border: none;
    background: #10b981;
    color: #fff;
    transition: all 0.2s ease;
  }
  .ambient-toggle-btn:hover {
    filter: brightness(1.1);
    transform: translateY(-1px);
  }
  .ambient-toggle-btn.playing {
    background: #ef4444;
  }

  /* Chime Section */
  .chime-selector-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .chime-select {
    flex: 1;
    padding: 8px 12px;
    border-radius: 8px;
    background: var(--surface-2, rgba(255, 255, 255, 0.08));
    border: 1px solid var(--border, rgba(255, 255, 255, 0.15));
    color: var(--text, #f1f5f9);
    font-size: 12px;
    outline: none;
  }
  .chime-select option {
    background: #1e293b;
    color: #f1f5f9;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    padding: 12px 18px;
    border-top: 1px solid var(--border, rgba(255, 255, 255, 0.1));
    background: rgba(255, 255, 255, 0.02);
  }
  .btn-primary {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 18px;
    border-radius: 8px;
    border: none;
    background: #10b981;
    color: #fff;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .btn-primary:hover {
    filter: brightness(1.1);
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.4; transform: scale(0.85); }
  }
  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
</style>
