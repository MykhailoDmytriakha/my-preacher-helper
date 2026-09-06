'use client';

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type Modifier,
} from '@dnd-kit/core';
import { ChevronDownIcon, PlusIcon } from '@heroicons/react/20/solid';
import { Bars2Icon, Bars3Icon, CheckIcon, PencilIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import PointNote from '@/components/PointNote';
import {
  allowedCollisions,
  isDropTargetEnabled,
  NOTE_POOL_ID,
  notePointContainerId,
  noteSlotHeight,
  noteSubContainerId,
  parseNoteContainerId,
  resolveNoteCollision,
  type NoteContainerMeasure,
  type NoteSlot,
} from '@/utils/boardDnd';
import { newClientId } from '@/utils/clientId';
import {
  findPointSection,
  findSubPointParent,
  movePoint,
  moveSubPoint as moveSubPointInOutline,
  nestPointUnderPoint,
  nestPointUnderPointAt,
  outdentSubPoint,
} from '@/utils/outlineDnd';
import {
  remapAfterNest,
  remapAfterOutdent,
  remapAfterSubPointReparent,
} from '@/utils/scratchPlacementRemap';
import { capitalizeFirstLetter, normalizeCapitalizedTitle } from '@/utils/textNormalization';
import { getSectionStyling } from '@/utils/themeColors';
import { getSectionLabel } from '@lib/sections';

import type { OutlinePoint, ScratchNote, SermonOutline, SubPoint } from '@/models/models';

const ACTIVE_DROP_INDICATOR_CLASS = 'bg-indigo-500';
const INACTIVE_DROP_INDICATOR_CLASS = 'bg-transparent';

type SectionKey = 'introduction' | 'main' | 'conclusion';

const SECTIONS: { key: SectionKey; styleKey: 'introduction' | 'mainPart' | 'conclusion' }[] = [
  { key: 'introduction', styleKey: 'introduction' },
  { key: 'main', styleKey: 'mainPart' },
  { key: 'conclusion', styleKey: 'conclusion' },
];

const CANCEL_KEY = 'common.cancel';
const SAVE_KEY = 'common.save';
const DELETE_KEY = 'common.delete';
const SCRATCH_DROP_OVER_CLASS = 'ring-1 ring-indigo-300 bg-indigo-50/60 dark:bg-indigo-900/20';
const NOTE_SLOT_CLASS = 'rounded-lg border border-dashed border-indigo-400 bg-indigo-50/70 dark:border-indigo-500/70 dark:bg-indigo-900/30';
const NOTE_HOME_CLASS = 'rounded-lg border border-dotted border-slate-300 bg-slate-100/50 dark:border-gray-600 dark:bg-white/5';

/**
 * WHY THIS BOARD IS ON dnd-kit AND NOT ON `@hello-pangea/dnd`.
 *
 * A plan needs one gesture the old library cannot express: dropping a POINT onto
 * another point to make it a sub-point. There, a draggable may only enter a
 * droppable of the same `type`, and nested droppables of the same type are not
 * supported — so "inside a card" and "between cards" can never both be targets
 * for the same drag. dnd-kit has no such rule: any element can be a drop target,
 * and the drop is resolved by what the pointer is actually over.
 *
 * The vocabulary below is the whole interaction, and it is deliberately literal:
 * a card means INSIDE, a gap means BESIDE. Everything the drag can mean is one
 * of these ids, so `onDragEnd` reads as a list of sentences rather than a matrix
 * of indices.
 *
 * SCRATCH NOTES SPEAK A SECOND, SIMPLER LANGUAGE. A note is filed into a
 * CONTAINER — the pool, a point, a sub-point — and the whole card or row is the
 * target. Where inside the container it lands is read from the nearest note card
 * under the pointer (upper half: before, lower half: after), and the neighbours
 * slide apart to show exactly that slot. The owner's words for the old seams and
 * bands: "the machine catches every pixel; my movements are rough".
 */
const DRAG_POINT = 'point:';
const DRAG_SUB = 'sub:';
const DRAG_NOTE = 'note:';
const DROP_INTO_POINT = 'into-point:';
const DROP_GAP = 'gap:';
const DROP_SUB_GAP = 'subgap:';
const DROP_SECTION = 'section:';

/** Whatever the drag library needs on the grab handle — the note card only spreads it. */
export type DragHandleProps = Record<string, unknown>;

/**
 * A structural move does not change an id, but it changes what the id means:
 * a point and a sub-point are addressed differently. Carry the translated note
 * addresses with the move so attached notes keep their place on the screen.
 */
type OutlineDropResult = {
  next: SermonOutline | null;
  movedPointTo: SectionKey | null;
  placementChanges: { noteId: string; placement: { pointId: string; subPointId?: string } }[];
};

type DragKind = 'point' | 'sub' | 'note';
type DragSubject = { kind: DragKind; id: string };

const dragIdFor = (kind: DragKind, id: string) =>
  `${kind === 'point' ? DRAG_POINT : kind === 'sub' ? DRAG_SUB : DRAG_NOTE}${id}`;

const parseDragId = (raw: string): DragSubject | null => {
  if (raw.startsWith(DRAG_POINT)) return { kind: 'point', id: raw.slice(DRAG_POINT.length) };
  if (raw.startsWith(DRAG_SUB)) return { kind: 'sub', id: raw.slice(DRAG_SUB.length) };
  if (raw.startsWith(DRAG_NOTE)) return { kind: 'note', id: raw.slice(DRAG_NOTE.length) };
  return null;
};

const intoPointDropId = (pointId: string) => `${DROP_INTO_POINT}${pointId}`;
const gapDropId = (section: SectionKey, index: number) => `${DROP_GAP}${section}:${index}`;
const subGapDropId = (pointId: string, index: number) => `${DROP_SUB_GAP}${pointId}:${index}`;
const sectionDropId = (section: SectionKey) => `${DROP_SECTION}${section}`;

const parseGapDropId = (raw: string): { section: SectionKey; index: number } | null => {
  if (!raw.startsWith(DROP_GAP)) return null;
  const [section, index] = raw.slice(DROP_GAP.length).split(':');
  return isSectionKey(section) ? { section, index: Number(index) } : null;
};

const rectOf = (el: Element) => {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
};

const parseSubGapDropId = (raw: string): { pointId: string; index: number } | null => {
  if (!raw.startsWith(DROP_SUB_GAP)) return null;
  const rest = raw.slice(DROP_SUB_GAP.length);
  const at = rest.lastIndexOf(':');
  return at < 0 ? null : { pointId: rest.slice(0, at), index: Number(rest.slice(at + 1)) };
};

/**
 * A card that can be picked up. The listeners go on the HANDLE, not the card, so
 * double-clicking the text to rename still works and a drag never starts from a
 * stray click inside an input.
 */
function DraggableCard({
  dragId,
  disabled,
  children,
}: {
  dragId: string;
  disabled?: boolean;
  children: (state: {
    setNodeRef: (node: HTMLElement | null) => void;
    handleProps: Record<string, unknown>;
    isDragging: boolean;
  }) => React.ReactNode;
}) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: dragId, disabled });
  return (
    <>
      {children({
        setNodeRef,
        handleProps: disabled ? {} : { ...attributes, ...listeners },
        isDragging,
      })}
    </>
  );
}

