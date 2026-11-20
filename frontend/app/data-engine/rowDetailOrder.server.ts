import { createHash } from 'node:crypto';

import { boundedActionTime } from './actionClock';
import { commandFingerprint, equalValues, object } from './fieldValues';
import { matchesRowDetailBirth, replacedRowDetail, rowDetailConflict } from './rowDetailAction';
import { boundedRowId, existingRowField, existingRowFields, isRowChange, proofRevision, replaceExistingRowField } from './rowFieldAction';
import { orderConcurrentRowField, readRowObservation, uncertainRowChange } from './rowFieldOrder.server';

import type { ActionTime } from './actionClock';
import type { RowDetailAction, RowDetailHistoryEntry, RowDetailPolicy } from './rowDetailAction';
import type { RowFieldTarget, RowValue } from './rowFieldAction';
import type { ConflictDetail, DataCommand, ResourceSnapshot } from './types';

const MAX_PROOFS = 32;

type Update = Extract<DataCommand, { kind: 'update' }>;
type RepairSource = { digest: string; revision: number };
type Proof = RepairSource & { rowId: string; time: ActionTime | null; operationId: string; causal?: true; repairs?: RepairSource[]; valueRevision?: number; queueDigest?: string; priorFrames?: string[] };
type RowRepair<Value extends RowValue> = { before: Value; after: Value };
const MAX_REPAIR_SOURCES = 4;
const MAX_PRIOR_FRAMES = 8;
const proofDigest = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{43}$/.test(value);
type FieldPlan<Field extends string, Value extends RowValue> = {
  command: Update;
  stamp?: RowDetailAction<Value>;
  displaced?: RowDetailHistoryEntry<Field, Value>;
  uncertain?: ConflictDetail;
  sameValueWithoutOrder?: string;
  rebasedRepair?: string;
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
      || typeof item.operationId !== 'string' || !proofDigest(item.digest)) return [];
    const time = item.time === null ? null : boundedActionTime(item.time);
    const repairs = Array.isArray(item.repairs) ? item.repairs.slice(0, MAX_REPAIR_SOURCES).flatMap(repair =>
      object(repair) && proofDigest(repair.digest) && proofRevision(repair.revision) ? [{ digest: repair.digest, revision: repair.revision }] : []) : [];
    return time !== undefined ? [{ rowId: item.rowId, digest: item.digest, revision: item.revision, time, operationId: item.operationId,
      ...(item.causal === true && { causal: true as const }), ...(repairs.length && { repairs }),
      ...(proofRevision(item.valueRevision) && item.valueRevision <= item.revision && { valueRevision: item.valueRevision }),
      ...(proofDigest(item.queueDigest) && { queueDigest: item.queueDigest }),
      ...(Array.isArray(item.priorFrames) && item.priorFrames.length <= MAX_PRIOR_FRAMES && item.priorFrames.every(proofDigest)
        && { priorFrames: item.priorFrames }) }] : [];
  });
  return { values, floor };
}

function matchingProof(values: Proof[], rowId: string, born: string, value: RowValue, scope: RowValue | undefined, revision: number) {
  const key = digest(born, value, scope);
  return values.find(proof => proof.rowId === rowId && proof.revision <= revision && proof.digest === key);
}

type ProofIdentity = Pick<RowDetailPolicy<string, RowValue>, 'proofs' | 'proofRowId'>;
const proofRowId = (policy: ProofIdentity, rowId: string) => policy.proofRowId?.(rowId) ?? rowId;

export function readRowDetailProof(raw: unknown, policy: ProofIdentity, field: string,
  rowId: string, born: string, value: RowValue, scope: RowValue | undefined, revision: number) {
  return matchingProof(readProofs(raw, policy.proofs, field).values, proofRowId(policy, rowId), born, value, scope, revision);
}

export function rowDetailPreviousValues(raw: unknown, policy: { proofs: string }, field: string,
  rowId: string, born: string, value: RowValue, revision: number) {
  const proof = readRowDetailProof(raw, policy, field, rowId, born, value, undefined, revision);
  return proof?.priorFrames && ((earlier: RowValue) => proof.priorFrames!.includes(digest(born, earlier))
    ? { revision: proof.revision, time: null } : undefined);
}

