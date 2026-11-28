import { isReadyGroupMeetingDate } from '@/utils/groupMeeting';

import { equalValues } from './fieldValues';

import type { ManualPath, ManualScopeRecord } from './manualScope';
import type { DocumentData, ResourceRef } from './types';
import type { GroupMeetingDate } from '@/models/models';

export const GROUP_MEETING_SLOT = 'group-meeting';
export const GROUP_MEETING_SAVE_DELAY = 750;

export function groupMeetingForm(resource: ResourceRef, selection: readonly ManualPath[]): boolean {
  return resource.collection === 'groups' && selection.length === 1
    && selection[0].length === 1 && selection[0][0] === 'meetingDates';
}

export const groupMeetingRows = (value: DocumentData | null | undefined) =>
  (value?.meetingDates ?? []) as unknown as GroupMeetingDate[];

const keepsInitialDate = (first: GroupMeetingDate, initial: readonly GroupMeetingDate[]) =>
  initial.some(previous => previous.id === first.id && previous.date === first.date);

export function canSaveGroupMeeting(rows: readonly GroupMeetingDate[], initial: readonly GroupMeetingDate[]): boolean {
  const first = rows[0];
  return !first || isReadyGroupMeetingDate(first.date) || keepsInitialDate(first, initial);
}

export function normalizeGroupMeetingDraft(value: DocumentData, initial: DocumentData | null | undefined): DocumentData {
  const rows = groupMeetingRows(value);
  const first = rows[0], before = groupMeetingRows(initial);
  if (!first || !canSaveGroupMeeting(rows, before) || keepsInitialDate(first, before) || first.date === first.date.trim()) return value;
  return { ...value, meetingDates: [{ ...first, date: first.date.trim() }, ...rows.slice(1)] } as unknown as DocumentData;
}

export function hasMeetingDraft(record: ManualScopeRecord): boolean {
  if (!groupMeetingForm(record.resource, record.selection)) return false;
  // A return to the opening words can still be a later edit when a captured Save
  // has changed the base and its separate form receipt has not been written yet.
  return !equalValues(record.stage, record.savedSelection) || Boolean(record.active && record.autosaveGroupMeeting
    && record.generation > (record.savedGeneration ?? record.openingGeneration ?? 0));
}

export function hasRecordedMeetingSave(record: ManualScopeRecord): boolean {
  return record.active && record.autosaveGroupMeeting === true && groupMeetingForm(record.resource, record.selection)
    && record.predecessor !== null && record.savedGeneration === record.generation && !hasMeetingDraft(record);
}

export function readyMeetingAutosave(record: ManualScopeRecord, previous = record.savedSelection): boolean {
  if (!record.active || !record.autosaveGroupMeeting || !groupMeetingForm(record.resource, record.selection)
    || equalValues(record.stage, previous)) return false;
  const [rows] = record.stage, [before] = previous;
  if (!Array.isArray(rows.value)) return false;
  const meetings = rows.value as unknown as GroupMeetingDate[];
  return meetings.every(row => typeof row?.id === 'string' && typeof row.date === 'string')
    && canSaveGroupMeeting(meetings, Array.isArray(before.value) ? before.value as unknown as GroupMeetingDate[] : []);
}
