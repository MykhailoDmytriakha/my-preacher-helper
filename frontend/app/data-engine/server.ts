import { createHash } from 'node:crypto';

import { FieldPath } from 'firebase-admin/firestore';

import { adminDb } from '@/config/firebaseAdminConfig';

import { commandFingerprint, getResourcePolicy, validateCommand } from './protocol';
import { assembleChangePage, collectionHeadId, HEADS_COLLECTION, parseChangePointer, planFeedWrites, readHeadVersion, sequenceId } from './serverFeed';
import { planDataCommand } from './serverRelations';

import type { FeedWrite } from './serverFeed';
import type { CollectionChanges, CollectionPage, CommandReceipt, CommandResult, DataCommand, DocumentData, EngineMetadata, Json, ResourceRef, ResourceSnapshot } from './types';
import type { Transaction } from 'firebase-admin/firestore';

export const MAX_COMMAND_BYTES = 1024 * 1024;
const MAX_RECEIPT_BYTES = 1_000_000;
const MAX_LIST_BYTES = 4 * 1024 * 1024;
const RECEIPTS = '_dataEngineReceipts';
const INVALID_ARGUMENT = 'invalid-argument';
const PERMISSION_DENIED = 'permission-denied';
const PAYLOAD_TOO_LARGE = 'payload-too-large';
const INVALID_RECEIPT = 'invalid-stored-receipt';

export class DataEngineServerError extends Error {
  constructor(public readonly code: string, public readonly status: number) {
    super(code);
  }
}

/**
 * The HTTP protocol remains opt-in while legacy writers, rules and domain policies
 * are being migrated. This deployment gate is not a replacement for that migration.
 * Trusted server adapters can exercise processCommand without exposing a public API.
 */
export function assertDataEngineEnabled(): void {
  if (process.env.DATA_ENGINE_ENABLED !== 'true') throw new DataEngineServerError('data-engine-disabled', 503);
}

function validSegment(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 1500
    && !value.includes('/') && value !== '.' && value !== '..' && !/^__.*__$/.test(value);
}

function checkOwner(owner: string): void {
  if (!owner || owner.length > 128) throw new DataEngineServerError('unauthenticated', 401);
}

function resourcePolicy(resource: ResourceRef) {
  if (!validSegment(resource.collection) || !validSegment(resource.id)) {
    throw new DataEngineServerError(INVALID_ARGUMENT, 400);
  }
  try {
    const policy = getResourcePolicy(resource.collection);
    if (!policy.allowed) throw new Error('Unregistered resource');
    return policy;
  } catch {
    throw new DataEngineServerError(INVALID_ARGUMENT, 400);
  }
}

function owns(owner: string, resource: ResourceRef, raw: Record<string, unknown> | undefined): boolean {
  const policy = resourcePolicy(resource);
  return policy.ownerField === 'id' ? resource.id === owner : !raw || raw[policy.ownerField] === owner;
}

/** Firestore timestamps have one stable JSON representation on both HTTP paths. */
function toJson(value: unknown): Json {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(toJson);
  if (value && typeof value === 'object') {
    if ('toDate' in value && typeof value.toDate === 'function') return value.toDate().toISOString();
    if (value instanceof Date) return value.toISOString();
    const entries = Object.entries(value).map(([key, item]) => [key, toJson(item)]);
    return Object.fromEntries(entries);
  }
  throw new DataEngineServerError('unsupported-stored-value', 409);
}

function readMetadata(raw: unknown): EngineMetadata | null {
  if (raw === undefined) return null;
  if (!raw || typeof raw !== 'object') throw new DataEngineServerError('unsupported-protocol', 409);
  const data = raw as Partial<EngineMetadata>;
  if (data.protocol !== 1 || typeof data.generation !== 'string' || !data.generation
      || !Number.isSafeInteger(data.revision) || (data.revision ?? 0) < 1 || typeof data.deleted !== 'boolean'
      || (data.operationId !== undefined && (typeof data.operationId !== 'string' || !data.operationId))) {
    throw new DataEngineServerError('unsupported-protocol', 409);
  }
  return { protocol: 1, generation: data.generation, revision: data.revision!, deleted: data.deleted, ...(data.operationId ? { operationId: data.operationId } : {}) };
}

