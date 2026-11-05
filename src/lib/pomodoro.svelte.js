// Reactive Pomodoro timer state and controls.
// Shared across PDF reader, video player, and study dashboard.
import { recordCompletedPomodoro } from './stats.js';
import { playNotificationTone } from './sound.js';

export const POMODORO_MODES = {
  focus: { id: 'focus', defaultMinutes: 25, labelKey: 'pomodoro.focus' },
  shortBreak: { id: 'shortBreak', defaultMinutes: 5, labelKey: 'pomodoro.shortBreak' },
  longBreak: { id: 'longBreak', defaultMinutes: 15, labelKey: 'pomodoro.longBreak' }
};

export const pomodoroState = $state({
  mode: 'focus', // 'focus' | 'shortBreak' | 'longBreak'
  durationMinutes: 25,
  timeLeft: 25 * 60,
  isRunning: false,
  completedCount: 0,
  materialTitle: ''
});

let timerInterval = null;

export function playChimeSound() {
  try {
    playNotificationTone();
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
}

export function resetPomodoro() {
  pausePomodoro();
  pomodoroState.timeLeft = pomodoroState.durationMinutes * 60;
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
  if (pomodoroState.timeLeft > 1) {
    pomodoroState.timeLeft--;
  } else {
    pomodoroState.timeLeft = 0;
    onFinish();
  }
}
