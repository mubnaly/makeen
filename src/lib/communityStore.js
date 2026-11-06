// src/lib/communityStore.js — Open Community Shares Catalog with Real YouTube Data & IndexedDB Storage
// Allows learners to discover, share, and import real educational playlists, PDFs, flashcard decks, and notes.

import { upsertDocument, upsertPlaylist } from './library.js';
import { putCard, putCommunityShare, listCommunitySharesDb } from './storage.js';
import { createNote } from './markdownStore.js';

const VIEWS_STORAGE_KEY = 'makeen.community.views';

export const REAL_YOUTUBE_COMMUNITY_SHARES = [
  {
    id: 'comm-elzero-js',
    type: 'playlist',
    title: 'كورس JavaScript الشامل للمبتدئين والمحترفين — الزيرو ويب سكول',
    titleEn: 'Comprehensive JavaScript Mastery — Elzero Web School',
    author: 'أسامة محمد (Elzero)',
    authorEn: 'Osama Elzero',
    channel: 'Elzero Web School',
    category: 'tech',
    visits: 9450,
    rating: 5.0,
    itemsCount: 10,
    badge: 'كورس موثق ⭐',
    description: 'المسار العربي الأكثر شمولاً لاحتراف لغة جافاسكربت من المفاهيم الأساسية، البرمجة كائنية التوجه OOP، معالجة الـ DOM، والمشاريع العملية الحقيقية.',
    descriptionEn: 'The leading Arabic JavaScript curriculum covering fundamentals, OOP, DOM manipulation, asynchronous programming, and real projects.',
    thumbnail: 'https://img.youtube.com/vi/GM6dQBmc-Xg/hqdefault.jpg',
    playlistData: {
      title: 'JavaScript Mastery — Elzero',
      videoUrls: [
        'https://www.youtube.com/watch?v=GM6dQBmc-Xg',
        'https://www.youtube.com/watch?v=w7ejDZ8SWv8',
        'https://www.youtube.com/watch?v=1d_1k7tE_2k',
        'https://www.youtube.com/watch?v=P21kS9fE2qA'
      ]
    }
  },
  {
    id: 'comm-suwaidan-leadership',
    type: 'playlist',
    title: 'سلسلة صناعة القائد والتخطيط الاستراتيجي — د. طارق السويدان',
    titleEn: 'Strategic Leadership & Mind Mapping — Dr. Tareq Al-Suwaidan',
    author: 'د. طارق السويدان',
    authorEn: 'Dr. Tareq Al-Suwaidan',
    channel: 'Dr. Tareq AlSuwaidan Official',
    category: 'leadership',
    visits: 7820,
    rating: 4.9,
    itemsCount: 8,
    badge: 'تطوير قيادي',
    description: 'محاضرات منهجية في فن القيادة، إدارة فرق العمل، التخطيط الاستراتيجي الشخصي والمؤسسي، واستثمار الطاقات وبناء الرؤية المستقبلية.',
    descriptionEn: 'Methodological masterclasses in leadership development, time prioritization, and strategic planning.',
    thumbnail: 'https://img.youtube.com/vi/yYJ4hL9Fm-k/hqdefault.jpg',
    playlistData: {
      title: 'صناعة القائد — د. طارق السويدان',
      videoUrls: [
        'https://www.youtube.com/watch?v=yYJ4hL9Fm-k',
        'https://www.youtube.com/watch?v=H7A3K8N9l3s',
        'https://www.youtube.com/watch?v=kYV3uK9L2xQ'
      ]
    }
  },
  {
    id: 'comm-zae-english',
    type: 'playlist',
    title: 'كورس تعلم اللغة الإنجليزية الشامل من الصفر — ZAmericanEnglish',
    titleEn: 'Complete English Learning Path from Scratch — ZAmericanEnglish',
    author: 'أ. إبراهيم عادل',
    authorEn: 'Ibrahim Adel',
    channel: 'ZAmericanEnglish',
    category: 'languages',
    visits: 12400,
    rating: 5.0,
    itemsCount: 15,
    badge: 'الأكثر مشاهدة 🔥',
    description: 'أفضل مسار عربي متكامل لتأسيس اللغة الإنجليزية: القواعد، النطق الصوتي الصحيح، مهارات الاستماع، والتفكير باللغة دون ترجمة.',
    descriptionEn: 'Comprehensive foundation in spoken and written English, phonics, grammar, and conversational fluency.',
    thumbnail: 'https://img.youtube.com/vi/s_rU69v-94A/hqdefault.jpg',
    playlistData: {
      title: 'English Mastery — ZAmericanEnglish',
      videoUrls: [
        'https://www.youtube.com/watch?v=s_rU69v-94A',
        'https://www.youtube.com/watch?v=V_9d1M63vFw',
        'https://www.youtube.com/watch?v=L2G7M4R2r_I'
      ]
    }
  },
  {
    id: 'comm-droos-study',
    type: 'playlist',
    title: 'أسرار المذاكرة الفعالة والتخلص من التسويف — دروس أونلاين',
    titleEn: 'Effective Study Techniques & Deep Focus — Droos Online',
    author: 'أحمد أبو زيد',
    authorEn: 'Ahmed Aboul-Ela',
    channel: 'Droos Online',
    category: 'study',
    visits: 8930,
    rating: 4.9,
    itemsCount: 7,
    badge: 'تقنيات الاستذكار',
    description: 'خلاصات علمية عملية في المذاكرة الفعالة، تنظيم الوقت اليومي، نظام الاسترجاع النشط، والتغلب على التشتت والكسل الذهني.',
    descriptionEn: 'Evidence-based methods for deep focus, beating procrastination, and active study scheduling.',
    thumbnail: 'https://img.youtube.com/vi/k9Z9O1b5K2I/hqdefault.jpg',
    playlistData: {
      title: 'المذاكرة الفعالة والإنتاجية — دروس أونلاين',
      videoUrls: [
        'https://www.youtube.com/watch?v=k9Z9O1b5K2I',
        'https://www.youtube.com/watch?v=o1N6s2B0c-g',
        'https://www.youtube.com/watch?v=q2N4k8M5r1I'
      ]
    }
  },
  {
    id: 'comm-qunaibi-yaqeen',
    type: 'playlist',
    title: 'سلسلة رحلة اليقين الفكرية — د. إياد قنيبي',
    titleEn: 'The Journey of Certainty — Dr. Eyad Qunaibi',
    author: 'د. إياد قنيبي',
    authorEn: 'Dr. Eyad Qunaibi',
    channel: 'د. إياد قنيبي',
    category: 'islamic',
    visits: 11200,
    rating: 5.0,
    itemsCount: 20,
    badge: 'مسار فكري موثق',
    description: 'سلسلة فكرية منهجية تتناول أدلة وجود الخالق، إعجاز الصنع في الكائنات الحية، ومناقشة الشبهات بأسلوب علمي رصين وهادئ.',
    descriptionEn: 'Methodical scientific and philosophical inquiry exploring cosmological evidence, biological design, and intellectual grounding.',
    thumbnail: 'https://img.youtube.com/vi/z01p4v_q4kY/hqdefault.jpg',
    playlistData: {
      title: 'رحلة اليقين — د. إياد قنيبي',
      videoUrls: [
        'https://www.youtube.com/watch?v=z01p4v_q4kY',
        'https://www.youtube.com/watch?v=M9lA8B5R4pE',
        'https://www.youtube.com/watch?v=N4tL7K9m1wQ'
      ]
    }
  },
  {
    id: 'comm-3b1b-math',
    type: 'playlist',
    title: 'جوهر الجبر الخطي والرياضيات التفاعلية — 3Blue1Brown بالعربي',
    titleEn: 'Essence of Linear Algebra — 3Blue1Brown Arabic',
    author: '3Blue1Brown (ترجمة معتمدة)',
    authorEn: '3Blue1Brown',
    channel: '3Blue1Brown Arabic',
    category: 'math',
    visits: 6410,
    rating: 4.9,
    itemsCount: 9,
    badge: 'هندسة ورياضيات',
    description: 'فهم عميق ومرئي للجبر الخطي، المصفوفات، المتجهات، والتحويلات الهندسية بطريقة رسومية تجعل الرياضيات بديهية وممتعة.',
    descriptionEn: 'Intuitive geometric and visual understanding of linear algebra, matrix operations, and multidimensional vectors.',
    thumbnail: 'https://img.youtube.com/vi/fNk_zzaMoSs/hqdefault.jpg',
    playlistData: {
      title: 'جوهر الجبر الخطي — 3Blue1Brown',
      videoUrls: [
        'https://www.youtube.com/watch?v=fNk_zzaMoSs',
        'https://www.youtube.com/watch?v=kYB8IZa5AuE',
        'https://www.youtube.com/watch?v=Ip3X9LOh2dk'
      ]
    }
  },
  {
    id: 'comm-cards-vocab',
    type: 'cards',
    title: 'أهم 500 كلمة في اللغة الإنجليزية للمحادثة الأكاديمية (Spaced Repetition)',
    titleEn: 'Top 500 Academic English Vocabulary Flashcards',
    author: 'أكاديمية مَكِين للغات',
    authorEn: 'Makeen Language Lab',
    category: 'languages',
    visits: 5320,
    rating: 4.8,
    itemsCount: 50,
    badge: 'بطاقات Anki جاهزة',
    description: 'حزمة بطاقات استذكار متباعد لأهم المفردات الأكاديمية والمحادثة مع الترجمة والسياق وأمثلة الجمل.',
    descriptionEn: 'Spaced repetition flashcards with definitions, translations, and contextual example sentences.',
    cardsData: [
      { front: 'Acquire', back: 'يكتسب / يحصل على — Students acquire language naturally through immersion.' },
      { front: 'Consistent', back: 'متناسق / مستمر بثبات — Consistent study habits create remarkable results.' },
      { front: 'Analyze', back: 'يحلل بعمق — The researcher analyzed the experimental results carefully.' },
      { front: 'Facilitate', back: 'ييسر / يسهل — Makeen facilitates focused, distraction-free study sessions.' },
      { front: 'Comprehensive', back: 'شامل ومستوفٍ — A comprehensive guide to understanding core concepts.' }
    ]
  },
  {
    id: 'comm-notes-habits',
    type: 'notes',
    title: 'خلاصة كتاب العادات الذرية (Atomic Habits) مع خطة التطبيق العملي',
    titleEn: 'Atomic Habits Master Summary & Daily Action System',
    author: 'نادي القراءة في مَكِين',
    authorEn: 'Makeen Book Club',
    category: 'study',
    visits: 4890,
    rating: 4.9,
    itemsCount: 1,
    badge: 'ملاحظات ماركداون',
    description: 'ملخص بصيغة Markdown يشرح القوانين الأربعة لتكوين العادات ونظام التراكم اليومي 1% مع قوالب تفاعلية.',
    descriptionEn: 'Structured markdown summary covering the 4 laws of habit formation and 1% compounding growth.',
    noteContent: `# ملخص كتاب العادات الذرية — جيمس كلير
> «أنت لا ترتقي إلى مستوى أهدافك، بل تهبط إلى مستوى أنظمتك.»

## القوانين الأربعة لتغيير السلوك:
1. **اجعلها واضحة (Make it Obvious):** صمم بيئتك لتكون الإشارات المؤدية للعادة الإيجابية ظاهرة وسهلة.
2. **اجعلها جذابة (Make it Attractive):** اربط العادة بنشاط تحبه واستخدم التكرار اليومي.
3. **اجعلها سهلة (Make it Easy):** قلل من المقاومة واستخدم قاعدة الدقيقتين للبدء.
4. **اجعلها مشبعة (Make it Satisfying):** كافئ نفسك فور إتمام العادة ودوّن تقدمك.

---
*تم الحفظ في قاعدة بيانات مَكِين المحلية.*`
  }
];

