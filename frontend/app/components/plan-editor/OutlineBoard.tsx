'use client';

import {
  DragDropContext,
  Draggable,
  Droppable,
  type DraggableProvided,
  type DraggableProvidedDragHandleProps,
  type DraggableStateSnapshot,
  type DropResult,
  type DroppableProvided,
} from '@hello-pangea/dnd';
import { ChevronDownIcon, PlusIcon } from '@heroicons/react/20/solid';
import { Bars2Icon, Bars3Icon, CheckIcon, PencilIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';
import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import PointNote from '@/components/PointNote';
import { newClientId } from '@/utils/clientId';
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
const DND_TYPE_POINT = 'POINT';
const DND_TYPE_SUBPOINT = 'SUBPOINT';
const DND_TYPE_SCRATCH = 'scratch-note';
const SUBPOINT_DROPPABLE_PREFIX = 'subpoints:';
const SCRATCH_NOTE_POOL_DROPPABLE_ID = 'scratch-note-pool';
const SCRATCH_POINT_DROPPABLE_PREFIX = 'scratch-point:';
const SCRATCH_SUBPOINT_DROPPABLE_PREFIX = 'scratch-subpoint:';
const SCRATCH_DROP_OVER_CLASS = 'ring-1 ring-indigo-300 bg-indigo-50/60 dark:bg-indigo-900/20';

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

const getSubPointDroppableId = (outlinePointId: string) => `${SUBPOINT_DROPPABLE_PREFIX}${outlinePointId}`;

const getOutlinePointIdFromSubPointDroppable = (droppableId: string): string | null =>
  droppableId.startsWith(SUBPOINT_DROPPABLE_PREFIX)
    ? droppableId.slice(SUBPOINT_DROPPABLE_PREFIX.length)
    : null;

const getSubPointDraggableId = (subPointId: string) => `subpoint:${subPointId}`;

const getPointDraggableId = (outlinePointId: string) => `point:${outlinePointId}`;

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

const withSubPointPositions = (subPoints: SubPoint[]): SubPoint[] =>
  subPoints.map((sp, idx) => ({ ...sp, position: (idx + 1) * 1000 }));

const findPointLocation = (
  outline: Record<SectionKey, OutlinePoint[]>,
  outlinePointId: string
): { section: SectionKey; point: OutlinePoint } | null => {
  for (const section of SECTIONS) {
    const point = outline[section.key].find((item) => item.id === outlinePointId);
    if (point) return { section: section.key, point };
  }
  return null;
};

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
  renderNote: (
    note: ScratchNote,
    dragHandleProps: DraggableProvidedDragHandleProps | null | undefined
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

  const moveSubPoint = (
    sourcePointId: string,
    destinationPointId: string,
    sourceIndex: number,
    destinationIndex: number
  ) => {
    if (isReadOnly) return;
    if (sourcePointId === destinationPointId && sourceIndex === destinationIndex) return;

    const sourceLocation = findPointLocation(points, sourcePointId);
    const destinationLocation = findPointLocation(points, destinationPointId);
    if (!sourceLocation || !destinationLocation) return;

    const sourceSubPoints = sortSubPoints(sourceLocation.point.subPoints ?? []);
    const [moved] = sourceSubPoints.splice(sourceIndex, 1);
    if (!moved) return;

    const destinationSubPoints =
      sourcePointId === destinationPointId
        ? sourceSubPoints
        : sortSubPoints(destinationLocation.point.subPoints ?? []);
    destinationSubPoints.splice(destinationIndex, 0, moved);

    const next = SECTIONS.reduce((acc, s) => {
      acc[s.key] = points[s.key].map((p) => {
        if (p.id === sourcePointId && p.id === destinationPointId) {
          return { ...p, subPoints: withSubPointPositions(destinationSubPoints) };
        }
        if (p.id === sourcePointId) {
          return { ...p, subPoints: withSubPointPositions(sourceSubPoints) };
        }
        if (p.id === destinationPointId) {
          return { ...p, subPoints: withSubPointPositions(destinationSubPoints) };
        }
        return p;
      });
      return acc;
    }, {} as Record<SectionKey, OutlinePoint[]>);

    const updatedOutline = toOutline(next);
    onChange(updatedOutline);

    if (sourcePointId !== destinationPointId) {
      onSubPointMoved?.(
        moved.id,
        sourcePointId,
        destinationPointId,
        destinationLocation.section,
        updatedOutline
      );
    }
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

  const onDragEnd = (result: DropResult) => {
    if (isReadOnly) return;
    const { draggableId, source, destination, type } = result;
    if (!destination) return;

    if (type === DND_TYPE_SCRATCH) {
      if (!scratch) return;

      if (destination.droppableId === SCRATCH_NOTE_POOL_DROPPABLE_ID) {
        scratch.onPlace(draggableId, null);
        return;
      }

      const pointId = getScratchPointIdFromDroppable(destination.droppableId);
      if (pointId) {
        scratch.onPlace(draggableId, { pointId });
        return;
      }

      const subPointId = getScratchSubPointIdFromDroppable(destination.droppableId);
      if (!subPointId) return;
      const parentPointId = findParentPointIdForSubPoint(points, subPointId);
      if (!parentPointId) return;
      scratch.onPlace(draggableId, { pointId: parentPointId, subPointId });
      return;
    }

    if (type === DND_TYPE_SUBPOINT) {
      const sourcePointId = getOutlinePointIdFromSubPointDroppable(source.droppableId);
      const destinationPointId = getOutlinePointIdFromSubPointDroppable(destination.droppableId);
      if (!sourcePointId || !destinationPointId) return;
      moveSubPoint(sourcePointId, destinationPointId, source.index, destination.index);
      return;
    }

    if (type !== DND_TYPE_POINT) return;

    if (!isSectionKey(source.droppableId) || !isSectionKey(destination.droppableId)) return;
    const from = source.droppableId;
    const to = destination.droppableId;
    if (from === to && source.index === destination.index) return;

    const next = { ...points };
    let moved: OutlinePoint | undefined;
    if (from === to) {
      const items = Array.from(next[from]);
      [moved] = items.splice(source.index, 1);
      if (!moved) return;
      items.splice(destination.index, 0, moved);
      next[from] = items;
    } else {
      const fromItems = Array.from(next[from]);
      const toItems = Array.from(next[to]);
      [moved] = fromItems.splice(source.index, 1);
      if (!moved) return;
      toItems.splice(destination.index, 0, moved);
      next[from] = fromItems;
      next[to] = toItems;
    }
    const updatedOutline = toOutline(next);
    onChange(updatedOutline);

    if (from !== to && moved) {
      onOutlinePointMoved?.(moved.id, to, updatedOutline);
    }
  };

  const renderScratchNote = (note: ScratchNote, index: number, testId?: string) => {
    if (!scratch) return null;

    return (
      <Draggable
        key={note.id}
        draggableId={note.id}
        index={index}
        isDragDisabled={isReadOnly}
      >
        {(provided, snapshot) => {
          const node = (
            <div
              ref={provided.innerRef}
              {...provided.draggableProps}
              style={provided.draggableProps.style}
              data-testid={testId}
            >
              {scratch.renderNote(note, provided.dragHandleProps)}
            </div>
          );

          return renderInBodyPortal(node, snapshot.isDragging);
        }}
      </Draggable>
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
      <Droppable droppableId={droppableId} type={DND_TYPE_SCRATCH} isDropDisabled={isReadOnly}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            data-testid={testId}
            className={`mt-2 min-h-[44px] rounded-lg border border-dashed border-slate-200 px-2 py-2 transition-all duration-150 dark:border-gray-700 ${
              snapshot.isDraggingOver ? SCRATCH_DROP_OVER_CLASS : ''
            }`}
          >
            {notes.length === 0 ? (
              <div className="flex min-h-[26px] items-center justify-center text-center text-xs italic text-slate-400 dark:text-gray-500">
                {emptyLabel}
              </div>
            ) : (
              <div className="space-y-1.5">
                {notes.map((note, index) => renderScratchNote(note, index, `scratch-placed-note-${note.id}`))}
              </div>
            )}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
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

  const renderScratchPool = () => {
    if (!scratch) return null;
    const poolNotes = getScratchPoolNotes();

    return (
      <section
        data-testid="scratch-note-pool-band"
        className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm shadow-gray-900/5 dark:border-gray-700 dark:bg-gray-900 dark:shadow-black/20"
      >
        {scratch.poolHeader && <div className="mb-3">{scratch.poolHeader}</div>}
        <Droppable
          droppableId={SCRATCH_NOTE_POOL_DROPPABLE_ID}
          type={DND_TYPE_SCRATCH}
          isDropDisabled={isReadOnly}
        >
          {(provided, snapshot) => (
            <div
              ref={provided.innerRef}
              {...provided.droppableProps}
              className={`min-h-[88px] rounded-lg transition-all duration-150 ${
                poolNotes.length > 0 ? 'grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3' : ''
              } ${snapshot.isDraggingOver ? SCRATCH_DROP_OVER_CLASS : ''}`}
            >
              {poolNotes.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-300 px-3 py-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  {scratch.poolEmptyLabel}
                </div>
              ) : (
                poolNotes.map((note, index) => renderScratchNote(note, index))
              )}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
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
      <Droppable
        droppableId={getSubPointDroppableId(point.id)}
        type={DND_TYPE_SUBPOINT}
        isDropDisabled={isReadOnly}
      >
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`ml-7 mr-4 mt-2 mb-2 max-w-[calc(100%-2.75rem)] rounded-lg border-l border-slate-300/80 bg-white/30 py-1.5 pl-3 pr-2 dark:border-blue-100/35 dark:bg-white/[0.07] transition-all duration-150 ${
              snapshot.isDraggingOver ? 'ring-1 ring-indigo-300 bg-indigo-50/60 dark:bg-indigo-900/20' : ''
            }`}
          >
            <div className="min-h-[24px] space-y-0.5">
              {sorted.map((sp, index) => (
                <Draggable
                  key={sp.id}
                  draggableId={getSubPointDraggableId(sp.id)}
                  index={index}
                  isDragDisabled={isReadOnly}
                >
                  {(subProvided, subSnapshot) => {
                    const node = (
                      <div
                        ref={subProvided.innerRef}
                        {...subProvided.draggableProps}
                        style={subProvided.draggableProps.style}
                      >
                        <div
                          className={`group/subpoint rounded-lg px-2 py-1.5 transition-colors hover:bg-slate-100/80 dark:hover:bg-white/10 ${
                            subSnapshot.isDragging ? 'bg-white dark:bg-slate-800 shadow-lg ring-1 ring-blue-400/50' : ''
                          }`}
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            {!isReadOnly && subProvided.dragHandleProps ? (
                              <div
                                {...subProvided.dragHandleProps}
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
                    );

                    return renderInBodyPortal(node, subSnapshot.isDragging);
                  }}
                </Draggable>
              ))}
              {provided.placeholder}
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
        )}
      </Droppable>
    );
  };

  const renderColumn = (section: SectionKey, styleKey: 'introduction' | 'mainPart' | 'conclusion') => {
    const colPoints = points[section];
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

        <Droppable droppableId={section} type={DND_TYPE_POINT}>
          {(provided: DroppableProvided) => (
            <ul
              {...provided.droppableProps}
              ref={provided.innerRef}
              className="flex-1 overflow-y-auto p-2.5 space-y-2 min-h-[60px]"
            >
              {colPoints.map((point, index) => (
                <Draggable key={point.id} draggableId={getPointDraggableId(point.id)} index={index} isDragDisabled={isReadOnly}>
                  {(dp: DraggableProvided, snapshot: DraggableStateSnapshot) => {
                    const node = (
                      <li
                        ref={dp.innerRef}
                        {...dp.draggableProps}
                        className={`group rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm ${snapshot.isDragging ? 'ring-1 ring-indigo-300 shadow-lg' : ''}`}
                        style={dp.draggableProps.style}
                      >
                        <div className="flex items-start gap-1.5 p-2">
                          <div
                            {...dp.dragHandleProps}
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
                    );

                    return renderInBodyPortal(node, snapshot.isDragging);
                  }}
                </Draggable>
              ))}
              {provided.placeholder}
            </ul>
          )}
        </Droppable>

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
      <DragDropContext onDragEnd={onDragEnd}>
        {scratch ? (
          <div className="space-y-4">
            {renderScratchPool()}
            {boardColumns}
          </div>
        ) : (
          boardColumns
        )}
      </DragDropContext>

      {pendingDeleteOverlay && renderInBodyPortal(pendingDeleteOverlay, true)}
    </>
  );
};

export default OutlineBoard;
