import { equalValues, object, readField } from './fieldValues';

import type { ActionTime } from './actionClock';
import type { ConflictDetail, DocumentData, FieldChange, FieldValue, Json } from './types';

export type RowValue = string | boolean | null | DocumentData;
export type RowFieldTarget<Value extends RowValue> = {
  field: string;
  leaf: string | readonly [string, string];
  missing?: Value;
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
  return exists ? (value !== null && target.accepts(value) ? value : undefined) : target.missing;
}

function putRowField(row: DocumentData, leaf: RowFieldTarget<RowValue>['leaf'], value: RowValue): DocumentData {
  if (typeof leaf === 'string') {
    const edited = { ...row };
    if (value === null) delete edited[leaf];
    else edited[leaf] = value;
    return edited;
  }
  const [parent, child] = leaf;
  const parentValue = row[parent];
  return object(parentValue) ? { ...row, [parent]: putRowField(parentValue, child, value) } : row;
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
    return putRowField(row, target.leaf, value);
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
