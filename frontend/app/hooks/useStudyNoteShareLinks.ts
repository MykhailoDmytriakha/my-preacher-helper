import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useResolvedUid } from '@/hooks/useResolvedUid';
import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import { StudyNoteShareLink } from '@/models/models';
import { SHARE_LINK_MUTATION_KEYS } from '@/utils/mutationDefaults';
import {
  createStudyNoteShareLink,
  deleteStudyNoteShareLink,
  getStudyNoteShareLinks,
} from '@services/studyNoteShareLinks.service';

const shareLinksKey = (uid: string | undefined) => ['study-note-share-links', uid];

export function useStudyNoteShareLinks() {
  const { uid, isAuthLoading } = useResolvedUid();
  const queryClient = useQueryClient();
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
    mutationFn: ({ userId, noteId }: { userId: string; noteId: string }) =>
      createStudyNoteShareLink(userId, noteId),
    onSuccess: (created) => {
      queryClient.setQueryData<StudyNoteShareLink[]>(shareLinksKey(uid), (old = []) => {
        const filtered = (old ?? []).filter((link) => link.noteId !== created.noteId);
        return [created, ...filtered];
      });
    },
  });

  const deleteLinkMutation = useMutation({
    mutationKey: SHARE_LINK_MUTATION_KEYS.delete,
    mutationFn: ({ userId, linkId }: { userId: string; linkId: string }) =>
      deleteStudyNoteShareLink(userId, linkId),
    onSuccess: (_data, { linkId }) => {
      queryClient.setQueryData<StudyNoteShareLink[]>(shareLinksKey(uid), (old = []) =>
        (old ?? []).filter((link) => link.id !== linkId)
      );
    },
  });

  return {
    uid,
    shareLinks: shareLinksQuery.data ?? [],
    loading: isAuthLoading || shareLinksQuery.isLoading,
    error: shareLinksQuery.error as Error | null,
    refetch: shareLinksQuery.refetch,
    createShareLink: (noteId: string) => {
      if (!uid) return Promise.reject(new Error('No user'));
      return createLinkMutation.mutateAsync({ userId: uid, noteId });
    },
    deleteShareLink: (linkId: string) => {
      if (!uid) return Promise.reject(new Error('No user'));
      return deleteLinkMutation.mutateAsync({ userId: uid, linkId });
    },
  };
}
