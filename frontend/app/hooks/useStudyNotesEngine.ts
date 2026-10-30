import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDataCollection, useDocumentActions } from '@/data-engine/react.client';
import { useResolvedUid } from '@/hooks/useResolvedUid';
import { StaleWriteError } from '@/services/conflictSafeUpdate.client';
import { NOTE_AGGREGATE } from '@/services/studies.service';
import { resolveAppLocale, type AppLocale } from '@/utils/appLocale';
import { newClientId } from '@/utils/clientId';
import { getConnectivityStatus } from '@/utils/connectivity';
import { deepCleanUndefined } from '@/utils/deepCleanUndefined';
import { refusedWrite, skippedWrite, type WriteAcceptance, type WriteSubmission } from '@/utils/recoverableWrite';
import { withNoteReferenceBibles } from '@/utils/scriptureReferenceNumbering';
import { isStudyNoteDraft } from '@/utils/studyNoteDraft';

import type { DocumentData } from '@/data-engine/types';
import type { StudyNote } from '@/models/models';

const resource = (id: string) => ({ collection: 'studyNotes', id });
const now = () => new Date().toISOString();
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
/** The note text a person edits; relations (`materialIds`) move only through their material. */
const EDITABLE: (keyof StudyNote)[] = ['title', 'content', 'scriptureRefs', 'tags', 'type', 'analysis'];
/** The one draft rule, the server's too (`utils/studyNoteDraft.ts`): a comment is never a draft. */
const isDraft = (note: Pick<StudyNote, 'tags' | 'scriptureRefs' | 'type'>) => isStudyNoteDraft(note);
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
  // The engine delivers when the one answer about the connection says yes (`browser.client.ts`), so
  // the label follows that same answer: a phone flag "online" over café Wi-Fi would call a write
  // saved while the engine is holding it.
  const acceptance = persistence.then((): WriteAcceptance => (getConnectivityStatus() ? { kind: 'persisted' } : { kind: 'queued', receipt: key }));
  return { acceptance, persistence };
};

/**
 * A stored note as the screens read it. Its references each name their Bible: one stored before
 * references kept it is read in `locale`, the interface's language — in the app a note is read by its
 * author alone, so it is the language they write in (`withNoteReferenceBibles`).
 */
export function engineNote(value: DocumentData, id: string, locale: AppLocale): StudyNote {
  const stored = (value as unknown as StudyNote).scriptureRefs;
  const note = withNoteReferenceBibles(value as unknown as StudyNote, locale);
  const scriptureRefs = note.scriptureRefs || [];
  // Old references given their Bible here: the list remembers the stored list it was read from.
  if (stored !== undefined && scriptureRefs !== stored) readFrom.set(scriptureRefs, stored);
  return { ...note, id, scriptureRefs, tags: note.tags || [], materialIds: note.materialIds || [], isDraft: isDraft(note) };
}

/**
 * The stored list a list of references was read from, by the list itself, when old references in it
 * were given their Bible on reading — the editor keeps that very list in its baseline.
 */
const readFrom = new WeakMap<object, unknown>();

type SavedNote = StudyNote & { revision?: number };
type NoteUpdate = {
  id: string;
  updates: Partial<StudyNote>;
  expectedRevision?: number | null;
  expectedBaseline?: Record<string, unknown> | null;
};

/**
 * STUDY NOTES ON THE ENGINE — the interface the list, the note editor, the calendar and the
 * dashboard use (useStudyNotes).
 *
 * An edit states only the fields the person changed and is laid over the CURRENT note, so a tag
 * added on the phone survives a paragraph written on the laptop. The editor's baseline guard is
 * kept, and narrowed to what it protects: a field this save changes that was also changed
 * elsewhere since the editor's baseline refuses with the other value, and the editor offers
 * keep-mine / take-theirs. Offline a write is reported as queued, not saved (`accepted`).
 */