function snapshotFromRaw(resource: ResourceRef, raw: Record<string, unknown> | undefined): ResourceSnapshot {
  if (!raw) return { resource, value: null, metadata: null };
  const metadata = readMetadata(raw._dataEngine);
  if (metadata?.deleted) return { resource, value: null, metadata };
  const value = Object.fromEntries(Object.entries(raw).filter(([key]) => key !== '_dataEngine'));
  return { resource, value: toJson(value) as DocumentData, metadata };
}

/** Keep native timestamp values in fields whose logical JSON value did not change. */
function preserveStoredTypes(previous: unknown, next: Json): unknown {
  if (previous !== undefined && JSON.stringify(toJson(previous)) === JSON.stringify(next)) return previous;
  if (Array.isArray(next)) {
    return next.map((item, index) => preserveStoredTypes(Array.isArray(previous) ? previous[index] : undefined, item));
  }
  if (next && typeof next === 'object') {
    const before = previous && typeof previous === 'object' ? previous as Record<string, unknown> : {};
    return Object.fromEntries(Object.entries(next).map(([key, value]) => [key, preserveStoredTypes(before[key], value)]));
  }
  return next;
}

function receiptRef(owner: string, operationId: string) {
  const id = createHash('sha256').update(JSON.stringify([owner, operationId])).digest('hex');
  return adminDb.collection(RECEIPTS).doc(id);
}

type Acknowledgement = Extract<CommandResult, { kind: 'acknowledged' }>;
interface CompactAcknowledgement {
  receiptVersion: 2;
  kind: 'acknowledged';
  operationId: string;
  resource: ResourceRef;
  committed: EngineMetadata;
  affected?: Acknowledgement['affected'];
}
type StoredReceipt = Omit<CommandReceipt, 'result'> & { result: CommandResult | CompactAcknowledgement };
const compact = (result: StoredReceipt['result']): result is CompactAcknowledgement => 'receiptVersion' in result;
const unavailableReceiptSnapshot = () => new DataEngineServerError('receipt-snapshot-unavailable', 503);

function readCompactAcknowledgement(result: Record<string, unknown>): CompactAcknowledgement {
  const resource = result.resource as ResourceRef | undefined;
  if (result.receiptVersion !== 2 || result.kind !== 'acknowledged' || !validSegment(result.operationId)
    || !resource || !validSegment(resource.collection) || !validSegment(resource.id)) {
    throw new DataEngineServerError(INVALID_RECEIPT, 409);
  }
  const committed = readMetadata(result.committed);
  if (!committed || committed.operationId !== result.operationId
    || (result.affected !== undefined && (!Array.isArray(result.affected) || result.affected.length > 99))) {
    throw new DataEngineServerError(INVALID_RECEIPT, 409);
  }
  const affected = result.affected as Array<{ resource?: ResourceRef; metadata?: unknown }> | undefined;
  const effects = affected?.map(effect => {
    const metadata = readMetadata(effect?.metadata);
    if (!effect?.resource || !validSegment(effect.resource.collection) || !validSegment(effect.resource.id)
      || !metadata || metadata.operationId !== result.operationId) throw new DataEngineServerError(INVALID_RECEIPT, 409);
    return { resource: effect.resource, metadata };
  });
  return { receiptVersion: 2, kind: 'acknowledged', operationId: result.operationId as string, resource,
    committed, ...(effects ? { affected: effects } : {}) };
}

