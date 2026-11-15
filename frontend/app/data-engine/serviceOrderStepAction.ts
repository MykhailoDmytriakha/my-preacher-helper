import { isAuthoredStringList } from './authoredStringList';
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
export type ServiceOrderStepBodyCapture = SeenRowDetail<string>;
export type ServiceOrderStepScriptureCapture = SeenRowDetail<string[]>;
export type ServiceOrderStepCapture =
  | { field: 'flagged'; change: ServiceOrderFlagCapture }
  | { field: 'title' | 'body'; change: SeenRowDetail<string> }
  | { field: 'scriptureRefs'; change: ServiceOrderStepScriptureCapture }
  | { field: 'scriptureReview'; changes: readonly ServiceOrderStepScriptureCapture[] }
  | { field: 'placement'; change: ServiceOrderStepPlacementCapture };
type FlagAction = RowDetailObservation<boolean>;
export type ServiceOrderFlagActions = { flagged: FlagAction };
export type ServiceOrderStepTitleActions = { title: RowDetailObservation<string> };
export type ServiceOrderStepBodyActions = { body: RowDetailObservation<string> };
export type ServiceOrderStepScriptureActions = {
  scriptureRefs?: RowDetailObservation<string[]>;
  reviewed?: RowDetailObservation<string[]>[];
};
export type ServiceOrderStepHistoryPage<Field extends string, Value extends string | boolean> = {
  owner: string; orderId: string; generation: string; nextCursor: string | null;
  entries: Array<{ id: string; acceptedAt: string; fields: RowDetailHistoryEntry<Field, Value>[] }>;
};

export type ServiceOrderFlagHistoryPage = ServiceOrderStepHistoryPage<'flagged', boolean>;
export type ServiceOrderStepTitleHistoryPage = ServiceOrderStepHistoryPage<'title', string>;

export const SERVICE_ORDER_STEP_TITLE_TARGET: RowFieldTarget<string> = {
  field: 'steps', leaf: 'title', accepts: (value): value is string => typeof value === 'string',
};
export const SERVICE_ORDER_STEP_BODY_TARGET: RowFieldTarget<string> = {
  field: 'steps', leaf: 'body', missing: '', accepts: (value): value is string => typeof value === 'string',
};
export const SERVICE_ORDER_FLAG_TARGET: RowFieldTarget<boolean> = {
  field: 'steps', leaf: 'flagged', missing: false, accepts: (value): value is boolean => typeof value === 'boolean',
};
const MAX_ORDERED_REFERENCE_LENGTH = 512;

export function isSingleServiceStepScripture(value: unknown): value is string[] {
  return isAuthoredStringList(value) && value.length <= 1
    && value.every(reference => reference.length > 0 && reference.length <= MAX_ORDERED_REFERENCE_LENGTH);
}

export const SERVICE_ORDER_STEP_SCRIPTURE_LIST: RowFieldTarget<string[]> = {
  field: 'steps', leaf: 'scriptureRefs', missing: [], accepts: isAuthoredStringList,
};
export const SERVICE_ORDER_STEP_SCRIPTURE_TARGET = { ...SERVICE_ORDER_STEP_SCRIPTURE_LIST, accepts: isSingleServiceStepScripture };

export const acceptsServiceOrderStepId = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const STEP_ID: RowFieldTarget<string> = { field: 'steps', leaf: 'id', accepts: acceptsServiceOrderStepId };

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

export const SERVICE_ORDER_STEP_BODY_POLICY: RowDetailPolicy<'body', string> = {
  collection: 'serviceOrders', fields: ['body'], birth: STEP_ID, target: () => SERVICE_ORDER_STEP_BODY_TARGET,
  proofs: 'serviceOrderStepBodyProofs', actions: 'serviceOrderStepBodyActions', history: '_stepBodyHistory',
  repeatedFields: ['body'], allowUnclocked: true, atomicChoice: true, rememberOpenings: true, seedOpeningFromStoredValue: true,
};

export const SERVICE_ORDER_STEP_SCRIPTURE_POLICY: RowDetailPolicy<'scriptureRefs', string[]> = {
  collection: 'serviceOrders', fields: ['scriptureRefs'], birth: STEP_ID, target: () => SERVICE_ORDER_STEP_SCRIPTURE_TARGET,
  proofs: 'serviceOrderStepScriptureProofs', actions: 'serviceOrderStepScriptureActions', history: '_stepScriptureHistory',
  allowUnclocked: true, atomicChoice: true, rememberOpenings: true,
  // Two additions to an empty list are independent. Keep the ordinary list merge.
  mergesIndependently: (before, after, stored) => !before.length && after.length > 0 && stored.length > 0 && !equalValues(after, stored),
};

export function serviceOrderStepField(path: readonly string[] | undefined): { id: string; field: 'flagged' | 'title' | 'body' | 'scriptureRefs' } | undefined {
  if (path?.length !== 3 || path[0] !== 'steps' || !path[1].startsWith('id:')
    || (path[2] !== 'flagged' && path[2] !== 'title' && path[2] !== 'body' && path[2] !== 'scriptureRefs')) return undefined;
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
  if (capture?.field === 'body') {
    const body = captureSeenRowDetail(baseline, predecessor, draft, capture.change, records, 'body', SERVICE_ORDER_STEP_BODY_POLICY,
      request => request.serviceOrderStepBodyActions?.body);
    if (body) return { serviceOrderStepBodyActions: { body } };
  }
  if (capture?.field === 'scriptureRefs' || capture?.field === 'scriptureReview') {
    const captureScripture = (change: ServiceOrderStepScriptureCapture) =>
      captureSeenRowDetail(baseline, predecessor, draft, change, records, 'scriptureRefs',
        { ...SERVICE_ORDER_STEP_SCRIPTURE_POLICY, target: () => SERVICE_ORDER_STEP_SCRIPTURE_LIST },
        request => request.serviceOrderStepScriptureActions?.reviewed?.find(action => action.rowId === change.rowId)
          ?? request.serviceOrderStepScriptureActions?.scriptureRefs, acceptsServiceOrderStepId);
    if (capture.field === 'scriptureRefs') {
      const scriptureRefs = captureScripture(capture.change);
      if (scriptureRefs) return { serviceOrderStepScriptureActions: { scriptureRefs } };
    } else {
      const reviewed = capture.changes.flatMap(change => captureScripture(change) ?? []);
      if (reviewed.length) return { serviceOrderStepScriptureActions: { reviewed } };
    }
  }
}

export function matchesServiceOrderStep<Value extends string | boolean | string[]>(changes: FieldChange[], target: RowFieldTarget<Value>,
  action?: RowDetailObservation<Value>): boolean {
  return Boolean(action && matchesRowDetailBirth(changes, action, STEP_ID) && matchesRowAction(changes, action, target));
}

/** The unchecked checkbox is the same when a legacy row omits it or stores false. */
export function alignServiceOrderFlagRepresentation(command: DataCommand, current: ResourceSnapshot): DataCommand {
  if (command.kind !== 'update' || command.resource.collection !== SERVICE_ORDER_FLAG_POLICY.collection) return command;
  return alignOptionalRowField(command, current, SERVICE_ORDER_FLAG_TARGET, command.serviceOrderFlagActions?.flagged?.rowId);
}
