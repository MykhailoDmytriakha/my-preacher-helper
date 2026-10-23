import { BIBLE_BOOKS_DATA } from '@/utils/bibleBooks';
import { BIBLES, type BibleId } from '@/utils/bibles';
import { BIBLE_TEXT_CACHE, isBookShaped } from '@/utils/bibleTextCache';
import { chapterCount } from '@/utils/versification';

/**
 * The Bible text of one book, as produced by `scripts/build-bible-text.mjs`.
 * `chapters[c - 1][v - 1]` is verse c:v; verses are contiguous from 1 in every chapter.
 */
export type BookText = {
  id: string;
  chapters: string[][];
};

export type VerseSegment =
  | { kind: 'text'; text: string; added: boolean; jesus: boolean }
  | { kind: 'break' };

export type ParsedVerse = {
  opensParagraph: boolean;
  segments: VerseSegment[];
};

const PARAGRAPH_MARK = '¶';

/** How long a book may take to arrive whole before the reader offers to try again. */
export const BOOK_TEXT_DEADLINE_MS = 15_000;

/** The file name of a book: its canonical id in lower case, spaces as hyphens ("1 Timothy" → "1-timothy"). */
export const bookSlug = (bookId: string): string => bookId.toLowerCase().replace(/\s+/g, '-');

export const bookIdFromSlug = (slug: string): string | undefined =>
  BIBLE_BOOKS_DATA.find((book) => bookSlug(book.id) === slug)?.id;

export const bookTextUrl = (bookId: string, bible: BibleId): string => `${BIBLES[bible].textBase}/${bookSlug(bookId)}.json`;

/**
 * Splits a stored verse into segments. The stored text keeps only two marks — `<i>` for words the
 * translators added and `<J>` for words of Jesus — plus "\n" for a line break; a leading "¶" opens
 * a paragraph. Marks are read as markers, never as HTML.
 */
export function parseVerse(raw: string): ParsedVerse {
  const opensParagraph = raw.startsWith(PARAGRAPH_MARK);
  const body = opensParagraph ? raw.slice(PARAGRAPH_MARK.length) : raw;
  const segments: VerseSegment[] = [];
  let added = false;
  let jesus = false;
  for (const token of body.split(/(<\/?i>|<\/?J>|\n)/)) {
    if (token === '') continue;
    if (token === '<i>') added = true;
    else if (token === '</i>') added = false;
    else if (token === '<J>') jesus = true;
    else if (token === '</J>') jesus = false;
    else if (token === '\n') segments.push({ kind: 'break' });
    else segments.push({ kind: 'text', text: token, added, jesus });
  }
  return { opensParagraph, segments };
}

/** The verse as plain words — for lengths and search, without marks. */
export const verseWords = (raw: string): string =>
  raw.replace(/<\/?(?:i|J)>/g, '').replace(PARAGRAPH_MARK, '').replace(/\n/g, ' ');

/**
 * THE ONE CHECK OF A BOOK FILE — for the copy on the device, for the network answer and for the
 * warm-up alike. A file is this book only when it names the book, has exactly the book's chapters
 * and none of them is empty: a page that came back "200" from a hotel Wi-Fi, another book or a
 * truncated file must never be kept, because a kept copy is read first, forever.
 */
export const isBookText = (value: unknown, bookId: string, bible: BibleId): value is BookText =>
  // The chapters of THIS Bible: Joel has four in Ohienko and three in the Synodal.
  isBookShaped(value) && value.id === bookId && value.chapters.length === chapterCount(bible, bookId);

type TextSources = {
  fetchFn?: typeof fetch;
  cacheStorage?: CacheStorage;
  deadlineMs?: number;
};

const defaultCacheStorage = (): CacheStorage | undefined =>
  typeof caches === 'undefined' ? undefined : caches;

/** The device's copy store, or nothing — Cache Storage can be missing or refuse to open. */
const openTextCache = async (cacheStorage: CacheStorage | undefined): Promise<Cache | undefined> => {
  if (!cacheStorage) return undefined;
  try {
    return await cacheStorage.open(BIBLE_TEXT_CACHE);
  } catch {
    return undefined;
  }
};

/** Every step on the copy store may refuse (a full disk, a private window): a refusal is "no copy". */
const keptCopy = async (cache: Cache | undefined, url: string): Promise<Response | undefined> => {
  try {
    return await cache?.match(url);
  } catch {
    return undefined;
  }
};

const forget = async (cache: Cache | undefined, url: string): Promise<void> => {
  try {
    await cache?.delete(url);
  } catch {
    // Nothing more to do: the next read checks the copy again.
  }
};

const readJson = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
};

/** The whole answer — headers and body — within the deadline, or an error; a silent network never hangs the reader. */
async function fetchWithin(fetchFn: typeof fetch, url: string, deadlineMs: number): Promise<{ response: Response; data: unknown }> {
  const controller = typeof AbortController === 'undefined' ? undefined : new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller?.abort();
      reject(new Error(`No answer within ${deadlineMs} ms: ${url}`));
    }, deadlineMs);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetchFn(url, controller ? { signal: controller.signal } : undefined);
        const data = response.ok ? await readJson(response.clone()) : undefined;
        return { response, data };
      })(),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One book from the device's copy only — no network: what can be read at once, offline too. A copy
 * that fails the check is thrown away, as `fetchBookText` does, and counts as none.
 */
