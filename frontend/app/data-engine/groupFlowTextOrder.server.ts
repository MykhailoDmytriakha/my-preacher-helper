import { object } from './fieldValues';
import { matchesRowDetailBirth, rowDetailConflict } from './rowDetailAction';
import { needsLegacyRowDetailOpeningReview, orderRowDetails } from './rowDetailOrder.server';
import { boundedRowId, existingRowFields } from './rowFieldAction';
import { readRowObservation } from './rowFieldOrder.server';

import type { RowDetailPolicy } from './rowDetailAction';
import type { DataCommand, ResourceSnapshot } from './types';

/** A queued older client can compare values but cannot prove which occurrence of the same text it saw. */
export function orderGroupFlowText<Field extends string, Value extends string | null>(command: DataCommand,
  current: ResourceSnapshot, raw: unknown, serverMs: number, policy: RowDetailPolicy<Field, Value>) {
  const metadata = current.metadata;
  if (command.resource.collection !== policy.collection || command.kind !== 'update' || !metadata || metadata.deleted
    || command.generation !== metadata.generation) return orderRowDetails(command, current, raw, serverMs, policy);
  const [field] = policy.fields;
  const target = policy.target(field);
  const change = command.changes.find(item => item.path[0] === target.field);
  if (!change) return orderRowDetails(command, current, raw, serverMs, policy);
  const confirmed = current.value?.[target.field];
  const opening = existingRowFields(change.before.value, target);
  const proposed = existingRowFields(change.after.value, target);
  const live = existingRowFields(confirmed, target);
  const births = existingRowFields(confirmed, policy.birth);
  const beforeBirths = existingRowFields(change.before.value, policy.birth);
  const afterBirths = existingRowFields(change.after.value, policy.birth);
  const rawActions: unknown = Reflect.get(command, policy.actions);
  const seen = new Set<string>(), submitted = new Map<string, object>();
  for (const candidate of Array.isArray(rawActions) ? rawActions : []) {
    if (!object(candidate) || !boundedRowId(candidate.rowId)) continue;
    if (seen.has(candidate.rowId)) { submitted.delete(candidate.rowId); continue; }
    seen.add(candidate.rowId);
    if (typeof candidate.rowCreatedAt !== 'string') continue;
    const full = { ...candidate, before: opening.get(candidate.rowId), after: proposed.get(candidate.rowId) };
    const action = readRowObservation(command, full, target, serverMs, { allowUnclocked: true });
    if (action && action.observedRevision <= metadata.revision
      && matchesRowDetailBirth(command.changes, { rowId: action.rowId, rowCreatedAt: candidate.rowCreatedAt }, policy.birth)) submitted.set(action.rowId, full);
  }
  const projected = orderRowDetails({ ...command, [policy.actions]: [...submitted.values()] }, current, raw, serverMs, policy);
  const { command: rewritten, ...order } = projected;
  const result = { ...order, command: { ...command, changes: rewritten.kind === 'update' ? rewritten.changes : command.changes } };
  for (const [rowId, after] of proposed) {
    const before = opening.get(rowId), saved = live.get(rowId), born = births.get(rowId);
    if (submitted.has(rowId) || before === undefined || after === undefined || born === undefined || before === after || before !== saved
      || beforeBirths.get(rowId) !== born || afterBirths.get(rowId) !== born
      || !needsLegacyRowDetailOpeningReview(raw, policy, field, rowId, born, saved, metadata.revision)) continue;
    result.uncertain.push(rowDetailConflict({ rowId, rowCreatedAt: born, before, after, observedRevision: 0, time: null }, target, saved));
  }
  return result;
}
