'use client';

import { ChevronRightIcon } from '@heroicons/react/20/solid';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { getLocalizedAbbrev } from '@/utils/bibleBooks';

import { ReaderSheet, SheetCloseButton } from './ReaderSheet';
import { USAGE_KIND_LOOK } from './usageKinds';
import { passageLabel, type MinePlace } from './useBookUsage';

import type { AppLocale } from '@/utils/appLocale';
import type { BookUsageEntry } from '@/utils/scriptureUsage';

type MineSheetProps = {
  /** The verse or the chapter whose list is open; nothing — the window is closed. */
  at: MinePlace | null;
  bookId: string;
  locale: AppLocale;
  /** "Глава 4", "Псалом 23": the reader's word for a chapter. */
  chapterWord: (chapter: number) => string;
  /** The verse's own words, under the title. */
  verseText?: string;
  listed: { onVerse: BookUsageEntry[]; wholeChapter: BookUsageEntry[] } | null;
  onClose: () => void;
  /** Goes to the note, sermon, group or service order — the reader closes the window first. */
  onOpenEntry: (href: string) => void;
};

function EntryRow({ entry, abbrev, onOpen }: { entry: BookUsageEntry; abbrev: string; onOpen: (href: string) => void }) {
  const { t } = useTranslation();
  const { Icon, wordKey, badge } = USAGE_KIND_LOOK[entry.kind];
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(entry.href)}
        data-testid={`mine-entry-${entry.kind}-${entry.id}`}
        // Lit under the pointer and the finger, as the rows of the verse's window are (ScripturePreviewSheet):
        // with several rows it shows which one a tap opens (the owner, 2026-10-21).
        className="-mx-2 flex w-[calc(100%+1rem)] items-start gap-3 rounded-xl px-2 py-3 text-left transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 active:bg-gray-100 dark:hover:bg-gray-800 dark:active:bg-gray-700"
      >
        {/* The badge's own circle: the list speaks the same colours and icons as the text. */}
        <span className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${badge.circle}`}>
          <Icon className="h-4 w-4 text-white" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold text-gray-600 dark:text-gray-300">{t(wordKey)} · {passageLabel(abbrev, entry.passage)}</span>
          <span className="mt-0.5 block break-words text-base font-semibold text-gray-900 dark:text-gray-100">{entry.title || t('bible.preview.untitled')}</span>
          {entry.excerpt ? <span className="mt-1 line-clamp-2 text-sm leading-relaxed text-gray-600 dark:text-gray-300">{entry.excerpt}</span> : null}
        </span>
        <ChevronRightIcon className="mt-2 h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
      </button>
    </li>
  );
}

/**
 * THE PERSON'S OWN MATERIAL ON ONE VERSE OR ONE CHAPTER, opened from its badge in the reader: what holds
 * the verse, then what names its whole chapter. A row goes to that note, sermon, group or service order.
 */
export function MineSheet({ at, bookId, locale, chapterWord, verseText, listed, onClose, onOpenEntry }: MineSheetProps) {
  const { t } = useTranslation();
  const titleId = useId();
  if (!at || !listed) return null;
  const abbrev = getLocalizedAbbrev(bookId, locale);
  // The window is named by its place alone, as its rows say it: "Втор 6:21", "Евр 4" (the owner, 2026-10-21).
  const place = at.verse === null ? `${abbrev} ${at.chapter}` : `${abbrev} ${at.chapter}:${at.verse}`;
  const { onVerse, wholeChapter } = listed;
  return (
    <ReaderSheet titleId={titleId} onClose={onClose}>
      <div className="flex items-center justify-between gap-2">
        <h3 id={titleId} className="text-lg font-bold text-gray-900 dark:text-white">{place}</h3>
        <SheetCloseButton onClose={onClose} />
      </div>
      {verseText && at.verse !== null ? <p className="mb-2 font-serif text-[15px] leading-snug text-gray-600 dark:text-gray-400">{verseText}</p> : null}
      {onVerse.length ? (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {onVerse.map((entry) => <EntryRow key={entry.key} entry={entry} abbrev={abbrev} onOpen={onOpenEntry} />)}
        </ul>
      ) : null}
      {wholeChapter.length ? (
        <>
          {at.verse !== null ? <h4 className="mt-4 text-sm font-semibold text-gray-600 dark:text-gray-300">{t('bible.mine.wholeChapter', { chapter: chapterWord(at.chapter) })}</h4> : null}
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {wholeChapter.map((entry) => <EntryRow key={entry.key} entry={entry} abbrev={abbrev} onOpen={onOpenEntry} />)}
          </ul>
        </>
      ) : null}
      {!onVerse.length && !wholeChapter.length ? <p className="py-4 text-sm text-gray-600 dark:text-gray-400">{t('bible.mine.empty')}</p> : null}
    </ReaderSheet>
  );
}
