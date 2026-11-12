import { isBibleId } from '@/utils/bibles';

import { commandFingerprint, equalValues, object, readField } from './fieldValues';

import type { ConflictDetail, DocumentData, FieldChange, FieldValue, StudyNoteReferenceAlias } from './types';

export const studyNoteReferencesPath = ['scriptureRefs'];
const REFERENCE_REVIEW = 'study-note-reference-review';
const REFERENCE_ROW_REVIEW = 'study-note-reference-row-review';

type ReferenceRow = DocumentData & { id: string };
export interface StudyNoteReferenceOrder {
  change(authoredId: string, stored: ReferenceRow): -1 | 0 | 1 | 'review';
  addition(authored: ReferenceRow): 'keep' | 'skip' | 'review' | { stored: ReferenceRow; chronology: -1 | 0 | 1 };
}

export function isOrdinaryReferenceDocument(value: DocumentData | null): value is DocumentData {
  return Boolean(value && (value.type === undefined || value.type === 'note' || value.type === 'question'));
}

/** Keep the references the person actually saw, even when an earlier ACK brings new neighbors. */
export function captureStudyNoteReferenceChange(base: DocumentData | null, mine: DocumentData | null): FieldChange | undefined {
  if (!isOrdinaryReferenceDocument(base) || !isOrdinaryReferenceDocument(mine)) return undefined;
  const before = readField(base, studyNoteReferencesPath), after = readField(mine, studyNoteReferencesPath);
  return equalValues(before, after) ? undefined : { path: studyNoteReferencesPath, before, after };
}

export function validStudyNoteReferenceAliases(value: unknown, validId: (id: unknown) => id is string): value is StudyNoteReferenceAlias[] {
  if (!Array.isArray(value)) return false;
  const retired = new Set<string>(), retained = new Set<string>();
  for (const entry of value) {
    if (!object(entry) || Object.keys(entry).length !== 2 || !validId(entry.from) || !validId(entry.to)
      || entry.from === entry.to || retired.has(entry.from)) return false;
    retired.add(entry.from);
    retained.add(entry.to);
  }
  return [...retained].every(id => !retired.has(id));
}

export function referenceRows(field: FieldValue): ReferenceRow[] | undefined {
  if (!field.exists) return [];
  if (!Array.isArray(field.value)) return undefined;
  const ids = new Set<string>();
  const rows: ReferenceRow[] = [];
  for (const value of field.value) {
    if (!object(value) || typeof value.id !== 'string' || ids.has(value.id)) return undefined;
    ids.add(value.id);
    rows.push(value as ReferenceRow);
  }
  return rows;
}

function authoredKey(row: ReferenceRow): string {
  const { id: _id, ...reference } = row;
  return commandFingerprint(reference);
}

function referenceField(original: FieldValue, rows: ReferenceRow[]): FieldValue {
  return original.exists ? { exists: true, value: rows } : original;
}

function indexById(rows: ReferenceRow[]): Map<string, ReferenceRow> {
  return new Map(rows.map(row => [row.id, row]));
}

