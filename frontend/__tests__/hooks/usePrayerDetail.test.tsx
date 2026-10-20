import { renderHook } from '@testing-library/react';

import { useDataCollection } from '@/data-engine/react.client';
import { collectionRecordPresence } from '@/data-engine/recordPresence';

import { usePrayerDetail } from '@/hooks/usePrayerDetail';

import type { CollectionState } from '@/data-engine/collections';

/**
 * ONE PRAYER, FROM THE ENGINE'S ROWS. The detail screen and the breadcrumb read the prayer the
 * data engine holds; there is no second copy to choose between.
 */

jest.mock('@/data-engine/react.client', () => ({
  ...jest.requireActual('@/data-engine/react.client'),
  useDataCollection: jest.fn(),
}));
jest.mock('@services/firebaseAuth.service', () => ({ auth: { currentUser: { uid: 'signed-in' } } }));

const stored = { userId: 'u', title: 'Healing', status: 'active', updates: [], createdAt: 'c', updatedAt: 'u' };
const rows = (documents: unknown[], loading = false, overrides: Partial<CollectionState> = {}) => {
  const state = { snapshots: [], documents, complete: !loading, freshness: 'server', checking: false, version: 1,
    error: null, ...overrides } as CollectionState;
  const refresh = jest.fn(async () => state);
  jest.mocked(useDataCollection).mockReturnValue({ state, loading, error: state.error, refresh,
    presence: (id: string) => collectionRecordPresence({ collection: 'prayerRequests', id }, state),
  } as never);
  return { state, refresh };
};

beforeEach(() => jest.clearAllMocks());

it('shows the engine row of the prayer asked for, under its own id', () => {
  rows([{ resource: { collection: 'prayerRequests', id: 'other' }, value: { ...stored, title: 'Other' } },
    { resource: { collection: 'prayerRequests', id: 'p1' }, value: stored }]);
  const { result } = renderHook(() => usePrayerDetail('p1', 'u'));
  expect(result.current).toMatchObject({ prayer: { ...stored, id: 'p1' }, isLoading: false });
  expect(useDataCollection).toHaveBeenCalledWith('prayerRequests');
});

it('says loading while the rows are still coming, and nothing once they came without it', () => {
  rows([], true);
  expect(renderHook(() => usePrayerDetail('p1', 'u')).result.current).toMatchObject({ prayer: null, isLoading: true });
  rows([]);
  expect(renderHook(() => usePrayerDetail('p1', 'u')).result.current).toMatchObject({ prayer: null, isLoading: false });
});

it('subscribes to nothing without a prayer id', () => {
  rows([]);
  const { result } = renderHook(() => usePrayerDetail('', 'u'));
  expect(result.current).toMatchObject({ prayer: null, isLoading: false });
  expect(useDataCollection).toHaveBeenCalledWith(null);
});


describe('the prayer read preserves the engine presence contract', () => {
  const resource = { collection: 'prayerRequests', id: 'p1' };

  it('keeps a failed empty read unknown rather than declaring the prayer missing', () => {
    rows([], false, { freshness: 'unknown', complete: false, error: 'Store unavailable' });
    const { result } = renderHook(() => usePrayerDetail('p1', 'u'));
    expect(result.current).toMatchObject({ prayer: null, isLoading: false, presence: { kind: 'unknown' } });
  });

  it('does not treat a cached negative snapshot as confirmed absence', () => {
    rows([], false, { freshness: 'cache', complete: true, snapshots: [{ resource, value: null, metadata: null }] });
    const { result } = renderHook(() => usePrayerDetail('p1', 'u'));
    expect(result.current).toMatchObject({ prayer: null, presence: { kind: 'unknown', source: 'cache' } });
  });

  it('recognizes absence established by a complete successful server answer', () => {
    rows([], false, { freshness: 'server', complete: true });
    const { result } = renderHook(() => usePrayerDetail('p1', 'u'));
    expect(result.current).toMatchObject({ prayer: null, presence: { kind: 'absent', source: 'server' } });
  });

  it('retains the known prayer during a failed refresh', () => {
    rows([{ resource, value: stored }], false, { freshness: 'cache', error: 'Store unavailable',
      snapshots: [{ resource, value: stored, metadata: null }] });
    const { result } = renderHook(() => usePrayerDetail('p1', 'u'));
    expect(result.current).toMatchObject({ prayer: { ...stored, id: 'p1' }, isLoading: false,
      presence: { kind: 'present', source: 'cache' } });
  });

  it('preserves an explicit local deletion waiting for acceptance', () => {
    rows([{ resource, value: null, pending: true, deleting: true }], false, { freshness: 'cache',
      snapshots: [{ resource, value: stored, metadata: null }] });
    const { result } = renderHook(() => usePrayerDetail('p1', 'u'));
    expect(result.current).toMatchObject({ prayer: null, presence: { kind: 'deleting', source: 'local' } });
  });
});
