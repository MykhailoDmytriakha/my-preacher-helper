import { QueryClient } from '@tanstack/react-query';

import { OfflineQueuedError } from '@/services/conflictSafeUpdate.client';
import { addPreachDate, updatePreachDate } from '@/services/preachDates.service';
import { updateSermon } from '@/services/sermon.service';
import {
  DASHBOARD_SERMON_MUTATION_KEYS,
  GROUP_MUTATION_KEYS,
  PLAN_TEMPLATE_MUTATION_KEYS,
  PRAYER_MUTATION_KEYS,
  registerOfflineMutationDefaults,
  TAG_MUTATION_KEYS,
} from '@/utils/mutationDefaults';

// Partial mocks only: a blanket mock of these modules breaks the moment someone adds an
// export to them, and it breaks far from where it was written.
jest.mock('@/services/sermon.service', () => ({
  ...jest.requireActual('@/services/sermon.service'),
  updateSermon: jest.fn(),
}));
jest.mock('@/services/preachDates.service', () => ({
  ...jest.requireActual('@/services/preachDates.service'),
  addPreachDate: jest.fn(),
  updatePreachDate: jest.fn(),
  deletePreachDate: jest.fn().mockResolvedValue(undefined),
}));

const mockUpdateSermon = updateSermon as jest.MockedFunction<typeof updateSermon>;
const mockAddPreachDate = addPreachDate as jest.MockedFunction<typeof addPreachDate>;
const mockUpdatePreachDate = updatePreachDate as jest.MockedFunction<typeof updatePreachDate>;

describe('registerOfflineMutationDefaults', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // A paused write the previous version left for an engine-owned collection is replayed after
  // reload with only its key and variables. It is refused with the typed migration error — the
  // text lives on in the previous-version archive — and no old writer runs.
  it.each([
    ...Object.values(GROUP_MUTATION_KEYS),
    ...Object.values(PRAYER_MUTATION_KEYS),
    ...Object.values(TAG_MUTATION_KEYS),
    ...Object.values(PLAN_TEMPLATE_MUTATION_KEYS),
  ].map(key => [key.join('/'), key] as const))('refuses a replayed %s for a collection the engine owns', async (_name, key) => {
    const queryClient = new QueryClient();
    registerOfflineMutationDefaults(queryClient);
    const mutationFn = queryClient.getMutationDefaults(key)?.mutationFn as (variables: unknown) => Promise<unknown>;
    await expect(mutationFn({ id: 'x', title: 'Unsent words' })).rejects.toMatchObject({ code: 'data-engine-required' });
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


// Sermons are engine-owned: a paused dashboard write of the previous version is refused before any service.
it.each(Object.entries(DASHBOARD_SERMON_MUTATION_KEYS))('refuses old %s replay before touching a service', async (_operation, key) => {
  const client = new QueryClient(); registerOfflineMutationDefaults(client);
  const mutation = client.getMutationDefaults(key).mutationFn as (input: unknown) => Promise<unknown>;
  await expect(mutation({})).rejects.toMatchObject({ code: 'data-engine-required', status: 426 });
});
