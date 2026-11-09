import { encodeVerseLayer, isMarkColor, isPencilColor, readVerseLayerSpans } from '@/utils/bibleMarkLayers';

import { boundedActionTime, compareActionTime } from './actionClock';
import { isVerseMarkKey, MARK_LAYERS, MAX_MARK_PREDECESSORS, markLayerKey, markRangesByLayer, readMarkLayer, writeMarkLayer, type DisplacedMark, type MarkAddress, type MarkRange } from './bibleMarkStroke';
import { equalValues, object } from './fieldValues';
import { isValidIdentifier } from './protocol';

import type { ActionTime } from './actionClock';
import type { BibleMarkPredecessor, BibleMarkStrokeStamp, ConflictDetail, DataCommand, DocumentData, FieldValue, Json, ResourceSnapshot } from './types';

const MAX_STROKE_VERSES = 64;
const MAX_VERSE_PROOFS = 512;
const MAX_DISPLACED_SPANS = 128;
export const BIBLE_MARK_HISTORY = '_markHistory';
export const BIBLE_MARK_PROOFS = '_markProofs';

type Proof = MarkRange & { colour: string | null; time: ActionTime | null; revision: number; operationId?: string };
type MarkOrder = {
  command: DataCommand;
  proofWrites?: Map<string, Proof[]>;
  resetProofs?: true;
  displaced?: DisplacedMark[];
  uncertain?: ConflictDetail[];
};
type StrokeFields = { before: unknown; after: unknown; change?: Extract<DataCommand, { kind: 'update' }>['changes'][number] };
type Colour = string | undefined;
type MarkTracking = { floor: number; reset: boolean };
type StrokeClock = MarkTracking & { stroke?: BibleMarkStrokeStamp; revision: number; operationId: string };
type SpanDecision = { previous?: Proof; stamp?: ActionTime | null; uncertain?: true; fold?: 'incoming' | 'stored'; displaced?: DisplacedMark };
type LayerResult = { before: Colour; after: Colour; folded: boolean; uncertain: boolean; proofs: Proof[]; displaced: DisplacedMark[] };

function isRevision(value: unknown, minimum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}

function readProofs(verse: string, raw: unknown, current: ResourceSnapshot, floor: number): Proof[] {
  const revision = current.metadata?.revision ?? 0;
  if (!object(raw) || raw.generation !== current.metadata?.generation || !isRevision(raw.revision, floor)
    || raw.revision > revision || !Array.isArray(raw.proofs) || raw.proofs.length > MAX_VERSE_PROOFS) return [];
  return raw.proofs.flatMap(value => {
    if (!object(value) || value.verse !== verse || (value.layer !== 'm' && value.layer !== 'p') || !isRevision(value.first, 0)
      || !isRevision(value.last, value.first) || !isRevision(value.revision, floor) || value.revision > revision) return [];
    const validColour = value.layer === 'm' ? isMarkColor : isPencilColor;
    if (value.colour !== null && !validColour(value.colour)) return [];
    const time = value.time === null ? null : boundedActionTime(value.time);
    return time !== undefined ? [{ verse, layer: value.layer, first: value.first, last: value.last,
      colour: value.colour as string | null, time, revision: value.revision,
      ...(isValidIdentifier(value.operationId) && { operationId: value.operationId }) }] : [];
  });
}

function strokeFields(command: DataCommand): StrokeFields | undefined {
  if (command.resource.collection !== 'bibleMarks') return undefined;
  if (command.kind === 'create') return { before: {}, after: command.value.verses };
  if (command.kind !== 'update') return undefined;
  const change = command.changes.find(field => field.path[0] === 'verses');
  if (!change) return undefined;
  return { change, before: change.before.exists ? change.before.value : {}, after: change.after.exists ? change.after.value : {} };
}

export function bibleMarkTracking(raw: unknown): MarkTracking {
  if (!object(raw) || !isRevision(raw.markProofFloor, 1)) return { floor: 0, reset: false };
  return { floor: raw.markProofFloor, reset: raw.markProofReset === true };
}

export function bibleMarkProofVerses(command: DataCommand): string[] | null {
  const fields = strokeFields(command);
  if (!fields) return [];
  const { before, after } = fields;
  if (!object(before) || !object(after)) return null;
  const verses = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(verse => isVerseMarkKey(verse) && !equalValues(before[verse], after[verse]));
  return verses.length > MAX_STROKE_VERSES ? null : verses;
}

function readPredecessors(value: unknown): BibleMarkPredecessor[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_MARK_PREDECESSORS) return undefined;
  const result: BibleMarkPredecessor[] = [];
  for (const span of value) {
    if (!object(span) || typeof span.verse !== 'string' || !isVerseMarkKey(span.verse) || (span.layer !== 'm' && span.layer !== 'p')
      || !isRevision(span.first, 0) || !isRevision(span.last, span.first) || !isValidIdentifier(span.operationId)) return undefined;
    const { verse, layer, first, last, operationId } = span;
    result.push({ verse, layer, first, last, operationId });
  }
  for (const spans of markRangesByLayer(result).values()) {
    spans.sort((left, right) => left.first - right.first);
    if (spans.some((span, index) => index > 0 && spans[index - 1].last >= span.first)) return undefined;
  }
  return result;
}

