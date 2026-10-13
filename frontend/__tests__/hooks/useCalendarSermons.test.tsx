import { renderHook } from '@testing-library/react';

import { useCalendarSermons } from '@/hooks/useCalendarSermons';
import { useAuth } from '@/hooks/useAuth';
import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import { fetchCalendarSermons } from '@services/preachDates.service';

import type { Sermon } from '@/models/models';

jest.mock('@/hooks/useAuth', () => ({
  useAuth: jest.fn(),
}));

jest.mock('@/hooks/useServerFirstQuery', () => ({
  useServerFirstQuery: jest.fn(),
}));

jest.mock('@services/preachDates.service', () => ({
  fetchCalendarSermons: jest.fn(),
}));

// Sermons are engine-owned: the calendar reads the engine's rows.
const mockEngine = { sermons: [] as Sermon[], loading: false, error: null as string | null, refresh: jest.fn() };
jest.mock('@/hooks/useSermonsDataCollection', () => ({ useSermonsDataCollection: () => mockEngine }));

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockUseServerFirstQuery = useServerFirstQuery as jest.MockedFunction<typeof useServerFirstQuery>;
const mockFetchCalendarSermons = fetchCalendarSermons as jest.MockedFunction<typeof fetchCalendarSermons>;

const buildServerFirstResult = <TData,>(data: TData) =>
  ({
    data,
    isLoading: false,
    error: null,
    refetch: jest.fn(),
    isOnline: true,
  } as unknown as ReturnType<typeof useServerFirstQuery>);

describe('useCalendarSermons', () => {
  const startDate = new Date('2024-01-01T00:00:00.000Z');
  const endDate = new Date('2024-01-31T00:00:00.000Z');

  it('groups sermons by date and identifies pending sermons', async () => {
    mockUseAuth.mockReturnValue({ user: { uid: 'user-1' } } as any);

    const sermons: Sermon[] = [
      {
        id: 'sermon-1',
        title: 'Pending',
        verse: '',
        date: '2024-01-10',
        userId: 'user-1',
        thoughts: [],
        outline: { introduction: [], main: [], conclusion: [] },
        isPreached: true,
        preachDates: [],
      },
      {
        id: 'sermon-2',
        title: 'Scheduled',
        verse: '',
        date: '2024-01-15',
        userId: 'user-1',
        thoughts: [],
        outline: { introduction: [], main: [], conclusion: [] },
        isPreached: true,
        preachDates: [
          {
            id: 'pd-1',
            date: '2024-01-07',
            createdAt: '2024-01-01T00:00:00Z',
            church: { id: 'church-1', name: 'First', city: 'Town' },
          },
        ],
      },
      {
        id: 'sermon-3',
        title: 'Multiple',
        verse: '',
        date: '2024-01-20',
        userId: 'user-1',
        thoughts: [],
        outline: { introduction: [], main: [], conclusion: [] },
        isPreached: false,
        preachDates: [
          {
            id: 'pd-2',
            date: '2024-01-07T00:00:00.000Z',
            createdAt: '2024-01-02T00:00:00Z',
            church: { id: 'church-2', name: 'Second', city: 'City' },
          },
          {
            id: 'pd-3',
            date: '2024-01-08',
            createdAt: '2024-01-03T00:00:00Z',
            church: { id: 'church-1', name: 'First', city: 'Town' },
          },
        ],
      },
    ];

    mockEngine.sermons = [...sermons, { ...sermons[1], id: 'foreign', userId: 'user-2' }];
    mockUseServerFirstQuery.mockReturnValue(buildServerFirstResult([]));

    // The calendar page asks without a range (calendar/page.tsx), so a preached sermon with no
    // date still reaches the "no date yet" warning.
    const { result } = renderHook(() => useCalendarSermons());

    expect(result.current.pendingSermons).toHaveLength(1);
    expect(result.current.pendingSermons[0].id).toBe('sermon-1');

    expect(result.current.sermonsByDate['2024-01-07']).toHaveLength(2);
    expect(result.current.sermonsByDate['2024-01-08']).toHaveLength(1);
    expect(result.current.sermonsByDate['2024-01-07T00:00:00.000Z']).toBeUndefined();

    // A range keeps only sermons with a preach date inside it, as the legacy read did.
    const ranged = renderHook(() => useCalendarSermons(startDate, endDate)).result.current;
    expect(ranged.sermons.map(entry => entry.id).sort()).toEqual(['sermon-2', 'sermon-3']);
    expect(mockFetchCalendarSermons).not.toHaveBeenCalled();
    mockEngine.sermons = [];
  });

  it('returns empty data when no user is available', async () => {
    mockUseAuth.mockReturnValue({ user: null } as any);

    let capturedOptions: any;
    mockUseServerFirstQuery.mockImplementation((options: any) => {
      capturedOptions = options;
      return buildServerFirstResult([]);
    });

    const { result } = renderHook(() => useCalendarSermons());

    expect(result.current.sermons).toEqual([]);
    expect(result.current.pendingSermons).toEqual([]);
    expect(capturedOptions.enabled).toBe(false);

    const queryResult = await capturedOptions.queryFn();

    expect(queryResult).toEqual([]);
    expect(mockFetchCalendarSermons).not.toHaveBeenCalled();
  });
});

/**
 * The calendar has no document listener by design — it shows many sermons at once,
 * and one listener per sermon is the wrong trade. Returning to the tab is what
 * replaces it: without that, a date added on the phone stayed invisible on a laptop
 * calendar left open, indefinitely and with no hint.
 */
describe('the calendar re-asks the server when the person returns', () => {
  it('requests a focus refetch instead of trusting the cache', () => {
    mockUseAuth.mockReturnValue({ user: { uid: 'user-1' } } as unknown as ReturnType<typeof useAuth>);
    mockUseServerFirstQuery.mockReturnValue(buildServerFirstResult([] as Sermon[]));

    renderHook(() => useCalendarSermons(new Date('2026-07-01'), new Date('2026-07-31')));

    expect(mockUseServerFirstQuery).toHaveBeenCalledWith(
      expect.objectContaining({ refetchOnWindowFocus: true })
    );
  });
});
