'use client';

import { ChevronDownIcon } from '@heroicons/react/20/solid';
import { ArrowUturnLeftIcon, ArrowUturnRightIcon, Squares2X2Icon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';

import OutlineBoard from '@/components/plan-editor/OutlineBoard';
import { useOutlineConflictForEditor } from '@/components/plan-editor/OutlineConflictScope';
import SavedDraftCopyPicker from '@/components/SavedDraftCopyPicker';
import { useStructureWriter } from '@/components/sermon/structureWriter';
import UnreadableConflictDrafts from '@/components/UnreadableConflictDrafts';
import { useModalLayer } from '@/hooks/useModalLayer';
import { usePanelPosition } from '@/hooks/usePanelPosition';
import { usePlanTemplates } from '@/hooks/usePlanTemplates';
import { isOutlineCollisionError } from '@/services/sermons.client';
import { newClientId } from '@/utils/clientId';
import { keyboardReaches } from '@/utils/modalLayerRegistry';
import { OutlineCapture } from '@/utils/outlineCapture';
import { chooseOutlineLocalChanges, OutlineChoiceReviewRequiredError } from '@/utils/outlineChoice';
import { awaitWriteOperation } from '@/utils/recoverableWrite';
import { EMERALD_ACTION } from '@/utils/themeColors';
import { isTypingIn } from '@/utils/typingTarget';
import { writeFailureTranslationKey } from '@/utils/writeRecovery';
import { useTranslation } from '@locales/useTranslation';

import type { OutlinePoint, Sermon, SermonOutline, SubPoint } from '@/models/models';

const emptyOutline = (): SermonOutline => ({ introduction: [], main: [], conclusion: [] });
type OutlineSectionKey = keyof SermonOutline;

const CANCEL_KEY = 'common.cancel';

// Bounded undo/redo history ("a few steps", no unbounded growth). One entry per
// completed action (add/delete/edit/move point, apply template, clear).
const MAX_HISTORY = 30;
const capPush = (stack: SermonOutline[], item: SermonOutline): SermonOutline[] => {
  const next = [...stack, item];
  return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
};

const fromSermon = (outline?: SermonOutline | null): SermonOutline => ({
  introduction: outline?.introduction ?? [],
  main: outline?.main ?? [],
  conclusion: outline?.conclusion ?? [],
});

const countPoints = (outline: SermonOutline): number =>
  (outline.introduction?.length ?? 0) + (outline.main?.length ?? 0) + (outline.conclusion?.length ?? 0);

// Deep-clone a section assigning fresh ids, so applying a template never collides
// with existing ids (each applied point is a distinct, editable copy).
const cloneSectionWithFreshIds = (points: OutlinePoint[]): OutlinePoint[] =>
  points.map((p) => ({
    id: newClientId(),
    text: p.text,
    ...(p.isReviewed !== undefined ? { isReviewed: p.isReviewed } : {}),
    ...(p.subPoints && p.subPoints.length > 0
      ? {
          subPoints: p.subPoints.map((sp, idx): SubPoint => ({
            id: newClientId(),
            text: sp.text,
            position: (idx + 1) * 1000,
          })),
        }
      : {}),
  }));

// Reminder notes are personal to this sermon — they must never leak into a reusable
// template. Rebuild each point/sub-point WITHOUT `note` (mirrors cloneSectionWithFreshIds).
const stripNotesFromOutline = (outline: SermonOutline): SermonOutline => {
  const strip = (points: OutlinePoint[]): OutlinePoint[] =>
    points.map((p) => {
      const cleaned: OutlinePoint = { id: p.id, text: p.text };
      if (p.isReviewed !== undefined) cleaned.isReviewed = p.isReviewed;
      if (p.subPoints && p.subPoints.length > 0) {
        cleaned.subPoints = p.subPoints.map((sp) => ({ id: sp.id, text: sp.text, position: sp.position }));
      }
      return cleaned;
    });
  return {
    introduction: strip(outline.introduction),
    main: strip(outline.main),
    conclusion: strip(outline.conclusion),
  };
};

interface PlanEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  sermon: Sermon;
  onOutlineUpdate?: (outline: SermonOutline) => void;
  onOutlinePointDeleted?: (pointId: string) => void;
  onSubPointDeleted?: (pointId: string, subPointId: string) => void;
  onOutlinePointMoved?: (pointId: string, destinationSection: OutlineSectionKey, updatedOutline: SermonOutline) => void;
  onSubPointMoved?: (
    subPointId: string,
    sourcePointId: string,
    destinationPointId: string,
    destinationSection: OutlineSectionKey,
    updatedOutline: SermonOutline
  ) => void;
  isReadOnly?: boolean;
}

