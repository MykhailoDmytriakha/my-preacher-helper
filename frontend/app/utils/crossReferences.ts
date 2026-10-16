import { getBookIds, getLocalizedAbbrev } from '@/utils/bibleBooks';
import { bibleCrossRefsBase, isCrossRefsShaped, NUMBERS_PER_LINK } from '@/utils/bibleCrossRefsCache';
import { bookSlug } from '@/utils/bibleText';
import { placesIn, verseCount, type VersePlace } from '@/utils/versification';

import type { AppLocale } from '@/utils/appLocale';
import type { BibleId } from '@/utils/bibles';

/*
 * CROSS REFERENCES — "this verse, in the Bible being read → the places it points to, in the same Bible".
 *
 * The set is one file per book (`scripts/build-bible-crossrefs.mjs` makes it from the MyBible modules),
 * kept in the King James numbering. This module is the only reader of it: a screen asks for a verse in
 * its own Bible and gets places in that Bible; the numbering moves through `utils/versification`, never
 * by hand. A link's weight is how many independent sources give it; the main links are the ones at
 * least three of them agree on (on average three a verse — the owner chose to show those, 2026-10-15).
 */

/** The weight from which a link is a main one. */
export const MAIN_REFERENCE_WEIGHT = 3;

export type CrossRefsBook = { id: string; chapters: number[][][] };

export type CrossReference = {
  book: string;
  chapter: number;
  fromVerse: number;
  toVerse: number;
  /** How many independent sources give this link. */
  weight: number;
};

export type CrossReferenceCount = { main: number; total: number };

const SET_BIBLE: BibleId = 'kjv';

export const crossRefsUrl = (bookId: string): string => `${bibleCrossRefsBase}/${bookSlug(bookId)}.json`;

export const isMainReference = (reference: CrossReference): boolean => reference.weight >= MAIN_REFERENCE_WEIGHT;

const loaded = new Map<string, Promise<CrossRefsBook>>();

/**
 * A book's links, fetched once per visit. The service worker keeps the file on the device, so the
 * second visit reads it without the network. A failed or wrong answer is not remembered: the next
 * ask tries again.
 */
export function loadCrossRefs(bookId: string, fetchFn: typeof fetch = fetch): Promise<CrossRefsBook> {
  const known = loaded.get(bookId);
  if (known) return known;
  const pending = fetchFn(crossRefsUrl(bookId))
    .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`Cross references of ${bookId}: ${response.status}`))))
    .then((data: unknown) => {
      if (!isCrossRefsShaped(data) || data.id !== bookId) throw new Error(`Cross references of ${bookId}: not the book's set`);
      return data;
    });
  loaded.set(bookId, pending);
  pending.catch(() => loaded.delete(bookId));
  return pending;
}

/** Forgets what was fetched — for tests. */
export function forgetLoadedCrossRefs(): void {
  loaded.clear();
}

/**
 * A place moved between Bibles, remembered: the links of a book point at the same places again and
 * again, and the numbering never changes while the page lives. Counting the Psalter's chips in the
 * Synodal took 130 ms on a computer without it and 71 ms with it (2026-10-16).
 */
const movedPlaces = new Map<string, VersePlace[]>();
function moved(to: BibleId, from: BibleId, place: VersePlace): VersePlace[] {
  if (to === from) return [place];
  const key = `${to}|${from}|${place.book}|${place.chapter}|${place.verse}`;
  let found = movedPlaces.get(key);
  if (!found) {
    found = placesIn(to, from, place);
    movedPlaces.set(key, found);
  }
  return found;
}

/** The links of one King James verse, as the set keeps them. */
export function linksAt(book: CrossRefsBook, place: VersePlace): CrossReference[] {
  const numbers = book.chapters[place.chapter - 1]?.[place.verse - 1];
  if (!numbers) return [];
  const ids = getBookIds();
  const found: CrossReference[] = [];
  for (let index = 0; index + NUMBERS_PER_LINK <= numbers.length; index += NUMBERS_PER_LINK) {
    const id = ids[numbers[index]];
    if (!id) continue;
    found.push({ book: id, chapter: numbers[index + 1], fromVerse: numbers[index + 2], toVerse: numbers[index + 3], weight: numbers[index + 4] });
  }
  return found;
}

