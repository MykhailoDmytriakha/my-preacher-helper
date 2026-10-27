/*
 * MARKS IN THE TEXT OF THE BIBLE — the owner's paper habit (2026-10-16): words under a marker whose colour
 * says what the words are about, and words under a plain pencil line. One module owns the rules; the
 * reader, its storage and its drawing only call it.
 *
 * A mark lies on words of one Bible, verse by verse: a verse keeps runs of word positions, the words
 * being the verse's plain words (`verseWords` in `bibleText.ts`, split on white space). The marker and
 * the pencil are two layers — a word can carry both, as on paper. A stroke across verses is cut at
 * each verse's edge.
 */

import { verseWords } from './bibleText';
import { placesIn } from './versification';

import type { BibleId } from './bibles';

/** The five meanings of the owner's reading plan, in its order. */
export const MARK_COLORS = ['red', 'green', 'yellow', 'orange', 'blue'] as const;
export type MarkColor = (typeof MARK_COLORS)[number];

/** The pencil's colours: plain grey, or one of the five meanings as a line (the owner, 2026-10-16). */
export const PENCIL_COLORS = ['gray', ...MARK_COLORS] as const;
export type PencilColor = (typeof PENCIL_COLORS)[number];

/** A run of words `[first, last]` in a verse, with its colour. */
export type MarkerRun = [number, number, MarkColor];
export type PencilRun = [number, number, PencilColor];

export type VerseMarks = { m?: MarkerRun[]; p?: PencilRun[] };

/** A book's marks in one Bible, by "chapter:verse". */
export type BookMarks = Record<string, VerseMarks>;

/** A word of the book: the verse ("chapter:verse") and the word's position in it. */
export type WordAt = { verse: string; index: number };

/** What a stroke does: paint a colour, draw the pencil line in a colour, or take both away. */
export type StrokeKind = { tool: 'marker'; color: MarkColor } | { tool: 'pencil'; color: PencilColor } | { tool: 'eraser' };

/** The words a mark counts in a verse: its plain words split on white space (a line break is a space). */
export const countVerseWords = (raw: string): number => verseWords(raw).split(/\s+/).filter(Boolean).length;

export const isMarkColor = (value: unknown): value is MarkColor =>
  typeof value === 'string' && (MARK_COLORS as readonly string[]).includes(value);

export const isPencilColor = (value: unknown): value is PencilColor =>
  typeof value === 'string' && (PENCIL_COLORS as readonly string[]).includes(value);

/** The book's verses in reading order, as "chapter:verse", with their word counts. */
export type VerseOrder = { keys: string[]; position: Map<string, number>; words: Map<string, number> };

export function verseOrder(chapters: readonly (readonly string[])[], countWords: (raw: string) => number): VerseOrder {
  const keys: string[] = [];
  const position = new Map<string, number>();
  const words = new Map<string, number>();
  chapters.forEach((verses, chapterIndex) => {
    verses.forEach((raw, verseIndex) => {
      const key = `${chapterIndex + 1}:${verseIndex + 1}`;
      position.set(key, keys.length);
      words.set(key, countWords(raw));
      keys.push(key);
    });
  });
  return { keys, position, words };
}

const compare = (order: VerseOrder, a: WordAt, b: WordAt): number =>
  (order.position.get(a.verse) ?? 0) - (order.position.get(b.verse) ?? 0) || a.index - b.index;

/** The words a run leaves when `[from, to]` is taken out of it: none, one piece or two. */
function cut<T extends [number, number, ...unknown[]]>(runs: readonly T[], from: number, to: number): T[] {
  const kept: T[] = [];
  for (const run of runs) {
    const [first, last] = run;
    if (last < from || first > to) {
      kept.push(run);
      continue;
    }
    if (first < from) kept.push([first, from - 1, ...run.slice(2)] as unknown as T);
    if (last > to) kept.push([to + 1, last, ...run.slice(2)] as unknown as T);
  }
  return kept;
}

