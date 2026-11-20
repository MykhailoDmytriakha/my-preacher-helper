import { MEETING_DATE_TARGET } from './datedRowAction';
import { equalValues } from './fieldValues';
import { withFirstMeetingOpening } from './groupFirstMeeting';
import { GROUP_MEETING_FIELDS, MEETING_ROW_BIRTH, meetingFieldTarget } from './groupMeetingFieldAction';
import { existingRowField, rowConflictId } from './rowFieldAction';

import type { ActionTime } from './actionClock';
import type { CommitRequest } from './commits';
import type { DatedRowActionEvidence } from './datedRowAction';
import type { GroupMeetingFieldActions } from './groupMeetingFieldAction';
import type { RowFieldObservation, RowFieldTarget, RowValue } from './rowFieldAction';
import type { ConflictDetail, DocumentData, ResourceSnapshot } from './types';

export type GroupMeetingReview = {
  generation: string;
  rowId: string;
  rowCreatedAt: string;
  fields?: GroupMeetingFieldActions;
  date?: DatedRowActionEvidence;
};

/** A choice supplies a new observation only for disputed fields. Independent edits keep their earlier evidence. */
export function captureGroupMeetingReview(confirmed: ResourceSnapshot, draft: DocumentData | null, comparison: ConflictDetail,
  conflicts: readonly ConflictDetail[], time: ActionTime | null, request?: CommitRequest): GroupMeetingReview | undefined {
  const metadata = confirmed.metadata;
  const rowId = comparison.path[1]?.slice(3);
  if (confirmed.resource.collection !== 'groups' || !metadata || metadata.deleted || !rowId) return;
  const stored = confirmed.value?.meetingDates, selected = draft?.meetingDates;
  const rowCreatedAt = existingRowField(stored, rowId, MEETING_ROW_BIRTH);
  if (!rowCreatedAt || existingRowField(selected, rowId, MEETING_ROW_BIRTH) !== rowCreatedAt) return;
  const originating = request?.baseline.metadata?.generation === metadata.generation
    && request.baseline.resource.collection === 'groups' && request.baseline.resource.id === confirmed.resource.id ? request : undefined;
  const observe = <Value extends RowValue>(target: RowFieldTarget<Value>, previous?: RowFieldObservation<Value>) => {
    const before = existingRowField(stored, rowId, target), after = existingRowField(selected, rowId, target);
    if (before === undefined || after === undefined || equalValues(before, after)) return;
    const reviewed = conflicts.some(conflict => rowConflictId(conflict.path, target) === rowId
      || equalValues(conflict.path, ['meetingDates']));
    if (reviewed) return { rowId, before, after, observedRevision: metadata.revision, time };
    if (previous?.rowId !== rowId || !equalValues(previous.after, after)) return;
    const { observedRevision, time: originalTime } = previous;
    return { rowId, before: previous.before, after, observedRevision, time: originalTime };
  };
  const fields = Object.fromEntries(GROUP_MEETING_FIELDS.flatMap(field => {
    const previous = originating?.groupMeetingFieldActions?.[field];
    const action = observe(meetingFieldTarget(field), previous?.rowCreatedAt === rowCreatedAt ? previous : undefined);
    return action ? [[field, { ...action, rowCreatedAt }]] : [];
  }));
  const basis = originating?.initialized && originating.command ? originating.working.value : originating?.baseline.value;
  const original = withFirstMeetingOpening(basis ?? null, originating?.value ?? null);
  const date = observe(MEETING_DATE_TARGET, existingRowField(original?.meetingDates, rowId, MEETING_ROW_BIRTH) === rowCreatedAt
    ? originating?.meetingDateAction : undefined);
  return date || Object.keys(fields).length ? { generation: metadata.generation, rowId, rowCreatedAt,
    ...(Object.keys(fields).length && { fields }), ...(date && { date }) } : undefined;
}

/** Restore only actions still naming the same saved row and the exact value being queued. */
export function groupMeetingReviewForSave(review: GroupMeetingReview | undefined, confirmed: ResourceSnapshot,
  draft: DocumentData | null): Pick<GroupMeetingReview, 'fields' | 'date'> | undefined {
  if (!review || confirmed.resource.collection !== 'groups' || review.generation !== confirmed.metadata?.generation) return;
  const { rowId, rowCreatedAt } = review;
  const rows = draft?.meetingDates;
  if (existingRowField(confirmed.value?.meetingDates, rowId, MEETING_ROW_BIRTH) !== rowCreatedAt
    || existingRowField(rows, rowId, MEETING_ROW_BIRTH) !== rowCreatedAt) return;
  const matches = <Value extends RowValue>(target: RowFieldTarget<Value>, action: RowFieldObservation<Value> | undefined) =>
    action?.rowId === rowId && action.observedRevision <= confirmed.metadata!.revision
    && equalValues(existingRowField(rows, rowId, target), action.after);
  const fields = Object.fromEntries(GROUP_MEETING_FIELDS.flatMap(field => {
    const action = review.fields?.[field];
    return action?.rowCreatedAt === rowCreatedAt && matches(meetingFieldTarget(field), action) ? [[field, action]] : [];
  }));
  const date = matches(MEETING_DATE_TARGET, review.date) ? review.date : undefined;
  return { ...(Object.keys(fields).length && { fields }), ...(date && { date }) };
}
