import { projectServiceOrderStep, stepGap } from '@/utils/serviceOrderStepPlacement';

import { equalValues } from './fieldValues';
import { homileticLists, readHomileticList } from './homileticPlan';
import { placementSteps, retainedStepOrderChanged } from './serviceOrderStepPlacement';

import type { HomileticList, HomileticMoveGesture, HomileticMoveInput } from './homileticPlan';
import type { DocumentData, ServiceOrderStepGap } from './types';

export const MAX_HOMILETIC_MOVES = 32;
const ids = (rows: readonly { id: string }[]) => rows.map(row => row.id);

export function stageHomileticMove(before: DocumentData, after: DocumentData, input: HomileticMoveInput['homileticMove']): HomileticMoveGesture | undefined {
  if (!homileticLists.includes(input.list)) return;
  const original = readHomileticList(before.preparation, input.list), proposed = readHomileticList(after.preparation, input.list);
  const opening = original && stepGap(original, input.rowId), destination = proposed && stepGap(proposed, input.rowId);
  if (!opening || !destination || !original || !proposed || equalValues(opening, destination)) return;
  const projected = projectServiceOrderStep(original, input.rowId, destination);
  if (projected && equalValues(ids(projected), ids(proposed))) return { ...input, opening, destination, visibleOrder: ids(original) };
}

/** A set of gestures certifies only the retained relative order it exactly reproduces. */
export function matchesHomileticMoveSequence(before: unknown, after: unknown,
  moves: readonly { stepId: string; opening: ServiceOrderStepGap; destination: ServiceOrderStepGap }[]): boolean {
  const original = placementSteps(before), proposed = placementSteps(after);
  if (!original || !proposed || !moves.length || moves.length > MAX_HOMILETIC_MOVES || !retainedStepOrderChanged(original, proposed)) return false;
  const incoming = new Set(ids(proposed)), opening = new Set(ids(original));
  let projected = original.filter(row => incoming.has(row.id));
  for (const move of moves) {
    if (equalValues(move.opening, move.destination) || !equalValues(stepGap(projected, move.stepId), move.opening)) return false;
    const next = projectServiceOrderStep(projected, move.stepId, move.destination);
    if (!next || !equalValues(stepGap(next, move.stepId), move.destination)) return false;
    projected = next;
  }
  return equalValues(ids(projected), ids(proposed.filter(row => opening.has(row.id))));
}

export function homileticMovesInList(moves: readonly HomileticMoveGesture[], list: HomileticList,
  original: readonly { id: string }[], proposed: readonly { id: string }[]) {
  const incoming = new Set(ids(proposed));
  const retained = new Set(ids(original).filter(id => incoming.has(id)));
  return moves.filter(move => move.list === list).flatMap(({ rowId, opening, destination, visibleOrder }) => {
    if (!visibleOrder) return [{ stepId: rowId, opening, destination }];
    if (!retained.has(rowId)) return [];
    const visible = visibleOrder.map(id => ({ id }));
    const after = projectServiceOrderStep(visible, rowId, destination);
    if (!after) return [];
    const from = stepGap(visible.filter(row => retained.has(row.id)), rowId);
    const to = stepGap(after.filter(row => retained.has(row.id)), rowId);
    return from && to && !equalValues(from, to) ? [{ stepId: rowId, opening: from, destination: to }] : [];
  });
}

/** Apply an exact relative order while leaving unmentioned rows in their original slots. */
export function carryHomileticOrder<Row extends { id: string }>(rows: Row[], order: readonly { id: string }[], retained: ReadonlySet<string>): Row[] {
  const original = new Map(rows.filter(row => retained.has(row.id)).map(row => [row.id, row]));
  const sorted = order.flatMap(({ id }) => original.get(id) ?? []);
  let index = 0;
  return rows.map(row => retained.has(row.id) ? sorted[index++] ?? row : row);
}

/** Replay only the relative pairs this choice changes. A cycle means the fresh order needs another decision. */
export function rebaseHomileticOrder<Row extends { id: string }>(rows: Row[],
  compared: readonly { id: string }[], chosen: readonly { id: string }[]): Row[] | undefined {
  const index = (items: readonly { id: string }[]) => new Map(items.map((row, position) => [row.id, position]));
  const before = index(compared), after = index(chosen), live = index(rows);
  const compare = (a: Row, b: Row) => {
    const opening = (before.get(a.id) ?? NaN) - (before.get(b.id) ?? NaN);
    const desired = (after.get(a.id) ?? NaN) - (after.get(b.id) ?? NaN);
    return opening * desired < 0 ? desired : live.get(a.id)! - live.get(b.id)!;
  };
  const ordered = [...rows].sort(compare);
  // Sort alone cannot detect contradictory pair constraints.
  for (let i = 0; i < ordered.length; i++) {
    for (let j = i + 1; j < ordered.length; j++) {
      if (compare(ordered[i], ordered[j]) > 0) return;
    }
  }
  return ordered;
}
