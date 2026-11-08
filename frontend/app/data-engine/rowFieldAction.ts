import { object, own } from './fieldValues';

import type { ActionTime } from './actionClock';
import type { ConflictDetail, FieldChange, FieldValue, Json } from './types';

export type RowValue = string | null;
export type RowFieldTarget<Value extends RowValue> = {
  field: string;
  leaf: string;
  missing?: Value;
  accepts(value: unknown): value is Value;
};

export type RowFieldEvidence<Value extends RowValue> = {
  rowId: string;
  before: Value;
  after: Value;
  time: ActionTime;
  observedRevision: number;
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

export function existingRowFields<Value extends RowValue>(rows: unknown, target: RowFieldTarget<Value>): Map<string, Value | undefined> {
  const fields = new Map<string, Value | undefined>();
  if (!Array.isArray(rows)) return fields;
  for (const row of rows) {
    if (!object(row) || typeof row.id !== 'string') continue;
    const value = row[target.leaf];
    fields.set(row.id, fields.has(row.id) ? undefined
      : own(row, target.leaf) ? (value !== null && target.accepts(value) ? value : undefined) : target.missing);
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
    const edited = { ...row };
    if (value === null) delete edited[target.leaf];
    else edited[target.leaf] = value;
    return edited;
  });
}

export function isRowChange(change: FieldChange, target: RowFieldTarget<RowValue>): boolean {
  return change.path.length === 1 && change.path[0] === target.field;
}

export function matchesRowAction<Value extends RowValue>(changes: FieldChange[], action: RowFieldEvidence<Value>, target: RowFieldTarget<Value>): boolean {
  const change = changes.find(item => isRowChange(item, target));
  return Boolean(change?.before.exists && change.after.exists
    && existingRowField(change.before.value, action.rowId, target) === action.before
    && existingRowField(change.after.value, action.rowId, target) === action.after);
}

export const rowConflictPath = (rowId: string, target: RowFieldTarget<RowValue>) => [target.field, 'id:' + rowId, target.leaf];
export const rowConflictValue = (value: RowValue): FieldValue => value === null ? { exists: false } : { exists: true, value };

export function isCapturedRowConflict<Value extends RowValue>(conflict: ConflictDetail, action: RowFieldEvidence<Value>, target: RowFieldTarget<Value>): boolean {
  const path = rowConflictPath(action.rowId, target);
  return conflict.path.length === path.length && path.every((part, index) => conflict.path[index] === part)
    && (conflict.base.exists ? conflict.base.value : null) === action.before
    && (conflict.mine.exists ? conflict.mine.value : null) === action.after
    && (conflict.theirs.exists ? target.accepts(conflict.theirs.value) : target.missing === null);
}
