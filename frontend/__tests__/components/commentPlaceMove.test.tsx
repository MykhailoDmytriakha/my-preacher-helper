import { act, renderHook } from '@testing-library/react';

import { useBookTexts } from '@/components/bible/useBookTexts';
import { readerPlaceName } from '@/components/bible/ReaderCommentDialog';
import { useCommentPlace } from '@/components/CommentPlaceMove';
import { versesHeldIn } from '@/utils/scriptureReferenceNumbering';
import { verseCount } from '@/utils/versification';

import type { BibleId } from '@/utils/bibles';

jest.mock('@/components/bible/useBookTexts', () => ({ useBookTexts: jest.fn(() => new Map()) }));

/** The Psalter of a Bible, each verse saying which Bible and which number it is. */
const psalter = (bible: BibleId) => new Map([['Psalms', {
  id: 'Psalms',
  chapters: Array.from({ length: 150 }, (_, c) => Array.from({ length: verseCount(bible, 'Psalms', c + 1) }, (__, v) => `${bible} ${c + 1}:${v + 1}`)),
}]]);

describe('a comment moved by its place list', () => {
  // Codex review r3: the list counted in the Bible the comment was written in, though its verses were just chosen in the
  // reader's — Synodal Psalm 9:38–10:2 moved to Psalm 11:1 went to one verse.
  it('keeps the verses just chosen in the reader, counted in the reader\'s Bible', () => {
    const standing = { id: 'r', bible: 'kjv' as const, book: 'Psalms', chapter: 10, fromVerse: 1 };
    const { result } = renderHook(() => useCommentPlace({ standing, newPlace: undefined, choosesOwn: false, bible: 'rst', notes: [], ownId: 'c' }));
    act(() => result.current.moveTo({ id: 'r', bible: 'rst', book: 'Psalms', chapter: 9, fromVerse: 38, toVerseChapter: 10, toVerse: 2 }));
    expect(result.current.list!.bible).toBe('rst');
    act(() => result.current.list!.onPick({ book: 'Psalms', chapter: 11, verse: 1 }));
    expect(result.current.here).toEqual(expect.objectContaining({ bible: 'rst', chapter: 11, fromVerse: 1 }));
    expect(versesHeldIn(result.current.here!, 'rst')).toHaveLength(4);
  });

  // Codex review r3: the list counted in the reader's numbers but marked «here» the old Bible's row — 10:1 for 9:22.
  it('marks «here» where it stood, in the numbers the list counts in', () => {
    const standing = { id: 'r', bible: 'kjv' as const, book: 'Psalms', chapter: 10, fromVerse: 1 };
    const { result } = renderHook(() => useCommentPlace({ standing, newPlace: undefined, choosesOwn: false, bible: 'rst', notes: [], ownId: 'c' }));
    expect(result.current.list!.home).toEqual({ book: 'Psalms', chapter: 10, verse: 1 });
    act(() => result.current.moveTo({ id: 'r', bible: 'rst', book: 'Psalms', chapter: 9, fromVerse: 38, toVerseChapter: 10, toVerse: 2 }));
    expect(result.current.list!.home).toEqual({ book: 'Psalms', chapter: 9, verse: 22 });
  });
});

/*
 * A PLACE AND ITS WORDS COME FROM ONE BIBLE (the owner, 2026-11-11: as chosen for the verse window — a place is numbered
 * as the text beside it numbers it). Codex's class sweep, 2026-11-10 (BUG-20261110-comment-move-label-and-words-in-two-bibles):
 * a comment written in the Synodal, moved in a King James reader, was named «Пс 51:10» over the Synodal words of 50:12.
 */
describe('the place a comment moves to, named and quoted', () => {
  beforeEach(() => jest.mocked(useBookTexts).mockImplementation((_books, bible) => psalter(bible)));
  afterEach(() => jest.mocked(useBookTexts).mockImplementation(() => new Map()));

  it('reads the words in the Bible the reader shows, which names it', () => {
    const standing = { id: 'r', bible: 'rst' as const, book: 'Psalms', chapter: 50, fromVerse: 11 };
    const placeOf = (reference: Parameters<typeof readerPlaceName>[0]) => readerPlaceName(reference, 'kjv', 'ru');
    const { result } = renderHook(() => useCommentPlace({ standing, newPlace: undefined, choosesOwn: false, bible: 'kjv', placeOf, notes: [], ownId: 'c' }));
    act(() => result.current.moveTo({ id: 'r', bible: 'rst', book: 'Psalms', chapter: 50, fromVerse: 12 }));
    expect(result.current.shown('')).toBe('Пс 51:10');
    expect(result.current.context).toBe('kjv 51:10');
    // The list still counts in the comment's own Bible, and says so.
    expect(result.current.list).toEqual(expect.objectContaining({ bible: 'rst', writtenIn: 'rst' }));
  });

  it('reads them in the Bible of the interface on a screen with no Bible of its own', () => {
    const standing = { id: 'r', bible: 'rst' as const, book: 'Psalms', chapter: 50, fromVerse: 11 };
    const { result } = renderHook(() => useCommentPlace({ standing, newPlace: undefined, choosesOwn: false, notes: [], ownId: 'c' }));
    act(() => result.current.moveTo({ id: 'r', bible: 'rst', book: 'Psalms', chapter: 50, fromVerse: 12 }));
    expect(result.current.shown('')).toBe('Ps.51:10');
    expect(result.current.context).toBe('kjv 51:10');
  });
});
