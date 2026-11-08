// Reactive Pomodoro timer state and controls.
// Shared across PDF reader, video player, and study dashboard.
import { recordCompletedPomodoro } from './stats.js';
import {
  playNotificationTone,
  loadPreferredSound,
  savePreferredSound,
  loadPomodoroSoundPrefs,
  savePomodoroSoundPrefs,
  playClockTick,
  startAmbientSound,
  stopAmbientSound,
  setAmbientVolume,
  isAmbientSoundActive,
  AVAILABLE_AMBIENT_SOUNDS,
  AVAILABLE_SOUNDS
} from './sound.js';

export { AVAILABLE_AMBIENT_SOUNDS, AVAILABLE_SOUNDS };

export const POMODORO_MODES = {
  focus: { id: 'focus', defaultMinutes: 25, labelKey: 'pomodoro.focus' },
  shortBreak: { id: 'shortBreak', defaultMinutes: 5, labelKey: 'pomodoro.shortBreak' },
  longBreak: { id: 'longBreak', defaultMinutes: 15, labelKey: 'pomodoro.longBreak' }
};

const initialPrefs = loadPomodoroSoundPrefs();

export const pomodoroState = $state({
  mode: 'focus', // 'focus' | 'shortBreak' | 'longBreak'
  durationMinutes: 25,
  timeLeft: 25 * 60,
  isRunning: false,
  completedCount: 0,
  materialTitle: ''
});

export const pomodoroSoundOptions = $state({
  tickEnabled: initialPrefs.tickEnabled, // false by default
  tickVolume: initialPrefs.tickVolume,
  ambientSound: initialPrefs.ambientSound,
  ambientVolume: initialPrefs.ambientVolume,
  ambientMode: initialPrefs.ambientMode, // 'timer' | 'always'
  chimeSound: loadPreferredSound(),
  chimeVolume: 0.7,
  isAmbientPlaying: false
});

let timerInterval = null;

export function setTickEnabled(enabled) {
  pomodoroSoundOptions.tickEnabled = Boolean(enabled);
  savePomodoroSoundPrefs({ tickEnabled: pomodoroSoundOptions.tickEnabled });
}

export function setTickVolume(volume) {
  const vol = Math.max(0.05, Math.min(1.0, Number(volume) || 0.35));
  pomodoroSoundOptions.tickVolume = vol;
  savePomodoroSoundPrefs({ tickVolume: vol });
}

export function setAmbientSound(soundId) {
  pomodoroSoundOptions.ambientSound = soundId || 'none';
  savePomodoroSoundPrefs({ ambientSound: pomodoroSoundOptions.ambientSound });
  if (pomodoroSoundOptions.isAmbientPlaying || pomodoroSoundOptions.ambientMode === 'always') {
    if (pomodoroSoundOptions.ambientSound === 'none') {
      stopAmbientSound();
      pomodoroSoundOptions.isAmbientPlaying = false;
    } else {
      startAmbientSound(pomodoroSoundOptions.ambientSound, pomodoroSoundOptions.ambientVolume);
      pomodoroSoundOptions.isAmbientPlaying = true;
    }
  }
}

export function setAmbientVolumeLevel(volume) {
  const vol = Math.max(0.05, Math.min(1.0, Number(volume) || 0.5));
  pomodoroSoundOptions.ambientVolume = vol;
  savePomodoroSoundPrefs({ ambientVolume: vol });
  setAmbientVolume(vol);
}

export function setAmbientMode(mode) {
  pomodoroSoundOptions.ambientMode = mode === 'always' ? 'always' : 'timer';
  savePomodoroSoundPrefs({ ambientMode: pomodoroSoundOptions.ambientMode });
  if (pomodoroSoundOptions.ambientMode === 'always' && pomodoroSoundOptions.ambientSound !== 'none') {
    startAmbientSound(pomodoroSoundOptions.ambientSound, pomodoroSoundOptions.ambientVolume);
    pomodoroSoundOptions.isAmbientPlaying = true;
  } else if (pomodoroSoundOptions.ambientMode === 'timer' && !pomodoroState.isRunning) {
    stopAmbientSound();
    pomodoroSoundOptions.isAmbientPlaying = false;
  }
}

export function setChimeSound(soundId) {
  pomodoroSoundOptions.chimeSound = soundId || 'soft-chime';
  savePreferredSound(pomodoroSoundOptions.chimeSound);
}

export function setChimeVolume(vol) {
  pomodoroSoundOptions.chimeVolume = Math.max(0.05, Math.min(1.0, Number(vol) || 0.7));
}

