import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useResolvedUid } from '@/hooks/useResolvedUid';
import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import { StudyNoteShareLink } from '@/models/models';
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

  const createLinkMutation = useMutation({
    mutationFn: (noteId: string) => {
      if (!uid) throw new Error('No user');
      return createStudyNoteShareLink(uid, noteId);
    },
    onSuccess: (created) => {
      queryClient.setQueryData<StudyNoteShareLink[]>(shareLinksKey(uid), (old = []) => {
        const filtered = (old ?? []).filter((link) => link.noteId !== created.noteId);
        return [created, ...filtered];
      });
    },
  });

  const deleteLinkMutation = useMutation({
    mutationFn: (linkId: string) => {
      if (!uid) throw new Error('No user');
      return deleteStudyNoteShareLink(uid, linkId);
    },
    onSuccess: (_data, linkId) => {
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
    createShareLink: createLinkMutation.mutateAsync,
    deleteShareLink: deleteLinkMutation.mutateAsync,
  };
}
