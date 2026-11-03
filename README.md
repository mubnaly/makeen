# StudyOS

A local-first, desktop-first study and productivity workspace. It turns PDFs
into a connected learning routine: read and annotate, capture diagrams, turn
captures into flashcards, and review them with spaced repetition — all offline,
with no account required.

Built from the roadmap in [`STUDY_PRODUCTIVITY_APP_PLAN.md`](STUDY_PRODUCTIVITY_APP_PLAN.md).
This repository currently implements **the plan's recommended first milestone
(§19)**: a small offline PDF reader with reliable JSON annotations, plus the
capture → flashcard loop.

## What works today

- **PDF reader** — open a local PDF with **continuous scrolling by default**,
  or switch to **single page** and **two-page book spread**; the spread starts
  **RTL** (page 1 on the right) and flips to LTR with one button. Peek at the
  page edge with a thin **auto-hiding scrubber** and jump by typing a page number
  or clicking a thumbnail. Four **reading modes** (normal, warm paper, grey,
  dark — dark inverts text pages only, never image pages), zoom (fit-width),
  rotation, in-document text search, and a selectable text layer. Open PDFs live
  in **horizontal tabs**; fullscreen turns them into one icon with a dropdown.
  A single **right-hand panel** carries three tabs: **cropped images**, **page
  previews** and **bookmarks**; it starts closed and opens only from its icon.
  **Fullscreen** (F / the toolbar button) replaces both toolbar rows and the
  status bar with **one horizontally scrolling icon-only line** that keeps every
  tool plus per-panel switches; its settings dialog reorders buttons and repeats
  a marker/shape/pen as a preset with fixed colour, width and fill; Esc exits.
- **Annotation engine** — the marker is a real highlighter: it renders on its
  own multiply-blended layer, so a stroke tints the paper while black text stays
  black and readable at any opacity or width. **Its direction follows the drag**
  — a mostly horizontal gesture marks a line of text, a mostly vertical one marks
  a column, and a tap leaves a short dash; there are no mode buttons to choose.
  Drafts preview live while you drag, and the pointer always carries a **size
  ring** showing the exact width the next stroke will have on screen — it comes
  from the same transform as the stroke, so it stays honest across zoom, rotation
  and page size. Widths step with +/-, not a hidden slider: **highlighter starts
  at 25 px, pen at 5 px, shapes at 5 px**. Tools: marker, shapes (rectangle,
  ellipse, line, arrow, check, cross), a temporary pointer trail, a hand/pan tool
  with grab/grabbing feedback, a text box with RTL/LTR/auto direction and Arabic
  shaping, a geometric eraser, capture, and a **spot-bookmark** tool. Per-document
  undo/redo.
- **Persistence** — annotations are saved as a **versioned JSON sidecar per
  document**, separate from the source PDF (source-safe). Coordinates are stored
  **normalized to the page**, so strokes stay glued to the same content across
  zoom, rotation, resize and restart. Saves are atomic with a rolling backup;
  the UI only reports "Saved" when a layer actually accepted the write.
- **Screenshots** — drag over a page region and the capture is saved
  **immediately** (compositing the PDF + annotations) to the Gallery and to the
  reader's right-hand Images tab for that document; there is no save-or-card
  question every time. Turn captures into flashcards later, in one batch, from
  the Gallery or a flashcard set. Every image of the open document can be
  exported together as one labelled PDF from that tab.
- **Screenshot quality** — PDF and video captures are encoded as JPEG at a
  quality you choose in Settings. It **defaults to 80%**, which stays sharp for
  diagrams and text while keeping the local library small; the range is 10–100%
  with a one-click reset, and it applies to new captures only.
- **Themes** — ten palettes for the whole workspace, five light (indigo, sand,
  mint, sky, rose) and five dark (charcoal, midnight, forest, plum, graphite).
  Every surface and every icon follows the palette, so switching a theme changes
  the chrome, cards and tools together; the choice is remembered before the
  first paint, so there is no flash of the wrong theme on startup.
