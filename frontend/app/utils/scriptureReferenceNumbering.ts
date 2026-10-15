import { detectTextLocale, type AppLocale } from '@/utils/appLocale';
import { bibleForLocale, isBibleId, type BibleId } from '@/utils/bibles';
import { chapterCount, placesIn, verseCount, type VersePlace } from '@/utils/versification';

import type { ScriptureRefShape } from '@/utils/scriptureReference';

/**
 * WHICH BIBLE A REFERENCE IS NUMBERED BY.
 *
 * A reference is kept the way it was written, with the Bible it was written in (`bible`), and read
 * in the Bible of whoever reads it: "Пс 50:12" written by the Synodal is "Ps 51:10" in the King
 * James, the same verse ("Create in me a clean heart"). The mapping is `utils/versification`,
 * through the Hebrew and Greek original, so a new Bible needs no table to every other. Nothing
 * here looks at the interface language except to name the Bible a person writes in.
 */

/** The Bible a person writes and reads references in: the one in the interface's language. */
export const referenceBibleFor = (locale: AppLocale): BibleId => bibleForLocale(locale);

/** The Bible AI prompts and machine comparison read references in, with the English book names. */
export const CANONICAL_BIBLE: BibleId = 'kjv';

/**
 * How references were kept before they knew their Bible: a Russian or Ukrainian Psalm chapter
 * moved up by one for Psalms 9–146 and the verses left as typed, so "Пс 50:12" was kept as
 * Psalms 51:12 and "Пс 147" as Psalms 148. This undoes the move; it is the old rule's own inverse,
 * not a numbering of any Bible, and 148 stays 148 because the old rule sent Psalms 147 and 148 there.
 */
const typedPsalmChapter = (stored: number): number => (stored >= 10 && stored <= 147 ? stored - 1 : stored);

/**
 * A reference written before references knew their Bible. It was typed in the interface's
 * language and kept with that one change (`typedPsalmChapter`). Read back in the Bible it was
 * typed in, Russian and Ukrainian get the chapter they typed again; an English one is the King
 * James as it stands. A reference that names its Bible is returned as is.
 */
export function withStoredBible<T extends ScriptureRefShape>(ref: T, typedIn: AppLocale): T {
  if (isBibleId(ref.bible)) return ref;
  const bible = referenceBibleFor(typedIn);
  if (typedIn === 'en' || ref.book !== 'Psalms') return { ...ref, bible };
  return {
    ...ref,
    bible,
    ...(ref.chapter !== undefined ? { chapter: typedPsalmChapter(ref.chapter) } : {}),
    ...(ref.toChapter !== undefined ? { toChapter: typedPsalmChapter(ref.toChapter) } : {}),
  };
}

type NoteText = { title?: string; content?: string; scriptureRefs?: readonly ScriptureRefShape[] };

/**
 * The language a note's old references were typed in: the language of its own words — stable,
 * and known on the server too — or, for a note that has no words, the reader's.
 */
export function noteLanguage(note: Pick<NoteText, 'title' | 'content'>, fallback: AppLocale): AppLocale {
  const text = `${note.title ?? ''} ${note.content ?? ''}`;
  return /\p{L}/u.test(text) ? detectTextLocale(text) : fallback;
}

/**
 * A note as it is read: every reference names its Bible. Done once where a note comes out of
 * storage — the screens, the server routes and the public link all read through it — so no
 * screen meets a reference without one. The note is returned unchanged when nothing is old.
 */
export function withNoteReferenceBibles<T extends NoteText>(note: T, fallback: AppLocale): T {
  const refs = note.scriptureRefs;
  if (!refs?.length || refs.every((ref) => isBibleId(ref.bible))) return note;
  const typedIn = noteLanguage(note, fallback);
  return { ...note, scriptureRefs: refs.map((ref) => withStoredBible(ref, typedIn)) };
}

const withoutPlace = <T extends ScriptureRefShape>(ref: T): T => {
  const rest = { ...ref };
  delete rest.chapter;
  delete rest.toChapter;
  delete rest.fromVerse;
  delete rest.toVerse;
  return rest;
};

