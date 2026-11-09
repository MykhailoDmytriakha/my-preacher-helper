'use client';

import { z } from 'zod';

import { requestOwnerJson } from '@/services/ownerHttpTransport.client';
import { newClientId } from '@/utils/clientId';
import { resolveOwnerUid } from '@/utils/queryKeys';

import { ACTION_CLOCK_HEADER, isClockTime, readsDocumentActionClock, usesActionClock } from './actionClock';
import { actionClock } from './actionClock.client';
import { getResourcePolicy, isValidIdentifier, MAX_RELATION_RESOURCES } from './protocol';
import { coversCommittedEffect } from './snapshotFreshness';

import type { CollectionChanges, CollectionPage, CollectionTransport, CommandResult, DataCommand, EngineTransport, Json, ResourceSnapshot } from './types';

const json: z.ZodType<Json> = z.lazy(() => z.union([z.null(), z.boolean(), z.number().finite(), z.string(), z.array(json), z.record(json)]));
const resourceSchema = z.object({ collection: z.string(), id: z.string() });
const metadataSchema = z.object({ protocol: z.literal(1), generation: z.string().min(1), revision: z.number().int().safe().positive(), deleted: z.boolean(), operationId: z.string().refine(isValidIdentifier).optional(),
  shareRevocation: z.string().refine(isValidIdentifier).optional() });
const field = z.object({ exists: z.boolean(), value: json.optional() });
export const snapshotSchema: z.ZodType<ResourceSnapshot> = z.object({
  resource: resourceSchema,
  value: z.record(json).nullable(),
  metadata: metadataSchema.nullable(),
}).refine((snapshot) => !snapshot.metadata || (snapshot.metadata.deleted === (snapshot.value === null)), 'Inconsistent deletion metadata');
const seriesSelection = z.object({ id: z.string().refine(isValidIdentifier), generation: z.string().refine(isValidIdentifier).nullable(), label: z.string() });
const seriesComparison = z.object({
  ref: z.object({ type: z.enum(['sermon', 'group']), refId: z.string().refine(isValidIdentifier) }),
  label: z.string(), proposed: seriesSelection.nullable(), stored: seriesSelection.nullable(),
});
const resultSchema: z.ZodType<CommandResult> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('acknowledged'), operationId: z.string(), snapshot: snapshotSchema, committed: metadataSchema.optional(),
    affected: z.array(z.object({ resource: resourceSchema, metadata: metadataSchema })).max(99).optional(),
    relatedSnapshots: z.array(snapshotSchema).max(99).optional() }),
  z.object({ kind: z.literal('conflict'), operationId: z.string(), snapshot: snapshotSchema, conflicts: z.array(z.object({ path: z.array(z.string()), base: field, mine: field, theirs: field })) }),
  z.object({ kind: z.literal('deleted'), operationId: z.string(), snapshot: snapshotSchema }),
  z.object({ kind: z.literal('refused'), operationId: z.string(), code: z.string(),
    seriesMembershipComparisons: z.array(seriesComparison).min(1).max(MAX_RELATION_RESOURCES).optional() }),
  z.object({ kind: z.literal('blocked'), operationId: z.string(), dependencies: z.array(z.string()) }),
]).refine(result => result.kind !== 'acknowledged' || !result.committed || Boolean(
  coversCommittedEffect(result.snapshot, result.snapshot.resource, result.committed)
  && result.committed.operationId === result.operationId
), 'Inconsistent committed effect');
const messages = { failed: 'Data engine request failed', timedOut: 'Data engine request timed out', unavailable: 'Data engine unavailable' };
const version = z.number().int().safe().nonnegative();
const pageSchema: z.ZodType<CollectionPage> = z.object({
  snapshots: z.array(snapshotSchema).max(100), nextCursor: z.string().refine(isValidIdentifier).nullable(), version, legacyOpen: z.boolean().optional(),
});
const changesSchema: z.ZodType<CollectionChanges> = z.object({
  snapshots: z.array(snapshotSchema).max(100), cursor: version, version, hasMore: z.boolean(), resetRequired: z.boolean().optional(), legacyOpen: z.boolean().optional(),
});

