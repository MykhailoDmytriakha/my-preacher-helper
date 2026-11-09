import { findPointSection } from '@/utils/outlineDnd';
import { replaceSermonOutline } from '@/utils/sermonThoughtEdits';
import { normalizeStructureTag } from '@/utils/structureTags';
import { applyScopedThoughtPlacement, completeStoredThoughtPlacement, removeThoughtIdFromStructure } from '@/utils/thoughtOrdering';

import { equalValues, object, readField } from './fieldValues';
import { diffFields, mergeDocumentFields, mergeFields } from './protocol';
import { matchesRowDetailBirth, rowDetailConflict } from './rowDetailAction';
import { boundedRowId, matchesRowAction } from './rowFieldAction';
import { isThoughtLocation, projectThoughtMoveFields, readThoughtLocation, THOUGHT_PLACEMENT_POLICY } from './thoughtPlacementAction';

import type { ThoughtLocation } from './thoughtPlacementAction';
import type { ConflictDetail, DataCommand, DocumentData, FieldChange, FieldValue, Json, ResourceSnapshot } from './types';
import type { Sermon, SermonOutline, ThoughtsBySection } from '@/models/models';

type Update = Extract<DataCommand, { kind: 'update' }>;
type Row = DocumentData & { id: string; date: string };
type Repair = { before: ThoughtLocation; after: ThoughtLocation };
type Projection = { before: Row; after: Row; effect: { before: Row; after: Row } };
const sections = ['introduction', 'main', 'conclusion'] as const;
const locationKeys = ['outlinePointId', 'subPointId'] as const;
const boardFields = ['structure', 'thoughtsBySection'] as const;
const target = THOUGHT_PLACEMENT_POLICY.target('outlineLocation');
const thoughtRows = (value: unknown): value is Row[] => Array.isArray(value) && value.every(row =>
  object(row) && boundedRowId(row.id) && typeof row.date === 'string' && Array.isArray(row.tags) && row.tags.every(tag => typeof tag === 'string'));
const pointRows = (value: unknown): boolean => Array.isArray(value) && value.every(point => object(point) && typeof point.id === 'string'
  && (point.subPoints === undefined || (Array.isArray(point.subPoints) && point.subPoints.every(sub => object(sub) && typeof sub.id === 'string'))));
const outlineValue = (value: unknown): value is DocumentData => object(value)
  && sections.every(section => value[section] === undefined || pointRows(value[section]));
const byId = (rows: readonly Row[]) => new Map(rows.map(row => [row.id, row]));
const value = (data: Json): FieldValue => ({ exists: true, value: data });

function canonicalRepair(document: DocumentData, after: DocumentData): DocumentData {
  return replaceSermonOutline(document as unknown as Sermon, after as unknown as SermonOutline) as unknown as DocumentData;
}

function changedLinks(before: Row, after: Row): Repair | undefined {
  const opening = readThoughtLocation(before), repaired = readThoughtLocation(after);
  return opening && repaired && !equalValues(opening, repaired) ? { before: opening, after: repaired } : undefined;
}

function structureTags(row: Row) {
  return (row.tags as string[]).map(normalizeStructureTag).filter(Boolean);
}

function changedPlacement(before: Row, after: Row, oldOutline: DocumentData, newOutline: DocumentData): boolean {
  if (changedLinks(before, after)) return true;
  if (typeof before.outlinePointId !== 'string') return false;
  return findPointSection(oldOutline as unknown as SermonOutline, before.outlinePointId)
    !== findPointSection(newOutline as unknown as SermonOutline, before.outlinePointId);
}

function matchesAutomaticPlacement(opening: Row, proposed: Row, repaired: Row, before: DocumentData, after: DocumentData): boolean {
  return equalValues(readThoughtLocation(proposed), readThoughtLocation(repaired)) &&
    (Boolean(changedLinks(opening, repaired))
      || (changedPlacement(opening, repaired, before, after) && equalValues(structureTags(proposed), structureTags(repaired))));
}

function authoredActions(command: Update) {
  const stamped = Array.isArray(command.thoughtPlacementActions) ? command.thoughtPlacementActions : [];
  return stamped.filter(action => object(action) && boundedRowId(action.rowId)
    && isThoughtLocation(action.before) && isThoughtLocation(action.after)
    && THOUGHT_PLACEMENT_POLICY.birth.accepts(action.rowCreatedAt)
    && matchesRowDetailBirth(command.changes, action, THOUGHT_PLACEMENT_POLICY.birth)
    && matchesRowAction(command.changes, action, target));
}

