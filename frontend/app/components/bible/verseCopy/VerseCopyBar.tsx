'use client';

import { ArrowUpOnSquareIcon, DocumentDuplicateIcon, XMarkIcon } from '@heroicons/react/24/outline';

import { AnalysisIcon, CommentIcon, ParagraphIcon } from '@/components/Icons';
import { inOneRun, pickedPassage, type PickedPassage } from '@/utils/passagePick';
import { useTranslation } from '@locales/useTranslation';

import type { VerseCopy } from './useVerseCopy';
import type { BookText } from '@/utils/bibleText';
import type { CopyFormat } from '@/utils/verseCopy';

/** What the verses chosen in a row may become, besides a copy: a comment or a paragraph on them, or their analysis. */
export type VerseWriting = 'comment' | 'paragraph';

function FormatSwitch({ copy, wide }: { copy: VerseCopy; wide: boolean }) {
  const { t } = useTranslation();
  const option = (format: CopyFormat, label: string) => {
    const on = copy.format === format;
    return (
      <button
        type="button"
        aria-pressed={on}
        onClick={() => copy.setFormat(format)}
        className={`h-8 whitespace-nowrap rounded-lg font-semibold ${wide ? 'px-3 text-sm' : 'px-2 text-xs'} ${on
          ? 'bg-white text-gray-900 shadow-sm dark:bg-indigo-600 dark:text-white'
          : 'text-gray-600 dark:text-gray-300'}`}
      >
        {label}
      </button>
    );
  };
  return (
    <div role="group" aria-label={t('bible.copy.format')} className="flex shrink-0 gap-0.5 rounded-xl bg-gray-100 p-[3px] dark:bg-gray-950">
      {option('quote', t('bible.copy.asQuote'))}
      {option('numbered', t('bible.copy.numbered'))}
    </div>
  );
}

const TILE_WIDE = 'inline-flex h-11 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-gray-300 px-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800';
const TILE_PHONE = 'flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl border border-gray-300 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800';

/** Copy and «Поделиться» — the system's own share sheet, a mark only (the owner, 2026-11-06) — for any verses. */
function CopyActions({ copy, verses, wide }: { copy: VerseCopy; verses: NonNullable<VerseCopy['picked']>; wide: boolean }) {
  const { t } = useTranslation();
  return (
    <>
      <button type="button" onClick={() => { void copy.copy(verses, copy.format); }} className={`inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-indigo-600 font-semibold text-white hover:bg-indigo-700 ${wide ? 'h-11 px-4' : 'h-10 px-3 text-sm'}`}>
        {wide ? <DocumentDuplicateIcon className="h-5 w-5" aria-hidden="true" /> : null}
        {t('bible.copy.copy')}
      </button>
      {copy.canShare ? (
        <button type="button" onClick={() => { void copy.share(verses, copy.format); }} aria-label={t('bible.copy.share')} title={t('bible.copy.share')} className={`inline-flex shrink-0 items-center justify-center rounded-xl border border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800 ${wide ? 'h-11 w-11' : 'h-10 w-10'}`}>
          <ArrowUpOnSquareIcon className="h-5 w-5" aria-hidden="true" />
        </button>
      ) : null}
    </>
  );
}

/** A comment, a paragraph and an analysis on the verses in a row. */
function WriteActions({ passage, wide, onWrite, onAnalyse }: { passage: PickedPassage; wide: boolean; onWrite?: (kind: VerseWriting, passage: PickedPassage) => void; onAnalyse?: (passage: PickedPassage) => void }) {
  const { t } = useTranslation();
  // On a wide screen narrower than the one-row bar, the three share the second row evenly, as on a phone.
  const tile = wide ? `${TILE_WIDE} flex-1 xl:flex-none` : TILE_PHONE;
  return (
    <>
      {onWrite ? <button type="button" onClick={() => onWrite('comment', passage)} className={tile}><CommentIcon className="h-5 w-5" />{t('bible.copy.writeComment')}</button> : null}
      {onWrite ? <button type="button" onClick={() => onWrite('paragraph', passage)} className={tile}><ParagraphIcon className="h-5 w-5" />{t('bible.copy.writeParagraph')}</button> : null}
      {onAnalyse ? <button type="button" onClick={() => onAnalyse(passage)} className={tile}><AnalysisIcon className="h-5 w-5" />{t('bible.copy.analyse')}</button> : null}
    </>
  );
}

