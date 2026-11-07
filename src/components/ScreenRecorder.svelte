<!-- src/components/ScreenRecorder.svelte — Makeen Professional Screen & Camera Recorder -->
<script>
  import { onMount, onDestroy } from 'svelte';
  import Icon from './Icon.svelte';
  import { t, ui } from '../lib/lang.svelte.js';

  let { notify = () => {}, onclose = () => {} } = $props();

  let recordingState = $state('setup'); // 'setup' | 'recording' | 'paused' | 'saving'
  let controlsExpanded = $state(false); // compact floating button by default, expandable on click
  let recordMode = $state('both'); // 'screen' | 'camera' | 'both'
  let cameraPosition = $state('bottom-left'); // 'bottom-left' | 'bottom-right'
  let includeMic = $state(true);
  let includeSysAudio = $state(true);

  let elapsedSeconds = $state(0);
  let timerInterval = null;

  let screenStream = null;
  let cameraStream = null;
  let micStream = null;
  let mediaRecorder = null;
  let recordedChunks = [];

  let canvasEl = null;
  let screenVideoEl = null;
  let cameraVideoEl = null;
  let animationFrameId = null;

  // Format seconds to mm:ss
  function formatDuration(sec) {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  async function startRecording() {
    recordedChunks = [];
    elapsedSeconds = 0;

    try {
      // 1. Get Screen Stream if needed
      if (recordMode === 'screen' || recordMode === 'both') {
        screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: 30 } },
          audio: includeSysAudio
        });

        // Listen for user stopping share from browser banner
        screenStream.getVideoTracks()[0].onended = () => {
          if (recordingState === 'recording' || recordingState === 'paused') {
            stopRecording();
          }
        };
      }

      // 2. Get Camera Stream if needed
      if (recordMode === 'camera' || recordMode === 'both') {
        cameraStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } }
        }).catch((err) => {
          notify?.('تعذر تشغيل الكاميرا: ' + err.message, 'error');
          return null;
        });
      }

      // 3. Get Mic Stream if enabled
      if (includeMic) {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true }
        }).catch(() => null);
      }

      // 4. Setup Video elements for drawing to Canvas
      if (screenStream) {
        screenVideoEl = document.createElement('video');
        screenVideoEl.srcObject = screenStream;
        screenVideoEl.muted = true;
        await screenVideoEl.play();
      }

      if (cameraStream) {
        cameraVideoEl = document.createElement('video');
        cameraVideoEl.srcObject = cameraStream;
        cameraVideoEl.muted = true;
        await cameraVideoEl.play();
      }

      // 5. Canvas Compositing Engine
      const width = screenVideoEl ? screenVideoEl.videoWidth || 1920 : 1280;
      const height = screenVideoEl ? screenVideoEl.videoHeight || 1080 : 720;

      canvasEl = document.createElement('canvas');
      canvasEl.width = width;
      canvasEl.height = height;
      const ctx = canvasEl.getContext('2d');

      const drawFrame = () => {
        if (!ctx) return;

        // Draw screen
        if (screenVideoEl && screenVideoEl.readyState >= 2) {
          ctx.drawImage(screenVideoEl, 0, 0, width, height);
        } else {
          ctx.fillStyle = '#111';
          ctx.fillRect(0, 0, width, height);
        }

        // Draw Circular Camera in corner if mode is 'both'
        if ((recordMode === 'both' || recordMode === 'camera') && cameraVideoEl && cameraVideoEl.readyState >= 2) {
          const camSize = Math.round(Math.min(width, height) * 0.22);
          const margin = 32;
          const cx = cameraPosition === 'bottom-left' ? margin + camSize / 2 : width - margin - camSize / 2;
          const cy = height - margin - camSize / 2;
          const radius = camSize / 2;

          ctx.save();
          ctx.beginPath();
          ctx.arc(cx, cy, radius + 4, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.shadowColor = 'rgba(0,0,0,0.4)';
          ctx.shadowBlur = 12;
          ctx.fill();

          ctx.beginPath();
          ctx.arc(cx, cy, radius, 0, Math.PI * 2);
          ctx.clip();

          // Crop center of camera feed into square circle
          const camW = cameraVideoEl.videoWidth || 640;
          const camH = cameraVideoEl.videoHeight || 480;
          const minDim = Math.min(camW, camH);
          const sx = (camW - minDim) / 2;
          const sy = (camH - minDim) / 2;

          ctx.drawImage(cameraVideoEl, sx, sy, minDim, minDim, cx - radius, cy - radius, camSize, camSize);
          ctx.restore();
        }

        animationFrameId = requestAnimationFrame(drawFrame);
      };

      drawFrame();

      // 6. Capture stream from Canvas
      const outputStream = canvasEl.captureStream(30);

      // Merge Audio Tracks
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const dest = audioCtx.createMediaStreamDestination();

      if (screenStream && screenStream.getAudioTracks().length) {
        const sysSource = audioCtx.createMediaStreamSource(screenStream);
        sysSource.connect(dest);
      }
      if (micStream && micStream.getAudioTracks().length) {
        const micSource = audioCtx.createMediaStreamSource(micStream);
        micSource.connect(dest);
      }

      dest.stream.getAudioTracks().forEach((track) => outputStream.addTrack(track));

      // 7. MediaRecorder setup: prefer MP4 for universal video playback
      const mimeType = MediaRecorder.isTypeSupported('video/mp4;codecs=avc1,mp4a.40.2')
        ? 'video/mp4;codecs=avc1,mp4a.40.2'
        : MediaRecorder.isTypeSupported('video/mp4')
          ? 'video/mp4'
          : MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
            ? 'video/webm;codecs=vp9,opus'
            : 'video/webm';

      mediaRecorder = new MediaRecorder(outputStream, { mimeType });
      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          recordedChunks.push(e.data);
        }
      };

      mediaRecorder.onstop = handleRecordingSaved;

      mediaRecorder.start(1000); // chunk every 1s
      recordingState = 'recording';
      controlsExpanded = false; // start with small floating button

      timerInterval = setInterval(() => {
        elapsedSeconds += 1;
      }, 1000);

      notify?.('بدأ تسجيل الشاشة والكاميرا بنجاح!', 'ok');
    } catch (err) {
      cleanupStreams();
      notify?.('فشل بدء التسجيل: ' + err.message, 'error');
      recordingState = 'setup';
    }
  }

  function pauseRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.pause();
      recordingState = 'paused';
      if (timerInterval) clearInterval(timerInterval);
    }
  }

  function resumeRecording() {
    if (mediaRecorder && mediaRecorder.state === 'paused') {
      mediaRecorder.resume();
      recordingState = 'recording';
      timerInterval = setInterval(() => {
        elapsedSeconds += 1;
      }, 1000);
    }
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      recordingState = 'saving';
      if (timerInterval) clearInterval(timerInterval);
      mediaRecorder.stop();
    }
  }

  function discardRecording() {
    if (confirm('هل أنت متأكد من إلغاء التسجيل وحذفه؟')) {
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.ondataavailable = null;
        mediaRecorder.onstop = null;
        mediaRecorder.stop();
      }
      cleanupStreams();
      onclose?.();
    }
  }

  async function handleRecordingSaved() {
    cleanupStreams();

    if (!recordedChunks.length) {
      notify?.('لم يتم تسجيل أي بيانات', 'error');
      onclose?.();
      return;
    }

    const ext = (mediaRecorder?.mimeType && mediaRecorder.mimeType.includes('mp4')) ? 'mp4' : 'mp4';
    const blob = new Blob(recordedChunks, { type: mediaRecorder?.mimeType || 'video/mp4' });
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const filename = `Makeen_Recording_${timestamp}.${ext}`;

    // 1. Try Desktop (Electron) direct save to Documents/Makeen & reveal in File Explorer
    const bridge = window.makeen || window.studyos;
    if (bridge?.saveExportFile) {
      try {
        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = String(reader.result).split(',')[1];
          const res = await bridge.saveExportFile(filename, base64, true);
          if (res?.ok) {
            if (res.path) {
              bridge.showItemInFolder?.(res.path);
            }
            notify?.(`تم استخراج الفيديو وحفظه في: ${res.path}`, 'ok');
          } else {
            downloadBlobDirectly(blob, filename);
          }
        };
        reader.readAsDataURL(blob);
        onclose?.();
        return;
      } catch (err) {
        console.error('Failed to save via desktop bridge', err);
      }
    }

    // 2. Browser / Mobile Direct Download
    downloadBlobDirectly(blob, filename);
    notify?.('تم استخراج وحفظ الفيديو المسجل بنجاح!', 'ok');
    onclose?.();
  }

  function downloadBlobDirectly(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function cleanupStreams() {
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    if (timerInterval) clearInterval(timerInterval);
    if (screenStream) {
      screenStream.getTracks().forEach((t) => t.stop());
      screenStream = null;
    }
    if (cameraStream) {
      cameraStream.getTracks().forEach((t) => t.stop());
      cameraStream = null;
    }
    if (micStream) {
      micStream.getTracks().forEach((t) => t.stop());
      micStream = null;
    }
  }

  onDestroy(() => {
    cleanupStreams();
  });
</script>

{#if recordingState === 'setup'}
  <!-- Recorder Setup Dialog -->
  <div class="recorder-backdrop" onclick={onclose} role="presentation">
    <div class="recorder-card card" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
      <div class="recorder-head hstack" style="justify-content:space-between;">
        <div class="hstack" style="gap:8px;">
          <div class="rec-icon-badge"><Icon name="video" size={18} /></div>
          <h3 style="margin:0; font-size:16px;">{t('recorder.recordScreen')}</h3>
        </div>
        <button class="icon-btn" onclick={onclose}><Icon name="x" size={16} /></button>
      </div>

      <div class="recorder-body">
        <label class="field-label">نوع التسجيل المطلوب:</label>
        <div class="mode-selector-grid">
          <button
            type="button"
            class="mode-btn {recordMode === 'both' ? 'active' : ''}"
            onclick={() => (recordMode = 'both')}
          >
            <Icon name="video" size={20} />
            <span class="mode-title">الشاشة + الكاميرا</span>
            <span class="mode-sub">صورة داخل صورة دائرية (PiP)</span>
          </button>

          <button
            type="button"
            class="mode-btn {recordMode === 'screen' ? 'active' : ''}"
            onclick={() => (recordMode = 'screen')}
          >
            <Icon name="columns" size={20} />
            <span class="mode-title">الشاشة فقط</span>
            <span class="mode-sub">تسجيل التطبيق أو نافذة محددة</span>
          </button>

          <button
            type="button"
            class="mode-btn {recordMode === 'camera' ? 'active' : ''}"
            onclick={() => (recordMode = 'camera')}
          >
            <Icon name="camera" size={20} />
            <span class="mode-title">الكاميرا فقط</span>
            <span class="mode-sub">تسجيل شرح بالكاميرا مباشرة</span>
          </button>
        </div>

        {#if recordMode === 'both'}
          <label class="field-label" style="margin-top:10px;">موضع الكاميرا الدائرية:</label>
          <div class="hstack" style="gap:10px;">
            <button
              type="button"
              class="pos-btn {cameraPosition === 'bottom-left' ? 'active' : ''}"
              onclick={() => (cameraPosition = 'bottom-left')}
            >
              <Icon name="check" size={13} />
              <span>{t('recorder.posBottomLeft')} (الافتراضي)</span>
            </button>
            <button
              type="button"
              class="pos-btn {cameraPosition === 'bottom-right' ? 'active' : ''}"
              onclick={() => (cameraPosition = 'bottom-right')}
            >
              <Icon name="check" size={13} />
              <span>{t('recorder.posBottomRight')}</span>
            </button>
          </div>
        {/if}

        <div class="audio-options-card card mt">
          <label class="checkbox-row hstack">
            <input type="checkbox" bind:checked={includeMic} />
            <span>تسجيل صوت الميكروفون (الشرح الصوتي)</span>
          </label>
          <label class="checkbox-row hstack">
            <input type="checkbox" bind:checked={includeSysAudio} />
            <span>تسجيل صوت النظام الداخلي وفيديوهات التطبيق</span>
          </label>
        </div>
      </div>

      <div class="recorder-footer hstack" style="justify-content:flex-end; gap:8px;">
        <button class="secondary" onclick={onclose}>{t('common.cancel')}</button>
        <button class="primary hstack" onclick={startRecording}>
          <span class="rec-dot"></span>
          <span>{t('recorder.start')}</span>
        </button>
      </div>
    </div>
  </div>
{:else}
  <!-- Floating Live Recording Widget (Small Button by default, clicks to expand controls) -->
  {#if !controlsExpanded}
    <button
      type="button"
      class="floating-recorder-pill"
      onclick={() => (controlsExpanded = true)}
      title="انقر لإظهار أدوات التحكم بالتسجيل (إيقاف، إيقاف مؤقت، متابعة)"
      aria-label="أدوات التسجيل"
    >
      <span class="rec-pulsing-dot {recordingState === 'paused' ? 'paused' : ''}"></span>
      <span class="rec-timer">{formatDuration(elapsedSeconds)}</span>
      <span class="pill-expand-icon"><Icon name="chevron-up" size={13} /></span>
    </button>
  {:else}
    <div class="floating-recorder-bar" role="toolbar" aria-label="أدوات التسجيل">
      <div
        class="rec-status-indicator hstack"
        role="button"
        tabindex="0"
        onclick={() => (controlsExpanded = false)}
        onkeydown={(e) => { if (e.key === 'Enter') controlsExpanded = false; }}
        title="تصغير إلى زر صغير"
        style="cursor:pointer;"
      >
        <span class="rec-pulsing-dot {recordingState === 'paused' ? 'paused' : ''}"></span>
        <span class="rec-timer">{formatDuration(elapsedSeconds)}</span>
      </div>

      <div class="v-divider"></div>

      <div class="hstack" style="gap:6px;">
        {#if recordingState === 'recording'}
          <button class="rec-control-btn" onclick={pauseRecording} title={t('recorder.pause')}>
            <Icon name="pause" size={15} />
          </button>
        {:else if recordingState === 'paused'}
          <button class="rec-control-btn active" onclick={resumeRecording} title={t('recorder.resume')}>
            <Icon name="play" size={15} />
          </button>
        {/if}

        <button class="rec-control-btn stop" onclick={stopRecording} title={t('recorder.stop')}>
          <Icon name="square" size={14} />
          <span style="font-weight:700; font-size:12px;">{t('recorder.stop')}</span>
        </button>

        {#if recordMode === 'both'}
          <button
            class="rec-control-btn"
            onclick={() => (cameraPosition = cameraPosition === 'bottom-left' ? 'bottom-right' : 'bottom-left')}
            title="تبديل موضع الكاميرا الدائرية"
          >
            <Icon name="camera" size={14} />
          </button>
        {/if}

        <button class="rec-control-btn discard" onclick={discardRecording} title={t('recorder.discard')}>
          <Icon name="trash" size={14} />
        </button>

        <div class="v-divider"></div>

        <button class="rec-control-btn minimize" onclick={() => (controlsExpanded = false)} title="تصغير إلى زر صغير">
          <Icon name="chevron-down" size={14} />
        </button>
      </div>
    </div>
  {/if}
{/if}

<style>
  .recorder-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  }
  .recorder-card {
    width: min(520px, 94vw);
    padding: 20px;
    border-radius: var(--radius-lg);
    background: var(--surface);
    display: flex;
    flex-direction: column;
    gap: 16px;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.3);
  }
  .rec-icon-badge {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    background: #e74c3c;
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .recorder-body {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .field-label {
    font-size: 13px;
    font-weight: 700;
  }
  .mode-selector-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }
  .mode-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 6px;
    padding: 12px 8px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface-2);
    cursor: pointer;
    transition: all 0.15s;
    color: var(--text);
  }
  .mode-btn.active {
    border-color: #e74c3c;
    background: rgba(231, 76, 60, 0.08);
    color: #e74c3c;
  }
  .mode-title {
    font-size: 12.5px;
    font-weight: 700;
  }
  .mode-sub {
    font-size: 10px;
    color: var(--muted);
  }

  .pos-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--surface-2);
    font-size: 12px;
    cursor: pointer;
    color: var(--text);
  }
  .pos-btn.active {
    background: var(--accent);
    color: #fff;
    border-color: var(--accent);
  }

  .audio-options-card {
    padding: 10px 14px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .checkbox-row {
    font-size: 12.5px;
    cursor: pointer;
    gap: 8px;
  }

  .rec-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #e74c3c;
    display: inline-block;
  }

  /* Floating Compact Pill Button */
  .floating-recorder-pill {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(18, 20, 28, 0.94);
    color: #fff;
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.22);
    border-radius: 999px;
    padding: 7px 16px;
    display: inline-flex;
    align-items: center;
    gap: 10px;
    z-index: 10001;
    cursor: pointer;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
    transition: transform 0.15s, background 0.15s, box-shadow 0.15s;
    user-select: none;
    -webkit-user-select: none;
  }
  .floating-recorder-pill:hover {
    transform: translate(-50%, -2px);
    background: rgba(28, 32, 44, 0.98);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
  }
  .pill-expand-icon {
    display: inline-flex;
    align-items: center;
    opacity: 0.7;
  }

  /* Floating Controller Toolbar */
  .floating-recorder-bar {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(18, 20, 28, 0.94);
    color: #fff;
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 999px;
    padding: 8px 16px;
    display: flex;
    align-items: center;
    gap: 12px;
    z-index: 10001;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    animation: slide-up 0.25s ease-out;
  }
  @keyframes slide-up {
    from { transform: translate(-50%, 20px); opacity: 0; }
    to { transform: translate(-50%, 0); opacity: 1; }
  }

  .rec-pulsing-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #e74c3c;
    box-shadow: 0 0 0 rgba(231, 76, 60, 0.7);
    animation: pulse 1.4s infinite;
  }
  .rec-pulsing-dot.paused {
    background: #f39c12;
    animation: none;
  }
  @keyframes pulse {
    0% { box-shadow: 0 0 0 0 rgba(231, 76, 60, 0.7); }
    70% { box-shadow: 0 0 0 8px rgba(231, 76, 60, 0); }
    100% { box-shadow: 0 0 0 0 rgba(231, 76, 60, 0); }
  }

  .rec-timer {
    font-family: monospace;
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 1px;
  }
  .v-divider {
    width: 1px;
    height: 20px;
    background: rgba(255, 255, 255, 0.2);
  }

  .rec-control-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-radius: 999px;
    border: none;
    background: rgba(255, 255, 255, 0.12);
    color: #fff;
    cursor: pointer;
    font-size: 12px;
    transition: background 0.15s;
  }
  .rec-control-btn:hover {
    background: rgba(255, 255, 255, 0.22);
  }
  .rec-control-btn.stop {
    background: #e74c3c;
  }
  .rec-control-btn.stop:hover {
    background: #c0392b;
  }
  .rec-control-btn.discard {
    background: transparent;
    color: #aaa;
  }
  .rec-control-btn.discard:hover {
    color: #ff6b6b;
  }
</style>
