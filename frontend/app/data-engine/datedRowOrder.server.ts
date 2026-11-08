import { boundedActionTime, compareActionTime } from './actionClock';
import { datedRowTarget, existingRowDate, isDateChange, matchesDatedRowChange, MEETING_DATE_TARGET, replaceExistingDate } from './datedRowAction';
import { object } from './fieldValues';

import type { ActionTime } from './actionClock';
import type { DatedRowActionEvidence, DatedRowTarget, DisplacedRowDate } from './datedRowAction';
import type { ConflictDetail, DataCommand, FieldChange, ResourceSnapshot } from './types';

const MAX_PROOFS = 32;
type Proof = { rowId: string; date: string; time: ActionTime | null; revision: number };
type DateOrder = { command: DataCommand; target?: DatedRowTarget; action?: DatedRowActionEvidence; displaced?: DisplacedRowDate;
  kept?: Proof; uncertain?: ConflictDetail[] };

const boundedRow = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128;
const revision = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

function actionFrom(command: Extract<DataCommand, { kind: 'update' }>, target: DatedRowTarget, readTimeMs: number): DatedRowActionEvidence | undefined {
  const action: unknown = command[target.evidence];
  if (!object(action) || !boundedRow(action.rowId) || !target.isDate(action.before) || !target.isDate(action.after)
    || action.before === action.after || !revision(action.observedRevision) || !Number.isFinite(readTimeMs)) return undefined;
  const time = boundedActionTime(action.time);
  if (!time) return undefined;
  const evidence = { rowId: action.rowId, time, before: action.before, after: action.after, observedRevision: action.observedRevision };
  if (evidence.time.earliestMs > readTimeMs + 5 || !matchesDatedRowChange(command.changes, evidence, target)) return undefined;
  return evidence;
}

function proofs(rawMetadata: unknown, target: DatedRowTarget): Proof[] {
  const entries = object(rawMetadata) ? rawMetadata[target.proofs] : undefined;
  if (!Array.isArray(entries)) return [];
  return entries.slice(0, MAX_PROOFS).flatMap((item: unknown) => {
    if (!object(item) || !boundedRow(item.rowId) || !target.isDate(item.date) || !revision(item.revision)) return [];
    const time = item.time === null && target === MEETING_DATE_TARGET ? null : boundedActionTime(item.time);
    return time === undefined ? [] : [{ rowId: item.rowId, date: item.date, time, revision: item.revision }];
  });
}

function foldDateChange(change: FieldChange, target: DatedRowTarget, rowId: string, date: string, keepStored: boolean): FieldChange {
  if (!isDateChange(change, target)) return change;
  return {
    ...change,
    before: { ...change.before, value: replaceExistingDate(change.before.value, rowId, date, target) },
    after: keepStored ? { ...change.after, value: replaceExistingDate(change.after.value, rowId, date, target) } : change.after,
  };
}

function meetingProofFloor(rawMetadata: unknown): number {
  const floor = object(rawMetadata) ? rawMetadata.meetingDateProofFloor : undefined;
  return revision(floor) ? floor : 0;
}

function uncertainMeetingDate(command: DataCommand, action: DatedRowActionEvidence): DateOrder {
  const base = { exists: true, value: action.before };
  return { command, uncertain: [{ path: [MEETING_DATE_TARGET.field, `id:${action.rowId}`, 'date'],
    base, mine: { exists: true, value: action.after }, theirs: base }] };
}

function compareUnobservedDate(command: Extract<DataCommand, { kind: 'update' }>, target: DatedRowTarget,
  action: DatedRowActionEvidence, previous: Proof): DateOrder {
  const { date, time } = previous;
  const order = time ? compareActionTime(action.time, time) : 0;
  if (date === action.after) {
    if (order > 0) return { command, action };
    return order < 0 || target === MEETING_DATE_TARGET ? { command, kept: previous } : { command };
  }
  if (!time || !order) {
    if (target !== MEETING_DATE_TARGET || action.before !== date) return { command };
    return uncertainMeetingDate(command, action);
  }
  const older = order < 0;
  const displaced = { rowId: action.rowId, generation: command.generation!, date: older ? action.after : date,
    winnerDate: older ? date : action.after,
    actionTime: older ? action.time : time, winnerActionTime: older ? time : action.time };
  const changes = command.changes.map(change => foldDateChange(change, target, action.rowId, date, older));
  return { command: { ...command, changes }, target, action: older ? undefined : action, kept: older ? previous : undefined, displaced };
}

