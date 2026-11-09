import { boundedActionTime } from './actionClock';
import { datedRowTarget, existingRowDate, isDateChange, MEETING_DATE_TARGET } from './datedRowAction';
import { object } from './fieldValues';
import { isValidIdentifier } from './protocol';
import { boundedRowId, existingRowField, existingRowFields, proofRevision } from './rowFieldAction';
import { orderConcurrentRowField, readRowAction, uncertainRowChange } from './rowFieldOrder.server';

import type { ActionTime } from './actionClock';
import type { DatedRowActionEvidence, DatedRowTarget, DisplacedRowDate } from './datedRowAction';
import type { ConflictDetail, DataCommand, ResourceSnapshot } from './types';

const MAX_PROOFS = 32;
type Proof = { rowId: string; date: string; time: ActionTime | null; revision: number; operationId?: string; rowCreatedAt?: string };
type DateOrder = { command: DataCommand; target?: DatedRowTarget; action?: DatedRowActionEvidence; displaced?: DisplacedRowDate;
  kept?: Proof; uncertain?: ConflictDetail[] };

function proofs(rawMetadata: unknown, target: DatedRowTarget): Proof[] {
  const entries = object(rawMetadata) ? rawMetadata[target.proofs] : undefined;
  if (!Array.isArray(entries)) return [];
  return entries.slice(0, MAX_PROOFS).flatMap((item: unknown) => {
    if (!object(item) || !boundedRowId(item.rowId) || !target.accepts(item.date) || !proofRevision(item.revision)) return [];
    const time = item.time === null && target === MEETING_DATE_TARGET ? null : boundedActionTime(item.time);
    const operationId = time && isValidIdentifier(item.operationId) ? item.operationId : undefined;
    const rowCreatedAt = target.birth.accepts(item.rowCreatedAt) ? item.rowCreatedAt : undefined;
    return time === undefined ? [] : [{ rowId: item.rowId, date: item.date, time, revision: item.revision,
      ...(operationId && rowCreatedAt && { operationId, rowCreatedAt }) }];
  });
}

function meetingProofFloor(rawMetadata: unknown): number {
  const floor = object(rawMetadata) ? rawMetadata.meetingDateProofFloor : undefined;
  return proofRevision(floor) ? floor : 0;
}

function uncertainMeetingDate(command: DataCommand, action: DatedRowActionEvidence): DateOrder {
  return { command, uncertain: [uncertainRowChange(action, MEETING_DATE_TARGET)] };
}

function compareUnobservedDate(command: Extract<DataCommand, { kind: 'update' }>, target: DatedRowTarget,
  action: DatedRowActionEvidence, previous: Proof): DateOrder {
  const { date, time } = previous;
  const ordered = orderConcurrentRowField(command, action, target, { value: date, time });
  const { chronology, displaced } = ordered;
  if (date === action.after) {
    if (chronology > 0) return { command, action };
    return chronology < 0 || target === MEETING_DATE_TARGET ? { command, kept: previous } : { command };
  }
  if (!displaced) {
    return target === MEETING_DATE_TARGET && action.before === date ? uncertainMeetingDate(command, action) : { command };
  }
  const { value, winnerValue, ...details } = displaced;
  return { command: ordered.command, target,
    ...(chronology < 0 ? { kept: previous } : { action }),
    displaced: { ...details, date: value, winnerDate: winnerValue } };
}

/** The ordinary merge still decides every neighboring field, row identity and permission. */
export function orderDatedRow(command: DataCommand, current: ResourceSnapshot, rawMetadata: unknown, readTimeMs: number): DateOrder {
  const target = datedRowTarget(command.resource.collection);
  if (!target || command.kind !== 'update' || !current.metadata
    || current.metadata.deleted || command.generation !== current.metadata.generation) return { command };
  const submitted = command[target.evidence];
  const action = readRowAction(command, submitted, target, readTimeMs);
  if (!action || action.observedRevision > current.metadata.revision) return { command };
  const currentDate = existingRowDate(current.value?.[target.field], action.rowId, target);
  if (currentDate === undefined) return { command };
  const previous = proofs(rawMetadata, target).find(item => item.rowId === action.rowId && item.date === currentDate
    && item.revision <= current.metadata!.revision);
  if (previous && previous.revision > action.observedRevision) {
    if (previous.operationId && previous.operationId === submitted?.predecessorOperationId && currentDate === action.before) {
      const change = command.changes.find(item => isDateChange(item, target));
      const born = existingRowField(current.value?.[target.field], action.rowId, target.birth);
      if (change && born && previous.rowCreatedAt === born
        && existingRowField(change.before.value, action.rowId, target.birth) === born
        && existingRowField(change.after.value, action.rowId, target.birth) === born) return { command, action };
    }
    return compareUnobservedDate(command, target, action, previous);
  }
  if (!previous && target === MEETING_DATE_TARGET && currentDate === action.before
    && action.observedRevision < Math.min(meetingProofFloor(rawMetadata), current.metadata.revision)) return uncertainMeetingDate(command, action);
  if (!previous && (currentDate === action.after || (target === MEETING_DATE_TARGET && action.observedRevision < current.metadata.revision))) return { command };
  return { command, action };
}

function unstampedMeetingDates(snapshot: ResourceSnapshot, raw: Record<string, unknown> | undefined): Proof[] {
  const previous = existingRowFields(raw?.meetingDates, MEETING_DATE_TARGET);
  return [...existingRowFields(snapshot.value?.meetingDates, MEETING_DATE_TARGET)].flatMap(([rowId, date]) =>
    !boundedRowId(rowId) || date === undefined || date === previous.get(rowId) ? [] : [{ rowId, date, revision: snapshot.metadata!.revision, time: null }]);
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
  }).map(proof => {
    if (!proof.operationId || proof.rowCreatedAt === existingRowField(rows, proof.rowId, target.birth)) return proof;
    const { rowId, date, time, revision } = proof;
    return { rowId, date, time, revision };
  });
  if (target === MEETING_DATE_TARGET) keep.unshift(...unstampedMeetingDates(snapshot, raw));
  const action = order?.action;
  if (action && existingRowDate(rows, action.rowId, target) === action.after) {
    const rowCreatedAt = existingRowField(rows, action.rowId, target.birth);
    const { operationId, revision } = snapshot.metadata;
    keep.unshift({ rowId: action.rowId, date: action.after, time: action.time, revision,
      ...(operationId && rowCreatedAt && { operationId, rowCreatedAt }) });
  } else if (order?.kept) keep.unshift(order.kept);
  const unique = [...new Map(keep.slice().reverse().map(proof => [proof.rowId, proof])).values()].reverse();
  const retained = unique.slice(0, MAX_PROOFS);
  // After pruning, an action older than an evicted proof cannot infer that a matching value is untouched.
  const floor = target === MEETING_DATE_TARGET
    ? unique.slice(MAX_PROOFS).reduce((value, proof) => Math.max(value, proof.revision), meetingProofFloor(raw?._dataEngine)) : 0;
  return { ...snapshot.metadata, ...(retained.length && { [target.proofs]: retained }), ...(floor && { meetingDateProofFloor: floor }) };
}
