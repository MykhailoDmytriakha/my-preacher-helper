import { isDateOnlyKey, shownDayOf } from './dateOnly';

import type { GroupMeetingDate } from '@/models/models';

/** Legacy complete formats remain readable; partial or impossible dates never name a calendar day. */
export function groupMeetingDay(value: string): string | null {
  const day = shownDayOf(value);
  return isDateOnlyKey(day) ? day : null;
}

/** An empty date means an undated meeting; unfinished typing is not a scheduled day. */
export const isReadyGroupMeetingDate = (date: string) => date.trim() === '' || isDateOnlyKey(date.trim());

/** Editing one field never deletes the meeting, replaces its identity, or drops its siblings. */
export function editFirstGroupMeeting(meetings: GroupMeetingDate[], patch: Partial<Pick<GroupMeetingDate, 'date' | 'location' | 'audience'>>,
  identity: Pick<GroupMeetingDate, 'id' | 'createdAt'>): GroupMeetingDate[] {
  const first = meetings[0];
  if (!first && !Object.values(patch).some(Boolean)) return meetings;
  return [{ ...(first ?? { ...identity, date: '' }), ...patch }, ...meetings.slice(1)];
}
