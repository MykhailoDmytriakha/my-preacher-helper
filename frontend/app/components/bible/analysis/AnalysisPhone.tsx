'use client';

import { EllipsisHorizontalIcon } from '@heroicons/react/20/solid';
import { ArrowLeftIcon, ArrowUturnLeftIcon, ChevronLeftIcon, ChevronRightIcon, PencilSquareIcon } from '@heroicons/react/24/outline';
import { useEffect, useRef, useState, type ReactNode, type UIEvent } from 'react';
import { createPortal } from 'react-dom';

import { BibleIcon } from '@/components/bible/BibleIcon';
import { AnalysisIcon } from '@/components/Icons';
import Switch from '@/components/ui/Switch';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useModalLayer } from '@/hooks/useModalLayer';
import { useTranslation } from '@locales/useTranslation';

import type { AnalysisDoor, AnalysisMode } from './AnalysisParts';

/*
 * THE ANALYSIS ON A PHONE (the owner's choice on the canvas «Шапка разбора на телефоне», 2026-11-07, variant 4): the
 * header of the wide screen stood in four rows over a quarter of the screen. Here one bar of 48 px — back, the place, ⋯,
 * «Править»/«Готово» — that leaves the text while it is read and scrolled down, and comes back on a scroll up; the rare
 * things wait in ⋯; the arrows ‹ › of the line touched stand in a capsule at the bottom, so the text keeps no margin for
 * them. No marker, pencil or eraser here (the owner: «их не будет»).
 */

/**
 * The analysis takes its phone form on a narrow screen, and on a short one — a phone turned on its side stays a phone
 * (Codex, 07.11: turning it across 768 px swapped the whole form and dropped what ⋯ had open).
 */
const PHONE = '(max-width: 767px), (max-height: 500px)';
/** Narrower than this the side panel is not there, and what it says is said over the text. */
const NO_PANEL = '(max-width: 1023px)';

const matchesNow = (query: string) => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;

/** Whether the analysis takes its phone form; read at once on the first paint, so a phone never shows the wide header first. */
export function usePhoneAnalysis(): boolean {
  return useMediaQuery(PHONE, matchesNow(PHONE));
}

/** How far the text must go one way, counted from where it turned, before the bar follows: a tremor is not a scroll. */
const BAR_TRAVEL = 6;

/**
 * The bar's leaving and return: it leaves while the text is scrolled down in «Просмотр», past its own height, and comes
 * back on any scroll up or near the top. In «Правка» it stays — «Готово» is always at hand. The way is counted from where
 * the scroll last turned, so a slow scroll of many small steps counts as one (Codex, 07.11: six steps of 3 px up left it gone).
 */
export function useBarOnScroll(active: boolean) {
  const [hidden, setHidden] = useState(false);
  const last = useRef(0);
  const turnedAt = useRef(0);
  const going = useRef(0);
  useEffect(() => { if (!active) setHidden(false); }, [active]);
  const onScroll = (event: UIEvent<HTMLElement>) => {
    const top = event.currentTarget.scrollTop;
    const way = Math.sign(top - last.current);
    if (way !== 0 && way !== going.current) { going.current = way; turnedAt.current = last.current; }
    last.current = top;
    if (!active) return;
    if (top <= 48 || (going.current < 0 && turnedAt.current - top >= BAR_TRAVEL)) setHidden(false);
    else if (going.current > 0 && top - turnedAt.current >= BAR_TRAVEL) setHidden(true);
  };
  return { hidden: active && hidden, onScroll };
}

const ICON_BUTTON = 'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-gray-700 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-gray-200 dark:hover:bg-gray-900';

