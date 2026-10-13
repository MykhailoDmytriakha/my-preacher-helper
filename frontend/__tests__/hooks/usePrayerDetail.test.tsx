import { renderHook } from '@testing-library/react';

import { useDataCollection } from '@/data-engine/react.client';
import { usePrayerDetail } from '@/hooks/usePrayerDetail';

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
const rows = (documents: unknown[], loading = false) => jest.mocked(useDataCollection).mockReturnValue({
  state: { snapshots: [], documents, complete: !loading, freshness: 'server', checking: false, version: 1, error: null },
  loading, error: null, refresh: jest.fn(),
} as never);

beforeEach(() => jest.clearAllMocks());

it('shows the engine row of the prayer asked for, under its own id', () => {
  rows([{ resource: { collection: 'prayerRequests', id: 'other' }, value: { ...stored, title: 'Other' } },
    { resource: { collection: 'prayerRequests', id: 'p1' }, value: stored }]);
  const { result } = renderHook(() => usePrayerDetail('p1', 'u'));
  expect(result.current).toEqual({ prayer: { ...stored, id: 'p1' }, isLoading: false });
  expect(useDataCollection).toHaveBeenCalledWith('prayerRequests');
});

it('says loading while the rows are still coming, and nothing once they came without it', () => {
  rows([], true);
  expect(renderHook(() => usePrayerDetail('p1', 'u')).result.current).toEqual({ prayer: null, isLoading: true });
  rows([]);
  expect(renderHook(() => usePrayerDetail('p1', 'u')).result.current).toEqual({ prayer: null, isLoading: false });
});

it('subscribes to nothing without a prayer id', () => {
  rows([]);
  const { result } = renderHook(() => usePrayerDetail('', 'u'));
  expect(result.current).toEqual({ prayer: null, isLoading: false });
  expect(useDataCollection).toHaveBeenCalledWith(null);
});
