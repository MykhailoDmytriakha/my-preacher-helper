/**
 * Where the cross-reference set is served from and which cache keeps it on the device.
 *
 * Shared by the service worker (`app/sw.ts`, the CacheFirst rule) and the reader
 * (`utils/crossReferences.ts`), so the address and the cache name cannot drift apart. A set never
 * changes under an address: a new set (`scripts/build-bible-crossrefs.mjs`) gets a new version folder,
 * so a copy kept forever is never stale. Kept free of other imports — the worker bundle pulls this file in.
 */
export const BIBLE_CROSSREFS_PATH_PREFIX = '/bible-crossrefs/';
export const BIBLE_CROSSREFS_CACHE = 'bible-crossrefs';

/**
 * The set's folder: a new set is the next version. v2 (2026-10-16): every passage ends inside its
 * chapter and an anchor that is two King James verses gives its links to both.
 */
const BIBLE_CROSSREFS_VERSION = 'v2';

export const bibleCrossRefsBase = `${BIBLE_CROSSREFS_PATH_PREFIX}${BIBLE_CROSSREFS_VERSION}`;

export const isBibleCrossRefsPath = (pathname: string): boolean => pathname.startsWith(BIBLE_CROSSREFS_PATH_PREFIX);

/** Five numbers per link: book index, chapter, first verse, last verse, weight. */
export const NUMBERS_PER_LINK = 5;

/**
 * The shape of a book's file: an id and its chapters, every chapter a non-empty list of verses, every
 * verse a list of numbers in fives. The worker checks this before it stores an answer, so a page from
 * a hotel Wi-Fi is never kept as the set.
 */
export const isCrossRefsShaped = (value: unknown): value is { id: string; chapters: number[][][] } => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { id?: unknown; chapters?: unknown };
  return typeof candidate.id === 'string'
    && Array.isArray(candidate.chapters)
    && candidate.chapters.length > 0
    && candidate.chapters.every((chapter) => Array.isArray(chapter) && chapter.length > 0 && chapter.every((verse) =>
      Array.isArray(verse) && verse.length % NUMBERS_PER_LINK === 0 && verse.every((number) => Number.isInteger(number))));
};
