import fs from 'fs';
import path from 'path';

import { engineNote } from '@/hooks/useStudyNotesEngine';
import { formatScriptureReference } from '@/utils/scriptureReference';
import {
  noteLanguage,
  referenceIn,
  sameScriptureReference,
  versesHeldIn,
  withNoteReferenceBibles,
  withStoredBible,
} from '@/utils/scriptureReferenceNumbering';

import type { BibleId } from '@/utils/bibles';
import type { ScriptureRefShape } from '@/utils/scriptureReference';

/** A verse of the committed text, to show that a mapped pair is the same verse and not a neighbour. */
function verseText(bible: BibleId, book: string, chapter: number, verse: number): string {
  const file = path.join(__dirname, '../../public/bible-text', bible, 'v1', `${book.toLowerCase().replace(/ /g, '-')}.json`);
  const data = JSON.parse(fs.readFileSync(file, 'utf8')) as { chapters: string[][] };
  return data.chapters[chapter - 1][verse - 1];
}

const ps = (bible: BibleId, chapter: number, fromVerse?: number, toVerse?: number): ScriptureRefShape => ({
  bible, book: 'Psalms', chapter, ...(fromVerse !== undefined ? { fromVerse } : {}), ...(toVerse !== undefined ? { toVerse } : {}),
});

describe('the verses a reference covers in a Bible', () => {
  it('gives them as that Bible numbers them, a whole Psalm all of it', () => {
    expect(versesHeldIn(ps('rst', 50, 12), 'kjv')).toEqual([{ book: 'Psalms', chapter: 51, verse: 10 }]);
    expect(versesHeldIn(ps('rst', 22), 'kjv').map((place) => place.chapter)).toEqual(Array(6).fill(23));
    expect(versesHeldIn(ps('rst', 22), 'rst')).toHaveLength(6);
  });

  it('walks a chapter range only as far as the book goes', () => {
    const ref = { bible: 'rst' as BibleId, book: 'Revelation', chapter: 21, toChapter: 999_999_999_999 };
    expect(new Set(versesHeldIn(ref, 'rst').map((place) => place.chapter))).toEqual(new Set([21, 22]));
    // The same reference compared or moved to another Bible no longer walks a billion chapters either.
    expect(referenceIn(ref, 'kjv')).toMatchObject({ chapter: 21, toChapter: 22 });
  });

  it('covers nothing without a Bible or a chapter', () => {
    expect(versesHeldIn({ book: 'Romans', chapter: 8 }, 'rst')).toEqual([]);
    expect(versesHeldIn({ bible: 'rst', book: 'Romans' }, 'rst')).toEqual([]);
  });
});

