import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useResolvedUid } from '@/hooks/useResolvedUid';
import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import { StudyNote } from '@/models/models';
import { newClientId } from '@/utils/clientId';
import { STUDY_NOTE_MUTATION_KEYS } from '@/utils/mutationDefaults';
import {
  createStudyNote,
  deleteStudyNote,
  getStudyNotes,
  updateStudyNote,
} from '@services/studies.service';

const notesKey = (uid: string | undefined) => ['study-notes', uid];

// Module-level constant so consumers that derive memos from `notes` get a
// stable reference when the query is still loading — otherwise `?? []`
// would allocate a fresh array each render and invalidate every downstream
// useMemo dep (e.g. wikilink resolver Map, autosave signature).
const EMPTY_NOTES: readonly StudyNote[] = Object.freeze([]) as readonly StudyNote[];

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
  // Create uses a client-generated id: the autosave gets the id back immediately
  // (no await on the network), so it can set the route/createdNoteId and switch
  // out of "new" mode — which prevents the offline autosave from firing repeated
  // creates (duplicates) while a paused create waits to replay. The server
  // upserts by that id, so a replayed create is idempotent.
  const createNoteMutation = useMutation({
    mutationKey: STUDY_NOTE_MUTATION_KEYS.create,
    mutationFn: (note: Omit<StudyNote, 'id' | 'createdAt' | 'updatedAt' | 'isDraft'> & { id: string }) =>
      createStudyNote(note),
    onMutate: async (note) => {
      await queryClient.cancelQueries({ queryKey: notesKey(uid) });
      const previous = queryClient.getQueryData<StudyNote[]>(notesKey(uid));
      queryClient.setQueryData<StudyNote[]>(notesKey(uid), (old = []) => [note as StudyNote, ...(old ?? [])]);
      return { previous };
    },
    onError: (_e, _note, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(notesKey(uid), ctx.previous);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['study-notes'] });
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
    notes: (notesQuery.data ?? EMPTY_NOTES) as StudyNote[],
    // Show loading when auth is loading OR query is loading
    loading: isAuthLoading || notesQuery.isLoading,
    error: notesQuery.error as Error | null,
    refetch: notesQuery.refetch,
    // Returns the client-generated id immediately (resolved) so the autosave can
    // set the route/createdNoteId without awaiting the network; the write buffers
    // and replays on reconnect.
    createNote: async (
      note: Omit<StudyNote, 'id' | 'createdAt' | 'updatedAt' | 'isDraft'>
    ): Promise<StudyNote> => {
      const id = newClientId();
      const now = new Date().toISOString();
      const optimistic: StudyNote = {
        ...note,
        id,
        createdAt: now,
        updatedAt: now,
        isDraft: false,
        materialIds: note.materialIds || [],
        relatedSermonIds: note.relatedSermonIds || [],
      };
      createNoteMutation.mutate({ ...note, id });
      return optimistic;
    },
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
