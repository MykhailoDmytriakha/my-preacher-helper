import { mergeSections } from '@/utils/mergeSections';
import { applyScopedThoughtPlacement, completeStoredThoughtPlacement } from '@/utils/thoughtOrdering';

import { object } from './fieldValues';
import { orderRowDetails } from './rowDetailOrder.server';
import { replaceExistingRowField } from './rowFieldAction';
import { alignThoughtPlacementRepresentation, isThoughtLocation, projectThoughtMoveFields, THOUGHT_PLACEMENT_POLICY, thoughtPlacementConflictId } from './thoughtPlacementAction';

import type { ConflictDetail, DataCommand, DocumentData, FieldChange, FieldValue, Json, ResourceSnapshot } from './types';
import type { Sermon, ThoughtsBySection } from '@/models/models';

type Decision = { rowId: string; incomingWins: boolean };

function thought(rows: unknown, id: string): DocumentData | undefined {
  if (!Array.isArray(rows)) return;
  const row = rows.find(value => object(value) && value.id === id);
  return object(row) ? row : undefined;
}

function alignThoughtMove(original: FieldChange, ordered: FieldChange, live: DocumentData, decisions: readonly Decision[]): FieldChange {
  const byId = new Map(decisions.map(decision => [decision.rowId, decision]));
  const align = (side: FieldValue, after: boolean): FieldValue => {
    if (!Array.isArray(side.value)) return side;
    return { ...side, value: side.value.map(row => {
      const id = object(row) && typeof row.id === 'string' ? row.id : undefined;
      const decision = id ? byId.get(id) : undefined;
      if (!object(row) || !id || !decision || (after && decision.incomingWins)) return row;
      const opening = thought(original.before.value, id), target = thought(original.after.value, id), stored = thought(live.thoughts, id);
      return opening && target && stored ? projectThoughtMoveFields(row, opening, target, stored) : row;
    }) };
  };
  return { ...ordered, before: align(ordered.before, false), after: align(ordered.after, true) };
}

function openingBoard(command: Extract<DataCommand, { kind: 'update' }>, live: DocumentData): ThoughtsBySection {
  const opening = { ...live };
  for (const change of command.changes) {
    if (change.path.length !== 1) continue;
    const [key] = change.path;
    if (!['thoughts', 'outline', 'structure', 'thoughtsBySection'].includes(key)) continue;
    if (change.before.exists && change.before.value !== undefined) opening[key] = change.before.value;
    else delete opening[key];
  }
  return completeStoredThoughtPlacement(opening as unknown as Sermon);
}

function alignBoardMove(change: FieldChange, live: DocumentData, decisions: readonly Decision[],
  original: Extract<DataCommand, { kind: 'update' }>): FieldChange {
  const stored = live[change.path[0]];
  const current = object(stored) ? stored as unknown as ThoughtsBySection
    : completeStoredThoughtPlacement(live as unknown as Sermon);
  const align = (side: FieldValue, ids: readonly string[]): FieldValue => object(side.value) && ids.length
    ? { ...side, value: applyScopedThoughtPlacement(side.value as unknown as ThoughtsBySection, current, ids) as unknown as Json }
    : side;
  const ids = decisions.map(decision => decision.rowId);
  const losing = decisions.filter(decision => !decision.incomingWins).map(decision => decision.rowId);
  const after = align(change.after, losing);
  if (change.before.exists || !object(after.value)) return { ...change, before: align(change.before, ids), after };
  const before = applyScopedThoughtPlacement(openingBoard(original, live), current, ids);
  if (object(stored)) return { ...change, before: { exists: true, value: before as unknown as Json }, after };
  // When this alias was never stored, its virtual opening still distinguishes an independent
  // move in this Save from a section that changed elsewhere while it was offline.
  const merged = mergeSections(after.value as unknown as ThoughtsBySection, current, before);
  return { ...change, after: { ...after, value: merged as unknown as Json } };
}

/** Leave the disputed pair untouched while the planner checks the rest of the command. */
function withoutDisputedLocations(command: DataCommand, conflicts: readonly ConflictDetail[]): DataCommand {
  if (command.kind !== 'update' || !conflicts.length) return command;
  const target = THOUGHT_PLACEMENT_POLICY.target('outlineLocation');
  const align = (side: FieldValue): FieldValue => {
    let value = side.value;
    for (const conflict of conflicts) {
      const id = thoughtPlacementConflictId(conflict.path);
      if (id && conflict.theirs.exists && isThoughtLocation(conflict.theirs.value)) {
        value = replaceExistingRowField(value, id, conflict.theirs.value, target);
      }
    }
    return { ...side, value };
  };
  return { ...command, changes: command.changes.map(change => change.path.length === 1 && change.path[0] === target.field
    ? { ...change, before: align(change.before), after: align(change.after) } : change) };
}

/** Move-related board order follows the winning assignment, while other rows and words still merge normally. */
export function orderThoughtPlacement(command: DataCommand, current: ResourceSnapshot, raw: unknown, serverMs: number) {
  const order = orderRowDetails(command, current, raw, serverMs, THOUGHT_PLACEMENT_POLICY);
  const normalized = alignThoughtPlacementRepresentation(withoutDisputedLocations(order.command, order.uncertain), current);
  const decisions = (order.fields.get('outlineLocation') ?? []).flatMap(({ displaced, stamp, uncertain }): Decision[] => {
    if (displaced) return [{ rowId: displaced.rowId, incomingWins: Boolean(stamp) }];
    const disputed = uncertain && thoughtPlacementConflictId(uncertain.path);
    return disputed ? [{ rowId: disputed, incomingWins: false }] : [];
  });
  if (normalized.kind !== 'update' || command.kind !== 'update' || !current.value || !decisions.length) return { ...order, command: normalized };
  const live = current.value;
  const opening = command.changes.find(change => change.path.length === 1 && change.path[0] === 'thoughts');
  const changes = normalized.changes.map(change => {
    if (change.path.length !== 1) return change;
    if (change.path[0] === 'thoughts' && opening) return alignThoughtMove(opening, change, live, decisions);
    if (change.path[0] === 'structure' || change.path[0] === 'thoughtsBySection') return alignBoardMove(change, live, decisions, command);
    return change;
  });
  return { ...order, command: { ...normalized, changes } };
}
