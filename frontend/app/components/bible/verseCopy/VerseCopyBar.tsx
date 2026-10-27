'use client';

import { ArrowUpOnSquareIcon, DocumentDuplicateIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useTranslation } from 'react-i18next';

import type { VerseCopy } from './useVerseCopy';
import type { CopyFormat } from '@/utils/verseCopy';


function FormatSwitch({ copy, wide }: { copy: VerseCopy; wide: boolean }) {
  const { t } = useTranslation();
  const option = (format: CopyFormat, label: string) => {
    const on = copy.format === format;
    return (
      <button
        type="button"
        aria-pressed={on}
        onClick={() => copy.setFormat(format)}
        className={`h-8 whitespace-nowrap rounded-lg px-3 text-sm font-semibold ${wide ? '' : 'flex-1'} ${on
          ? 'bg-white text-gray-900 shadow-sm dark:bg-indigo-600 dark:text-white'
          : 'text-gray-600 dark:text-gray-300'}`}
      >
        {label}
      </button>
    );
  };
  return (
    <div role="group" aria-label={t('bible.copy.format')} className={`flex gap-0.5 rounded-xl bg-gray-100 p-[3px] dark:bg-gray-950 ${wide ? 'shrink-0' : 'w-full'}`}>
      {option('quote', t('bible.copy.asQuote'))}
      {option('numbered', t('bible.copy.numbered'))}
    </div>
  );
}

/**
 * THE BAR OF THE VERSES CHOSEN — «Выбрать несколько» in a verse's menu brings it; the verses pressed join it.
 * It names the place and the count, chooses how the copy reads (one verse — a quote, several — numbered, at
 * first), and copies or sends them; ✕ or Escape lets the choice go.
 */
export function VerseCopyBar({ copy, wide }: { copy: VerseCopy; wide: boolean }) {
  const { t } = useTranslation();
  const verses = copy.picked;
  if (!verses) return null;
  const place = copy.placeOf(verses);
  const count = t('bible.verseCount', { count: verses.length });
  const clear = (
    <button type="button" onClick={copy.clear} aria-label={t('bible.copy.clear')} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200">
      <XMarkIcon className="h-5 w-5" aria-hidden="true" />
    </button>
  );
  const copyButton = (
    <button type="button" onClick={() => { void copy.copy(verses, copy.format); }} className={`inline-flex h-11 shrink-0 whitespace-nowrap items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 font-semibold text-white hover:bg-indigo-700 ${wide ? '' : 'flex-1'}`}>
      <DocumentDuplicateIcon className="h-5 w-5" aria-hidden="true" />
      {t('bible.copy.copy')}
    </button>
  );
  const shareButton = copy.canShare ? (
    <button type="button" onClick={() => { void copy.share(verses, copy.format); }} className={`inline-flex h-11 shrink-0 whitespace-nowrap items-center justify-center gap-2 rounded-xl border border-gray-300 px-4 font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800 ${wide ? '' : 'flex-1'}`}>
      <ArrowUpOnSquareIcon className="h-5 w-5" aria-hidden="true" />
      {t('bible.copy.share')}
    </button>
  ) : null;
  const shell = 'fixed z-[110] rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900';
  return wide ? (
    <div role="region" aria-label={place} className={`${shell} bottom-6 left-1/2 flex w-[min(44rem,calc(100vw-2rem))] -translate-x-1/2 items-center gap-3 py-2.5 pl-5 pr-2.5`}>
      <div className="min-w-[7.5rem] flex-1">
        <div data-copy-place="" className="truncate font-bold text-gray-900 dark:text-white">{place}</div>
        <div className="text-xs text-gray-500 dark:text-gray-400">{count}</div>
      </div>
      <FormatSwitch copy={copy} wide />
      {copyButton}
      {shareButton}
      {clear}
    </div>
  ) : (
    <div role="region" aria-label={place} className={`${shell} inset-x-2 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] p-3`}>
      <div className="mb-2.5 flex items-center gap-2">
        <span data-copy-place="" className="min-w-0 flex-1 truncate font-bold text-gray-900 dark:text-white">{place}</span>
        <span className="shrink-0 text-sm text-gray-500 dark:text-gray-400">{count}</span>
        {clear}
      </div>
      <div className="mb-2.5 flex"><FormatSwitch copy={copy} wide={false} /></div>
      <div className="flex gap-2">
        {copyButton}
        {shareButton}
      </div>
    </div>
  );
}