export function toggleAmbientPlayback() {
  if (pomodoroSoundOptions.isAmbientPlaying || isAmbientSoundActive()) {
    stopAmbientSound();
    pomodoroSoundOptions.isAmbientPlaying = false;
  } else {
    const soundToPlay = pomodoroSoundOptions.ambientSound !== 'none' ? pomodoroSoundOptions.ambientSound : 'rain';
    if (pomodoroSoundOptions.ambientSound === 'none') {
      pomodoroSoundOptions.ambientSound = 'rain';
      savePomodoroSoundPrefs({ ambientSound: 'rain' });
    }
    startAmbientSound(soundToPlay, pomodoroSoundOptions.ambientVolume);
    pomodoroSoundOptions.isAmbientPlaying = true;
  }
}

export function testTickSound() {
  playClockTick(pomodoroSoundOptions.tickVolume);
}

export function testChimeSound() {
  playNotificationTone(pomodoroSoundOptions.chimeSound, pomodoroSoundOptions.chimeVolume);
}

export function testAmbientPreview(soundId) {
  startAmbientSound(soundId, pomodoroSoundOptions.ambientVolume);
  pomodoroSoundOptions.isAmbientPlaying = true;
}

export function playChimeSound() {
  try {
    playNotificationTone(pomodoroSoundOptions.chimeSound, pomodoroSoundOptions.chimeVolume);
  } catch {
    // Audio context may be restricted by autoplay policy
  }
}

export function togglePomodoro() {
  if (pomodoroState.isRunning) {
    pausePomodoro();
  } else {
    startPomodoro();
  }
}

export function startPomodoro() {
  if (pomodoroState.isRunning) return;
  pomodoroState.isRunning = true;

  // Start ambient sound if configured
  if (pomodoroSoundOptions.ambientSound && pomodoroSoundOptions.ambientSound !== 'none') {
    startAmbientSound(pomodoroSoundOptions.ambientSound, pomodoroSoundOptions.ambientVolume);
    pomodoroSoundOptions.isAmbientPlaying = true;
  }

  // Play tick immediately if enabled
  if (pomodoroSoundOptions.tickEnabled) {
    try { playClockTick(pomodoroSoundOptions.tickVolume); } catch {}
  }

  if (!timerInterval) {
    timerInterval = setInterval(tick, 1000);
  }
}

export function pausePomodoro() {
  pomodoroState.isRunning = false;
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  // Stop ambient sound if mode is timer-only
  if (pomodoroSoundOptions.ambientMode !== 'always') {
    stopAmbientSound();
    pomodoroSoundOptions.isAmbientPlaying = false;
  }
}

export function resetPomodoro() {
  pausePomodoro();
  pomodoroState.timeLeft = pomodoroState.durationMinutes * 60;
  if (pomodoroSoundOptions.ambientMode !== 'always') {
    stopAmbientSound();
    pomodoroSoundOptions.isAmbientPlaying = false;
  }
}

export function setPomodoroMode(modeId) {
  pausePomodoro();
  const config = POMODORO_MODES[modeId] || POMODORO_MODES.focus;
  pomodoroState.mode = config.id;
  pomodoroState.durationMinutes = config.defaultMinutes;
  pomodoroState.timeLeft = config.defaultMinutes * 60;
}

export function setPomodoroMinutes(minutes) {
  const m = Math.max(1, Math.min(180, Number(minutes) || 25));
  pomodoroState.durationMinutes = m;
  if (!pomodoroState.isRunning) {
    pomodoroState.timeLeft = m * 60;
  }
}

export function setPomodoroMaterial(title) {
  if (title) pomodoroState.materialTitle = String(title).slice(0, 100);
}

function onFinish() {
  pausePomodoro();
  playChimeSound();

  const finishedMode = pomodoroState.mode;
  if (finishedMode === 'focus') {
    pomodoroState.completedCount++;
    recordCompletedPomodoro({
      mode: 'focus',
      durationMinutes: pomodoroState.durationMinutes,
      title: pomodoroState.materialTitle
    });

    try {
      if (globalThis.Notification && Notification.permission === 'granted') {
        new Notification('جلسة دراسة مكتملة! 🎉', {
          body: `أحسنت! أكملت جلسة بومودورو (${pomodoroState.durationMinutes} دقيقة). حان وقت استراحة قصيرة.`
        });
      }
    } catch {}

    // Auto-advance to break (long break every 4 pomodoros)
    if (pomodoroState.completedCount % 4 === 0) {
      setPomodoroMode('longBreak');
    } else {
      setPomodoroMode('shortBreak');
    }
  } else {
    setPomodoroMode('focus');
    try {
      if (globalThis.Notification && Notification.permission === 'granted') {
        new Notification('انتهت الاستراحة! 🚀', {
          body: 'استعد للبدء في جلسة التركيز التالية.'
        });
      }
    } catch {}
  }
}

function tick() {
  if (!pomodoroState.isRunning) return;

  // Tick-tick sound every second if enabled
  if (pomodoroSoundOptions.tickEnabled) {
    try {
      playClockTick(pomodoroSoundOptions.tickVolume);
    } catch {}
  }

  if (pomodoroState.timeLeft > 1) {
    pomodoroState.timeLeft--;
  } else {
    pomodoroState.timeLeft = 0;
    onFinish();
  }
}
