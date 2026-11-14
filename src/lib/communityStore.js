// src/lib/communityStore.js — Makeen Community Store with Real Database, Content Gating & Monetization
// Community content is browsable by all learners, with free preview vs paid access, and peer review options.

import { upsertDocument, upsertPlaylist } from './library.js';
import { putCard, putCommunityShare, listCommunitySharesDb, deleteCommunityShareDb } from './storage.js';
import { createNote } from './markdownStore.js';
import { getCurrentUser } from './auth.js';
import { isContentUnlocked, unlockContentForUser } from './sessionStore.js';
import { upsertProject } from './projects.js';
import {
  apiFetchCommunityShares,
  apiPublishCommunityShare,
  apiUpdateCommunityShare,
  apiDeleteCommunityShare,
  apiRecordShareVisit
} from './api.js';

export function normalizeTags(tags) {
  if (Array.isArray(tags)) {
    return tags.map((t) => String(t).trim().replace(/^#+/, '')).filter(Boolean);
  }
  if (typeof tags === 'string') {
    return tags
      .split(/[,،\s]+/)
      .map((t) => t.trim().replace(/^#+/, ''))
      .filter(Boolean);
  }
  return [];
}

const IMPORTED_SHARES_KEY = 'studyos.community.imported_shares';

export function getImportedShareIds() {
  try {
    const raw = localStorage.getItem(IMPORTED_SHARES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function isShareImported(shareId) {
  if (!shareId) return false;
  const list = getImportedShareIds();
  return list.includes(shareId);
}

export function recordShareImported(shareId) {
  if (!shareId) return;
  try {
    const list = getImportedShareIds();
    if (!list.includes(shareId)) {
      list.push(shareId);
      localStorage.setItem(IMPORTED_SHARES_KEY, JSON.stringify(list));
    }
  } catch {}
}

export function formatTotalDuration(seconds, lang = 'ar') {
  const sec = Number(seconds) || 0;
  if (sec <= 0) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (lang === 'en') {
    if (h > 0) return `${h} hr${h > 1 ? 's' : ''}${m > 0 ? ' ' + m + ' min' : ''}`;
    if (m > 0) return `${m} min`;
    return `${s} sec`;
  }
  if (h > 0) return `${h} س${m > 0 ? ' ' + m + ' د' : ''}`;
  if (m > 0) return `${m} دقيقة`;
  return `${s} ثانية`;
}

export function computeShareTotalDuration(share) {
  if (!share) return 0;
  let total = 0;
  if (Array.isArray(share.items)) {
    for (const it of share.items) {
      total += Number(it.duration || it.durationSeconds || it.lengthSeconds || 0);
    }
  }
  if (Array.isArray(share.pathCourses)) {
    for (const c of share.pathCourses) {
      const cDur = Number(c.durationSeconds || c.totalDurationSeconds || c.duration || 0);
      if (cDur > 0) {
        total += cDur;
      } else if (Array.isArray(c.videos)) {
        for (const v of c.videos) {
          total += Number(v.duration || v.durationSeconds || v.lengthSeconds || 0);
        }
      } else if (Array.isArray(c.items)) {
        for (const it of c.items) {
          total += Number(it.duration || it.durationSeconds || it.lengthSeconds || 0);
        }
      }
    }
  }
  if (total <= 0 && share.totalDurationSeconds && Number(share.totalDurationSeconds) > 0) {
    return Number(share.totalDurationSeconds);
  }
  // Smart fallback estimate if durations were not yet indexed (~25 min per lesson/video)
  if (total <= 0) {
    const videoCount = (share.items?.length || share.itemsCount || share.playlistData?.videoUrls?.length || 0);
    if (videoCount > 0) {
      return videoCount * 25 * 60;
    }
    const pathCoursesCount = (share.pathCourses?.length || 0);
    if (pathCoursesCount > 0) {
      return pathCoursesCount * 8 * 25 * 60;
    }
  }
  return total;
}

export async function listUserCommunityShares(userId, authorName) {
  const all = await listCommunityShares();
  const user = getCurrentUser();
  return all.filter((s) => {
    if (isShareOwner(s, user)) return true;
    if (s.isLocal) return true;
    if (userId && s.creatorId && String(s.creatorId) === String(userId)) return true;
    if (authorName && s.author && String(s.author).toLowerCase() === String(authorName).toLowerCase()) return true;
    return false;
  });
}

const VIEWS_STORAGE_KEY = 'makeen.community.views';
const WIPED_INITIAL_KEY = 'makeen.community.wiped_v2';

/**
 * Checks if old mock data has been wiped. If not, cleans the database once.
 */
export async function ensureFreshCommunityData() {
  // Safe no-op: never wipe user-created community shares
  return;
}

export async function updateCommunityShare(shareId, updatedData) {
  const existingList = await listCommunitySharesDb();
  const existing = existingList.find((s) => s.id === shareId);
  if (!existing) return null;

  const user = getCurrentUser();
  const isAnonymous = updatedData.isAnonymous !== undefined ? Boolean(updatedData.isAnonymous) : existing.isAnonymous;
  const authorName = isAnonymous
    ? 'مشارك مجهول (Anonymous)'
    : (updatedData.author || user?.name || user?.username || existing.author || 'طالب مَكِين');

  const authorAvatar = isAnonymous ? '' : (user?.avatar || existing.authorAvatar || '');
  const isPaid = updatedData.isPaid !== undefined ? Boolean(updatedData.isPaid) : existing.isPaid;
  const price = isPaid ? Math.max(0, Math.round(Number(updatedData.price ?? existing.price) * 100) / 100) : 0;
  const tags = updatedData.tags !== undefined ? normalizeTags(updatedData.tags) : (existing.tags || []);
  const isPrivate = updatedData.isPrivate !== undefined ? Boolean(updatedData.isPrivate) : Boolean(existing.isPrivate);
  const teacher = updatedData.teacher !== undefined ? String(updatedData.teacher || '').trim() : (existing.teacher || '');

  const merged = {
    ...existing,
    ...updatedData,
    id: shareId,
    author: authorName,
    authorAvatar,
    teacher,
    isAnonymous,
    isPaid,
    price,
    tags,
    isPrivate,
    items: Array.isArray(updatedData.items) ? updatedData.items : existing.items,
    updatedAt: Date.now()
  };

  try {
    await apiUpdateCommunityShare(shareId, merged);
  } catch {}
  await putCommunityShare(merged);
  return merged;
}

export async function deleteCommunityShare(shareId) {
  try {
    await apiDeleteCommunityShare(shareId);
  } catch {}
  await deleteCommunityShareDb(shareId);
  return true;
}

export const REAL_YOUTUBE_COMMUNITY_SHARES = [
  {
    id: 'comm-elzero-js',
    type: 'playlist',
    title: 'كورس JavaScript الشامل للمبتدئين والمحترفين — الزيرو ويب سكول',
    titleEn: 'Comprehensive JavaScript Mastery — Elzero Web School',
    author: 'أسامة محمد (Elzero)',
    authorEn: 'Osama Elzero',
    teacher: 'أسامة محمد',
    channel: 'Elzero Web School',
    category: 'tech',
    tags: ['javascript', 'web', 'frontend', 'برمجة', 'جافاسكربت'],
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
    },
    items: [
      { title: 'مقدمة في لغة جافاسكربت وبيئة العمل', url: 'https://www.youtube.com/watch?v=GM6dQBmc-Xg', isFreePreview: true },
      { title: 'المتغيرات وأنواع البيانات Data Types', url: 'https://www.youtube.com/watch?v=w7ejDZ8SWv8', isFreePreview: true },
      { title: 'الشروط والعمليات المنطقية Conditions', url: 'https://www.youtube.com/watch?v=1d_1k7tE_2k', isFreePreview: true },
      { title: 'الدوال Functions ومجال المتغيرات Scope', url: 'https://www.youtube.com/watch?v=P21kS9fE2qA', isFreePreview: true }
    ]
  },
  {
    id: 'comm-suwaidan-leadership',
    type: 'playlist',
    title: 'سلسلة صناعة القائد والتخطيط الاستراتيجي — د. طارق السويدان',
    titleEn: 'Strategic Leadership & Mind Mapping — Dr. Tareq Al-Suwaidan',
    author: 'د. طارق السويدان',
    authorEn: 'Dr. Tareq Al-Suwaidan',
    teacher: 'د. طارق السويدان',
    channel: 'Dr. Tareq AlSuwaidan Official',
    category: 'leadership',
    tags: ['leadership', 'قيادة', 'تخطيط', 'إدارة'],
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
    },
    items: [
      { title: 'مفهوم القيادة وأركان صناعة القائد', url: 'https://www.youtube.com/watch?v=yYJ4hL9Fm-k', isFreePreview: true },
      { title: 'كيف تضع خطتك الاستراتيجية الشخصية', url: 'https://www.youtube.com/watch?v=H7A3K8N9l3s', isFreePreview: true },
      { title: 'إدارة الأولويات واتخاذ القرارات الصعبة', url: 'https://www.youtube.com/watch?v=kYV3uK9L2xQ', isFreePreview: true }
    ]
  },
  {
    id: 'comm-zae-english',
    type: 'playlist',
    title: 'كورس تعلم اللغة الإنجليزية الشامل من الصفر — ZAmericanEnglish',
    titleEn: 'Complete English Learning Path from Scratch — ZAmericanEnglish',
    author: 'أ. إبراهيم عادل',
    authorEn: 'Ibrahim Adel',
    teacher: 'إبراهيم عادل',
    channel: 'ZAmericanEnglish',
    category: 'languages',
    tags: ['english', 'لغات', 'إنجليزي', 'محادثة'],
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
    },
    items: [
      { title: 'أساسيات التحدث والنطق الصحيح بالإنجليزية', url: 'https://www.youtube.com/watch?v=s_rU69v-94A', isFreePreview: true },
      { title: 'قواعد الأزمنة الإنجليزية بطريقة الفهم لا الحفظ', url: 'https://www.youtube.com/watch?v=V_9d1M63vFw', isFreePreview: true },
      { title: 'تطوير الاستماع والمحادثة اليومية', url: 'https://www.youtube.com/watch?v=L2G7M4R2r_I', isFreePreview: true }
    ]
  },
  {
    id: 'comm-droos-study',
    type: 'playlist',
    title: 'أسرار المذاكرة الفعالة والتخلص من التسويف — دروس أونلاين',
    titleEn: 'Effective Study Techniques & Deep Focus — Droos Online',
    author: 'أحمد أبو زيد',
    authorEn: 'Ahmed Aboul-Ela',
    teacher: 'أحمد أبو زيد',
    channel: 'Droos Online',
    category: 'study',
    tags: ['study', 'مذاكرة', 'تركيز', 'تنظيم الوقت'],
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
    },
    items: [
      { title: 'كيف تذاكر بذكاء وليس بجهد أكبر؟', url: 'https://www.youtube.com/watch?v=k9Z9O1b5K2I', isFreePreview: true },
      { title: 'التخلص النهائي من المماطلة والتسويف الدراسي', url: 'https://www.youtube.com/watch?v=o1N6s2B0c-g', isFreePreview: true },
      { title: 'تقنية الاسترجاع النشط والتكرار المتباعد', url: 'https://www.youtube.com/watch?v=q2N4k8M5r1I', isFreePreview: true }
    ]
  },
  {
    id: 'comm-qunaibi-yaqeen',
    type: 'playlist',
    title: 'سلسلة رحلة اليقين الفكرية — د. إياد قنيبي',
    titleEn: 'The Journey of Certainty — Dr. Eyad Qunaibi',
    author: 'د. إياد قنيبي',
    authorEn: 'Dr. Eyad Qunaibi',
    teacher: 'د. إياد قنيبي',
    channel: 'د. إياد قنيبي',
    category: 'islamic',
    tags: ['فكر', 'يقين', 'علوم', 'إيمان'],
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
    },
    items: [
      { title: 'مدخل إلى رحلة اليقين والمنهج العلمي', url: 'https://www.youtube.com/watch?v=z01p4v_q4kY', isFreePreview: true },
      { title: 'أدلة التصميم والإتقان في الكون والكائنات', url: 'https://www.youtube.com/watch?v=M9lA8B5R4pE', isFreePreview: true },
      { title: 'العلم الطبيعي ومحاكمة النظريات المادية', url: 'https://www.youtube.com/watch?v=N4tL7K9m1wQ', isFreePreview: true }
    ]
  },
  {
    id: 'comm-3b1b-math',
    type: 'playlist',
    title: 'جوهر الجبر الخطي والرياضيات التفاعلية — 3Blue1Brown بالعربي',
    titleEn: 'Essence of Linear Algebra — 3Blue1Brown Arabic',
    author: '3Blue1Brown (ترجمة معتمدة)',
    authorEn: '3Blue1Brown',
    teacher: 'Grant Sanderson',
    channel: '3Blue1Brown Arabic',
    category: 'math',
    tags: ['math', 'رياضيات', 'جبر خطي', 'هندسة'],
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
    },
    items: [
      { title: 'المتجهات: الرؤية الهندسية مقابل الجبرية', url: 'https://www.youtube.com/watch?v=fNk_zzaMoSs', isFreePreview: true },
      { title: 'التحويلات الخطية والمصفوفات Linear Transformations', url: 'https://www.youtube.com/watch?v=kYB8IZa5AuE', isFreePreview: true },
      { title: 'المحددات Determinants والمساحات الفضائية', url: 'https://www.youtube.com/watch?v=Ip3X9LOh2dk', isFreePreview: true }
    ]
  },
  {
    id: 'comm-cards-vocab',
    type: 'cards',
    title: 'أهم 500 كلمة في اللغة الإنجليزية للمحادثة الأكاديمية (Spaced Repetition)',
    titleEn: 'Top 500 Academic English Vocabulary Flashcards',
    author: 'أكاديمية مَكِين للغات',
    authorEn: 'Makeen Language Lab',
    category: 'languages',
    tags: ['anki', 'vocabulary', 'بطاقات', 'إنجليزي'],
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
    tags: ['عادات', 'إنتاجية', 'ملخص', 'كتب'],
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
4. **اجعلها مشبعة (Make it Satisfying):** كافئ نفسك فور إتمام العادة ودوّن تقدمك.`
  }
];

export function isShareOwner(share, user) {
  if (!share) return false;
  // Any share authored or stored in this device's local database belongs to this device's user
  if (share.isLocal) return true;
  if (user) {
    if (share.creatorId && user.id && String(share.creatorId) === String(user.id)) return true;
    if (share.author && user.name && String(share.author).toLowerCase() === String(user.name).toLowerCase()) return true;
    if (share.author && user.username && String(share.author).toLowerCase() === String(user.username).toLowerCase()) return true;
  }
  return false;
}

/**
 * Lists community items sorted and loaded from PostgreSQL backend, IndexedDB, or curated catalog.
 */
export async function listCommunityShares() {
  const user = getCurrentUser();
  let remote = [];
  try {
    const res = await apiFetchCommunityShares();
    if (Array.isArray(res)) remote = res;
  } catch {}

  const dbShares = await listCommunitySharesDb();
  const viewsMap = loadViewsMap();

  const map = new Map();
  // 1. Built-in verified courses catalog (always available for offline or standalone use)
  for (const s of REAL_YOUTUBE_COMMUNITY_SHARES) {
    if (s?.id) map.set(s.id, { ...s, isCurated: true });
  }

  // 2. Remote backend shares
  for (const s of remote) {
    if (s?.id) map.set(s.id, s);
  }

  // 3. Local database shares (user's created and published lists are always preserved and take precedence)
  for (const s of dbShares) {
    if (s?.id) {
      map.set(s.id, {
        ...s,
        isLocal: true,
        type: s.type || 'playlist',
        title: s.title || 'مشاركة بدون عنوان',
        tags: normalizeTags(s.tags)
      });
    }
  }

  return Array.from(map.values())
    .filter((s) => !s.isPrivate || isShareOwner(s, user))
    .map((s) => ({
      ...s,
      visits: (s.visits || 0) + (viewsMap[s.id] || 0)
    }));
}

/**
 * Publishes a new community item into PostgreSQL or IndexedDB.
 */
export async function publishCommunityShare(shareData) {
  const user = getCurrentUser();
  const isAnonymous = Boolean(shareData.isAnonymous);

  const authorName = isAnonymous
    ? 'مشارك مجهول (Anonymous)'
    : (shareData.author || user?.name || user?.username || 'طالب مَكِين');

  const authorAvatar = isAnonymous ? '' : (user?.avatar || '');

  const isPaid = Boolean(shareData.isPaid && Number(shareData.price) > 0);
  const price = isPaid ? Math.max(0, Math.round(Number(shareData.price) * 100) / 100) : 0;
  const tags = normalizeTags(shareData.tags);
  const isPrivate = Boolean(shareData.isPrivate);
  const teacher = String(shareData.teacher || '').trim();

  const newShare = {
    id: `comm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: shareData.type || 'playlist', // 'playlist' | 'path' | 'pdf' | 'cards' | 'notes' | 'video'
    title: shareData.title.trim(),
    titleEn: shareData.titleEn || shareData.title.trim(),
    author: authorName,
    authorAvatar,
    teacher,
    creatorId: user?.id || 'guest',
    isAnonymous,
    category: shareData.category || 'general',
    tags,
    isPrivate,
    visits: 1,
    rating: 5.0,
    ratingsCount: 1,
    itemsCount: shareData.itemsCount || 1,
    description: shareData.description || '',
    thumbnail: shareData.thumbnail || '',
    isPaid,
    price,
    currency: shareData.currency || 'EGP',
    totalDurationSeconds: shareData.totalDurationSeconds || computeShareTotalDuration(shareData) || 0,
    pathCourses: Array.isArray(shareData.pathCourses) ? shareData.pathCourses : [],
    // Detailed items with individual free preview toggle
    items: Array.isArray(shareData.items) ? shareData.items : [],
    playlistData: shareData.playlistData || null,
    cardsData: shareData.cardsData || null,
    pdfData: shareData.pdfData || null,
    noteContent: shareData.noteContent || '',
    isLocal: true,
    createdAt: Date.now()
  };

  try {
    await apiPublishCommunityShare(newShare);
  } catch {}
  await putCommunityShare(newShare);
  return newShare;
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
    apiRecordShareVisit(shareId);
  } catch {}
  try {
    const map = loadViewsMap();
    map[shareId] = (map[shareId] || 0) + 1;
    localStorage.setItem(VIEWS_STORAGE_KEY, JSON.stringify(map));
  } catch {}
}

