/** @jest-environment node */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BIBLE_BOOKS_DATA } from '@/utils/bibleBooks';
import {
  bookIdFromSlug, bookSlug, bookTextUrl, fetchBookText, isBookText, parseVerse, verseWords, warmBibleText, warmBibleTextOnce,
} from '@/utils/bibleText';
import { BIBLE_IDS, BIBLES, type BibleId } from '@/utils/bibles';
import { BIBLE_TEXT_CACHE } from '@/utils/bibleTextCache';

const PUBLIC_DIR = join(__dirname, '..', '..', 'public');

const readBook = (bookId: string, bible: BibleId = 'rst') =>
  JSON.parse(readFileSync(join(PUBLIC_DIR, bookTextUrl(bookId, bible)), 'utf8')) as { id: string; chapters: string[][] };

/** Books of the real shape: Jude and Obadiah have one chapter, Ruth four. */
const jude = { id: 'Jude', chapters: [['¶Иуда, раб Иисуса Христа']] };
const ruth = { id: 'Ruth', chapters: [['¶В те дни'], ['¶У Ноемини'], ['¶Свекровь'], ['¶Вооз']] };
const obadiah = { id: 'Obadiah', chapters: [['¶Видение Авдия']] };

class FakeCache {
  store = new Map<string, Response>();
  puts: string[] = [];
  deletes: string[] = [];
  failMatch = false;
  failPut = false;
  async match(url: string) {
    if (this.failMatch) throw new DOMException('refused', 'UnknownError');
    const kept = this.store.get(url);
    return kept ? kept.clone() : undefined;
  }
  async put(url: string, response: Response) {
    if (this.failPut) throw new DOMException('full', 'QuotaExceededError');
    this.puts.push(url);
    this.store.set(url, response.clone());
  }
  async delete(url: string) {
    this.deletes.push(url);
    return this.store.delete(url);
  }
}

const fakeStorage = (cache: FakeCache) => ({
  open: jest.fn(async (name: string) => {
    expect(name).toBe(BIBLE_TEXT_CACHE);
    return cache;
  }),
}) as unknown as CacheStorage;

const jsonResponse = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
const fetchReturning = (byUrl: Record<string, () => Response | Promise<Response>>) =>
  jest.fn(async (url: string) => {
    const answer = byUrl[url];
    if (!answer) throw new TypeError(`Failed to fetch ${url}`);
    return answer();
  }) as unknown as typeof fetch;

describe('parseVerse', () => {
  it('reads the paragraph mark, added words and words of Jesus as markers', () => {
    expect(parseVerse('¶Но Иисус сказал: <J>оставь <i>теперь</i></J> Тогда.')).toEqual({
      opensParagraph: true,
      segments: [
        { kind: 'text', text: 'Но Иисус сказал: ', added: false, jesus: false },
        { kind: 'text', text: 'оставь ', added: false, jesus: true },
        { kind: 'text', text: 'теперь', added: true, jesus: true },
        { kind: 'text', text: ' Тогда.', added: false, jesus: false },
      ],
    });
  });

  it('turns a stored line break into a break segment and leaves other text alone', () => {
    expect(parseVerse('первая строка\nвторая <b>строка</b>').segments).toEqual([
      { kind: 'text', text: 'первая строка', added: false, jesus: false },
      { kind: 'break' },
      { kind: 'text', text: 'вторая <b>строка</b>', added: false, jesus: false },
    ]);
  });

  it('gives the plain words for lengths', () => {
    expect(verseWords('¶Слово <J>Его</J>\nдальше')).toBe('Слово Его дальше');
  });
});

describe('book addresses', () => {
  it('turns every book id into a file name and back', () => {
    for (const book of BIBLE_BOOKS_DATA) {
      expect(bookIdFromSlug(bookSlug(book.id))).toBe(book.id);
    }
    expect(bookSlug('1 Timothy')).toBe('1-timothy');
    expect(bookTextUrl('Song of Solomon', 'rst')).toBe('/bible-text/rst/v1/song-of-solomon.json');
    expect(bookTextUrl('Song of Solomon', 'ubio')).toBe('/bible-text/ubio/v1/song-of-solomon.json');
    expect(bookIdFromSlug('no-such-book')).toBeUndefined();
  });
});

describe('isBookText', () => {
  it('accepts only this book, with exactly its chapters and none of them empty', () => {
    expect(isBookText(ruth, 'Ruth', 'rst')).toBe(true);
    expect(isBookText(ruth, 'Jude', 'rst')).toBe(false);
    expect(isBookText({ id: 'Ruth', chapters: [] }, 'Ruth', 'rst')).toBe(false);
    expect(isBookText({ id: 'Ruth', chapters: [['a'], ['b'], ['c']] }, 'Ruth', 'rst')).toBe(false);
    expect(isBookText({ id: 'Ruth', chapters: [['a'], [], ['c'], ['d']] }, 'Ruth', 'rst')).toBe(false);
    expect(isBookText('<html>sign in to the Wi-Fi</html>', 'Ruth', 'rst')).toBe(false);
  });

  it('counts the chapters of the Bible the file is from: Joel has four in Ohienko, three in the Synodal', () => {
    const joel = (chapters: number) => ({ id: 'Joel', chapters: Array.from({ length: chapters }, () => ['¶…']) });
    expect(isBookText(joel(4), 'Joel', 'ubio')).toBe(true);
    expect(isBookText(joel(3), 'Joel', 'ubio')).toBe(false);
    expect(isBookText(joel(3), 'Joel', 'rst')).toBe(true);
  });
});

