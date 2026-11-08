/*
 * A VERSE LAYER OF BIBLE MARKS AS IT IS STORED — the colours, a run of words and the one way to write a layer — kept apart from
 * the marks' rules (`bibleMarks.ts`), light enough for the data engine, which merges a verse's marks word by word with it
 * (`mergeVerseLayer`; BUG-20261107-marks-same-verse-offline-conflict).
 */

/** The five meanings of the owner's reading plan, in its order. */
export const MARK_COLORS = ['red', 'green', 'yellow', 'orange', 'blue'] as const;
export type MarkColor = (typeof MARK_COLORS)[number];

/** The pencil's colours: plain grey, or one of the five meanings as a line (the owner, 2026-10-16). */
export const PENCIL_COLORS = ['gray', ...MARK_COLORS] as const;
export type PencilColor = (typeof PENCIL_COLORS)[number];

/** A run of words `[first, last]` in a verse, with its colour. */
export type MarkerRun = [number, number, MarkColor];
export type PencilRun = [number, number, PencilColor];

export const isMarkColor = (value: unknown): value is MarkColor =>
  typeof value === 'string' && (MARK_COLORS as readonly string[]).includes(value);

export const isPencilColor = (value: unknown): value is PencilColor =>
  typeof value === 'string' && (PENCIL_COLORS as readonly string[]).includes(value);

/** Sorted, with neighbours of the same kind joined: one way to write the same marks. */
export function tidy<T extends [number, number, ...unknown[]]>(runs: T[]): T[] {
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

export const runText = (run: readonly [number, number, string]) => `${run[0]}-${run[1]}-${run[2]}`;
const runOf = (text: unknown): unknown[] | null => {
  if (typeof text !== 'string') return null;
  const match = /^(\d+)-(\d+)-([a-z]+)$/.exec(text);
  return match ? [Number(match[1]), Number(match[2]), match[3]] : null;
};

// A list of run strings is how the first marks were kept, while they were tried on 2026-10-16.
export const layerRuns = (layer: unknown): unknown[] =>
  (typeof layer === 'string' ? layer.split(',') : Array.isArray(layer) ? layer : []).map(runOf).filter(Boolean) as unknown[];

type Layer = 'm' | 'p';
type Run = [number, number, string];

/**
 * A layer's runs in their one way of writing, or null when the value does not read back whole — a piece that is not a run, a
 * number past exact integers, a run that ends before it starts, a colour the layer has no place for, one word under two
 * colours: such a value is never merged, it stays a question. No value is no marks.
 */
function layerRunsOf(layer: Layer, value: unknown): Run[] | null {
  if (value === undefined) return [];
  const pieces = typeof value === 'string' ? (value === '' ? [] : value.split(',')) : Array.isArray(value) ? value : null;
  if (!pieces) return null;
  const valid = layer === 'm' ? isMarkColor : isPencilColor;
  const runs: Run[] = [];
  for (const piece of pieces) {
    const run = runOf(piece);
    if (!run) return null;
    const [first, last, colour] = run as Run;
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first > last || !valid(colour)) return null;
    runs.push([first, last, colour]);
  }
  const sorted = [...runs].sort((a, b) => a[0] - b[0]);
  // Every earlier run that reaches a word is of the colour of the one reaching farthest, or the value was refused already.
  let reach: Run | null = null;
  for (const run of sorted) {
    if (reach && run[0] <= reach[1] && run[2] !== reach[2]) return null;
    if (!reach || run[1] > reach[1]) reach = run;
  }
  return tidy(sorted);
}

const colourAt = (runs: readonly Run[], word: number): string | undefined => runs.find(([first, last]) => first <= word && word <= last)?.[2];

/**
 * A verse's layer changed on two sides, merged word by word (BUG-20261107-marks-same-verse-offline-conflict): what one side
 * changed from the version both started from is laid over the other's words, so strokes on different words of one verse — made
 * offline on an iPad, or on another device meanwhile — keep each other. A word both sides changed differently (another colour,
 * erased here and recoloured there) is the person's question: null. `value` — the layer in its one way of writing, `undefined`
 * when no word is left marked. Worked span by span between the runs' edges, never word by word: a damaged run as long as a
 * billion words costs no more than a short one (Codex review).
 */
export function mergeVerseLayer(layer: Layer, base: unknown, mine: unknown, theirs: unknown): { value: string | undefined } | null {
  const sides = [base, mine, theirs].map(value => layerRunsOf(layer, value));
  if (sides.some(runs => runs === null)) return null;
  const [b, m, t] = sides as Run[][];
  const edges = [...new Set([...b, ...m, ...t].flatMap(([first, last]) => [first, last + 1]))].sort((x, y) => x - y);
  const merged: Run[] = [];
  for (let index = 0; index < edges.length - 1; index += 1) {
    const from = edges[index], to = edges[index + 1] - 1;
    const [was, here, there] = [b, m, t].map(runs => colourAt(runs, from));
    const kept = here === was ? there : there === was || there === here ? here : null;
    if (kept === null) return null;
    if (kept !== undefined) merged.push([from, to, kept]);
  }
  const runs = tidy(merged);
  return { value: runs.length ? runs.map(runText).join(',') : undefined };
}
