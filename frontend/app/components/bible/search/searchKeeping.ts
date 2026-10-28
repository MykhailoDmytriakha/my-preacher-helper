import { scopeBookIds, type SearchAnswer } from '@/utils/bibleSearch/results';

import type { LineReading } from '@/utils/bibleSearch/query';

/**
 * WHICH SEARCH THE HISTORY KEEPS (the owner, 2026-10-27: «сделал поиск, прошло 10 секунд и не поменял — в историю;
 * выбрал стих — в историю; подбери и другие случаи, чтобы история заполнялась хорошо»; the cases weighed with Codex,
 * `.cases/2026-10-12-block-diagram/artifacts/history-cases-codex.md`). A search of words that found verses — not a place («Ин
 * 3:16», the trail of places keeps those), not a list of books, not a line that found nothing (a typo stands still too,
 * and there is nothing to come back to). It is kept at once by an act on its results — a verse chosen, copied or
 * opened, «Показать ещё» — or after it stood `KEEP_AFTER_MS` unchanged with its verses in sight. A lone word that
 * begins books' names («Ио», «Иоа») is a book being typed: it waits for an act, never for the clock.
 */
export const KEEP_AFTER_MS = 10_000;

/** `meaning`: how the line is read — its books and words; read anew (a book arrived), its clock starts again. */
export type SearchToKeep = { line: string; asWords: boolean; byRest: boolean; meaning: string };

/** `versesShown`: the results show verses — «ад», «ум» find some, but two letters show only books for now (Codex, 2026-10-27). */
export function searchToKeep(reading: LineReading, answer: SearchAnswer | null, searched: string, asWords: boolean, versesShown: boolean): SearchToKeep | null {
  if (reading.kind !== 'search' || !answer?.hits.length || !versesShown) return null;
  const { scope, terms, phrases } = reading.query;
  if (!terms.length && !phrases.length) return null;
  const meaning = JSON.stringify([scope ? scopeBookIds(scope) : null, terms, phrases]);
  return { line: searched, asWords, byRest: !reading.prefixBooks.length, meaning };
}
