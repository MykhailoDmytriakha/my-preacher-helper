import { stepGap } from '@/utils/serviceOrderStepPlacement';

import { equalValues } from './fieldValues';

import type { ActionTime } from './actionClock';
import type { CommitRequest } from './commits';
import type { AnchoredRowPlacementCapture } from './types';

type RowId = { id: string };

export function captureAnchoredRowPlacement<Row extends RowId>(shown: Row[] | undefined, moved: Row[] | undefined,
  stepId: string, generation: string | null, observedRevision: number, time: ActionTime | null): AnchoredRowPlacementCapture<Row> | undefined {
  const opening = shown && stepGap(shown, stepId);
  const destination = moved && stepGap(moved, stepId);
  if (!shown || !moved || !opening || !destination || equalValues(opening, destination)) return undefined;
  return { generation, before: shown, after: moved, placement: { stepId, opening, destination, observedRevision, time } };
}

/** Walk only through the local chain that produced the exact order visible at the gesture. */
export function anchoredPlacementPredecessor<Row extends RowId>(records: readonly CommitRequest[], predecessor: CommitRequest | undefined,
  move: AnchoredRowPlacementCapture<Row>, collection: string, witness: (record: CommitRequest) => Row[] | undefined,
  capture: (record: CommitRequest) => AnchoredRowPlacementCapture<Row> | undefined): CommitRequest | undefined {
  if (!predecessor) return undefined;
  const chain = new Map(records.map(record => [record.id, record]));
  let shown = move.before;
  let record: CommitRequest | undefined = predecessor;
  while (record && chain.delete(record.id)) {
    if (record.owner !== predecessor.owner || record.baseline.resource.collection !== collection
      || record.baseline.resource.id !== predecessor.baseline.resource.id
      || (record.baseline.metadata?.generation ?? null) !== move.generation
      || ['cancelled', 'conflict', 'refused'].includes(record.state)
      || !equalValues(witness(record), shown)) return undefined;
    const previous = capture(record);
    if (previous) {
      if (!equalValues(previous.after, shown)) return undefined;
      if (previous.placement.stepId === move.placement.stepId) return record;
      shown = previous.before;
    }
    record = record.predecessor ? chain.get(record.predecessor) : undefined;
  }
}

/** Restore the opening order of surviving rows, leaving new rows at the ends or before their next known row. */
export function withoutUnsignedRowOrder<Row extends RowId>(before: readonly Row[], after: readonly Row[]): Row[] {
  const opening = new Set(before.map(row => row.id));
  const current = new Map(after.map(row => [row.id, row]));
  const prefix: Row[] = [];
  const inserts = new Map<string, Row[]>();
  let pending: Row[] = [];
  let foundOpeningRow = false;
  for (const row of after) {
    if (!opening.has(row.id)) pending.push(row);
    else {
      if (!foundOpeningRow) prefix.push(...pending);
      else if (pending.length) inserts.set(row.id, pending);
      foundOpeningRow = true;
      pending = [];
    }
  }
  return [...prefix, ...before.flatMap(row => {
    const edited = current.get(row.id);
    return edited ? [...inserts.get(row.id) ?? [], edited] : [];
  }), ...pending];
}

export function isAnchoredPlacementRefusal(request: CommitRequest): boolean {
  const { command, result } = request;
  if (result?.kind !== 'refused' || command?.kind !== 'update') return false;
  return command.resource.collection === 'groups' && result.code === 'group-step-placement-needs-review'
    || command.resource.collection === 'councils' && result.code === 'council-topic-placement-needs-review';
}

export function isUnsignedAnchoredPlacementRefusal(request: CommitRequest): boolean {
  const { command } = request;
  return isAnchoredPlacementRefusal(request) && command?.kind === 'update'
    && !command.groupFlowStepPlacement && !command.councilTopicPlacement;
}
