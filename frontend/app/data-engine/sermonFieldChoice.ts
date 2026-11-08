import { object, readField } from './fieldValues';
import { mergeDocumentFields } from './protocol';

import type { ConflictDetail, DocumentData, FieldValue, ResourceSnapshot } from './types';

export function comparableSermonField(path: readonly string[]): boolean {
  return (path.length === 1 && path[0] === 'verse')
    || (path.length === 3 && path[0] === 'preachDates' && path[1].startsWith('id:') && path[2] === 'date');
}

const isDateRow = (value: unknown, key: string) => object(value) && value.id === key.slice(3);

export function readSermonConflictField(data: DocumentData, path: string[]): FieldValue {
  if (path[0] !== 'preachDates' || path.length < 2) return readField(data, path);
  const row = Array.isArray(data.preachDates) ? data.preachDates.find(value => isDateRow(value, path[1])) : undefined;
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
  if (path[0] === 'verse') return withField(data, 'verse', selected);
  if (!Array.isArray(data.preachDates) || !data.preachDates.some(value => isDateRow(value, path[1]))) return undefined;
  return { ...data, preachDates: data.preachDates.map(value => object(value) && isDateRow(value, path[1]) ? withField(value, 'date', selected) : value) };
}

/** The saved side wins the reviewed field. Independent changes from the same Save still belong to the owner. */
export function keepUncontestedSermonFields(basis: ResourceSnapshot, draft: DocumentData | null, stored: ResourceSnapshot | null,
  conflicts: readonly ConflictDetail[]): DocumentData | undefined {
  if (basis.resource.collection !== 'sermons' || conflicts.length !== 1 || !comparableSermonField(conflicts[0].path)) return undefined;
  const changed = () => Object.assign(new Error('The shown field comparison changed'), { code: 'decision-changed' });
  if (!basis.value || !draft || !stored?.value || basis.metadata?.generation !== stored.metadata?.generation) throw changed();
  const path = conflicts[0].path;
  if (path[0] === 'preachDates' && !readSermonConflictField(stored.value, path.slice(0, 2)).exists) throw changed();
  const corrected = withSelectedField(draft, path, readSermonConflictField(stored.value, path));
  if (!corrected) throw changed();
  const merged = mergeDocumentFields(basis.value, withField(corrected, 'updatedAt', readField(stored.value, ['updatedAt'])), stored.value);
  if (!merged.value.exists || merged.conflicts.length) throw changed();
  return merged.value.value as DocumentData;
}
