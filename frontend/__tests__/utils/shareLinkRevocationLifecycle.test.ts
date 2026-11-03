import { QueryClient, hydrate } from '@tanstack/react-query';

import { createStudyNoteShareLink, deleteStudyNoteShareLink } from '@/services/studyNoteShareLinks.service';
import { registerOfflineMutationDefaults, SHARE_LINK_MUTATION_KEYS } from '@/utils/mutationDefaults';

jest.mock('@/services/studyNoteShareLinks.service', () => ({
  createStudyNoteShareLink: jest.fn(),
  deleteStudyNoteShareLink: jest.fn(),
}));

/** Old mutation payloads are evidence for migration, never new capability commands. */
describe('retired share link mutation replay', () => {
  afterEach(() => { jest.clearAllMocks(); });

  it.each([
    [SHARE_LINK_MUTATION_KEYS.create, { userId: 'owner', noteId: 'note-to-share' }],
    [SHARE_LINK_MUTATION_KEYS.delete, { userId: 'owner', linkId: 'link-to-revoke' }],
  ])('refuses restored %j without issuing HTTP and preserves its exact variables', async (mutationKey, variables) => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    registerOfflineMutationDefaults(client);
    const raw = JSON.parse(JSON.stringify(variables));
    try {
      hydrate(client, { queries: [], mutations: [{ mutationKey, state: {
        context: undefined, data: undefined, error: null, failureCount: 0, failureReason: null,
        isPaused: true, status: 'pending', variables: raw, submittedAt: 123,
      } }] });
      await client.resumePausedMutations();
      const restored = client.getMutationCache().getAll()[0];
      expect(restored.state.status).toBe('error');
      expect(restored.state.error).toMatchObject({ code: 'data-engine-required' });
      expect(restored.state.variables).toEqual(variables);
      expect(restored.state.submittedAt).toBe(123);
      expect(createStudyNoteShareLink).not.toHaveBeenCalled();
      expect(deleteStudyNoteShareLink).not.toHaveBeenCalled();
    } finally { client.clear(); }
  });
});