function readReceipt(raw: Record<string, unknown> | undefined): StoredReceipt | undefined {
  if (!raw) return undefined;
  let result: unknown = raw.result;
  if (typeof raw.resultJson === 'string') {
    try { result = JSON.parse(raw.resultJson) as unknown; }
    catch { throw new DataEngineServerError(INVALID_RECEIPT, 409); }
  }
  if (!result || typeof result !== 'object' || !('kind' in result)
      || !['acknowledged', 'conflict', 'deleted', 'refused', 'blocked'].includes(String(result.kind))) {
    throw new DataEngineServerError(INVALID_RECEIPT, 409);
  }
  const parsed = 'receiptVersion' in result ? readCompactAcknowledgement(result as Record<string, unknown>) : result as CommandResult;
  return { owner: raw.owner as string, operationId: raw.operationId as string, commandHash: raw.commandHash as string, result: parsed };
}

/** ACK history retains proof of effect, never another full document per autosave. */
function serializeReceipt(receipt: CommandReceipt) {
  const result = receipt.result;
  const stored: CommandResult | CompactAcknowledgement = result.kind === 'acknowledged'
    ? { receiptVersion: 2, kind: result.kind, operationId: result.operationId, resource: result.snapshot.resource,
      committed: result.committed ?? result.snapshot.metadata!, ...(result.affected ? { affected: result.affected } : {}) }
    : result;
  // Exact conflict payloads remain JSON strings to avoid nested map depth amplification.
  return { owner: receipt.owner, operationId: receipt.operationId, commandHash: receipt.commandHash, resultJson: JSON.stringify(stored) };
}

function replayAcknowledgement(result: CompactAcknowledgement, resource: ResourceRef, raw: Record<string, unknown> | undefined): Acknowledgement {
  let snapshot: ResourceSnapshot;
  try { snapshot = snapshotFromRaw(resource, raw); }
  catch { throw unavailableReceiptSnapshot(); }
  if (result.resource.collection !== resource.collection || result.resource.id !== resource.id
    || !snapshot.metadata || snapshot.metadata.generation !== result.committed.generation
    || snapshot.metadata.revision < result.committed.revision || (result.committed.deleted && !snapshot.metadata.deleted)) {
    throw unavailableReceiptSnapshot();
  }
  return { kind: 'acknowledged', operationId: result.operationId, snapshot, committed: result.committed,
    ...(result.affected ? { affected: result.affected } : {}) };
}

function previousCommandResult(previous: StoredReceipt | undefined, command: DataCommand, commandHash: string,
  raw: Record<string, unknown> | undefined): CommandResult | undefined {
  if (!owns(command.owner, command.resource, raw)) {
    if (previous && compact(previous.result)) throw unavailableReceiptSnapshot();
    return { kind: 'refused', operationId: command.operationId, code: PERMISSION_DENIED };
  }
  if (!previous) return undefined;
  if (previous.owner !== command.owner || previous.operationId !== command.operationId || previous.commandHash !== commandHash) {
    return { kind: 'refused', operationId: command.operationId, code: 'operation-id-reused' };
  }
  if (compact(previous.result)) return replayAcknowledgement(previous.result, command.resource, raw);
  return previous.result.kind === 'blocked' ? undefined : previous.result;
}

async function prepareFeedWrites(transaction: Transaction, owner: string, operationId: string, effects: ResourceSnapshot[]): Promise<FeedWrite[]> {
  const collections = [...new Set(effects.map(effect => effect.resource.collection))];
  const heads = await Promise.all(collections.map(async collection => {
    const head = await transaction.get(adminDb.collection(HEADS_COLLECTION).doc(collectionHeadId(owner, collection)));
    return [collection, head.exists ? head.data() as DocumentData : undefined] as const;
  }));
  return planFeedWrites(owner, operationId, effects, new Map(heads));
}

function persistFeedWrites(transaction: Transaction, writes: FeedWrite[]): void {
  for (const write of writes) {
    const head = adminDb.collection(write.path[0]).doc(write.path[1]);
    transaction.set(write.path.length === 2 ? head : head.collection(write.path[2]).doc(write.path[3]), write.value);
  }
}