/**
 * Imports community share into local library.
 * If paid and locked, throws an error requiring payment.
 */
export async function importShareToMyLibrary(share) {
  recordShareVisit(share.id);
  recordShareImported(share.id);

  if (share.isPaid && !isContentUnlocked(share)) {
    throw new Error('CONTENT_LOCKED_PAYMENT_REQUIRED');
  }

  if (share.type === 'path') {
    const courses = Array.isArray(share.pathCourses) && share.pathCourses.length ? share.pathCourses : (Array.isArray(share.items) ? share.items : []);
    const projId = `proj-path-${Date.now()}`;
    const projectFolders = [];
    const allProjVideos = [];

    for (let cIdx = 0; cIdx < courses.length; cIdx++) {
      const course = courses[cIdx];
      const folderId = `fld-${cIdx + 1}-${Date.now()}`;
      const folderItems = [];
      const playlistId = `pl-path-${Date.now()}-${cIdx}`;
      const childVideoIds = [];
      const vids = Array.isArray(course.videos) ? course.videos : (Array.isArray(course.items) ? course.items : []);

      for (let i = 0; i < vids.length; i++) {
        const item = vids[i];
        const url = item.url || item;
        const vidMatch = String(url).match(/(?:v=|\/embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
        const ytId = vidMatch ? vidMatch[1] : '';
        const docId = `yt-video-${ytId || Math.random().toString(36).slice(2)}`;

        const saved = upsertDocument({
          id: docId,
          kind: 'video',
          provider: ytId ? 'youtube' : 'local',
          ytType: 'video',
          ytId,
          title: item.title || `${course.title || 'دورة'} — درس ${i + 1}`,
          filename: url,
          url,
          embedUrl: ytId ? `https://www.youtube-nocookie.com/embed/${ytId}?rel=0&modestbranding=1` : url,
          size: 0,
          mime: 'text/html',
          missing: false,
          playlistId,
          isPlaylistChild: true,
          fromCommunity: true,
          communityShareId: share.id,
          isPaid: !!share.isPaid,
          isProtected: !!share.isPaid || !item.isFreePreview
        });
        if (saved?.id) {
          childVideoIds.push(saved.id);
          allProjVideos.push(saved.id);
          folderItems.push({ type: 'video', refId: saved.id, name: saved.title });
        }
      }

      upsertPlaylist({
        id: playlistId,
        title: `${share.title} — ${course.title || `مرحلة ${cIdx + 1}`}`,
        videoIds: childVideoIds,
        fromCommunity: true,
        communityShareId: share.id,
        isPaid: !!share.isPaid,
        isProtected: !!share.isPaid
      });

      projectFolders.push({
        id: folderId,
        name: course.title || `المرحلة ${cIdx + 1}`,
        items: folderItems
      });
    }

    upsertProject({
      id: projId,
      name: `مسار: ${share.title}`,
      description: share.description || '',
      category: share.category || 'مسار تعليمي',
      videos: allProjVideos,
      folders: projectFolders,
      studyList: allProjVideos
    });

    return { ok: true, type: 'path', coursesCount: courses.length, totalVideos: allProjVideos.length };
  }

  if (share.type === 'playlist') {
    const urls = share.playlistData?.videoUrls || [];
    const items = Array.isArray(share.items) && share.items.length ? share.items : urls.map((u, idx) => ({ title: `${share.title} - ${idx + 1}`, url: u, isFreePreview: true }));
    const playlistId = `pl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const childVideoIds = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const url = item.url || item;
      const vidMatch = String(url).match(/(?:v=|\/embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
      const ytId = vidMatch ? vidMatch[1] : '';
      const docId = `yt-video-${ytId || Math.random().toString(36).slice(2)}`;

      const saved = upsertDocument({
        id: docId,
        kind: 'video',
        provider: ytId ? 'youtube' : 'local',
        ytType: 'video',
        ytId,
        title: item.title || `${share.title} — درس ${i + 1}`,
        filename: url,
        url,
        embedUrl: ytId ? `https://www.youtube-nocookie.com/embed/${ytId}?rel=0&modestbranding=1` : url,
        size: 0,
        mime: 'text/html',
        missing: false,
        playlistId,
        isPlaylistChild: true, // Stays in Playlists tab, avoids polluting flat individual videos
        fromCommunity: true,
        communityShareId: share.id,
        isPaid: !!share.isPaid,
        isProtected: !!share.isPaid || !item.isFreePreview
      });
      if (saved?.id) {
        childVideoIds.push(saved.id);
      }
    }

    upsertPlaylist({
      id: playlistId,
      title: share.title,
      videoIds: childVideoIds,
      fromCommunity: true,
      communityShareId: share.id,
      isPaid: !!share.isPaid,
      isProtected: !!share.isPaid
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
      id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      kind: 'pdf',
      title: share.title,
      filename: `${share.title}.pdf`,
      url: share.pdfData?.url || share.pdfUrl || '',
      sizeBytes: share.pdfData?.size || 1024 * 500,
      dateAdded: Date.now()
    });
    return { ok: true, type: 'pdf' };
  }

  return { ok: false };
}

