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
            date: '2024-01-07',
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

    let capturedOptions: any;
    mockUseServerFirstQuery.mockImplementation((options: any) => {
      capturedOptions = options;
      return buildServerFirstResult(sermons);
    });

    const { result } = renderHook(() => useCalendarSermons(startDate, endDate));

    expect(result.current.pendingSermons).toHaveLength(1);
    expect(result.current.pendingSermons[0].id).toBe('sermon-1');

    expect(result.current.sermonsByDate['2024-01-07']).toHaveLength(2);
    expect(result.current.sermonsByDate['2024-01-08']).toHaveLength(1);

    mockFetchCalendarSermons.mockResolvedValue([]);
    await capturedOptions.queryFn();

    expect(mockFetchCalendarSermons).toHaveBeenCalledWith('user-1', '2024-01-01', '2024-01-31');
    expect(capturedOptions.enabled).toBe(true);
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
