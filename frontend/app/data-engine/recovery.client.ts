'use client';

import { z } from 'zod';

import { orderActionProjections } from './atomicCommits';
import { readManualScopeIdentity } from './editorIdentity';
import { equalValues, getResourcePolicy, isValidIdentifier, validateCommand } from './protocol';
import { recoverySources } from './recoveryPresence';
import { recoveryOrigins } from './recoverySource';
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
  recoveryVersion: z.string().min(1).optional(),
  retainedManualChoice: z.object({ base: z.unknown(), decidingEditorId: z.string().min(1).optional() }).optional(),
  recoveryOrigins: z.array(z.object({ id: z.string().min(1), version: z.string().min(1) })).optional(),
  recoverySources: z.array(z.object({ id: z.string().min(1) })).optional(),
  checkpoint: z.object({
    confirmed: snapshotSchema, draft: z.unknown(), dirty: z.boolean(), editGeneration: z.number().int().safe().nonnegative(),
    remoteCandidate: snapshotSchema.nullable(),
    conflicts: z.array(z.object({ path: z.array(z.string()), base: fieldSchema, mine: fieldSchema, theirs: fieldSchema })).default([]),
    pending: z.record(id, z.object({ generation: z.number().int().safe().nonnegative(), value: z.unknown(), operations: z.array(id).optional(), borrowedManualScope: z.string().refine(value => readManualScopeIdentity(value) !== null).optional() })),
  }),
});
const sameResource = (a: ResourceRef, b: ResourceRef) => a.collection === b.collection && a.id === b.id;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export const recoveryCheckpointId = (owner: string, editorId: string): string => JSON.stringify([owner, editorId]);

/** Decode the same owner-scoped physical identity for discovery, forking and retirement. */
export function recoveryCheckpointEditorId(owner: string, sourceId: unknown): string | null {
  if (typeof sourceId !== 'string') return null;
  let identity: unknown;
  try { identity = JSON.parse(sourceId); } catch { return null; }
  return Array.isArray(identity) && identity.length === 2 && identity[0] === owner && typeof identity[1] === 'string'
    && sourceId === recoveryCheckpointId(owner, identity[1]) ? identity[1] : null;
}

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
  const retainedManualChoice = record.retainedManualChoice && {
    ...record.retainedManualChoice, base: ownedDocument(record.retainedManualChoice.base),
  };
  return clone({ ...record, retainedManualChoice, prepared,
    checkpoint: { ...record.checkpoint, draft: ownedDocument(record.checkpoint.draft, createIntent), pending, conflicts } });
}

export function isRecoverableCheckpoint(record: EditorRecord): boolean {
  return record.checkpoint.dirty || record.prepared !== null || Object.keys(record.checkpoint.pending).length > 0 || record.unfinalized.length > 0;
}

/** A submitted projection is distinct from a checkpoint that also contains private work. */
export function isOnlySubmittedCopy(record: EditorRecord, includes: (requestId: string) => boolean): boolean {
  const { checkpoint, prepared, unfinalized } = record;
  const pending = Object.entries(checkpoint.pending);
  return !prepared && !unfinalized.length && pending.every(([id]) => includes(id))
    && pending.some(([, intent]) => intent.generation === checkpoint.editGeneration && equalValues(intent.value, checkpoint.draft));
}

/** A saved projection still pins its receipts, but offers no competing recovery copy. */
export function isPassiveManualContinuation(record: EditorRecord): boolean {
  return isOnlySubmittedCopy(record, id => Boolean(record.checkpoint.pending[id].borrowedManualScope));
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
  for (const request of orderActionProjections(requests)) {
    if (request.owner !== record.owner || !sameResource(request.baseline.resource, record.checkpoint.confirmed.resource)
      || completed.has(request.id)
      || (request.editorId !== record.editorId && !session.checkpoint().pending[request.id])) continue;
    // Work the person decided on another editor settles here too (`DataSession.applyCommit`).
    if (session.applyCommit(request)) completed.add(request.id);
  }
  return { ...clone(record), checkpoint: session.checkpoint(), ...(completed.size ? { completedCommits: [...completed] } : {}) };
}

/** Owner filtering happens before reading another owner's record contents. */
export function selectRecoverableCheckpoints(records: readonly (readonly [unknown, unknown])[], owner: string, resource?: ResourceRef): RecoveryCheckpoint[] {
  const selected: RecoveryCheckpoint[] = [];
  for (const [key, value] of records) {
    const editorId = recoveryCheckpointEditorId(owner, key);
    if (editorId === null || typeof key !== 'string') continue;
    const record = validateRecoveryRecord(value, owner, editorId);
    if ((!resource || sameResource(resource, record.checkpoint.confirmed.resource)) && isRecoverableCheckpoint(record)) {
      selected.push({ id: key, record });
    }
  }
  return selected;
}

function checkpointForkRecord(original: EditorRecord, sourceId: string, editorId: string, version: string | null): EditorRecord {
  return clone({ ...original, editorId, recoveryVersion: undefined, retainedManualChoice: undefined,
    recoverySources: recoverySources(original.recoverySources, sourceId),
    recoveryOrigins: version ? recoveryOrigins(original.recoveryOrigins, { id: sourceId, version }) : undefined });
}

/** Explicit fork preserves pending operation identity and never takes over the source editor. */
export async function forkCheckpoint(store: Pick<CheckpointRecoveryStore, 'read' | 'create' | 'pinRecovery'>, owner: string, sourceId: string, newEditorId: string, resource: ResourceRef): Promise<EditorRecord> {
  const sourceEditorId = recoveryCheckpointEditorId(owner, sourceId);
  if (sourceEditorId === null || !newEditorId || newEditorId === sourceEditorId) throw new Error('Invalid checkpoint recovery identity');
  for (let attempt = 0; ; attempt += 1) {
    const value = await store.read(owner, sourceEditorId);
    if (!value) throw Object.assign(new Error('Recovery checkpoint no longer exists'), { code: 'draft-gone' });
    const original = validateRecoveryRecord(value, owner, sourceEditorId, resource);
    if (!isRecoverableCheckpoint(original)) throw Object.assign(new Error('The checkpoint has no pending local work'), { code: 'draft-done' });
    const version = store.pinRecovery ? await store.pinRecovery(original) : null;
    if (store.pinRecovery && !version) {
      if (attempt < 2) continue;
      throw Object.assign(new Error('Recovery source changed before capture'), { code: 'decision-changed' });
    }
    const forked = checkpointForkRecord(original, sourceId, newEditorId, version);
    try { await store.create(forked); return clone(forked); }
    catch (error) {
      if ((error as { code?: string }).code !== 'commit-reference-changed' || attempt === 2) throw error;
    }
  }
}