// --- Coupons, Master Passcode & Resource Insertion Engine -------------------

export function generateCouponCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let part1 = '';
  let part2 = '';
  for (let i = 0; i < 4; i++) {
    part1 += chars.charAt(Math.floor(Math.random() * chars.length));
    part2 += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `MK-${part1}-${part2}`;
}

export async function generateCouponBatch(shareId, count = 20, maxUses = 1) {
  const existingList = await listCommunitySharesDb();
  let existing = existingList.find((s) => s.id === shareId);
  if (!existing) {
    existing = REAL_YOUTUBE_COMMUNITY_SHARES.find((s) => s.id === shareId);
  }
  if (!existing) return { ok: false, error: 'SHARE_NOT_FOUND' };

  const currentCoupons = Array.isArray(existing.coupons) ? [...existing.coupons] : [];
  const existingCodes = new Set(currentCoupons.map((c) => String(c.code).toUpperCase()));
  const generated = [];

  for (let i = 0; i < count; i++) {
    let code = generateCouponCode();
    while (existingCodes.has(code)) {
      code = generateCouponCode();
    }
    existingCodes.add(code);
    const coupon = {
      id: `cpn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${i}`,
      code,
      maxUses: Math.max(1, Number(maxUses) || 1),
      usedCount: 0,
      createdAt: new Date().toISOString(),
      usedBy: []
    };
    currentCoupons.push(coupon);
    generated.push(coupon);
  }

  const updated = await updateCommunityShare(shareId, { coupons: currentCoupons });
  return { ok: true, generated, totalCoupons: currentCoupons, share: updated };
}