describe('a reference in another Bible', () => {
  it('finds the same verse, not the one with the same number', () => {
    expect(referenceIn(ps('rst', 50, 12), 'kjv')).toEqual(ps('kjv', 51, 10));
    expect(referenceIn(ps('kjv', 51, 10), 'rst')).toEqual(ps('rst', 50, 12));
    expect(verseText('rst', 'Psalms', 50, 12)).toMatch(/^¶?Сердце чистое/);
    expect(verseText('kjv', 'Psalms', 51, 10)).toMatch(/^¶?Create in me a clean heart/);
  });

  it('keeps a whole chapter whole where it is one chapter there', () => {
    expect(referenceIn(ps('rst', 22), 'kjv')).toEqual(ps('kjv', 23));
    expect(referenceIn(ps('kjv', 23), 'rst')).toEqual(ps('rst', 22));
    expect(referenceIn(ps('kjv', 51), 'rst')).toEqual(ps('rst', 50));
    expect(referenceIn(ps('rst', 50), 'kjv')).toEqual(ps('kjv', 51));
    expect(referenceIn(ps('rst', 22), 'ubio')).toEqual(ps('ubio', 22));
  });

  it('gives the chapters a merged psalm is divided into, and the verses of a divided one', () => {
    expect(referenceIn(ps('rst', 9), 'kjv')).toEqual({ bible: 'kjv', book: 'Psalms', chapter: 9, toChapter: 10 });
    expect(referenceIn(ps('rst', 113), 'kjv')).toEqual({ bible: 'kjv', book: 'Psalms', chapter: 114, toChapter: 115 });
    expect(referenceIn(ps('rst', 114), 'kjv')).toEqual(ps('kjv', 116, 1, 9));
    expect(referenceIn(ps('rst', 115), 'kjv')).toEqual(ps('kjv', 116, 10, 19));
    expect(referenceIn(ps('rst', 147), 'kjv')).toEqual(ps('kjv', 147, 12, 20));
    expect(referenceIn(ps('kjv', 147), 'rst')).toEqual({ bible: 'rst', book: 'Psalms', chapter: 146, toChapter: 147 });
  });

  it('moves a range into the chapter that holds it, and covers a range split across two chapters', () => {
    expect(referenceIn(ps('rst', 9, 22, 39), 'kjv')).toEqual(ps('kjv', 10, 1, 18));
    expect(referenceIn(ps('rst', 9, 20, 25), 'kjv')).toEqual({ bible: 'kjv', book: 'Psalms', chapter: 9, toChapter: 10 });
  });

  it('keeps a chapter whose verses stand in two chapters with a gap between as the chapter holding most of it', () => {
    // King James Romans 16:25-27 is Synodal Romans 14:24-26: "Romans 14-16" would name chapter 15.
    expect(referenceIn({ bible: 'kjv', book: 'Romans', chapter: 16 }, 'rst')).toEqual({ bible: 'rst', book: 'Romans', chapter: 16 });
    expect(referenceIn({ bible: 'rst', book: 'Romans', chapter: 14 }, 'kjv')).toEqual({ bible: 'kjv', book: 'Romans', chapter: 14 });
    expect(referenceIn({ bible: 'ubio', book: 'Romans', chapter: 16 }, 'rst')).toEqual({ bible: 'rst', book: 'Romans', chapter: 16 });
    expect(referenceIn({ bible: 'kjv', book: 'Romans', chapter: 16, fromVerse: 24, toVerse: 27 }, 'rst'))
      .toEqual({ bible: 'rst', book: 'Romans', chapter: 14, fromVerse: 24, toVerse: 26 });
  });

  it('maps the places where numberings part outside the Psalms', () => {
    const joel = { book: 'Joel', chapter: 2, fromVerse: 28 };
    expect(referenceIn({ ...joel, bible: 'rst' }, 'ubio')).toEqual({ book: 'Joel', bible: 'ubio', chapter: 3, fromVerse: 1 });
    expect(referenceIn({ ...joel, bible: 'rst' }, 'kjv')).toEqual({ ...joel, bible: 'kjv' });
    expect(referenceIn({ bible: 'kjv', book: 'Romans', chapter: 16, fromVerse: 25, toVerse: 27 }, 'rst'))
      .toEqual({ bible: 'rst', book: 'Romans', chapter: 14, fromVerse: 24, toVerse: 26 });
  });

  it('is the same verse where a verse boundary only moved by a few words, not it and its neighbour', () => {
    // "and I died" closes Rom 7:9 of the King James and opens 7:10 of the Synodal.
    const romans = (bible: 'rst' | 'kjv', fromVerse: number) => ({ bible, book: 'Romans', chapter: 7, fromVerse });
    expect(referenceIn(romans('rst', 10), 'kjv')).toEqual(romans('kjv', 10));
    expect(referenceIn(romans('kjv', 9), 'rst')).toEqual(romans('rst', 9));
    expect(referenceIn({ bible: 'kjv', book: 'Mark', chapter: 12, fromVerse: 15 }, 'rst')).toEqual({ bible: 'rst', book: 'Mark', chapter: 12, fromVerse: 15 });
    // A verse the other Bible divides in two is still both: Rev 20:9 of the King James.
    expect(referenceIn({ bible: 'kjv', book: 'Revelation', chapter: 20, fromVerse: 9 }, 'rst'))
      .toEqual({ bible: 'rst', book: 'Revelation', chapter: 20, fromVerse: 8, toVerse: 9 });
  });

  it('leaves alone what it cannot place: no Bible, its own Bible, a book alone, a verse that Bible lacks', () => {
    const legacy = { book: 'Psalms', chapter: 51, fromVerse: 12 };
    expect(referenceIn(legacy, 'rst')).toBe(legacy);
    const own = ps('rst', 50, 12);
    expect(referenceIn(own, 'rst')).toBe(own);
    const book = { bible: 'rst' as const, book: 'Psalms' };
    expect(referenceIn(book, 'kjv')).toBe(book);
    const missing = { bible: 'rst' as const, book: 'Romans', chapter: 16, fromVerse: 25 };
    expect(referenceIn(missing, 'kjv')).toBe(missing);
  });

  it('carries the rest of the stored reference along', () => {
    expect(referenceIn({ ...ps('rst', 50, 12), id: 'r1', text: 'Сердце чистое' } as ScriptureRefShape, 'kjv'))
      .toEqual({ ...ps('kjv', 51, 10), id: 'r1', text: 'Сердце чистое' });
  });
});

