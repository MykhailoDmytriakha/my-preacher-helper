import { boundedActionTime } from './actionClock';
import { changeTagMembership, documentTagChange, documentTagCollection, documentTagConflictPath, matchesDocumentTag, mergeOptionalPrayerTags, tagField, tagList, tagMembership } from './documentTagMembership';
import { object } from './fieldValues';
import { isValidIdentifier } from './protocol';
import { proofRevision, rowConflictValue } from './rowFieldAction';
import { decideTagMembership, isTagMembershipName, MAX_TAG_MEMBERSHIP_PROOFS, readTagMembershipName } from './tagMembershipOrder';
import { readTagProofIdentity, tagProofIdentity, tagProofKey } from './tagProofIdentity.server';

import type { DocumentTagHistoryEntry } from './documentTagMembership';
import type { TagMembershipAction, TagMembershipProof } from './tagMembershipOrder';
import type { TagProofIdentity } from './tagProofIdentity.server';
import type { ConflictDetail, DataCommand, FieldChange, ResourceSnapshot } from './types';

type Proof = TagMembershipProof & TagProofIdentity;
type Stamp = Omit<TagMembershipProof, 'revision' | 'operationId'> & { tag: string };
type TagOrder = { command: DataCommand; uncertain: ConflictDetail[]; displaced: DocumentTagHistoryEntry[]; stamps: Stamp[] };

function readProofs(raw: unknown, generation: string) {
  const stored = object(raw) && raw.generation === generation ? raw.tagMembershipProofs : undefined;
  const floor = object(stored) && proofRevision(stored.floor) ? stored.floor : 0;
  const entries = object(stored) && Array.isArray(stored.entries) ? stored.entries.slice(0, MAX_TAG_MEMBERSHIP_PROOFS) : [];
  const proofs = new Map<string, Proof>();
  for (const item of entries) {
    if (!object(item) || typeof item.present !== 'boolean' || !proofRevision(item.revision)
      || !isValidIdentifier(item.operationId)) continue;
    const identity = readTagProofIdentity(item);
    const time = item.time === null ? null : boundedActionTime(item.time);
    if (identity && time !== undefined) proofs.set(tagProofKey(identity), { ...identity, present: item.present, revision: item.revision,
      operationId: item.operationId, time, causal: item.causal === true });
  }
  return { floor, proofs };
}

function readActions(raw: unknown, change: FieldChange, source: FieldChange, revision: number, serverMs: number): TagMembershipAction[] {
  if (!Array.isArray(raw) || raw.length > MAX_TAG_MEMBERSHIP_PROOFS) return [];
  const actions = new Map<string, TagMembershipAction | undefined>();
  for (const item of raw) {
    if (!object(item) || typeof item.before !== 'boolean' || typeof item.after !== 'boolean'
      || !proofRevision(item.observedRevision) || item.observedRevision > revision) continue;
    const tag = readTagMembershipName(item, tagList((item.after ? source.after : source.before).value));
    if (!tag) continue;
    const time = item.time === null ? null : boundedActionTime(item.time);
    if (time === undefined || (time && (!Number.isFinite(serverMs) || time.earliestMs > serverMs + 5))) continue;
    const action: TagMembershipAction = { tag, before: item.before, after: item.after, observedRevision: item.observedRevision,
      time, ...(isValidIdentifier(item.predecessorOperationId) && { predecessorOperationId: item.predecessorOperationId }) };
    if (matchesDocumentTag(change, action)) actions.set(action.tag, actions.has(action.tag) ? undefined : action);
  }
  return [...actions.values()].filter((action): action is TagMembershipAction => action !== undefined);
}

export function orderDocumentTags(command: DataCommand, source: DataCommand, current: ResourceSnapshot, raw: unknown, serverMs: number): TagOrder {
  const result: TagOrder = { command, uncertain: [], displaced: [], stamps: [] };
  const metadata = current.metadata;
  if (command.kind !== 'update' || source.kind !== 'update' || !documentTagCollection(command.resource.collection) || !current.value
    || !metadata || metadata.deleted || command.generation !== metadata.generation) return result;
  const change = documentTagChange(command.changes);
  const original = documentTagChange(source.changes);
  if (!change || !original) return result;
  const { floor, proofs } = readProofs(raw, metadata.generation);
  const currentTags = tagField(current.value);
  let { before, after } = change;
  // Legacy notes can omit tags. On a real addition, an existing saved list
  // and the incoming list share an empty ancestor for membership merging.
  if (command.resource.collection === 'studyNotes' && !before.exists && currentTags.exists && after.exists && tagList(currentTags.value) && tagList(after.value)) {
    before = { exists: true, value: [] };
  }
  for (const action of readActions(source.tagMembershipActions, change, original, metadata.revision, serverMs)) {
    const { tag } = action, stored = tagMembership(currentTags, tag);
    if (stored === undefined) continue;
    const decision = decideTagMembership(action, stored, proofs.get(tagProofKey(tag)), metadata.revision, floor);
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
  const prayerTags = mergeOptionalPrayerTags(command.resource.collection, before, after, currentTags);
  if (prayerTags) { before = currentTags; after = prayerTags; }
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
  const currentKeys = new Set(after.filter(isTagMembershipName).map(tagProofKey));
  const recorded = new Map<string, Proof>();
  const add = ({ tag, ...stamp }: Stamp) => {
    const identity = tagProofIdentity(tag);
    recorded.set(tagProofKey(identity), { ...stamp, ...identity, revision: metadata.revision, operationId: metadata.operationId! });
  };
  for (const stamp of order?.stamps ?? []) if (current.has(stamp.tag) === stamp.present) add(stamp);
  for (const tag of new Set([...before, ...after])) {
    if (!isTagMembershipName(tag) || recorded.has(tagProofKey(tag)) || previous.has(tag) === current.has(tag)) continue;
    add({ tag, present: current.has(tag), time: null, causal: false });
  }
  for (const [key, proof] of stored.proofs) {
    if (!recorded.has(key) && currentKeys.has(key) === proof.present) recorded.set(key, proof);
  }
  const entries = [...recorded.values()];
  const floor = entries.slice(MAX_TAG_MEMBERSHIP_PROOFS).reduce((value, item) => Math.max(value, item.revision), stored.floor);
  return entries.length || floor ? { ...metadata, tagMembershipProofs: { entries: entries.slice(0, MAX_TAG_MEMBERSHIP_PROOFS), floor } } : metadata;
}
