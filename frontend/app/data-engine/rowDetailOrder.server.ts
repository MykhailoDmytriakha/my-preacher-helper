import { createHash } from 'node:crypto';

import { boundedActionTime } from './actionClock';
import { commandFingerprint, equalValues, object } from './fieldValues';
import { matchesRowDetailBirth, replacedRowDetail, rowDetailConflict } from './rowDetailAction';
import { boundedRowId, existingRowField, existingRowFields, isRowChange, proofRevision } from './rowFieldAction';
import { orderConcurrentRowField, readRowObservation, uncertainRowChange } from './rowFieldOrder.server';

import type { ActionTime } from './actionClock';
import type { RowDetailAction, RowDetailHistoryEntry, RowDetailPolicy } from './rowDetailAction';
import type { RowFieldTarget, RowValue } from './rowFieldAction';
import type { ConflictDetail, DataCommand, ResourceSnapshot } from './types';

const MAX_PROOFS = 32;

type Update = Extract<DataCommand, { kind: 'update' }>;
type Proof = { rowId: string; digest: string; revision: number; time: ActionTime | null; operationId: string; causal?: true };
type FieldPlan<Field extends string, Value extends RowValue> = {
  command: Update;
  stamp?: RowDetailAction<Value>;
  displaced?: RowDetailHistoryEntry<Field, Value>;
  uncertain?: ConflictDetail;
  sameValueWithoutOrder?: string;
};

function digest(born: string, value: RowValue, scope?: RowValue): string {
  // The original group proof has this exact wire digest. New scoped or object values use a stable key.
  const key = scope === undefined && !object(value) ? JSON.stringify([born, value]) : commandFingerprint([born, value, scope ?? null]);
  return createHash('sha256').update(key).digest('base64url');
}

function readProofs(raw: unknown, key: string, field: string) {
  const all = object(raw) ? raw[key] : undefined;
  const stored = object(all) ? all[field] : undefined;
  const floor = object(stored) && proofRevision(stored.floor) ? stored.floor : 0;
  const proofs = object(stored) && Array.isArray(stored.proofs) ? stored.proofs : [];
  const values = proofs.slice(0, MAX_PROOFS).flatMap((item): Proof[] => {
    if (!object(item) || !boundedRowId(item.rowId) || !proofRevision(item.revision)
      || typeof item.operationId !== 'string' || typeof item.digest !== 'string' || !/^[a-zA-Z0-9_-]{43}$/.test(item.digest)) return [];
    const time = item.time === null ? null : boundedActionTime(item.time);
    return time !== undefined ? [{ rowId: item.rowId, digest: item.digest, revision: item.revision, time, operationId: item.operationId,
      ...(item.causal === true && { causal: true as const }) }] : [];
  });
  return { values, floor };
}

