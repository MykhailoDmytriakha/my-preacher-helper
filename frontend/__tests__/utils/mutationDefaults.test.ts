import { QueryClient } from '@tanstack/react-query';

import {
  DASHBOARD_SERMON_MUTATION_KEYS,
  GROUP_MUTATION_KEYS,
  PLAN_TEMPLATE_MUTATION_KEYS,
  PRAYER_MUTATION_KEYS,
  PREACH_DATE_MUTATION_KEYS,
  registerOfflineMutationDefaults,
  SHARE_LINK_MUTATION_KEYS,
  TAG_MUTATION_KEYS,
} from '@/utils/mutationDefaults';
import * as shareLinksService from '@/services/studyNoteShareLinks.service';

jest.mock('@/services/studyNoteShareLinks.service', () => ({
  getStudyNoteShareLinks: jest.fn(),
  createStudyNoteShareLink: jest.fn(),
  deleteStudyNoteShareLink: jest.fn(),
}));

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
    expect(shareLinksService.createStudyNoteShareLink).not.toHaveBeenCalled();
    expect(shareLinksService.deleteStudyNoteShareLink).not.toHaveBeenCalled();
  });
});
