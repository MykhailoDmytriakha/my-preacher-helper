import { useEffect, useMemo, useSyncExternalStore } from 'react';

import { BIBLE_BOOKS_DATA } from '@/utils/bibleBooks';
import { BIBLES, type BibleId } from '@/utils/bibles';
import { fetchBookText, keptBookText } from '@/utils/bibleText';

import { BibleSearchIndex } from './searchIndex';
import { loadWordFormLexicon, wordFormLexiconReady } from './wordFormLexicon';

/** One index per Bible; text arrivals and lexical readiness are independent parts of the same search state. */
export type SearchIndexState = {
  index: BibleSearchIndex;
  indexed: number;
  total: number;
  loading: boolean;
  missing: number;
  version: number;
  wordFormsReady: boolean;
  wordFormsError: Error | null;
};

type Entry = {
  state: SearchIndexState;
  booksRunning: Promise<void> | null;
  booksAgain: boolean;
  wordFormsRunning: Promise<void> | null;
  wordFormsAgain: boolean;
  failed: Set<string>;
  listeners: Set<() => void>;
};

const KEPT_CONCURRENCY = 6;
const NETWORK_CONCURRENCY = 4;
const entries = new Map<BibleId, Entry>();
const lexicalReady = (bible: BibleId): boolean => {
  const language = BIBLES[bible].language;
  return language === 'en' || wordFormLexiconReady(language);
};

function entryFor(bible: BibleId, order: readonly string[]): Entry {
  let entry = entries.get(bible);
  if (!entry) {
    entry = {
      state: { index: new BibleSearchIndex(order), indexed: 0, total: BIBLE_BOOKS_DATA.length,
        loading: false, missing: 0, version: 0, wordFormsReady: lexicalReady(bible), wordFormsError: null },
      booksRunning: null, booksAgain: false, wordFormsRunning: null, wordFormsAgain: false,
      failed: new Set(), listeners: new Set(),
    };
    entries.set(bible, entry);
  }
  return entry;
}

function publish(entry: Entry, change: Partial<SearchIndexState>): void {
  entry.state = { ...entry.state, ...change, loading: Boolean(entry.booksRunning || entry.wordFormsRunning), version: entry.state.version + 1 };
  entry.listeners.forEach(listener => listener());
}

/** One language request is shared by its consumers; a reconnect during a refusal earns one later attempt. */
function loadWordForms(bible: BibleId, entry: Entry): Promise<void> {
  const language = BIBLES[bible].language;
  if (language === 'en' || lexicalReady(bible)) {
    if (!entry.state.wordFormsReady || entry.state.wordFormsError) publish(entry, { wordFormsReady: true, wordFormsError: null });
    return Promise.resolve();
  }
  if (entry.wordFormsRunning) {
    entry.wordFormsAgain = true;
    return entry.wordFormsRunning;
  }
  entry.wordFormsRunning = loadWordFormLexicon(language).then(() => {
    entry.wordFormsRunning = null;
    entry.wordFormsAgain = false;
    publish(entry, { wordFormsReady: true, wordFormsError: null });
  }, error => {
    entry.wordFormsRunning = null;
    const again = entry.wordFormsAgain;
    entry.wordFormsAgain = false;
    publish(entry, { wordFormsReady: false, wordFormsError: error instanceof Error ? error : new Error(String(error)) });
    if (again) void loadWordForms(bible, entry);
  });
  publish(entry, { wordFormsReady: false, wordFormsError: null });
  return entry.wordFormsRunning;
}

async function pass(books: readonly string[], concurrency: number, read: (bookId: string) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => { while (next < books.length) await read(books[next++]); };
  await Promise.all(Array.from({ length: Math.min(concurrency, books.length) }, worker));
}

/** Kept books join first, without waiting for unrelated network books or the language payload. */
function loadBooks(bible: BibleId, order: readonly string[], entry: Entry): Promise<void> {
  if (entry.booksRunning) {
    entry.booksAgain = true;
    return entry.booksRunning;
  }
  const { index } = entry.state;
  const waiting = order.filter(bookId => !index.has(bookId));
  if (!waiting.length) return Promise.resolve();
  entry.failed.clear();
  const add = (text: Parameters<BibleSearchIndex['addBook']>[0]) => {
    index.addBook(text);
    publish(entry, { indexed: index.bookCount });
  };
  entry.booksRunning = Promise.resolve().then(async () => {
    await pass(waiting, KEPT_CONCURRENCY, async bookId => {
      const kept = await keptBookText(bookId, bible).catch(() => null);
      if (kept) add(kept);
    });
    await pass(waiting.filter(bookId => !index.has(bookId)), NETWORK_CONCURRENCY, async bookId => {
      try { add(await fetchBookText(bookId, bible)); }
      catch { entry.failed.add(bookId); }
    });
  }).then(() => {
    entry.booksRunning = null;
    publish(entry, { missing: entry.failed.size });
    if (entry.booksAgain) {
      entry.booksAgain = false;
      void loadBooks(bible, order, entry);
    }
  });
  publish(entry, { missing: 0 });
  return entry.booksRunning;
}

/** Focus prepares book previews. A word query or its history requests the independent lexical prerequisite too. */
export function loadSearchIndex(bible: BibleId, order: readonly string[], withWordForms = true): Promise<void> {
  const entry = entryFor(bible, order);
  const books = loadBooks(bible, order, entry);
  const wordForms = withWordForms ? loadWordForms(bible, entry) : Promise.resolve();
  return Promise.all([books, wordForms]).then(() => undefined);
}

export function searchIndexState(bible: BibleId, order: readonly string[]): SearchIndexState {
  return entryFor(bible, order).state;
}

export function useSearchIndex(bible: BibleId, order: readonly string[], active: boolean, withWordForms = active): SearchIndexState {
  const entry = entryFor(bible, order);
  const state = useSyncExternalStore(
    listener => { entry.listeners.add(listener); return () => entry.listeners.delete(listener); },
    () => entry.state, () => entry.state,
  );
  useEffect(() => {
    if (!active) return undefined;
    void loadSearchIndex(bible, order, withWordForms);
    const again = () => void loadSearchIndex(bible, order, withWordForms);
    window.addEventListener('online', again);
    return () => window.removeEventListener('online', again);
  }, [active, bible, order, withWordForms]);
  // A new query renders before its effect: it is already waiting, never an unverified zero-result answer.
  return useMemo(() => withWordForms && !state.wordFormsReady && !state.wordFormsError
    ? { ...state, loading: true } : state, [state, withWordForms]);
}

export function resetSearchIndexesForTests(): void { entries.clear(); }