/** These questions sit inside the portalled editor and take its keyboard while open. */
function PlanEditorQuestion({ title, onClose, closeDisabled, returnFocusTo, children }: {
  title: string;
  onClose: () => void;
  closeDisabled?: boolean;
  returnFocusTo?: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
}) {
  const titleId = useId();
  const layer = useModalLayer({ onClose, closeDisabled, returnFocusTo });
  return (
    <div {...layer} className="absolute inset-0 z-[201] flex items-center justify-center bg-slate-900/40 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="w-full max-w-sm bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-5">
        <h3 id={titleId} className="text-base font-semibold text-slate-800 dark:text-gray-100">{title}</h3>
        {children}
      </div>
    </div>
  );
}

const PlanEditorModal: React.FC<PlanEditorModalProps> = ({
  isOpen,
  onClose,
  sermon,
  onOutlineUpdate,
  onOutlinePointDeleted,
  onSubPointDeleted,
  onOutlinePointMoved,
  onSubPointMoved,
  isReadOnly = false,
}) => {
  const { t } = useTranslation();
  // The page's public engine writer owns local capture and durable delivery.
  const writer = useStructureWriter();
  const { templates, createTemplate } = usePlanTemplates(sermon.userId);

  const [outline, setOutline] = useState<SermonOutline>(emptyOutline);
  const [undoStack, setUndoStack] = useState<SermonOutline[]>([]);
  const [redoStack, setRedoStack] = useState<SermonOutline[]>([]);
  const [templatesMenuOpen, setTemplatesMenuOpen] = useState(false);
  const [pendingApply, setPendingApply] = useState<SermonOutline | null>(null);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [wholeReviewOpen, setWholeReviewOpen] = useState(false);

  /*
   * One rule for every window: the page lock, Escape and "am I the topmost window". Escape is
   * refused while an apply is in flight or a nested dialog is open — those own the key then.
   */
  const questionOpen = Boolean(pendingApply) || saveAsOpen || clearConfirmOpen;
  const layer = useModalLayer({ onClose, active: isOpen, closeDisabled: questionOpen });
  const [saveAsName, setSaveAsName] = useState('');
  const saveAsNameRef = useRef(saveAsName);
  saveAsNameRef.current = saveAsName;
  const [savingTemplate, setSavingTemplate] = useState(false);
  const savingTemplateRef = useRef(false);

  const saveQueue = useMemo(() => new OutlineCapture(writer, sermon.id), [writer, sermon.id]);
  const sessionRef = useRef(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const templatesPanelRef = useRef<HTMLDivElement>(null);
  const templatesButtonRef = useRef<HTMLButtonElement>(null);
  usePanelPosition(templatesPanelRef, isOpen && templatesMenuOpen && !isReadOnly);
  const outlineRef = useRef<SermonOutline>(emptyOutline());

  /**
   * THE PLAN THIS EDITOR OPENED WITH — and, after each save, what the server
   * actually committed.
   *
   * It is what lets the write MERGE instead of replace. Without it, saving the plan
   * from a laptop that has been open since last night wipes the point added from a
   * phone this morning, silently: the plan is one whole field, so the laptop's
   * snapshot simply becomes the new truth.
   */
  const baseOutlineRef = useRef<SermonOutline | null>(null);
  /**
   * The same point was rewritten here AND on the other device. Nothing is written
   * and nothing is guessed — the person decides, and their text stays on screen.
   *
   * Stored DURABLY, not in component state. Escape, the backdrop, the X and "Done"
   * all close this modal, and while the refusal lived in state alone, any of them
   * threw away the only copy of the refused plan — the modal reopened from the
   * server and the laptop's work was simply gone. Now closing is safe: the text and
   * the question come back.
   */
  const ownConflictController = useOutlineConflictForEditor(sermon.userId, sermon.id, isOpen);
  const {record:storedCollision,ready:conflictReady,get:getConflict,ask:askConflict,edit:editConflict,
    select:selectConflict,clear:clearConflict,retire:retireConflict,requireWholeReview,
    choices:conflictChoices,choose:chooseConflictCopy,activation:conflictActivation} = ownConflictController;
  const collision = storedCollision && storedCollision.payload.resolution !== 'local'
    ? {serverOutline:storedCollision.payload.serverOutline} : null;
  const unreviewedRefusal = !collision
    ? conflictChoices.copies.find(copy => copy.value.payload.resolution !== 'local') ?? null
    : null;
  const needsWholeChoice = Boolean(collision && storedCollision && (storedCollision.payload.reviewWhole
    || !Object.prototype.hasOwnProperty.call(storedCollision.payload, 'baseOutline')));
  const setCollision = useCallback((next:{serverOutline:SermonOutline | null} | null, refused?:SermonOutline,
    base:SermonOutline | null=baseOutlineRef.current) => {
    if (!next) clearConflict();
    else askConflict(refused ?? outlineRef.current,base,next.serverOutline);
  },[askConflict,clearConflict]);
  const persistRef = useRef<((next:SermonOutline,options?:{force?:boolean}) => void) | null>(null);

  outlineRef.current = outline;

  useEffect(() => {
    if (!isOpen || !conflictReady) return;
    const saved=getConflict()?.payload;
    const recovered=saved?.outline ?? fromSermon(sermon.outline);
    setOutline(recovered);
    outlineRef.current=recovered;
    baseOutlineRef.current=saved && Object.prototype.hasOwnProperty.call(saved,'baseOutline')
      ? saved.baseOutline ?? null : fromSermon(sermon.outline);
    generationRef.current+=1;
    setUndoStack([]);
    setRedoStack([]);
    setTemplatesMenuOpen(false);
    setPendingApply(null);
    setClearConfirmOpen(false);
    setSaveAsOpen(false);
    setWholeReviewOpen(false);
    sessionRef.current += 1;
    if (saved?.resolution==='local') persistRef.current?.(recovered,{force:true});
    return () => {
      sessionRef.current += 1;
      // Every accepted input has already reached the engine. Selected input also
      // keeps its durable backup until an exact current capture retires it.
      void saveQueue.flush();
    };
    // Opening is an identity boundary, not an invitation to replace later typing from props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[isOpen,sermon.userId,sermon.id,conflictReady,saveQueue,conflictActivation]);


  useEffect(() => {
    if (!templatesMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setTemplatesMenuOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [templatesMenuOpen]);

  /**
   * Which local version of the plan is on screen right now.
   *
   * It exists because a response can arrive AFTER the person has typed more. The
   * first version of this code applied whatever came back unconditionally, so an
   * answer to the edit of point 1 wiped the edit of point 2 out from under the
   * cursor — text lost while the app looked like it was saving, and strictly worse
   * than before, when nothing was applied back at all.
   */
  const generationRef = useRef(0);

  const persist = useCallback(
    (next: SermonOutline, options?: { force?: boolean }) => {
      if (isReadOnly || !sermon.id || !conflictReady) return;
      const pending = getConflict();
      if (pending && pending.payload.resolution !== 'local' && !options?.force) {
        editConflict(next);
        return;
      }
      if (pending?.payload.resolution === 'local') editConflict(next);
      const generationAtRequest = generationRef.current;
      const sessionAtRequest = sessionRef.current;
      saveQueue.schedule({
        outline: next,
        base: baseOutlineRef.current,
        begin: () => {
          const waiting = getConflict();
          return {
            stored: stored => {
              if (sessionRef.current !== sessionAtRequest) return;
              baseOutlineRef.current = stored;
              if (generationRef.current === generationAtRequest) {
                // This exact selected value is now kept by the engine on this device.
                retireConflict(waiting);
                outlineRef.current = stored;
                setOutline(stored);
                onOutlineUpdate?.(stored);
              }
            },
            failed: (err, refused, baseAtRequest) => {
              const currentSession = sessionRef.current === sessionAtRequest;
              // A departed selected write already has a durable home. A later editor may
              // have captured its continuation; this old answer cannot restore the question.
              if (!currentSession && waiting?.payload.resolution === 'local') return;
              if (isOutlineCollisionError(err)) {
                const baseline = err.baseline;
                setCollision({ serverOutline: err.serverOutline }, refused, baseline ? baseline.outline : baseAtRequest);
                return;
              }
              if (!currentSession) return;
              console.error('PlanEditorModal: failed to save outline', err);
              toast.error(t(writeFailureTranslationKey(err, 'errors.saveOutlineError')));
            },
          };
        },
      });
    },
    [isReadOnly, sermon.id, conflictReady, onOutlineUpdate, setCollision, getConflict, editConflict, retireConflict, t, saveQueue]
  );

  persistRef.current=persist;

  // Every committed change snapshots the current outline onto the undo stack and
  // drops the redo branch (a new action invalidates any "redo" path). Closure
  // values (not functional updaters) so no side-effects run inside a setState
  // updater — safe under StrictMode's double-invoke.
  const handleChange = useCallback(
    (next: SermonOutline) => {
      setUndoStack((s) => capPush(s, outline));
      setRedoStack([]);
      generationRef.current += 1;
      setOutline(next);
      persist(next);
    },
    [outline, persist]
  );

  const undo = useCallback(() => {
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack(undoStack.slice(0, -1));
    setRedoStack((r) => capPush(r, outline));
    generationRef.current += 1;
    setOutline(previous);
    persist(previous);
  }, [undoStack, outline, persist]);

  const redo = useCallback(() => {
    if (redoStack.length === 0) return;
    const nextOutline = redoStack[redoStack.length - 1];
    setRedoStack(redoStack.slice(0, -1));
    setUndoStack((s) => capPush(s, outline));
    generationRef.current += 1;
    setOutline(nextOutline);
    persist(nextOutline);
  }, [redoStack, outline, persist]);

  const clearPlan = () => {
    setClearConfirmOpen(false);
    handleChange(emptyOutline());
  };

  // ⌘Z / ⌘⇧Z (⌘Y) — but leave a focused text field's own undo alone.
  useEffect(() => {
    if (!isOpen || isReadOnly) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (!keyboardReaches(layer.ref.current) || isTypingIn(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        redo();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, isReadOnly, layer.ref, undo, redo]);

  const totalPoints = useMemo(() => countPoints(outline), [outline]);

  const requestApplyTemplate = (structure: SermonOutline) => {
    setTemplatesMenuOpen(false);
    if (totalPoints === 0) {
      applyTemplate(structure, 'replace');
    } else {
      setPendingApply(structure);
    }
  };

  const applyTemplate = (structure: SermonOutline, mode: 'replace' | 'append') => {
    const src = fromSermon(structure);
    const next: SermonOutline =
      mode === 'replace'
        ? {
            introduction: cloneSectionWithFreshIds(src.introduction),
            main: cloneSectionWithFreshIds(src.main),
            conclusion: cloneSectionWithFreshIds(src.conclusion),
          }
        : {
            introduction: [...outline.introduction, ...cloneSectionWithFreshIds(src.introduction)],
            main: [...outline.main, ...cloneSectionWithFreshIds(src.main)],
            conclusion: [...outline.conclusion, ...cloneSectionWithFreshIds(src.conclusion)],
          };
    setPendingApply(null);
    handleChange(next);
    toast.success(t('planEditor.templateApplied'));
  };

  const saveAsTemplate = async () => {
    const submittedName = saveAsName;
    const name = submittedName.trim();
    if (!name || savingTemplateRef.current) return;
    savingTemplateRef.current = true;
    setSavingTemplate(true);
    const reportFailure = (error: unknown) => {
      console.error('PlanEditorModal: failed to save template', error);
      toast.error(t('planTemplates.createError'));
    };
    try {
      await awaitWriteOperation(
        createTemplate({ id: newClientId(), userId: sermon.userId, name, structure: stripNotesFromOutline(outline) }),
        reportFailure
      );
      if (saveAsNameRef.current === submittedName) {
        setSaveAsOpen(false);
        setSaveAsName('');
      }
    } catch (error) {
      reportFailure(error);
    } finally {
      savingTemplateRef.current = false;
      setSavingTemplate(false);
    }
  };

  const getSubPointThoughtCount = useCallback(
    (subPointId: string) => sermon.thoughts.filter((th) => th.subPointId === subPointId).length,
    [sermon.thoughts]
  );

  const getPointThoughtCount = useCallback(
    (pointId: string) => sermon.thoughts.filter((th) => th.outlinePointId === pointId).length,
    [sermon.thoughts]
  );

  // Render into <body> via a portal so `fixed inset-0` is relative to the viewport
  // (not a transformed ancestor like the framer-motion slider), and the backdrop
  // covers the whole screen — including the sticky top nav.
  if (!isOpen || typeof document === 'undefined') return null;

  return createPortal(
    <div {...layer} className="fixed inset-0 z-[200] flex items-center justify-center overscroll-contain p-4 sm:p-6">
      <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm" onClick={questionOpen ? undefined : onClose} aria-hidden="true" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('planEditor.title')}
        className="relative flex flex-col w-full h-full bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden"
      >
        <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-4 sm:grid-cols-[minmax(0,auto)_minmax(0,1fr)_auto_auto] sm:px-5 py-3 border-b border-slate-200 dark:border-gray-700">
          <div className="col-start-1 row-start-1 flex items-center gap-2.5 min-w-0">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-300 flex-shrink-0">
              <Squares2X2Icon className="w-5 h-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold text-slate-800 dark:text-gray-100 leading-tight truncate">
                {t('planEditor.title')}
              </h2>
              {sermon.title && (
                <p className="text-xs text-slate-400 dark:text-gray-500 leading-tight truncate">{sermon.title}</p>
              )}
            </div>

            {!isReadOnly && (
              <div className="flex items-center rounded-lg border border-slate-300 dark:border-gray-600 overflow-hidden flex-shrink-0">
                <button
                  onClick={undo}
                  disabled={undoStack.length === 0}
                  aria-label={t('planEditor.undo')}
                  title={t('planEditor.undo')}
                  className="px-2 py-1.5 text-slate-600 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-gray-700 disabled:text-slate-300 dark:disabled:text-gray-600 disabled:hover:bg-transparent border-r border-slate-300 dark:border-gray-600"
                >
                  <ArrowUturnLeftIcon className="w-4 h-4" />
                </button>
                <button
                  onClick={redo}
                  disabled={redoStack.length === 0}
                  aria-label={t('planEditor.redo')}
                  title={t('planEditor.redo')}
                  className="px-2 py-1.5 text-slate-600 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-gray-700 disabled:text-slate-300 dark:disabled:text-gray-600 disabled:hover:bg-transparent"
                >
                  <ArrowUturnRightIcon className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          <p className="col-start-2 row-start-1 hidden lg:block px-6 text-center text-xs text-slate-400 dark:text-gray-500 truncate">
            {t('planEditor.hint')}
          </p>

          <div className="col-span-2 row-start-2 flex max-w-full flex-wrap items-center gap-2 sm:col-span-1 sm:col-start-3 sm:row-start-1">
            {!isReadOnly && (
              <div className="relative" ref={menuRef}>
                <button
                  ref={templatesButtonRef}
                  onClick={() => setTemplatesMenuOpen((v) => !v)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-slate-50 dark:hover:bg-gray-700 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-gray-200"
                >
                  <Squares2X2Icon className="w-4 h-4 text-slate-500 dark:text-gray-400" />
                  {t('planEditor.templates')}
                  <ChevronDownIcon className="w-3.5 h-3.5 text-slate-400" />
                </button>

                {templatesMenuOpen && (
                  <div ref={templatesPanelRef} className="absolute right-0 mt-1.5 w-72 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-slate-200 dark:border-gray-700 py-1.5 z-20 max-h-80 overflow-y-auto">
                    <p className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-gray-500">
                      {t('planEditor.applyTemplate')}
                    </p>
                    {templates.length === 0 ? (
                      <p className="px-3 py-2 text-sm text-slate-400 dark:text-gray-500">{t('planEditor.noTemplates')}</p>
                    ) : (
                      templates.map((tpl) => (
                        <button
                          key={tpl.id}
                          onClick={() => requestApplyTemplate(tpl.structure)}
                          className="w-full text-left px-3 py-2 hover:bg-slate-50 dark:hover:bg-gray-700 text-sm text-slate-700 dark:text-gray-200 flex items-center justify-between gap-2"
                        >
                          <span className="truncate">{tpl.name}</span>
                          <span className="text-[11px] text-slate-400 flex-shrink-0">{countPoints(tpl.structure)}</span>
                        </button>
                      ))
                    )}
                    <div className="my-1 border-t border-slate-100 dark:border-gray-700" />
                    <button
                      onClick={() => {
                        setTemplatesMenuOpen(false);
                        setSaveAsName('');
                        setSaveAsOpen(true);
                      }}
                      disabled={totalPoints === 0}
                      className="w-full text-left px-3 py-2 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 text-sm text-emerald-700 dark:text-emerald-400 font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {t('planEditor.saveAsTemplate')}
                    </button>
                    <Link
                      href="/settings/templates"
                      className="block px-3 py-2 hover:bg-slate-50 dark:hover:bg-gray-700 text-sm text-slate-500 dark:text-gray-400"
                    >
                      {t('planEditor.manageTemplates')}
                    </Link>
                  </div>
                )}
              </div>
            )}

            {!isReadOnly && (
              <button
                onClick={() => setClearConfirmOpen(true)}
                disabled={totalPoints === 0}
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 dark:border-rose-900/50 bg-white dark:bg-gray-800 hover:bg-rose-50 dark:hover:bg-rose-900/20 px-3 py-1.5 text-sm font-medium text-rose-600 dark:text-rose-400 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <TrashIcon className="w-4 h-4" />
                {t('planEditor.clear')}
              </button>
            )}

          </div>

          <button
            onClick={onClose}
            aria-label={t('common.close')}
            className="col-start-2 row-start-1 inline-flex items-center justify-center w-8 h-8 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-gray-800 hover:text-slate-600 dark:hover:text-gray-200 sm:col-start-4"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </header>

        <UnreadableConflictDrafts owner={sermon.userId} sources={conflictChoices.unreadableSources} failed={conflictChoices.unreadableFailed} />

        {/* A refusal preserves both copies. New records allow a scoped choice; older
            records without an ancestor require an explicit whole-structure review. */}
        {collision && (
          <div
            role="alert"
            className="mx-3 mt-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-500/40 dark:bg-amber-500/10 sm:mx-4"
          >
            <p className="font-medium text-amber-900 dark:text-amber-200">
              {t('freshness.conflictTitle')}
            </p>
            <p className="mt-0.5 text-amber-800/80 dark:text-amber-200/70">
              {needsWholeChoice ? t('planEditor.wholeStructureDescription')
                : t('freshness.conflictDescription', { entity: t('freshness.entitySermon') })}
            </p>
            <SavedDraftCopyPicker
              options={conflictChoices.copies.map(copy => ({ key: copy.key,
                label: [...copy.value.payload.outline.introduction, ...copy.value.payload.outline.main, ...copy.value.payload.outline.conclusion]
                  .map(point => point.text).join(' · ') || t('plan.draftRecoveryEmpty') }))}
              selectedKey={conflictChoices.selectedKey}
              onChange={chooseConflictCopy}
              className="mt-3 block"
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  if (needsWholeChoice && !wholeReviewOpen) return;
                  let chosen: SermonOutline;
                  try {
                    chosen = needsWholeChoice ? outline
                      : chooseOutlineLocalChanges(baseOutlineRef.current, outline, collision.serverOutline);
                  } catch (error) {
                    if (!(error instanceof OutlineChoiceReviewRequiredError)) throw error;
                    requireWholeReview();
                    setWholeReviewOpen(false);
                    return;
                  }
                  // The choice covers only this shown snapshot. A later unknown edit is
                  // still checked by the ordinary writer; its backup remains until capture.
                  baseOutlineRef.current = collision.serverOutline;
                  selectConflict(chosen,collision.serverOutline);
                  setOutline(chosen);
                  outlineRef.current=chosen;
                  persist(chosen, { force: true });
                }}
                disabled={needsWholeChoice && !wholeReviewOpen}
                className="rounded-lg bg-amber-600 px-3 py-1.5 font-medium text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
              >
                {t(needsWholeChoice ? 'planEditor.useWholeLocalStructure' : 'freshness.conflictKeepMine')}
              </button>
              {needsWholeChoice && (
                <button type="button" onClick={() => setWholeReviewOpen(true)}
                  className="rounded-lg border border-amber-300 px-3 py-1.5 font-medium text-amber-900 dark:border-amber-500/40 dark:text-amber-200">
                  {t('planEditor.reviewCurrentStructure')}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  const theirs = fromSermon(collision.serverOutline);
                  baseOutlineRef.current = theirs;
                  setCollision(null);
                  generationRef.current += 1;
                  setOutline(theirs);
                  onOutlineUpdate?.(theirs);
                }}
                className="rounded-lg border border-amber-300 px-3 py-1.5 font-medium text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-500/40 dark:text-amber-200 dark:hover:bg-amber-500/20"
              >
                {t('freshness.conflictTakeTheirs')}
              </button>
            </div>
          </div>
        )}
        {!collision && unreviewedRefusal && (
          <div role="alert" className="mx-3 mt-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-500/40 dark:bg-amber-500/10 sm:mx-4">
            <p className="font-medium text-amber-900 dark:text-amber-200">{t('freshness.conflictTitle')}</p>
            <p className="mt-0.5 text-amber-800/80 dark:text-amber-200/70">
              {t('freshness.conflictDescription', { entity: t('freshness.entitySermon') })}
            </p>
            <button type="button" onClick={() => chooseConflictCopy(unreviewedRefusal.key)}
              className="mt-3 rounded-lg bg-amber-600 px-3 py-1.5 font-medium text-white hover:bg-amber-700">
              {t('freshness.reviewAction')}
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-3 sm:p-4">
          {collision && needsWholeChoice && wholeReviewOpen && (
            <section aria-label={t('planEditor.currentStructure')} className="mb-5 rounded-xl border border-slate-300 p-3 dark:border-gray-600">
              <h3 className="mb-3 font-semibold text-slate-800 dark:text-gray-100">{t('planEditor.currentStructure')}</h3>
              <OutlineBoard value={fromSermon(collision.serverOutline)} onChange={() => undefined} isReadOnly showNotes />
            </section>
          )}
          {needsWholeChoice && <h3 className="mb-3 font-semibold text-slate-800 dark:text-gray-100">{t('planEditor.localStructure')}</h3>}
          <OutlineBoard
            value={outline}
            onChange={handleChange}
            isReadOnly={isReadOnly || !conflictReady}
            showNotes
            getSubPointThoughtCount={getSubPointThoughtCount}
            getPointThoughtCount={getPointThoughtCount}
            onPointDeleted={onOutlinePointDeleted}
            onSubPointDeleted={onSubPointDeleted}
            onOutlinePointMoved={onOutlinePointMoved}
            onSubPointMoved={onSubPointMoved}
          />
        </div>

        <footer className="flex items-center justify-between px-4 sm:px-5 py-3 border-t border-slate-200 dark:border-gray-700">
          <span className="text-xs text-slate-400 dark:text-gray-500">{t('planEditor.autoSaved')}</span>
          <button
            onClick={onClose}
            className="rounded-lg bg-slate-800 hover:bg-slate-900 dark:bg-indigo-600 dark:hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2"
          >
            {t('common.done')}
          </button>
        </footer>

        {pendingApply && (
          <PlanEditorQuestion title={t('planEditor.apply.title')} onClose={() => setPendingApply(null)} returnFocusTo={templatesButtonRef}>
            <p className="mt-2 text-sm text-slate-500 dark:text-gray-400">{t('planEditor.apply.message', { count: totalPoints })}</p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                onClick={() => applyTemplate(pendingApply, 'replace')}
                className="w-full rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium px-4 py-2"
              >
                {t('planEditor.apply.replace')}
              </button>
              <button
                onClick={() => applyTemplate(pendingApply, 'append')}
                className="w-full rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2"
              >
                {t('planEditor.apply.append')}
              </button>
              <button
                onClick={() => setPendingApply(null)}
                className="w-full rounded-lg border border-slate-300 dark:border-gray-600 text-slate-600 dark:text-gray-300 text-sm font-medium px-4 py-2 hover:bg-slate-50 dark:hover:bg-gray-700"
              >
                {t(CANCEL_KEY)}
              </button>
            </div>
          </PlanEditorQuestion>
        )}

        {saveAsOpen && (
          <PlanEditorQuestion title={t('planEditor.saveAs.title')} onClose={() => setSaveAsOpen(false)} returnFocusTo={templatesButtonRef} closeDisabled={savingTemplate}>
            <input
              type="text"
              value={saveAsName}
              onChange={(e) => setSaveAsName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveAsTemplate();
              }}
              placeholder={t('planEditor.saveAs.namePlaceholder')}
              className="mt-3 w-full p-2 text-sm bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded border border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              autoFocus
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setSaveAsOpen(false)}
                disabled={savingTemplate}
                className="rounded-lg border border-slate-300 dark:border-gray-600 text-slate-600 dark:text-gray-300 text-sm font-medium px-4 py-2 hover:bg-slate-50 dark:hover:bg-gray-700"
              >
                {t(CANCEL_KEY)}
              </button>
              <button
                onClick={saveAsTemplate}
                disabled={savingTemplate || !saveAsName.trim()}
                aria-busy={savingTemplate}
                className={`${EMERALD_ACTION} rounded-lg text-sm font-medium px-4 py-2 disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                {t('planEditor.saveAs.save')}
              </button>
            </div>
          </PlanEditorQuestion>
        )}

        {clearConfirmOpen && (
          <PlanEditorQuestion title={t('planEditor.clearConfirm.title')} onClose={() => setClearConfirmOpen(false)}>
            <p className="mt-2 text-sm text-slate-500 dark:text-gray-400">
              {t('planEditor.clearConfirm.message', { count: totalPoints })}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setClearConfirmOpen(false)}
                className="rounded-lg border border-slate-300 dark:border-gray-600 text-slate-600 dark:text-gray-300 text-sm font-medium px-4 py-2 hover:bg-slate-50 dark:hover:bg-gray-700"
              >
                {t(CANCEL_KEY)}
              </button>
              <button
                onClick={clearPlan}
                className="rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium px-4 py-2"
              >
                {t('planEditor.clearConfirm.confirm')}
              </button>
            </div>
          </PlanEditorQuestion>
        )}
      </div>
    </div>,
    document.body
  );
};

export default PlanEditorModal;
