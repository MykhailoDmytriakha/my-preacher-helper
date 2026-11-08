import { boundedActionTime, compareActionTime } from './actionClock';
import { equalValues, object } from './fieldValues';
import { boundedRowId, isRowChange, matchesRowAction, proofRevision, replaceExistingRowField, rowConflictPath, rowConflictValue } from './rowFieldAction';

import type { ActionTime } from './actionClock';
import type { DisplacedRowField, RowFieldEvidence, RowFieldTarget, RowValue } from './rowFieldAction';
import type { ConflictDetail, DataCommand } from './types';

type Update = Extract<DataCommand, { kind: 'update' }>;

export function readRowAction<Value extends RowValue>(command: Update, raw: unknown, target: RowFieldTarget<Value>,
  serverMs: number): RowFieldEvidence<Value> | undefined {
  if (!object(raw) || !boundedRowId(raw.rowId) || !target.accepts(raw.before) || !target.accepts(raw.after)
    || equalValues(raw.before, raw.after) || !proofRevision(raw.observedRevision) || !Number.isFinite(serverMs)) return undefined;
  const time = boundedActionTime(raw.time);
  if (!time || time.earliestMs > serverMs + 5) return undefined;
  const action = { rowId: raw.rowId, before: raw.before, after: raw.after, observedRevision: raw.observedRevision, time };
  return matchesRowAction(command.changes, action, target) ? action : undefined;
}

export function uncertainRowChange<Value extends RowValue>(action: RowFieldEvidence<Value>, target: RowFieldTarget<Value>): ConflictDetail {
  const base = rowConflictValue(action.before);
  return { path: rowConflictPath(action.rowId, target), base, mine: rowConflictValue(action.after), theirs: base };
}

/** Rewrite only the ordered leaf. The normal keyed-array merge still owns all neighboring edits. */
export function orderConcurrentRowField<Value extends RowValue>(command: Update, action: RowFieldEvidence<Value>,
  target: RowFieldTarget<Value>, stored: { value: Value; time: ActionTime | null }): {
    command: Update; chronology: number; displaced?: DisplacedRowField<Value>;
  } {
  const chronology = stored.time ? compareActionTime(action.time, stored.time) : 0;
  if (!stored.time || !chronology || equalValues(stored.value, action.after)) return { command, chronology };
  const incomingWins = chronology > 0;
  const changes = command.changes.map(change => isRowChange(change, target) ? {
    ...change,
    before: { ...change.before, value: replaceExistingRowField(change.before.value, action.rowId, stored.value, target) },
    after: incomingWins ? change.after : { ...change.after, value: replaceExistingRowField(change.after.value, action.rowId, stored.value, target) },
  } : change);
  return { command: { ...command, changes }, chronology, displaced: {
    rowId: action.rowId, generation: command.generation!,
    value: incomingWins ? stored.value : action.after, winnerValue: incomingWins ? action.after : stored.value,
    actionTime: incomingWins ? stored.time : action.time, winnerActionTime: incomingWins ? action.time : stored.time,
  } };
}
