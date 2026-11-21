import { preparationConfirmationField, preparationTextField } from '@/utils/preparationFieldValues';
import { outlineTitleConflictTarget, sermonNoteConflictTarget, sermonNoteConflictText, withSermonNoteText } from '@/utils/sermonNoteText';
import { applyScopedThoughtPlacement, completeStoredThoughtPlacement } from '@/utils/thoughtOrdering';

import { isSermonChurch } from './churchFieldValue';
import { existingRowDate, PREACH_DATE_TARGET } from './datedRowAction';
import { acceptsDocumentField, isOrderedSermonMetadata, SERMON_CHURCH_REVIEW_CHANGED, SERMON_GOAL_TYPE, SERMON_GOAL_TYPE_REVIEW_CHANGED, SERMON_METADATA_SETTLED, SERMON_PLAN_MODE, SERMON_VERSE_REVIEW_CHANGED } from './documentFieldAction';
import { exegeticalPlan, exegeticalPointConflictId, projectExegeticalPoint, readExegeticalPointChoice } from './exegeticalPointAction';
import { UNREADABLE_EXEGETICAL_PROOF } from './exegeticalPointCapture';
import { equalValues, object, readField, writeField } from './fieldValues';
import { projectOutlineParentChoice } from './outlineParentChoice';
import { keepUncontestedOutlineTitle } from './outlineTitleEdit';
import { isOrderedPreachDateField, preachDateChoiceFrames, withoutPreachDateRow } from './preachDateChoice';
import { preachDateNoteConflictId, samePreachDateRow } from './preachDateFieldAction';
import { mergeDocumentFields } from './protocol';
import { rebaseSermonChurchFill } from './sermonChurchFill';
import { isPlanCellPath } from './sermonTextOpenings';
import { readThoughtLockConflict, thoughtLockConflictId } from './thoughtLockAction';
import { projectThoughtMoveFields, readThoughtPlacementChoice, thoughtPlacementConflictId } from './thoughtPlacementAction';
import { readThoughtTagChoice, restoreThoughtTag, thoughtTagIdentity } from './thoughtTagAction';
import { readThoughtTextConflict, thoughtTextConflictId } from './thoughtTextAction';

import type { CommitRequest } from './commits';
import type { DocumentFieldObservation } from './documentFieldAction';
import type { SermonChurchFill } from './sermonChurchFill';
import type { SessionCheckpoint } from './session';
import type { ConflictDetail, DocumentData, FieldValue, Json, ResourceSnapshot } from './types';
import type { Sermon, ThoughtsBySection } from '@/models/models';

export function comparableSermonField(path: readonly string[]): boolean {
  return (path.length === 1 && (path[0] === 'verse' || path[0] === 'planMode'))
    || isPlanCellPath(path) || sermonNoteConflictTarget(path) !== undefined || outlineTitleConflictTarget(path) !== undefined
    || preparationConfirmationField(path) !== undefined || preparationTextField(path) !== undefined || exegeticalPointConflictId(path) !== undefined
    || thoughtTextConflictId(path) !== undefined || preachDateNoteConflictId(path) !== undefined
    || (path.length === 3 && path[0] === 'preachDates' && path[1].startsWith('id:') && path[2] === 'date');
}

export function isReturnedSermonTitle(conflict: ConflictDetail): boolean {
  return conflict.path.length === 1 && conflict.path[0] === 'title'
    && equalValues(conflict.base, conflict.theirs);
}

export function isSermonVerseReview(conflict: ConflictDetail): boolean {
  return equalValues(conflict.path, ['verse']) && (conflict.code === SERMON_VERSE_REVIEW_CHANGED
    || (!conflict.code && equalValues(conflict.base, conflict.theirs)));
}

export function isSermonChurchReview(conflict: ConflictDetail): boolean {
  return equalValues(conflict.path, ['church']) && (!conflict.code || conflict.code === SERMON_CHURCH_REVIEW_CHANGED)
    && isSermonChurch(conflict.mine) && isSermonChurch(conflict.theirs);
}

export function isSermonGoalTypeReview(conflict: ConflictDetail): boolean {
  return equalValues(conflict.path, SERMON_GOAL_TYPE.path)
    && (!conflict.code || conflict.code === SERMON_GOAL_TYPE_REVIEW_CHANGED)
    && acceptsDocumentField(conflict.mine, SERMON_GOAL_TYPE) && acceptsDocumentField(conflict.theirs, SERMON_GOAL_TYPE);
}

