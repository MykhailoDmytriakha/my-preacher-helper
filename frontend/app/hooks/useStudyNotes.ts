import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useResolvedUid } from '@/hooks/useResolvedUid';
import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import { StudyNote } from '@/models/models';
import {
  createStudyNote,
  deleteStudyNote,
  getStudyNotes,
  updateStudyNote,
} from '@services/studies.service';

const notesKey = (uid: string | undefined) => ['study-notes', uid];

export function useStudyNotes() {
  const { uid, isAuthLoading } = useResolvedUid();
  const queryClient = useQueryClient();
  const notesQuery = useServerFirstQuery({
    queryKey: notesKey(uid),
    queryFn: () => (uid ? getStudyNotes(uid) : Promise.resolve([])),
    enabled: !!uid,
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
