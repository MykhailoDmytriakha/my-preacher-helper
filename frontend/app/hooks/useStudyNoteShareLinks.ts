import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { toast } from 'sonner';

import { useDataCollection } from '@/data-engine/react.client';
import { useResolvedUid } from '@/hooks/useResolvedUid';
import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import { StudyNoteShareLink } from '@/models/models';
import {
  mutationOutcomeWrite,
  refusedWrite,
  skippedWrite,
  useWriteRecovery,
  type WriteSubmission,
} from '@/utils/recoverableWrite';
import {
  createFailureToastId, revokeFailureToastId, revokeShareLinkMutationOptions,
  SHARE_LINK_MUTATION_KEYS, shareLinksKey, type RevokeShareLinkVariables,
} from '@/utils/studyNoteShareLinkWrites';
import { useTranslation } from '@locales/useTranslation';
import {
  createStudyNoteShareLink,
  getStudyNoteShareLinks,
} from '@services/studyNoteShareLinks.service';

/** One empty list for as long as the links are not loaded: a fresh [] per render breaks every memo built on it. */
const NO_SHARE_LINKS: StudyNoteShareLink[] = [];

type CreateShareLinkVars = { userId: string; noteId: string };

export function useStudyNoteShareLinks() {
  const { t } = useTranslation();
  const { uid, isAuthLoading } = useResolvedUid();
  const queryClient = useQueryClient();
  const { presence: notePresence } = useDataCollection(uid ? 'studyNotes' : null);
  const shareLinksQuery = useServerFirstQuery({
    queryKey: shareLinksKey(uid),
    queryFn: () => (uid ? getStudyNoteShareLinks(uid) : Promise.resolve([])),
    enabled: !!uid,
  });

  // The server retires links atomically with their note. A still-fresh or restored links cache
  // must follow that exact tombstone too; a missing/unloaded note or a queued delete proves less.
  const shareLinks = useMemo(() => shareLinksQuery.data?.filter(
    link => notePresence(link.noteId).snapshot?.metadata?.deleted !== true,
  ) ?? NO_SHARE_LINKS, [shareLinksQuery.data, notePresence]);

  // mutationKey + self-contained variables (userId in the payload) tie each write
  // to its resumable default in mutationDefaults.ts so it survives a reload and
  // replays on reconnect.
  const createLinkMutation = useMutation({
    mutationKey: SHARE_LINK_MUTATION_KEYS.create,
    mutationFn: ({ userId, noteId }: CreateShareLinkVars) =>
      createStudyNoteShareLink(userId, noteId),
    onSuccess: (created) => {
      // A failure message for this note is old news now, and its "Retry" would make a second request.
      toast.dismiss(createFailureToastId(created.noteId));
      queryClient.setQueryData<StudyNoteShareLink[]>(shareLinksKey(uid), (old = []) => {
        const filtered = (old ?? []).filter((link) => link.noteId !== created.noteId);
        return [created, ...filtered];
      });
    },
  });

  const deleteLinkMutation = useMutation(revokeShareLinkMutationOptions(queryClient));

  const hasPendingMutation = <TVars,>(
    mutationKey: readonly unknown[],
    matches: (variables: TVars) => boolean
  ) =>
    queryClient.getMutationCache().getAll().some(
      (mutation) =>
        JSON.stringify(mutation.options.mutationKey) === JSON.stringify(mutationKey) &&
        mutation.state.status === 'pending' &&
        matches(mutation.state.variables as TVars)
    );

  /**
   * A link that did not come into being, or did not go away, is said wherever the person next looks
   * at notes or their links, in its own words (BUG-20260928-share-link-failure-seen-only-on-studies).
   * The words say only what is known: the service turns every failure into a plain error, so a
   * refusal cannot be told from a dropped connection, and "could not confirm" is the true sentence.
   *
   * An unresolved revoke remains important after restart even without typed text. Its durable
   * mutation is retired only by the shared, exact owner/link acknowledgement handler; a cached
   * list, a remount or an unsuccessful retry never proves that access has ended.
   */
  useWriteRecovery<CreateShareLinkVars>(queryClient, {
    mutationKey: SHARE_LINK_MUTATION_KEYS.create,
    fallbackTitleKey: 'studiesWorkspace.shareLinks.createUnconfirmed',
    recoveryText: () => undefined,
    toastId: (vars) => createFailureToastId(vars.noteId),
    owns: (vars) => Boolean(uid) && vars.userId === uid,
    retry: (vars) => createLinkMutation.mutate(vars),
  });

  useWriteRecovery<RevokeShareLinkVariables>(queryClient, {
    mutationKey: SHARE_LINK_MUTATION_KEYS.delete,
    fallbackTitleKey: 'studiesWorkspace.shareLinks.revokeUnconfirmed',
    retainWithoutTextAcrossSessions: true,
    recoveryText: () => undefined,
    toastId: (vars) => revokeFailureToastId(vars.linkId),
    owns: (vars) => Boolean(uid) && vars.userId === uid,
    retry: (vars) => deleteLinkMutation.mutate(vars),
  });

  return {
    uid,
    shareLinks,
    loading: isAuthLoading || shareLinksQuery.isLoading,
    error: shareLinksQuery.error as Error | null,
    refetch: shareLinksQuery.refetch,
    createShareLink: (noteId: string): WriteSubmission => {
      if (!uid) return refusedWrite('unauthenticated', 'No signed-in user for this write', t('writeRecovery.refused'));
      const vars: CreateShareLinkVars = { userId: uid, noteId };
      if (hasPendingMutation<CreateShareLinkVars>(
        SHARE_LINK_MUTATION_KEYS.create,
        (pending) => pending.noteId === noteId && pending.userId === uid
      )) return skippedWrite();
      // Saved or queued is decided by what happened to the mutation, not by the icon (owner's rule 3).
      return mutationOutcomeWrite(queryClient.getMutationCache(), `outbox:study-note-share-link:create:${noteId}`,
        () => createLinkMutation.mutateAsync(vars));
    },
    deleteShareLink: (linkId: string): WriteSubmission => {
      if (!uid) return refusedWrite('unauthenticated', 'No signed-in user for this write', t('writeRecovery.refused'));
      const vars: RevokeShareLinkVariables = { userId: uid, linkId };
      if (hasPendingMutation<RevokeShareLinkVariables>(
        SHARE_LINK_MUTATION_KEYS.delete,
        (pending) => pending.linkId === linkId && pending.userId === uid
      )) return skippedWrite();
      return mutationOutcomeWrite(queryClient.getMutationCache(), `outbox:study-note-share-link:delete:${linkId}`,
        () => deleteLinkMutation.mutateAsync(vars));
    },
  };
}
