import { boundedActionTime } from './actionClock';
import { equalValues, object } from './fieldValues';
import { matchesRowDetailBirth } from './rowDetailAction';
import { boundedRowId, existingRowField, matchesRowAction, proofRevision } from './rowFieldAction';

import type { ActionTime } from './actionClock';
import type { CommitRequest } from './commits';
import type { RowDetailActions, RowDetailObservation, RowDetailPolicy } from './rowDetailAction';
import type { RowValue } from './rowFieldAction';
import type { DocumentData, FieldChange, ResourceSnapshot } from './types';

export type RowDetailCaptures<Field extends string, Value extends RowValue> = Partial<Record<Field, {
  rowId: string; rowCreatedAt: string; after: Value; time: ActionTime;
}>>;

export function knownRowDetailPredecessor<Field extends string, Value extends RowValue>(predecessor: CommitRequest | undefined,
  requests: ReadonlyMap<string, CommitRequest>, baseline: ResourceSnapshot, policy: RowDetailPolicy<Field, Value>,
  actionFor: (request: CommitRequest) => Pick<RowDetailObservation<Value>, 'rowId' | 'rowCreatedAt' | 'after'> | undefined,
  field: Field, rowId: string, rowCreatedAt: string, value: Value, scope: RowValue | undefined): string | undefined {
  const visited = new Set<string>();
  const target = policy.target(field);
  for (let request = predecessor; request && !visited.has(request.id); request = requests.get(request.predecessor ?? '')) {
    const saved = request.baseline;
    const rows = request.value?.[target.field];
    if (saved.resource.collection !== baseline.resource.collection || saved.resource.id !== baseline.resource.id
      || saved.metadata?.generation !== baseline.metadata?.generation || request.state === 'cancelled' || request.state === 'refused'
      || existingRowField(rows, rowId, policy.birth) !== rowCreatedAt || !equalValues(existingRowField(rows, rowId, target), value)
      || !equalValues(policy.scopes?.(rows, field)?.get(rowId), scope)) break;
    const authored = actionFor(request);
    if (authored?.rowId === rowId) return authored.rowCreatedAt === rowCreatedAt && equalValues(authored.after, value) ? request.id : undefined;
    visited.add(request.id);
  }
}

export function captureRowDetailActions<Field extends string, Value extends RowValue>(baseline: ResourceSnapshot, predecessor: CommitRequest | undefined,
  draft: DocumentData | null, captures: RowDetailCaptures<Field, Value> | undefined, records: readonly CommitRequest[],
  policy: RowDetailPolicy<Field, Value>, actionsFor: (request: CommitRequest) => RowDetailActions<Field, Value> | undefined): RowDetailActions<Field, Value> | undefined {
  if (!captures || baseline.resource.collection !== policy.collection || !baseline.metadata || baseline.metadata.deleted) return undefined;
  const { revision: observedRevision } = baseline.metadata;
  const ancestor = predecessor ? predecessor.value : baseline.value;
  const requests = new Map(records.map(request => [request.id, request]));
  const actions = policy.fields.flatMap(field => {
    const capture = captures[field];
    if (!object(capture) || !boundedRowId(capture.rowId)) return [];
    const { rowId } = capture;
    const time = boundedActionTime(capture.time);
    const target = policy.target(field);
    const beforeRows = ancestor?.[target.field], afterRows = draft?.[target.field];
    const before = existingRowField(beforeRows, rowId, target), after = existingRowField(afterRows, rowId, target);
    const rowCreatedAt = existingRowField(beforeRows, rowId, policy.birth);
    const scopes = policy.scopes?.(beforeRows, field);
    const scope = scopes?.get(rowId);
    if (!time || before === undefined || after === undefined || equalValues(before, after) || !equalValues(after, capture.after) || !rowCreatedAt
      || rowCreatedAt !== capture.rowCreatedAt || rowCreatedAt !== existingRowField(afterRows, rowId, policy.birth)
      || (scopes && (scope === undefined || !equalValues(scope, policy.scopes?.(afterRows, field)?.get(rowId))))) return [];
    const predecessorOperationId = knownRowDetailPredecessor(predecessor, requests, baseline, policy, request => actionsFor(request)?.[field], field, rowId, rowCreatedAt, before, scope);
    return [[field, { rowId, rowCreatedAt, before, after, time, observedRevision,
      ...(predecessorOperationId && { predecessorOperationId }) }]] as const;
  });
  return actions.length ? Object.fromEntries(actions) as RowDetailActions<Field, Value> : undefined;
}

