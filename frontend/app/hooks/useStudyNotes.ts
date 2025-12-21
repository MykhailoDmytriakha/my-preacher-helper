import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { StudyNote } from '@/models/models';
import { useAuth } from '@/providers/AuthProvider';
import {
  createStudyNote,
  deleteStudyNote,
  getStudyNotes,
  updateStudyNote,
} from '@services/studies.service';

/**
 * Resolve uid from auth context.
 * IMPORTANT: Only returns uid when auth state is settled (not loading).
 * This prevents using stale localStorage data before Firebase auth initializes.
 */
function useResolveUid(): { uid: string | undefined; isAuthLoading: boolean } {
  const { user, loading } = useAuth();
  
  // Wait for auth to settle before returning any uid
  // This prevents race conditions where stale localStorage data is used
  if (loading) {
    return { uid: undefined, isAuthLoading: true };
  }
  
  // Primary: use user from AuthProvider (reactive to auth state changes)
  if (user?.uid) {
    return { uid: user.uid, isAuthLoading: false };
  }
  
  // Fallback: check localStorage for guest user ONLY when auth is settled and no user
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
    console.error('useStudyNotes: error parsing guestUser', error);
    return { uid: undefined, isAuthLoading: false };
  }
}

const notesKey = (uid: string | undefined) => ['study-notes', uid];

export function useStudyNotes() {
  const { uid, isAuthLoading } = useResolveUid();
  const queryClient = useQueryClient();

  const notesQuery = useQuery({
    queryKey: notesKey(uid),
    queryFn: () => (uid ? getStudyNotes(uid) : Promise.resolve([])),
    // Only enable query when auth is settled AND we have a uid
    enabled: !isAuthLoading && !!uid,
    staleTime: 60_000,
  });

  const createNote = useMutation({
    mutationFn: (note: Omit<StudyNote, 'id' | 'createdAt' | 'updatedAt' | 'isDraft'>) => createStudyNote(note),
    onSuccess: (created) => {
      queryClient.setQueryData<StudyNote[]>(notesKey(uid), (old = []) => [created, ...(old ?? [])]);
    },
  });

  const updateNoteMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<StudyNote> }) => {
      if (!uid) throw new Error('No user');
      return updateStudyNote(id, { ...updates, userId: uid });
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<StudyNote[]>(notesKey(uid), (old = []) =>
        (old ?? []).map((n) => (n.id === updated.id ? updated : n))
      );
    },
  });

  const deleteNoteMutation = useMutation({
    mutationFn: (id: string) => {
      if (!uid) throw new Error('No user');
      return deleteStudyNote(id, uid);
    },
    onSuccess: (_data, id) => {
      queryClient.setQueryData<StudyNote[]>(notesKey(uid), (old = []) =>
        (old ?? []).filter((n) => n.id !== id)
      );
    },
  });

  return {
    uid,
    notes: notesQuery.data ?? [],
    // Show loading when auth is loading OR query is loading
    loading: isAuthLoading || notesQuery.isLoading,
    error: notesQuery.error as Error | null,
    refetch: notesQuery.refetch,
    createNote: createNote.mutateAsync,
    updating: updateNoteMutation.isPending,
    updateNote: updateNoteMutation.mutateAsync,
    deleteNote: deleteNoteMutation.mutateAsync,
  };
}
