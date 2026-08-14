import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { usePrayerDetail } from '@/hooks/usePrayerDetail';
import { getPrayerRequestById } from '@services/prayerRequests.service';

import type { PrayerRequest } from '@/models/models';
import type { ReactNode } from 'react';

jest.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: jest.fn(),
}));

jest.mock('@services/prayerRequests.service', () => ({
  getPrayerRequestById: jest.fn(),
}));

const mockUseOnlineStatus = useOnlineStatus as jest.MockedFunction<typeof useOnlineStatus>;
const mockGetPrayerRequestById = getPrayerRequestById as jest.MockedFunction<
  typeof getPrayerRequestById
>;

const prayerWith = (
  title: string,
  revision: number,
  updatedAt = '2026-08-01T00:00:00.000Z'
): PrayerRequest => ({
  id: 'prayer-1',
  userId: 'test-user-id',
  title,
  status: 'active',
  updates: [],
  createdAt: '2026-03-01T00:00:00.000Z',
  updatedAt,
  rev: { content: revision },
});

const renderPrayer = (stored: PrayerRequest | null, prayerId = 'prayer-1') => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 0 } },
  });
  if (stored) {
    // jest.setup.js signs this suite in as test-user-id. A different owner key
    // would miss the production lookup and make the regression test meaningless.
    queryClient.setQueryData(['prayerRequests', 'test-user-id'], [stored]);
  }
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { ...renderHook(() => usePrayerDetail(prayerId), { wrapper }), queryClient };
};

describe('usePrayerDetail · which copy the screen shows', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseOnlineStatus.mockReturnValue(true);
  });

  it('shows the newer server copy instead of an older prayer cached in the list', async () => {
    const stored = prayerWith('Older prayer left on this device', 1);
    mockGetPrayerRequestById.mockResolvedValue(
      prayerWith('Newer prayer saved elsewhere', 2)
    );

    const { result } = renderPrayer(stored);

    await waitFor(() =>
      expect(result.current.prayer?.title).toBe('Newer prayer saved elsewhere')
    );
    expect(mockGetPrayerRequestById).toHaveBeenCalledWith('prayer-1');
  });

  it('keeps an unsaved local edit when the server revision is not ahead', async () => {
    const stored = prayerWith('Edited here, not saved yet', 4);
    mockGetPrayerRequestById.mockResolvedValue(prayerWith('What the server still holds', 4));

    const { result } = renderPrayer(stored);

    await waitFor(() => expect(mockGetPrayerRequestById).toHaveBeenCalledWith('prayer-1'));
    expect(result.current.prayer?.title).toBe('Edited here, not saved yet');
  });

  it('reads the stored prayer and leaves the network alone while offline', () => {
    mockUseOnlineStatus.mockReturnValue(false);
    const stored = prayerWith('Available without a connection', 1);

    const { result } = renderPrayer(stored);

    expect(result.current.prayer?.title).toBe('Available without a connection');
    expect(mockGetPrayerRequestById).not.toHaveBeenCalled();
  });

  it('receives a stored prayer when the offline list hydrates after mount', async () => {
    mockUseOnlineStatus.mockReturnValue(false);
    const { result, queryClient } = renderPrayer(null);

    expect(result.current.prayer).toBeNull();
    act(() => {
      queryClient.setQueryData(
        ['prayerRequests', 'test-user-id'],
        [prayerWith('Restored from this device', 1)]
      );
    });

    await waitFor(() =>
      expect(result.current.prayer?.title).toBe('Restored from this device')
    );
    expect(mockGetPrayerRequestById).not.toHaveBeenCalled();
  });

  it('keeps showing the stored prayer when the server request fails', async () => {
    const stored = prayerWith('Still readable after a failed refresh', 1);
    mockGetPrayerRequestById.mockRejectedValue(new Error('network down'));

    const { result } = renderPrayer(stored);

    await waitFor(() => expect(mockGetPrayerRequestById).toHaveBeenCalledWith('prayer-1'));
    expect(result.current.prayer?.title).toBe('Still readable after a failed refresh');
  });

  it('fetches a prayer that is missing from the cached list', async () => {
    mockGetPrayerRequestById.mockResolvedValue(prayerWith('Exists on the server', 1));

    const { result } = renderPrayer(null);

    await waitFor(() => expect(result.current.prayer?.title).toBe('Exists on the server'));
  });

  it('returns null and does not fetch when no prayer id is provided', () => {
    const { result } = renderPrayer(null, '');

    expect(result.current.prayer).toBeNull();
    expect(mockGetPrayerRequestById).not.toHaveBeenCalled();
  });
});
