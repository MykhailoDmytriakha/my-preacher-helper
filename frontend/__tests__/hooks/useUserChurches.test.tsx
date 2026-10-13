import { renderHook } from '@testing-library/react';

import { useUserChurches } from '@/hooks/useUserChurches';
import { useAuth } from '@/hooks/useAuth';

import type { Sermon } from '@/models/models';

jest.mock('@/hooks/useAuth', () => ({
  useAuth: jest.fn(),
}));

const mockEngineSermons = { sermons: [] as Sermon[], loading: false, error: null as string | null };
jest.mock('@/hooks/useSermonsDataCollection', () => ({
  useSermonsDataCollection: () => mockEngineSermons,
}));

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;

describe('useUserChurches', () => {
  it('deduplicates churches by name and city', () => {
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

    // Sermons are engine-owned: the suggestions come from the engine's rows.
    mockEngineSermons.sermons = sermons;
    const { result } = renderHook(() => useUserChurches());

    expect(result.current.availableChurches).toHaveLength(2);
    expect(result.current.availableChurches[0].name).toBe('First');
    expect(result.current.availableChurches[1].name).toBe('Second');
    mockEngineSermons.sermons = [];
  });

  it('returns empty list when no user is available', () => {
    mockUseAuth.mockReturnValue({ user: null } as any);
    mockEngineSermons.sermons = [{ id: 's1', userId: 'user-1', church: { id: 'c1', name: 'Grace', city: 'Kyiv' } }] as unknown as Sermon[];

    const { result } = renderHook(() => useUserChurches());

    expect(result.current.availableChurches).toEqual([]);
    mockEngineSermons.sermons = [];
  });

  // BUG-20260930-legacy-cache-week-expiry: the suggestions come from the engine's on-device
  // collection, so they survive having no network.
  describe('when sermons live on the data engine', () => {
    afterEach(() => { mockEngineSermons.sermons = []; });

    it("suggests the churches of the owner's sermons from the engine", () => {
      mockUseAuth.mockReturnValue({ user: { uid: 'user-1' } } as unknown as ReturnType<typeof useAuth>);
        mockEngineSermons.sermons = [
        { id: 's1', userId: 'user-1', church: { id: 'c1', name: 'Grace', city: 'Kyiv' } },
        { id: 's2', userId: 'user-1', preachDates: [{ id: 'p1', date: '2026-10-01', church: { id: 'c2', name: 'Hope', city: '' } }] },
        { id: 's3', userId: 'someone-else', church: { id: 'c3', name: 'Elsewhere', city: '' } },
      ] as unknown as Sermon[];

      const { result } = renderHook(() => useUserChurches());

      expect(result.current.availableChurches.map(church => church.name).sort()).toEqual(['Grace', 'Hope']);
    });
  });
});
