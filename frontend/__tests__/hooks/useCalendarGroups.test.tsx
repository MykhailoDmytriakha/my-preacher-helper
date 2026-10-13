import { renderHook } from '@testing-library/react';

import { useAuth } from '@/hooks/useAuth';
import { useCalendarGroups } from '@/hooks/useCalendarGroups';
import { useGroupsDataCollection } from '@/hooks/useGroupsDataCollection';

/**
 * THE CALENDAR'S GROUPS come from the data engine's rows: the signed-in owner's groups with a
 * meeting inside the range the calendar asks for.
 */

jest.mock('@/hooks/useAuth', () => ({ useAuth: jest.fn() }));
jest.mock('@/hooks/useGroupsDataCollection', () => ({ useGroupsDataCollection: jest.fn() }));

const group = (id: string, userId: string, dates: string[]) => ({
  id, userId, title: id, status: 'draft', templates: [], flow: [], createdAt: 'c', updatedAt: 'u',
  meetingDates: dates.map((date, index) => ({ id: `${id}-${index}`, date, createdAt: 'c' })),
});
const refreshGroups = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useAuth).mockReturnValue({ user: { uid: 'user-1' } } as ReturnType<typeof useAuth>);
  jest.mocked(useGroupsDataCollection).mockReturnValue({
    groups: [group('inside', 'user-1', ['2026-02-10']), group('before', 'user-1', ['2026-01-05']),
      group('undated', 'user-1', []), group('foreign', 'user-2', ['2026-02-10'])],
    loading: false, error: null, refreshGroups,
  } as unknown as ReturnType<typeof useGroupsDataCollection>);
});

describe('useCalendarGroups', () => {
  it('returns the owner\'s groups that meet inside the range', () => {
    const { result } = renderHook(() => useCalendarGroups(new Date('2026-02-01T00:00:00.000Z'), new Date('2026-02-28T00:00:00.000Z')));
    expect(result.current.groups.map(entry => entry.id)).toEqual(['inside']);
    expect(result.current.refetch).toBe(refreshGroups);
  });

  it('returns every dated group of the owner when no range is given', () => {
    const { result } = renderHook(() => useCalendarGroups());
    expect(result.current.groups.map(entry => entry.id)).toEqual(['inside', 'before']);
  });

  it('returns nothing when nobody is signed in', () => {
    jest.mocked(useAuth).mockReturnValue({ user: null } as unknown as ReturnType<typeof useAuth>);
    const { result } = renderHook(() => useCalendarGroups());
    expect(result.current.groups).toEqual([]);
  });
});