- **Projects** — a project is one study unit that can hold **many PDFs, videos,
  flashcard sets and screenshots** at once. Opening a source from inside a project
  tags every new capture with that project automatically, and screenshots from
  any gallery can be brought in. The project page shows a description, linked
  sources, every screenshot, and a **PDF draft** where images can be reordered,
  captioned, and separated by text blocks (headings or notes) before a one-click
  export to a project PDF. The draft is saved with the project, so it can be
  edited over multiple sittings before exporting.
- **Flashcards & sets** — create an image card from a capture; a capture taken
  from a document lands in a **set named after that document**, so every item
  gets its own set without any setup. A card can live in **several sets at once**
  (＋ beside any card adds it to an existing set or a new one — the same image in
  as many collections as you like). Beside the card grid a rail shows the **cards
  already taken** for the selected set (thumbnail, source, due date) and any one
  of them can be reviewed on its own. A **set strip** above the grid lists **every
  set with its card count and due count at a glance** (click one to work in it),
  and the selected set can be **renamed** or **merged** into another from the same
  strip: both rewrite membership for every card at once, renaming to an existing
  name is refused in favour of a merge, and the counts follow immediately. Leading
  the strip is the **Today set** — virtual rather than stored, it **fills itself
  with whatever is due today**, so it can never go stale, and it can be reviewed
  and exported like any other set (the export is named “Today”). Each card's set
  editor also **moves** a card to another set (it leaves every set it was in) or
  **duplicates** it there — a new record with its own id and a fresh schedule,
  due today, while the original keeps its interval history.
- **Spaced repetition** — five ratings with the intervals you choose:
  **very easy 4 weeks · easy 2 weeks · moderate 1 week · hard 3 days · very hard
  1 day**, all editable in Settings (1–365 days each, with a reset). Every rating
  button shows the delay it will apply, and the next due date is counted in your
  **local calendar days**, so a card can never land a day off because of the
  timezone.
- **Daily reminder** — once a day at a time you pick (default **09:00**) StudyOS
  reports how many flashcards are due and which sets they come from. It fires at
  the first check on or after that time (so opening the app in the evening still
  reminds you), at most once per day, recorded in the settings so a restart never
  double-notifies. On desktop it uses the native notification bridge, in a
  browser it uses the Notification API, and if notifications are unavailable it
  says so in-app instead of failing silently.
- **Set exports** — the selected set exports as an **.xlsx sheet**
  (front/back/set/source/page/due/difficulty/created, written by a
  dependency-free writer) with **card images embedded** via a real drawing
  layer: each PNG/JPEG's natural size is read straight from its header (no
  canvas), sized to fit its column and anchored in its own tall row. The Anki
  export is a **.zip** containing the `#separator:tab`/`#html:true` import text,
  every card image under `collection.media/`, and a bilingual README with the
  two copy/import steps — unzip, copy the media folder, File → Import.
- **Library & history** — recent documents remember last page + zoom for resume.
  **Bookmarks** remember a page or an exact spot on it (normalized to the page,
  like annotations), show as pins, list in the side panel, and jump back to the
  page and position; clicking the bookmark icon saves the current page without
  opening the panel first.
- **Planner & calendar** — tasks with notes, priority, estimates and checklists;
  study blocks (start time + duration) that link to a PDF page or a flashcard
  deck and reopen the exact material location; recurring series with
  per-occurrence completion; month/week/day/list views; drag to reschedule;
  in-app reminders (they fire while the app is open).
- **Exports (plan §7.5)** — none of these modifies the source PDF:
  **Save annotated copy to library** flattens the annotations with pdf-lib (text
  boxes are rasterized so Arabic shaping survives) and adds the result as a new
  PDF in the Library, so it reopens with the changes already visible;
  **Annotated PDF copy** downloads that same flattened file; **Highlight
  excerpts PDF** makes one cropped excerpt per marker with a source/page caption;
  **Annotation JSON** is the portable sidecar. The reader's Images tab exports
  every crop of the open document as one PDF, and the Gallery can also **Export
  PDF** (selected or all captures, optional labels).
