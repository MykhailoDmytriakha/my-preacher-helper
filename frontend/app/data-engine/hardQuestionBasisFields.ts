import { boundedActionTime } from './actionClock';
import { isAuthoredStringList } from './authoredStringList';
import { equalValues } from './fieldValues';
import { carriedHardQuestionListItems, hardQuestionListItemChanges, type HardQuestionReviewStamp } from './hardQuestionFieldAction';
import { HARD_QUESTION_BASIS_SCRIPTURE } from './hardQuestionThemeLists';
import { captureRowDetailActions } from './rowDetailCapture';
import { boundedRowId, existingRowField, existingRowFields, replaceExistingRowField, rowConflictValue } from './rowFieldAction';

import type { ActionTime } from './actionClock';
import type { CommitRequest } from './commits';
import type { RowDetailObservation, RowDetailPolicy } from './rowDetailAction';
import type { RowDetailCaptures } from './rowDetailCapture';
import type { RowFieldTarget } from './rowFieldAction';
import type { ConflictDetail, DocumentData, FieldValue, ResourceSnapshot } from './types';

export const HARD_QUESTION_BASIS_FIELDS = ['title', 'label', 'text', 'scriptureRefs'] as const;
export const BASIS_REFERENCE_PROJECTION = 'hard-question-basis-reference-projection';
export const BASIS_FIELD_REVIEW = 'hard-question-basis-field-review';
export const BASIS_FIELD_SETTLED = 'hard-question-basis-field-settled';
export const BASIS_FIELD_QUEUED = 'hard-question-basis-field-queued';
export type HardQuestionBasisField = typeof HARD_QUESTION_BASIS_FIELDS[number];
type BasisValue = string | null | string[];
type HardQuestionBasisAction = RowDetailObservation<BasisValue> & Omit<HardQuestionReviewStamp, 'basisTheme'>;
export type HardQuestionBasisActions = Partial<Record<HardQuestionBasisField, HardQuestionBasisAction>>;
export type HardQuestionBasisRowActions = Partial<Record<HardQuestionBasisField, HardQuestionBasisAction[]>>;
type HardQuestionBasisEvidence = { hardQuestionBasisFieldActions?: HardQuestionBasisActions; hardQuestionBasisRowActions?: HardQuestionBasisRowActions };
export type HardQuestionBasisReview = { id: string; fields: readonly HardQuestionBasisField[]; original: HardQuestionBasisActions; referenceItems?: readonly string[] };

const basisRow: RowFieldTarget<string> = { field: 'bases', leaf: 'id', accepts: boundedRowId };
const title: RowFieldTarget<string> = { field: 'bases', leaf: 'title',
  accepts: (value): value is string => typeof value === 'string' && value.trim().length > 0 };
const optional = (leaf: 'label' | 'text'): RowFieldTarget<string | null> => ({ field: 'bases', leaf, missing: null,
  accepts: (value): value is string | null => value === null || typeof value === 'string' });
const targets = { title, label: optional('label'), text: optional('text'),
  scriptureRefs: { field: 'bases', leaf: 'scriptureRefs', accepts: isAuthoredStringList, missing: [] } satisfies RowFieldTarget<string[]> };

export const HARD_QUESTION_BASIS_POLICY: RowDetailPolicy<HardQuestionBasisField, BasisValue> = {
  collection: 'hardQuestionThemes', fields: HARD_QUESTION_BASIS_FIELDS, birth: basisRow, target: field => targets[field],
  actions: 'hardQuestionBasisFieldActions', proofs: 'hardQuestionBasisFieldProofs', history: '_basisFieldHistory',
  submissions: hardQuestionBasisActionsForField,
  allowUnclocked: true, atomicChoice: true, rememberOpenings: true, rememberReaffirmations: true,
  seedOpeningFromStoredValue: true,
};

export function hardQuestionBasisActionsForField(source: HardQuestionBasisEvidence, field: HardQuestionBasisField) {
  const first = source.hardQuestionBasisFieldActions?.[field];
  const repeated = source.hardQuestionBasisRowActions?.[field];
  const actions = Array.isArray(repeated) ? [...(first ? [first] : []), ...repeated] : first ? [first] : [];
  const byRow = new Map<string, HardQuestionBasisAction | undefined>();
  for (const action of actions) {
    if (action && boundedRowId(action.rowId)) byRow.set(action.rowId, byRow.has(action.rowId) ? undefined : action);
  }
  return [...byRow.values()].filter(action => action !== undefined);
}

export function hardQuestionBasisField(path: readonly string[]) {
  const [collectionField, row, leaf] = path;
  if (path.length !== 3 || collectionField !== 'bases' || !row.startsWith('id:')) return;
  const id = row.slice(3);
  const field = HARD_QUESTION_BASIS_FIELDS.find(candidate => candidate === leaf);
  if (boundedRowId(id) && field) return { id, field };
}

export function hardQuestionBasisConflict({ code, path }: ConflictDetail) {
  if (!code || code === BASIS_FIELD_REVIEW || code === HARD_QUESTION_BASIS_SCRIPTURE || code === BASIS_REFERENCE_PROJECTION) return hardQuestionBasisField(path);
}

export function hasHardQuestionBasisReview(collection: string, conflicts: readonly ConflictDetail[]): boolean {
  return collection === HARD_QUESTION_BASIS_POLICY.collection && conflicts.some(hardQuestionBasisConflict);
}

export function readHardQuestionBasisField(document: DocumentData, id: string, field: HardQuestionBasisField) {
  const value = existingRowField(document.bases, id, HARD_QUESTION_BASIS_POLICY.target(field));
  return rowConflictValue(value ?? null);
}

