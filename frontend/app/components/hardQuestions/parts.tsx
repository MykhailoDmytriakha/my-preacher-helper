'use client';

import { ChevronRightIcon, ClockIcon, QuestionMarkCircleIcon } from '@heroicons/react/24/outline';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

import Tooltip from '@/components/ui/Tooltip';
import { isWaiting } from '@/utils/hardQuestions';
import { CARE_CARD_TONES } from '@/utils/themeColors';
import { useTranslation } from '@locales/useTranslation';

import type { HardQuestion, HardQuestionBasis } from '@/models/models';
import type { ReactNode } from 'react';

/**
 * The pieces every screen of the hard questions shares: its colours, the way back, the label over a
 * list, a question's row.
 *
 * COLOUR. Rose is the section's name, not its paint: the title and its icon, the one main button,
 * focus — the colour of the pastor's own card on `/care`. A page of rose wore out the eyes within
 * minutes (the owner, 2026-11-26: «вся красная тема … глаза начинает выедать»), so the rest speaks
 * the app's own words: Scripture in the indigo of every reference in the app's texts, the bases in
 * amber (the one colour that is theirs alone), and everything else — the way back, quiet actions,
 * what waits for an answer, the short answer — in the app's greys.
 */
export const ROSE = CARE_CARD_TONES.rose;
/** A place of Scripture written out: the indigo of `SCRIPTURE_LINK_CLASSES`. */
export const SCRIPTURE_TEXT = 'text-indigo-700 dark:text-indigo-300';
/** A basis named on a question or a theme. */
export const BASIS_TEXT = 'text-amber-800 dark:text-amber-200/90';
export const BASIS_DOT = 'bg-amber-500 dark:bg-amber-400';
/** A basis pressed or chosen: the answer rests on it. */
export const BASIS_CHIP = 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-900/40';
export const PRIMARY_BUTTON = 'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full bg-rose-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/50 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus-visible:ring-offset-gray-900';
export const SECONDARY_BUTTON = 'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-gray-300 bg-white px-4 text-sm font-semibold text-gray-800 transition hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
export const QUIET_BUTTON = 'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full px-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40 disabled:cursor-not-allowed disabled:opacity-60 dark:text-gray-200 dark:hover:bg-gray-800';
/** A quiet button that is on: «Переставить» while arranging. */
export const QUIET_PRESSED = 'bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-gray-50';
export const DANGER_BUTTON = 'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full px-3 text-sm font-semibold text-red-700 transition hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 disabled:opacity-60 dark:text-red-300 dark:hover:bg-red-950/40';
export const PANEL = 'overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900';
export const ROW = 'flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-gray-50 focus:outline-none focus-visible:bg-gray-100 dark:hover:bg-gray-800/60 dark:focus-visible:bg-gray-800';
export const FIELD = 'w-full rounded-xl border border-gray-300 bg-white px-3.5 py-2.5 text-[15px] text-gray-900 placeholder:text-gray-400 focus:border-rose-500 focus:outline-none focus:ring-2 focus:ring-rose-500/30 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500';

export const sectionPath = '/care/questions';
/** The address segment of a question that stands in no theme. */
export const NO_THEME_SEGMENT = 'none';
export const themePath = (themeId: string) => `${sectionPath}/${encodeURIComponent(themeId)}`;
export const questionPath = (question: Pick<HardQuestion, 'id' | 'themeId'>, themeKnown = true) =>
  `${sectionPath}/${encodeURIComponent(question.themeId && themeKnown ? question.themeId : NO_THEME_SEGMENT)}/${encodeURIComponent(question.id)}`;
export const basisPath = (themeId: string, basisId: string) => `${themePath(themeId)}/basis/${encodeURIComponent(basisId)}`;

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-gray-600 transition hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100">
      <ArrowLeft className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
      {children}
    </Link>
  );
}

/**
 * The quiet label over a list: its title, beside it how many rows the list holds in a small circle (the
 * owner, 2026-11-26: «перенести левее, показывать кружочек, в кружочке цифру»), the list's actions on the
 * right. The circle counts the rows right below, so a reader takes its number for them; `countLabel`
 * says it in words («6 вопросов») to a screen reader and as a pointer's tooltip. No circle for none.
 * Actions that wait for the pointer are the screen's to hide: it marks the section they belong to
 * (`hoverActions.row`) and wraps them (`hoverActions.actions`).
 *
 * `chapter` — a part of a theme (its bases, each group): the theme reads as chapters, and ten groups under
 * small grey labels ran together into one ribbon (the owner, 2026-11-26: «сливаются все воедино … всё
 * одинаково выглядит»), so a chapter's name is a heading in its own words, not a label.
 */