- **Video workspace** — import a local lesson recording **or paste a YouTube
  video/playlist link** and study either in the app: a single bottom control row
  (play/pause, ±5s, scrubbable timeline, speed, mute), **timestamps as data** —
  bookmarks with notes jump back to the moment (they work for YouTube too,
  through the IFrame API), and **Capture frame** sends the current frame to the
  Gallery (and from there into a flashcard) carrying its timecode; frame capture
  needs a local file, so a YouTube item says so instead of failing. Playback
  resumes at the last position for both providers, a duration the file does not
  declare is shown as unavailable rather than guessed, and removing a video
  frees its stored bytes.
- **Usage report** — the home page's التقرير tile block and 7-day activity strip
  come from one localStorage record of per-day counters (reviews, captures,
  cards, exports, opens) with a **review streak** that counts consecutive local
  calendar days; totals are lifetime and the strip says so plainly when there
  is no activity.
- **Grid or list, remembered** — Library, Today, Flashcards, Gallery and the
  video library each carry a grid/list toggle whose choice persists per
  section.
- **Arabic first, switchable** — the interface ships complete in **Arabic**
  (default) and **English**; the language picker sits in the top bar with a
  second copy in Settings. Switching flips the document direction (`dir=rtl`),
  the whole layout, dates and weekday names (Intl), and even Arabic plural forms
  (`بطاقة واحدة · بطاقتان · 3 بطاقات · 11 بطاقة`). PDF pages, video timelines and
  annotation boxes stay left-to-right, because the *content* is not the interface.
- **Monochrome icons only** — every icon in the chrome is an inline 24×24 SVG
  drawn with `currentColor` (no emoji, no colour fills), so icons match the text
  in light and dark themes. `tests/icons.test.mjs` fails the build if a component
  references a missing icon or renders an emoji.
- **Themes** — light and dark (Settings; the top bar keeps only language and imports).

## Architecture

```
src/
  lib/geometry.js      Canonical normalized-page coordinate transform (D2 fix)
  lib/sidecar.js       Versioned JSON sidecar schema, validation, (de)serialization
  lib/storage.js       Durable sidecar store (local + desktop file), PDF bytes
  lib/annotations.js   Annotation rendering + geometric eraser hit-testing
  lib/undo.js          Per-document command-based undo/redo
  lib/library.js       Document library + reading-position history
  lib/pdf.js           PDF.js load/render/text-layer helpers
  lib/export.js        PDF exports: images→PDF, highlight excerpts, annotated copy
  lib/xlsx.js          Dependency-free .xlsx writer (stored ZIP + inline strings)
  lib/flashcards.js    Set membership, sheet rows, Anki TSV, local-day date helpers
  lib/srs.js           Difficulty scale, editable intervals, next due dates, reminder
  lib/recurrence.js    Recurrence rules (validation, occurrence expansion, labels)
  lib/i18n.js          Arabic + English dictionary, plurals, dates, RTL attributes
  lib/lang.svelte.js   Reactive language state (the translator components import)
  lib/icons.js         Icon geometry: monochrome 24×24 outline primitives
  lib/media.js         Video file kinds, timecodes, seeking, capture records
  lib/youtube.js       YouTube/playlist URL parsing + lazy IFrame Player API loader
  lib/usage.js         Per-day usage counters, streaks, 7-day activity window
  lib/viewmode.js      Grid/list mode per section, persisted
  lib/filenames.js     Filesystem-safe export/capture names, data-URL → bytes
  components/Icon.svelte     Renders one monochrome SVG icon
  components/Reader.svelte   The PDF workspace (tools, capture, view modes)
  components/Video.svelte    Video workspace (player, bookmarks, frame capture)
  components/Planner.svelte  Tasks, study blocks, calendar views, reminders
  components/Report.svelte   Usage report: tiles, streak, 7-day activity strip
  App.svelte           Shell: navigation, Library/Today/Gallery/Flashcards, import
electron/
  main.cjs, preload.cjs       Desktop shell + atomic sidecar/capture file bridge
tests/                 Node test-runner suites for geometry, sidecar, annotations,
                       exports, xlsx, filenames, flashcards, recurrence, tasks,
                       srs, i18n, icons, media, youtube, usage, viewmode and
                       IndexedDB collections
```

**Storage model:** the local key/value record (localStorage) is the guaranteed
durable layer for annotation sidecars; on desktop an atomically-written JSON
file is added under `Documents/StudyOSData/annotations/`. Loading prefers the
newer of the two and can recover from a rolling backup copy. The JSON sidecar
is authoritative for annotations; the in-app index is rebuildable from it.