/** The ordinary merge still decides every neighboring field, row identity and permission. */
export function orderDatedRow(command: DataCommand, current: ResourceSnapshot, rawMetadata: unknown, readTimeMs: number): DateOrder {
  const target = datedRowTarget(command.resource.collection);
  if (!target || command.kind !== 'update' || !current.metadata
    || current.metadata.deleted || command.generation !== current.metadata.generation) return { command };
  const action = actionFrom(command, target, readTimeMs);
  if (!action || action.observedRevision > current.metadata.revision) return { command };
  const currentDate = existingRowDate(current.value?.[target.field], action.rowId, target);
  if (currentDate === undefined) return { command };
  const previous = proofs(rawMetadata, target).find(item => item.rowId === action.rowId && item.date === currentDate
    && item.revision <= current.metadata!.revision);
  if (previous && previous.revision > action.observedRevision) return compareUnobservedDate(command, target, action, previous);
  if (!previous && target === MEETING_DATE_TARGET && currentDate === action.before
    && action.observedRevision < Math.min(meetingProofFloor(rawMetadata), current.metadata.revision)) return uncertainMeetingDate(command, action);
  if (!previous && (currentDate === action.after || (target === MEETING_DATE_TARGET && action.observedRevision < current.metadata.revision))) return { command };
  return { command, action };
}

function meetingDays(rows: unknown): Map<string, string | undefined> {
  const days = new Map<string, string | undefined>();
  if (Array.isArray(rows)) for (const row of rows) {
    if (object(row) && boundedRow(row.id)) {
      days.set(row.id, !days.has(row.id) && MEETING_DATE_TARGET.isDate(row.date) ? row.date : undefined);
    }
  }
  return days;
}

function unstampedMeetingDates(snapshot: ResourceSnapshot, raw: Record<string, unknown> | undefined): Proof[] {
  const previous = meetingDays(raw?.meetingDates);
  return [...meetingDays(snapshot.value?.meetingDates)].flatMap(([rowId, date]) =>
    date === undefined || date === previous.get(rowId) ? [] : [{ rowId, date, revision: snapshot.metadata!.revision, time: null }]);
}

/** An unstamped meeting edit retires the previous timestamp, even when the date later returns. */
export function metadataAfterDatedRow(snapshot: ResourceSnapshot, raw: Record<string, unknown> | undefined, submitted: DataCommand | undefined, order?: DateOrder) {
  const target = datedRowTarget(snapshot.resource.collection);
  if (!target || !snapshot.value || !snapshot.metadata) return snapshot.metadata;
  const rows = snapshot.value[target.field];
  const directChange = submitted?.kind === 'update' && submitted.changes.find(change => isDateChange(change, target));
  const keep = proofs(raw?._dataEngine, target).filter(proof => {
    if (existingRowDate(rows, proof.rowId, target) !== proof.date) return false;
    if (!directChange || target === MEETING_DATE_TARGET) return true;
    return existingRowDate(directChange.before.value, proof.rowId, target) === existingRowDate(directChange.after.value, proof.rowId, target);
  });
  if (target === MEETING_DATE_TARGET) keep.unshift(...unstampedMeetingDates(snapshot, raw));
  const action = order?.action;
  if (action && existingRowDate(rows, action.rowId, target) === action.after) {
    keep.unshift({ rowId: action.rowId, date: action.after, time: action.time, revision: snapshot.metadata.revision });
  } else if (order?.kept) keep.unshift(order.kept);
  const unique = [...new Map(keep.slice().reverse().map(proof => [proof.rowId, proof])).values()].reverse();
  const retained = unique.slice(0, MAX_PROOFS);
  // After pruning, an action older than an evicted proof cannot infer that a matching value is untouched.
  const floor = target === MEETING_DATE_TARGET
    ? unique.slice(MAX_PROOFS).reduce((value, proof) => Math.max(value, proof.revision), meetingProofFloor(raw?._dataEngine)) : 0;
  return { ...snapshot.metadata, ...(retained.length && { [target.proofs]: retained }), ...(floor && { meetingDateProofFloor: floor }) };
}
