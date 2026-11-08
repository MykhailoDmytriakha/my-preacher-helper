import { equalValues, object, own, readField } from './fieldValues';
import { replacedRowDetail, rowDetailConflict } from './rowDetailAction';
import { captureRowDetailActions, type RowDetailCaptures } from './rowDetailCapture';
import { boundedRowId, existingRowField, existingRowFields, isCapturedRowConflict, replaceExistingRowField, rowConflictPath } from './rowFieldAction';

import type { ActionTime } from './actionClock';
import type { CommitRequest } from './commits';
import type { RowDetailActions, RowDetailHistoryEntry, RowDetailPolicy } from './rowDetailAction';
import type { RowFieldTarget, RowValue } from './rowFieldAction';
import type { ConflictDetail, DocumentData, ResourceSnapshot } from './types';

export const PREACH_DATE_FIELDS = ['audience', 'churchCity', 'church'] as const;
export type PreachDateField = typeof PREACH_DATE_FIELDS[number];
export type PreachDateFieldActions = RowDetailActions<PreachDateField, RowValue>;
export type PreachDateFieldHistoryEntry = RowDetailHistoryEntry<PreachDateField, RowValue>;
export type PreachDateFieldHistoryPage = {
  owner: string; sermonId: string; generation: string; nextCursor: string | null;
  entries: Array<{ id: string; acceptedAt: string; fields: PreachDateFieldHistoryEntry[] }>;
};

type ChurchValue = DocumentData & { id: string; name: string; city?: string };
const short = (value: unknown): value is string => typeof value === 'string' && value.length <= 1024;
const optionalShort = (value: unknown): value is string | null => value === null || short(value);
const isChurchValue = (value: unknown): value is ChurchValue => object(value) && short(value.id) && short(value.name)
  && (!own(value, 'city') || short(value.city)) && Object.keys(value).every(key => ['id', 'name', 'city'].includes(key));

export const PREACH_ROW_BIRTH: RowFieldTarget<string> = {
  field: 'preachDates', leaf: 'createdAt',
  accepts: (value): value is string => typeof value === 'string' && value.length > 0,
};

const CHURCH: RowFieldTarget<ChurchValue> = { field: 'preachDates', leaf: 'church', accepts: isChurchValue };
const AUDIENCE: RowFieldTarget<string | null> = { field: 'preachDates', leaf: 'audience', missing: null, accepts: optionalShort };
const CITY: RowFieldTarget<string | null> = { field: 'preachDates', leaf: ['church', 'city'], missing: null, accepts: optionalShort };

export const churchIdentity = (value: RowValue | undefined): DocumentData | undefined => isChurchValue(value)
  ? { id: value.id, name: value.name } : undefined;

export function preachDateFieldTarget(field: PreachDateField): RowFieldTarget<RowValue> {
  if (field === 'audience') return AUDIENCE;
  if (field === 'churchCity') return CITY;
  return CHURCH;
}

/** A city belongs to the shown church. A replacement church includes its city as part of the selection. */
export const PREACH_DATE_FIELD_POLICY: RowDetailPolicy<PreachDateField, RowValue> = {
  collection: 'sermons', fields: PREACH_DATE_FIELDS, birth: PREACH_ROW_BIRTH, target: preachDateFieldTarget,
  proofs: 'preachDateFieldProofs', actions: 'preachDateFieldActions', history: '_preachDateFieldHistory',
  scopes: (rows, field) => field === 'churchCity'
    ? new Map([...existingRowFields(rows, CHURCH)].map(([id, church]) => [id, churchIdentity(church)]))
    : undefined,
  needsChoice: (field, before, after, current) => {
    if (field !== 'church') return false;
    const identity = churchIdentity(before);
    return equalValues(identity, churchIdentity(current)) && !equalValues(identity, churchIdentity(after)) && !equalValues(before, current);
  },
};

export type PreachDateFieldInput = { detail: PreachDateField; rowId: string };
export type PreachDateFieldDraft = { rowId: string; rowCreatedAt: string; fields: Partial<Record<PreachDateField, true>> };
export type PreachDateFieldSave = PreachDateFieldDraft & { time: ActionTime };

/** Persist authored fields with the draft. A confirmed manual Save supplies the clock. */
export function stagePreachDateField(previous: PreachDateFieldDraft | undefined, input: PreachDateFieldInput,
  current: DocumentData, next: DocumentData): PreachDateFieldDraft | undefined {
  const { rowId, detail } = input;
  if (!boundedRowId(rowId)) return previous;
  const born = existingRowField(current.preachDates, rowId, PREACH_ROW_BIRTH);
  const target = preachDateFieldTarget(detail);
  const before = existingRowField(current.preachDates, rowId, target), after = existingRowField(next.preachDates, rowId, target);
  if (!born || born !== existingRowField(next.preachDates, rowId, PREACH_ROW_BIRTH)
    || before === undefined || after === undefined || equalValues(before, after)) return previous;
  const fields = previous?.rowId === rowId && previous.rowCreatedAt === born ? previous.fields : {};
  return { rowId, rowCreatedAt: born, fields: { ...fields, [detail]: true } };
}

