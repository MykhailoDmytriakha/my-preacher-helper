import { renderHook } from '@testing-library/react';

import { useUserChurches } from '@/hooks/useUserChurches';
import { useAuth } from '@/hooks/useAuth';
import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import { getSermons } from '@services/sermon.service';

import type { Sermon } from '@/models/models';

jest.mock('@/hooks/useAuth', () => ({
  useAuth: jest.fn(),
}));

jest.mock('@/hooks/useServerFirstQuery', () => ({
  useServerFirstQuery: jest.fn(),
}));

jest.mock('@services/sermon.service', () => ({
  getSermons: jest.fn(),
}));

const mockEngineSermons = { sermons: [] as Sermon[], loading: false, error: null as string | null };
jest.mock('@/hooks/useSermonsDataCollection', () => ({
  useSermonsDataCollection: () => mockEngineSermons,
}));

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockUseServerFirstQuery = useServerFirstQuery as jest.MockedFunction<typeof useServerFirstQuery>;
const mockGetSermons = getSermons as jest.MockedFunction<typeof getSermons>;

const buildServerFirstResult = <TData,>(data: TData) =>
  ({
    data,
    isLoading: false,
    error: null,
    isOnline: true,
  } as unknown as ReturnType<typeof useServerFirstQuery>);

describe('useUserChurches', () => {
  it('deduplicates churches by name and city', async () => {
    mockUseAuth.mockReturnValue({ user: { uid: 'user-1' } } as any);

    const sermons: Sermon[] = [
      {
        id: 'sermon-1',
        title: 'Sermon 1',
        verse: '',
        date: '2024-01-01',
        userId: 'user-1',
        thoughts: [],
        outline: { introduction: [], main: [], conclusion: [] },
        isPreached: true,
        preachDates: [
          {
            id: 'pd-1',
            date: '2024-01-01',
            createdAt: '2024-01-01T00:00:00Z',
            church: { id: 'church-1', name: 'First', city: 'Town' },
          },
          {
            id: 'pd-2',
            date: '2024-01-02',
            createdAt: '2024-01-02T00:00:00Z',
            church: { id: 'church-1', name: 'First', city: 'Town' },
          },
        ],
      },
      {
        id: 'sermon-2',
        title: 'Sermon 2',
        verse: '',
        date: '2024-01-05',
        userId: 'user-1',
        thoughts: [],
        outline: { introduction: [], main: [], conclusion: [] },
        isPreached: true,
        preachDates: [
          {
            id: 'pd-3',
            date: '2024-01-03',
            createdAt: '2024-01-03T00:00:00Z',
            church: { id: 'church-2', name: 'Second', city: '' },
          },
        ],
      },
    ];

    let capturedOptions: any;
    mockUseServerFirstQuery.mockImplementation((options: any) => {
      capturedOptions = options;
      return buildServerFirstResult(sermons);
    });

    const { result } = renderHook(() => useUserChurches());

    expect(result.current.availableChurches).toHaveLength(2);
    expect(result.current.availableChurches[0].name).toBe('First');
    expect(result.current.availableChurches[1].name).toBe('Second');

    mockGetSermons.mockResolvedValue([]);
    await capturedOptions.queryFn();

    expect(mockGetSermons).toHaveBeenCalledWith('user-1');
    expect(capturedOptions.enabled).toBe(true);
  });

  it('returns empty list when no user is available', async () => {
    mockUseAuth.mockReturnValue({ user: null } as any);

    let capturedOptions: any;
    mockUseServerFirstQuery.mockImplementation((options: any) => {
      capturedOptions = options;
      return buildServerFirstResult([]);
    });

    const { result } = renderHook(() => useUserChurches());

    expect(result.current.availableChurches).toEqual([]);
    expect(capturedOptions.enabled).toBe(false);

    const queryResult = await capturedOptions.queryFn();

    expect(queryResult).toEqual([]);
    expect(mockGetSermons).not.toHaveBeenCalled();
  });

  // BUG-20260930-legacy-cache-week-expiry: on the engine the old-path query of every sermon is
  // neither saved nor asked offline, so the suggestions were empty without a network.
  describe('when sermons live on the data engine', () => {
    const ON_ENGINE = 'NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS';
    beforeEach(() => { process.env[ON_ENGINE] = 'sermons'; });
    afterEach(() => { delete process.env[ON_ENGINE]; mockEngineSermons.sermons = []; });

    it("suggests the churches of the owner's sermons from the engine, without the old-path query", () => {
      mockUseAuth.mockReturnValue({ user: { uid: 'user-1' } } as unknown as ReturnType<typeof useAuth>);
      mockUseServerFirstQuery.mockReturnValue(buildServerFirstResult([]));
      mockEngineSermons.sermons = [
        { id: 's1', userId: 'user-1', church: { id: 'c1', name: 'Grace', city: 'Kyiv' } },
        { id: 's2', userId: 'user-1', preachDates: [{ id: 'p1', date: '2026-10-01', church: { id: 'c2', name: 'Hope', city: '' } }] },
        { id: 's3', userId: 'someone-else', church: { id: 'c3', name: 'Elsewhere', city: '' } },
      ] as unknown as Sermon[];

      const { result } = renderHook(() => useUserChurches());

      expect(result.current.availableChurches.map(church => church.name).sort()).toEqual(['Grace', 'Hope']);
      expect(mockUseServerFirstQuery).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    });
  });
});
