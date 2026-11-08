import { isDateOnlyKey, shownDayOf } from '@/utils/dateOnly';
import { groupMeetingDay } from '@/utils/groupMeeting';

import { isActionTime, type ActionTime } from './actionClock';
import { existingRowField, isCapturedRowConflict, isRowChange, matchesRowAction, replaceExistingRowField } from './rowFieldAction';

import type { RowFieldEvidence, RowFieldTarget } from './rowFieldAction';
import type { DocumentData, FieldChange, FieldValue, Json, ResourceSnapshot } from './types';

export type DisplacedRowDate = {
  rowId: string; date: string; winnerDate: string; generation: string;
  actionTime: ActionTime; winnerActionTime: ActionTime;
};
export type PreachDateHistoryEntry = DisplacedRowDate & { id: string; acceptedAt: string };
export type PreachDateHistoryPage = { owner: string; sermonId: string; generation: string; entries: PreachDateHistoryEntry[]; nextCursor: string | null };

export type MeetingDateHistoryPage = {
  owner: string; groupId: string; generation: string; entries: Array<DisplacedRowDate & { id: string; acceptedAt: string }>; nextCursor: string | null;
};

export type DatedRowActionCapture = { rowId: string; time: ActionTime; after?: string };
export type DatedRowActionEvidence = RowFieldEvidence<string>;

type DateField = 'preachDates' | 'meetingDates';
type DateEvidenceField = 'preachDateAction' | 'meetingDateAction';
type DateProofField = 'preachDateActions' | 'meetingDateActions';

export type DatedRowTarget = RowFieldTarget<string> & {
  field: DateField; leaf: 'date'; evidence: DateEvidenceField; proofs: DateProofField; history: string;
};

export const PREACH_DATE_TARGET: DatedRowTarget = {
  field: 'preachDates', evidence: 'preachDateAction', proofs: 'preachDateActions', history: '_preachDateHistory',
  leaf: 'date', accepts: (value): value is string => typeof value === 'string' && value.length <= 128 && (value === '' || isDateOnlyKey(shownDayOf(value))),
};

export const MEETING_DATE_TARGET: DatedRowTarget = {
  field: 'meetingDates', evidence: 'meetingDateAction', proofs: 'meetingDateActions', history: '_meetingDateHistory',
  leaf: 'date', accepts: (value): value is string => typeof value === 'string' && value.length <= 128 && (value === '' || groupMeetingDay(value) !== null),
};

export function datedRowTarget(collection: string): DatedRowTarget | undefined {
  if (collection === 'sermons') return PREACH_DATE_TARGET;
  if (collection === 'groups') return MEETING_DATE_TARGET;
}

export function existingRowDate(rows: Json | undefined, rowId: string, target: DatedRowTarget): string | undefined {
  return existingRowField(rows, rowId, target);
}

export function captureDatedRowAction(baseline: ResourceSnapshot, predecessor: { value: DocumentData | null } | undefined,
  after: DocumentData | null, capture?: DatedRowActionCapture): DatedRowActionEvidence | undefined {
  const target = datedRowTarget(baseline.resource.collection);
  if (!target || !baseline.metadata?.generation || !capture || !isActionTime(capture.time)) return undefined;
  const before = predecessor ? predecessor.value : baseline.value;
  const previousDate = existingRowDate(before?.[target.field], capture.rowId, target);
  const nextDate = existingRowDate(after?.[target.field], capture.rowId, target);
  if (previousDate === undefined || nextDate === undefined || previousDate === nextDate
    || (capture.after !== undefined && capture.after !== nextDate)) return undefined;
  return { rowId: capture.rowId, time: capture.time, before: previousDate, after: nextDate, observedRevision: baseline.metadata.revision };
}

export function replaceExistingDate(rows: Json | undefined, rowId: string, date: string, target: DatedRowTarget): Json | undefined {
  return replaceExistingRowField(rows, rowId, date, target);
}

export function isDateChange(change: FieldChange, target: DatedRowTarget): boolean {
  return isRowChange(change, target);
}

export function matchesDatedRowChange(changes: FieldChange[], evidence: DatedRowActionEvidence, target: DatedRowTarget): boolean {
  return matchesRowAction(changes, evidence, target);
}

export function isCapturedDateConflict(conflict: { path: string[]; base: FieldValue; mine: FieldValue; theirs: FieldValue },
  action: DatedRowActionEvidence, target: DatedRowTarget): boolean {
  return isCapturedRowConflict(conflict, action, target);
}

export function capturedDateBaseline(changes: FieldChange[], action: DatedRowActionEvidence, target: DatedRowTarget): FieldChange[] {
  return changes.map(change => isDateChange(change, target)
    ? { ...change, before: { ...change.before, value: replaceExistingDate(change.before.value, action.rowId, action.before, target) } }
    : change);
}
