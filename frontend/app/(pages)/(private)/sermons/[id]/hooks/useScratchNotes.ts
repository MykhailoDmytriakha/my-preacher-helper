import { useCallback, useMemo, useRef, useState } from 'react';

import {
  addScratchNote as persistAddedScratchNotes,
  deleteScratchNote as persistDeletedScratchNotes,
  updateScratchNote as persistUpdatedScratchNotes,
} from '@/services/scratch.service';
import { applyScratchToOutlineViaClient } from '@/services/sermons.client';
import { newClientId } from '@/utils/clientId';

import type { MutableRefObject } from 'react';
import type { ScratchNote, Sermon, SermonOutline } from '@/models/models';

type SetSermon = (
  updater: Sermon | null | ((previous: Sermon | null) => Sermon | null)
) => void | Promise<void>;

type ScratchSection = ScratchNote['section'];
type ScratchPatch = {
  text?: string;
  section?: ScratchSection | null;
};
type ScratchPersistAction = 'add' | 'update' | 'delete';
type QueuedScratchMutationNext = {
  scratch: ScratchNote[];
  outline?: SermonOutline;
};
type QueuedScratchMutation = {
  writesOutline?: boolean;
  buildNext: (currentSermon: Sermon) => QueuedScratchMutationNext;
  persist: (sermonId: string, next: QueuedScratchMutationNext) => Promise<unknown>;
  mergeScratchRollback?: (
    latestScratch: ScratchNote[],
    previousScratch: ScratchNote[]
  ) => ScratchNote[] | null;
  errorMessage: string;
};

interface UseScratchNotesParams {
  sermon: Sermon | null;
  sermonRef: MutableRefObject<Sermon | null>;
  setSermon: SetSermon;
  onOutlineWriteQueued?: () => void;
}

function shouldRollbackPersistFailure() {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

function getScratchSignature(scratch: ScratchNote[] | undefined) {
  return JSON.stringify(scratch ?? []);
}

function getOutlineSignature(outline: SermonOutline | undefined) {
  return JSON.stringify(outline ?? null);
}

function applyPatch(note: ScratchNote, patch: ScratchPatch): ScratchNote {
  const next: ScratchNote = { ...note };

  if (typeof patch.text === 'string') {
    next.text = patch.text;
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'section')) {
    if (patch.section) {
      next.section = patch.section;
    } else {
      delete next.section;
    }
  }

  return next;
}

