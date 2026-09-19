'use client';

import { z } from 'zod';

import { getResourcePolicy, isValidIdentifier, validateCommand } from './protocol';
import { DataSession } from './session';
import { snapshotSchema } from './transport.client';

import type { CommitRequest } from './commits';
import type { CheckpointRecoveryStore, EditorRecord, RecoveryCheckpoint } from './controller';
import type { ConflictDetail, FieldValue, ResourceRef } from './types';

const id = z.string().refine(isValidIdentifier);
const fieldSchema = z.discriminatedUnion('exists', [z.object({ exists: z.literal(false) }), z.object({ exists: z.literal(true), value: z.unknown() })]);
const recordSchema = z.object({
  owner: id, editorId: z.string().min(1), prepared: z.unknown().nullable(), unfinalized: z.array(id).default([]),
  completedCommits: z.array(id).optional(),
  checkpoint: z.object({
    confirmed: snapshotSchema, draft: z.unknown(), dirty: z.boolean(), editGeneration: z.number().int().safe().nonnegative(),
    remoteCandidate: snapshotSchema.nullable(),
    conflicts: z.array(z.object({ path: z.array(z.string()), base: fieldSchema, mine: fieldSchema, theirs: fieldSchema })).default([]),
    pending: z.record(id, z.object({ generation: z.number().int().safe().nonnegative(), value: z.unknown(), operations: z.array(id).optional() })),
  }),
});
const sameResource = (a: ResourceRef, b: ResourceRef) => a.collection === b.collection && a.id === b.id;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export const recoveryCheckpointId = (owner: string, editorId: string): string => JSON.stringify([owner, editorId]);

/** Validate recovered disk data before it can enter a controller or another account. */
export function validateRecoveryRecord(value: unknown, owner: string, editorId: string, resource?: ResourceRef): EditorRecord {
  const record = recordSchema.parse(value);
  const ref = record.checkpoint.confirmed.resource;
  if (record.owner !== owner || record.editorId !== editorId || (resource && !sameResource(resource, ref))
    || (record.checkpoint.remoteCandidate && !sameResource(ref, record.checkpoint.remoteCandidate.resource))) throw new Error('Checkpoint identity mismatch');
  const document = (data: unknown) => snapshotSchema.parse({ resource: ref, value: data, metadata: null }).value;
  const policy = getResourcePolicy(ref.collection);
  const ownedDocument = (data: unknown, createIntent = false) => {
    const value = document(data);
    if (policy.ownerField === 'id' ? ref.id !== owner : value !== null && value[policy.ownerField] !== owner
      && !(createIntent && !Object.prototype.hasOwnProperty.call(value, policy.ownerField))) throw new Error('Checkpoint document ownership mismatch');
    return value;
  };
  ownedDocument(record.checkpoint.confirmed.value);
  if (record.checkpoint.remoteCandidate) ownedDocument(record.checkpoint.remoteCandidate.value);
  const field = (input: z.infer<typeof fieldSchema>): FieldValue => input.exists
    ? { exists: true, value: document({ value: input.value })!.value } : { exists: false };
  const prepared = record.prepared === null ? null : validateCommand(record.prepared);
  if (prepared && (prepared.owner !== owner || !sameResource(prepared.resource, ref)
    || !Object.prototype.hasOwnProperty.call(record.checkpoint.pending, prepared.operationId))) throw new Error('Prepared checkpoint identity mismatch');
  const conflicts: ConflictDetail[] = record.checkpoint.conflicts.map(conflict => ({ ...conflict, base: field(conflict.base), mine: field(conflict.mine), theirs: field(conflict.theirs) }));
  const createIntent = record.checkpoint.confirmed.value === null && record.checkpoint.confirmed.metadata === null;
  const pending = Object.fromEntries(Object.entries(record.checkpoint.pending).map(([operationId, intent]) => [operationId, { ...intent, value: ownedDocument(intent.value, createIntent) }]));
  return clone({ ...record, prepared, checkpoint: { ...record.checkpoint, draft: ownedDocument(record.checkpoint.draft, createIntent), pending, conflicts } });
}

export function isRecoverableCheckpoint(record: EditorRecord): boolean {
  return record.checkpoint.dirty || record.prepared !== null || Object.keys(record.checkpoint.pending).length > 0 || record.unfinalized.length > 0;
}

/**
 * Background delivery outlives the editor that saved. Project its durable results
 * before offering recovery, using exactly the mounted editor's ACK/rebase rule.
 * This is a read-only view: another live tab may still own the stored checkpoint.
 * Requests must be in dependency order, as returned by CommitQueue.list().
 */
export function reconcileRecoveryRecord(record: EditorRecord, requests: readonly CommitRequest[]): EditorRecord {
  const session = DataSession.restore(record.checkpoint);
  const completed = new Set(record.completedCommits ?? []);
  for (const request of requests) {
    if (request.owner !== record.owner || !sameResource(request.baseline.resource, record.checkpoint.confirmed.resource)
      || completed.has(request.id)
      || (request.editorId !== record.editorId && !session.checkpoint().pending[request.id])) continue;
    if (session.applyCommit(request)) completed.add(request.id);
  }
  return { ...clone(record), checkpoint: session.checkpoint(), ...(completed.size ? { completedCommits: [...completed] } : {}) };
}

/** Owner filtering happens before reading another owner's record contents. */
export function selectRecoverableCheckpoints(records: readonly (readonly [unknown, unknown])[], owner: string, resource?: ResourceRef): RecoveryCheckpoint[] {
  const selected: RecoveryCheckpoint[] = [];
  for (const [key, value] of records) {
    if (typeof key !== 'string') continue;
    let identity: unknown;
    try { identity = JSON.parse(key); } catch { continue; }
    if (!Array.isArray(identity) || identity.length !== 2 || identity[0] !== owner || typeof identity[1] !== 'string'
      || key !== recoveryCheckpointId(owner, identity[1])) continue;
    const record = validateRecoveryRecord(value, owner, identity[1]);
    if ((!resource || sameResource(resource, record.checkpoint.confirmed.resource)) && isRecoverableCheckpoint(record)) {
      selected.push({ id: key, record });
    }
  }
  return selected;
}

/** Explicit fork preserves pending operation identity and never takes over the source editor. */
export async function forkCheckpoint(store: Pick<CheckpointRecoveryStore, 'read' | 'create'>, owner: string, sourceId: string, newEditorId: string, resource: ResourceRef): Promise<EditorRecord> {
  let identity: unknown;
  try { identity = JSON.parse(sourceId); } catch { throw new Error('Invalid checkpoint recovery identity'); }
  if (!Array.isArray(identity) || identity.length !== 2 || identity[0] !== owner || typeof identity[1] !== 'string'
    || sourceId !== recoveryCheckpointId(owner, identity[1]) || !newEditorId || newEditorId === identity[1]) throw new Error('Invalid checkpoint recovery identity');
  for (let attempt = 0; ; attempt += 1) {
    const value = await store.read(owner, identity[1]);
    if (!value) throw new Error('Recovery checkpoint no longer exists');
    const original = validateRecoveryRecord(value, owner, identity[1], resource);
    if (!isRecoverableCheckpoint(original)) throw new Error('The checkpoint has no pending local work');
    const forked = clone({ ...original, editorId: newEditorId });
    try { await store.create(forked); return clone(forked); }
    catch (error) {
      if ((error as { code?: string }).code !== 'commit-reference-changed' || attempt === 2) throw error;
    }
  }
}
