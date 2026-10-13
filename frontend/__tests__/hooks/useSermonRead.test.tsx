import { renderHook } from '@testing-library/react';

import { sermonIsMissing, useSermonRead } from '@/hooks/useSermonRead';

import type { Sermon } from '@/models/models';

const mockCollection = jest.fn();
jest.mock('@/hooks/useSermonsDataCollection', () => ({
  useSermonsDataCollection: (enabled: boolean) => mockCollection(enabled),
}));

const sermon = { id: 's1', title: 'Born offline', verse: 'John 3:16', userId: 'u1', thoughts: [], date: '2026-10-12' } as unknown as Sermon;
const collection = (overrides: Partial<{ sermons: Sermon[]; loading: boolean; complete: boolean }>) => ({
  sermons: [], loading: false, complete: true, ...overrides,
});

describe('useSermonRead — the sermon the read-only chrome shows', () => {
  beforeEach(() => mockCollection.mockReset());

  it('finds the sermon in the engine collection, including one not yet on the server', () => {
    mockCollection.mockReturnValue(collection({ sermons: [sermon], complete: false }));
    const { result } = renderHook(() => useSermonRead('s1'));
    expect(result.current.sermon).toBe(sermon);
    expect(sermonIsMissing(result.current.sermon, result.current)).toBe(false);
  });

  it('calls a sermon missing only once the collection was received whole without it', () => {
    mockCollection.mockReturnValue(collection({ sermons: [], complete: true }));
    const { result } = renderHook(() => useSermonRead('gone'));
    expect(result.current.sermon).toBeNull();
    expect(sermonIsMissing(result.current.sermon, result.current)).toBe(true);
  });

  it('keeps waiting while the collection has never been received whole', () => {
    mockCollection.mockReturnValue(collection({ sermons: [], complete: false }));
    const { result } = renderHook(() => useSermonRead('s1'));
    expect(result.current.awaitingFirstAnswer).toBe(true);
    expect(sermonIsMissing(result.current.sermon, result.current)).toBe(false);
  });

  it('keeps waiting while the collection is loading', () => {
    mockCollection.mockReturnValue(collection({ sermons: [], loading: true, complete: true }));
    const { result } = renderHook(() => useSermonRead('s1'));
    expect(sermonIsMissing(result.current.sermon, result.current)).toBe(false);
  });

  it('reads nothing for an empty id', () => {
    mockCollection.mockReturnValue(collection({ sermons: [sermon], loading: true, complete: false }));
    const { result } = renderHook(() => useSermonRead(''));
    expect(mockCollection).toHaveBeenCalledWith(false);
    expect(result.current).toEqual({ sermon: null, loading: false, awaitingFirstAnswer: false });
  });
});
