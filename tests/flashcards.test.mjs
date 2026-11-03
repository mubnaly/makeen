// Flashcard set tests (src/lib/flashcards.js): grouping, export rows, Anki TSV
// and the local-calendar date helpers the scheduler depends on.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_DECK,
  deckOf,
  setsOf,
  inSet,
  normalizeCard,
  addCardToSet,
  removeCardFromSet,
  isDue,
  decksOf,
  cardsOfDeck,
  deckSheetRows,
  cardToAnkiLine,
  deckToAnki,
  deckAnkiBundle,
  ankiMediaNameFor,
  deckFileNames,
  safeFileBase,
  todayIso,
  addDaysIso,
  renameSet,
  mergeSets,
  changedCards,
  moveCardToSet,
  duplicateCardInto,
  TODAY_SET,
  isTodaySet,
  IMAGE_COLUMN,
  DECK_COLUMNS
} from '../src/lib/flashcards.js';

const TODAY = '2026-10-16';

const cards = [
  { id: '1', deck: 'Biology', front: 'Cell?', back: 'Unit of life', source: 'Biology.pdf', page: 3, due: TODAY, difficulty: 'good', createdAt: '2026-10-01T10:00:00.000Z', image: 'data:image/png;base64,AA' },
  { id: '2', deck: 'Biology', front: 'DNA shape?', back: 'Double helix', source: 'Biology.pdf', page: 9, due: '2026-12-01', difficulty: 'easy', createdAt: '2026-10-02T10:00:00.000Z' },
  { id: '3', front: 'No set', back: '', source: 'History.pdf', page: 1, due: '2026-10-01' },
  { id: '4', deck: '  Chemistry  ', front: 'Na?', back: 'Sodium', due: '2026-12-25' }
];

// --- dates ------------------------------------------------------------------

test('todayIso is a local calendar day', () => {
  assert.match(todayIso(), /^\d{4}-\d{2}-\d{2}$/);
  // 23:30 local must still be that local day, whatever the UTC offset.
  const late = new Date(2026, 9, 16, 23, 30, 0);
  assert.equal(todayIso(late), '2026-10-16');
  const early = new Date(2026, 9, 16, 0, 15, 0);
  assert.equal(todayIso(early), '2026-10-16');
});

test('addDaysIso keeps local days honest across month, year and DST boundaries', () => {
  assert.equal(addDaysIso('2026-10-16', 0), '2026-10-16');
  assert.equal(addDaysIso('2026-10-16', 1), '2026-10-17');
  assert.equal(addDaysIso('2026-10-16', 14), '2026-10-30');
  assert.equal(addDaysIso('2026-10-31', 1), '2026-11-01', 'month rollover');
  assert.equal(addDaysIso('2026-12-31', 1), '2027-01-01', 'year rollover');
  assert.equal(addDaysIso('2026-03-28', 1), '2026-03-29', 'DST switch day is still one day');
  assert.equal(addDaysIso('2026-10-16', -3), '2026-10-13', 'negative offsets');
  assert.equal(addDaysIso('', 2), addDaysIso(todayIso(), 2), 'empty input means today');
});

// --- grouping ---------------------------------------------------------------

test('deckOf normalizes the set name and falls back to Default', () => {
  assert.equal(deckOf({ deck: 'Biology' }), 'Biology');
  assert.equal(deckOf({ deck: '  Chemistry  ' }), 'Chemistry');
  assert.equal(deckOf({ deck: '   ' }), DEFAULT_DECK);
  assert.equal(deckOf({}), DEFAULT_DECK);
  assert.equal(deckOf(null), DEFAULT_DECK);
});

test('isDue compares calendar days, and only for cards that have one', () => {
  assert.equal(isDue({ due: TODAY }, TODAY), true);
  assert.equal(isDue({ due: '2026-10-01' }, TODAY), true, 'overdue counts');
  assert.equal(isDue({ due: '2026-10-17' }, TODAY), false);
  assert.equal(isDue({}, TODAY), false, 'no due date is not due');
  assert.equal(isDue({ due: null }, TODAY), false);
});

test('decksOf counts each set and its due cards, biggest first', () => {
  const decks = decksOf(cards, TODAY);
  // Equal-sized sets fall back to the set name, so the order is stable.
  assert.deepEqual(decks.map((d) => d.name), ['Biology', 'Chemistry', 'Default']);
  assert.deepEqual(decks[0], { name: 'Biology', total: 2, due: 1 });
  assert.deepEqual(decks[1], { name: 'Chemistry', total: 1, due: 0 });
  assert.deepEqual(decks[2], { name: DEFAULT_DECK, total: 1, due: 1 }, 'cards with no deck join Default');
  assert.deepEqual(decksOf([], TODAY), []);
});

