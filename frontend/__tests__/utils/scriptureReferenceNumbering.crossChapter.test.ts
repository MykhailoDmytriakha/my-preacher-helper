import { referenceIn, versesHeldIn } from '@/utils/scriptureReferenceNumbering';

describe('referenceIn preserves a verse run across chapters', () => {
  it('maps a partial run to its exact first and last verses instead of whole chapters', () => {
    const written = { bible: 'rst' as const, book: 'Psalms', chapter: 9, fromVerse: 20, toVerse: 25 };
    const mapped = referenceIn(written, 'kjv');
    expect(mapped).toEqual({ bible: 'kjv', book: 'Psalms', chapter: 9, fromVerse: 19, endChapter: 10, toVerse: 4 });
    expect(versesHeldIn(mapped, 'kjv')).toEqual(versesHeldIn(written, 'kjv'));
    expect(referenceIn(mapped, 'rst')).toEqual(written);
  });

  it('retains an existing cross-chapter run when the target Bible numbers it the same way', () => {
    const written = { bible: 'rst' as const, book: 'Ephesians', chapter: 4, fromVerse: 31, toVerseChapter: 5, toVerse: 2 };
    expect(referenceIn(written, 'kjv')).toEqual({ bible: 'kjv', book: 'Ephesians', chapter: 4, fromVerse: 31, endChapter: 5, toVerse: 2 });
  });

  it('keeps whole chapters as whole chapters', () => {
    expect(referenceIn({ bible: 'rst', book: 'Psalms', chapter: 9 }, 'kjv'))
      .toEqual({ bible: 'kjv', book: 'Psalms', chapter: 9, toChapter: 10 });
  });
});
