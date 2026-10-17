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
 * and known on the server too — or, for a note that has no words, the reader's. Cyrillic with no
 * letter only one of the two languages has — "Любов понад усе" — could be either, and is read in
 * the reader's language when that is one of them (BUG-20261017-old-uk-note-read-as-russian: it was
 * read as Russian, and its author's old "Йоїл 3:1" showed as Ohienko 4:1). In the app a note is read
 * by its author alone, so that is the language they write in, the one their new references follow.
 * The server does not know it and still reads such a note as Russian
 * (BUG-20261017-server-reads-note-without-author-language).
 */
export function noteLanguage(note: Pick<NoteText, 'title' | 'content'>, fallback: AppLocale): AppLocale {
  const text = `${note.title ?? ''} ${note.content ?? ''}`;
  if (!/\p{L}/u.test(text)) return fallback;
  const language = detectTextLocale(text);
  return language === 'ru' && fallback === 'uk' && !/[ыэъё]/iu.test(text) ? 'uk' : language;
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

/** The verses that hold the given verses in another Bible, each once, in order — none dropped. */
function versesThere(to: BibleId, from: BibleId, verses: VersePlace[]): VersePlace[] {
  return [...new Map(verses.flatMap((place) => placesIn(to, from, place)).map((place) => [place.chapter * 1_000 + place.verse, place])).entries()]
    .sort(([a], [b]) => a - b)
    .map(([, place]) => place);
}

/**
 * Every verse the reference covers, as the Bible `to` numbers them, in order: "Пс 50:12" of the
 * Synodal is Ps 51:10 in the King James, a whole Psalm keeps all its verses across the renumbering,
 * King James Romans 16:24-27 is Synodal 14:24-26 and 16:24, and — as everywhere — a verse wins over
 * a chapter range left beside it. A reference with no Bible or no chapter covers nothing.
 */
export function versesHeldIn(ref: ScriptureRefShape, to: BibleId): VersePlace[] {
  const from = ref.bible;
  if (!isBibleId(from) || ref.chapter === undefined) return [];
  const verses = versesOf(from, { ...ref, chapter: ref.chapter });
  return from === to ? verses : versesThere(to, from, verses);
}

/**
 * A PASSAGE — a stretch of one Bible, from `chapter`:`fromVerse` to `toChapter`:`toVerse`, or whole
 * chapters `chapter`–`toChapter` when it has no verses. Unlike the stored shape it may run from a verse
 * of one chapter into the next: Synodal "Пс 9:20-25" is Ps 9:19-10:4 of the King James (the owner,
 * 2026-10-17: "9:19–10:4 is fine"). It is what a reference is printed and compared by, never stored.
 */
export type Passage = { chapter: number; toChapter: number; fromVerse?: number; toVerse?: number };

/** The passage a reference names as it is written: a verse wins over a chapter range left beside it. */
function passageAsWritten(ref: ScriptureRefShape & { chapter: number }): Passage {
  if (ref.fromVerse !== undefined) return { chapter: ref.chapter, toChapter: ref.chapter, fromVerse: ref.fromVerse, toVerse: ref.toVerse ?? ref.fromVerse };
  return { chapter: ref.chapter, toChapter: ref.toChapter ?? ref.chapter };
}

/**
 * What the reference covers in the Bible `to`, as passages in order — one, unless a gap parts its
 * verses there: King James Romans 16:24-27 is Synodal 14:24-26 and 16:24. A whole chapter stays whole
 * where it is whole there (Пс 22 → Ps 23, Пс 9 → Ps 9-10) and becomes its verses where it is a part
 * (Пс 114 → Ps 116:1-9). With no Bible to read it in, no Bible of its own, the same Bible, or a place
 * its Bible lacks, it is the passage as written; with no chapter, nothing.
 */
export function passagesIn(ref: ScriptureRefShape, to: BibleId | undefined): Passage[] {
  if (ref.chapter === undefined) return [];
  const written = passageAsWritten({ ...ref, chapter: ref.chapter });
  const from = ref.bible;
  if (!to || !isBibleId(from) || from === to) return [written];
  const held = versesHeldIn(ref, to);
  if (!held.length) return [written];

  const { book } = ref;
  const follows = (prev: VersePlace, next: VersePlace) => (next.chapter === prev.chapter
    ? next.verse === prev.verse + 1
    : next.chapter === prev.chapter + 1 && next.verse === 1 && prev.verse === verseCount(to, book, prev.chapter));
  const runs: VersePlace[][] = [];
  held.forEach((place, i) => {
    if (i > 0 && follows(held[i - 1], place)) runs.at(-1)!.push(place);
    else runs.push([place]);
  });
  return runs.map((run) => {
    const start = run[0];
    const end = run.at(-1)!;
    const whole = ref.fromVerse === undefined && start.verse === 1 && end.verse === verseCount(to, book, end.chapter);
    return whole
      ? { chapter: start.chapter, toChapter: end.chapter }
      : { chapter: start.chapter, toChapter: end.chapter, fromVerse: start.verse, toVerse: end.verse };
  });
}

/**
 * The verses that hold the reference there, kept to one chapter or to adjacent ones — what the stored
 * shape can say. When a gap parts them, the chapter holding most of them is kept: Romans 16 of the
 * King James is Romans 16 of the Synodal, its last three verses standing there in chapter 14 —
 * "Romans 14-16" would name chapter 15, which the reference never touched.
 */
function versesNameable(held: VersePlace[]): VersePlace[] {
  const chapters = [...new Set(held.map((place) => place.chapter))];
  if (chapters.every((chapter, i) => i === 0 || chapter === chapters[i - 1] + 1)) return held;
  const count = (chapter: number) => held.filter((place) => place.chapter === chapter).length;
  const main = chapters.reduce((best, chapter) => (count(chapter) > count(best) ? chapter : best));
  return held.filter((place) => place.chapter === main);
}

/**
 * The same reference in another Bible, in the stored shape — for a form that edits it (the picker).
 * A verse or a range of verses becomes the verses that hold it there (Пс 50:12 → Ps 51:10); a whole
 * chapter stays a whole chapter where it is one there (Пс 22 → Ps 23) and becomes its verses where it
 * is a part (Пс 114 → Ps 116:1-9). The shape has no verse range across a chapter seam, so a range
 * that falls across two chapters there is given as those chapters (Пс 9:20-25 → Ps 9-10) — print
 * and compare through `passagesIn`, which says Ps 9:19-10:4. A place the reference's own Bible does
 * not have is left as it was written, and so is a reference with no Bible.
 */
export function referenceIn<T extends ScriptureRefShape>(ref: T, to: BibleId): T {
  const from = ref.bible;
  if (!isBibleId(from) || from === to || ref.chapter === undefined) return ref;

  const { book } = ref;
  const held = versesNameable(versesHeldIn(ref, to));
  const start = held[0];
  const end = held.at(-1);
  if (!start || !end) return ref;

  const there = { ...withoutPlace(ref), bible: to };
  if (start.chapter !== end.chapter) return { ...there, chapter: start.chapter, toChapter: end.chapter };
  const wholeChapter = ref.fromVerse === undefined && start.verse === 1 && end.verse === verseCount(to, book, end.chapter);
  if (wholeChapter) return { ...there, chapter: start.chapter };
  return { ...there, chapter: start.chapter, fromVerse: start.verse, ...(end.verse !== start.verse ? { toVerse: end.verse } : {}) };
}

/**
 * Whether two references name the same place, whichever Bibles they were written in: the same verses
 * in the King James, a whole chapter being its verses from the first to the last — "Пс 9" and
 * "Пс 9:1-39" are one place.
 */
export function sameScriptureReference(a: ScriptureRefShape, b: ScriptureRefShape): boolean {
  if (a.book !== b.book) return false;
  const verses = (passage: Passage): Passage => (passage.fromVerse !== undefined ? passage
    : { ...passage, fromVerse: 1, toVerse: verseCount(CANONICAL_BIBLE, a.book, passage.toChapter) });
  const left = passagesIn(a, CANONICAL_BIBLE).map(verses);
  const right = passagesIn(b, CANONICAL_BIBLE).map(verses);
  return left.length === right.length && left.every((passage, i) => passage.chapter === right[i].chapter
    && passage.toChapter === right[i].toChapter && passage.fromVerse === right[i].fromVerse && passage.toVerse === right[i].toVerse);
}
