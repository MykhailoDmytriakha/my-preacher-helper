import { placeLine, placePreview, placeShown, placeVerses } from '@/utils/placeText';

import type { BookText } from '@/utils/bibleText';

/** A Synodal Psalter in miniature: each verse says where it stands. */
const synodalPsalms = (): BookText => ({
  id: 'Psalms',
  chapters: Array.from({ length: 151 }, (_, c) => Array.from({ length: 30 }, (__, v) => `¶Пс ${c + 1}:${v + 1}`)),
} as unknown as BookText);

describe('a place read in another Bible', () => {
  it('reads a King James place in the Synodal by the Synodal numbers: Psalm 23:4 is Пс 22:4', () => {
    expect(placeVerses(synodalPsalms(), { bible: 'kjv', book: 'Psalms', chapter: 23, fromVerse: 4 }, 'rst'))
      .toEqual([{ chapter: 22, verse: 4, words: 'Пс 22:4' }]);
  });

  it('shows a run whole up to the limit, then «…»', () => {
    const run = { bible: 'rst' as const, book: 'Psalms', chapter: 22, fromVerse: 1, toVerse: 3 };
    expect(placePreview(synodalPsalms(), run, 'rst', 8)).toBe('Пс 22:1 Пс 22:2 Пс 22:3');
    expect(placePreview(synodalPsalms(), run, 'rst', 2)).toBe('Пс 22:1 Пс 22:2 …');
  });

  it('has no words while the book text has not come', () => {
    expect(placePreview(undefined, { bible: 'kjv', book: 'Psalms', chapter: 23 }, 'rst', 2)).toBeNull();
  });
});

// The owner, 2026-11-10 and 2026-11-11: a place is numbered as the words beside it number it. Its name and its words
// come from one Bible, said once — the verse window and the comment window each split them before.
describe('a place shown over a Bible\'s text', () => {
  const shepherd = { bible: 'kjv' as const, book: 'Psalms', chapter: 23, fromVerse: 4 };

  it('names it and reads it in the one Bible the screen shows', () => {
    expect(placeShown(shepherd, 'rst', { text: synodalPsalms(), locale: 'ru' }))
      .toEqual({ name: 'Пс.22:4', verses: [{ chapter: 22, verse: 4, words: 'Пс 22:4' }] });
  });

  it('hands a screen\'s own way of naming that same Bible', () => {
    const name = jest.fn(() => 'Пс 22:4');
    placeShown(shepherd, 'rst', { text: synodalPsalms(), locale: 'ru', name });
    expect(name).toHaveBeenCalledWith(shepherd, 'rst');
  });

  it('says a run on one line: its first verse, then «…» and its last', () => {
    const run = placeShown({ bible: 'rst', book: 'Psalms', chapter: 22, fromVerse: 1, toVerse: 3 }, 'rst', { text: synodalPsalms(), locale: 'ru' });
    expect(placeLine(run.verses)).toBe('Пс 22:1 … Пс 22:3');
    expect(placeLine(run.verses.slice(0, 1))).toBe('Пс 22:1');
    expect(placeLine([])).toBe('');
  });
});
