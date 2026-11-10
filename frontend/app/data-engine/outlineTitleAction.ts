import { SECTION_KEYS } from '@/utils/outlineDnd';
import { outlineTitleConflictTarget, outlineTitleField, withOutlineTitleText } from '@/utils/sermonNoteText';

import { object } from './fieldValues';
import { outlinePlacementField } from './outlinePlacementResource';

import type { RowDetailHistoryEntry, RowDetailPolicy } from './rowDetailAction';
import type { ConflictDetail, DocumentData, FieldChange, Json } from './types';
import type { SermonOutline } from '@/models/models';

type Field = 'outline' | 'structure';
const string = (value: unknown): value is string => typeof value === 'string';

export const OUTLINE_TITLE_HISTORY = '_outlineTitleHistory';
export const OUTLINE_TITLE_REVIEW = 'outline-title-review';
export const OUTLINE_TITLE_SETTLED = 'outline-title-settled';
export const OUTLINE_TITLE_QUEUED = 'outline-title-queued';
export type OutlineTitleCollection = 'sermons' | 'planTemplates';
export type OutlineTitleHistoryPage = {
  owner: string;
  id: string;
  generation: string;
  entries: { id: string; acceptedAt: string; fields: RowDetailHistoryEntry<'text', string>[] }[];
  nextCursor: string | null;
};

export function outlineTitleRows(value: unknown): DocumentData[] {
  if (!object(value)) return [];
  return SECTION_KEYS.flatMap(section => {
    const points = value[section];
    return Array.isArray(points) ? points.flatMap(point => object(point)
      ? [point, ...(Array.isArray(point.subPoints) ? point.subPoints.filter(object) : [])] : []) : [];
  });
}

function replaceTitle(rows: Json | undefined, id: string, title: string): Json | undefined {
  return object(rows)
    ? (withOutlineTitleText(rows as unknown as SermonOutline, { kind: 'point', id }, title) as unknown as Json | undefined) ?? rows
    : rows;
}

export function outlineTitlePolicy(collection: string): RowDetailPolicy<'text', string> | undefined {
  const field = outlinePlacementField(collection);
  if (!field) return;
  return {
    collection, fields: ['text'], repeatedFields: ['text'], proofs: 'outlineTitleRows', actions: 'outlineTitleActions',
    acceptsRowId: (value): value is string => typeof value === 'string' && value.length > 0,
    birth: { field, leaf: 'id', accepts: string, container: { rows: outlineTitleRows, replace: rows => rows } },
    target: () => ({ field, leaf: 'text', accepts: string, container: { rows: outlineTitleRows, replace: replaceTitle } }),
    allowUnclocked: true, atomicChoice: true, rememberOpenings: true, allowUnchanged: () => true, history: OUTLINE_TITLE_HISTORY,
  };
}

export function outlineTitlePath(field: Field, id: string, outline: unknown): string[] | undefined {
  if (!object(outline)) return;
  return outlineTitleField(outline as unknown as SermonOutline, { kind: 'point', id }, field)?.path;
}

export function outlineTitleId(path: readonly string[], collection: string): string | undefined {
  return path[0] === outlinePlacementField(collection) ? outlineTitleConflictTarget(path)?.id : undefined;
}

export function outlineTitleChange(changes: readonly FieldChange[], field: Field): FieldChange | undefined {
  return changes.find(change => change.path.length === 1 && change.path[0] === field);
}

export function outlineTitleReview(path: string[], before: string, after: string, live: string): ConflictDetail {
  return { path, code: OUTLINE_TITLE_REVIEW, base: { exists: true, value: before },
    mine: { exists: true, value: after }, theirs: { exists: true, value: live } };
}
