// Projects group one study unit across sources: several PDFs, videos, flashcard
// sets, and screenshots taken while working inside the project. The project also
// owns a small PDF draft (composer) made of image and text blocks, so captures
// can be reordered and annotated with headings before export.
//
// Project records are small references only; PDF/video bytes, captures and cards
// stay in their existing stores. This module is DOM-free and unit-tested.

export const PROJECTS_KEY = 'studyos.projects';
export const PROJECT_NAME_MAX = 80;
export const PROJECT_DESCRIPTION_MAX = 600;
export const COMPOSER_TEXT_MAX = 4000;

const now = () => Date.now();
const text = (value, max = 4000) => String(value ?? '').trim().slice(0, max);
const uniqueStrings = (list) => [...new Set((Array.isArray(list) ? list : []).filter((v) => typeof v === 'string' && v)) ];

export function makeProjectId() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch { /* fall through */ }
  return `project-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function normalizeComposerEntry(raw) {
  if (!raw || typeof raw.id !== 'string') return null;
  if (raw.type === 'image' && typeof raw.captureId === 'string' && raw.captureId) {
    return { id: raw.id, type: 'image', captureId: raw.captureId, caption: text(raw.caption, 240) };
  }
  if (raw.type === 'text') {
    const value = text(raw.text, COMPOSER_TEXT_MAX);
    return value ? { id: raw.id, type: 'text', text: value } : null;
  }
  return null;
}

export function normalizeProject(raw) {
  if (!raw || typeof raw.id !== 'string' || !raw.id) return null;
  const name = text(raw.name, PROJECT_NAME_MAX);
  if (!name) return null;
  const composer = (Array.isArray(raw.composer) ? raw.composer : [])
    .map(normalizeComposerEntry)
    .filter(Boolean);
  const createdAt = Number(raw.createdAt) || now();
  const channel = raw.channel && typeof raw.channel === 'object' ? {
    id: String(raw.channel.id || ''),
    title: text(raw.channel.title || '', PROJECT_NAME_MAX),
    url: String(raw.channel.url || ''),
    avatar: String(raw.channel.avatar || ''),
    description: text(raw.channel.description || '', PROJECT_DESCRIPTION_MAX)
  } : null;
  const channelVideos = (Array.isArray(raw.channelVideos) ? raw.channelVideos : [])
    .map((v) => {
      if (!v || !v.id) return null;
      return {
        id: String(v.id),
        title: text(v.title || '', 200),
        duration: Number(v.duration) || 0,
        thumbnail: String(v.thumbnail || ''),
        url: String(v.url || `https://www.youtube.com/watch?v=${v.id}`),
        inStudyList: v.inStudyList !== false
      };
    })
    .filter(Boolean);
  const studyList = uniqueStrings(raw.studyList || channelVideos.filter((v) => v.inStudyList).map((v) => v.id));

  return {
    id: raw.id,
    name,
    description: text(raw.description, PROJECT_DESCRIPTION_MAX),
    docs: uniqueStrings(raw.docs),
    videos: uniqueStrings(raw.videos),
    sets: uniqueStrings(raw.sets),
    composer,
    channel,
    channelVideos,
    studyList,
    createdAt,
    updatedAt: Math.max(createdAt, Number(raw.updatedAt) || createdAt)
  };
}

export function createProject(name, description = '') {
  const clean = text(name, PROJECT_NAME_MAX);
  if (!clean) throw new Error('Project name is required');
  const createdAt = now();
  return {
    id: makeProjectId(),
    name: clean,
    description: text(description, PROJECT_DESCRIPTION_MAX),
    docs: [],
    videos: [],
    sets: [],
    composer: [],
    channel: null,
    channelVideos: [],
    studyList: [],
    createdAt,
    updatedAt: createdAt
  };
}