/** Every verse the reference covers in its own Bible, in order. */
function versesOf(bible: BibleId, ref: ScriptureRefShape & { chapter: number }): VersePlace[] {
  const { book, chapter } = ref;
  if (ref.fromVerse !== undefined) {
    const last = Math.min(ref.toVerse ?? ref.fromVerse, verseCount(bible, book, chapter));
    return Array.from({ length: Math.max(0, last - ref.fromVerse + 1) }, (_, i) => ({ book, chapter, verse: ref.fromVerse! + i }));
  }
  // A range is read up to the book's last chapter: "Откр 22-999999999999" is not a billion chapters to walk.
  const last = Math.min(ref.toChapter ?? chapter, chapterCount(bible, book));
  const chapters = Array.from({ length: Math.max(1, last - chapter + 1) }, (_, i) => chapter + i);
  return chapters.flatMap((c) => Array.from({ length: verseCount(bible, book, c) }, (_, i) => ({ book, chapter: c, verse: i + 1 })));
}

/**
 * The verses that hold the reference in another Bible, in order. When they fall in chapters with a
 * gap between them, only the chapter holding most of them is kept: Romans 16 of the King James is
 * Romans 16 of the Synodal, its last three verses standing there in chapter 14 — "Romans 14-16"
 * would name a chapter the reference never touched.
 */
function versesThere(to: BibleId, from: BibleId, verses: VersePlace[]): VersePlace[] {
  const there = [...new Map(verses.flatMap((place) => placesIn(to, from, place)).map((place) => [place.chapter * 1_000 + place.verse, place])).entries()]
    .sort(([a], [b]) => a - b)
    .map(([, place]) => place);
  const chapters = [...new Set(there.map((place) => place.chapter))];
  if (chapters.every((chapter, i) => i === 0 || chapter === chapters[i - 1] + 1)) return there;
  const count = (chapter: number) => there.filter((place) => place.chapter === chapter).length;
  const main = chapters.reduce((best, chapter) => (count(chapter) > count(best) ? chapter : best));
  return there.filter((place) => place.chapter === main);
}

/**
 * Every verse the reference covers, as the Bible `to` numbers them, in order: "Пс 50:12" of the
 * Synodal is Ps 51:10 in the King James, a whole Psalm keeps all its verses across the renumbering,
 * and — as everywhere — a verse wins over a chapter range left beside it. A reference with no Bible
 * or no chapter covers nothing.
 */
export function versesHeldIn(ref: ScriptureRefShape, to: BibleId): VersePlace[] {
  const from = ref.bible;
  if (!isBibleId(from) || ref.chapter === undefined) return [];
  const verses = versesOf(from, { ...ref, chapter: ref.chapter });
  return from === to ? verses : versesThere(to, from, verses);
}

/**
 * The same reference in another Bible. A verse or a range of verses becomes the verses that hold
 * it there (Пс 50:12 → Ps 51:10); a whole chapter stays a whole chapter where it is one there
 * (Пс 22 → Ps 23) and becomes its verses where it is a part (Пс 114 → Ps 116:1-9). A range that
 * falls across two chapters there is given as those chapters (Пс 9:20-25 → Ps 9-10). A place the
 * reference's own Bible does not have is left as it was written, and so is a reference with no Bible.
 */
export function referenceIn<T extends ScriptureRefShape>(ref: T, to: BibleId): T {
  const from = ref.bible;
  if (!isBibleId(from) || from === to || ref.chapter === undefined) return ref;

  const { book } = ref;
  const held = versesHeldIn(ref, to);
  const start = held[0];
  const end = held.at(-1);
  if (!start || !end) return ref;

  const there = { ...withoutPlace(ref), bible: to };
  if (start.chapter !== end.chapter) return { ...there, chapter: start.chapter, toChapter: end.chapter };
  const wholeChapter = ref.fromVerse === undefined && start.verse === 1 && end.verse === verseCount(to, book, end.chapter);
  if (wholeChapter) return { ...there, chapter: start.chapter };
  return { ...there, chapter: start.chapter, fromVerse: start.verse, ...(end.verse !== start.verse ? { toVerse: end.verse } : {}) };
}

/** Whether two references name the same place, whichever Bibles they were written in. */
export function sameScriptureReference(a: ScriptureRefShape, b: ScriptureRefShape): boolean {
  const left = referenceIn(a, CANONICAL_BIBLE);
  const right = referenceIn(b, CANONICAL_BIBLE);
  return left.book === right.book
    && left.chapter === right.chapter
    && (left.toChapter ?? left.chapter) === (right.toChapter ?? right.chapter)
    && left.fromVerse === right.fromVerse
    && (left.toVerse ?? left.fromVerse) === (right.toVerse ?? right.fromVerse);
}
