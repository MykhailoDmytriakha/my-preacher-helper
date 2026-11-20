import { firstGroupMeetingIdentity, type MeetingOpening } from '@/utils/groupMeeting';

import { equalValues, object, readField, writeField } from './fieldValues';

import type { ConflictDetail, DocumentData, FieldChange, FieldValue } from './types';

export const FIRST_GROUP_MEETING_COMPARISON = 'first-group-meeting-comparison';
export const FIRST_GROUP_MEETING_FIELDS = ['date', 'location', 'audience'] as const;
const initialMeetingId = /^first-meeting-(0|[1-9]\d{0,15})$/;
export type Merge = (base: FieldValue, mine: FieldValue, theirs: FieldValue, path: string[]) => { value: FieldValue; conflicts: ConflictDetail[] };

function emptyList(field: FieldValue): boolean {
  return !field.exists || Array.isArray(field.value) && field.value.length === 0;
}

function firstRow(field: FieldValue): DocumentData | undefined {
  const row = field.exists && Array.isArray(field.value) ? field.value[0] : undefined;
  return object(row) ? row : undefined;
}

function sameBirth(row: DocumentData | undefined, opening: Pick<MeetingOpening, 'id' | 'createdAt'>): boolean {
  return row?.id === opening.id && row.createdAt === opening.createdAt;
}

/** A normal row addition has its own ID. This shape is reserved for the blank first-meeting form. */
export function firstMeetingOpening(before: FieldValue, after: FieldValue): MeetingOpening | undefined {
  if (!emptyList(before) || !Array.isArray(after.value) || after.value.length !== 1) return;
  const row = firstRow(after);
  if (!row || typeof row.id !== 'string' || typeof row.createdAt !== 'string' || !row.createdAt
    || !initialMeetingId.test(row.id) || typeof row.date !== 'string'
    || Object.keys(row).some(key => !['id', 'createdAt', 'date', 'location', 'audience'].includes(key))) return;
  return { id: row.id, createdAt: row.createdAt, date: '' };
}

export function meetingOpeningField(opening: MeetingOpening): FieldValue {
  return { exists: true, value: [opening] };
}

export function withFirstMeetingOpening(group: DocumentData | null, proposed: DocumentData | null): DocumentData | null {
  if (!group || !proposed) return group;
  const opening = firstMeetingOpening(readField(group, ['meetingDates']), readField(proposed, ['meetingDates']));
  return opening && equalValues(opening, firstGroupMeetingIdentity(group)) ? { ...group, meetingDates: [opening] } : group;
}

export function captureFirstGroupMeetingChange(opening: DocumentData | null, proposed: DocumentData | null): FieldChange | undefined {
  if (!opening || !proposed || withFirstMeetingOpening(opening, proposed) === opening) return;
  const path = ['meetingDates'];
  return { path, before: readField(opening, path), after: readField(proposed, path) };
}

export function firstMeetingProofChanges(changes: FieldChange[]): FieldChange[] {
  return changes.map(change => {
    const opening = change.path[0] === 'meetingDates' && firstMeetingOpening(change.before, change.after);
    return opening ? { ...change, before: meetingOpeningField(opening) } : change;
  });
}

function firstMeetingConflict(path: string[], base: FieldValue, mine: FieldValue, theirs: FieldValue) {
  return { value: mine, conflicts: [{ path, base, mine, theirs }] };
}

/** The two additions have a shared empty ancestor only when they fill the same slot. */
export function mergeFirstGroupMeeting(base: FieldValue, mine: FieldValue, theirs: FieldValue, path: string[], merge: Merge) {
  if (!emptyList(base) || emptyList(theirs)) return;
  const opening = firstMeetingOpening(base, mine);
  const stored = firstRow(theirs);
  if (opening) return sameBirth(stored, opening)
    ? merge(meetingOpeningField(opening), mine, theirs, path)
    : firstMeetingConflict(path, base, mine, theirs);
  const added = firstRow(mine);
  if (typeof stored?.id === 'string' && initialMeetingId.test(stored.id) && added && added.id !== stored.id) {
    // A previous client could not identify the initial slot. Keep both versions for review.
    return firstMeetingConflict(path, base, mine, theirs);
  }
}

export function groupFirstMeetingState(current: DocumentData, opening: MeetingOpening): 'vacant' | 'active' | undefined {
  const meetings = readField(current, ['meetingDates']);
  if (emptyList(meetings) && equalValues(opening, firstGroupMeetingIdentity(current))) return 'vacant';
  if (opening.createdAt === current.createdAt && sameBirth(firstRow(meetings), opening)) return 'active';
}

/** A delayed initial save may fill its own slot, never a later empty or different first meeting. */
export function mergeFirstGroupMeetingCommand(change: FieldChange, current: DocumentData, merge: Merge) {
  const opening = firstMeetingOpening(change.before, change.after);
  if (!opening) return;
  const state = groupFirstMeetingState(current, opening);
  if (state === 'vacant') return { value: change.after, conflicts: [] };
  const theirs = readField(current, change.path);
  return state === 'active'
    ? merge(meetingOpeningField(opening), change.after, theirs, change.path)
    : firstMeetingConflict(change.path, change.before, change.after, theirs);
}

