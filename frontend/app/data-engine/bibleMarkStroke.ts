import { encodeVerseLayer, readVerseLayerSpans } from '@/utils/bibleMarkLayers';

import { boundedActionTime } from './actionClock';
import { equalValues, object } from './fieldValues';

import type { CommitRequest } from './commits';
import type { BibleMarkStrokeStamp, DataCommand, DocumentData, Json, ResourceSnapshot } from './types';
import type { VerseMarkLayer } from '@/utils/bibleMarkLayers';

export const MARK_LAYERS: readonly VerseMarkLayer[] = ['m', 'p'];
export type MarkAddress = { verse: string; layer: VerseMarkLayer };
export type MarkRange = MarkAddress & { first: number; last: number };
export type DisplacedMark = MarkRange & {
  colour: string | null;
  winnerColour: string | null;
  actionTime: BibleMarkStrokeStamp['time'];
  winnerActionTime: BibleMarkStrokeStamp['time'];
};
export type BibleMarkHistoryEntry = { id: string; generation: string; acceptedAt: string; marks: DisplacedMark[] };
export type BibleMarkHistoryPage = {
  owner: string; bookId: string; generation: string; entries: BibleMarkHistoryEntry[]; nextCursor: string | null;
};
type MarkEdit = MarkRange & { before: string | null; after: string | null };
export type CapturedBibleMarkStroke = BibleMarkStrokeStamp & { edits: MarkEdit[] };
type MarkCommand = Extract<DataCommand, { kind: 'create' | 'update' }>;

export function isVerseMarkKey(key: string): boolean {
  return key.length <= 32 && /^v\d+_\d+$/.test(key);
}

export function readMarkLayer(verses: DocumentData, { verse, layer }: MarkAddress): Json | undefined {
  const row = verses[verse];
  return object(row) ? row[layer] : undefined;
}

export function writeMarkLayer(verses: DocumentData, { verse, layer }: MarkAddress, run: string | undefined): void {
  const value = verses[verse];
  const row = object(value) ? { ...value } : {};
  if (run === undefined) delete row[layer];
  else row[layer] = run;
  if (Object.keys(row).length) verses[verse] = row;
  else delete verses[verse];
}

function layerEdits(address: MarkAddress, previous: Json | undefined, next: Json | undefined): MarkEdit[] | undefined {
  if (equalValues(previous, next)) return [];
  const spans = readVerseLayerSpans(address.layer, [previous, next]);
  if (!spans) return undefined;
  const edits: MarkEdit[] = [];
  for (const { first, last, colours: [from, to] } of spans) {
    if (from === to) continue;
    const lastEdit = edits.at(-1);
    if (lastEdit && lastEdit.last + 1 === first && lastEdit.before === (from ?? null) && lastEdit.after === (to ?? null)) lastEdit.last = last;
    else edits.push({ ...address, first, last, before: from ?? null, after: to ?? null });
  }
  return edits;
}

function markEdits(before: unknown, after: unknown): MarkEdit[] | undefined {
  if (!object(before) || !object(after)) return undefined;
  const edits: MarkEdit[] = [];
  for (const verse of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (equalValues(before[verse], after[verse])) continue;
    if (!isVerseMarkKey(verse)) return undefined;
    for (const layer of MARK_LAYERS) {
      const address = { verse, layer };
      const changed = layerEdits(address, readMarkLayer(before, address), readMarkLayer(after, address));
      if (!changed) return undefined;
      edits.push(...changed);
    }
  }
  return edits.sort((left, right) => left.verse.localeCompare(right.verse) || left.layer.localeCompare(right.layer) || left.first - right.first);
}

export function captureBibleMarkStroke(baseline: ResourceSnapshot, predecessor: Pick<CommitRequest, 'id' | 'value' | 'bibleMarkStroke'> | undefined,
  after: DocumentData | null, capture: unknown): CapturedBibleMarkStroke | undefined {
  if (baseline.resource.collection !== 'bibleMarks' || !after || baseline.metadata?.deleted) return undefined;
  const time = boundedActionTime(capture);
  if (!time) return undefined;
  const before = predecessor ? predecessor.value : baseline.value;
  const edits = markEdits(before?.verses ?? {}, after.verses);
  return edits?.length ? { time, edits, observedRevision: baseline.metadata?.revision ?? 0,
    ...(predecessor?.bibleMarkStroke && { predecessorOperationId: predecessor.id }) } : undefined;
}

export function withBibleMarkStroke(command: DataCommand, stroke?: CapturedBibleMarkStroke): DataCommand {
  if (!stroke || command.resource.collection !== 'bibleMarks' || (command.kind !== 'create' && command.kind !== 'update')) return command;
  if (!equalValues(commandMarkEdits(command), stroke.edits)) return command;
  const { time, observedRevision, predecessorOperationId } = stroke;
  return { ...command, bibleMarkStroke: { time, observedRevision, ...(predecessorOperationId && { predecessorOperationId }) } };
}

function commandMarkEdits(command: MarkCommand): MarkEdit[] | undefined {
  if (command.kind === 'create') return markEdits({}, command.value.verses);
  const change = command.changes.find(field => field.path[0] === 'verses');
  if (!change) return undefined;
  return markEdits(change.before.exists ? change.before.value : {}, change.after.exists ? change.after.value : {});
}

/** Replace only the given ranges. The other words and the other layer keep their own values. */
function projectMarkRanges<T extends MarkRange>(target: DocumentData, ranges: readonly T[], source: (range: T, colour: string | undefined) => string | undefined,
  from?: DocumentData): DocumentData | undefined {
  const result = { ...target };
  const groups = new Map<string, T[]>();
  for (const range of ranges) {
    const key = range.verse + ':' + range.layer;
    const group = groups.get(key);
    if (group) group.push(range);
    else groups.set(key, [range]);
  }
  for (const edits of groups.values()) {
    const address = edits[0];
    const values = [readMarkLayer(target, address), from && readMarkLayer(from, address)];
    const spans = readVerseLayerSpans(address.layer, values, edits.flatMap(edit => [edit.first, edit.last + 1]));
    if (!spans) return undefined;
    const runs: [number, number, string][] = [];
    for (const { first, last, colours: [original, other] } of spans) {
      const edit = edits.find(item => item.first <= first && last <= item.last);
      const colour = edit ? source(edit, other) : original;
      if (colour !== undefined) runs.push([first, last, colour]);
    }
    writeMarkLayer(result, address, encodeVerseLayer(runs));
  }
  return result;
}


export function rebaseBibleMarkAncestor(source: DocumentData | null, current: ResourceSnapshot, captured: ResourceSnapshot,
  stroke?: CapturedBibleMarkStroke): DocumentData | undefined {
  if (!stroke || !current.value || current.metadata?.deleted || !object(source?.verses) || !object(current.value.verses)) return undefined;
  if (captured.metadata && current.metadata?.generation !== captured.metadata.generation) return undefined;
  const verses = projectMarkRanges(source.verses, stroke.edits, (_edit, colour) => colour, current.value.verses);
  return verses && !equalValues(verses, source.verses) ? { ...source, verses } : undefined;
}

export function restoreBibleMarkAncestor(current: ResourceSnapshot, stroke: CapturedBibleMarkStroke): ResourceSnapshot {
  if (!object(current.value?.verses)) return current;
  const verses = projectMarkRanges(current.value.verses, stroke.edits, edit => edit.before ?? undefined);
  return verses ? { ...current, value: { ...current.value, verses } } : current;
}
