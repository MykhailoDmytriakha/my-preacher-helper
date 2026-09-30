import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useResolvedUid } from '@/hooks/useResolvedUid';
import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import { StudyNoteShareLink } from '@/models/models';
import { SHARE_LINK_MUTATION_KEYS } from '@/utils/mutationDefaults';
import {
  persistedWrite,
  queuedMutation,
  refusedWrite,
  skippedWrite,
  useWriteRecovery,
  type WriteSubmission,
} from '@/utils/recoverableWrite';
import {
  createStudyNoteShareLink,
  deleteStudyNoteShareLink,
  getStudyNoteShareLinks,
} from '@services/studyNoteShareLinks.service';

const shareLinksKey = (uid: string | undefined) => ['study-note-share-links', uid];
/** One empty list for as long as the links are not loaded: a fresh [] per render breaks every memo built on it. */
const NO_SHARE_LINKS: StudyNoteShareLink[] = [];
const createFailureToastId = (noteId: string) => `write-recovery:study-note-share-link:create:${noteId}`;
const revokeFailureToastId = (linkId: string) => `write-recovery:study-note-share-link:delete:${linkId}`;

type CreateShareLinkVars = { userId: string; noteId: string };
type DeleteShareLinkVars = { userId: string; linkId: string };

export function useStudyNoteShareLinks() {
  const { t } = useTranslation();
  const { uid, isAuthLoading } = useResolvedUid();
  const queryClient = useQueryClient();
  const isOnline = useOnlineStatus();
  const shareLinksQuery = useServerFirstQuery({
    queryKey: shareLinksKey(uid),
    queryFn: () => (uid ? getStudyNoteShareLinks(uid) : Promise.resolve([])),
    enabled: !!uid,
  });

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

  const deleteLinkMutation = useMutation({
    mutationKey: SHARE_LINK_MUTATION_KEYS.delete,
    mutationFn: ({ userId, linkId }: DeleteShareLinkVars) =>
      deleteStudyNoteShareLink(userId, linkId),
    onSuccess: (_data, { linkId }) => {
      const revoked = queryClient.getQueryData<StudyNoteShareLink[]>(shareLinksKey(uid))?.find((link) => link.id === linkId);
      toast.dismiss(revokeFailureToastId(linkId));
      // The person no longer wants a link for this note: an earlier "not created — retry" must not make one.
      if (revoked) toast.dismiss(createFailureToastId(revoked.noteId));
      queryClient.setQueryData<StudyNoteShareLink[]>(shareLinksKey(uid), (old = []) =>
        (old ?? []).filter((link) => link.id !== linkId)
      );
    },
  });

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
   * Across sessions this keeps the shared rule — a textless failure from an earlier session is
   * dropped. Keeping a failed revoke alive until it is settled needs evidence of the write's outcome
   * that a cached list cannot give; two review rounds showed each shortcut losing a real warning.
   */
  useWriteRecovery<CreateShareLinkVars>(queryClient, {
    mutationKey: SHARE_LINK_MUTATION_KEYS.create,
    fallbackTitleKey: 'studiesWorkspace.shareLinks.createUnconfirmed',
    recoveryText: () => undefined,
    toastId: (vars) => createFailureToastId(vars.noteId),
    owns: (vars) => Boolean(uid) && vars.userId === uid,
    retry: (vars) => createLinkMutation.mutate(vars),
  });

  useWriteRecovery<DeleteShareLinkVars>(queryClient, {
    mutationKey: SHARE_LINK_MUTATION_KEYS.delete,
    fallbackTitleKey: 'studiesWorkspace.shareLinks.revokeUnconfirmed',
    recoveryText: () => undefined,
    toastId: (vars) => revokeFailureToastId(vars.linkId),
    owns: (vars) => Boolean(uid) && vars.userId === uid,
    retry: (vars) => deleteLinkMutation.mutate(vars),
  });

  return {
    uid,
    shareLinks: shareLinksQuery.data ?? NO_SHARE_LINKS,
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
      const request = createLinkMutation.mutateAsync(vars);
      return isOnline
        ? persistedWrite(request)
        : queuedMutation(`outbox:study-note-share-link:create:${noteId}`, request);
    },
    deleteShareLink: (linkId: string): WriteSubmission => {
      if (!uid) return refusedWrite('unauthenticated', 'No signed-in user for this write', t('writeRecovery.refused'));
      const vars: DeleteShareLinkVars = { userId: uid, linkId };
      if (hasPendingMutation<DeleteShareLinkVars>(
        SHARE_LINK_MUTATION_KEYS.delete,
        (pending) => pending.linkId === linkId && pending.userId === uid
      )) return skippedWrite();
      const request = deleteLinkMutation.mutateAsync(vars);
      return isOnline
        ? persistedWrite(request)
        : queuedMutation(`outbox:study-note-share-link:delete:${linkId}`, request);
    },
  };
}