test('cardsOfDeck returns exactly the set members', () => {
  assert.deepEqual(cardsOfDeck(cards, 'Biology').map((c) => c.id), ['1', '2']);
  assert.deepEqual(cardsOfDeck(cards, 'Chemistry').map((c) => c.id), ['4']);
  assert.deepEqual(cardsOfDeck(cards, 'Nope'), []);
  assert.deepEqual(cardsOfDeck([], 'Biology'), []);
});

// --- spreadsheet rows -------------------------------------------------------

test('deckSheetRows lines up with DECK_COLUMNS and reports the image flag', () => {
  const rows = deckSheetRows(cards, 'Biology');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].length, DECK_COLUMNS.length, 'every row matches the header width');
  assert.deepEqual(rows[0].slice(0, 6), ['Cell?', 'Unit of life', 'Biology', 'Biology.pdf', 3, TODAY]);
  assert.equal(rows[0][7], 'yes');
  assert.equal(rows[1][7], 'no');
  assert.equal(rows[1][8], '2026-10-02T10:00:00.000Z');
});

test('deckSheetRows fills sane defaults instead of undefined holes', () => {
  const rows = deckSheetRows([{ id: 'x', deck: 'Set', front: 'Q', source: '', page: 'nope' }], 'Set');
  assert.deepEqual(rows[0], ['Q', '', 'Set', '', '', '', 'new', 'no', '', '']);
  assert.equal(rows[0].length, DECK_COLUMNS.length, 'every row still matches the header width');
});

// --- Anki -------------------------------------------------------------------

test('cardToAnkiLine is one tab-separated note with tags', () => {
  const line = cardToAnkiLine(cards[0], 'Biology');
  const fields = line.split('\t');
  assert.equal(fields.length, 3, 'front, back, tags — nothing else');
  assert.equal(fields[0], 'Cell?');
  assert.equal(fields[1], 'Unit of life · Biology.pdf p.3', 'the source reference rides along with the answer');
  assert.equal(fields[2], 'studyos biology good');
});

test('cardToAnkiLine collapses tabs and newlines so a note never splits', () => {
  const line = cardToAnkiLine({ front: 'a\tb', back: 'multi\nline\r\nanswer', source: 'S.pdf' }, 'My Set');
  assert.equal(line.split('\t').length, 3);
  assert.match(line, /^a b\tmulti line answer · S\.pdf\t/);
  // Anki tags are space separated; the point is that no field leaked across the
  // tab boundaries and no tag is empty. This card has no membership at all, so it
  // belongs to the Default set and carries that tag alongside the export's set
  // (through deckToAnki a card is only exported for a set it is actually in).
  const tags = line.split('\t')[2];
  assert.equal(tags, 'studyos default my-set new');
  assert.deepEqual(tags.split(' ').filter(Boolean).length, 4);
});

test('cardToAnkiLine never emits an empty front', () => {
  const line = cardToAnkiLine({ back: '' }, 'Set');
  assert.match(line, /^Untitled card\t/);
});

test('deckToAnki writes the import directives and one line per card', () => {
  const text = deckToAnki(cards, 'Biology');
  const lines = text.trimEnd().split('\n');
  assert.deepEqual(lines.slice(0, 3), ['#separator:tab', '#html:false', '#tags column:3']);
  assert.equal(lines.length, 5, 'three directives plus two notes');
  assert.ok(text.endsWith('\n'), 'file ends with a newline');
  assert.equal(deckToAnki(cards, 'Nope').trimEnd().split('\n').length, 3, 'directives only for an unknown set');
});

// --- filenames --------------------------------------------------------------

test('safeFileBase removes characters a filesystem rejects', () => {
  assert.equal(safeFileBase('Study/Notes:2024'), 'Study Notes 2024');
  assert.equal(safeFileBase('a<b>c|d?e*f"g\\h'), 'a b c d e f g h');
  assert.equal(safeFileBase('trailing dots...'), 'trailing dots');
  assert.equal(safeFileBase('   '), 'flashcards');
  assert.equal(safeFileBase(null), 'flashcards');
  assert.equal(safeFileBase('x'.repeat(200)).length, 80);
});