/** Trusted server callers pass their authenticated owner explicitly; no auth comes from the payload. */
export async function processCommand(owner: string, input: unknown): Promise<CommandResult> {
  checkOwner(owner);
  let command: DataCommand;
  try {
    command = validateCommand(input);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === INVALID_ARGUMENT
        && input && typeof input === 'object' && 'owner' in input && input.owner === owner
        && 'operationId' in input && validSegment(input.operationId)) {
      return { kind: 'refused', operationId: input.operationId, code: INVALID_ARGUMENT };
    }
    throw error;
  }
  resourcePolicy(command.resource);
  if (Buffer.byteLength(JSON.stringify(command)) > MAX_COMMAND_BYTES) return { kind: 'refused', operationId: command.operationId, code: 'resource-exhausted' };
  if (command.owner !== owner) throw new DataEngineServerError(PERMISSION_DENIED, 403);
  const commandHash = createHash('sha256').update(commandFingerprint(command)).digest('hex');
  const commandReceiptRef = receiptRef(owner, command.operationId);
  const documentRef = adminDb.collection(command.resource.collection).doc(command.resource.id);
  const refusal = (code: string): CommandResult => ({ kind: 'refused', operationId: command.operationId, code });

  return adminDb.runTransaction(async transaction => {
    // Rights and receipts are read in the same transaction as the eventual effect.
    const [stored, existingReceipt] = await Promise.all([transaction.get(documentRef), transaction.get(commandReceiptRef)]);
    const raw = stored.exists ? stored.data() : undefined;
    const previous = existingReceipt.exists ? readReceipt(existingReceipt.data()) : undefined;
    const replay = previousCommandResult(previous, command, commandHash, raw);
    if (replay) return replay;

    const dependencies = await Promise.all(command.dependsOn.map(id => transaction.get(receiptRef(owner, id))));
    const blocked = command.dependsOn.filter((id, index) => {
      const dependency = readReceipt(dependencies[index].data());
      return !dependency || dependency.owner !== owner || dependency.operationId !== id || dependency.result.kind !== 'acknowledged';
    });
    let result: CommandResult;
    let effects: ResourceSnapshot[] = [];
    const resourceKey = (resource: ResourceRef) => JSON.stringify([resource.collection, resource.id]);
    const rawDocuments = new Map<string, Record<string, unknown> | undefined>([[resourceKey(command.resource), raw]]);
    if (blocked.length) {
      result = { kind: 'blocked', operationId: command.operationId, dependencies: blocked };
    } else {
      const plan = await planDataCommand(command, snapshotFromRaw(command.resource, raw), {
        get: async resource => {
          resourcePolicy(resource);
          const document = await transaction.get(adminDb.collection(resource.collection).doc(resource.id));
          const data = document.exists ? document.data() : undefined;
          if (!owns(owner, resource, data)) throw new DataEngineServerError(PERMISSION_DENIED, 403);
          rawDocuments.set(resourceKey(resource), data);
          return snapshotFromRaw(resource, data);
        },
        list: async (collection, limit, filter) => {
          const ownerField = getResourcePolicy(collection).ownerField;
          let query = adminDb.collection(collection).where(ownerField, '==', owner).limit(limit);
          if (filter) query = query.where(filter.field, filter.operator, filter.value);
          const documents = await transaction.get(query);
          return documents.docs.map(document => {
            const resource = { collection, id: document.id };
            const data = document.data();
            if (data[ownerField] !== owner) throw new DataEngineServerError(PERMISSION_DENIED, 403);
            rawDocuments.set(resourceKey(resource), data);
            return snapshotFromRaw(resource, data);
          });
        },
      });
      result = plan.result;
      if (result.kind === 'acknowledged') result = { ...result, committed: result.snapshot.metadata! };
      effects = plan.writes;
      // Leave headroom below Firestore's transaction request limit; never split a cascade.
      if (effects.reduce((bytes, effect) => bytes + Buffer.byteLength(JSON.stringify(effect)), 0) > 8 * 1024 * 1024) {
        result = refusal('relation-effects-too-large');
      }
    }
    let receipt: CommandReceipt = { owner, operationId: command.operationId, commandHash, result };
    // Receipts are indivisible Firestore documents. Refuse before writing, never truncate recovery data.
    // Measure stored strings, not a second JSON encoding that would count escapes twice.
    if (Object.values(serializeReceipt(receipt)).reduce((bytes, value) => bytes + Buffer.byteLength(value), 0) > MAX_RECEIPT_BYTES) {
      result = refusal('receipt-too-large');
      receipt = { ...receipt, result };
    }
    if (result.kind === 'acknowledged') {
      const feedWrites = await prepareFeedWrites(transaction, owner, command.operationId, effects);
      for (const snapshot of effects) {
        const value = snapshot.value === null
          ? { [getResourcePolicy(snapshot.resource.collection).ownerField]: owner }
          : preserveStoredTypes(rawDocuments.get(resourceKey(snapshot.resource)), snapshot.value) as Record<string, unknown>;
        transaction.set(adminDb.collection(snapshot.resource.collection).doc(snapshot.resource.id), { ...value, _dataEngine: snapshot.metadata });
      }
      persistFeedWrites(transaction, feedWrites);
    }
    // A blocked receipt fixes the identity but may advance after its dependencies acknowledge.
    transaction.set(commandReceiptRef, serializeReceipt(receipt));
    return result;
  });
}

