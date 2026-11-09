import { rankBetween, RANK_STEP, sortByRank } from '@/utils/serviceOrderRank';

import { boundedActionTime, compareActionTime } from './actionClock';
import { equalValues, object, readField } from './fieldValues';
import { isValidIdentifier, MAX_RELATION_RESOURCES, validServiceOrderPlacementGap } from './protocol';

import type { ActionTime } from './actionClock';
import type { ConflictDetail, DataCommand, LabeledServiceOrderPlacement, ResourceSnapshot, ServiceOrderPlacementAnchor, ServiceOrderPlacementComparison, ServiceOrderPlacementGap } from './types';

export const SERVICE_ORDER_PLACEMENT_HISTORY = '_placementHistory';
type Update = Extract<DataCommand, { kind: 'update' }>;
type Gap = ServiceOrderPlacementGap;
type PlacementProof = { revision: number; operationId: string; destination?: Gap; time: ActionTime | null };
type LabeledGap = LabeledServiceOrderPlacement;
type DisplacedPlacement = { earlier: LabeledGap; kept: LabeledGap; actionTime: ActionTime; winnerActionTime: ActionTime };
export type ServiceOrderPlacementWrite = { proof?: Omit<PlacementProof, 'revision'>; displaced?: DisplacedPlacement };
type RankWrite = { snapshot: ResourceSnapshot; rank: number };
type PlacementReader = {
  get(id: string): Promise<ResourceSnapshot>;
  list(select?: (snapshot: ResourceSnapshot) => boolean): Promise<ResourceSnapshot[] | undefined>;
};
type PlacementPlan = { ranks: RankWrite[]; write: ServiceOrderPlacementWrite } | { conflict: ConflictDetail; comparison: ServiceOrderPlacementComparison };

function storedPlacement(rawMetadata: unknown, snapshot: ResourceSnapshot): PlacementProof | undefined {
  const proof = object(rawMetadata) && rawMetadata.serviceOrderPlacement;
  if (!object(proof) || !snapshot.metadata || typeof proof.revision !== 'number' || !Number.isSafeInteger(proof.revision)
    || proof.revision < 1 || proof.revision > snapshot.metadata.revision || !isValidIdentifier(proof.operationId)) return undefined;
  const time = proof.time === null ? null : boundedActionTime(proof.time);
  const destination = proof.destination;
  if (time === undefined || (destination !== undefined && !validServiceOrderPlacementGap(destination, snapshot.resource.id))) return undefined;
  return { revision: proof.revision, operationId: proof.operationId, time, ...(destination !== undefined && { destination }) };
}

function asRow(snapshot: ResourceSnapshot) {
  const value = snapshot.value?.rank;
  return { id: snapshot.resource.id, rank: typeof value === 'number' ? value : Number.NaN, snapshot };
}

async function resolveGap(gap: Gap, reader: PlacementReader) {
  const read = async (anchor: ServiceOrderPlacementAnchor | null) => {
    if (!anchor) return null;
    const snapshot = await reader.get(anchor.id);
    return snapshot.value && !snapshot.metadata?.deleted && (snapshot.metadata?.generation ?? null) === anchor.generation
      ? asRow(snapshot) : undefined;
  };
  const [previous, next] = await Promise.all([read(gap.previous), read(gap.next)]);
  if (previous === undefined || next === undefined || (previous && next && sortByRank([previous, next])[0] !== previous)) return undefined;
  return { previous, next };
}

async function labelGap(gap: Gap, reader: PlacementReader): Promise<LabeledGap> {
  const label = async (anchor: ServiceOrderPlacementAnchor | null) => {
    if (!anchor) return null;
    const snapshot = await reader.get(anchor.id);
    const title = (snapshot.metadata?.generation ?? null) === anchor.generation ? snapshot.value?.title : undefined;
    return { ...anchor, ...(typeof title === 'string' && { title }) };
  };
  const [previous, next] = await Promise.all([label(gap.previous), label(gap.next)]);
  return { previous, next };
}

async function storedGap(current: ResourceSnapshot, reader: PlacementReader): Promise<LabeledGap | null> {
  const rows = await reader.list();
  if (!rows) return null;
  const ordered = sortByRank(rows.map(asRow));
  const index = ordered.findIndex(row => row.id === current.resource.id);
  if (index < 0) return null;
  const describe = (row: (typeof ordered)[number] | undefined) => {
    if (!row) return null;
    const title = row.snapshot.value?.title;
    return { id: row.id, generation: row.snapshot.metadata?.generation ?? null, ...(typeof title === 'string' && { title }) };
  };
  return { previous: describe(ordered[index - 1]), next: describe(ordered[index + 1]) };
}

async function displaced(earlier: Gap, kept: Gap, actionTime: ActionTime, winnerActionTime: ActionTime, reader: PlacementReader) {
  const [oldLabel, newLabel] = await Promise.all([labelGap(earlier, reader), labelGap(kept, reader)]);
  return { earlier: oldLabel, kept: newLabel, actionTime, winnerActionTime };
}

