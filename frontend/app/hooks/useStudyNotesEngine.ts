import { useMemo, useRef, useState } from 'react';

import { isLiveCollectionDocument, readTagOpening, useDataCollection, useDocumentActions, type DocumentWriteReceipt } from '@/data-engine/react.client';
import { useResolvedUid } from '@/hooks/useResolvedUid';
import { StaleWriteError } from '@/services/conflictSafeUpdate.client';
import { NOTE_AGGREGATE } from '@/services/studies.service';
import { resolveAppLocale, type AppLocale } from '@/utils/appLocale';
import { newClientId } from '@/utils/clientId';
import { deepCleanUndefined } from '@/utils/deepCleanUndefined';
import { refusedWrite, skippedWrite, type WriteAcceptance, type WriteSubmission } from '@/utils/recoverableWrite';
import { withNoteReferenceBibles } from '@/utils/scriptureReferenceNumbering';
import { isStudyNoteDraft } from '@/utils/studyNoteDraft';
import { isOrdinaryStudyNote, isOrdinaryStudyNoteType } from '@/utils/studyNoteType';
import { useTranslation } from '@locales/useTranslation';


import type { OrdinaryStudyNoteType, StudyNoteTitleCapture, StudyNoteTitleSeen, StudyNoteTypeCapture, StudyNoteTypeSeen } from '@/data-engine/documentFieldAction';
import type { DocumentTagBasis, DocumentTagIntent } from '@/data-engine/documentTagCapture';
import type { DocumentData, ResourceSnapshot } from '@/data-engine/types';
import type { StudyNote } from '@/models/models';
import type { BookText } from '@/utils/bibleText';
import type { AnalysisReshapeEdit } from '@/utils/studyAnalysisReshape';

const resource = (id: string) => ({ collection: 'studyNotes', id });
const now = () => new Date().toISOString();
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
/** The note text a person edits; relations (`materialIds`) move only through their material. */
// 'paragraph' — a comment switched between a comment and a paragraph in the reader's window: without it here the switch,
// the whole of such a save, was dropped before the engine and nothing was written (case 2026-11-06-comment-paragraph).
const EDITABLE: (keyof StudyNote)[] = ['title', 'content', 'scriptureRefs', 'tags', 'type', 'dictationSourceIds', 'recordingSourceIds', 'analysis', 'paragraph'];
export type StudyNoteSubmission = WriteSubmission & {
  /** Exact canonical capture; absent on refused/skipped compatibility results. */
  capture?: Promise<DocumentWriteReceipt>;
};