export async function readDocument(owner: string, resource: ResourceRef): Promise<ResourceSnapshot> {
  checkOwner(owner);
  resourcePolicy(resource);
  const document = await adminDb.collection(resource.collection).doc(resource.id).get();
  const raw = document.exists ? document.data() : undefined;
  if (!owns(owner, resource, raw)) throw new DataEngineServerError(PERMISSION_DENIED, 403);
  return snapshotFromRaw(resource, raw);
}

export type ResourcePage = CollectionPage;

function headReference(owner: string, collection: string) {
  try { return adminDb.collection(HEADS_COLLECTION).doc(collectionHeadId(owner, collection)); }
  catch { throw new DataEngineServerError(INVALID_ARGUMENT, 400); }
}

export async function listDocuments(owner: string, collection: string, options: { limit?: number; cursor?: string } = {}): Promise<ResourcePage> {
  checkOwner(owner);
  const policy = resourcePolicy({ collection, id: owner });
  const limit = options.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (options.cursor !== undefined && !validSegment(options.cursor))) {
    throw new DataEngineServerError(INVALID_ARGUMENT, 400);
  }
  const headRef = headReference(owner, collection);
  return adminDb.runTransaction(async transaction => {
    const head = await transaction.get(headRef);
    const version = readHeadVersion(owner, collection, head.exists ? head.data() as DocumentData : undefined);
    if (policy.ownerField === 'id') {
      if (options.cursor && options.cursor >= owner) return { snapshots: [], nextCursor: null, version };
      const document = await transaction.get(adminDb.collection(collection).doc(owner));
      const snapshot = snapshotFromRaw({ collection, id: owner }, document.exists ? document.data() : undefined);
      return { snapshots: snapshot.value !== null || snapshot.metadata !== null ? [snapshot] : [], nextCursor: null, version };
    }
    let query = adminDb.collection(collection).where(policy.ownerField, '==', owner).orderBy(FieldPath.documentId()).limit(limit + 1);
    if (options.cursor !== undefined) query = query.startAfter(options.cursor);
    const page = await transaction.get(query);
    const snapshots: ResourceSnapshot[] = [];
    let bytes = 0;
    for (const document of page.docs.slice(0, limit)) {
      const resource = { collection, id: document.id };
      const raw = document.data();
      if (!owns(owner, resource, raw)) throw new DataEngineServerError(PERMISSION_DENIED, 403);
      const snapshot = snapshotFromRaw(resource, raw);
      bytes += Buffer.byteLength(JSON.stringify(snapshot));
      if (bytes > MAX_LIST_BYTES && snapshots.length > 0) break;
      snapshots.push(snapshot);
    }
    return { snapshots, nextCursor: page.docs.length > snapshots.length ? snapshots.at(-1)!.resource.id : null, version };
  });
}

