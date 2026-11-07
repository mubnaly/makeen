const { contextBridge, ipcRenderer } = require('electron');

// Desktop bridge exposed to the renderer. The storage layer calls these to
// write real JSON sidecars + capture PNGs (fixes gap defect D3/D5). Methods
// return { ok, path } or { ok:false, error } so the UI never claims a write that
// did not happen.
const api = {
  saveCapture: (filename, dataUrl) => ipcRenderer.invoke('save-capture', { filename, dataUrl }),
  saveSidecarFile: (documentId, text) => ipcRenderer.invoke('save-sidecar', { documentId, text }),
  loadSidecarFile: (documentId) => ipcRenderer.invoke('load-sidecar', { documentId }),
  saveExportFile: (filename, dataBase64, showInFolder = true) => ipcRenderer.invoke('save-export', { filename, dataBase64, showInFolder }),
  showItemInFolder: (itemPath) => ipcRenderer.invoke('show-item-in-folder', itemPath),
  notify: (title, body) => ipcRenderer.invoke('notify', { title, body }),

  // YouTube: the loopback player origin (see player-server.cjs), caption
  // extraction, and a compositor crop for frames that canvas cannot read.
  appOrigin: () => ipcRenderer.invoke('app-origin'),
  youtubeTranscript: (payload) => ipcRenderer.invoke('youtube-transcript', payload),
  youtubePlaylist: (payload) => ipcRenderer.invoke('youtube-playlist', payload),
  youtubeChannel: (payload) => ipcRenderer.invoke('youtube-channel', payload),
  youtubeChapters: (payload) => ipcRenderer.invoke('youtube-chapters', payload),
  youtubeCaptureFrame: (payload) => ipcRenderer.invoke('youtube-capture-frame', payload),
  downloadVideo: (payload) => ipcRenderer.invoke('video-download', payload),
  exportTranscriptPdf: (payload) => ipcRenderer.invoke('export-transcript-pdf', payload),
  captureRegion: (rect, quality) => ipcRenderer.invoke('capture-region', { rect, quality }),
  setYoutubeQuality: (quality) => ipcRenderer.invoke('set-youtube-quality', { quality }),
  transcribeAudio: (payload) => ipcRenderer.invoke('transcribe-audio', payload),

  // PDF opening on Desktop: startup args, "Open With", and native file dialog
  getInitialPdf: () => ipcRenderer.invoke('get-initial-pdf'),
  onOpenPdf: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('open-pdf-file', handler);
    return () => ipcRenderer.removeListener('open-pdf-file', handler);
  },
  pickLocalPdf: () => ipcRenderer.invoke('pick-local-pdf'),
  readPdfFile: (filePath) => ipcRenderer.invoke('read-pdf-file', filePath),
  writePdfFile: (filePath, bytes) => ipcRenderer.invoke('write-pdf-file', { filePath, bytes })
};

contextBridge.exposeInMainWorld('makeen', api);
contextBridge.exposeInMainWorld('studyos', api);
