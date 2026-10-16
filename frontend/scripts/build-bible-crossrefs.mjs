#!/usr/bin/env node
/**
 * Builds the app's cross-reference set from MyBible cross-reference modules (`*.crossreferences.SQLite3`).
 *
 * Usage: node scripts/build-bible-crossrefs.mjs <folder with the modules> public/bible-crossrefs/v1
 *
 * Every module is a list of links "verse → passage". The modules overlap heavily, so the script makes
 * ONE set of them (the owner, 2026-10-15: "a set, not a list"):
 *   1. One numbering. A module says whether it counts verses the Russian way (`info.russian_numbering`);
 *      such places are moved to the King James numbering through the app's own `utils/versification`,
 *      so the reader can move them on to whatever Bible is read.
 *   2. Both directions. A module marked `requires_reverse_processing` stores a link one way only;
 *      the other way is added, as MyBible does.
 *   3. One place, one link. Inside one target chapter a range lying within another melts into it
 *      (1–4 takes 2–3), ranges that overlap join (1–2 and 2–3 give 1–3), ranges that only touch stay
 *      apart (Isaiah 11:15 and 11:16 are two thoughts).
 *   4. A weight. How many INDEPENDENT sources give the link: modules that copy one another count once
 *      (OpenBible is 97% and TSK2 87% the TSK; Pa and PP agree on 95–99%; the Slovak Jerusalem Bible and
 *      the Studium Biblicum on 53–76% — measured on these modules 2026-10-15).
 *
 * The output is one file per book, `<slug>.json`: `{ id, chapters }`, where `chapters[c-1][v-1]` is the
 * flat list `[book, chapter, from, to, weight, …]` of the links of King James verse c:v — `book` the
 * index in the app's book list, strongest first. A folder is never rewritten: a changed set goes to `v2`
 * and its version in `app/utils/bibleCrossRefsCache.ts`, because the service worker keeps files forever.
 */
import { mkdirSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const [modulesDir, outDir] = process.argv.slice(2);
if (!modulesDir || !outDir) {
  console.error('Usage: node scripts/build-bible-crossrefs.mjs <folder with *.crossreferences.SQLite3> <output folder>');
  process.exit(2);
}
if (existsSync(outDir) && readdirSync(outDir).length > 0) {
  console.error(`${outDir} is not empty: a published set is never rewritten — write the next version folder.`);
  process.exit(2);
}

// The app's numbering and book list, read from its own TypeScript (jiti arrives with Tailwind).
const frontend = resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(join(frontend, 'package.json'));
const jiti = require('jiti')(join(frontend, 'app'), { alias: { '@': join(frontend, 'app') }, interopDefault: true });
const { placesIn, chapterCount, verseCount } = jiti('./utils/versification/index.ts');
const { getBookIds } = jiti('./utils/bibleBooks.ts');

const BOOK_IDS = getBookIds();
// MyBible's book numbers for the 66 books, in the app's order. Other numbers (the deuterocanon some
// modules carry) have no text in the app and are left out.
const MYBIBLE_NUMBERS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 190, 220, 230, 240, 250, 260,
  290, 300, 310, 330, 340, 350, 360, 370, 380, 390, 400, 410, 420, 430, 440, 450, 460,
  470, 480, 490, 500, 510, 520, 530, 540, 550, 560, 570, 580, 590, 600, 610, 620, 630, 640, 650, 660, 670, 680, 690, 700, 710, 720, 730];
if (MYBIBLE_NUMBERS.length !== BOOK_IDS.length) throw new Error('The MyBible book table does not match the app\'s book list');
const bookOfNumber = new Map(MYBIBLE_NUMBERS.map((number, index) => [number, BOOK_IDS[index]]));
const bookIndex = new Map(BOOK_IDS.map((id, index) => [id, index]));

/** Modules that copy one another are one voice. Keyed by the module's short name (its file name before `.crossreferences`). */
const FAMILY = {
  'TSK-x': 'TSK', 'TSK2-x': 'TSK', OBX: 'TSK',
  'Pa-x': 'NT quotations', 'PP-x': 'NT quotations',
  'Jeruz-x': 'Jerusalem', '思高圣经-x': 'Jerusalem',
};

const toNumber = (value) => Number.parseInt(value, 10) || 0;
const toKjv = (bible, place) => (bible === 'kjv' ? [place] : placesIn('kjv', bible, place));
const inKjv = (place) => place.chapter >= 1 && place.chapter <= chapterCount('kjv', place.book)
  && place.verse >= 1 && place.verse <= verseCount('kjv', place.book, place.chapter);

// anchor "book|chapter|verse" → target "book|chapter" → [{ from, to, sources }]
const links = new Map();
const add = (anchor, target, from, to, source) => {
  const anchorKey = `${anchor.book}|${anchor.chapter}|${anchor.verse}`;
  let byChapter = links.get(anchorKey);
  if (!byChapter) links.set(anchorKey, (byChapter = new Map()));
  const chapterKey = `${target.book}|${target.chapter}`;
  if (!byChapter.has(chapterKey)) byChapter.set(chapterKey, []);
  byChapter.get(chapterKey).push({ from, to, source });
};

