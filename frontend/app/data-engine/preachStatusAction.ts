import { boundedActionTime } from './actionClock';
import { object } from './fieldValues';
import { PREACH_ROW_BIRTH } from './preachDateFieldAction';
import { matchesRowDetailBirth, replacedRowDetail } from './rowDetailAction';
import { knownRowDetailPredecessor } from './rowDetailCapture';
import { boundedRowId, existingRowField, existingRowFields, isCapturedRowConflict, isRowChange, matchesRowAction, replaceExistingRowField } from './rowFieldAction';

import type { ActionTime } from './actionClock';
import type { CommitRequest } from './commits';
import type { RowDetailObservation, RowDetailHistoryEntry, RowDetailPolicy } from './rowDetailAction';
import type { RowFieldTarget } from './rowFieldAction';
import type { ConflictDetail, DataCommand, DocumentData, FieldChange, Json, ResourceSnapshot } from './types';
import type { PreachDateStatus } from '@/models/models';

export type PreachStatusValue = PreachDateStatus | null;
export type PreachStatusAction = RowDetailObservation<PreachStatusValue>;
export type PreachStatusIntent = { status: PreachDateStatus; rowId: string } | { status: 'planned'; rowId?: never };
export type PreachStatusSave = PreachStatusIntent & { time: ActionTime | null };
export type PreachStatusCapture = PreachStatusSave & { rows: Array<{ rowId: string; rowCreatedAt: string }> };
export type PreachStatusHistoryEntry = RowDetailHistoryEntry<'status', PreachStatusValue>;
export type PreachStatusHistoryPage = {
  owner: string; sermonId: string; generation: string; nextCursor: string | null;
  entries: Array<{ id: string; acceptedAt: string; fields: PreachStatusHistoryEntry[] }>;
};

export const PREACH_STATUS_TARGET: RowFieldTarget<PreachStatusValue> = {
  field: 'preachDates', leaf: 'status', missing: null,
  accepts: (value): value is PreachStatusValue => value === null || value === 'planned' || value === 'preached',
};

export const PREACH_STATUS_POLICY: RowDetailPolicy<'status', PreachStatusValue> = {
  collection: 'sermons', fields: ['status'], repeatedFields: ['status'], allowUnclocked: true,
  allowUnchanged: (_field, value) => value === 'planned', validAfter: (_field, value) => value !== null,
  birth: PREACH_ROW_BIRTH, target: () => PREACH_STATUS_TARGET,
  proofs: 'preachStatusProofs', actions: 'preachStatusActions', history: '_preachStatusHistory',
};


export function capturePreachStatusOpening(openingRows: unknown, save: PreachStatusSave): PreachStatusCapture {
  const births = existingRowFields(openingRows, PREACH_ROW_BIRTH);
  const rows = [...births].flatMap(([rowId, rowCreatedAt]) =>
    rowCreatedAt && boundedRowId(rowId) && (save.rowId === undefined || rowId === save.rowId) ? [{ rowId, rowCreatedAt }] : []);
  return { ...save, rows };
}

export function capturePreachStatusActions(baseline: ResourceSnapshot, predecessor: CommitRequest | undefined,
  draft: DocumentData | null, capture: PreachStatusCapture | undefined, records: readonly CommitRequest[]): PreachStatusAction[] | undefined {
  if (!capture || baseline.resource.collection !== 'sermons' || !baseline.metadata || baseline.metadata.deleted) return undefined;
  const time = capture.time === null ? null : boundedActionTime(capture.time);
  if (time === undefined) return undefined;
  const { revision: observedRevision } = baseline.metadata;
  const prior = (predecessor ? predecessor.value : baseline.value)?.preachDates;
  const next = draft?.preachDates;
  const priorBirths = existingRowFields(prior, PREACH_ROW_BIRTH), nextBirths = existingRowFields(next, PREACH_ROW_BIRTH);
  const priorStatuses = existingRowFields(prior, PREACH_STATUS_TARGET), nextStatuses = existingRowFields(next, PREACH_STATUS_TARGET);
  const requests = new Map(records.map(request => [request.id, request]));
  const actions = capture.rows.flatMap(({ rowId, rowCreatedAt }) => {
    const before = priorStatuses.get(rowId), after = nextStatuses.get(rowId);
    if (!rowCreatedAt || priorBirths.get(rowId) !== rowCreatedAt || nextBirths.get(rowId) !== rowCreatedAt
      || before === undefined || after !== capture.status || (before === after && capture.rowId !== undefined)) return [];
    const predecessorOperationId = knownRowDetailPredecessor(predecessor, requests, baseline, PREACH_STATUS_POLICY,
      request => {
        const action = request.preachStatusActions?.find(item => item.rowId === rowId);
        if (action) return action;
        const opening = request.predecessor ? requests.get(request.predecessor)?.value : request.baseline.value;
        const rows = opening?.preachDates;
        // The chain can also start at the Save that added this exact row.
        if (opening === undefined || (rows !== undefined && !Array.isArray(rows))
          || (Array.isArray(rows) && rows.some(row => object(row) && row.id === rowId))) return undefined;
        return { rowId, rowCreatedAt, after: before };
      }, 'status', rowId, rowCreatedAt, before, undefined);
    return [{ rowId, rowCreatedAt, before, after, observedRevision, time, ...(predecessorOperationId && { predecessorOperationId }) }];
  });
  return actions.length ? actions : undefined;
}

