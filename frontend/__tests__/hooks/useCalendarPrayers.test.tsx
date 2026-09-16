import { renderHook } from '@testing-library/react';

import { useAuth } from '@/hooks/useAuth';
import { useCalendarPrayers } from '@/hooks/useCalendarPrayers';
import { usePrayerRequests } from '@/hooks/usePrayerRequests';

jest.mock('@/hooks/useAuth', () => ({
  useAuth: jest.fn(),
}));

jest.mock('@/hooks/usePrayerRequests', () => ({
  usePrayerRequests: jest.fn(),
}));

const mockUseAuth = jest.mocked(useAuth);
const mockUsePrayerRequests = jest.mocked(usePrayerRequests);

const answered = {
  id: 'p1',
  userId: 'u1',
  title: 'За церковь',
  status: 'answered',
  updates: [],
  createdAt: '2026-09-02T12:00:00.000Z',
  updatedAt: '2026-09-20T12:00:00.000Z',
  answeredAt: '2026-09-20T12:00:00.000Z',
};

describe('useCalendarPrayers', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ user: { uid: 'u1' } } as any);
  });

  it("borrows the journal's own list for the signed-in person and translates it", () => {
    mockUsePrayerRequests.mockReturnValue({ prayerRequests: [answered], loading: false, error: null } as any);

    const { result } = renderHook(() => useCalendarPrayers());

    expect(mockUsePrayerRequests).toHaveBeenCalledWith('u1');
    expect(result.current.entries.map((entry) => [entry.kind, entry.date, entry.status])).toEqual([
      ['prayer', '2026-09-02', undefined],
      ['prayer', '2026-09-20', 'answered'],
    ]);
    expect(result.current.isLoading).toBe(false);
  });

  it("reports the journal's loading and error as its own", () => {
    const error = new Error('offline');
    mockUsePrayerRequests.mockReturnValue({ prayerRequests: [], loading: true, error } as any);

    const { result } = renderHook(() => useCalendarPrayers());

    expect(result.current).toEqual({ entries: [], isLoading: true, error });
  });
});