export async function setShareMasterPasscode(shareId, passcode) {
  const clean = String(passcode || '').trim();
  const updated = await updateCommunityShare(shareId, { masterPasscode: clean });
  return { ok: true, masterPasscode: clean, share: updated };
}

export async function redeemShareCoupon(shareId, rawCode, user = null) {
  const code = String(rawCode || '').trim();
  if (!code) return { ok: false, error: 'الرجاء إدخال كود الكوبون أو كلمة المرور' };

  const all = await listCommunityShares();
  const share = all.find((s) => s.id === shareId);
  if (!share) return { ok: false, error: 'الدورة غير موجودة' };

  const currentUser = user || getCurrentUser();
  const userId = currentUser?.id || 'guest';
  const userName = currentUser?.name || currentUser?.username || 'طالب مَكِين';

  // Check master passcode
  if (share.masterPasscode && String(share.masterPasscode).trim().toLowerCase() === code.toLowerCase()) {
    unlockContentForUser(userId, shareId);
    return { ok: true, isMasterPasscode: true, message: 'تم تفعيل الدورة بنجاح بواسطة كلمة المرور!' };
  }

  // Check individual coupons
  const coupons = Array.isArray(share.coupons) ? [...share.coupons] : [];
  const targetIndex = coupons.findIndex((c) => String(c.code).toUpperCase() === code.toUpperCase());

  if (targetIndex === -1) {
    return { ok: false, error: 'كود الكوبون أو كلمة المرور غير صحيحة' };
  }

  const target = { ...coupons[targetIndex] };
  const usedBy = Array.isArray(target.usedBy) ? [...target.usedBy] : [];

  if (target.usedCount >= target.maxUses) {
    return { ok: false, error: 'عذراً، هذا الكوبون تم استخدامه بالكامل مسبقاً' };
  }

  if (userId !== 'guest' && usedBy.some((u) => u.userId === userId)) {
    return { ok: false, error: 'لقد قمت باستخدام هذا الكوبون لحسابك بالفعل' };
  }

  target.usedCount = (target.usedCount || 0) + 1;
  usedBy.push({
    userId,
    username: userName,
    usedAt: new Date().toISOString()
  });
  target.usedBy = usedBy;
  coupons[targetIndex] = target;

  await updateCommunityShare(shareId, { coupons });
  unlockContentForUser(userId, shareId);

  return {
    ok: true,
    coupon: target,
    message: 'تم تفعيل الكوبون بنجاح وفتح محتويات الدورة!'
  };
}