/** A retained alias identifies a row. Its opening words still govern every later edit. */
export function alignStudyNoteReferenceChange(before: FieldValue, after: FieldValue, stored: FieldValue,
  aliases: readonly StudyNoteReferenceAlias[], order?: StudyNoteReferenceOrder): {
    before: FieldValue; after: FieldValue; review?: string[]; additions?: StudyNoteReferenceAlias[];
  } | null {
  if (!aliases.length && !order) return { before, after };
  const targets = new Map(aliases.map(({ from, to }) => [from, to]));
  const containsAlias = ({ value }: FieldValue) => Array.isArray(value) && value.some(row =>
    object(row) && typeof row.id === 'string' && targets.has(row.id));
  if (!order && !containsAlias(before) && !containsAlias(after)) return { before, after };
  const opening = referenceRows(before), local = referenceRows(after), accepted = referenceRows(stored);
  if (!opening || !local || !accepted) return null;
  const observed = indexById(opening), authored = indexById(local), saved = indexById(accepted);
  const canonicalOpening = new Set(opening.map(row => targets.get(row.id) ?? row.id));
  // An alias identifies the same place. Only action-time evidence can settle
  // an edit the other device's copy never observed.
  const review: string[] = [];
  const ordered = new Map<string, { stored: ReferenceRow; order: -1 | 1 }>();
  for (const row of opening) {
    const target = targets.get(row.id);
    const requested = authored.get(row.id);
    if (requested && authoredKey(row) === authoredKey(requested)) continue;
    const stored = saved.get(target ?? row.id);
    const chronology = stored && order?.change(row.id, stored);
    if (stored && (chronology === -1 || chronology === 1)) ordered.set(row.id, { stored, order: chronology });
    else if (target || chronology === 'review') review.push(target ?? row.id);
  }
  for (const row of local) {
    const target = targets.get(row.id);
    if (!target || observed.has(row.id)) continue;
    const live = saved.get(target);
    // An unobserved old identity can repeat the same live addition. It cannot
    // restore a removed row or overwrite words that were never shown to this editor.
    if (!live || authoredKey(live) !== authoredKey(row)) return null;
  }
  const rename = (rows: ReferenceRow[]) => rows.map(row => targets.has(row.id) ? { ...row, id: targets.get(row.id)! } : row);
  const alignedBefore = rename(opening), alignedAfter = rename(local);
  if (indexById(alignedBefore).size !== opening.length || indexById(alignedAfter).size !== local.length) return null;
  for (const { stored, order } of ordered.values()) {
    alignedBefore[alignedBefore.findIndex(row => row.id === stored.id)] = stored;
    if (order < 0) {
      const index = alignedAfter.findIndex(row => row.id === stored.id);
      if (index < 0) {
        const next = accepted.slice(accepted.indexOf(stored) + 1).find(neighbor => alignedAfter.some(row => row.id === neighbor.id));
        alignedAfter.splice(next ? alignedAfter.findIndex(row => row.id === next.id) : alignedAfter.length, 0, stored);
      } else alignedAfter[index] = stored;
    }
  }
  const additions: StudyNoteReferenceAlias[] = [];
  const kept = alignedAfter.flatMap(row => {
    if (!order || canonicalOpening.has(row.id) || saved.has(row.id)) return [row];
    const result = order.addition(row);
    if (result === 'keep') return [row];
    if (result === 'skip') return [];
    if (result === 'review') { review.push(row.id); return [row]; }
    const { stored, chronology } = result;
    if (canonicalOpening.has(stored.id) || alignedAfter.some(next => next.id === stored.id)) return [row];
    canonicalOpening.add(stored.id);
    alignedBefore.push(stored);
    if (!chronology) review.push(stored.id);
    else additions.push({ from: row.id, to: stored.id });
    return [chronology < 0 ? stored : { ...row, id: stored.id }];
  });
  return { before: referenceField(before, alignedBefore), after: referenceField(after, kept),
    ...(review.length && { review }), ...(additions.length && { additions }) };
}

function referenceRowId(path: readonly string[]): string | undefined {
  return path.length === 2 && path[0] === studyNoteReferencesPath[0] && path[1].startsWith('id:') ? path[1].slice(3) : undefined;
}

const rowValue = (row: ReferenceRow | undefined): FieldValue => row ? { exists: true, value: row } : { exists: false };

/** Keep the merged list alongside the exact rows that still need a decision. */
export function studyNoteReferenceReview(before: FieldValue, mine: FieldValue, stored: FieldValue,
  review: readonly string[], conflicts: ConflictDetail[], authored: FieldValue): ConflictDetail[] {
  const opening = referenceRows(before), projected = referenceRows(mine), saved = referenceRows(stored);
  if (!opening || !projected || !saved || conflicts.some(conflict => !referenceRowId(conflict.path))) return conflicts;
  const old = indexById(opening), local = indexById(projected), remote = indexById(saved);
  const ids = new Set([...review, ...conflicts.flatMap(({ path }) => referenceRowId(path) ?? [])]);
  const rows = [...ids].filter(id => !equalValues(local.get(id), remote.get(id))).map(id => ({
    path: [...studyNoteReferencesPath, 'id:' + id], code: REFERENCE_ROW_REVIEW,
    base: rowValue(old.get(id)), mine: rowValue(local.get(id)), theirs: rowValue(remote.get(id)),
  }));
  return rows.length ? [{ path: studyNoteReferencesPath, code: REFERENCE_REVIEW, base: before, mine, theirs: stored, studyNoteReferenceOpening: authored }, ...rows] : conflicts;
}