/** Sorted, with neighbours of the same kind joined: one way to write the same marks. */
function tidy<T extends [number, number, ...unknown[]]>(runs: T[]): T[] {
  const sorted = [...runs].sort((a, b) => a[0] - b[0]);
  const joined: T[] = [];
  for (const run of sorted) {
    const previous = joined[joined.length - 1];
    if (previous && previous[2] === run[2] && previous[1] + 1 >= run[0]) {
      previous[1] = Math.max(previous[1], run[1]);
    } else {
      joined.push([...run] as T);
    }
  }
  return joined;
}

function paintVerse(marks: VerseMarks | undefined, from: number, to: number, kind: StrokeKind, erase: boolean): VerseMarks {
  let m = marks?.m ?? [];
  let p = marks?.p ?? [];
  if (kind.tool === 'eraser') {
    m = cut(m, from, to);
    p = cut(p, from, to);
  } else if (kind.tool === 'pencil') {
    p = cut(p, from, to);
    if (!erase) p = tidy([...p, [from, to, kind.color]]);
  } else {
    m = cut(m, from, to);
    if (!erase) m = tidy([...m, [from, to, kind.color]]);
  }
  const next: VerseMarks = {};
  if (m.length) next.m = m;
  if (p.length) next.p = p;
  return next;
}

/** What lies on one word: the marker's colour, if any, and the pencil line's colour, if one runs under it. */
export function marksOnWord(marks: VerseMarks | undefined, index: number): { color: MarkColor | null; pencil: PencilColor | null } {
  const color = marks?.m?.find(([first, last]) => first <= index && index <= last)?.[2] ?? null;
  const pencil = marks?.p?.find(([first, last]) => first <= index && index <= last)?.[2] ?? null;
  return { color, pencil };
}

/**
 * A stroke that begins on a word already carrying the same colour (the marker's, or the pencil line's)
 * takes that mark away along its way — the owner's "the same colour over it erases"; another colour
 * repaints.
 */
export function strokeErases(book: BookMarks, start: WordAt, kind: StrokeKind): boolean {
  const on = marksOnWord(book[start.verse], start.index);
  if (kind.tool === 'marker') return on.color === kind.color;
  if (kind.tool === 'pencil') return on.pencil === kind.color;
  return true;
}

/** The book after a stroke from one word to another (either way round), cut at each verse's edge. */
export function applyStroke(book: BookMarks, order: VerseOrder, start: WordAt, end: WordAt, kind: StrokeKind, erase: boolean): BookMarks {
  const [from, to] = compare(order, start, end) <= 0 ? [start, end] : [end, start];
  const first = order.position.get(from.verse);
  const last = order.position.get(to.verse);
  if (first === undefined || last === undefined) return book;
  const next: BookMarks = { ...book };
  for (let position = first; position <= last; position += 1) {
    const verse = order.keys[position];
    const count = order.words.get(verse) ?? 0;
    if (count === 0) continue;
    const a = position === first ? from.index : 0;
    const b = position === last ? to.index : count - 1;
    const painted = paintVerse(next[verse], Math.max(0, a), Math.min(count - 1, b), kind, erase);
    if (painted.m || painted.p) next[verse] = painted;
    else delete next[verse];
  }
  return next;
}

/**
 * The first verse, in the book's order, whose marks a change made different — or null: an eraser drawn over words
 * that bore nothing, a colour laid over the same colour, changed nothing (the owner, 2026-10-27: such a stroke is no
 * act on a verse).
 */
export function firstChangedVerse(before: BookMarks, after: BookMarks, order: VerseOrder): string | null {
  let first: string | null = null;
  for (const verse of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[verse] ?? null) === JSON.stringify(after[verse] ?? null)) continue;
    if (first === null || (order.position.get(verse) ?? Infinity) < (order.position.get(first) ?? Infinity)) first = verse;
  }
  return first;
}