// --- membership: a card can live in several sets ---------------------------

// The same capture may belong to more than one collection at once.
const shared = {
  id: 'm1', sets: ['Biology', 'Chemistry'], front: 'Shared image', back: '',
  source: 'landmark.pdf', page: 2, due: '2026-11-20', difficulty: 'moderate'
};

test('setsOf normalizes membership and keeps the legacy deck working', () => {
  assert.deepEqual(setsOf({ sets: ['Biology', 'Chemistry'] }), ['Biology', 'Chemistry']);
  assert.deepEqual(setsOf({ sets: ['  Biology  ', 'Biology'] }), ['Biology'], 'trimmed and deduped');
  assert.deepEqual(setsOf({ deck: 'Chemistry' }), ['Chemistry'], 'a legacy deck becomes the only set');
  assert.deepEqual(setsOf({ sets: [], deck: 'Chemistry' }), ['Chemistry'], 'empty sets falls back to deck');
  assert.deepEqual(setsOf({ sets: ['', '   '], deck: 'Maths' }), ['Maths'], 'blank names are dropped');
  assert.deepEqual(setsOf({ sets: 'Biology' }), [DEFAULT_DECK], 'a non-array sets field is ignored');
  assert.deepEqual(setsOf({}), [DEFAULT_DECK]);
  assert.deepEqual(setsOf(null), [DEFAULT_DECK]);
});

test('normalizeCard stores both fields, deck being the primary set', () => {
  const multi = normalizeCard({ id: '1', sets: ['Z', 'A'] });
  assert.deepEqual(multi.sets, ['Z', 'A']);
  assert.equal(multi.deck, 'Z');
  const legacy = normalizeCard({ id: '2', deck: 'Bio' });
  assert.deepEqual(legacy.sets, ['Bio']);
  assert.equal(legacy.deck, 'Bio');
  assert.equal(normalizeCard({ id: '3' }).deck, DEFAULT_DECK);
});

test('addCardToSet and removeCardFromSet are pure and never orphan a card', () => {
  const card = { id: '1', sets: ['Biology'] };
  const added = addCardToSet(card, 'Chemistry');
  assert.deepEqual(added.sets, ['Biology', 'Chemistry']);
  assert.equal(added.deck, 'Biology', 'the primary set does not move');
  assert.deepEqual(card.sets, ['Biology'], 'the original is untouched');
  assert.deepEqual(addCardToSet(card, 'Biology').sets, ['Biology'], 'no duplicates');
  assert.deepEqual(addCardToSet(card, '   ').sets, ['Biology'], 'a blank name is ignored');
  assert.deepEqual(removeCardFromSet(added, 'Biology').sets, ['Chemistry']);
  assert.deepEqual(removeCardFromSet(card, 'Biology').sets, ['Biology'], 'the last set stays');
  assert.deepEqual(removeCardFromSet(card, 'Nope').sets, ['Biology'], 'removing a non-member is a no-op');
});

test('a card in two sets appears in both and is counted in both', () => {
  const all = [...cards, shared];
  assert.equal(inSet(shared, 'Chemistry'), true);
  assert.equal(inSet(shared, 'History'), false);
  assert.deepEqual(cardsOfDeck(all, 'Biology').map((c) => c.id), ['1', '2', 'm1']);
  assert.deepEqual(cardsOfDeck(all, 'Chemistry').map((c) => c.id), ['4', 'm1']);
  const decks = decksOf(all, TODAY);
  assert.deepEqual(decks.find((d) => d.name === 'Biology'), { name: 'Biology', total: 3, due: 1 });
  assert.deepEqual(decks.find((d) => d.name === 'Chemistry'), { name: 'Chemistry', total: 2, due: 0 });
});

test('exports carry every set a card lives in', () => {
  assert.equal(deckSheetRows([shared], 'Chemistry')[0][2], 'Biology, Chemistry');
  assert.match(cardToAnkiLine(shared, 'Chemistry'), /\tstudyos biology chemistry moderate$/);
});

