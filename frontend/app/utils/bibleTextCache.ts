/**
 * Where the Bible text is served from and which cache keeps it on the device.
 *
 * Shared by the service worker (`app/sw.ts`, the CacheFirst rule) and the Bible page (the warm-up
 * that downloads every book once), so the address and the cache name cannot drift apart. The text
 * never changes under an address: a new text gets a new version folder, so a copy kept forever is
 * never stale. Kept free of other imports — the worker bundle pulls this file in.
 */
export const BIBLE_TEXT_PATH_PREFIX = '/bible-text/';
export const BIBLE_TEXT_CACHE = 'bible-text';

/** Each Bible's text folder and its version: a new text of a Bible gets the next version. */
const BIBLE_TEXT_VERSIONS: Readonly<Record<string, string>> = { rst: 'v1', ubio: 'v1', kjv: 'v1' };

/** Where one Bible's books are served from: `/bible-text/<bible>/<version>`. */
export const bibleTextBase = (bibleId: string): string => `${BIBLE_TEXT_PATH_PREFIX}${bibleId}/${BIBLE_TEXT_VERSIONS[bibleId] ?? 'v1'}`;

export const isBibleTextPath = (pathname: string): boolean => pathname.startsWith(BIBLE_TEXT_PATH_PREFIX);

/** An answer worth keeping: a successful JSON response. Anything else is passed on but never stored. */
export const isBibleTextAnswer = (response: Pick<Response, 'ok' | 'headers'>): boolean =>
  response.ok && (response.headers.get('content-type') ?? '').includes('application/json');

/**
 * The shape of a book file: an id and chapters, every chapter a non-empty list of verse strings.
 * The worker checks this before it stores an answer (it stores in the background, so a check by the
 * page alone would race it); the page adds the book's own id and chapter count (`isBookText`).
 */
export const isBookShaped = (value: unknown): value is { id: string; chapters: string[][] } => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { id?: unknown; chapters?: unknown };
  return typeof candidate.id === 'string'
    && Array.isArray(candidate.chapters)
    && candidate.chapters.length > 0
    && candidate.chapters.every((chapter) => Array.isArray(chapter) && chapter.length > 0 && chapter.every((verse) => typeof verse === 'string'));
};
