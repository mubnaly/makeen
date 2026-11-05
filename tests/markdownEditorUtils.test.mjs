import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getAutoListContinuation,
  processMarkdownEnter,
  processMarkdownTab
} from '../src/lib/markdownEditorUtils.js';

test('getAutoListContinuation: task list continuation', () => {
  const result = getAutoListContinuation('- [ ] Task 1');
  assert.deepEqual(result, { continuation: '- [ ] ' });

  const resultDone = getAutoListContinuation('- [x] Done Task');
  assert.deepEqual(resultDone, { continuation: '- [ ] ' });

  const indented = getAutoListContinuation('  * [ ] Nested task');
  assert.deepEqual(indented, { continuation: '  * [ ] ' });
});

test('getAutoListContinuation: empty task exits list', () => {
  const result = getAutoListContinuation('- [ ] ');
  assert.equal(result.exit, true);

  const resultIndented = getAutoListContinuation('  - [ ]   ');
  assert.equal(resultIndented.exit, true);
});

test('getAutoListContinuation: bullet list continuation and exit', () => {
  const res = getAutoListContinuation('- An item');
  assert.deepEqual(res, { continuation: '- ' });

  const resStar = getAutoListContinuation('* Another item');
  assert.deepEqual(resStar, { continuation: '* ' });

  const resEmpty = getAutoListContinuation('- ');
  assert.equal(resEmpty.exit, true);
});

test('getAutoListContinuation: numbered list continuation and exit', () => {
  const res1 = getAutoListContinuation('1. First point');
  assert.deepEqual(res1, { continuation: '2. ' });

  const resIndented = getAutoListContinuation('   3. Third point');
  assert.deepEqual(resIndented, { continuation: '   4. ' });

  const resEmpty = getAutoListContinuation('1. ');
  assert.equal(resEmpty.exit, true);
});

test('getAutoListContinuation: plain text returns null', () => {
  assert.equal(getAutoListContinuation('Just some normal text'), null);
  assert.equal(getAutoListContinuation('# Heading 1'), null);
});

test('processMarkdownEnter: auto-continuation on enter in task', () => {
  const text = '- [ ] Buy milk';
  const res = processMarkdownEnter(text, text.length, text.length);
  assert.ok(res);
  assert.equal(res.content, '- [ ] Buy milk\n- [ ] ');
  assert.equal(res.newCursor, text.length + '\n- [ ] '.length);
});

test('processMarkdownEnter: exiting empty task on enter', () => {
  const text = '- [ ] Buy milk\n- [ ] ';
  const res = processMarkdownEnter(text, text.length, text.length);
  assert.ok(res);
  assert.equal(res.content, '- [ ] Buy milk\n\n');
});

test('processMarkdownTab: indent and outdent', () => {
  const text = '- [ ] Task item';
  const indentRes = processMarkdownTab(text, 5, 5, false);
  assert.ok(indentRes);
  assert.equal(indentRes.content, '  - [ ] Task item');
  assert.equal(indentRes.newStart, 7);

  const outdentRes = processMarkdownTab('  - [ ] Task item', 7, 7, true);
  assert.ok(outdentRes);
  assert.equal(outdentRes.content, '- [ ] Task item');
  assert.equal(outdentRes.newStart, 5);
});
