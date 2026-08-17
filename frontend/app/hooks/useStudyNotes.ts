import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useResolvedUid } from '@/hooks/useResolvedUid';
import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import { StudyNote } from '@/models/models';
import { isStaleWriteError } from '@/services/conflictSafeUpdate.client';
import { newClientId } from '@/utils/clientId';
import { STUDY_NOTE_MUTATION_KEYS } from '@/utils/mutationDefaults';
import { studyNoteListKey } from '@/utils/queryKeys';
import {
  persistedWrite,
  queuedMutation,
  refusedWrite,
  skippedWrite,
  useWriteRecovery,
  type WriteSubmission,
} from '@/utils/recoverableWrite';
import { formatScriptureRefs, recoveryText } from '@/utils/writeRecovery';
import {
  createStudyNote,
  deleteStudyNote,
  getStudyNotes,
  updateStudyNote,
} from '@services/studies.service';

/** One spelling of this key, shared with the sermon side — see `studyNoteListKey`. */
const notesKey = studyNoteListKey;
const STUDY_NOTE_SAVE_ERROR_KEY = 'common.saveError';

type CreateStudyNoteVars = Omit<StudyNote, 'id' | 'createdAt' | 'updatedAt' | 'isDraft'> & {
  id: string;
};

type UpdateStudyNoteVars = {
  id: string;
  updates: Partial<StudyNote>;
  userId: string;
  expectedRevision?: number | null;
  expectedBaseline?: Record<string, unknown> | null;
  /** The complete editor payload, retained for a late-failure recovery toast. */
  recoveryDraft?: string;
};

type DeleteStudyNoteVars = { id: string; userId: string };

/** A create still has to hand its stable id to the editor without claiming it saved. */
export interface StudyNoteCreateSubmission extends WriteSubmission {
  note: StudyNote;
}

export interface StudyNoteUpdateSubmission extends WriteSubmission {
  result: Promise<StudyNote & { revision?: number }>;
}

