import { createHash } from 'node:crypto';

import { isStandaloneScriptureReference } from '@/utils/bibleLink';

import { boundedActionTime, compareActionTime } from './actionClock';
import { councilLifecycleValue, councilStatusOf, matchesCouncilLifecycle } from './councilFieldAction';
import { acceptsDocumentField, documentFieldChange, documentFieldTargets } from './documentFieldAction';
import { commandFingerprint, equalValues, object, readField } from './fieldValues';
import { proofRevision } from './rowFieldAction';
import { rebaseSermonChurchFill } from './sermonChurchFill';

import type { ActionTime } from './actionClock';
import type { DocumentFieldObservation, DocumentFieldTarget } from './documentFieldAction';
import type { ConflictDetail, DataCommand, DocumentData, FieldChange, FieldValue, ResourceSnapshot } from './types';

export const DOCUMENT_TITLE_HISTORY = '_titleHistory';
export const GROUP_STATUS_HISTORY = '_statusHistory';
export const SERMON_VERSE_HISTORY = '_verseHistory';
export const SERMON_CHURCH_HISTORY = '_churchHistory';
export const DOCUMENT_METADATA_HISTORY = '_metadataHistory';
type FieldProof = { value: FieldValue; revision: number; time: ActionTime | null; operationId?: string };
type DocumentFieldOrder = {
  command: DataCommand;
  stamp?: ActionTime | null;
  previous?: FieldProof;
  displaced?: { value: FieldValue; winnerValue: FieldValue; generation: string; actionTime: ActionTime; winnerActionTime: ActionTime };
  uncertain?: ConflictDetail[];
};

const usesDigest = (target: DocumentFieldTarget) => target.field === 'verse' || target.field === 'church' || target.field === 'date' || target.field === 'heldAt' || target.field === 'answeredAt' || target.action === 'seriesFieldActions';
const fieldDigest = (value: FieldValue, target: DocumentFieldTarget) => createHash('sha256')
  .update(target.field === 'verse' ? String(value.value) : commandFingerprint(value)).digest('base64url');

function previousField(raw: unknown, current: ResourceSnapshot, target: DocumentFieldTarget): FieldProof | undefined {
  const proof = object(raw) ? raw[target.proof] : undefined;
  if (!object(proof)) return undefined;
  if (!current.value) return undefined;
  const value = target.field === 'heldAt' ? councilLifecycleValue(current.value) : readField(current.value, [target.field]);
  if (!value || !acceptsDocumentField(value, target) || !proofRevision(proof.revision) || proof.revision > (current.metadata?.revision ?? 0)
    || (usesDigest(target) ? proof.digest !== fieldDigest(value, target) : proof[target.field] !== value.value)) return undefined;
  const time = proof.time === null ? null : boundedActionTime(proof.time);
  return time !== undefined ? { value, revision: proof.revision, time,
    ...(typeof proof.operationId === 'string' && { operationId: proof.operationId }) } : undefined;
}

function readAction(command: Extract<DataCommand, { kind: 'update' }>, change: FieldChange, revision: number, serverMs: number, target: DocumentFieldTarget): DocumentFieldObservation<FieldValue> | undefined {
  const action: unknown = target.action === 'seriesFieldActions' ? command.seriesFieldActions?.[target.field] : command[target.action];
  const { before, after } = change;
  if (!object(action) || !acceptsDocumentField(before, target) || !acceptsDocumentField(after, target) || equalValues(before, after)
    || (target.field === 'heldAt' && !matchesCouncilLifecycle(command.changes, change))
    || (!usesDigest(target) && (before.value !== action.before || after.value !== action.after))
    || !proofRevision(action.observedRevision) || action.observedRevision > revision) return undefined;
  const time = target.causal && action.time === null ? null : boundedActionTime(action.time);
  if (time === undefined || (time && (!Number.isFinite(serverMs) || time.earliestMs > serverMs + 5))) return undefined;
  return { before, after, observedRevision: action.observedRevision, time,
    ...(target.causal && typeof action.predecessorOperationId === 'string' && { predecessorOperationId: action.predecessorOperationId }) };
}

