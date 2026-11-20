import { useDataDocument, useDocumentActions } from '@/data-engine/react.client';
import { newClientId } from '@/utils/clientId';
import { deepCleanUndefined } from '@/utils/deepCleanUndefined';
import { moveNoteTo } from '@/utils/scratchOrder';
import {
  materializedNoteId, materializeOutlineNotes, OLD_REMINDER_CREATED_AT, outlineNoteTargetOf, scratchNoteAt, scratchPlaceOf, outlineOrEmpty, outlineWithPoint, outlineWithSubPoint, outlineWithoutPoint, outlineWithoutSubPoint,
  placeScratchNotes, type ScratchPlace,
} from '@/utils/scratchPlacement';
import { readOutlineNoteText, withOutlineNoteText, withOutlineTitleText, type OutlineNoteTarget } from '@/utils/sermonNoteText';
import { replaceSermonOutline } from '@/utils/sermonThoughtEdits';

import type { DocumentData, Json } from '@/data-engine/types';
import type { ScratchNote, Sermon, SermonOutline } from '@/models/models';
import type { SectionKey } from '@/utils/outlineDnd';

type ScratchPatch = { text?: string; section?: ScratchNote['section'] | null };

const notesOf = (document: DocumentData): ScratchNote[] => (document.scratch ?? []) as unknown as ScratchNote[];
const outlineOf = (document: DocumentData) => document.outline as unknown as SermonOutline | undefined;
/** The outline changes through the same rule as every other structure editor: thoughts follow their points. */
const withOutline = (document: DocumentData, outline: SermonOutline): DocumentData =>
  deepCleanUndefined(replaceSermonOutline(document as unknown as Sermon, outline)) as unknown as DocumentData;
const withNotes = (document: DocumentData, notes: ScratchNote[]): DocumentData => ({ ...document, scratch: notes as unknown as Json });
function existing(document: DocumentData | null): DocumentData {
  if (!document) throw new Error('The sermon is not available for scratch editing');
  return document;
}

