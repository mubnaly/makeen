import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROJECTS_KEY, addAllProjectImages, addComposerImage, addComposerText,
  capturesForProject, clearComposer, composerPlan, createProject, linkSource,
  listProjects, makeProjectId, moveComposerEntry, normalizeProject, projectCounts,
  removeComposerEntry, removeProject, saveProjects, unlinkSource, updateComposerEntry,
  upsertProject, createChannelProject, toggleChannelVideoInStudyList, setAllChannelVideosInStudyList,
  createProjectFolder, updateProjectFolder, removeProjectFolder, addResourceToFolder,
  removeResourceFromFolder, moveResourceInFolder
} from '../src/lib/projects.js';

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key)
  };
}

const capture = (id, projectId = 'p1') => ({ id, projectId, image: 'data:image/jpeg;base64,AAAA', name: id, source: 'Biology.pdf' });

test('createProject trims its name and starts with empty collections', () => {
  const project = createProject('  Cell biology  ', ' Chapter 4 ');
  assert.ok(project.id);
  assert.equal(project.name, 'Cell biology');
  assert.equal(project.description, 'Chapter 4');
  assert.deepEqual(project.docs, []);
  assert.deepEqual(project.videos, []);
  assert.deepEqual(project.sets, []);
  assert.deepEqual(project.composer, []);
  assert.throws(() => createProject('   '), /name/);
});

test('normalizeProject drops malformed composer entries and deduplicates links', () => {
  const project = normalizeProject({
    id: 'p1', name: '  Biology ', description: '  ',
    docs: ['a', 'a', 4, ''], videos: ['v1'], sets: ['Set A', 'Set A'],
    composer: [
      { id: 'e1', type: 'image', captureId: 'c1', caption: '  Figure 1 ' },
      { id: 'e2', type: 'image', captureId: '' },
      { id: 'e3', type: 'text', text: '  Heading  ' },
      { id: 'e4', type: 'text', text: '   ' },
      { id: 'e5', type: 'unknown' }
    ]
  });
  assert.deepEqual(project.docs, ['a']);
  assert.deepEqual(project.sets, ['Set A']);
  assert.deepEqual(project.composer, [
    { id: 'e1', type: 'image', captureId: 'c1', caption: 'Figure 1' },
    { id: 'e3', type: 'text', text: 'Heading' }
  ]);
  assert.equal(normalizeProject({ id: 'p', name: '' }), null);
});

test('projects persist in localStorage and upsert/remove follow the record id', () => {
  const storage = memoryStorage();
  const project = createProject('Biology');
  const saved = upsertProject(project, storage);
  assert.equal(saved.id, project.id);
  assert.equal(listProjects(storage).length, 1);
  assert.equal(listProjects(storage)[0].name, 'Biology');
  const renamed = upsertProject({ ...saved, name: 'Biology II' }, storage);
  assert.equal(renamed.name, 'Biology II');
  assert.equal(listProjects(storage).length, 1);
  removeProject(project.id, storage);
  assert.equal(listProjects(storage).length, 0);
  assert.equal(storage.getItem(PROJECTS_KEY), '[]');
});

test('linkSource/unlinkSource keep each source once', () => {
  let project = createProject('Course');
  project = linkSource(project, 'docs', 'd1');
  project = linkSource(project, 'docs', 'd1');
  project = linkSource(project, 'videos', 'v1');
  project = linkSource(project, 'sets', 'Set A');
  assert.deepEqual(project.docs, ['d1']);
  assert.deepEqual(project.videos, ['v1']);
  assert.deepEqual(project.sets, ['Set A']);
  project = unlinkSource(project, 'docs', 'd1');
  assert.deepEqual(project.docs, []);
});

test('composer adds, edits, moves and removes image/text blocks in order', () => {
  let project = createProject('Draft');
  project = addComposerImage(project, 'c1', 'Figure 1');
  project = addComposerText(project, 'A heading');
  project = addComposerImage(project, 'c2', 'Figure 2');
  assert.equal(project.composer.length, 3);
  assert.deepEqual(project.composer.map((e) => e.type), ['image', 'text', 'image']);

  const textId = project.composer[1].id;
  project = moveComposerEntry(project, textId, -1);
  assert.deepEqual(project.composer.map((e) => e.type), ['text', 'image', 'image']);
  assert.equal(moveComposerEntry(project, 'missing', 1).composer.length, 3);
  assert.equal(moveComposerEntry(project, textId, -5).composer[0].type, 'text');

  const imageId = project.composer[1].id;
  project = updateComposerEntry(project, imageId, { caption: ' New caption ' });
  assert.equal(project.composer[1].caption, 'New caption');
  project = removeComposerEntry(project, imageId);
  assert.equal(project.composer.length, 2);
  project = clearComposer(project);
  assert.equal(project.composer.length, 0);
});

test('addAllProjectImages adds each project capture once', () => {
  let project = createProject('Images');
  const captures = [capture('c1', project.id), capture('c2', project.id), { ...capture('c3'), projectId: 'other' }];
  project = addAllProjectImages(project, captures);
  assert.deepEqual(project.composer.map((e) => e.captureId), ['c1', 'c2']);
  project = addAllProjectImages(project, captures);
  assert.equal(project.composer.length, 2);
  assert.deepEqual(capturesForProject(project, captures).map((c) => c.id), ['c1', 'c2']);
});