/** How many, in a small grey circle beside a name — a list's heading, a theme in the list; nothing for none. */
export function CountChip({ count, label, className = '' }: { count?: number; label?: string; className?: string }) {
  if (!count) return null;
  return (
    <span title={label} className={`inline-flex h-5 min-w-[1.25rem] shrink-0 items-center justify-center rounded-full bg-gray-200 px-1.5 text-[11px] font-semibold leading-none tabular-nums text-gray-700 dark:bg-gray-700 dark:text-gray-200 ${className}`}>
      {label ? <><span aria-hidden="true">{count}</span><span className="sr-only">{label}</span></> : count}
    </span>
  );
}

export function ListLabel({ id, title, count, countLabel, help, action, chapter = false }: {
  id?: string; title: ReactNode; count?: number; countLabel?: string; help?: ReactNode; action?: ReactNode; chapter?: boolean;
}) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-3">
      {/* The title runs inline, so the circle follows its last word when a long name wraps on a phone. */}
      <div className="min-w-0">
        <h2 id={id} className={chapter
          ? 'inline text-lg font-bold leading-snug text-gray-900 dark:text-gray-50'
          : 'inline text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400'}>{title}</h2>
        <CountChip count={count} label={countLabel} className="ml-2 align-middle" />
        {help ? <span className="ml-1 inline-flex align-middle">{help}</span> : null}
      </div>
      {action && <div className="flex shrink-0 items-center">{action}</div>}
    </div>
  );
}

/**
 * A «?» beside a label: what the thing is, for whoever asks — shown when it is pointed at, focused or
 * pressed, and pressed again or tapped away to close (`Tooltip`). The owner, 2026-11-26: an explanation
 * printed under a heading every time is noise; «на знак вопроса нажимаешь, и становится понятным».
 */
export function HelpMark({ label, text }: { label: string; text: string }) {
  return (
    <Tooltip content={text}>
      <button type="button" aria-label={label}
        className="-my-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-400 transition hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40 dark:text-gray-500 dark:hover:text-gray-300">
        <QuestionMarkCircleIcon className="h-[18px] w-[18px]" aria-hidden="true" />
      </button>
    </Tooltip>
  );
}

/**
 * The bases a question rests on, as one quiet line under it in a list: a basis without its own short
 * label shows its whole title, and a row of chips with such titles wrapped into a heap on a phone
 * (live walk, 2026-11-25). The question's own page shows them as links.
 */
export function BasisLine({ bases }: { bases: readonly HardQuestionBasis[] }) {
  const { t } = useTranslation();
  if (!bases.length) return null;
  return (
    <span className={`mt-1 flex min-w-0 items-center gap-1.5 text-[12px] ${BASIS_TEXT}`}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${BASIS_DOT}`} aria-hidden="true" />
      <span className="sr-only">{t('hardQuestions.question.restsOn')}:</span>
      <span className="truncate">{bases.map((basis) => basis.title).join(' · ')}</span>
    </span>
  );
}

/**
 * One question in a list. `number` — its place in the theme as the theme reads (the owner's
 * documents say «see question 13»); `sub` — a quiet line under it (the theme, the short answer);
 * `leading` and `trailing` — the grip and the arrows while the list is arranged.
 */
export function QuestionRow({ question, href, number, sub, bases = [], leading, trailing, className = '' }: {
  question: HardQuestion; href: string; number?: number; sub?: ReactNode; bases?: readonly HardQuestionBasis[];
  leading?: ReactNode; trailing?: ReactNode; className?: string;
}) {
  const { t } = useTranslation();
  const waiting = isWaiting(question);
  return (
    <div className={`flex items-stretch ${className}`}>
      {leading && <span className="flex items-center pl-1">{leading}</span>}
      <Link href={href} className={`${ROW} min-w-0 flex-1`}>
        {number !== undefined && (
          <span className="w-6 shrink-0 text-right text-sm tabular-nums text-gray-500 dark:text-gray-400" aria-hidden="true">{number}</span>
        )}
        {waiting && (
          <ClockIcon className="h-5 w-5 shrink-0 text-gray-500 dark:text-gray-400" aria-label={t('hardQuestions.waitingMark')} role="img" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-medium leading-snug text-gray-900 dark:text-gray-100">{question.title}</span>
          {sub && <span className="mt-0.5 block truncate text-[13px] text-gray-600 dark:text-gray-400">{sub}</span>}
          <BasisLine bases={bases} />
        </span>
        <ChevronRightIcon className="h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500" aria-hidden="true" />
      </Link>
      {trailing}
    </div>
  );
}