export function matchingRowDetailActions<Field extends string, Value extends RowValue>(changes: FieldChange[],
  actions: RowDetailActions<Field, Value> | undefined, policy: RowDetailPolicy<Field, Value>): RowDetailActions<Field, Value> | undefined {
  if (!actions) return undefined;
  const matching = policy.fields.flatMap(field => {
    const action = actions[field];
    return action && matchesRowDetailBirth(changes, action, policy.birth) && matchesRowAction(changes, action, policy.target(field))
      ? [[field, action]] as const : [];
  });
  return matching.length ? Object.fromEntries(matching) as RowDetailActions<Field, Value> : undefined;
}

export function pendingRowDetailRebases<Field extends string, Value extends RowValue>(record: CommitRequest,
  actions: Partial<Record<Field, RowDetailObservation<Value>>> | undefined, policy: RowDetailPolicy<Field, Value>) {
  if (record.sequence !== 0 || !actions || !record.working.value
    || record.working.metadata?.generation !== record.baseline.metadata?.generation) return [];
  return policy.fields.flatMap(field => {
    const action = actions[field], target = policy.target(field);
    const current = record.working.value?.[target.field], intended = record.intended?.[target.field];
    return action && existingRowField(current, action.rowId, target) !== undefined
      && existingRowField(current, action.rowId, policy.birth) === action.rowCreatedAt
      && existingRowField(intended, action.rowId, policy.birth) === action.rowCreatedAt
      && equalValues(existingRowField(intended, action.rowId, target), action.after)
      && equalValues(policy.scopes?.(current, field)?.get(action.rowId), policy.scopes?.(intended, field)?.get(action.rowId))
      ? [{ action, target }] : [];
  });
}

export type SeenRowDetail<Value extends RowValue> = { generation: string; observedRevision: number; rowId: string; before: Value; after: Value; time: ActionTime | null };

/** Preserve the exact displayed row and action even if its current value already matches the click. */
export function captureSeenRowDetail<Field extends string, Value extends RowValue>(baseline: ResourceSnapshot,
  predecessor: CommitRequest | undefined, draft: DocumentData | null, capture: SeenRowDetail<Value> | undefined, records: readonly CommitRequest[],
  field: Field, policy: RowDetailPolicy<Field, Value>, actionFor: (request: CommitRequest) => RowDetailObservation<Value> | undefined):
  RowDetailObservation<Value> | undefined {
  if (!capture || baseline.resource.collection !== policy.collection || !baseline.metadata || baseline.metadata.deleted
    || capture.generation !== baseline.metadata.generation || !proofRevision(capture.observedRevision)
    || capture.observedRevision > baseline.metadata.revision || !boundedRowId(capture.rowId)) return undefined;
  const { rowId, before, after, observedRevision } = capture;
  const target = policy.target(field);
  const time = capture.time === null ? null : boundedActionTime(capture.time);
  if (time === undefined || !target.accepts(before) || !target.accepts(after) || equalValues(before, after)) return undefined;
  const ancestor = predecessor ? predecessor.value : baseline.value;
  const born = existingRowField(ancestor?.[target.field], rowId, policy.birth);
  if (!born || existingRowField(ancestor?.[target.field], rowId, target) === undefined
    || existingRowField(draft?.[target.field], rowId, policy.birth) !== born
    || !equalValues(existingRowField(draft?.[target.field], rowId, target), after)) return undefined;
  const byId = new Map(records.map(request => [request.id, request]));
  const scope = policy.scopes?.(ancestor?.[target.field], field)?.get(rowId);
  const predecessorOperationId = knownRowDetailPredecessor(predecessor, byId, baseline, policy, request => {
    const action = actionFor(request);
    if (action?.rowId === rowId) return action;
    const opening = request.predecessor ? byId.get(request.predecessor)?.value : request.baseline.value;
    const openingRows = opening?.[target.field];
    const sameBirth = existingRowField(request.value?.[target.field], rowId, policy.birth) === born;
    const created = existingRowField(openingRows, rowId, policy.birth) === undefined;
    const enteredScope = policy.causalScopeEntry && scope !== undefined && policy.scopes?.(openingRows, field)?.get(rowId) === undefined;
    return sameBirth && (created || enteredScope) ? { rowId, rowCreatedAt: born, after: before } : undefined;
  }, field, rowId, born, before, scope);
  return { rowId, rowCreatedAt: born, before, after, observedRevision, time, ...(predecessorOperationId && { predecessorOperationId }) };
}
