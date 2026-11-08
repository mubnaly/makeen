// Web Audio Synthesizer for Makeen notifications, Pomodoro timer & Prayer reminders.
// Pure offline synthesis: Zero external audio file dependencies, zero latency, customizable tones.

const SOUND_PREF_KEY = 'makeen.sound.tone';
const VOLUME_PREF_KEY = 'makeen.sound.volume';
const POMO_TICK_PREF_KEY = 'makeen.pomodoro.tick_enabled';
const POMO_TICK_VOL_KEY = 'makeen.pomodoro.tick_volume';
const POMO_AMBIENT_PREF_KEY = 'makeen.pomodoro.ambient_sound';
const POMO_AMBIENT_VOL_KEY = 'makeen.pomodoro.ambient_volume';
const POMO_AMBIENT_MODE_KEY = 'makeen.pomodoro.ambient_mode';

export const AVAILABLE_SOUNDS = [
  { id: 'soft-chime', nameEn: 'Soft Chime', nameAr: 'رنة هادئة (لحن ثلاثي)' },
  { id: 'gentle-bell', nameEn: 'Gentle Bell', nameAr: 'جرس لطيف' },
  { id: 'classic-ping', nameEn: 'Classic Ping', nameAr: 'رنين بلوري' },
  { id: 'peaceful-bowl', nameEn: 'Tibetan Singing Bowl', nameAr: 'وعاء تأمل هادئ' },
  { id: 'adhan-melody', nameEn: 'Spiritual Tone', nameAr: 'نغمة أذان روحانية' }
];

export const AVAILABLE_AMBIENT_SOUNDS = [
  { id: 'none', nameEn: 'None (Silent)', nameAr: 'صامت (بدون صوت)', icon: 'volume' },
  { id: 'clock', nameEn: 'Grandfather Clock', nameAr: 'دقات ساعة حائطية', icon: 'clock' },
  { id: 'rain', nameEn: 'Gentle Rain', nameAr: 'صوت المطر الهادئ', icon: 'volume' },
  { id: 'brown', nameEn: 'Deep Focus (Brown Noise)', nameAr: 'تركيز عميق (ضوضاء بنية)', icon: 'sliders' },
  { id: 'white', nameEn: 'White Noise', nameAr: 'ضوضاء بيضاء نقية', icon: 'sliders' },
  { id: 'waves', nameEn: 'Ocean Waves', nameAr: 'أمواج البحر وتدفق الماء', icon: 'volume' },
  { id: 'campfire', nameEn: 'Cozy Campfire', nameAr: 'نيران المدفأة وتفرقع الحطب', icon: 'volume' },
  { id: 'zen', nameEn: 'Zen Meditation Bowl', nameAr: 'وعاء تأمل وتناغم هادئ', icon: 'bell' }
];

export function loadPomodoroSoundPrefs() {
  if (typeof localStorage === 'undefined') {
    return {
      tickEnabled: false, // DISABLED BY DEFAULT as requested
      tickVolume: 0.35,
      ambientSound: 'none',
      ambientVolume: 0.5,
      ambientMode: 'timer'
    };
  }
  return {
    tickEnabled: localStorage.getItem(POMO_TICK_PREF_KEY) === '1', // default false
    tickVolume: parseFloat(localStorage.getItem(POMO_TICK_VOL_KEY) || '0.35'),
    ambientSound: localStorage.getItem(POMO_AMBIENT_PREF_KEY) || 'none',
    ambientVolume: parseFloat(localStorage.getItem(POMO_AMBIENT_VOL_KEY) || '0.5'),
    ambientMode: localStorage.getItem(POMO_AMBIENT_MODE_KEY) || 'timer'
  };
}

export function savePomodoroSoundPrefs(patch = {}) {
  if (typeof localStorage === 'undefined') return;
  if ('tickEnabled' in patch) {
    localStorage.setItem(POMO_TICK_PREF_KEY, patch.tickEnabled ? '1' : '0');
  }
  if ('tickVolume' in patch) {
    localStorage.setItem(POMO_TICK_VOL_KEY, String(patch.tickVolume));
  }
  if ('ambientSound' in patch) {
    localStorage.setItem(POMO_AMBIENT_PREF_KEY, String(patch.ambientSound));
  }
  if ('ambientVolume' in patch) {
    localStorage.setItem(POMO_AMBIENT_VOL_KEY, String(patch.ambientVolume));
  }
  if ('ambientMode' in patch) {
    localStorage.setItem(POMO_AMBIENT_MODE_KEY, String(patch.ambientMode));
  }
}

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

let tickAlternate = false;

/**
 * Plays a single, crisp mechanical clock tick/tock sound.
 * @param {number} [volume] Volume between 0.0 and 1.0. Defaults to 0.35.
 */
