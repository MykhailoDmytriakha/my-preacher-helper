import { groupMeetingDay } from '@/utils/groupMeeting';

import { isActionTime, type ActionTime } from './actionClock';

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
export type DatedRowActionEvidence = DatedRowActionCapture & { before: string; after: string; observedRevision: number };

type DateField = 'preachDates' | 'meetingDates';
type DateEvidenceField = 'preachDateAction' | 'meetingDateAction';
type DateProofField = 'preachDateActions' | 'meetingDateActions';

export type DatedRowTarget = {
  field: DateField; evidence: DateEvidenceField; proofs: DateProofField; history: string;
  isDate(value: unknown): value is string;
};

export const PREACH_DATE_TARGET: DatedRowTarget = {
  field: 'preachDates', evidence: 'preachDateAction', proofs: 'preachDateActions', history: '_preachDateHistory',
  isDate: (value): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value),
};

export const MEETING_DATE_TARGET: DatedRowTarget = {
  field: 'meetingDates', evidence: 'meetingDateAction', proofs: 'meetingDateActions', history: '_meetingDateHistory',
  isDate: (value): value is string => typeof value === 'string' && value.length <= 128 && (value === '' || groupMeetingDay(value) !== null),
};

export function datedRowTarget(collection: string): DatedRowTarget | undefined {
  if (collection === 'sermons') return PREACH_DATE_TARGET;
  if (collection === 'groups') return MEETING_DATE_TARGET;
}

export function existingRowDate(rows: Json | undefined, rowId: string, target: DatedRowTarget): string | undefined {
  if (!Array.isArray(rows)) return undefined;
  const matches = rows.filter(row => row && typeof row === 'object' && !Array.isArray(row) && row.id === rowId);
  const row = matches.length === 1 ? matches[0] : undefined;
  if (!row || typeof row !== 'object' || Array.isArray(row) || !target.isDate(row.date)) return undefined;
  return row.date;
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
  if (!Array.isArray(rows) || existingRowDate(rows, rowId, target) === undefined) return rows;
  return rows.map(row => row && typeof row === 'object' && !Array.isArray(row) && row.id === rowId ? { ...row, date } : row);
}

export function isDateChange(change: FieldChange, target: DatedRowTarget): boolean {
  return change.path.length === 1 && change.path[0] === target.field;
}

export function matchesDatedRowChange(changes: FieldChange[], evidence: DatedRowActionEvidence, target: DatedRowTarget): boolean {
  const change = changes.find(item => isDateChange(item, target));
  return Boolean(change?.before.exists && change.after.exists
    && existingRowDate(change.before.value, evidence.rowId, target) === evidence.before
    && existingRowDate(change.after.value, evidence.rowId, target) === evidence.after);
}

export function isCapturedDateConflict(conflict: { path: string[]; base: FieldValue; mine: FieldValue; theirs: FieldValue },
  action: DatedRowActionEvidence, target: DatedRowTarget): boolean {
  return conflict.path.length === 3 && conflict.path[0] === target.field
    && conflict.path[1] === `id:${action.rowId}` && conflict.path[2] === 'date'
    && conflict.base.exists && conflict.base.value === action.before
    && conflict.mine.exists && conflict.mine.value === action.after
    && conflict.theirs.exists && target.isDate(conflict.theirs.value);
}

export function capturedDateBaseline(changes: FieldChange[], action: DatedRowActionEvidence, target: DatedRowTarget): FieldChange[] {
  return changes.map(change => isDateChange(change, target)
    ? { ...change, before: { ...change.before, value: replaceExistingDate(change.before.value, action.rowId, action.before, target) } }
    : change);
}
