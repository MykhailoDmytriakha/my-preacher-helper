import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDataCollection, useDocumentActions } from '@/data-engine/react.client';
import { useResolvedUid } from '@/hooks/useResolvedUid';
import { StaleWriteError } from '@/services/conflictSafeUpdate.client';
import { NOTE_AGGREGATE } from '@/services/studies.service';
import { newClientId } from '@/utils/clientId';
import { isBrowserOffline } from '@/utils/connectivity';
import { deepCleanUndefined } from '@/utils/deepCleanUndefined';
import { refusedWrite, skippedWrite, type WriteAcceptance, type WriteSubmission } from '@/utils/recoverableWrite';

import type { DocumentData } from '@/data-engine/types';
import type { StudyNotesApi } from '@/hooks/useStudyNotes';
import type { StudyNote } from '@/models/models';

const resource = (id: string) => ({ collection: 'studyNotes', id });
const now = () => new Date().toISOString();
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
/** The note text a person edits; relations (`materialIds`) move only through their material. */
const EDITABLE: (keyof StudyNote)[] = ['title', 'content', 'scriptureRefs', 'tags', 'type'];
const isDraft = (note: Pick<StudyNote, 'tags' | 'scriptureRefs'>) => (note.tags?.length ?? 0) === 0 || (note.scriptureRefs?.length ?? 0) === 0;
/**
 * What the editor may say about a write the engine holds on this device. Acceptance waits for
 * the engine's local commit — quick, and it works offline — because that is where a stale
 * baseline is refused; only then is the write named. Offline it is a receipt ("queued"), never
 * "Saved": the server has not seen it. Online the engine delivers at once, and a late answer is
 * offered by EngineConflictBanner.
 */
const accepted = (key: string, request: Promise<unknown>): WriteSubmission => {
  const persistence = request.then(() => undefined);
  void persistence.catch(() => undefined);
  const acceptance = persistence.then((): WriteAcceptance => (isBrowserOffline() ? { kind: 'queued', receipt: key } : { kind: 'persisted' }));
  return { acceptance, persistence };
};

export function engineNote(value: DocumentData, id: string): StudyNote {
  const note = value as unknown as StudyNote;
  return { ...note, id, scriptureRefs: note.scriptureRefs || [], tags: note.tags || [], materialIds: note.materialIds || [], isDraft: isDraft(note) };
}

/**
 * STUDY NOTES ON THE ENGINE — the same interface as the legacy hook (useStudyNotes), so the
 * list, the note editor, the calendar and the dashboard do not change.
 *
 * An edit states only the fields the person changed and is laid over the CURRENT note, so a tag
 * added on the phone survives a paragraph written on the laptop. The editor's baseline guard is
 * kept, and narrowed to what it protects: a field this save changes that was also changed
 * elsewhere since the editor's baseline refuses with the other value, and the editor offers
 * keep-mine / take-theirs. Offline a write is reported as queued, not saved (`accepted`).
 */
export function useStudyNotesEngine(enabled: boolean): StudyNotesApi {
  const { t } = useTranslation();
  const { uid, isAuthLoading } = useResolvedUid();
  const collection = useDataCollection(enabled && uid ? 'studyNotes' : null);
  const actions = useDocumentActions();
  const [updating, setUpdating] = useState(0);
  const inFlight = useRef(new Set<string>());

  const notes = useMemo(() => (collection.state?.documents ?? [])
    .flatMap(row => row.value ? [engineNote(row.value, row.resource.id)] : [])
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()), [collection.state?.documents]);

  const once = (key: string, run: () => Promise<unknown>): WriteSubmission | null => {
    if (inFlight.current.has(key)) return null;
    inFlight.current.add(key);
    const request = run().finally(() => inFlight.current.delete(key));
    void request.catch(() => undefined);
    return accepted(key, request);
  };

  const refusal = () => refusedWrite('unauthenticated', 'No signed-in user for this write', t('writeRecovery.refused'));

  return {
    uid,
    notes,
    loading: isAuthLoading || (Boolean(uid) && collection.loading),
    error: collection.error ? new Error(collection.error) : null,
    refetch: async () => { await collection.refresh(); },
    createNote: (note) => {
      const id = newClientId();
      const at = now();
      const optimistic: StudyNote = { ...note, id, createdAt: at, updatedAt: at, isDraft: isDraft(note), materialIds: [], relatedSermonIds: note.relatedSermonIds || [] };
      const value = deepCleanUndefined({
        userId: note.userId, content: note.content ?? '', title: note.title || '', scriptureRefs: note.scriptureRefs || [],
        tags: note.tags || [], type: note.type || 'note', isDraft: isDraft(note), createdAt: at, updatedAt: at,
      }) as unknown as DocumentData;
      const request = actions.create(resource(id), value);
      void request.catch(() => undefined);
      return { ...accepted(`study-note:create:${id}`, request), note: optimistic };
    },
    updating: updating > 0,
    updateNote: ({ id, updates, expectedRevision, expectedBaseline }) => {
      if (!uid) {
        const refused = refusal();
        const result = refused.acceptance.then(() => undefined as never) as Promise<StudyNote & { revision?: number }>;
        void result.catch(() => undefined);
        return { ...refused, result };
      }
      const patch = Object.fromEntries(EDITABLE.filter(field => updates[field] !== undefined).map(field => [field, updates[field]]));
      let saved: (StudyNote & { revision?: number }) | undefined;
      const submission = once(`study-note:update:${id}:${JSON.stringify(patch)}`, async () => {
        setUpdating(count => count + 1);
        try {
          let stale: StaleWriteError | null = null;
          await actions.commit(resource(id), current => {
            stale = null;
            if (!current) throw new Error('Study note not found');
            const stored = (current.rev as Record<string, number> | undefined)?.[NOTE_AGGREGATE] ?? 0;
            const changedElsewhere = expectedBaseline ? Object.keys(patch).filter(field =>
              field in expectedBaseline && !same(current[field], expectedBaseline[field]) && !same(current[field], patch[field])) : [];
            if (changedElsewhere.length) {
              stale = new StaleWriteError(NOTE_AGGREGATE, expectedRevision ?? stored, stored,
                Object.fromEntries(changedElsewhere.map(field => [field, current[field] ?? null])));
              return current;
            }
            const merged: DocumentData = { ...current, ...(deepCleanUndefined(patch) as DocumentData), updatedAt: now() };
            const next: DocumentData = { ...merged, isDraft: isDraft(merged as unknown as StudyNote) };
            // The engine moves the stored counter itself; this is the value it will reach.
            saved = { ...engineNote(next, id), revision: stored + 1 };
            return next;
          });
          if (stale) throw stale;
        } finally {
          setUpdating(count => count - 1);
        }
      });
      if (!submission) return { ...skippedWrite(), result: Promise.resolve<StudyNote & { revision?: number }>(undefined as never) };
      const result = submission.persistence.then(() => saved as StudyNote & { revision?: number });
      void result.catch(() => undefined);
      return { ...submission, result };
    },
    // The deletion carries what this device last saw; the server removes the note from its
    // materials in the same transaction (serverRelations.ts).
    deleteNote: (id) => (!uid ? refusal() : once(`study-note:delete:${id}`, () => actions.remove(resource(id))) ?? skippedWrite()),
  };
}
