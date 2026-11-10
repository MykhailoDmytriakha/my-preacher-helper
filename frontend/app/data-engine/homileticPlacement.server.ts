import { projectServiceOrderStep, stepGap } from '@/utils/serviceOrderStepPlacement';

import { boundedActionTime } from './actionClock';
import { trackAnchoredRows } from './anchoredRowTracking.server';
import { equalValues, object } from './fieldValues';
import { crossedHomileticPairs, effectiveHomileticPairs, homileticCrossingLineage, readHomileticCrossings, type CrossingWrite } from './homileticCrossings.server';
import { homileticListPath, HOMILETIC_POSITION_REVIEW } from './homileticPlan';
import { carryHomileticOrder, matchesHomileticMoveSequence, MAX_HOMILETIC_MOVES } from './homileticPlanMoves';
import { isValidIdentifier, validServiceOrderStepGap } from './protocol';
import { placementSteps } from './serviceOrderStepPlacement';
import { planStepPlacement } from './stepPlacement.server';

import type { HomileticList, HomileticPlacement } from './homileticPlan';
import type { PlacementStep, StepPlacementWrite } from './stepPlacement.server';
import type { ConflictDetail, DataCommand, FieldChange, ResourceSnapshot } from './types';

type Update = Extract<DataCommand, { kind: 'update' }>;
export type HomileticMoveWrite = { writes: StepPlacementWrite[]; crossings: CrossingWrite[] };
type ProjectedMoves = ({ change: FieldChange; order: PlacementStep[] } & HomileticMoveWrite) | { conflict: ConflictDetail };

export const homileticPlacementProofKey = (list: HomileticList) => `homiletic-${list}-placement`;

export function homileticPlacementTracking(list: HomileticList) {
  return trackAnchoredRows({ collection: 'sermons', field: list, proofKey: homileticPlacementProofKey(list),
    read: placementSteps, rowIdentity: row => row.id });
}

function readMoves(input: unknown, revision: number, before: PlacementStep[], after: PlacementStep[]): HomileticPlacement[] | undefined {
  if (!Array.isArray(input) || !input.length || input.length > MAX_HOMILETIC_MOVES) return;
  const moves: HomileticPlacement[] = [];
  for (const move of input) {
    if (!object(move) || !isValidIdentifier(move.stepId) || !isValidIdentifier(move.queueId)
      || !validServiceOrderStepGap(move.opening, move.stepId) || !validServiceOrderStepGap(move.destination, move.stepId)
      || !Number.isSafeInteger(move.observedRevision) || (move.observedRevision as number) < 1 || (move.observedRevision as number) > revision) return;
    const time = move.time === null ? null : boundedActionTime(move.time);
    if (time === undefined) return;
    moves.push({ stepId: move.stepId, queueId: move.queueId, opening: move.opening, destination: move.destination,
      time, observedRevision: move.observedRevision as number,
      ...(isValidIdentifier(move.predecessorOperationId) && { predecessorOperationId: move.predecessorOperationId }) });
  }
  const first = moves[0];
  if (moves.some(move => move.queueId !== first.queueId || move.observedRevision !== first.observedRevision || !equalValues(move.time, first.time))) return;
  return matchesHomileticMoveSequence(before, after, moves) ? moves : undefined;
}

export function planHomileticMoves(command: Update, list: HomileticList, change: FieldChange, current: ResourceSnapshot,
  raw: unknown, serverMs: number, projected = change): ProjectedMoves | undefined {
  const before = placementSteps(change.before.value), mine = placementSteps(change.after.value);
  const stored = placementSteps(current.value?.[list]);
  if (!current.metadata || !before || !mine || !stored) return;
  const moves = readMoves(command.homileticMoveActions?.[list], current.metadata.revision, before, mine);
  if (!moves) return;
  const tracker = homileticPlacementTracking(list);
  const evidence = readHomileticCrossings(raw, list, current.metadata.revision);
  const known = new Set(before.map(row => row.id));
  const submitted = new Set(mine.map(row => row.id));
  const kept = new Set(stored.map(row => row.id));
  const retained = new Set(before.filter(row => submitted.has(row.id) && kept.has(row.id)).map(row => row.id));
  let opening = before.filter(row => submitted.has(row.id));
  let live = stored;
  let local: PlacementStep[] | undefined = stored;
  let needsReview = false;
  const writes: StepPlacementWrite[] = [];
  const crossings: CrossingWrite[] = [];
  for (const move of moves) {
    const after = projectServiceOrderStep(opening, move.stepId, move.destination)!;
    const pairs = crossedHomileticPairs(opening, after, move.stepId);
    const planFor = (rows: PlacementStep[]) => planStepPlacement({
      collection: 'sermons', field: list, proofKey: '', read: placementSteps, project: projectServiceOrderStep, title: (_doc, row) => row.title,
      lineage: (metadata, _snapshot, _rows, seen) => {
        const lineage = tracker.lineage(metadata, current, stored, seen, move);
        const effective = effectiveHomileticPairs(pairs, rows, move);
        if (effective.some(pair => !known.has(pair.first) || !known.has(pair.second))) return { ...lineage, trusted: false };
        return homileticCrossingLineage(lineage, evidence, effective, rows, move, stepGap(rows, move.stepId), serverMs);
      },
    }, move, { ...command, changes: [{ path: [list], before: { exists: true, value: opening }, after: { exists: true, value: after } }] },
    { ...current, value: { [list]: rows } }, raw, serverMs);
    const plan = planFor(live);
    const localPlan: ReturnType<typeof planStepPlacement> | undefined = local === live ? plan : local && planFor(local);
    if (local && localPlan) {
      local = 'conflict' in localPlan ? (localPlan.comparison.available ? projectServiceOrderStep(local, move.stepId, move.destination) : undefined)
        : placementSteps(localPlan.steps);
    }
    if ('conflict' in plan) needsReview = true;
    else {
      const applied = placementSteps(plan.steps);
      if (!applied) return;
      writes.push(plan.write);
      const proof = plan.write.proof;
      if (proof) for (const pair of effectiveHomileticPairs(pairs, live, move)) {
        crossings.push({ ...pair, operationId: proof.operationId, time: proof.time,
          ...(proof.queueDigest && { queueDigest: proof.queueDigest }) });
      }
      live = applied;
    }
    opening = after;
  }
  if (needsReview) return { conflict: { path: homileticListPath(list), code: HOMILETIC_POSITION_REVIEW,
    base: { exists: true, value: before }, mine: local ? { exists: true, value: local } : { exists: false },
    theirs: { exists: true, value: live } } };
  // Rewrite only relative positions. Titles and additions still take the ordinary keyed merge.
  return { change: { ...projected, before: { ...projected.before, value: carryHomileticOrder(placementSteps(projected.before.value) ?? before, stored, retained) },
    after: { ...projected.after, value: carryHomileticOrder(placementSteps(projected.after.value) ?? mine, live, retained) } }, order: live, writes, crossings };
}

export function retainedHomileticMoveHistory(snapshot: ResourceSnapshot, list: HomileticList, writes: readonly StepPlacementWrite[]) {
  const rows = placementSteps(snapshot.value?.[list]);
  if (!rows) return [];
  return writes.flatMap(({ displaced }) => {
    if (!displaced) return [];
    const gap = stepGap(rows, displaced.stepId);
    const kept = { previous: displaced.kept.previous?.id ?? null, next: displaced.kept.next?.id ?? null };
    return equalValues(gap, kept) ? [displaced] : [];
  });
}
