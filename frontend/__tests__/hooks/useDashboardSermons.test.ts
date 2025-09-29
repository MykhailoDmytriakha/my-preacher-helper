import { renderHook, waitFor, act } from '@testing-library/react';
import type { Sermon } from '@/models/models';
import { useDashboardSermons } from '@/hooks/useDashboardSermons';

jest.mock('@services/firebaseAuth.service', () => ({
  auth: { currentUser: null },
}));

const mockGetSermons = jest.fn();

jest.mock('@services/sermon.service', () => ({
  getSermons: (...args: unknown[]) => mockGetSermons(...args),
}));

const { auth: mockAuth } = jest.requireMock('@services/firebaseAuth.service') as {
  auth: { currentUser: { uid: string } | null };
};

const createSermon = (id: string, overrides: Partial<Sermon> = {}): Sermon => ({
  id,
  title: `Sermon ${id}`,
  verse: 'John 3:16',
  date: '2024-01-01',
  thoughts: [],
  userId: 'user-1',
  ...overrides,
});

describe('useDashboardSermons', () => {
  const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

  beforeEach(() => {
    mockAuth.currentUser = null;
    mockGetSermons.mockReset();
    localStorage.clear();
  });

  afterAll(() => {
    consoleErrorSpy.mockRestore();
  });

  it('fetches sermons for an authenticated user', async () => {
    const sermons = [createSermon('1'), createSermon('2')];
    mockAuth.currentUser = { uid: 'user-123' };
    mockGetSermons.mockResolvedValueOnce(sermons);

    const { result } = renderHook(() => useDashboardSermons());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockGetSermons).toHaveBeenCalledWith('user-123');
    expect(result.current.sermons).toEqual(sermons);
    expect(result.current.error).toBeNull();
  });

  it('uses guest user from localStorage when no authenticated user exists', async () => {
    const guestUid = 'guest-abc';
    localStorage.setItem('guestUser', JSON.stringify({ uid: guestUid }));
    const sermons = [createSermon('3')];
    mockGetSermons.mockResolvedValueOnce(sermons);

    const { result } = renderHook(() => useDashboardSermons());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockGetSermons).toHaveBeenCalledWith(guestUid);
    expect(result.current.sermons).toEqual(sermons);
  });

  it('handles fetch errors gracefully', async () => {
    mockAuth.currentUser = { uid: 'user-456' };
    const error = new Error('network');
    mockGetSermons.mockRejectedValueOnce(error);

    const { result } = renderHook(() => useDashboardSermons());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.sermons).toEqual([]);
    expect(result.current.error).toEqual(error);
  });

  it('ignores invalid guestUser entries in localStorage', async () => {
    localStorage.setItem('guestUser', '{invalid json');
    mockGetSermons.mockResolvedValueOnce([]);

    const { result } = renderHook(() => useDashboardSermons());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockGetSermons).not.toHaveBeenCalled();
    expect(result.current.sermons).toEqual([]);
  });

  it('refreshes sermons on demand', async () => {
    mockAuth.currentUser = { uid: 'user-789' };
    const firstBatch = [createSermon('1')];
    const secondBatch = [createSermon('2')];
    mockGetSermons
      .mockResolvedValueOnce(firstBatch)
      .mockResolvedValueOnce(secondBatch);

    const { result } = renderHook(() => useDashboardSermons());

    await waitFor(() => expect(result.current.sermons).toEqual(firstBatch));

    await act(async () => {
      await result.current.refresh();
    });

    await waitFor(() => expect(result.current.sermons).toEqual(secondBatch));
    expect(mockGetSermons).toHaveBeenCalledTimes(2);
  });
});
