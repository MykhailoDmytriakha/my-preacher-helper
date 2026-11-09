import { boundedActionTime, compareActionTime } from './actionClock';
import { object } from './fieldValues';
import { isValidIdentifier } from './protocol';
import { matchesRowDetailBirth, rowDetailConflict } from './rowDetailAction';
import { boundedRowId, existingRowField, proofRevision } from './rowFieldAction';
import { orderConcurrentRowField, readRowObservation } from './rowFieldOrder.server';
import { MAX_THOUGHT_TAG_PROOFS, ordinaryThoughtTag, THOUGHT_TAG_BIRTH, thoughtTagTarget } from './thoughtTagAction';

import type { ActionTime } from './actionClock';
import type { RowDetailHistoryEntry } from './rowDetailAction';
import type { ThoughtTagAction } from './thoughtTagAction';
import type { ConflictDetail, DataCommand, ResourceSnapshot } from './types';

type Update = Extract<DataCommand, { kind: 'update' }>;
type Subject = { rowId: string; rowCreatedAt: string; tag: string };
type Proof = Subject & { present: boolean; revision: number; operationId: string; time: ActionTime | null; causal: boolean };
type Pending = Omit<Proof, 'revision' | 'operationId'>;
type History = RowDetailHistoryEntry<string, boolean>;

const key = ({ rowId, rowCreatedAt, tag }: Subject) => JSON.stringify([rowId, rowCreatedAt, tag]);

function readProofs(raw: unknown, generation: string) {
  const stored = object(raw) && raw.generation === generation ? raw.thoughtTagProofs : undefined;
  const floor = object(stored) && proofRevision(stored.floor) ? stored.floor : 0;
  const entries = object(stored) && Array.isArray(stored.entries) ? stored.entries.slice(0, MAX_THOUGHT_TAG_PROOFS) : [];
  const proofs = entries.flatMap((item): Proof[] => {
    if (!object(item) || !boundedRowId(item.rowId) || !THOUGHT_TAG_BIRTH.accepts(item.rowCreatedAt)
      || !ordinaryThoughtTag(item.tag) || typeof item.present !== 'boolean' || !proofRevision(item.revision)
      || !isValidIdentifier(item.operationId)) return [];
    const time = item.time === null ? null : boundedActionTime(item.time);
    return time === undefined ? [] : [{ rowId: item.rowId, rowCreatedAt: item.rowCreatedAt, tag: item.tag,
      present: item.present, revision: item.revision, operationId: item.operationId, time, causal: item.causal === true }];
  });
  return { floor, proofs };
}

function readActions(command: Update, revision: number, serverMs: number) {
  if (!Array.isArray(command.thoughtTagActions) || command.thoughtTagActions.length > MAX_THOUGHT_TAG_PROOFS) return [];
  const actions = new Map<string, ThoughtTagAction | undefined>();
  for (const item of command.thoughtTagActions) {
    if (!object(item) || !ordinaryThoughtTag(item.tag) || !THOUGHT_TAG_BIRTH.accepts(item.rowCreatedAt)) continue;
    const action = readRowObservation(command, item, thoughtTagTarget(item.tag), serverMs, { allowUnclocked: true });
    if (!action || action.observedRevision > revision || !matchesRowDetailBirth(command.changes, { ...action, rowCreatedAt: item.rowCreatedAt }, THOUGHT_TAG_BIRTH)) continue;
    const result = { ...action, tag: item.tag, rowCreatedAt: item.rowCreatedAt,
      ...(isValidIdentifier(item.predecessorOperationId) && { predecessorOperationId: item.predecessorOperationId }) };
    const id = key(result);
    actions.set(id, actions.has(id) ? undefined : result);
  }
  return [...actions.values()].filter((action): action is ThoughtTagAction => action !== undefined);
}

function pending(action: ThoughtTagAction, time = action.time, causal = true): Pending {
  return { rowId: action.rowId, rowCreatedAt: action.rowCreatedAt, tag: action.tag, present: action.after, time, causal };
}

