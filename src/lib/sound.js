// Web Audio Synthesizer for Makeen notifications, Pomodoro timer & Prayer reminders.
// Pure offline synthesis: Zero external audio file dependencies, zero latency, customizable tones.

const SOUND_PREF_KEY = 'makeen.sound.tone';
const VOLUME_PREF_KEY = 'makeen.sound.volume';

export const AVAILABLE_SOUNDS = [
  { id: 'soft-chime', nameEn: 'Soft Chime', nameAr: 'رنة هادئة (لحن ثلاثي)' },
  { id: 'gentle-bell', nameEn: 'Gentle Bell', nameAr: 'جرس لطيف' },
  { id: 'classic-ping', nameEn: 'Classic Ping', nameAr: 'رنين بلوري' },
  { id: 'peaceful-bowl', nameEn: 'Tibetan Singing Bowl', nameAr: 'وعاء تأمل هادئ' },
  { id: 'adhan-melody', nameEn: 'Spiritual Tone', nameAr: 'نغمة أذان روحانية' }
];

export function loadPreferredSound() {
  if (typeof localStorage === 'undefined') return 'soft-chime';
  return localStorage.getItem(SOUND_PREF_KEY) || 'soft-chime';
}

export function savePreferredSound(soundId) {
  if (typeof localStorage === 'undefined' || !soundId) return;
  localStorage.setItem(SOUND_PREF_KEY, soundId);
}

export function loadSoundVolume() {
  if (typeof localStorage === 'undefined') return 0.7;
  const raw = localStorage.getItem(VOLUME_PREF_KEY);
  if (!raw) return 0.7;
  const num = parseFloat(raw);
  return Number.isFinite(num) ? Math.max(0.05, Math.min(1.0, num)) : 0.7;
}

export function saveSoundVolume(vol) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(VOLUME_PREF_KEY, String(vol));
}

let audioCtx = null;
function getAudioContext() {
  if (typeof window === 'undefined') return null;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new AudioCtx();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

/**
 * Plays a synthesized notification tone using Web Audio API.
 * @param {string} [soundId] One of AVAILABLE_SOUNDS ids. Defaults to user's saved preference.
 * @param {number} [customVolume] Volume 0.0 to 1.0
 */
export function playNotificationTone(soundId = null, customVolume = null) {
  const ctx = getAudioContext();
  if (!ctx) return;

  const tone = soundId || loadPreferredSound();
  const volume = customVolume !== null ? customVolume : loadSoundVolume();

  const now = ctx.currentTime;
  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(volume * 0.45, now);
  masterGain.connect(ctx.destination);

  switch (tone) {
    case 'gentle-bell': {
      // Warm chime with fundamental and overtone
      playHarmonicBell(ctx, masterGain, now, 523.25, 1.8);
      break;
    }
    case 'classic-ping': {
      // Crisp modern glass ping
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(1760, now + 0.05);

      gain.gain.setValueAtTime(1.0, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

      osc.connect(gain);
      gain.connect(masterGain);
      osc.start(now);
      osc.stop(now + 0.6);
      break;
    }
    case 'peaceful-bowl': {
      // Deep resonant meditative tone
      playHarmonicBell(ctx, masterGain, now, 261.63, 2.5);
      playHarmonicBell(ctx, masterGain, now, 392.00, 2.2);
      break;
    }
    case 'adhan-melody': {
      // 4-note spiritual ascending gentle melody (D4, G4, A4, D5)
      const notes = [
        { f: 293.66, t: 0.0, d: 0.4 },
        { f: 392.00, t: 0.35, d: 0.5 },
        { f: 440.00, t: 0.8, d: 0.6 },
        { f: 587.33, t: 1.35, d: 1.2 }
      ];
      notes.forEach(({ f, t, d }) => {
        playHarmonicBell(ctx, masterGain, now + t, f, d);
      });
      break;
    }
    case 'soft-chime':
    default: {
      // 3-note ascending chime: C5, E5, G5
      const notes = [
        { f: 523.25, t: 0.0, d: 0.5 },
        { f: 659.25, t: 0.16, d: 0.6 },
        { f: 783.99, t: 0.32, d: 0.9 }
      ];
      notes.forEach(({ f, t, d }) => {
        playHarmonicBell(ctx, masterGain, now + t, f, d);
      });
      break;
    }
  }
}

function playHarmonicBell(ctx, destination, startTime, freq, duration) {
  // Fundamental oscillator
  const osc1 = ctx.createOscillator();
  const gain1 = ctx.createGain();
  osc1.type = 'sine';
  osc1.frequency.setValueAtTime(freq, startTime);

  gain1.gain.setValueAtTime(0.001, startTime);
  gain1.gain.linearRampToValueAtTime(0.7, startTime + 0.03);
  gain1.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  osc1.connect(gain1);
  gain1.connect(destination);

  osc1.start(startTime);
  osc1.stop(startTime + duration);

  // Soft overtone (harmonic sparkle)
  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.type = 'sine';
  osc2.frequency.setValueAtTime(freq * 2.02, startTime);

  gain2.gain.setValueAtTime(0.001, startTime);
  gain2.gain.linearRampToValueAtTime(0.25, startTime + 0.02);
  gain2.gain.exponentialRampToValueAtTime(0.0001, startTime + duration * 0.6);

  osc2.connect(gain2);
  gain2.connect(destination);

  osc2.start(startTime);
  osc2.stop(startTime + duration * 0.6);
}
