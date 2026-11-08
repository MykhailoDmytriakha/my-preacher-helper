import { boundedActionTime } from './actionClock';
import { object, readField } from './fieldValues';
import { matchesRowDetailBirth } from './rowDetailAction';
import { knownRowDetailPredecessor } from './rowDetailCapture';
import { boundedRowId, existingRowField, isRowChange, matchesRowAction, proofRevision } from './rowFieldAction';

import type { ActionTime } from './actionClock';
import type { CommitRequest } from './commits';
import type { RowDetailHistoryEntry, RowDetailObservation, RowDetailPolicy } from './rowDetailAction';
import type { RowFieldTarget } from './rowFieldAction';
import type { DataCommand, DocumentData, FieldChange, FieldValue, ResourceSnapshot } from './types';

export type ServiceOrderStepVersion = { generation: string; observedRevision: number };
type StepCapture<Value> = ServiceOrderStepVersion & { rowId: string; before: Value; after: Value; time: ActionTime | null };
export type ServiceOrderFlagCapture = StepCapture<boolean>;
export type ServiceOrderStepTitleCapture = StepCapture<string>;
export type ServiceOrderStepCapture = { field: 'flagged'; change: ServiceOrderFlagCapture } | { field: 'title'; change: ServiceOrderStepTitleCapture };
type FlagAction = RowDetailObservation<boolean>;
export type ServiceOrderFlagActions = { flagged: FlagAction };
export type ServiceOrderStepTitleActions = { title: RowDetailObservation<string> };
export type ServiceOrderStepHistoryPage<Field extends string, Value extends string | boolean> = {
  owner: string; orderId: string; generation: string; nextCursor: string | null;
  entries: Array<{ id: string; acceptedAt: string; fields: RowDetailHistoryEntry<Field, Value>[] }>;
};

export type ServiceOrderFlagHistoryPage = ServiceOrderStepHistoryPage<'flagged', boolean>;
export type ServiceOrderStepTitleHistoryPage = ServiceOrderStepHistoryPage<'title', string>;

export const SERVICE_ORDER_STEP_TITLE_TARGET: RowFieldTarget<string> = {
  field: 'steps', leaf: 'title', accepts: (value): value is string => typeof value === 'string',
};
export const SERVICE_ORDER_FLAG_TARGET: RowFieldTarget<boolean> = {
  field: 'steps', leaf: 'flagged', missing: false, accepts: (value): value is boolean => typeof value === 'boolean',
};
const STEP_ID: RowFieldTarget<string> = { field: 'steps', leaf: 'id', accepts: boundedRowId };

export function hasServiceOrderStep(rows: unknown, id: string): boolean {
  return existingRowField(rows, id, STEP_ID) === id;
}

export const SERVICE_ORDER_FLAG_POLICY: RowDetailPolicy<'flagged', boolean> = {
  collection: 'serviceOrders', fields: ['flagged'], birth: STEP_ID, target: () => SERVICE_ORDER_FLAG_TARGET,
  proofs: 'serviceOrderFlagProofs', actions: 'serviceOrderFlagActions', history: '_stepFlagHistory', allowUnclocked: true,
};

export const SERVICE_ORDER_STEP_TITLE_POLICY: RowDetailPolicy<'title', string> = {
  collection: 'serviceOrders', fields: ['title'], birth: STEP_ID, target: () => SERVICE_ORDER_STEP_TITLE_TARGET,
  proofs: 'serviceOrderStepTitleProofs', actions: 'serviceOrderStepTitleActions', history: '_stepTitleHistory', allowUnclocked: true,
};

export function serviceOrderStepField(path: readonly string[] | undefined): { id: string; field: 'flagged' | 'title' } | undefined {
  if (path?.length !== 3 || path[0] !== 'steps' || !path[1].startsWith('id:') || (path[2] !== 'flagged' && path[2] !== 'title')) return undefined;
  const id = path[1].slice(3);
  return boundedRowId(id) ? { id, field: path[2] } : undefined;
}