/**
 * A place a card can be dropped into.
 *
 * `activeKind` is what makes the board quiet: a target that cannot accept the
 * thing currently in the air is disabled outright, so it never highlights and
 * never competes for the pointer. Nothing is dragging → nothing is a target,
 * which is why the resting board shows no drop zones at all.
 */
function DropZone({
  dropId,
  disabled,
  activeKind,
  render,
}: {
  dropId: string;
  disabled?: boolean;
  activeKind: DragKind | null;
  render: (state: {
    setNodeRef: (node: HTMLElement | null) => void;
    isOver: boolean;
    isCandidate: boolean;
  }) => React.ReactNode;
}) {
  const isCandidate = activeKind !== null && isDropTargetEnabled(activeKind, dropId);
  /*
   * `disabled` here is ONLY about the board being read-only. It must never depend
   * on what is currently being dragged: dnd-kit measures the targets as the drag
   * begins, so a target that switches itself on at that same moment is measured
   * as absent and never collides with anything for the rest of the gesture.
   */
  const off = Boolean(disabled);
  const { setNodeRef, isOver } = useDroppable({ id: dropId, disabled: off });
  return <>{render({ setNodeRef, isOver: isOver && !off && isCandidate, isCandidate })}</>;
}

const renderInBodyPortal = (
  node: React.ReactElement<HTMLElement>,
  enabled: boolean
): React.ReactElement<HTMLElement> =>
  (enabled && typeof document !== 'undefined' ? createPortal(node, document.body) : node) as React.ReactElement<HTMLElement>;

const withSection = (outline: SermonOutline): Record<SectionKey, OutlinePoint[]> => ({
  introduction: outline.introduction ?? [],
  main: outline.main ?? [],
  conclusion: outline.conclusion ?? [],
});

const toOutline = (outline: Record<SectionKey, OutlinePoint[]>): SermonOutline => ({
  introduction: outline.introduction,
  main: outline.main,
  conclusion: outline.conclusion,
});

const isSectionKey = (value: string): value is SectionKey =>
  value === 'introduction' || value === 'main' || value === 'conclusion';

const sortSubPoints = (subPoints: SubPoint[]): SubPoint[] =>
  [...subPoints].sort((a, b) => a.position - b.position);

const findParentPointIdForSubPoint = (
  outline: Record<SectionKey, OutlinePoint[]>,
  subPointId: string
): string | null => {
  for (const section of SECTIONS) {
    const point = outline[section.key].find((item) =>
      (item.subPoints ?? []).some((sp) => sp.id === subPointId)
    );
    if (point) return point.id;
  }
  return null;
};

type ScratchPlacementTarget = { pointId: string; subPointId?: string };

type ScratchLayerProps = {
  pool: ScratchNote[];
  notesById: Map<string, ScratchNote>;
  placements: Record<string, ScratchPlacementTarget>;
  /** Re-file a note without touching its order — structural remaps and the "back to the pool" button. */
  onPlace: (noteId: string, target: ScratchPlacementTarget | null) => void;
  /**
   * One drop: WHICH container and WHERE among its notes. `neighbourIds` are that
   * container's notes as displayed, without the moved one; `index` counts among them.
   */
  onMove?: (noteId: string, target: ScratchPlacementTarget | null, neighbourIds: string[], index: number) => void;
  renderNote: (
    note: ScratchNote,
    dragHandleProps: DragHandleProps,
    options?: { overlay?: boolean }
  ) => React.ReactNode;
  poolHeader?: React.ReactNode;
  poolEmptyLabel?: string;
  /**
   * Wording for the per-point notes while the scratch layer is on. On this board a
   * point's note is the very slot a placed scratch note lands in, so calling it a
   * "reminder note" here drags the plan-editor vocabulary onto a screen that is
   * about scratch notes. Omitted -> the plan-editor wording.
   */
  noteLabels?: React.ComponentProps<typeof PointNote>['labels'];
};

interface OutlineBoardProps {
  value: SermonOutline;
  onChange: (next: SermonOutline) => void;
  isReadOnly?: boolean;
  /** Optional: count of thoughts attached to a sub-point, for the delete warning. */
  getSubPointThoughtCount?: (subPointId: string) => number;
  /** Optional: count of thoughts attached to a point (incl. its sub-points), for the delete warning. */
  getPointThoughtCount?: (pointId: string) => number;
  /** Called after a point is deleted — lets the sermon detach thoughts that referenced it. */
  onPointDeleted?: (pointId: string) => void;
  /** Called after a sub-point is deleted — lets the sermon clear its thoughts' subPointId. */
  onSubPointDeleted?: (pointId: string, subPointId: string) => void;
  /** Called after a point moves to a different section, so attached thoughts can re-sync their section. */
  onOutlinePointMoved?: (pointId: string, destinationSection: SectionKey, updatedOutline: SermonOutline) => void;
  /** Called after a sub-point moves to a different point, so attached thoughts can follow the sub-point. */
  onSubPointMoved?: (
    subPointId: string,
    sourcePointId: string,
    destinationPointId: string,
    destinationSection: SectionKey,
    updatedOutline: SermonOutline
  ) => void;
  /** Tailwind classes for the columns grid container. */
  className?: string;
  /**
   * Enable the per-point / per-sub-point reminder note ("what I want to say here").
   * Off by default so contexts like the template editor stay note-free.
   */
  showNotes?: boolean;
  scratch?: ScratchLayerProps;
}

/**
 * Reusable three-column outline editor (Introduction / Main / Conclusion) with
 * drag-and-drop of points across sections, inline edit, add/delete and sub-points.
 * Pure value/onChange — the parent owns persistence (sermon outline, or a template
 * structure). Holds only transient UI state (which row is being edited/added).
 */