describe('a reference written before references knew their Bible', () => {
  // "Пс 50:12" typed in Russian was kept as Psalms 51:12: the chapter moved by one, the verse as typed.
  const old = { id: 'r1', book: 'Psalms', chapter: 51, fromVerse: 12 };

  it('is read back in the Bible it was typed in', () => {
    expect(withStoredBible(old, 'ru')).toEqual({ ...old, bible: 'rst', chapter: 50 });
    expect(withStoredBible(old, 'uk')).toEqual({ ...old, bible: 'ubio', chapter: 50 });
    expect(withStoredBible(old, 'en')).toEqual({ ...old, bible: 'kjv' });
  });

  it('gets the chapter the old rule moved, a chapter range too, and nothing else', () => {
    expect(withStoredBible({ book: 'Psalms', chapter: 5, toChapter: 24 }, 'ru')).toEqual({ book: 'Psalms', bible: 'rst', chapter: 5, toChapter: 23 });
    expect(withStoredBible({ book: 'Psalms', chapter: 148 }, 'ru')).toEqual({ book: 'Psalms', bible: 'rst', chapter: 148 });
    expect(withStoredBible({ book: 'Romans', chapter: 16, fromVerse: 25 }, 'ru')).toEqual({ book: 'Romans', bible: 'rst', chapter: 16, fromVerse: 25 });
  });

  it('then reads right in every other Bible: the verse an English reader and the AI get', () => {
    expect(referenceIn(withStoredBible(old, 'ru'), 'kjv')).toEqual({ ...old, bible: 'kjv', chapter: 51, fromVerse: 10 });
  });

  it('is left alone once it names its Bible', () => {
    const named = { ...ps('kjv', 23), id: 'r2' };
    expect(withStoredBible(named, 'ru')).toBe(named);
  });
});

