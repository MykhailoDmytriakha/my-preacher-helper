'use client';

import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  KeyboardSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { ChevronDownIcon, PlusIcon } from '@heroicons/react/20/solid';
import { Bars2Icon, Bars3Icon, CheckIcon, PencilIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';
import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import PointNote from '@/components/PointNote';
import {
  allowedCollisions,
  isDropTargetEnabled,
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

type SectionKey = 'introduction' | 'main' | 'conclusion';

const SECTIONS: { key: SectionKey; styleKey: 'introduction' | 'mainPart' | 'conclusion' }[] = [
  { key: 'introduction', styleKey: 'introduction' },
  { key: 'main', styleKey: 'mainPart' },
  { key: 'conclusion', styleKey: 'conclusion' },
];

const CANCEL_KEY = 'common.cancel';
const SAVE_KEY = 'common.save';
const DELETE_KEY = 'common.delete';
const SCRATCH_NOTE_POOL_DROPPABLE_ID = 'scratch-note-pool';
const SCRATCH_POINT_DROPPABLE_PREFIX = 'scratch-point:';
const SCRATCH_SUBPOINT_DROPPABLE_PREFIX = 'scratch-subpoint:';
const SCRATCH_DROP_OVER_CLASS = 'ring-1 ring-indigo-300 bg-indigo-50/60 dark:bg-indigo-900/20';

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
 */
const DRAG_POINT = 'point:';
const DRAG_SUB = 'sub:';
const DRAG_NOTE = 'note:';
const DROP_INTO_POINT = 'into-point:';
const DROP_GAP = 'gap:';
const DROP_SUB_GAP = 'subgap:';
const DROP_NOTE_GAP = 'notegap:';
const DROP_SECTION = 'section:';

/** Whatever the drag library needs on the grab handle — the note card only spreads it. */
export type DragHandleProps = Record<string, unknown>;

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

/**
 * The seam between two notes filed on the same row.
 *
 * The container is itself an id with colons in it ('scratch-point:p1'), so the
 * index is separated by a double colon — otherwise the parser has to guess where
 * the container ends.
 */
const noteGapDropId = (containerId: string, index: number) => `${DROP_NOTE_GAP}${containerId}::${index}`;

const parseNoteGapDropId = (raw: string): { containerId: string; index: number } | null => {
  if (!raw.startsWith(DROP_NOTE_GAP)) return null;
  const at = raw.lastIndexOf('::');
  if (at < 0) return null;
  return { containerId: raw.slice(DROP_NOTE_GAP.length, at), index: Number(raw.slice(at + 2)) };
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

const getScratchPointDroppableId = (pointId: string) => `${SCRATCH_POINT_DROPPABLE_PREFIX}${pointId}`;

const getScratchSubPointDroppableId = (subPointId: string) => `${SCRATCH_SUBPOINT_DROPPABLE_PREFIX}${subPointId}`;

const getScratchPointIdFromDroppable = (droppableId: string): string | null =>
  droppableId.startsWith(SCRATCH_POINT_DROPPABLE_PREFIX)
    ? droppableId.slice(SCRATCH_POINT_DROPPABLE_PREFIX.length)
    : null;

const getScratchSubPointIdFromDroppable = (droppableId: string): string | null =>
  droppableId.startsWith(SCRATCH_SUBPOINT_DROPPABLE_PREFIX)
    ? droppableId.slice(SCRATCH_SUBPOINT_DROPPABLE_PREFIX.length)
    : null;

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

type ScratchLayerProps = {
  pool: ScratchNote[];
  notesById: Map<string, ScratchNote>;
  placements: Record<string, { pointId: string; subPointId?: string }>;
  onPlace: (noteId: string, target: { pointId: string; subPointId?: string } | null) => void;
  /** Reorder notes that share one row: which of them comes first. */
  onReorder?: (noteId: string, groupIds: string[], targetIndex: number) => void;
  renderNote: (
    note: ScratchNote,
    dragHandleProps: DragHandleProps
  ) => React.ReactNode;
  poolHeader?: React.ReactNode;
  poolEmptyLabel?: string;
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
  /** Which target the pointer is over right now — for feedback the zones cannot show themselves. */
  const [hoveredDropId, setHoveredDropId] = useState<string | null>(null);
  /**
   * A drag starts only after the pointer has travelled a few pixels, so a tap on
   * the handle still counts as a click and the card can be renamed or deleted
   * without the board thinking a move began.
   */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );
  const onDragStart = (event: DragStartEvent) => {
    setActiveDrag(parseDragId(String(event.active.id)));
    setHoveredDropId(null);
  };

  const onDragOver = (event: DragOverEvent) => {
    setHoveredDropId(event.over ? String(event.over.id) : null);
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

  /**
   * ONE DROP, READ AS A SENTENCE.
   *
   * Every drop target says what it means — a card means "inside me", a gap means
   * "beside me here" — so this handler only has to name the pairing and hand it
   * to the pure move in `outlineDnd`. All the index arithmetic and the two-level
   * rule live there, where they are tested without a browser.
   */
  const onDragEnd = (event: DragEndEvent) => {
    setActiveDrag(null);
    setHoveredDropId(null);
    if (isReadOnly) return;
    const subject = parseDragId(String(event.active.id));
    const overId = event.over ? String(event.over.id) : null;
    if (!subject || !overId) return;

    // --- a scratch note is filed against a point, a sub-point, or back to the pool
    if (subject.kind === 'note') {
      if (!scratch) return;

      /*
       * A SEAM BETWEEN TWO NOTES SAYS WHICH ONE COMES FIRST.
       *
       * Notes sharing a row had no seams at all, so the only target inside a row
       * was the row itself — and dropping a note where it already lives means
       * nothing changed. "Наброски не могу поменять местами внутри подпункта."
       * The seam carries both halves of the intention: which row it belongs to,
       * and where among its neighbours it sits.
       */
      const noteGap = parseNoteGapDropId(overId);
      if (noteGap) {
        const { containerId, index } = noteGap;
        const target = containerId === SCRATCH_NOTE_POOL_DROPPABLE_ID
          ? null
          : (() => {
              const pointId = getScratchPointIdFromDroppable(containerId);
              if (pointId) return { pointId };
              const subPointId = getScratchSubPointIdFromDroppable(containerId);
              if (!subPointId) return undefined;
              const parentPointId = findParentPointIdForSubPoint(points, subPointId);
              return parentPointId ? { pointId: parentPointId, subPointId } : undefined;
            })();
        if (target === undefined) return;

        const groupIds = notesInContainer(containerId).map((note) => note.id);
        scratch.onPlace(subject.id, target);
        scratch.onReorder?.(subject.id, groupIds, index);
        return;
      }

      if (overId === SCRATCH_NOTE_POOL_DROPPABLE_ID) {
        scratch.onPlace(subject.id, null);
        return;
      }
      const pointId = getScratchPointIdFromDroppable(overId) ?? (overId.startsWith(DROP_INTO_POINT)
        ? overId.slice(DROP_INTO_POINT.length)
        : null);
      if (pointId) {
        scratch.onPlace(subject.id, { pointId });
        return;
      }
      const subPointId = getScratchSubPointIdFromDroppable(overId);
      if (!subPointId) return;
      const parentPointId = findParentPointIdForSubPoint(points, subPointId);
      if (!parentPointId) return;
      scratch.onPlace(subject.id, { pointId: parentPointId, subPointId });
      return;
    }

    const outline = toOutline(points);
    let next: SermonOutline | null = null;
    let movedPointTo: SectionKey | null = null;
    /*
     * A structural move does not change any id, but it changes what an id MEANS —
     * `pt-a` as a point and `pt-a` as a sub-point are addressed differently. Notes
     * are found through those addresses, so a move that leaves them untranslated
     * makes a note vanish from the screen while still sitting in the document.
     * That is what the owner hit: "I attached a note to a point, moved the point,
     * the note is gone."
     */
    let placementChanges: { noteId: string; placement: { pointId: string; subPointId?: string } }[] = [];

    if (subject.kind === 'point') {
      if (overId.startsWith(DROP_INTO_POINT)) {
        // Dropped ON a card — the point becomes its sub-point (children follow).
        const newParentId = overId.slice(DROP_INTO_POINT.length);
        const formerChildren = (SECTIONS.flatMap((sec) => points[sec.key]).find((p) => p.id === subject.id)?.subPoints ?? []).map((sp) => sp.id);
        next = nestPointUnderPoint(outline, subject.id, newParentId);
        placementChanges = remapAfterNest(scratch?.placements ?? {}, subject.id, newParentId, formerChildren);
      } else if (parseSubGapDropId(overId)) {
        /*
         * A seam BETWEEN sub-points is a real intention: "put this point under
         * that one, right here". The board drew the line for it and then did
         * nothing, because this branch only understood seams between points —
         * so every drop above or below a sub-point silently did nothing.
         */
        const subGap = parseSubGapDropId(overId)!;
        const formerChildren = (SECTIONS.flatMap((sec) => points[sec.key]).find((p) => p.id === subject.id)?.subPoints ?? []).map((sp) => sp.id);
        next = nestPointUnderPointAt(outline, subject.id, subGap.pointId, subGap.index);
        placementChanges = remapAfterNest(scratch?.placements ?? {}, subject.id, subGap.pointId, formerChildren);
      } else {
        const gap = parseGapDropId(overId);
        const section = gap?.section ?? (overId.startsWith(DROP_SECTION) && isSectionKey(overId.slice(DROP_SECTION.length))
          ? (overId.slice(DROP_SECTION.length) as SectionKey)
          : null);
        if (!section) return;
        const index = gap ? gap.index : (points[section]?.length ?? 0);
        if (findPointSection(outline, subject.id) !== section) movedPointTo = section;
        next = movePoint(outline, subject.id, section, index);
      }
    }

    if (subject.kind === 'sub') {
      if (overId.startsWith(DROP_INTO_POINT)) {
        const targetPointId = overId.slice(DROP_INTO_POINT.length);
        // Onto a card: land at the end of that card's children.
        next = moveSubPointInOutline(outline, subject.id, targetPointId, Number.MAX_SAFE_INTEGER);
        placementChanges = remapAfterSubPointReparent(scratch?.placements ?? {}, subject.id, targetPointId);
      } else {
        const subGap = parseSubGapDropId(overId);
        if (subGap) {
          next = moveSubPointInOutline(outline, subject.id, subGap.pointId, subGap.index);
        } else {
          // A gap between POINTS means "leave your parent" — the sub-point is promoted.
          const gap = parseGapDropId(overId);
          const section = gap?.section ?? (overId.startsWith(DROP_SECTION) && isSectionKey(overId.slice(DROP_SECTION.length))
            ? (overId.slice(DROP_SECTION.length) as SectionKey)
            : null);
          if (!section) return;
          const index = gap ? gap.index : (points[section]?.length ?? 0);
          const formerParent = findSubPointParent(outline, subject.id)?.point.id;
          next = outdentSubPoint(outline, subject.id, section, index);
          movedPointTo = section;
          if (formerParent) {
            placementChanges = remapAfterOutdent(scratch?.placements ?? {}, subject.id, formerParent);
          }
        }
      }
    }

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
      render={({ setNodeRef, isOver, isCandidate }) => (
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
              isOver ? 'bg-indigo-500' : 'bg-transparent'
            }`}
          />
          <span
            className={`pointer-events-none absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full transition-colors ${
              indented ? 'left-0' : '-left-1'
            } ${isOver ? 'bg-indigo-500' : 'bg-transparent'}`}
          />
        </div>
      )}
    />
  );

  const renderScratchNote = (note: ScratchNote, index: number, testId?: string) => {
    if (!scratch) return null;

    return (
      <DraggableCard key={note.id} dragId={dragIdFor('note', note.id)} disabled={isReadOnly}>
        {({ setNodeRef, handleProps, isDragging }) => (
          <div ref={setNodeRef} data-testid={testId} className={isDragging ? 'opacity-50' : ''}>
            {scratch.renderNote(note, handleProps as DragHandleProps)}
          </div>
        )}
      </DraggableCard>
    );
  };

  const renderScratchDropStrip = ({
    droppableId,
    notes,
    emptyLabel,
    testId,
  }: {
    droppableId: string;
    notes: ScratchNote[];
    emptyLabel: string;
    testId: string;
  }) => {
    if (!scratch) return null;

    return (
      <DropZone
        dropId={droppableId}
        disabled={isReadOnly}
        activeKind={activeDrag?.kind ?? null}
        render={({ setNodeRef, isOver, isCandidate }) => {
          /*
           * AN EMPTY INVITATION IS ONLY SHOWN WHEN IT CAN BE ACCEPTED.
           *
           * "Drag a note onto this point" used to sit under every point at all
           * times — a dashed rectangle per card, taking more room than the plan
           * itself and lighting up during drags that could never land there. It
           * now appears only while a note is actually in the air; once notes are
           * filed here it stays, because then it is content, not an invitation.
           */
          /*
           * KEEP THE SPACE, CHANGE ONLY THE PAINT.
           *
           * Collapsing this strip when it is not a target made the whole card
           * change height the instant a drag began — the "everything jumped"
           * report. Atlassian's guidance is the opposite and it is right: while
           * dragging, the layout must not move; the original stays put and only
           * dims. So the strip keeps its box and merely goes quiet when empty.
           */
          if (notes.length === 0 && !isCandidate) {
            return (
              <div
                ref={setNodeRef}
                data-testid={testId}
                className="mt-1.5 min-h-[32px] rounded-lg border border-dashed border-transparent px-2 py-1"
              />
            );
          }

          return (
            <div
              ref={setNodeRef}
              data-testid={testId}
              className={`mt-1.5 min-h-[32px] rounded-lg border border-dashed px-2 py-1 transition-all duration-150 ${
                isOver
                  ? SCRATCH_DROP_OVER_CLASS + ' border-indigo-400'
                  : isCandidate
                    ? 'border-indigo-300/70 dark:border-indigo-500/40'
                    : 'border-slate-200 dark:border-gray-700'
              }`}
            >
              {notes.length === 0 ? (
                /*
                 * ONE ZONE SPEAKS, THE REST STAY QUIET.
                 *
                 * Every point can accept a note, so lifting one used to put
                 * "drop a note on this point" under all of them at once — five
                 * sentences competing for the eye while the answer is wherever
                 * the pointer is. The empty candidates keep only their dashed
                 * outline; the words appear on the one being hovered, as
                 * confirmation rather than instruction.
                 */
                <div className="flex min-h-[22px] items-center justify-center text-center text-xs italic text-slate-400 dark:text-gray-500">
                  {isOver ? emptyLabel : ''}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {notes.map((note, index) => (
                    <React.Fragment key={note.id}>
                      {renderDropGap(noteGapDropId(droppableId, index), true)}
                      {renderScratchNote(note, index, `scratch-placed-note-${note.id}`)}
                    </React.Fragment>
                  ))}
                  {renderDropGap(noteGapDropId(droppableId, notes.length), true)}
                </div>
              )}
            </div>
          );
        }}
      />
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

  /** The notes a given strip shows — the neighbours a reorder is measured against. */
  const notesInContainer = (containerId: string) => {
    if (containerId === SCRATCH_NOTE_POOL_DROPPABLE_ID) return getScratchPoolNotes();
    const pointId = getScratchPointIdFromDroppable(containerId);
    if (pointId) return getScratchPointNotes(pointId);
    const subPointId = getScratchSubPointIdFromDroppable(containerId);
    return subPointId ? getScratchSubPointNotes(subPointId) : [];
  };

  /**
   * The pool's seam is VERTICAL, because the pool is a grid.
   *
   * A horizontal line between rows would lie about where the card lands when the
   * cards flow left to right and wrap. So the seam stands at a card's leading
   * edge and means "before this one"; the trailing edge of the last card means
   * "at the end". Only one seam per card, or two neighbours would claim the same
   * index and the library would see a duplicate id.
   *
   * It is `pointer-events-none` on purpose: collision is decided by geometry, so
   * the strip can be invisible to clicks and still be a target — the edit and
   * delete buttons underneath keep working.
   */
  const renderPoolSeam = (index: number, side: 'left' | 'right') => (
    <DropZone
      dropId={noteGapDropId(SCRATCH_NOTE_POOL_DROPPABLE_ID, index)}
      disabled={isReadOnly}
      activeKind={activeDrag?.kind ?? null}
      render={({ setNodeRef, isOver }) => (
        <div
          ref={setNodeRef}
          aria-hidden="true"
          className={`pointer-events-none absolute inset-y-0 w-6 ${side === 'left' ? '-left-3' : '-right-3'}`}
        >
          <span
            className={`absolute inset-y-2 left-1/2 w-0.5 -translate-x-1/2 rounded-full transition-colors ${
              isOver ? 'bg-indigo-500' : 'bg-transparent'
            }`}
          />
          <span
            className={`absolute left-1/2 top-1 h-2 w-2 -translate-x-1/2 rounded-full transition-colors ${
              isOver ? 'bg-indigo-500' : 'bg-transparent'
            }`}
          />
        </div>
      )}
    />
  );

  const renderScratchPool = () => {
    if (!scratch) return null;
    const poolNotes = getScratchPoolNotes();

    return (
      <section
        data-testid="scratch-note-pool-band"
        className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm shadow-gray-900/5 dark:border-gray-700 dark:bg-gray-900 dark:shadow-black/20"
      >
        {scratch.poolHeader && <div className="mb-3">{scratch.poolHeader}</div>}
        <DropZone
          dropId={SCRATCH_NOTE_POOL_DROPPABLE_ID}
          disabled={isReadOnly}
          activeKind={activeDrag?.kind ?? null}
          render={({ setNodeRef, isOver }) => (
            <div
              ref={setNodeRef}
              className={`min-h-[88px] rounded-lg transition-all duration-150 ${
                poolNotes.length > 0 ? 'grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3' : ''
              } ${isOver ? SCRATCH_DROP_OVER_CLASS : ''}`}
            >
              {poolNotes.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-300 px-3 py-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  {scratch.poolEmptyLabel}
                </div>
              ) : (
                poolNotes.map((note, index) => (
                  <div key={note.id} className="relative">
                    {renderScratchNote(note, index)}
                    {renderPoolSeam(index, 'left')}
                    {index === poolNotes.length - 1 && renderPoolSeam(poolNotes.length, 'right')}
                  </div>
                ))
              )}
            </div>
          )}
        />
      </section>
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
                      <div ref={setNodeRef}>
                        {/*
                          * A row must be readable as its own object WITHOUT being touched.
                          * These rows used to be bare text on the parent's fill, with an
                          * outline appearing only on hover — so at rest one could not tell
                          * where one sub-point ended and the next began. The surface is
                          * permanent now; hover only brightens what is already there.
                          */}
                        <div
                          className={`group/subpoint rounded-lg border px-2 py-1.5 transition-colors ${
                            isDragging
                              ? 'border-blue-400/50 bg-white shadow-lg ring-1 ring-blue-400/50 opacity-60 dark:bg-slate-800'
                              : 'border-slate-200/90 bg-white shadow-sm hover:border-slate-300 dark:border-white/[0.14] dark:bg-white/[0.11] dark:hover:border-white/25 dark:hover:bg-white/[0.16]'
                          }`}
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            {!isReadOnly ? (
                              <div
                                {...handleProps}
                                className="cursor-grab flex-shrink-0 w-4 flex items-center justify-center touch-manipulation"
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
                            />
                          )}
                          {scratch &&
                            renderScratchDropStrip({
                              droppableId: getScratchSubPointDroppableId(sp.id),
                              testId: `scratch-subpoint-drop-zone-${sp.id}`,
                              notes: getScratchSubPointNotes(sp.id),
                              emptyLabel: t('scratch.board.dropHereSubPoint'),
                            })}
                        </div>
                      </div>
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
                      <li
                        ref={setCardRef}
                        /*
                         * The original never moves and never changes shape while it
                         * is being dragged — it dims to 40%, which is the documented
                         * convention and the only one that keeps the board still.
                         * "Combine" targets say so with a filled background plus an
                         * outline, not a hairline border nobody can see.
                         */
                        className={`group relative rounded-lg border bg-white dark:bg-gray-800 shadow-sm transition-colors ${
                          isDragging ? 'opacity-40 border-slate-200 dark:border-gray-700' : 'border-slate-200 dark:border-gray-700'
                        } ${
                          isIntoTarget
                            ? 'outline outline-2 outline-indigo-500 border-indigo-400 bg-indigo-50 dark:bg-indigo-950/40'
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
                            className={`mt-0.5 text-gray-400 dark:text-gray-500 ${isReadOnly ? 'cursor-not-allowed opacity-50' : 'cursor-grab hover:text-gray-600 dark:hover:text-gray-300'}`}
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

                              {showNotes && (
                                <PointNote
                                  note={point.note}
                                  onChange={(n) => mutatePoint(point.id, (p) => ({ ...p, note: n }))}
                                  isReadOnly={isReadOnly}
                                  indentClass="ml-6"
                                  addRevealClass="opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
                                  tone={scratch ? 'neutral' : 'note'}
                                />
                              )}
                              {scratch &&
                                renderScratchDropStrip({
                                  droppableId: getScratchPointDroppableId(point.id),
                                  testId: `scratch-point-drop-zone-${point.id}`,
                                  notes: getScratchPointNotes(point.id),
                                  emptyLabel: t('scratch.board.dropHerePoint'),
                                })}
                              {!collapsedPoints[point.id] && renderSubPoints(point)}
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
                      </li>
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
        collisionDetection={(args) => allowedCollisions(parseDragId(String(args.active.id))?.kind ?? null, pointerWithin(args))}
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
        onDragOver={onDragOver}
        onDragCancel={() => {
          setActiveDrag(null);
          setHoveredDropId(null);
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
          <DragOverlay dropAnimation={null}>
            {activeDrag ? (
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