export async function readCollectionChanges(owner: string, collection: string, after: number, options: { limit?: number } = {}): Promise<CollectionChanges> {
  checkOwner(owner);
  resourcePolicy({ collection, id: owner });
  const limit = options.limit ?? 100;
  if (!Number.isSafeInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new DataEngineServerError(INVALID_ARGUMENT, 400);
  const headRef = headReference(owner, collection);
  return adminDb.runTransaction(async transaction => {
    const [head, changes] = await Promise.all([
      transaction.get(headRef),
      transaction.get(headRef.collection('changes').orderBy(FieldPath.documentId()).startAfter(sequenceId(after)).limit(limit)),
    ]);
    const version = readHeadVersion(owner, collection, head.exists ? head.data() as DocumentData : undefined);
    const pointers = changes.docs.map(document => parseChangePointer(collection, document.id, document.data() as DocumentData));
    if (pointers.length < limit && (pointers.at(-1)?.version ?? after) < version) pointers.push(undefined);
    const resources = new Map(pointers.flatMap(pointer => pointer ? [[pointer.resource.id, pointer.resource] as const] : []));
    const snapshots = await Promise.all([...resources.values()].map(async resource => {
      resourcePolicy(resource);
      const document = await transaction.get(adminDb.collection(collection).doc(resource.id));
      const raw = document.exists ? document.data() : undefined;
      if (!owns(owner, resource, raw)) throw new DataEngineServerError(PERMISSION_DENIED, 403);
      return [resource.id, snapshotFromRaw(resource, raw)] as const;
    }));
    return assembleChangePage(version, after, pointers, new Map(snapshots));
  });
}

/** Bound the bytes actually read, even when Content-Length is absent or dishonest. */
export async function readCommandBody(request: Request): Promise<unknown> {
  const announced = request.headers.get('content-length');
  if (announced && (!/^\d+$/.test(announced) || Number(announced) > MAX_COMMAND_BYTES)) {
    throw new DataEngineServerError(PAYLOAD_TOO_LARGE, 413);
  }
  if (!request.body) throw new DataEngineServerError(INVALID_ARGUMENT, 400);
  const reader = request.body.getReader();
  // Do not retain one object per chunk: a tiny-chunk stream can otherwise consume
  // far more memory than the admitted byte limit (even empty chunks cost memory).
  let body = Buffer.alloc(4096);
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_COMMAND_BYTES) {
        await reader.cancel();
        throw new DataEngineServerError(PAYLOAD_TOO_LARGE, 413);
      }
      if (size > body.length) {
        const expanded = Buffer.alloc(Math.min(MAX_COMMAND_BYTES, Math.max(size, body.length * 2)));
        body.copy(expanded);
        body = expanded;
      }
      body.set(value, size - value.byteLength);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(body.subarray(0, size).toString('utf8')) as unknown;
  } catch {
    throw new DataEngineServerError(INVALID_ARGUMENT, 400);
  }
}

export function serverErrorResponse(error: unknown): Response {
  if (error instanceof DataEngineServerError) return Response.json({ code: error.code }, { status: error.status, headers: { 'Cache-Control': 'no-store' } });
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  const invalid = code === INVALID_ARGUMENT || (error instanceof Error && error.message === INVALID_ARGUMENT);
  return Response.json({ code: invalid ? INVALID_ARGUMENT : 'unavailable' }, { status: invalid ? 400 : 503, headers: { 'Cache-Control': 'no-store' } });
}