describe('the language a note’s old references were typed in', () => {
  // The owner, 2026-10-17: "a Ukrainian interface — the Ukrainian Bible". The old picker moved a Psalm by
  // the interface's language, and it names the Bible a person uses — the one their new references follow.
  it('is the language the author’s interface speaks, whatever the note’s words look like', () => {
    expect(noteLanguage({ title: 'Любов понад усе', content: '' }, 'uk')).toBe('uk');
    expect(noteLanguage({ title: 'Иисус любит', content: '' }, 'uk')).toBe('uk');
    expect(noteLanguage({ title: 'Покаяние', content: '' }, 'en')).toBe('en');
    expect(noteLanguage({ content: 'Серце чисте створи мені, Боже' }, 'ru')).toBe('ru');
    // BUG-20261017-old-uk-note-read-as-russian: a Ukrainian title with none of і, ї, є, ґ read as Russian,
    // and the note's old "Йоїл 3:1" became Synodal 3:1 — Ohienko 4:1, another verse, for its own author.
    const [ref] = withNoteReferenceBibles({ title: 'Любов понад усе', content: '', scriptureRefs: [{ book: 'Joel', chapter: 3, fromVerse: 1 }] }, 'uk').scriptureRefs;
    expect(ref).toEqual({ book: 'Joel', bible: 'ubio', chapter: 3, fromVerse: 1 });
  });

  it('is the language of the note’s words where the author’s is not known, and English for a note with none', () => {
    expect(noteLanguage({ title: 'Покаяние', content: '' })).toBe('ru');
    expect(noteLanguage({ content: 'Серце чисте створи мені, Боже' })).toBe('uk');
    expect(noteLanguage({ content: 'A clean heart' })).toBe('en');
    expect(noteLanguage({ title: '', content: '  12 ' })).toBe('en');
  });

  it('names the Bible of every old reference of a note, and leaves a note with nothing old as it is', () => {
    const note = { title: 'Покаяние', content: 'Пс 50:12', scriptureRefs: [{ id: 'r1', book: 'Psalms', chapter: 51, fromVerse: 12 }, { ...ps('kjv', 23), id: 'r2' }] };
    expect(withNoteReferenceBibles(note, 'ru').scriptureRefs).toEqual([
      { id: 'r1', bible: 'rst', book: 'Psalms', chapter: 50, fromVerse: 12 },
      { ...ps('kjv', 23), id: 'r2' },
    ]);
    // An English interface did not move the Psalm: the number stands as the King James's.
    expect(withNoteReferenceBibles(note, 'en').scriptureRefs[0]).toEqual({ id: 'r1', bible: 'kjv', book: 'Psalms', chapter: 51, fromVerse: 12 });
    const current = { title: 'x', scriptureRefs: [{ ...ps('rst', 50), id: 'r3' }] };
    expect(withNoteReferenceBibles(current, 'en')).toBe(current);
    const none = { title: 'x', scriptureRefs: [] };
    expect(withNoteReferenceBibles(none, 'en')).toBe(none);
  });
});

describe('two references to the same place', () => {
  it('match whichever Bibles they were written in', () => {
    expect(sameScriptureReference(ps('rst', 50, 12), ps('kjv', 51, 10))).toBe(true);
    expect(sameScriptureReference(ps('rst', 50, 12), ps('kjv', 51, 12))).toBe(false);
    expect(sameScriptureReference(ps('rst', 22), ps('kjv', 23))).toBe(true);
    expect(sameScriptureReference({ bible: 'rst', book: 'Romans', chapter: 7, fromVerse: 10 }, { bible: 'kjv', book: 'Romans', chapter: 7, fromVerse: 10 })).toBe(true);
    expect(sameScriptureReference({ book: 'John', chapter: 3, fromVerse: 16, toVerse: 16 }, { book: 'John', chapter: 3, fromVerse: 16 })).toBe(true);
  });
});

