import { equalValues } from './fieldValues';
import { matchesRowDetailBirth, rowDetailConflict } from './rowDetailAction';
import { needsLegacyRowDetailOpeningReview, orderRowDetails } from './rowDetailOrder.server';
import { alignOptionalRowField, boundedRowId, existingRowFields, isRowChange } from './rowFieldAction';
import { readRowObservation } from './rowFieldOrder.server';
import { SERVICE_ORDER_STEP_SCRIPTURE_POLICY as policy, SERVICE_ORDER_STEP_SCRIPTURE_TARGET as target } from './serviceOrderStepAction';

import type { ConflictDetail, DataCommand, ResourceSnapshot } from './types';

const field = 'scriptureRefs';

export function orderServiceStepScripture(command: DataCommand, current: ResourceSnapshot, raw: unknown, serverMs: number) {
  const ordered = orderRowDetails(command, current, raw, serverMs, policy);
  if (command.kind !== 'update' || ordered.command.kind !== 'update' || command.resource.collection !== policy.collection
    || !current.value || !current.metadata || current.metadata.deleted || command.generation !== current.metadata.generation) return ordered;
  const change = command.changes.find(item => isRowChange(item, target));
  if (!change) return ordered;
  const submission = command.serviceOrderStepScriptureActions?.scriptureRefs;
  const observation = readRowObservation(command, submission, target, serverMs, { allowUnclocked: true });
  const valid = observation && submission && observation.observedRevision <= current.metadata.revision
    && matchesRowDetailBirth(command.changes, submission, policy.birth);
  const uncertain: ConflictDetail[] = [];
  const opening = existingRowFields(change.before.value, target);
  const proposed = existingRowFields(change.after.value, target);
  const saved = existingRowFields(current.value.steps, target);
  const openingBirths = existingRowFields(change.before.value, policy.birth);
  const savedBirths = existingRowFields(current.value.steps, policy.birth);
  for (const [rowId, before] of opening) {
    if (!boundedRowId(rowId) || before === undefined || (valid && observation.rowId === rowId)) continue;
    const after = proposed.get(rowId), born = openingBirths.get(rowId), stored = saved.get(rowId);
    if (!born || after === undefined || equalValues(before, after) || !equalValues(before, stored)
      || savedBirths.get(rowId) !== born) continue;
    if (needsLegacyRowDetailOpeningReview(raw, policy, field, rowId, born, before, current.metadata.revision)) {
      // An older request has no revision to distinguish a return to the same displayed reference.
      uncertain.push(rowDetailConflict({ rowId, rowCreatedAt: born, before, after, time: null, observedRevision: 0 }, target, stored));
    }
  }
  return { ...ordered,
    command: valid ? alignOptionalRowField(ordered.command, current, target, observation.rowId) : ordered.command,
    uncertain: [...ordered.uncertain, ...uncertain],
  };
}
