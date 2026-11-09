import { equalValues } from './fieldValues';
import { existingRowField, isRowChange, rowConflictPath, rowConflictValue } from './rowFieldAction';

import type { DisplacedRowField, RowFieldEvidence, RowFieldObservation, RowFieldTarget, RowValue } from './rowFieldAction';
import type { ConflictDetail, FieldChange, ResourceSnapshot } from './types';

export type RowDetailObservation<Value extends RowValue> = RowFieldObservation<Value> & { rowCreatedAt: string; predecessorOperationId?: string };
export type RowDetailAction<Value extends RowValue> = RowFieldEvidence<Value> & RowDetailObservation<Value>;
export type RowDetailHistoryEntry<Field extends string, Value extends RowValue> = DisplacedRowField<Value> & { field: Field; rowCreatedAt: string; scope?: RowValue };
export type RowDetailActions<Field extends string, Value extends RowValue> = Partial<Record<Field, RowDetailAction<Value>>>;

export type RowDetailPolicy<Field extends string, Value extends RowValue> = {
  collection: string;
  fields: readonly Field[];
  birth: RowFieldTarget<string>;
  target: (field: Field) => RowFieldTarget<Value>;
  proofs: string;
  actions: string;
  repeatedFields?: readonly Field[];
  allowUnclocked?: boolean;
  causalScopeEntry?: boolean;
  allowUnchanged?: (field: Field, value: Value) => boolean;
  validAfter?: (field: Field, value: Value) => boolean;
  history: string;
  scopes?: (rows: unknown, field: Field) => ReadonlyMap<string, RowValue | undefined> | undefined;
  needsChoice?: (field: Field, before: Value, after: Value, current: Value) => boolean;
};

export function matchesRowDetailBirth(changes: FieldChange[], action: { rowId: string; rowCreatedAt: string }, birth: RowFieldTarget<string>): boolean {
  const change = changes.find(item => isRowChange(item, birth));
  return existingRowField(change?.before.value, action.rowId, birth) === action.rowCreatedAt
    && existingRowField(change?.after.value, action.rowId, birth) === action.rowCreatedAt;
}

export function replacedRowDetail<Value extends RowValue>(current: ResourceSnapshot, action: RowDetailObservation<Value>,
  target: RowFieldTarget<Value>, birth: RowFieldTarget<string>): ConflictDetail | undefined {
  const rows = current.value?.[target.field];
  const born = existingRowField(rows, action.rowId, birth);
  if (born === undefined || born === action.rowCreatedAt) return undefined;
  const value = existingRowField(rows, action.rowId, target);
  if (equalValues(value, action.after)) return undefined;
  return rowDetailConflict(action, target, value);
}

export function rowDetailConflict<Value extends RowValue>(action: RowDetailObservation<Value>, target: RowFieldTarget<Value>,
  current: Value | undefined): ConflictDetail {
  return { path: rowConflictPath(action.rowId, target), base: rowConflictValue(action.before),
    mine: rowConflictValue(action.after), theirs: rowConflictValue(current ?? null) };
}