function captureStepField<Field extends 'flagged' | 'title', Value extends string | boolean>(baseline: ResourceSnapshot,
  predecessor: CommitRequest | undefined, draft: DocumentData | null, capture: StepCapture<Value> | undefined, records: readonly CommitRequest[],
  field: Field, policy: RowDetailPolicy<Field, Value>, actionFor: (request: CommitRequest) => RowDetailObservation<Value> | undefined):
  RowDetailObservation<Value> | undefined {
  if (!capture || baseline.resource.collection !== policy.collection || !baseline.metadata || baseline.metadata.deleted
    || capture.generation !== baseline.metadata.generation || !proofRevision(capture.observedRevision)
    || capture.observedRevision > baseline.metadata.revision || !boundedRowId(capture.rowId)) return undefined;
  const { rowId, before, after, observedRevision } = capture;
  const target = policy.target(field);
  const time = capture.time === null ? null : boundedActionTime(capture.time);
  if (time === undefined || !target.accepts(before) || !target.accepts(after) || before === after) return undefined;
  const ancestor = predecessor ? predecessor.value : baseline.value;
  if (existingRowField(ancestor?.steps, rowId, target) === undefined || existingRowField(draft?.steps, rowId, target) !== after) return undefined;
  // An already matching stored value may hide a concurrent action. Retain the rendered before.
  const byId = new Map(records.map(request => [request.id, request]));
  const predecessorOperationId = knownRowDetailPredecessor(predecessor, byId, baseline, policy, request => {
    const action = actionFor(request);
    if (action?.rowId === rowId) return action;
    const opening = request.predecessor ? byId.get(request.predecessor)?.value : request.baseline.value;
    return existingRowField(opening?.steps, rowId, STEP_ID) === undefined && existingRowField(request.value?.steps, rowId, STEP_ID) === rowId
      ? { rowId, rowCreatedAt: rowId, after: before } : undefined;
  }, field, rowId, rowId, before, undefined);
  return { rowId, rowCreatedAt: rowId, before, after, observedRevision, time, ...(predecessorOperationId && { predecessorOperationId }) };
}

export function captureServiceOrderStep(baseline: ResourceSnapshot, predecessor: CommitRequest | undefined,
  draft: DocumentData | null, capture: ServiceOrderStepCapture | undefined, records: readonly CommitRequest[]) {
  if (capture?.field === 'flagged') {
    const flagged = captureStepField(baseline, predecessor, draft, capture.change, records, 'flagged', SERVICE_ORDER_FLAG_POLICY,
      request => request.serviceOrderFlagActions?.flagged);
    if (flagged) return { serviceOrderFlagActions: { flagged } };
  }
  if (capture?.field === 'title') {
    const title = captureStepField(baseline, predecessor, draft, capture.change, records, 'title', SERVICE_ORDER_STEP_TITLE_POLICY,
      request => request.serviceOrderStepTitleActions?.title);
    if (title) return { serviceOrderStepTitleActions: { title } };
  }
}

export function matchesServiceOrderStep<Value extends string | boolean>(changes: FieldChange[], target: RowFieldTarget<Value>,
  action?: RowDetailObservation<Value>): boolean {
  return Boolean(action && matchesRowDetailBirth(changes, action, STEP_ID) && matchesRowAction(changes, action, target));
}

/** The unchecked checkbox is the same when a legacy row omits it or stores false. */
export function alignServiceOrderFlagRepresentation(command: DataCommand, current: ResourceSnapshot): DataCommand {
  if (command.kind !== 'update' || command.resource.collection !== SERVICE_ORDER_FLAG_POLICY.collection) return command;
  const rowId = command.serviceOrderFlagActions?.flagged?.rowId;
  const rows = current.value?.steps;
  if (!boundedRowId(rowId) || !Array.isArray(rows) || existingRowField(rows, rowId, SERVICE_ORDER_FLAG_TARGET) !== false) return command;
  const stored = rows.find(row => object(row) && row.id === rowId);
  if (!object(stored)) return command;
  const field = readField(stored, ['flagged']);
  const align = (side: FieldValue): FieldValue => {
    if (!Array.isArray(side.value) || existingRowField(side.value, rowId, SERVICE_ORDER_FLAG_TARGET) !== false) return side;
    return { ...side, value: side.value.map(row => {
      if (!object(row) || row.id !== rowId || readField(row, ['flagged']).exists === field.exists) return row;
      const next = { ...row };
      if (field.exists) next.flagged = false;
      else delete next.flagged;
      return next;
    }) };
  };
  return { ...command, changes: command.changes.map(change => isRowChange(change, SERVICE_ORDER_FLAG_TARGET)
    ? { ...change, before: align(change.before), after: align(change.after) } : change) };
}
