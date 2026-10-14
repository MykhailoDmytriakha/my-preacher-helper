#!/usr/bin/env node
/**
 * Converts a MyBible module (SQLite) into one JSON file per book for the Bible section.
 *
 * Usage: node scripts/build-bible-text.mjs <module.SQLite3> [outDir]
 *   default outDir: public/bible-text/rst/v1
 *
 * The output is committed: the module itself lives outside the repository. A text change
 * gets a new version folder (v2, …) because the service worker keeps these files forever
 * (`bible-text` cache in app/sw.ts) — a file under an old address is never re-read.
 *
 * Output shape per book: { "id": "<canonical English id>", "source": <module book number>, "chapters": [["verse 1", …], …] }
 * A verse that opens a paragraph starts with "¶". Inline markup kept: <i>…</i> (words the
 * translators added) and <J>…</J> (words of Jesus); "\n" is a line break. Everything else
 * (Strong numbers, footnote marks, style tags) is dropped.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// MyBible numbers its books in this order; the ids are BookInfo.id in bibleData.ts. This script
// cannot import the app's TypeScript, so the list and the slug rule below are copies — kept in step
// by __tests__/utils/bibleText.test.ts, which fails unless the files are exactly one per book of
// bibleData.ts, named by the app's bookSlug, with that book's id and chapter count.
const BOOK_IDS = [
  'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy', 'Joshua', 'Judges', 'Ruth',
  '1 Samuel', '2 Samuel', '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles', 'Ezra',
  'Nehemiah', 'Esther', 'Job', 'Psalms', 'Proverbs', 'Ecclesiastes', 'Song of Solomon',
  'Isaiah', 'Jeremiah', 'Lamentations', 'Ezekiel', 'Daniel', 'Hosea', 'Joel', 'Amos',
  'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk', 'Zephaniah', 'Haggai', 'Zechariah',
  'Malachi', 'Matthew', 'Mark', 'Luke', 'John', 'Acts', 'Romans', '1 Corinthians',
  '2 Corinthians', 'Galatians', 'Ephesians', 'Philippians', 'Colossians', '1 Thessalonians',
  '2 Thessalonians', '1 Timothy', '2 Timothy', 'Titus', 'Philemon', 'Hebrews', 'James',
  '1 Peter', '2 Peter', '1 John', '2 John', '3 John', 'Jude', 'Revelation',
];

const bookSlug = (id) => id.toLowerCase().replace(/\s+/g, '-');

const cleanVerse = (raw) => {
  const opensParagraph = raw.trimStart().startsWith('<pb/>');
  const text = raw
    .replace(/<S>.*?<\/S>/g, '')
    .replace(/<f>.*?<\/f>/g, '')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<(?!\/?(?:i|J)>)[^>]*>/g, '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
  return opensParagraph ? `¶${text}` : text;
};

const main = () => {
  const [modulePath, outArg] = process.argv.slice(2);
  if (!modulePath) {
    console.error('Usage: node scripts/build-bible-text.mjs <module.SQLite3> [outDir]');
    process.exit(1);
  }
  const outDir = resolve(outArg ?? 'public/bible-text/rst/v1');
  const db = new DatabaseSync(resolve(modulePath), { readOnly: true });

  const numbers = db.prepare('SELECT DISTINCT book_number AS n FROM verses ORDER BY book_number').all().map((r) => r.n);
  if (numbers.length !== BOOK_IDS.length) {
    throw new Error(`Expected ${BOOK_IDS.length} books, the module has ${numbers.length}`);
  }

  // Everything is built and checked first; nothing is written unless every book passes.
  const verseRows = db.prepare('SELECT chapter, verse, text FROM verses WHERE book_number = ? ORDER BY chapter, verse');
  const chapterCount = db.prepare('SELECT MAX(chapter) AS n FROM verses WHERE book_number = ?');
  let total = 0;
  const books = numbers.map((number, index) => {
    const id = BOOK_IDS[index];
    const chapters = [];
    for (const { chapter, verse, text } of verseRows.all(number)) {
      if (!chapters[chapter - 1]) chapters[chapter - 1] = [];
      const list = chapters[chapter - 1];
      if (verse !== list.length + 1) {
        throw new Error(`${id} ${chapter}:${verse} does not follow verse ${list.length}`);
      }
      list.push(cleanVerse(text));
      total += 1;
    }
    // A plain loop: `some` skips the holes of a sparse array, so a missing chapter would pass it.
    const expected = chapterCount.get(number).n;
    if (chapters.length !== expected) throw new Error(`${id}: ${chapters.length} chapters, expected ${expected}`);
    for (let index = 0; index < chapters.length; index++) {
      if (!Array.isArray(chapters[index]) || chapters[index].length === 0) throw new Error(`${id} has no chapter ${index + 1}`);
    }
    // `source` is the module's own number of the book: MyBible numbers books in canonical order, so
    // the test can prove that every id got its own text (a swap in BOOK_IDS breaks that order).
    return { file: join(outDir, `${bookSlug(id)}.json`), content: JSON.stringify({ id, source: number, chapters }) };
  });

  // An address never gets a different text: devices keep these files forever. A changed text goes
  // to a new version folder (and its version in app/utils/bibleTextCache.ts moves with it).
  const changed = books.filter(({ file, content }) => existsSync(file) && readFileSync(file, 'utf8') !== content);
  if (changed.length > 0) {
    throw new Error(`${changed.length} file(s) in ${outDir} would change — write the new text to a new version folder instead`);
  }
  mkdirSync(outDir, { recursive: true });
  for (const { file, content } of books) writeFileSync(file, content);
  console.log(`Wrote ${books.length} books, ${total} verses to ${outDir}`);
};

main();
