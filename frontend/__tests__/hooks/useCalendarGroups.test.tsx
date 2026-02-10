import { renderHook } from '@testing-library/react';

import { useAuth } from '@/hooks/useAuth';
import { useCalendarGroups } from '@/hooks/useCalendarGroups';
import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import { fetchCalendarGroups } from '@/services/groups.service';

jest.mock('@/hooks/useAuth', () => ({
  useAuth: jest.fn(),
}));

jest.mock('@/hooks/useServerFirstQuery', () => ({
  useServerFirstQuery: jest.fn(),
}));

jest.mock('@/services/groups.service', () => ({
  fetchCalendarGroups: jest.fn(),
}));

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockUseServerFirstQuery = useServerFirstQuery as jest.MockedFunction<typeof useServerFirstQuery>;
const mockFetchCalendarGroups = fetchCalendarGroups as jest.MockedFunction<typeof fetchCalendarGroups>;

const buildServerFirstResult = <TData,>(data: TData) =>
  ({
    data,
    isLoading: false,
    error: null,
    refetch: jest.fn(),
    isOnline: true,
  } as unknown as ReturnType<typeof useServerFirstQuery>);

describe('useCalendarGroups', () => {
  it('groups meeting dates by day and calls service query', async () => {
    mockUseAuth.mockReturnValue({ user: { uid: 'user-1' } } as any);

    const startDate = new Date('2026-02-01T00:00:00.000Z');
    const endDate = new Date('2026-02-28T00:00:00.000Z');

    const groups = [
      {
        id: 'g1',
        title: 'Group 1',
        meetingDates: [
          { id: 'd1', date: '2026-02-11T00:00:00.000Z', createdAt: 'x' },
          { id: 'd2', date: '2026-02-11', createdAt: 'x' },
        ],
      },
      {
        id: 'g2',
        title: 'Group 2',
        meetingDates: [{ id: 'd3', date: '2026-02-12', createdAt: 'x' }],
      },
    ] as any;

    let capturedOptions: any;
    mockUseServerFirstQuery.mockImplementation((options: any) => {
      capturedOptions = options;
      return buildServerFirstResult(groups);
    });

    const { result } = renderHook(() => useCalendarGroups(startDate, endDate));

    expect(result.current.groups).toHaveLength(2);
    expect(result.current.groupsByDate['2026-02-11']).toHaveLength(2);
    expect(result.current.groupsByDate['2026-02-12']).toHaveLength(1);
    expect(result.current.groupsByDate['2026-02-11T00:00:00.000Z']).toBeUndefined();
    expect(capturedOptions.enabled).toBe(true);

    mockFetchCalendarGroups.mockResolvedValue([]);
    await capturedOptions.queryFn();
    expect(mockFetchCalendarGroups).toHaveBeenCalledWith('user-1', '2026-02-01', '2026-02-28');
  });

  it('returns empty query payload when user is not available', async () => {
    mockUseAuth.mockReturnValue({ user: null } as any);

    let capturedOptions: any;
    mockUseServerFirstQuery.mockImplementation((options: any) => {
      capturedOptions = options;
      return buildServerFirstResult([]);
    });

    const { result } = renderHook(() => useCalendarGroups());
    const queried = await capturedOptions.queryFn();

    expect(result.current.groups).toEqual([]);
    expect(result.current.groupsByDate).toEqual({});
    expect(capturedOptions.enabled).toBe(false);
    expect(queried).toEqual([]);
    expect(mockFetchCalendarGroups).not.toHaveBeenCalled();
  });
});