export function withReviewedSermonChurchDates(opening: DocumentData | null, draft: DocumentData | null,
  stored: DocumentData | null, selected: FieldValue, fill?: SermonChurchFill): DocumentData | null {
  if (!draft || !fill) return draft;
  const dates = rebaseSermonChurchFill(opening?.preachDates, draft.preachDates, stored?.preachDates, selected, fill);
  return dates === undefined || dates === draft.preachDates ? draft : { ...draft, preachDates: dates };
}

export function earlierSermonMetadataProof<Value>(action: DocumentFieldObservation<Value> | undefined, after: unknown) {
  if (action && equalValues(action.after, after)) return { observedRevision: action.observedRevision, time: action.time };
}

export function earlierSermonDateProof(request: CommitRequest, draft: DocumentData | null, stored: ResourceSnapshot) {
  const action = request.preachDateAction;
  const opening = request.initialized ? request.working.value : request.baseline.value;
  if (!action || !draft || !opening || !stored.value || !samePreachDateRow(action.rowId, opening, stored.value)
    || !samePreachDateRow(action.rowId, opening, draft)
    || existingRowDate(draft.preachDates, action.rowId, PREACH_DATE_TARGET) !== action.after) return;
  const { rowId, after, observedRevision, time } = action;
  return { rowId, after, observedRevision, time };
}

export function sermonHeaderReviewFrames(basis: ResourceSnapshot, reviewed: DocumentData | null, stored: ResourceSnapshot,
  conflicts: readonly ConflictDetail[], churchFill?: SermonChurchFill) {
  if (basis.resource.collection !== 'sermons' || !basis.value || !reviewed || !stored.value
    || basis.metadata?.generation !== stored.metadata?.generation) return { basis, reviewed };
  let base = basis.value;
  let value = reviewed;
  for (const conflict of conflicts.filter(isOrderedSermonMetadata)) {
    if (!equalValues(readSermonConflictField(value, conflict.path), conflict.mine)) continue;
    if (conflict.path[0] === 'preachDates' && !samePreachDateRow(conflict.path[1].slice(3), base, stored.value)) continue;
    if (conflict.code === SERMON_METADATA_SETTLED) {
      value = withSelectedField(value, conflict.path, readSermonConflictField(base, conflict.path)) ?? value;
      if (conflict.path[0] === 'church' && churchFill) {
        const dates = rebaseSermonChurchFill(base.preachDates, value.preachDates, stored.value.preachDates,
          readField(stored.value, conflict.path), churchFill);
        if (dates !== undefined) value = { ...value, preachDates: dates };
      }
    } else if (equalValues(readSermonConflictField(stored.value, conflict.path), conflict.theirs)) {
      base = withSelectedField(base, conflict.path, conflict.theirs) ?? base;
    }
  }
  return { basis: { ...basis, value: base }, reviewed: value };
}

export function comparableSermonFields(conflicts: readonly ConflictDetail[]): boolean {
  return conflicts.length > 0 && (conflicts.every(({ path }) => thoughtTagIdentity(path))
    || (conflicts.length === 1 && (comparableSermonField(conflicts[0].path)
      || isReturnedSermonTitle(conflicts[0]) || isSermonChurchReview(conflicts[0]) || isSermonGoalTypeReview(conflicts[0]))));
}

