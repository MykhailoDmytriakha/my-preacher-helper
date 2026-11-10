import { projectServiceOrderStep } from '@/utils/serviceOrderStepPlacement';

import { boundedActionTime, compareActionTime } from './actionClock';
import { object } from './fieldValues';
import { isValidIdentifier } from './protocol';

import type { HomileticList, HomileticPlacement } from './homileticPlan';
import type { PlacementStep, StepPlacementProof } from './stepPlacement.server';
import type { ServiceOrderStepGap } from './types';

const limit = 64;
export const homileticCrossingProofKey = (list: HomileticList) => `homiletic-${list}-crossings`;
type Pair = { first: string; second: string; firstBefore: boolean };
export type CrossingWrite = Pair & Pick<StepPlacementProof, 'operationId' | 'time' | 'queueDigest'>;
type Proof = CrossingWrite & { revision: number };
type Evidence = { floor: number; proofs: Map<string, Proof> };
type Lineage = { available: boolean; trusted: boolean; previous?: StepPlacementProof; queueDigest?: string };
const indexRows = (rows: readonly PlacementStep[]) => new Map(rows.map(({ id }, index) => [id, index]));
const pairKey = ({ first, second }: Pair) => JSON.stringify([first, second]);

function orderOf(pair: Pair, order: ReadonlyMap<string, number>): boolean | undefined {
  const first = order.get(pair.first), second = order.get(pair.second);
  return first !== undefined && second !== undefined ? first < second : undefined;
}

/** Either arrow on adjacent rows changes the same relative order. */
export function crossedHomileticPairs(opening: PlacementStep[], after: PlacementStep[], mover: string): Pair[] {
  const before = indexRows(opening), wanted = indexRows(after);
  return opening.flatMap(({ id }) => {
    if (id === mover) return [];
    const [first, second] = id < mover ? [id, mover] : [mover, id];
    const pair = { first, second, firstBefore: false };
    const firstBefore = orderOf(pair, wanted);
    return firstBefore !== undefined && firstBefore !== orderOf(pair, before) ? [{ ...pair, firstBefore }] : [];
  });
}

/** The same anchors can cross extra rows when projected onto a changed list. */
export function effectiveHomileticPairs(pairs: readonly Pair[], rows: PlacementStep[], move: HomileticPlacement): Pair[] {
  const projected = projectServiceOrderStep(rows, move.stepId, move.destination);
  const actual = projected ? crossedHomileticPairs(rows, projected, move.stepId) : [];
  return [...new Map([...pairs, ...actual].map(pair => [pairKey(pair), pair])).values()];
}

export function readHomileticCrossings(raw: unknown, list: HomileticList, revision: number): Evidence {
  const state = object(raw) ? raw[homileticCrossingProofKey(list)] : undefined;
  const proofs = new Map<string, Proof>();
  const validRevision = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= revision;
  if (!object(state) || !validRevision(state.floor) || !Array.isArray(state.proofs) || state.proofs.length > limit) return { floor: 0, proofs };
  for (const proof of state.proofs) {
    if (!object(proof) || !isValidIdentifier(proof.first) || !isValidIdentifier(proof.second) || proof.first >= proof.second
      || typeof proof.firstBefore !== 'boolean' || !validRevision(proof.revision)
      || (proof.operationId !== null && !isValidIdentifier(proof.operationId))) continue;
    const time = proof.time === null ? null : boundedActionTime(proof.time);
    if (time === undefined) continue;
    const { first, second, firstBefore, revision: accepted, operationId, queueDigest } = proof;
    const pair = { first, second, firstBefore };
    proofs.set(pairKey(pair), { ...pair, time, operationId, revision: accepted,
      ...(typeof queueDigest === 'string' && /^[a-zA-Z0-9_-]{43}$/.test(queueDigest) && { queueDigest }) });
  }
  return { floor: state.floor, proofs };
}

export function homileticCrossingLineage(lineage: Lineage, evidence: Evidence, pairs: readonly Pair[], live: PlacementStep[],
  move: HomileticPlacement, saved: ServiceOrderStepGap | undefined, serverMs: number): Lineage {
  if (!lineage.trusted || !saved) return lineage;
  const order = indexRows(live);
  const rivals: StepPlacementProof[] = [];
  for (const pair of pairs) {
    const current = orderOf(pair, order);
    if (current === undefined) continue;
    const proof = evidence.proofs.get(pairKey(pair));
    if (proof && proof.firstBefore === current) {
      if (proof.revision > move.observedRevision && !follows(proof, lineage, move)) {
        rivals.push({ ...proof, stepId: move.stepId, destination: saved });
      }
    } else if (evidence.floor > move.observedRevision) return { ...lineage, trusted: false };
  }
  if (!rivals.length) return lineage;
  const row = lineage.previous;
  if (row && row.revision > move.observedRevision && !follows(row, lineage, move)) rivals.push(row);
  const time = move.time && move.time.earliestMs <= serverMs + 5 ? move.time : null;
  const orders = new Set(rivals.map(proof => time && proof.time ? compareActionTime(time, proof.time) : 0));
  if (orders.size > 1 || orders.has(0)) return { ...lineage, trusted: false };
  const previous = rivals.reduce((latest, proof) => latest.revision >= proof.revision ? latest : proof);
  return { ...lineage, previous };
}

function follows(proof: Pick<StepPlacementProof, 'operationId' | 'queueDigest'>, lineage: Lineage, move: HomileticPlacement) {
  return Boolean(proof.queueDigest && proof.queueDigest === lineage.queueDigest && proof.operationId === move.predecessorOperationId);
}

export function metadataAfterHomileticCrossings(raw: unknown, list: HomileticList, revision: number, rows: PlacementStep[],
  accepted: readonly CrossingWrite[] | undefined) {
  const { floor, proofs } = readHomileticCrossings(raw, list, revision - 1);
  const order = indexRows(rows);
  for (const proof of accepted ?? []) {
    if (orderOf(proof, order) === proof.firstBefore) proofs.set(pairKey(proof), { ...proof, revision });
  }
  const retained = [...proofs.values()].filter(proof => orderOf(proof, order) === proof.firstBefore).sort((a, b) => b.revision - a.revision);
  return retained.length || floor ? { [homileticCrossingProofKey(list)]: { floor: Math.max(floor, retained[limit]?.revision ?? 0), proofs: retained.slice(0, limit) } } : {};
}