/** Only well-formed marks survive a read from storage: a broken record never breaks the reader. */
export function readBookMarks(value: unknown): BookMarks {
  if (!value || typeof value !== 'object') return {};
  const book: BookMarks = {};
  for (const [verse, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!/^\d+:\d+$/.test(verse) || !raw || typeof raw !== 'object') continue;
    const { m, p } = raw as { m?: unknown; p?: unknown };
    const runs = (list: unknown) => (Array.isArray(list) ? list : []).filter((run): run is unknown[] =>
      Array.isArray(run) && Number.isInteger(run[0]) && Number.isInteger(run[1]) && run[0] >= 0 && run[1] >= run[0]);
    const marker = runs(m).filter((run) => isMarkColor(run[2])).map((run) => [run[0], run[1], run[2]] as MarkerRun);
    // A pencil line saved before the pencil had colours is grey.
    const pencil = runs(p).map((run) => [run[0], run[1], isPencilColor(run[2]) ? run[2] : 'gray'] as PencilRun);
    const verseMarks: VerseMarks = {};
    if (marker.length) verseMarks.m = tidy(marker);
    if (pencil.length) verseMarks.p = tidy(pencil);
    if (verseMarks.m || verseMarks.p) book[verse] = verseMarks;
  }
  return book;
}

/*
 * THE MARKS AS A STORED DOCUMENT — one document per person, Bible and book (`bibleMarks`), its verses a
 * map so marks in different verses from two devices merge by themselves, and a verse's marker and pencil
 * as well. A layer of a verse is ONE string of runs, "first-last-colour" joined by commas ("0-1-blue,2-3-red"):
 * the data engine merges a list of strings as a set, so a verse recoloured blue on one device and green
 * on the other would keep both colours on the same words; one string is one value, and the same verse
 * changed on two devices becomes a question to the person. A verse key starts with a letter ("v26_4" for
 * 26:4) to be a plain field name anywhere.
 */
export type StoredVerse = { m?: string; p?: string };
export type StoredVerses = Record<string, StoredVerse>;

const verseField = (verse: string) => `v${verse.replace(':', '_')}`;
const verseOfField = (field: string): string | null => {
  const match = /^v(\d+)_(\d+)$/.exec(field);
  return match ? `${match[1]}:${match[2]}` : null;
};
const runText = (run: readonly [number, number, string]) => `${run[0]}-${run[1]}-${run[2]}`;
const runOf = (text: unknown): unknown[] | null => {
  if (typeof text !== 'string') return null;
  const match = /^(\d+)-(\d+)-([a-z]+)$/.exec(text);
  return match ? [Number(match[1]), Number(match[2]), match[3]] : null;
};

// A list of run strings is how the first marks were kept, while they were tried on 2026-10-16.
const layerRuns = (layer: unknown): unknown[] =>
  (typeof layer === 'string' ? layer.split(',') : Array.isArray(layer) ? layer : []).map(runOf).filter(Boolean) as unknown[];

export function encodeBookMarks(book: BookMarks): StoredVerses {
  const stored: StoredVerses = {};
  for (const [verse, marks] of Object.entries(book)) {
    const entry: StoredVerse = {};
    if (marks.m?.length) entry.m = marks.m.map(runText).join(',');
    if (marks.p?.length) entry.p = marks.p.map(runText).join(',');
    if (entry.m || entry.p) stored[verseField(verse)] = entry;
  }
  return stored;
}

/**
 * The marks as one string, the same for the same marks whichever order their verses were made in: what
 * a page shows is compared by it, and a copy that changed nothing is not drawn again.
 */
export function marksKey(book: BookMarks): string {
  const stored = encodeBookMarks(book);
  return Object.keys(stored).sort().map((field) => `${field}=${stored[field].m ?? ''}/${stored[field].p ?? ''}`).join(';');
}

