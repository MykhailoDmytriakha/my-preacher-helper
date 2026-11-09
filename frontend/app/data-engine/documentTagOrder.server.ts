import { boundedActionTime } from './actionClock';
import { changeTagMembership, documentTagChange, documentTagCollection, documentTagConflictPath, matchesDocumentTag, supportedDocumentTag, tagField, tagList, tagMembership } from './documentTagMembership';
import { object } from './fieldValues';
import { isValidIdentifier } from './protocol';
import { proofRevision, rowConflictValue } from './rowFieldAction';
import { decideTagMembership, MAX_TAG_MEMBERSHIP_PROOFS } from './tagMembershipOrder';

import type { DocumentTagHistoryEntry } from './documentTagMembership';
import type { TagMembershipAction, TagMembershipProof } from './tagMembershipOrder';
import type { ConflictDetail, DataCommand, FieldChange, ResourceSnapshot } from './types';

type Proof = TagMembershipProof & { tag: string };
type Stamp = Omit<Proof, 'revision' | 'operationId'>;
type TagOrder = { command: DataCommand; uncertain: ConflictDetail[]; displaced: DocumentTagHistoryEntry[]; stamps: Stamp[] };

function readProofs(raw: unknown, generation: string) {
  const stored = object(raw) && raw.generation === generation ? raw.tagMembershipProofs : undefined;
  const floor = object(stored) && proofRevision(stored.floor) ? stored.floor : 0;
  const entries = object(stored) && Array.isArray(stored.entries) ? stored.entries.slice(0, MAX_TAG_MEMBERSHIP_PROOFS) : [];
  const proofs = new Map<string, Proof>();
  for (const item of entries) {
    if (!object(item) || !supportedDocumentTag(item.tag) || typeof item.present !== 'boolean' || !proofRevision(item.revision)
      || !isValidIdentifier(item.operationId)) continue;
    const time = item.time === null ? null : boundedActionTime(item.time);
    if (time !== undefined) proofs.set(item.tag, { tag: item.tag, present: item.present, revision: item.revision,
      operationId: item.operationId, time, causal: item.causal === true });
  }
  return { floor, proofs };
}

function readActions(raw: unknown, change: FieldChange, revision: number, serverMs: number): TagMembershipAction[] {
  if (!Array.isArray(raw) || raw.length > MAX_TAG_MEMBERSHIP_PROOFS) return [];
  const actions = new Map<string, TagMembershipAction | undefined>();
  for (const item of raw) {
    if (!object(item) || !supportedDocumentTag(item.tag) || typeof item.before !== 'boolean' || typeof item.after !== 'boolean'
      || !proofRevision(item.observedRevision) || item.observedRevision > revision) continue;
    const time = item.time === null ? null : boundedActionTime(item.time);
    if (time === undefined || (time && (!Number.isFinite(serverMs) || time.earliestMs > serverMs + 5))) continue;
    const action: TagMembershipAction = { tag: item.tag, before: item.before, after: item.after, observedRevision: item.observedRevision,
      time, ...(isValidIdentifier(item.predecessorOperationId) && { predecessorOperationId: item.predecessorOperationId }) };
    if (matchesDocumentTag(change, action)) actions.set(action.tag, actions.has(action.tag) ? undefined : action);
  }
  return [...actions.values()].filter((action): action is TagMembershipAction => action !== undefined);
}

export function orderDocumentTags(command: DataCommand, current: ResourceSnapshot, raw: unknown, serverMs: number): TagOrder {
  const result: TagOrder = { command, uncertain: [], displaced: [], stamps: [] };
  const metadata = current.metadata;
  if (command.kind !== 'update' || !documentTagCollection(command.resource.collection) || !current.value
    || !metadata || metadata.deleted || command.generation !== metadata.generation) return result;
  const change = documentTagChange(command.changes);
  if (!change) return result;
  const { floor, proofs } = readProofs(raw, metadata.generation);
  const currentTags = tagField(current.value);
  let { before, after } = change;
  // Legacy notes can omit tags. On a real addition, an existing saved list
  // and the incoming list share an empty ancestor for membership merging.
  if (!before.exists && currentTags.exists && after.exists && tagList(currentTags.value) && tagList(after.value)) {
    before = { exists: true, value: [] };
  }
  for (const action of readActions(command.tagMembershipActions, change, metadata.revision, serverMs)) {
    const { tag } = action, stored = tagMembership(currentTags, tag);
    if (stored === undefined) continue;
    const decision = decideTagMembership(action, stored, proofs.get(tag), metadata.revision, floor);
    if (decision.kind === 'uncertain') result.uncertain.push({
      path: documentTagConflictPath(tag), base: rowConflictValue(action.before), mine: rowConflictValue(action.after), theirs: rowConflictValue(stored),
    });
    if (decision.kind === 'stamp') result.stamps.push({ tag, present: action.after, time: decision.time, causal: decision.causal });
    if (decision.kind === 'ordered') {
      const { incomingWins, incomingTime, storedTime } = decision;
      before = changeTagMembership(before, tag, stored);
      if (!incomingWins) after = changeTagMembership(after, tag, stored);
      else result.stamps.push({ tag, present: action.after, time: incomingTime, causal: true });
      result.displaced.push({ tag, value: incomingWins ? stored : action.after, winnerValue: incomingWins ? action.after : stored,
        actionTime: incomingWins ? storedTime : incomingTime, winnerActionTime: incomingWins ? incomingTime : storedTime });
    }
  }
  if (before !== change.before || after !== change.after) {
    result.command = { ...command, changes: command.changes.map(item => item === change ? { ...change, before, after } : item) };
  }
  return result;
}

export function metadataAfterDocumentTags(snapshot: ResourceSnapshot, raw: Record<string, unknown> | undefined, order?: TagOrder) {
  const { metadata, value } = snapshot;
  if (!documentTagCollection(snapshot.resource.collection) || !metadata?.operationId || !value) return metadata;
  const after = tagList(value.tags), before = tagList(raw?.tags);
  if (!after || !before) return metadata;
  const stored = readProofs(raw?._dataEngine, metadata.generation);
  const current = new Set(after), previous = new Set(before);
  const recorded = new Map<string, Proof>();
  const add = (stamp: Stamp) => recorded.set(stamp.tag, { ...stamp, revision: metadata.revision, operationId: metadata.operationId! });
  for (const stamp of order?.stamps ?? []) if (current.has(stamp.tag) === stamp.present) add(stamp);
  for (const tag of new Set([...before, ...after])) {
    if (!supportedDocumentTag(tag) || recorded.has(tag) || previous.has(tag) === current.has(tag)) continue;
    add({ tag, present: current.has(tag), time: null, causal: false });
  }
  for (const proof of stored.proofs.values()) {
    if (!recorded.has(proof.tag) && current.has(proof.tag) === proof.present) recorded.set(proof.tag, proof);
  }
  const entries = [...recorded.values()];
  const floor = entries.slice(MAX_TAG_MEMBERSHIP_PROOFS).reduce((value, item) => Math.max(value, item.revision), stored.floor);
  return entries.length || floor ? { ...metadata, tagMembershipProofs: { entries: entries.slice(0, MAX_TAG_MEMBERSHIP_PROOFS), floor } } : metadata;
}