export function readBasisReferenceVersions(conflicts: readonly ConflictDetail[], mine: DocumentData, saved: DocumentData, id: string) {
  return conflicts.find(conflict => {
    const target = hardQuestionBasisConflict(conflict);
    return target?.id === id && target.field === 'scriptureRefs' && conflict.hardQuestionListVersions
      && equalValues(conflict.mine, readHardQuestionBasisField(mine, id, 'scriptureRefs'))
      && equalValues(conflict.theirs, readHardQuestionBasisField(saved, id, 'scriptureRefs'));
  })?.hardQuestionListVersions;
}

export function writeBasisReferences(document: DocumentData, id: string, value: FieldValue): DocumentData {
  if (!isAuthoredStringList(value.value)) return document;
  const bases = replaceExistingRowField(document.bases, id, value.value, targets.scriptureRefs);
  return bases === undefined ? document : { ...document, bases };
}

export function captureHardQuestionBasisFields(baseline: ResourceSnapshot, predecessor: CommitRequest | undefined,
  draft: DocumentData | null, captured: ActionTime | null | undefined, records: readonly CommitRequest[],
  review?: HardQuestionBasisReview): HardQuestionBasisActions | undefined {
  const policy = HARD_QUESTION_BASIS_POLICY;
  if (baseline.resource.collection !== policy.collection || !baseline.metadata || baseline.metadata.deleted || captured === undefined) return;
  const time = captured === null ? null : boundedActionTime(captured);
  if (time === undefined) return;
  const before = (predecessor ? predecessor.value : baseline.value)?.bases;
  const after = draft?.bases;
  const captures: RowDetailCaptures<HardQuestionBasisField, BasisValue, ActionTime | null> = {};
  for (const field of policy.fields) {
    const target = policy.target(field);
    const opening = existingRowFields(before, target);
    const edits = [...existingRowFields(after, target)].filter(([id, value]) => (!review || id === review.id) && value !== undefined
      && opening.get(id) !== undefined && !equalValues(opening.get(id), value));
    // The manual form saves one existing basis. An old bulk/list command cannot assign one row's time to another.
    if (edits.length !== 1) continue;
    const [[rowId, value]] = edits;
    if (value === undefined) continue;
    const earlier = review?.id === rowId && !review.fields.includes(field) ? review.original[field] : undefined;
    captures[field] = { rowId, rowCreatedAt: rowId, after: value, time: earlier?.time ?? (review && !review.fields.includes(field) ? null : time) };
  }
  const actions: HardQuestionBasisActions = captureRowDetailActions(baseline, predecessor, draft, captures,
    records, policy, request => {
      return Object.fromEntries(policy.fields.flatMap(field => {
        const rowId = review?.id ?? captures[field]?.rowId;
        const action = hardQuestionBasisActionsForField(request, field).find(item => item.rowId === rowId);
        return action ? [[field, action]] : [];
      }));
    }) ?? {};
  if (review) {
    const { id, fields, original } = review;
    for (const field of policy.fields) {
      const captured = actions[field];
      const prior = original[field];
      if (!fields.includes(field)) {
        if (!captured || prior?.rowId !== id) {
          delete actions[field];
          continue;
        }
        const exactBefore = equalValues(captured.before, prior.before), exactAfter = equalValues(captured.after, prior.after);
        if (prior.reviewed && (!exactBefore || !exactAfter)) {
          delete actions[field];
          continue;
        }
        const carried = { ...captured, before: rowConflictValue(captured.before), after: rowConflictValue(captured.after) };
        const sameMembershipAction = field === 'scriptureRefs' && !prior.reviewed && carriedHardQuestionListItems(
          carried, { ...prior, before: rowConflictValue(prior.before), after: rowConflictValue(prior.after) },
        ).length === hardQuestionListItemChanges(carried.before, carried.after).size;
        if (exactAfter || sameMembershipAction) {
          actions[field] = { ...captured, time: prior.time, observedRevision: prior.observedRevision,
            ...(exactBefore && prior.predecessorOperationId && { predecessorOperationId: prior.predecessorOperationId }),
            ...(prior.reviewed && { reviewed: true,
              ...(prior.confirmedItems && { confirmedItems: prior.confirmedItems }),
              ...(prior.carriedItems && { carriedItems: prior.carriedItems }),
            }),
          };
        } else delete actions[field];
        continue;
      }
      const target = policy.target(field);
      const was = existingRowField(before, id, target), next = existingRowField(after, id, target);
      if (was === undefined || next === undefined) continue;
      const reviewed = { rowId: id, rowCreatedAt: id, before: was, after: next, time,
        observedRevision: baseline.metadata.revision, reviewed: true as const };
      const items = field === 'scriptureRefs' ? review.referenceItems : undefined;
      const originalAction = prior?.rowId === id && prior;
      if (!items?.length) {
        actions[field] = reviewed;
        continue;
      }
      const inherited = originalAction ? originalAction.reviewed ? originalAction.carriedItems : originalAction : undefined;
      const carried = inherited && originalAction ? carriedHardQuestionListItems(
        { ...reviewed, before: rowConflictValue(was), after: rowConflictValue(next) },
        { ...originalAction, before: rowConflictValue(originalAction.before), after: rowConflictValue(originalAction.after) },
      ).filter(item => !items.includes(item) && (!originalAction.reviewed || originalAction.carriedItems?.items.includes(item))) : [];
      actions[field] = { ...reviewed, confirmedItems: items,
        ...(inherited && carried.length && { carriedItems: { time: inherited.time, observedRevision: inherited.observedRevision,
          ...(inherited.predecessorOperationId && { predecessorOperationId: inherited.predecessorOperationId }), items: carried } }) };
    }
  }
  return Object.keys(actions).length ? actions : undefined;
}
