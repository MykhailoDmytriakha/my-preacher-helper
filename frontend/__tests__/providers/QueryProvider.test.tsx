import { useQueryClient } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import React, { useEffect } from 'react';
import { toast } from 'sonner';

import { QueryProvider } from '@/providers/QueryProvider';
import { createIDBPersister } from '@/utils/queryPersister';

jest.mock('@/utils/queryPersister', () => ({
  createIDBPersister: jest.fn(),
}));

jest.mock('sonner', () => ({
  toast: { error: jest.fn() }
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
});
