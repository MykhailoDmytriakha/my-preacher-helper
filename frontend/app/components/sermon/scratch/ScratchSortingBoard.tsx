"use client";

import { defaultDropAnimationSideEffects, DndContext, DragOverlay, MouseSensor, pointerWithin, rectIntersection, TouchSensor, useDroppable, useSensor, useSensors, type CollisionDetection, type DragEndEvent, type DragMoveEvent, type DragOverEvent, type DragStartEvent, type DropAnimation } from '@dnd-kit/core';
import { Dialog, DialogPanel, DialogTitle, Popover, PopoverButton, PopoverPanel } from '@headlessui/react';
import { ChevronDoubleLeftIcon, ChevronDoubleRightIcon, MicrophoneIcon, PencilIcon, PencilSquareIcon, PlusIcon, QuestionMarkCircleIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import hoverActions from '@/components/ui/HoverActions.module.css';
import { useConfirm } from '@/hooks/useConfirm';
import { useDndKitAccessibility } from '@/hooks/useDragAnnouncements';
import { recordDiagnostic } from '@/utils/appDiagnostics';
import { resolveNoteSlot, type Point } from '@/utils/boardDnd';
import { deviceChoice } from '@/utils/deviceChoice';
import { SECTION_KEYS, type SectionKey } from '@/utils/outlineDnd';
import { materializedNoteId, outlineNoteSketches, outlineNoteTargetOf, placeScratchNotes, POOL_PLACE, sameScratchPlace, scratchPlaceOf, sortScratch, type ScratchPlace } from '@/utils/scratchPlacement';
import { SERMON_SECTION_COLORS } from '@/utils/themeColors';
import { getSectionLabel } from '@lib/sections';
import { useTranslation } from '@locales/useTranslation';

import ScratchSketchCard, { noteDropId, type ScratchMoveTarget } from './ScratchSketchCard';

import type { ScratchNote, SermonOutline } from '@/models/models';
import type { OutlineNoteTarget } from '@/utils/sermonNoteText';

/** The parts' colours, the same as on the structure page; literal classes so Tailwind compiles them. */
/** Each part's colour; `radioOn` / `radioOff` are its pill in «which part?», chosen and not chosen. */
const SECTION_LOOK: Record<SectionKey, { bar: string; title: string; tint: string; dot: string; radioOn: string; radioOff: string }> = {
  introduction: { bar: SERMON_SECTION_COLORS.introduction.base, title: 'text-amber-800 dark:text-amber-200', tint: 'bg-amber-50/50 dark:bg-amber-900/10', dot: 'bg-amber-600', radioOn: 'border-amber-600 bg-amber-600 text-white shadow-sm', radioOff: 'border-amber-200 bg-amber-50 text-amber-800 hover:border-amber-300 hover:bg-amber-100 dark:border-amber-800/60 dark:bg-amber-900/20 dark:text-amber-200 dark:hover:bg-amber-900/40' },
  main: { bar: SERMON_SECTION_COLORS.mainPart.base, title: 'text-blue-800 dark:text-blue-200', tint: 'bg-blue-50/50 dark:bg-blue-900/10', dot: 'bg-blue-600', radioOn: 'border-blue-600 bg-blue-600 text-white shadow-sm', radioOff: 'border-blue-200 bg-blue-50 text-blue-800 hover:border-blue-300 hover:bg-blue-100 dark:border-blue-800/60 dark:bg-blue-900/20 dark:text-blue-200 dark:hover:bg-blue-900/40' },
  conclusion: { bar: SERMON_SECTION_COLORS.conclusion.base, title: 'text-green-800 dark:text-green-200', tint: 'bg-green-50/50 dark:bg-green-900/10', dot: 'bg-green-600', radioOn: 'border-green-600 bg-green-600 text-white shadow-sm', radioOff: 'border-green-200 bg-green-50 text-green-800 hover:border-green-300 hover:bg-green-100 dark:border-green-800/60 dark:bg-green-900/20 dark:text-green-200 dark:hover:bg-green-900/40' },
};
const WIDE = '(min-width: 768px)';
/** Where a note in the hand would land: the place, the card it goes before (none: the end), and the card the line stands by. */
type Aim = { place: ScratchPlace; label: string; beforeId?: string; anchorId: string | null; side: 'before' | 'after' };
const NOTE_COUNT_KEY = 'scratch.capture.countReady';
/** The whole card is the handle; its buttons, links and fields keep their own job. */
const NOT_A_HANDLE = 'button, a, input, textarea, select, label, [contenteditable="true"], [role="menu"]';
const canTake = (target: EventTarget | null) => !(target instanceof Element && target.closest(NOT_A_HANDLE));
class CardMouseSensor extends MouseSensor {
  static activators = [{ eventName: 'onMouseDown' as const, handler: ({ nativeEvent }: React.MouseEvent) => nativeEvent.button === 0 && canTake(nativeEvent.target) }];
}
class CardTouchSensor extends TouchSensor {
  static activators = [{ eventName: 'onTouchStart' as const, handler: ({ nativeEvent }: React.TouchEvent) => canTake(nativeEvent.target) }];
}
/** The lifted card settles into its new place instead of vanishing. */
const DROP_ANIMATION: DropAnimation = { duration: 220, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: '0.4' } } }) };
/** On localhost every take, hover and drop is written to the console, so a failed move can be read back. */
const journal = (...entry: unknown[]) => { if (process.env.NODE_ENV !== 'production') console.info('[scratch-dnd]', ...entry); };
/** Zones nest (part → point → sub-point): the smallest one under the finger is where the note lands. */
const innermostZone: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  if (!hits.length) return rectIntersection(args);
  const area = (id: string | number) => { const rect = args.droppableRects.get(id); return rect ? rect.width * rect.height : Number.POSITIVE_INFINITY; };
  return [...hits].sort((a, b) => area(a.id) - area(b.id));
};
const placeKey = (place: ScratchPlace) => place.section ? `${place.section}:${place.pointId ?? ''}:${place.subPointId ?? ''}` : 'pool';
const PRIMARY = 'inline-flex items-center justify-center rounded-lg bg-violet-600 px-3 text-sm font-semibold text-white transition-colors hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-violet-500 dark:hover:bg-violet-400';
const SECONDARY = 'inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700';
const INPUT = 'min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 text-base text-gray-900 placeholder-gray-400 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200 md:text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:focus:ring-violet-900/50';

