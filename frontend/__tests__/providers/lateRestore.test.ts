import { QueryClient } from '@tanstack/react-query';

import { persistQueryClientRestore } from '@tanstack/react-query-persist-client';

import { HELD_AFTER_LATE_RESTORE, PERSISTED_CACHE_MAX_AGE, takeInLateRestore } from '@/providers/QueryProvider';

import type { PersistedClient } from '@tanstack/react-query-persist-client';

/*
 * A QUERY-CACHE RESTORE THAT ANSWERED LATE (BUG-20260927-engine-open-hangs-on-silent-device-storage).
 * The app stopped waiting for it after the silence threshold; when it answers it must still be
 * taken in, but last session's offline edits must not be replayed over what this session changed.
 */
const restored = (overrides: Partial<PersistedClient> = {}): PersistedClient => ({
  timestamp: Date.now(),
  buster: '',
  clientState: {
    mutations: [],
    queries: [{ queryKey: ['entitlement'], queryHash: '["entitlement"]', state: {
      data: { tier: 'pro' }, dataUpdateCount: 1, dataUpdatedAt: Date.now(), error: null, errorUpdateCount: 0, errorUpdatedAt: 0,
      fetchFailureCount: 0, fetchFailureReason: null, fetchMeta: null, isInvalidated: false, status: 'success', fetchStatus: 'idle',
    } }],
  },
  ...overrides,
} as unknown as PersistedClient);

const pausedEdit = {
  mutationKey: ['settings', 'update'],
  state: { context: undefined, data: undefined, error: null, failureCount: 0, failureReason: null, isPaused: true, status: 'pending', variables: { theme: 'dark' }, submittedAt: Date.now() - 60_000 },
};

describe('taking in a late query-cache restore', () => {
  it('takes in what was read', () => {
    const client = new QueryClient();

    takeInLateRestore(client, restored());

    expect(client.getQueryData(['entitlement'])).toEqual({ tier: 'pro' });
  });

  it('holds last session\'s offline edits for the person instead of replaying them over newer changes', () => {
    const client = new QueryClient();
    const resume = jest.spyOn(client, 'resumePausedMutations');

    takeInLateRestore(client, restored({ clientState: { queries: [], mutations: [pausedEdit] } as unknown as PersistedClient['clientState'] }));

    const [held] = client.getMutationCache().getAll();
    expect(held.state.isPaused).toBe(false);
    expect(held.state.status).toBe('error');
    expect(held.state.variables).toEqual({ theme: 'dark' });
    expect((held.state.error as { code?: string }).code).toBe(HELD_AFTER_LATE_RESTORE);
    expect(resume).not.toHaveBeenCalled();
  });

  it('ignores a restore from another cache version', () => {
    const client = new QueryClient();
    takeInLateRestore(client, restored({ buster: 'other' }));
    expect(client.getQueryData(['entitlement'])).toBeUndefined();
  });

  // BUG-20260930-legacy-cache-week-expiry: what this device saw stays, however long ago.
  it('takes in a restore however old it is', () => {
    const client = new QueryClient();
    takeInLateRestore(client, restored({ timestamp: Date.now() - 30 * 24 * 60 * 60 * 1000 }));
    expect(client.getQueryData(['entitlement'])).toEqual({ tier: 'pro' });
  });
});

/*
 * The timely restore goes through TanStack's own restore with the provider's options: a copy last
 * written a month ago — the app simply not opened since — still comes back, offline edits included.
 */
describe('restoring the saved query cache after a long pause', () => {
  it('brings back what was seen and the edits not yet sent, a month later', async () => {
    const client = new QueryClient();
    const month = restored({
      timestamp: Date.now() - 30 * 24 * 60 * 60 * 1000,
      clientState: { ...restored().clientState, mutations: [pausedEdit] } as PersistedClient['clientState'],
    });
    const persister = { persistClient: jest.fn(), restoreClient: jest.fn().mockResolvedValue(month), removeClient: jest.fn() };

    await persistQueryClientRestore({ queryClient: client, persister, maxAge: PERSISTED_CACHE_MAX_AGE });

    expect(persister.removeClient).not.toHaveBeenCalled();
    expect(client.getQueryData(['entitlement'])).toEqual({ tier: 'pro' });
    expect(client.getMutationCache().getAll()).toHaveLength(1);
  });

});

it.each([
  ['older source with a later local clock', '1794036480:500000001', 400, false],
  ['newer source with an equal local clock', '1794036480:500000003', 300, true],
  ['newer source with a rolled-back local clock', '1794036480:500000003', 200, true],
] as const)('uses source order for a late restore: %s', (_label, readVersion, updatedAt, takeSaved) => {
  const queryKey = ['referral-stats', 'owner'];
  const client = new QueryClient();
  const live = { readVersion: '1794036480:500000002', value: 1 };
  const saved = { readVersion, value: 2 };
  client.setQueryData(queryKey, live, { updatedAt: 300 });
  const copy = restored();
  const query = copy.clientState.queries[0];
  query.queryKey = queryKey;
  query.queryHash = JSON.stringify(queryKey);
  query.state.data = saved;
  query.state.dataUpdatedAt = updatedAt;

  takeInLateRestore(client, copy);

  expect(client.getQueryData(queryKey)).toEqual(takeSaved ? saved : live);
  client.clear();
});

it('does not replace a terminal server refusal with a late device copy', () => {
  const queryKey = ['referral-stats', 'owner'];
  const client = new QueryClient();
  const queryHash = JSON.stringify(queryKey);
  client.setQueryData(queryKey, { readVersion: '1794036480:500000001', value: 1 });
  const refusal = new Error('Unauthorized');
  client.getQueryCache().get(queryHash)!.setState({ status: 'error', error: refusal });
  const copy = restored();
  const query = copy.clientState.queries[0];
  query.queryKey = queryKey;
  query.queryHash = queryHash;
  query.state.data = { readVersion: '1794036480:500000002', value: 2 };

  takeInLateRestore(client, copy);

  expect(client.getQueryState(queryKey)).toMatchObject({ status: 'error', error: refusal });
  client.clear();
});