const OutlineBoard: React.FC<OutlineBoardProps> = ({
  value,
  onChange,
  isReadOnly = false,
  getSubPointThoughtCount,
  getPointThoughtCount,
  onPointDeleted,
  onSubPointDeleted,
  onOutlinePointMoved,
  onSubPointMoved,
  className = 'grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4 h-full',
  showNotes = false,
  scratch,
}) => {
  const { t } = useTranslation();
  const points = withSection(value);

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

  /** What the flying copy says — the card's own words, so the drag is recognisable. */
  const activeDragLabel = (): string => {
    if (!activeDrag) return '';
    if (activeDrag.kind === 'note') {
      return scratch?.notesById.get(activeDrag.id)?.text?.slice(0, 90) ?? '';
    }
    if (activeDrag.kind === 'point') {
      for (const section of SECTIONS) {
        const found = points[section.key].find((p) => p.id === activeDrag.id);
        if (found) return found.text;
      }
      return '';
    }
    for (const section of SECTIONS) {
      for (const point of points[section.key]) {
        const sub = point.subPoints?.find((sp) => sp.id === activeDrag.id);
        if (sub) return sub.text;
      }
    }
    return '';
  };

  const [editingPointId, setEditingPointId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [addingToSection, setAddingToSection] = useState<SectionKey | null>(null);
  const [newPointText, setNewPointText] = useState('');
  const [collapsedPoints, setCollapsedPoints] = useState<Record<string, boolean>>({});
  const [pendingDelete, setPendingDelete] = useState<OutlinePoint | null>(null);
  const [addingSubPointTo, setAddingSubPointTo] = useState<string | null>(null);
  const [newSubPointText, setNewSubPointText] = useState('');
  const [editingSubPointId, setEditingSubPointId] = useState<string | null>(null);
  const [editingSubPointText, setEditingSubPointText] = useState('');
  const [pendingSubPointDelete, setPendingSubPointDelete] = useState<{
    outlinePointId: string;
    subPointId: string;
  } | null>(null);

  const emit = (next: Record<SectionKey, OutlinePoint[]>) =>
    onChange(toOutline(next));

  const addPoint = (section: SectionKey) => {
    if (isReadOnly) return;
    const text = normalizeCapitalizedTitle(newPointText);
    if (!text) {
      setAddingToSection(null);
      setNewPointText('');
      return;
    }
    emit({ ...points, [section]: [...points[section], { id: newClientId(), text }] });
    setNewPointText('');
    setAddingToSection(null);
  };

  const saveEdit = () => {
    if (isReadOnly) return;
    const text = normalizeCapitalizedTitle(editingText);
    if (!editingPointId || !text) {
      setEditingPointId(null);
      setEditingText('');
      return;
    }
    const next = SECTIONS.reduce((acc, s) => {
      acc[s.key] = points[s.key].map((p) => (p.id === editingPointId ? { ...p, text } : p));
      return acc;
    }, {} as Record<SectionKey, OutlinePoint[]>);
    setEditingPointId(null);
    setEditingText('');
    emit(next);
  };

  // Two-step delete via a custom in-board confirm overlay (no window.confirm — it
  // blocks, and the project uses dialog components). The overlay is `fixed` at a
  // z-index above the plan-editor modal so it works both inside it and standalone.
  const deletePoint = (point: OutlinePoint) => {
    if (isReadOnly) return;
    setPendingDelete(point);
  };

  const confirmDeletePoint = () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    const next = SECTIONS.reduce((acc, s) => {
      acc[s.key] = points[s.key].filter((p) => p.id !== target.id);
      return acc;
    }, {} as Record<SectionKey, OutlinePoint[]>);
    setPendingDelete(null);
    emit(next);
    // Detach any thoughts that pointed at the deleted point (sermon context only).
    onPointDeleted?.(target.id);
  };

  const mutatePoint = (outlinePointId: string, fn: (p: OutlinePoint) => OutlinePoint) => {
    const next = SECTIONS.reduce((acc, s) => {
      acc[s.key] = points[s.key].map((p) => (p.id === outlinePointId ? fn(p) : p));
      return acc;
    }, {} as Record<SectionKey, OutlinePoint[]>);
    emit(next);
  };

  const addSubPoint = (outlinePointId: string, text: string) => {
    const value2 = normalizeCapitalizedTitle(text);
    if (isReadOnly || !value2) return;
    mutatePoint(outlinePointId, (p) => {
      const existing = p.subPoints ?? [];
      const maxPos = existing.length > 0 ? Math.max(...existing.map((sp) => sp.position)) : 0;
      return { ...p, subPoints: [...existing, { id: newClientId(), text: value2, position: maxPos + 1000 }] };
    });
  };

  const editSubPoint = (outlinePointId: string, subPointId: string, newText: string) => {
    const value2 = normalizeCapitalizedTitle(newText);
    if (isReadOnly || !value2) return;
    mutatePoint(outlinePointId, (p) => ({
      ...p,
      subPoints: (p.subPoints ?? []).map((sp) => (sp.id === subPointId ? { ...sp, text: value2 } : sp)),
    }));
  };

  const deleteSubPoint = (outlinePointId: string, subPointId: string) => {
    if (isReadOnly) return;
    mutatePoint(outlinePointId, (p) => ({
      ...p,
      subPoints: (p.subPoints ?? []).filter((sp) => sp.id !== subPointId),
    }));
    // Clear subPointId on any thoughts attached to the removed sub-point.
    onSubPointDeleted?.(outlinePointId, subPointId);
  };

  const startAddingSubPoint = (outlinePointId: string) => {
    if (isReadOnly) return;
    setAddingSubPointTo(outlinePointId);
    setNewSubPointText('');
    setEditingSubPointId(null);
    setEditingSubPointText('');
  };

  const saveNewSubPoint = (outlinePointId: string) => {
    if (isReadOnly) return;
    const value2 = normalizeCapitalizedTitle(newSubPointText);
    if (value2) {
      addSubPoint(outlinePointId, value2);
    }
    setAddingSubPointTo(null);
    setNewSubPointText('');
  };

  const startEditingSubPoint = (sp: SubPoint) => {
    if (isReadOnly) return;
    setEditingSubPointId(sp.id);
    setEditingSubPointText(capitalizeFirstLetter(sp.text));
    setAddingSubPointTo(null);
    setNewSubPointText('');
  };

  const saveSubPointEdit = (outlinePointId: string, subPointId: string) => {
    if (isReadOnly) return;
    const value2 = normalizeCapitalizedTitle(editingSubPointText);
    if (value2) {
      editSubPoint(outlinePointId, subPointId, value2);
    }
    setEditingSubPointId(null);
    setEditingSubPointText('');
  };

  const requestDeleteSubPoint = (outlinePointId: string, subPointId: string) => {
    if (isReadOnly) return;
    const count = getSubPointThoughtCount?.(subPointId) ?? 0;
    if (count > 0) {
      setPendingSubPointDelete({ outlinePointId, subPointId });
    } else {
      deleteSubPoint(outlinePointId, subPointId);
    }
  };

  const confirmDeleteSubPoint = () => {
    if (!pendingSubPointDelete) return;
    deleteSubPoint(pendingSubPointDelete.outlinePointId, pendingSubPointDelete.subPointId);
    setPendingSubPointDelete(null);
  };

  /** The placement a note container stands for; `undefined` when the container cannot be resolved. */
  const placementForContainer = (containerId: string): ScratchPlacementTarget | null | undefined => {
    const parsed = parseNoteContainerId(containerId);
    if (!parsed) return undefined;
    if (parsed.kind === 'pool') return null;
    if (parsed.kind === 'point') return { pointId: parsed.pointId };
    const parentPointId = findParentPointIdForSubPoint(points, parsed.subPointId);
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

  const handlePointDrop = (subject: DragSubject, overId: string, outline: SermonOutline): OutlineDropResult => {
    const result: OutlineDropResult = { next: null, movedPointTo: null, placementChanges: [] };
    if (overId.startsWith(DROP_INTO_POINT)) {
      // Dropped ON a card — the point becomes its sub-point (children follow).
      const newParentId = overId.slice(DROP_INTO_POINT.length);
      const formerChildren = (SECTIONS.flatMap((sec) => points[sec.key]).find((p) => p.id === subject.id)?.subPoints ?? []).map((sp) => sp.id);
      result.next = nestPointUnderPoint(outline, subject.id, newParentId);
      result.placementChanges = remapAfterNest(scratch?.placements ?? {}, subject.id, newParentId, formerChildren);
    } else if (parseSubGapDropId(overId)) {
      /*
       * A seam BETWEEN sub-points is a real intention: "put this point under
       * that one, right here". The board drew the line for it and then did
       * nothing, because this branch only understood seams between points —
       * so every drop above or below a sub-point silently did nothing.
       */
      const subGap = parseSubGapDropId(overId)!;
      const formerChildren = (SECTIONS.flatMap((sec) => points[sec.key]).find((p) => p.id === subject.id)?.subPoints ?? []).map((sp) => sp.id);
      result.next = nestPointUnderPointAt(outline, subject.id, subGap.pointId, subGap.index);
      result.placementChanges = remapAfterNest(scratch?.placements ?? {}, subject.id, subGap.pointId, formerChildren);
    } else {
      const gap = parseGapDropId(overId);
      const section = gap?.section ?? (overId.startsWith(DROP_SECTION) && isSectionKey(overId.slice(DROP_SECTION.length))
        ? (overId.slice(DROP_SECTION.length) as SectionKey)
        : null);
      if (!section) return result;
      const index = gap ? gap.index : (points[section]?.length ?? 0);
      if (findPointSection(outline, subject.id) !== section) result.movedPointTo = section;
      result.next = movePoint(outline, subject.id, section, index);
    }
    return result;
  };

  const handleSubPointDrop = (subject: DragSubject, overId: string, outline: SermonOutline): OutlineDropResult => {
    const result: OutlineDropResult = { next: null, movedPointTo: null, placementChanges: [] };
    if (overId.startsWith(DROP_INTO_POINT)) {
      const targetPointId = overId.slice(DROP_INTO_POINT.length);
      // Onto a card: land at the end of that card's children.
      result.next = moveSubPointInOutline(outline, subject.id, targetPointId, Number.MAX_SAFE_INTEGER);
      result.placementChanges = remapAfterSubPointReparent(scratch?.placements ?? {}, subject.id, targetPointId);
    } else {
      const subGap = parseSubGapDropId(overId);
      if (subGap) {
        result.next = moveSubPointInOutline(outline, subject.id, subGap.pointId, subGap.index);
      } else {
        // A gap between POINTS means "leave your parent" — the sub-point is promoted.
        const gap = parseGapDropId(overId);
        const section = gap?.section ?? (overId.startsWith(DROP_SECTION) && isSectionKey(overId.slice(DROP_SECTION.length))
          ? (overId.slice(DROP_SECTION.length) as SectionKey)
          : null);
        if (!section) return result;
        const index = gap ? gap.index : (points[section]?.length ?? 0);
        const formerParent = findSubPointParent(outline, subject.id)?.point.id;
        result.next = outdentSubPoint(outline, subject.id, section, index);
        result.movedPointTo = section;
        if (formerParent) {
          result.placementChanges = remapAfterOutdent(scratch?.placements ?? {}, subject.id, formerParent);
        }
      }
    }
    return result;
  };

  /**
   * ONE DROP, READ AS A SENTENCE.
   *
   * Every drop target says what it means — a card means "inside me", a gap means
   * "beside me here" — so this handler only has to name the pairing and hand it
   * to the pure move in `outlineDnd`. All the index arithmetic and the two-level
   * rule live there, where they are tested without a browser.
   */
  const onDragEnd = (event: DragEndEvent) => {
    const subject = parseDragId(String(event.active.id));
    activeDragRef.current = null;
    setActiveDrag(null);
    setHoveredDropId(null);
    const overId = event.over ? String(event.over.id) : null;

    if (subject?.kind === 'note') {
      if (!isReadOnly) handleNoteDrop(subject, event);
      resetNoteDrag();
      return;
    }
    if (isReadOnly) return;
    if (!subject || !overId) return;

    const outline = toOutline(points);
    const { next, movedPointTo, placementChanges } = subject.kind === 'point'
      ? handlePointDrop(subject, overId, outline)
      : handleSubPointDrop(subject, overId, outline);

    if (!next) return;
    if (JSON.stringify(next) === JSON.stringify(outline)) return;

    onChange(next);
    // Re-file the notes whose address the move invalidated (pure remap above).
    placementChanges.forEach(({ noteId, placement }) => scratch?.onPlace(noteId, placement));

    /*
     * THOUGHTS FOLLOW THE THING THEY WERE ATTACHED TO.
     *
     * A point that changes section, or a sub-point that changes parent, leaves
     * thoughts pointing at a place that no longer describes them. These two
     * callbacks are how the sermon page re-syncs them, and they were wired into
     * the old drag handler — losing them here would have been a silent regression
     * that no type or test would catch, only a preacher finding his notes under
     * the wrong heading.
     */
    if (subject.kind === 'point' && movedPointTo) {
      onOutlinePointMoved?.(subject.id, movedPointTo, next);
    }
    if (subject.kind === 'sub') {
      const before = findSubPointParent(outline, subject.id);
      const after = findSubPointParent(next, subject.id);
      if (before && after && before.point.id !== after.point.id) {
        onSubPointMoved?.(subject.id, before.point.id, after.point.id, after.section, next);
      }
      // Promoted out of its parent: it is a point now, in whatever section it landed.
      if (before && !after && movedPointTo) {
        onOutlinePointMoved?.(subject.id, movedPointTo, next);
      }
    }
  };

  /**
   * The space BETWEEN cards, and the whole of "beside, not inside".
   *
   * It stays invisible until a drag is over it, so the board is not a ladder of
   * empty strips when nothing is being moved — the complaint about the old layout
   * was exactly that, rectangles inviting an action nobody is taking yet.
   */
  const renderDropGap = (dropId: string, indented = false) => (
    <DropZone
      dropId={dropId}
      disabled={isReadOnly}
      activeKind={activeDrag?.kind ?? null}
      render={({ setNodeRef, isOver }) => (
        <div
          ref={setNodeRef}
          /*
           * A 2px seam is honest geometry and a miserable target: aiming at it
           * with a card under the cursor means missing. While a card is in the
           * air the seam becomes a real landing strip and collapses again the
           * moment the drag ends, so a board at rest keeps its density and shows
           * no drop zones at all.
           */
          /*
           * The seam always occupies the same height, so nothing reflows when a
           * drag starts; only what is painted inside it changes. The line follows
           * the documented shape: a 2px stroke with a round terminal on the left,
           * shown only where a relative position actually exists.
           */
          className={`relative h-3 -my-1.5 ${indented ? 'ml-2' : ''}`}
        >
          <span
            className={`pointer-events-none absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full transition-colors ${
              isOver ? ACTIVE_DROP_INDICATOR_CLASS : INACTIVE_DROP_INDICATOR_CLASS
            }`}
          />
          <span
            className={`pointer-events-none absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full transition-colors ${
              indented ? 'left-0' : '-left-1'
            } ${isOver ? ACTIVE_DROP_INDICATOR_CLASS : INACTIVE_DROP_INDICATOR_CLASS}`}
          />
        </div>
      )}
    />
  );

  const activeNoteId = activeDrag?.kind === 'note' ? activeDrag.id : null;
  useEffect(() => {
    if (activeNoteId) setLiftedNoteId(activeNoteId);
  }, [activeNoteId]);

  const renderScratchNote = (note: ScratchNote, testId?: string) => {
    if (!scratch) return null;

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
            {scratch.renderNote(note, handleProps as DragHandleProps)}
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
  const renderNoteList = (containerId: string, notes: ScratchNote[], testIdFor?: (note: ScratchNote) => string) => {
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
    return items;
  };

  /**
   * KEEP THE SPACE, CHANGE ONLY THE PAINT. Collapsing an empty strip when it was
   * not a target made the whole card change height the instant a drag began — the
   * "everything jumped" report. The strip keeps its box; the slot inside it, when
   * the container is the target, is the only thing that appears.
   */
  const renderNoteStrip = ({ containerId, notes, testId }: { containerId: string; notes: ScratchNote[]; testId: string }) => {
    if (!scratch) return null;
    return (
      <div
        data-testid={testId}
        data-scratch-strip={containerId}
        className="mt-1.5 flex min-h-[32px] flex-col gap-1.5 rounded-lg px-1 py-1"
      >
        {renderNoteList(containerId, notes, (note) => `scratch-placed-note-${note.id}`)}
      </div>
    );
  };

  const getScratchPoolNotes = () => (scratch ? scratch.pool : []);

  const getScratchPointNotes = (pointId: string) =>
    scratch
      ? Array.from(scratch.notesById.values()).filter((note) => {
          const placement = scratch.placements[note.id];
          return placement?.pointId === pointId && !placement.subPointId;
        })
      : [];

  const getScratchSubPointNotes = (subPointId: string) =>
    scratch
      ? Array.from(scratch.notesById.values()).filter(
          (note) => scratch.placements[note.id]?.subPointId === subPointId
        )
      : [];

  /** The notes a given container shows — the neighbours a drop is measured against. */
  const notesInContainer = (containerId: string): ScratchNote[] => {
    const parsed = parseNoteContainerId(containerId);
    if (!parsed) return [];
    if (parsed.kind === 'pool') return getScratchPoolNotes();
    if (parsed.kind === 'point') return getScratchPointNotes(parsed.pointId);
    return getScratchSubPointNotes(parsed.subPointId);
  };

  const isNoteTarget = (containerId: string) => noteSlot !== null && !noteSlot.own && noteSlot.containerId === containerId;

  const renderScratchPool = () => {
    if (!scratch) return null;
    const poolNotes = getScratchPoolNotes();
    const poolIsEmpty = poolNotes.length === 0;

    return (
      <DropZone
        dropId={NOTE_POOL_ID}
        disabled={isReadOnly}
        activeKind={activeDrag?.kind ?? null}
        render={({ setNodeRef }) => (
          <section
            ref={setNodeRef}
            data-testid="scratch-note-pool-band"
            data-note-container={NOTE_POOL_ID}
            className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm shadow-gray-900/5 dark:border-gray-700 dark:bg-gray-900 dark:shadow-black/20"
          >
            {scratch.poolHeader && <div className="mb-3">{scratch.poolHeader}</div>}
            <div
              data-scratch-strip={NOTE_POOL_ID}
              className={`grid min-h-[88px] grid-cols-1 gap-3 rounded-lg transition-all duration-150 md:grid-cols-2 xl:grid-cols-3 ${
                isNoteTarget(NOTE_POOL_ID) ? SCRATCH_DROP_OVER_CLASS : ''
              }`}
            >
              {poolIsEmpty && !isNoteTarget(NOTE_POOL_ID) && (
                <div className="col-span-full rounded-lg border border-dashed border-gray-300 px-3 py-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  {scratch.poolEmptyLabel}
                </div>
              )}
              {renderNoteList(NOTE_POOL_ID, poolNotes)}
            </div>
          </section>
        )}
      />
    );
  };

  const renderSubPointControls = (point: OutlinePoint, sp: SubPoint) => {
    const isEditing = editingSubPointId === sp.id;

    if (isEditing) {
      return (
        <div className="flex-1 flex items-center gap-1 min-w-0">
          <input
            type="text"
            value={editingSubPointText}
            onChange={(e) => setEditingSubPointText(capitalizeFirstLetter(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveSubPointEdit(point.id, sp.id);
              if (e.key === 'Escape') {
                setEditingSubPointId(null);
                setEditingSubPointText('');
              }
            }}
            className="flex-1 px-2 py-0.5 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded border border-gray-300 dark:border-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-400 min-w-0"
            autoFocus
          />
          <button
            onClick={() => saveSubPointEdit(point.id, sp.id)}
            className="p-0.5 text-green-600 hover:text-green-700 dark:text-green-400"
            aria-label={t(SAVE_KEY)}
          >
            <CheckIcon className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => {
              setEditingSubPointId(null);
              setEditingSubPointText('');
            }}
            className="p-0.5 text-gray-400 hover:text-gray-600 dark:text-gray-500"
            aria-label={t(CANCEL_KEY)}
          >
            <XMarkIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      );
    }

    return (
      <>
        <span
          className="flex-1 min-w-0 truncate text-sm font-medium text-slate-600 dark:text-blue-50/90 cursor-text"
          title={sp.text}
          onDoubleClick={() => startEditingSubPoint(sp)}
        >
          {sp.text}
        </span>
        {!isReadOnly && (
          <div className="flex w-10 flex-shrink-0 items-center justify-end gap-0.5 opacity-100 lg:opacity-40 transition-opacity lg:group-hover/subpoint:opacity-100">
            <button
              onClick={() => startEditingSubPoint(sp)}
              className="p-0.5 text-slate-400 hover:text-slate-600 dark:text-blue-100/45 dark:hover:text-blue-50"
              aria-label={t('common.edit')}
            >
              <PencilIcon className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => requestDeleteSubPoint(point.id, sp.id)}
              className="p-0.5 text-slate-400 hover:text-red-500 dark:text-blue-100/45 dark:hover:text-red-200"
              aria-label={t(DELETE_KEY)}
            >
              <TrashIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </>
    );
  };

  const renderSubPoints = (point: OutlinePoint) => {
    const sorted = sortSubPoints(point.subPoints ?? []);
    const pendingDeleteForPoint =
      pendingSubPointDelete?.outlinePointId === point.id ? pendingSubPointDelete : null;
    const showWrapper = sorted.length > 0 || addingSubPointTo === point.id || pendingDeleteForPoint !== null || !isReadOnly;

    if (!showWrapper) return null;

    return (
      <div className="ml-7 mr-4 mt-2 mb-2 max-w-[calc(100%-2.75rem)] rounded-lg border-l border-slate-300/80 bg-white/20 py-1.5 pl-3 pr-2 dark:border-blue-100/35 dark:bg-white/[0.03] transition-all duration-150">
            <div className="min-h-[24px] space-y-1.5">
              {sorted.map((sp, index) => (
                <React.Fragment key={sp.id}>
                  {renderDropGap(subGapDropId(point.id, index), true)}
                  <DraggableCard dragId={dragIdFor('sub', sp.id)} disabled={isReadOnly}>
                  {({ setNodeRef, handleProps, isDragging }) => (
                      <DropZone
                        dropId={noteSubContainerId(sp.id)}
                        disabled={isReadOnly}
                        activeKind={activeDrag?.kind ?? null}
                        render={({ setNodeRef: setNoteContainerRef }) => (
                      <div
                        ref={(el) => {
                          setNodeRef(el);
                          setNoteContainerRef(el);
                        }}
                        data-note-container={noteSubContainerId(sp.id)}
                      >
                        {/*
                          * A row must be readable as its own object WITHOUT being touched.
                          * These rows used to be bare text on the parent's fill, with an
                          * outline appearing only on hover — so at rest one could not tell
                          * where one sub-point ended and the next began. The surface is
                          * permanent now; hover only brightens what is already there.
                          * For a note in the air the WHOLE row is the target.
                          */}
                        <div
                          className={`group/subpoint rounded-lg border px-2 py-1.5 transition-colors ${
                            isDragging
                              ? 'border-blue-400/50 bg-white shadow-lg ring-1 ring-blue-400/50 opacity-60 dark:bg-slate-800'
                              : isNoteTarget(noteSubContainerId(sp.id))
                                ? `border-indigo-300 ${SCRATCH_DROP_OVER_CLASS}`
                                : 'border-slate-200/90 bg-white shadow-sm hover:border-slate-300 dark:border-white/[0.14] dark:bg-white/[0.11] dark:hover:border-white/25 dark:hover:bg-white/[0.16]'
                          }`}
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            {!isReadOnly ? (
                              <div
                                {...handleProps}
                                className="cursor-grab flex-shrink-0 w-6 min-h-[28px] flex items-center justify-center touch-none"
                                aria-label={t('common.dragToReorder')}
                              >
                                <Bars2Icon className="h-3 w-3 text-slate-400 dark:text-blue-100/70" />
                              </div>
                            ) : (
                              <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-blue-100/75 flex-shrink-0 shadow-sm dark:shadow-blue-950/20" />
                            )}
                            {renderSubPointControls(point, sp)}
                          </div>
                          {showNotes && (
                            <PointNote
                              note={sp.note}
                              onChange={(n) =>
                                mutatePoint(point.id, (p) => ({
                                  ...p,
                                  subPoints: (p.subPoints ?? []).map((s) => (s.id === sp.id ? { ...s, note: n } : s)),
                                }))
                              }
                              isReadOnly={isReadOnly}
                              indentClass="ml-5"
                              addRevealClass="opacity-100 lg:opacity-0 lg:group-hover/subpoint:opacity-100"
                              tone={scratch ? 'neutral' : 'note'}
                              labels={scratch?.noteLabels}
                            />
                          )}
                          {scratch &&
                            renderNoteStrip({
                              containerId: noteSubContainerId(sp.id),
                              testId: `scratch-subpoint-drop-zone-${sp.id}`,
                              notes: getScratchSubPointNotes(sp.id),
                            })}
                        </div>
                      </div>
                        )}
                      />
                  )}
                  </DraggableCard>
                </React.Fragment>
              ))}
              {renderDropGap(subGapDropId(point.id, sorted.length), true)}
            </div>

            {pendingDeleteForPoint && (
              <div className="flex items-center gap-2 py-1.5 px-2 mt-1 rounded bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 text-xs">
                <span className="text-red-600 dark:text-red-400 flex-1">
                  {t('structure.subPointDeleteConfirm', {
                    defaultValue: '{{count}} thought(s) will be ungrouped',
                    count: getSubPointThoughtCount?.(pendingDeleteForPoint.subPointId) ?? 0,
                  })}
                </span>
                <button
                  onClick={confirmDeleteSubPoint}
                  className="px-2 py-0.5 rounded bg-red-100 hover:bg-red-200 dark:bg-red-800/40 dark:hover:bg-red-800/60 text-red-700 dark:text-red-300 font-medium transition-colors"
                >
                  {t(DELETE_KEY)}
                </button>
                <button
                  onClick={() => setPendingSubPointDelete(null)}
                  className="p-0.5 text-gray-400 hover:text-gray-600 dark:text-gray-500"
                  aria-label={t(CANCEL_KEY)}
                >
                  <XMarkIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {!isReadOnly && (
              <div className={sorted.length > 0 ? 'mt-0.5' : 'py-0.5'}>
                {addingSubPointTo === point.id ? (
                  <div className="flex items-center gap-1 pl-1.5">
                    <span className="w-1 h-1 rounded-full bg-blue-300 dark:bg-blue-500 flex-shrink-0" />
                    <input
                      type="text"
                      value={newSubPointText}
                      onChange={(e) => setNewSubPointText(capitalizeFirstLetter(e.target.value))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveNewSubPoint(point.id);
                        if (e.key === 'Escape') {
                          setAddingSubPointTo(null);
                          setNewSubPointText('');
                        }
                      }}
                      placeholder={t('structure.subPointPlaceholder', { defaultValue: 'Sub-point name...' })}
                      className="flex-1 px-2 py-0.5 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded border border-gray-300 dark:border-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-400 min-w-0"
                      autoFocus
                    />
                    <button
                      onClick={() => saveNewSubPoint(point.id)}
                      className="p-0.5 text-green-600 hover:text-green-700 dark:text-green-400"
                      aria-label={t(SAVE_KEY)}
                    >
                      <CheckIcon className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        setAddingSubPointTo(null);
                        setNewSubPointText('');
                      }}
                      className="p-0.5 text-gray-400 hover:text-gray-600 dark:text-gray-500"
                      aria-label={t(CANCEL_KEY)}
                    >
                      <XMarkIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => startAddingSubPoint(point.id)}
                    className="flex items-center gap-1 pl-1.5 py-0.5 text-xs font-medium text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors rounded focus:outline-none focus-visible:ring-1 focus-visible:ring-indigo-500/50"
                  >
                    <PlusIcon className="h-3.5 w-3.5 mr-0.5" />
                    <span>{t('structure.addSubPoint', { defaultValue: 'Add sub-point' })}</span>
                  </button>
                )}
              </div>
            )}
      </div>
    );
  };

  const renderColumn = (section: SectionKey, styleKey: 'introduction' | 'mainPart' | 'conclusion') => {
    const colPoints = points[section];
    // The seam of an empty column and the column itself mean the same thing to a
    // person; treat a hover on either as a hover on the region.
    const isColumnCandidateHovered = hoveredDropId === gapDropId(section, colPoints.length);
    const colors = getSectionStyling(styleKey);
    return (
      <section
        key={section}
        data-testid={`outline-board-column-${section}`}
        className={`flex flex-col min-h-0 rounded-xl border ${colors.border} bg-white dark:bg-gray-800`}
      >
        <div className={`flex items-center justify-between px-3 py-2.5 rounded-t-xl ${colors.headerBg}`}>
          <h3 className="font-semibold text-gray-700 dark:text-gray-100">{getSectionLabel(t, styleKey)}</h3>
          <span className={`inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-xs leading-none tabular-nums ${colors.badge}`}>
            {colPoints.length}
          </span>
        </div>

        <DropZone
          dropId={sectionDropId(section)}
          disabled={isReadOnly}
          activeKind={activeDrag?.kind ?? null}
          render={({ setNodeRef, isOver }) => (
            <ul
              ref={setNodeRef}
              /*
               * An empty column has nothing to place a card relative to, so the
               * documented answer is a background wash on the whole region rather
               * than a line. It also has to react while ANY of its own targets is
               * under the pointer: the seam inside it wins the collision by
               * design, and the column was staying blank the whole time — which is
               * exactly the "I dragged into Conclusion and nothing lit up" report.
               */
              className={`flex-1 overflow-y-auto p-2.5 space-y-2 min-h-[60px] rounded-b-xl transition-colors ${
                (isOver || isColumnCandidateHovered) && colPoints.length === 0
                  ? 'bg-indigo-100/70 outline outline-2 outline-dashed outline-indigo-400 dark:bg-indigo-900/30'
                  : ''
              }`}
            >
              {colPoints.map((point, index) => (
                <React.Fragment key={point.id}>
                  {renderDropGap(gapDropId(section, index))}
                  <DraggableCard dragId={dragIdFor('point', point.id)} disabled={isReadOnly}>
                  {({ setNodeRef: setCardRef, handleProps, isDragging }) => (
                      <DropZone
                        dropId={intoPointDropId(point.id)}
                        disabled={isReadOnly || isDragging}
                        activeKind={activeDrag?.kind ?? null}
                        render={({ setNodeRef: setIntoRef, isOver: isIntoTarget }) => (
                      <DropZone
                        dropId={notePointContainerId(point.id)}
                        disabled={isReadOnly}
                        activeKind={activeDrag?.kind ?? null}
                        render={({ setNodeRef: setNoteContainerRef }) => (
                      <li
                        ref={(el) => {
                          setCardRef(el);
                          setNoteContainerRef(el);
                        }}
                        data-note-container={notePointContainerId(point.id)}
                        /*
                         * The original never moves and never changes shape while it
                         * is being dragged — it dims to 40%, which is the documented
                         * convention and the only one that keeps the board still.
                         * "Combine" targets say so with a filled background plus an
                         * outline, not a hairline border nobody can see. For a NOTE
                         * in the air the whole card is the container: a wash, no
                         * outline — the outline means "nest", and a note never nests.
                         */
                        className={`group relative rounded-lg border bg-white dark:bg-gray-800 shadow-sm transition-colors ${
                          isDragging ? 'opacity-40 border-slate-200 dark:border-gray-700' : 'border-slate-200 dark:border-gray-700'
                        } ${
                          isIntoTarget
                            ? 'outline outline-2 outline-indigo-500 border-indigo-400 bg-indigo-50 dark:bg-indigo-950/40'
                            : isNoteTarget(notePointContainerId(point.id))
                              ? `border-indigo-300 ${SCRATCH_DROP_OVER_CLASS}`
                              : ''
                        }`}
                      >
                        {/*
                          THE MIDDLE MEANS "INSIDE", THE EDGES MEAN "NEXT TO".

                          The whole card used to be the nest target, so a drag
                          aimed at the seam a few pixels away merged two points
                          instead of reordering them — the owner's "they merged".
                          Splitting the card the way file trees do makes the two
                          intentions physically different places: the middle band
                          nests, everything above and below belongs to the seams.
                        */}
                        <div
                          ref={setIntoRef}
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-x-0 top-1/4 h-1/2"
                        />
                        <div className="flex items-start gap-1.5 p-2">
                          <div
                            {...handleProps}
                            className={`mt-0.5 touch-none text-gray-400 dark:text-gray-500 ${isReadOnly ? 'cursor-not-allowed opacity-50' : 'cursor-grab hover:text-gray-600 dark:hover:text-gray-300'}`}
                            aria-label={t('common.dragToReorder')}
                          >
                            <Bars3Icon className="h-5 w-5" />
                          </div>

                          {editingPointId === point.id ? (
                            <div className="flex-1 flex items-center gap-1">
                              <input
                                type="text"
                                value={editingText}
                                onChange={(e) => setEditingText(capitalizeFirstLetter(e.target.value))}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') saveEdit();
                                  if (e.key === 'Escape') {
                                    setEditingPointId(null);
                                    setEditingText('');
                                  }
                                }}
                                className="flex-1 p-1 text-sm bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded border border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                placeholder={t('structure.editPointPlaceholder')}
                                autoFocus
                              />
                              <button aria-label={t(SAVE_KEY)} onClick={saveEdit} className="p-1 text-green-600 hover:text-green-800 dark:text-green-400">
                                <CheckIcon className="h-5 w-5" />
                              </button>
                              <button
                                aria-label={t(CANCEL_KEY)}
                                onClick={() => {
                                  setEditingPointId(null);
                                  setEditingText('');
                                }}
                                className="p-1 text-red-600 hover:text-red-800 dark:text-red-400"
                              >
                                <XMarkIcon className="h-5 w-5" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start gap-1.5">
                                {(point.subPoints?.length ?? 0) > 0 && (
                                  <button
                                    onClick={() => setCollapsedPoints((prev) => ({ ...prev, [point.id]: !prev[point.id] }))}
                                    className="mt-0.5 p-0.5 rounded hover:bg-black/5 dark:hover:bg-white/10 text-gray-500 dark:text-gray-400 flex-shrink-0"
                                    aria-label={collapsedPoints[point.id] ? t('common.expand') : t('common.collapse')}
                                  >
                                    <ChevronDownIcon className={`h-4 w-4 transition-transform ${collapsedPoints[point.id] ? '-rotate-90' : ''}`} />
                                  </button>
                                )}
                                <span
                                  className={`text-sm text-gray-800 dark:text-gray-200 break-words ${isReadOnly ? '' : 'cursor-text'}`}
                                  onDoubleClick={() => {
                                    if (isReadOnly) return;
                                    setEditingPointId(point.id);
                                    setEditingText(capitalizeFirstLetter(point.text));
                                    setAddingToSection(null);
                                  }}
                                >
                                  {point.text}
                                </span>
                              </div>
                            </div>
                          )}

                          {editingPointId !== point.id && !isReadOnly && (
                            <div className="flex items-center gap-0.5 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity">
                              <button
                                aria-label={t('common.edit')}
                                onClick={() => {
                                  setEditingPointId(point.id);
                                  setEditingText(capitalizeFirstLetter(point.text));
                                  setAddingToSection(null);
                                }}
                                className="p-1 text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400"
                              >
                                <PencilIcon className="h-4 w-4" />
                              </button>
                              <button aria-label={t(DELETE_KEY)} onClick={() => deletePoint(point)} className="p-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400">
                                <TrashIcon className="h-4 w-4" />
                              </button>
                            </div>
                          )}
                        </div>
                        {editingPointId !== point.id && (
                          <div className="min-w-0 px-2 pb-2">
                            {showNotes && (
                              <PointNote
                                note={point.note}
                                onChange={(n) => mutatePoint(point.id, (p) => ({ ...p, note: n }))}
                                isReadOnly={isReadOnly}
                                indentClass="ml-6"
                                addRevealClass="opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
                                tone={scratch ? 'neutral' : 'note'}
                                labels={scratch?.noteLabels}
                              />
                            )}
                            {scratch &&
                              renderNoteStrip({
                                containerId: notePointContainerId(point.id),
                                testId: `scratch-point-drop-zone-${point.id}`,
                                notes: getScratchPointNotes(point.id),
                              })}
                            {!collapsedPoints[point.id] && renderSubPoints(point)}
                          </div>
                        )}
                      </li>
                        )}
                      />
                        )}
                      />
                  )}
                  </DraggableCard>
                </React.Fragment>
              ))}
              {renderDropGap(gapDropId(section, colPoints.length))}
            </ul>
          )}
        />

        {!isReadOnly && (
          <div className="p-2.5 pt-0">
            {addingToSection === section ? (
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={newPointText}
                  onChange={(e) => setNewPointText(capitalizeFirstLetter(e.target.value))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addPoint(section);
                    if (e.key === 'Escape') {
                      setAddingToSection(null);
                      setNewPointText('');
                    }
                  }}
                  placeholder={t('structure.addPointPlaceholder')}
                  className="flex-1 p-1.5 text-sm bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded border border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  autoFocus
                />
                <button aria-label={t(SAVE_KEY)} onClick={() => addPoint(section)} className="p-1.5 text-green-600 hover:text-green-800">
                  <CheckIcon className="h-5 w-5" />
                </button>
                <button
                  aria-label={t(CANCEL_KEY)}
                  onClick={() => {
                    setAddingToSection(null);
                    setNewPointText('');
                  }}
                  className="p-1.5 text-red-600 hover:text-red-800"
                >
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => {
                  setAddingToSection(section);
                  setEditingPointId(null);
                }}
                className="flex items-center justify-center w-full p-2 text-sm text-gray-500 dark:text-gray-400 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 hover:text-indigo-600 hover:border-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors"
              >
                <PlusIcon className="h-4 w-4 mr-1" />
                {t('structure.addPointButton')}
              </button>
            )}
          </div>
        )}
      </section>
    );
  };

  const boardColumns = <div className={className}>{SECTIONS.map((s) => renderColumn(s.key, s.styleKey))}</div>;
  const pendingDeleteOverlay = pendingDelete ? (
    <div className="fixed inset-0 z-[210] flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-sm bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-5">
        <h3 className="text-base font-semibold text-slate-800 dark:text-gray-100">
          {t('structure.deletePointConfirmTitle')}
        </h3>
        <p className="mt-2 text-sm text-slate-500 dark:text-gray-400">
          {t('structure.deletePointConfirm', { text: pendingDelete.text })}
        </p>
        {(getPointThoughtCount?.(pendingDelete.id) ?? 0) > 0 && (
          <p className="mt-2 text-sm font-medium text-amber-700 dark:text-amber-400">
            {t('planEditor.thoughtsUnassignedWarning', {
              defaultValue: '{{count}} thought(s) will be unassigned, not deleted',
              count: getPointThoughtCount?.(pendingDelete.id) ?? 0,
            })}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={() => setPendingDelete(null)}
            className="rounded-lg border border-slate-300 dark:border-gray-600 text-slate-600 dark:text-gray-300 text-sm font-medium px-4 py-2 hover:bg-slate-50 dark:hover:bg-gray-700"
          >
            {t(CANCEL_KEY)}
          </button>
          <button
            onClick={confirmDeletePoint}
            className="rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium px-4 py-2"
          >
            {t(DELETE_KEY)}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      <DndContext
        sensors={sensors}
        /*
         * `pointerWithin` and not the default: a card sits INSIDE a column, and a
         * gap sits inside the same space again. Distance-to-centre would keep
         * choosing the biggest box under the cursor, so "beside" would be
         * unreachable. What the pointer is literally over is the only reading that
         * matches what the person sees.
         */
        /*
         * Targets here overlap by construction — a seam sits inside a card sits
         * inside a column — so the raw list of hits is ordered by how precise the
         * target is before the first one is taken. `pointerWithin` alone would
         * hand back whichever it listed first, and the drop would mean something
         * nobody aimed at. (Newer dnd-kit spells this as `collisionPriority`.)
         */
        collisionDetection={collisionDetection}
        /*
         * MEASURE ON EVERY DRAG, NOT ONCE.
         *
         * dnd-kit caches droppable geometry by default. This board rebuilds its
         * lists after every drop — cards move between columns, gaps appear and
         * vanish — so the cached rectangles describe a layout that no longer
         * exists, and the second drag in a session lands on nothing. Measured
         * live: the first drop worked, the next silently did nothing. The
         * official tree example takes the same precaution.
         */
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragOver={onDragOver}
        onDragCancel={() => {
          activeDragRef.current = null;
          setActiveDrag(null);
          setHoveredDropId(null);
          resetNoteDrag();
        }}
        onDragEnd={onDragEnd}
      >
        {scratch ? (
          <div className="space-y-4">
            {renderScratchPool()}
            {boardColumns}
          </div>
        ) : (
          boardColumns
        )}

        {/*
          THE CARD HAS TO BE VISIBLY IN THE AIR — AND RENDERED THROUGH A PORTAL.

          Without an overlay the original just dims in place, which is what the
          owner reported as "I don't see that the card is being dragged". And the
          overlay has to leave this subtree: an ancestor carries a transform
          (the panel animates), and a transformed ancestor becomes the containing
          block for fixed positioning — the copy then renders relative to it and
          lands off-screen. Measured: `left: -2345px`. The official tree example
          portals it to the body for the same reason.
        */}
        {renderInBodyPortal(
          <DragOverlay dropAnimation={null} modifiers={[keepHandleUnderFinger]}>
            {activeDrag?.kind === 'note' && scratch ? (
              /*
               * A NOTE FLIES AS ITSELF. The copy is the card the finger picked up —
               * clipped to a few lines when it is tall — and it stays glued to the
               * finger: the modifier above keeps the handle row where it was grabbed.
               */
              (() => {
                const note = scratch.notesById.get(activeDrag.id);
                return note ? (
                  <div ref={overlayCardRef} className="pointer-events-none">
                    {scratch.renderNote(note, {}, { overlay: true })}
                  </div>
                ) : null;
              })()
            ) : activeDrag ? (
              <div className="pointer-events-none rounded-lg border border-indigo-400 bg-white px-3 py-2 text-sm text-gray-800 shadow-2xl shadow-indigo-900/30 dark:bg-gray-800 dark:text-gray-100">
                {activeDragLabel()}
              </div>
            ) : null}
          </DragOverlay>,
          true
        )}
      </DndContext>

      {pendingDeleteOverlay && renderInBodyPortal(pendingDeleteOverlay, true)}
    </>
  );
};

export default OutlineBoard;
