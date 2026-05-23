'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import type { StudyNote } from '@/models/models';

interface UseNoteAccessGuardParams {
  noteId: string;
  isNew: boolean;
  notesLoading: boolean;
  error?: unknown;
  existingNote: StudyNote | undefined;
  uid: string | undefined;
  redirectTo: string;
}

export function useNoteAccessGuard({
  noteId,
  isNew,
  notesLoading,
  error,
  existingNote,
  uid,
  redirectTo,
}: UseNoteAccessGuardParams): void {
  const router = useRouter();
  const { t } = useTranslation();

  useEffect(() => {
    if (notesLoading || !uid) return;

    if (!isNew && !existingNote) {
      if (error) return;

      const timeoutId = window.setTimeout(() => {
        toast.error(t('studiesWorkspace.noteNotFound', { defaultValue: 'Note not found' }));
        router.push(redirectTo);
      }, 500);

      return () => window.clearTimeout(timeoutId);
    }

    if (existingNote && existingNote.userId !== uid) {
      toast.error(t('studiesWorkspace.noAccess', { defaultValue: 'No access to this note' }));
      router.push(redirectTo);
    }
  }, [error, existingNote, isNew, noteId, notesLoading, redirectTo, router, t, uid]);
}
