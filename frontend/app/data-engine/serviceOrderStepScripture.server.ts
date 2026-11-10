import { AUTHORED_LIST_REVIEW } from './authoredStringList';
import { equalValues, object } from './fieldValues';
import { matchesRowDetailBirth, rowDetailConflict } from './rowDetailAction';
import { needsLegacyRowDetailOpeningReview, orderRowDetails, readRowDetailProof } from './rowDetailOrder.server';
import { alignOptionalRowField, boundedRowId, existingRowField, existingRowFields, isRowChange } from './rowFieldAction';
import { readRowObservation } from './rowFieldOrder.server';
import { acceptsServiceOrderStepId, SERVICE_ORDER_STEP_SCRIPTURE_LIST as list, SERVICE_ORDER_STEP_SCRIPTURE_POLICY as policy, SERVICE_ORDER_STEP_SCRIPTURE_TARGET as target } from './serviceOrderStepAction';

import type { RowDetailObservation } from './rowDetailAction';
import type { ConflictDetail, DataCommand, ResourceSnapshot } from './types';

const field = 'scriptureRefs';

export function readServiceStepScriptureObservations(command: Extract<DataCommand, { kind: 'update' }>, revision: number, serverMs: number) {
  const submitted = command.serviceOrderStepScriptureActions;
  const candidates: unknown[] = Array.isArray(submitted?.reviewed) ? submitted.reviewed : [submitted?.scriptureRefs];
  const observations = new Map<string, RowDetailObservation<string[]> | undefined>();
  for (const candidate of candidates) {
    if (!object(candidate) || typeof candidate.rowCreatedAt !== 'string') continue;
    const action = readRowObservation(command, candidate, list, serverMs, { allowUnclocked: true, acceptsRowId: acceptsServiceOrderStepId });
    if (!action || action.observedRevision > revision
      || !matchesRowDetailBirth(command.changes, { rowId: action.rowId, rowCreatedAt: candidate.rowCreatedAt }, policy.birth)) continue;
    observations.set(action.rowId, observations.has(action.rowId) ? undefined : {
      ...action, rowCreatedAt: candidate.rowCreatedAt,
      ...(typeof candidate.predecessorOperationId === 'string' && { predecessorOperationId: candidate.predecessorOperationId }),
    });
  }
  return observations;
}

export function orderServiceStepScripture(command: DataCommand, current: ResourceSnapshot, raw: unknown, serverMs: number,
  resolved: ReadonlySet<string>) {
  const row = command.kind === 'update' ? command.serviceOrderStepScriptureActions?.scriptureRefs?.rowId : undefined;
  const alreadyOrdered = row !== undefined && resolved.has(row);
  const pending = alreadyOrdered ? { ...command } : command;
  if (alreadyOrdered && pending.kind === 'update') delete pending.serviceOrderStepScriptureActions;
  const ordered = orderRowDetails(pending, current, raw, serverMs, policy);
  if (command.kind !== 'update' || ordered.command.kind !== 'update' || command.resource.collection !== policy.collection
    || !current.value || !current.metadata || current.metadata.deleted || command.generation !== current.metadata.generation) return ordered;
  const change = command.changes.find(item => isRowChange(item, target));
  if (!change) return ordered;
  const submission = command.serviceOrderStepScriptureActions?.scriptureRefs;
  const observation = readRowObservation(command, submission, target, serverMs, { allowUnclocked: true });
  const valid = observation && submission && observation.observedRevision <= current.metadata.revision
    && matchesRowDetailBirth(command.changes, submission, policy.birth);
  const uncertain: ConflictDetail[] = [];
  let adjusted = valid && !alreadyOrdered ? alignOptionalRowField(ordered.command, current, target, observation.rowId) : ordered.command;
  const reviewed = Array.isArray(command.serviceOrderStepScriptureActions?.reviewed)
    ? readServiceStepScriptureObservations(command, current.metadata.revision, serverMs) : undefined;
  const groupedComparison: ConflictDetail[] = [];
  let compareAgain = false;
  for (const action of reviewed?.values() ?? []) {
    if (!action) continue;
    const stored = existingRowField(current.value.steps, action.rowId, list);
    const born = existingRowField(current.value.steps, action.rowId, policy.birth);
    if (equalValues(stored, action.after) && born === action.rowCreatedAt) continue;
    const revision = current.metadata.revision;
    groupedComparison.push({ ...rowDetailConflict(action, list, stored), code: AUTHORED_LIST_REVIEW });
    const proof = action.observedRevision < revision && readRowDetailProof(raw, policy, field, action.rowId, action.rowCreatedAt, action.before, undefined, revision);
    if (born === action.rowCreatedAt && equalValues(stored, action.before)
      && (action.observedRevision === revision || (proof && proof.revision <= action.observedRevision))) {
      adjusted = alignOptionalRowField(adjusted, current, list, action.rowId);
    } else {
      compareAgain = true;
    }
  }
  // Keep the other selected rows attached if any row needs a new confirmation.
  if (compareAgain) uncertain.push(...groupedComparison);
  const opening = existingRowFields(change.before.value, target);
  const proposed = existingRowFields(change.after.value, target);
  const saved = existingRowFields(current.value.steps, target);
  const openingBirths = existingRowFields(change.before.value, policy.birth);
  const savedBirths = existingRowFields(current.value.steps, policy.birth);
  for (const [rowId, before] of opening) {
    if (reviewed?.get(rowId) || resolved.has(rowId) || !boundedRowId(rowId) || before === undefined || (valid && observation.rowId === rowId)) continue;
    const after = proposed.get(rowId), born = openingBirths.get(rowId), stored = saved.get(rowId);
    if (!born || after === undefined || equalValues(before, after) || !equalValues(before, stored)
      || savedBirths.get(rowId) !== born) continue;
    if (needsLegacyRowDetailOpeningReview(raw, policy, field, rowId, born, before, current.metadata.revision)) {
      // An older request has no revision to distinguish a return to the same displayed reference.
      uncertain.push(rowDetailConflict({ rowId, rowCreatedAt: born, before, after, time: null, observedRevision: 0 }, target, stored));
    }
  }
  return { ...ordered,
    command: adjusted,
    uncertain: [...ordered.uncertain, ...uncertain],
  };
}
