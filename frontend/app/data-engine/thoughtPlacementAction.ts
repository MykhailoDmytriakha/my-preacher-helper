import { normalizeStructureTag } from '@/utils/structureTags';

import { equalValues, object } from './fieldValues';
import { existingRowField } from './rowFieldAction';

import type { RowDetailHistoryEntry, RowDetailPolicy } from './rowDetailAction';
import type { RowFieldTarget } from './rowFieldAction';
import type { ConflictDetail, DataCommand, DocumentData, FieldValue, Json, ResourceSnapshot } from './types';

export type ThoughtLocation = { outlinePointId: string | null; subPointId: string | null };

const isLocationId = (value: unknown): value is string | null =>
  value === null || (typeof value === 'string' && value.length > 0 && value.length <= 1500);

export function isThoughtLocation(value: unknown): value is ThoughtLocation {
  return object(value) && Object.keys(value).length === 2 && isLocationId(value.outlinePointId)
    && isLocationId(value.subPointId) && (value.outlinePointId !== null || value.subPointId === null);
}

export function readThoughtLocation(row: DocumentData): ThoughtLocation | undefined {
  const value = { outlinePointId: row.outlinePointId ?? null, subPointId: row.subPointId ?? null };
  return isThoughtLocation(value) ? value : undefined;
}

const locationKeys = ['outlinePointId', 'subPointId'] as const;

const LOCATION: RowFieldTarget<ThoughtLocation> = {
  field: 'thoughts', leaf: 'outlineLocation', accepts: isThoughtLocation,
  projection: {
    read: readThoughtLocation,
    write: (row, value) => {
      const next = { ...row };
      for (const key of locationKeys) if ((row[key] ?? null) !== value[key]) next[key] = value[key];
      return next;
    },
  },
};

export const THOUGHT_PLACEMENT_POLICY: RowDetailPolicy<'outlineLocation', ThoughtLocation> = {
  collection: 'sermons', fields: ['outlineLocation'],
  birth: { field: 'thoughts', leaf: 'date', accepts: (value): value is string => typeof value === 'string' && value.length <= 128 },
  target: () => LOCATION,
  proofs: 'thoughtPlacementProofs', actions: 'thoughtPlacementActions', history: '_thoughtPlacementHistory',
  repeatedFields: ['outlineLocation'], allowUnclocked: true, allowUnchanged: () => true, atomicChoice: true,
};

export function thoughtPlacementConflictId(path: readonly string[]): string | undefined {
  if (path.length !== 3 || path[0] !== LOCATION.field || path[2] !== LOCATION.leaf || !path[1].startsWith('id:')) return;
  return path[1].slice(3);
}

export function isThoughtPlacementPart(path: readonly string[], id: string): boolean {
  return path.length === 3 && path[0] === LOCATION.field && path[1] === 'id:' + id
    && locationKeys.some(key => key === path[2]);
}

export function readThoughtPlacementChoice(conflict: ConflictDetail, base: DocumentData, draft: DocumentData, stored: DocumentData) {
  const id = thoughtPlacementConflictId(conflict.path);
  if (!id) return;
  const { birth, target } = THOUGHT_PLACEMENT_POLICY;
  const born = existingRowField(base.thoughts, id, birth);
  if (born === undefined || existingRowField(draft.thoughts, id, birth) !== born
    || existingRowField(stored.thoughts, id, birth) !== born) return;
  const opening = existingRowField(base.thoughts, id, target('outlineLocation'));
  const mine = existingRowField(draft.thoughts, id, target('outlineLocation'));
  const theirs = existingRowField(stored.thoughts, id, target('outlineLocation'));
  if (!opening || !mine || !theirs || equalValues(mine, theirs)) return;
  if (![conflict.base, conflict.mine, conflict.theirs].every(field => field.exists)
    || !equalValues(opening, conflict.base.value) || !equalValues(mine, conflict.mine.value)
    || !equalValues(theirs, conflict.theirs.value)) return;
  return { id, mine, stored: theirs };
}

export function localThoughtPlacementChoices(conflicts: readonly ConflictDetail[], base: DocumentData | null,
  draft: DocumentData | null, stored: DocumentData | null): ReadonlySet<string> | undefined {
  if (!base || !draft || !stored) return;
  const selected = conflicts.flatMap(conflict => {
    const choice = readThoughtPlacementChoice(conflict, base, draft, stored);
    return choice ? [choice.id] : [];
  });
  return selected.length ? new Set(selected) : undefined;
}

export type ThoughtPlacementHistoryPage = {
  owner: string; sermonId: string; generation: string; nextCursor: string | null;
  entries: { id: string; acceptedAt: string; fields: RowDetailHistoryEntry<'outlineLocation', ThoughtLocation>[] }[];
};

/** Normalize absent legacy links only on the captured thought, using the actual stored spelling. */
export function alignThoughtPlacementRepresentation(command: DataCommand, current: ResourceSnapshot): DataCommand {
  if (command.kind !== 'update' || command.resource.collection !== 'sermons' || !Array.isArray(command.thoughtPlacementActions) || !command.thoughtPlacementActions.length
    || !Array.isArray(current.value?.thoughts)) return command;
  const captured = new Set(command.thoughtPlacementActions.map(action => action?.rowId));
  const stored = new Map(current.value.thoughts.flatMap(row => object(row) && typeof row.id === 'string' && captured.has(row.id) ? [[row.id, row]] : []));
  const align = (side: FieldValue): FieldValue => {
    if (!Array.isArray(side.value)) return side;
    return { ...side, value: side.value.map(row => {
      const live = object(row) && typeof row.id === 'string' ? stored.get(row.id) : undefined;
      if (!object(row) || !live) return row;
      const next = { ...row };
      for (const key of locationKeys) {
        if (!equalValues(row[key] ?? null, live[key] ?? null)) continue;
        if (live[key] === undefined) delete next[key];
        else next[key] = live[key];
      }
      return next;
    }) };
  };
  return { ...command, changes: command.changes.map(change => change.path.length === 1 && change.path[0] === LOCATION.field
    ? { ...change, before: align(change.before), after: align(change.after) } : change) };
}

const isStructureTag = (tag: Json) => typeof tag === 'string' && normalizeStructureTag(tag) !== null;
const tagsOf = (row: DocumentData): Json[] => Array.isArray(row.tags) ? row.tags : [];

export function projectThoughtMoveFields(row: DocumentData, before: DocumentData, after: DocumentData, live: DocumentData): DocumentData {
  const next = { ...row };
  if (!equalValues(before.position, after.position)) {
    if (live.position === undefined) delete next.position;
    else next.position = live.position;
  }
  const structural = tagsOf(live).filter(isStructureTag);
  if (!equalValues(tagsOf(before).filter(isStructureTag), tagsOf(after).filter(isStructureTag))) {
    next.tags = [...tagsOf(row).filter(tag => !isStructureTag(tag)), ...structural];
  }
  return next;
}