function orderField<Field extends string, Value extends RowValue>(command: Update, current: ResourceSnapshot, raw: unknown, serverMs: number,
  field: Field, policy: RowDetailPolicy<Field, Value>, submitted: unknown): FieldPlan<Field, Value> {
  const target = policy.target(field);
  const evidence = readRowObservation(command, submitted, target, serverMs, {
    allowUnclocked: policy.allowUnclocked,
    allowUnchanged: after => Boolean(policy.allowUnchanged?.(field, after)),
  });
  const revision = current.metadata!.revision;
  if (!evidence || policy.validAfter?.(field, evidence.after) === false || evidence.observedRevision > revision || !object(submitted) || !policy.birth.accepts(submitted.rowCreatedAt)) return { command };
  const action = { ...evidence, rowCreatedAt: submitted.rowCreatedAt };
  if (!matchesRowDetailBirth(command.changes, action, policy.birth)) return { command };
  const replacement = replacedRowDetail(current, action, target, policy.birth);
  if (replacement) return { command, uncertain: replacement };
  const rows = current.value?.[target.field];
  const value = existingRowField(rows, action.rowId, target);
  if (value === undefined || existingRowField(rows, action.rowId, policy.birth) !== action.rowCreatedAt) return { command };
  const scopes = policy.scopes?.(rows, field);
  const scope = scopes?.get(action.rowId);
  if (scopes) {
    const change = command.changes.find(item => isRowChange(item, target));
    const beforeScope = policy.scopes?.(change?.before.value, field)?.get(action.rowId);
    const afterScope = policy.scopes?.(change?.after.value, field)?.get(action.rowId);
    if (beforeScope === undefined || !equalValues(beforeScope, afterScope)) return { command };
    if (!equalValues(beforeScope, scope)) {
      return { command, ...(!equalValues(value, action.after) && { uncertain: rowDetailConflict(action, target, value) }) };
    }
  }
  if (policy.needsChoice?.(field, action.before, action.after, value)) {
    return { command, uncertain: rowDetailConflict(action, target, value) };
  }
  const { values, floor } = readProofs(raw, policy.proofs, field);
  const key = digest(action.rowCreatedAt, value, scope);
  const previous = values.find(proof => proof.rowId === action.rowId && proof.revision <= revision && proof.digest === key);
  const sameIntent = equalValues(action.before, action.after);
  const unobserved = previous && previous.revision > action.observedRevision;
  const proofEvicted = !previous && action.observedRevision < Math.min(floor, revision);
  if (proofEvicted && equalValues(value, action.before) && !equalValues(value, action.after)) {
    return { command, uncertain: uncertainRowChange(action, target) };
  }
  if (sameIntent && !unobserved && !equalValues(value, action.after)) {
    return { command, uncertain: rowDetailConflict(action, target, value) };
  }
  const followsPredecessor = unobserved && (previous.time || (policy.allowUnclocked && previous.causal)) && equalValues(value, action.before)
    && previous.operationId === submitted.predecessorOperationId;
  if (!action.time) {
    if (followsPredecessor) return { command, ...(sameIntent && { sameValueWithoutOrder: action.rowId }) };
    if ((unobserved || proofEvicted) && !equalValues(value, action.after)) {
      return { command, uncertain: rowDetailConflict(action, target, value) };
    }
    return { command, ...((unobserved || sameIntent) && equalValues(value, action.after) && { sameValueWithoutOrder: action.rowId }) };
  }
  const timed = { ...action, time: action.time };
  if (unobserved) {
    if (followsPredecessor) return { command, stamp: timed };
    return orderUnobservedRowDetail(command, timed, field, target, value, previous, scope);
  }
  return { command, ...((sameIntent || !equalValues(value, action.after)) && (previous || action.observedRevision === revision) ? { stamp: timed } : {}) };
}

function orderUnobservedRowDetail<Field extends string, Value extends RowValue>(command: Update, action: RowDetailAction<Value>,
  field: Field, target: RowFieldTarget<Value>, value: Value, previous: Proof, scope?: RowValue): FieldPlan<Field, Value> {
  const ordered = orderConcurrentRowField(command, action, target, { value, time: previous.time });
  if (ordered.displaced) return { command: ordered.command, displaced: { ...ordered.displaced, field, rowCreatedAt: action.rowCreatedAt, ...(scope != null && { scope }) },
    ...(ordered.chronology > 0 ? { stamp: action } : {}) };
  if (ordered.chronology > 0) return { command, stamp: action };
  if (!ordered.chronology && equalValues(value, action.after)) return { command, sameValueWithoutOrder: action.rowId };
  if (!ordered.chronology && equalValues(action.before, action.after)) return { command, uncertain: rowDetailConflict(action, target, value) };
  if (!ordered.chronology && equalValues(value, action.before)) return { command, uncertain: uncertainRowChange(action, target) };
  return { command };
}

function submissions<Field extends string, Value extends RowValue>(command: Update, field: Field, policy: RowDetailPolicy<Field, Value>): unknown[] {
  const raw: unknown = Reflect.get(command, policy.actions);
  if (policy.repeatedFields?.includes(field)) {
    if (!Array.isArray(raw)) return [];
    const byId = new Map<string, unknown>();
    for (const action of raw) {
      if (!object(action) || !boundedRowId(action.rowId)) continue;
      // Ambiguous intent for one row is never evidence of its chronology.
      byId.set(action.rowId, byId.has(action.rowId) ? undefined : action);
    }
    return [...byId.values()].filter(action => action !== undefined);
  }
  const single = object(raw) ? raw[field] : undefined;
  return single === undefined ? [] : [single];
}

