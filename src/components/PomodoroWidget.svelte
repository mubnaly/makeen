<script>
  import Icon from './Icon.svelte';
  import PomodoroSoundModal from './PomodoroSoundModal.svelte';
  import { t } from '../lib/lang.svelte.js';
  import {
    pomodoroState,
    pomodoroSoundOptions,
    togglePomodoro,
    resetPomodoro,
    setPomodoroMode,
    setPomodoroMaterial
  } from '../lib/pomodoro.svelte.js';

  let { materialTitle = '', compact = false } = $props();

  let menuOpen = $state(false);
  let soundModalOpen = $state(false);

  $effect(() => {
    if (materialTitle) {
      setPomodoroMaterial(materialTitle);
    }
  });

  function formatTime(totalSec) {
    const s = Math.max(0, Math.floor(totalSec));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  }

  function handleModeSelect(modeId) {
    setPomodoroMode(modeId);
    menuOpen = false;
  }
</script>

<div class="pomodoro-widget {compact ? 'compact' : ''} mode-{pomodoroState.mode}" dir="ltr">
  <!-- Mode indicator & quick switch -->
  <button
    class="pomo-mode-btn"
    onclick={() => (menuOpen = !menuOpen)}
    title={t(`pomodoro.${pomodoroState.mode}`)}
    aria-label={t(`pomodoro.${pomodoroState.mode}`)}
  >
    <Icon name="clock" size={compact ? 13 : 15} />
    {#if !compact}
      <span class="pomo-mode-label">{t(`pomodoro.${pomodoroState.mode}`)}</span>
    {/if}
  </button>

  <!-- Timer Display -->
  <span class="pomo-timer-digits {pomodoroState.isRunning ? 'running' : ''}">
    {formatTime(pomodoroState.timeLeft)}
  </span>

  <!-- Action Controls -->
  <div class="pomo-actions">
    <button
      class="pomo-action-btn play-pause {pomodoroState.isRunning ? 'is-running' : ''}"
      onclick={togglePomodoro}
      title={pomodoroState.isRunning ? t('pomodoro.pause') : t('pomodoro.start')}
      aria-label={pomodoroState.isRunning ? t('pomodoro.pause') : t('pomodoro.start')}
    >
      <Icon name={pomodoroState.isRunning ? 'pause' : 'play'} size={compact ? 12 : 14} />
    </button>
    <button
      class="pomo-action-btn reset"
      onclick={resetPomodoro}
      title={t('pomodoro.reset')}
      aria-label={t('pomodoro.reset')}
    >
      <Icon name="repeat" size={compact ? 11 : 13} />
    </button>
    <button
      class="pomo-action-btn sound {pomodoroSoundOptions.tickEnabled || pomodoroSoundOptions.isAmbientPlaying ? 'has-active-sound' : ''}"
      onclick={() => (soundModalOpen = true)}
      title={t('pomodoro.soundOptions')}
      aria-label={t('pomodoro.soundOptions')}
    >
      <Icon name="volume" size={compact ? 11 : 13} />
    </button>
  </div>

  {#if pomodoroState.completedCount > 0}
    <span class="pomo-count-badge" title={t('pomodoro.completed')}>
      {pomodoroState.completedCount}
    </span>
  {/if}

  <!-- Sound Options Modal -->
  <PomodoroSoundModal bind:open={soundModalOpen} />

  <!-- Mode Selector Dropdown Menu -->
  {#if menuOpen}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="pomo-menu-overlay" onclick={() => (menuOpen = false)}></div>
    <div class="pomo-menu" role="menu">
      <button
        class="pomo-menu-item {pomodoroState.mode === 'focus' ? 'active' : ''}"
        onclick={() => handleModeSelect('focus')}
      >
        <span class="dot focus"></span>
        <span class="item-text">{t('pomodoro.focus')} (25m)</span>
      </button>
      <button
        class="pomo-menu-item {pomodoroState.mode === 'shortBreak' ? 'active' : ''}"
        onclick={() => handleModeSelect('shortBreak')}
      >
        <span class="dot shortBreak"></span>
        <span class="item-text">{t('pomodoro.shortBreak')} (5m)</span>
      </button>
      <button
        class="pomo-menu-item {pomodoroState.mode === 'longBreak' ? 'active' : ''}"
        onclick={() => handleModeSelect('longBreak')}
      >
        <span class="dot longBreak"></span>
        <span class="item-text">{t('pomodoro.longBreak')} (15m)</span>
      </button>
    </div>
  {/if}
</div>

<style>
  .pomodoro-widget {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    border-radius: 20px;
    background: var(--surface, #1e293b);
    border: 1px solid var(--border, rgba(255, 255, 255, 0.15));
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
    font-size: 13px;
    user-select: none;
    z-index: 40;
    transition: all 0.2s ease;
  }
  .pomodoro-widget.compact {
    padding: 2px 6px;
    gap: 4px;
    font-size: 11px;
    border-radius: 16px;
  }
  .mode-focus {
    border-color: rgba(239, 68, 68, 0.4);
  }
  .mode-shortBreak {
    border-color: rgba(16, 185, 129, 0.4);
  }
  .mode-longBreak {
    border-color: rgba(59, 130, 246, 0.4);
  }

  .pomo-mode-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 12px;
    color: var(--text, #f1f5f9);
    font-size: 11px;
    font-weight: 600;
  }
  .mode-focus .pomo-mode-btn { color: #f87171; }
  .mode-shortBreak .pomo-mode-btn { color: #34d399; }
  .mode-longBreak .pomo-mode-btn { color: #60a5fa; }

  .pomo-timer-digits {
    font-variant-numeric: tabular-nums;
    font-weight: 700;
    letter-spacing: 0.5px;
    color: var(--text, #f1f5f9);
    padding: 0 2px;
  }
  .pomo-timer-digits.running {
    color: #fbbf24;
  }

  .pomo-actions {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  .pomo-action-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border-radius: 50%;
    border: none;
    cursor: pointer;
    background: var(--surface-2, rgba(255, 255, 255, 0.1));
    color: var(--text, #f1f5f9);
    transition: transform 0.1s ease, background 0.15s;
  }
  .compact .pomo-action-btn {
    width: 18px;
    height: 18px;
  }
  .pomo-action-btn:hover {
    background: var(--accent, #eab308);
    color: #000;
    transform: scale(1.08);
  }
  .pomo-action-btn.play-pause.is-running {
    background: rgba(234, 179, 8, 0.25);
    color: #fbbf24;
  }
  .pomo-action-btn.sound.has-active-sound {
    background: rgba(16, 185, 129, 0.25);
    color: #34d399;
    box-shadow: 0 0 6px rgba(16, 185, 129, 0.4);
  }

  .pomo-count-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 1px 5px;
    border-radius: 10px;
    background: rgba(239, 68, 68, 0.2);
    color: #f87171;
    font-size: 10px;
    font-weight: 700;
  }

  .pomo-menu-overlay {
    position: fixed;
    inset: 0;
    z-index: 99;
  }
  .pomo-menu {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    background: var(--surface, #1e293b);
    border: 1px solid var(--border, rgba(255, 255, 255, 0.2));
    border-radius: 10px;
    padding: 4px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    z-index: 100;
    min-width: 140px;
  }
  .pomo-menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-radius: 6px;
    background: transparent;
    border: none;
    color: var(--text, #f1f5f9);
    font-size: 12px;
    cursor: pointer;
    text-align: start;
    white-space: nowrap;
    transition: background 0.12s;
  }
  .pomo-menu-item:hover {
    background: var(--surface-2, rgba(255, 255, 255, 0.1));
  }
  .pomo-menu-item.active {
    background: var(--surface-2, rgba(255, 255, 255, 0.15));
    font-weight: 600;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .dot.focus { background: #ef4444; }
  .dot.shortBreak { background: #10b981; }
  .dot.longBreak { background: #3b82f6; }
</style>
