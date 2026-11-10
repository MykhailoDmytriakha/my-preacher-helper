import { verseWords, type BookText } from '@/utils/bibleText';
import { versesHeldIn } from '@/utils/scriptureReferenceNumbering';

import type { BibleId } from '@/utils/bibles';
import type { ScriptureRefShape } from '@/utils/scriptureReference';

/**
 * A PLACE'S WORDS in the Bible read — one rule for every list that shows a reference with its
 * text: a verse's cross-references (`CrossReferenceSheet`) and the word for the occasion.
 *
 * Kept beside `bibleText.ts`, not in it: that file's bytes are part of the fingerprint of the
 * generated word-form data (`__tests__/utils/bibleSearch/wordFormsData.test.ts`), and a helper
 * added there would ask for the lexical data to be generated again for nothing.
 */

/**
 * The verses a place holds in the Bible read, with their words, from that Bible's text of the
 * place's book — numbered by `versesHeldIn`, so a place written by one Bible ("Psalm 23", King
 * James) is read in another ("Пс 22", Synodal). A verse the text lacks is left out.
 */
export function placeVerses(text: BookText | undefined, place: ScriptureRefShape, reading: BibleId): { chapter: number; verse: number; words: string }[] {
  if (!text) return [];
  return versesHeldIn(place, reading).flatMap((at) => {
    const raw = text.chapters[at.chapter - 1]?.[at.verse - 1];
    return raw === undefined ? [] : [{ chapter: at.chapter, verse: at.verse, words: verseWords(raw) }];
  });
}

/** A place's words for a list: its first `shown` verses, and «…» after them when it holds more. */
export function placePreview(text: BookText | undefined, place: ScriptureRefShape, reading: BibleId, shown: number): string | null {
  const verses = placeVerses(text, place, reading);
  if (!verses.length) return null;
  const words = verses.slice(0, shown).map((verse) => verse.words).join(' ');
  return verses.length > shown ? `${words} …` : words;
}
