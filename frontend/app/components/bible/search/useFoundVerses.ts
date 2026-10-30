'use client';

import { useMemo } from 'react';

import { answeringOf, chooseReading } from '@/utils/bibleSearch/lineChoice';
import { useSearchIndex } from '@/utils/bibleSearch/searchIndexStore';

import { booksOf, bookSequence } from '../bookOrder';

import { foundInOrder, foundKey, type FoundSearch, type FoundVerse } from './foundInBible';
import { litPieces } from './searchModel';

import type { BibleId } from '@/utils/bibles';

export type FoundPieces = Array<{ text: string; lit: boolean }>;
export type FoundVerses = {
  /** In Bible order: the order the list shows and the reading meets them. */
  verses: FoundVerse[];
  /** A verse's words, what the search found marked — worked out only for the rows the list draws. */
  piecesOf: (text: string) => FoundPieces;
  /** The keys in the search window's own order, to know how many verses it must show to stand on one. */
  windowOrder: string[];
  /** Books still arriving: the list may grow. */
  loading: boolean;
};

/** The verses the search shown in the Bible finds — read by the search's own rules over the same index as its window. */
export function useFoundVerses(found: FoundSearch | null, bible: BibleId): FoundVerses | null {
  const books = useMemo(() => booksOf(bible), [bible]);
  const order = useMemo(() => bookSequence(books), [books]);
  const active = Boolean(found && found.bible === bible);
  const index = useSearchIndex(bible, order, active);
  return useMemo(() => {
    if (!found || !active) return null;
    const { reading, answer } = chooseReading(found.line, { bible, books, asWords: found.asWords }, answeringOf(index.index, index.indexed, books));
    if (reading.kind !== 'search' || !answer) return { verses: [], piecesOf: (text) => [{ text, lit: false }], windowOrder: [], loading: index.loading };
    return {
      verses: foundInOrder(answer.hits, order),
      piecesOf: (text) => litPieces(text, reading.query, answer.matchers),
      windowOrder: answer.hits.map((hit) => foundKey(hit.book, hit.chapter, hit.verse)),
      loading: index.loading,
    };
  }, [found, active, bible, books, order, index]);
}
