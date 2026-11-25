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

/** Placing and editing words of the same note are separate actions. */
export function sameScratchNoteWords(stored: Json | ScratchNote | undefined, note: Json | ScratchNote | undefined): boolean {
  return object(stored) && object(note) && typeof stored.createdAt === 'string' && stored.createdAt.length > 0
    && stored.createdAt === note.createdAt && typeof stored.text === 'string' && stored.text === note.text;
}

export function appendedSketches(before: DocumentData, after: DocumentData) {
  const opening = sketchRows(before), result = sketchRows(after);
  if (!opening || !result || result.length <= opening.length
    || !equalValues(result.slice(0, opening.length), opening)) return;
  return result.slice(opening.length);
}

export function exactAmendedScratchAppend(before: DocumentData | null, after: DocumentData | null): ScratchNote | undefined {
  if (!before || !after || !equalValues(restoreSketchFrame(after, before), before)) return;
  const [note, extra] = appendedSketches(before, after) ?? [];
  if (!extra) return note;
}
