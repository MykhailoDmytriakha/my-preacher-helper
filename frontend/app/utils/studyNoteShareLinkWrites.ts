import { toast } from 'sonner';

import { deleteStudyNoteShareLink } from '@/services/studyNoteShareLinks.service';

import type { StudyNoteShareLink } from '@/models/models';
import type { QueryClient } from '@tanstack/react-query';

export const STUDY_NOTE_SHARE_LINKS_KEY = 'study-note-share-links';
export const SHARE_LINK_MUTATION_KEYS = {
  create: [STUDY_NOTE_SHARE_LINKS_KEY, 'create'] as const,
  delete: [STUDY_NOTE_SHARE_LINKS_KEY, 'delete'] as const,
};

export const shareLinksKey = (owner: string | undefined) => [STUDY_NOTE_SHARE_LINKS_KEY, owner] as const;
export const createFailureToastId = (noteId: string) => `write-recovery:study-note-share-link:create:${noteId}`;
export const revokeFailureToastId = (linkId: string) => `write-recovery:study-note-share-link:delete:${linkId}`;
export type RevokeShareLinkVariables = { userId: string; linkId: string };

/** A live delete and a restored replay settle the same permanent capability, never a cached list. */
export function revokeShareLinkMutationOptions(queryClient: QueryClient) {
  return {
    mutationKey: SHARE_LINK_MUTATION_KEYS.delete,
    // An unresolved access revocation matters until acknowledged, even without authored text.
    gcTime: Infinity,
    mutationFn: ({ userId, linkId }: RevokeShareLinkVariables) => deleteStudyNoteShareLink(userId, linkId),
    onSuccess: (_data: void, { userId, linkId }: RevokeShareLinkVariables) => {
      const key = shareLinksKey(userId);
      const revoked = queryClient.getQueryData<StudyNoteShareLink[]>(key)?.find(link => link.id === linkId);
      const cache = queryClient.getMutationCache();
      for (const mutation of cache.getAll()) {
        if (JSON.stringify(mutation.options.mutationKey) !== JSON.stringify(SHARE_LINK_MUTATION_KEYS.delete)) continue;
        const variables = mutation.state.variables as RevokeShareLinkVariables | undefined;
        if (variables?.userId !== userId || mutation.state.isPaused) continue;
        // Keep every other unresolved target. Old successes need no durable recovery record.
        if (mutation.state.status === 'success' || (mutation.state.status === 'error' && variables.linkId === linkId)) {
          cache.remove(mutation);
        }
      }
      toast.dismiss(revokeFailureToastId(linkId));
      if (revoked) toast.dismiss(createFailureToastId(revoked.noteId));
      queryClient.setQueryData<StudyNoteShareLink[]>(key, old => old?.filter(link => link.id !== linkId));
      // A later visit should read afresh; an immediate refetch can replace this ACK with an older in-flight list.
      void queryClient.invalidateQueries({ queryKey: key, refetchType: 'none' });
    },
  };
}
