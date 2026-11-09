import { boundedActionTime } from './actionClock';
import { object } from './fieldValues';
import { isValidIdentifier } from './protocol';
import { matchesRowDetailBirth, rowDetailConflict } from './rowDetailAction';
import { boundedRowId, existingRowField, isRowChange, proofRevision } from './rowFieldAction';
import { orderConcurrentRowField, readRowObservation } from './rowFieldOrder.server';
import { decideTagMembership, MAX_TAG_MEMBERSHIP_PROOFS, readTagMembershipName } from './tagMembershipOrder';
import { readTagProofIdentity, tagProofIdentity, tagProofKey } from './tagProofIdentity.server';
import { ordinaryThoughtTag, THOUGHT_TAG_BIRTH, thoughtTagTarget, thoughtTags } from './thoughtTagAction';

import type { RowDetailHistoryEntry } from './rowDetailAction';
import type { TagMembershipProof } from './tagMembershipOrder';
import type { TagProofIdentity } from './tagProofIdentity.server';
import type { ThoughtTagAction } from './thoughtTagAction';
import type { ConflictDetail, DataCommand, ResourceSnapshot } from './types';

type Update = Extract<DataCommand, { kind: 'update' }>;
type ThoughtRow = { rowId: string; rowCreatedAt: string };
type Proof = ThoughtRow & TagProofIdentity & TagMembershipProof;
type Pending = ThoughtRow & { tag: string } & Omit<TagMembershipProof, 'revision' | 'operationId'>;
type History = RowDetailHistoryEntry<string, boolean>;

const key = ({ rowId, rowCreatedAt }: ThoughtRow, identity: string | TagProofIdentity) =>
  JSON.stringify([rowId, rowCreatedAt, tagProofKey(identity)]);

function readProofs(raw: unknown, generation: string) {
  const stored = object(raw) && raw.generation === generation ? raw.thoughtTagProofs : undefined;
  const floor = object(stored) && proofRevision(stored.floor) ? stored.floor : 0;
  const entries = object(stored) && Array.isArray(stored.entries) ? stored.entries.slice(0, MAX_TAG_MEMBERSHIP_PROOFS) : [];
  const proofs = entries.flatMap((item): Proof[] => {
    if (!object(item) || !boundedRowId(item.rowId) || !THOUGHT_TAG_BIRTH.accepts(item.rowCreatedAt)
      || typeof item.present !== 'boolean' || !proofRevision(item.revision)
      || !isValidIdentifier(item.operationId)) return [];
    const identity = readTagProofIdentity(item, ordinaryThoughtTag);
    const time = item.time === null ? null : boundedActionTime(item.time);
    return !identity || time === undefined ? [] : [{ rowId: item.rowId, rowCreatedAt: item.rowCreatedAt, ...identity,
      present: item.present, revision: item.revision, operationId: item.operationId, time, causal: item.causal === true }];
  });
  return { floor, proofs };
}

function readActions(command: Update, source: Update, revision: number, serverMs: number) {
  if (!Array.isArray(source.thoughtTagActions) || source.thoughtTagActions.length > MAX_TAG_MEMBERSHIP_PROOFS) return [];
  // Placement repair can move structural tags inside the array. The wire index names the original side.
  const change = source.changes.find(item => isRowChange(item, THOUGHT_TAG_BIRTH));
  if (!change) return [];
  const actions = new Map<string, ThoughtTagAction | undefined>();
  for (const item of source.thoughtTagActions) {
    if (!object(item) || !boundedRowId(item.rowId) || !THOUGHT_TAG_BIRTH.accepts(item.rowCreatedAt) || typeof item.after !== 'boolean') continue;
    const tag = readTagMembershipName(item, thoughtTags((item.after ? change.after : change.before).value, item.rowId));
    if (!ordinaryThoughtTag(tag)) continue;
    const action = readRowObservation(command, item, thoughtTagTarget(tag), serverMs, { allowUnclocked: true });
    if (!action || action.observedRevision > revision || !matchesRowDetailBirth(command.changes, { ...action, rowCreatedAt: item.rowCreatedAt }, THOUGHT_TAG_BIRTH)) continue;
    const result = { ...action, tag, rowCreatedAt: item.rowCreatedAt,
      ...(isValidIdentifier(item.predecessorOperationId) && { predecessorOperationId: item.predecessorOperationId }) };
    const id = key(result, result.tag);
    actions.set(id, actions.has(id) ? undefined : result);
  }
  return [...actions.values()].filter((action): action is ThoughtTagAction => action !== undefined);
}

