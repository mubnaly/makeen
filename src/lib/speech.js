/**
 * Makeen Speech-to-Text Recorder & Realtime Dictation
 * Supports Web Speech API (realtime Arabic/English voice recognition in Chrome/Edge/Android WebView)
 * with graceful fallback to MediaRecorder & local bridge.
 */

let activeRecognition = null;
let activeStream = null;
let activeRecorder = null;

export function isSpeechAvailable() {
  if (typeof window === 'undefined') return false;
  return !!(
    window.SpeechRecognition ||
    window.webkitSpeechRecognition ||
    navigator.mediaDevices?.getUserMedia
  );
}

/**
 * Start realtime dictation using Web Speech API if supported.
 * Calls `onResult({ text, isFinal })`, `onError(err)`, `onEnd()`.
 */
export function startRealtimeSpeech({
  lang = 'ar-SA',
  onResult = () => {},
  onError = () => {},
  onEnd = () => {}
} = {}) {
  const SpeechRecognition = typeof window !== 'undefined'
    ? (window.SpeechRecognition || window.webkitSpeechRecognition)
    : null;

  if (!SpeechRecognition) {
    return null;
  }

  if (activeRecognition) {
    try { activeRecognition.abort(); } catch {}
    activeRecognition = null;
  }

  try {
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.lang = lang || 'ar-SA';

    recognition.onresult = (event) => {
      let interim = '';
      let final = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const item = event.results[i];
        const text = item[0]?.transcript || '';
        if (item.isFinal) {
          final += text;
        } else {
          interim += text;
        }
      }

      onResult({
        final: final.trim(),
        interim: interim.trim(),
        full: (final + ' ' + interim).trim()
      });
    };

    recognition.onerror = (e) => {
      if (e.error === 'no-speech') return; // Ignore silent pauses
      onError(e.error || 'speech_error');
    };

    recognition.onend = () => {
      activeRecognition = null;
      onEnd();
    };

    recognition.start();
    activeRecognition = recognition;

    return {
      stop() {
        if (activeRecognition) {
          try { activeRecognition.stop(); } catch {}
          activeRecognition = null;
        }
      },
      abort() {
        if (activeRecognition) {
          try { activeRecognition.abort(); } catch {}
          activeRecognition = null;
        }
      }
    };
  } catch (err) {
    onError(String(err?.message || err));
    return null;
  }
}

/**
 * Fallback audio recorder for offline Whisper or backend transcription.
 */
export async function startSpeechRecording() {
  if (activeStream) {
    stopCurrentStream();
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      sampleRate: 16000,
      echoCancellation: true,
      noiseSuppression: true
    }
  });
  activeStream = stream;

  const mimeType = (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm;codecs=opus'))
    ? 'audio/webm;codecs=opus'
    : 'audio/webm';

  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks = [];

  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      chunks.push(event.data);
    }
  };

  activeRecorder = recorder;
  recorder.start(250);

  return {
    async stop() {
      return new Promise((resolve, reject) => {
        recorder.onstop = async () => {
          stopCurrentStream();
          try {
            const blob = new Blob(chunks, { type: mimeType });
            const arrayBuffer = await blob.arrayBuffer();
            const bytes = new Uint8Array(arrayBuffer);
            resolve({ bytes, mimeType, size: bytes.length });
          } catch (err) {
            reject(err);
          }
        };
        try {
          if (recorder.state !== 'inactive') {
            recorder.stop();
          }
        } catch (err) {
          stopCurrentStream();
          reject(err);
        }
      });
    },
    cancel() {
      stopCurrentStream();
    }
  };
}

function stopCurrentStream() {
  if (activeStream) {
    try {
      activeStream.getTracks().forEach((track) => track.stop());
    } catch {}
    activeStream = null;
  }
  activeRecorder = null;
}

export async function transcribeAudio(audioBytes, mimeType = 'audio/webm', lang = 'ar') {
  if (!audioBytes || audioBytes.length === 0) {
    return { ok: false, error: 'emptyAudio' };
  }
  const bridge = globalThis.window?.studyos;
  if (typeof bridge?.transcribeAudio === 'function') {
    try {
      return await bridge.transcribeAudio({
        audioBytes,
        mimeType,
        lang,
        model: 'tiny'
      });
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }
  return { ok: false, error: 'offlineSttUnavailable' };
}
