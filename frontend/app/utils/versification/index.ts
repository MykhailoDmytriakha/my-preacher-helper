import { getBookIds } from '@/utils/bibleBooks';

import { NUMBERINGS, type Numbering, type TableId } from './numberings';
import { KJV_TABLE, ORIGINAL_VERSE_COUNTS, SYNODAL_TABLE, type NumberingRule } from './tables';

import type { BibleId } from '@/utils/bibles';

/**
 * ONE PLACE IN EVERY BIBLE. Bibles number chapters and verses differently — Psalm 23 of the King
 * James is Psalm 22 of the Synodal, Romans 16:25 of the one is Romans 14:24 of the other — so a
 * place read in one Bible is found in another through the original (Hebrew and Greek) they all
 * translate: the place → the verses of the original it holds → where those stand in the other.
 * Each Bible's numbering is described once (`numberings.ts`) on top of shared tables (`tables.ts`);
 * a new Bible is one more description, not a table to every other.
 */
export type VersePlace = { book: string; chapter: number; verse: number };

const TABLES: Record<Exclude<TableId, 'original'>, Readonly<Record<string, NumberingRule>>> = { synodal: SYNODAL_TABLE, kjv: KJV_TABLE };
// Book numbers in the tables are the King James order, which is the order of the app's book list.
const BOOK_IDS = getBookIds();
const PSALMS = BOOK_IDS.indexOf('Psalms') + 1;

/** BBCCCVVV as a number: book × 1 000 000 + chapter × 1 000 + verse. */
const toLoc = (book: number, chapter: number, verse: number) => book * 1_000_000 + chapter * 1_000 + verse;
const chapterOf = (loc: number) => Math.floor(loc / 1_000);
const fromLoc = (loc: number): VersePlace => ({
  book: BOOK_IDS[Math.floor(loc / 1_000_000) - 1],
  chapter: Math.floor(loc / 1_000) % 1_000,
  verse: loc % 1_000,
});

type Rules = {
  exact: Map<number, number[]>;
  ranges: Map<number, { from: number; to: number; rule: NumberingRule }[]>;
};

/** Where a rule's value puts the verse at `loc`. A title the tables number verse 0 is verse 1 here. */
const target = (rule: NumberingRule, loc: number): number => {
  const at = typeof rule === 'number' ? loc + rule : Number(rule.slice(0, 8));
  return at % 1_000 === 0 ? at + 1 : at;
};

function collectRules(numbering: Numbering): Rules {
  const own = Object.entries(numbering.exceptions ?? {});
  const ownChapters = new Set(own.map(([key]) => key.slice(0, 5)));
  const tableOf = (chapterKey: string): TableId =>
    numbering.chapters?.[chapterKey] ?? (Number(chapterKey.slice(0, 2)) === PSALMS && numbering.psalms ? numbering.psalms : numbering.base);
  const entries: [string, NumberingRule][] = [];
  for (const [id, table] of Object.entries(TABLES) as [TableId, Readonly<Record<string, NumberingRule>>][]) {
    for (const entry of Object.entries(table)) {
      const chapterKey = entry[0].slice(0, 5);
      if (tableOf(chapterKey) === id && !ownChapters.has(chapterKey)) entries.push(entry);
    }
  }
  entries.push(...own);
  const rules: Rules = { exact: new Map(), ranges: new Map() };
  for (const [key, rule] of entries) {
    const loc = Number(key.slice(0, 8));
    const range = /^\d{8}-(\d{3})$/.exec(key);
    if (range) {
      const list = rules.ranges.get(chapterOf(loc)) ?? [];
      list.push({ from: loc % 1_000, to: Number(range[1]), rule });
      rules.ranges.set(chapterOf(loc), list);
      continue;
    }
    // "BBCCCVVV" or a part of it, "BBCCCVVV:W1-W2": every part adds a verse the original one lands on.
    const list = rules.exact.get(loc) ?? [];
    list.push(target(rule, loc));
    rules.exact.set(loc, list);
  }
  return rules;
}

type Compiled = {
  /** A verse of the original → the verses of this Bible that hold it. */
  forward: Map<number, number[]>;
  /** A verse of this Bible → the verses of the original it holds. */
  inverse: Map<number, number[]>;
  /** Verses per chapter, by BBCCC. */
  verses: Map<number, number>;
};