export function useStudyNotes() {
  const { t } = useTranslation();
  const { uid, isAuthLoading } = useResolvedUid();
  const queryClient = useQueryClient();
  const isOnline = useOnlineStatus();
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
    mutationFn: (note: CreateStudyNoteVars) =>
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
    mutationFn: ({
      id,
      updates,
      userId,
      expectedRevision,
      expectedBaseline,
    }: UpdateStudyNoteVars) =>
      updateStudyNote(id, { ...updates, userId }, expectedRevision ?? null, expectedBaseline ?? null),
    onSuccess: (updated) => {
      queryClient.setQueryData<StudyNote[]>(notesKey(uid), (old = []) =>
        (old ?? []).map((n) => (n.id === updated.id ? updated : n))
      );
    },
  });

  const deleteNoteMutation = useMutation({
    mutationKey: STUDY_NOTE_MUTATION_KEYS.delete,
    mutationFn: ({ id, userId }: DeleteStudyNoteVars) => deleteStudyNote(id, userId),
    onSuccess: (_data, { id }) => {
      queryClient.setQueryData<StudyNote[]>(notesKey(uid), (old = []) =>
        (old ?? []).filter((n) => n.id !== id)
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

  // All terminal failures are owned here, where the mutation and the complete
  // human text meet. A component may have closed after `queued`; this keeps the
  // refusal recoverable instead of relying on that component still being mounted.
  useWriteRecovery<CreateStudyNoteVars>(queryClient, {
    mutationKey: STUDY_NOTE_MUTATION_KEYS.create,
    fallbackTitleKey: STUDY_NOTE_SAVE_ERROR_KEY,
    recoveryText: (note) =>
      recoveryText([
        note.title,
        note.content,
        note.tags.join(', '),
        // Picked reference by reference; losing them means picking them all again.
        formatScriptureRefs(note.scriptureRefs),
        note.type,
      ]),
    toastId: (note) => `write-recovery:study-note:create:${note.id}`,
    owns: (note) => Boolean(uid) && note.userId === uid,
    retry: (note) => createNoteMutation.mutate(note),
  });

  useWriteRecovery<UpdateStudyNoteVars>(queryClient, {
    mutationKey: STUDY_NOTE_MUTATION_KEYS.update,
    fallbackTitleKey: STUDY_NOTE_SAVE_ERROR_KEY,
    recoveryText: (vars) => vars.recoveryDraft ?? recoveryText([
      vars.updates.title,
      vars.updates.content,
      vars.updates.tags?.join(', '),
      formatScriptureRefs(vars.updates.scriptureRefs),
      vars.updates.type,
    ]),
    toastId: (vars) => `write-recovery:study-note:update:${vars.id}:${JSON.stringify(vars.updates)}`,
    owns: (vars) => Boolean(uid) && vars.userId === uid,
    /**
     * A stale revision is a CHOICE — the note editor holds the text and offers
     * "keep mine / take theirs". A recovery message on top of that turned one ordinary
     * multi-device conflict into two events with two different resolutions.
     */
    ignore: (error) => isStaleWriteError(error),
    retry: (vars) => updateNoteMutation.mutate(vars),
  });

  useWriteRecovery<DeleteStudyNoteVars>(queryClient, {
    mutationKey: STUDY_NOTE_MUTATION_KEYS.delete,
    fallbackTitleKey: STUDY_NOTE_SAVE_ERROR_KEY,
    recoveryText: () => undefined,
    toastId: (vars) => `write-recovery:study-note:delete:${vars.id}`,
    owns: (vars) => Boolean(uid) && vars.userId === uid,
    retry: (vars) => deleteNoteMutation.mutate(vars),
  });

  return {
    uid,
    notes: notesQuery.data ?? [],
    // Show loading when auth is loading OR query is loading
    loading: isAuthLoading || notesQuery.isLoading,
    error: notesQuery.error as Error | null,
    refetch: notesQuery.refetch,
    // The stable id is available immediately. Online, acceptance still waits for
    // the server (`persisted`); offline, the persisted React Query mutation owns
    // the create (`queued`) and must never be announced as saved.
    createNote: (
      note: Omit<StudyNote, 'id' | 'createdAt' | 'updatedAt' | 'isDraft'>
    ): StudyNoteCreateSubmission => {
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
      const vars: CreateStudyNoteVars = { ...note, id };
      const request = createNoteMutation.mutateAsync(vars);
      return {
        ...(isOnline
          ? persistedWrite(request)
          : queuedMutation(`study-note:create:${id}`, request)),
        note: optimistic,
      };
    },
    updating: updateNoteMutation.isPending,
    updateNote: ({
      id,
      updates,
      expectedRevision,
      expectedBaseline,
      recoveryDraft,
    }: {
      id: string;
      updates: Partial<StudyNote>;
      expectedRevision?: number | null;
      expectedBaseline?: Record<string, unknown> | null;
      recoveryDraft?: string;
    }): StudyNoteUpdateSubmission => {
      if (!uid) {
        // A refusal, not a failed write: nothing was attempted, so no mutation exists and
        // no descriptor below can ever speak for it. `refusedWrite` says the sentence once;
        // the editor keeps the note exactly as typed.
        const refusal = refusedWrite(
          'unauthenticated',
          'No signed-in user for this write',
          t('writeRecovery.refused')
        );
        const result = refusal.acceptance.then(
          () => undefined as never
        ) as Promise<StudyNote & { revision?: number }>;
        void result.catch(() => undefined);
        return { ...refusal, result };
      }
      const vars: UpdateStudyNoteVars = {
        id,
        updates,
        userId: uid,
        expectedRevision,
        expectedBaseline,
        recoveryDraft,
      };
      if (hasPendingMutation<UpdateStudyNoteVars>(
        STUDY_NOTE_MUTATION_KEYS.update,
        (pending) => pending.id === id && JSON.stringify(pending.updates) === JSON.stringify(updates)
      )) {
        const result = Promise.resolve<StudyNote & { revision?: number }>(undefined as never);
        return { ...skippedWrite(), result };
      }
      const request = updateNoteMutation.mutateAsync(vars);
      void request.catch(() => undefined);
      const submission = isOnline
        ? persistedWrite(request)
        : queuedMutation(`outbox:study-note:update:${id}`, request);
      return { ...submission, result: request };
    },
    deleteNote: (id: string): WriteSubmission => {
      if (!uid) return refusedWrite('unauthenticated', 'No signed-in user for this write', t('writeRecovery.refused'));
      const vars: DeleteStudyNoteVars = { id, userId: uid };
      if (hasPendingMutation<DeleteStudyNoteVars>(
        STUDY_NOTE_MUTATION_KEYS.delete,
        (pending) => pending.id === id
      )) return skippedWrite();
      return queuedMutation(`study-note:delete:${id}`, deleteNoteMutation.mutateAsync(vars));
    },
  };
}