export function orderThoughtTags(command: DataCommand, current: ResourceSnapshot, raw: unknown, serverMs: number) {
  const uncertain: ConflictDetail[] = [], displaced: History[] = [], stamps: Pending[] = [];
  const metadata = current.metadata;
  if (command.kind !== 'update' || command.resource.collection !== 'sermons' || !metadata || metadata.deleted
    || command.generation !== metadata.generation || !current.value) return { command, uncertain, displaced, stamps };
  let orderedCommand: Update = command;
  const { floor, proofs } = readProofs(raw, metadata.generation);
  const indexed = new Map(proofs.map(proof => [key(proof), proof]));
  for (const action of readActions(command, metadata.revision, serverMs)) {
    const target = thoughtTagTarget(action.tag), rows = current.value.thoughts;
    const stored = existingRowField(rows, action.rowId, target);
    const born = existingRowField(rows, action.rowId, THOUGHT_TAG_BIRTH);
    if (stored === undefined || born === undefined) continue;
    if (born !== action.rowCreatedAt) {
      if (stored !== action.after) uncertain.push(rowDetailConflict(action, target, stored));
      continue;
    }
    const candidate = indexed.get(key(action));
    const previous = candidate?.present === stored && candidate.revision <= metadata.revision ? candidate : undefined;
    const unobserved = previous && previous.revision > action.observedRevision;
    const causal = unobserved && previous.causal && previous.operationId === action.predecessorOperationId && stored === action.before;
    if (!unobserved || causal) {
      const missingProof = !previous && action.observedRevision < Math.min(floor, metadata.revision);
      if (missingProof && stored !== action.after) uncertain.push(rowDetailConflict(action, target, stored));
      else if (stored === action.before) stamps.push(pending(action));
      continue;
    }
    const timing = action.time && previous.time ? compareActionTime(action.time, previous.time) : 0;
    if (stored === action.after) {
      if (timing > 0) stamps.push(pending(action));
      else if (!timing) stamps.push(pending(action, null, false));
      continue;
    }
    if (!timing || !action.time) {
      uncertain.push(rowDetailConflict(action, target, stored));
      continue;
    }
    const ordered = orderConcurrentRowField(orderedCommand, { ...action, time: action.time }, target, { value: stored, time: previous.time });
    orderedCommand = ordered.command;
    if (ordered.displaced) displaced.push({ ...ordered.displaced, field: action.tag, rowCreatedAt: action.rowCreatedAt });
    if (timing > 0) stamps.push(pending(action));
  }
  return { command: orderedCommand, uncertain, displaced, stamps };
}

function memberships(rows: unknown) {
  const byId = new Map<string, { date: string; tags: Set<string> } | undefined>();
  if (!Array.isArray(rows)) return byId;
  for (const row of rows) {
    if (!object(row) || !boundedRowId(row.id)) continue;
    const valid = THOUGHT_TAG_BIRTH.accepts(row.date) && Array.isArray(row.tags) && row.tags.every(tag => typeof tag === 'string');
    byId.set(row.id, !byId.has(row.id) && valid ? { date: row.date as string, tags: new Set((row.tags as unknown[]).filter(ordinaryThoughtTag)) } : undefined);
  }
  return byId;
}

export function metadataAfterThoughtTags(snapshot: ResourceSnapshot, raw: Record<string, unknown> | undefined,
  order?: ReturnType<typeof orderThoughtTags>) {
  const { metadata } = snapshot;
  if (!metadata?.operationId || snapshot.resource.collection !== 'sermons' || !snapshot.value) return metadata;
  const current = memberships(snapshot.value.thoughts), previous = memberships(raw?.thoughts);
  const stored = readProofs(raw?._dataEngine, metadata.generation);
  const recorded = new Map<string, Proof>();
  const add = (intent: Pending) => {
    const live = current.get(intent.rowId);
    if (live?.date === intent.rowCreatedAt && live.tags.has(intent.tag) === intent.present) {
      recorded.set(key(intent), { ...intent, revision: metadata.revision, operationId: metadata.operationId! });
    }
  };
  order?.stamps.forEach(add);
  for (const [rowId, live] of current) {
    const before = previous.get(rowId);
    if (!live || before?.date !== live.date) continue;
    for (const tag of new Set([...before.tags, ...live.tags])) {
      const present = live.tags.has(tag);
      const intent = { rowId, rowCreatedAt: live.date, tag, present, time: null, causal: false };
      if (present !== before.tags.has(tag) && !recorded.has(key(intent))) add(intent);
    }
  }
  for (const proof of stored.proofs) {
    const live = current.get(proof.rowId);
    if (live?.date === proof.rowCreatedAt && live.tags.has(proof.tag) === proof.present && !recorded.has(key(proof))) recorded.set(key(proof), proof);
  }
  const retained = [...recorded.values()];
  const floor = retained.slice(MAX_THOUGHT_TAG_PROOFS).reduce((value, item) => Math.max(value, item.revision), stored.floor);
  return retained.length || floor ? { ...metadata, thoughtTagProofs: { entries: retained.slice(0, MAX_THOUGHT_TAG_PROOFS), floor } } : metadata;
}
