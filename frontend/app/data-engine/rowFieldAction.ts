import { equalValues, object, readField } from './fieldValues';

import type { ActionTime } from './actionClock';
import type { ConflictDetail, DataCommand, DocumentData, FieldChange, FieldValue, Json, ResourceSnapshot } from './types';

export type RowValue = string | number | boolean | null | DocumentData;
export type RowFieldTarget<Value extends RowValue> = {
  field: string;
  leaf: string | readonly [string, string];
  missing?: Value;
  storeNull?: true;
  accepts(value: unknown): value is Value;
};

export type RowFieldObservation<Value extends RowValue> = {
  rowId: string;
  before: Value;
  after: Value;
  time: ActionTime | null;
  observedRevision: number;
};

export type RowFieldEvidence<Value extends RowValue> = RowFieldObservation<Value> & {
  time: ActionTime;
};

export type DisplacedRowField<Value extends RowValue> = {
  rowId: string;
  value: Value;
  winnerValue: Value;
  generation: string;
  actionTime: ActionTime;
  winnerActionTime: ActionTime;
};

export const boundedRowId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128;
export const proofRevision = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

const leafPath = (leaf: RowFieldTarget<RowValue>['leaf']): string[] => typeof leaf === 'string' ? [leaf] : [...leaf];

function readRowField<Value extends RowValue>(row: DocumentData, target: RowFieldTarget<Value>): Value | undefined {
  if (typeof target.leaf !== 'string' && !object(row[target.leaf[0]])) return undefined;
  const { exists, value } = readField(row, leafPath(target.leaf));
  return exists ? ((value !== null || target.storeNull) && target.accepts(value) ? value : undefined) : target.missing;
}

function putRowField(row: DocumentData, leaf: RowFieldTarget<RowValue>['leaf'], value: RowValue, keepNull = false): DocumentData {
  if (typeof leaf === 'string') {
    const edited = { ...row };
    if (value === null && !keepNull) delete edited[leaf];
    else edited[leaf] = value;
    return edited;
  }
  const [parent, child] = leaf;
  const parentValue = row[parent];
  return object(parentValue) ? { ...row, [parent]: putRowField(parentValue, child, value, keepNull) } : row;
}

export function existingRowFields<Value extends RowValue>(rows: unknown, target: RowFieldTarget<Value>): Map<string, Value | undefined> {
  const fields = new Map<string, Value | undefined>();
  if (!Array.isArray(rows)) return fields;
  for (const row of rows) {
    if (!object(row) || typeof row.id !== 'string') continue;
    fields.set(row.id, fields.has(row.id) ? undefined : readRowField(row, target));
  }
  return fields;
}

export function existingRowField<Value extends RowValue>(rows: unknown, rowId: string, target: RowFieldTarget<Value>): Value | undefined {
  return existingRowFields(rows, target).get(rowId);
}

export function replaceExistingRowField<Value extends RowValue>(rows: Json | undefined, rowId: string, value: Value, target: RowFieldTarget<Value>): Json | undefined {
  if (!Array.isArray(rows) || existingRowField(rows, rowId, target) === undefined) return rows;
  return rows.map(row => {
    if (!object(row) || row.id !== rowId) return row;
    return putRowField(row, target.leaf, value, target.storeNull);
  });
}

export function isRowChange(change: FieldChange, target: RowFieldTarget<RowValue>): boolean {
  return change.path.length === 1 && change.path[0] === target.field;
}

export function matchesRowAction<Value extends RowValue>(changes: FieldChange[], action: RowFieldObservation<Value>, target: RowFieldTarget<Value>): boolean {
  const change = changes.find(item => isRowChange(item, target));
  return Boolean(change?.before.exists && change.after.exists
    && equalValues(existingRowField(change.before.value, action.rowId, target), action.before)
    && equalValues(existingRowField(change.after.value, action.rowId, target), action.after));
}

export const rowConflictPath = (rowId: string, target: RowFieldTarget<RowValue>) => [target.field, 'id:' + rowId, ...leafPath(target.leaf)];
export const rowConflictValue = (value: RowValue): FieldValue => value === null ? { exists: false } : { exists: true, value };

export function isCapturedRowConflict<Value extends RowValue>(conflict: ConflictDetail, action: RowFieldObservation<Value>, target: RowFieldTarget<Value>): boolean {
  const path = rowConflictPath(action.rowId, target);
  const missing = target.missing ?? null;
  return conflict.path.length === path.length && path.every((part, index) => conflict.path[index] === part)
    && equalValues(conflict.base.exists ? conflict.base.value : missing, action.before)
    && equalValues(conflict.mine.exists ? conflict.mine.value : missing, action.after)
    && (conflict.theirs.exists ? target.accepts(conflict.theirs.value) : target.missing !== undefined);
}

/** A missing optional row value can display the same value as its explicit default. */
export function alignOptionalRowField<Value extends RowValue>(command: Extract<DataCommand, { kind: 'update' }>, current: ResourceSnapshot,
  target: RowFieldTarget<Value>, rowId: string | undefined): DataCommand {
  const rows = current.value?.[target.field];
  const leaf = target.leaf;
  const missing = target.missing;
  if (missing === undefined || typeof leaf !== 'string' || !boundedRowId(rowId) || !Array.isArray(rows)
    || !equalValues(existingRowField(rows, rowId, target), missing)) return command;
  const stored = rows.find(row => object(row) && row.id === rowId);
  if (!object(stored)) return command;
  const exists = readField(stored, [leaf]).exists;
  const align = (side: FieldValue): FieldValue => {
    if (!Array.isArray(side.value) || !equalValues(existingRowField(side.value, rowId, target), missing)) return side;
    return { ...side, value: side.value.map(row => {
      if (!object(row) || row.id !== rowId || readField(row, [leaf]).exists === exists) return row;
      return putRowField(row, leaf, exists ? missing : null, exists && target.storeNull);
    }) };
  };
  return { ...command, changes: command.changes.map(change => isRowChange(change, target)
    ? { ...change, before: align(change.before), after: align(change.after) } : change) };
}