export async function keptBookText(
  bookId: string,
  bible: BibleId,
  { cacheStorage = defaultCacheStorage() }: Pick<TextSources, 'cacheStorage'> = {},
): Promise<BookText | null> {
  const url = bookTextUrl(bookId, bible);
  const cache = await openTextCache(cacheStorage);
  const kept = await keptCopy(cache, url);
  if (!kept) return null;
  const data = await readJson(kept);
  if (isBookText(data, bookId, bible)) return data;
  await forget(cache, url);
  return null;
}

/**
 * One book: the copy on the device first, the network only when there is no good copy. The page
 * keeps the copy itself rather than relying on the service worker, which may not control the page
 * yet (the first visit) or at all (`npm run dev:no-pwa`). A bad copy is thrown away and fetched again.
 */
export async function fetchBookText(
  bookId: string,
  bible: BibleId,
  { fetchFn = fetch, cacheStorage = defaultCacheStorage(), deadlineMs = BOOK_TEXT_DEADLINE_MS }: TextSources = {},
): Promise<BookText> {
  const url = bookTextUrl(bookId, bible);
  const cache = await openTextCache(cacheStorage);
  const kept = await keptCopy(cache, url);
  if (kept) {
    const data = await readJson(kept);
    if (isBookText(data, bookId, bible)) return data;
    await forget(cache, url);
  }
  const { response, data } = await fetchWithin(fetchFn, url, deadlineMs);
  if (!response.ok) throw new Error(`Bible text for ${bookId}: HTTP ${response.status}`);
  if (!isBookText(data, bookId, bible)) {
    // The worker may have stored this answer on its way through: it must not stay.
    await forget(cache, url);
    throw new Error(`Bible text for ${bookId}: not this book`);
  }
  if (cache) {
    try {
      await cache.put(url, response);
    } catch {
      // A full disk: the book still reads now, only not offline.
    }
  }
  return data;
}

export type WarmResult = {
  /** Books that are on the device now. */
  onDevice: number;
  total: number;
  /** The device refused to store (no Cache Storage, or a write failed): offline reading is not possible. */
  storageFailed: boolean;
};

type WarmOptions = TextSources & {
  /** The Bible to keep on the device: the one the person reads. */
  bible: BibleId;
  bookIds?: string[];
  concurrency?: number;
};

/**
 * Downloads every book the device does not hold yet, a few at a time, so the whole Bible reads
 * offline after one visit online (about 1.5 MB a Bible). A copy that fails the check is replaced; a book
 * the network does not give now is simply left for the next run.
 */
export async function warmBibleText({
  bible,
  bookIds = BIBLE_BOOKS_DATA.map((book) => book.id),
  fetchFn = fetch,
  cacheStorage = defaultCacheStorage(),
  deadlineMs = BOOK_TEXT_DEADLINE_MS,
  concurrency = 3,
}: WarmOptions): Promise<WarmResult> {
  const total = bookIds.length;
  const cache = await openTextCache(cacheStorage);
  if (!cache) return { onDevice: 0, total, storageFailed: true };
  let onDevice = 0;
  let storageFailed = false;
  const missing: string[] = [];
  // Presence only: parsing all 66 kept copies on every visit would cost 6 MB of JSON. What is
  // stored here was checked before it was stored, and the reader checks every copy it reads.
  for (const bookId of bookIds) {
    if (await keptCopy(cache, bookTextUrl(bookId, bible))) onDevice += 1;
    else missing.push(bookId);
  }
  let next = 0;
  const worker = async () => {
    while (next < missing.length) {
      const bookId = missing[next++];
      const url = bookTextUrl(bookId, bible);
      try {
        const { response, data } = await fetchWithin(fetchFn, url, deadlineMs);
        if (!response.ok || !isBookText(data, bookId, bible)) {
          await forget(cache, url);
          continue;
        }
        try {
          await cache.put(url, response);
          onDevice += 1;
        } catch {
          storageFailed = true;
        }
      } catch {
        // Offline, a weak signal or a silent network: the next run asks again.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, missing.length) }, worker));
  return { onDevice, total, storageFailed };
}

const warmInFlight = new Map<BibleId, Promise<WarmResult>>();
const warmAgain = new Set<BibleId>();

/**
 * The warm-up, never twice at once for one Bible: a reconnect and a return to the tab may both ask
 * for it. A request that arrives during a run is not lost — a book that failed before the
 * connection came back would be skipped by that run — so one more pass follows over what is still
 * missing. Another Bible warms on its own: switching the translation does not wait for the last one.
 */
export function warmBibleTextOnce(options: WarmOptions): Promise<WarmResult> {
  const { bible } = options;
  const running = warmInFlight.get(bible);
  if (running) {
    warmAgain.add(bible);
    return running;
  }
  const run = async (): Promise<WarmResult> => {
    let result = await warmBibleText(options);
    while (warmAgain.has(bible)) {
      warmAgain.delete(bible);
      result = await warmBibleText(options);
    }
    return result;
  };
  const started = run().finally(() => {
    warmInFlight.delete(bible);
  });
  warmInFlight.set(bible, started);
  return started;
}
