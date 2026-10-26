import { useEffect, useSyncExternalStore } from 'react';

import { BIBLE_BOOKS_DATA } from '@/utils/bibleBooks';
import { fetchBookText, keptBookText } from '@/utils/bibleText';

import { BibleSearchIndex } from './searchIndex';

import type { BibleId } from '@/utils/bibles';

/**
 * ONE SEARCH INDEX PER BIBLE FOR THE PAGE'S LIFE. It is built in two passes: first every book the device
 * holds — the copy the warm-up keeps (`warmBibleText`), read without the network, so a stalled download
 * never keeps a saved book out — then the network for the books not there yet. Each book is searchable
 * as soon as it joins. A book the network does not give now is left out and asked for again when the
 * connection returns: search then covers the books it has, and says so.
 */
export type SearchIndexState = {
  index: BibleSearchIndex;
  /** Books searchable now. */
  indexed: number;
  total: number;
  /** Books still on their way. */
  loading: boolean;
  /** Books asked for and not given (offline, or the network failed). */
  missing: number;
  /** Changes whenever a book joins: results computed for an older version are stale. */
  version: number;
};

/** `again`: asked to load while a run was going (the connection came back): one more pass follows it. */
type Entry = { state: SearchIndexState; running: Promise<void> | null; again: boolean; failed: Set<string>; listeners: Set<() => void> };

const KEPT_CONCURRENCY = 6;
const NETWORK_CONCURRENCY = 4;
const entries = new Map<BibleId, Entry>();

function entryFor(bible: BibleId, order: readonly string[]): Entry {
  let entry = entries.get(bible);
  if (!entry) {
    entry = {
      state: { index: new BibleSearchIndex(order), indexed: 0, total: BIBLE_BOOKS_DATA.length, loading: false, missing: 0, version: 0 },
      running: null,
      again: false,
      failed: new Set(),
      listeners: new Set(),
    };
    entries.set(bible, entry);
  }
  return entry;
}

function publish(entry: Entry, change: Partial<SearchIndexState>): void {
  entry.state = { ...entry.state, ...change, version: entry.state.version + 1 };
  entry.listeners.forEach((listener) => listener());
}

/** Brings every book of the Bible into its index that is not there yet; one run at a time per Bible. */
export function loadSearchIndex(bible: BibleId, order: readonly string[]): Promise<void> {
  const entry = entryFor(bible, order);
  if (entry.running) {
    // A book that failed before the connection returned would be skipped by the run now going.
    entry.again = true;
    return entry.running;
  }
  const { index } = entry.state;
  const waiting = order.filter((bookId) => !index.has(bookId));
  if (!waiting.length) return Promise.resolve();
  entry.failed.clear();
  publish(entry, { loading: true, missing: 0 });
  const pass = async (books: readonly string[], concurrency: number, read: (bookId: string) => Promise<void>) => {
    let next = 0;
    const worker = async () => {
      while (next < books.length) await read(books[next++]);
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, books.length) }, worker));
  };
  const add = (text: Parameters<BibleSearchIndex['addBook']>[0]) => {
    index.addBook(text);
    publish(entry, { indexed: index.bookCount });
  };
  entry.running = (async () => {
    await pass(waiting, KEPT_CONCURRENCY, async (bookId) => {
      const kept = await keptBookText(bookId, bible).catch(() => null);
      if (kept) add(kept);
    });
    await pass(waiting.filter((bookId) => !index.has(bookId)), NETWORK_CONCURRENCY, async (bookId) => {
      try {
        add(await fetchBookText(bookId, bible));
      } catch {
        entry.failed.add(bookId);
      }
    });
  })().then(() => {
    entry.running = null;
    publish(entry, { loading: false, missing: entry.failed.size });
    if (entry.again) {
      entry.again = false;
      void loadSearchIndex(bible, order);
    }
  });
  return entry.running;
}

/** The index of a Bible as it stands, without starting a load. */
export function searchIndexState(bible: BibleId, order: readonly string[]): SearchIndexState {
  return entryFor(bible, order).state;
}

/**
 * The index for a screen. While `active` (the line is in use) the books are brought in, and again when
 * the connection returns.
 */
export function useSearchIndex(bible: BibleId, order: readonly string[], active: boolean): SearchIndexState {
  const entry = entryFor(bible, order);
  const state = useSyncExternalStore(
    (listener) => {
      entry.listeners.add(listener);
      return () => entry.listeners.delete(listener);
    },
    () => entry.state,
    () => entry.state,
  );
  useEffect(() => {
    if (!active) return undefined;
    void loadSearchIndex(bible, order);
    const again = () => void loadSearchIndex(bible, order);
    window.addEventListener('online', again);
    return () => window.removeEventListener('online', again);
  }, [active, bible, order]);
  return state;
}

/** Forgets every index — for tests. */
export function resetSearchIndexesForTests(): void {
  entries.clear();
}
