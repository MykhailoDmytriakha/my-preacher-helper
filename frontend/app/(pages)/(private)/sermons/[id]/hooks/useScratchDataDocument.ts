import { useDataDocument, useDocumentActions } from '@/data-engine/react.client';
import { newClientId } from '@/utils/clientId';
import { deepCleanUndefined } from '@/utils/deepCleanUndefined';
import { moveNoteTo } from '@/utils/scratchOrder';
import {
  outlineOrEmpty, outlineWithPoint, outlineWithSubPoint, outlineWithoutPoint, outlineWithoutSubPoint, placeScratchNotes,
  releaseScratchFromPoint, releaseScratchFromSubPoint, sectionOfPoint, type ScratchPlace,
} from '@/utils/scratchPlacement';
import { withOutlineTitleText, type OutlineNoteTarget } from '@/utils/sermonNoteText';
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
  /** A sub-point goes; its scratch notes and its thoughts stay on the point (the thoughts by the outline rule). */
  const removeOutlineSubPoint = (subPointId: string) => write(sermon => withNotes(
    withOutline(sermon, outlineWithoutSubPoint(outlineOf(sermon), subPointId)),
    releaseScratchFromSubPoint(notesOf(sermon), subPointId),
  ));
  /** A point goes; its scratch notes and its thoughts stay in its part, without a point. */
  const removeOutlinePoint = (pointId: string) => write(sermon => withNotes(
    withOutline(sermon, outlineWithoutPoint(outlineOf(sermon), pointId)),
    // The part is read from the outline being changed, not from the screen: the point may have moved since.
    releaseScratchFromPoint(notesOf(sermon), pointId, sectionOfPoint(outlineOf(sermon), pointId)),
  ));
  const restoreScratchNote = async (note: ScratchNote): Promise<ScratchNote | null> => {
    if (!note.text.trim()) return null;
    if (!sermonId) throw new Error('The sermon is not available for scratch editing');
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
  const updateScratchNote = (noteId: string, patch: ScratchPatch) => mutateNotes(notes => notes.map(note => {
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
      { kind: 'scratch', id: note.id, createdAt: note.createdAt }, note.text,
    ),
    deleteScratchNote: (noteId: string) => mutateNotes(notes => notes.filter(note => note.id !== noteId)),
    moveScratchNote: (noteId: string, neighbourIds: string[], index: number) => mutateNotes(notes => moveNoteTo(notes, noteId, neighbourIds, index)),
    setScratchNoteSection: (noteId: string, section: ScratchNote['section'] | null) => updateScratchNote(noteId, { section }),
    placeScratchNotes: (noteIds: string[], place: ScratchPlace, beforeId?: string) => mutateNotes(notes => placeScratchNotes(notes, noteIds, place, beforeId)),
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
