// src/lib/communityStore.js — Open Community Shares Catalog & Import Engine for Makeen
// Allows learners to discover, share, and import study playlists, PDFs, flashcard decks, and notes with 1-click.

import { upsertDocument, listDocuments, upsertPlaylist, listPlaylists } from './library.js';
import { putCard } from './storage.js';
import { createNote } from './markdownStore.js';

const COMMUNITY_STORAGE_KEY = 'makeen.community.user_shares';
const VIEWS_STORAGE_KEY = 'makeen.community.views';

export const SEED_COMMUNITY_SHARES = [
  {
    id: 'comm-pl-1',
    type: 'playlist',
    title: 'أساسيات علوم الحاسب وهندسة البرمجيات',
    titleEn: 'Computer Science & Software Architecture',
    author: 'أ. مروان الشامي',
    authorEn: 'Eng. Marwan',
    category: 'tech',
    visits: 3420,
    rating: 4.9,
    itemsCount: 12,
    description: 'مسار دراسي شامل يغطي مفاهيم الخوارزميات، هياكل البيانات، وهندسة البرمجيات للمبتدئين والمتقدمين مع ملاحظات عملية.',
    descriptionEn: 'Comprehensive study path covering algorithms, data structures, and software engineering.',
    badge: 'الأكثر شعبية',
    playlistData: {
      title: 'أساسيات علوم الحاسب',
      videoUrls: [
        'https://www.youtube.com/watch?v=zOjov-2OZ0E',
        'https://www.youtube.com/watch?v=RBSGKlAvoiM',
        'https://www.youtube.com/watch?v=0I647GU3Jsc'
      ]
    }
  },
  {
    id: 'comm-cards-1',
    type: 'cards',
    title: 'أهم 500 كلمة في اللغة الإنجليزية للمحادثة الأكاديمية',
    titleEn: 'Top 500 Academic & Conversational English Words',
    author: 'د. ليلى فهمي',
    authorEn: 'Dr. Laila Fahmy',
    category: 'languages',
    visits: 2890,
    rating: 4.8,
    itemsCount: 50,
    description: 'حزمة بطاقات استذكار تكرار متباعد (Spaced Repetition) لأهم المفردات الإنجليزية مع أمثلة وسياق واقعي.',
    descriptionEn: 'Spaced repetition flashcard deck for essential vocabulary with real contextual sentences.',
    badge: 'تقييم ممتاز',
    cardsData: [
      { front: 'Acquire', back: 'يكتسب / يحصل على — e.g. Students acquire language through immersive listening.' },
      { front: 'Consistent', back: 'متناسق / مستمر بثبات — e.g. Consistent study produces lasting mastery.' },
      { front: 'Analyze', back: 'يحلل — e.g. The researcher analyzed the data thoroughly.' },
      { front: 'Facilitate', back: 'يسهل / ييسر — e.g. Good tools facilitate focused learning.' },
      { front: 'Comprehensive', back: 'شامل ومستوفٍ — e.g. Makeen offers a comprehensive study workspace.' }
    ]
  },
  {
    id: 'comm-pl-2',
    type: 'playlist',
    title: 'سلسلة تدبر القرآن الكريم وتطوير الروح',
    titleEn: 'Quranic Reflections & Spiritual Growth',
    author: 'د. أحمد خليل',
    authorEn: 'Dr. Ahmed Khalil',
    category: 'islamic',
    visits: 4120,
    rating: 5.0,
    itemsCount: 15,
    description: 'وقفات تدبرية هادئة لبناء البصيرة وهدوء النفس، صالحة للاستماع في الخلفية أثناء التنقل أو الدراسة.',
    descriptionEn: 'Reflective series on Quranic wisdom and spiritual tranquility, optimized for background listening.',
    badge: 'موصى به',
    playlistData: {
      title: 'تدبر القرآن الكريم',
      videoUrls: [
        'https://www.youtube.com/watch?v=kJQP7kiw5Fk',
        'https://www.youtube.com/watch?v=fJ9rUzIMcZQ'
      ]
    }
  },
  {
    id: 'comm-pdf-1',
    type: 'pdf',
    title: 'دليل الطالب الذكي: تقنيات الاستذكار الفعال وإدارة الوقت',
    titleEn: 'Smart Student Guide: Active Recall & Time Management',
    author: 'فريق مَكِين التعليمي',
    authorEn: 'Makeen Education Team',
    category: 'study',
    visits: 1980,
    rating: 4.7,
    itemsCount: 32,
    description: 'ملخص كتاب ودليل عملي يشرح تقنية فاينمان، نظام بومودورو، وكيفية تنظيم اليوم لتحقيق أعلى تركيز.',
    descriptionEn: 'Practical summary explaining the Feynman technique, Pomodoro system, and day planning.',
    badge: 'دليل عملي',
    pdfUrl: 'https://raw.githubusercontent.com/mozilla/pdf.js/master/examples/learning/helloworld.pdf'
  },
  {
    id: 'comm-notes-1',
    type: 'notes',
    title: 'ملخص كتاب العادات الذرية (Atomic Habits) مع خطة تطبيق',
    titleEn: 'Atomic Habits Master Summary & Action Plan',
    author: 'م. عمر السعيد',
    authorEn: 'Omar Al-Saeed',
    category: 'habits',
    visits: 3670,
    rating: 4.9,
    itemsCount: 1,
    description: 'خلاصة كاملة بصيغة ماركداون تتضمن القواعد الأربع لتكوين العادات وقوائم مراجعة يومية قابلة للتطبيق.',
    descriptionEn: 'Full markdown summary covering the 4 laws of behavior change with daily checklists.',
    badge: 'ملخص مميز',
    noteContent: `# ملخص كتاب العادات الذرية — جيمس كلير

> «أنت لا ترتقي إلى مستوى أهدافك، بل تهبط إلى مستوى أنظمتك.»

## القوانين الأربعة لتغيير السلوك:
1. **اجعلها واضحة (Make it Obvious):** صمم بيئتك بحيث تكون الإشارات المؤدية للعادة الإيجابية ظاهرة وسهلة.
2. **اجعلها جذابة (Make it Attractive):** اربط العادة بنشاط تحبه (Temptation Bundling).
3. **اجعلها سهلة (Make it Easy):** قلل من المقاومة واستخدم قاعدة الدقيقتين.
4. **اجعلها مشبعة (Make it Satisfying):** كافئ نفسك فور إتمام العادة وتتبع تقدمك يومياً.

---
*تم الاستيراد من مجتمع مَكِين المفتوح.*`
  }
];