function comparisonRow(row: DocumentData | undefined): FieldValue {
  if (!row) return { exists: false };
  const { id, createdAt, date, location, audience } = row;
  return { exists: true, value: { id, createdAt, date,
    ...(location !== undefined && { location }), ...(audience !== undefined && { audience }) } };
}

export function groupFirstMeetingComparison(change: FieldChange, effective: FieldChange, current: DocumentData,
  conflicts: readonly ConflictDetail[], merge: Merge): ConflictDetail | undefined {
  const live = readField(current, change.path);
  const opening = firstMeetingOpening(change.before, change.after);
  const stored = firstRow(live);
  const first = firstRow(change.after);
  const addingFirst = emptyList(change.before);
  if (!first || (addingFirst && (!Array.isArray(change.after.value) || change.after.value.length !== 1))) return;
  const prior = firstRow(change.before);
  const existing = typeof prior?.id === 'string' && typeof prior.createdAt === 'string' && prior.createdAt
    ? { id: prior.id, createdAt: prior.createdAt } : undefined;
  const observed = opening && groupFirstMeetingState(current, opening) === 'active' ? opening : existing;

  let mine: DocumentData | undefined;
  let remote: DocumentData | undefined = stored;
  if (conflicts.some(item => equalValues(item.path, change.path))) {
    if (!addingFirst || (!opening && !(typeof stored?.id === 'string' && initialMeetingId.test(stored.id)))) return;
    mine = stored ?? firstGroupMeetingIdentity(current);
    if (mine) for (const field of FIRST_GROUP_MEETING_FIELDS) {
      const value = first[field];
      if (typeof value === 'string' && value) mine = { ...mine, [field]: value };
    }
  } else if (observed && stored && sameBirth(stored, observed) && sameBirth(first, observed)) {
    const root = ['meetingDates', 'id:' + observed.id];
    const compared = conflicts.filter(item => equalValues(item.path.slice(0, 2), root) && item.path.length === 3
      && FIRST_GROUP_MEETING_FIELDS.some(field => field === item.path[2]));
    if (!compared.length) return;
    const rebased = merge(effective.before, effective.after, live, change.path);
    mine = firstRow(rebased.value);
    remote = mine;
    if (remote) for (const { path } of compared) remote = writeField(remote, [path[2]], readField(stored, [path[2]]));
  } else return;

  const rowId = stored?.id ?? first.id;
  if (typeof rowId !== 'string') return;
  return { path: ['meetingDates', 'id:' + rowId], code: FIRST_GROUP_MEETING_COMPARISON,
    base: comparisonRow(stored), mine: comparisonRow(mine), theirs: comparisonRow(remote) };
}

export function firstGroupMeetingReview(conflicts: readonly ConflictDetail[]): ConflictDetail | undefined {
  return conflicts.find(conflict => conflict.code === FIRST_GROUP_MEETING_COMPARISON);
}

/** Apply only the reviewed leaves. A changed first row cannot acquire a stale choice. */
export function projectFirstGroupMeetingChoice(stored: DocumentData, comparison: ConflictDetail,
  choice: 'local' | 'remote', amendment?: { before: DocumentData | null; after: DocumentData }): DocumentData | undefined {
  const rows = Array.isArray(stored.meetingDates) ? stored.meetingDates : [];
  const live = firstRow({ exists: true, value: rows });
  const basis = comparison.base.exists && object(comparison.base.value) ? comparison.base.value : undefined;
  const selected = choice === 'local' ? comparison.mine : comparison.theirs;
  const option = selected.exists && object(selected.value) ? selected.value : undefined;
  if (!option) return choice === 'remote' ? stored : undefined;
  if (live && (!basis || live.id !== basis.id || live.createdAt !== basis.createdAt) || !live && basis) {
    return choice === 'remote' ? stored : undefined;
  }
  let row = live ?? firstGroupMeetingIdentity(stored);
  if (!row) return;
  const prior = amendment?.before && firstRow(readField(amendment.before, ['meetingDates']));
  const edited = amendment && firstRow(readField(amendment.after, ['meetingDates']));
  for (const field of FIRST_GROUP_MEETING_FIELDS) {
    const before = basis ? readField(basis, [field]) : { exists: false };
    const original = readField(option, [field]);
    const correction = prior && edited && prior.id === edited.id && prior.createdAt === edited.createdAt
      && !equalValues(readField(prior, [field]), readField(edited, [field])) ? readField(edited, [field]) : undefined;
    const value = correction ?? original;
    if (!equalValues(value, before)) {
      const now = live && readField(live, [field]);
      if (now && !equalValues(now, before) && !equalValues(now, value)) {
        if (choice === 'local') return;
      } else row = writeField(row, [field], value);
    }
  }
  return { ...stored, meetingDates: [row, ...rows.slice(1)] };
}