function readStroke(input: unknown, revision: number, serverMs: number): BibleMarkStrokeStamp | undefined {
  if (!object(input) || !isRevision(input.observedRevision, 0) || input.observedRevision > revision || !Number.isFinite(serverMs)) return undefined;
  const time = boundedActionTime(input.time);
  if (!time || time.earliestMs > serverMs + 5) return undefined;
  const predecessors = readPredecessors(input.predecessors);
  const predecessorOperationId = input.predecessors === undefined && isValidIdentifier(input.predecessorOperationId)
    ? input.predecessorOperationId : undefined;
  return { observedRevision: input.observedRevision, time,
    ...(predecessorOperationId && { predecessorOperationId }), ...(predecessors && { predecessors }) };
}

function decideSpan(range: MarkRange, colours: [Colour, Colour, Colour], previous: Proof | undefined, clock: StrokeClock, predecessorOperationId?: string): SpanDecision {
  const [base, mine, stored] = colours;
  if (mine === base) return { previous };
  const { stroke, revision, floor } = clock;
  if (!stroke) return { stamp: null };
  if (!previous) {
    // A matching value alone cannot attach an old stroke's clock to an untracked span.
    if (clock.reset && stroke.observedRevision < floor && base === stored && mine !== stored) return { uncertain: true };
    const tracked = stroke.observedRevision === revision || (floor > 0 && stroke.observedRevision >= floor);
    return mine !== stored && tracked ? { stamp: stroke.time } : {};
  }
  if (previous.revision <= stroke.observedRevision) return mine !== stored ? { stamp: stroke.time } : { previous };
  if (base === stored && predecessorOperationId && previous.operationId === predecessorOperationId) {
    return { stamp: stroke.time };
  }
  return decideUnobservedSpan(range, colours, previous, stroke.time);
}

function decideUnobservedSpan(range: MarkRange, [base, mine, stored]: [Colour, Colour, Colour], previous: Proof, time: ActionTime): SpanDecision {
  const previousTime = previous.time;
  if (!previousTime) return base === stored && mine !== stored ? { uncertain: true } : {};
  const order = compareActionTime(time, previousTime);
  if (mine === stored) return order < 0 ? { previous } : order > 0 ? { stamp: time } : { stamp: null };
  if (!order) return base === stored ? { uncertain: true } : {};
  const incomingWins = order > 0;
  return {
    ...(incomingWins ? { stamp: time, fold: 'incoming' as const } : { previous, fold: 'stored' as const }),
    displaced: { ...range, colour: (incomingWins ? stored : mine) ?? null, winnerColour: (incomingWins ? mine : stored) ?? null,
      actionTime: incomingWins ? previousTime : time, winnerActionTime: incomingWins ? time : previousTime },
  };
}

function acceptedSpanProof(range: MarkRange, mine: Colour, decision: SpanDecision, clock: StrokeClock): Proof | undefined {
  if (decision.stamp !== undefined) return { ...range, colour: mine ?? null, time: decision.stamp,
    revision: clock.revision + 1, ...(decision.stamp && { operationId: clock.operationId }) };
  return decision.previous && { ...decision.previous, first: range.first, last: range.last };
}

function appendSpanProof(proofs: Proof[], proof: Proof): void {
  const previous = proofs.at(-1);
  if (previous && previous.last + 1 === proof.first && previous.colour === proof.colour
    && previous.revision === proof.revision && previous.operationId === proof.operationId && equalValues(previous.time, proof.time)) {
    previous.last = proof.last;
  } else proofs.push(proof);
}

function processLayer(address: MarkAddress, values: [unknown, unknown, unknown], proofs: Proof[], predecessors: BibleMarkPredecessor[],
  clock: StrokeClock): LayerResult | null {
  const spans = readVerseLayerSpans(address.layer, values, [...proofs, ...predecessors].flatMap(range => [range.first, range.last + 1]));
  if (!spans) return null;
  const before: [number, number, string][] = [], after: [number, number, string][] = [];
  const kept: Proof[] = [], displaced: DisplacedMark[] = [];
  let uncertain = false;
  for (const { first, last, colours } of spans) {
    const range = { ...address, first, last };
    const [base, mine, stored] = colours;
    const prior = proofs.find(proof => proof.first <= first && last <= proof.last && proof.colour === (stored ?? null));
    const predecessor = predecessors.find(span => span.first <= first && last <= span.last)?.operationId ?? clock.stroke?.predecessorOperationId;
    const decision = decideSpan(range, [base, mine, stored], prior, clock, predecessor);
    uncertain ||= decision.uncertain === true;
    const foldedBase = decision.fold ? stored : base;
    const foldedMine = decision.fold === 'stored' ? stored : mine;
    if (foldedBase !== undefined) before.push([first, last, foldedBase]);
    if (foldedMine !== undefined) after.push([first, last, foldedMine]);
    const proof = acceptedSpanProof(range, foldedMine, decision, clock);
    if (proof) appendSpanProof(kept, proof);
    if (decision.displaced) displaced.push(decision.displaced);
  }
  return { before: encodeVerseLayer(before), after: encodeVerseLayer(after), folded: displaced.length > 0, uncertain, proofs: kept, displaced };
}

