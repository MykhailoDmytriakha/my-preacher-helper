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
});
