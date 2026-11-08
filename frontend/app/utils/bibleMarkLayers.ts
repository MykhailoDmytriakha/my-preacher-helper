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

export type VerseMarkLayer = 'm' | 'p';
type Run = [number, number, string];
type LayerSpan = { first: number; last: number; colours: Array<string | undefined> };

/**
 * A layer's runs in their one way of writing, or null when the value does not read back whole — a piece that is not a run, a
 * number past exact integers, a run that ends before it starts, a colour the layer has no place for, one word under two
 * colours: such a value is never merged, it stays a question. No value is no marks.
 */
function layerRunsOf(layer: VerseMarkLayer, value: unknown): Run[] | null {
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

function* spansBetweenRuns(sides: Run[][], boundaries: readonly number[]): IterableIterator<LayerSpan> {
  const edges = [...new Set([...boundaries, ...sides.flatMap(runs => runs.flatMap(([first, last]) => [first, last + 1]))])].sort((a, b) => a - b);
  for (let index = 0; index < edges.length - 1; index += 1) {
    const first = edges[index], last = edges[index + 1] - 1;
    yield { first, last, colours: sides.map(runs => colourAt(runs, first)) };
  }
}

/** Each returned span has one colour per stored layer and no changes inside its bounds. */
export function readVerseLayerSpans(layer: VerseMarkLayer, values: readonly unknown[], boundaries: readonly number[] = []): IterableIterator<LayerSpan> | null {
  const runs: Run[][] = [];
  for (const value of values) {
    const parsed = layerRunsOf(layer, value);
    if (!parsed) return null;
    runs.push(parsed);
  }
  return spansBetweenRuns(runs, boundaries);
}


export function encodeVerseLayer(runs: Run[]): string | undefined {
  return runs.length ? tidy(runs).map(runText).join(',') : undefined;
}
/**
 * A verse's layer changed on two sides, merged word by word (BUG-20261107-marks-same-verse-offline-conflict): what one side
 * changed from the version both started from is laid over the other's words, so strokes on different words of one verse — made
 * offline on an iPad, or on another device meanwhile — keep each other. A word both sides changed differently (another colour,
 * erased here and recoloured there) is the person's question: null. `value` — the layer in its one way of writing, `undefined`
 * when no word is left marked. Worked span by span between the runs' edges, never word by word: a damaged run as long as a
 * billion words costs no more than a short one (Codex review).
 */
export function mergeVerseLayer(layer: VerseMarkLayer, base: unknown, mine: unknown, theirs: unknown): { value: string | undefined } | null {
  const spans = readVerseLayerSpans(layer, [base, mine, theirs]);
  if (!spans) return null;
  const merged: Run[] = [];
  for (const { first, last, colours: [was, here, there] } of spans) {
    const kept = here === was ? there : there === was || there === here ? here : null;
    if (kept === null) return null;
    if (kept !== undefined) merged.push([first, last, kept]);
  }
  return { value: encodeVerseLayer(merged) };
}

/** An explicit restore paints or clears only one saved span of one layer. */
export function restoreVerseLayerSpan(layer: VerseMarkLayer, stored: unknown, first: number, last: number, colour: string | null): string | undefined | null {
  const validColour = layer === 'm' ? isMarkColor : isPencilColor;
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 0 || last < first || (colour !== null && !validColour(colour))) return null;
  const spans = readVerseLayerSpans(layer, [stored], [first, last + 1]);
  if (!spans) return null;
  const runs: Run[] = [];
  for (const span of spans) {
    const kept = first <= span.first && span.last <= last ? colour : span.colours[0];
    if (kept) runs.push([span.first, span.last, kept]);
  }
  return encodeVerseLayer(runs);
}
