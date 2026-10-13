import { useStudyNotesEngine } from '@/hooks/useStudyNotesEngine';

/**
 * The study notes. They are read and written only through the data engine
 * (engineOwnedCollections.ts).
 */
export function useStudyNotes() {
  return useStudyNotesEngine(true);
}

export type StudyNotesApi = ReturnType<typeof useStudyNotesEngine>;