export function followsQueuedRowDetail(proof: Proof, predecessorOperationId: unknown, queueDigest: string | undefined): boolean {
  return Boolean(queueDigest && proof.queueDigest === queueDigest && proof.causal && proof.operationId === predecessorOperationId);
}

/** An old request showing a never-repeated frame must have opened during that frame. */
export function continuousRowDetailFrame(proof: Proof | undefined): boolean {
  const previous = proof?.priorFrames;
  return Boolean(proof && previous && !previous.includes(proof.digest));
}

export function needsLegacyRowDetailOpeningReview(raw: unknown, policy: ProofIdentity, field: string,
  rowId: string, born: string, value: RowValue, revision: number): boolean {
  const { values, floor } = readProofs(raw, policy.proofs, field);
  const proof = matchingProof(values, proofRowId(policy, rowId), born, value, undefined, revision);
  // An evicted creation proof alone cannot hide a change back to the opening.
  return proof ? !continuousRowDetailFrame(proof) : floor > 1;
}

function nextPriorFrames(prior: Proof | undefined, hasOpening: boolean, changed: boolean): string[] | undefined {
  if (!hasOpening) return [];
  const frames = prior?.priorFrames;
  if (!prior || !frames || !changed || frames.includes(prior.digest)) return frames;
  // Once the complete history is unknown, an old request cannot prove when it saw this frame.
  return frames.length < MAX_PRIOR_FRAMES ? [...frames, prior.digest] : undefined;
}

