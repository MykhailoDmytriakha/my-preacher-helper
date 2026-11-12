import { verseWords, type BookText } from '@/utils/bibleText';
import { formatScriptureReference, type ScriptureRefShape } from '@/utils/scriptureReference';
import { versesHeldIn } from '@/utils/scriptureReferenceNumbering';

import type { AppLocale } from '@/utils/appLocale';
import type { BibleId } from '@/utils/bibles';

/**
 * A PLACE'S WORDS in the Bible read — one rule for every list that shows a reference with its
 * text: a verse's cross-references (`CrossReferenceSheet`), the word for the occasion, a comment's
 * place — and, through `placeShown`, the place's name beside them in that same Bible.
 *
 * Kept beside `bibleText.ts`, not in it: that file's bytes are part of the fingerprint of the
 * generated word-form data (`__tests__/utils/bibleSearch/wordFormsData.test.ts`), and a helper
 * added there would ask for the lexical data to be generated again for nothing.
 */

/** One verse of a place, as `placeVerses` reads it. */
export type PlaceVerse = { chapter: number; verse: number; words: string };

/**
 * The verses a place holds in the Bible read, with their words, from that Bible's text of the
 * place's book — numbered by `versesHeldIn`, so a place written by one Bible ("Psalm 23", King
 * James) is read in another ("Пс 22", Synodal). A verse the text lacks is left out.
 */
export function placeVerses(text: BookText | undefined, place: ScriptureRefShape, reading: BibleId): PlaceVerse[] {
  if (!text) return [];
  return versesHeldIn(place, reading).flatMap((at) => {
    const raw = text.chapters[at.chapter - 1]?.[at.verse - 1];
    return raw === undefined ? [] : [{ chapter: at.chapter, verse: at.verse, words: verseWords(raw) }];
  });
}

/** A place's words for a list: its first `shown` verses, and «…» after them when it holds more. */
export function versesPreview(verses: readonly PlaceVerse[], shown: number): string | null {
  if (!verses.length) return null;
  const words = verses.slice(0, shown).map((verse) => verse.words).join(' ');
  return verses.length > shown ? `${words} …` : words;
}

/** `versesPreview` of a place read from a Bible's text. */
export function placePreview(text: BookText | undefined, place: ScriptureRefShape, reading: BibleId, shown: number): string | null {
  return versesPreview(placeVerses(text, place, reading), shown);
}

/** A place's words on one line: its first verse, and «… its last» when it holds more — a comment's place under its title. */
export function placeLine(verses: readonly PlaceVerse[]): string {
  const [first] = verses;
  const last = verses.at(-1);
  if (!first || !last) return '';
  return first === last ? first.words : `${first.words} … ${last.words}`;
}

/**
 * A PLACE OVER A BIBLE'S TEXT — its name and its words, both in the one Bible the screen shows (the owner, 2026-11-10 and
 * 2026-11-11: a place is numbered as the text beside it numbers it — "Пс.23" over the King James a Russian reader chose).
 *
 * The numbering was never wrong; the pair was. A screen asked for the name and for the words in two calls and gave each
 * its own Bible, and the name's default — the Bible of the interface's language — split them silently: the verse window
 * titled King James Psalm 23 "Пс.22", the comment window named a place in the reader's Bible over the words of the
 * comment's own. Here the screen says its Bible once, and both come from it; a screen that names places its own way
 * (`name`) is handed that same Bible to name in.
 */
export function placeShown<P extends ScriptureRefShape>(
  place: P,
  bible: BibleId,
  { text, locale, name }: { text: BookText | undefined; locale: AppLocale; name?: (place: P, bible: BibleId) => string },
): { name: string; verses: PlaceVerse[] } {
  return {
    name: name ? name(place, bible) : formatScriptureReference(place, { locale, style: 'short', bible }),
    verses: placeVerses(text, place, bible),
  };
}
