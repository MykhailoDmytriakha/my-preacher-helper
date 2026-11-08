import { isOrderedMeetingFieldValue } from '@/utils/groupMeeting';

import { boundedActionTime } from './actionClock';
import { replacedRowDetail, type RowDetailAction, type RowDetailActions, type RowDetailHistoryEntry, type RowDetailPolicy } from './rowDetailAction';
import { captureRowDetailActions, matchingRowDetailActions, type RowDetailCaptures } from './rowDetailCapture';
import { boundedRowId, existingRowField } from './rowFieldAction';

import type { ActionTime } from './actionClock';
import type { CommitRequest } from './commits';
import type { RowFieldTarget } from './rowFieldAction';
import type { ConflictDetail, DocumentData, FieldChange, ResourceSnapshot } from './types';

export const GROUP_MEETING_FIELDS = ['location', 'audience'] as const;
export type GroupMeetingValue = string | null;
export type GroupMeetingField = typeof GROUP_MEETING_FIELDS[number];
export type GroupMeetingFieldAction = RowDetailAction<GroupMeetingValue>;
export type GroupMeetingFieldActions = RowDetailActions<GroupMeetingField, GroupMeetingValue>;
export type GroupMeetingFieldInput = { field: GroupMeetingField; rowId: string; time: ActionTime };
export type GroupMeetingFieldCaptures = RowDetailCaptures<GroupMeetingField, GroupMeetingValue>;
export type GroupMeetingFieldHistoryEntry = RowDetailHistoryEntry<GroupMeetingField, GroupMeetingValue>;
export type GroupMeetingFieldHistoryPage = {
  owner: string; groupId: string; generation: string; nextCursor: string | null;
  entries: Array<{ id: string; acceptedAt: string; fields: GroupMeetingFieldHistoryEntry[] }>;
};

export const MEETING_ROW_BIRTH: RowFieldTarget<string> = {
  field: 'meetingDates', leaf: 'createdAt',
  accepts: (value): value is string => typeof value === 'string' && value.length > 0,
};

export function meetingFieldTarget(leaf: GroupMeetingField): RowFieldTarget<GroupMeetingValue> {
  return { field: 'meetingDates', leaf, missing: null, accepts: isOrderedMeetingFieldValue };
}

export const GROUP_MEETING_FIELD_POLICY: RowDetailPolicy<GroupMeetingField, GroupMeetingValue> = {
  collection: 'groups', fields: GROUP_MEETING_FIELDS, birth: MEETING_ROW_BIRTH, target: meetingFieldTarget,
  proofs: 'groupMeetingFieldProofs', actions: 'groupMeetingFieldActions', history: '_meetingFieldHistory',
};

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

export function captureMeetingFieldActions(baseline: ResourceSnapshot, predecessor: CommitRequest | undefined,
  draft: DocumentData | null, captures: GroupMeetingFieldCaptures | undefined, records: readonly CommitRequest[]): GroupMeetingFieldActions | undefined {
  return captureRowDetailActions(baseline, predecessor, draft, captures, records, GROUP_MEETING_FIELD_POLICY, request => request.groupMeetingFieldActions);
}

export function matchingMeetingFieldActions(changes: FieldChange[], actions: GroupMeetingFieldActions | undefined): GroupMeetingFieldActions | undefined {
  return matchingRowDetailActions(changes, actions, GROUP_MEETING_FIELD_POLICY);
}

export function replacedMeetingField(current: ResourceSnapshot, field: GroupMeetingField, action: GroupMeetingFieldAction): ConflictDetail | undefined {
  return replacedRowDetail(current, action, meetingFieldTarget(field), MEETING_ROW_BIRTH);
}
