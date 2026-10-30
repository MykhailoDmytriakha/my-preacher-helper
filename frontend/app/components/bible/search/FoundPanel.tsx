'use client';

import { ArrowLeftIcon, MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { memo, useId, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { drawnAround, type FoundRange, type FoundVerse } from './foundInBible';
import { SHOWN_VERSES, verseRef } from './searchModel';

import type { FoundVerses } from './useFoundVerses';
import type { AppLocale } from '@/utils/appLocale';

/**
 * THE FOUND VERSES BESIDE THE TEXT (`foundInBible.ts`; the owner's choice 30.10): in the trail's place, a column of the
 * verses a search found — the line and «7 из 9» on top, «К поиску» back to the same search window, then each verse with
 * its found words underlined. Exactly what was searched and seen in the window, no places to search wider (the owner,
 * 30.10: «мы видим то, по чём искали»). The verse the reading stands at is said by «7 из 9» and framed in the text; the
 * list itself lights none and stays where the person scrolled it, as the trail does (the owner, 30.10). A press puts the text on that verse; reading on, the verse
 * the reading stands at is framed here as in the text. The words stay underlined only here: over the text a found
 * verse is a frame alone, so the person's marker and pencil show as they are (the owner, 30.10). A word on every
 * page («Господь» finds near seven thousand verses) draws a hundred at a time, as the search window shows them — the
 * hundred around the verse read (`drawnAround`), «Показать … выше» over them and «Показать ещё» under them (Codex
 * review, 30.10). On an arrival — the book opened at a place, a move to one — the found verse arrived at is brought
 * into the list's middle when out of sight, as the trail brings its light; reading on, or a verse pressed in sight,
 * leaves the list as scrolled.
 */
export function FoundPanel({ line, found, atKey, arrived = null, locale, onGo, onBack, onClose }: {
  line: string; found: FoundVerses; atKey: string | null;
  /** The found verse of the place last arrived at, and that arrival (`arrival` in the reader): each arrival is its own. */
  arrived?: { key: string; of: object } | null;
  locale: AppLocale;
  onGo: (verse: FoundVerse) => void;
  onBack: () => void; onClose: () => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const at = atKey ? found.verses.findIndex((verse) => verse.key === atKey) : -1;
  const [range, setRange] = useState<FoundRange | null>(null);
  const shown = drawnAround(range, at, SHOWN_VERSES, found.verses.length);
  if (shown !== range) setRange(shown);
  const drawn = found.verses.slice(shown.from, shown.to);
  const earlier = Math.min(SHOWN_VERSES, shown.from);
  const more = Math.min(SHOWN_VERSES, found.verses.length - shown.to);

  const listRef = useRef<HTMLOListElement | null>(null);
  const before = useRef<(FoundRange & { height: number }) | null>(null);
  const brought = useRef<object | null>(null);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const last = before.current;
    if (last && shown.from < last.from && shown.to === last.to) {
      // Verses drawn over those in sight: they stay where they stood.
      list.scrollTop += list.scrollHeight - last.height;
    }
    const row = arrived && arrived.of !== brought.current ? list.querySelector<HTMLElement>(`[data-found-row="${arrived.key}"]`) : null;
    if (row && arrived) {
      brought.current = arrived.of;
      const box = list.getBoundingClientRect();
      const place = row.getBoundingClientRect();
      if (place.top < box.top || place.bottom > box.bottom) {
        list.scrollTop = Math.max(0, list.scrollTop + place.top - box.top - (list.clientHeight - place.height) / 2);
      }
    }
    before.current = { from: shown.from, to: shown.to, height: list.scrollHeight };
  });

  return (
    <nav aria-labelledby={titleId} data-found-panel="" className="mb-4 flex w-[244px] shrink-0 flex-col self-stretch overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
      <div className="flex h-11 shrink-0 items-center gap-1.5 border-b border-gray-100 pl-3.5 pr-1.5 text-[13px] font-semibold text-gray-600 dark:border-gray-800 dark:text-gray-300">
        <MagnifyingGlassIcon className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
        <span id={titleId} className="min-w-0 truncate" title={line}>«{line}»</span>
        <span className="shrink-0 whitespace-nowrap text-gray-500 dark:text-gray-400">· {t('bible.found.position', { at: at + 1 || '–', count: found.verses.length })}</span>
        <span className="flex-1" />
        <button type="button" onClick={onClose} aria-label={t('bible.found.close')} title={t('bible.found.close')}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100">
          <XMarkIcon className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="shrink-0 border-b border-gray-100 px-2.5 py-2.5 dark:border-gray-800">
        <button type="button" onClick={onBack}
          className="flex h-9 w-full items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 text-left text-[13px] font-semibold text-indigo-700 hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-indigo-500/40 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-950/70">
          <ArrowLeftIcon className="h-4 w-4 shrink-0" aria-hidden="true" />{t('bible.found.back')}
        </button>
      </div>
      {/* The list keeps its own place when verses are drawn over those in sight: the browser's anchoring would move it twice. */}
      <ol ref={listRef} className="min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain px-2 pb-2.5 pt-1.5 [overflow-anchor:none]">
        {earlier > 0 ? (
          <li>
            <button type="button" data-found-earlier="" onClick={() => setRange({ from: shown.from - earlier, to: shown.to })} className={MORE_CLASS}>
              {t('bible.found.showEarlier', { count: earlier })}
            </button>
          </li>
        ) : null}
        {drawn.map((verse) => (
          <FoundRow key={verse.key} verse={verse} here={verse.key === atKey} locale={locale} piecesOf={found.piecesOf} onGo={onGo} />
        ))}
        {more > 0 ? (
          <li>
            <button type="button" data-found-more="" onClick={() => setRange({ from: shown.from, to: shown.to + more })} className={MORE_CLASS}>
              {t('bible.search.showMore', { count: more })}
            </button>
          </li>
        ) : null}
      </ol>
    </nav>
  );
}

const MORE_CLASS = 'w-full rounded-xl px-2.5 py-2 text-left text-[13px] font-semibold text-indigo-700 transition hover:bg-indigo-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 active:bg-indigo-100 dark:text-indigo-300 dark:hover:bg-indigo-950/40 dark:active:bg-indigo-950/70';

/** One found verse; drawn again only when it becomes or stops being the one the reading stands at. */
const FoundRow = memo(function FoundRow({ verse, here, locale, piecesOf, onGo }: {
  verse: FoundVerse; here: boolean; locale: AppLocale;
  piecesOf: FoundVerses['piecesOf']; onGo: (verse: FoundVerse) => void;
}) {
  return (
    <li>
      <button type="button" data-found-row={verse.key} {...(here ? { 'aria-current': 'location' as const } : {})} onClick={() => onGo(verse)}
        // Lit under the pointer as the trail's places are: a press is clearly going to this verse (the owner, 30.10).
        className="group w-full rounded-xl px-2.5 py-2 text-left text-[13px] leading-snug text-gray-700 transition hover:bg-indigo-50 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 active:bg-indigo-100 dark:text-gray-200 dark:hover:bg-indigo-950/40 dark:hover:text-white dark:active:bg-indigo-950/70">
        <span className="mr-1 font-semibold text-gray-900 group-hover:text-indigo-700 dark:text-white dark:group-hover:text-indigo-300">{verseRef(verse.bookId, verse.chapter, verse.verse, locale)}</span>
        {piecesOf(verse.text).map((piece, index) => (piece.lit
          ? <span key={index} className="font-semibold underline decoration-amber-500 decoration-2 underline-offset-[3px]">{piece.text}</span>
          : <span key={index}>{piece.text}</span>))}
      </button>
    </li>
  );
});
