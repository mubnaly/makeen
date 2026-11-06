// src/lib/videoSettings.js
// Global video quality preference (YouTube & player videos)

export const VIDEO_QUALITY_KEY = 'studyos.video.quality';

export const VIDEO_QUALITY_OPTIONS = [
  { id: 'auto', labelEn: 'Auto (Recommended)', labelAr: 'تلقائي (موصى به)' },
  { id: 'hd1080', labelEn: '1080p Full HD', labelAr: '1080p دقة فائقة' },
  { id: 'hd720', labelEn: '720p HD', labelAr: '720p دقة عالية' },
  { id: 'large', labelEn: '480p Standard', labelAr: '480p جودة قياسية' },
  { id: 'medium', labelEn: '360p Medium', labelAr: '360p متوسطة' },
  { id: 'small', labelEn: '240p Data Saver', labelAr: '240p موفر للبيانات' },
  { id: 'tiny', labelEn: '144p Minimum', labelAr: '144p جودة منخفضة' }
];

export function loadDefaultVideoQuality() {
  try {
    return localStorage.getItem(VIDEO_QUALITY_KEY) || 'large'; // Default to 480p Standard
  } catch {
    return 'large';
  }
}

export function saveDefaultVideoQuality(quality) {
  try {
    localStorage.setItem(VIDEO_QUALITY_KEY, quality || 'large');
    window.dispatchEvent(new CustomEvent('studyos:video-quality-changed', { detail: { quality } }));
  } catch {}
}
