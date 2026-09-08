'use client';

import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  type DragEndEvent,
} from '@dnd-kit/core';
import { ChevronDownIcon, PlusIcon } from '@heroicons/react/20/solid';
import { Bars2Icon, Bars3Icon, CheckIcon, PencilIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';
import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import PointNote from '@/components/PointNote';
import {
  NOTE_POOL_ID,
  notePointContainerId,
  noteSubContainerId,
} from '@/utils/boardDnd';
import { newClientId } from '@/utils/clientId';
import { sortSubPointsByPosition } from '@/utils/subPoints';
import { capitalizeFirstLetter, normalizeCapitalizedTitle } from '@/utils/textNormalization';
import { getSectionStyling } from '@/utils/themeColors';
import { getSectionLabel } from '@lib/sections';

import { DraggableCard, DropZone } from './BoardDragPrimitives';
import { dragIdFor, parseDragId, intoPointDropId, gapDropId, subGapDropId, sectionDropId, resolveOutlineDrop } from './outlineBoardModel';
import { indexScratchNotes } from './outlineBoardNotes';
import { ScratchNotePool, ScratchNoteStrip, SCRATCH_DROP_OVER_CLASS } from './ScratchNoteLayer';
import { useOutlineBoardDrag } from './useOutlineBoardDrag';

import type { ScratchLayerProps } from './outlineBoardTypes';
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
/** Drag attributes carried by scratch cards; persistence stays with their owner. */
export type { DragHandleProps } from './outlineBoardTypes';

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
  const noteIndex = useMemo(() => indexScratchNotes(scratch), [scratch]);
  const notesInContainer = (id: string) => noteIndex.get(id) ?? [];
  const { activeDrag, hoveredDropId, noteSlot, activeNoteHeight, liftedNoteId, overlayCardRef, sensors,
    collisionDetection, keepHandleUnderFinger, onDragStart, onDragMove, onDragOver,
    handleNoteDrop, noteHomeOf, clearActiveDrag, resetNoteDrag, cancelDrag } = useOutlineBoardDrag(points, scratch, notesInContainer);

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
    const subject = parseDragId(String(event.active.id));
    clearActiveDrag();
    const overId = event.over ? String(event.over.id) : null;

    if (subject?.kind === 'note') {
      if (!isReadOnly) handleNoteDrop(subject, event);
      resetNoteDrag();
      return;
    }
    if (isReadOnly) return;
    if (!subject || !overId) return;

    const outline = toOutline(points);
    const transition = resolveOutlineDrop(outline, subject, overId, scratch?.placements);
    if (!transition) return;
    const { next, movedPointTo, placementChanges, subPointMove } = transition;

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
    if (movedPointTo) onOutlinePointMoved?.(subject.id, movedPointTo, next);
    if (subPointMove) {
      onSubPointMoved?.(subject.id, subPointMove.sourcePointId, subPointMove.destinationPointId, subPointMove.section, next);
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


  const isNoteTarget = (containerId: string) => noteSlot !== null && !noteSlot.own && noteSlot.containerId === containerId;
  const noteListProps = { isReadOnly, noteSlot, liftedNoteId, activeNoteHeight, noteHomeOf };
  const renderNoteStrip = ({ containerId, notes, testId }: { containerId: string; notes: ScratchNote[]; testId: string }) => scratch
    ? <ScratchNoteStrip {...noteListProps} scratch={scratch} containerId={containerId} notes={notes} testId={testId} /> : null;

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
    const sorted = sortSubPointsByPosition(point.subPoints);
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
                              notes: notesInContainer(noteSubContainerId(sp.id)),
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
                                notes: notesInContainer(notePointContainerId(point.id)),
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
        onDragCancel={cancelDrag}
        onDragEnd={onDragEnd}
      >
        {scratch ? (
          <div className="space-y-4">
            <ScratchNotePool {...noteListProps} scratch={scratch} notes={notesInContainer(NOTE_POOL_ID)} activeDrag={activeDrag} />
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
