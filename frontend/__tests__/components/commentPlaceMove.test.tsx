import { act, renderHook } from '@testing-library/react';

import { useCommentPlace } from '@/components/CommentPlaceMove';
import { versesHeldIn } from '@/utils/scriptureReferenceNumbering';

jest.mock('@/components/bible/useBookTexts', () => ({ useBookTexts: () => new Map() }));

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
