import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useResolvedUid } from '@/hooks/useResolvedUid';
import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import { StudyNote } from '@/models/models';
import { STUDY_NOTE_MUTATION_KEYS } from '@/utils/mutationDefaults';
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

  // mutationKey + self-contained variables (userId carried in the payload) tie
  // each write to its resumable default in mutationDefaults.ts so an edit made
  // offline survives a reload and replays on reconnect.
  const createNote = useMutation({
    mutationKey: STUDY_NOTE_MUTATION_KEYS.create,
    mutationFn: (note: Omit<StudyNote, 'id' | 'createdAt' | 'updatedAt' | 'isDraft'>) => createStudyNote(note),
    onSuccess: (created) => {
      queryClient.setQueryData<StudyNote[]>(notesKey(uid), (old = []) => [created, ...(old ?? [])]);
    },
  });

  const updateNoteMutation = useMutation({
    mutationKey: STUDY_NOTE_MUTATION_KEYS.update,
    mutationFn: ({ id, updates, userId }: { id: string; updates: Partial<StudyNote>; userId: string }) =>
      updateStudyNote(id, { ...updates, userId }),
    onSuccess: (updated) => {
      queryClient.setQueryData<StudyNote[]>(notesKey(uid), (old = []) =>
        (old ?? []).map((n) => (n.id === updated.id ? updated : n))
      );
    },
  });

  const deleteNoteMutation = useMutation({
    mutationKey: STUDY_NOTE_MUTATION_KEYS.delete,
    mutationFn: ({ id, userId }: { id: string; userId: string }) => deleteStudyNote(id, userId),
    onSuccess: (_data, { id }) => {
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
    updateNote: ({ id, updates }: { id: string; updates: Partial<StudyNote> }) => {
      if (!uid) return Promise.reject(new Error('No user'));
      return updateNoteMutation.mutateAsync({ id, updates, userId: uid });
    },
    deleteNote: (id: string) => {
      if (!uid) return Promise.reject(new Error('No user'));
      return deleteNoteMutation.mutateAsync({ id, userId: uid });
    },
  };
}
