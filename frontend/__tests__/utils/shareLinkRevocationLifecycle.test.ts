import { QueryClient, dehydrate, hydrate } from '@tanstack/react-query';

import { deleteStudyNoteShareLink } from '@/services/studyNoteShareLinks.service';
import { registerOfflineMutationDefaults, SHARE_LINK_MUTATION_KEYS } from '@/utils/mutationDefaults';

jest.mock('@/services/studyNoteShareLinks.service', () => ({
  createStudyNoteShareLink: jest.fn(),
  deleteStudyNoteShareLink: jest.fn(),
}));

const removeLink = jest.mocked(deleteStudyNoteShareLink);
const variables = { userId: 'owner', linkId: 'link-to-revoke' };
const makeClient = () => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  registerOfflineMutationDefaults(client);
  return client;
};

async function fail(client: QueryClient, vars = variables) {
  const mutation = client.getMutationCache().build(client, {
    mutationKey: SHARE_LINK_MUTATION_KEYS.delete,
    mutationFn: async () => { throw new Error('Temporary failure'); },
  });
  await mutation.execute(vars).catch(() => undefined);
  return mutation;
}

const isUnresolved = (client: QueryClient, linkId: string, owner = 'owner') =>
  client.getMutationCache().getAll().some(mutation => {
    const vars = mutation.state.variables as typeof variables | undefined;
    return mutation.state.status === 'error' && vars?.linkId === linkId && vars?.userId === owner;
  });

describe('share link revocation after leaving the screen', () => {
  afterEach(() => { jest.useRealTimers(); jest.clearAllMocks(); });

  it('keeps unresolved revocation in the persisted cache beyond ordinary garbage collection', async () => {
    jest.useFakeTimers();
    const client = makeClient();
    try {
      await fail(client);
      await jest.advanceTimersByTimeAsync(6 * 60 * 1000);
      expect(isUnresolved(client, variables.linkId)).toBe(true);
      expect(dehydrate(client, { shouldDehydrateMutation: mutation => mutation.state.status === 'error' }).mutations).toHaveLength(1);
    } finally { client.clear(); }
  });

  it('settles the matching restored failure after an acknowledged replay without a mounted screen', async () => {
    const previous = makeClient();
    await fail(previous);
    await fail(previous, { userId: 'owner', linkId: 'another-link' });
    await fail(previous, { userId: 'another-owner', linkId: variables.linkId });
    const saved = dehydrate(previous, { shouldDehydrateMutation: mutation => mutation.state.status === 'error' });
    previous.clear();
    const restored = makeClient();
    try {
      hydrate(restored, saved);
      removeLink.mockResolvedValue(undefined);
      const replay = restored.getMutationCache().build(restored, { mutationKey: SHARE_LINK_MUTATION_KEYS.delete });
      await replay.execute(variables);
      expect(removeLink).toHaveBeenCalledWith('owner', 'link-to-revoke');
      expect(isUnresolved(restored, variables.linkId)).toBe(false);
      expect(isUnresolved(restored, 'another-link')).toBe(true);
      expect(isUnresolved(restored, variables.linkId, 'another-owner')).toBe(true);
    } finally { restored.clear(); }
  });
});
