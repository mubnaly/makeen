// Comprehensive StudyOS Study Statistics & User Profile Tracker.
// Records time spent reading, watching videos, reviewing cards, and overall mastery.

const STATS_KEY = 'studyos.study_stats';
const AVATAR_KEY = 'studyos.user_avatar';

export const LEARNER_AVATARS = [
  { id: 'grad', name: 'Scholar Graduate', icon: 'user', bg: '#4f46e5' },
  { id: 'bookworm', name: 'Diligent Reader', icon: 'reader', bg: '#059669' },
  { id: 'coder', name: 'Tech Learner', icon: 'projects', bg: '#0284c7' },
  { id: 'scientist', name: 'Researcher', icon: 'search', bg: '#7c3aed' },
  { id: 'artist', name: 'Creative Mind', icon: 'pencil', bg: '#db2777' },
  { id: 'explorer', name: 'Explorer', icon: 'globe', bg: '#d97706' },
  { id: 'champion', name: 'Top Achiever', icon: 'check-square', bg: '#ea580c' },
  { id: 'thinker', name: 'Deep Thinker', icon: 'flashcards', bg: '#10b981' }
];

export function loadUserAvatar() {
  if (typeof localStorage === 'undefined') return LEARNER_AVATARS[0];
  try {
    const raw = localStorage.getItem(AVATAR_KEY);
    if (!raw) return LEARNER_AVATARS[0];
    const parsed = JSON.parse(raw);
    return parsed;
  } catch {
    return LEARNER_AVATARS[0];
  }
}

export function saveUserAvatar(avatar) {
  if (typeof localStorage === 'undefined' || !avatar) return;
  try {
    localStorage.setItem(AVATAR_KEY, JSON.stringify(avatar));
  } catch {}
}

export function loadStudyStats() {
  if (typeof localStorage === 'undefined') {
    return { docs: {}, videos: {}, decks: {}, days: {} };
  }
  try {
    const raw = localStorage.getItem(STATS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed || { docs: {}, videos: {}, decks: {}, days: {} };
  } catch {
    return { docs: {}, videos: {}, decks: {}, days: {} };
  }
}

export function persistStudyStats(stats) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch {}
}

// Record active study time in seconds
export function recordStudyHeartbeat(kind, id, title, seconds = 5, extra = {}) {
  if (!id || seconds <= 0) return;
  const stats = loadStudyStats();
  const today = new Date().toISOString().slice(0, 10);

  // Daily aggregate
  stats.days[today] = stats.days[today] || { readingSec: 0, videoSec: 0, reviewSec: 0 };

  if (kind === 'video') {
    stats.videos[id] = stats.videos[id] || { id, title: title || 'Video', totalSec: 0, lastPlayed: 0 };
    stats.videos[id].totalSec += seconds;
    stats.videos[id].title = title || stats.videos[id].title;
    stats.videos[id].lastPlayed = Date.now();
    if (extra.duration) stats.videos[id].duration = extra.duration;
    if (extra.current) stats.videos[id].current = extra.current;
    stats.days[today].videoSec += seconds;
  } else if (kind === 'pdf') {
    stats.docs[id] = stats.docs[id] || { id, title: title || 'Document', totalSec: 0, pagesDone: 0, lastRead: 0 };
    stats.docs[id].totalSec += seconds;
    stats.docs[id].title = title || stats.docs[id].title;
    stats.docs[id].lastRead = Date.now();
    if (extra.page) {
      stats.docs[id].maxPage = Math.max(stats.docs[id].maxPage || 1, extra.page);
    }
    if (extra.numPages) stats.docs[id].numPages = extra.numPages;
    stats.days[today].readingSec += seconds;
  } else if (kind === 'deck') {
    stats.decks[id] = stats.decks[id] || { id, title: title || 'Deck', totalSec: 0, reviewsCount: 0, correctCount: 0 };
    stats.decks[id].totalSec += seconds;
    stats.days[today].reviewSec += seconds;
  }

  persistStudyStats(stats);
}

export function recordCardReview(deckId, isCorrect = true) {
  if (!deckId) return;
  const stats = loadStudyStats();
  stats.decks[deckId] = stats.decks[deckId] || { id: deckId, title: deckId, totalSec: 0, reviewsCount: 0, correctCount: 0 };
  stats.decks[deckId].reviewsCount = (stats.decks[deckId].reviewsCount || 0) + 1;
  if (isCorrect) stats.decks[deckId].correctCount = (stats.decks[deckId].correctCount || 0) + 1;
  persistStudyStats(stats);
}

export function computeStudySummary(stats = loadStudyStats(), docsList = [], videosList = []) {
  let totalVideoSec = 0;
  let totalReadingSec = 0;
  let totalReviewSec = 0;
  let totalPagesRead = 0;
  let totalCardsReviewed = 0;
  let totalCardsCorrect = 0;

  // Aggregate videos
  for (const vId in stats.videos) {
    totalVideoSec += stats.videos[vId].totalSec || 0;
  }
  // Aggregate docs
  for (const dId in stats.docs) {
    totalReadingSec += stats.docs[dId].totalSec || 0;
    totalPagesRead += stats.docs[dId].maxPage || 0;
  }
  // Aggregate decks
  for (const dkId in stats.decks) {
    totalReviewSec += stats.decks[dkId].totalSec || 0;
    totalCardsReviewed += stats.decks[dkId].reviewsCount || 0;
    totalCardsCorrect += stats.decks[dkId].correctCount || 0;
  }

  const totalStudySec = totalVideoSec + totalReadingSec + totalReviewSec;
  const cardRetentionRate = totalCardsReviewed > 0 ? Math.round((totalCardsCorrect / totalCardsReviewed) * 100) : 100;

  // Calculate Overall Study Rating (0 - 100 score & 5-star metric)
  let score = 50;
  if (totalStudySec > 3600) score += 20;
  else if (totalStudySec > 900) score += 10;
  if (totalPagesRead > 10) score += 15;
  if (totalCardsReviewed > 10) score += 15;
  score = Math.min(100, Math.max(0, score));

  const stars = Math.min(5, Math.max(1, Math.round(score / 20)));

  return {
    totalStudySec,
    totalStudyMinutes: Math.round(totalStudySec / 60),
    totalStudyHours: +(totalStudySec / 3600).toFixed(1),
    totalVideoSec,
    totalVideoMinutes: Math.round(totalVideoSec / 60),
    totalVideoHours: +(totalVideoSec / 3600).toFixed(1),
    totalReadingSec,
    totalReadingMinutes: Math.round(totalReadingSec / 60),
    totalReadingHours: +(totalReadingSec / 3600).toFixed(1),
    totalPagesRead,
    totalCardsReviewed,
    cardRetentionRate,
    studyScore: score,
    studyStars: stars,
    ratingLabel: score >= 90 ? 'ممتاز جداً (Elite Scholar)' : score >= 75 ? 'متفوق (High Achiever)' : score >= 50 ? 'جيد جداً (Steady Learner)' : 'في البداية (Getting Started)'
  };
}
