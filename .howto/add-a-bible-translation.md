when: add a Bible translation · another Bible · new translation in the reader · Greek text · versification · verse numbering differs between Bibles · Psalm 23 is Psalm 22 · same verse in another translation · map a verse between Bibles · placesIn · placeIn · numberings.ts · chapter count differs (Joel 4) · MyBible module · build-bible-text · bibletags · Strong numbers audit · добавить перевод Библии · новый перевод · нумерация стихов · сопоставление стихов между переводами · тот же стих в другом переводе · греческий текст · псалом 22 и 23

# Add a Bible translation

A Bible is one entry keyed by its own id, never by its language: its text, its numbering and its order of books hang on the id. A place is found in another Bible through the original (Hebrew and Greek): `placesIn(to, from, place)` in `frontend/app/utils/versification`.

## How

1. Text. Take its MyBible module (SQLite, outside the repository) and run `node scripts/build-bible-text.mjs <module.SQLite3> public/bible-text/<id>/v1` from `frontend/`. It refuses to write unless every book has contiguous verses; an existing folder is never rewritten — a changed text goes to `v2` and its version in `app/utils/bibleTextCache.ts`.
2. Registry. Add the id to `BIBLE_IDS` and `BIBLES` in `app/utils/bibles.ts` (language of the text, order of books, text folder) and the version in `bibleTextCache.ts`. If its order of books is new, add it to `components/bible/bookOrder.ts` (`booksOf`).
3. Numbering. Describe it in `app/utils/versification/numberings.ts`: which table each chapter of the original takes (`base`, `psalms`, `chapters`) and the edition's own exceptions in the tables' syntax. Derive it from the text, chapter by chapter, against the original's verse counts — not from what the language usually does: Ohienko numbers the Psalter as the Synodal and the rest as the original.
4. Prove it. `npx jest __tests__/utils/versification.test.ts` checks every chapter's verse count against the committed text, that every verse has a source in the original, and that no verse is fed from two chapters (the check that found two holes of the Synodal table: Ps 90:6 and the title of Ps 142). For a module with Strong numbers, `BIBLE_MODULES_DIR=<folder> npx jest __tests__/utils/versification.audit.test.ts` compares the Strong numbers of every mapped pair; extend `FILES` there.
5. Names. `bible.translations.<id>.{name,language}` in all three locales, in the edition's own language.
6. Look. In the reader, switch to it at a psalm (Ps 22/23), at Joel 2:28 / 3:1, at Rom 16:25 and at Mal 4 — the places where numberings part.

## Traps

- `getChapterCount` in `studies/bibleData.ts` is the King James count; a Bible's own count is `chapterCount(bible, book)` (Joel has 4 chapters in Ohienko).
- The tables come from bibletags-versification (MIT, `THIRD_PARTY_NOTICES.md`); regenerate them with `scripts/build-versification.mjs`, never by hand.
- Study-note references still use the chapter-only psalm convention of `bibleData` (BUG-20261012-psalm-verse-numbering-not-mapped): moving them onto `placesIn` changes how stored references read and waits for the owner's decision.

## Why

- 2026-10-14: the owner asked for the Synodal, Ohienko and King James with the same place kept on a switch, by Bible and not by language, ready for a Greek text later. Same-number mapping put 1 746 Synodal verses on the wrong King James verse; through the original, none.
