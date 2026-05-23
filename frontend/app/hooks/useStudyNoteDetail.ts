import { useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useResolvedUid } from '@/hooks/useResolvedUid';
import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import { getStudyNotes } from '@services/studies.service';

import type { StudyNote } from '@/models/models';

const studyNotesKey = (uid: string | undefined) => ['study-notes', uid] as const;
const studyNoteDetailKey = (noteId: string | null, uid: string | undefined) =>
  ['study-note-detail', noteId, uid] as const;

export function useStudyNoteDetail(
  noteId: string | null | undefined
): { note: StudyNote | null; loading: boolean } {
  const queryClient = useQueryClient();
  const { uid, isAuthLoading } = useResolvedUid();
  const resolvedNoteId = noteId || null;

  const cachedFromList = useMemo(() => {
    if (!uid || !resolvedNoteId) {
      return null;
    }

    const notes = queryClient.getQueryData<StudyNote[]>(studyNotesKey(uid)) ?? [];
    return notes.find((note) => note.id === resolvedNoteId) ?? null;
  }, [queryClient, resolvedNoteId, uid]);

  const { data, isLoading } = useServerFirstQuery<StudyNote | null>({
    queryKey: studyNoteDetailKey(resolvedNoteId, uid),
    enabled: Boolean(uid && resolvedNoteId && !cachedFromList),
    queryFn: async () => {
      if (!uid || !resolvedNoteId) {
        return null;
      }

      // studies.service has no single-note helper; use the canonical list fetch
      // only for this detail query. The list cache owns its own optimistic state.
      const notes = await getStudyNotes(uid);
      return notes.find((note) => note.id === resolvedNoteId) ?? null;
    },
    initialData: () => cachedFromList ?? undefined,
    initialDataUpdatedAt: () => {
      if (!uid) {
        return undefined;
      }

      return queryClient.getQueryState(studyNotesKey(uid))?.dataUpdatedAt;
    },
    placeholderData: cachedFromList ?? undefined,
  });

  return {
    note: cachedFromList ?? data ?? null,
    loading: Boolean(resolvedNoteId) && (isAuthLoading || (!cachedFromList && isLoading)),
  };
}
