import { isDateOnlyKey, shownDayOf } from './dateOnly';

import type { GroupMeetingDate } from '@/models/models';

/** Legacy complete formats remain readable; partial or impossible dates never name a calendar day. */
export function groupMeetingDay(value: string): string | null {
  const day = shownDayOf(value);
  return isDateOnlyKey(day) ? day : null;
}

/** Only short details participate in automatic chronology and history. */
export const isOrderedMeetingFieldValue = (value: unknown): value is string | null =>
  value === null || (typeof value === 'string' && value.length <= 1024);

/** The editor renders a missing meeting list as empty without authoring a change. */
export function isEmptyGroupMeetingDefault(opening: unknown, displayed: unknown): boolean {
  return opening === undefined && Array.isArray(displayed) && displayed.length === 0;
}

/** An empty date means an undated meeting; unfinished typing is not a scheduled day. */
export const isReadyGroupMeetingDate = (date: string) => date.trim() === '' || isDateOnlyKey(date.trim());

export type MeetingOpening = { id: string; createdAt: string; date: '' };

/** A vacant first meeting slot is shared by devices. Only writes to meetings advance its revision. */
export function firstGroupMeetingIdentity(group: { createdAt?: unknown; rev?: unknown } | null | undefined): MeetingOpening | undefined {
  if (!group || typeof group.createdAt !== 'string' || !group.createdAt) return;
  const rev = group.rev;
  const revision = rev && typeof rev === 'object' && 'meetingDates' in rev ? rev.meetingDates : 0;
  if (typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0) {
    return { id: 'first-meeting-' + revision, createdAt: group.createdAt, date: '' };
  }
}

/** Editing one field never deletes the meeting, replaces its identity, or drops its siblings. */
export function editFirstGroupMeeting(meetings: GroupMeetingDate[], patch: Partial<Pick<GroupMeetingDate, 'date' | 'location' | 'audience'>>,
  identity: Pick<GroupMeetingDate, 'id' | 'createdAt'>): GroupMeetingDate[] {
  const first = meetings[0];
  if (!first && !Object.values(patch).some(Boolean)) return meetings;
  return [{ ...(first ?? { ...identity, date: '' }), ...patch }, ...meetings.slice(1)];
}