/** Comments and analyses are never drafts; the shared domain rule also owns the server. */
const isDraft = (note: Pick<StudyNote, 'tags' | 'scriptureRefs' | 'type'>) => isStudyNoteDraft(note);
/** Local capture owns the submitted backup; server status and raw audio still require exact ACK. */
const accepted = (key: string, request: Promise<DocumentWriteReceipt>): StudyNoteSubmission & { snapshot: Promise<ResourceSnapshot> } => {
  const snapshot = request.then(receipt => receipt.persistence);
  const persistence = snapshot.then(() => undefined);
  const acceptance = request.then((receipt): WriteAcceptance => ({ kind: 'queued', receipt: receipt.requestId ?? key }));
  void snapshot.catch(() => undefined);
  void persistence.catch(() => undefined);
  void acceptance.catch(() => undefined);
  return { acceptance, persistence, snapshot, capture: request };
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

/** Recover the exact stored list behind a reading, including legacy references without a Bible. */
const storedReferences = (references: unknown) => references !== null && typeof references === 'object'
  ? readFrom.get(references) ?? references : references;

const creationValue = (note: Omit<StudyNote, 'id' | 'createdAt' | 'updatedAt' | 'isDraft'>, at: string): DocumentData => deepCleanUndefined({
  userId: note.userId, content: note.content ?? '', title: note.title || '', scriptureRefs: note.scriptureRefs || [],
  tags: note.tags || [], type: note.type || 'note', analysis: note.analysis, paragraph: note.paragraph, isDraft: isDraft(note), createdAt: at, updatedAt: at,
  ...(note.dictationSourceIds?.length ? { dictationSourceIds: [...new Set(note.dictationSourceIds)] } : {}),
  ...(note.recordingSourceIds?.length ? { recordingSourceIds: [...new Set(note.recordingSourceIds)] } : {}),
}) as unknown as DocumentData;

type SavedNote = StudyNote & { revision?: number };
type NoteUpdate = {
  id: string;
  updates: Partial<StudyNote>;
  captureScope?: string;
  expectedRevision?: number | null;
  expectedBaseline?: Record<string, unknown> | null;
  titleCapture?: StudyNoteTitleCapture;
  typeCapture?: StudyNoteTypeCapture;
  tagMembership?: readonly DocumentTagIntent[];
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
  const { t, language: interfaceLanguage } = useTranslation();
  const locale = resolveAppLocale(interfaceLanguage);
  const { uid, isAuthLoading } = useResolvedUid();
  const collection = useDataCollection(enabled && uid ? 'studyNotes' : null);
  const actions = useDocumentActions();
  const [updating, setUpdating] = useState(0);
  const inFlight = useRef(new Set<string>());

  const notes = useMemo(() => (collection.state?.documents ?? [])
    .filter(isLiveCollectionDocument)
    .map(row => engineNote(row.value, row.resource.id, locale))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()), [collection.state?.documents, locale]);

  // A displayed row can include queued words. Keep its canonical delivery evidence beside the domain value.
  const noteDelivery = useMemo<ReadonlyMap<string, { readonly pending: boolean; readonly needsAttention: boolean }>>(
    () => new Map((collection.state?.documents ?? []).flatMap(row => row.value ? [[row.resource.id,
      { pending: row.pending, needsAttention: row.needsAttention }] as const] : [])),
    [collection.state?.documents]);

  const once = (key: string, run: () => Promise<DocumentWriteReceipt>): (StudyNoteSubmission & { snapshot: Promise<ResourceSnapshot> }) | null => {
    if (inFlight.current.has(key)) return null;
    inFlight.current.add(key);
    const request = run().finally(() => inFlight.current.delete(key));
    void request.catch(() => undefined);
    return accepted(key, request);
  };

  const confirmedDictationSources = useMemo<ReadonlyMap<string, readonly string[]>>(
    () => new Map((collection.state?.snapshots ?? []).flatMap(snapshot => snapshot.value
      ? [[snapshot.resource.id, (snapshot.value.dictationSourceIds ?? []) as string[]] as const] : [])),
    [collection.state?.snapshots]);

  // A unique future resource can prove its creation even if its precreate backup is older.
  const confirmedCreationIds = useMemo<ReadonlySet<string>>(
    () => new Set((collection.state?.snapshots ?? []).filter(snapshot => Boolean(snapshot.metadata))
      .map(snapshot => snapshot.resource.id)), [collection.state?.snapshots]);

  const observeTitle = (id: string, title: string): StudyNoteTitleSeen | undefined => {
    const row = collection.state?.documents?.find(item => item.resource.id === id);
    if (row?.needsAttention) return undefined;
    if (row?.value?.title === title && row.submittedTitle?.title === title) return row.submittedTitle;
    const observed = [row?.acknowledged, collection.state?.snapshots?.find(item => item.resource.id === id)].find(snapshot =>
      snapshot?.value && (snapshot.value.title ?? '') === title && snapshot.value.title !== null
        && snapshot.metadata && !snapshot.metadata.deleted);
    const metadata = observed?.metadata;
    return metadata ? { title, generation: metadata.generation, revision: metadata.revision,
      ...(observed?.value?.title === undefined && { missing: true }) } : undefined;
  };

  const observeType = (id: string, type: OrdinaryStudyNoteType): StudyNoteTypeSeen | undefined => {
    const row = collection.state?.documents?.find(item => item.resource.id === id);
    if (row?.needsAttention) return undefined;
    if (row?.value?.type === type && row.submittedNoteType?.type === type) return row.submittedNoteType;
    const observed = [row?.acknowledged, collection.state?.snapshots?.find(item => item.resource.id === id)].find(snapshot =>
      snapshot?.value && (snapshot.value.type ?? 'note') === type && isOrdinaryStudyNote(snapshot.value)
        && snapshot.metadata && !snapshot.metadata.deleted);
    const metadata = observed?.metadata;
    return metadata ? { type, generation: metadata.generation, revision: metadata.revision,
      ...(observed?.value?.type === undefined && { missing: true }) } : undefined;
  };

  const observeTagBasis = (id: string, opening: string[]): DocumentTagBasis | undefined => {
    const basis = readTagOpening(collection.state, id, opening);
    return basis && { generation: basis.generation, revision: basis.revision };
  };

  const refusal = () => refusedWrite('unauthenticated', 'No signed-in user for this write', t('writeRecovery.refused'));

  return {
    uid,
    notes,
    noteDelivery,
    observeTitle,
    observeType,
    observeTagBasis,
    captureActionTime: actions.captureActionTime,
    notePresence: collection.presence,
    commentCollectionReady: collection.state?.complete === true && !collection.error && !collection.readOnly,
    confirmedDictationSources,
    confirmedCreationIds,
    loading: isAuthLoading || (Boolean(uid) && collection.loading),
    /** The list is being asked of the server: a note made on another device may still be on its way into it — even into a
     *  list once read whole, whose newer changes are what is being asked (Codex, 30.10). */
    checking: Boolean(collection.state?.checking),
    error: collection.error ? new Error(collection.error) : null,
    refetch: async () => { await collection.refresh(); },
    recoverAnalysisCreation: async (id: string): Promise<StudyNote | null> => {
      const captured = await actions.findStudyAnalysisCreation(id);
      return captured ? engineNote(captured.value, captured.resource.id, locale) : null;
    },
    releaseAnalysisCreation: (sourceId: string, adoptedId: string): Promise<void> => actions.releaseStudyAnalysisCreation(sourceId, adoptedId),
    combineAnalysisCreation: async (sourceId: string, targetId: string, text: BookText): Promise<string> =>
      (await actions.transferStudyAnalysisCreation(sourceId, targetId, text)).id,
    createNote: (note: Omit<StudyNote, 'id' | 'createdAt' | 'updatedAt' | 'isDraft'>, options?: { id?: string; captureScope?: string }): StudyNoteSubmission & { note: StudyNote } => {
      const id = options?.id ?? newClientId();
      const at = now();
      const optimistic: StudyNote = { ...note, id, createdAt: at, updatedAt: at, isDraft: isDraft(note), materialIds: [], relatedSermonIds: note.relatedSermonIds || [] };
      const value = creationValue(note, at);
      const request = actions.submit(resource(id), { kind: 'create', value }, options?.captureScope ? { captureScope: options.captureScope } : undefined);
      void request.catch(() => undefined);
      return { ...accepted(`study-note:create:${id}`, request), note: optimistic };
    },
    /** The shared engine captures the source and every recipient together. */
    reshapeNotes: async (edits: readonly AnalysisReshapeEdit[]): Promise<void> => {
      if (!uid) throw Object.assign(new Error('No signed-in user for this write'), { code: 'unauthenticated' });
      const at = now();
      await actions.reshapeStudyAnalysis(edits.map(edit => ({ resource: resource(edit.id),
        expected: edit.expected ? deepCleanUndefined({ ...edit.expected,
          scriptureRefs: storedReferences(edit.expected.scriptureRefs) }) as unknown as DocumentData : null,
        value: edit.expected ? deepCleanUndefined({ ...edit.expected, ...edit.fields }) as unknown as DocumentData
          : creationValue({ userId: uid, ...edit.fields, type: 'analysis', tags: [] }, at),
      })));
    },
    updating: updating > 0,
    updateNote: ({ id, updates, expectedRevision, expectedBaseline, captureScope, titleCapture, typeCapture, tagMembership }: NoteUpdate): StudyNoteSubmission & { result: Promise<SavedNote> } => {
      if (!uid) {
        const refused = refusal();
        const result = refused.acceptance.then(() => undefined as never) as Promise<SavedNote>;
        void result.catch(() => undefined);
        return { ...refused, result };
      }
      const patch = Object.fromEntries(EDITABLE.filter(field => updates[field] !== undefined).map(field => [field, updates[field]]));
      const openingTags = Array.isArray(expectedBaseline?.tags) ? expectedBaseline.tags : undefined;
      const requestedTags = updates.tags;
      const authoredTags = openingTags && requestedTags
        ? [...new Set([...openingTags, ...requestedTags])].filter(tag => openingTags.includes(tag) !== requestedTags.includes(tag)) : [];
      const timedTags = tagMembership?.length && openingTags && requestedTags
        && authoredTags.every(tag => tagMembership.some(intent => intent.tag === tag))
        && tagMembership.every(intent => intent.after === requestedTags.includes(intent.tag) && intent.before !== intent.after
          && (intent.before === openingTags.includes(intent.tag) || intent.predecessorRequestId))
        ? tagMembership : undefined;
      const title = titleCapture && expectedBaseline && (expectedBaseline.title === titleCapture.seen.title || titleCapture.seen.requestId)
        && typeof patch.title === 'string' ? titleCapture : undefined;
      const type = typeCapture && expectedBaseline && (expectedBaseline.type === typeCapture.seen.type || typeCapture.seen.requestId)
        && isOrdinaryStudyNoteType(patch.type) ? typeCapture : undefined;
      const action = title ? { kind: 'study-note-title' as const, title, type, tagMembership: timedTags }
        : type ? { kind: 'study-note-type' as const, type, tagMembership: timedTags }
          : timedTags ? { kind: 'document-tags' as const, tagMembership: timedTags } : undefined;
      const submission = once(`study-note:update:${id}:${JSON.stringify(patch)}`, async () => {
        setUpdating(count => count + 1);
        let staleTimedField: StaleWriteError | undefined;
        try {
          return await actions.submit(resource(id), { kind: 'update', update: current => {
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
            const readSource = storedReferences(baselineRefs);
            // A note stored without a type is a note — compared and reported as one, as every screen reads it: else an
            // editor that adopted the reported type would be refused again on the same revision (Codex review, 2026-10-28).
            const storedField = (field: string) => (field === 'type' ? read.type ?? 'note'
              : field === 'title' && title?.seen.missing && current.title === undefined ? '' : read[field]);
            // "Already what I write" is judged on the stored list too, never on a reading of it.
            const storedAs = (field: string, value: unknown) => (field === 'scriptureRefs'
              ? same(current.scriptureRefs ?? [], value)
              : same(storedField(field), value));
            const compared = expectedBaseline ? Object.keys(patch).filter(field => field !== 'dictationSourceIds' && field !== 'recordingSourceIds' && field in expectedBaseline) : [];
            const changedElsewhere = compared.filter(field => expectedBaseline && !(field === 'tags' && timedTags)
              && !storedAs(field, field === 'scriptureRefs' ? readSource ?? baselineRefs : expectedBaseline[field])
              && !storedAs(field, patch[field]));
            if (changedElsewhere.length) {
              // A refusal reports every compared field so the editor can adopt the complete server version.
              const stale = new StaleWriteError(NOTE_AGGREGATE, expectedRevision ?? stored, stored,
                Object.fromEntries(compared.map(field => [field, field === 'type' ? storedField(field) : current[field] ?? null])));
              const ordered = (field: string) => field === 'title' ? Boolean(title && (title.time || title.seen.requestId))
                : field === 'type' && isOrdinaryStudyNote(current) && Boolean(type && (type.time || type.seen.requestId));
              if (!changedElsewhere.every(ordered)) throw stale;
              staleTimedField = stale;
            }
            const receipts: DocumentData = {};
            for (const field of ['dictationSourceIds', 'recordingSourceIds'] as const) {
              if (updates[field]) receipts[field] = [...new Set([...((current[field] ?? []) as string[]), ...updates[field]])];
            }
            if (timedTags) {
              const tags = new Set(Array.isArray(current.tags) ? current.tags : []);
              for (const intent of timedTags) {
                if (intent.after) tags.add(intent.tag);
                else tags.delete(intent.tag);
              }
              receipts.tags = [...tags];
            }
            const merged: DocumentData = { ...current, ...(deepCleanUndefined(patch) as DocumentData), ...receipts, updatedAt: now() };
            const next: DocumentData = { ...merged, isDraft: isDraft(merged as unknown as StudyNote) };
            return next;
          } }, captureScope || action ? { ...(captureScope && { captureScope }), ...(action && { action }) } : undefined);
        } catch (error) {
          if (staleTimedField && error && typeof error === 'object' && 'code' in error
            && (error.code === 'study-note-title-basis-changed' || error.code === 'study-note-type-basis-changed')) throw staleTimedField;
          throw error;
        } finally {
          setUpdating(count => count - 1);
        }
      });
      if (!submission) return { ...skippedWrite(), result: Promise.resolve<SavedNote>(undefined as never) };
      const result = submission.snapshot.then(snapshot => {
        if (!snapshot.value) throw new Error('Accepted study note is missing');
        const revision = (snapshot.value.rev as Record<string, number> | undefined)?.[NOTE_AGGREGATE];
        return { ...engineNote(snapshot.value, id, locale), revision };
      });
      void result.catch(() => undefined);
      return { ...submission, result };
    },
    // The deletion carries what this device last saw; the server removes the note from its
    // materials in the same transaction (serverRelations.ts).
    deleteNote: (id: string): WriteSubmission => (!uid ? refusal() : once(`study-note:delete:${id}`, () => actions.submit(resource(id), { kind: 'delete' })) ?? skippedWrite()),
  };
}
