import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';

jest.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: jest.fn(),
}));

const mockUseOnlineStatus = useOnlineStatus as jest.MockedFunction<typeof useOnlineStatus>;

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return { queryClient, wrapper };
};

describe('useServerFirstQuery', () => {
  it('returns data after server fetch when online', async () => {
    mockUseOnlineStatus.mockReturnValue(true);
    const { wrapper } = createWrapper();
    const queryFn = jest.fn().mockResolvedValue('server-data');

    const { result } = renderHook(
      () =>
        useServerFirstQuery({
          queryKey: ['server-first', 'online'],
          queryFn,
        }),
      { wrapper }
    );

    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.data).toBe('server-data');
    });

    expect(result.current.isLoading).toBe(false);
    expect(queryFn).toHaveBeenCalled();
  });

  it('returns cached data when offline and does not fetch', () => {
    mockUseOnlineStatus.mockReturnValue(false);
    const { queryClient, wrapper } = createWrapper();

    queryClient.setQueryData(['server-first', 'offline'], 'cached-data');

    const queryFn = jest.fn().mockResolvedValue('server-data');

    const { result } = renderHook(
      () =>
        useServerFirstQuery({
          queryKey: ['server-first', 'offline'],
          queryFn,
        }),
      { wrapper }
    );

    expect(result.current.data).toBe('cached-data');
    expect(result.current.isLoading).toBe(false);
    expect(queryFn).not.toHaveBeenCalled();
  });

  it('throws when queryFn is missing', () => {
    mockUseOnlineStatus.mockReturnValue(true);
    const { wrapper } = createWrapper();

    expect(() =>
      renderHook(
        () =>
          useServerFirstQuery({
            queryKey: ['server-first', 'missing-queryfn'],
          } as any),
        { wrapper }
      )
    ).toThrow('useServerFirstQuery requires a queryFn.');
  });

  it('reveals error data when online and fetch fails', async () => {
    mockUseOnlineStatus.mockReturnValue(true);
    const { wrapper } = createWrapper();
    const queryFn = jest.fn().mockRejectedValue(new Error('fetch failed'));

    const { result } = renderHook(
      () =>
        useServerFirstQuery({
          queryKey: ['server-first', 'error'],
          queryFn,
          retry: false,
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
  });

  it('handles disabled state correctly', () => {
    mockUseOnlineStatus.mockReturnValue(true);
    const { wrapper } = createWrapper();
    const queryFn = jest.fn();

    const { result } = renderHook(
      () =>
        useServerFirstQuery({
          queryKey: ['server-first', 'disabled'],
          queryFn,
          enabled: false,
        }),
      { wrapper }
    );

    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(queryFn).not.toHaveBeenCalled();
  });

  /**
   * A CALLER THAT ASKS FOR A FOCUS REFETCH MUST GET ONE.
   *
   * Cache-first switches the focus refetch OFF by default, which is right for screens
   * with a document listener and wrong for the calendar — it has none, so a date added
   * on the phone stayed invisible on a laptop left open. The calendar asks for the focus
   * refetch explicitly; if this wrapper ever swallowed that request, the screen would go
   * back to being silently stale with nothing to notice it.
   */
  it('honours an explicit focus refetch even in cache-first mode', async () => {
    mockUseOnlineStatus.mockReturnValue(true);
    const { wrapper } = createWrapper();
    const queryFn = jest.fn().mockResolvedValue('server-data');

    const { result } = renderHook(
      () =>
        useServerFirstQuery({
          queryKey: ['focus-refetch'],
          queryFn,
          refetchOnWindowFocus: true,
          staleTime: 0,
        }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.data).toBe('server-data'));
    expect(queryFn).toHaveBeenCalledTimes(1);

    // Coming back to the tab is exactly the moment work continues from another device.
    window.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));

    await waitFor(() => expect(queryFn.mock.calls.length).toBeGreaterThan(1));
  });
});
