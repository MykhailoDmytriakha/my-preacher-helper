import { getCanonicalTagForSection, normalizeStructureTag } from '@/utils/structureTags';
import { applyScopedThoughtPlacement, findThoughtSectionInStructure, insertThoughtIdInStructure, resolveSectionFromTags } from '@/utils/thoughtOrdering';

import { equalValues, object, readField } from './fieldValues';
import { outlineMoveProof } from './outlineMoveProof.server';
import { matchesRowDetailBirth } from './rowDetailAction';
import { existingRowField } from './rowFieldAction';
import { readRowObservation } from './rowFieldOrder.server';
import { THOUGHT_PLACEMENT_POLICY, thoughtOutlineDestinations } from './thoughtPlacementAction';

import type { ThoughtOutlineDestination } from './thoughtPlacementAction';
import type { DataCommand, DocumentData, FieldChange, FieldValue, Json, ResourceSnapshot } from './types';
import type { ThoughtsBySection } from '@/models/models';

const boardFields = ['structure', 'thoughtsBySection'] as const;
const { birth } = THOUGHT_PLACEMENT_POLICY;
const target = THOUGHT_PLACEMENT_POLICY.target('outlineLocation');
type Update = Extract<DataCommand, { kind: 'update' }>;
type Repair = { destination: ThoughtOutlineDestination; sectionChanged: boolean };
const rows = (value: unknown): DocumentData[] => Array.isArray(value) ? value.filter(object) : [];
const board = (value: unknown) => object(value) ? value as unknown as ThoughtsBySection : undefined;

function savedSection(id: string, stored: ThoughtsBySection | undefined, row: DocumentData) {
  return findThoughtSectionInStructure(stored, id) ?? resolveSectionFromTags(
    Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === 'string') : [],
  );
}

function projectRows(side: FieldValue, repairs: ReadonlyMap<string, Repair>, liveRows: ReadonlyMap<Json, DocumentData>, after: boolean): FieldValue {
  if (!Array.isArray(side.value)) return side;
  return { ...side, value: side.value.map(row => {
    if (!object(row) || typeof row.id !== 'string') return row;
    const repair = repairs.get(row.id);
    if (!repair) return row;
    const projected = after ? target.projection!.write(row, repair.destination.location) : { ...row };
    if (!repair.sectionChanged || !Array.isArray(row.tags)) return projected;
    const structural = (tag: Json) => typeof tag === 'string' && normalizeStructureTag(tag) !== null;
    const liveTags = liveRows.get(row.id)?.tags;
    const sectionTags = after ? [getCanonicalTagForSection(repair.destination.section)] : Array.isArray(liveTags) ? liveTags.filter(structural) : [];
    return { ...projected, tags: [...row.tags.filter(tag => !structural(tag)), ...sectionTags] };
  }) };
}

function projectBoard(change: FieldChange | undefined, field: typeof boardFields[number], current: DocumentData, repairs: ReadonlyMap<string, Repair>, authored: ReadonlySet<string>, otherOpening: FieldValue | undefined) {
  const liveField = readField(current, [field]);
  const live = board(liveField.value);
  const proposed = board(change?.after.value) ?? (!change ? live : undefined);
  if (!proposed) return change;
  const affected = [...repairs].filter(([, repair]) => repair.sectionChanged);
  if (!affected.length) return change;
  const opening = board(change?.before.value) ?? (change ? board(otherOpening?.value) : undefined);
  const projectedOpening = opening && live
    ? applyScopedThoughtPlacement(opening, live, affected.map(([id]) => id)) : undefined;
  const after = affected.reduce((value, [thoughtId, { destination }]) =>
    findThoughtSectionInStructure(value, thoughtId) === destination.section
      ? value : insertThoughtIdInStructure({ structure: value, section: destination.section, thoughtId }), proposed);
  if (change && !opening && live) {
    // Another write materialized the legacy alias. It owns every placement the
    // incoming Save did not explicitly author.
    return { ...change, before: liveField, after: { exists: true, value: applyScopedThoughtPlacement(live, after, [...authored]) as unknown as Json } };
  }
  return {
    path: [field],
    before: projectedOpening ? { exists: true, value: projectedOpening as unknown as Json } : change?.before ?? liveField,
    after: { exists: true, value: after as unknown as Json },
  };
}

