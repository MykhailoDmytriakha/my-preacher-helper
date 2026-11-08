import { isOrderedMeetingFieldValue } from '@/utils/groupMeeting';

import { boundedActionTime } from './actionClock';
import { object } from './fieldValues';
import { boundedRowId, existingRowField, isRowChange, matchesRowAction, rowConflictPath, rowConflictValue } from './rowFieldAction';

import type { ActionTime } from './actionClock';
import type { CommitRequest } from './commits';
import type { DisplacedRowField, RowFieldEvidence, RowFieldTarget, RowValue } from './rowFieldAction';
import type { ConflictDetail, DocumentData, FieldChange, ResourceSnapshot } from './types';

export const GROUP_MEETING_FIELDS = ['location', 'audience'] as const;
export type GroupMeetingField = typeof GROUP_MEETING_FIELDS[number];
export type GroupMeetingFieldAction = RowFieldEvidence<RowValue> & { rowCreatedAt: string; predecessorOperationId?: string };
export type GroupMeetingFieldActions = Partial<Record<GroupMeetingField, GroupMeetingFieldAction>>;
export type GroupMeetingFieldInput = { field: GroupMeetingField; rowId: string; time: ActionTime };
type MeetingFieldCapture = Omit<GroupMeetingFieldInput, 'field'> & { after: RowValue; rowCreatedAt: string };
export type GroupMeetingFieldCaptures = Partial<Record<GroupMeetingField, MeetingFieldCapture>>;
export type GroupMeetingFieldHistoryEntry = DisplacedRowField<RowValue> & { field: GroupMeetingField; rowCreatedAt: string };
export type GroupMeetingFieldHistoryPage = {
  owner: string; groupId: string; generation: string; nextCursor: string | null;
  entries: Array<{ id: string; acceptedAt: string; fields: GroupMeetingFieldHistoryEntry[] }>;
};

export const MEETING_ROW_BIRTH: RowFieldTarget<string> = {
  field: 'meetingDates', leaf: 'createdAt',
  accepts: (value): value is string => typeof value === 'string' && value.length > 0,
};

export function meetingFieldTarget(leaf: GroupMeetingField): RowFieldTarget<RowValue> {
  return { field: 'meetingDates', leaf, missing: null, accepts: isOrderedMeetingFieldValue };
}

/** A stage holds the last action for each exact leaf. Unrelated inputs leave that action intact. */
export function stageMeetingFieldCaptures(previous: GroupMeetingFieldCaptures | undefined, current: DocumentData, next: DocumentData,
  input?: GroupMeetingFieldInput): GroupMeetingFieldCaptures | undefined {
  if (!previous && !input) return undefined;
  const captures = GROUP_MEETING_FIELDS.flatMap(field => {
    const time = input?.field === field ? boundedActionTime(input.time) : undefined;
    const existing = previous?.[field];
    const rowId = time ? input!.rowId : existing?.rowId;
    if (!boundedRowId(rowId)) return [];
    const target = meetingFieldTarget(field);
    const before = existingRowField(current.meetingDates, rowId, target);
    const after = existingRowField(next.meetingDates, rowId, target);
    const rowCreatedAt = existingRowField(current.meetingDates, rowId, MEETING_ROW_BIRTH);
    if (after === undefined || before === undefined || !rowCreatedAt
      || rowCreatedAt !== existingRowField(next.meetingDates, rowId, MEETING_ROW_BIRTH)) return [];
    if (time && before !== after) return [[field, { rowId, rowCreatedAt, after, time }]] as const;
    return before === after && existing?.rowId === rowId && existing.rowCreatedAt === rowCreatedAt && existing.after === after ? [[field, existing]] as const : [];
  });
  return captures.length ? Object.fromEntries(captures) : undefined;
}