const report = [];
const files = readdirSync(modulesDir).filter((file) => file.endsWith('.crossreferences.SQLite3')).sort();
if (files.length === 0) throw new Error(`No *.crossreferences.SQLite3 in ${modulesDir}`);
for (const file of files) {
  const source = file.slice(0, -'.crossreferences.SQLite3'.length);
  const db = new DatabaseSync(join(modulesDir, file), { readOnly: true });
  const info = Object.fromEntries(db.prepare('select name, value from info').all().map((row) => [row.name, row.value]));
  const bible = info.russian_numbering === 'true' ? 'rst' : 'kjv';
  const reverse = info.requires_reverse_processing === 'true';
  let read = 0;
  let skipped = 0;
  for (const row of db.prepare('select * from cross_references').iterate()) {
    const from = bookOfNumber.get(toNumber(row.book));
    const to = bookOfNumber.get(toNumber(row.book_to));
    const anchor = { book: from, chapter: toNumber(row.chapter), verse: toNumber(row.verse) };
    const target = { book: to, chapter: toNumber(row.chapter_to), verse: toNumber(row.verse_to_start) };
    if (!from || !to || !anchor.chapter || !anchor.verse || !target.chapter || !target.verse) { skipped += 1; continue; }
    read += 1;
    const anchorEnd = Math.max(toNumber(row.verse_end), anchor.verse);
    const targetEnd = Math.max(toNumber(row.verse_to_end), target.verse);
    const pairs = [[anchor, target, targetEnd]];
    if (reverse) pairs.push([target, anchor, anchorEnd]);
    for (const [place, start, endVerse] of pairs) {
      const anchorKjv = toKjv(bible, place)[0];
      const startKjv = toKjv(bible, start)[0];
      const endKjv = toKjv(bible, { ...start, verse: endVerse }).at(-1);
      if (!anchorKjv || !startKjv || !endKjv || !inKjv(anchorKjv) || !inKjv(startKjv)) { skipped += 1; continue; }
      // A passage runs within one chapter; one that crosses into the next ends with its first chapter.
      const last = endKjv.book === startKjv.book && endKjv.chapter === startKjv.chapter
        ? Math.max(endKjv.verse, startKjv.verse)
        : verseCount('kjv', startKjv.book, startKjv.chapter);
      // A verse pointing at itself is no link.
      if (anchorKjv.book === startKjv.book && anchorKjv.chapter === startKjv.chapter && startKjv.verse <= anchorKjv.verse && anchorKjv.verse <= last) continue;
      add(anchorKjv, startKjv, startKjv.verse, last, source);
    }
  }
  db.close();
  report.push(`${source.padEnd(14)} ${bible} ${reverse ? 'both ways' : 'one way  '} read ${String(read).padStart(7)} skipped ${skipped}`);
}

/** One target chapter: a range within another melts into it, overlapping ranges join, touching ones stay apart. */
function merge(ranges) {
  const sorted = [...ranges].sort((a, b) => a.from - b.from || b.to - a.to);
  const out = [];
  for (const range of sorted) {
    const last = out.at(-1);
    if (last && range.from <= last.to) {
      last.to = Math.max(last.to, range.to);
      last.sources.add(range.source);
    } else {
      out.push({ from: range.from, to: range.to, sources: new Set([range.source]) });
    }
  }
  return out;
}

mkdirSync(outDir, { recursive: true });
let total = 0;
let bytes = 0;
for (const bookId of BOOK_IDS) {
  const chapters = [];
  for (let chapter = 1; chapter <= chapterCount('kjv', bookId); chapter += 1) {
    const verses = [];
    for (let verse = 1; verse <= verseCount('kjv', bookId, chapter); verse += 1) {
      const byChapter = links.get(`${bookId}|${chapter}|${verse}`);
      const found = [];
      for (const [chapterKey, ranges] of byChapter ?? []) {
        const [targetBook, targetChapter] = chapterKey.split('|');
        for (const range of merge(ranges)) {
          const weight = new Set([...range.sources].map((name) => FAMILY[name] ?? name)).size;
          found.push([bookIndex.get(targetBook), Number(targetChapter), range.from, range.to, weight]);
        }
      }
      found.sort((a, b) => b[4] - a[4] || a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
      total += found.length;
      verses.push(found.flat());
    }
    chapters.push(verses);
  }
  const json = JSON.stringify({ id: bookId, chapters });
  bytes += Buffer.byteLength(json);
  writeFileSync(join(outDir, `${bookId.toLowerCase().replace(/\s+/g, '-')}.json`), json);
}

console.log(report.join('\n'));
console.log(`${files.length} modules → ${total} links in ${BOOK_IDS.length} books, ${(bytes / 1e6).toFixed(1)} MB`);
