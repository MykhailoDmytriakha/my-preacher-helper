import { placePreview, placeVerses } from '@/utils/placeText';

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
