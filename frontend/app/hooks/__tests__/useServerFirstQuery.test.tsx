import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';

import { useServerFirstQuery } from '../useServerFirstQuery';

jest.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: jest.fn(),
}));

jest.mock('@/utils/debugMode', () => ({
  debugLog: jest.fn(),
}));

const mockUseOnlineStatus = useOnlineStatus as jest.MockedFunction<typeof useOnlineStatus>;

const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

const createWrapper = (queryClient: QueryClient) => {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('useServerFirstQuery', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns fresh cached data immediately while online without refetching on mount', () => {
    const queryClient = createQueryClient();
    const cachedData = { id: 'cached', title: 'Cached sermon' };
    queryClient.setQueryData(['sermon', '1'], cachedData);
    mockUseOnlineStatus.mockReturnValue(true);

    const queryFn = jest.fn().mockResolvedValue({ id: 'server', title: 'Server sermon' });

    const { result } = renderHook(
      () =>
        useServerFirstQuery({
          queryKey: ['sermon', '1'],
          queryFn,
        }),
      { wrapper: createWrapper(queryClient) }
    );

    expect(result.current.data).toEqual(cachedData);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isOnline).toBe(true);
    expect(queryFn).not.toHaveBeenCalled();
  });

  it('returns cached data while offline and does not call the query function', () => {
    const queryClient = createQueryClient();
    const cachedData = [{ id: 'note-1', title: 'Cached note' }];
    queryClient.setQueryData(['study-notes', 'user-1'], cachedData);
    mockUseOnlineStatus.mockReturnValue(false);

    const queryFn = jest.fn().mockResolvedValue([{ id: 'note-2', title: 'Server note' }]);

    const { result } = renderHook(
      () =>
        useServerFirstQuery({
          queryKey: ['study-notes', 'user-1'],
          queryFn,
        }),
      { wrapper: createWrapper(queryClient) }
    );

    expect(result.current.data).toEqual(cachedData);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isOnline).toBe(false);
    expect(queryFn).not.toHaveBeenCalled();
  });

  it('does not call the query function while offline and no cache exists', () => {
    const queryClient = createQueryClient();
    mockUseOnlineStatus.mockReturnValue(false);

    const queryFn = jest.fn().mockResolvedValue({ id: 'server' });

    const { result } = renderHook(
      () =>
        useServerFirstQuery({
          queryKey: ['sermon', 'missing'],
          queryFn,
        }),
      { wrapper: createWrapper(queryClient) }
    );

    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isOnline).toBe(false);
    expect(queryFn).not.toHaveBeenCalled();
  });

  it('fetches when online and no cached data exists', async () => {
    const queryClient = createQueryClient();
    mockUseOnlineStatus.mockReturnValue(true);

    const serverData = { id: 'server', title: 'Server sermon' };
    const queryFn = jest.fn().mockResolvedValue(serverData);

    const { result } = renderHook(
      () =>
        useServerFirstQuery({
          queryKey: ['sermon', '2'],
          queryFn,
        }),
      { wrapper: createWrapper(queryClient) }
    );

    await waitFor(() => expect(result.current.data).toEqual(serverData));

    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isOnline).toBe(true);
  });
});