function assertOwner(owner: string): void {
  if (!owner || resolveOwnerUid() !== owner) throw Object.assign(new Error('Account changed'), { code: 'unauthenticated' });
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw Object.assign(new Error('Invalid data engine response'), { code: 'data-loss' });
  return result.data;
}

function collectionQuery(collection: string, options: { limit?: number; cursor?: string } = {}): string {
  if (!getResourcePolicy(collection).allowed || collection === '_dataEngineHeads' || (options.limit !== undefined
    && (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100))
    || (options.cursor !== undefined && !isValidIdentifier(options.cursor))) {
    throw Object.assign(new Error('Invalid collection request'), { code: 'invalid-argument' });
  }
  const parameters = new URLSearchParams();
  if (options.limit !== undefined) parameters.set('limit', String(options.limit));
  if (options.cursor !== undefined) parameters.set('cursor', options.cursor);
  return parameters.toString();
}

function validateCollectionSnapshots(owner: string, collection: string, snapshots: ResourceSnapshot[]): void {
  const policy = getResourcePolicy(collection);
  const ids = new Set<string>();
  for (const snapshot of snapshots) {
    if (snapshot.resource.collection !== collection || !isValidIdentifier(snapshot.resource.id)
      || ids.has(snapshot.resource.id) || (policy.ownerField === 'id' && snapshot.resource.id !== owner)
      || (policy.ownerField !== 'id' && snapshot.value !== null && snapshot.value[policy.ownerField] !== owner)) {
      throw Object.assign(new Error('Mismatched collection response'), { code: 'data-loss' });
    }
    ids.add(snapshot.resource.id);
  }
}

function validateRelatedSnapshots(owner: string, result: Extract<CommandResult, { kind: 'acknowledged' }>): void {
  if (!result.relatedSnapshots) return; // Compatible with an older server during rollout.
  const related = result.relatedSnapshots, affected = result.affected ?? [];
  const identities = new Set(related.map(snapshot => JSON.stringify(snapshot.resource)));
  const proofs = new Set(affected.map(effect => JSON.stringify(effect.resource)));
  if (identities.size !== related.length || proofs.size !== affected.length || related.length !== affected.length || affected.some(effect =>
    effect.metadata.operationId !== result.operationId
    || !related.some(snapshot => coversCommittedEffect(snapshot, effect.resource, effect.metadata))
    || (effect.resource.collection === result.snapshot.resource.collection && effect.resource.id === result.snapshot.resource.id))) {
    throw Object.assign(new Error('Mismatched related acknowledgement'), { code: 'data-loss' });
  }
  try { for (const snapshot of related) validateCollectionSnapshots(owner, snapshot.resource.collection, [snapshot]); }
  catch { throw Object.assign(new Error('Mismatched related acknowledgement owner or resource'), { code: 'data-loss' }); }
}

function validateSeriesComparisons(command: DataCommand, result: Extract<CommandResult, { kind: 'refused' }>): void {
  const comparisons = result.seriesMembershipComparisons;
  if (!comparisons) return;
  const mismatch = () => Object.assign(new Error('Mismatched series comparison'), { code: 'data-loss' });
  if (result.code !== 'membership-already-assigned' || command.kind !== 'relation' || command.relation !== 'series-membership') throw mismatch();
  const intended = new Map<string, { id: string; generation: string | null } | null>();
  for (const edit of command.edits) {
    for (const { type, refId } of edit.membership?.removed ?? []) {
      const key = type + ':' + refId;
      if (!intended.has(key)) intended.set(key, null);
    }
    for (const { type, refId } of edit.membership?.added ?? []) intended.set(type + ':' + refId, { id: edit.resource.id, generation: edit.generation });
  }
  for (const { ref, proposed } of comparisons) {
    const key = ref.type + ':' + ref.refId;
    const selected = intended.get(key);
    if (selected === undefined || selected?.id !== proposed?.id || selected?.generation !== proposed?.generation) throw mismatch();
    intended.delete(key);
  }
}

