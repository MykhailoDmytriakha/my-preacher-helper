'use client';

import { z } from 'zod';

import { requestOwnerJson } from '@/services/ownerHttpTransport.client';
import { resolveOwnerUid } from '@/utils/queryKeys';

import { getResourcePolicy, isValidIdentifier } from './protocol';

import type { CollectionChanges, CollectionPage, CollectionTransport, CommandResult, EngineTransport, Json, ResourceSnapshot } from './types';

const json: z.ZodType<Json> = z.lazy(() => z.union([z.null(), z.boolean(), z.number().finite(), z.string(), z.array(json), z.record(json)]));
const resourceSchema = z.object({ collection: z.string(), id: z.string() });
const metadataSchema = z.object({ protocol: z.literal(1), generation: z.string().min(1), revision: z.number().int().safe().positive(), deleted: z.boolean(), operationId: z.string().refine(isValidIdentifier).optional() });
const field = z.object({ exists: z.boolean(), value: json.optional() });
export const snapshotSchema: z.ZodType<ResourceSnapshot> = z.object({
  resource: resourceSchema,
  value: z.record(json).nullable(),
  metadata: metadataSchema.nullable(),
}).refine((snapshot) => !snapshot.metadata || (snapshot.metadata.deleted === (snapshot.value === null)), 'Inconsistent deletion metadata');
const resultSchema: z.ZodType<CommandResult> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('acknowledged'), operationId: z.string(), snapshot: snapshotSchema, committed: metadataSchema.optional(), affected: z.array(z.object({ resource: resourceSchema, metadata: metadataSchema })).optional() }),
  z.object({ kind: z.literal('conflict'), operationId: z.string(), snapshot: snapshotSchema, conflicts: z.array(z.object({ path: z.array(z.string()), base: field, mine: field, theirs: field })) }),
  z.object({ kind: z.literal('deleted'), operationId: z.string(), snapshot: snapshotSchema }),
  z.object({ kind: z.literal('refused'), operationId: z.string(), code: z.string() }),
  z.object({ kind: z.literal('blocked'), operationId: z.string(), dependencies: z.array(z.string()) }),
]).refine(result => result.kind !== 'acknowledged' || !result.committed || Boolean(result.snapshot.metadata
  && result.snapshot.metadata.generation === result.committed.generation
  && result.snapshot.metadata.revision >= result.committed.revision
  && result.committed.operationId === result.operationId
  && (!result.committed.deleted || result.snapshot.metadata.deleted)), 'Inconsistent committed effect');
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

export function createHttpEngineTransport(): EngineTransport & CollectionTransport {
  return {
    async send(command) {
      assertOwner(command.owner);
      const { value } = await requestOwnerJson<unknown>('/api/data-engine/commands', { method: 'POST', payload: command, messages });
      assertOwner(command.owner);
      const result = parse(resultSchema, value);
      if (result.operationId !== command.operationId || ('snapshot' in result && (
        result.snapshot.resource.collection !== command.resource.collection || result.snapshot.resource.id !== command.resource.id
      ))) throw Object.assign(new Error('Mismatched data engine response'), { code: 'data-loss' });
      return result;
    },
    async read(owner, resource) {
      assertOwner(owner);
      const { value } = await requestOwnerJson<unknown>(`/api/data-engine/documents/${encodeURIComponent(resource.collection)}/${encodeURIComponent(resource.id)}`, { method: 'GET', answerStatuses: [], messages });
      assertOwner(owner);
      const snapshot = parse(snapshotSchema, value);
      if (snapshot.resource.collection !== resource.collection || snapshot.resource.id !== resource.id) {
        throw Object.assign(new Error('Mismatched data engine response'), { code: 'data-loss' });
      }
      return snapshot;
    },
    async list(owner, collection, options) {
      assertOwner(owner);
      const query = collectionQuery(collection, options);
      const { value } = await requestOwnerJson<unknown>(`/api/data-engine/collections/${encodeURIComponent(collection)}${query ? `?${query}` : ''}`, { method: 'GET', answerStatuses: [], messages });
      assertOwner(owner);
      const page = parse(pageSchema, value);
      validateCollectionSnapshots(owner, collection, page.snapshots);
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