async function planRanks(current: ResourceSnapshot, gap: Gap, reader: PlacementReader): Promise<RankWrite[] | undefined> {
  const live = await resolveGap(gap, reader);
  if (!live) return undefined;
  const rank = rankBetween(live.previous?.rank ?? null, live.next?.rank ?? null);
  if (rank !== null) return [{ snapshot: current, rank }];
  // A compressed gap is repaired in the same bounded transaction as the move.
  // For a large catalog, allocate fresh ranks only inside a neighborhood that
  // contains the anchors. Rows beyond its strict bounds keep their positions.
  const full = await reader.list();
  const range = full ? undefined : localRankRange(live.previous?.rank, live.next?.rank);
  const rows = full ?? (range && await reader.list(snapshot => {
    const rank = snapshot.value?.rank;
    return typeof rank === 'number' && rank >= range.lower && rank <= range.upper;
  }));
  if (!rows) return undefined;
  const ordered = sortByRank(rows.filter(snapshot =>
    snapshot.resource.id !== current.resource.id && snapshot.value && !snapshot.metadata?.deleted).map(asRow));
  const target = live.next ? ordered.findIndex(row => row.id === live.next?.id)
    : ordered.findIndex(row => row.id === live.previous?.id) + 1;
  if (target < 0 || (!live.next && target === 0)) return undefined;
  ordered.splice(target, 0, asRow(current));
  if (!range) return ordered.map(({ snapshot }, index) => ({ snapshot, rank: (index + 1) * RANK_STEP }));
  const span = range.upper - range.lower;
  const spread = ordered.map(({ snapshot }, index) => ({
    snapshot, rank: range.lower + span * ((index + 1) / (ordered.length + 1)),
  }));
  return spread.every(({ rank }, index) => Number.isFinite(rank) && rank < range.upper
    && rank > (spread[index - 1]?.rank ?? range.lower)) ? spread : undefined;
}

function localRankRange(previous?: number, next?: number) {
  const anchors = [previous, next].filter((rank): rank is number => typeof rank === 'number' && Number.isFinite(rank));
  if (!anchors.length) return undefined;
  const lo = Math.min(...anchors), hi = Math.max(...anchors);
  const margin = Math.max(1, Math.max(Math.abs(lo), Math.abs(hi)) * Number.EPSILON * (MAX_RELATION_RESOURCES + 2));
  return { lower: Math.max(-Number.MAX_VALUE, lo - margin), upper: Math.min(Number.MAX_VALUE, hi + margin) };
}

export async function planServiceOrderPlacement(command: Update, current: ResourceSnapshot,
  rawMetadata: unknown, serverMs: number | undefined, reader: PlacementReader): Promise<PlacementPlan> {
  const move = command.serviceOrderPlacement!;
  const change = command.changes.find(item => item.path[0] === 'rank')!;
  const stored = readField(current.value!, ['rank']);
  const conflict = { path: change.path, base: change.before, mine: change.after, theirs: stored };
  const previous = storedPlacement(rawMetadata, current);
  const forReview = async (canPlace = true): Promise<PlacementPlan> => {
    const live = await resolveGap(move.destination, reader);
    const mine = await labelGap(move.destination, reader);
    const saved = await storedGap(current, reader);
    return { conflict, comparison: { mine, saved, available: canPlace && Boolean(live) } };
  };
  if (move.observedRevision > (current.metadata?.revision ?? 0)) return forReview();
  const measured = boundedActionTime(move.time);
  const time = measured && serverMs !== undefined && measured.earliestMs <= serverMs + 5 ? measured : null;
  const proof = { operationId: command.operationId, destination: move.destination, time };
  const unseen = previous && previous.revision > move.observedRevision;
  // An exact receipt belongs to this order and generation. A neighboring move can change
  // the shown gap without replacing the order's own accepted action.
  const follows = unseen && previous.operationId === move.predecessorOperationId;
  let retained: DisplacedPlacement | undefined;
  if (unseen && !follows) {
    const samePlace = equalValues(previous.destination, move.destination);
    const order = time && previous.time ? compareActionTime(time, previous.time) : 0;
    if (!samePlace && !order) return forReview();
    if (order < 0) {
      const history = !samePlace && previous.destination && time && previous.time
        ? await displaced(move.destination, previous.destination, time, previous.time, reader) : undefined;
      return { ranks: [], write: { ...(history && { displaced: history }) } };
    }
    if (!samePlace && previous.destination && time && previous.time) {
      retained = await displaced(previous.destination, move.destination, previous.time, time, reader);
    }
  }
  if (!previous && !equalValues(change.before, stored)) return forReview();
  const ranks = await planRanks(current, move.destination, reader);
  return ranks ? { ranks, write: { proof, ...(retained && { displaced: retained }) } } : forReview(false);
}

export function metadataAfterServiceOrderPlacement(snapshot: ResourceSnapshot, raw: Record<string, unknown> | undefined,
  write?: ServiceOrderPlacementWrite, maintenance = false) {
  const { metadata, resource, value } = snapshot;
  if (!metadata || resource.collection !== 'serviceOrders' || !value) return metadata;
  const previous = storedPlacement(raw?._dataEngine, snapshot);
  const rankChanged = !equalValues(raw?.rank, value.rank);
  const newProof = write?.proof ?? (rankChanged && !maintenance && metadata.operationId
    ? { operationId: metadata.operationId, time: null } : undefined);
  const proof = newProof ? { ...newProof, revision: metadata.revision } : previous;
  return proof ? { ...metadata, serviceOrderPlacement: proof } : metadata;
}
