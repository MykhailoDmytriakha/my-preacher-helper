import { councilOutcomeLogText } from '@/utils/councilTopicOutcome';

import { COUNCIL_OUTCOME, COUNCIL_OUTCOME_POLICY, readCouncilOutcome } from './councilOutcomeAction';
import { equalValues, object } from './fieldValues';
import { orderRowDetails } from './rowDetailOrder.server';
import { existingRowFields } from './rowFieldAction';

import type { DataCommand, DocumentData, FieldChange, Json, ResourceSnapshot } from './types';

const changesTopic = (change: FieldChange) => change.path.length === 1 && change.path[0] === 'topics';
const topicAt = (topics: Json | undefined, id: string) => Array.isArray(topics)
  ? topics.find((topic): topic is DocumentData => object(topic) && topic.id === id) : undefined;

function adjustedLog(opening: DocumentData, incoming: DocumentData, stored: DocumentData, won: boolean): Json | undefined {
  const before = opening.changes;
  const existing = Array.isArray(before) ? before : [];
  const written = incoming.changes;
  if ((before !== undefined && !Array.isArray(before)) || !Array.isArray(written) || written.length !== existing.length + 1
    || !equalValues(written.slice(0, -1), existing)) return written;
  const entry = written.at(-1);
  if (!object(entry) || entry.from !== councilOutcomeLogText(opening) || entry.to !== councilOutcomeLogText(incoming)
    || typeof entry.at !== 'string') return written;
  if (!won) return before;
  return [...existing, { ...entry, from: councilOutcomeLogText(stored) }];
}

export function orderCouncilOutcome(command: DataCommand, current: ResourceSnapshot, raw: unknown, serverMs: number) {
  const original = command.kind === 'update' && command.resource.collection === 'councils' ? command.changes.find(changesTopic) : undefined;
  if (command.kind !== 'update' || !original || !Array.isArray(command.councilOutcomeActions)) {
    return orderRowDetails(command, current, raw, serverMs, COUNCIL_OUTCOME_POLICY);
  }
  const openingOutcomes = existingRowFields(original.before.value, COUNCIL_OUTCOME);
  const writtenOutcomes = existingRowFields(original.after.value, COUNCIL_OUTCOME);
  const actions = command.councilOutcomeActions.flatMap(proof => {
    if (!object(proof) || typeof proof.rowId !== 'string') return [];
    const before = openingOutcomes.get(proof.rowId), after = writtenOutcomes.get(proof.rowId);
    return before && after ? [{ ...proof, before, after }] : [];
  });
  const order = orderRowDetails({ ...command, councilOutcomeActions: actions }, current, raw, serverMs, COUNCIL_OUTCOME_POLICY);
  if (!order.displaced.length || order.command.kind !== 'update') return order;
  const choices = new Map(order.displaced.map(displaced => [displaced.rowId, displaced]));
  const changes = order.command.changes.map(change => {
    if (!changesTopic(change) || !Array.isArray(change.after.value)) return change;
    const value = change.after.value.map(row => {
      if (!object(row) || typeof row.id !== 'string') return row;
      const choice = choices.get(row.id);
      if (!choice) return row;
      const opening = topicAt(original.before.value, row.id);
      const incoming = topicAt(original.after.value, row.id);
      const stored = topicAt(current.value?.topics, row.id);
      if (!opening || !incoming || !stored) return row;
      const history = adjustedLog(opening, incoming, stored, equalValues(readCouncilOutcome(incoming), choice.winnerValue));
      if (history !== undefined) return { ...row, changes: history };
      const { changes: _changes, ...outcome } = row;
      return outcome;
    });
    return { ...change, after: { ...change.after, value } };
  });
  return { ...order, command: { ...order.command, changes } };
}