function field(value: Json | undefined): FieldValue {
  return value === undefined ? { exists: false } : { exists: true, value };
}

function reconcileLayers(before: DocumentData, after: DocumentData, stored: DocumentData, proofs: Proof[], verses: readonly string[],
  clock: StrokeClock) {
  const byLayer = markRangesByLayer(proofs);
  const lineage = markRangesByLayer(clock.stroke?.predecessors ?? []);
  const nextProofs: Proof[] = [], displaced: DisplacedMark[] = [], uncertain: ConflictDetail[] = [];
  const foldedBefore = { ...before }, foldedAfter = { ...after };
  const validVerses = verses.filter(verse => [before[verse], after[verse], stored[verse]].every(row => row === undefined || object(row)));
  const addresses = validVerses.flatMap(verse => MARK_LAYERS.map(layer => ({ verse, layer })));
  for (const address of addresses) {
    const { verse, layer } = address;
    const baseline = readMarkLayer(before, address), mine = readMarkLayer(after, address);
    const key = markLayerKey(address);
    const prior = byLayer.get(key) ?? [];
    if (equalValues(baseline, mine)) {
      nextProofs.push(...prior);
      continue;
    }
    const theirs = readMarkLayer(stored, address);
    const result = processLayer(address, [baseline, mine, theirs], prior, lineage.get(key) ?? [], clock);
    if (!result) continue;
    nextProofs.push(...result.proofs);
    displaced.push(...result.displaced);
    if (result.uncertain) uncertain.push({ path: ['verses', verse, layer], base: field(baseline), mine: field(mine), theirs: field(theirs) });
    if (result.folded) {
      writeMarkLayer(foldedBefore, address, result.before);
      writeMarkLayer(foldedAfter, address, result.after);
    }
  }
  return { nextProofs, displaced, uncertain, foldedBefore, foldedAfter };
}

function planProofWrites(verses: readonly string[], previous: Proof[], next: Proof[]): Map<string, Proof[]> | undefined {
  const writes = new Map<string, Proof[]>();
  for (const verse of verses) {
    const updated = next.filter(proof => proof.verse === verse);
    if (updated.length > MAX_VERSE_PROOFS) return undefined;
    if (!equalValues(updated, previous.filter(proof => proof.verse === verse))) writes.set(verse, updated);
  }
  return writes;
}

/** Fold only proved spans; the ordinary planner still decides all unresolved writes. */
export function orderBibleMarks(command: DataCommand, current: ResourceSnapshot, tracking: MarkTracking, verses: readonly string[] | null,
  savedProofs: ReadonlyMap<string, unknown>, serverMs: number): MarkOrder {
  if (!verses) return { command, resetProofs: true };
  if (!verses.length || (command.kind !== 'create' && command.kind !== 'update')) return { command };
  const fields = strokeFields(command)!;
  const { before, after, change } = fields;
  const stored = current.value?.verses ?? {};
  if (!object(before) || !object(after) || !object(stored)) return { command, resetProofs: true };

  const revision = current.metadata?.revision ?? 0;
  const stroke = readStroke(command.bibleMarkStroke, revision, serverMs);
  const proofs = verses.flatMap(verse => readProofs(verse, savedProofs.get(verse), current, tracking.floor || 1));
  const { nextProofs, displaced, uncertain, foldedBefore, foldedAfter } = reconcileLayers(before, after, stored, proofs, verses, { ...tracking, stroke, revision, operationId: command.operationId });
  if (uncertain.length) return { command, uncertain };
  const proofWrites = planProofWrites(verses, proofs, nextProofs);
  if (!proofWrites || displaced.length > MAX_DISPLACED_SPANS) return { command, resetProofs: true };
  if (!displaced.length || command.kind !== 'update') return { command, proofWrites };
  return {
    command: { ...command, changes: command.changes.map(field => field === change
      ? { ...field, before: { exists: true, value: foldedBefore }, after: { exists: true, value: foldedAfter } }
      : field) },
    proofWrites,
    displaced,
  };
}

export function metadataAfterBibleMarks(snapshot: ResourceSnapshot, raw: unknown, order?: MarkOrder) {
  if (!snapshot.value || !snapshot.metadata) return snapshot.metadata;
  const previous = bibleMarkTracking(raw);
  const floor = order?.resetProofs ? snapshot.metadata.revision : previous.floor || (order?.proofWrites?.size ? snapshot.metadata.revision : 0);
  if (!floor) return snapshot.metadata;
  const reset = previous.reset || order?.resetProofs;
  return { ...snapshot.metadata, markProofFloor: floor, ...(reset && { markProofReset: true }) };
}
