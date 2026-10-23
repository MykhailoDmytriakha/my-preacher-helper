import { isBibleId, type BibleId } from '@/utils/bibles';
import { keptLine, lineKey } from '@/utils/bibleSearch/words';
import { deviceChoice } from '@/utils/deviceChoice';

/*
 * THE SEARCH HISTORY ON THIS DEVICE: the searches a verse was opened from, newest first (the owner,
 * 2026-10-23: a button by «?» in the line). A search joins when a verse is opened from it, not on every
 * keystroke, so «Ио», «Иоа», «Иоан» never fill it. It lives on the device, as the trail of places does —
 * nothing is written to the account on a move through the Bible — and each search keeps the Bible it
 * was typed for: words of the Synodal text find nothing in the King James.
 */
/** `asWords`: the first word was searched as a word, not read as a book («плач скрежет»). */
export type SearchHistoryEntry = { line: string; bible: BibleId; at: number; asWords?: boolean };
type SearchHistory = { entries: SearchHistoryEntry[] };

const KEPT = 30;
const EMPTY: SearchHistory = { entries: [] };

function isEntry(value: unknown): value is SearchHistoryEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<SearchHistoryEntry>;
  return typeof entry.line === 'string' && entry.line.trim() !== '' && isBibleId(entry.bible) && typeof entry.at === 'number' && Number.isFinite(entry.at)
    && (entry.asWords === undefined || typeof entry.asWords === 'boolean');
}

function parse(raw: string | null): SearchHistory {
  if (!raw) return EMPTY;
  try {
    const value = JSON.parse(raw) as { entries?: unknown };
    const entries = Array.isArray(value.entries) ? value.entries.filter(isEntry).slice(0, KEPT) : [];
    return entries.length ? { entries } : EMPTY;
  } catch {
    return EMPTY;
  }
}

const historyChoice = deviceChoice<SearchHistory>({ key: 'bible:search-history', parse, fallback: EMPTY });

const sameSearch = (a: SearchHistoryEntry, line: string, bible: BibleId, asWords: boolean) =>
  a.bible === bible && Boolean(a.asWords) === asWords && lineKey(a.line) === lineKey(line);

/** A verse was opened from this search: it goes to the top, once. */
export function rememberSearch(line: string, bible: BibleId, asWords = false, at = Date.now()): void {
  const trimmed = keptLine(line);
  if (!trimmed) return;
  const rest = historyChoice.read().entries.filter((entry) => !sameSearch(entry, trimmed, bible, asWords));
  historyChoice.save({ entries: [{ line: trimmed, bible, at, ...(asWords ? { asWords } : {}) }, ...rest].slice(0, KEPT) });
}

export function forgetSearch(entry: SearchHistoryEntry): void {
  historyChoice.save({ entries: historyChoice.read().entries.filter((each) => each !== entry && !(each.at === entry.at && each.line === entry.line)) });
}

/** Clears the history and gives back what it held, for «Вернуть». */
export function clearSearchHistory(): SearchHistoryEntry[] {
  const before = historyChoice.read().entries;
  historyChoice.save({ entries: [] });
  return before;
}

export function restoreSearchHistory(entries: SearchHistoryEntry[]): void {
  historyChoice.save({ entries: entries.slice(0, KEPT) });
}

export function useSearchHistory(): SearchHistoryEntry[] {
  return historyChoice.useChoice().entries;
}

export function resetSearchHistoryForTests(): void {
  historyChoice.resetForTests();
}