function couldBeLegacyCleanup(before: DocumentData, after: DocumentData, location: ThoughtLocation): boolean {
  if (location.subPointId !== null) return false;
  const points = (outline: DocumentData) => sections.flatMap(section =>
    Array.isArray(outline[section]) ? (outline[section] as Json[]).filter(object) : []);
  const current = new Map(points(after).map(point => [point.id, point]));
  return points(before).some(point => {
    const surviving = current.get(point.id);
    if (location.outlinePointId === null) return !surviving;
    if (point.id !== location.outlinePointId || !surviving || !Array.isArray(point.subPoints)) return false;
    const retained = new Set(Array.isArray(surviving.subPoints) ? surviving.subPoints.filter(object).map(sub => sub.id) : []);
    return point.subPoints.filter(object).some(sub => !retained.has(sub.id));
  });
}

function projectRow(row: Row, projection: Projection, chosen: Row): Row {
  const next = projectThoughtMoveFields(row, projection.effect.before, projection.effect.after, chosen) as Row;
  for (const key of locationKeys) {
    if (chosen[key] === undefined) delete next[key];
    else next[key] = chosen[key];
  }
  return next;
}

function projectRows(side: FieldValue, projections: ReadonlyMap<string, Projection>, after: boolean, appended: readonly Row[]): FieldValue {
  if (!thoughtRows(side.value)) return side;
  const rows = side.value.map(row => {
    const projected = projections.get(row.id);
    return projected && projected.before.date === row.date ? projectRow(row, projected, after ? projected.after : projected.before) : row;
  });
  return value([...rows, ...appended.map(row => after ? projections.get(row.id)!.after : row)]);
}

function projectBoard(change: FieldChange | undefined, field: typeof boardFields[number], live: DocumentData,
  repaired: DocumentData, ids: readonly string[], deleted: readonly string[]): FieldChange | undefined {
  const rawBefore = readField(live, [field]), rawAfter = readField(repaired, [field]);
  if (!change) return equalValues(rawBefore, rawAfter) ? undefined : { path: [field], before: rawBefore, after: rawAfter };
  const project = (side: FieldValue, document: DocumentData): FieldValue => {
    if (!object(side.value)) return side;
    const stored = document[field];
    const desired = object(stored) ? stored as unknown as ThoughtsBySection : completeStoredThoughtPlacement(document as unknown as Sermon);
    const projected = applyScopedThoughtPlacement(side.value as unknown as ThoughtsBySection, desired, ids);
    return value(deleted.reduce((board, id) => removeThoughtIdFromStructure(board, id), projected) as unknown as Json);
  };
  // An opening alias that did not exist stays absent unless another writer actually introduced it.
  return { ...change, before: change.before.exists ? project(change.before, live) : rawBefore, after: project(change.after, repaired) };
}

