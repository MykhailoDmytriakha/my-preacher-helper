import { isDateOnlyKey, shownDayOf } from '@/utils/dateOnly';
import { groupMeetingDay } from '@/utils/groupMeeting';

import { isActionTime, type ActionTime } from './actionClock';
import { firstMeetingProofChanges, withFirstMeetingOpening } from './groupFirstMeeting';
import { MEETING_ROW_BIRTH } from './groupMeetingFieldAction';
import { PREACH_ROW_BIRTH } from './preachDateFieldAction';
import { existingRowField, isCapturedRowConflict, isRowChange, matchesRowAction, replaceExistingRowField } from './rowFieldAction';

import type { CommitRequest } from './commits';
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
export type DatedRowActionEvidence = RowFieldEvidence<string> & { predecessorOperationId?: string };

type DateField = 'preachDates' | 'meetingDates';
type DateEvidenceField = 'preachDateAction' | 'meetingDateAction';
type DateProofField = 'preachDateActions' | 'meetingDateActions';

export type DatedRowTarget = RowFieldTarget<string> & {
  field: DateField; leaf: 'date'; birth: RowFieldTarget<string>; evidence: DateEvidenceField; proofs: DateProofField; history: string;
};

export const PREACH_DATE_TARGET: DatedRowTarget = {
  field: 'preachDates', birth: PREACH_ROW_BIRTH, evidence: 'preachDateAction', proofs: 'preachDateActions', history: '_preachDateHistory',
  leaf: 'date', accepts: (value): value is string => typeof value === 'string' && value.length <= 128 && (value === '' || isDateOnlyKey(shownDayOf(value))),
};

export const MEETING_DATE_TARGET: DatedRowTarget = {
  field: 'meetingDates', birth: MEETING_ROW_BIRTH, evidence: 'meetingDateAction', proofs: 'meetingDateActions', history: '_meetingDateHistory',
  leaf: 'date', accepts: (value): value is string => typeof value === 'string' && value.length <= 128 && (value === '' || groupMeetingDay(value) !== null),
};

export function datedRowTarget(collection: string): DatedRowTarget | undefined {
  if (collection === 'sermons') return PREACH_DATE_TARGET;
  if (collection === 'groups') return MEETING_DATE_TARGET;
}

export function existingRowDate(rows: Json | undefined, rowId: string, target: DatedRowTarget): string | undefined {
  return existingRowField(rows, rowId, target);
}

function knownDatePredecessor(baseline: ResourceSnapshot, predecessor: CommitRequest, records: readonly CommitRequest[],
  target: DatedRowTarget, rowId: string, date: string, born: string): string | undefined {
  const byId = new Map(records.map(request => [request.id, request]));
  const visited = new Set<string>();
  const sameRowDate = (value: DocumentData | null) => existingRowDate(value?.[target.field], rowId, target) === date
    && existingRowField(value?.[target.field], rowId, target.birth) === born;
  let request: CommitRequest | undefined = predecessor;
  while (request && !visited.has(request.id)) {
    const saved = request.baseline;
    if (request.owner !== predecessor.owner || saved.resource.collection !== baseline.resource.collection
      || saved.resource.id !== baseline.resource.id || saved.metadata?.generation !== baseline.metadata?.generation
      || request.state === 'cancelled' || request.state === 'refused' || request.state === 'conflict'
      || !sameRowDate(request.value)) return undefined;
    const action: DatedRowActionEvidence | undefined = request[target.evidence];
    if (action?.rowId === rowId) return action.after === date ? request.id : undefined;
    const prior: CommitRequest | undefined = byId.get(request.predecessor ?? '');
    if (!prior || !sameRowDate(prior.value)) return undefined;
    visited.add(request.id);
    request = prior;
  }
}

export function captureDatedRowAction(baseline: ResourceSnapshot, predecessor: CommitRequest | undefined,
  after: DocumentData | null, capture: DatedRowActionCapture | undefined, records: readonly CommitRequest[]): DatedRowActionEvidence | undefined {
  const target = datedRowTarget(baseline.resource.collection);
  if (!target || !baseline.metadata?.generation || !capture || !isActionTime(capture.time)) return undefined;
  const rawBefore = predecessor ? predecessor.value : baseline.value;
  const before = target === MEETING_DATE_TARGET ? withFirstMeetingOpening(rawBefore, after) : rawBefore;
  const previousDate = existingRowDate(before?.[target.field], capture.rowId, target);
  const nextDate = existingRowDate(after?.[target.field], capture.rowId, target);
  if (previousDate === undefined || nextDate === undefined || previousDate === nextDate
    || (capture.after !== undefined && capture.after !== nextDate)) return undefined;
  const born = existingRowField(before?.[target.field], capture.rowId, target.birth);
  const predecessorOperationId = predecessor && born && born === existingRowField(after?.[target.field], capture.rowId, target.birth)
    ? knownDatePredecessor(baseline, predecessor, records, target, capture.rowId, previousDate, born) : undefined;
  return { rowId: capture.rowId, time: capture.time, before: previousDate, after: nextDate, observedRevision: baseline.metadata.revision,
    ...(predecessorOperationId && { predecessorOperationId }) };
}

export function replaceExistingDate(rows: Json | undefined, rowId: string, date: string, target: DatedRowTarget): Json | undefined {
  return replaceExistingRowField(rows, rowId, date, target);
}

export function isDateChange(change: FieldChange, target: DatedRowTarget): boolean {
  return isRowChange(change, target);
}

export function matchesDatedRowChange(changes: FieldChange[], evidence: DatedRowActionEvidence, target: DatedRowTarget): boolean {
  return matchesRowAction(target === MEETING_DATE_TARGET ? firstMeetingProofChanges(changes) : changes, evidence, target);
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
