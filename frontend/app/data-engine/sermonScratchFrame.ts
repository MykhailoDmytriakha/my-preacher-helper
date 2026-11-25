import { equalValues, object, readField, restoreStoredField } from './fieldValues';

import type { DocumentData, Json } from './types';
import type { ScratchNote } from '@/models/models';

export const scratchPath = ['scratch'] as const;

export function sketchRows(value: DocumentData): readonly ScratchNote[] | undefined {
  const field = readField(value, scratchPath);
  if (!field.exists) return [];
  const rows = field.value;
  if (!Array.isArray(rows) || !rows.every(row => object(row) && typeof row.id === 'string' && row.id
    && typeof row.text === 'string' && typeof row.createdAt === 'string' && row.createdAt)
    || new Set(rows.map(row => (row as DocumentData).id)).size !== rows.length) return;
  return rows as unknown as ScratchNote[];
}

export function withSketchRows(value: DocumentData, rows: readonly ScratchNote[]): DocumentData {
  return { ...value, scratch: rows as unknown as Json };
}

export const sameSketchFrame = (left: DocumentData, right: DocumentData): boolean =>
  equalValues(readField(left, scratchPath), readField(right, scratchPath));

export const restoreSketchFrame = (value: DocumentData, saved: DocumentData): DocumentData =>
  restoreStoredField(value, saved, scratchPath);