function decideUnobservedField(command: Extract<DataCommand, { kind: 'update' }>, change: FieldChange, action: DocumentFieldObservation<FieldValue>,
  previous: FieldProof, target: DocumentFieldTarget): DocumentFieldOrder {
  const { value, time } = previous;
  const before = action.before.value, after = action.after.value, stored = value.value;
  const standalone = target.field !== 'verse' || typeof before === 'string' && typeof after === 'string' && typeof stored === 'string'
    && (before.trim() === '' || isStandaloneScriptureReference(before))
    && isStandaloneScriptureReference(after) && isStandaloneScriptureReference(stored);
  const order = standalone && time && action.time ? compareActionTime(action.time, time) : 0;
  if (equalValues(action.after, value)) return order > 0 ? { command, stamp: action.time } : order < 0 ? { command, previous } : { command, stamp: null };
  if (!order || !time || !action.time) {
    const uncertain = equalValues(action.before, value) ? [{ path: change.path, base: change.before, mine: change.after, theirs: change.before }] : undefined;
    return { command, uncertain };
  }
  const incomingWins = order > 0;
  const changes = command.changes.map(field => field === change
    ? { ...field, before: value, after: incomingWins ? field.after : value }
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
  const stored = target.field === 'heldAt' ? councilLifecycleValue(current.value) : current.value && readField(current.value, [target.field]);
  if (!stored || !acceptsDocumentField(stored, target)) return { command, stamp: null };
  const action = readAction(command, change, current.metadata.revision, serverMs, target);
  if (!action) return { command, stamp: null };
  const previous = previousField(raw, current, target);
  if (previous && previous.revision > action.observedRevision) {
    // An exact local predecessor is causal even when its action clock was unavailable.
    if (action.predecessorOperationId && previous.operationId === action.predecessorOperationId && equalValues(previous.value, action.before)) {
      return { command, stamp: action.time };
    }
    return decideUnobservedField(command, change, action, previous, target);
  }
  if (equalValues(action.after, stored)) return { command, previous };
  return { command, stamp: previous || action.observedRevision === current.metadata.revision ? action.time : null };
}

function resolvePlannedChurchFill(original: DataCommand, ordered: DataCommand, current: ResourceSnapshot): DataCommand {
  if (original.kind !== 'update' || ordered.kind !== 'update' || !original.sermonChurchFill
    || !current.value || current.metadata?.generation !== original.generation) return ordered;
  const requested = original.changes.find(change => change.path[0] === 'church');
  const accepted = ordered.changes.find(change => change.path[0] === 'church');
  const dates = ordered.changes.find(change => change.path[0] === 'preachDates');
  if (!dates?.after.exists || (requested && !equalValues(requested.after, { exists: true, value: original.sermonChurchFill.church }))) return ordered;
  const rows = rebaseSermonChurchFill(dates.before.value, dates.after.value, current.value.preachDates,
    accepted?.after ?? readField(current.value, ['church']), original.sermonChurchFill);
  if (rows === dates.after.value || rows === undefined) return ordered;
  return { ...ordered, changes: ordered.changes.map(change => change === dates ? { ...dates, after: { exists: true, value: rows } } : change) };
}

function resolveSeriesTitleMirror(original: DataCommand, order: DocumentFieldOrder, current: ResourceSnapshot): DataCommand {
  const ordered = order.command;
  if (!order.displaced || original.kind !== 'update' || ordered.kind !== 'update' || !current.value) return ordered;
  const requested = original.changes.find(change => change.path[0] === 'title');
  const mirror = original.changes.find(change => change.path[0] === 'theme');
  const openingTheme = original.seriesFieldActions?.title?.openingTheme;
  const after = requested?.after;
  if (!after?.exists || typeof after.value !== 'string') return ordered;
  if (mirror ? !equalValues(mirror.after, after) : openingTheme !== after.value) return ordered;
  const stored = readField(current.value, ['theme']);
  // A distinct legacy theme remains an ordinary conflict, even if the title has a proven order.
  if (!equalValues(stored, readField(current.value, ['title']))) return ordered;
  const resolved = { path: ['theme'], before: stored, after: order.displaced.winnerValue };
  const changes = mirror ? ordered.changes.map(change => change.path[0] === 'theme' ? resolved : change) : [...ordered.changes, resolved];
  return { ...ordered, changes };
}

function alignCouncilLifecycle(order: DocumentFieldOrder, current: ResourceSnapshot): DataCommand {
  const { command, displaced } = order;
  if (command.kind !== 'update' || !displaced || !current.value) return command;
  const before = readField(current.value, ['status']);
  const after = { exists: true, value: councilStatusOf(displaced.winnerValue) };
  const companion = { path: ['status'], before, after };
  const changes = command.changes.filter(change => change.path.length !== 1 || change.path[0] !== 'status');
  return { ...command, changes: equalValues(before, after) ? changes : [...changes, companion] };
}

export function orderDocumentFields(command: DataCommand, current: ResourceSnapshot, raw: unknown, serverMs: number) {
  const fields = documentFieldTargets(command.resource.collection).map(target => {
    const order = orderDocumentField(command, current, raw, serverMs, target);
    if (target.field === 'church') command = resolvePlannedChurchFill(command, order.command, current);
    else if (target.action === 'seriesFieldActions' && target.field === 'title') command = resolveSeriesTitleMirror(command, order, current);
    else if (target.field === 'heldAt') command = alignCouncilLifecycle(order, current);
    else command = order.command;
    return { target, order };
  });
  return { command, fields, uncertain: fields.flatMap(({ order }) => order.uncertain ?? []) };
}

export function metadataAfterDocumentFields(snapshot: ResourceSnapshot, raw: Record<string, unknown> | undefined, fields?: ReturnType<typeof orderDocumentFields>) {
  const metadata = snapshot.metadata;
  if (!metadata) return metadata;
  const proofs = documentFieldTargets(snapshot.resource.collection).flatMap(target => {
    if (!snapshot.value) return [];
    const value = target.field === 'heldAt' ? councilLifecycleValue(snapshot.value) : readField(snapshot.value, [target.field]);
    if (!value || !acceptsDocumentField(value, target)) return [];
    const order = fields?.fields.find(item => item.target === target)?.order;
    const rawMetadata = raw?._dataEngine;
    const previous = order?.previous ?? previousField(rawMetadata, snapshot, target);
    const changed = target.causal && !equalValues(readField((raw ?? {}) as DocumentData, [target.field]), value);
    // The first unrelated write to an older sermon, including a secondary effect,
    // observes the same field at the original revision.
    const revision = target.causal && !changed && order?.stamp === undefined && object(rawMetadata)
      && rawMetadata.generation === metadata.generation && proofRevision(rawMetadata.revision)
      ? rawMetadata.revision : metadata.revision;
    const proof: FieldProof = order?.stamp === undefined && previous ? previous : {
      value, revision, time: order?.stamp ?? null,
      ...(changed && metadata.operationId && { operationId: metadata.operationId }),
    };
    const match = usesDigest(target) ? { digest: fieldDigest(proof.value, target) } : { [target.field]: proof.value.value };
    return [[target.proof, { ...match, revision: proof.revision, time: proof.time,
      ...(target.causal && proof.operationId && { operationId: proof.operationId }) }]] as const;
  });
  return { ...metadata, ...Object.fromEntries(proofs) };
}