function orderField<Field extends string, Value extends RowValue>(command: Update, current: ResourceSnapshot, raw: unknown, serverMs: number,
  field: Field, policy: RowDetailPolicy<Field, Value>, submitted: unknown, queueDigest?: string, knownOpeningRow?: string): FieldPlan<Field, Value> {
  const target = policy.target(field);
  const evidence = readRowObservation(command, submitted, target, serverMs, {
    allowUnclocked: policy.allowUnclocked,
    acceptsRowId: policy.acceptsRowId,
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
  if (policy.mergesIndependently?.(action.before, action.after, value)) return { command };
  if (policy.needsChoice?.(field, action.before, action.after, value)) {
    return { command, uncertain: rowDetailConflict(action, target, value) };
  }
  const { values, floor } = readProofs(raw, policy.proofs, field);
  const previous = matchingProof(values, proofRowId(policy, action.rowId), action.rowCreatedAt, value, scope, revision);
  const unobserved = previous && previous.revision > action.observedRevision;
  const proofEvicted = !previous && action.observedRevision < Math.min(floor, revision);
  const matchesOpening = equalValues(value, action.before);
  const followsPredecessor = unobserved && (previous.time || (policy.allowUnclocked && previous.causal)) && matchesOpening
    && previous.operationId === submitted.predecessorOperationId;
  if (policy.requireObserved) {
    // The row revision still detects a competing write that returned to the opening value.
    const unknown = !previous && action.observedRevision < revision;
    const continues = previous && followsQueuedRowDetail(previous, submitted.predecessorOperationId, queueDigest);
    return unknown || !matchesOpening || (unobserved && !continues)
      ? { command, uncertain: rowDetailConflict(action, target, value) } : { command };
  }

  const sameIntent = equalValues(action.before, action.after);
  const openingDigest = previous?.repairs && digest(action.rowCreatedAt, action.before, scope);
  const throughRepair = openingDigest && previous?.repairs?.some(repair =>
    repair.digest === openingDigest && repair.revision > action.observedRevision && repair.revision <= revision);
  const followsRepair = throughRepair && unobserved && previous.operationId === submitted.predecessorOperationId;
  if (throughRepair && (!unobserved || followsRepair)) {
    // The exact shown link was transformed by the outline. The transform has no action time of its own.
    const changes = command.changes.map(change => isRowChange(change, target) ? {
      ...change,
      before: { ...change.before, value: replaceExistingRowField(change.before.value, action.rowId, value, target) },
    } : change);
    return { command: { ...command, changes }, rebasedRepair: action.rowId,
      ...(action.time ? { stamp: { ...action, time: action.time } } : equalValues(value, action.after) && { sameValueWithoutOrder: action.rowId }) };
  }

  if (policy.atomicChoice && !unobserved && !equalValues(value, action.before) && !equalValues(value, action.after)) {
    return { command, uncertain: rowDetailConflict(action, target, value) };
  }
  if (proofEvicted && equalValues(value, action.before) && !equalValues(value, action.after)) {
    return { command, uncertain: uncertainRowChange(action, target) };
  }
  if (sameIntent && !unobserved && !equalValues(value, action.after)) {
    return { command, uncertain: rowDetailConflict(action, target, value) };
  }
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
    return orderUnobservedRowDetail(command, timed, field, target, value, previous, scope, policy.atomicChoice);
  }
  const matchesKnownOpening = knownOpeningRow === action.rowId && matchesOpening;
  return { command, ...((sameIntent || !equalValues(value, action.after))
    && (previous || action.observedRevision === revision || matchesKnownOpening) ? { stamp: timed } : {}) };
}

function orderUnobservedRowDetail<Field extends string, Value extends RowValue>(command: Update, action: RowDetailAction<Value>,
  field: Field, target: RowFieldTarget<Value>, value: Value, previous: Proof, scope?: RowValue, atomicChoice?: true): FieldPlan<Field, Value> {
  const ordered = orderConcurrentRowField(command, action, target, { value, time: previous.time });
  if (ordered.displaced) return { command: ordered.command, displaced: { ...ordered.displaced, field, rowCreatedAt: action.rowCreatedAt, ...(scope != null && { scope }) },
    ...(ordered.chronology > 0 ? { stamp: action } : {}) };
  if (ordered.chronology > 0) return { command, stamp: action };
  if (!ordered.chronology && equalValues(value, action.after)) return { command, sameValueWithoutOrder: action.rowId };
  if (!ordered.chronology && (atomicChoice || equalValues(action.before, action.after))) return { command, uncertain: rowDetailConflict(action, target, value) };
  if (!ordered.chronology && equalValues(value, action.before)) return { command, uncertain: uncertainRowChange(action, target) };
  return { command };
}

function submissions<Field extends string, Value extends RowValue>(command: Update, field: Field, policy: RowDetailPolicy<Field, Value>): unknown[] {
  const raw: unknown = Reflect.get(command, policy.actions);
  if (policy.repeatedFields?.includes(field)) {
    if (!Array.isArray(raw)) return [];
    const byId = new Map<string, unknown>();
    for (const action of raw) {
      if (!object(action) || !(policy.acceptsRowId ?? boundedRowId)(action.rowId)) continue;
      // Ambiguous intent for one row is never evidence of its chronology.
      byId.set(action.rowId, byId.has(action.rowId) ? undefined : action);
    }
    return [...byId.values()].filter(action => action !== undefined);
  }
  const single = object(raw) ? raw[field] : undefined;
  return single === undefined ? [] : [single];
}

export function orderRowDetails<Field extends string, Value extends RowValue>(command: DataCommand, current: ResourceSnapshot,
  raw: unknown, serverMs: number, policy: RowDetailPolicy<Field, Value>, queueDigest?: string, knownOpeningRow?: string) {
  const fields = new Map<Field, FieldPlan<Field, Value>[]>();
  if (command.resource.collection === policy.collection && command.kind === 'update' && current.metadata && !current.metadata.deleted
    && command.generation === current.metadata.generation) {
    let ordered: Update = command;
    for (const field of policy.fields) {
      const plans: FieldPlan<Field, Value>[] = [];
      for (const submitted of submissions(ordered, field, policy)) {
        const plan: FieldPlan<Field, Value> = orderField(ordered, current, raw, serverMs, field, policy, submitted, queueDigest, knownOpeningRow);
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
  raw: Record<string, unknown> | undefined, policy: RowDetailPolicy<Field, Value>, order?: ReturnType<typeof orderRowDetails<Field, Value>>,
  repairs?: ReadonlyMap<string, RowRepair<Value>>, queueDigest?: string) {
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
    const proofIds = policy.proofRowId && new Map([...current.keys()].map(rowId => [proofRowId(policy, rowId), rowId]));
    const updated = [...current].flatMap(([rowId, value]): Proof[] => {
      const born = births.get(rowId);
      const proofId = proofRowId(policy, rowId);
      if (value === undefined || born === undefined || !boundedRowId(proofId) || !metadata.operationId) return [];
      const scope = currentScopes?.get(rowId);
      const stamp = stamps.get(rowId);
      const time = stamp?.rowCreatedAt === born && equalValues(stamp.after, value) ? stamp.time : null;
      const changed = !equalValues(previous.get(rowId), value) || previousBirths.get(rowId) !== born;
      const repair = repairs?.get(rowId);
      if (repair && !time && previousBirths.get(rowId) === born && equalValues(previous.get(rowId), repair.before)
        && equalValues(repair.after, value)) {
        const source = digest(born, repair.before, previousScopes?.get(rowId));
        const prior = stored.values.find(proof => proof.rowId === proofId && proof.digest === source && proof.revision < metadata.revision);
        const repairs = [{ digest: source, revision: metadata.revision }, ...(prior?.repairs ?? []).filter(item => item.digest !== source)]
          .slice(0, MAX_REPAIR_SOURCES);
        return [{
          rowId: proofId, digest: digest(born, value, scope), revision: prior?.revision ?? metadata.revision - 1,
          operationId: prior?.operationId ?? metadata.operationId, time: prior?.time ?? null,
          ...(prior?.causal && { causal: true }), repairs,
        }];
      }
      const oldScope = previousScopes?.get(rowId);
      const scopeChanged = !equalValues(oldScope, scope);
      const enteredScope = policy.causalScopeEntry && scope !== undefined && oldScope === undefined;
      if (!time && !changed && !scopeChanged && !unordered.has(rowId)) return [];
      const oldValue = previousBirths.get(rowId) === born ? previous.get(rowId) : undefined;
      const remembersOpenings = policy.requireObserved || policy.rememberOpenings;
      const prior = remembersOpenings && oldValue !== undefined
        ? matchingProof(stored.values, proofId, born, oldValue, oldScope, metadata.revision - 1) : undefined;
      // A type change can make a new scoped proof without advancing the outcome itself.
      const valueRevision = policy.requireObserved ? (changed ? metadata.revision : prior?.valueRevision ?? prior?.revision ?? metadata.revision) : undefined;
      const hasOpening = policy.rememberOpenings ? previousBirths.get(rowId) === born : oldValue !== undefined;
      const reselected = Boolean(policy.allowUnchanged?.(field, value))
        && (Boolean(stamp && equalValues(stamp.before, stamp.after)) || unordered.has(rowId));
      const reaffirmed = policy.rememberReaffirmations && !changed && (Boolean(time) || unordered.has(rowId));
      const priorFrames = policy.seedOpeningFromStoredValue && !stored.floor && !prior && oldValue !== undefined && changed
        ? [digest(born, oldValue, oldScope)]
        : remembersOpenings ? nextPriorFrames(prior, hasOpening, changed || scopeChanged || reselected || reaffirmed === true) : undefined;
      const bound = policy.requireObserved && queueDigest && (changed || scopeChanged);
      // A coalesced value can make an older opening ambiguous without proving this request authored it.
      const causalRefresh = policy.rememberOpenings && (reselected || (reaffirmed && !unordered.has(rowId)));
      return [{ rowId: proofId, digest: digest(born, value, scope), revision: metadata.revision, time, operationId: metadata.operationId,
        ...(valueRevision && { valueRevision }), ...(priorFrames && { priorFrames }), ...(bound && { queueDigest }),
        ...(policy.allowUnclocked && (changed || enteredScope || bound || causalRefresh) && { causal: true as const }) }];
    });
    const newRows = new Set(updated.map(proof => proof.rowId));
    const retained = [...updated, ...stored.values.filter(proof => {
      const rowId = proofIds?.get(proof.rowId) ?? proof.rowId;
      const value = current.get(rowId), born = births.get(rowId);
      return value !== undefined && born !== undefined && !newRows.has(proof.rowId)
        && proof.digest === digest(born, value, currentScopes?.get(rowId));
    })];
    const floor = retained.slice(MAX_PROOFS).reduce((revision, proof) => Math.max(revision, proof.revision), stored.floor);
    return retained.length || floor ? [[field, { proofs: retained.slice(0, MAX_PROOFS), floor }]] : [];
  }));
  return { ...metadata, ...(Object.keys(proofs).length ? { [policy.proofs]: proofs } : {}) };
}