/** The stored verses read back; anything malformed is left out (`readBookMarks`). */
export function decodeBookMarks(stored: unknown): BookMarks {
  if (!stored || typeof stored !== 'object') return {};
  const raw: Record<string, { m: unknown[]; p: unknown[] }> = {};
  for (const [field, value] of Object.entries(stored as Record<string, unknown>)) {
    const verse = verseOfField(field);
    if (!verse || !value || typeof value !== 'object') continue;
    const { m, p } = value as { m?: unknown; p?: unknown };
    raw[verse] = { m: layerRuns(m), p: layerRuns(p) };
  }
  return readBookMarks(raw);
}

/*
 * MARKS MADE IN ANOTHER BIBLE (2.9.3, the owner, 2026-10-16): they lie on that translation's words, so in
 * this Bible a verse only carries a sign, and a tap shows the verse there whole, painted as it is there.
 * The sign stands at the verse of THIS Bible that is the same place (`utils/versification`): Psalm 22 of
 * the Synodal is Psalm 23 of the King James. Signs and what a tap shows come from one list, so a sign
 * never opens onto nothing.
 */
export type OtherBookMarks = { bible: BibleId; marks: BookMarks };
/** One stroke of a sign: a marker's colour, or a pencil line's. */
export type SignStroke = { tool: 'marker'; color: MarkColor } | { tool: 'pencil'; color: PencilColor };
/** A marked verse of another Bible, and the verse of this one it is. */
export type MarkedElsewhere = { here: string; bible: BibleId; chapter: number; verse: number; marks: VerseMarks };

const VERSE_KEY = /^(\d+):(\d+)$/;

export function markedElsewhere(bible: BibleId, bookId: string, others: readonly OtherBookMarks[]): MarkedElsewhere[] {
  const found: MarkedElsewhere[] = [];
  for (const other of others) {
    if (other.bible === bible) continue;
    for (const [key, marks] of Object.entries(other.marks)) {
      const match = VERSE_KEY.exec(key);
      if (!match || !(marks.m?.length || marks.p?.length)) continue;
      const chapter = Number(match[1]), verse = Number(match[2]);
      for (const place of placesIn(bible, other.bible, { book: bookId, chapter, verse })) {
        found.push({ here: `${place.chapter}:${place.verse}`, bible: other.bible, chapter, verse, marks });
      }
    }
  }
  return found;
}

/** The sign of each verse of this Bible marked elsewhere: its colours, the marker's first, each once. */
export function signsHere(elsewhere: readonly MarkedElsewhere[]): Map<string, SignStroke[]> {
  const signs = new Map<string, SignStroke[]>();
  for (const { here, marks } of elsewhere) {
    const strokes = signs.get(here) ?? [];
    const add = (stroke: SignStroke) => {
      if (!strokes.some((known) => known.tool === stroke.tool && known.color === stroke.color)) strokes.push(stroke);
    };
    marks.m?.forEach(([, , color]) => add({ tool: 'marker', color }));
    marks.p?.forEach(([, , color]) => add({ tool: 'pencil', color }));
    signs.set(here, [...strokes.filter((s) => s.tool === 'marker'), ...strokes.filter((s) => s.tool === 'pencil')]);
  }
  return signs;
}

/** What a tap on a verse's sign shows: each other Bible with its marked verses that are this verse, in order. */
export function versesElsewhere(elsewhere: readonly MarkedElsewhere[], here: string): { bible: BibleId; verses: MarkedElsewhere[] }[] {
  const byBible = new Map<BibleId, MarkedElsewhere[]>();
  for (const entry of elsewhere) {
    if (entry.here !== here) continue;
    const verses = byBible.get(entry.bible) ?? [];
    if (!verses.some((known) => known.chapter === entry.chapter && known.verse === entry.verse)) verses.push(entry);
    byBible.set(entry.bible, verses);
  }
  return [...byBible].map(([bible, verses]) => ({ bible, verses: verses.sort((a, b) => a.chapter - b.chapter || a.verse - b.verse) }));
}