// Each Bible's verse count and first verse, as its MyBible module has them.
const EDITIONS: Record<BibleId, { verses: number; genesis: string }> = {
  rst: { verses: 31162, genesis: '¶В начале сотворил Бог небо и землю.' },
  ubio: { verses: 31170, genesis: '¶На поча́тку Бог створив небо та землю.' },
  kjv: { verses: 31102, genesis: '¶In the beginning God created the heaven and the earth.' },
};

describe.each(BIBLE_IDS)('the %s text in public/', (bible) => {
  it('is exactly one file per book of the book table, named by the app\'s slug — the converter keeps a copy of both', () => {
    const files = readdirSync(join(PUBLIC_DIR, BIBLES[bible].textBase)).filter((name) => name.endsWith('.json')).sort();
    expect(files).toEqual(BIBLE_BOOKS_DATA.map((book) => `${bookSlug(book.id)}.json`).sort());
  });

  it('gives every id its own text: the module\'s book numbers rise in the order of the book table', () => {
    // The converter maps ids to the module's books by position; a swap of two books with the same
    // chapter count (Obadiah and Jude) would pass every other check, but breaks this order.
    const numbers = BIBLE_BOOKS_DATA.map((book) => (readBook(book.id, bible) as unknown as { source: number }).source);
    expect(numbers.every((number, index) => index === 0 || number > numbers[index - 1])).toBe(true);
    expect(numbers[0]).toBe(10);
    expect(numbers[numbers.length - 1]).toBe(730);
  });

  it('passes the reader\'s check for every book, with contiguous verses and only the kept marks', () => {
    let verses = 0;
    for (const book of BIBLE_BOOKS_DATA) {
      const text = readBook(book.id, bible);
      expect(isBookText(text, book.id, bible)).toBe(true);
      for (const chapter of text.chapters) {
        for (const verse of chapter) {
          expect(verse.replace(/<\/?(?:i|J)>/g, '')).not.toMatch(/[<>]/);
          verses += 1;
        }
      }
    }
    expect(verses).toBe(EDITIONS[bible].verses);
    expect(readBook('Genesis', bible).chapters[0][0]).toBe(EDITIONS[bible].genesis);
  });
});