/**
 * Where a passage moved to `bible` ends. A passage stays within its chapter: an end the numbering
 * moved into the next chapter (KJV Numbers 29:12–40 is Synodal 29:12–39 and 30:1) ends at the last
 * verse of the start's chapter, never collapses to the first verse; an end with no place in `bible`
 * leaves the first verse alone.
 */
function passageEnd(bible: BibleId, start: VersePlace, end: VersePlace | undefined): number {
  if (!end || end.book !== start.book || end.chapter < start.chapter) return start.verse;
  if (end.chapter > start.chapter) return verseCount(bible, start.book, start.chapter);
  return Math.max(end.verse, start.verse);
}

/**
 * The links of a verse of `bible`, as places of `bible`, strongest first and then in the Bible's
 * order. A verse that holds two verses of the King James (a psalm's title and its first words) has
 * the links of both; a link found twice keeps its larger weight.
 */
export function crossReferencesAt(book: CrossRefsBook, bible: BibleId, place: VersePlace): CrossReference[] {
  const sources = moved(SET_BIBLE, bible, place);
  const byPlace = new Map<string, CrossReference>();
  for (const source of sources) {
    if (source.book !== book.id) continue;
    for (const link of linksAt(book, source)) {
      const start = moved(bible, SET_BIBLE, { book: link.book, chapter: link.chapter, verse: link.fromVerse })[0];
      if (!start) continue;
      const end = moved(bible, SET_BIBLE, { book: link.book, chapter: link.chapter, verse: link.toVerse }).at(-1);
      const reference: CrossReference = {
        book: start.book,
        chapter: start.chapter,
        fromVerse: start.verse,
        toVerse: passageEnd(bible, start, end),
        weight: link.weight,
      };
      // A verse pointing at itself is no link.
      if (reference.book === place.book && reference.chapter === place.chapter && reference.fromVerse <= place.verse && place.verse <= reference.toVerse) continue;
      const key = `${reference.book}|${reference.chapter}|${reference.fromVerse}|${reference.toVerse}`;
      const known = byPlace.get(key);
      if (!known || known.weight < reference.weight) byPlace.set(key, reference);
    }
  }
  const order = getBookIds();
  return [...byPlace.values()].sort((a, b) =>
    b.weight - a.weight || order.indexOf(a.book) - order.indexOf(b.book) || a.chapter - b.chapter || a.fromVerse - b.fromVerse);
}

/**
 * How many links each verse of a book has, main and all — keyed `"chapter:verse"` in `bible`. The
 * chapters are the book's text in `bible` (only their lengths are read).
 */
export function countCrossReferences(book: CrossRefsBook, bible: BibleId, chapters: readonly (readonly unknown[])[]): Map<string, CrossReferenceCount> {
  const counts = new Map<string, CrossReferenceCount>();
  chapters.forEach((verses, chapterIndex) => {
    for (let verse = 1; verse <= verses.length; verse += 1) {
      const references = crossReferencesAt(book, bible, { book: book.id, chapter: chapterIndex + 1, verse });
      if (references.length === 0) continue;
      counts.set(`${chapterIndex + 1}:${verse}`, { main: references.filter(isMainReference).length, total: references.length });
    }
  });
  return counts;
}

/** A link that covers its whole chapter is named by the chapter alone: "Иер 46". */
export function coversChapter(reference: CrossReference, bible: BibleId): boolean {
  return reference.fromVerse === 1 && reference.toVerse >= verseCount(bible, reference.book, reference.chapter);
}

/** The link as the reader names places: the book's short name in the interface's language, the numbers of the Bible read. */
export function crossReferenceLabel(reference: CrossReference, bible: BibleId, locale: AppLocale): string {
  const book = getLocalizedAbbrev(reference.book, locale);
  if (coversChapter(reference, bible)) return `${book} ${reference.chapter}`;
  const verses = reference.toVerse > reference.fromVerse ? `${reference.fromVerse}-${reference.toVerse}` : String(reference.fromVerse);
  return `${book} ${reference.chapter}:${verses}`;
}