interface ScratchSortingBoardProps {
  notes: ScratchNote[];
  outline?: SermonOutline;
  /** Recording and «Написать набросок» — they open the pool, on every width. */
  capture: React.ReactNode;
  isReadOnly: boolean;
  /** A note's words cannot be edited or deleted yet (a write not yet kept on the device); moving still can. */
  isNoteLocked?: boolean;
  /** A point a thought hangs on is not removed from here; the structure page owns that. */
  pointThoughtCount: (pointId: string) => number;
  /** The note's words; each new `editSignal` opens them for editing. */
  renderText: (note: ScratchNote, editSignal: number, onEditingChange: (editing: boolean) => void) => React.ReactNode;
  onDelete: (noteId: string) => void;
  onPlace: (noteIds: string[], place: ScratchPlace, beforeId?: string) => void;
  onCreatePoint: (section: SectionKey, title: string, noteIds: string[]) => void;
  onAddPoint: (section: SectionKey, title: string) => void;
  onAddSubPoint: (pointId: string, title: string) => void;
  onRemovePoint: (pointId: string) => void;
  onRenameTitle: (target: OutlineNoteTarget, title: string) => void;
  onRemoveSubPoint: (subPointId: string) => void;
  /**
   * After opening the pool from the right rail, start recording or open the manual note field in `capture`.
   */
  onRailCapture?: (kind: 'voice' | 'write') => void;
  /** Keep the pool open during recording, transcription, or while recovery controls are shown. */
  captureBusy?: boolean;
  /** Why the rail's microphone cannot record now (voice notes unavailable); nothing — it can. */
  railVoiceUnavailable?: string | null;
}

/**
 * Whether the pool beside the plan is folded into a rail, kept on this device (`utils/deviceChoice.ts`): folded once,
 * it stays folded for every sermon here until shown again. A phone does not use it — there the pool is a tab.
 */
const poolPanelChoice = deviceChoice<{ folded: boolean }>({
  key: 'scratch:poolPanel',
  parse: (raw) => {
    try {
      return { folded: Boolean(raw && (JSON.parse(raw) as { folded?: unknown }).folded === true) };
    } catch {
      return { folded: false };
    }
  },
  fallback: { folded: false },
});

/** Tests start from a pool that is shown: clearing storage alone leaves the choice the page already holds. */
export const resetPoolPanelForTests = () => poolPanelChoice.resetForTests();

type Sheet = { kind: 'move' | 'group'; ids: string[] } | null;
interface LastMove { words: string; back: { ids: string[]; place: ScratchPlace }[] }

/** With a mouse a title's buttons appear while its row is pointed at or focused by a key; touch screens keep them. */


/** A point's or sub-point's title in place: Enter or «Сохранить» keeps it, Escape or «Отмена» leaves it as it was. */
function TitleEditor({ initial, label, onSave, onCancel, saveLabel, cancelLabel }: {
  initial: string; label: string; onSave: (text: string) => void; onCancel: () => void; saveLabel: string; cancelLabel: string;
}) {
  const [text, setText] = useState(initial);
  const save = () => { if (text.trim() && text.trim() !== initial.trim()) onSave(text); else onCancel(); };
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      <input type="text" aria-label={label} value={text} autoFocus onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); save(); } if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel(); } }}
        className={`${INPUT} h-11 min-w-[10rem] md:h-9`} />
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className={`${SECONDARY} h-11 md:h-9`}>{cancelLabel}</button>
        <button type="button" onClick={save} disabled={!text.trim()} className={`${PRIMARY} h-11 md:h-9`}>{saveLabel}</button>
      </div>
    </div>
  );
}

