import { COUNCIL_OUTCOME, COUNCIL_OUTCOME_POLICY } from './councilOutcomeAction';
import { object } from './fieldValues';
import { orderRowDetails } from './rowDetailOrder.server';
import { existingRowFields } from './rowFieldAction';

import type { DataCommand, ResourceSnapshot } from './types';

export function orderCouncilOutcome(command: DataCommand, current: ResourceSnapshot, raw: unknown, serverMs: number) {
  const original = command.kind === 'update' && command.resource.collection === 'councils' ? command.changes.find(change => change.path.length === 1 && change.path[0] === 'topics') : undefined;
  if (command.kind !== 'update' || !original || !Array.isArray(command.councilOutcomeActions)) {
    return orderRowDetails(command, current, raw, serverMs, COUNCIL_OUTCOME_POLICY);
  }
  const openingOutcomes = existingRowFields(original.before.value, COUNCIL_OUTCOME);
  const writtenOutcomes = existingRowFields(original.after.value, COUNCIL_OUTCOME);
  const actions = command.councilOutcomeActions.flatMap(proof => {
    if (!object(proof) || typeof proof.rowId !== 'string') return [];
    const before = openingOutcomes.get(proof.rowId), after = writtenOutcomes.get(proof.rowId);
    return before && after ? [{ ...proof, before, after, time: null }] : [];
  });
  return orderRowDetails({ ...command, councilOutcomeActions: actions }, current, raw, serverMs, COUNCIL_OUTCOME_POLICY);
}