**Large artifacts** — PDF bytes, screenshots and flashcards (which embed PNG
data URLs) — live in **IndexedDB** (`studyos-files` v3: `pdfs`, `captures`,
`cards`, `tasks`), not localStorage, so large galleries do not hit the few-MB
localStorage quota (plan §8.1). An idempotent migration moves captures/cards
that older builds kept in localStorage, removing the old keys only after a
successful write.

## Getting started

```bash
npm install

npm run dev        # start the web app (Vite dev server)
npm run build      # production build into dist/
npm test           # run the Node test suites (geometry, sidecar, annotations)

npm run desktop    # build + launch the Electron shell (loads dist/ over file://)
```

A small 3-page fixture generator lives at `tests/fixtures/make_pdf.mjs`
(`node tests/fixtures/make_pdf.mjs` writes `landmark.pdf`).

## Verification status

- **Automated:** 187 passing tests across geometry (zoom/rotation/marker-centering
  round-trips), sidecar (durability, backup recovery, honest failure, schema
  refusal), annotation hit-testing (every geometry type), PDF exports (valid
  output, source bytes never mutated, colour/line-cap operators present, marker
  crop geometry, encrypted/corrupt input reported), the .xlsx container and
  worksheet XML (verified with an independently written ZIP reader and a
  bit-by-bit CRC32), including the embedded-image drawing layer (PNG/JPEG
  natural-size parsing from the header, column-fit layout, anchor placement),
  filesystem-safe export/capture filenames, flashcard sets/multi-set
  membership/Anki text and zip-media packaging/local-day dates, set rename and
  merge (members only, identity-preserving, primary-set rules, no orphaned card,
  changed-record reporting), card move/duplicate (wholesale relocation without
  mutation, independent copies with a fresh schedule), the virtual Today set
  (computed from due dates, never stored, exports covering it), the
  spaced-repetition scale (intervals, clamping, next-due dates, the reminder
  decision), recurrence/task rules, capture/card/task IndexedDB
  storage (put/list/delete/clear + idempotent localStorage migration),
  the bilingual dictionary (identical key sets, matching placeholders in both
  languages, every Arabic CLDR plural form present, language persistence),
  the icon set (well-formed geometry, every referenced name exists, no emoji in
  any component), the video helpers (file-kind detection, timecode
  round-trips, unknown durations, seeking, frame-capture records, playback
  position/bookmark persistence, byte cleanup on removal), YouTube link and
  playlist parsing, the usage counters (per-day bumps, streaks, 7-day window),
  and the grid/list view-mode persistence.
- **External check (manual):** a generated .xlsx unpacks with Windows
  `Expand-Archive` and both XML parts parse as well-formed XML, with numbers
  staying numeric and escaped text round-tripping.
- **Manual end-to-end (browser):** import → annotate (auto-direction marker,
  text, shape, pointer) → zoom and confirm the marker stays on the same content
  fraction → undo/redo → erase → view modes → reload and confirm annotations and
  bookmarks persist in place → page and spot bookmarks from the right-hand panel
  → capture → crop appears in Images → save annotated copy → reopen it from the
  Library with marks baked in → fullscreen one-line toolbar with each panel
  switch → review and reschedule — all verified.

## Non-goals / not yet built

Sync, AI, learning paths, screen recording, background notifications while
StudyOS is **closed** (reminders fire while it is open), and mobile/web
packaging are later phases (§16) and are intentionally out of scope for this
milestone.

The video workspace studies **local files and YouTube links** (playback,
bookmarks and resume for both). The plan's remaining provider adapters (Vimeo
etc.) and **watched-interval “active minutes”** accounting are not built, and
frame capture still needs a local file — so the `plyr` dependency is therefore
still unused.

Note: exporting a fully **encrypted** PDF is refused with a clear message.
Captions on excerpt and image-export pages are drawn as small rasterized labels
through the browser's own text shaping, so Arabic and every other non-WinAnsi
script keep their joining and direction instead of turning into `???`; exported
text boxes use the same raster path.
