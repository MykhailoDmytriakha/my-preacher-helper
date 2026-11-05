import { renderHook } from '@testing-library/react';

import { useDataCollection } from '@/data-engine/react.client';
import { useResolvedUid } from '@/hooks/useResolvedUid';
import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import { useSermonsBuiltOnNote } from '@/hooks/useSermonNoteLinks';
import { hydrateSermon, sortSermons } from '@/utils/sermonDocument';

import type { Sermon } from '@/models/models';

jest.mock('@/data-engine/react.client', () => ({ useDataCollection: jest.fn(), useDocumentActions: jest.fn() }));
jest.mock('@/hooks/useResolvedUid', () => ({ useResolvedUid: jest.fn() }));
jest.mock('@/hooks/useServerFirstQuery', () => ({ useServerFirstQuery: jest.fn() }));

const raw = [
  { id: 'b', userId: 'u1', date: '2026-10-30', sourceNoteIds: ['n1', 'n2'], structure: { introduction: ['thought'] } },
  { id: 'unrelated', userId: 'u1', date: '2026-11-01', sourceNoteIds: ['n2'] },
  { id: 'a', userId: 'u1', date: '2026-10-30', sourceNoteIds: ['n1'], plan: { introduction: 'Opening' } },
  { id: 'latest', userId: 'u1', date: '2026-10-31', sourceNoteIds: ['n1'] },
  { id: 'unlinked', userId: 'u1', date: '2026-11-02' },
] as unknown as Sermon[];

const collection = (rows = raw, loading = false) => ({
  state: {
    documents: rows.map(({ id, ...value }) => ({ resource: { collection: 'sermons', id }, value })),
    complete: false, freshness: 'cached',
  },
  loading, error: null, refresh: jest.fn(),
});

beforeEach(() => {
  jest.mocked(useResolvedUid).mockReturnValue({ uid: 'u1', isAuthLoading: false });
  jest.mocked(useServerFirstQuery).mockReturnValue({ data: sortSermons(raw.map(hydrateSermon)), isLoading: false } as never);
  jest.mocked(useDataCollection).mockReturnValue(collection() as never);
});

describe('useSermonsBuiltOnNote engine migration', () => {
  it('preserves the legacy result, including date order, id tie-break and hydrated aliases', () => {
    const { result } = renderHook(() => useSermonsBuiltOnNote('n1'));
    expect(result.current.sermons.map(sermon => sermon.id)).toEqual(['latest', 'a', 'b']);
    expect(result.current.sermons).toEqual(sortSermons(raw.map(hydrateSermon)).filter(sermon => sermon.sourceNoteIds?.includes('n1')));
    expect(result.current.loading).toBe(false);
  });

  it('shows the device-held partial list offline without a legacy cached list', () => {
    jest.mocked(useServerFirstQuery).mockReturnValue({ data: undefined, isLoading: false } as never);
    jest.mocked(useDataCollection).mockReturnValue(collection([raw[0], raw[3]]) as never);
    const { result } = renderHook(() => useSermonsBuiltOnNote('n1'));
    expect(result.current.sermons.map(sermon => sermon.id)).toEqual(['latest', 'b']);
    expect(result.current.loading).toBe(false);
  });

  it('reads through the shared engine facade without opening the legacy query', () => {
    renderHook(() => useSermonsBuiltOnNote('n1'));
    expect(useDataCollection).toHaveBeenCalledWith('sermons');
    expect(useServerFirstQuery).not.toHaveBeenCalled();
  });

  it('does not subscribe before the note has an id', () => {
    const { result } = renderHook(() => useSermonsBuiltOnNote(undefined));
    expect(result.current.sermons).toEqual([]);
    expect(useDataCollection).toHaveBeenCalledWith(null);
  });

  it('reports the engine loading state and then filters its updated list', () => {
    jest.mocked(useDataCollection).mockReturnValue({ state: null, loading: true } as never);
    const { result, rerender } = renderHook(() => useSermonsBuiltOnNote('n1'));
    expect(result.current.loading).toBe(true);
    jest.mocked(useDataCollection).mockReturnValue(collection() as never);
    rerender();
    expect(result.current.loading).toBe(false);
    expect(result.current.sermons.map(sermon => sermon.id)).toEqual(['latest', 'a', 'b']);
  });
});
