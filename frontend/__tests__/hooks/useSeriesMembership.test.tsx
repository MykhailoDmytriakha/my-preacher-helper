import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useSeriesMembership } from '@/hooks/useSeriesMembership';
import { getAllGroups } from '@/services/groups.service';
import { getAllSeries } from '@/services/series.service';
import { commitSeriesBatch } from '@/services/seriesMembership.client';
import { getSermons } from '@/services/sermon.service';

import type { Group, Series, Sermon } from '@/models/models';
import type { ReactNode } from 'react';

jest.mock('@/hooks/useResolvedUid', () => ({
  useResolvedUid: () => ({ uid: 'test-user-id', isAuthLoading: false }),
}));

jest.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: jest.fn(),
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

jest.mock('@/services/sermon.service', () => ({
  getSermons: jest.fn(),
}));

jest.mock('@/services/groups.service', () => ({
  getAllGroups: jest.fn(),
}));

// Keep the real pure helpers (applySeriesTransform is used by the optimistic
// layer); only stub the network write so we can assert the transform set.
jest.mock('@/services/seriesMembership.client', () => ({
  ...jest.requireActual('@/services/seriesMembership.client'),
  commitSeriesBatch: jest.fn().mockResolvedValue(undefined),
}));

const mockGetAllSeries = getAllSeries as jest.MockedFunction<typeof getAllSeries>;
const mockCommit = commitSeriesBatch as jest.MockedFunction<typeof commitSeriesBatch>;
const mockGetSermons = getSermons as jest.MockedFunction<typeof getSermons>;
const mockGetAllGroups = getAllGroups as jest.MockedFunction<typeof getAllGroups>;
const mockUseOnlineStatus = useOnlineStatus as jest.MockedFunction<typeof useOnlineStatus>;

const seriesWith = (id: string, refIds: string[]): Series =>
  ({
    id,
    userId: 'test-user-id',
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
  if (seed) queryClient.setQueryData(['series', 'test-user-id'], seed);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { ...renderHook(() => useSeriesMembership(), { wrapper }), queryClient };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUseOnlineStatus.mockReturnValue(true);
  mockGetAllSeries.mockResolvedValue([]);
  mockGetSermons.mockResolvedValue([]);
  mockGetAllGroups.mockResolvedValue([]);
});

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

  it('WARM cache: removes the ref from its old series', async () => {
    const { result } = renderMembership([seriesWith('A', ['s1']), seriesWith('B', [])]);

    act(() => {
      result.current.addToSeries('B', { type: 'sermon', refId: 's1' });
    });

    await waitFor(() => expect(mockCommit).toHaveBeenCalled());
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
    expect(mockGetAllSeries).toHaveBeenCalledWith('test-user-id');
    // one-to-one holds BY CONSTRUCTION even though the RQ list cache was cold
    expectMove();
  });
});

