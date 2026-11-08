import { createHash } from 'node:crypto';

import { boundedActionTime } from './actionClock';
import { object } from './fieldValues';
import { GROUP_MEETING_FIELDS, matchesMeetingFieldBirth, MEETING_ROW_BIRTH, meetingFieldTarget, replacedMeetingField } from './groupMeetingFieldAction';
import { boundedRowId, existingRowField, existingRowFields, proofRevision } from './rowFieldAction';
import { orderConcurrentRowField, readRowAction, uncertainRowChange } from './rowFieldOrder.server';

import type { ActionTime } from './actionClock';
import type { GroupMeetingField, GroupMeetingFieldAction, GroupMeetingFieldHistoryEntry } from './groupMeetingFieldAction';
import type { RowValue } from './rowFieldAction';
import type { ConflictDetail, DataCommand, ResourceSnapshot } from './types';

const MAX_PROOFS = 32;
export const GROUP_MEETING_FIELD_HISTORY = '_meetingFieldHistory';

type Update = Extract<DataCommand, { kind: 'update' }>;
type Proof = { rowId: string; digest: string; revision: number; time: ActionTime | null; operationId: string };
type FieldPlan = {
  command: Update;
  stamp?: GroupMeetingFieldAction;
  displaced?: GroupMeetingFieldHistoryEntry;
  uncertain?: ConflictDetail;
  sameValueWithoutOrder?: string;
};

const digest = (born: string, value: RowValue) => createHash('sha256').update(JSON.stringify([born, value])).digest('base64url');

function readProofs(raw: unknown, field: GroupMeetingField) {
  const all = object(raw) ? raw.groupMeetingFieldProofs : undefined;
  const stored = object(all) ? all[field] : undefined;
  const floor = object(stored) && proofRevision(stored.floor) ? stored.floor : 0;
  const proofs = object(stored) && Array.isArray(stored.proofs) ? stored.proofs : [];
  const values = proofs.slice(0, MAX_PROOFS).flatMap((item): Proof[] => {
    if (!object(item) || !boundedRowId(item.rowId) || !proofRevision(item.revision)
      || typeof item.operationId !== 'string' || typeof item.digest !== 'string' || !/^[a-zA-Z0-9_-]{43}$/.test(item.digest)) return [];
    const time = item.time === null ? null : boundedActionTime(item.time);
    return time !== undefined ? [{ rowId: item.rowId, digest: item.digest, revision: item.revision, time, operationId: item.operationId }] : [];
  });
  return { values, floor };
}

function orderField(command: Update, current: ResourceSnapshot, raw: unknown, serverMs: number,
  field: GroupMeetingField): FieldPlan {
  const target = meetingFieldTarget(field);
  const actions = command.groupMeetingFieldActions;
  const submitted = object(actions) ? actions[field] : undefined;
  const evidence = readRowAction(command, submitted, target, serverMs);
  const revision = current.metadata!.revision;
  if (!evidence || evidence.observedRevision > revision || !object(submitted) || !MEETING_ROW_BIRTH.accepts(submitted.rowCreatedAt)) return { command };
  const action = { ...evidence, rowCreatedAt: submitted.rowCreatedAt };
  if (!matchesMeetingFieldBirth(command.changes, action)) return { command };
  const replacement = replacedMeetingField(current, field, action);
  if (replacement) return { command, uncertain: replacement };
  const rows = current.value?.meetingDates;
  const value = existingRowField(rows, action.rowId, target);
  if (value === undefined || existingRowField(rows, action.rowId, MEETING_ROW_BIRTH) !== action.rowCreatedAt) return { command };
  const { values, floor } = readProofs(raw, field);
  const key = digest(action.rowCreatedAt, value);
  const previous = values.find(proof => proof.rowId === action.rowId && proof.revision <= revision && proof.digest === key);
  if (previous && previous.revision > action.observedRevision) {
    if (previous.time && value === action.before && previous.operationId === submitted.predecessorOperationId) return { command, stamp: action };
    return orderUnobservedMeetingField(command, action, field, value, previous);
  }
  if (!previous && value === action.before && action.observedRevision < Math.min(floor, revision)) {
    return { command, uncertain: uncertainRowChange(action, target) };
  }
  return { command, ...(value !== action.after && (previous || action.observedRevision === revision) ? { stamp: action } : {}) };
}

