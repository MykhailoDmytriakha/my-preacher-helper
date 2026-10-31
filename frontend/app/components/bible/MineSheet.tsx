'use client';

import { ChevronRightIcon } from '@heroicons/react/20/solid';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { getLocalizedAbbrev } from '@/utils/bibleBooks';
import { markdownPreviewText } from '@/utils/markdownUtils';

import { AnalysisOutline } from './analysis/AnalysisOutline';
import { AnalysisSermons } from './analysis/AnalysisSermons';
import { ReaderSheet, SheetCloseButton } from './ReaderSheet';
import { USAGE_KIND_LOOK } from './usageKinds';
import { passageLabel, type MinePlace } from './useBookUsage';

import type { AppLocale } from '@/utils/appLocale';
import type { Passage } from '@/utils/scriptureReferenceNumbering';
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
  /** A comment opens in its own window, not on a page: it is edited only there (the owner, 2026-10-28). */
  onEditComment?: (id: string) => void;
  /** A passage's analysis opens in the reader's analysis screen, not in the note editor (case 2026-10-12-block-diagram, 3.4). */
  onOpenAnalysis?: (id: string) => void;
  /** A passage as the reader's «Копировать» gives it: a new sermon's verse from an analysis (`passageCopyText`). */
  passageCopy?: (passage: Passage) => string;
};

/** Under a row's kind and place: a comment's words, an analysis's structure, or a title and its excerpt. */
function EntryBody({ entry, comment }: { entry: BookUsageEntry; comment: string | null }) {
  const { t } = useTranslation();
  if (comment !== null) return <span className="mt-0.5 line-clamp-5 block break-words text-[15px] leading-relaxed text-gray-800 dark:text-gray-200">{comment}</span>;
  // Its title only repeats the kind and the place above it; its structure stands under the row.
  if (entry.kind === 'analysis' && entry.body) return null;
  return (
    <>
      <span className="mt-0.5 block break-words text-base font-semibold text-gray-900 dark:text-gray-100">{entry.title || t('bible.preview.untitled')}</span>
      {entry.excerpt ? <span className="mt-1 line-clamp-2 text-sm leading-relaxed text-gray-600 dark:text-gray-300">{entry.excerpt}</span> : null}
    </>
  );
}

/**
 * A row of the list: its kind and place, then its words or its structure. `bare` — the window's title already names the
 * kind and the place (an analysis's badge opened it): the structure stands alone, without a row repeating them.
 */
function EntryRow({ entry, abbrev, bare, onOpen, onEditComment, onOpenAnalysis }: { entry: BookUsageEntry; abbrev: string; bare: boolean; onOpen: (href: string) => void; onEditComment?: (id: string) => void; onOpenAnalysis?: (id: string) => void }) {
  const { t } = useTranslation();
  const { Icon, wordKey, badge } = USAGE_KIND_LOOK[entry.kind];
  // A comment has no title: the row is its own words, and it opens in the comment's window.
  const comment = entry.kind === 'comment' && onEditComment ? markdownPreviewText(entry.body ?? '') : null;
  const open = () => (comment !== null && onEditComment ? onEditComment(entry.id) : entry.kind === 'analysis' && onOpenAnalysis ? onOpenAnalysis(entry.id) : onOpen(entry.href));
  const place = passageLabel(abbrev, entry.passage);
  const outline = entry.kind === 'analysis' && entry.body
    ? <AnalysisOutline text={entry.body} analysis={entry.analysis} label={t('bible.mine.openAnalysis', { place })} onOpen={open} grow={bare} />
    : null;
  if (bare && outline) return <li className="pt-2">{outline}</li>;
  return (
    <li>
      <button
        type="button"
        onClick={open}
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
          <span className="block text-xs font-semibold text-gray-600 dark:text-gray-300">{t(wordKey)} · {place}</span>
          <EntryBody entry={entry} comment={comment} />
        </span>
        <ChevronRightIcon className="mt-2 h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
      </button>
      {outline}
    </li>
  );
}