export function useStudyNotesEngine(enabled: boolean) {
  const { t, i18n } = useTranslation();
  const locale = resolveAppLocale(i18n?.language);
  const { uid, isAuthLoading } = useResolvedUid();
  const collection = useDataCollection(enabled && uid ? 'studyNotes' : null);
  const actions = useDocumentActions();
  const [updating, setUpdating] = useState(0);
  const inFlight = useRef(new Set<string>());

  const notes = useMemo(() => (collection.state?.documents ?? [])
    .flatMap(row => row.value ? [engineNote(row.value, row.resource.id, locale)] : [])
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()), [collection.state?.documents, locale]);

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
    /** The list is being asked of the server: a note made on another device may still be on its way into it — even into a
     *  list once read whole, whose newer changes are what is being asked (Codex, 30.10). */
    checking: Boolean(collection.state?.checking),
    error: collection.error ? new Error(collection.error) : null,
    refetch: async () => { await collection.refresh(); },
    createNote: (note: Omit<StudyNote, 'id' | 'createdAt' | 'updatedAt' | 'isDraft'>): WriteSubmission & { note: StudyNote } => {
      const id = newClientId();
      const at = now();
      const optimistic: StudyNote = { ...note, id, createdAt: at, updatedAt: at, isDraft: isDraft(note), materialIds: [], relatedSermonIds: note.relatedSermonIds || [] };
      const value = deepCleanUndefined({
        userId: note.userId, content: note.content ?? '', title: note.title || '', scriptureRefs: note.scriptureRefs || [],
        tags: note.tags || [], type: note.type || 'note', analysis: note.analysis, isDraft: isDraft(note), createdAt: at, updatedAt: at,
      }) as unknown as DocumentData;
      const request = actions.create(resource(id), value);
      void request.catch(() => undefined);
      return { ...accepted(`study-note:create:${id}`, request), note: optimistic };
    },
    updating: updating > 0,
    updateNote: ({ id, updates, expectedRevision, expectedBaseline }: NoteUpdate): WriteSubmission & { result: Promise<SavedNote> } => {
      if (!uid) {
        const refused = refusal();
        const result = refused.acceptance.then(() => undefined as never) as Promise<SavedNote>;
        void result.catch(() => undefined);
        return { ...refused, result };
      }
      const patch = Object.fromEntries(EDITABLE.filter(field => updates[field] !== undefined).map(field => [field, updates[field]]));
      let saved: SavedNote | undefined;
      const submission = once(`study-note:update:${id}:${JSON.stringify(patch)}`, async () => {
        setUpdating(count => count + 1);
        try {
          let stale: StaleWriteError | null = null;
          await actions.commit(resource(id), current => {
            stale = null;
            if (!current) throw new Error('Study note not found');
            const stored = (current.rev as Record<string, number> | undefined)?.[NOTE_AGGREGATE] ?? 0;
            // The baseline is the note as the editor read it. Its references are compared as stored —
            // the guard compares stored data, never a reading of it:
            // the stored list against the one the editor's list was read from — or, when the editor's list
            // is not a reading (as stored, or written by the editor itself), against that list. Reading
            // cannot be compared: it changes with the interface's language, a switch of which is not another
            // device's edit, and it hides changes — the old Psalm "9" and "10" both read as Synodal 9 — that
            // an older app on another device may still write without the Bible.
            const read = engineNote(current, id, locale) as unknown as Record<string, unknown>;
            const baselineRefs = expectedBaseline?.scriptureRefs;
            const readSource = baselineRefs !== null && typeof baselineRefs === 'object' ? readFrom.get(baselineRefs) : undefined;
            // A note stored without a type is a note — compared and reported as one, as every screen reads it: else an
            // editor that adopted the reported type would be refused again on the same revision (Codex review, 2026-10-28).
            const storedField = (field: string) => (field === 'type' ? read.type ?? 'note' : read[field]);
            // "Already what I write" is judged on the stored list too, never on a reading of it.
            const storedAs = (field: string, value: unknown) => (field === 'scriptureRefs'
              ? same(current.scriptureRefs ?? [], value)
              : same(storedField(field), value));
            const compared = expectedBaseline ? Object.keys(patch).filter(field => field in expectedBaseline) : [];
            const changedElsewhere = compared.filter(field => expectedBaseline
              && !storedAs(field, field === 'scriptureRefs' ? readSource ?? baselineRefs : expectedBaseline[field])
              && !storedAs(field, patch[field]));
            if (changedElsewhere.length) {
              // What the server held for EVERY compared field, as the error promises: a field left out could be one still
              // as opened or one already equal to what was sent, and an editor taking the server's version cannot tell
              // which (Codex review, 2026-10-28).
              stale = new StaleWriteError(NOTE_AGGREGATE, expectedRevision ?? stored, stored,
                Object.fromEntries(compared.map(field => [field, field === 'type' ? storedField(field) : current[field] ?? null])));
              return current;
            }
            const merged: DocumentData = { ...current, ...(deepCleanUndefined(patch) as DocumentData), updatedAt: now() };
            const next: DocumentData = { ...merged, isDraft: isDraft(merged as unknown as StudyNote) };
            // The engine moves the stored counter itself; this is the value it will reach.
            saved = { ...engineNote(next, id, locale), revision: stored + 1 };
            return next;
          });
          if (stale) throw stale;
        } finally {
          setUpdating(count => count - 1);
        }
      });
      if (!submission) return { ...skippedWrite(), result: Promise.resolve<SavedNote>(undefined as never) };
      const result = submission.persistence.then(() => saved as SavedNote);
      void result.catch(() => undefined);
      return { ...submission, result };
    },
    // The deletion carries what this device last saw; the server removes the note from its
    // materials in the same transaction (serverRelations.ts).
    deleteNote: (id: string): WriteSubmission => (!uid ? refusal() : once(`study-note:delete:${id}`, () => actions.remove(resource(id))) ?? skippedWrite()),
  };
}
