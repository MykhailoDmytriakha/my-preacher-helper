import { equalValues } from './fieldValues';
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
export type ServiceOrderStepScriptureCapture = SeenRowDetail<string[]>;
export type ServiceOrderStepCapture =
  | { field: 'flagged'; change: ServiceOrderFlagCapture }
  | { field: 'title'; change: ServiceOrderStepTitleCapture }
  | { field: 'scriptureRefs'; change: ServiceOrderStepScriptureCapture }
  | { field: 'placement'; change: ServiceOrderStepPlacementCapture };
type FlagAction = RowDetailObservation<boolean>;
export type ServiceOrderFlagActions = { flagged: FlagAction };
export type ServiceOrderStepTitleActions = { title: RowDetailObservation<string> };
export type ServiceOrderStepScriptureActions = { scriptureRefs: RowDetailObservation<string[]> };
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
const MAX_ORDERED_REFERENCE_LENGTH = 512;

export function isServiceStepScriptureList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(reference => typeof reference === 'string');
}

export function isSingleServiceStepScripture(value: unknown): value is string[] {
  return isServiceStepScriptureList(value) && value.length <= 1
    && value.every(reference => reference.length > 0 && reference.length <= MAX_ORDERED_REFERENCE_LENGTH);
}

export const SERVICE_ORDER_STEP_SCRIPTURE_LIST: RowFieldTarget<string[]> = {
  field: 'steps', leaf: 'scriptureRefs', missing: [], accepts: isServiceStepScriptureList,
};
export const SERVICE_ORDER_STEP_SCRIPTURE_TARGET = { ...SERVICE_ORDER_STEP_SCRIPTURE_LIST, accepts: isSingleServiceStepScripture };

const STEP_ID: RowFieldTarget<string> = {
  field: 'steps', leaf: 'id', accepts: (value): value is string => typeof value === 'string' && value.length > 0,
};

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

export const SERVICE_ORDER_STEP_SCRIPTURE_POLICY: RowDetailPolicy<'scriptureRefs', string[]> = {
  collection: 'serviceOrders', fields: ['scriptureRefs'], birth: STEP_ID, target: () => SERVICE_ORDER_STEP_SCRIPTURE_TARGET,
  proofs: 'serviceOrderStepScriptureProofs', actions: 'serviceOrderStepScriptureActions', history: '_stepScriptureHistory',
  allowUnclocked: true, atomicChoice: true, rememberOpenings: true,
  // Two additions to an empty list are independent. Keep the ordinary list merge.
  mergesIndependently: (before, after, stored) => !before.length && after.length > 0 && stored.length > 0 && !equalValues(after, stored),
};

export function serviceOrderStepField(path: readonly string[] | undefined): { id: string; field: 'flagged' | 'title' | 'scriptureRefs' } | undefined {
  if (path?.length !== 3 || path[0] !== 'steps' || !path[1].startsWith('id:')
    || (path[2] !== 'flagged' && path[2] !== 'title' && path[2] !== 'scriptureRefs')) return undefined;
  const id = path[1].slice(3);
  return (path[2] === 'scriptureRefs' ? id.length > 0 : boundedRowId(id)) ? { id, field: path[2] } : undefined;
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
  if (capture?.field === 'scriptureRefs') {
    const scriptureRefs = captureSeenRowDetail(baseline, predecessor, draft, capture.change, records, 'scriptureRefs',
      SERVICE_ORDER_STEP_SCRIPTURE_POLICY, request => request.serviceOrderStepScriptureActions?.scriptureRefs);
    if (scriptureRefs) return { serviceOrderStepScriptureActions: { scriptureRefs } };
  }
}

export function matchesServiceOrderStep<Value extends string | boolean | string[]>(changes: FieldChange[], target: RowFieldTarget<Value>,
  action?: RowDetailObservation<Value>): boolean {
  return Boolean(action && matchesRowDetailBirth(changes, action, STEP_ID) && matchesRowAction(changes, action, target));
}

/** Two edits that remove the same reference cannot silently turn competing replacements into additions. */
export function competingServiceStepScripture(base: unknown, mine: unknown, theirs: unknown): boolean {
  if (!isServiceStepScriptureList(base) || !isServiceStepScriptureList(mine) || !isServiceStepScriptureList(theirs)) return false;
  const seen = new Set(base), local = new Set(mine), stored = new Set(theirs);
  if (!base.some(reference => !local.has(reference) && !stored.has(reference))) return false;
  return mine.some(reference => !seen.has(reference) && !stored.has(reference))
    || theirs.some(reference => !seen.has(reference) && !local.has(reference));
}

/** The unchecked checkbox is the same when a legacy row omits it or stores false. */
export function alignServiceOrderFlagRepresentation(command: DataCommand, current: ResourceSnapshot): DataCommand {
  if (command.kind !== 'update' || command.resource.collection !== SERVICE_ORDER_FLAG_POLICY.collection) return command;
  return alignOptionalRowField(command, current, SERVICE_ORDER_FLAG_TARGET, command.serviceOrderFlagActions?.flagged?.rowId);
}
