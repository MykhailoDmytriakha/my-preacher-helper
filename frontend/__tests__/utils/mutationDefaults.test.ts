import { QueryClient } from '@tanstack/react-query';

import {
  DASHBOARD_SERMON_MUTATION_KEYS,
  GROUP_MUTATION_KEYS,
  PLAN_TEMPLATE_MUTATION_KEYS,
  PRAYER_MUTATION_KEYS,
  PREACH_DATE_MUTATION_KEYS,
  registerOfflineMutationDefaults,
  TAG_MUTATION_KEYS,
} from '@/utils/mutationDefaults';

describe('registerOfflineMutationDefaults', () => {
  // A paused write the previous version left for an engine-owned collection is replayed after
  // reload with only its key and variables. It is refused with the typed migration error — the
  // text lives on in the previous-version archive — and no old writer runs.
  it.each([
    ...Object.values(GROUP_MUTATION_KEYS),
    ...Object.values(PRAYER_MUTATION_KEYS),
    ...Object.values(TAG_MUTATION_KEYS),
    ...Object.values(PLAN_TEMPLATE_MUTATION_KEYS),
    ...Object.values(DASHBOARD_SERMON_MUTATION_KEYS),
    ...Object.values(PREACH_DATE_MUTATION_KEYS),
  ].map(key => [key.join('/'), key] as const))('refuses a replayed %s for a collection the engine owns', async (_name, key) => {
    const queryClient = new QueryClient();
    registerOfflineMutationDefaults(queryClient);
    const mutationFn = queryClient.getMutationDefaults(key)?.mutationFn as (variables: unknown) => Promise<unknown>;
    await expect(mutationFn({ id: 'x', title: 'Unsent words' })).rejects.toMatchObject({ code: 'data-engine-required' });
  });
});
