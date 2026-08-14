import { QueryClient } from '@tanstack/react-query';

import { OfflineQueuedError } from '@/services/conflictSafeUpdate.client';
import { createGroup, deleteGroup, updateGroup } from '@/services/groups.service';
import {
  DASHBOARD_SERMON_MUTATION_KEYS,
  GROUP_MUTATION_KEYS,
  registerOfflineMutationDefaults,
} from '@/utils/mutationDefaults';

jest.mock('@/services/groups.service', () => ({
  createGroup: jest.fn().mockResolvedValue({ id: 'g1' }),
  updateGroup: jest.fn().mockResolvedValue({ id: 'g1' }),
  deleteGroup: jest.fn().mockResolvedValue(undefined),
}));

const mockCreateGroup = createGroup as jest.MockedFunction<typeof createGroup>;
const mockUpdateGroup = updateGroup as jest.MockedFunction<typeof updateGroup>;
const mockDeleteGroup = deleteGroup as jest.MockedFunction<typeof deleteGroup>;

describe('registerOfflineMutationDefaults', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('registers a resumable mutationFn for each group write key', () => {
    const queryClient = new QueryClient();
    registerOfflineMutationDefaults(queryClient);

    expect(typeof queryClient.getMutationDefaults(GROUP_MUTATION_KEYS.create)?.mutationFn).toBe('function');
    expect(typeof queryClient.getMutationDefaults(GROUP_MUTATION_KEYS.update)?.mutationFn).toBe('function');
    expect(typeof queryClient.getMutationDefaults(GROUP_MUTATION_KEYS.delete)?.mutationFn).toBe('function');
  });

  it('routes each registered mutationFn to its service call (replay path after reload)', async () => {
    // After a page reload a paused mutation rehydrated from IndexedDB carries only
    // its mutationKey + variables — the original useMutation closure is gone. The
    // registered default is what `resumePausedMutations()` actually invokes. This
    // asserts that link is wired correctly for every group write.
    const queryClient = new QueryClient();
    registerOfflineMutationDefaults(queryClient);

    const createFn = queryClient.getMutationDefaults(GROUP_MUTATION_KEYS.create)?.mutationFn as (
      v: unknown
    ) => Promise<unknown>;
    const updateFn = queryClient.getMutationDefaults(GROUP_MUTATION_KEYS.update)?.mutationFn as (
      v: unknown
    ) => Promise<unknown>;
    const deleteFn = queryClient.getMutationDefaults(GROUP_MUTATION_KEYS.delete)?.mutationFn as (
      v: unknown
    ) => Promise<unknown>;

    await createFn({ userId: 'u', title: 'T' });
    await updateFn({ id: 'g1', updates: { title: 'X' } });
    await deleteFn('g1');

    expect(mockCreateGroup).toHaveBeenCalledWith({ userId: 'u', title: 'T' });
    expect(mockUpdateGroup).toHaveBeenCalledWith('g1', { title: 'X' });
    expect(mockDeleteGroup).toHaveBeenCalledWith('g1');
  });

  it('does NOT roll the sermon row back when the write was QUEUED, not refused', async () => {
    /**
     * Nominally online, Firestore unreachable: `conflictSafeUpdate` stores the edit in the
     * durable outbox and throws `OfflineQueuedError`. That is a receipt. Rolling back here
     * took the person's edit off the screen while it sat safely waiting to replay — the
     * screen contradicting what was actually kept.
     */
    const queryClient = new QueryClient();
    registerOfflineMutationDefaults(queryClient);
    const setQueryData = jest.spyOn(queryClient, 'setQueryData');

    const onError = queryClient.getMutationDefaults(DASHBOARD_SERMON_MUTATION_KEYS.update)
      ?.onError as (error: unknown, vars: unknown, ctx: unknown) => Promise<void>;

    await onError(
      new OfflineQueuedError('core'),
      { uid: 'user-1', sermonId: 's1', input: { sermon: { id: 's1', title: 'old' } } },
      undefined
    );

    expect(setQueryData).not.toHaveBeenCalled();
  });
});