export function createChannelProject(channel, videos = []) {
  if (!channel || !channel.title) throw new Error('Channel title is required');
  const project = createProject(channel.title, channel.description || `YouTube Channel: ${channel.title}`);
  const cleanVideos = (Array.isArray(videos) ? videos : []).map((v) => ({
    id: String(v.id),
    title: text(v.title || '', 200),
    duration: Number(v.duration) || 0,
    thumbnail: String(v.thumbnail || ''),
    url: String(v.url || `https://www.youtube.com/watch?v=${v.id}`),
    inStudyList: true
  }));
  return {
    ...project,
    channel: {
      id: String(channel.id || ''),
      title: text(channel.title, PROJECT_NAME_MAX),
      url: String(channel.url || ''),
      avatar: String(channel.avatar || ''),
      description: text(channel.description || '', PROJECT_DESCRIPTION_MAX)
    },
    channelVideos: cleanVideos,
    studyList: cleanVideos.map((v) => v.id)
  };
}

export function toggleChannelVideoInStudyList(project, videoId) {
  const base = normalizeProject(project);
  if (!base || !videoId) return base;
  const targetId = String(videoId);
  const updatedVideos = (base.channelVideos || []).map((v) => {
    if (v.id === targetId) return { ...v, inStudyList: !v.inStudyList };
    return v;
  });
  const inList = updatedVideos.find((v) => v.id === targetId)?.inStudyList;
  let nextStudyList = [...base.studyList];
  if (inList && !nextStudyList.includes(targetId)) nextStudyList.push(targetId);
  else if (!inList) nextStudyList = nextStudyList.filter((id) => id !== targetId);

  return {
    ...base,
    channelVideos: updatedVideos,
    studyList: nextStudyList,
    updatedAt: now()
  };
}

export function setAllChannelVideosInStudyList(project, enable = true) {
  const base = normalizeProject(project);
  if (!base) return base;
  const updatedVideos = (base.channelVideos || []).map((v) => ({ ...v, inStudyList: Boolean(enable) }));
  return {
    ...base,
    channelVideos: updatedVideos,
    studyList: enable ? updatedVideos.map((v) => v.id) : [],
    updatedAt: now()
  };
}

