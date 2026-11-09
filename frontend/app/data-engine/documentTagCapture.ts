import { boundedActionTime } from './actionClock';
import { changeTagMembership, documentTagCollection, DOCUMENT_TAG_FIELD, tagField, tagList, tagMembership } from './documentTagMembership';
import { equalValues, object } from './fieldValues';
import { isValidIdentifier } from './protocol';
import { proofRevision } from './rowFieldAction';
import { isTagMembershipName } from './tagMembershipOrder';

import type { ActionTime } from './actionClock';
import type { CollectionState } from './collections';
import type { CommitRequest } from './commits';
import type { SessionCheckpoint } from './session';
import type { TagMembershipAction } from './tagMembershipOrder';
import type { DocumentData, ResourceSnapshot } from './types';

export type DocumentTagBasis = { generation: string; revision: number };
export type DocumentTagIntent = Omit<TagMembershipAction, 'predecessorOperationId' | 'observedRevision'> & DocumentTagBasis & { predecessorRequestId?: string };

type DisplayedTagRequest = { tag: string; requestId: string; revision: number };
export type DocumentTagOpening = DocumentTagBasis & { predecessors?: readonly DisplayedTagRequest[] };

export function submittedPrayerTagBasis(checkpoint: SessionCheckpoint | null, requests: readonly CommitRequest[]): DocumentTagOpening | undefined {
  const metadata = checkpoint?.confirmed.metadata;
  if (!checkpoint?.draft || checkpoint.confirmed.resource.collection !== 'prayerRequests' || !metadata || metadata.deleted) return undefined;
  const shown = tagField(checkpoint.draft);
  const pending = new Map(requests.map(request => [request.id, request]));
  const predecessors = new Map<string, DisplayedTagRequest>();
  for (const id of Object.keys(checkpoint.pending).reverse()) {
    const request = pending.get(id);
    if (request?.baseline.metadata?.generation !== metadata.generation) continue;
    for (const action of request.tagMembershipActions ?? []) {
      if (!predecessors.has(action.tag) && tagMembership(shown, action.tag) === action.after) {
        predecessors.set(action.tag, { tag: action.tag, requestId: request.id, revision: action.observedRevision });
      }
    }
  }
  return { generation: metadata.generation, revision: metadata.revision, predecessors: [...predecessors.values()] };
}

export function observeDocumentTagBasis(state: CollectionState | null | undefined, id: string, opening: readonly string[]): DocumentTagOpening | undefined {
  const row = state?.documents?.find(item => item.resource.id === id);
  if (!row?.value || row.needsAttention || !equalValues(tagList(row.value.tags), opening)) return undefined;
  if (row.submittedPrayerTagBasis) return row.submittedPrayerTagBasis;
  const metadata = (row.acknowledged ?? state?.snapshots.find(item => item.resource.id === id))?.metadata;
  return metadata && !metadata.deleted ? { generation: metadata.generation, revision: metadata.revision } : undefined;
}

export function makeDocumentTagIntents(opening: unknown, requested: unknown, basis: DocumentTagOpening,
  time: ActionTime | null): DocumentTagIntent[] | undefined {
  const beforeList = tagList(opening), afterList = tagList(requested);
  if (!beforeList || !afterList) return undefined;
  const before = new Set(beforeList), after = new Set(afterList);
  const changes = [...new Set([...before, ...after])].filter(tag => before.has(tag) !== after.has(tag));
  if (!changes.length || !changes.every(isTagMembershipName)) return undefined;
  const predecessors = new Map(basis.predecessors?.map(item => [item.tag, item]));
  return changes.map(tag => {
    const prior = predecessors.get(tag);
    return { tag, before: before.has(tag), after: after.has(tag), time,
      generation: basis.generation, revision: prior?.revision ?? basis.revision, ...(prior && { predecessorRequestId: prior.requestId }) };
  });
}

export function validDocumentTagIntents(raw: unknown, requested: unknown): boolean {
  const list = tagList(requested);
  if (!list) return false;
  const tags = new Set(list);
  return Array.isArray(raw) && raw.length > 0
    && raw.every(intent => object(intent) && isTagMembershipName(intent.tag) && typeof intent.before === 'boolean' && typeof intent.after === 'boolean'
      && intent.before !== intent.after && tags.has(intent.tag) === intent.after && isValidIdentifier(intent.generation) && proofRevision(intent.revision)
      && (intent.time === null || boundedActionTime(intent.time) !== undefined)
      && (intent.predecessorRequestId === undefined || isValidIdentifier(intent.predecessorRequestId)))
    && new Set(raw.map(intent => intent.tag)).size === raw.length;
}

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
    || !intents?.length) return undefined;
  const byId = new Map(records.map(record => [record.id, record]));
  const counts = new Map<string, number>();
  for (const { tag } of intents) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  const tags = tagField(draft);
  const actions = intents.flatMap(({ generation, revision, tag, before, after, time: captured, predecessorRequestId }) => {
    const time = captured === null ? null : boundedActionTime(captured);
    if (!isTagMembershipName(tag) || counts.get(tag) !== 1 || generation !== metadata.generation || !proofRevision(revision)
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
