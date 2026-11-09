import { preparationConfirmationField } from '@/utils/preparationFieldValues';
import { applyScopedThoughtPlacement, completeStoredThoughtPlacement } from '@/utils/thoughtOrdering';

import { acceptsDocumentField, SERMON_PLAN_MODE } from './documentFieldAction';
import { exegeticalPlan, exegeticalPointConflictId, projectExegeticalPoint, readExegeticalPointChoice } from './exegeticalPointAction';
import { equalValues, object, readField, writeField } from './fieldValues';
import { mergeDocumentFields } from './protocol';
import { readThoughtLockConflict, thoughtLockConflictId } from './thoughtLockAction';
import { projectThoughtMoveFields, readThoughtPlacementChoice, thoughtPlacementConflictId } from './thoughtPlacementAction';
import { readThoughtTagChoice, restoreThoughtTag, thoughtTagIdentity } from './thoughtTagAction';

import type { SessionCheckpoint } from './session';
import type { ConflictDetail, DocumentData, FieldValue, Json, ResourceSnapshot } from './types';
import type { Sermon, ThoughtsBySection } from '@/models/models';

export function comparableSermonField(path: readonly string[]): boolean {
  return (path.length === 1 && (path[0] === 'verse' || path[0] === 'planMode'))
    || preparationConfirmationField(path) !== undefined || exegeticalPointConflictId(path) !== undefined
    || (path.length === 3 && path[0] === 'preachDates' && path[1].startsWith('id:') && path[2] === 'date');
}

export function comparableSermonFields(conflicts: readonly ConflictDetail[]): boolean {
  return conflicts.length > 0 && (conflicts.every(({ path }) => thoughtTagIdentity(path))
    || (conflicts.length === 1 && comparableSermonField(conflicts[0].path)));
}

export function readSermonPlanModeComparison(checkpoint: SessionCheckpoint) {
  const { confirmed, draft, remoteCandidate, conflicts, editGeneration } = checkpoint;
  if (confirmed.resource.collection !== 'sermons' || !draft || !remoteCandidate?.value || !confirmed.metadata
    || confirmed.metadata.generation !== remoteCandidate.metadata?.generation || conflicts.length !== 1
    || !equalValues(conflicts[0].path, SERMON_PLAN_MODE.path)) return undefined;
  const mine = readField(draft, SERMON_PLAN_MODE.path);
  const stored = readField(remoteCandidate.value, SERMON_PLAN_MODE.path);
  if (!acceptsDocumentField(mine, SERMON_PLAN_MODE) || !acceptsDocumentField(stored, SERMON_PLAN_MODE)
    || equalValues(mine, stored) || !equalValues(mine, conflicts[0].mine) || !equalValues(stored, conflicts[0].theirs)) return undefined;
  return { mine, stored, identity: JSON.stringify([editGeneration, remoteCandidate.metadata.generation,
    remoteCandidate.metadata.revision, mine, stored]) };
}

const isRow = (value: unknown, key: string) => object(value) && value.id === key.slice(3);

export function readSermonConflictField(data: DocumentData, path: string[]): FieldValue {
  const [field, id] = path;
  if ((field !== 'preachDates' && field !== 'thoughts') || !id) return readField(data, path);
  const rows = data[field];
  const row = Array.isArray(rows) ? rows.find(value => isRow(value, id)) : undefined;
  if (!object(row)) return { exists: false };
  return path.length === 2 ? { exists: true, value: row } : readField(row, path.slice(2));
}

function withField(data: DocumentData, field: string, selected: FieldValue): DocumentData {
  const next = { ...data };
  if (selected.exists && selected.value !== undefined) next[field] = selected.value;
  else delete next[field];
  return next;
}

function withSelectedField(data: DocumentData, path: string[], selected: FieldValue): DocumentData | undefined {
  if (path[0] === 'verse' || path[0] === 'planMode') return withField(data, path[0], selected);
  if (preparationConfirmationField(path)) return writeField(data, path, selected);
  const [field, id, leaf] = path;
  const rows = data[field];
  if (!Array.isArray(rows) || !rows.some(value => isRow(value, id))) return undefined;
  return { ...data, [field]: rows.map(value => object(value) && isRow(value, id) ? withField(value, leaf, selected) : value) };
}

