import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { StudyNoteShareLink } from '@/models/models';
import { useAuth } from '@/providers/AuthProvider';
import {
  createStudyNoteShareLink,
  deleteStudyNoteShareLink,
  getStudyNoteShareLinks,
} from '@services/studyNoteShareLinks.service';

function useResolveUid(): { uid: string | undefined; isAuthLoading: boolean } {
  const { user, loading } = useAuth();

  if (loading) {
    return { uid: undefined, isAuthLoading: true };
  }

  if (user?.uid) {
    return { uid: user.uid, isAuthLoading: false };
  }

  if (typeof window === 'undefined') {
    return { uid: undefined, isAuthLoading: false };
  }

  try {
    const guestData = window.localStorage.getItem('guestUser');
    if (!guestData) {
      return { uid: undefined, isAuthLoading: false };
    }
    const parsed = JSON.parse(guestData) as { uid?: string };
    return { uid: parsed.uid, isAuthLoading: false };
  } catch (error) {
    console.error('useStudyNoteShareLinks: error parsing guestUser', error);
    return { uid: undefined, isAuthLoading: false };
  }
}

const shareLinksKey = (uid: string | undefined) => ['study-note-share-links', uid];

export function useStudyNoteShareLinks() {
  const { uid, isAuthLoading } = useResolveUid();
  const queryClient = useQueryClient();

  const shareLinksQuery = useQuery({
    queryKey: shareLinksKey(uid),
    queryFn: () => (uid ? getStudyNoteShareLinks(uid) : Promise.resolve([])),
    enabled: !isAuthLoading && !!uid,
    staleTime: 60_000,
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