describe('a reference on the screen — BUG-20261012-psalm-verse-numbering-not-mapped', () => {
  it('a new one: its author sees what was typed, an English screen and the AI the same verse', () => {
    const typed = { bible: 'rst' as const, book: 'Psalms', chapter: 50, fromVerse: 12 };
    expect(formatScriptureReference(typed, { locale: 'ru' })).toBe('Пс.50:12');
    expect(formatScriptureReference(typed, { locale: 'uk' })).toBe('Пс.50:12');
    expect(formatScriptureReference(typed, { locale: 'en', style: 'long' })).toBe('Psalms 51:10');
    expect(formatScriptureReference(typed, { style: 'canonical' })).toBe('Psalms 51:10');
  });

  it('an old one, read through its note: unchanged for its author, the right verse for everyone else', () => {
    // "Пс 50:12" typed in a Russian interface before references kept their Bible: stored as Psalms 51:12.
    // Its author's screen is Russian; read there, it names the Synodal, and every other Bible follows.
    const stored = { userId: 'u', title: 'Покаяние', content: 'Сердце чистое', scriptureRefs: [{ id: 'r1', book: 'Psalms', chapter: 51, fromVerse: 12 }] };
    const [ref] = engineNote(stored, 'n1', 'ru').scriptureRefs;
    expect(formatScriptureReference(ref, { locale: 'ru' })).toBe('Пс.50:12');
    expect(formatScriptureReference(ref, { locale: 'en', style: 'long' })).toBe('Psalms 51:10');
    expect(formatScriptureReference(ref, { style: 'canonical' })).toBe('Psalms 51:10');
  });

  it('an old one that never passed through a note is shown as it always was', () => {
    const stored = { book: 'Psalms', chapter: 23 };
    expect(formatScriptureReference(stored, { locale: 'ru' })).toBe('Пс.22');
    expect(formatScriptureReference(stored, { locale: 'en' })).toBe('Ps.23');
    expect(formatScriptureReference(stored, { style: 'canonical' })).toBe('Psalms 23');
  });
});

// BUG-20261017-reference-across-chapters-in-other-bible: a reference whose verses fall in two chapters of
// another Bible was printed as those whole chapters, or lost the chapter holding fewer of its verses.
describe('a reference whose verses fall in two chapters of another Bible', () => {
  const psalm9 = { bible: 'rst' as const, book: 'Psalms', chapter: 9, fromVerse: 20, toVerse: 25 };
  const doxology = { bible: 'kjv' as const, book: 'Romans', chapter: 16, fromVerse: 24, toVerse: 27 };

  it('is printed from its first verse to its last across the seam (the owner: "9:19–10:4 is fine")', () => {
    expect(formatScriptureReference(psalm9, { locale: 'en', style: 'long' })).toBe('Psalms 9:19-10:4');
    expect(formatScriptureReference(psalm9, { style: 'canonical' })).toBe('Psalms 9:19-10:4');
    expect(formatScriptureReference(psalm9, { locale: 'ru' })).toBe('Пс.9:20-25');
  });

  it('is printed in every piece when a gap parts them, none dropped', () => {
    expect(formatScriptureReference(doxology, { locale: 'ru', style: 'long' })).toBe('К Римлянам 14:24-26, 16:24');
    expect(formatScriptureReference({ bible: 'kjv', book: 'Romans', chapter: 16 }, { locale: 'ru', style: 'long' })).toBe('К Римлянам 14:24-26, 16');
  });

  it('covers every one of its verses there', () => {
    expect(versesHeldIn(doxology, 'rst').map((place) => `${place.chapter}:${place.verse}`)).toEqual(['14:24', '14:25', '14:26', '16:24']);
    expect(versesHeldIn(psalm9, 'kjv').map((place) => `${place.chapter}:${place.verse}`)).toEqual(['9:19', '9:20', '10:1', '10:2', '10:3', '10:4']);
  });

  it('is not the same place as the whole chapters around it', () => {
    expect(sameScriptureReference(psalm9, { bible: 'kjv', book: 'Psalms', chapter: 9, toChapter: 10 })).toBe(false);
    expect(sameScriptureReference(psalm9, { ...psalm9 })).toBe(true);
    expect(sameScriptureReference({ bible: 'kjv', book: 'Romans', chapter: 16, fromVerse: 25, toVerse: 27 }, { bible: 'rst', book: 'Romans', chapter: 14, fromVerse: 24, toVerse: 26 })).toBe(true);
  });

  it('is the same place as its whole chapter written out verse by verse', () => {
    expect(sameScriptureReference(ps('rst', 9), ps('rst', 9, 1, 39))).toBe(true);
    expect(sameScriptureReference(ps('rst', 113), ps('rst', 113, 1, 26))).toBe(true);
    expect(sameScriptureReference(ps('rst', 9), ps('rst', 9, 1, 38))).toBe(false);
  });
});
