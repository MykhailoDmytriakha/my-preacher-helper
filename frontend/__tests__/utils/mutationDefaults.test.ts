import { QueryClient } from '@tanstack/react-query';

import { apiClient } from '@/utils/apiClient';
import {
  DASHBOARD_SERMON_MUTATION_KEYS,
  GROUP_MUTATION_KEYS,
  PLAN_TEMPLATE_MUTATION_KEYS,
  PRAYER_MUTATION_KEYS,
  PREACH_DATE_MUTATION_KEYS,
  registerOfflineMutationDefaults,
  SHARE_LINK_MUTATION_KEYS,
  SETTINGS_MUTATION_KEYS,
  TAG_MUTATION_KEYS,
} from '@/utils/mutationDefaults';

// The old writers reached the server through `apiClient` (via `requestOwnerJson`). A replay that
// calls `apiClient` or `fetch` issues HTTP, whatever error the mutation ends with.
jest.mock('@/utils/apiClient', () => ({ ...jest.requireActual('@/utils/apiClient'), apiClient: jest.fn() }));

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

  it.each(['unset', 'false'] as const)('refuses all seven settings replays with the typed migration error when activation is %s', async activation => {
    const enabled = process.env.NEXT_PUBLIC_DATA_ENGINE_ENABLED;
    const collections = process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS;
    try {
      if (activation === 'unset') delete process.env.NEXT_PUBLIC_DATA_ENGINE_ENABLED;
      else process.env.NEXT_PUBLIC_DATA_ENGINE_ENABLED = 'false';
      delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS;
      const queryClient = new QueryClient();
      registerOfflineMutationDefaults(queryClient);
      const preference = { preferredProviderId: 'openai', preferredModelId: 'gpt-4o-mini' };
      const functionPreference = { preferredTts: { providerId: 'openai', modelId: 'gpt-4o-mini-tts' } };
      const variables: Record<keyof typeof SETTINGS_MUTATION_KEYS, unknown> = {
        prepMode: { userId: 'owner', value: true },
        audioGeneration: { userId: 'owner', value: true },
        structurePreview: { userId: 'owner', value: true },
        firstDayOfWeek: { userId: 'owner', value: 'monday' },
        showAppVersion: { userId: 'owner', value: true },
        modelPreference: { userId: 'owner', preference },
        functionModelPreference: { userId: 'owner', preference: functionPreference },
      };
      for (const [name, key] of Object.entries(SETTINGS_MUTATION_KEYS) as [keyof typeof SETTINGS_MUTATION_KEYS, readonly unknown[]][]) {
        const mutation = queryClient.getMutationCache().build(queryClient, { mutationKey: key });
        const payload = variables[name];
        await expect(mutation.execute(payload)).rejects.toMatchObject({ code: 'data-engine-required', status: 426 });
        expect(mutation.state.variables).toEqual(payload);
      }
      expect(apiClient).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      queryClient.clear();
    } finally {
      if (enabled === undefined) delete process.env.NEXT_PUBLIC_DATA_ENGINE_ENABLED;
      else process.env.NEXT_PUBLIC_DATA_ENGINE_ENABLED = enabled;
      if (collections === undefined) delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS;
      else process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = collections;
    }
  });

  it.each([
    [SHARE_LINK_MUTATION_KEYS.create, { userId: 'owner', noteId: 'note', custom: 'waiting words' }],
    [SHARE_LINK_MUTATION_KEYS.delete, { userId: 'owner', linkId: 'link', custom: 'waiting words' }],
  ] as const)('refuses a replayed share-link mutation without rewriting its saved variables', async (key, variables) => {
    jest.clearAllMocks();
    const queryClient = new QueryClient();
    registerOfflineMutationDefaults(queryClient);
    const mutation = queryClient.getMutationCache().build(queryClient, { mutationKey: key });

    await expect(mutation.execute(variables)).rejects.toMatchObject({ code: 'data-engine-required' });
    expect(mutation.state.variables).toEqual(variables);
    expect(apiClient).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