test('composerPlan drops dangling captures and keeps text in order', () => {
  const project = addComposerText(addComposerImage(createProject('Plan'), 'c1'), 'Title');
  const plan = composerPlan(project, [capture('c1')]);
  assert.deepEqual(plan.map((entry) => entry.kind), ['image', 'text']);
  assert.equal(plan[0].capture.id, 'c1');
  assert.deepEqual(composerPlan(project, []).map((entry) => entry.kind), ['text']);
});

test('projectCounts counts real linked PDFs and videos only', () => {
  const project = { ...createProject('Counts'), docs: ['d1', 'v1', 'missing'], videos: ['v1'], sets: ['A'] };
  const counts = projectCounts(project, [capture('c1', project.id), capture('c2', project.id), { ...capture('c3'), projectId: 'x' }], [
    { id: 'd1', kind: 'pdf' },
    { id: 'v1', kind: 'video' }
  ]);
  assert.deepEqual(counts, { docs: 1, videos: 1, sets: 1, images: 2, blocks: 0, folders: 0, folderResources: 0 });
});

test('saveProjects normalizes the whole list', () => {
  const storage = memoryStorage();
  saveProjects([
    { id: 'b', name: 'B', docs: [] },
    { id: 'a', name: 'A', docs: [] },
    { id: 'bad', name: '' }
  ], storage);
  assert.deepEqual(listProjects(storage).map((p) => p.id).sort(), ['a', 'b']);
});

test('makeProjectId is unique enough for local records', () => {
  assert.notEqual(makeProjectId(), makeProjectId());
});

test('createChannelProject creates project with channel metadata and video study list', () => {
  const channel = { id: 'c1', title: 'Science Hub', description: 'Science lessons', avatar: 'https://example.com/avatar.jpg' };
  const videos = [
    { id: 'v1', title: 'Episode 1', duration: 600, thumbnail: 'https://example.com/t1.jpg' },
    { id: 'v2', title: 'Episode 2', duration: 800, thumbnail: 'https://example.com/t2.jpg' }
  ];
  const project = createChannelProject(channel, videos);
  assert.equal(project.name, 'Science Hub');
  assert.equal(project.channel.id, 'c1');
  assert.equal(project.channel.avatar, 'https://example.com/avatar.jpg');
  assert.equal(project.channelVideos.length, 2);
  assert.deepEqual(project.studyList, ['v1', 'v2']);

  // Toggle study list
  const toggled = toggleChannelVideoInStudyList(project, 'v1');
  assert.equal(toggled.channelVideos.find((v) => v.id === 'v1').inStudyList, false);
  assert.deepEqual(toggled.studyList, ['v2']);

  // Toggle back
  const toggledBack = toggleChannelVideoInStudyList(toggled, 'v1');
  assert.equal(toggledBack.channelVideos.find((v) => v.id === 'v1').inStudyList, true);
  assert.deepEqual(toggledBack.studyList, ['v2', 'v1']);

  // Set all
  const allDisabled = setAllChannelVideosInStudyList(project, false);
  assert.deepEqual(allDisabled.studyList, []);
  assert.ok(allDisabled.channelVideos.every((v) => !v.inStudyList));
});

test('project folders: create, add resources, move, remove and count', () => {
  let project = createProject('Physics Term 1');
  assert.deepEqual(project.folders, []);

  // Add folder
  project = createProjectFolder(project, 'Chapter 1: Kinematics', '#10b981');
  assert.equal(project.folders.length, 1);
  const folderId = project.folders[0].id;
  assert.equal(project.folders[0].name, 'Chapter 1: Kinematics');
  assert.equal(project.folders[0].color, '#10b981');

  // Add resources
  project = addResourceToFolder(project, folderId, {
    type: 'pdf',
    refId: 'doc-123',
    title: 'Lecture 1 Notes.pdf'
  });
  project = addResourceToFolder(project, folderId, {
    type: 'youtube',
    refId: 'yt-vid-456',
    title: 'Velocity and Acceleration',
    url: 'https://youtube.com/watch?v=12345678901'
  });
  project = addResourceToFolder(project, folderId, {
    type: 'deck',
    refId: 'Kinematics Formulas',
    title: 'Kinematics Formulas'
  });
  assert.equal(project.folders[0].items.length, 3);
  assert.equal(project.folders[0].items[0].type, 'pdf');
  assert.equal(project.folders[0].items[1].type, 'youtube');
  assert.equal(project.folders[0].items[2].type, 'deck');

  // Reorder resource
  const itemId = project.folders[0].items[0].id;
  project = moveResourceInFolder(project, folderId, itemId, 1);
  assert.equal(project.folders[0].items[1].id, itemId);

  // Remove one resource
  project = removeResourceFromFolder(project, folderId, itemId);
  assert.equal(project.folders[0].items.length, 2);

  // Counts
  const counts = projectCounts(project, [], []);
  assert.equal(counts.folders, 1);
  assert.equal(counts.folderResources, 2);

  // Remove folder
  project = removeProjectFolder(project, folderId);
  assert.equal(project.folders.length, 0);
});