test('deckFileNames labels both exports after the set', () => {
  assert.deepEqual(deckFileNames('Biology'), {
    xlsx: 'Biology - flashcards.xlsx',
    // The Anki export is a zip: Anki pulls pictures from collection.media, so
    // notes and their images travel together.
    anki: 'Biology - Anki.zip'
  });
  // The desktop bridge keeps [a-z0-9._-] only, so the name must survive it intact.
  assert.equal('Biology - flashcards.xlsx'.replace(/[^a-z0-9._-]/gi, '_'), 'Biology_-_flashcards.xlsx');
  assert.ok(!/[^\x20-\x7e]/.test(deckFileNames('Biology').xlsx), 'ASCII only');
  const weird = deckFileNames('Set/1: Intro');
  assert.ok(!/[<>:"/\\|?*]/.test(weird.xlsx), `unsafe name: ${weird.xlsx}`);
  assert.match(weird.xlsx, /\.xlsx$/);
  assert.match(weird.anki, /\.zip$/);
});

// --- rename / merge a whole set -------------------------------------------

test('renameSet rewrites the set on every member and nowhere else', () => {
  const before = [...cards, shared];
  const after = renameSet(before, 'Biology', 'Life Sciences');
  // Members: legacy `deck`-only records and `sets` records both move.
  assert.deepEqual(setsOf(after[0]), ['Life Sciences']);
  assert.equal(after[0].deck, 'Life Sciences', 'the primary set follows the rename');
  assert.deepEqual(setsOf(after[1]), ['Life Sciences']);
  // Non-members keep their object identity (nothing to persist).
  assert.equal(after[2], before[2]);
  assert.equal(after[3], before[3]);
  // A card in two sets keeps its other membership and its position in the list.
  assert.deepEqual(setsOf(after[4]), ['Life Sciences', 'Chemistry']);
  // The input array is never mutated.
  assert.deepEqual(setsOf(before[0]), ['Biology']);
  // Counts follow the new name.
  const decks = decksOf(after, TODAY);
  assert.deepEqual(decks.find((d) => d.name === 'Life Sciences'), { name: 'Life Sciences', total: 3, due: 1 });
  assert.equal(decks.find((d) => d.name === 'Biology'), undefined);
});

test('renameSet refuses blank, unchanged and unknown names', () => {
  assert.equal(renameSet(cards, 'Biology', 'Biology'), cards, 'same name is a no-op');
  assert.equal(renameSet(cards, 'Biology', '   '), cards, 'blank target is a no-op');
  assert.equal(renameSet(cards, '', 'Chemistry'), cards, 'blank source is a no-op');
  assert.deepEqual(changedCards(cards, renameSet(cards, 'Nope', 'X')), [], 'unknown set changes nothing');
  // The built-in default is a set like any other and can be renamed.
  const renamed = renameSet([{ id: 'z' }], DEFAULT_DECK, 'المفضلة');
  assert.deepEqual(setsOf(renamed[0]), ['المفضلة']);
  assert.equal(renamed[0].deck, 'المفضلة');
});

test('mergeSets folds one set into another without losing memberships', () => {
  const before = [...cards, shared];
  const after = mergeSets(before, 'Chemistry', 'Biology');
  // Chemistry's only member joins Biology…
  assert.deepEqual(setsOf(after[3]), ['Biology']);
  assert.equal(after[3].deck, 'Biology', 'the absorbed primary moves to the target');
  // …and the card that was in both ends up in it once.
  assert.deepEqual(setsOf(after[4]), ['Biology']);
  // Everyone else keeps identity.
  assert.equal(after[0], before[0]);
  assert.equal(after[2], before[2]);
  const decks = decksOf(after, TODAY);
  assert.deepEqual(decks.find((d) => d.name === 'Biology'), { name: 'Biology', total: 4, due: 1 });
  assert.equal(decks.find((d) => d.name === 'Chemistry'), undefined, 'the merged set is gone');
});

test('merging leaves the primary set alone unless it was the absorbed one', () => {
  const keepPrimary = mergeSets([{ id: 'm2', sets: ['History', 'Chemistry'] }], 'Chemistry', 'Biology');
  assert.deepEqual(setsOf(keepPrimary[0]), ['History', 'Biology']);
  assert.equal(keepPrimary[0].deck, 'History');
  const movesPrimary = mergeSets([{ id: 'm3', sets: ['Chemistry', 'History'] }], 'Chemistry', 'Biology');
  assert.equal(movesPrimary[0].deck, 'Biology');
  // Neither operation can leave a card with no set at all.
  const lastSet = mergeSets([{ id: 'm4', sets: ['Chemistry'] }], 'Chemistry', 'Biology');
  assert.ok(setsOf(lastSet[0]).length >= 1);
  assert.equal(lastSet[0].deck, 'Biology');
});

test('changedCards reports only the rewritten records, by identity', () => {
  const before = cards;
  assert.deepEqual(changedCards(before, renameSet(before, 'Biology', 'Life')).map((c) => c.id), ['1', '2']);
  assert.deepEqual(changedCards(before, mergeSets(before, 'Chemistry', 'Biology')).map((c) => c.id), ['4']);
  assert.deepEqual(changedCards(before, renameSet(before, 'Nope', 'X')), []);
  assert.deepEqual(changedCards(before, before), []);
});

// --- move / duplicate a card -----------------------------------------------

test('moveCardToSet relocates the card wholesale and never mutates it', () => {
  const card = { id: 'm5', sets: ['Biology', 'Chemistry'], deck: 'Biology', front: 'Q', due: TODAY };
  const moved = moveCardToSet(card, 'History');
  assert.deepEqual(moved.sets, ['History'], 'it leaves every set it was in');
  assert.equal(moved.deck, 'History', 'the primary set follows');
  assert.equal(moved.front, 'Q');
  assert.equal(moved.due, TODAY, 'the schedule survives the move');
  assert.deepEqual(card.sets, ['Biology', 'Chemistry'], 'the original record is untouched');
  // A blank target means "no destination": the card comes back normalized.
  assert.deepEqual(moveCardToSet(card, '   ').sets, ['Biology', 'Chemistry']);
  assert.equal(moveCardToSet(card, '').deck, 'Biology');
});

test('duplicateCardInto makes an independent copy with a fresh schedule', () => {
  const card = { id: 'src', sets: ['Biology'], front: 'Q', back: 'A', image: 'data:image/png;base64,AA', source: 'Bio.pdf', page: 4, due: '2026-11-11', difficulty: 'easy' };
  const copy = duplicateCardInto(card, 'Exams', 'copy-1', new Date('2026-10-16T10:30:00Z'));
  assert.notEqual(copy.id, card.id, 'a duplicate is its own record');
  assert.deepEqual(copy.sets, ['Exams']);
  assert.equal(copy.deck, 'Exams');
  assert.equal(copy.front, 'Q');
  assert.equal(copy.back, 'A');
  assert.equal(copy.image, card.image, 'the picture travels with it');
  assert.equal(copy.source, 'Bio.pdf');
  assert.equal(copy.page, 4);
  assert.equal(copy.due, '2026-10-16', 'due today (local day), not inherited');
  assert.equal(copy.difficulty, 'new', 'the copy starts an independent schedule');
  assert.equal(copy.createdAt, '2026-10-16T10:30:00.000Z');
  assert.equal(card.due, '2026-11-11', 'the original keeps its schedule');
  assert.deepEqual(card.sets, ['Biology'], 'the original keeps its sets');
  // Without a destination or an id there is nothing to write.
  assert.equal(duplicateCardInto(card, '  ', 'x'), null);
  assert.equal(duplicateCardInto(card, 'Exams', ''), null);
});

// --- the virtual Today set --------------------------------------------------

test('the Today set fills itself from due dates and is never stored', () => {
  assert.equal(isTodaySet(TODAY_SET), true);
  assert.equal(isTodaySet('Biology'), false);
  // Today = due on or before the local day: cards 1 (due today) and 3 (overdue).
  assert.deepEqual(cardsOfDeck(cards, TODAY_SET).map((c) => c.id), ['1', '3']);
  assert.deepEqual(cardsOfDeck([], TODAY_SET), []);
  // Nothing carries the sentinel, so no stored membership can go stale…
  assert.ok(cards.every((c) => !setsOf(c).includes(TODAY_SET)));
  // …and the set exists only where it is asked for: decksOf lists real sets.
  assert.ok(!decksOf(cards, TODAY_SET).some((d) => d.name === TODAY_SET));
});

test('exports built on cardsOfDeck cover the Today set for free', () => {
  const rows = deckSheetRows(cards, TODAY_SET);
  assert.equal(rows.length, 2, 'one row per due card');
  assert.deepEqual(rows.map((r) => r[0]), ['Cell?', 'No set']);
  const anki = deckToAnki(cards, TODAY_SET).trimEnd().split('\n');
  assert.deepEqual(anki.slice(0, 3), ['#separator:tab', '#html:false', '#tags column:3']);
  assert.equal(anki.length, 5, 'three directives plus the two due notes');
});

// --- Anki bundle (notes + collection.media in one zip) ----------------------

// Minimal STORED-zip reader (the writer never deflates), just enough to inspect
// what the bundle ships.
function unzip(bytes) {
  const buf = Buffer.from(bytes);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  assert.ok(eocd >= 0, 'end of central directory present');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let i = 0; i < count; i++) {
    const crc = buf.readUInt32LE(p + 16);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const localNameLen = buf.readUInt16LE(local + 26);
    const localExtraLen = buf.readUInt16LE(local + 28);
    out.set(name, buf.subarray(local + 30 + localNameLen + localExtraLen, local + 30 + localNameLen + localExtraLen + size));
    void crc;
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

test('deckAnkiBundle ships HTML notes, their pictures and instructions', () => {
  const bundle = deckAnkiBundle(cards, 'Biology', { now: new Date('2026-10-16T12:00:00Z') });
  assert.equal(bundle.filename, 'Biology - Anki.zip');
  assert.equal(bundle.noteCount, 2);
  assert.equal(bundle.mediaCount, 1, 'only card 1 has a picture');

  const entries = unzip(bundle.bytes);
  const names = [...entries.keys()];
  assert.ok(names.includes('Biology - Anki.txt'));
  assert.ok(names.includes('README.txt'));
  const mediaName = names.find((n) => n.startsWith('collection.media/'));
  assert.ok(mediaName, 'the picture rides in collection.media/');
  const file = mediaName.slice('collection.media/'.length);
  // filename + date + time, exactly as saved pictures are named.
  assert.match(file, /^Biology_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.png$/, file);
  // Decoded with Node's own base64 reader: the bytes must travel unchanged.
  assert.deepEqual([...entries.get(mediaName)], [...Buffer.from('AA', 'base64')], 'bytes arrive unmodified');

  const txt = entries.get('Biology - Anki.txt').toString('utf8');
  const lines = txt.trimEnd().split('\n');
  assert.deepEqual(lines.slice(0, 3), ['#separator:tab', '#html:true', '#tags column:3']);
  assert.ok(txt.includes(`<img src="${file}">`), 'the note references its picture by that exact name');
  assert.equal(lines.length, 5, 'three directives plus two notes');
  const readme = entries.get('README.txt').toString('utf8');
  assert.ok(readme.includes('collection.media') && readme.includes('Anki'));
  assert.ok(/\p{Script=Arabic}/u.test(readme), 'instructions also in Arabic');
});

test('deckAnkiBundle without pictures is still a valid bundle', () => {
  const bundle = deckAnkiBundle(cards, 'Chemistry');
  assert.equal(bundle.mediaCount, 0);
  assert.equal(bundle.noteCount, 1);
  const entries = unzip(bundle.bytes);
  assert.deepEqual([...entries.keys()].sort(), ['Chemistry - Anki.txt', 'README.txt']);
  const txt = entries.get('Chemistry - Anki.txt').toString('utf8');
  assert.ok(!txt.includes('<img'), 'no img tags without pictures');
  assert.ok(txt.includes('#html:true'), 'the directive stays so the format never changes');
});

test('ankiMediaNameFor names by document + moment and dedupes collisions', () => {
  const taken = new Set();
  const card = { id: 'c1', source: 'Biology.pdf', createdAt: '2026-10-01T10:00:00.000Z', image: 'data:image/png;base64,AA' };
  const first = ankiMediaNameFor(card, taken);
  assert.match(first, /^Biology_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.png$/);
  const second = ankiMediaNameFor(card, taken); // same document, same second
  assert.notEqual(second, first, 'colliding names get a suffix instead of overwriting');
  assert.match(second, /-2\.png$/);
  assert.equal(ankiMediaNameFor({ id: 'c2', source: 'x.pdf' }, new Set()), null, 'no image');
  assert.equal(ankiMediaNameFor({ id: 'c3', image: 'data:image/gif;base64,AA' }, new Set()), null, 'gif cannot ride along');
  assert.equal(ankiMediaNameFor(null, new Set()), null);
});

test('the spreadsheet has a dedicated column for the embedded picture', () => {
  assert.equal(IMAGE_COLUMN, DECK_COLUMNS.length - 1);
  assert.equal(DECK_COLUMNS[IMAGE_COLUMN].label, 'Image');
  const rows = deckSheetRows(cards, 'Biology');
  assert.equal(rows[0].length, DECK_COLUMNS.length);
  assert.equal(rows[0][IMAGE_COLUMN], '', 'the picture floats over a blank cell');
});
