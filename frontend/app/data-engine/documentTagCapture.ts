import { boundedActionTime } from './actionClock';
import { changeTagMembership, documentTagCollection, DOCUMENT_TAG_FIELD, supportedDocumentTag, tagField, tagMembership } from './documentTagMembership';
import { isValidIdentifier } from './protocol';
import { proofRevision } from './rowFieldAction';
import { MAX_TAG_MEMBERSHIP_PROOFS } from './tagMembershipOrder';

import type { CommitRequest } from './commits';
import type { TagMembershipAction } from './tagMembershipOrder';
import type { DocumentData, ResourceSnapshot } from './types';

export type DocumentTagBasis = { generation: string; revision: number };
export type DocumentTagIntent = Omit<TagMembershipAction, 'predecessorOperationId' | 'observedRevision'> & DocumentTagBasis & { predecessorRequestId?: string };

function knownPredecessor(tag: string, before: boolean, predecessor: CommitRequest | undefined, byId: Map<string, CommitRequest>,
  baseline: ResourceSnapshot) {
  const seen = new Set<string>();
  for (let item = predecessor; item && !seen.has(item.id); item = byId.get(item.predecessor ?? '')) {
    if (item.baseline.metadata?.generation !== baseline.metadata?.generation || item.baseline.resource.collection !== baseline.resource.collection
      || item.baseline.resource.id !== baseline.resource.id || ['conflict', 'refused', 'cancelled'].includes(item.state)
      || tagMembership(tagField(item.value), tag) !== before) return undefined;
    const authored = item.tagMembershipActions?.find(action => action.tag === tag);
    if (authored) return authored.after === before ? item.id : undefined;
    seen.add(item.id);
  }
  return undefined;
}

export function captureDocumentTags(baseline: ResourceSnapshot, predecessor: CommitRequest | undefined, draft: DocumentData | null,
  intents: readonly DocumentTagIntent[] | undefined, records: readonly CommitRequest[]): TagMembershipAction[] | undefined {
  const { metadata } = baseline;
  if (!documentTagCollection(baseline.resource.collection) || !metadata || metadata.deleted || !draft || !baseline.value
    || !intents?.length || intents.length > MAX_TAG_MEMBERSHIP_PROOFS) return undefined;
  const byId = new Map(records.map(record => [record.id, record]));
  const counts = new Map<string, number>();
  for (const { tag } of intents) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  const tags = tagField(draft);
  const actions = intents.flatMap(({ generation, revision, tag, before, after, time: captured, predecessorRequestId }) => {
    const time = captured === null ? null : boundedActionTime(captured);
    if (!supportedDocumentTag(tag) || counts.get(tag) !== 1 || generation !== metadata.generation || !proofRevision(revision)
      || revision > metadata.revision || typeof before !== 'boolean' || typeof after !== 'boolean'
      || before === after || tagMembership(tags, tag) !== after || time === undefined) return [];
    const named = predecessorRequestId ? byId.get(predecessorRequestId) : undefined;
    const acknowledged = named?.state === 'acknowledged' ? named : undefined;
    // The live editor can still own the exact capture receipt after the collector
    // retires its acknowledged request. The server only uses that ID if it owns
    // the latest proof of this membership on the same document and generation.
    const retiredReceipt = !named && isValidIdentifier(predecessorRequestId) ? predecessorRequestId : undefined;
    const predecessorOperationId = knownPredecessor(tag, before, predecessor, byId, baseline)
      ?? knownPredecessor(tag, before, acknowledged, byId, baseline) ?? retiredReceipt;
    return [{ tag, before, after, observedRevision: revision, time, ...(predecessorOperationId && { predecessorOperationId }) }];
  });
  return actions.length ? actions : undefined;
}

export function pendingDocumentTags(record: CommitRequest): readonly TagMembershipAction[] {
  if (record.sequence !== 0 || !record.working.value || !record.intended
    || record.working.metadata?.generation !== record.baseline.metadata?.generation) return [];
  const before = tagField(record.working.value), after = tagField(record.intended);
  return record.tagMembershipActions?.filter(action =>
    tagMembership(before, action.tag) !== undefined && tagMembership(after, action.tag) === action.after) ?? [];
}

export function restoreDocumentTagAncestor(snapshot: ResourceSnapshot, actions: readonly TagMembershipAction[]): ResourceSnapshot {
  if (!snapshot.value || !actions.length) return snapshot;
  const before = actions.reduce((field, action) => changeTagMembership(field, action.tag, action.before), tagField(snapshot.value));
  return before.exists ? { ...snapshot, value: { ...snapshot.value, [DOCUMENT_TAG_FIELD]: before.value! } } : snapshot;
}