/** Read the explicit choice from the original envelope, then point it at the same node in the live tree. */
export function repairThoughtDestinations(command: DataCommand, current: ResourceSnapshot, rawMetadata: unknown, serverMs: number): DataCommand {
  const live = current.value;
  const revision = current.metadata?.revision;
  if (command.kind !== 'update' || command.resource.collection !== 'sermons' || !live || revision === undefined
    || command.generation !== current.metadata?.generation || !Array.isArray(command.thoughtPlacementActions)) return command;
  const root = (field: string) => command.changes.find(change => change.path.length === 1 && change.path[0] === field);
  const thoughts = root('thoughts');
  if (!thoughts || root('outline')) return command;
  const before = new Map(rows(thoughts.before.value).map(row => [row.id, row]));
  const after = new Map(rows(thoughts.after.value).map(row => [row.id, row]));
  const liveRows = new Map(rows(live.thoughts).map(row => [row.id, row]));
  const primary = root('structure') ?? root('thoughtsBySection');
  const repairs = new Map<string, Repair>();
  const authored = new Set<string>();
  const actions = command.thoughtPlacementActions;
  const prove = outlineMoveProof(rawMetadata, thoughtOutlineDestinations(live.outline), revision);
  for (const raw of actions) {
    const observation = readRowObservation(command, raw, target, serverMs, { allowUnclocked: true, allowUnchanged: () => true });
    if (!observation || observation.observedRevision > revision || !object(raw) || !birth.accepts(raw.rowCreatedAt)
      || !matchesRowDetailBirth(command.changes, { ...observation, rowCreatedAt: raw.rowCreatedAt }, birth)
      || existingRowField(live.thoughts, observation.rowId, birth) !== raw.rowCreatedAt
      || actions.filter(other => object(other) && other.rowId === observation.rowId).length !== 1) continue;
    authored.add(observation.rowId);
    if (observation.observedRevision === revision) continue;
    const chosen = prove(observation.after, observation.observedRevision);
    const openingRow = before.get(observation.rowId), proposedRow = after.get(observation.rowId);
    if (!chosen || !openingRow || !proposedRow) continue;
    const { destination } = chosen;
    const source = prove(observation.before, observation.observedRevision);
    const openingSection = savedSection(observation.rowId, board(primary?.before.value), openingRow);
    const proposedSection = savedSection(observation.rowId, board(primary?.after.value), proposedRow);
    const movedBetweenSections = source && source.original.section !== source.destination.section;
    const sectionChanged = Boolean((movedBetweenSections && (openingSection !== source.destination.section || proposedSection !== destination.section))
      || (chosen.original.section !== destination.section && proposedSection !== destination.section));
    if (sectionChanged || !equalValues(destination.location, observation.after)) repairs.set(observation.rowId, { destination, sectionChanged });
  }
  if (!repairs.size) return command;
  const changes = command.changes.filter(change => change !== thoughts && !boardFields.some(field => root(field) === change));
  changes.push({ ...thoughts, before: projectRows(thoughts.before, repairs, liveRows, false), after: projectRows(thoughts.after, repairs, liveRows, true) });
  for (const field of boardFields) {
    const other = field === 'structure' ? 'thoughtsBySection' : 'structure';
    const projected = projectBoard(root(field), field, live, repairs, authored, root(other)?.before);
    if (projected) changes.push(projected);
  }
  return { ...command, changes, thoughtPlacementActions: actions.map(action => {
    const repair = object(action) ? repairs.get(action.rowId) : undefined;
    return repair ? { ...action, after: repair.destination.location } : action;
  }) } satisfies Update;
}