function compile(numbering: Numbering): Compiled {
  const rules = collectRules(numbering);
  const forward = new Map<number, number[]>();
  const inverse = new Map<number, number[]>();
  const verses = new Map<number, number>();
  ORIGINAL_VERSE_COUNTS.forEach((chapters, bookIndex) => chapters.forEach((count, chapterIndex) => {
    for (let verse = 1; verse <= count; verse += 1) {
      const loc = toLoc(bookIndex + 1, chapterIndex + 1, verse);
      const range = rules.ranges.get(chapterOf(loc))?.find((entry) => verse >= entry.from && verse <= entry.to);
      const targets = [...new Set(rules.exact.get(loc) ?? (range ? [target(range.rule, loc)] : [loc]))].sort((a, b) => a - b);
      forward.set(loc, targets);
      for (const at of targets) {
        const sources = inverse.get(at) ?? [];
        sources.push(loc);
        inverse.set(at, sources);
        verses.set(chapterOf(at), Math.max(verses.get(chapterOf(at)) ?? 0, at % 1_000));
      }
    }
  }));
  return { forward, inverse, verses };
}

const compiled = new Map<BibleId, Compiled>();
/** Built on first use, about 31 000 verses a Bible, and kept. */
const numberingOf = (bible: BibleId): Compiled => {
  let entry = compiled.get(bible);
  if (!entry) {
    entry = compile(NUMBERINGS[bible]);
    compiled.set(bible, entry);
  }
  return entry;
};

const bookNumber = (bookId: string) => BOOK_IDS.indexOf(bookId) + 1;

/** How many chapters the book has in this Bible (Joel has 4 in Ohienko, 3 in the Synodal). */
export function chapterCount(bible: BibleId, bookId: string): number {
  const book = bookNumber(bookId);
  if (!book) return 0;
  const { verses } = numberingOf(bible);
  let chapter = 0;
  while (verses.has(chapterOf(toLoc(book, chapter + 1, 1)))) chapter += 1;
  return chapter;
}

/** How many verses the chapter has in this Bible; 0 when there is no such chapter. */
export function verseCount(bible: BibleId, bookId: string, chapter: number): number {
  const book = bookNumber(bookId);
  return book ? numberingOf(bible).verses.get(chapterOf(toLoc(book, chapter, 1))) ?? 0 : 0;
}

/**
 * Every verse of `to` that holds the place read in `from`, in order — one verse mostly, two where
 * `to` divides what `from` keeps whole. Empty when `from` has no such verse.
 */
export function placesIn(to: BibleId, from: BibleId, place: VersePlace): VersePlace[] {
  const book = bookNumber(place.book);
  if (!book || place.verse < 1 || place.verse > verseCount(from, place.book, place.chapter)) return [];
  if (to === from) return [place];
  const source = numberingOf(from);
  // A verse the original does not have (none in the three Bibles now) stands for the nearest one before it.
  let loc = toLoc(book, place.chapter, place.verse);
  while (!source.inverse.has(loc) && loc % 1_000 > 1) loc -= 1;
  const origins = source.inverse.get(loc);
  if (!origins) return [];
  const { forward } = numberingOf(to);
  // A verse of the original divided into as many parts in both Bibles: part for part (Neh 7:68–69
  // of the King James are the Synodal 7:68–69). Kept whole in one of them: all its parts.
  const found = origins.flatMap((origin) => {
    const here = source.forward.get(origin) ?? [];
    const there = forward.get(origin) ?? [];
    const part = here.indexOf(loc);
    return part >= 0 && here.length > 1 && here.length === there.length ? [there[part]] : there;
  });
  return [...new Set(found)].sort((a, b) => a - b).map(fromLoc);
}

/** The first verse of `to` that holds the place: where a reader opens. */
export function placeIn(to: BibleId, from: BibleId, place: VersePlace): VersePlace | null {
  return placesIn(to, from, place)[0] ?? null;
}

/** The place in several Bibles at once: "Ps 22:1 of the Synodal — in Ohienko and the King James". */
export function placesInEach(targets: readonly BibleId[], from: BibleId, place: VersePlace): Partial<Record<BibleId, VersePlace[]>> {
  return Object.fromEntries(targets.map((to) => [to, placesIn(to, from, place)]));
}

/** For tests and audits: every verse of a Bible and the verses of the original it holds. */
export function numberingEntries(bible: BibleId): [VersePlace, VersePlace[]][] {
  return [...numberingOf(bible).inverse].map(([loc, origins]) => [fromLoc(loc), origins.map(fromLoc)]);
}

