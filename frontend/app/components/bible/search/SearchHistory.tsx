'use client';

import { ClockIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useTranslation } from 'react-i18next';

import { HOVER_ROW, SELECTED_ROW } from './searchStyles';

import type { SearchHistoryEntry } from '../searchHistoryStore';

/**
 * «ИСТОРИЯ ПОИСКА»: the searches a verse was opened from, by day — today, yesterday, earlier — each one
 * tap from its results again. A search is taken out with its cross; «Очистить» takes them all and
 * offers them back once, instead of asking first.
 */
/** `count`: how many verses the search finds now, when known. */
export type HistoryRow = { entry: SearchHistoryEntry; count: number | null };

const SIGNED = /([*_"])/;

function dayOf(at: number, now: Date): 'today' | 'yesterday' | 'earlier' {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (at >= midnight) return 'today';
  if (at >= midnight - 24 * 60 * 60 * 1000) return 'yesterday';
  return 'earlier';
}

type Props = {
  rows: HistoryRow[];
  /** The row the arrows are on (a computer). */
  selected: number | null;
  touch: boolean;
  cleared: boolean;
  example: string;
  onPick: (entry: SearchHistoryEntry) => void;
  /** The example offered while the history is empty. */
  onTry: (line: string) => void;
  onRemove: (entry: SearchHistoryEntry) => void;
  onClear: () => void;
  onUndo: () => void;
};

export function SearchHistory({ rows, selected, touch, cleared, example, onPick, onTry, onRemove, onClear, onUndo }: Props) {
  const { t } = useTranslation();
  const now = new Date();
  const groups = (['today', 'yesterday', 'earlier'] as const)
    .map((day) => ({ day, rows: rows.map((row, index) => ({ ...row, index })).filter((row) => dayOf(row.entry.at, now) === day) }))
    .filter((group) => group.rows.length);
  const titles = { today: t('bible.search.historyToday'), yesterday: t('bible.search.historyYesterday'), earlier: t('bible.search.historyEarlier') };

  return (
    <div>
      <div className="flex min-h-9 items-center justify-between gap-3 border-b border-gray-100 pb-2 dark:border-gray-800">
        <h2 className="text-[15px] font-semibold tracking-tight text-gray-900 dark:text-white">{t('bible.search.history')}</h2>
        {rows.length ? (
          <button
            type="button"
            onClick={onClear}
            className={`-mr-2 rounded-lg px-2 text-[13px] font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800 ${touch ? 'h-11 px-3' : 'h-7'}`}
          >
            {t('bible.search.historyClear')}
          </button>
        ) : null}
      </div>
      {cleared ? (
        <p role="status" className="flex flex-wrap items-center gap-x-2 pt-3 text-sm text-gray-600 dark:text-gray-300">
          {t('bible.search.historyCleared')}
          <button type="button" onClick={onUndo} className={`rounded-lg font-semibold text-indigo-700 underline-offset-2 hover:underline dark:text-indigo-300 ${touch ? '-mx-2 h-11 px-2' : ''}`}>
            {t('bible.search.historyUndo')}
          </button>
        </p>
      ) : null}
      {!rows.length && !cleared ? (
        <p className="pt-3 text-sm leading-relaxed text-gray-500 dark:text-gray-400">
          {t('bible.search.historyEmpty')}{' '}
          <button type="button" onClick={() => onTry(example)} className={`inline-flex items-center rounded-md bg-gray-100 text-sm font-medium text-gray-900 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-100 ${touch ? 'h-11 px-3' : 'h-7 px-2'}`}>
            {example}
          </button>
        </p>
      ) : null}
      {groups.map((group) => (
        <div key={group.day}>
          <h3 className="px-2 pb-1 pt-3 text-xs font-semibold text-gray-500 dark:text-gray-400">{titles[group.day]}</h3>
          {/* A list of real buttons — open a search, take it out — reachable by every way of pressing,
              a screen reader's included. The arrows in the line move the light here, and Enter opens. */}
          <ul className="-mx-2">
            {group.rows.map((row) => {
              const isSelected = row.index === selected;
              return (
                <li key={`${row.entry.at}-${row.entry.line}`} className={`group flex items-center rounded-lg ${isSelected ? SELECTED_ROW : HOVER_ROW}`}>
                  <button
                    type="button"
                    aria-current={isSelected ? 'true' : undefined}
                    onMouseDown={(event) => { if (!touch) event.preventDefault(); }}
                    onClick={() => onPick(row.entry)}
                    className={`flex min-w-0 flex-1 items-center gap-3 rounded-lg pl-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${touch ? 'min-h-12' : 'min-h-10'}`}
                  >
                    <ClockIcon className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-gray-900 dark:text-gray-100">
                      {row.entry.line.split(SIGNED).filter(Boolean).map((piece, index) => (SIGNED.test(piece)
                        ? <span key={index} className="font-semibold text-indigo-600 dark:text-indigo-300">{piece}</span>
                        : <span key={index}>{piece}</span>))}
                    </span>
                    {row.count !== null ? <span className="shrink-0 pr-1 text-[13px] tabular-nums text-gray-400">{t('bible.search.verses', { count: row.count })}</span> : null}
                  </button>
                  <button
                    type="button"
                    onMouseDown={(event) => { if (!touch) event.preventDefault(); }}
                    onClick={() => onRemove(row.entry)}
                    aria-label={t('bible.search.historyRemove', { line: row.entry.line })}
                    title={t('bible.search.historyRemove', { line: row.entry.line })}
                    className={`mr-1 inline-flex shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-gray-800 ${touch ? 'h-11 w-11' : 'h-8 w-8 opacity-0 group-hover:opacity-100'}`}
                  >
                    <XMarkIcon className="h-4 w-4" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