function orderUnobservedMeetingField(command: Update, action: GroupMeetingFieldAction, field: GroupMeetingField,
  value: RowValue, previous: Proof): FieldPlan {
  const target = meetingFieldTarget(field);
  const ordered = orderConcurrentRowField(command, action, target, { value, time: previous.time });
  if (ordered.displaced) return { command: ordered.command, displaced: { ...ordered.displaced, field, rowCreatedAt: action.rowCreatedAt },
    ...(ordered.chronology > 0 ? { stamp: action } : {}) };
  if (ordered.chronology > 0) return { command, stamp: action };
  if (!ordered.chronology && value === action.after) return { command, sameValueWithoutOrder: action.rowId };
  if (!ordered.chronology && value === action.before) return { command, uncertain: uncertainRowChange(action, target) };
  return { command };
}

export function orderGroupMeetingFields(command: DataCommand, current: ResourceSnapshot, raw: unknown, serverMs: number) {
  const fields = new Map<GroupMeetingField, FieldPlan>();
  if (command.resource.collection === 'groups' && command.kind === 'update' && current.metadata && !current.metadata.deleted
    && command.generation === current.metadata.generation) {
    for (const field of GROUP_MEETING_FIELDS) {
      const plan = orderField(command, current, raw, serverMs, field);
      fields.set(field, plan);
      command = plan.command;
    }
  }
  const plans = [...fields.values()];
  return { command, fields, displaced: plans.flatMap(plan => plan.displaced ?? []), uncertain: plans.flatMap(plan => plan.uncertain ?? []) };
}

export function metadataAfterGroupMeetingFields(snapshot: ResourceSnapshot, raw: Record<string, unknown> | undefined,
  order?: ReturnType<typeof orderGroupMeetingFields>) {
  const metadata = snapshot.metadata;
  if (!metadata || !snapshot.value || snapshot.resource.collection !== 'groups') return metadata;
  const births = existingRowFields(snapshot.value.meetingDates, MEETING_ROW_BIRTH);
  const previousBirths = existingRowFields(raw?.meetingDates, MEETING_ROW_BIRTH);
  const groupMeetingFieldProofs = Object.fromEntries(GROUP_MEETING_FIELDS.flatMap(field => {
    const target = meetingFieldTarget(field);
    const current = existingRowFields(snapshot.value?.meetingDates, target);
    const previous = existingRowFields(raw?.meetingDates, target);
    const stored = readProofs(raw?._dataEngine, field);
    const plan = order?.fields.get(field);
    const stamp = plan?.stamp;
    const updated = [...current].flatMap(([rowId, value]): Proof[] => {
      const born = births.get(rowId);
      if (value === undefined || !born || !boundedRowId(rowId) || !metadata.operationId) return [];
      const time = stamp?.rowId === rowId && stamp.rowCreatedAt === born && stamp.after === value ? stamp.time : null;
      return time || previous.get(rowId) !== value || previousBirths.get(rowId) !== born || plan?.sameValueWithoutOrder === rowId
        ? [{ rowId, digest: digest(born, value), revision: metadata.revision, time, operationId: metadata.operationId }] : [];
    });
    const newRows = new Set(updated.map(proof => proof.rowId));
    const retained = [...updated, ...stored.values.filter(proof => {
      const value = current.get(proof.rowId);
      const born = births.get(proof.rowId);
      return value !== undefined && born && !newRows.has(proof.rowId) && proof.digest === digest(born, value);
    })];
    const floor = retained.slice(MAX_PROOFS).reduce((revision, proof) => Math.max(revision, proof.revision), stored.floor);
    return retained.length || floor ? [[field, { proofs: retained.slice(0, MAX_PROOFS), floor }]] : [];
  }));
  return { ...metadata, ...(Object.keys(groupMeetingFieldProofs).length ? { groupMeetingFieldProofs } : {}) };
}
