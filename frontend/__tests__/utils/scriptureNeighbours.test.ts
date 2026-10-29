import { chaptersAround, movedReference, versesAround, verseStep } from '@/utils/scriptureNeighbours';

const spots = (list: { chapter: number; verse: number }[]) => list.map(({ chapter, verse }) => `${chapter}:${verse}`);

describe('scriptureNeighbours', () => {
  it('steps across a chapter edge and stops at the book ends', () => {
    expect(verseStep('rst', 'Isaiah', { chapter: 40, verse: 31 }, 1)).toEqual({ chapter: 41, verse: 1 });
    expect(verseStep('rst', 'Isaiah', { chapter: 41, verse: 1 }, -1)).toEqual({ chapter: 40, verse: 31 });
    expect(verseStep('rst', 'Genesis', { chapter: 1, verse: 1 }, -1)).toBeNull();
    expect(verseStep('rst', 'Isaiah', { chapter: 66, verse: 24 }, 1)).toBeNull();
  });

  it('lists five verses up and five down, crossing into the next chapter', () => {
    expect(spots(versesAround('rst', 'Isaiah', { chapter: 40, verse: 31 }))).toEqual([
      '40:26', '40:27', '40:28', '40:29', '40:30', '40:31', '41:1', '41:2', '41:3', '41:4', '41:5',
    ]);
  });

  it('gives fewer at the start of a book and in a book of one chapter', () => {
    expect(spots(versesAround('rst', 'Genesis', { chapter: 1, verse: 2 }))).toEqual(['1:1', '1:2', '1:3', '1:4', '1:5', '1:6', '1:7']);
    expect(spots(versesAround('rst', 'Jude', { chapter: 1, verse: 25 }))).toEqual(['1:20', '1:21', '1:22', '1:23', '1:24', '1:25']);
  });

  it('counts the verses in the Bible it is given: Psalm 118 of the Synodal is long, Psalm 118 of the King James short', () => {
    expect(spots(versesAround('rst', 'Psalms', { chapter: 118, verse: 29 }, 1))).toEqual(['118:28', '118:29', '118:30']);
    expect(spots(versesAround('kjv', 'Psalms', { chapter: 118, verse: 29 }, 1))).toEqual(['118:28', '118:29', '119:1']);
  });

  it('lists the chapters around a chapter inside the book', () => {
    expect(chaptersAround('rst', 'Isaiah', 40)).toEqual([35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45]);
    expect(chaptersAround('rst', 'Isaiah', 64)).toEqual([59, 60, 61, 62, 63, 64, 65, 66]);
    expect(chaptersAround('rst', 'Jude', 1)).toEqual([1]);
  });

  describe('movedReference', () => {
    it('moves one verse to another, keeping its id and naming the Bible it is counted in', () => {
      expect(movedReference({ id: 'r1', bible: 'kjv', book: 'Isaiah', chapter: 40, fromVerse: 31 }, 'rst', 'Isaiah', { chapter: 41, verse: 2 }))
        .toEqual({ id: 'r1', bible: 'rst', book: 'Isaiah', chapter: 41, fromVerse: 2 });
    });

    it('keeps the stretch a reference covers, cut at the chapter end', () => {
      const three = { id: 'r1', bible: 'rst' as const, book: 'Isaiah', chapter: 40, fromVerse: 29, toVerse: 31 };
      expect(movedReference(three, 'rst', 'Isaiah', { chapter: 41, verse: 2 })).toEqual({ id: 'r1', bible: 'rst', book: 'Isaiah', chapter: 41, fromVerse: 2, toVerse: 4 });
      expect(movedReference(three, 'rst', 'Isaiah', { chapter: 41, verse: 29 })).toEqual({ id: 'r1', bible: 'rst', book: 'Isaiah', chapter: 41, fromVerse: 29 });
    });

    it('moves whole chapters as chapters, cut at the book end, and a verse to another book', () => {
      const chapters = { id: 'r2', bible: 'rst' as const, book: 'Isaiah', chapter: 40, toChapter: 41 };
      expect(movedReference(chapters, 'rst', 'Isaiah', { chapter: 43 })).toEqual({ id: 'r2', bible: 'rst', book: 'Isaiah', chapter: 43, toChapter: 44 });
      expect(movedReference(chapters, 'rst', 'Isaiah', { chapter: 66 })).toEqual({ id: 'r2', bible: 'rst', book: 'Isaiah', chapter: 66 });
      expect(movedReference({ id: 'r3', bible: 'rst', book: 'Isaiah', chapter: 40, fromVerse: 31 }, 'rst', 'Romans', { chapter: 8, verse: 28 }))
        .toEqual({ id: 'r3', bible: 'rst', book: 'Romans', chapter: 8, fromVerse: 28 });
    });
  });
});
