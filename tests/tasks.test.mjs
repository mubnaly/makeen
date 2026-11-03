// Task store + legacy-migration tests (plan §6.8, §8.2). Node has no indexedDB,
// so these exercise the in-memory fallback with the same put/list/delete
// contract the browser IndexedDB path implements.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  putTask,
  listTasks,
  deleteTaskById,
  clearTasks,
  migrateLocalCollections
} from '../src/lib/storage.js';
import { makeRule, occursOn, occurrencesInRange } from '../src/lib/recurrence.js';

function task(id, extra = {}) {
  return {
    id,
    title: `Task ${id}`,
    notes: '',
    status: 'todo',
    estimateMinutes: null,
    dueDate: null,
    startTime: null,
    durationMinutes: null,
    recurrence: null,
    priority: 'normal',
    checklist: [],
    links: [],
    completedOccurrences: [],
    createdAt: '2026-10-15T10:00:00Z',
    updatedAt: '2026-10-15T10:00:00Z',
    ...extra
  };
}

function fakeLocalStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k)
  };
}

test('tasks: put/list round-trips the full shape', async () => {
  await clearTasks();
  const t = task('t1', {
    title: 'Read Biology pages 10-20',
    dueDate: '2026-10-16',
    startTime: '15:00',
    durationMinutes: 50,
    estimateMinutes: 50,
    priority: 'high',
    recurrence: makeRule({ freq: 'daily' }),
    checklist: [{ id: 'c1', text: 'skim headings', done: false }],
    links: [{ kind: 'pdf', docId: 'doc1', title: 'Biology.pdf', page: 10 }]
  });
  await putTask(t);
  const all = await listTasks();
  assert.equal(all.length, 1);
  const got = all[0];
  assert.equal(got.title, 'Read Biology pages 10-20');
  assert.equal(got.startTime, '15:00');
  assert.equal(got.recurrence.freq, 'daily');
  assert.equal(got.checklist[0].text, 'skim headings');
  assert.equal(got.links[0].page, 10);
});

test('tasks: update overwrites by id; delete and clear work', async () => {
  await clearTasks();
  await putTask(task('a'));
  await putTask({ ...task('a'), title: 'updated' });
  let all = await listTasks();
  assert.equal(all.length, 1, 'no duplicate after update');
  assert.equal(all[0].title, 'updated');
  await putTask(task('b'));
  await deleteTaskById('a');
  all = await listTasks();
  assert.deepEqual(all.map((t) => t.id), ['b']);
  await clearTasks();
  assert.equal((await listTasks()).length, 0);
});

test('migration normalizes legacy {title, done, due} tasks and clears the keys', async () => {
  await clearTasks();
  const ls = fakeLocalStorage({
    'studyos-tasks': JSON.stringify([
      { id: 'old1', title: 'Legacy essay', done: true, due: '2026-10-10' },
      { id: 'old2', title: 'Legacy revision', done: false, due: '2026-10-20' }
    ]),
    'studyos.tasks': JSON.stringify([{ id: 'old3', title: 'Dot-key task', done: false }])
  });
  const moved = await migrateLocalCollections(ls);
  assert.equal(moved.tasks, 3);
  assert.equal(ls.getItem('studyos-tasks'), null);
  assert.equal(ls.getItem('studyos.tasks'), null);
  const all = await listTasks();
  assert.equal(all.length, 3);
  const done = all.find((t) => t.id === 'old1');
  assert.equal(done.status, 'done', 'legacy done -> status done');
  assert.equal(done.dueDate, '2026-10-10', 'legacy due -> dueDate');
  assert.equal(done.recurrence, null);
  const todo = all.find((t) => t.id === 'old2');
  assert.equal(todo.status, 'todo');
  // Normalized records carry the full current shape.
  assert.ok(Array.isArray(todo.completedOccurrences) && Array.isArray(todo.checklist) && Array.isArray(todo.links));
});

test('migration is idempotent for tasks', async () => {
  await clearTasks();
  const ls = fakeLocalStorage({ 'studyos-tasks': JSON.stringify([{ id: 'x', title: 'X', done: false }]) });
  const first = await migrateLocalCollections(ls);
  assert.equal(first.tasks, 1);
  const second = await migrateLocalCollections(ls);
  assert.equal(second.tasks, 0);
  assert.equal((await listTasks()).length, 1);
});

// --- planner behavior helpers (pure, exercised via recurrence) --------------

test('study-block scenario: daily 15:00 block links to PDF pages and recurs', async () => {
  await clearTasks();
  const block = task('block1', {
    title: 'Biology.pdf pages 10-20',
    startTime: '15:00',
    durationMinutes: 50,
    dueDate: '2026-10-15',
    recurrence: makeRule({ freq: 'daily' }),
    links: [{ kind: 'pdf', docId: 'doc1', title: 'Biology.pdf', page: 10 }]
  });
  await putTask(block);
  const [loaded] = await listTasks();
  const days = occurrencesInRange(loaded.recurrence, loaded.dueDate, '2026-10-15', '2026-10-18');
  assert.deepEqual(days, ['2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'], 'block recurs daily');
  assert.ok(occursOn(loaded.recurrence, loaded.dueDate, '2026-10-16'), 'due tomorrow');
  assert.equal(loaded.links[0].page, 10, 'link target preserved for open-at-page');
});

test('per-occurrence completion does not mark the whole series done', async () => {
  await clearTasks();
  const t = task('r1', { recurrence: makeRule({ freq: 'daily' }), dueDate: '2026-10-15', completedOccurrences: ['2026-10-15'] });
  await putTask(t);
  const [loaded] = await listTasks();
  // "Done today" is per-occurrence; the task itself remains active for tomorrow.
  assert.ok(loaded.completedOccurrences.includes('2026-10-15'));
  assert.equal(occursOn(loaded.recurrence, loaded.dueDate, '2026-10-16'), true, 'still recurs tomorrow');
  assert.equal(occursOn(loaded.recurrence, loaded.dueDate, '2026-10-15') && !loaded.completedOccurrences.includes('2026-10-15'), false, 'today counts as done');
});
