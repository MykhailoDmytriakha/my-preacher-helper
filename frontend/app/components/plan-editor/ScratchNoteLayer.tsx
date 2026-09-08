'use client';

import React from 'react';

import { NOTE_POOL_ID, noteSlotHeight, type NoteSlot } from '@/utils/boardDnd';

import { DraggableCard, DropZone } from './BoardDragPrimitives';
import { dragIdFor, type DragSubject } from './outlineBoardModel';

import type { ScratchLayerProps } from './outlineBoardTypes';
import type { ScratchNote } from '@/models/models';

export const SCRATCH_DROP_OVER_CLASS = 'ring-1 ring-indigo-300 bg-indigo-50/60 dark:bg-indigo-900/20';
const NOTE_SLOT_CLASS = 'rounded-lg border border-dashed border-indigo-400 bg-indigo-50/70 dark:border-indigo-500/70 dark:bg-indigo-900/30';
const NOTE_HOME_CLASS = 'rounded-lg border border-dotted border-slate-300 bg-slate-100/50 dark:border-gray-600 dark:bg-white/5';

type NoteListProps = {
  scratch: ScratchLayerProps;
  isReadOnly: boolean;
  containerId: string;
  notes: ScratchNote[];
  noteSlot: (NoteSlot & { own: boolean }) | null;
  liftedNoteId: string | null;
  activeNoteHeight: number;
  noteHomeOf: (id: string) => NoteSlot | null;
  testIdFor?: (note: ScratchNote) => string;
};

/** The pool and placed-note strips share the same physical slot and lifted-node rules. */
export function ScratchNoteList({ scratch, isReadOnly, containerId, notes, noteSlot, liftedNoteId, activeNoteHeight, noteHomeOf, testIdFor }: NoteListProps) {
  const renderScratchNote = (note: ScratchNote, testId?: string) => {
    return (
      <DraggableCard key={note.id} dragId={dragIdFor('note', note.id)} disabled={isReadOnly}>
        {({ setNodeRef, handleProps }) => (
          /*
           * THE LIFTED CARD LEAVES THE LIST. Its copy is in the air and its place is
           * the open slot; keeping it here too would make the list one card longer
           * for the whole gesture. It stays mounted (hidden) so the drag keeps its
           * node. It hides on THIS board's state, which `onDragStart` sets one
           * effect after dnd-kit has measured the card: hiding on the library's own
           * `isDragging` was one render too early — the overlay was then sized from
           * a card that was already `display: none`, a 0×0 rectangle at the page
           * corner, and the copy wrapped into a 26px column far from the finger.
           */
          <div
            ref={setNodeRef}
            data-testid={testId}
            data-scratch-note={note.id}
            className={note.id === liftedNoteId ? 'hidden' : undefined}
          >
            {scratch.renderNote(note, handleProps)}
          </div>
        )}
      </DraggableCard>
    );
  };

  /**
   * THE SLOT IS THE SIGNAL. Neighbours slide apart exactly where the note will
   * land; nothing else lights up, no words are printed. At home the slot is the
   * card's full height, so lifting moves nothing; in another container it is
   * compact, so a tall note does not shove every destination away while it travels.
   */
  const renderNoteSlot = (key: string, own: boolean, sameContainer: boolean) => (
    <div
      key={key}
      data-scratch-slot={own ? 'home' : 'target'}
      aria-hidden="true"
      className={own ? NOTE_HOME_CLASS : NOTE_SLOT_CLASS}
      style={{ height: noteSlotHeight(activeNoteHeight, own || sameContainer) }}
    />
  );

  /**
   * A container's notes with the slot woven in. While a note is in the air its own
   * card is hidden; its place shows as a muted home slot until the note is aimed
   * at another container, and as the live slot when it is aimed at its own place.
   */

  const slot = noteSlot && noteSlot.containerId === containerId ? noteSlot : null;
  const home = liftedNoteId ? noteHomeOf(liftedNoteId) : null;
  const homeHere = home && home.containerId === containerId ? home : null;
  const showHome = homeHere !== null && (!slot || slot.own || noteSlot === null);
  const sameContainer = home !== null && home.containerId === containerId;
  const visible = notes.filter((note) => note.id !== liftedNoteId);
  const items: React.ReactNode[] = [];
  visible.forEach((note, index) => {
    if (slot && !slot.own && slot.index === index) items.push(renderNoteSlot('slot', false, sameContainer));
    if (showHome && homeHere && homeHere.index === index) items.push(renderNoteSlot('home', true, true));
    items.push(renderScratchNote(note, testIdFor?.(note)));
  });
  if (slot && !slot.own && slot.index >= visible.length) items.push(renderNoteSlot('slot', false, sameContainer));
  if (showHome && homeHere && homeHere.index >= visible.length) items.push(renderNoteSlot('home', true, true));
  // The hidden original keeps the drag's node alive; it takes no room.
  const active = liftedNoteId ? notes.find((note) => note.id === liftedNoteId) : undefined;
  if (active) items.push(renderScratchNote(active, testIdFor?.(active)));
  return <>{items}</>;

}

export function ScratchNoteStrip({ testId, ...props }: NoteListProps & { testId: string }) {
  return <div data-testid={testId} data-scratch-strip={props.containerId}
    className="mt-1.5 flex min-h-[32px] flex-col gap-1.5 rounded-lg px-1 py-1">
    <ScratchNoteList {...props} testIdFor={note => `scratch-placed-note-${note.id}`} />
  </div>;
}

export function ScratchNotePool({ activeDrag, ...props }: Omit<NoteListProps, 'containerId'> & { activeDrag: DragSubject | null }) {
  const { scratch, isReadOnly, noteSlot, notes } = props;
  const isTarget = noteSlot !== null && !noteSlot.own && noteSlot.containerId === NOTE_POOL_ID;
  return <DropZone dropId={NOTE_POOL_ID} disabled={isReadOnly} activeKind={activeDrag?.kind ?? null}
    render={({ setNodeRef }) => <section ref={setNodeRef} data-testid="scratch-note-pool-band" data-note-container={NOTE_POOL_ID}
      className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm shadow-gray-900/5 dark:border-gray-700 dark:bg-gray-900 dark:shadow-black/20">
      {scratch.poolHeader && <div className="mb-3">{scratch.poolHeader}</div>}
      <div data-scratch-strip={NOTE_POOL_ID}
        className={`grid min-h-[88px] grid-cols-1 gap-3 rounded-lg transition-all duration-150 md:grid-cols-2 xl:grid-cols-3 ${isTarget ? SCRATCH_DROP_OVER_CLASS : ''}`}>
        {notes.length === 0 && !isTarget && <div className="col-span-full rounded-lg border border-dashed border-gray-300 px-3 py-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">{scratch.poolEmptyLabel}</div>}
        <ScratchNoteList {...props} containerId={NOTE_POOL_ID} />
      </div>
    </section>} />;
}
