import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';

import useSermon from '@/hooks/useSermon';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import { debugLog } from '@/utils/debugMode';
import { auth } from '@/services/firebaseAuth.service';

import type { Sermon } from '@/models/models';

jest.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: jest.fn(),
}));

jest.mock('@/hooks/useServerFirstQuery', () => ({
  useServerFirstQuery: jest.fn(),
}));

jest.mock('@/utils/debugMode', () => ({
  debugLog: jest.fn(),
}));

jest.mock('@/services/firebaseAuth.service', () => ({
  auth: { currentUser: null },
}));

const mockUseOnlineStatus = useOnlineStatus as jest.MockedFunction<typeof useOnlineStatus>;
const mockUseServerFirstQuery = useServerFirstQuery as jest.MockedFunction<typeof useServerFirstQuery>;
const mutableAuth = auth as { currentUser: unknown };

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return { queryClient, wrapper };
};

describe('useSermon', () => {
  const baseSermon: Sermon = {
    id: 'sermon-1',
    title: 'Sermon',
    verse: 'John 3:16',
    date: '2024-01-01',
    userId: 'user-1',
    thoughts: [
      { id: 't1', text: 'A', date: '2024-01-01' } as any,
      { id: 't2', text: 'B', date: '2024-01-02' } as any,
    ],
    outline: { introduction: [], main: [], conclusion: [] },
    isPreached: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mutableAuth.currentUser = { uid: 'user-1' } as any;
    window.localStorage.clear();
  });

  it('returns server data when online and ignores cached list', () => {
    const { wrapper, queryClient } = createWrapper();
    const cached = { ...baseSermon, id: 'sermon-1', title: 'Cached' };
    queryClient.setQueryData(['sermons', 'user-1'], [cached]);

    mockUseOnlineStatus.mockReturnValue(true);
    mockUseServerFirstQuery.mockReturnValue({
      data: baseSermon,
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    } as any);

    const { result } = renderHook(() => useSermon('sermon-1'), { wrapper });

    expect(result.current.sermon).toEqual(baseSermon);
  });

  it('returns null when online and only cached list exists', () => {
    const { wrapper, queryClient } = createWrapper();
    const cached = { ...baseSermon, id: 'sermon-1', title: 'Cached' };
    queryClient.setQueryData(['sermons', 'user-1'], [cached]);

    mockUseOnlineStatus.mockReturnValue(true);
    mockUseServerFirstQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    } as any);

    const { result } = renderHook(() => useSermon('sermon-1'), { wrapper });

    expect(result.current.sermon).toBeNull();
  });

  it('hydrates cache from list when offline', async () => {
    const { wrapper, queryClient } = createWrapper();
    const cached = { ...baseSermon, id: 'sermon-1', title: 'Cached' };
    queryClient.setQueryData(['sermons', 'user-1'], [cached]);

    mockUseOnlineStatus.mockReturnValue(false);
    mockUseServerFirstQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    } as any);

    const { result } = renderHook(() => useSermon('sermon-1'), { wrapper });

    await waitFor(() => {
      expect(queryClient.getQueryData(['sermon', 'sermon-1'])).toEqual(cached);
    });

    expect(result.current.sermon).toEqual(cached);
    expect(debugLog).toHaveBeenCalled();
  });

  it('handles setSermon updater functions that return null', () => {
    const { wrapper, queryClient } = createWrapper();

    mockUseOnlineStatus.mockReturnValue(true);
    mockUseServerFirstQuery.mockReturnValue({
      data: baseSermon,
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    } as any);

    const { result } = renderHook(() => useSermon('sermon-1'), { wrapper });

    act(() => {
      result.current.setSermon(() => null);
    });

    expect(queryClient.getQueryData(['sermon', 'sermon-1'])).toBeUndefined();
  });

  it('sets sermon when updater is a direct value', () => {
    const { wrapper, queryClient } = createWrapper();
    const updated = { ...baseSermon, title: 'Updated' };

    mockUseOnlineStatus.mockReturnValue(true);
    mockUseServerFirstQuery.mockReturnValue({
      data: baseSermon,
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    } as any);

    const { result } = renderHook(() => useSermon('sermon-1'), { wrapper });

    act(() => {
      result.current.setSermon(updated);
    });

    expect(queryClient.getQueryData(['sermon', 'sermon-1'])).toEqual(updated);
  });

  it('skips offline hydration when data already exists', async () => {
    const { wrapper, queryClient } = createWrapper();

    mockUseOnlineStatus.mockReturnValue(false);
    mockUseServerFirstQuery.mockReturnValue({
      data: baseSermon,
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    } as any);

    const { result } = renderHook(() => useSermon('sermon-1'), { wrapper });

    await waitFor(() => {
      expect(result.current.sermon).toEqual(baseSermon);
    });

    expect(queryClient.getQueryData(['sermon', 'sermon-1'])).toBeUndefined();
    expect(debugLog).not.toHaveBeenCalled();
  });

  it('hydrates from guest uid cache when available', async () => {
    mutableAuth.currentUser = null;
    window.localStorage.setItem('guestUser', JSON.stringify({ uid: 'guest-1' }));

    const { wrapper, queryClient } = createWrapper();
    const cached = { ...baseSermon, id: 'sermon-1', title: 'Guest Cached' };
    queryClient.setQueryData(['sermons', 'guest-1'], [cached]);

    mockUseOnlineStatus.mockReturnValue(false);
    mockUseServerFirstQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    } as any);

    const { result } = renderHook(() => useSermon('sermon-1'), { wrapper });

    await waitFor(() => {
      expect(queryClient.getQueryData(['sermon', 'sermon-1'])).toEqual(cached);
    });

    expect(result.current.sermon).toEqual(cached);
  });

  it('does not hydrate when sermonId is empty', () => {
    const { wrapper, queryClient } = createWrapper();

    mockUseOnlineStatus.mockReturnValue(false);
    mockUseServerFirstQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    } as any);

    renderHook(() => useSermon(''), { wrapper });

    expect(queryClient.getQueryData(['sermon', ''])).toBeUndefined();
  });

  it('works without a resolved uid', () => {
    mutableAuth.currentUser = null;

    const { wrapper } = createWrapper();

    mockUseOnlineStatus.mockReturnValue(true);
    mockUseServerFirstQuery.mockReturnValue({
      data: baseSermon,
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    } as any);

    const { result } = renderHook(() => useSermon('sermon-1'), { wrapper });

    expect(result.current.sermon).toEqual(baseSermon);
  });
});
