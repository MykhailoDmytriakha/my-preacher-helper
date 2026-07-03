import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';

import { useSeriesMembership } from '@/hooks/useSeriesMembership';
import { getAllSeries } from '@/services/series.service';
import { commitSeriesBatch } from '@/services/seriesMembership.client';

import type { Series } from '@/models/models';
import type { ReactNode } from 'react';

jest.mock('@/hooks/useResolvedUid', () => ({
  useResolvedUid: () => ({ uid: 'user-1', isAuthLoading: false }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue || key,
  }),
}));

jest.mock('sonner', () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}));

jest.mock('@/services/series.service', () => ({
  getAllSeries: jest.fn(),
}));

// Keep the real pure helpers (applySeriesTransform is used by the optimistic
// layer); only stub the network write so we can assert the transform set.
jest.mock('@/services/seriesMembership.client', () => ({
  ...jest.requireActual('@/services/seriesMembership.client'),
  commitSeriesBatch: jest.fn().mockResolvedValue(undefined),
}));

const mockGetAllSeries = getAllSeries as jest.MockedFunction<typeof getAllSeries>;
const mockCommit = commitSeriesBatch as jest.MockedFunction<typeof commitSeriesBatch>;

const seriesWith = (id: string, refIds: string[]): Series =>
  ({
    id,
    userId: 'user-1',
    title: id,
    items: refIds.map((refId, i) => ({ type: 'sermon', refId, position: i + 1 })),
    sermonIds: refIds,
    seriesKind: 'sermon',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  }) as unknown as Series;

const renderMembership = (seed?: Series[]) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  if (seed) queryClient.setQueryData(['series', 'user-1'], seed);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useSeriesMembership(), { wrapper });
};

beforeEach(() => jest.clearAllMocks());

describe('useSeriesMembership — one-to-one discovery (add MOVES out of the old series)', () => {
  const expectMove = () => {
    const transforms = mockCommit.mock.calls[0][0];
    expect(transforms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ seriesId: 'B', op: 'add' }),
        expect.objectContaining({ seriesId: 'A', op: 'remove' }),
      ])
    );
  };

  it('WARM cache: removes the ref from its old series without any SDK read', async () => {
    const { result } = renderMembership([seriesWith('A', ['s1']), seriesWith('B', [])]);

    act(() => {
      result.current.addToSeries('B', { type: 'sermon', refId: 's1' });
    });

    await waitFor(() => expect(mockCommit).toHaveBeenCalled());
    expect(mockGetAllSeries).not.toHaveBeenCalled();
    expectMove();
  });

  it('COLD cache (#5 fix): falls back to a fresh SDK read to discover + remove the old membership', async () => {
    mockGetAllSeries.mockResolvedValue([seriesWith('A', ['s1']), seriesWith('B', [])]);
    const { result } = renderMembership(); // no seed -> cold list cache

    await act(async () => {
      result.current.addToSeries('B', { type: 'sermon', refId: 's1' });
      await Promise.resolve();
    });

    await waitFor(() => expect(mockCommit).toHaveBeenCalled());
    expect(mockGetAllSeries).toHaveBeenCalledWith('user-1');
    // one-to-one holds BY CONSTRUCTION even though the RQ list cache was cold
    expectMove();
  });
});