/** Scratch domain operations; the shared editor owns persistence, merging and delivery. */
export function useScratchDataDocument(sermonId: string | null) {
  const document = useDataDocument(sermonId ? { collection: 'sermons', id: sermonId } : null, { slot: 'scratch' });
  const actions = useDocumentActions();
  // useDataDocument publishes failures. Void UI callbacks must not add an unhandled rejection.
  const write = (change: (sermon: DocumentData) => DocumentData) => {
    void document.update(current => change(existing(current))).catch(() => undefined);
  };
  const mutateNotes = (mutate: (notes: ScratchNote[]) => ScratchNote[]) => write(sermon => withNotes(sermon, mutate(notesOf(sermon))));
  /**
   * A deletion is committed at once, not after the editor's short autosave pause: its «Undo» restores
   * through a separate commit that reads what was submitted, and must find the deletion already there.
   */
  const commitNow = (change: (sermon: DocumentData) => DocumentData): Promise<void> =>
    Promise.resolve(document.commit(current => change(existing(current)))).then(() => undefined, () => undefined);
  /** One gesture, one write: a new point and the notes it was made from land together. */
  const createPointWithScratch = (section: SectionKey, title: string, noteIds: string[]): string | null => {
    const text = title.trim();
    if (!text) return null;
    const pointId = newClientId();
    write(sermon => withNotes(
      withOutline(sermon, outlineWithPoint(outlineOf(sermon), section, { id: pointId, text })),
      placeScratchNotes(notesOf(sermon), noteIds, { section, pointId, subPointId: null }),
    ));
    return pointId;
  };
  const addOutlinePoint = (section: SectionKey, title: string) => {
    const text = title.trim();
    if (text) write(sermon => withOutline(sermon, outlineWithPoint(outlineOf(sermon), section, { id: newClientId(), text })));
  };
  const addOutlineSubPoint = (pointId: string, title: string) => {
    const text = title.trim();
    if (text) write(sermon => withOutline(sermon, outlineWithSubPoint(outlineOf(sermon), pointId, { id: newClientId(), text })));
  };
  /** A point's or sub-point's title, through the same outline rule the structure screens use. */
  const renameOutlineTitle = (target: OutlineNoteTarget, title: string) => {
    const text = title.trim();
    if (!text) return;
    write(sermon => {
      const outline = withOutlineTitleText(outlineOrEmpty(outlineOf(sermon)), target, text);
      return outline ? withOutline(sermon, outline) : sermon;
    });
  };
  /** A sub-point goes; its notes, its old reminder and its thoughts stay on the point (the outline rule). */
  const removeOutlineSubPoint = (subPointId: string) => write(sermon => withOutline(sermon, outlineWithoutSubPoint(outlineOf(sermon), subPointId)));
  /** A point goes; its notes, its old reminder and its thoughts stay in the part it stands in now (the outline rule). */
  const removeOutlinePoint = (pointId: string) => write(sermon => withOutline(sermon, outlineWithoutPoint(outlineOf(sermon), pointId)));
  /** The node's old reminder set to `text` (cleared when undefined), through the same outline rule. */
  const withReminder = (sermon: DocumentData, target: OutlineNoteTarget, text: string | undefined): DocumentData => {
    const outline = withOutlineNoteText(outlineOrEmpty(outlineOf(sermon)), target, text);
    return outline ? withOutline(sermon, outline) : sermon;
  };
  /** Old reminders among `ids` become ordinary notes first (`materializedNoteId`), then the change runs on real notes. */
  const onRealNotes = (ids: readonly (string | undefined)[], change: (sermon: DocumentData, realId: (id: string) => string) => DocumentData) => {
    const reminders = ids.filter((id): id is string => Boolean(id && outlineNoteTargetOf(id)));
    write(sermon => {
      if (!reminders.length) return change(sermon, id => id);
      const made = materializeOutlineNotes(outlineOf(sermon), notesOf(sermon), reminders);
      return change(withNotes(withOutline(sermon, made.outline), made.notes), id => made.ids.get(id) ?? id);
    });
  };
  const restoreScratchNote = async (note: ScratchNote): Promise<ScratchNote | null> => {
    if (!note.text.trim()) return null;
    if (!sermonId) throw new Error('The sermon is not available for scratch editing');
    const reminder = outlineNoteTargetOf(note.id);
    if (reminder) {
      // Undo of a cleared reminder writes it back into its node. If the node got other words meanwhile, or is
      // gone, the deleted words come back as an ordinary note where the node is (or was) — never dropped.
      await actions.commit({ collection: 'sermons', id: sermonId }, current => {
        const sermon = existing(current);
        const outline = outlineOrEmpty(outlineOf(sermon));
        const now = readOutlineNoteText(outline, reminder)?.text;
        if (now === note.text) return sermon;
        const restored = !now?.trim() ? withOutlineNoteText(outline, reminder, note.text) : undefined;
        if (restored) return withOutline(sermon, restored);
        const id = materializedNoteId(reminder, note.text);
        const notes = notesOf(sermon);
        if (notes.some(item => item.id === id)) return sermon;
        const place = scratchPlaceOf({ ...note, id }, outline);
        return withNotes(sermon, [scratchNoteAt(place, { id, text: note.text, createdAt: OLD_REMINDER_CREATED_AT }), ...notes]);
      });
      return note;
    }
    let restored: ScratchNote | null = null;
    await actions.commit({ collection: 'sermons', id: sermonId }, current => {
      const sermon = existing(current);
      const notes = notesOf(sermon);
      const prior = notes.find(item => item.id === note.id);
      restored = prior ?? note;
      return prior ? sermon : { ...sermon, scratch: [note, ...notes] as unknown as Json };
    });
    return restored;
  };
  const addScratchNote = (text: string, section?: ScratchNote['section']): ScratchNote | null => {
    if (!text.trim()) return null;
    const note = { id: newClientId(), text: text.trim(), createdAt: new Date().toISOString(), ...(section ? { section } : {}) };
    mutateNotes(notes => [note, ...notes]);
    return note;
  };
  const addRecordedScratchNote = async (text: string, recordingId: string): Promise<ScratchNote | null> => {
    if (!text.trim() || !recordingId) return null;
    const candidate: ScratchNote = { id: `audio:${recordingId}`, text: text.trim(), createdAt: new Date().toISOString() };
    let accepted: ScratchNote | null = null;
    await document.update(current => {
      const sermon = existing(current);
      const notes = notesOf(sermon);
      const prior = notes.find(note => note.id === candidate.id);
      accepted = prior ?? candidate;
      return prior ? sermon : { ...sermon, scratch: [candidate, ...notes] as unknown as Json };
    });
    return accepted;
  };
  const updateScratchNote = (noteId: string, patch: ScratchPatch) => {
    const reminder = outlineNoteTargetOf(noteId);
    if (reminder) {
      if (typeof patch.text === 'string') write(sermon => withReminder(sermon, reminder, patch.text));
      return;
    }
    updateRealNote(noteId, patch);
  };
  const updateRealNote = (noteId: string, patch: ScratchPatch) => mutateNotes(notes => notes.map(note => {
    if (note.id !== noteId) return note;
    const next = { ...note };
    if (typeof patch.text === 'string') next.text = patch.text;
    if (Object.prototype.hasOwnProperty.call(patch, 'section')) {
      if (patch.section) next.section = patch.section;
      else delete next.section;
    }
    return next;
  }));
  const state = document.state;
  const isWritePending = Boolean(state && (!state.durable || state.checkpoint.dirty
    || Object.keys(state.checkpoint.pending).length > 0
    || (document.status && document.status.phase !== 'saved')));

  return {
    ...document,
    notes: document.data ? notesOf(document.data) : [],
    outline: document.data?.outline as unknown as SermonOutline | undefined,
    addScratchNote,
    addRecordedScratchNote,
    restoreScratchNote,
    updateScratchNote,
    captureScratchText: (note: ScratchNote) => document.captureSermonNoteText(
      outlineNoteTargetOf(note.id) ?? { kind: 'scratch', id: note.id, createdAt: note.createdAt }, note.text,
    ),
    /** Resolves once the deletion is submitted; «Undo» waits for it, so it never restores before the delete lands. */
    deleteScratchNote: (noteId: string): Promise<void> => {
      const reminder = outlineNoteTargetOf(noteId);
      return reminder
        ? commitNow(sermon => withReminder(sermon, reminder, undefined))
        : commitNow(sermon => withNotes(sermon, notesOf(sermon).filter(note => note.id !== noteId)));
    },
    moveScratchNote: (noteId: string, neighbourIds: string[], index: number) => mutateNotes(notes => moveNoteTo(notes, noteId, neighbourIds, index)),
    setScratchNoteSection: (noteId: string, section: ScratchNote['section'] | null) => updateScratchNote(noteId, { section }),
    // An old reminder moved — or dropped before — becomes an ordinary note, then moves like one.
    placeScratchNotes: (noteIds: string[], place: ScratchPlace, beforeId?: string) => onRealNotes([...noteIds, beforeId], (sermon, realId) =>
      withNotes(sermon, placeScratchNotes(notesOf(sermon), noteIds.map(realId), place, beforeId && realId(beforeId)))),
    createPointWithScratch,
    addOutlinePoint,
    addOutlineSubPoint,
    removeOutlinePoint,
    renameOutlineTitle,
    removeOutlineSubPoint,
    isWritePending,
    scratchRevision: state?.checkpoint.editGeneration ?? 0,
  };
}
