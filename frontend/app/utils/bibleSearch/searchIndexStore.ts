import { useEffect, useMemo, useSyncExternalStore } from 'react';

import { bibleAssetFetch } from '@/utils/bibleAssetFetch';
import { BIBLE_BOOKS_DATA } from '@/utils/bibleBooks';
import { BIBLES, type BibleId } from '@/utils/bibles';
import { fetchBookText, keptBookText } from '@/utils/bibleText';
import { serverInReach, subscribeToReachableAgain } from '@/utils/reachableAgain';

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

type Replay = { manual: boolean; auto: boolean };

type Entry = {
  state: SearchIndexState;
  booksRunning: Promise<void> | null;
  booksAgain: Replay | null;
  wordFormsRunning: Promise<void> | null;
  wordFormsAgain: Replay | null;
  failed: Set<string>;
  reportedFailures: Set<string>;
  active: number;
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
      booksRunning: null, booksAgain: null, wordFormsRunning: null, wordFormsAgain: null,
      failed: new Set(), reportedFailures: new Set(), active: 0, listeners: new Set(),
    };
    entries.set(bible, entry);
  }
  return entry;
}

function publish(entry: Entry, change: Partial<SearchIndexState>): void {
  entry.state = { ...entry.state, ...change, loading: Boolean(entry.booksRunning || entry.wordFormsRunning), version: entry.state.version + 1 };
  entry.listeners.forEach(listener => listener());
}

function queueReplay(previous: Replay | null, automatic: boolean): Replay {
  return { manual: Boolean(previous?.manual || !automatic), auto: Boolean(previous?.auto || automatic) };
}

function shouldReplay(replay: Replay | null, entry: Entry): boolean {
  return Boolean(replay?.manual || (replay?.auto && entry.active > 0 && serverInReach()));
}

/** One language request is shared by its consumers; a reconnect during a refusal earns one later attempt. */
function loadWordForms(bible: BibleId, entry: Entry, automatic: boolean): Promise<void> {
  const language = BIBLES[bible].language;
  if (language === 'en' || lexicalReady(bible)) {
    if (!entry.state.wordFormsReady || entry.state.wordFormsError) publish(entry, { wordFormsReady: true, wordFormsError: null });
    return Promise.resolve();
  }
  if (entry.wordFormsRunning) {
    entry.wordFormsAgain = queueReplay(entry.wordFormsAgain, automatic);
    return entry.wordFormsRunning;
  }
  entry.wordFormsRunning = loadWordFormLexicon(language).then(() => {
    entry.wordFormsRunning = null;
    entry.wordFormsAgain = null;
    publish(entry, { wordFormsReady: true, wordFormsError: null });
  }, error => {
    entry.wordFormsRunning = null;
    const again = entry.wordFormsAgain;
    entry.wordFormsAgain = null;
    publish(entry, { wordFormsReady: false, wordFormsError: error instanceof Error ? error : new Error(String(error)) });
    if (shouldReplay(again, entry)) void loadWordForms(bible, entry, !again?.manual);
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
function loadBooks(bible: BibleId, order: readonly string[], entry: Entry, automatic: boolean): Promise<void> {
  if (entry.booksRunning) {
    entry.booksAgain = queueReplay(entry.booksAgain, automatic);
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
      const fetchFn = bibleAssetFetch(() => {
        if (!entry.active || entry.reportedFailures.has(bookId)) return false;
        entry.reportedFailures.add(bookId);
        return true;
      });
      try {
        add(await fetchBookText(bookId, bible, { fetchFn }));
        entry.reportedFailures.delete(bookId);
      } catch {
        entry.failed.add(bookId);
      }
    });
  }).then(() => {
    entry.booksRunning = null;
    publish(entry, { missing: entry.failed.size });
    const again = entry.booksAgain;
    entry.booksAgain = null;
    if (shouldReplay(again, entry)) void loadBooks(bible, order, entry, !again?.manual);
  });
  publish(entry, { missing: 0 });
  return entry.booksRunning;
}

/** Focus prepares book previews. A word query or its history requests the independent lexical prerequisite too. */
export function loadSearchIndex(bible: BibleId, order: readonly string[], withWordForms = true, automatic = false): Promise<void> {
  const entry = entryFor(bible, order);
  const books = loadBooks(bible, order, entry, automatic);
  const wordForms = withWordForms ? loadWordForms(bible, entry, automatic) : Promise.resolve();
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
    entry.active += 1;
    let alive = true;
    const stop = subscribeToReachableAgain(() => {
      queueMicrotask(() => {
        if (alive && serverInReach()) void loadSearchIndex(bible, order, withWordForms, true);
      });
    });
    void loadSearchIndex(bible, order, withWordForms, true);
    return () => {
      alive = false;
      entry.active -= 1;
      stop();
    };
  }, [active, bible, entry, order, withWordForms]);
  // A new query renders before its effect: it is already waiting, never an unverified zero-result answer.
  return useMemo(() => withWordForms && !state.wordFormsReady && !state.wordFormsError
    ? { ...state, loading: true } : state, [state, withWordForms]);
}

export function resetSearchIndexesForTests(): void { entries.clear(); }