export function useScratchNotes({
  sermon,
  sermonRef,
  setSermon,
  onOutlineWriteQueued,
}: UseScratchNotesParams) {
  const localMutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const scratchVersionRef = useRef(0);
  const [pendingWriteCount, setPendingWriteCount] = useState(0);

  const notes = useMemo(() => sermon?.scratch ?? [], [sermon?.scratch]);
  const isWritePending = pendingWriteCount > 0;

  const persistScratch = useCallback(
    (action: ScratchPersistAction, sermonId: string, scratch: ScratchNote[]) => {
      if (action === 'add') return persistAddedScratchNotes(sermonId, scratch);
      if (action === 'delete') return persistDeletedScratchNotes(sermonId, scratch);
      return persistUpdatedScratchNotes(sermonId, scratch);
    },
    []
  );

  const enqueueSermonScratchMutation = useCallback(
    ({ writesOutline, buildNext, persist, mergeScratchRollback, errorMessage }: QueuedScratchMutation) => {
      let didInvalidateOutlineWrite = false;
      let persistenceResult: Promise<unknown> = Promise.resolve();

      if (writesOutline) {
        onOutlineWriteQueued?.();
        didInvalidateOutlineWrite = true;
      }

      const localMutation = localMutationQueueRef.current
        .catch(() => undefined)
        .then(() => {
          const currentSermon = sermonRef.current ?? sermon;
          if (!currentSermon) return;

          const previousScratch = currentSermon.scratch ?? [];
          const previousOutline = currentSermon.outline;
          const next = buildNext(currentSermon);
          const nextScratch = next.scratch;
          const nextOutline = next.outline;
          if (nextOutline !== undefined && !didInvalidateOutlineWrite) {
            onOutlineWriteQueued?.();
            didInvalidateOutlineWrite = true;
          }

          const nextVersion = scratchVersionRef.current + 1;
          scratchVersionRef.current = nextVersion;
          const producedScratchSignature = getScratchSignature(nextScratch);
          const producedOutlineSignature =
            nextOutline !== undefined ? getOutlineSignature(nextOutline) : null;

          sermonRef.current = {
            ...currentSermon,
            ...(nextOutline !== undefined ? { outline: nextOutline } : {}),
            scratch: nextScratch,
          };
          void setSermon((previous) =>
            previous
              ? {
                  ...previous,
                  ...(nextOutline !== undefined ? { outline: nextOutline } : {}),
                  scratch: nextScratch,
                }
              : previous
          );

          const shouldTrackServerSettle = shouldRollbackPersistFailure();
          if (shouldTrackServerSettle) {
            setPendingWriteCount((count) => count + 1);
          }

          const handledPersistence = Promise.resolve()
            .then(() => persist(currentSermon.id, next))
            .catch((error) => {
              console.error(errorMessage, error);
              if (!shouldRollbackPersistFailure()) return;

              const latestSermon = sermonRef.current;
              if (!latestSermon) throw error;

              const shouldRollbackScratch =
                scratchVersionRef.current === nextVersion &&
                getScratchSignature(latestSermon.scratch) === producedScratchSignature;
              const scratchRollback = shouldRollbackScratch
                ? previousScratch
                : mergeScratchRollback?.(latestSermon.scratch ?? [], previousScratch) ?? null;
              const shouldRollbackOutline =
                producedOutlineSignature !== null &&
                getOutlineSignature(latestSermon.outline) === producedOutlineSignature;

              if (scratchRollback || shouldRollbackOutline) {
                sermonRef.current = sermonRef.current
                  ? {
                      ...sermonRef.current,
                      ...(shouldRollbackOutline ? { outline: previousOutline } : {}),
                      ...(scratchRollback ? { scratch: scratchRollback } : {}),
                    }
                  : sermonRef.current;
                void setSermon((previous) =>
                  previous
                    ? {
                        ...previous,
                        ...(shouldRollbackOutline ? { outline: previousOutline } : {}),
                        ...(scratchRollback ? { scratch: scratchRollback } : {}),
                      }
                    : previous
                );
              }
              throw error;
            })
            .finally(() => {
              if (shouldTrackServerSettle) {
                setPendingWriteCount((count) => Math.max(0, count - 1));
              }
            });

          void handledPersistence.catch(() => undefined);
          persistenceResult = shouldTrackServerSettle ? handledPersistence : Promise.resolve();
        });

      localMutationQueueRef.current = localMutation.then(() => undefined, () => undefined);
      const mutationResult = localMutation.then(() => persistenceResult).then(() => undefined);
      void mutationResult.catch(() => undefined);
      return mutationResult;
    },
    [onOutlineWriteQueued, sermon, sermonRef, setSermon]
  );

  const enqueueScratchMutation = useCallback(
    (
      action: ScratchPersistAction,
      mutate: (currentScratch: ScratchNote[]) => ScratchNote[]
    ) => {
      enqueueSermonScratchMutation({
        buildNext: (currentSermon) => ({
          scratch: mutate(currentSermon.scratch ?? []),
        }),
        persist: (sermonId, next) => persistScratch(action, sermonId, next.scratch),
        errorMessage: 'Failed to persist scratch notes',
      });
    },
    [enqueueSermonScratchMutation, persistScratch]
  );

  const addScratchNote = useCallback(
    (text: string, section?: ScratchSection) => {
      const trimmedText = text.trim();
      if (!trimmedText) return null;

      const note: ScratchNote = {
        id: newClientId(),
        text: trimmedText,
        createdAt: new Date().toISOString(),
      };
      if (section) note.section = section;

      enqueueScratchMutation('add', (currentScratch) => [
        note,
        ...currentScratch.filter((item) => item.id !== note.id),
      ]);

      return note;
    },
    [enqueueScratchMutation]
  );

  const restoreScratchNote = useCallback(
    (note: ScratchNote) => {
      const trimmedText = note.text.trim();
      if (!trimmedText) return null;

      const restoredNote: ScratchNote = {
        ...note,
        text: trimmedText,
      };

      enqueueScratchMutation('add', (currentScratch) => [
        restoredNote,
        ...currentScratch.filter((item) => item.id !== restoredNote.id),
      ]);

      return restoredNote;
    },
    [enqueueScratchMutation]
  );

  const updateScratchNote = useCallback(
    (noteId: string, patch: ScratchPatch) => {
      enqueueScratchMutation('update', (currentScratch) =>
        currentScratch.map((note) => (note.id === noteId ? applyPatch(note, patch) : note))
      );
    },
    [enqueueScratchMutation]
  );

  const deleteScratchNote = useCallback(
    (noteId: string) => {
      enqueueScratchMutation('delete', (currentScratch) =>
        currentScratch.filter((note) => note.id !== noteId)
      );
    },
    [enqueueScratchMutation]
  );

  const setScratchNoteSection = useCallback(
    (noteId: string, section: ScratchSection | null) => {
      updateScratchNote(noteId, { section });
    },
    [updateScratchNote]
  );

  const applyOutlineAndConsume = useCallback(
    (finalOutline: SermonOutline, consumedNoteIds: string[]) => {
      const consumedIds = new Set(consumedNoteIds);

      return enqueueSermonScratchMutation({
        writesOutline: true,
        buildNext: (currentSermon) => ({
          outline: finalOutline,
          scratch: (currentSermon.scratch ?? []).filter((note) => !consumedIds.has(note.id)),
        }),
        persist: (sermonId, next) =>
          applyScratchToOutlineViaClient(sermonId, next.outline ?? finalOutline, next.scratch),
        mergeScratchRollback: (latestScratch, previousScratch) => {
          const latestIds = new Set(latestScratch.map((note) => note.id));
          const restoredConsumedNotes = previousScratch.filter(
            (note) => consumedIds.has(note.id) && !latestIds.has(note.id)
          );
          return restoredConsumedNotes.length > 0
            ? [...latestScratch, ...restoredConsumedNotes]
            : null;
        },
        errorMessage: 'Failed to apply scratch notes to outline',
      });
    },
    [enqueueSermonScratchMutation]
  );

  return {
    notes,
    addScratchNote,
    restoreScratchNote,
    updateScratchNote,
    deleteScratchNote,
    setScratchNoteSection,
    applyOutlineAndConsume,
    isWritePending,
    scratchRevision: scratchVersionRef.current,
  };
}