function knownMeetingFieldPredecessor(predecessor: CommitRequest | undefined, requests: ReadonlyMap<string, CommitRequest>,
  baseline: ResourceSnapshot, field: GroupMeetingField, rowId: string, rowCreatedAt: string, value: RowValue): string | undefined {
  const visited = new Set<string>();
  const target = meetingFieldTarget(field);
  for (let request = predecessor; request && !visited.has(request.id); request = requests.get(request.predecessor ?? '')) {
    const saved = request.baseline;
    const rows = request.value?.meetingDates;
    if (saved.resource.collection !== baseline.resource.collection || saved.resource.id !== baseline.resource.id
      || saved.metadata?.generation !== baseline.metadata?.generation || request.state === 'cancelled' || request.state === 'refused'
      || existingRowField(rows, rowId, MEETING_ROW_BIRTH) !== rowCreatedAt || existingRowField(rows, rowId, target) !== value) break;
    const authored = request.groupMeetingFieldActions?.[field];
    if (authored?.rowId === rowId) return authored.rowCreatedAt === rowCreatedAt && authored.after === value ? request.id : undefined;
    visited.add(request.id);
  }
}

export function captureMeetingFieldActions(baseline: ResourceSnapshot, predecessor: CommitRequest | undefined,
  draft: DocumentData | null, captures: GroupMeetingFieldCaptures | undefined, records: readonly CommitRequest[]): GroupMeetingFieldActions | undefined {
  if (!captures || baseline.resource.collection !== 'groups' || !baseline.metadata || baseline.metadata.deleted) return undefined;
  const { revision: observedRevision } = baseline.metadata;
  const ancestor = predecessor ? predecessor.value : baseline.value;
  const requests = new Map(records.map(request => [request.id, request]));
  const actions = GROUP_MEETING_FIELDS.flatMap(field => {
    const capture = captures[field];
    if (!object(capture) || !boundedRowId(capture.rowId)) return [];
    const time = boundedActionTime(capture.time);
    const target = meetingFieldTarget(field);
    const before = existingRowField(ancestor?.meetingDates, capture.rowId, target);
    const after = existingRowField(draft?.meetingDates, capture.rowId, target);
    const rowCreatedAt = existingRowField(ancestor?.meetingDates, capture.rowId, MEETING_ROW_BIRTH);
    if (!time || before === undefined || after === undefined || before === after || after !== capture.after || !rowCreatedAt
      || rowCreatedAt !== capture.rowCreatedAt || rowCreatedAt !== existingRowField(draft?.meetingDates, capture.rowId, MEETING_ROW_BIRTH)) return [];
    const predecessorOperationId = knownMeetingFieldPredecessor(predecessor, requests, baseline, field, capture.rowId, rowCreatedAt, before);
    return [[field, { rowId: capture.rowId, rowCreatedAt, before, after, time, observedRevision,
      ...(predecessorOperationId && { predecessorOperationId }) }]] as const;
  });
  return actions.length ? Object.fromEntries(actions) : undefined;
}

export function matchingMeetingFieldActions(changes: FieldChange[], actions: GroupMeetingFieldActions | undefined): GroupMeetingFieldActions | undefined {
  if (!actions) return undefined;
  const matching = GROUP_MEETING_FIELDS.flatMap(field => {
    const action = actions[field];
    return action && matchesMeetingFieldBirth(changes, action) && matchesRowAction(changes, action, meetingFieldTarget(field)) ? [[field, action]] as const : [];
  });
  return matching.length ? Object.fromEntries(matching) : undefined;
}

export function matchesMeetingFieldBirth(changes: FieldChange[], action: Pick<GroupMeetingFieldAction, 'rowId' | 'rowCreatedAt'>): boolean {
  const change = changes.find(item => isRowChange(item, MEETING_ROW_BIRTH));
  return existingRowField(change?.before.value, action.rowId, MEETING_ROW_BIRTH) === action.rowCreatedAt
    && existingRowField(change?.after.value, action.rowId, MEETING_ROW_BIRTH) === action.rowCreatedAt;
}

export function replacedMeetingField(current: ResourceSnapshot, field: GroupMeetingField, action: GroupMeetingFieldAction): ConflictDetail | undefined {
  const rows = current.value?.meetingDates;
  const born = existingRowField(rows, action.rowId, MEETING_ROW_BIRTH);
  if (!born || born === action.rowCreatedAt) return undefined;
  const target = meetingFieldTarget(field);
  const value = existingRowField(rows, action.rowId, target);
  if (value === action.after) return undefined;
  return { path: rowConflictPath(action.rowId, target), base: rowConflictValue(action.before),
    mine: rowConflictValue(action.after), theirs: rowConflictValue(value ?? null) };
}