function rebaseStoredThoughtPlacement(base: DocumentData, draft: DocumentData, stored: DocumentData,
  conflicts: readonly ConflictDetail[]) {
  const moves = new Map(conflicts.map(conflict => {
    const choice = readThoughtPlacementChoice(conflict, base, draft, stored);
    if (!choice) throw Object.assign(new Error('The shown field comparison changed'), { code: 'decision-changed' });
    const path = ['thoughts', 'id:' + choice.id];
    return [choice.id, {
      opening: readSermonConflictField(base, path).value as DocumentData,
      local: readSermonConflictField(draft, path).value as DocumentData,
      live: readSermonConflictField(stored, path).value as DocumentData,
    }] as const;
  }));
  const ids = [...moves.keys()];
  const project = (side: DocumentData): DocumentData => {
    const next = { ...side, thoughts: (side.thoughts as Json[]).map(row => {
      const move = object(row) && typeof row.id === 'string' ? moves.get(row.id) : undefined;
      if (!object(row) || !move) return row;
      const edited = projectThoughtMoveFields(row, move.opening, move.local, move.live);
      for (const key of ['outlinePointId', 'subPointId']) {
        if (move.live[key] === undefined) delete edited[key];
        else edited[key] = move.live[key];
      }
      return edited;
    }) };
    for (const key of ['structure', 'thoughtsBySection'] as const) {
      if (equalValues(base[key], draft[key])) continue;
      const live = object(stored[key]) ? stored[key] as unknown as ThoughtsBySection
        : completeStoredThoughtPlacement(stored as unknown as Sermon);
      if (!object(side[key]) && !object(stored[key])) continue;
      const current = object(side[key]) ? side[key] as unknown as ThoughtsBySection : live;
      (next as DocumentData)[key] = applyScopedThoughtPlacement(current, live, ids) as unknown as Json;
    }
    return next;
  };
  return { base: project(base), draft: project(draft) };
}

/** The saved side wins the reviewed field. Independent changes from the same Save still belong to the owner. */
export function keepUncontestedSermonFields(basis: ResourceSnapshot, draft: DocumentData | null, stored: ResourceSnapshot | null,
  conflicts: readonly ConflictDetail[]): DocumentData | undefined {
  if (basis.resource.collection !== 'sermons' || !conflicts.length) return undefined;
  const lockIds = conflicts.flatMap(({ path }) => thoughtLockConflictId(path) ?? []);
  const locksOnly = lockIds.length === conflicts.length;
  const placementsOnly = conflicts.every(({ path }) => thoughtPlacementConflictId(path));
  if (!locksOnly && !placementsOnly && !comparableSermonFields(conflicts)) return undefined;
  const changed = () => Object.assign(new Error('The shown field comparison changed'), { code: 'decision-changed' });
  if (!basis.value || !draft || !stored?.value || basis.metadata?.generation !== stored.metadata?.generation) throw changed();
  let opening = basis.value;
  let corrected: DocumentData | undefined;
  if (placementsOnly) {
    const projected = rebaseStoredThoughtPlacement(basis.value, draft, stored.value, conflicts);
    opening = projected.base;
    corrected = projected.draft;
  } else if (locksOnly) {
    corrected = draft;
    for (const id of lockIds) {
      if (!corrected || !readThoughtLockConflict(id, basis.value, draft, stored.value)) throw changed();
      const path = ['thoughts', 'id:' + id, 'isLocked'];
      corrected = withSelectedField(corrected, path, readSermonConflictField(stored.value, path));
    }
  } else if (conflicts.every(({ path }) => thoughtTagIdentity(path))) {
    corrected = draft;
    for (const conflict of conflicts) {
      const tag = readThoughtTagChoice(conflict, basis.value, draft, stored.value);
      // A replacement thought is a document choice, outside the exact tag comparison.
      if (!tag) return undefined;
      corrected = restoreThoughtTag(corrected, tag.rowId, tag.date, tag.tag, tag.mine, tag.stored);
    }
  } else {
    const path = conflicts[0].path;
    if (path[0] === 'preachDates' && !readSermonConflictField(stored.value, path.slice(0, 2)).exists) throw changed();
    const pointId = exegeticalPointConflictId(path);
    if (pointId) {
      const before = exegeticalPlan(basis.value.preparation), local = exegeticalPlan(draft.preparation), remote = exegeticalPlan(stored.value.preparation);
      if (!before || !local || !remote) throw changed();
      const choice = readExegeticalPointChoice(before, local, remote, pointId);
      if (!choice) throw changed();
      const projected = projectExegeticalPoint(draft.preparation, local, pointId, choice.before.ancestors, choice.saved);
      if (!projected) throw changed();
      corrected = writeField(draft, ['preparation'], projected);
    } else {
      corrected = withSelectedField(draft, path, readSermonConflictField(stored.value, path));
    }
  }
  if (!corrected) throw changed();
  const merged = mergeDocumentFields(opening, withField(corrected, 'updatedAt', readField(stored.value, ['updatedAt'])), stored.value);
  if (!merged.value.exists || merged.conflicts.length) throw changed();
  return merged.value.value as DocumentData;
}
