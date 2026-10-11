import { useQueryClient } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import React, { useEffect } from 'react';
import { toast } from 'sonner';

import { QueryProvider, shouldDehydrateMutation } from '@/providers/QueryProvider';
import { preserveLegacyQueryCache } from '@/data-engine/legacyQueryRecovery.client';
import { UsageCapReachedError } from '@/services/usageLimits';
import { createIDBPersister } from '@/utils/queryPersister';

jest.mock('@/utils/queryPersister', () => ({
  createIDBPersister: jest.fn(),
}));
jest.mock('@/data-engine/legacyQueryRecovery.client', () => ({ preserveLegacyQueryCache: jest.fn() }));

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

  it.each(['councils', 'users'])('does not mount the cache persister until %s migration input is durably preserved', async collection => {
    const previous = process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS;
    process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = collection;
    let finish!: () => void;
    jest.mocked(preserveLegacyQueryCache).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    mockCreateIDBPersister.mockReturnValue({ persistClient: jest.fn(), restoreClient: jest.fn(), removeClient: jest.fn() });
    try {
      const view = render(<QueryProvider><p>Workspace</p></QueryProvider>);
      await waitFor(() => expect(preserveLegacyQueryCache).toHaveBeenCalled());
      expect(mockCreateIDBPersister).not.toHaveBeenCalled();
      expect(screen.queryByText('Workspace')).not.toBeInTheDocument();
      finish();
      expect(await screen.findByText('Workspace')).toBeInTheDocument();
      expect(mockCreateIDBPersister).toHaveBeenCalledTimes(1);
      view.unmount();
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS;
      else process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = previous;
    }
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
    // A query nothing watches stays in memory, so the next save of the cache still carries it
    // (BUG-20260930-legacy-cache-week-expiry: seen once, seen offline however long ago).
    expect(queriesDefaults?.gcTime).toBe(Infinity);
    
    // Test jitter logic
    const retryDelayFn = mutationsDefaults?.retryDelay as (attemptIndex: number) => number;
    const delay0 = retryDelayFn(0);
    expect(delay0).toBeGreaterThanOrEqual(0);
    expect(delay0).toBeLessThanOrEqual(1000);
    
    expect(mockCreateIDBPersister).toHaveBeenCalled();
  });

  it('never retries a REFUSAL, only transient failures', async () => {
    // Found live: the note editor showed "Saving…" for about a minute and the
    // conflict choice never appeared, because a StaleWriteError went through the
    // whole five-step retry ladder. Retrying a refusal is worse than useless — with
    // the freshness listener advancing the revision meanwhile, one of those retries
    // can LAND and overwrite the other device.
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
    const retry = client.getDefaultOptions().mutations?.retry as (
      failureCount: number,
      error: unknown
    ) => boolean;

    const refusal = Object.assign(new Error('refused'), { isStaleWrite: true });
    const rulesRefusal = Object.assign(new Error('denied'), { code: 'permission-denied' });
    const queued = Object.assign(new Error('queued'), { isOfflineQueued: true });

    expect(retry(0, refusal)).toBe(false);
    expect(retry(0, rulesRefusal)).toBe(false);
    expect(retry(0, queued)).toBe(false);
    // A transient failure still gets the retries that offline work depends on.
    expect(retry(0, new Error('network hiccup'))).toBe(true);
    expect(retry(5, new Error('network hiccup'))).toBe(false);
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

    // Through the translation layer, and saying only the CAUSE. The old wording promised
    // "edits are saved locally", which contradicted the write's own recovery message
    // ("nothing was saved") and pointed the person at the wrong action.
    expect(toast.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ id: 'auth-expired-error' })
    );
    const said = (toast.error as jest.Mock).mock.calls[0][0] as string;
    expect(said).not.toMatch(/saved locally/i);
  });

  /**
   * A REFUSAL IS HELD ON SCREEN, NOT FLASHED PAST.
   *
   * This used to assert a toast — which is how the message ended up stacked under another
   * toast, below the fold, needing a hover to be read, and gone on a timer.
   */
  it('raises the hard-cap dialog globally for a typed mutation error', async () => {
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

    await waitFor(() => expect(screen.getByTestId('usage-cap-dialog')).toBeInTheDocument());
    expect(toast).not.toHaveBeenCalled();
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

describe('QueryProvider — React Query follows the one answer about the connection', () => {
  /**
   * BUG-20261010-engine-online-flag-not-reread-on-return, third row: React Query's own "online" came
   * from the browser's events, so a successful check of the connection did not wake what it had
   * paused. Now it follows `utils/connectivity`: a request that reaches the server resumes paused
   * work even when the phone never fired `online` (an iPad resumed with its flag stuck at false).
   */
  beforeEach(() => {
    jest.clearAllMocks();
    const { __resetConnectivityForTests } = jest.requireActual('@/utils/connectivity');
    __resetConnectivityForTests();
    Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
    mockCreateIDBPersister.mockReturnValue({ persistClient: jest.fn(), restoreClient: jest.fn(), removeClient: jest.fn() });
  });

  it('resumes a paused save when a request reaches the server, with no `online` event', async () => {
    const { reportServerReachable } = jest.requireActual('@/utils/connectivity');
    const onReady = jest.fn();
    render(<QueryProvider><ClientProbe onReady={onReady} /></QueryProvider>);
    await waitFor(() => expect(onReady).toHaveBeenCalled());
    const client = onReady.mock.calls[0][0] as ReturnType<typeof useQueryClient>;

    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    window.dispatchEvent(new Event('offline'));

    const save = jest.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue('saved');
    const done = client.getMutationCache().build(client, { mutationFn: save, retry: 3, retryDelay: 0 }).execute(undefined);
    await waitFor(() => expect(client.getMutationCache().getAll()[0].state.isPaused).toBe(true));
    expect(save).toHaveBeenCalledTimes(1);

    // The flag stays false; the knock (or any request) reaches our server.
    reportServerReachable();
    await expect(done).resolves.toBe('saved');
    expect(save).toHaveBeenCalledTimes(2);
  });
});
