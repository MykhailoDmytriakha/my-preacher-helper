import { useDataDocument } from '@/data-engine/react.client';
import { newClientId } from '@/utils/clientId';
import { moveNoteTo } from '@/utils/scratchOrder';
import { replaceSermonOutline } from '@/utils/sermonThoughtEdits';

import type { DocumentData, Json } from '@/data-engine/types';
import type { ScratchNote, Sermon, SermonOutline } from '@/models/models';

type ScratchPatch = { text?: string; section?: ScratchNote['section'] | null };
export interface QueuedScratchDelivery { delivery: 'queued' }

const notesOf = (document: DocumentData): ScratchNote[] => (document.scratch ?? []) as unknown as ScratchNote[];
function existing(document: DocumentData | null): DocumentData {
  if (!document) throw new Error('The sermon is not available for scratch editing');
  return document;
}

/** Scratch domain operations; the shared editor owns persistence, merging and delivery. */
export function useScratchDataDocument(sermonId: string | null) {
  const document = useDataDocument(sermonId ? { collection: 'sermons', id: sermonId } : null, { slot: 'scratch' });
  const mutateNotes = (mutate: (notes: ScratchNote[]) => ScratchNote[]) => {
    // useDataDocument publishes failures. Void UI callbacks must not add an unhandled rejection.
    void document.update(current => {
      const sermon = existing(current);
      return { ...sermon, scratch: mutate(notesOf(sermon)) as unknown as Json };
    }).catch(() => undefined);
  };
  const restoreScratchNote = (note: ScratchNote): ScratchNote | null => {
    const text = note.text.trim();
    if (!text) return null;
    const restored = { ...note, text };
    mutateNotes(notes => [restored, ...notes.filter(item => item.id !== restored.id)]);
    return restored;
  };
  const addScratchNote = (text: string, section?: ScratchNote['section']): ScratchNote | null => {
    if (!text.trim()) return null;
    return restoreScratchNote({ id: newClientId(), text, createdAt: new Date().toISOString(), ...(section ? { section } : {}) });
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
  const applyOutlineAndConsume = async (outline: SermonOutline, consumedNoteIds: string[]): Promise<QueuedScratchDelivery> => {
    const consumed = new Set(consumedNoteIds);
    await document.commit(current => {
      const sermon = existing(current);
      return { ...replaceSermonOutline(sermon as unknown as Sermon, outline) as unknown as DocumentData,
        scratch: notesOf(sermon).filter(note => !consumed.has(note.id)) as unknown as Json };
    });
    return { delivery: 'queued' };
  };
  const state = document.state;
  const isWritePending = Boolean(state && (!state.durable || state.checkpoint.dirty
    || Object.keys(state.checkpoint.pending).length > 0
    || (document.status && document.status.phase !== 'saved')));

  return {
    ...document,
    notes: document.data ? notesOf(document.data) : [],
    outline: document.data?.outline as unknown as SermonOutline | undefined,
    addScratchNote,
    restoreScratchNote,
    updateScratchNote,
    deleteScratchNote: (noteId: string) => mutateNotes(notes => notes.filter(note => note.id !== noteId)),
    moveScratchNote: (noteId: string, neighbourIds: string[], index: number) => mutateNotes(notes => moveNoteTo(notes, noteId, neighbourIds, index)),
    setScratchNoteSection: (noteId: string, section: ScratchNote['section'] | null) => updateScratchNote(noteId, { section }),
    applyOutlineAndConsume,
    onOutlineChange: (outline: SermonOutline) => applyOutlineAndConsume(outline, []),
    isWritePending,
    scratchRevision: state?.checkpoint.editGeneration ?? 0,
  };
}
