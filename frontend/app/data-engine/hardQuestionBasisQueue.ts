import { equalValues } from './fieldValues';
import { captureHardQuestionBasisFields, HARD_QUESTION_BASIS_POLICY, hardQuestionBasisActionsForField } from './hardQuestionBasisFields';
import { matchesRowDetailBirth } from './rowDetailAction';
import { pendingRowDetailRebases } from './rowDetailCapture';
import { existingRowField, matchesRowAction } from './rowFieldAction';

import type { ActionTime } from './actionClock';
import type { CommitRequest } from './commits';
import type { HardQuestionBasisField, HardQuestionBasisReview, HardQuestionBasisRowActions } from './hardQuestionBasisFields';
import type { DocumentData, FieldChange, ResourceSnapshot } from './types';

export type ThemeBasisDecision = { id: string; field: HardQuestionBasisField; side: 'local' | 'remote'; referenceItems?: readonly string[] };

const policy = HARD_QUESTION_BASIS_POLICY;

export function orderedHardQuestionBasisReviews(pending: readonly CommitRequest[], decisions: readonly ThemeBasisDecision[]): HardQuestionBasisReview[] {
  type PendingReview = Omit<HardQuestionBasisReview, 'fields'> & { fields: HardQuestionBasisField[] };
  const reviews = new Map<string, PendingReview>();
  const forRow = (id: string) => {
    const previous = reviews.get(id);
    if (previous) return previous;
    const item: PendingReview = { id, fields: [], original: {} };
    reviews.set(id, item);
    return item;
  };
  const byRequest = new Map(pending.map(request => [request.id, request]));
  for (const request of pending) {
    const before = (request.predecessor && byRequest.get(request.predecessor)?.value) || (request.initialized ? request.working : request.baseline).value;
    const after = request.value;
    for (const field of policy.fields) {
      const target = policy.target(field);
      for (const row of reviews.values()) {
        if (!equalValues(existingRowField(before?.bases, row.id, target), existingRowField(after?.bases, row.id, target))) delete row.original[field];
      }
      for (const action of hardQuestionBasisActionsForField(request, field)) {
        if (action.rowCreatedAt === action.rowId && equalValues(existingRowField(after?.bases, action.rowId, target), action.after)) {
          forRow(action.rowId).original[field] = action;
        }
      }
    }
  }
  for (const { id, field, side, referenceItems } of decisions) {
    const review = forRow(id);
    if (side === 'local' || referenceItems?.length) {
      review.fields.push(field);
      if (referenceItems) review.referenceItems = referenceItems;
    } else delete review.original[field];
  }
  return [...reviews.values()].filter(review => review.fields.length || Object.keys(review.original).length);
}

export function captureHardQuestionBasisRowActions(baseline: ResourceSnapshot, predecessor: CommitRequest | undefined,
  draft: DocumentData | null, time: ActionTime | null | undefined, records: readonly CommitRequest[],
  reviews: readonly HardQuestionBasisReview[]): HardQuestionBasisRowActions | undefined {
  const result: HardQuestionBasisRowActions = {};
  for (const review of reviews) {
    const actions = captureHardQuestionBasisFields(baseline, predecessor, draft, time, records, review);
    for (const field of policy.fields) {
      const action = actions?.[field], prior = review.original[field];
      if (!action || (!review.fields.includes(field) && (!prior || prior.observedRevision !== action.observedRevision
        || !equalValues(prior.time, action.time)))) continue;
      (result[field] ??= []).push(action);
    }
  }
  return Object.keys(result).length ? result : undefined;
}

export function matchingHardQuestionBasisRowActions(changes: FieldChange[], record: CommitRequest): HardQuestionBasisRowActions | undefined {
  if (!record.hardQuestionBasisRowActions) return;
  const fields = policy.fields.flatMap(field => {
    const actions = hardQuestionBasisActionsForField(record, field).filter(action => matchesRowDetailBirth(changes, action, policy.birth)
      && matchesRowAction(changes, action, policy.target(field)));
    return actions.length ? [[field, actions]] as const : [];
  });
  return fields.length ? Object.fromEntries(fields) : undefined;
}

export function pendingHardQuestionBasisRowRebases(record: CommitRequest) {
  if (!record.hardQuestionBasisRowActions) return [];
  return policy.fields.flatMap(field => hardQuestionBasisActionsForField(record, field)
    .flatMap(action => pendingRowDetailRebases(record, { [field]: action }, policy)));
}
