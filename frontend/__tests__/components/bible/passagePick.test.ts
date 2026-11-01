import { bookIndex, pickedPassage, pulledEnd, pulledRow, stretchPassage, versesBetween } from '@/components/bible/verseCopy/passagePick';

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

  it('keeps a single verse when it is pressed again, and brings the nearer end to a verse in the middle', () => {
    expect(stretchPassage(BOOK, [v(1, 3)], v(1, 3))).toEqual({ verses: [v(1, 3)], end: null });
    const run = [v(1, 1), v(1, 2), v(1, 3), v(1, 4), v(1, 5)];
    // Nearer the first verse: the first verse moves down to it (the owner, 31.10: «первый стих тоже может меняться»).
    expect(stretchPassage(BOOK, run, v(1, 2))).toEqual({ verses: [v(1, 2), v(1, 3), v(1, 4), v(1, 5)], end: 'first' });
    // Nearer the last, or halfway: the last verse moves up to it.
    expect(stretchPassage(BOOK, run, v(1, 4))).toEqual({ verses: [v(1, 1), v(1, 2), v(1, 3), v(1, 4)], end: 'last' });
    expect(stretchPassage(BOOK, run, v(1, 3))).toEqual({ verses: [v(1, 1), v(1, 2), v(1, 3)], end: 'last' });
  });

  it('stretches across a chapter and names the passage first verse to last', () => {
    const verses = stretchPassage(BOOK, [v(1, 4)], v(2, 2)).verses;
    expect(pickedPassage(BOOK, verses)).toEqual({ chapter: 1, fromVerse: 4, toChapter: 2, toVerse: 2 });
  });

  it('pulls one end of the passage to a verse — never past the other end (a grip, phase 9)', () => {
    const run = [v(1, 2), v(1, 3), v(1, 4)];
    expect(pulledEnd(BOOK, run, 'last', v(2, 1))).toEqual([v(1, 2), v(1, 3), v(1, 4), v(1, 5), v(2, 1)]);
    expect(pulledEnd(BOOK, run, 'first', v(1, 1))).toEqual([v(1, 1), v(1, 2), v(1, 3), v(1, 4)]);
    expect(pulledEnd(BOOK, run, 'first', v(1, 3))).toEqual([v(1, 3), v(1, 4)]);
    expect(pulledEnd(BOOK, run, 'last', v(1, 1))).toEqual([v(1, 2)]);
    expect(pulledEnd(BOOK, run, 'first', v(2, 2))).toEqual([v(1, 4)]);
  });

  it('takes a verse for a pulled grip once the pointer is past its middle, down and up alike (the owner, 01.11)', () => {
    // Rows at 0–40, 40–100 (two lines), 100–140: middles 20, 70, 120.
    const middles = [20, 70, 120];
    expect(pulledRow(middles, 45, 'last')).toBe(0);
    expect(pulledRow(middles, 71, 'last')).toBe(1);
    expect(pulledRow(middles, 119, 'last')).toBe(1);
    expect(pulledRow(middles, 500, 'last')).toBe(2);
    expect(pulledRow(middles, 95, 'first')).toBe(2);
    expect(pulledRow(middles, 69, 'first')).toBe(1);
    expect(pulledRow(middles, -10, 'first')).toBe(0);
    expect(pulledRow([], 10, 'first')).toBe(-1);
  });
});
