when: cross references · cross-references · parallel passages · TSK · OpenBible · MyBible crossreferences module · .crossreferences.SQLite3 · chip beside a verse · bible-crossrefs · build-bible-crossrefs · crossReferencesAt · перекрёстные ссылки · параллельные места · метка у стиха · ссылки к стиху · набор ссылок · сокровищница TSK

# Show and rebuild the Bible's cross references

A verse of the reader carries a chip with the number of its main links; the chip or the verse number opens the window of its links, and "Open" goes to the passage with the way back to the verse. The data is ONE set made from fourteen MyBible modules (the owner, 2026-10-15: "a set, not a list"), one file per book in `frontend/public/bible-crossrefs/<version>/` (the version is `BIBLE_CROSSREFS_VERSION` in `app/utils/bibleCrossRefsCache.ts`, v2 since 2026-10-16), kept in the King James numbering.

## How

- A screen never reads the set itself. `frontend/app/utils/crossReferences.ts` answers "this verse, in this Bible → its links, as places of the same Bible": `crossReferencesAt(set, bible, place)`, `countCrossReferences` for the chips, `crossReferenceLabel` for names, `loadCrossRefs(bookId)` to fetch a book's file. Numbering moves only through `utils/versification` (a link to KJV Ps 18:10–12 is Synodal Ps 17:11–13).
- A screen that draws a book with `BookRibbon` gets everything from `useBookCrossRefs(bookId, bible, text, 'reader' | 'window')` (`frontend/app/components/bible/useBookCrossRefs.ts`): pass `ribbon` to `<BookRibbon crossRefs>` and render `<CrossReferenceSheet>` with `openAt`, `set`, `close`. The reader (`BibleBookReader`) and the passage window (`VerseSheet`) are the two users.
- What shows is the person's choice on the device, `crossReferencePrefs.ts` (`show`, `inWindow`, `mode` main/all, `othersAsVerses`), set in the cross-reference section of the reader's "T" menu (`CrossReferenceSettings` passed as children to `FloatingTextScaleControls`). A passage window shows chips only with `inWindow`.
- The window of a verse's links (`CrossReferenceSheet`) shows the main links with their WHOLE text (never a line clamp — the owner's iPad, 2026-10-16) and folds the rest; opened, the rest's row carries a switch before its chevron: on, the rest read as verses with their text in the Bible's order (their books' texts fetched only then); off, as references by book. The switch is `othersAsVerses`, the same one as in the "T" menu. The window is `ReaderSheet`: 672 px on a tablet, a 448 px card on a wide screen.
- Main = at least three INDEPENDENT sources (`MAIN_REFERENCE_WEIGHT`). The weight is counted by families: TSK, TSK2 and OpenBible are one voice (OpenBible is 97% TSK), Pa and PP one, the Slovak Jerusalem Bible and the Studium Biblicum one.
- Rebuild the set from the modules (kept outside the repo, `~/MyProjects/bible-modules/crossreferences`): from `frontend/`, `node scripts/build-bible-crossrefs.mjs <modules folder> public/bible-crossrefs/v3`, change `BIBLE_CROSSREFS_VERSION` to `v3` and remove the old folder. The script refuses a folder that is not empty: a published set is never rewritten, the service worker keeps it forever (`app/sw.ts`, its own CacheFirst rule and cache `bible-crossrefs`).
- The merge rule lives in the script only: inside one target chapter a range within another melts into it (1–4 takes 2–3), overlapping ranges join, touching ranges stay apart; modules marked `requires_reverse_processing` get the other direction added; `russian_numbering` modules are moved to KJV first.

## Traps

- The set loads AFTER the book's text (`useBookCrossRefs`): fetched first, it took the reader's failed-network answer in `BibleBookReader.test` and the text loaded instead of the error — and on a weak network the text must not wait behind the links.
- Counting the chips moves ~150 000 places for the Psalter; `crossReferences.ts` remembers moved places (130 → 71 ms on a computer). Do not call `placesIn` per link elsewhere.
- The reader's text follows `--text-scale` now; a size change keeps the verse being read at the top (`useKeepPlaceOnTextScale` — the provider writes the size in its own effect, after the reader's, so the jump waits a frame).
- `CrossReferenceSheet` over the passage window (`z-[260]` over `z-[250]`) has its own focus trap; the window's trap yields to the topmost layer.
- "Open" moves the reader only after the window has closed (`useFollowAfterClose`, a frame later): on iOS the window pins the page and, released, scrolls it back — a jump made under it was undone. A desktop browser does not show this; only iOS does.
- A passage always ends inside its chapter. The modules write "Isaiah 52:13–53" for 52:13–53:12 and the numbering can carry an end into the next chapter (KJV Numbers 29:12–40 is Synodal 29:12–39 and 30:1): the builder cuts at the chapter's last verse (`lastVerse`), and so does the reader (`passageEnd`) — never back to the first verse. An anchor that is two KJV verses gives its links to both. The set-on-disk test checks all 735 451 links.

## Why

- 2026-10-15/16: the owner chose a count chip on every width, the settings under the text size in the "T" menu, and all fourteen modules as one set (case `.cases/2026-10-15-perekrestnye-ssylki-v-chitalke`, canvas https://claude.ai/artifact/36kE3nv1JyY1tw4ZibMA2s).
