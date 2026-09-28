import { QueryClient } from '@tanstack/react-query';

import { HELD_AFTER_LATE_RESTORE, takeInLateRestore } from '@/providers/QueryProvider';

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

  it('ignores a restore the provider would have discarded: too old, or from another cache version', () => {
    const client = new QueryClient();
    takeInLateRestore(client, restored({ timestamp: Date.now() - 8 * 24 * 60 * 60 * 1000 }));
    takeInLateRestore(client, restored({ buster: 'other' }));
    expect(client.getQueryData(['entitlement'])).toBeUndefined();
  });
});
