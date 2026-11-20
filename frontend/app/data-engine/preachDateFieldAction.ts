import { isChurchValue, type ChurchValue } from './churchFieldValue';
import { equalValues, object, readField } from './fieldValues';
import { replacedRowDetail, rowDetailConflict } from './rowDetailAction';
import { captureRowDetailActions, type RowDetailCaptures } from './rowDetailCapture';
import { boundedRowId, existingRowField, existingRowFields, isCapturedRowConflict, replaceExistingRowField, rowConflictPath } from './rowFieldAction';

import type { ActionTime } from './actionClock';
import type { CommitRequest } from './commits';
import type { RowDetailActions, RowDetailHistoryEntry, RowDetailPolicy, RowTextStamp } from './rowDetailAction';
import type { RowFieldTarget } from './rowFieldAction';
import type { ConflictDetail, DataCommand, DocumentData, Json, ResourceSnapshot } from './types';

export const PREACH_DATE_FIELDS = ['audience', 'churchCity', 'church', 'notes'] as const;
export type PreachDateField = typeof PREACH_DATE_FIELDS[number];
export type PreachDateFieldValue = string | null | ChurchValue;
export type PreachDateFieldActions = RowDetailActions<PreachDateField, PreachDateFieldValue, ActionTime | null>;
export type PreachDateFieldWire = Omit<PreachDateFieldActions, 'notes'> & { notes?: RowTextStamp };
type PreachDateNotesHistory = Omit<RowDetailHistoryEntry<'notes', string | null>, 'winnerValue'>;
export type PreachDateFieldHistoryEntry = RowDetailHistoryEntry<Exclude<PreachDateField, 'notes'>, PreachDateFieldValue> | PreachDateNotesHistory;
export type PreachDateFieldHistoryPage = {
  owner: string; sermonId: string; generation: string; nextCursor: string | null;
  entries: Array<{ id: string; acceptedAt: string; fields: PreachDateFieldHistoryEntry[] }>;
};

const short = (value: unknown): value is string => typeof value === 'string' && value.length <= 1024;
const optionalShort = (value: unknown): value is string | null => value === null || short(value);

export const PREACH_ROW_BIRTH: RowFieldTarget<string> = {
  field: 'preachDates', leaf: 'createdAt',
  accepts: (value): value is string => typeof value === 'string' && value.length > 0,
};

const CHURCH: RowFieldTarget<ChurchValue> = { field: 'preachDates', leaf: 'church', accepts: isChurchValue };
const NOTES: RowFieldTarget<string | null> = { field: 'preachDates', leaf: 'notes', missing: null,
  accepts: (value): value is string | null => value === null || typeof value === 'string' };
const AUDIENCE: RowFieldTarget<string | null> = { field: 'preachDates', leaf: 'audience', missing: null, accepts: optionalShort };
const CITY: RowFieldTarget<string | null> = { field: 'preachDates', leaf: ['church', 'city'], missing: null, accepts: optionalShort };

export const churchIdentity = (value: PreachDateFieldValue | undefined): DocumentData | undefined => isChurchValue(value)
  ? { id: value.id, name: value.name } : undefined;

export function preachDateFieldTarget(field: PreachDateField): RowFieldTarget<PreachDateFieldValue> {
  if (field === 'audience') return AUDIENCE;
  if (field === 'notes') return NOTES;
  if (field === 'churchCity') return CITY;
  return CHURCH;
}

