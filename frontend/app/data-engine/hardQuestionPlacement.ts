import { boundedActionTime } from './actionClock';
import { equalValues, object, readField, writeField } from './fieldValues';

import type { ActionTime } from './actionClock';
import type { SessionCheckpoint } from './session';
import type { ConflictDetail, DocumentData, FieldChange, ResourceSnapshot } from './types';

export const HARD_QUESTION_PLACEMENT_UNAVAILABLE = 'hard-question-placement-unavailable';
export const HARD_QUESTION_PLACEMENT_REVIEW = 'hard-question-placement-review';
export const HARD_QUESTION_PLACEMENT_FIELDS = ['themeId', 'groupId', 'rank'] as const;
type PlacementField = typeof HARD_QUESTION_PLACEMENT_FIELDS[number];
export type HardQuestionPlace = { themeId: string | null; groupId: string | null; rank: number };
export type HardQuestionPlacementOpening = { place: HardQuestionPlace; observedRevision: number };
export type HardQuestionPlacement = { before: HardQuestionPlace; after: HardQuestionPlace; observedRevision: number; time: ActionTime | null;
  predecessorOperationId?: string; reviewed?: true };

const identifier = (value: unknown) => typeof value === 'string' && value.length > 0 ? value : null;
const asField = (value: HardQuestionPlace[PlacementField]) => value === null
  ? { exists: false as const } : { exists: true as const, value };

export function readHardQuestionPlace(document: DocumentData | null | undefined): HardQuestionPlace | undefined {
  if (!document || typeof document.rank !== 'number' || !Number.isFinite(document.rank)) return;
  const themeId = identifier(document.themeId);
  return { themeId, groupId: themeId ? identifier(document.groupId) : null, rank: document.rank };
}

export function isHardQuestionPlace(value: unknown): value is HardQuestionPlace {
  return object(value) && (value.themeId === null || identifier(value.themeId) !== null)
    && (value.groupId === null || (value.themeId !== null && identifier(value.groupId) !== null))
    && typeof value.rank === 'number' && Number.isFinite(value.rank);
}

export function projectHardQuestionPlace(document: DocumentData, place: HardQuestionPlace): DocumentData {
  const previous = readHardQuestionPlace(document);
  const placed = HARD_QUESTION_PLACEMENT_FIELDS.reduce((value, field) => writeField(value, [field], asField(place[field])), document);
  // Bases belong to the theme the question is leaving. Choosing a group in the same theme never edits them.
  return previous?.themeId !== place.themeId ? writeField(placed, ['basisIds'], { exists: false }) : placed;
}

export function hardQuestionPlacementField(path: readonly string[]): path is [PlacementField] {
  return path.length === 1 && HARD_QUESTION_PLACEMENT_FIELDS.some(field => field === path[0]);
}

export function hardQuestionPlaceParts(change: readonly FieldChange[]): FieldChange[] {
  return change.filter(({ path }) => hardQuestionPlacementField(path));
}

export function matchesHardQuestionPlacement(changes: readonly FieldChange[], move: HardQuestionPlacement): boolean {
  const parts = hardQuestionPlaceParts(changes);
  return parts.length > 0 && HARD_QUESTION_PLACEMENT_FIELDS.every(field => {
    const part = parts.find(item => item.path[0] === field);
    return part ? equalValues(part.before, asField(move.before[field])) && equalValues(part.after, asField(move.after[field]))
      : move.before[field] === move.after[field];
  });
}

export function captureHardQuestionPlacement(baseline: ResourceSnapshot, opening: DocumentData | null, draft: DocumentData | null,
  captured: ActionTime | null | undefined, previous?: { id: string; move: HardQuestionPlacement }, reviewed?: true,
  seen?: HardQuestionPlacementOpening): HardQuestionPlacement | undefined {
  if (baseline.resource.collection !== 'hardQuestions' || !baseline.metadata || baseline.metadata.deleted || captured === undefined) return;
  if (seen && (!Number.isSafeInteger(seen.observedRevision) || seen.observedRevision < 1 || seen.observedRevision > baseline.metadata.revision)) {
    throw Object.assign(new Error('The question placement opening changed'), { code: 'decision-changed' });
  }
  const before = seen?.place ?? readHardQuestionPlace(opening), after = readHardQuestionPlace(draft);
  const time = captured === null ? null : boundedActionTime(captured);
  if (!before || !after || time === undefined || (!reviewed && equalValues(before, after))) return;
  return { before, after, time, observedRevision: seen?.observedRevision ?? baseline.metadata.revision,
    ...(previous && equalValues(previous.move.after, before) && { predecessorOperationId: previous.id }), ...(reviewed && { reviewed }) };
}

export function hardQuestionPlacementConflict(before: HardQuestionPlace, mine: HardQuestionPlace, saved: HardQuestionPlace,
  unavailable = false): ConflictDetail {
  return { code: unavailable ? HARD_QUESTION_PLACEMENT_UNAVAILABLE : HARD_QUESTION_PLACEMENT_REVIEW, path: ['themeId'], base: { exists: true, value: before },
    mine: { exists: true, value: mine }, theirs: { exists: true, value: saved } };
}

export function readHardQuestionPlacementConflict(conflicts: readonly ConflictDetail[]) {
  const item = conflicts.find(conflict => conflict.code === HARD_QUESTION_PLACEMENT_REVIEW || conflict.code === HARD_QUESTION_PLACEMENT_UNAVAILABLE);
  if (!item || !isHardQuestionPlace(item.base.value) || !isHardQuestionPlace(item.mine.value) || !isHardQuestionPlace(item.theirs.value)) return;
  return { opening: item.base.value, mine: item.mine.value, saved: item.theirs.value,
    unavailable: item.code === HARD_QUESTION_PLACEMENT_UNAVAILABLE };
}

export function preserveHardQuestionPlacementComparison(checkpoint: SessionCheckpoint, conflicts: ConflictDetail[], saved: ResourceSnapshot) {
  if (saved.resource.collection !== 'hardQuestions' || !Object.keys(checkpoint.pending).length
    || checkpoint.confirmed.metadata?.generation !== saved.metadata?.generation) return conflicts;
  const comparison = readHardQuestionPlacementConflict(checkpoint.conflicts);
  const current = readHardQuestionPlace(saved.value);
  if (!comparison || !current) return conflicts;
  // A separately accepted answer or basis link cannot answer the question about its place.
  return [...conflicts.filter(({ path }) => !hardQuestionPlacementField(path)),
    hardQuestionPlacementConflict(comparison.opening, comparison.mine, current, comparison.unavailable)];
}

export function applyHardQuestionPlaceChanges(document: DocumentData, parts: readonly FieldChange[], side: 'before' | 'after') {
  return readHardQuestionPlace(parts.reduce((value, part) => writeField(value, part.path, part[side]), document));
}

export function hardQuestionPlaceDelta(document: DocumentData, place: HardQuestionPlace) {
  const next = projectHardQuestionPlace(document, place);
  const fields = [...HARD_QUESTION_PLACEMENT_FIELDS, ...(readField(document, ['themeId']).value !== place.themeId ? ['basisIds'] : [])];
  return fields.flatMap(field => {
    const path = [field], before = readField(document, path), after = readField(next, path);
    return equalValues(before, after) ? [] : [{ path, before, after }];
  });
}
