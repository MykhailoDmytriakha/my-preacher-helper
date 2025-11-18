import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactElement, ReactNode } from 'react';
import { useDashboardSermons } from '@/hooks/useDashboardSermons';
import type { Sermon } from '@/models/models';

// Mock services
jest.mock('@/services/firebaseAuth.service', () => ({
  auth: { currentUser: null },
}));

const mockGetSermons = jest.fn();

jest.mock('@/services/sermon.service', () => ({
  getSermons: (...args: unknown[]) => mockGetSermons(...args),
}));

const { auth: mockAuth } = jest.requireMock('@/services/firebaseAuth.service') as {
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

const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: 0,
      cacheTime: 0,
    },
  },
});

const wrapper = ({ children }: { children: ReactNode }): ReactElement => {
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      {children}
    </QueryClientProvider>
  );
};

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

    const { result } = renderHook(() => useDashboardSermons(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.sermons).toEqual(sermons);
      expect(result.current.error).toBeNull();
    });

    expect(mockGetSermons).toHaveBeenCalledWith('user-123');
  });

  it('uses guest user from localStorage when no authenticated user exists', async () => {
    const guestUid = 'guest-abc';
    localStorage.setItem('guestUser', JSON.stringify({ uid: guestUid }));
    const sermons = [createSermon('3')];
    mockGetSermons.mockResolvedValueOnce(sermons);

    const { result } = renderHook(() => useDashboardSermons(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.sermons).toEqual(sermons);
    });

    expect(mockGetSermons).toHaveBeenCalledWith(guestUid);
  });

  it('handles fetch errors gracefully', async () => {
    mockAuth.currentUser = { uid: 'user-456' };
    const error = new Error('network');
    mockGetSermons.mockRejectedValueOnce(error);

    const { result } = renderHook(() => useDashboardSermons(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.sermons).toEqual([]);
      expect(result.current.error).toEqual(error);
    });
  });

  it('ignores invalid guestUser entries in localStorage', async () => {
    localStorage.setItem('guestUser', '{invalid json');
    mockGetSermons.mockResolvedValueOnce([]);

    const { result } = renderHook(() => useDashboardSermons(), { wrapper });

    await waitFor(() => {
      expect(result.current.sermons).toEqual([]);
    });

    expect(mockGetSermons).not.toHaveBeenCalled();
  });

  it('refreshes sermons on demand', async () => {
    mockAuth.currentUser = { uid: 'user-789' };
    const firstBatch = [createSermon('1')];
    const secondBatch = [createSermon('2')];

    // First call
    mockGetSermons.mockResolvedValueOnce(firstBatch);

    const { result } = renderHook(() => useDashboardSermons(), { wrapper });

    await waitFor(() => {
      expect(result.current.sermons).toEqual(firstBatch);
    });

    // Setup second call
    mockGetSermons.mockResolvedValueOnce(secondBatch);

    await act(async () => {
      await result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.sermons).toEqual(secondBatch);
    });

    expect(mockGetSermons).toHaveBeenCalledTimes(2);
  });
});