export function playClockTick(volume = 0.35) {
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  tickAlternate = !tickAlternate;

  // Alternate between tick (~1400Hz) and tock (~950Hz)
  const freq = tickAlternate ? 1400 : 950;
  const decay = tickAlternate ? 0.016 : 0.024;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();

  osc.type = 'triangle';
  osc.frequency.setValueAtTime(freq, now);
  osc.frequency.exponentialRampToValueAtTime(tickAlternate ? 550 : 380, now + decay);

  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(freq, now);
  filter.Q.setValueAtTime(7.5, now);

  const vol = Math.max(0.01, Math.min(1.0, volume)) * 0.38;
  gain.gain.setValueAtTime(vol, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + decay);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + decay);
}

let currentAmbient = null;

/**
 * Starts synthesizing an ambient focus background sound.
 * Pure Web Audio API offline synthesis (no external network files).
 * @param {string} soundId One of AVAILABLE_AMBIENT_SOUNDS ids.
 * @param {number} [volume] 0.0 to 1.0
 */
export function startAmbientSound(soundId, volume = 0.5) {
  stopAmbientSound();
  if (!soundId || soundId === 'none') return null;

  const ctx = getAudioContext();
  if (!ctx) return null;

  const now = ctx.currentTime;
  const masterGain = ctx.createGain();
  const clampedVol = Math.max(0.01, Math.min(1.0, volume));
  masterGain.gain.setValueAtTime(0.001, now);
  masterGain.gain.linearRampToValueAtTime(clampedVol * 0.45, now + 0.3);
  masterGain.connect(ctx.destination);

  let cleanupFn = () => {};

  try {
    switch (soundId) {
      case 'clock': {
        // Grandfather Clock ambience: rhythmic ticking every second
        let clockTimer = setInterval(() => {
          playClockTick(clampedVol);
        }, 1000);
        playClockTick(clampedVol);
        cleanupFn = () => {
          if (clockTimer) clearInterval(clockTimer);
          clockTimer = null;
        };
        break;
      }

      case 'rain': {
        // Pink noise base + soft droplet transients
        const bufferSize = ctx.sampleRate * 3;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
        for (let i = 0; i < bufferSize; i++) {
          const white = Math.random() * 2 - 1;
          b0 = 0.99886 * b0 + white * 0.0555179;
          b1 = 0.99332 * b1 + white * 0.0750759;
          b2 = 0.96900 * b2 + white * 0.1538520;
          b3 = 0.86650 * b3 + white * 0.3104856;
          b4 = 0.55000 * b4 + white * 0.5329522;
          b5 = -0.7616 * b5 - white * 0.0168980;
          data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.09;
          b6 = white * 0.115926;
        }
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1400, now);

        source.connect(filter);
        filter.connect(masterGain);
        source.start(now);

        // Random droplets
        let dropInterval = setInterval(() => {
          if (!currentAmbient || currentAmbient.soundId !== 'rain') return;
          try {
            const dropTime = ctx.currentTime;
            const dropOsc = ctx.createOscillator();
            const dropGain = ctx.createGain();
            dropOsc.type = 'sine';
            const f = 2000 + Math.random() * 2200;
            dropOsc.frequency.setValueAtTime(f, dropTime);
            dropOsc.frequency.exponentialRampToValueAtTime(f * 0.6, dropTime + 0.03);

            dropGain.gain.setValueAtTime(clampedVol * 0.08 * (0.5 + Math.random() * 0.5), dropTime);
            dropGain.gain.exponentialRampToValueAtTime(0.0001, dropTime + 0.035);

            dropOsc.connect(dropGain);
            dropGain.connect(masterGain);
            dropOsc.start(dropTime);
            dropOsc.stop(dropTime + 0.04);
          } catch {}
        }, 160);

        cleanupFn = () => {
          if (dropInterval) clearInterval(dropInterval);
          dropInterval = null;
          try { source.stop(); } catch {}
        };
        break;
      }

      case 'brown': {
        // Brownian noise (deep focus / reading)
        const bufferSize = ctx.sampleRate * 3;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        let lastOut = 0.0;
        for (let i = 0; i < bufferSize; i++) {
          const white = Math.random() * 2 - 1;
          data[i] = (lastOut + (0.02 * white)) / 1.02;
          lastOut = data[i];
          data[i] *= 3.8;
        }
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(320, now);
        filter.Q.setValueAtTime(0.7, now);

        source.connect(filter);
        filter.connect(masterGain);
        source.start(now);

        cleanupFn = () => {
          try { source.stop(); } catch {}
        };
        break;
      }

      case 'white': {
        // Pure smooth white noise
        const bufferSize = ctx.sampleRate * 2;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          data[i] = (Math.random() * 2 - 1) * 0.15;
        }
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(2200, now);

        source.connect(filter);
        filter.connect(masterGain);
        source.start(now);

        cleanupFn = () => {
          try { source.stop(); } catch {}
        };
        break;
      }

      case 'waves': {
        // Ocean surf: brownian noise modulated with 0.12 Hz LFO
        const bufferSize = ctx.sampleRate * 4;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        let lastOut = 0.0;
        for (let i = 0; i < bufferSize; i++) {
          const white = Math.random() * 2 - 1;
          data[i] = (lastOut + (0.02 * white)) / 1.02;
          lastOut = data[i];
          data[i] *= 3.2;
        }
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(380, now);

        // LFO modulating filter cutoff
        const lfo = ctx.createOscillator();
        const lfoGain = ctx.createGain();
        lfo.frequency.setValueAtTime(0.12, now); // ~8 sec per wave
        lfoGain.gain.setValueAtTime(220, now);
        lfo.connect(lfoGain);
        lfoGain.connect(filter.frequency);

        source.connect(filter);
        filter.connect(masterGain);

        source.start(now);
        lfo.start(now);

        cleanupFn = () => {
          try {
            source.stop();
            lfo.stop();
          } catch {}
        };
        break;
      }

      case 'campfire': {
        // Campfire: low rumble + crackle pops
        const bufferSize = ctx.sampleRate * 3;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        let lastOut = 0.0;
        for (let i = 0; i < bufferSize; i++) {
          const white = Math.random() * 2 - 1;
          data[i] = (lastOut + (0.015 * white)) / 1.015;
          lastOut = data[i];
          data[i] *= 2.8;
        }
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(220, now);

        source.connect(filter);
        filter.connect(masterGain);
        source.start(now);

        let crackleTimer = setInterval(() => {
          if (!currentAmbient || currentAmbient.soundId !== 'campfire') return;
          try {
            const crackleTime = ctx.currentTime;
            const popOsc = ctx.createOscillator();
            const popGain = ctx.createGain();
            const popFilter = ctx.createBiquadFilter();

            popOsc.type = 'sawtooth';
            popOsc.frequency.setValueAtTime(400 + Math.random() * 1200, crackleTime);

            popFilter.type = 'highpass';
            popFilter.frequency.setValueAtTime(900, crackleTime);

            const popDuration = 0.008 + Math.random() * 0.012;
            popGain.gain.setValueAtTime(clampedVol * 0.12 * (0.4 + Math.random() * 0.6), crackleTime);
            popGain.gain.exponentialRampToValueAtTime(0.0001, crackleTime + popDuration);

            popOsc.connect(popFilter);
            popFilter.connect(popGain);
            popGain.connect(masterGain);

            popOsc.start(crackleTime);
            popOsc.stop(crackleTime + popDuration);
          } catch {}
        }, 110);

        cleanupFn = () => {
          if (crackleTimer) clearInterval(crackleTimer);
          crackleTimer = null;
          try { source.stop(); } catch {}
        };
        break;
      }

      case 'zen': {
        // Tibetan singing bowl drone (216 Hz fundamental + 432 Hz harmonic + 648 Hz overtone)
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const osc3 = ctx.createOscillator();

        const g1 = ctx.createGain();
        const g2 = ctx.createGain();
        const g3 = ctx.createGain();

        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(216, now);
        g1.gain.setValueAtTime(0.4, now);

        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(432.5, now);
        g2.gain.setValueAtTime(0.2, now);

        osc3.type = 'sine';
        osc3.frequency.setValueAtTime(648.8, now);
        g3.gain.setValueAtTime(0.08, now);

        // Gentle slow tremolo LFO
        const lfo = ctx.createOscillator();
        const lfoG = ctx.createGain();
        lfo.frequency.setValueAtTime(0.18, now);
        lfoG.gain.setValueAtTime(0.08, now);
        lfo.connect(lfoG);
        lfoG.connect(masterGain.gain);

        osc1.connect(g1);
        osc2.connect(g2);
        osc3.connect(g3);
        g1.connect(masterGain);
        g2.connect(masterGain);
        g3.connect(masterGain);

        osc1.start(now);
        osc2.start(now);
        osc3.start(now);
        lfo.start(now);

        cleanupFn = () => {
          try {
            osc1.stop();
            osc2.stop();
            osc3.stop();
            lfo.stop();
          } catch {}
        };
        break;
      }

      default:
        break;
    }
  } catch (err) {
    console.warn('Ambient synthesis failed:', err);
  }

  currentAmbient = {
    soundId,
    masterGain,
    cleanup: () => {
      try {
        const curTime = ctx.currentTime;
        masterGain.gain.setValueAtTime(masterGain.gain.value, curTime);
        masterGain.gain.linearRampToValueAtTime(0.0001, curTime + 0.15);
      } catch {}
      setTimeout(() => {
        cleanupFn();
        try { masterGain.disconnect(); } catch {}
      }, 160);
    }
  };

  return currentAmbient;
}

export function stopAmbientSound() {
  if (currentAmbient) {
    try {
      currentAmbient.cleanup();
    } catch {}
    currentAmbient = null;
  }
}

export function setAmbientVolume(vol) {
  if (currentAmbient && currentAmbient.masterGain) {
    try {
      const ctx = getAudioContext();
      if (ctx) {
        const now = ctx.currentTime;
        const clamped = Math.max(0.01, Math.min(1.0, vol));
        currentAmbient.masterGain.gain.setValueAtTime(currentAmbient.masterGain.gain.value, now);
        currentAmbient.masterGain.gain.linearRampToValueAtTime(clamped * 0.45, now + 0.05);
      }
    } catch {}
  }
}

export function isAmbientSoundActive() {
  return currentAmbient !== null && currentAmbient.soundId !== 'none';
}

