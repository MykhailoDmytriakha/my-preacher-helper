import { firstGroupMeetingIdentity, type MeetingOpening } from '@/utils/groupMeeting';

import { equalValues, object } from './fieldValues';
import { firstMeetingOpening, firstMeetingProofChanges, groupFirstMeetingState } from './groupFirstMeeting';

import type { DataCommand, ResourceSnapshot } from './types';

const legacyOpeningField = 'legacyFirstGroupMeetingOpening';

export function prepareFirstGroupMeetingOrder(command: DataCommand, current: ResourceSnapshot) {
  if (command.resource.collection !== 'groups' || command.kind !== 'update' || !current.value
    || !current.metadata || command.generation !== current.metadata.generation) return;
  const change = command.changes.find(item => item.path[0] === 'meetingDates');
  const opening = change && firstMeetingOpening(change.before, change.after);
  if (!opening) return;
  const state = groupFirstMeetingState(current.value, opening);
  if (!state) return;
  return {
    rowId: opening.id,
    command: { ...command, changes: firstMeetingProofChanges(command.changes) },
    current: state === 'vacant' ? { ...current, value: { ...current.value, meetingDates: [opening] } } : current,
    // The protocol must see actual absence when the accepted command creates the row.
    restoreOpening: (ordered: DataCommand): DataCommand => state === 'vacant' && ordered.kind === 'update'
      ? { ...ordered, changes: ordered.changes.map(item => item.path[0] === 'meetingDates' ? { ...item, before: change!.before } : item) }
      : ordered,
  };
}

/** An implicit blank is the common ancestor of initial edits, never a recorded action. */
export function rawFirstGroupMeetingOpening(command: DataCommand, snapshot: ResourceSnapshot, raw: Record<string, unknown> | undefined) {
  if (command.kind !== 'update' || command.resource.collection !== 'groups' || !raw || !snapshot.value
    || (raw.meetingDates !== undefined && (!Array.isArray(raw.meetingDates) || raw.meetingDates.length))) return raw;
  const change = command.changes.find(item => item.path[0] === 'meetingDates');
  const opening = change && firstMeetingOpening(change.before, change.after);
  return opening && groupFirstMeetingState(snapshot.value, opening) === 'active' ? { ...raw, meetingDates: [opening] } : raw;
}

function commandOpening(command: DataCommand): MeetingOpening | undefined {
  if (command.kind !== 'update' || command.resource.collection !== 'groups') return;
  const change = command.changes.find(item => item.path[0] === 'meetingDates');
  if (change) return firstMeetingOpening(change.before, change.after);
}

function legacyOpening(raw: unknown): MeetingOpening | undefined {
  if (!object(raw)) return;
  const value = raw[legacyOpeningField];
  return firstMeetingOpening({ exists: false }, { exists: true, value: [value ?? null] });
}

/** Only the exact first slot that adopted a legacy group may cross the adoption boundary. */
export function adoptLegacyFirstGroupMeeting(command: DataCommand, current: ResourceSnapshot, raw: unknown): DataCommand {
  if (command.kind !== 'update' || command.generation !== null || !current.metadata || current.metadata.deleted || !current.value
    || command.changes.some(change => !['meetingDates', 'updatedAt'].includes(change.path[0]))) return command;
  const opening = commandOpening(command);
  if (!opening || !equalValues(legacyOpening(raw), opening) || !groupFirstMeetingState(current.value, opening)) return command;
  return { ...command, generation: current.metadata.generation };
}

export function firstGroupMeetingLegacyMetadata(snapshot: ResourceSnapshot, raw: Record<string, unknown> | undefined,
  command: DataCommand | undefined) {
  if (snapshot.resource.collection !== 'groups' || !raw || !snapshot.value) return {};
  const previous = legacyOpening(raw._dataEngine);
  const adopted = command?.generation === null && raw._dataEngine == null;
  const birth = adopted && rawFirstGroupMeetingOpening(command, snapshot, raw) !== raw ? commandOpening(command) : undefined;
  const vacant = adopted && (raw.meetingDates === undefined || Array.isArray(raw.meetingDates) && !raw.meetingDates.length)
    && (snapshot.value.meetingDates === undefined || Array.isArray(snapshot.value.meetingDates) && !snapshot.value.meetingDates.length)
    ? firstGroupMeetingIdentity(snapshot.value) : undefined;
  const opening = previous ?? birth ?? vacant;
  return opening && groupFirstMeetingState(snapshot.value, opening) ? { [legacyOpeningField]: opening } : {};
}