export function reviewedStudyNoteReferences(conflicts: readonly ConflictDetail[], stored?: FieldValue) {
  const review = conflicts.find(conflict => conflict.code === REFERENCE_REVIEW && equalValues(conflict.path, studyNoteReferencesPath));
  if (!review || stored && !equalValues(review.theirs, stored)) return undefined;
  stored = review.theirs;
  const projected = referenceRows(review.mine), saved = referenceRows(stored);
  if (!projected || !saved) return undefined;
  const byId = indexById(saved);
  const rows = conflicts.filter(conflict => conflict.code === REFERENCE_ROW_REVIEW);
  const ids = new Set(rows.flatMap(({ path }) => referenceRowId(path) ?? []));
  if (!ids.size || ids.size !== rows.length) return undefined;
  const storedChoice = projected.flatMap(row => ids.has(row.id) ? byId.get(row.id) ?? [] : row);
  const retained = new Set(storedChoice.map(row => row.id));
  for (let i = saved.length - 1; i >= 0; i -= 1) {
    const row = saved[i];
    if (!ids.has(row.id) || retained.has(row.id)) continue;
    const next = saved.slice(i + 1).find(item => retained.has(item.id));
    const at = next ? storedChoice.findIndex(item => item.id === next.id) : storedChoice.length;
    storedChoice.splice(at, 0, row);
    retained.add(row.id);
  }
  return { mine: review.mine, stored: referenceField(stored, storedChoice), rows, accepted: stored,
    authored: review.studyNoteReferenceOpening, fieldConflicts: conflicts.filter(conflict => conflict !== review && !rows.includes(conflict)) };
}

export function hasStudyNoteReferenceReview(conflicts: readonly ConflictDetail[]): boolean {
  return conflicts.some(conflict => conflict.code === REFERENCE_REVIEW);
}

function indexByWords(rows: ReferenceRow[]): Map<string, ReferenceRow[]> {
  const groups = new Map<string, ReferenceRow[]>();
  for (const row of rows) {
    if (!isBibleId(row.bible)) continue;
    const key = authoredKey(row);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

/** Retain the already saved row and its order when one new row repeats its complete authored value. */
export function coalesceStudyNoteReferences(before: FieldValue, after: FieldValue, stored: FieldValue, merged: FieldValue,
  known: readonly StudyNoteReferenceAlias[], validId: (id: unknown) => id is string): { value: FieldValue; aliases: StudyNoteReferenceAlias[] } {
  const opening = referenceRows(before), local = referenceRows(after), accepted = referenceRows(stored), result = referenceRows(merged);
  if (!opening || !local || !accepted || !result) return { value: merged, aliases: [] };
  const prior = indexById(opening), saved = indexById(accepted), final = indexById(result);
  const remoteWords = indexByWords(accepted), localWords = indexByWords(local);
  const knownIds = new Set(known.flatMap(({ from, to }) => [from, to]));
  const retiredIds = new Set(known.map(({ from }) => from));
  const aliases: StudyNoteReferenceAlias[] = [];
  for (const [key, group] of localWords) {
    // A repeated legacy group has no unique identity to absorb.
    const remote = remoteWords.get(key);
    if (remote?.length !== 1) continue;
    const kept = remote[0], retained = final.get(kept.id);
    const incoming = group.filter(row => !prior.has(row.id) && !saved.has(row.id));
    if (prior.has(kept.id) || incoming.length !== 1 || group.some(row => row !== incoming[0] && row.id !== kept.id)
      || !retained || authoredKey(retained) !== key) continue;
    const dropped = incoming[0];
    if (!final.has(dropped.id) || knownIds.has(dropped.id) || retiredIds.has(kept.id) || !validId(dropped.id) || !validId(kept.id)) continue;
    aliases.push({ from: dropped.id, to: kept.id });
  }
  if (!aliases.length) return { value: merged, aliases };
  const retired = new Set(aliases.map(alias => alias.from));
  return { value: referenceField(merged, result.filter(row => !retired.has(row.id))), aliases };
}
