'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode, type RefObject } from 'react';

import { useMediaQuery } from '@/hooks/useMediaQuery';

import { FOUND_ATTRIBUTE } from '../BookRibbon';

import { closeFound, foundAt, showFound, shownFor, useFoundSearch, type FoundVerse } from './foundInBible';
import { FoundPanel } from './FoundPanel';
import { rememberOpened } from './lastSearch';
import { SHOWN_VERSES } from './searchModel';
import { useFoundVerses } from './useFoundVerses';

import type { MinimapFound } from '../BibleMinimap';
import type { AppLocale } from '@/utils/appLocale';
import type { BibleId } from '@/utils/bibles';

type Place = { chapter: number; verse: number };
type SearchRequest = { line: string; asWords: boolean };

/** The reader as wide as with the trail's widest column: the found verses stand in its place. */
const READER_WIDTH = 'max-w-[1544px]';

/**
 * THE FOUND VERSES IN THE READER (`foundInBible.ts`): on a screen with room for a column (from 1024 px, as the trail's),
 * a search's verse opened from the search window keeps the whole search beside the text — the column in the trail's
 * place, a thin amber band on the minimap at each verse, all alike, a frame round each verse in the text. The verse the
 * reading stands at is framed thicker in the text and the column; «К поиску» opens the same search window on it. A narrower screen opens the verse alone,
 * as before.
 */
export function useFoundInReader({ bible, bookId, locale, wide, textRef, drawn, ready, currentChapter, currentVerse, arrival, openPlace }: {
  bible: BibleId; bookId: string; locale: AppLocale; wide: boolean;
  textRef: RefObject<HTMLElement | null>;
  /** The chapters drawn now (`useChapterWindow`): the frames are set again on the rows that come in. */
  drawn: unknown;
  ready: boolean;
  currentChapter: number; currentVerse: number;
  /** The place last arrived at: the list brings its found verse into sight, as the trail its light. */
  arrival: Place | null;
  openPlace: (book: string, place: Place) => void;
}): {
  panel: ReactNode; readerWidth: string | null; mapFound: readonly MinimapFound[] | undefined;
  onOpenFound: ((search: { line: string; asWords: boolean }, book: string, place: Place) => void) | undefined;
  /** «К поиску» asked: the search window opens on it once and says so (`takeSearchRequest`), so a window made anew opens nothing. */
  searchRequest: SearchRequest | null;
  takeSearchRequest: () => void;
} {
  const roomForColumn = useMediaQuery('(min-width: 1024px)', false);
  const room = wide && roomForColumn;
  const found = useFoundSearch();
  const shown = room && found?.bible === bible ? found : null;
  const verses = useFoundVerses(shown, bible);
  const at = verses ? foundAt(verses.verses, bookId, currentChapter, currentVerse) : null;
  const arrivedAt = verses && arrival ? foundAt(verses.verses, bookId, arrival.chapter, arrival.verse) : null;
  const [searchRequest, setSearchRequest] = useState<SearchRequest | null>(null);

  const framed = useMemo(() => new Set((verses?.verses ?? []).filter((verse) => verse.bookId === bookId).map((verse) => `${verse.chapter}:${verse.verse}`)), [verses, bookId]);
  const atRow = at ? `${at.chapter}:${at.verse}` : null;
  // The frames on the rows: set on the rows themselves, like the arrival, and again as chapters are drawn — one pass
  // over the rows drawn, however many verses the search found in the book.
  useEffect(() => {
    const root = textRef.current;
    if (!root) return;
    root.querySelectorAll<HTMLElement>('[data-verse]').forEach((row) => {
      const key = row.getAttribute('data-verse') ?? '';
      const value = framed.has(key) ? (key === atRow ? 'at' : 'on') : null;
      if (row.getAttribute(FOUND_ATTRIBUTE) === value) return;
      if (value) row.setAttribute(FOUND_ATTRIBUTE, value);
      else row.removeAttribute(FOUND_ATTRIBUTE);
    });
  }, [framed, atRow, textRef, drawn, ready]);

  const onOpenFound = useCallback((search: { line: string; asWords: boolean }, book: string, place: Place) => {
    showFound({ bible, ...search });
    openPlace(book, place);
  }, [bible, openPlace]);

  const mapFound = useMemo(() => (verses
    ? verses.verses.filter((verse) => verse.bookId === bookId).map((verse) => ({ chapter: verse.chapter, verse: verse.verse }))
    : undefined), [verses, bookId]);

  const onGo = useCallback((verse: FoundVerse) => openPlace(verse.bookId, { chapter: verse.chapter, verse: verse.verse }), [openPlace]);
  const takeSearchRequest = useCallback(() => setSearchRequest(null), []);

  const panel = shown && verses ? (
    <FoundPanel
      // Another search is another list: drawn from its first hundred.
      key={`${shown.asWords}:${shown.line}`}
      line={shown.line}
      found={verses}
      atKey={at?.key ?? null}
      arrived={arrivedAt && arrival ? { key: arrivedAt.key, of: arrival } : null}
      locale={locale}
      onGo={onGo}
      onBack={() => {
        // The search window opens with its arrows on the verse stood at, as a search of the history does (`lastSearch.ts`).
        if (at) rememberOpened(bible, shown.line, shown.asWords, at.key, shownFor(verses.windowOrder, at.key, SHOWN_VERSES));
        setSearchRequest({ line: shown.line, asWords: shown.asWords });
      }}
      onClose={closeFound}
    />
  ) : null;

  return { panel, readerWidth: panel ? READER_WIDTH : null, mapFound, onOpenFound: room ? onOpenFound : undefined, searchRequest, takeSearchRequest };
}