function receiveClock(probe: ReturnType<typeof actionClock.begin> | undefined, owner: string, value: unknown): void {
  if (!probe || !value || typeof value !== 'object' || !('actionClock' in value)) return;
  const echo = value.actionClock;
  if (echo && typeof echo === 'object' && 'challenge' in echo && echo.challenge === probe.challenge
    && 'serverMs' in echo && isClockTime(echo.serverMs)) probe.receive(owner, echo.serverMs);
}

export function createHttpEngineTransport(clock: Pick<typeof actionClock, 'begin'> = actionClock): EngineTransport & CollectionTransport {
  return {
    async send(command) {
      assertOwner(command.owner);
      const query = command.kind === 'relation' && command.relation === 'share-link-revoke' ? '?shareNoteReceipt=1' : '';
      const { value } = await requestOwnerJson<unknown>('/api/data-engine/commands' + query, { method: 'POST', payload: command, messages });
      assertOwner(command.owner);
      const result = parse(resultSchema, value);
      if (result.operationId !== command.operationId || ('snapshot' in result && (
        result.snapshot.resource.collection !== command.resource.collection || result.snapshot.resource.id !== command.resource.id
      ))) throw Object.assign(new Error('Mismatched data engine response'), { code: 'data-loss' });
      if (result.kind === 'acknowledged') validateRelatedSnapshots(command.owner, result);
      if (result.kind === 'refused') validateSeriesComparisons(command, result);
      return result;
    },
    async read(owner, resource, options) {
      assertOwner(owner);
      const query = options?.fresh ? new URLSearchParams({ read: newClientId() }).toString() : '';
      const probe = readsDocumentActionClock(resource.collection) ? clock.begin() : undefined;
      const { value } = await requestOwnerJson<unknown>(`/api/data-engine/documents/${encodeURIComponent(resource.collection)}/${encodeURIComponent(resource.id)}` + (query ? '?' + query : ''), { method: 'GET', answerStatuses: [], messages,
        ...(probe && { headers: { [ACTION_CLOCK_HEADER]: probe.challenge } }),
      });
      assertOwner(owner);
      const snapshot = parse(snapshotSchema, value);
      if (snapshot.resource.collection !== resource.collection || snapshot.resource.id !== resource.id) {
        throw Object.assign(new Error('Mismatched data engine response'), { code: 'data-loss' });
      }
      // The same owner rule as a list: another account's document is never this owner's answer,
      // even when a cache on the way (the service worker) hands one back (cross-account entry, BUGS.md).
      validateCollectionSnapshots(owner, resource.collection, [snapshot]);
      receiveClock(probe, owner, value);
      return snapshot;
    },
    async list(owner, collection, options) {
      assertOwner(owner);
      const query = collectionQuery(collection, options);
      const probe = usesActionClock(collection) ? clock.begin() : undefined;
      const { value } = await requestOwnerJson<unknown>(`/api/data-engine/collections/${encodeURIComponent(collection)}${query ? `?${query}` : ''}`, { method: 'GET', answerStatuses: [], messages,
        ...(probe && { headers: { [ACTION_CLOCK_HEADER]: probe.challenge } }),
      });
      assertOwner(owner);
      const page = parse(pageSchema, value);
      validateCollectionSnapshots(owner, collection, page.snapshots);
      receiveClock(probe, owner, value);
      return page;
    },
    async changes(owner, collection, after, options) {
      assertOwner(owner);
      const query = collectionQuery(collection, options);
      if (!Number.isSafeInteger(after) || after < 0) throw Object.assign(new Error('Invalid collection cursor'), { code: 'invalid-argument' });
      const { value } = await requestOwnerJson<unknown>(`/api/data-engine/changes/${encodeURIComponent(collection)}?after=${after}${query ? `&${query}` : ''}`, { method: 'GET', answerStatuses: [], messages });
      assertOwner(owner);
      const changes = parse(changesSchema, value);
      validateCollectionSnapshots(owner, collection, changes.snapshots);
      return changes;
    },
  };
}