describe('fetchBookText', () => {
  const url = bookTextUrl('Jude', 'rst');

  it('answers from the copy on the device without asking the network', async () => {
    const cache = new FakeCache();
    cache.store.set(url, jsonResponse(jude));
    const fetchFn = jest.fn();
    await expect(fetchBookText('Jude', 'rst', { fetchFn, cacheStorage: fakeStorage(cache) })).resolves.toEqual(jude);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('asks the network when there is no copy, and keeps one', async () => {
    const cache = new FakeCache();
    const fetchFn = fetchReturning({ [url]: () => jsonResponse(jude) });
    await expect(fetchBookText('Jude', 'rst', { fetchFn, cacheStorage: fakeStorage(cache) })).resolves.toEqual(jude);
    expect(cache.puts).toEqual([url]);
  });

  it('throws a bad copy away and reads the book again — Retry is never stuck on it', async () => {
    const cache = new FakeCache();
    cache.store.set(url, new Response('<html>Wi-Fi sign-in</html>', { status: 200 }));
    const fetchFn = fetchReturning({ [url]: () => jsonResponse(jude) });
    await expect(fetchBookText('Jude', 'rst', { fetchFn, cacheStorage: fakeStorage(cache) })).resolves.toEqual(jude);
    expect(cache.deletes).toEqual([url]);
    expect(cache.puts).toEqual([url]);
  });

  it('refuses an answer that is not this book, and removes what the worker may have stored', async () => {
    const cache = new FakeCache();
    const fetchFn = fetchReturning({ [url]: () => jsonResponse(obadiah) });
    await expect(fetchBookText('Jude', 'rst', { fetchFn, cacheStorage: fakeStorage(cache) })).rejects.toThrow('not this book');
    expect(cache.puts).toEqual([]);
    expect(cache.deletes).toEqual([url]);
  });

  it('reads from the network when the copy store refuses, and still returns the book when it cannot store it', async () => {
    const cache = new FakeCache();
    cache.failMatch = true;
    cache.failPut = true;
    const fetchFn = fetchReturning({ [url]: () => jsonResponse(jude) });
    await expect(fetchBookText('Jude', 'rst', { fetchFn, cacheStorage: fakeStorage(cache) })).resolves.toEqual(jude);
  });

  it('gives up on a silent network within the deadline instead of loading for ever', async () => {
    const fetchFn = jest.fn(() => new Promise<Response>(() => undefined)) as unknown as typeof fetch;
    await expect(fetchBookText('Jude', 'rst', { fetchFn, cacheStorage: undefined, deadlineMs: 20 })).rejects.toThrow('No answer within 20 ms');
  });

  it('reports a missing file', async () => {
    const fetchFn = fetchReturning({ [url]: () => new Response('', { status: 404 }) });
    await expect(fetchBookText('Jude', 'rst', { fetchFn, cacheStorage: undefined })).rejects.toThrow('HTTP 404');
  });
});

describe('warmBibleText', () => {
  it('downloads only the books the device does not hold, and stores only real books', async () => {
    const cache = new FakeCache();
    cache.store.set(bookTextUrl('Jude', 'rst'), jsonResponse(jude));
    const fetchFn = fetchReturning({
      [bookTextUrl('Ruth', 'rst')]: () => jsonResponse(ruth),
      [bookTextUrl('Obadiah', 'rst')]: () => new Response('<html>', { status: 200 }),
    });
    const result = await warmBibleText({ bible: 'rst', bookIds: ['Jude', 'Ruth', 'Obadiah'], fetchFn, cacheStorage: fakeStorage(cache) });
    expect(result).toEqual({ onDevice: 2, total: 3, storageFailed: false });
    expect(cache.puts).toEqual([bookTextUrl('Ruth', 'rst')]);
    expect(cache.deletes).toEqual([bookTextUrl('Obadiah', 'rst')]);
  });

  it('skips a book the network does not give, and one that falls silent, and goes on', async () => {
    const cache = new FakeCache();
    const fetchFn = jest.fn(async (url: string) => {
      if (url === bookTextUrl('Jude', 'rst')) throw new TypeError('Failed to fetch');
      if (url === bookTextUrl('Obadiah', 'rst')) return new Promise<Response>(() => undefined);
      return jsonResponse(ruth);
    }) as unknown as typeof fetch;
    const result = await warmBibleText({ bible: 'rst', bookIds: ['Jude', 'Obadiah', 'Ruth'], fetchFn, cacheStorage: fakeStorage(cache), concurrency: 1, deadlineMs: 20 });
    expect(result).toEqual({ onDevice: 1, total: 3, storageFailed: false });
  });

  it('says when the device refuses to store, and when there is no store at all', async () => {
    const cache = new FakeCache();
    cache.failPut = true;
    const fetchFn = fetchReturning({ [bookTextUrl('Jude', 'rst')]: () => jsonResponse(jude) });
    await expect(warmBibleText({ bible: 'rst', bookIds: ['Jude'], fetchFn, cacheStorage: fakeStorage(cache) })).resolves.toEqual({ onDevice: 0, total: 1, storageFailed: true });
    await expect(warmBibleText({ bible: 'rst', bookIds: ['Jude'], fetchFn, cacheStorage: undefined })).resolves.toEqual({ onDevice: 0, total: 1, storageFailed: true });
  });

  it('runs once at a time: a reconnect and a return to the tab share one warm-up', async () => {
    const cache = new FakeCache();
    let answer: () => void = () => undefined;
    const fetchFn = jest.fn(() => new Promise<Response>((resolve) => { answer = () => resolve(jsonResponse(jude)); })) as unknown as typeof fetch;
    const first = warmBibleTextOnce({ bible: 'rst', bookIds: ['Jude'], fetchFn, cacheStorage: fakeStorage(cache) });
    const second = warmBibleTextOnce({ bible: 'rst', bookIds: ['Jude'], fetchFn, cacheStorage: fakeStorage(cache) });
    expect(second).toBe(first);
    await new Promise((resolve) => setTimeout(resolve, 0));
    answer();
    await expect(first).resolves.toEqual({ onDevice: 1, total: 1, storageFailed: false });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('runs one more pass when asked during a run, so a book that failed before the reconnect is fetched', async () => {
    const cache = new FakeCache();
    let online = false;
    let releaseRuth: () => void = () => undefined;
    const fetchFn = jest.fn((url: string) => {
      if (url === bookTextUrl('Jude', 'rst')) return online ? Promise.resolve(jsonResponse(jude)) : Promise.reject(new TypeError('Failed to fetch'));
      return new Promise<Response>((resolve) => { releaseRuth = () => resolve(jsonResponse(ruth)); });
    }) as unknown as typeof fetch;
    const options = { bible: 'rst' as const, bookIds: ['Jude', 'Ruth'], fetchFn, cacheStorage: fakeStorage(cache), concurrency: 2 };
    const first = warmBibleTextOnce(options);
    await new Promise((resolve) => setTimeout(resolve, 0));
    online = true;
    const second = warmBibleTextOnce(options);
    releaseRuth();
    await expect(second).resolves.toEqual({ onDevice: 2, total: 2, storageFailed: false });
    await expect(first).resolves.toEqual({ onDevice: 2, total: 2, storageFailed: false });
    expect(cache.puts.sort()).toEqual([bookTextUrl('Jude', 'rst'), bookTextUrl('Ruth', 'rst')].sort());
  });
});
