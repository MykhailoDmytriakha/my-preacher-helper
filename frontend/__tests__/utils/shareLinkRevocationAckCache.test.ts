import { QueryClient } from '@tanstack/react-query';

import { deleteStudyNoteShareLink } from '@/services/studyNoteShareLinks.service';
import { registerOfflineMutationDefaults, SHARE_LINK_MUTATION_KEYS } from '@/utils/mutationDefaults';

jest.mock('@/services/studyNoteShareLinks.service', () => ({ createStudyNoteShareLink: jest.fn(), deleteStudyNoteShareLink: jest.fn() }));

const createClient = () => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  registerOfflineMutationDefaults(client);
  jest.mocked(deleteStudyNoteShareLink).mockResolvedValue(undefined);
  return client;
};

async function acknowledge(client: QueryClient, linkId: string) {
  await client.getMutationCache().build(client, { mutationKey: SHARE_LINK_MUTATION_KEYS.delete })
    .execute({ userId: 'owner', linkId });
}

describe('acknowledged share link cache boundaries', () => {
  it('does not invent an empty loaded list when a replay finishes before the list opens', async () => {
    const client = createClient();
    try {
      await acknowledge(client, 'link-1');
      expect(client.getQueryData(['study-note-share-links', 'owner'])).toBeUndefined();
    } finally { client.clear(); }
  });

  it('does not accumulate successful revoke records while preserving another unresolved target', async () => {
    const client = createClient();
    try {
      const failed = client.getMutationCache().build(client, {
        mutationKey: SHARE_LINK_MUTATION_KEYS.delete,
        mutationFn: async () => { throw new Error('Unresolved neighbor'); },
      });
      await failed.execute({ userId: 'owner', linkId: 'unresolved-link' }).catch(() => undefined);
      for (let index = 0; index < 8; index += 1) await acknowledge(client, `link-${index}`);
      expect(client.getMutationCache().getAll()).toContain(failed);
      expect(client.getMutationCache().getAll().filter(mutation => mutation.state.status === 'success')).toHaveLength(1);
    } finally { client.clear(); }
  });
});
