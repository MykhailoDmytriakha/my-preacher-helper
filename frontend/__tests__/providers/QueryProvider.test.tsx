import { useQueryClient } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import React, { useEffect } from 'react';
import { toast } from 'sonner';

import { QueryProvider, shouldDehydrateMutation } from '@/providers/QueryProvider';
import { UsageCapReachedError } from '@/services/usageLimits';
import { createIDBPersister } from '@/utils/queryPersister';

jest.mock('@/utils/queryPersister', () => ({
  createIDBPersister: jest.fn(),
}));

jest.mock('sonner', () => ({
  toast: Object.assign(jest.fn(), { error: jest.fn() })
}));

const mockCreateIDBPersister = createIDBPersister as jest.MockedFunction<typeof createIDBPersister>;

const ClientProbe = ({ onReady }: { onReady: (client: ReturnType<typeof useQueryClient>) => void }) => {
  const client = useQueryClient();

  useEffect(() => {
    onReady(client);
  }, [client, onReady]);

  return null;
};

describe('QueryProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('configures the query client with expected defaults', async () => {
    mockCreateIDBPersister.mockReturnValue({
      persistClient: jest.fn(),
      restoreClient: jest.fn(),
      removeClient: jest.fn(),
    });

    const onReady = jest.fn();

    render(
      <QueryProvider>
        <ClientProbe onReady={onReady} />
      </QueryProvider>
    );

    await waitFor(() => expect(onReady).toHaveBeenCalled());

    const client = onReady.mock.calls[0][0];
    const queriesDefaults = client.getDefaultOptions().queries;
    const mutationsDefaults = client.getDefaultOptions().mutations;

    expect(queriesDefaults?.staleTime).toBe(30000);
    expect(queriesDefaults?.refetchOnMount).toBe(true);
    expect(queriesDefaults?.networkMode).toBe('offlineFirst');
    
    // Test jitter logic
    const retryDelayFn = mutationsDefaults?.retryDelay as (attemptIndex: number) => number;
    const delay0 = retryDelayFn(0);
    expect(delay0).toBeGreaterThanOrEqual(0);
    expect(delay0).toBeLessThanOrEqual(1000);
    
    expect(mockCreateIDBPersister).toHaveBeenCalled();
  });

  it('handles global 401 mutation errors', async () => {
    mockCreateIDBPersister.mockReturnValue({
      persistClient: jest.fn(),
      restoreClient: jest.fn(),
      removeClient: jest.fn(),
    });

    const onReady = jest.fn();

    render(
      <QueryProvider>
        <ClientProbe onReady={onReady} />
      </QueryProvider>
    );

    await waitFor(() => expect(onReady).toHaveBeenCalled());

    const client = onReady.mock.calls[0][0];
    const mutationCache = client.getMutationCache();
    
    // Simulate a 401 error
    const onError = (mutationCache.config as any).onError;
    onError({ status: 401, message: 'Unauthorized' });

    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining('session has expired'),
      expect.objectContaining({ id: 'auth-expired-error' })
    );
  });

  it('shows the hard-cap message globally for a typed mutation error', async () => {
    mockCreateIDBPersister.mockReturnValue({
      persistClient: jest.fn(),
      restoreClient: jest.fn(),
      removeClient: jest.fn(),
    });
    const onReady = jest.fn();

    render(
      <QueryProvider>
        <ClientProbe onReady={onReady} />
      </QueryProvider>
    );

    await waitFor(() => expect(onReady).toHaveBeenCalled());
    const client = onReady.mock.calls[0][0];
    const onError = (client.getMutationCache().config as any).onError;
    onError(new UsageCapReachedError(
      'ai',
      110,
      100,
      110,
      '2026-08-01T00:00:00.000Z'
    ));

    await waitFor(() => expect(toast).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        id: 'usage-hard-cap:ai:2026-08-01T00:00:00.000Z',
      })
    ));
  });

  describe('shouldDehydrateMutation', () => {
    it('persists paused (offline-queued) mutations — resumePausedMutations replays them', () => {
      expect(shouldDehydrateMutation({ state: { isPaused: true, status: 'pending' } })).toBe(true);
    });

    it('persists error mutations — rehydrated as retryable error badges', () => {
      expect(shouldDehydrateMutation({ state: { isPaused: false, status: 'error' } })).toBe(true);
    });

    it('does NOT persist in-flight pending mutations — v5 cannot resume them (zombie badges)', () => {
      expect(shouldDehydrateMutation({ state: { isPaused: false, status: 'pending' } })).toBe(false);
    });

    it('does NOT persist successful mutations', () => {
      expect(shouldDehydrateMutation({ state: { isPaused: false, status: 'success' } })).toBe(false);
    });
  });
});
