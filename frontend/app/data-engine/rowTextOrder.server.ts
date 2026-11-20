import { equalValues, object } from './fieldValues';
import { matchesRowDetailBirth, rowDetailConflict } from './rowDetailAction';
import { needsLegacyRowDetailOpeningReview, orderRowDetails } from './rowDetailOrder.server';
import { boundedRowId, existingRowFields, rowConflictPath, rowConflictValue } from './rowFieldAction';
import { readRowObservation } from './rowFieldOrder.server';

import type { RowDetailPolicy } from './rowDetailAction';
import type { RowDetailOrder } from './rowDetailOrder.server';
import type { RowValue } from './rowFieldAction';
import type { DataCommand, ResourceSnapshot } from './types';

/** A queued older client can compare values but cannot prove which occurrence of the same text it saw. */
export function orderRowText<Field extends string, Value extends string | null>(command: DataCommand,
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
  const repeated = policy.repeatedFields?.includes(field);
  const candidates = repeated ? (Array.isArray(rawActions) ? rawActions : [])
    : object(rawActions) ? [rawActions[field]] : [];
  const seen = new Set<string>(), submitted = new Map<string, object>();
  const acceptsRowId = policy.acceptsRowId ?? boundedRowId;
  for (const candidate of candidates) {
    if (!object(candidate) || !acceptsRowId(candidate.rowId)) continue;
    if (seen.has(candidate.rowId)) { submitted.delete(candidate.rowId); continue; }
    seen.add(candidate.rowId);
    if (typeof candidate.rowCreatedAt !== 'string') continue;
    const compact = repeated && !Object.hasOwn(candidate, 'before') && !Object.hasOwn(candidate, 'after');
    const full = compact ? { ...candidate, before: opening.get(candidate.rowId), after: proposed.get(candidate.rowId) } : candidate;
    const action = readRowObservation(command, full, target, serverMs, { allowUnclocked: true, acceptsRowId,
      allowUnchanged: after => Boolean(policy.allowUnchanged?.(field, after)) });
    if (action && action.observedRevision <= metadata.revision
      && matchesRowDetailBirth(command.changes, { rowId: action.rowId, rowCreatedAt: candidate.rowCreatedAt }, policy.birth)) submitted.set(action.rowId, full);
  }
  const validated = [...submitted.values()];
  const actions = repeated ? validated : { [field]: validated[0] };
  const projected = orderRowDetails({ ...command, [policy.actions]: actions }, current, raw, serverMs, policy);
  const { command: rewritten, ...order } = projected;
  const result = { ...order, command: { ...command, changes: rewritten.kind === 'update' ? rewritten.changes : command.changes } };
  for (const [rowId, after] of proposed) {
    const before = opening.get(rowId), saved = live.get(rowId), born = births.get(rowId);
    if (submitted.has(rowId) || before === undefined || after === undefined || born === undefined || before === after
      || beforeBirths.get(rowId) !== born || afterBirths.get(rowId) !== born) continue;
    if (policy.rememberLegacyReaffirmations && after === saved) {
      const plans = result.fields.get(field) ?? [];
      result.fields.set(field, [...plans, { command: result.command, sameValueWithoutOrder: rowId }]);
    } else if (before === saved && needsLegacyRowDetailOpeningReview(raw, policy, field, rowId, born, saved, metadata.revision)) {
      result.uncertain.push(rowDetailConflict({ rowId, rowCreatedAt: born, before, after, observedRevision: 0, time: null }, target, saved));
    }
  }
  return result;
}

/** An ordered field may share the Save with a field that still needs the owner's choice. */
export function settledRowDetailComparisons<Field extends string, Value extends RowValue>(command: DataCommand,
  current: ResourceSnapshot, policy: RowDetailPolicy<Field, Value>, order: RowDetailOrder<Field, Value>,
  codes: { settled: string; queued: string }) {
  if (command.kind !== 'update' || !order.displaced.length) return [];
  return policy.fields.flatMap(field => {
    const target = policy.target(field);
    const change = command.changes.find(item => item.path[0] === target.field);
    const opening = existingRowFields(change?.before.value, target);
    const proposed = existingRowFields(change?.after.value, target);
    const accepted = existingRowFields(current.value?.[target.field], target);
    return order.displaced.flatMap(entry => {
      if (entry.field !== field) return [];
      const { rowId, value, winnerValue } = entry;
      const before = opening.get(rowId), mine = proposed.get(rowId), stored = accepted.get(rowId);
      if (before === undefined || mine === undefined || stored === undefined) return [];
      const code = equalValues(stored, winnerValue) && equalValues(mine, value) ? codes.settled
        : equalValues(stored, value) && equalValues(mine, winnerValue) ? codes.queued : undefined;
      return code ? [{ path: rowConflictPath(rowId, target), code, base: rowConflictValue(before),
        mine: rowConflictValue(mine), theirs: rowConflictValue(stored) }] : [];
    });
  });
}