export function capturePreachDateFields(baseline: ResourceSnapshot, predecessor: CommitRequest | undefined,
  draft: DocumentData | null, saved: PreachDateFieldSave | undefined, records: readonly CommitRequest[]): PreachDateFieldActions | undefined {
  if (!saved || !boundedRowId(saved.rowId)) return undefined;
  const { rowId, rowCreatedAt, fields, time } = saved;
  const beforeRows = (predecessor ? predecessor.value : baseline.value)?.preachDates;
  const afterRows = draft?.preachDates;
  const captures: RowDetailCaptures<PreachDateField, RowValue> = {};
  if (fields?.audience === true) {
    const after = existingRowField(afterRows, rowId, AUDIENCE);
    if (after !== undefined) captures.audience = { rowId, rowCreatedAt, time, after };
  }
  if (fields?.church === true || fields?.churchCity === true) {
    const before = existingRowField(beforeRows, rowId, CHURCH), after = existingRowField(afterRows, rowId, CHURCH);
    if (before && after) {
      if (equalValues(churchIdentity(before), churchIdentity(after))) captures.churchCity = { rowId, rowCreatedAt, time, after: after.city ?? null };
      else if (fields.church === true) captures.church = { rowId, rowCreatedAt, time, after };
    }
  }
  return captureRowDetailActions(baseline, predecessor, draft, captures, records, PREACH_DATE_FIELD_POLICY, request => request.preachDateFieldActions);
}

export function preachDateRebaseChoices(snapshot: ResourceSnapshot, ancestor: DocumentData | null,
  actions: PreachDateFieldActions | undefined): ConflictDetail[] {
  return PREACH_DATE_FIELDS.flatMap(field => {
    const action = actions?.[field];
    if (!action) return [];
    const target = preachDateFieldTarget(field);
    const replacement = replacedRowDetail(snapshot, action, target, PREACH_ROW_BIRTH);
    if (replacement) return [replacement];
    const rows = snapshot.value?.preachDates;
    const current = existingRowField(rows, action.rowId, target);
    if (current === undefined || equalValues(current, action.after)) return [];
    const scopes = PREACH_DATE_FIELD_POLICY.scopes!;
    const changedChurch = !equalValues(scopes(ancestor?.preachDates, field)?.get(action.rowId), scopes(rows, field)?.get(action.rowId));
    return changedChurch || PREACH_DATE_FIELD_POLICY.needsChoice?.(field, action.before, action.after, current)
      ? [rowDetailConflict(action, target, current)] : [];
  });
}

export function isCapturedPreachDateFieldConflict(conflict: ConflictDetail, actions: PreachDateFieldActions | undefined): boolean {
  return PREACH_DATE_FIELDS.some(field => {
    const action = actions?.[field];
    if (!action) return false;
    const target = preachDateFieldTarget(field);
    if (isCapturedRowConflict(conflict, action, target)) return true;
    if (field !== 'church' || !isChurchValue(action.before) || !isChurchValue(action.after)) return false;
    const root = rowConflictPath(action.rowId, target);
    const leaf = conflict.path[root.length];
    return conflict.path.length === root.length + 1 && root.every((part, index) => conflict.path[index] === part)
      && ['id', 'name', 'city'].includes(leaf) && equalValues(readField(action.before, [leaf]), conflict.base)
      && equalValues(readField(action.after, [leaf]), conflict.mine);
  });
}

/** A fully authored church is indivisible, even if the ordinary object merge kept an unseen city. */
export function retainAuthoredChurch(intended: DocumentData | null, snapshot: ResourceSnapshot,
  actions: PreachDateFieldActions | undefined): DocumentData | null {
  const action = actions?.church;
  if (!intended || !action || !isChurchValue(action.after)
    || existingRowField(snapshot.value?.preachDates, action.rowId, PREACH_ROW_BIRTH) !== action.rowCreatedAt
    || existingRowField(intended.preachDates, action.rowId, PREACH_ROW_BIRTH) !== action.rowCreatedAt) return intended;
  const rows = replaceExistingRowField(intended.preachDates, action.rowId, action.after, CHURCH);
  return rows === undefined ? intended : { ...intended, preachDates: rows };
}
