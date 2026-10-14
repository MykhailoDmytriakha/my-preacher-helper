import { isBibleId, type BibleId } from '@/utils/bibles';

/**
 * Where the person stopped reading, on this device only: a convenience for "Continue", not a
 * record. Browser storage can be missing or refuse (a private window), so every access is guarded
 * and the page works without it.
 *
 * A place is numbered by its Bible — Psalm 22 of the Synodal is Psalm 23 of the King James — so
 * every place kept here says which Bible it is in. One kept before there were several Bibles is in
 * the Synodal, the only one then.
 */
export type LastPlace = { slug: string; chapter: number; verse: number; bible: BibleId };

const STORAGE_KEY = 'bible:last-place';
const FIRST_BIBLE: BibleId = 'rst';

const bibleOf = (value: unknown): BibleId | null => (value === undefined ? FIRST_BIBLE : isBibleId(value) ? value : null);

const asLastPlace = (value: unknown): LastPlace | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<LastPlace>;
  const bible = bibleOf(candidate.bible);
  const valid = typeof candidate.slug === 'string'
    && Number.isInteger(candidate.chapter) && (candidate.chapter ?? 0) > 0
    && Number.isInteger(candidate.verse) && (candidate.verse ?? 0) > 0;
  return valid && bible ? { slug: candidate.slug as string, chapter: candidate.chapter as number, verse: candidate.verse as number, bible } : null;
};

/**
 * The first verse of a book is no place to continue: "Continue at Genesis 1:1" is what the book's
 * own button does, and a book opened and left at once has not been read.
 */
const isBookStart = (place: { chapter: number; verse: number }) => place.chapter === 1 && place.verse === 1;

export function readLastPlace(): LastPlace | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const place = asLastPlace(raw ? JSON.parse(raw) : null);
    return place && !isBookStart(place) ? place : null;
  } catch {
    return null;
  }
}

/** Saving the start of a book keeps the place there was: only opening a book is not reading it. */
export function saveLastPlace(place: LastPlace): void {
  if (isBookStart(place)) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(place));
  } catch {
    // Storage refused: "Continue" simply does not appear.
  }
}

type Place = { chapter: number; verse: number };

/** "1:18" → { chapter: 1, verse: 18 }; anything else → null. Whether the verse exists is the reader's check. */
export function parsePlaceParam(value: string | null | undefined): Place | null {
  const match = /^(\d{1,3}):(\d{1,3})$/.exec(value ?? '');
  if (!match) return null;
  const chapter = Number(match[1]);
  const verse = Number(match[2]);
  return chapter > 0 && verse > 0 ? { chapter, verse } : null;
}

/** The place, when that verse exists in the book; otherwise null. */
export function placeInBook(chapters: string[][], place: Place | null): Place | null {
  if (!place) return null;
  const verses = chapters[place.chapter - 1];
  return verses && place.verse <= verses.length ? place : null;
}

/*
 * WHERE THIS HISTORY ENTRY WAS READ. Back and Forward re-open the reader from scratch; to land
 * where the person was, every entry carries an id in `history.state` and the place under that id
 * lives in sessionStorage (this tab only). Next's own fields in `history.state` are kept: Next
 * copies them into the state it is given (pushState/replaceState integration).
 */
const ENTRY_KEY = 'bibleEntry';
const ENTRY_PREFIX = 'bible:entry:';
/** The place in another book this entry was opened from: the reader's way back ("← Rom 5"). */
const FROM_KEY = 'bibleFrom';

const newEntryId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** The state for a new entry that opens a book; `from` when it was opened from another book. */
export const newEntryState = (from?: LastPlace | null): Record<string, unknown> => ({
  [ENTRY_KEY]: newEntryId(),
  ...(from ? { [FROM_KEY]: from } : {}),
});

/** Where the current entry was opened from, when that was another book. Call after mount. */
export function readEntryFrom(): LastPlace | null {
  return asLastPlace(((window.history.state ?? {}) as Record<string, unknown>)[FROM_KEY]);
}

/** The id of the current entry, giving it one when it has none (a deep link, a reload). Call after mount. */
export function currentEntryId(): string {
  const state = (window.history.state ?? {}) as Record<string, unknown>;
  const existing = state[ENTRY_KEY];
  if (typeof existing === 'string') return existing;
  const id = newEntryId();
  window.history.replaceState({ ...state, [ENTRY_KEY]: id }, '');
  return id;
}

/** A place read in a history entry, with the Bible it was read in. */
export type EntryPlace = Place & { bible: BibleId };

export function readEntryPlace(entryId: string): EntryPlace | null {
  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(ENTRY_PREFIX + entryId) ?? 'null');
    if (!value || typeof value !== 'object') return null;
    const { chapter, verse, bible } = value as Partial<EntryPlace>;
    const of = bibleOf(bible);
    return Number.isInteger(chapter) && Number.isInteger(verse) && of ? { chapter: chapter as number, verse: verse as number, bible: of } : null;
  } catch {
    return null;
  }
}

export function saveEntryPlace(entryId: string, place: EntryPlace): void {
  try {
    window.sessionStorage.setItem(ENTRY_PREFIX + entryId, JSON.stringify(place));
  } catch {
    // Storage refused: Back opens the book at its start.
  }
}
