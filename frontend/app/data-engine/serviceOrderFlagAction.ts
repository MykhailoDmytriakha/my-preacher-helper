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

export type ServiceOrderFlagVersion = { generation: string; observedRevision: number };
export type ServiceOrderFlagCapture = ServiceOrderFlagVersion & { rowId: string; before: boolean; after: boolean; time: ActionTime | null };
type FlagAction = RowDetailObservation<boolean>;
export type ServiceOrderFlagActions = { flagged: FlagAction };
export type ServiceOrderFlagHistoryPage = {
  owner: string; orderId: string; generation: string; nextCursor: string | null;
  entries: Array<{ id: string; acceptedAt: string; fields: RowDetailHistoryEntry<'flagged', boolean>[] }>;
};

export const SERVICE_ORDER_FLAG_TARGET: RowFieldTarget<boolean> = {
  field: 'steps', leaf: 'flagged', missing: false, accepts: (value): value is boolean => typeof value === 'boolean',
};
const STEP_ID: RowFieldTarget<string> = { field: 'steps', leaf: 'id', accepts: boundedRowId };

export const SERVICE_ORDER_FLAG_POLICY: RowDetailPolicy<'flagged', boolean> = {
  collection: 'serviceOrders', fields: ['flagged'], birth: STEP_ID, target: () => SERVICE_ORDER_FLAG_TARGET,
  proofs: 'serviceOrderFlagProofs', actions: 'serviceOrderFlagActions', history: '_stepFlagHistory', allowUnclocked: true,
};

export function serviceOrderFlagRow(path: readonly string[] | undefined): string | undefined {
  if (path?.length !== 3 || path[0] !== 'steps' || !path[1].startsWith('id:') || path[2] !== 'flagged') return undefined;
  const rowId = path[1].slice(3);
  return boundedRowId(rowId) ? rowId : undefined;
}

export function captureServiceOrderFlag(baseline: ResourceSnapshot, predecessor: CommitRequest | undefined,
  draft: DocumentData | null, capture: ServiceOrderFlagCapture | undefined, records: readonly CommitRequest[]): ServiceOrderFlagActions | undefined {
  if (!capture || baseline.resource.collection !== SERVICE_ORDER_FLAG_POLICY.collection || !baseline.metadata || baseline.metadata.deleted
    || capture.generation !== baseline.metadata.generation || !proofRevision(capture.observedRevision)
    || capture.observedRevision > baseline.metadata.revision || !boundedRowId(capture.rowId)) return undefined;
  const { rowId, before, after, observedRevision } = capture;
  const time = capture.time === null ? null : boundedActionTime(capture.time);
  if (time === undefined || typeof before !== 'boolean' || typeof after !== 'boolean' || before === after) return undefined;
  const ancestor = predecessor ? predecessor.value : baseline.value;
  const prior = existingRowField(ancestor?.steps, rowId, SERVICE_ORDER_FLAG_TARGET);
  if (prior === undefined || existingRowField(draft?.steps, rowId, SERVICE_ORDER_FLAG_TARGET) !== after) return undefined;
  // An already matching stored value may hide a concurrent action; retain the rendered before.
  const byId = new Map(records.map(request => [request.id, request]));
  const predecessorOperationId = knownRowDetailPredecessor(predecessor, byId, baseline, SERVICE_ORDER_FLAG_POLICY, request => {
    const action = request.serviceOrderFlagActions?.flagged;
    if (action?.rowId === rowId) return action;
    const opening = request.predecessor ? byId.get(request.predecessor)?.value : request.baseline.value;
    return existingRowField(opening?.steps, rowId, STEP_ID) === undefined && existingRowField(request.value?.steps, rowId, STEP_ID) === rowId
      ? { rowId, rowCreatedAt: rowId, after: before } : undefined;
  }, 'flagged', rowId, rowId, before, undefined);
  return { flagged: { rowId, rowCreatedAt: rowId, before, after, observedRevision, time, ...(predecessorOperationId && { predecessorOperationId }) } };
}

export function matchingServiceOrderFlag(changes: FieldChange[], actions?: ServiceOrderFlagActions): ServiceOrderFlagActions | undefined {
  const flag = actions?.flagged;
  return flag && matchesRowDetailBirth(changes, flag, STEP_ID) && matchesRowAction(changes, flag, SERVICE_ORDER_FLAG_TARGET) ? actions : undefined;
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
