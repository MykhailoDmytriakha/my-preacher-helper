import { lineKey } from '@/utils/bibleSearch/words';

import type { BibleId } from '@/utils/bibles';

/**
 * THE SEARCH OF THIS VISIT: the line a verse was last opened from (and whether its first word was searched
 * as a word), which verses were opened from it, and the last of them. The opened verses are marked
 * «Открывали», and that search, chosen again from the history, opens with the arrows on the last of them.
 * The line itself always opens empty: the window of the books is for the books, and a search brought back
 * there unasked came back even after it was cleared (the owner, 2026-10-23). It lives in the page's memory
 * only, and only for half an hour.
 */
const RESUME_MS = 30 * 60 * 1000;

/** `limit`: how many of its verses were shown when the last one was opened — beyond the first forty, after «Показать ещё». */
export type LastSearch = { line: string; asWords: boolean; opened: ReadonlySet<string>; lastKey: string; limit: number };
type Kept = { bible: BibleId; line: string; asWords: boolean; at: number; opened: Set<string>; lastKey: string; limit: number };

let last: Kept | null = null;

/** The search of this visit when it is this one (`line` as typed or kept: `lineKey` decides). */
export function lastSearchOf(bible: BibleId, line: string, asWords: boolean, now = Date.now()): LastSearch | null {
  if (!last || last.bible !== bible || now - last.at >= RESUME_MS || last.line !== lineKey(line) || last.asWords !== asWords) return null;
  return { line: last.line, asWords: last.asWords, opened: last.opened, lastKey: last.lastKey, limit: last.limit };
}

/** A verse (`key`, «John 6:35») was opened from the line `line`, with `limit` of its verses shown. */
export function rememberOpened(bible: BibleId, typed: string, asWords: boolean, key: string, limit: number, now = Date.now()): void {
  const line = lineKey(typed);
  if (!last || last.bible !== bible || last.line !== line || last.asWords !== asWords) last = { bible, line, asWords, at: now, opened: new Set(), lastKey: key, limit };
  last.opened.add(key);
  last.lastKey = key;
  last.limit = limit;
  last.at = now;
}

/** The verses opened from this very line in this visit. */
export function openedFrom(bible: BibleId, line: string, asWords: boolean): ReadonlySet<string> {
  return last && last.bible === bible && last.line === lineKey(line) && last.asWords === asWords ? last.opened : EMPTY;
}

const EMPTY: ReadonlySet<string> = new Set();

export function resetLastSearchForTests(): void {
  last = null;
}
