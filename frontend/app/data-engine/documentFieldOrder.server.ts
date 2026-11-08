import { createHash } from 'node:crypto';

import { isStandaloneScriptureReference } from '@/utils/bibleLink';

import { boundedActionTime, compareActionTime } from './actionClock';
import { documentFieldChange, documentFieldTargets } from './documentFieldAction';
import { object } from './fieldValues';
import { proofRevision } from './rowFieldAction';

import type { ActionTime } from './actionClock';
import type { DocumentFieldObservation, DocumentFieldTarget } from './documentFieldAction';
import type { ConflictDetail, DataCommand, FieldChange, ResourceSnapshot } from './types';

export const DOCUMENT_TITLE_HISTORY = '_titleHistory';
export const GROUP_STATUS_HISTORY = '_statusHistory';
export const SERMON_VERSE_HISTORY = '_verseHistory';
type FieldProof = { value: string; revision: number; time: ActionTime | null; operationId?: string };
type DocumentFieldOrder = {
  command: DataCommand;
  stamp?: ActionTime | null;
  previous?: FieldProof;
  displaced?: { value: string; winnerValue: string; generation: string; actionTime: ActionTime; winnerActionTime: ActionTime };
  uncertain?: ConflictDetail[];
};

const fieldDigest = (value: string) => createHash('sha256').update(value).digest('base64url');

function previousField(raw: unknown, current: ResourceSnapshot, target: DocumentFieldTarget): FieldProof | undefined {
  const proof = object(raw) ? raw[target.proof] : undefined;
  if (!object(proof)) return undefined;
  const value = current.value?.[target.field];
  if (!target.accepts(value) || !proofRevision(proof.revision) || proof.revision > (current.metadata?.revision ?? 0)
    || (target.field === 'verse' ? proof.digest !== fieldDigest(value) : proof[target.field] !== value)) return undefined;
  const time = proof.time === null ? null : boundedActionTime(proof.time);
  return time !== undefined ? { value, revision: proof.revision, time,
    ...(typeof proof.operationId === 'string' && { operationId: proof.operationId }) } : undefined;
}

function readAction(command: Extract<DataCommand, { kind: 'update' }>, change: FieldChange, revision: number, serverMs: number, target: DocumentFieldTarget): DocumentFieldObservation | undefined {
  const action: unknown = command[target.action];
  const before = change.before.value, after = change.after.value;
  if (!object(action) || !change.before.exists || !change.after.exists || !target.accepts(before) || !target.accepts(after) || before === after
    || (target.field !== 'verse' && (before !== action.before || after !== action.after))
    || !proofRevision(action.observedRevision) || action.observedRevision > revision) return undefined;
  const time = target.causal && action.time === null ? null : boundedActionTime(action.time);
  if (time === undefined || (time && (!Number.isFinite(serverMs) || time.earliestMs > serverMs + 5))) return undefined;
  return { before, after, observedRevision: action.observedRevision, time,
    ...(target.causal && typeof action.predecessorOperationId === 'string' && { predecessorOperationId: action.predecessorOperationId }) };
}

function decideUnobservedField(command: Extract<DataCommand, { kind: 'update' }>, change: FieldChange, action: DocumentFieldObservation,
  previous: FieldProof, target: DocumentFieldTarget): DocumentFieldOrder {
  const { value, time } = previous;
  const standalone = target.field !== 'verse' || (action.before.trim() === '' || isStandaloneScriptureReference(action.before))
    && isStandaloneScriptureReference(action.after) && isStandaloneScriptureReference(value);
  const order = standalone && time && action.time ? compareActionTime(action.time, time) : 0;
  if (action.after === value) return order > 0 ? { command, stamp: action.time } : order < 0 ? { command, previous } : { command, stamp: null };
  if (!order || !time || !action.time) {
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
  if (previous && previous.revision > action.observedRevision) {
    // An exact local predecessor is causal even when its action clock was unavailable.
    if (action.predecessorOperationId && previous.operationId === action.predecessorOperationId && previous.value === action.before) {
      return { command, stamp: action.time };
    }
    return decideUnobservedField(command, change, action, previous, target);
  }
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

export function metadataAfterDocumentFields(snapshot: ResourceSnapshot, raw: Record<string, unknown> | undefined, fields?: ReturnType<typeof orderDocumentFields>) {
  const metadata = snapshot.metadata;
  if (!metadata) return metadata;
  const proofs = documentFieldTargets(snapshot.resource.collection).flatMap(target => {
    const value = snapshot.value?.[target.field];
    if (!target.accepts(value)) return [];
    const order = fields?.fields.find(item => item.target === target)?.order;
    const rawMetadata = raw?._dataEngine;
    const previous = order?.previous ?? previousField(rawMetadata, snapshot, target);
    const changed = target.causal && raw?.[target.field] !== value;
    // The first unrelated write to an older sermon, including a secondary effect,
    // observes the same field at the original revision.
    const revision = target.causal && !changed && order?.stamp === undefined && object(rawMetadata)
      && rawMetadata.generation === metadata.generation && proofRevision(rawMetadata.revision)
      ? rawMetadata.revision : metadata.revision;
    const proof: FieldProof = order?.stamp === undefined && previous ? previous : {
      value, revision, time: order?.stamp ?? null,
      ...(changed && metadata.operationId && { operationId: metadata.operationId }),
    };
    const match = target.field === 'verse' ? { digest: fieldDigest(proof.value) } : { [target.field]: proof.value };
    return [[target.proof, { ...match, revision: proof.revision, time: proof.time,
      ...(target.causal && proof.operationId && { operationId: proof.operationId }) }]] as const;
  });
  return { ...metadata, ...Object.fromEntries(proofs) };
}
