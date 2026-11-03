// Flashcard sets (decks) and their portable exports (plan §7.5 / §16).
//
// A card's set is its `deck` name; captures taken from a document land in a set
// named after that document, so "every item gets its own set" falls out of the
// capture flow. Everything here is pure data shaping — no DOM, no storage — so
// it can be asserted in Node (tests/flashcards.test.mjs).
//
// Anki note: this writes a **tab-separated import file** with Anki's
// `#separator`/`#html`/`#tags column` directives (File → Import). Card images
// are NOT embedded: Anki media requires an .apkg (SQLite + media store). The
// image column is reported as a flag instead, and the capture itself stays in
// the Gallery.

import { zipStore } from './xlsx.js';
import { imageFileName, safeBaseName, uniqueFileName } from './filenames.js';

export const DEFAULT_DECK = 'Default';

// The “due today” set is VIRTUAL: it is never written to a card, so it can
// never go stale — membership is computed from due dates every time it is asked
// for. Anything built on cardsOfDeck (the grid, the rail, XLSX/Anki exports)
// therefore covers it for free, and it fills itself as reviews come due.
export const TODAY_SET = '__today__';

export function isTodaySet(name) {
  return name === TODAY_SET;
}

// Due dates are LOCAL calendar days: "today" for a student is their own day, not
// UTC's. Every schedule write and every due check goes through these two helpers
// so a card can never be a day off because of the timezone.
export function todayIso(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function addDaysIso(iso, days) {
  const [y, m, d] = String(iso || todayIso()).split('-').map(Number);
  const dt = new Date(y || 1970, (m || 1) - 1, d || 1, 12);
  dt.setDate(dt.getDate() + Number(days || 0));
  return todayIso(dt);
}

// A card lives in one or more sets. `sets` is the source of truth; `deck` is kept
// as the primary (first) set so older records, the review header and exports that
// predate multi-set membership keep working untouched.
export function setsOf(card) {
  const raw = Array.isArray(card?.sets) ? card.sets : [];
  const names = raw
    .map((name) => (typeof name === 'string' ? name.trim() : ''))
    .filter(Boolean);
  if (!names.length && typeof card?.deck === 'string' && card.deck.trim()) names.push(card.deck.trim());
  const unique = [...new Set(names)];
  return unique.length ? unique : [DEFAULT_DECK];
}

export function deckOf(card) {
  return setsOf(card)[0];
}

export function inSet(card, deck) {
  return setsOf(card).includes(deck);
}

// The stored shape: every card carries both fields, never just one of them.
export function normalizeCard(card) {
  const sets = setsOf(card);
  return { ...card, sets, deck: sets[0] };
}

// Returns a NEW card. A card must belong to at least one set, so removing the
// last one keeps it (silently) rather than orphaning the card.
export function addCardToSet(card, deck) {
  const name = String(deck || '').trim();
  if (!name) return normalizeCard(card);
  return normalizeCard({ ...card, sets: [...setsOf(card), name] });
}

export function removeCardFromSet(card, deck) {
  const sets = setsOf(card).filter((name) => name !== deck);
  return normalizeCard({ ...card, sets: sets.length ? sets : setsOf(card) });
}

// --- set operations ----------------------------------------------------------
// Rename and merge are the same membership rewrite seen from two intents, so
// they share one core. Both are pure and element-wise: a card that is not in
// `from` keeps its object identity, which lets a caller persist only what
// actually changed. Neither can orphan a card — `to`/`into` is a real set and
// `normalizeCard` keeps at least the primary set.
function moveMembership(cards, from, to) {
  const source = String(from || '').trim();
  const target = String(to || '').trim();
  if (!source || !target || source === target) return cards;
  return cards.map((card) => {
    const sets = setsOf(card);
    if (!sets.includes(source)) return card;
    // Position-preserving rewrite, deduped: a card already in both names ends
    // up in the target once, and the primary set only moves when it was the
    // set being renamed/absorbed.
    const next = [...new Set(sets.map((name) => (name === source ? target : name)))];
    return normalizeCard({ ...card, sets: next });
  });
}

// Rename `from` to `to` everywhere at once. Collisions with an existing set
// name are the caller's to reject (renaming into an existing name is a merge).
export function renameSet(cards, from, to) {
  return moveMembership(cards, from, to);
}

// Fold `from` into `into`: every member of `from` joins `into` (existing members
// keep one copy), `from` disappears, and memberships the card had elsewhere are
// untouched.
export function mergeSets(cards, from, into) {
  return moveMembership(cards, from, into);
}

// The cards whose membership a rewrite changed — exactly the records to persist.
export function changedCards(before, after) {
  return after.filter((card, i) => card !== before[i]);
}

// Move a card into `to`: it leaves every set it was in and lands in that one
// (unlike addCardToSet, which only adds membership). A blank target leaves the
// card untouched, and the result is always normalized so `deck` stays truthful.
export function moveCardToSet(card, to) {
  const target = String(to || '').trim();
  if (!target) return normalizeCard(card);
  return normalizeCard({ ...card, sets: [target] });
}

// Duplicate a card into `to`: a NEW record with its own id, same content and
// source, and a fresh schedule (due today, unreviewed) so the copy can be
// studied without disturbing the original's interval history.
// Returns null when the target or id is missing — the caller reports it.
export function duplicateCardInto(card, to, newId, now = new Date()) {
  const target = String(to || '').trim();
  if (!target || !newId) return null;
  return normalizeCard({
    ...card,
    id: newId,
    sets: [target],
    deck: target,
    due: todayIso(now),
    difficulty: 'new',
    createdAt: now.toISOString()
  });
}

export function isDue(card, today = todayIso()) {
  return !!card?.due && card.due <= today;
}

// Every set present in the library, with its size and how many cards are due.
// A card in two sets counts once in each — that is what a set count means.
export function decksOf(cards = [], today = todayIso()) {
  const map = new Map();
  for (const card of cards) {
    for (const name of setsOf(card)) {
      if (!map.has(name)) map.set(name, { name, total: 0, due: 0 });
      const entry = map.get(name);
      entry.total++;
      if (isDue(card, today)) entry.due++;
    }
  }
  return [...map.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

export function cardsOfDeck(cards = [], deck = DEFAULT_DECK) {
  if (isTodaySet(deck)) return cards.filter((c) => isDue(c));
  return cards.filter((c) => inSet(c, deck));
}

// --- spreadsheet ------------------------------------------------------------

export const DECK_COLUMNS = [
  { label: 'Front', width: 42 },
  { label: 'Back', width: 42 },
  { label: 'Set', width: 20 },
  { label: 'Source', width: 24 },
  { label: 'Page', width: 7 },
  { label: 'Due', width: 12 },
  { label: 'Difficulty', width: 12 },
  { label: 'Has image', width: 10 },
  { label: 'Created', width: 22 },
  // The picture itself is anchored over this cell as an embedded drawing (see
  // sheetToXlsx `images`), so the cell stays blank text in every reader.
  { label: 'Image', width: 24 }
];

// 0-based column index where a card's picture is anchored in the sheet.
export const IMAGE_COLUMN = DECK_COLUMNS.length - 1;

function plain(value) {
  if (value == null) return '';
  return typeof value === 'string' ? value : String(value);
}

// Rows (header excluded — sheetToXlsx adds it from DECK_COLUMNS).
export function deckSheetRows(cards = [], deck = DEFAULT_DECK) {
  return cardsOfDeck(cards, deck).map((card) => [
    plain(card.front),
    plain(card.back),
    setsOf(card).join(', '),
    plain(card.source),
    Number.isFinite(Number(card.page)) && card.page !== null && card.page !== undefined ? Number(card.page) : '',
    plain(card.due),
    plain(card.difficulty || 'new'),
    card.image ? 'yes' : 'no',
    plain(card.createdAt),
    ''
  ]);
}

// --- Anki -------------------------------------------------------------------

// Anki fields are tab separated and one note per line: tabs and newlines inside
// a field would split it, so they collapse to spaces.
function field(value, fallback = '') {
  const text = plain(value).replace(/[\t\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  return text || fallback;
}

function ankiTag(value) {
  return plain(value)
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function cardToAnkiLine(card, deck = deckOf(card), { imageFile = '' } = {}) {
  const reference = card?.source ? `${plain(card.source)}${card.page ? ` p.${card.page}` : ''}` : '';
  const front = field(card?.front, 'Untitled card');
  const text = [field(card?.back), reference].filter(Boolean).join(' · ');
  // With an image the note becomes HTML: Anki renders <img src="name.png"> from
  // its collection.media folder (the bundle ships those files next to the txt).
  const back = imageFile
    ? `<img src="${escapeHtmlAttr(imageFile)}">${text ? `<br>${escapeHtmlText(text)}` : ''}`
    : text;
  // Every set the card lives in becomes a tag, so an Anki note keeps its place
  // in each collection it belongs to.
  const setTags = [...new Set([...setsOf(card), deck])].map(ankiTag);
  const tags = ['studyos', ...setTags, ankiTag(card?.difficulty || 'new')].filter(Boolean);
  return `${front}\t${back}\t${[...new Set(tags)].join(' ')}`;
}

function escapeHtmlAttr(value) {
  return plain(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeHtmlText(value) {
  return plain(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function deckToAnki(cards = [], deck = DEFAULT_DECK) {
  const list = cardsOfDeck(cards, deck);
  const lines = [
    '#separator:tab',
    '#html:false',
    '#tags column:3',
    ...list.map((card) => cardToAnkiLine(card, deck))
  ];
  return `${lines.join('\n')}\n`;
}

// --- Anki bundle (notes + their pictures) -----------------------------------

// Anki's text importer copies pictures from its collection.media folder, not
// from the text file (docs.ankiweb.net/manual/importing/text-files), so the
// export ships BOTH: an #html:true note file whose back field carries
// <img src="…">, and a collection.media/ folder holding exactly those files.
// The zip is unpacked, media copied into the profile folder, then File → Import.

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// The picture's file name: its document's base name + the moment it was taken.
export function ankiMediaNameFor(card, taken = new Set(), now = new Date()) {
  if (!card?.image || typeof card.image !== 'string') return null;
  const m = card.image.match(/^data:image\/(png|jpe?g);base64,/i);
  if (!m) return null;
  const ext = /^png$/i.test(m[1]) ? 'png' : 'jpg';
  const when = card.createdAt || (now instanceof Date ? now.toISOString() : String(now || ''));
  const base = safeBaseName(card.source || 'capture');
  return uniqueFileName(imageFileName(base, when, ext), taken);
}

export function deckAnkiBundle(cards = [], deck = DEFAULT_DECK, { now = new Date() } = {}) {
  const list = cardsOfDeck(cards, deck);
  const taken = new Set();
  const media = [];
  const nameByCard = new Map();
  for (const card of list) {
    const name = ankiMediaNameFor(card, taken, now);
    if (!name) continue;
    const b64 = card.image.replace(/^data:image\/(?:png|jpe?g);base64,/i, '');
    try {
      media.push({ name, bytes: base64ToBytes(b64) });
      nameByCard.set(card.id, name);
    } catch {
      // A corrupted data URL skips its picture; the note itself still exports.
    }
  }
  const base = safeFileBase(isTodaySet(deck) ? 'Today' : deck);
  const txtName = `${base} - Anki.txt`;
  const lines = [
    '#separator:tab',
    '#html:true',
    '#tags column:3',
    ...list.map((card) => cardToAnkiLine(card, deck, { imageFile: nameByCard.get(card.id) || '' }))
  ];
  const entries = [
    { name: txtName, text: `${lines.join('\n')}\n` },
    ...media.map((m) => ({ name: `collection.media/${m.name}`, bytes: m.bytes })),
    { name: 'README.txt', text: ANKI_README }
  ];
  return {
    bytes: zipStore(entries, { now }),
    filename: `${base} - Anki.zip`,
    textName: txtName,
    mediaCount: media.length,
    noteCount: list.length
  };
}

export const ANKI_README = `StudyOS → Anki import\n=====================\n\nEN\n1. Unzip this file into any folder.\n2. Copy every file inside collection.media/ into Anki's collection.media folder\n   (Anki: Tools → Add-ons → Open add-ons folder? No: it is next to collection.anki2\n   in your profile folder; on most systems: %APPDATA%\\Anki2 on Windows,\n   ~/Library/Application Support/Anki2 on macOS, ~/.local/share/Anki2 on Linux).\n3. In Anki choose File → Import… and pick the "- Anki.txt" file from here.\n4. Keep "Allow HTML in fields" enabled (the file already declares #html:true).\n5. The pictures appear on their cards because their names match the <img> tags.\n\nAR\n1. فك ضغط هذا الملف.\n2. انسخ كل ملفات داخل مجلد collection.media/ إلى مجلد collection.media في ملفات\n   Anki الشخصية (الجانب الذي يحوي collection.anki2).\n3. في Anki اختر ملف ← استيراد… واختر ملف «- Anki.txt» من هنا.\n4. اترك خيار «السماح بحقول HTML» مفعّلًا (الملف يعلن #html:true).\n5. ستظهر الصور في بطاقاتها لأن أسماءها مطابقة لوسوم <img>.\n`;

// --- filenames --------------------------------------------------------------

export function safeFileBase(name, fallback = 'flashcards') {
  const cleaned = plain(name)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 80);
  return cleaned || fallback;
}

// ASCII-only separator: the desktop bridge (electron/main.cjs safeName) replaces
// every non-alphanumeric character, so an em dash would arrive as underscores.
// The Anki export is a zip: Anki pulls pictures from collection.media, which a
// plain .txt cannot carry, so the bundle ships notes + media together.
export function deckFileNames(deck = DEFAULT_DECK) {
  const base = safeFileBase(deck);
  return { xlsx: `${base} - flashcards.xlsx`, anki: `${base} - Anki.zip` };
}
