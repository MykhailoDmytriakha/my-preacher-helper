import { bookIndex, pickedPassage, stretchPassage, versesBetween } from '@/components/bible/verseCopy/passagePick';

import type { BookText } from '@/utils/bibleText';

// Two chapters; 1:5 is the first chapter's last verse.
const BOOK: BookText = {
  id: 'Test',
  chapters: [
    ['one', 'two', 'three', 'four', 'five'],
    ['six', 'seven'],
  ],
};
const v = (chapter: number, verse: number) => ({ chapter, verse });

describe('passagePick — a passage for an analysis is one piece of text', () => {
  it('counts verses through the whole book and lists the verses between two, across a chapter', () => {
    expect(bookIndex(BOOK, v(2, 1))).toBe(5);
    expect(versesBetween(BOOK, v(1, 4), v(2, 1))).toEqual([v(1, 4), v(1, 5), v(2, 1)]);
  });

  it('stretches to a verse below or above, and takes off an end verse', () => {
    expect(stretchPassage(BOOK, [v(1, 3)], v(1, 5)).verses).toEqual([v(1, 3), v(1, 4), v(1, 5)]);
    expect(stretchPassage(BOOK, [v(1, 3), v(1, 4)], v(1, 1)).verses).toEqual([v(1, 1), v(1, 2), v(1, 3), v(1, 4)]);
    expect(stretchPassage(BOOK, [v(1, 3), v(1, 4), v(1, 5)], v(1, 5)).verses).toEqual([v(1, 3), v(1, 4)]);
    expect(stretchPassage(BOOK, [v(1, 3), v(1, 4), v(1, 5)], v(1, 3)).verses).toEqual([v(1, 4), v(1, 5)]);
  });

  it('keeps a single verse when it is pressed again, and refuses a verse in the middle', () => {
    expect(stretchPassage(BOOK, [v(1, 3)], v(1, 3))).toEqual({ verses: [v(1, 3)], inside: false });
    expect(stretchPassage(BOOK, [v(1, 3), v(1, 4), v(1, 5)], v(1, 4))).toEqual({ verses: [v(1, 3), v(1, 4), v(1, 5)], inside: true });
  });

  it('stretches across a chapter and names the passage first verse to last', () => {
    const verses = stretchPassage(BOOK, [v(1, 4)], v(2, 2)).verses;
    expect(pickedPassage(BOOK, verses)).toEqual({ chapter: 1, fromVerse: 4, toChapter: 2, toVerse: 2 });
  });
});