export async function insertResourceIntoShare(shareId, resource, positionIndex = -1) {
  const all = await listCommunityShares();
  const share = all.find((s) => s.id === shareId);
  if (!share) return { ok: false, error: 'الدورة غير موجودة' };

  let items = Array.isArray(share.items) ? [...share.items] : [];
  if (items.length === 0 && share.playlistData?.videoUrls?.length) {
    items = share.playlistData.videoUrls.map((u, i) => ({
      id: `item-${i + 1}`,
      type: 'video',
      title: `${share.title} - درس ${i + 1}`,
      url: u,
      isFreePreview: i === 0 || !share.isPaid
    }));
  }

  const newItem = {
    id: `res-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: resource.type || 'video',
    title: String(resource.title || '').trim() || 'عنصر تعليمي جديد',
    url: resource.url || '',
    content: resource.content || '',
    pdfUrl: resource.pdfUrl || resource.url || '',
    isFreePreview: Boolean(resource.isFreePreview),
    addedAt: Date.now()
  };

  if (positionIndex >= 0 && positionIndex < items.length) {
    items.splice(positionIndex, 0, newItem);
  } else {
    items.push(newItem);
  }

  const updated = await updateCommunityShare(shareId, { items });
  return { ok: true, item: newItem, items, share: updated };
}

export function getShareDeepLink(shareId) {
  if (typeof window === 'undefined') return `?share=${shareId}`;
  const origin = window.location.origin || '';
  const pathname = window.location.pathname || '/';
  return `${origin}${pathname}#course/${shareId}`;
}

