import { matchesRowDetailBirth } from './rowDetailAction';
import { captureSeenRowDetail } from './rowDetailCapture';
import { alignOptionalRowField, boundedRowId, existingRowField, matchesRowAction } from './rowFieldAction';

import type { CommitRequest } from './commits';
import type { RowDetailHistoryEntry, RowDetailObservation, RowDetailPolicy } from './rowDetailAction';
import type { SeenRowDetail } from './rowDetailCapture';
import type { RowFieldTarget } from './rowFieldAction';
import type { DataCommand, DocumentData, FieldChange, ResourceSnapshot, ServiceOrderStepPlacementCapture } from './types';

export type ServiceOrderStepVersion = { generation: string; observedRevision: number };
export type ServiceOrderFlagCapture = SeenRowDetail<boolean>;
export type ServiceOrderStepTitleCapture = SeenRowDetail<string>;
export type ServiceOrderStepCapture =
  | { field: 'flagged'; change: ServiceOrderFlagCapture }
  | { field: 'title'; change: ServiceOrderStepTitleCapture }
  | { field: 'placement'; change: ServiceOrderStepPlacementCapture };
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

export function captureServiceOrderStep(baseline: ResourceSnapshot, predecessor: CommitRequest | undefined,
  draft: DocumentData | null, capture: ServiceOrderStepCapture | undefined, records: readonly CommitRequest[]) {
  if (capture?.field === 'flagged') {
    const flagged = captureSeenRowDetail(baseline, predecessor, draft, capture.change, records, 'flagged', SERVICE_ORDER_FLAG_POLICY,
      request => request.serviceOrderFlagActions?.flagged);
    if (flagged) return { serviceOrderFlagActions: { flagged } };
  }
  if (capture?.field === 'title') {
    const title = captureSeenRowDetail(baseline, predecessor, draft, capture.change, records, 'title', SERVICE_ORDER_STEP_TITLE_POLICY,
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
  return alignOptionalRowField(command, current, SERVICE_ORDER_FLAG_TARGET, command.serviceOrderFlagActions?.flagged?.rowId);
}