export function listProjects(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(PROJECTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return (Array.isArray(parsed) ? parsed : [])
      .map(normalizeProject)
      .filter(Boolean)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export function saveProjects(list, storage = globalThis.localStorage) {
  const clean = (Array.isArray(list) ? list : []).map(normalizeProject).filter(Boolean);
  try { storage?.setItem(PROJECTS_KEY, JSON.stringify(clean)); } catch { /* quota/private mode */ }
  return clean;
}

export function upsertProject(project, storage = globalThis.localStorage) {
  const clean = normalizeProject(project);
  if (!clean) return null;
  const list = listProjects(storage);
  const index = list.findIndex((p) => p.id === clean.id);
  const saved = { ...clean, updatedAt: now() };
  if (index >= 0) list[index] = saved;
  else list.push(saved);
  saveProjects(list, storage);
  return saved;
}

export function removeProject(id, storage = globalThis.localStorage) {
  const list = listProjects(storage).filter((p) => p.id !== id);
  saveProjects(list, storage);
  return list;
}

export function updateProject(project, patch = {}) {
  const base = normalizeProject(project);
  if (!base) return null;
  return normalizeProject({ ...base, ...patch, id: base.id, createdAt: base.createdAt, updatedAt: now() });
}

// --- linked sources ---------------------------------------------------------
// `kind` is 'docs' | 'videos' | 'sets'. Sets are names, not ids, because that is
// how flashcards represent a set everywhere else in the app.

export function linkSource(project, kind, value) {
  const base = normalizeProject(project);
  if (!base || !['docs', 'videos', 'sets'].includes(kind)) return base;
  const next = uniqueStrings([...base[kind], String(value || '')]);
  return { ...base, [kind]: next.filter(Boolean), updatedAt: now() };
}

export function unlinkSource(project, kind, value) {
  const base = normalizeProject(project);
  if (!base || !['docs', 'videos', 'sets'].includes(kind)) return base;
  return { ...base, [kind]: base[kind].filter((id) => id !== value), updatedAt: now() };
}

// --- PDF composer -----------------------------------------------------------

export function addComposerImage(project, captureId, caption = '') {
  const base = normalizeProject(project);
  if (!base || !captureId) return base;
  const entry = normalizeComposerEntry({
    id: `entry-${now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: 'image',
    captureId,
    caption
  });
  if (!entry) return base;
  return { ...base, composer: [...base.composer, entry], updatedAt: now() };
}

export function addComposerText(project, value) {
  const base = normalizeProject(project);
  const entry = normalizeComposerEntry({
    id: `entry-${now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: 'text',
    text: value
  });
  if (!base || !entry) return base;
  return { ...base, composer: [...base.composer, entry], updatedAt: now() };
}

export function updateComposerEntry(project, entryId, patch = {}) {
  const base = normalizeProject(project);
  if (!base) return base;
  const composer = base.composer.map((entry) => {
    if (entry.id !== entryId) return entry;
    return normalizeComposerEntry({ ...entry, ...patch }) || entry;
  });
  return { ...base, composer, updatedAt: now() };
}

export function removeComposerEntry(project, entryId) {
  const base = normalizeProject(project);
  if (!base) return base;
  return { ...base, composer: base.composer.filter((entry) => entry.id !== entryId), updatedAt: now() };
}

// delta -1 moves up (closer to the front), +1 moves down. Moving beyond either
// end keeps the list unchanged, so the buttons can stay enabled without risk.
export function moveComposerEntry(project, entryId, delta) {
  const base = normalizeProject(project);
  if (!base) return base;
  const index = base.composer.findIndex((entry) => entry.id === entryId);
  const target = index + (Number(delta) || 0);
  if (index < 0 || target < 0 || target >= base.composer.length) return base;
  const composer = [...base.composer];
  const [entry] = composer.splice(index, 1);
  composer.splice(target, 0, entry);
  return { ...base, composer, updatedAt: now() };
}

export function clearComposer(project) {
  const base = normalizeProject(project);
  return base ? { ...base, composer: [], updatedAt: now() } : base;
}

export function addAllProjectImages(project, captures = []) {
  let next = normalizeProject(project);
  if (!next) return next;
  const existing = new Set(next.composer.filter((e) => e.type === 'image').map((e) => e.captureId));
  for (const capture of capturesForProject(next, captures)) {
    if (!capture?.id || existing.has(capture.id)) continue;
    next = addComposerImage(next, capture.id, capture.name || '');
    existing.add(capture.id);
  }
  return next;
}

// Captures belong to a project through `capture.projectId`; this keeps legacy
// captures (no projectId) visible by also accepting explicit membership.
export function capturesForProject(project, captures = []) {
  if (!project) return [];
  return (Array.isArray(captures) ? captures : []).filter((c) => c?.projectId === project.id);
}

// Pure plan for the exporter: resolves composer entries against real captures,
// drops dangling references, and leaves text blocks intact for rasterization.
export function composerPlan(project, captures = []) {
  if (!project) return [];
  const byId = new Map((Array.isArray(captures) ? captures : []).map((c) => [c.id, c]));
  return project.composer.flatMap((entry) => {
    if (entry.type === 'text') return [{ ...entry, kind: 'text' }];
    const capture = byId.get(entry.captureId);
    if (!capture?.image) return [];
    return [{ ...entry, kind: 'image', capture }];
  });
}

export function projectCounts(project, captures = [], docs = []) {
  const allDocs = Array.isArray(docs) ? docs : [];
  const docCount = project?.docs?.filter((id) => allDocs.some((d) => d.id === id && d.kind !== 'video')).length || 0;
  const videoCount = project?.videos?.filter((id) => allDocs.some((d) => d.id === id && d.kind === 'video')).length || 0;
  return {
    docs: docCount,
    videos: videoCount,
    sets: project?.sets?.length || 0,
    images: capturesForProject(project, captures).length,
    blocks: project?.composer?.length || 0
  };
}
