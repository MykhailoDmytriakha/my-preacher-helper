import { projectServiceOrderStep, stepGap } from '@/utils/serviceOrderStepPlacement';

import { trackAnchoredRows } from './anchoredRowTracking.server';
import { equalValues } from './fieldValues';
import { membershipKey } from './seriesMembershipOrder.server';
import { replaySeriesReorder, seriesReorderGap } from './seriesReorder';
import { placementSteps, retainedStepOrderChanged } from './serviceOrderStepPlacement';
import { planStepPlacement } from './stepPlacement.server';

import type { StepPlacementTarget, StepPlacementWrite } from './stepPlacement.server';
import type { ConflictDetail, DataCommand, DocumentData, ResourceSnapshot } from './types';

export const SERIES_ITEM_PLACEMENT_HISTORY = '_seriesItemPlacementHistory';

type Relation = Extract<DataCommand, { relation: 'series-membership' }>;
type SeriesEdit = Relation['edits'][number];
type SeriesRow = DocumentData & { id: string; type: 'sermon' | 'group'; refId: string; position: number };
type Plan = { items: SeriesRow[]; writes: StepPlacementWrite[] } | { conflict: ConflictDetail } | { code: string };

function seriesRows(value: unknown): SeriesRow[] | undefined {
  const rows = placementSteps(value);
  if (!rows?.every((row): row is SeriesRow => (row.type === 'sermon' || row.type === 'group')
    && typeof row.refId === 'string' && typeof row.position === 'number' && Number.isFinite(row.position))) return undefined;
  return [...rows].sort((left, right) => left.position - right.position);
}
const target = {
  collection: 'series', field: 'items', proofKey: 'seriesItemPlacement',
  read: seriesRows,
  rowIdentity: (row: DocumentData) => JSON.stringify([row.type, row.refId]),
};
const tracking = trackAnchoredRows(target);
const positionRows = (rows: SeriesRow[]) => rows.map((row, index) => row.position === index + 1 ? row : { ...row, position: index + 1 });

function asUpdate(command: Relation, edit: SeriesEdit): Extract<DataCommand, { kind: 'update' }> {
  return { protocol: 1, kind: 'update', owner: command.owner, operationId: command.operationId,
    resource: edit.resource, generation: edit.generation, dependsOn: command.dependsOn,
    changes: [{ path: ['items'], before: { exists: true, value: edit.beforeItems }, after: { exists: true, value: edit.afterItems } }] };
}

export function planSeriesItemPlacement(command: Relation, edit: SeriesEdit, current: ResourceSnapshot, currentItems: DocumentData[],
  raw: unknown, serverMs?: number): Plan {
  const capture = edit.membership;
  const before = seriesRows(edit.beforeItems), after = seriesRows(edit.afterItems), stored = seriesRows(currentItems);
  if (!capture?.reorder || !capture.reorderQueueId || capture.added.length || capture.removed.length || !before || !after || !stored) return { code: 'invalid-document' };
  const order = replaySeriesReorder(before.map(row => row.id), capture.reorder);
  const authored = new Map(after.map(row => [row.id, row]));
  if (!order || !equalValues(order, after.map(row => row.id)) || before.some(row => {
    const moved = authored.get(row.id);
    return !moved || !equalValues({ ...row, position: moved.position }, moved);
  })) return { code: 'invalid-document' };

  const revision = current.metadata?.revision ?? 0;
  // An acknowledgement can prove the birth of an anchor. It does not prove
  // that the original gesture saw other moves incorporated in that snapshot.
  const predecessorBirth = capture.predecessorOperationId && capture.predecessorOperationId === current.metadata?.operationId
    && equalValues(before.map(row => [row.id, target.rowIdentity(row)]), stored.map(row => [row.id, target.rowIdentity(row)]))
    ? revision : undefined;
  const subjects = new Set(capture.reorder.map(step => step.itemId));
  const anchors = new Set(order.filter(id => !subjects.has(id)));
  const update = asUpdate(command, edit);
  let items = stored;
  const writes: StepPlacementWrite[] = [];
  for (const stepId of order.filter(id => subjects.has(id))) {
    const projectionGap = seriesReorderGap(order, stepId, anchors);
    const placement = { stepId, opening: stepGap(before, stepId)!, destination: stepGap(after, stepId)!,
      observedRevision: capture.observedRevision, time: capture.time, queueId: capture.reorderQueueId,
      predecessorOperationId: capture.predecessorOperationId };
    const policy: StepPlacementTarget<SeriesRow> = {
      ...target, title: () => undefined,
      // Use the full saved gap for proof and history. Projection skips subjects still to be placed.
      project: (rows, stepId) => {
        const projected = projectServiceOrderStep(rows, stepId, projectionGap);
        return projected && positionRows(projected);
      },
      lineage: (_raw, _current, _rows, opening, _move) => tracking.lineage(raw, current, stored, opening, placement, predecessorBirth),
    };
    const plan = planStepPlacement(policy, placement, update, { ...current, value: { ...current.value!, items } }, raw, serverMs);
    if ('conflict' in plan) return { conflict: plan.conflict };
    items = seriesRows(plan.steps)!;
    if (plan.write.proof) anchors.add(stepId);
    writes.push(plan.write);
  }
  return { items, writes };
}

export function legacyReorderedSeries(edits: readonly SeriesEdit[]): SeriesEdit[] {
  const moved = new Set<string>();
  for (const { beforeItems, afterItems } of edits) {
    const before = new Set(beforeItems.map(membershipKey)), after = new Set(afterItems.map(membershipKey));
    for (const member of before) if (!after.has(member)) moved.add(member);
    for (const member of after) if (!before.has(member)) moved.add(member);
  }
  return edits.flatMap(edit => {
    const beforeItems = seriesRows(edit.beforeItems)?.filter(row => !moved.has(membershipKey(row)));
    const afterItems = seriesRows(edit.afterItems)?.filter(row => !moved.has(membershipKey(row)));
    return beforeItems && afterItems && retainedStepOrderChanged(beforeItems, afterItems) ? [{ ...edit, beforeItems, afterItems }] : [];
  });
}

export function isPureSeriesReorder(edit: SeriesEdit): boolean {
  const before = seriesRows(edit.beforeItems), after = seriesRows(edit.afterItems);
  if (!before || !after || before.length !== after.length) return false;
  const byId = new Map(after.map(row => [row.id, row]));
  return before.every(row => {
    const moved = byId.get(row.id);
    return moved && equalValues({ ...row, position: moved.position }, moved);
  });
}

export function legacySeriesReorderNeedsReview(command: Relation, edit: SeriesEdit, current: ResourceSnapshot, raw: unknown): boolean {
  return tracking.legacyNeedsReview(asUpdate(command, edit), current, raw);
}

export const metadataAfterSeriesItemPlacement = tracking.metadataAfter;