/** A spot to land: shown softly while a note is in the hand, clearly while the hand is over it. */
function DropZone({ id, className, activeClass, readyClass = '', children, ariaLabel, style, dragActive }: {
  id: string; className: string; activeClass: string; readyClass?: string; children: React.ReactNode; ariaLabel?: string; style?: React.CSSProperties; dragActive: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return <div ref={setNodeRef} aria-label={ariaLabel} style={style}
    className={`${className} transition-[box-shadow,background-color] duration-150 ${isOver ? activeClass : dragActive ? readyClass : ''}`}>{children}</div>;
}

/**
 * FROM RAW NOTES TO A PLAN (owner's choice «Сначала группы», 2026-11-19).
 *
 * The plan reads top to bottom, the way the sermon sounds; the pool stands on its right and folds into a
 * narrow rail when the plan needs the room (owner's choice «Справа», 2026-11-20). The main gesture: tick a few
 * notes about one thing and collect them into a new point.
 * A note can also be dragged, or moved with «Переместить в…». Every move is saved at once and the
 * note stays a piece of its own (`utils/scratchPlacement.ts`). Inside each part, notes without a
 * point come first. A phone gets two tabs, a bar at the bottom and choices from below.
 */
export default function ScratchSortingBoard({
  notes, outline, capture, isReadOnly, isNoteLocked = false, pointThoughtCount, renderText, onDelete,
  onPlace, onCreatePoint, onAddPoint, onAddSubPoint, onRemovePoint, onRenameTitle, onRemoveSubPoint, onRailCapture,
  captureBusy = false, railVoiceUnavailable = null,
}: ScratchSortingBoardProps) {
  const { t } = useTranslation();
  const { confirm, confirmDialog } = useConfirm();
  const [tab, setTab] = useState<'pool' | 'plan'>('pool');
  const [selected, setSelected] = useState<string[]>([]);
  const [drag, setDrag] = useState<{ id: string; folded: boolean } | null>(null);
  const dragging = drag?.id ?? null;
  const { folded: poolFolded } = poolPanelChoice.useChoice();
  // Active capture and selected notes normally keep the pool open.
  // During a drag, keep its starting width so the drop targets stay in place.
  const poolBusy = selected.length > 0 || captureBusy;
  const folded = drag?.folded ?? (poolFolded && !poolBusy);
  const foldPool = useCallback((next: boolean) => {
    const saved = poolPanelChoice.save({ folded: next });
    // Storage that refused it or read back something else says so (`.howto/keep-a-device-choice.md`).
    if (saved !== 'kept') recordDiagnostic('setting', { source: 'board', code: 'scratchPool-folded', result: `${next ? 'on' : 'off'}-${saved}` });
  }, []);
  // The button pressed goes away with the form it belonged to; the keyboard lands on its pair, not on the page.
  const showPoolRef = useRef<HTMLButtonElement>(null);
  const hidePoolRef = useRef<HTMLButtonElement>(null);
  const poolHeadingRef = useRef<HTMLHeadingElement>(null);
  const focusAfterFold = useRef<'show' | 'hide' | 'heading' | null>(null);
  useEffect(() => {
    const target = focusAfterFold.current;
    if (target === 'heading' && (folded || tab !== 'pool')) return;
    focusAfterFold.current = null;
    if (target === 'show') showPoolRef.current?.focus();
    if (target === 'hide') hidePoolRef.current?.focus();
    if (target === 'heading') poolHeadingRef.current?.focus();
  }, [folded, tab]);
  const openFromRail = () => {
    setTab('pool');
    foldPool(false);
  };
  const startFromRail = (kind: 'voice' | 'write') => {
    if (kind === 'voice') focusAfterFold.current = 'heading';
    openFromRail();
    onRailCapture?.(kind);
  };
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [sheet, setSheet] = useState<Sheet>(null);
  const [grouping, setGrouping] = useState(false);
  const [groupTitle, setGroupTitle] = useState('');
  /** No part is chosen for the new point until the preacher picks one. */
  const [groupSection, setGroupSection] = useState<SectionKey | null>(null);
  const [addingPoint, setAddingPoint] = useState<SectionKey | null>(null);
  const [pointDraft, setPointDraft] = useState('');
  const [addingSub, setAddingSub] = useState<string | null>(null);
  const [subDraft, setSubDraft] = useState('');
  const [lastMove, setLastMove] = useState<LastMove | null>(null);
  const [justPlaced, setJustPlaced] = useState<string[]>([]);
  const [editRequest, setEditRequest] = useState<{ id: string; n: number; place: ScratchPlace } | null>(null);
  const [openEdit, setOpenEdit] = useState<{ id: string; place: ScratchPlace } | null>(null);
  const [renaming, setRenaming] = useState<OutlineNoteTarget | null>(null);
  const isRenaming = (kind: OutlineNoteTarget['kind'], id: string) => renaming?.kind === kind && renaming.id === id;
  const titleEditor = (target: OutlineNoteTarget, initial: string) => (
    <TitleEditor initial={initial} label={target.kind === 'point' ? t('scratch.sort.pointTitle') : t('scratch.sort.subPointTitle')}
      saveLabel={t('scratch.card.save')} cancelLabel={t('scratch.card.cancel')}
      onCancel={() => setRenaming(null)} onSave={(text) => { if (!isReadOnly) onRenameTitle(target, text); setRenaming(null); }} />
  );
  const requestEdit = (id: string) => {
    const place = placeById.get(id);
    if (!place) return;
    setExpanded((current) => ({ ...current, [id]: true }));
    setEditRequest((current) => ({ id, place, n: (current?.n ?? 0) + 1 }));
  };
  // The sermon page slides its modes with a transform, and anything "fixed" inside a transformed box
  // is placed against that box, not the screen. The card in the hand and the phone's bottom bar are
  // therefore drawn on the page's body; only after mounting, so the server's HTML stays the same.
  const [onBody, setOnBody] = useState(false);
  useEffect(() => setOnBody(true), []);
  const droppedAt = useRef(0);
  const swallowClick = useCallback(() => Date.now() - droppedAt.current < 300, []);
  useEffect(() => {
    if (!justPlaced.length) return;
    const timer = setTimeout(() => setJustPlaced([]), 1400);
    return () => clearTimeout(timer);
  }, [justPlaced]);

  const sorted = useMemo(() => sortScratch(notes, outline), [notes, outline]);
  /** A move that would leave every note where it is and in the same order. */
  const changesNothing = useCallback((ids: string[], place: ScratchPlace, beforeId?: string) => {
    // The board shows the nodes' old one-line reminders as notes too, so the check runs on the same list.
    const shown = [...outlineNoteSketches(outline), ...notes];
    const signature = (list: readonly ScratchNote[]) => list.map((note) => `${note.id}@${placeKey(scratchPlaceOf(note, outline))}`).join(',');
    return signature(placeScratchNotes(shown, ids, place, beforeId)) === signature(shown);
  }, [notes, outline]);
  /** Each place's notes in the order the board shows them (the stored order). */
  const orderByPlace = useMemo(() => {
    const order = new Map<string, string[]>();
    order.set(placeKey(POOL_PLACE), sorted.pool.map((note) => note.id));
    SECTION_KEYS.forEach((section) => {
      const part = sorted.sections[section];
      order.set(placeKey({ section, pointId: null, subPointId: null }), part.loose.map((note) => note.id));
      part.points.forEach(({ point, notes: onPoint, subPoints }) => {
        order.set(placeKey({ section, pointId: point.id, subPointId: null }), onPoint.map((note) => note.id));
        subPoints.forEach(({ subPoint, notes: onSub }) => order.set(placeKey({ section, pointId: point.id, subPointId: subPoint.id }), onSub.map((note) => note.id)));
      });
    });
    return order;
  }, [sorted]);
  const placeById = useMemo(() => {
    const places = new Map<string, ScratchPlace>();
    sorted.pool.forEach((note) => places.set(note.id, POOL_PLACE));
    SECTION_KEYS.forEach((section) => {
      const part = sorted.sections[section];
      part.loose.forEach((note) => places.set(note.id, { section, pointId: null, subPointId: null }));
      part.points.forEach(({ point, notes: onPoint, subPoints }) => {
        onPoint.forEach((note) => places.set(note.id, { section, pointId: point.id, subPointId: null }));
        subPoints.forEach(({ subPoint, notes: onSub }) => onSub.forEach((note) => places.set(note.id, { section, pointId: point.id, subPointId: subPoint.id })));
      });
    });
    return places;
  }, [sorted]);
  // Keep the open editor mounted in its original list until Save or Cancel.
  // Commands and drop destinations use the latest stored outline and placement.
  const editPlace = openEdit ?? editRequest;
  const editingNoteId = editPlace?.id;
  const displayed = useMemo(() => {
    const stored = editPlace && placeById.get(editPlace.id);
    return editPlace && stored && !sameScratchPlace(stored, editPlace.place)
      ? sortScratch(notes, outline, true, editPlace)
      : sorted;
  }, [editPlace, notes, outline, placeById, sorted]);
  // The board shows the nodes' old one-line reminders as notes too, so they count like notes.
  const total = placeById.size;
  const placed = total - displayed.pool.length;
  const shownNotes = useMemo(() => [...outlineNoteSketches(outline), ...notes], [notes, outline]);
  /** The id a note has after a move: an old reminder becomes an ordinary note under its stable id. */
  const idAfterMove = useCallback((id: string) => {
    const target = outlineNoteTargetOf(id);
    const shown = target ? shownNotes.find((note) => note.id === id) : undefined;
    return target && shown ? materializedNoteId(target, shown.text) : id;
  }, [shownNotes]);

  // Ticks and the open panel follow the notes: a note that left or vanished is no longer picked.
  useEffect(() => {
    setSelected((current) => {
      const next = current.filter((id) => placeById.has(id));
      return next.length === current.length ? current : next;
    });
  }, [placeById]);
  // A panel from below is a phone's; a screen that turns wide closes it, so it never holds the page hidden.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(WIDE);
    const close = () => { if (query.matches) setSheet(null); };
    query.addEventListener?.('change', close);
    return () => query.removeEventListener?.('change', close);
  }, []);

  const targets = useMemo<ScratchMoveTarget[]>(() => {
    const list: ScratchMoveTarget[] = [{ key: 'pool', label: t('scratch.card.placeIntoPool'), depth: 0, place: POOL_PLACE, tone: 'pool' }];
    SECTION_KEYS.forEach((section) => {
      const part = sorted.sections[section];
      const label = getSectionLabel(t, section);
      const partPlace: ScratchPlace = { section, pointId: null, subPointId: null };
      list.push({ key: placeKey(partPlace), label: part.points.length ? t('scratch.sort.partWithoutPoint', { part: label }) : label, depth: 0, place: partPlace, tone: 'part', textClass: SECTION_LOOK[section].title });
      part.points.forEach(({ point, subPoints }) => {
        const pointPlace: ScratchPlace = { section, pointId: point.id, subPointId: null };
        list.push({ key: placeKey(pointPlace), label: point.text, depth: 1, place: pointPlace, tone: 'point' });
        subPoints.forEach(({ subPoint }) => {
          const subPlace: ScratchPlace = { section, pointId: point.id, subPointId: subPoint.id };
          list.push({ key: placeKey(subPlace), label: subPoint.text, depth: 2, place: subPlace, tone: 'point' });
        });
      });
    });
    return list;
  }, [sorted, t]);
  const targetLabel = useCallback((place: ScratchPlace) => {
    if (!place.section) return t('scratch.card.placeIntoPool');
    const target = targets.find((entry) => entry.key === placeKey(place));
    return target?.tone === 'part' ? getSectionLabel(t, place.section) : `«${target?.label ?? ''}»`;
  }, [t, targets]);

  /** `exact`: a drag chose a slot, so the order inside the place counts; the menu only names a place (its end). */
  const move = useCallback((ids: string[], place: ScratchPlace, beforeId?: string, exact = false) => {
    const moving = ids.filter((id) => { const current = placeById.get(id); return current && (exact ? id !== beforeId : !sameScratchPlace(current, place)); });
    if (!moving.length || isReadOnly) return;
    if (changesNothing(moving, place, beforeId)) return;
    const back = new Map<string, { ids: string[]; place: ScratchPlace }>();
    moving.forEach((id) => {
      const from = placeById.get(id) ?? POOL_PLACE;
      const key = placeKey(from);
      back.set(key, { ids: [...(back.get(key)?.ids ?? []), idAfterMove(id)], place: from });
    });
    onPlace(moving, place, beforeId);
    setJustPlaced(moving.map(idAfterMove));
    setSelected((current) => current.filter((id) => !moving.includes(id)));
    setLastMove({ words: t('scratch.sort.moved', { what: t(NOTE_COUNT_KEY, { count: moving.length }), where: targetLabel(place) }), back: [...back.values()] });
  }, [changesNothing, idAfterMove, isReadOnly, onPlace, placeById, t, targetLabel]);
  const undoLastMove = () => {
    if (isReadOnly) return;
    lastMove?.back.forEach(({ ids, place }) => onPlace(ids, place));
    setLastMove(null);
  };

  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]);
  const collect = (ids: string[]) => {
    if (isReadOnly) return;
    const title = groupTitle.trim();
    if (!title || !groupSection || !ids.length || isReadOnly) return;
    onCreatePoint(groupSection, title, ids);
    setLastMove({ words: t('scratch.sort.collected', { what: t(NOTE_COUNT_KEY, { count: ids.length }), point: title }), back: [] });
    setSelected([]);
    setGrouping(false);
    setGroupTitle('');
    setGroupSection(null);
    setSheet(null);
  };
  const addPoint = (section: SectionKey) => {
    if (pointDraft.trim() && !isReadOnly) onAddPoint(section, pointDraft);
    setAddingPoint(null);
    setPointDraft('');
  };
  const addSubPoint = (pointId: string) => {
    if (subDraft.trim() && !isReadOnly) onAddSubPoint(pointId, subDraft);
    setAddingSub(null);
    setSubDraft('');
  };
  const removePoint = async (pointId: string, title: string) => {
    const thoughts = pointThoughtCount(pointId);
    const accepted = await confirm({
      title: { key: 'scratch.sort.removePointTitle', values: { title } },
      description: { key: thoughts ? 'scratch.sort.removePointWithThoughts' : 'scratch.sort.removePointDescription' },
      confirmText: { key: 'common.delete' },
      cancelText: { key: 'common.cancel' },
    });
    if (accepted && !isReadOnly) onRemovePoint(pointId);
  };
  const removeSubPoint = async (subPointId: string, title: string) => {
    const accepted = await confirm({
      title: { key: 'scratch.sort.removeSubPointTitle', values: { title } },
      description: { key: 'scratch.sort.removeSubPointDescription' },
      confirmText: { key: 'common.delete' },
      cancelText: { key: 'common.cancel' },
    });
    if (accepted && !isReadOnly) onRemoveSubPoint(subPointId);
  };

  const sensors = useSensors(
    useSensor(CardMouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(CardTouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  );
  /** A spot's id → the place a note dropped there goes to; a card's id stands for the card's own place. */
  const dropPlaces = useMemo(() => {
    const places = new Map<string, { place: ScratchPlace; label: string }>(targets.map((target) => [target.key, { place: target.place, label: target.label }]));
    placeById.forEach((place, id) => {
      if (id !== editingNoteId) places.set(noteDropId(id), { place, label: targetLabel(place) });
    });
    return places;
  }, [editingNoteId, placeById, targetLabel, targets]);
  const dragIds = (id: string) => (selected.includes(id) ? selected : [id]).filter(noteId => noteId !== editingNoteId);
  const carriedIds = dragging ? dragIds(dragging) : [];
  /** Where the hand is, read from the window: the slot rule needs the pointer, not the dragged card's box. */
  const pointer = useRef<Point | null>(null);
  useEffect(() => {
    if (!dragging) return;
    const onPointer = (event: PointerEvent) => { pointer.current = { x: event.clientX, y: event.clientY }; };
    const onTouch = (event: TouchEvent) => { const touch = event.touches[0]; if (touch) pointer.current = { x: touch.clientX, y: touch.clientY }; };
    window.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('touchmove', onTouch, { passive: true });
    return () => { window.removeEventListener('pointermove', onPointer); window.removeEventListener('touchmove', onTouch); };
  }, [dragging]);
  const [aim, setAim] = useState<Aim | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  /**
   * Where a drop over `key` lands, by the board's one rule (`resolveNoteSlot` in `utils/boardDnd`): the spot under
   * the hand gives the place, and inside it the nearest card's half says before or after — the gaps belong to the
   * nearest card too. Counted without the notes in the hand; no `beforeId` means the end of the place.
   */
  const aimAt = (key: string | null): Aim | null => {
    const base = key ? dropPlaces.get(key) : undefined;
    if (!base) return null;
    if (!pointer.current) return { ...base, anchorId: null, side: 'after' };
    const list = (orderByPlace.get(placeKey(base.place)) ?? []).filter((id) => id !== editingNoteId && !carriedIds.includes(id));
    const cards = list.flatMap((id) => {
      const rect = boardRef.current?.querySelector(`[data-testid="scratch-sketch-${CSS.escape(id)}"]`)?.getBoundingClientRect();
      return rect && rect.width > 0 && rect.height > 0 ? [{ id, rect }] : [];
    });
    const slot = resolveNoteSlot(pointer.current, cards.map(({ rect }) => rect), false);
    return {
      ...base,
      beforeId: cards[slot.index]?.id,
      anchorId: slot.anchorIndex === null ? null : cards[slot.anchorIndex]?.id ?? null,
      side: slot.side,
    };
  };
  /** Re-render only when the landing spot changes, not on every pointer move. */
  const aimFor = (key: string | null) => setAim((current) => {
    const next = aimAt(key);
    return current && next && placeKey(current.place) === placeKey(next.place) && current.beforeId === next.beforeId
      && current.anchorId === next.anchorId && current.side === next.side ? current : next;
  });
  const onDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id);
    const start = event.activatorEvent as MouseEvent | TouchEvent;
    const touch = 'touches' in start ? start.touches[0] : undefined;
    pointer.current = touch ? { x: touch.clientX, y: touch.clientY } : 'clientX' in start ? { x: start.clientX, y: start.clientY } : null;
    setDrag({ id, folded });
    journal('take', { id, carried: selected.includes(id) ? selected.length : 1, from: placeKey(placeById.get(id) ?? POOL_PLACE) });
  };
  const onDragOver = (event: DragOverEvent) => {
    const key = event.over ? String(event.over.id) : null;
    aimFor(key);
    journal('over', key);
  };
  const onDragMove = (event: DragMoveEvent) => aimFor(event.over ? String(event.over.id) : null);
  const finishDrag = () => { setDrag(null); setAim(null); droppedAt.current = Date.now(); };
  const onDragEnd = (event: DragEndEvent) => {
    const id = String(event.active.id);
    const over = event.over ? String(event.over.id) : null;
    const drop = aimAt(over);
    finishDrag();
    journal('drop', { id, over, place: drop ? placeKey(drop.place) : null, before: drop?.beforeId ?? null });
    if (!drop) return;
    move(dragIds(id), drop.place, drop.beforeId, true);
  };
  const onDragCancel = () => { finishDrag(); journal('cancel'); };
  /** The line beside the card the slot is read from: above it or under it, and none where nothing would change. */
  const landingOf = (noteId: string): 'before' | 'after' | null => {
    if (!dragging || noteId === editingNoteId || !aim || aim.anchorId !== noteId) return null;
    return changesNothing(carriedIds.filter((id) => id !== aim.beforeId), aim.place, aim.beforeId) ? null : aim.side;
  };
  // The screen reader hears the place the card goes to: «→ Вступление».
  const placeOf = useCallback((over: { id: string | number }) => dropPlaces.get(String(over.id))?.label ?? null, [dropPlaces]);
  const dndAccessibility = useDndKitAccessibility({ placeOf });
  const draggedNote = dragging ? shownNotes.find((note) => note.id === dragging) : undefined;

  const card = (note: ScratchNote, variant: 'pool' | 'plan', selectable: boolean) => (
    <ScratchSketchCard key={note.id} note={note} variant={variant} isReadOnly={isReadOnly}
      selected={selected.includes(note.id)} onToggleSelect={selectable ? () => toggle(note.id) : undefined}
      expanded={Boolean(expanded[note.id])} onToggleExpanded={() => setExpanded((current) => ({ ...current, [note.id]: !current[note.id] }))}
      text={renderText(note, editRequest?.id === note.id ? editRequest.n : 0,
        (editing) => {
          if (editing) {
            const place = editRequest?.id === note.id ? editRequest.place : placeById.get(note.id);
            if (place) setOpenEdit({ id: note.id, place });
            setEditRequest((current) => (current?.id === note.id ? null : current));
          } else {
            setOpenEdit((current) => current?.id === note.id ? null : current);
          }
        })}
      editing={openEdit?.id === note.id} noteLocked={isNoteLocked} onEdit={() => requestEdit(note.id)} targets={targets} currentKey={placeKey(placeById.get(note.id) ?? POOL_PLACE)}
      onMove={(place) => move([note.id], place)} onOpenMoveSheet={() => setSheet({ kind: 'move', ids: [note.id] })}
      onDelete={() => onDelete(note.id)}
      carried={Boolean(dragging) && carriedIds.includes(note.id) && note.id !== dragging} landing={landingOf(note.id)}
      justPlaced={justPlaced.includes(note.id)} swallowClick={swallowClick} />
  );
  const groupForm = (ids: string[], inSheet: boolean) => (
    <div className="flex flex-col gap-2.5">
      <label className="sr-only" htmlFor={inSheet ? 'scratch-group-title-sheet' : 'scratch-group-title'}>{t('scratch.sort.pointTitle')}</label>
      <input id={inSheet ? 'scratch-group-title-sheet' : 'scratch-group-title'} type="text" value={groupTitle} autoFocus
        onChange={(event) => setGroupTitle(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); collect(ids); } if (event.key === 'Escape' && !inSheet) setGrouping(false); }}
        placeholder={t('scratch.sort.pointTitlePlaceholder')} className={`${INPUT} h-11 flex-none md:h-9`} />
      {/* Each part in its own colour, the chosen one filled; one line of three, a name never broken in two.
          The rail of a mid-size screen is too narrow for that line, so there they stand one under another. */}
      <div role="radiogroup" aria-label={t('scratch.sort.whichPart')}
        className={`grid gap-1.5 ${inSheet ? 'grid-cols-[1fr_1.25fr_1fr]' : 'grid-cols-[1fr_1.25fr_1fr] md:grid-cols-1 lg:grid-cols-[1fr_1.25fr_1fr]'}`}>
        {SECTION_KEYS.map((section) => (
          <button key={section} type="button" role="radio" aria-checked={groupSection === section} onClick={() => setGroupSection(section)}
            className={`inline-flex h-11 min-w-0 items-center justify-center whitespace-nowrap rounded-full border px-2 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-1 md:h-8 ${
              groupSection === section ? SECTION_LOOK[section].radioOn : SECTION_LOOK[section].radioOff}`}>
            {getSectionLabel(t, section)}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-end gap-2">
        {!inSheet && <button type="button" onClick={() => setGrouping(false)} className={`${SECONDARY} h-9`}>{t('common.cancel')}</button>}
        <button type="button" onClick={() => collect(ids)} disabled={!groupTitle.trim() || !groupSection} className={`${PRIMARY} h-11 flex-1 md:h-9 md:flex-none`}>{t('scratch.sort.createPoint')}</button>
      </div>
    </div>
  );

  return (
    <DndContext accessibility={dndAccessibility} sensors={sensors} collisionDetection={innermostZone} onDragStart={onDragStart} onDragOver={onDragOver} onDragMove={onDragMove} onDragEnd={onDragEnd} onDragCancel={onDragCancel}>
      <div ref={boardRef} data-testid="scratch-sorting-board">
        {/* A phone: the pool and the plan are two tabs. */}
        <div role="tablist" aria-label={t('scratch.title')} className="mb-3 flex gap-1.5 md:hidden">
          {(['pool', 'plan'] as const).map((name) => (
            <button key={name} type="button" role="tab" aria-selected={tab === name} onClick={() => setTab(name)}
              className={`h-11 flex-1 rounded-xl border text-[15px] font-semibold transition-colors ${tab === name
                ? 'border-violet-600 bg-violet-600 text-white' : 'border-gray-200 bg-white text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200'}`}>
              {name === 'pool' ? t('scratch.sort.tabPool', { count: displayed.pool.length }) : t('scratch.sort.tabPlan', { placed, total })}
            </button>
          ))}
        </div>
        {lastMove && (
          <div role="status" className="mb-3 flex items-center gap-2 rounded-xl bg-violet-50 px-3 py-2 text-sm text-violet-900 md:hidden dark:bg-violet-950/40 dark:text-violet-100">
            <span className="min-w-0 flex-1">{lastMove.words}</span>
            {lastMove.back.length > 0 && <button type="button" onClick={undoLastMove} className={`${SECONDARY} h-9 shrink-0`}>{t('scratch.card.undoDelete')}</button>}
          </div>
        )}

        <div className="md:flex md:items-start md:gap-4 lg:gap-6">
          {/* The pool: a column on the right of the plan on wide screens, folded into a narrow rail at will, so the
              plan's left edge stays in place.
              One drop zone in both forms: a note dropped on the rail goes into the pool. Folded, its column stays
              mounted, only hidden — a recording under way goes on. */}
          <DropZone id="pool" ariaLabel={t('scratch.sort.pool')}
            className={`${tab === 'pool' ? 'block' : 'hidden'} rounded-2xl border border-gray-200 bg-white shadow-sm md:sticky md:top-20 md:order-2 md:flex md:max-h-[calc(100dvh-9rem)] md:shrink-0 md:flex-col ${folded ? 'md:w-14' : 'md:w-[300px] lg:w-[400px]'} dark:border-gray-700 dark:bg-gray-900`}
            activeClass="ring-2 ring-violet-400 bg-violet-50/40 dark:bg-violet-950/20" readyClass="ring-1 ring-dashed ring-violet-200 dark:ring-violet-800" dragActive={Boolean(dragging)}>
            {folded && <div className="hidden md:flex md:flex-col md:items-center md:gap-2 md:py-3">
              <button ref={showPoolRef} type="button" onClick={() => { focusAfterFold.current = 'hide'; openFromRail(); }} aria-expanded={false}
                aria-label={t('scratch.sort.showPool')} title={t('scratch.sort.showPool')}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700">
                <ChevronDoubleLeftIcon className="h-4 w-4" aria-hidden="true" />
              </button>
              <span className="my-1 h-px w-6 bg-gray-200 dark:bg-gray-700" aria-hidden="true" />
              <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-violet-100 px-2 text-xs font-semibold text-violet-700 dark:bg-violet-900/50 dark:text-violet-200"
                title={t('scratch.sort.tabPool', { count: displayed.pool.length })}>{displayed.pool.length}</span>
              <button type="button" onClick={() => startFromRail('voice')} disabled={isReadOnly || Boolean(railVoiceUnavailable)}
                aria-label={t('audio.newRecording')} title={railVoiceUnavailable || t('audio.newRecording')}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-green-600 text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50">
                <MicrophoneIcon className="h-5 w-5" aria-hidden="true" />
              </button>
              <button type="button" onClick={() => startFromRail('write')} disabled={isReadOnly} aria-label={t('scratch.capture.manualAdd')} title={t('scratch.capture.manualAdd')}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gray-300 bg-gray-100 text-gray-700 transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200">
                <PencilIcon className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>}
            <div className={folded ? 'contents md:hidden' : 'contents'}>
            <div className="shrink-0 border-b border-gray-100 p-3 md:p-3.5 dark:border-gray-800">
              <div className="mb-3 flex items-center gap-2">
                <h2 ref={poolHeadingRef} tabIndex={-1} className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('scratch.sort.pool')}</h2>
                <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-violet-100 px-2 text-xs font-semibold text-violet-700 dark:bg-violet-900/50 dark:text-violet-200">{displayed.pool.length}</span>
                <span className="flex-1" />
                {/* How the board works: asked for, not printed over the notes every time. */}
                <Popover>
                  <PopoverButton aria-label={t('scratch.sort.howTo')} title={t('scratch.sort.howTo')}
                    className="-mr-1.5 inline-flex h-11 w-11 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 data-[open]:bg-gray-100 data-[open]:text-gray-700 md:h-8 md:w-8 dark:hover:bg-gray-800 dark:hover:text-gray-200 dark:data-[open]:bg-gray-800">
                    <QuestionMarkCircleIcon className="h-5 w-5" aria-hidden="true" />
                  </PopoverButton>
                  <PopoverPanel anchor="bottom end"
                    className="z-50 w-72 rounded-xl border border-gray-200 bg-white p-3 text-sm leading-snug text-gray-600 shadow-lg [--anchor-gap:6px] [--anchor-padding:16px] focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
                    <span className="md:hidden">{t('scratch.sort.poolHintPhone')}</span>
                    <span className="hidden md:inline">{t('scratch.sort.poolHint')}</span>
                  </PopoverPanel>
                </Popover>
                {!poolBusy && <button ref={hidePoolRef} type="button" onClick={() => { focusAfterFold.current = 'show'; foldPool(true); }} aria-expanded
                  aria-label={t('scratch.sort.hidePool')} title={t('scratch.sort.hidePool')}
                  className="hidden h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 transition-colors hover:bg-gray-100 md:inline-flex dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700">
                  <ChevronDoubleRightIcon className="h-4 w-4" aria-hidden="true" />
                </button>}
              </div>
              {capture}
              {selected.length > 0 && (
                <div className="mt-3 hidden rounded-xl border border-violet-200 bg-violet-50 p-2.5 md:block dark:border-violet-800 dark:bg-violet-950/30">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-violet-800 dark:text-violet-200">{t('scratch.sort.selected', { count: selected.length })}</span>
                    <span className="flex-1" />
                    {!grouping && <button type="button" onClick={() => { setGroupSection(null); setGrouping(true); }} disabled={isReadOnly} className={`${PRIMARY} h-8`}>{t('scratch.sort.collect')}</button>}
                    <button type="button" onClick={() => setSelected([])} aria-label={t('scratch.sort.clearSelection')} title={t('scratch.sort.clearSelection')}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-white dark:hover:bg-gray-800"><XMarkIcon className="h-4 w-4" aria-hidden="true" /></button>
                  </div>
                  {grouping && <div className="mt-2.5">{groupForm(selected, false)}</div>}
                </div>
              )}
            </div>
            {/* The rail stays beside the plan while the page scrolls; its own list scrolls inside it. */}
            <div className="flex flex-col gap-2 p-2.5 md:min-h-0 md:flex-1 md:overflow-y-auto md:overscroll-contain">
              {displayed.pool.map((note) => card(note, 'pool', true))}
              {displayed.pool.length === 0 && (
                <p className="rounded-xl border border-dashed border-gray-300 px-4 py-5 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">{t('scratch.sort.poolEmpty')}</p>
              )}
            </div>
            </div>
          </DropZone>

          {/* The plan, top to bottom. */}
          <section aria-label={t('scratch.sort.plan')} className={`${tab === 'plan' ? 'block' : 'hidden'} min-w-0 md:order-1 md:block md:flex-1`}>
            <div className="mb-3 flex items-center gap-3">
              <h2 className="hidden text-lg font-semibold text-gray-900 md:block dark:text-gray-100">{t('scratch.sort.plan')}</h2>
              <span className="whitespace-nowrap text-sm text-gray-600 dark:text-gray-300">{t('scratch.sort.progress', { placed, total })}</span>
              <div aria-hidden="true" className="h-1.5 flex-1 overflow-hidden rounded-full bg-violet-100 dark:bg-violet-950">
                <div className="h-full rounded-full bg-violet-600" style={{ width: `${total ? Math.round((placed / total) * 100) : 0}%` }} />
              </div>
            </div>
            <div className="flex flex-col gap-4">
              {SECTION_KEYS.map((section) => {
                const part = displayed.sections[section];
                const look = SECTION_LOOK[section];
                const count = part.loose.length + part.points.reduce((sum, entry) => sum + entry.notes.length + entry.subPoints.reduce((s, sub) => s + sub.notes.length, 0), 0);
                const empty = !part.loose.length && !part.points.length;
                return (
                  <DropZone key={section} id={placeKey({ section, pointId: null, subPointId: null })} ariaLabel={getSectionLabel(t, section)}
                    style={{ borderLeftColor: look.bar }}
                    className={`rounded-r-2xl rounded-l-md border-l-4 p-3 md:p-3.5 ${look.tint}`} activeClass="ring-2 ring-violet-400" readyClass="ring-1 ring-violet-200 dark:ring-violet-800" dragActive={Boolean(dragging)}>
                    <div className="flex items-center gap-2">
                      <h3 className={`text-base font-semibold ${look.title}`}>{getSectionLabel(t, section)}</h3>
                      {count > 0 && <span className="text-sm text-gray-500 dark:text-gray-400">{t(NOTE_COUNT_KEY, { count })}</span>}
                      <span className="flex-1" />
                      {!isReadOnly && (
                        <button type="button" onClick={() => { setAddingPoint(addingPoint === section ? null : section); setPointDraft(''); }}
                          className="inline-flex h-11 items-center gap-1 rounded-lg border border-dashed border-gray-300 bg-white px-2.5 text-sm text-gray-600 hover:border-gray-400 hover:text-gray-900 md:h-8 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300">
                          <PlusIcon className="h-4 w-4" aria-hidden="true" />{t('scratch.sort.addPointShort')}
                        </button>
                      )}
                    </div>
                    {addingPoint === section && (
                      <div className="mt-2.5 flex gap-2">
                        <label className="sr-only" htmlFor={`scratch-new-point-${section}`}>{t('scratch.sort.pointTitle')}</label>
                        <input id={`scratch-new-point-${section}`} type="text" value={pointDraft} autoFocus onChange={(event) => setPointDraft(event.target.value)}
                          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addPoint(section); } if (event.key === 'Escape') setAddingPoint(null); }}
                          placeholder={t('scratch.sort.pointTitle')} className={`${INPUT} h-11 md:h-9`} />
                        <button type="button" onClick={() => addPoint(section)} disabled={!pointDraft.trim()} className={`${PRIMARY} h-11 md:h-9`}>{t('scratch.sort.add')}</button>
                      </div>
                    )}
                    {empty && addingPoint !== section && (
                      <p className="mt-2.5 rounded-xl border border-dashed border-gray-300 bg-white px-3 py-3 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400">{t('scratch.sort.partEmpty')}</p>
                    )}
                    {part.loose.length > 0 && (
                      <div className="mt-3">
                        <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('scratch.sort.loose')}</div>
                        <div className="flex flex-col gap-1.5">{part.loose.map((note) => card(note, 'plan', true))}</div>
                      </div>
                    )}
                    {part.points.length > 0 && (
                      <div className="mt-3 flex flex-col gap-2.5">
                        {part.points.map(({ point, notes: onPoint, subPoints }) => {
                          const total = onPoint.length + subPoints.reduce((sum, sub) => sum + sub.notes.length, 0);
                          return (
                            <DropZone key={point.id} id={placeKey({ section, pointId: point.id, subPointId: null })} ariaLabel={point.text}
                              className="rounded-xl border border-gray-200 bg-white p-2.5 dark:border-gray-700 dark:bg-gray-900" activeClass="ring-2 ring-violet-500 bg-violet-50/60 dark:bg-violet-950/30" readyClass="ring-1 ring-violet-200 dark:ring-violet-800" dragActive={Boolean(dragging)}>
                              <div className={`flex items-center gap-1 ${hoverActions.row}`}>
                                <span aria-hidden="true" className={`ml-1 mr-1.5 h-2 w-2 shrink-0 rounded-full ${look.dot}`} />
                                {isRenaming('point', point.id) ? titleEditor({ kind: 'point', id: point.id }, point.text) : (
                                  <>
                                    <span className="min-w-0 flex-1 text-[15px] font-semibold text-gray-900 dark:text-gray-100">{point.text}</span>
                                    {total > 0 && <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">{t(NOTE_COUNT_KEY, { count: total })}</span>}
                                    {!isReadOnly && (
                                      <div className={`flex shrink-0 items-center gap-1 transition-opacity duration-150 ${addingSub === point.id ? '' : hoverActions.actions}`}>
                                        <button type="button" onClick={() => setRenaming({ kind: 'point', id: point.id })}
                                          aria-label={t('scratch.sort.renamePoint')} title={t('scratch.sort.renamePoint')}
                                          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-violet-700 md:h-8 md:w-8 dark:hover:bg-gray-800 dark:hover:text-violet-300">
                                          <PencilSquareIcon className="h-4 w-4" aria-hidden="true" />
                                        </button>
                                        <button type="button" onClick={() => { setAddingSub(addingSub === point.id ? null : point.id); setSubDraft(''); }}
                                          aria-label={t('scratch.sort.addSubPoint')} title={t('scratch.sort.addSubPoint')}
                                          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 md:h-8 md:w-8 dark:hover:bg-gray-800">
                                          <PlusIcon className="h-4 w-4" aria-hidden="true" />
                                        </button>
                                        <button type="button" onClick={() => { void removePoint(point.id, point.text); }}
                                          aria-label={t('scratch.sort.removePoint')} title={t('scratch.sort.removePoint')}
                                          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-red-600 md:h-8 md:w-8 dark:hover:bg-gray-800 dark:hover:text-red-400">
                                          <TrashIcon className="h-4 w-4" aria-hidden="true" />
                                        </button>
                                      </div>
                                    )}
                                  </>
                                )}
                              </div>
                              {(onPoint.length > 0 || subPoints.length > 0 || addingSub === point.id) && (
                                <div className="mt-1.5 flex flex-col gap-1.5 pl-3">
                                  {onPoint.map((note) => card(note, 'plan', false))}
                                  {subPoints.map(({ subPoint, notes: onSub }) => (
                                    <DropZone key={subPoint.id} id={placeKey({ section, pointId: point.id, subPointId: subPoint.id })} ariaLabel={subPoint.text}
                                      className="flex flex-col gap-1.5 rounded-r-lg border-l-2 border-gray-200 py-1 pl-2.5 dark:border-gray-700" activeClass="border-violet-500 bg-violet-50 dark:bg-violet-950/30" dragActive={Boolean(dragging)}>
                                      {isRenaming('subpoint', subPoint.id) ? titleEditor({ kind: 'subpoint', id: subPoint.id }, subPoint.text) : (
                                        <div className={`flex items-center gap-1 ${hoverActions.row}`}>
                                          <span className="min-w-0 flex-1 text-sm font-semibold text-gray-700 dark:text-gray-200">
                                            {subPoint.text}{onSub.length > 0 && <span className="ml-1.5 font-normal text-gray-400">{t(NOTE_COUNT_KEY, { count: onSub.length })}</span>}
                                          </span>
                                          {!isReadOnly && (
                                            <div className={`flex shrink-0 items-center gap-1 transition-opacity duration-150 ${hoverActions.actions}`}>
                                              <button type="button" onClick={() => setRenaming({ kind: 'subpoint', id: subPoint.id })}
                                                aria-label={t('scratch.sort.renameSubPoint')} title={t('scratch.sort.renameSubPoint')}
                                                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-violet-700 md:h-7 md:w-7 dark:hover:bg-gray-800 dark:hover:text-violet-300">
                                                <PencilSquareIcon className="h-4 w-4" aria-hidden="true" />
                                              </button>
                                              <button type="button" onClick={() => { void removeSubPoint(subPoint.id, subPoint.text); }}
                                                aria-label={t('scratch.sort.removeSubPoint')} title={t('scratch.sort.removeSubPoint')}
                                                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-red-600 md:h-7 md:w-7 dark:hover:bg-gray-800 dark:hover:text-red-400">
                                                <TrashIcon className="h-4 w-4" aria-hidden="true" />
                                              </button>
                                            </div>
                                          )}
                                        </div>
                                      )}
                                      {onSub.map((note) => card(note, 'plan', false))}
                                    </DropZone>
                                  ))}
                                  {addingSub === point.id && (
                                    <div className="flex gap-2">
                                      <label className="sr-only" htmlFor={`scratch-new-sub-${point.id}`}>{t('scratch.sort.subPointTitle')}</label>
                                      <input id={`scratch-new-sub-${point.id}`} type="text" value={subDraft} autoFocus onChange={(event) => setSubDraft(event.target.value)}
                                        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addSubPoint(point.id); } if (event.key === 'Escape') setAddingSub(null); }}
                                        placeholder={t('scratch.sort.subPointTitle')} className={`${INPUT} h-11 md:h-9`} />
                                      <button type="button" onClick={() => addSubPoint(point.id)} disabled={!subDraft.trim()} className={`${PRIMARY} h-11 md:h-9`}>{t('scratch.sort.add')}</button>
                                    </div>
                                  )}
                                </div>
                              )}
                            </DropZone>
                          );
                        })}
                      </div>
                    )}
                  </DropZone>
                );
              })}
            </div>
          </section>
        </div>

        {/* A phone: what to do with the ticked notes, at the bottom of the screen. */}
        {selected.length > 0 && !sheet && (
          <>
            <div aria-hidden="true" className="h-20 md:hidden" />
            {onBody && createPortal(
            <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-2 border-t border-gray-200 bg-white px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5 shadow-[0_-6px_18px_rgba(17,24,39,0.08)] md:hidden dark:border-gray-700 dark:bg-gray-900">
              <button type="button" onClick={() => setSelected([])} aria-label={t('scratch.sort.clearSelection')}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-500"><XMarkIcon className="h-5 w-5" aria-hidden="true" /></button>
              <span className="whitespace-nowrap text-sm font-semibold text-violet-800 dark:text-violet-200">{t('scratch.sort.selected', { count: selected.length })}</span>
              <span className="flex-1" />
              <button type="button" onClick={() => { setGroupTitle(''); setGroupSection(null); setSheet({ kind: 'group', ids: selected }); }} disabled={isReadOnly} className={`${PRIMARY} h-11`}>{t('scratch.sort.collectShort')}</button>
              <button type="button" onClick={() => setSheet({ kind: 'move', ids: selected })} disabled={isReadOnly} className={`${SECONDARY} h-11`}>{t('scratch.sort.moveShort')}</button>
            </div>,
              document.body)}
          </>
        )}

        <Dialog open={Boolean(sheet)} onClose={() => setSheet(null)} className="relative z-50 md:hidden">
          <div className="fixed inset-0 bg-gray-900/40" aria-hidden="true" />
          <div className="fixed inset-x-0 bottom-0">
            <DialogPanel className="max-h-[80vh] overflow-y-auto rounded-t-2xl bg-white px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2 shadow-2xl dark:bg-gray-900">
              <div aria-hidden="true" className="mx-auto mb-2.5 mt-1 h-1.5 w-10 rounded-full bg-gray-300 dark:bg-gray-600" />
              <DialogTitle className="text-base font-semibold text-gray-900 dark:text-gray-100">
                {sheet?.kind === 'group'
                  ? t('scratch.sort.newPointFrom', { what: t(NOTE_COUNT_KEY, { count: sheet.ids.length }) })
                  : t('scratch.sort.moveWhere', { what: t(NOTE_COUNT_KEY, { count: sheet?.ids.length ?? 0 }) })}
              </DialogTitle>
              {sheet?.kind === 'group' && <div className="mt-3">{groupForm(sheet.ids, true)}</div>}
              {sheet?.kind === 'move' && (
                <div className="mt-2 flex flex-col">
                  {targets.map((target) => {
                    const here = sheet.ids.length === 1 && placeKey(placeById.get(sheet.ids[0]) ?? POOL_PLACE) === target.key;
                    return (
                      <button key={target.key} type="button" disabled={here} onClick={() => { move(sheet.ids, target.place); setSheet(null); }}
                        className={`flex min-h-12 items-center rounded-lg pr-3 text-left text-[15px] disabled:text-gray-400 ${target.depth === 0 ? 'pl-3' : target.depth === 1 ? 'pl-7' : 'pl-11'} ${
                          target.tone === 'pool' ? 'font-medium text-violet-700 dark:text-violet-300' : target.tone === 'part' ? `font-semibold ${target.textClass ?? ''}` : 'text-gray-800 dark:text-gray-100'}`}>
                        <span className="min-w-0 flex-1 truncate">{target.label}</span>
                        {here && <span className="ml-2 shrink-0 text-sm font-normal">· {t('scratch.sort.hereNow')}</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </DialogPanel>
          </div>
        </Dialog>
        {confirmDialog}
      </div>
      {onBody && createPortal(
      <DragOverlay dropAnimation={DROP_ANIMATION}>
        {draggedNote ? (
          <div className="relative w-[min(22rem,80vw)] cursor-grabbing select-none">
            {carriedIds.length > 1 && (
              <>
                <div aria-hidden="true" className="absolute inset-0 translate-x-2 translate-y-2 rotate-2 rounded-xl border border-violet-200 bg-white dark:border-violet-800 dark:bg-gray-800" />
                <div aria-hidden="true" className="absolute inset-0 translate-x-1 translate-y-1 rotate-1 rounded-xl border border-violet-200 bg-white dark:border-violet-800 dark:bg-gray-800" />
              </>
            )}
            <div className="relative -rotate-1 scale-[1.02] rounded-xl border border-violet-300 bg-white p-3 text-sm leading-snug text-gray-800 shadow-2xl shadow-violet-900/20 dark:border-violet-500/60 dark:bg-gray-800 dark:text-gray-100">
              <p className="line-clamp-3 whitespace-pre-wrap break-words">{draggedNote.text}</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs font-semibold">
                {carriedIds.length > 1 && <span className="rounded-full bg-violet-600 px-2 py-0.5 text-white">{t(NOTE_COUNT_KEY, { count: carriedIds.length })}</span>}
                {aim && <span className="min-w-0 truncate rounded-full bg-violet-50 px-2 py-0.5 text-violet-800 dark:bg-violet-950 dark:text-violet-200">→ {aim.beforeId ? t('scratch.sort.dropBefore', { where: aim.label }) : aim.label}</span>}
              </div>
            </div>
          </div>
        ) : null}
      </DragOverlay>,
        document.body)}
    </DndContext>
  );
}