function pending(action: ThoughtTagAction, time = action.time, causal = true): Pending {
  return { rowId: action.rowId, rowCreatedAt: action.rowCreatedAt, tag: action.tag, present: action.after, time, causal };
}

export function orderThoughtTags(command: DataCommand, source: DataCommand, current: ResourceSnapshot, raw: unknown, serverMs: number) {
  const uncertain: ConflictDetail[] = [], displaced: History[] = [], stamps: Pending[] = [];
  const metadata = current.metadata;
  if (command.kind !== 'update' || source.kind !== 'update' || command.resource.collection !== 'sermons' || !metadata || metadata.deleted
    || command.generation !== metadata.generation || !current.value) return { command, uncertain, displaced, stamps };
  let orderedCommand: Update = command;
  const { floor, proofs } = readProofs(raw, metadata.generation);
  const indexed = new Map(proofs.map(proof => [key(proof, proof), proof]));
  for (const action of readActions(command, source, metadata.revision, serverMs)) {
    const target = thoughtTagTarget(action.tag), rows = current.value.thoughts;
    const stored = existingRowField(rows, action.rowId, target);
    const born = existingRowField(rows, action.rowId, THOUGHT_TAG_BIRTH);
    if (stored === undefined || born === undefined) continue;
    if (born !== action.rowCreatedAt) {
      if (stored !== action.after) uncertain.push(rowDetailConflict(action, target, stored));
      continue;
    }
    const decision = decideTagMembership(action, stored, indexed.get(key(action, action.tag)), metadata.revision, floor);
    if (decision.kind === 'uncertain') uncertain.push(rowDetailConflict(action, target, stored));
    if (decision.kind === 'stamp') stamps.push(pending(action, decision.time, decision.causal));
    if (decision.kind === 'ordered') {
      const ordered = orderConcurrentRowField(orderedCommand, { ...action, time: decision.incomingTime }, target, { value: stored, time: decision.storedTime });
      orderedCommand = ordered.command;
      if (ordered.displaced) displaced.push({ ...ordered.displaced, field: action.tag, rowCreatedAt: action.rowCreatedAt });
      if (decision.incomingWins) stamps.push(pending(action));
    }
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
  const keysByRow = new Map<string, Set<string>>();
  const add = ({ tag, ...intent }: Pending) => {
    const live = current.get(intent.rowId);
    if (live?.date === intent.rowCreatedAt && live.tags.has(tag) === intent.present) {
      const identity = tagProofIdentity(tag);
      recorded.set(key(intent, identity), { ...intent, ...identity, revision: metadata.revision, operationId: metadata.operationId! });
    }
  };
  order?.stamps.forEach(add);
  for (const [rowId, live] of current) {
    const before = previous.get(rowId);
    if (!live || before?.date !== live.date) continue;
    for (const tag of new Set([...before.tags, ...live.tags])) {
      const present = live.tags.has(tag);
      const intent = { rowId, rowCreatedAt: live.date, tag, present, time: null, causal: false };
      if (present !== before.tags.has(tag) && !recorded.has(key(intent, tag))) add(intent);
    }
  }
  for (const proof of stored.proofs) {
    const live = current.get(proof.rowId);
    if (live?.date !== proof.rowCreatedAt) continue;
    let keys = keysByRow.get(proof.rowId);
    if (!keys) {
      keys = new Set([...live.tags].map(tagProofKey));
      keysByRow.set(proof.rowId, keys);
    }
    const id = key(proof, proof);
    if (keys.has(tagProofKey(proof)) === proof.present && !recorded.has(id)) recorded.set(id, proof);
  }
  const retained = [...recorded.values()];
  const floor = retained.slice(MAX_TAG_MEMBERSHIP_PROOFS).reduce((value, item) => Math.max(value, item.revision), stored.floor);
  return retained.length || floor ? { ...metadata, thoughtTagProofs: { entries: retained.slice(0, MAX_TAG_MEMBERSHIP_PROOFS), floor } } : metadata;
}
