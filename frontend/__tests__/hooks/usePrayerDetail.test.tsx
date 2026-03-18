import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';

import { usePrayerDetail } from '@/hooks/usePrayerDetail';
import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import { getPrayerRequestById } from '@services/prayerRequests.service';

import type { ReactNode } from 'react';

jest.mock('@/hooks/useServerFirstQuery', () => ({
  useServerFirstQuery: jest.fn(),
}));

jest.mock('@services/prayerRequests.service', () => ({
  getPrayerRequestById: jest.fn(),
}));

jest.mock('@services/firebaseAuth.service', () => ({
  auth: { currentUser: { uid: 'user-1' } },
}));

const mockUseServerFirstQuery = useServerFirstQuery as jest.MockedFunction<typeof useServerFirstQuery>;
const mockGetPrayerRequestById = getPrayerRequestById as jest.MockedFunction<typeof getPrayerRequestById>;

const createWrapper = (queryClient: QueryClient) => {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('usePrayerDetail', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseServerFirstQuery.mockReturnValue({ data: undefined } as any);
    mockGetPrayerRequestById.mockResolvedValue(undefined);
  });

  it('prefers the cached list item and disables the fetch seam when present', () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
    });

    const cachedPrayer = {
      id: 'p1',
      userId: 'user-1',
      title: 'Cached prayer',
      status: 'active',
      updates: [],
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-02T00:00:00.000Z',
    };

    queryClient.setQueryData(['prayerRequests', 'user-1'], [cachedPrayer]);

    const { result } = renderHook(() => usePrayerDetail('p1'), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.prayer).toEqual(cachedPrayer);
    expect(mockUseServerFirstQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['prayerRequest', 'p1'],
        enabled: false,
      })
    );
  });

  it('returns fetched prayer data and exposes a direct query function for the file seam', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
    });

    const fetchedPrayer = {
      id: 'p2',
      userId: 'user-1',
      title: 'Fetched prayer',
      status: 'answered',
      updates: [],
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-03T00:00:00.000Z',
      answeredAt: '2026-03-04T00:00:00.000Z',
    };

    mockUseServerFirstQuery.mockReturnValue({ data: fetchedPrayer } as any);
    mockGetPrayerRequestById.mockResolvedValue(fetchedPrayer as any);

    const { result } = renderHook(() => usePrayerDetail('p2'), {
      wrapper: createWrapper(queryClient),
    });

    const options = mockUseServerFirstQuery.mock.calls[0][0];
    await expect(options.queryFn({} as any)).resolves.toEqual(fetchedPrayer);
    expect(options.enabled).toBe(true);
    expect(mockGetPrayerRequestById).toHaveBeenCalledWith('p2');
    expect(result.current.prayer).toEqual(fetchedPrayer);
  });

  it('returns null and disables fetching when no prayer id is provided', () => {
    const { auth } = jest.requireMock('@services/firebaseAuth.service') as {
      auth: { currentUser: { uid?: string } | null };
    };
    auth.currentUser = null;

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
    });

    const { result } = renderHook(() => usePrayerDetail(''), {
      wrapper: createWrapper(queryClient),
    });

    expect(mockUseServerFirstQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['prayerRequest', ''],
        enabled: false,
      })
    );
    expect(result.current.prayer).toBeNull();
  });
});
