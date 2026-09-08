'use client';

import { KeyboardSensor, MouseSensor, TouchSensor, pointerWithin, rectIntersection, useSensor, useSensors, type CollisionDetection, type DragEndEvent, type DragOverEvent, type DragStartEvent, type Modifier } from '@dnd-kit/core';
import { useCallback, useEffect, useRef, useState } from 'react';

import { allowedCollisions, NOTE_POOL_ID, notePointContainerId, noteSubContainerId, parseNoteContainerId, resolveNoteCollision, type NoteContainerMeasure, type NoteSlot } from '@/utils/boardDnd';
import { findSubPointParent } from '@/utils/outlineDnd';

import { parseDragId, type DragSubject } from './outlineBoardModel';

import type { ScratchLayerProps, ScratchPlacementTarget } from './outlineBoardTypes';
import type { ScratchNote, SermonOutline } from '@/models/models';

const rectOf = (el: Element) => {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
};

/** Transient drag state only. Owners still decide how a completed move is saved. */
export function useOutlineBoardDrag(outline: SermonOutline, scratch: ScratchLayerProps | undefined, notesInContainer: (id: string) => ScratchNote[]) {
  const [activeDrag, setActiveDrag] = useState<DragSubject | null>(null);
  const activeDragRef = useRef<DragSubject | null>(null);
  /** Which target the pointer is over right now — for feedback the zones cannot show themselves. */
  const [hoveredDropId, setHoveredDropId] = useState<string | null>(null);
  /**
   * The note layer's own state while a note is in the air: the open slot (which
   * container, which index, whether it is the note's own place) and the height of
   * the lifted card, which every slot is cut to. The ref mirrors the slot for the
   * collision function, which runs outside React's render.
   */
  type ActiveNoteSlot = NoteSlot & { own: boolean };
  const [noteSlot, setNoteSlot] = useState<ActiveNoteSlot | null>(null);
  const noteSlotRef = useRef<NoteSlot | null>(null);
  const [activeNoteHeight, setActiveNoteHeight] = useState(0);
  const activeNoteHeightRef = useRef(0);
  /*
   * The lifted card leaves its list one render AFTER lift-off, never in the same
   * one: dnd-kit measures the card for the flying copy in the activation render,
   * and a card hidden in that very render measures as a 0×0 rectangle at the page
   * corner — the copy then wrapped into a 26px column far from the finger.
   */
  const [liftedNoteId, setLiftedNoteId] = useState<string | null>(null);
  const overlayCardRef = useRef<HTMLDivElement | null>(null);
  /*
   * A drag starts only after the pointer has travelled a few pixels, so a tap on
   * the handle still counts as a click and the card can be renamed or deleted
   * without the board thinking a move began. Touch is its own sensor: a finger
   * must rest for a moment before the card lifts, otherwise a scroll would begin
   * every drag and the browser would cancel it — the same pair the structure page
   * settled on.
   */
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor)
  );

  const resetNoteDrag = () => {
    noteSlotRef.current = null;
    setNoteSlot(null);
    setLiftedNoteId(null);
    activeNoteHeightRef.current = 0;
    setActiveNoteHeight(0);
  };

  const onDragStart = (event: DragStartEvent) => {
    const subject = parseDragId(String(event.active.id));
    activeDragRef.current = subject;
    setActiveDrag(subject);
    setHoveredDropId(null);
    noteSlotRef.current = null;
    setNoteSlot(null);
    lastNoteKeyRef.current = null;
    lastNoteCollisionsRef.current = null;
    if (subject?.kind === 'note' && typeof document !== 'undefined') {
      // The inner card, not its wrapper: in the pool grid the wrapper is stretched
      // to the tallest card of its row, and every slot would be cut to that.
      const wrapper = document.querySelector<HTMLElement>(`[data-scratch-note="${subject.id}"]`);
      const card = (wrapper?.firstElementChild as HTMLElement | null) ?? wrapper;
      const height = card ? card.getBoundingClientRect().height : 0;
      activeNoteHeightRef.current = height;
      setActiveNoteHeight(height);
    }
  };

  /*
   * dnd-kit reports `onDragOver` only when the container changes; the slot's index
   * moves inside one container on every pointer move, so both `onDragMove` and
   * `onDragOver` feed the same reader. State changes only when the slot does —
   * a fresh object per move would re-render the board sixty times a second.
   */
  const readNoteSlot = (collisions: DragOverEvent['collisions']) => {
    if (activeDragRef.current?.kind !== 'note') return;
    const data = collisions?.[0]?.data as NoteSlot | undefined;
    const slot = data && typeof data.containerId === 'string' ? { containerId: data.containerId, index: data.index } : null;
    noteSlotRef.current = slot;
    if (!slot) {
      setNoteSlot((current) => (current === null ? current : null));
      return;
    }
    const home = noteHomeOf(activeDragRef.current.id);
    const own = home !== null && home.containerId === slot.containerId && home.index === slot.index;
    setNoteSlot((current) =>
      current && current.containerId === slot.containerId && current.index === slot.index && current.own === own
        ? current
        : { ...slot, own }
    );
  };

  const onDragOver = (event: DragOverEvent) => {
    setHoveredDropId(event.over ? String(event.over.id) : null);
    readNoteSlot(event.collisions);
  };

  const onDragMove = (event: DragOverEvent) => {
    readNoteSlot(event.collisions);
  };

  /** The placement a note container stands for; `undefined` when the container cannot be resolved. */
  const placementForContainer = (containerId: string): ScratchPlacementTarget | null | undefined => {
    const parsed = parseNoteContainerId(containerId);
    if (!parsed) return undefined;
    if (parsed.kind === 'pool') return null;
    if (parsed.kind === 'point') return { pointId: parsed.pointId };
    const parentPointId = findSubPointParent(outline, parsed.subPointId)?.point.id;
    return parentPointId ? { pointId: parentPointId, subPointId: parsed.subPointId } : undefined;
  };

  /** Which container a note is in right now, and where among its notes. */
  const noteHomeOf = (noteId: string): NoteSlot | null => {
    if (!scratch) return null;
    const placement = scratch.placements[noteId];
    const containerId = !placement
      ? NOTE_POOL_ID
      : placement.subPointId
        ? noteSubContainerId(placement.subPointId)
        : notePointContainerId(placement.pointId);
    const index = notesInContainer(containerId).findIndex((note) => note.id === noteId);
    return index < 0 ? null : { containerId, index };
  };

  /**
   * ONE DROP, ONE OPERATION. The slot was resolved while the note was in the air
   * (the collision function keeps it in a ref); here it only has to be handed on.
   * Nothing changes when the note is let go where it already lives.
   */
  const handleNoteDrop = (subject: DragSubject, event: DragEndEvent) => {
    if (!scratch) return;
    /*
     * The slot normally arrives through `onDragOver`. A drop that never reported a
     * hover (a synthetic one, or a sensor that skipped it) still names a container
     * in `over`: the note then goes to the end of that container.
     */
    const overId = event.over ? String(event.over.id) : null;
    const eventSlot = event.collisions?.[0]?.data as NoteSlot | undefined;
    const slot: NoteSlot | null =
      noteSlotRef.current ??
      (eventSlot && typeof eventSlot.containerId === 'string' ? { containerId: eventSlot.containerId, index: eventSlot.index } : null) ??
      (overId && parseNoteContainerId(overId)
        ? { containerId: overId, index: notesInContainer(overId).filter((note) => note.id !== subject.id).length }
        : null);
    if (!slot) return;
    const home = noteHomeOf(subject.id);
    if (home && home.containerId === slot.containerId && home.index === slot.index) return;
    const target = placementForContainer(slot.containerId);
    if (target === undefined) return;
    const neighbourIds = notesInContainer(slot.containerId)
      .map((note) => note.id)
      .filter((id) => id !== subject.id);
    if (scratch.onMove) {
      scratch.onMove(subject.id, target, neighbourIds, slot.index);
    } else {
      scratch.onPlace(subject.id, target);
    }
  };

  /**
   * What the collision function needs to know about a container: its note cards
   * as displayed (without the one in the air) and the open slot, if any. Read from
   * the DOM on every move — a handful of rectangles, and always the truth.
   */
  const measureNoteContainer = (containerId: string, activeId: string | null): NoteContainerMeasure | null => {
    if (typeof document === 'undefined') return null;
    const strip = document.querySelector<HTMLElement>(`[data-scratch-strip="${containerId}"]`);
    if (!strip) return null;
    const cards: NoteContainerMeasure['cards'] = [];
    let slot: NoteContainerMeasure['slot'] = null;
    let slotIndex: number | null = null;
    let home: { rect: NoteContainerMeasure['slot']; index: number } | null = null;
    for (const child of Array.from(strip.children) as HTMLElement[]) {
      if (child.dataset.scratchSlot !== undefined) {
        slot = rectOf(child);
        slotIndex = cards.length;
      } else if (child.dataset.scratchNote !== undefined) {
        if (child.dataset.scratchNote === activeId) {
          // Still on screen for the first collision of the drag; hidden after that.
          if (!child.classList.contains('hidden')) home = { rect: rectOf(child), index: cards.length };
        } else {
          cards.push(rectOf(child));
        }
      }
    }
    if (!slot && home) {
      slot = home.rect;
      slotIndex = home.index;
    }
    return { cards, slot, slotIndex, isGrid: containerId === NOTE_POOL_ID };
  };

  /*
   * Two vocabularies, one router. A point or a sub-point keeps `pointerWithin`
   * ordered by precision (a seam sits inside a card sits inside a column). A note
   * gets the deepest CONTAINER under the pointer and the slot inside it. Without
   * pointer coordinates (keyboard) the dragged rectangle stands in for the pointer.
   *
   * THE CONTAINER IS READ FROM THE LIVE DOM, NOT FROM MEASURED RECTANGLES. Opening
   * a slot makes its container taller; dnd-kit's rectangle for that container is
   * from before, so the pointer near the bottom "leaves" a container it is still
   * inside — the slot closes, the container shrinks, the pointer is back inside,
   * the slot opens again. Measured live: that loop froze the page. What the
   * pointer is over right now is the only reading that cannot go stale.
   */
  const noteContainersUnderPointer = (point: { x: number; y: number }): { id: string }[] => {
    if (typeof document === 'undefined' || typeof document.elementsFromPoint !== 'function') return [];
    const seen = new Set<string>();
    const hits: { id: string }[] = [];
    for (const el of document.elementsFromPoint(point.x, point.y)) {
      const container = (el as HTMLElement).closest?.('[data-note-container]') as HTMLElement | null;
      const id = container?.dataset.noteContainer;
      if (id && !seen.has(id)) {
        seen.add(id);
        hits.push({ id });
      }
    }
    return hits;
  };

  /*
   * A NOTE'S TARGET CHANGES ONLY WHEN THE POINTER MOVES — OR THE PAGE DOES.
   * dnd-kit recomputes collisions on every re-measure as well, and a slot that
   * opens above a sub-point shifts that row under a still pointer: parent → child
   * → the slot closes → the row shifts back → parent → … — an effect-driven loop
   * that froze the page. Between two pointer events the answer is the previous
   * answer. The key also carries the window scroll: during auto-scroll the pointer
   * rests while the board slides under it, and that IS a move. For a keyboard
   * drag the centre of the flying copy stands in for the pointer, so the same
   * rule holds there.
   */
  const lastNoteKeyRef = useRef<string | null>(null);
  const lastNoteCollisionsRef = useRef<ReturnType<CollisionDetection> | null>(null);
  const collisionDetection = useCallback<CollisionDetection>((args) => {
    const subject = parseDragId(String(args.active.id));
    const kind = subject?.kind ?? null;
    if (kind !== 'note') {
      const hits = args.pointerCoordinates ? pointerWithin(args) : rectIntersection(args);
      return allowedCollisions(kind, hits);
    }
    const rect = args.collisionRect;
    const fallbackPoint = rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
    const point = args.pointerCoordinates ?? fallbackPoint;
    const scroll = typeof window === 'undefined' ? '' : `${Math.round(window.scrollX)},${Math.round(window.scrollY)}`;
    const key = point ? `${Math.round(point.x)},${Math.round(point.y)}|${scroll}` : null;
    if (key && key === lastNoteKeyRef.current && lastNoteCollisionsRef.current) {
      return lastNoteCollisionsRef.current;
    }
    const hits = point ? noteContainersUnderPointer(point) : rectIntersection(args);
    const slot = resolveNoteCollision({
      pointer: args.pointerCoordinates,
      fallbackPoint,
      hits,
      previous: noteSlotRef.current,
      measure: (containerId) => measureNoteContainer(containerId, subject?.id ?? null),
    });
    const result = slot ? [{ id: slot.containerId, data: slot }] : [];
    lastNoteKeyRef.current = key;
    lastNoteCollisionsRef.current = result;
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
   * THE HANDLE STAYS UNDER THE FINGER. The flying copy of a tall note is clipped to
   * a few lines, but dnd-kit positions the overlay by the ORIGINAL card's corner,
   * so the clipped copy's handle would float that much above the finger — the
   * owner's "the card hangs above the mouse". Shift it down by exactly the
   * difference and the handle row lands where it was picked up.
   */
  const keepHandleUnderFinger = useCallback<Modifier>(({ transform, active }) => {
    const kind = active ? parseDragId(String(active.id))?.kind : null;
    if (kind !== 'note') return transform;
    const overlayCard = overlayCardRef.current;
    const fullHeight = activeNoteHeightRef.current;
    if (!overlayCard || !fullHeight) return transform;
    const dy = fullHeight - overlayCard.offsetHeight;
    return dy > 0 ? { ...transform, y: transform.y + dy } : transform;
  }, []);

  const activeNoteId = activeDrag?.kind === 'note' ? activeDrag.id : null;
  useEffect(() => {
    if (activeNoteId) setLiftedNoteId(activeNoteId);
  }, [activeNoteId]);

  const clearActiveDrag = () => {
    activeDragRef.current = null;
    setActiveDrag(null);
    setHoveredDropId(null);
  };
  const cancelDrag = () => { clearActiveDrag(); resetNoteDrag(); };
  return { activeDrag, hoveredDropId, noteSlot, activeNoteHeight, liftedNoteId, overlayCardRef, sensors,
    collisionDetection, keepHandleUnderFinger, onDragStart, onDragMove, onDragOver,
    handleNoteDrop, noteHomeOf, clearActiveDrag, resetNoteDrag, cancelDrag };
}