describe('useSeriesMembership · which cached lists drive the rendered result', () => {
  const sermonWith = (title: string, revision: number): Sermon => ({
    id: 'sermon-1',
    userId: 'test-user-id',
    title,
    verse: 'John 3:16',
    date: '2026-08-01',
    thoughts: [],
    updatedAt: '2026-08-01T00:00:00.000Z',
    rev: { core: revision },
  });

  const groupWith = (title: string, revision: number): Group => ({
    id: 'group-1',
    userId: 'test-user-id',
    title,
    status: 'active',
    templates: [],
    flow: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    rev: { content: revision },
  });

  const seedResolvedCaches = (
    queryClient: QueryClient,
    target: Series,
    sermon: Sermon,
    group: Group
  ) => {
    queryClient.setQueryData(['sermons', 'test-user-id'], [sermon]);
    queryClient.setQueryData(['groups', 'test-user-id'], [group]);
    queryClient.setQueryData(['series-detail', target.id], {
      series: target,
      items: [],
      sermons: [],
      groups: [],
    });
  };

  it('uses newer server lists for membership decisions and visible item titles', async () => {
    const oldSource = {
      ...seriesWith('source', ['sermon-1', 'group-1']),
      rev: { items: 1 },
    };
    const oldTarget = {
      ...seriesWith('target', []),
      title: 'Older target title',
      rev: { items: 1 },
    };
    const { result, queryClient } = renderMembership([oldSource, oldTarget]);
    seedResolvedCaches(
      queryClient,
      oldTarget,
      sermonWith('Older sermon title', 1),
      groupWith('Older group title', 1)
    );

    mockGetAllSeries.mockResolvedValue([
      { ...oldSource, rev: { items: 2 } },
      { ...oldTarget, title: 'Newer target title', rev: { items: 2 } },
    ]);
    mockGetSermons.mockResolvedValue([sermonWith('Newer sermon title', 2)]);
    mockGetAllGroups.mockResolvedValue([groupWith('Newer group title', 2)]);

    act(() => {
      result.current.addRefsToSeries('target', [
        { type: 'sermon', refId: 'sermon-1' },
        { type: 'group', refId: 'group-1' },
      ]);
    });

    await waitFor(() => expect(mockCommit).toHaveBeenCalled());
    const visible = queryClient.getQueryData<{
      series: Series;
      sermons: Sermon[];
      groups: Group[];
    }>(['series-detail', 'target']);
    expect(visible?.series.title).toBe('Newer target title');
    expect(visible?.sermons[0]?.title).toBe('Newer sermon title');
    expect(visible?.groups[0]?.title).toBe('Newer group title');
  });

  it('keeps unsaved local list copies when the server revisions are not ahead', async () => {
    const target = {
      ...seriesWith('target', []),
      title: 'Unsaved target title',
      rev: { items: 4 },
    };
    const { result, queryClient } = renderMembership([target]);
    seedResolvedCaches(
      queryClient,
      target,
      sermonWith('Unsaved sermon title', 4),
      groupWith('Unsaved group title', 4)
    );
    mockGetAllSeries.mockResolvedValue([
      { ...target, title: 'Server target title', rev: { items: 4 } },
    ]);
    mockGetSermons.mockResolvedValue([sermonWith('Server sermon title', 4)]);
    mockGetAllGroups.mockResolvedValue([groupWith('Server group title', 4)]);

    act(() => {
      result.current.addRefsToSeries('target', [
        { type: 'sermon', refId: 'sermon-1' },
        { type: 'group', refId: 'group-1' },
      ]);
    });

    await waitFor(() => expect(mockCommit).toHaveBeenCalled());
    const visible = queryClient.getQueryData<{
      series: Series;
      sermons: Sermon[];
      groups: Group[];
    }>(['series-detail', 'target']);
    expect(visible?.series.title).toBe('Unsaved target title');
    expect(visible?.sermons[0]?.title).toBe('Unsaved sermon title');
    expect(visible?.groups[0]?.title).toBe('Unsaved group title');
  });

  it('uses stored lists without touching the network while offline', async () => {
    mockUseOnlineStatus.mockReturnValue(false);
    const target = seriesWith('target', []);
    const { result } = renderMembership([target]);

    act(() => {
      result.current.addToSeries('target', { type: 'sermon', refId: 'sermon-1' });
    });

    await waitFor(() => expect(mockCommit).toHaveBeenCalled());
    expect(mockGetAllSeries).not.toHaveBeenCalled();
    expect(mockGetSermons).not.toHaveBeenCalled();
    expect(mockGetAllGroups).not.toHaveBeenCalled();
  });

  it('keeps the visible stored lists when online refresh requests fail', async () => {
    const target = {
      ...seriesWith('target', []),
      title: 'Still visible after failed refresh',
      rev: { items: 1 },
    };
    const { result, queryClient } = renderMembership([target]);
    seedResolvedCaches(
      queryClient,
      target,
      sermonWith('Stored sermon stays visible', 1),
      groupWith('Stored group stays visible', 1)
    );
    mockGetAllSeries.mockRejectedValue(new Error('series request failed'));
    mockGetSermons.mockRejectedValue(new Error('sermons request failed'));
    mockGetAllGroups.mockRejectedValue(new Error('groups request failed'));

    act(() => {
      result.current.addRefsToSeries('target', [
        { type: 'sermon', refId: 'sermon-1' },
        { type: 'group', refId: 'group-1' },
      ]);
    });

    await waitFor(() => expect(mockCommit).toHaveBeenCalled());
    const visible = queryClient.getQueryData<{
      series: Series;
      sermons: Sermon[];
      groups: Group[];
    }>(['series-detail', 'target']);
    expect(visible?.series.title).toBe('Still visible after failed refresh');
    expect(visible?.sermons[0]?.title).toBe('Stored sermon stays visible');
    expect(visible?.groups[0]?.title).toBe('Stored group stays visible');
  });

  it('restores every affected membership cache when the online transaction is refused', async () => {
    const target = seriesWith('target', []);
    const detail = { series: target, items: [], sermons: [], groups: [] };
    const refusal = Object.assign(new Error('Write refused'), { code: 'permission-denied' });
    const { result, queryClient } = renderMembership([target]);
    queryClient.setQueryData(['series-detail', target.id], detail);
    mockGetAllSeries.mockResolvedValue([target]);
    mockCommit.mockRejectedValueOnce(refusal);

    let submission!: ReturnType<typeof result.current.addToSeries>;
    act(() => {
      submission = result.current.addToSeries('target', { type: 'sermon', refId: 'sermon-1' });
    });

    await expect(submission.acceptance).rejects.toMatchObject({ code: 'permission-denied' });
    await waitFor(() => {
      expect(queryClient.getQueryData(['series', 'test-user-id'])).toEqual([target]);
      expect(queryClient.getQueryData(['series-detail', target.id])).toEqual(detail);
    });
  });
});