/** Compute the automatic portion of an outline Save against the tree and thoughts that will be merged. */
export function prepareOutlinePlacementRepair(command: DataCommand, current: ResourceSnapshot) {
  const repairs = new Map<string, Repair>();
  const uncertain: ConflictDetail[] = [];
  const unchanged = { command, repairs, uncertain };
  const live = current.value;
  if (command.kind !== 'update' || command.outlinePointPlacement || command.resource.collection !== 'sermons' || !live || command.generation !== current.metadata?.generation
    || !outlineValue(live.outline) || !thoughtRows(live.thoughts)) return unchanged;
  const root = (field: string) => command.changes.find(change => change.path.length === 1 && change.path[0] === field);
  const outline = root('outline'), thought = root('thoughts');
  if (!outline || !outlineValue(outline.before.value) || !outlineValue(outline.after.value)
    || (thought && (!thoughtRows(thought.before.value) || !thoughtRows(thought.after.value)))) return unchanged;
  const merged = mergeFields(outline.before, outline.after, readField(live, ['outline']), ['outline']);
  if (merged.conflicts.length || !outlineValue(merged.value.value)) return unchanged;

  const openingOutline = outline.before.value, proposedOutline = outline.after.value, mergedOutline = merged.value.value;
  const openingRows = thoughtRows(thought?.before.value) ? thought.before.value : [];
  const proposedRows = thoughtRows(thought?.after.value) ? thought.after.value : [];
  const localAfter = byId(proposedRows);
  const canonicalLocal = byId(canonicalRepair({ ...live, outline: outline.before.value, thoughts: openingRows }, outline.after.value).thoughts as Row[]);
  const repaired = equalValues(live.outline, merged.value.value) ? live : canonicalRepair(live, merged.value.value);
  const liveAfter = byId(repaired.thoughts as Row[]);
  const localBefore = byId(openingRows);
  const actions = new Map(authoredActions(command).map(action => [action.rowId, action]));
  const projections = new Map<string, Projection>();
  const duplicateStamps = new Set<string>();

  for (const row of live.thoughts) {
    const opening = localBefore.get(row.id), proposed = localAfter.get(row.id);
    const materialized = liveAfter.get(row.id)!;
    if (opening && (!proposed || row.date !== opening.date || row.date !== proposed.date)) continue;
    const action = actions.get(row.id);
    const authored = opening && proposed && changedLinks(opening, proposed);
    const localRepair = opening && canonicalLocal.get(row.id);
    const automatic = opening && proposed && localRepair && !action && matchesAutomaticPlacement(opening, proposed, localRepair, openingOutline, proposedOutline);
    const projected = changedLinks(row, materialized);
    const legacyDuplicate = action && equalValues(action.before, action.after) && projected && equalValues(projected.after, action.after);
    if (action && !legacyDuplicate && equalValues(action.before, action.after) && isThoughtLocation(action.after)
      && couldBeLegacyCleanup(outline.before.value, outline.after.value, action.after)) {
      // This old envelope lost its opening link. Do not rank its timestamp against a surviving placement.
      duplicateStamps.add(row.id);
      const currentLocation = readThoughtLocation(row);
      if (currentLocation && !equalValues(currentLocation, action.after)) {
        uncertain.push(rowDetailConflict(action, target, currentLocation));
      }
    }
    if ((authored && !automatic) || (action && !legacyDuplicate)) continue;
    if (!automatic && !changedPlacement(row, materialized, live.outline, mergedOutline)) continue;
    if (legacyDuplicate) duplicateStamps.add(row.id);
    const effect = automatic && opening && localRepair ? { before: opening, after: localRepair } : { before: row, after: materialized };
    projections.set(row.id, { before: row, after: materialized, effect });
    if (projected) repairs.set(row.id, projected);
  }
  // A thought deleted after the editor opened stays deleted. Neutralize only its
  // automatic link delta so a separate text edit still reaches the usual conflict.
  const deleted = openingRows.flatMap(opening => {
    if (liveAfter.has(opening.id) || actions.has(opening.id)) return [];
    const proposed = localAfter.get(opening.id), projected = canonicalLocal.get(opening.id);
    if (!proposed || !projected || proposed.date !== opening.date || !matchesAutomaticPlacement(opening, proposed, projected, openingOutline, proposedOutline)) return [];
    projections.set(opening.id, { before: opening, after: opening, effect: { before: opening, after: projected } });
    return [opening.id];
  });
  if (!projections.size && !duplicateStamps.size) return unchanged;

  const appended = live.thoughts.filter(row => projections.has(row.id) && !localBefore.has(row.id) && !localAfter.has(row.id));
  const rowChange = thought ? { ...thought,
    before: projectRows(thought.before, projections, false, appended),
    after: projectRows(thought.after, projections, true, appended),
  } : { path: ['thoughts'], before: value(live.thoughts), after: value(live.thoughts.map(row => projections.get(row.id)?.after ?? row)) };
  const ids = [...projections.keys()];
  const boards = boardFields.flatMap(field => projectBoard(root(field), field, live, repaired, ids, deleted) ?? []);
  const placementRoot = (change: FieldChange) => change.path.length === 1
    && ['thoughts', ...boardFields].includes(change.path[0]);
  return { repairs, uncertain, command: { ...command, changes: [...command.changes.filter(change => !placementRoot(change)), rowChange, ...boards],
    ...(Array.isArray(command.thoughtPlacementActions) && { thoughtPlacementActions: command.thoughtPlacementActions.filter(action => !object(action) || !duplicateStamps.has(action.rowId)) }),
  } };
}


/** The device queue uses the same projection when an earlier Save returns a newer sermon. */
export function mergeOutlineAfterAcknowledgement(command: Omit<Update, 'changes'>, ancestor: DocumentData, draft: DocumentData, current: ResourceSnapshot) {
  const update = { ...command, changes: diffFields(ancestor, draft) };
  const prepared = prepareOutlinePlacementRepair(update, current);
  if (prepared.command === update || prepared.command.kind !== 'update') return;
  const before = { ...ancestor }, after = { ...draft };
  const project = (target: DocumentData, field: string, side: FieldValue) => {
    if (side.exists && side.value !== undefined) target[field] = side.value;
    else delete target[field];
  };
  for (const change of prepared.command.changes) {
    if (change.path.length !== 1) continue;
    project(before, change.path[0], change.before);
    project(after, change.path[0], change.after);
  }
  const merged = mergeDocumentFields(before, after, current.value);
  return { ...merged, conflicts: [...merged.conflicts, ...prepared.uncertain] };
}