/**
 * THE BAR OF THE VERSES CHOSEN (case 2026-11-06-comment-paragraph, the owner's canvas «Сначала стихи, потом действие»):
 * the verses are chosen first — a hold starts the choice, a press takes or gives back one verse, a hold takes every verse up
 * to it — and the bar says what to do with them. A copy or a send takes any verses; a comment, a paragraph and an analysis
 * are written on verses in a row, so their row stands only then, and a line says why it is gone. It names the place and
 * the count — with one verse chosen, how to add more, in place of «1 стих» — chooses how the copy reads; ✕ or Escape lets
 * the choice go. A wide screen keeps it on one row from `xl` up; narrower (an iPad, a small laptop) the writing goes to a
 * second row, so the place and ✕ stay in it: on one 60rem row the place shrank to «К…» and at 820 px «Разобрать» and ✕
 * were cut off the bar (visual pass, 2026-11-07).
 */
export function VerseCopyBar({ copy, wide, text, onWrite, onAnalyse }: {
  copy: VerseCopy;
  wide: boolean;
  /** The book read: whether the verses stand in a row, and the passage they make. */
  text?: BookText | null;
  /** A comment or a paragraph on the verses chosen (the reader's comment window). */
  onWrite?: (kind: VerseWriting, passage: PickedPassage) => void;
  /** The verses chosen analysed (the reader's analysis screen). */
  onAnalyse?: (passage: PickedPassage) => void;
}) {
  const { t } = useTranslation();
  const verses = copy.picked;
  if (!verses) return null;
  const place = copy.placeOf(verses);
  // One verse chosen: «1 стих» says nothing the place does not, and the line tells how to add more instead.
  const count = verses.length === 1
    ? <span data-copy-hint="">{t(copy.byTouch ? 'bible.copy.severalHint' : 'bible.copy.severalHintMouse')}</span>
    : t('bible.verseCount', { count: verses.length });
  const writes = Boolean(text && (onWrite || onAnalyse));
  const passage = writes && text && inOneRun(text, verses) ? pickedPassage(text, verses) : null;
  const writing = passage ? <WriteActions passage={passage} wide={wide} onWrite={onWrite} onAnalyse={onAnalyse} /> : null;
  const notInRow = writes && !passage ? <span className="text-xs text-gray-500 dark:text-gray-400" data-copy-not-in-row="">{t('bible.copy.onlyInRow')}</span> : null;
  const clear = (
    <button type="button" onClick={copy.clear} aria-label={t('bible.copy.clear')} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200">
      <XMarkIcon className="h-5 w-5" aria-hidden="true" />
    </button>
  );
  const shell = 'fixed z-[110] rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900';
  const where = (
    <div className="min-w-0 flex-1">
      <div data-copy-place="" className="truncate font-bold text-gray-900 dark:text-white">{place}</div>
      {/* The hint may take two lines where the row leaves the place little room; the place itself is cut, never the hint. */}
      <div className="text-xs leading-snug text-gray-500 dark:text-gray-400">{count}</div>
    </div>
  );
  return wide ? (
    <div role="region" aria-label={place} data-verse-bar="" className={`${shell} bottom-6 left-1/2 w-[min(60rem,calc(100vw-2rem))] -translate-x-1/2 py-2.5 pl-5 pr-2.5 xl:w-[min(68rem,calc(100vw-2rem))]`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 xl:flex-nowrap">
        {where}
        <FormatSwitch copy={copy} wide />
        <CopyActions copy={copy} verses={verses} wide />
        {writing ? (
          <div className="order-last flex w-full gap-2 xl:order-none xl:w-auto xl:gap-3">
            <span aria-hidden="true" className="hidden h-8 w-px shrink-0 self-center bg-gray-200 dark:bg-gray-700 xl:block" />
            {writing}
          </div>
        ) : null}
        {clear}
      </div>
      {notInRow ? <div className="mt-1.5">{notInRow}</div> : null}
    </div>
  ) : (
    <div role="region" aria-label={place} data-verse-bar="" className={`${shell} inset-x-2 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] p-3`}>
      <div className="mb-2.5 flex items-center gap-2">
        {where}
        {clear}
      </div>
      <div className="flex items-center gap-1.5">
        <CopyActions copy={copy} verses={verses} wide={false} />
        <div className="ml-auto"><FormatSwitch copy={copy} wide={false} /></div>
      </div>
      {writing ? <div className="mt-2 flex gap-2">{writing}</div> : null}
      {notInRow ? <div className="mt-2">{notInRow}</div> : null}
    </div>
  );
}
