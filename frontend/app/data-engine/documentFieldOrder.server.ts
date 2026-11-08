import { boundedActionTime, compareActionTime } from './actionClock';
import { documentFieldChange, documentFieldTargets } from './documentFieldAction';
import { object } from './fieldValues';

import type { ActionTime } from './actionClock';
import type { DocumentFieldAction, DocumentFieldTarget } from './documentFieldAction';
import type { ConflictDetail, DataCommand, FieldChange, ResourceSnapshot } from './types';

export const DOCUMENT_TITLE_HISTORY = '_titleHistory';
export const GROUP_STATUS_HISTORY = '_statusHistory';
type FieldProof = { value: string; revision: number; time: ActionTime | null };
type DocumentFieldOrder = {
  command: DataCommand;
  stamp?: ActionTime | null;
  previous?: FieldProof;
  displaced?: { value: string; winnerValue: string; generation: string; actionTime: ActionTime; winnerActionTime: ActionTime };
  uncertain?: ConflictDetail[];
};

function previousField(raw: unknown, current: ResourceSnapshot, target: DocumentFieldTarget): FieldProof | undefined {
  const proof = object(raw) ? raw[target.proof] : undefined;
  if (!object(proof)) return undefined;
  const value = proof[target.field];
  if (!target.accepts(value) || value !== current.value?.[target.field]
    || typeof proof.revision !== 'number' || !Number.isSafeInteger(proof.revision)
    || proof.revision < 1 || proof.revision > (current.metadata?.revision ?? 0)) return undefined;
  const time = proof.time === null ? null : boundedActionTime(proof.time);
  return time !== undefined ? { value, revision: proof.revision, time } : undefined;
}

function readAction(command: Extract<DataCommand, { kind: 'update' }>, change: FieldChange, revision: number, serverMs: number, target: DocumentFieldTarget): DocumentFieldAction | undefined {
  const action: unknown = command[target.action];
  if (!object(action) || !target.accepts(action.before) || !target.accepts(action.after) || action.before === action.after
    || !change.before.exists || !change.after.exists || change.before.value !== action.before || change.after.value !== action.after
    || typeof action.observedRevision !== 'number' || !Number.isSafeInteger(action.observedRevision)
    || action.observedRevision < 1 || action.observedRevision > revision || !Number.isFinite(serverMs)) return undefined;
  const time = boundedActionTime(action.time);
  return time && time.earliestMs <= serverMs + 5 ? { before: action.before, after: action.after, observedRevision: action.observedRevision, time } : undefined;
}

function decideUnobservedField(command: Extract<DataCommand, { kind: 'update' }>, change: FieldChange, action: DocumentFieldAction,
  previous: FieldProof): DocumentFieldOrder {
  const { value, time } = previous;
  const order = time ? compareActionTime(action.time, time) : 0;
  if (action.after === value) return order > 0 ? { command, stamp: action.time } : order < 0 ? { command, previous } : { command, stamp: null };
  if (!order || !time) {
    const uncertain = action.before === value ? [{ path: change.path, base: change.before, mine: change.after, theirs: change.before }] : undefined;
    return { command, uncertain };
  }
  const incomingWins = order > 0;
  const stored = { exists: true, value };
  const changes = command.changes.map(field => field === change
    ? { ...field, before: stored, after: incomingWins ? field.after : stored }
    : field);
  return {
    command: { ...command, changes },
    ...(incomingWins ? { stamp: action.time } : { previous }),
    displaced: {
      value: incomingWins ? value : action.after,
      winnerValue: incomingWins ? action.after : value,
      generation: command.generation!,
      actionTime: incomingWins ? time : action.time,
      winnerActionTime: incomingWins ? action.time : time,
    },
  };
}

function orderDocumentField(command: DataCommand, current: ResourceSnapshot, raw: unknown, serverMs: number,
  target: DocumentFieldTarget): DocumentFieldOrder {
  if (command.kind !== 'update') return { command };
  const change = documentFieldChange(command.changes, target);
  if (!change || !current.metadata || current.metadata.deleted || command.generation !== current.metadata.generation) return { command };
  if (!target.accepts(current.value?.[target.field])) return { command, stamp: null };
  const action = readAction(command, change, current.metadata.revision, serverMs, target);
  if (!action) return { command, stamp: null };
  const previous = previousField(raw, current, target);
  if (previous && previous.revision > action.observedRevision) return decideUnobservedField(command, change, action, previous);
  if (action.after === current.value?.[target.field]) return { command, previous };
  return { command, stamp: previous || action.observedRevision === current.metadata.revision ? action.time : null };
}

export function orderDocumentFields(command: DataCommand, current: ResourceSnapshot, raw: unknown, serverMs: number) {
  const fields = documentFieldTargets(command.resource.collection).map(target => {
    const order = orderDocumentField(command, current, raw, serverMs, target);
    command = order.command;
    return { target, order };
  });
  return { command, fields, uncertain: fields.flatMap(({ order }) => order.uncertain ?? []) };
}

export function metadataAfterDocumentFields(snapshot: ResourceSnapshot, raw: unknown, fields?: ReturnType<typeof orderDocumentFields>) {
  const metadata = snapshot.metadata;
  if (!metadata) return metadata;
  const proofs = documentFieldTargets(snapshot.resource.collection).flatMap(target => {
    const value = snapshot.value?.[target.field];
    if (!target.accepts(value)) return [];
    const order = fields?.fields.find(item => item.target === target)?.order;
    const previous = order?.previous ?? previousField(raw, snapshot, target);
    const proof = order?.stamp === undefined && previous ? previous : { value, revision: metadata.revision, time: order?.stamp ?? null };
    return [[target.proof, { [target.field]: proof.value, revision: proof.revision, time: proof.time }]] as const;
  });
  return { ...metadata, ...Object.fromEntries(proofs) };
}