/**
 * THE PERSON'S OWN MATERIAL ON ONE VERSE OR ONE CHAPTER, opened from its badge in the reader: what holds
 * the verse, then what names its whole chapter. A row goes to that note, sermon, group or service order.
 */
export function MineSheet({ at, bookId, locale, chapterWord, verseText, listed, onClose, onOpenEntry, onEditComment, onOpenAnalysis, passageCopy }: MineSheetProps) {
  const { t } = useTranslation();
  const titleId = useId();
  if (!at || !listed) return null;
  const abbrev = getLocalizedAbbrev(bookId, locale);
  // The window is named by its place alone, as its rows say it: "Втор 6:21", "Евр 4" (the owner, 2026-10-21).
  // From an analysis's badge, the window is named by that analysis's passage — «1Ин 4:1–3», not the verse it starts at —
  // and the verse's words are not shown above its structure, which already says them (the owner, 30.10).
  const place = at.stretch ? passageLabel(abbrev, at.stretch.passage) : at.verse === null ? `${abbrev} ${at.chapter}` : `${abbrev} ${at.chapter}:${at.verse}`;
  const { onVerse, wholeChapter } = listed;
  const look = at.stretch ? USAGE_KIND_LOOK[at.stretch.kind] : null;
  // An analysis's window carries its sermons by its name: a new one from it, or the ones made from it (AnalysisSermons).
  const analysis = at.stretch?.kind === 'analysis' ? onVerse.find((entry) => entry.kind === 'analysis') : undefined;
  return (
    <ReaderSheet titleId={titleId} onClose={onClose} grow={Boolean(at.stretch)}>
      <div className="flex shrink-0 items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          {/* From a badge, the window carries the badge's circle by its title: the kind is said once, up here (the owner, 30.10). */}
          {look ? (
            <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${look.badge.circle}`}>
              <look.Icon className="h-4 w-4 text-white" aria-hidden="true" />
            </span>
          ) : null}
          <h3 id={titleId} className="text-lg font-bold text-gray-900 dark:text-white">{place}</h3>
          {analysis && at.stretch ? <AnalysisSermons noteId={analysis.id} place={place} verse={passageCopy?.(at.stretch.passage) ?? ''} onOpen={onOpenEntry} /> : null}
        </div>
        <SheetCloseButton onClose={onClose} />
      </div>
      {verseText && at.verse !== null && !at.stretch ? <p className="mb-2 font-serif text-[15px] leading-snug text-gray-600 dark:text-gray-400">{verseText}</p> : null}
      {onVerse.length ? (
        // From a badge the window grows to the screen's gaps; past them only this part scrolls, the title stays.
        <ul className={`divide-y divide-gray-100 dark:divide-gray-800 ${at.stretch ? '-mx-2 min-h-0 flex-1 overflow-y-auto overscroll-contain px-2' : ''}`}>
          {onVerse.map((entry) => <EntryRow key={entry.key} entry={entry} abbrev={abbrev} bare={Boolean(at.stretch)} onOpen={onOpenEntry} onEditComment={onEditComment} onOpenAnalysis={onOpenAnalysis} />)}
        </ul>
      ) : null}
      {wholeChapter.length ? (
        <>
          {at.verse !== null ? <h4 className="mt-4 text-sm font-semibold text-gray-600 dark:text-gray-300">{t('bible.mine.wholeChapter', { chapter: chapterWord(at.chapter) })}</h4> : null}
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {wholeChapter.map((entry) => <EntryRow key={entry.key} entry={entry} abbrev={abbrev} bare={false} onOpen={onOpenEntry} onEditComment={onEditComment} onOpenAnalysis={onOpenAnalysis} />)}
          </ul>
        </>
      ) : null}
      {!onVerse.length && !wholeChapter.length ? <p className="py-4 text-sm text-gray-600 dark:text-gray-400">{t('bible.mine.empty')}</p> : null}
    </ReaderSheet>
  );
}
