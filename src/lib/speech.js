/**
 * StudyOS Offline Speech-to-Text Recorder & Bridge
 * Records audio from user microphone and uses local Whisper to transcribe in Arabic.
 */

let activeStream = null;
let activeRecorder = null;

export async function isSpeechAvailable() {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

/**
 * Start recording from the microphone.
 * Returns an object with `stop()`, `cancel()`, and `onData`.
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

  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
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

/**
 * Send audio bytes to Electron offline speech-to-text bridge.
 * @param {Uint8Array} audioBytes
 * @param {string} mimeType
 * @param {string} lang
 * @returns {Promise<{ ok: boolean, text?: string, error?: string }>}
 */
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
