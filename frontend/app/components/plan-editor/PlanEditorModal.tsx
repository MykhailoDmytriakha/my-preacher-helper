'use client';

import { ChevronDownIcon } from '@heroicons/react/20/solid';
import { ArrowUturnLeftIcon, ArrowUturnRightIcon, Squares2X2Icon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import OutlineBoard from '@/components/plan-editor/OutlineBoard';
import { usePlanTemplates } from '@/hooks/usePlanTemplates';
import { useScrollLock } from '@/hooks/useScrollLock';
import { updateSermonOutline } from '@/services/outline.service';
import { newClientId } from '@/utils/clientId';

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
  const { templates, createTemplate } = usePlanTemplates(sermon.userId);

  // Lock background page scroll while the modal is open.
  useScrollLock(isOpen);

  const [outline, setOutline] = useState<SermonOutline>(emptyOutline);
  const [undoStack, setUndoStack] = useState<SermonOutline[]>([]);
  const [redoStack, setRedoStack] = useState<SermonOutline[]>([]);
  const [templatesMenuOpen, setTemplatesMenuOpen] = useState(false);
  const [pendingApply, setPendingApply] = useState<SermonOutline | null>(null);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [saveAsName, setSaveAsName] = useState('');

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setOutline(fromSermon(sermon.outline));
      setUndoStack([]);
      setRedoStack([]);
      setTemplatesMenuOpen(false);
      setPendingApply(null);
      setClearConfirmOpen(false);
      setSaveAsOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, sermon.id]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !pendingApply && !saveAsOpen && !clearConfirmOpen) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, pendingApply, saveAsOpen, clearConfirmOpen]);

  useEffect(() => {
    if (!templatesMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setTemplatesMenuOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [templatesMenuOpen]);

  const persist = useCallback(
    (next: SermonOutline) => {
      if (isReadOnly || !sermon.id) return;
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(async () => {
        try {
          await updateSermonOutline(sermon.id, next);
          onOutlineUpdate?.(next);
        } catch (err) {
          console.error('PlanEditorModal: failed to save outline', err);
          toast.error(t('errors.saveOutlineError'));
        }
      }, 120);
    },
    [isReadOnly, sermon.id, onOutlineUpdate, t]
  );

  // Every committed change snapshots the current outline onto the undo stack and
  // drops the redo branch (a new action invalidates any "redo" path). Closure
  // values (not functional updaters) so no side-effects run inside a setState
  // updater — safe under StrictMode's double-invoke.
  const handleChange = useCallback(
    (next: SermonOutline) => {
      setUndoStack((s) => capPush(s, outline));
      setRedoStack([]);
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
    setOutline(previous);
    persist(previous);
  }, [undoStack, outline, persist]);

  const redo = useCallback(() => {
    if (redoStack.length === 0) return;
    const nextOutline = redoStack[redoStack.length - 1];
    setRedoStack(redoStack.slice(0, -1));
    setUndoStack((s) => capPush(s, outline));
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
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
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
  }, [isOpen, isReadOnly, undo, redo]);

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
    const name = saveAsName.trim();
    if (!name) return;
    try {
      await createTemplate({ id: newClientId(), userId: sermon.userId, name, structure: stripNotesFromOutline(outline) });
      toast.success(t('planEditor.templateSaved'));
      setSaveAsOpen(false);
      setSaveAsName('');
    } catch (err) {
      console.error('PlanEditorModal: failed to save template', err);
      toast.error(t('planEditor.templateSaveError'));
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
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6">
      <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('planEditor.title')}
        className="relative flex flex-col w-full h-full bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden"
      >
        <header className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-slate-200 dark:border-gray-700">
          <div className="flex items-center gap-2.5 min-w-0">
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

          <p className="hidden lg:block flex-1 px-6 text-center text-xs text-slate-400 dark:text-gray-500 truncate">
            {t('planEditor.hint')}
          </p>

          <div className="flex items-center gap-2 flex-shrink-0">
            {!isReadOnly && (
              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => setTemplatesMenuOpen((v) => !v)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-slate-50 dark:hover:bg-gray-700 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-gray-200"
                >
                  <Squares2X2Icon className="w-4 h-4 text-slate-500 dark:text-gray-400" />
                  {t('planEditor.templates')}
                  <ChevronDownIcon className="w-3.5 h-3.5 text-slate-400" />
                </button>

                {templatesMenuOpen && (
                  <div className="absolute right-0 mt-1.5 w-72 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-slate-200 dark:border-gray-700 py-1.5 z-20 max-h-80 overflow-y-auto">
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
                      href="/settings?section=planTemplates"
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

            <button
              onClick={onClose}
              aria-label={t('common.close')}
              className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-gray-800 hover:text-slate-600 dark:hover:text-gray-200"
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-hidden p-3 sm:p-4">
          <OutlineBoard
            value={outline}
            onChange={handleChange}
            isReadOnly={isReadOnly}
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
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-900/40 p-4">
            <div className="w-full max-w-sm bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-5">
              <h3 className="text-base font-semibold text-slate-800 dark:text-gray-100">{t('planEditor.apply.title')}</h3>
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
            </div>
          </div>
        )}

        {saveAsOpen && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-900/40 p-4">
            <div className="w-full max-w-sm bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-5">
              <h3 className="text-base font-semibold text-slate-800 dark:text-gray-100">{t('planEditor.saveAs.title')}</h3>
              <input
                type="text"
                value={saveAsName}
                onChange={(e) => setSaveAsName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveAsTemplate();
                  if (e.key === 'Escape') setSaveAsOpen(false);
                }}
                placeholder={t('planEditor.saveAs.namePlaceholder')}
                className="mt-3 w-full p-2 text-sm bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded border border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                autoFocus
              />
              <div className="mt-4 flex justify-end gap-2">
                <button
                  onClick={() => setSaveAsOpen(false)}
                  className="rounded-lg border border-slate-300 dark:border-gray-600 text-slate-600 dark:text-gray-300 text-sm font-medium px-4 py-2 hover:bg-slate-50 dark:hover:bg-gray-700"
                >
                  {t(CANCEL_KEY)}
                </button>
                <button
                  onClick={saveAsTemplate}
                  disabled={!saveAsName.trim()}
                  className="rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium px-4 py-2 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {t('planEditor.saveAs.save')}
                </button>
              </div>
            </div>
          </div>
        )}

        {clearConfirmOpen && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-900/40 p-4">
            <div className="w-full max-w-sm bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-5">
              <h3 className="text-base font-semibold text-slate-800 dark:text-gray-100">
                {t('planEditor.clearConfirm.title')}
              </h3>
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
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};

export default PlanEditorModal;