export function listCommunityShares() {
  try {
    const raw = localStorage.getItem(COMMUNITY_STORAGE_KEY);
    const userShares = raw ? JSON.parse(raw) : [];
    const viewsMap = loadViewsMap();
    return [...userShares, ...SEED_COMMUNITY_SHARES].map((item) => ({
      ...item,
      visits: (item.visits || 0) + (viewsMap[item.id] || 0)
    }));
  } catch {
    return SEED_COMMUNITY_SHARES;
  }
}

export function publishCommunityShare(shareData) {
  const item = {
    id: `comm-user-${crypto.randomUUID()}`,
    type: shareData.type || 'playlist',
    title: shareData.title || 'مشاركة جديدة',
    author: shareData.author || 'عضو مَكِين',
    category: shareData.category || 'general',
    visits: 1,
    rating: 5.0,
    itemsCount: shareData.itemsCount || 1,
    description: shareData.description || '',
    badge: 'مشاركة جديدة',
    playlistData: shareData.playlistData || null,
    cardsData: shareData.cardsData || null,
    noteContent: shareData.noteContent || null,
    createdAt: Date.now()
  };
  try {
    const raw = localStorage.getItem(COMMUNITY_STORAGE_KEY);
    const existing = raw ? JSON.parse(raw) : [];
    existing.unshift(item);
    localStorage.setItem(COMMUNITY_STORAGE_KEY, JSON.stringify(existing));
  } catch {}
  return item;
}

function loadViewsMap() {
  try {
    const raw = localStorage.getItem(VIEWS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function recordShareVisit(shareId) {
  try {
    const map = loadViewsMap();
    map[shareId] = (map[shareId] || 0) + 1;
    localStorage.setItem(VIEWS_STORAGE_KEY, JSON.stringify(map));
  } catch {}
}

export async function importShareToMyLibrary(share, notify = null) {
  recordShareVisit(share.id);

  if (share.type === 'playlist') {
    const urls = share.playlistData?.videoUrls || [];
    const playlistId = `pl-${crypto.randomUUID()}`;
    const childVideoIds = [];

    for (const url of urls) {
      const vidMatch = url.match(/(?:v=|\/embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
      const ytId = vidMatch ? vidMatch[1] : '';
      const docId = `yt-video-${ytId || crypto.randomUUID()}`;
      upsertDocument({
        id: docId,
        kind: 'video',
        provider: 'youtube',
        ytType: 'video',
        ytId,
        title: `${share.title} — درس`,
        filename: url,
        url,
        embedUrl: ytId ? `https://www.youtube-nocookie.com/embed/${ytId}?rel=0&modestbranding=1` : url,
        size: 0,
        mime: 'text/html',
        missing: false,
        playlistId
      });
      childVideoIds.push(docId);
    }

    upsertPlaylist({
      id: playlistId,
      title: share.title,
      videoIds: childVideoIds
    });
    return { ok: true, type: 'playlist', count: childVideoIds.length };
  }

  if (share.type === 'cards') {
    const cards = share.cardsData || [];
    let count = 0;
    for (const c of cards) {
      await putCard({
        id: crypto.randomUUID(),
        front: c.front,
        back: c.back,
        source: share.title,
        tags: [share.title],
        due: new Date().toISOString().slice(0, 10),
        deck: share.title
      });
      count++;
    }
    return { ok: true, type: 'cards', count };
  }

  if (share.type === 'notes') {
    const note = createNote({
      title: share.title,
      content: share.noteContent || `# ${share.title}\n\n`
    });
    return { ok: true, type: 'notes', noteId: note.id };
  }

  if (share.type === 'pdf') {
    upsertDocument({
      id: `doc-${crypto.randomUUID()}`,
      kind: 'pdf',
      title: share.title,
      filename: `${share.title}.pdf`,
      url: share.pdfUrl || '',
      sizeBytes: 1024 * 500,
      dateAdded: Date.now()
    });
    return { ok: true, type: 'pdf' };
  }

  return { ok: false };
}