export function orderRowDetails<Field extends string, Value extends RowValue>(command: DataCommand, current: ResourceSnapshot,
  raw: unknown, serverMs: number, policy: RowDetailPolicy<Field, Value>) {
  const fields = new Map<Field, FieldPlan<Field, Value>[]>();
  if (command.resource.collection === policy.collection && command.kind === 'update' && current.metadata && !current.metadata.deleted
    && command.generation === current.metadata.generation) {
    let ordered: Update = command;
    for (const field of policy.fields) {
      const plans: FieldPlan<Field, Value>[] = [];
      for (const submitted of submissions(ordered, field, policy)) {
        const plan: FieldPlan<Field, Value> = orderField(ordered, current, raw, serverMs, field, policy, submitted);
        plans.push(plan);
        ordered = plan.command;
      }
      if (plans.length) fields.set(field, plans);
    }
    command = ordered;
  }
  const plans = [...fields.values()].flat();
  return { command, fields, displaced: plans.flatMap(plan => plan.displaced ?? []), uncertain: plans.flatMap(plan => plan.uncertain ?? []) };
}

export type RowDetailOrder<Field extends string, Value extends RowValue> = ReturnType<typeof orderRowDetails<Field, Value>>;

export function metadataAfterRowDetails<Field extends string, Value extends RowValue>(snapshot: ResourceSnapshot,
  raw: Record<string, unknown> | undefined, policy: RowDetailPolicy<Field, Value>, order?: ReturnType<typeof orderRowDetails<Field, Value>>) {
  const metadata = snapshot.metadata;
  if (!metadata || !snapshot.value || snapshot.resource.collection !== policy.collection) return metadata;
  const rows = snapshot.value[policy.birth.field], oldRows = raw?.[policy.birth.field];
  const births = existingRowFields(rows, policy.birth), previousBirths = existingRowFields(oldRows, policy.birth);
  const proofs = Object.fromEntries(policy.fields.flatMap(field => {
    const target = policy.target(field);
    const current = existingRowFields(rows, target), previous = existingRowFields(oldRows, target);
    const currentScopes = policy.scopes?.(rows, field), previousScopes = policy.scopes?.(oldRows, field);
    const stored = readProofs(raw?._dataEngine, policy.proofs, field);
    const plans = order?.fields.get(field) ?? [];
    const stamps = new Map(plans.flatMap(plan => plan.stamp ? [[plan.stamp.rowId, plan.stamp] as const] : []));
    const unordered = new Set(plans.map(plan => plan.sameValueWithoutOrder));
    const updated = [...current].flatMap(([rowId, value]): Proof[] => {
      const born = births.get(rowId);
      if (value === undefined || born === undefined || !boundedRowId(rowId) || !metadata.operationId) return [];
      const scope = currentScopes?.get(rowId);
      const stamp = stamps.get(rowId);
      const time = stamp?.rowCreatedAt === born && equalValues(stamp.after, value) ? stamp.time : null;
      const changed = !equalValues(previous.get(rowId), value) || previousBirths.get(rowId) !== born;
      const enteredScope = policy.causalScopeEntry && scope !== undefined && previousScopes?.get(rowId) === undefined;
      // A same-value acknowledgement with uncertain order does not prove who set the value.
      return time || changed || !equalValues(previousScopes?.get(rowId), scope) || unordered.has(rowId)
        ? [{ rowId, digest: digest(born, value, scope), revision: metadata.revision, time, operationId: metadata.operationId,
          ...(policy.allowUnclocked && (changed || enteredScope) && { causal: true as const }) }] : [];
    });
    const newRows = new Set(updated.map(proof => proof.rowId));
    const retained = [...updated, ...stored.values.filter(proof => {
      const value = current.get(proof.rowId), born = births.get(proof.rowId);
      return value !== undefined && born !== undefined && !newRows.has(proof.rowId)
        && proof.digest === digest(born, value, currentScopes?.get(proof.rowId));
    })];
    const floor = retained.slice(MAX_PROOFS).reduce((revision, proof) => Math.max(revision, proof.revision), stored.floor);
    return retained.length || floor ? [[field, { proofs: retained.slice(0, MAX_PROOFS), floor }]] : [];
  }));
  return { ...metadata, ...(Object.keys(proofs).length ? { [policy.proofs]: proofs } : {}) };
}