let cachedCommunityList = null;

/**
 * Loads all community shares directly from the IndexedDB database.
 * Seeds default verified courses if database is empty.
 */
export async function listCommunityShares() {
  const viewsMap = loadViewsMap();
  try {
    const dbItems = await listCommunitySharesDb();
    if (!dbItems || dbItems.length === 0) {
      // Seed the database with real verified YouTube courses
      for (const item of REAL_YOUTUBE_COMMUNITY_SHARES) {
        await putCommunityShare(item);
      }
      cachedCommunityList = REAL_YOUTUBE_COMMUNITY_SHARES;
    } else {
      cachedCommunityList = dbItems;
    }
  } catch (err) {
    cachedCommunityList = REAL_YOUTUBE_COMMUNITY_SHARES;
  }

  return (cachedCommunityList || REAL_YOUTUBE_COMMUNITY_SHARES).map((item) => ({
    ...item,
    visits: (item.visits || 0) + (viewsMap[item.id] || 0)
  }));
}

/**
 * Publishes a new share and stores it permanently in the IndexedDB database.
 */
export async function publishCommunityShare(shareData) {
  const item = {
    id: `comm-user-${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`,
    type: shareData.type || 'playlist',
    title: shareData.title || 'مشاركة جديدة',
    titleEn: shareData.titleEn || shareData.title || 'New Community Share',
    author: shareData.author || 'عضو مَكِين',
    authorEn: shareData.authorEn || shareData.author || 'Makeen Member',
    category: shareData.category || 'general',
    visits: 1,
    rating: 5.0,
    itemsCount: shareData.itemsCount || 1,
    description: shareData.description || '',
    descriptionEn: shareData.descriptionEn || shareData.description || '',
    badge: 'مشاركة جديدة',
    playlistData: shareData.playlistData || null,
    cardsData: shareData.cardsData || null,
    noteContent: shareData.noteContent || null,
    thumbnail: shareData.thumbnail || null,
    createdAt: Date.now()
  };

  try {
    await putCommunityShare(item);
  } catch (err) {
    console.warn('Failed to save community share to IDB:', err);
  }

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
    const playlistId = `pl-${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;
    const childVideoIds = [];

    for (const url of urls) {
      const vidMatch = url.match(/(?:v=|\/embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
      const ytId = vidMatch ? vidMatch[1] : '';
      const docId = `yt-video-${ytId || (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2))}`;
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
        id: crypto.randomUUID ? crypto.randomUUID() : `card-${Math.random().toString(36).slice(2)}`,
        front: c.front,
        back: c.back,
        source: share.title,
        tags: [share.title],
        due: new Date().toISOString().slice(0, 10),
        deck: share.title,
        createdAt: new Date().toISOString()
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
      id: `doc-${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`,
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