/** The bar: ← (in «Просмотр»), the place — pressed, its verses are chosen again — ⋯, and «Править» or «Готово». */
export function AnalysisPhoneBar({ place, mode, hidden, backLabel, onClose, onMode, onEditVerses, onMore }: {
  place: string; mode: AnalysisMode; hidden: boolean; backLabel?: string; onClose: () => void;
  /** Absent where nothing here can be changed (an analysis over another Bible). */
  onMode?: (mode: AnalysisMode) => void;
  onEditVerses?: () => void;
  onMore?: () => void;
}) {
  const { t } = useTranslation();
  const editing = Boolean(onMode) && mode === 'edit';
  const placeLook = 'min-w-0 flex-1 truncate px-1.5 text-left text-base font-bold text-gray-900 dark:text-gray-50';
  return (
    <header data-testid="analysis-phone-bar" data-hidden={hidden ? 'true' : undefined} inert={hidden}
      className={`absolute inset-x-0 top-0 z-20 border-b border-gray-200 bg-white/95 pt-[env(safe-area-inset-top)] backdrop-blur transition-transform duration-200 ease-out motion-reduce:transition-none dark:border-gray-800 dark:bg-gray-950/95 ${hidden ? '-translate-y-full' : ''}`}>
      <div className="flex h-12 items-center gap-1 px-2">
        {editing ? null : (
          <button type="button" onClick={onClose} aria-label={backLabel ?? t('analysis.back')} className={ICON_BUTTON}>
            <ArrowLeftIcon className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
        {onEditVerses ? (
          <button type="button" onClick={onEditVerses} aria-label={t('analysis.editVerses')} className={`${placeLook} h-10 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-900`}>{place}</button>
        ) : <h2 className={placeLook}>{place}</h2>}
        {onMore ? (
          <button type="button" onClick={onMore} aria-label={t('analysis.more')} aria-haspopup="dialog" className={ICON_BUTTON}>
            <EllipsisHorizontalIcon className="h-6 w-6" aria-hidden="true" />
          </button>
        ) : null}
        {onMode ? (
          <button type="button" onClick={() => onMode(editing ? 'view' : 'edit')}
            className={`h-10 shrink-0 rounded-xl px-2.5 text-base text-indigo-600 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300 dark:hover:bg-indigo-950 ${editing ? 'font-bold' : 'font-semibold'}`}>
            {t(editing ? 'analysis.done' : 'analysis.startEdit')}
          </button>
        ) : null}
      </div>
    </header>
  );
}

const SHEET_ROW = 'flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-base font-medium text-gray-800 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-gray-100 dark:hover:bg-gray-800';

/** ⋯ — what the wide screen keeps in its bar and side panel: all the links at once, the sermons, the other home, the verses. */
export function AnalysisMoreSheet({ onClose, allLinks, sermons, door, onEditVerses }: {
  onClose: () => void;
  allLinks?: { on: boolean; onToggle: () => void } | null;
  /** The sermons made from it and a new one (`AnalysisSermonsPanel`). */
  sermons?: ReactNode;
  door?: { home: AnalysisDoor['home']; onPress: () => void } | null;
  onEditVerses?: () => void;
}) {
  const { t } = useTranslation();
  const layer = useModalLayer({ onClose });
  // Over the analysis (z 120) by its number, not only by its place: the window that owns Escape, Back and the Tab ring is
  // the one with the highest z-index (`modalLayerRegistry.ts`; Codex, 07.11: at z 40 Escape closed the whole analysis).
  // Under a new sermon's form (z 130, `AnalysisSermons.tsx`), which opens from here.
  // Beside the analysis, not inside it: closed after the phone turned and ⋯ was gone, focus returns to the analysis — from
  // inside, the registry took the focus for already home and it fell to the page (Codex, second round).
  return createPortal(
    <div {...layer} role="dialog" aria-modal="true" aria-label={t('analysis.more')} className="fixed inset-0 z-[125] flex flex-col justify-end">
      <button type="button" tabIndex={-1} aria-label={t('common.close')} onClick={onClose} className="absolute inset-0 bg-black/50" />
      <div className="relative max-h-[80dvh] overflow-y-auto overscroll-contain rounded-t-3xl border-t border-gray-200 bg-white px-3 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-2 shadow-2xl dark:border-gray-700 dark:bg-gray-900">
        <span aria-hidden="true" className="mx-auto mb-2 block h-1 w-10 rounded-full bg-gray-300 dark:bg-gray-700" />
        {allLinks ? (
          <div className="px-1 pb-1">
            <Switch checked={allLinks.on} onClick={allLinks.onToggle} label={t('analysis.view.allLinks')} className="w-full justify-between [&>span:first-child]:text-base [&>span:first-child]:text-gray-800 dark:[&>span:first-child]:text-gray-100" />
          </div>
        ) : null}
        {sermons ? <div className="px-3 py-2 text-sm">{sermons}</div> : null}
        {door || onEditVerses ? <div aria-hidden="true" className="mx-3 my-1 h-px bg-gray-200 dark:bg-gray-800" /> : null}
        {door ? (
          <button type="button" onClick={door.onPress} className={SHEET_ROW}>
            {door.home === 'bible' ? <BibleIcon className="h-5 w-5 text-gray-500" aria-hidden="true" /> : <AnalysisIcon className="h-5 w-5 text-gray-500" aria-hidden="true" />}
            {t(`analysis.door.${door.home}`)}
          </button>
        ) : null}
        {onEditVerses ? (
          <button type="button" onClick={onEditVerses} className={SHEET_ROW}>
            <PencilSquareIcon className="h-5 w-5 text-gray-500" aria-hidden="true" />{t('analysis.editVerses')}
          </button>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

const STEP_ON = 'bg-white text-indigo-600 shadow-[inset_0_0_0_1px_#a5b4fc] hover:bg-indigo-50 dark:bg-gray-950 dark:text-indigo-300 dark:shadow-[inset_0_0_0_1px_#4338ca] dark:hover:bg-indigo-950';
const STEP_OFF = 'bg-white text-gray-300 shadow-[inset_0_0_0_1px_#e5e7eb] dark:bg-gray-950 dark:text-gray-600 dark:shadow-[inset_0_0_0_1px_#374151]';

/**
 * «Правка» on a phone: ‹ › for the line touched — the same steps as the arrows left of a line on a wide screen — and undo,
 * in a capsule at the bottom. No line touched yet: the arrows wait, pale, and say what to do.
 */
export function AnalysisEditCapsule({ line, up, down, canUndo, onUndo }: {
  /** The line touched, by its words, or null. */
  line: string | null;
  up: (() => void) | null; down: (() => void) | null; canUndo: boolean; onUndo: () => void;
}) {
  const { t } = useTranslation();
  const step = (side: 'up' | 'down', onPress: (() => void) | null) => {
    const Icon = side === 'up' ? ChevronLeftIcon : ChevronRightIcon;
    return (
      <button type="button" aria-label={t(side === 'up' ? 'analysis.level.up' : 'analysis.level.down')} disabled={!onPress} onClick={() => onPress?.()}
        className={`inline-flex h-10 w-10 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${onPress ? STEP_ON : STEP_OFF}`}>
        <Icon className="h-[18px] w-[18px]" strokeWidth={2.2} aria-hidden="true" />
      </button>
    );
  };
  return (
    <div role="toolbar" aria-label={line ? t('analysis.phone.line', { part: line }) : t('analysis.phone.pickLine')}
      className="flex items-center gap-2 rounded-full border border-gray-200 bg-white py-1.5 pl-2 pr-1.5 shadow-xl dark:border-gray-700 dark:bg-gray-900">
      {line ? null : <span className="pl-2 pr-1 text-sm text-gray-500 dark:text-gray-400">{t('analysis.phone.pickLine')}</span>}
      {step('up', up)}
      {step('down', down)}
      <span aria-hidden="true" className="h-7 w-px bg-gray-200 dark:bg-gray-700" />
      <button type="button" aria-label={t('analysis.undo')} disabled={!canUndo} onClick={onUndo}
        className="inline-flex h-10 w-10 items-center justify-center rounded-full text-gray-700 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-40 dark:text-gray-200 dark:hover:bg-gray-800">
        <ArrowUturnLeftIcon className="h-[18px] w-[18px]" aria-hidden="true" />
      </button>
    </div>
  );
}

/** How long what the analysis says stays over the text where no side panel holds it. */
const SAID_MS = 5_000;

/**
 * What the analysis says — a tie made, a tie refused — where the side panel is not there (BUG-20261107-analysis-messages-
 * hidden-below-lg: on a phone and an iPad upright a refused drag said nothing at all). Over the text, at the bottom; it
 * goes by itself.
 */
export function useSaidOverText(message: { text: string; warn: boolean } | null, clear: () => void) {
  const noPanel = useMediaQuery(NO_PANEL, matchesNow(NO_PANEL));
  const shown = noPanel ? message : null;
  const clearRef = useRef(clear);
  useEffect(() => { clearRef.current = clear; });
  useEffect(() => {
    if (!shown) return undefined;
    const timer = setTimeout(() => clearRef.current(), SAID_MS);
    return () => clearTimeout(timer);
  }, [shown]);
  return shown;
}

export function SaidOverText({ message }: { message: { text: string; warn: boolean } }) {
  return (
    <p role="status" className={`max-w-[min(26rem,calc(100vw-2rem))] rounded-2xl px-3.5 py-2 text-sm leading-snug shadow-lg ${message.warn ? 'bg-rose-50 text-rose-800 ring-1 ring-rose-200 dark:bg-rose-950 dark:text-rose-100 dark:ring-rose-900' : 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-100 dark:ring-emerald-900'}`}>
      {message.text}
    </p>
  );
}