/** A city belongs to the shown church. A replacement church includes its city as part of the selection. */
export const PREACH_DATE_FIELD_POLICY: RowDetailPolicy<PreachDateField, PreachDateFieldValue> = {
  collection: 'sermons', fields: PREACH_DATE_FIELDS, birth: PREACH_ROW_BIRTH, target: preachDateFieldTarget,
  proofs: 'preachDateFieldProofs', actions: 'preachDateFieldActions', history: '_preachDateFieldHistory', allowUnclocked: true,
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
export type PreachDateFieldSave = PreachDateFieldDraft & { time: ActionTime | null };

/** Persist authored fields with the draft. A confirmed manual Save supplies the available action time. */
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
  const captures: RowDetailCaptures<PreachDateField, PreachDateFieldValue, ActionTime | null> = {};
  if (fields?.audience === true) {
    const after = existingRowField(afterRows, rowId, AUDIENCE);
    if (after !== undefined) captures.audience = { rowId, rowCreatedAt, time, after };
  }
  if (fields?.notes === true) {
    const after = existingRowField(afterRows, rowId, NOTES);
    if (after !== undefined) captures.notes = { rowId, rowCreatedAt, time, after };
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

/** The keyed row change already carries the two values, so the wire only needs the observation. */
export function compactPreachDateFields({ notes, ...fields }: PreachDateFieldActions): PreachDateFieldWire {
  if (!notes) return fields;
  const { rowId, rowCreatedAt, observedRevision, time, predecessorOperationId } = notes;
  return { ...fields, notes: { rowId, rowCreatedAt, observedRevision, time, ...(predecessorOperationId && { predecessorOperationId }) } };
}

export function expandPreachDateNotes(command: Extract<DataCommand, { kind: 'update' }>) {
  const notes = command.preachDateFieldActions?.notes;
  if (!object(notes) || !boundedRowId(notes.rowId)) return;
  const change = command.changes.find(item => item.path.length === 1 && item.path[0] === NOTES.field);
  const before = existingRowField(change?.before.value, notes.rowId, NOTES);
  const after = existingRowField(change?.after.value, notes.rowId, NOTES);
  if (before !== undefined && after !== undefined) return { ...notes, before, after };
}

export const PREACH_DATE_NOTE_SETTLED = 'preach-date-note-settled';
export const PREACH_DATE_NOTE_QUEUED = 'preach-date-note-queued';
export const PREACH_DATE_DETAIL_SETTLED = 'preach-date-detail-settled';
export const PREACH_DATE_DETAIL_QUEUED = 'preach-date-detail-queued';

export function preachDateDetailConflict(path: readonly string[]) {
  const rowId = path[1]?.startsWith('id:') ? path[1].slice(3) : undefined;
  if (!rowId) return;
  const field = PREACH_DATE_FIELDS.find(field => equalValues(path, rowConflictPath(rowId, preachDateFieldTarget(field))));
  if (field) return { rowId, field };
}

export function orderedPreachDateFieldConflict({ path, code }: ConflictDetail) {
  const detail = preachDateDetailConflict(path);
  if (!detail) return;
  const [settled, queued] = detail.field === 'notes' ? [PREACH_DATE_NOTE_SETTLED, PREACH_DATE_NOTE_QUEUED]
    : [PREACH_DATE_DETAIL_SETTLED, PREACH_DATE_DETAIL_QUEUED];
  if (code === settled || code === queued) return { ...detail, queued: code === queued };
}

export function preachDateNoteConflictId(path: readonly string[]): string | undefined {
  return path.length === 3 && path[0] === NOTES.field && path[1].startsWith('id:') && path[2] === NOTES.leaf
    ? path[1].slice(3) || undefined : undefined;
}

export function preachDateFieldScope(rows: Json | undefined, rowId: string, field: PreachDateField) {
  return PREACH_DATE_FIELD_POLICY.scopes?.(rows, field)?.get(rowId);
}

export function samePreachDateRow(rowId: string, opening: DocumentData, current: DocumentData): boolean {
  const birth = existingRowField(opening.preachDates, rowId, PREACH_ROW_BIRTH);
  return Boolean(birth && existingRowField(current.preachDates, rowId, PREACH_ROW_BIRTH) === birth);
}

export function readPreachDateFieldVersions(path: readonly string[], mine: DocumentData, stored: DocumentData) {
  const rowId = path[1]?.startsWith('id:') ? path[1].slice(3) : undefined;
  if (!rowId || !samePreachDateRow(rowId, mine, stored)) return;
  const simple = path.length === 3 && path[0] === 'preachDates' && (path[2] === 'date' || path[2] === 'status') ? path[2] : undefined;
  const field = simple ?? preachDateDetailConflict(path)?.field;
  if (!field) return;
  const target: RowFieldTarget<PreachDateFieldValue> = field === 'date' || field === 'status'
    ? { field: 'preachDates', leaf: field, missing: null, accepts: (value): value is string | null => typeof value === 'string' || value === null }
    : preachDateFieldTarget(field);
  const local = existingRowField(mine.preachDates, rowId, target);
  const saved = existingRowField(stored.preachDates, rowId, target);
  if (local !== undefined && saved !== undefined) return { rowId, field, mine: local, stored: saved };
}

export function readChangedPreachDateFieldVersions(...args: Parameters<typeof readPreachDateFieldVersions>) {
  const versions = readPreachDateFieldVersions(...args);
  return versions && !equalValues(versions.mine, versions.stored) ? versions : undefined;
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