export function pendingPreachStatusActions(record: CommitRequest): PreachStatusAction[] {
  if (record.sequence !== 0 || !record.preachStatusActions
    || record.working.metadata?.generation !== record.baseline.metadata?.generation) return [];
  const working = record.working.value?.preachDates, intended = record.intended?.preachDates;
  return record.preachStatusActions.filter(action => existingRowField(working, action.rowId, PREACH_STATUS_TARGET) !== undefined
    && existingRowField(working, action.rowId, PREACH_ROW_BIRTH) === action.rowCreatedAt
    && existingRowField(intended, action.rowId, PREACH_ROW_BIRTH) === action.rowCreatedAt
    && existingRowField(intended, action.rowId, PREACH_STATUS_TARGET) === action.after);
}

export function replacePreachStatuses(value: DocumentData, actions: readonly PreachStatusAction[], side: 'before' | 'after'): DocumentData {
  if (!actions.length) return value;
  const rows = actions.reduce<Json | undefined>((current, action) =>
    replaceExistingRowField(current, action.rowId, action[side], PREACH_STATUS_TARGET), value.preachDates);
  return rows === undefined ? value : { ...value, preachDates: rows };
}

export function matchingPreachStatusActions(changes: FieldChange[], actions: readonly PreachStatusAction[]): PreachStatusAction[] {
  return actions.filter(action => matchesRowDetailBirth(changes, action, PREACH_ROW_BIRTH)
    && matchesRowAction(changes, action, PREACH_STATUS_TARGET));
}

export function replacedPreachStatusRows(snapshot: ResourceSnapshot, actions: readonly PreachStatusAction[] | undefined): ConflictDetail[] {
  return (actions ?? []).flatMap(action => replacedRowDetail(snapshot, action, PREACH_STATUS_TARGET, PREACH_ROW_BIRTH) ?? []);
}


export function isCapturedPreachStatusConflict(conflict: ConflictDetail, actions: readonly PreachStatusAction[] | undefined): boolean {
  return Boolean(actions?.some(action => isCapturedRowConflict(conflict, action, PREACH_STATUS_TARGET)));
}

export function retainPreachStatusIntent(intended: DocumentData | null, snapshot: ResourceSnapshot,
  actions: readonly PreachStatusAction[] | undefined): DocumentData | null {
  if (!intended || !actions?.length) return intended;
  const currentBirths = existingRowFields(snapshot.value?.preachDates, PREACH_ROW_BIRTH);
  const intendedBirths = existingRowFields(intended.preachDates, PREACH_ROW_BIRTH);
  return replacePreachStatuses(intended, actions.filter(action => currentBirths.get(action.rowId) === action.rowCreatedAt
    && intendedBirths.get(action.rowId) === action.rowCreatedAt), 'after');
}

/** Keep a sibling's current explicit status over the form's legacy materialization. */
export function alignImplicitPreachStatuses(before: Json | undefined, after: Json | undefined, current: Json | undefined,
  actions: readonly PreachStatusAction[] | undefined): Json | undefined {
  if (!actions?.length) return after;
  const explicit = new Set(actions.map(action => action.rowId));
  const beforeBirths = existingRowFields(before, PREACH_ROW_BIRTH);
  const afterBirths = existingRowFields(after, PREACH_ROW_BIRTH);
  const currentBirths = existingRowFields(current, PREACH_ROW_BIRTH);
  const currentStatuses = existingRowFields(current, PREACH_STATUS_TARGET);
  const beforeStatuses = existingRowFields(before, PREACH_STATUS_TARGET);
  const afterStatuses = existingRowFields(after, PREACH_STATUS_TARGET);
  return [...beforeStatuses].reduce((rows, [id, status]) => {
    const born = beforeBirths.get(id);
    const authored = afterStatuses.get(id);
    if (explicit.has(id) || status !== null || !authored || !born || born !== afterBirths.get(id)) return rows;
    const accepted = born === currentBirths.get(id) ? currentStatuses.get(id) ?? authored : null;
    return accepted === authored ? rows : replaceExistingRowField(rows, id, accepted, PREACH_STATUS_TARGET);
  }, after);
}

export function alignPreachStatusCommand(command: DataCommand, current: ResourceSnapshot): DataCommand {
  if (command.kind !== 'update' || command.resource.collection !== 'sermons' || command.generation !== current.metadata?.generation
    || !Array.isArray(command.preachStatusActions)) return command;
  const actions = matchingPreachStatusActions(command.changes, command.preachStatusActions.filter(action =>
    object(action) && boundedRowId(action.rowId) && PREACH_ROW_BIRTH.accepts(action.rowCreatedAt)
      && PREACH_STATUS_TARGET.accepts(action.before) && (action.after === 'planned' || action.after === 'preached')));
  if (!actions.length) return command;
  return { ...command, changes: command.changes.map(change => {
    if (!isRowChange(change, PREACH_STATUS_TARGET)) return change;
    const value = alignImplicitPreachStatuses(change.before.value, change.after.value, current.value?.preachDates, actions);
    return value === undefined ? change : { ...change, after: { exists: true, value } };
  }) };
}