export function readSermonPlanModeComparison(checkpoint: SessionCheckpoint) {
  const { confirmed, draft, remoteCandidate, conflicts, editGeneration } = checkpoint;
  if (confirmed.resource.collection !== 'sermons' || !draft || !remoteCandidate?.value || !confirmed.metadata
    || confirmed.metadata.generation !== remoteCandidate.metadata?.generation || conflicts.length !== 1
    || !equalValues(conflicts[0].path, SERMON_PLAN_MODE.path)) return undefined;
  const mine = readField(draft, SERMON_PLAN_MODE.path);
  const stored = readField(remoteCandidate.value, SERMON_PLAN_MODE.path);
  if (!acceptsDocumentField(mine, SERMON_PLAN_MODE) || !acceptsDocumentField(stored, SERMON_PLAN_MODE)
    || equalValues(mine, stored) || !equalValues(mine, conflicts[0].mine)) return undefined;
  if (mergeDocumentFields(confirmed.value, draft, remoteCandidate.value).conflicts.some(({ path }) => path[0] !== 'planMode')) return undefined;
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
  if (path.length === 1) return withField(data, path[0], selected);
  if (preparationConfirmationField(path) || preparationTextField(path) || equalValues(path, SERMON_GOAL_TYPE.path)) return writeField(data, path, selected);
  const [field, id, ...leaf] = path;
  const rows = data[field];
  if (!Array.isArray(rows) || !rows.some(value => isRow(value, id))) return undefined;
  return { ...data, [field]: rows.map(value => object(value) && isRow(value, id) ? writeField(value, leaf, selected) : value) };
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

function keepPreachDateEditsWithStoredFields(basis: DocumentData, draft: DocumentData, stored: DocumentData,
  conflicts: readonly ConflictDetail[]) {
  const notes = preachDateChoiceFrames(basis, draft, stored, conflicts, true);
  let corrected = notes.draft!;
  for (const conflict of conflicts) {
    const { path } = conflict;
    if (isOrderedPreachDateField(conflict)) continue;
    const selected = readSermonConflictField(stored, path);
    if (path[0] === 'preachDates' && path.length >= 3) {
      corrected = withSelectedField(corrected, path, selected) ?? corrected;
    } else if (path.length === 1) {
      corrected = writeField(corrected, path, selected);
    }
  }
  // Confirmed wins the reviewed overlap and remains the source of bookkeeping.
  const acceptedAt = withField(corrected, 'updatedAt', readField(stored, ['updatedAt']));
  const acceptedMetadata = withField(acceptedAt, 'rev', readField(stored, ['rev']));
  const merged = mergeDocumentFields(notes.basis, stored, acceptedMetadata);
  if (merged.value.exists) return merged.value.value as DocumentData;
}

/** The saved side wins the reviewed field. Independent changes from the same Save still belong to the owner. */
export function keepUncontestedSermonFields(basis: ResourceSnapshot, draft: DocumentData | null, stored: ResourceSnapshot | null,
  conflicts: readonly ConflictDetail[]): DocumentData | undefined {
  if (basis.resource.collection !== 'sermons' || !conflicts.length) return undefined;
  if (conflicts.some(conflict => conflict.code === UNREADABLE_EXEGETICAL_PROOF)) return undefined;
  if (basis.value && draft && stored?.value && basis.metadata?.generation === stored.metadata?.generation) {
    const dateFields = conflicts.every(({ path }) => path[0] === 'preachDates' && path.length >= 3 && path[1].startsWith('id:')
      && samePreachDateRow(path[1].slice(3), basis.value!, stored.value!));
    if (dateFields || conflicts.some(isOrderedPreachDateField)) {
      return keepPreachDateEditsWithStoredFields(basis.value, draft, stored.value, conflicts);
    }
  }
  if (conflicts.length === 1 && outlineTitleConflictTarget(conflicts[0].path)) {
    return keepUncontestedOutlineTitle(basis, draft, stored, conflicts);
  }
  const outline = projectOutlineParentChoice(basis, draft, stored, conflicts, 'remote');
  if (outline) return outline;
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
    const dateId = preachDateNoteConflictId(path);
    if (path[0] === 'preachDates' && !dateId && !readSermonConflictField(stored.value, path.slice(0, 2)).exists) throw changed();
    const pointId = exegeticalPointConflictId(path);
    const thoughtId = thoughtTextConflictId(path);
    if (thoughtId && !readThoughtTextConflict(thoughtId, draft, stored.value)) throw changed();
    if (dateId && !samePreachDateRow(dateId, opening, stored.value)) {
      // Taking the saved version cannot move edits from the old date onto its replacement.
      opening = withoutPreachDateRow(opening, dateId);
      corrected = withoutPreachDateRow(draft, dateId);
    } else if (sermonNoteConflictTarget(path)) {
      const note = sermonNoteConflictText(path, draft, stored.value);
      if (!note) return undefined;
      if (note.mine !== conflicts[0].mine.value || note.stored !== conflicts[0].theirs.value) throw changed();
      corrected = withSermonNoteText(draft, note.target, note.stored ?? null);
    } else if (isPlanCellPath(path)) {
      const local = readField(draft, path), saved = readField(stored.value, path);
      if (!equalValues(local, conflicts[0].mine) || !equalValues(saved, conflicts[0].theirs)) throw changed();
      corrected = writeField(draft, path, saved);
    } else if (pointId) {
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
