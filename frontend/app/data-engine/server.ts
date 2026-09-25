import { createHash } from 'node:crypto';

import { FieldPath } from 'firebase-admin/firestore';

import { adminDb } from '@/config/firebaseAdminConfig';

import { isCollectionServed, isEngineServing, isLegacyOpen } from './activation';
import { commandFingerprint, getResourcePolicy, TOMBSTONE_OWNER_FIELD, validateCommand } from './protocol';
import { assembleChangePage, collectionHeadId, HEADS_COLLECTION, parseChangePointer, planFeedWrites, readHeadVersion, sequenceId } from './serverFeed';
import { planDataCommand } from './serverRelations';
import { coversCommittedEffect } from './snapshotFreshness';

import type { FeedWrite } from './serverFeed';
import type { CollectionChanges, CollectionPage, CommandReceipt, CommandResult, DataCommand, DocumentData, EngineMetadata, Json, ResourceRef, ResourceSnapshot } from './types';
import type { Transaction } from 'firebase-admin/firestore';

export const MAX_COMMAND_BYTES = 1024 * 1024;
const MAX_RECEIPT_BYTES = 1_000_000;
const MAX_EFFECT_BYTES = 8 * 1024 * 1024;
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
 * Trusted server adapters can exercise processCommand without exposing a public API,
 * but every collection in a new effect must still be explicitly served.
 */
export function assertDataEngineEnabled(collection?: string): void {
  if (!isEngineServing()) throw new DataEngineServerError('data-engine-disabled', 503);
  // A domain migrates as a whole, so the deployment lists the collections it owns. The engine's
  // own bookkeeping is not one of them: change heads are how a client learns that any migrated
  // collection moved, and gating them behind the same list would leave it deaf to its own domain.
  // Without a collection the caller only asks whether the protocol is served at all.
  if (collection !== undefined && collection !== HEADS_COLLECTION && !isCollectionServed(collection)) {
    throw new DataEngineServerError('data-engine-disabled', 503);
  }
}

/** The command route gates before validation, so an unusable body yields no collection. */
export function commandCollection(body: unknown): string | undefined {
  const resource = (body as { resource?: { collection?: unknown } } | null)?.resource;
  return typeof resource?.collection === 'string' ? resource.collection : undefined;
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
  if (policy.ownerField === 'id') return resource.id === owner;
  if (!raw || raw[policy.ownerField] === owner) return true;
  // A tombstone carries no legacy owner field (see TOMBSTONE_OWNER_FIELD); ones written before
  // 2026-09-18 still do and are matched by the line above.
  return raw[policy.ownerField] === undefined && raw[TOMBSTONE_OWNER_FIELD] === owner;
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
  const value = Object.fromEntries(Object.entries(raw).filter(([key]) => key !== '_dataEngine' && key !== TOMBSTONE_OWNER_FIELD));
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
  if (!coversCommittedEffect(snapshot, result.resource, result.committed)) {
    throw unavailableReceiptSnapshot();
  }
  return { kind: 'acknowledged', operationId: result.operationId, snapshot, committed: result.committed,
    ...(result.affected ? { affected: result.affected } : {}) };
}

/** Current participant copies accompany replay; compact history retains only their proof. */
async function relatedAcknowledgement(transaction: Transaction, owner: string, result: Acknowledgement): Promise<Acknowledgement> {
  if (!result.affected?.length) return result;
  const relatedSnapshots = await Promise.all(result.affected.map(async effect => {
    const stored = await transaction.get(adminDb.collection(effect.resource.collection).doc(effect.resource.id));
    const raw = stored.exists ? stored.data() : undefined;
    if (!owns(owner, effect.resource, raw)) throw unavailableReceiptSnapshot();
    return replayAcknowledgement({ receiptVersion: 2, kind: 'acknowledged', operationId: result.operationId,
      resource: effect.resource, committed: effect.metadata }, effect.resource, raw).snapshot;
  }));
  // A later edit may grow the participants beyond the original transaction size.
  // Keep ACK proof available; clients can read the omitted copies individually.
  return effectBytes([result.snapshot, ...relatedSnapshots]) <= MAX_EFFECT_BYTES ? { ...result, relatedSnapshots } : result;
}

const effectBytes = (effects: ResourceSnapshot[]) => effects.reduce((bytes, effect) => bytes + Buffer.byteLength(JSON.stringify(effect)), 0);
function withAcceptedCopies(result: CommandResult, effects: ResourceSnapshot[]): CommandResult {
  if (result.kind !== 'acknowledged') return result;
  const relatedSnapshots = effects.filter(effect => effect.resource.collection !== result.snapshot.resource.collection || effect.resource.id !== result.snapshot.resource.id);
  return { ...result, committed: result.snapshot.metadata!, ...(relatedSnapshots.length ? { relatedSnapshots } : {}) };
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
  // A deleted tag leaves the thoughts after its own commit, one sermon at a time (removeTagFromSermons).
  let deletedTag: string | null = null;

  const outcome = await adminDb.runTransaction(async transaction => {
    deletedTag = null;
    // Rights and receipts are read in the same transaction as the eventual effect.
    const [stored, existingReceipt] = await Promise.all([transaction.get(documentRef), transaction.get(commandReceiptRef)]);
    const raw = stored.exists ? stored.data() : undefined;
    const previous = existingReceipt.exists ? readReceipt(existingReceipt.data()) : undefined;
    const replay = previousCommandResult(previous, command, commandHash, raw);
    if (replay) return replay.kind === 'acknowledged' ? relatedAcknowledgement(transaction, owner, replay) : replay;

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
      effects = plan.writes;
      result = withAcceptedCopies(plan.result, effects);
      // Leave headroom below Firestore's transaction request limit; never split a cascade.
      if (effectBytes(effects) > MAX_EFFECT_BYTES) {
        result = refusal('relation-effects-too-large');
      }
      // The primary route switch is insufficient: a cascade can mark documents
      // whose clients are still legacy. Refuse the entire effect before any write.
      // Receipt replay above retains proof of already accepted work independently.
      if (effects.some(effect => !isCollectionServed(effect.resource.collection))) {
        result = refusal('related-collection-not-enabled');
      }
    }
    let receipt: CommandReceipt = { owner, operationId: command.operationId, commandHash, result };
    // Receipts are indivisible Firestore documents. Refuse before writing, never truncate recovery data.
    // Measure stored strings, not a second JSON encoding that would count escapes twice.
    if (Object.values(serializeReceipt(receipt)).reduce((bytes, value) => bytes + Buffer.byteLength(value), 0) > MAX_RECEIPT_BYTES) {
      result = refusal('receipt-too-large');
      receipt = { ...receipt, result };
    }
    if (result.kind === 'acknowledged' && command.kind === 'delete' && command.resource.collection === 'tags' && typeof raw?.name === 'string') {
      deletedTag = raw.name;
    }
    if (result.kind === 'acknowledged') {
      const feedWrites = await prepareFeedWrites(transaction, owner, command.operationId, effects);
      for (const snapshot of effects) {
        const value = snapshot.value === null
          ? { [TOMBSTONE_OWNER_FIELD]: owner }
          : preserveStoredTypes(rawDocuments.get(resourceKey(snapshot.resource)), snapshot.value) as Record<string, unknown>;
        transaction.set(adminDb.collection(snapshot.resource.collection).doc(snapshot.resource.id), { ...value, _dataEngine: snapshot.metadata });
      }
      persistFeedWrites(transaction, feedWrites);
    }
    // A blocked receipt fixes the identity but may advance after its dependencies acknowledge.
    transaction.set(commandReceiptRef, serializeReceipt(receipt));
    return result;
  });
  const tag = deletedTag as string | null;
  if (tag) {
    // After the commit and outside it: the tag is gone whatever happens here, and a partial
    // cleanup leaves only a harmless label that the next pass removes.
    try {
      const { removeTagFromSermons } = await import('./serverEdit.server');
      await removeTagFromSermons(owner, tag);
    } catch (error) { console.error('Deleted tag could not leave every thought', error); }
  }
  return outcome;
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

/** Said only while true, so an answer about a closed or unserved collection is byte-identical to before. */
const legacyOpenness = (collection: string): { legacyOpen?: true } => isLegacyOpen(collection) ? { legacyOpen: true } : {};

/** Firestore orders document IDs by UTF-8 bytes, i.e. by Unicode scalar value — not UTF-16 units. */
function compareDocumentIds(left: string, right: string): number {
  const a = Array.from(left), b = Array.from(right);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const difference = a[index].codePointAt(0)! - b[index].codePointAt(0)!;
    if (difference) return difference;
  }
  return a.length - b.length;
}

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
      if (options.cursor && options.cursor >= owner) return { snapshots: [], nextCursor: null, version, ...legacyOpenness(collection) };
      const document = await transaction.get(adminDb.collection(collection).doc(owner));
      const snapshot = snapshotFromRaw({ collection, id: owner }, document.exists ? document.data() : undefined);
      return { snapshots: snapshot.value !== null || snapshot.metadata !== null ? [snapshot] : [], nextCursor: null, version, ...legacyOpenness(collection) };
    }
    // Two owner queries, one list: live documents answer the legacy owner field, tombstones
    // answer TOMBSTONE_OWNER_FIELD. Both run from the same cursor and merge in document order.
    const owned = (field: string) => {
      const query = adminDb.collection(collection).where(field, '==', owner).orderBy(FieldPath.documentId()).limit(limit + 1);
      return transaction.get(options.cursor === undefined ? query : query.startAfter(options.cursor));
    };
    const [live, buried] = await Promise.all([owned(policy.ownerField), owned(TOMBSTONE_OWNER_FIELD)]);
    const merged = [...new Map([...live.docs, ...buried.docs].map(document => [document.id, document])).values()]
      .sort((left, right) => compareDocumentIds(left.id, right.id));
    const snapshots: ResourceSnapshot[] = [];
    let bytes = 0;
    for (const document of merged.slice(0, limit)) {
      const resource = { collection, id: document.id };
      const raw = document.data();
      if (!owns(owner, resource, raw)) throw new DataEngineServerError(PERMISSION_DENIED, 403);
      const snapshot = snapshotFromRaw(resource, raw);
      bytes += Buffer.byteLength(JSON.stringify(snapshot));
      if (bytes > MAX_LIST_BYTES && snapshots.length > 0) break;
      snapshots.push(snapshot);
    }
    return { snapshots, nextCursor: merged.length > snapshots.length ? snapshots.at(-1)!.resource.id : null, version, ...legacyOpenness(collection) };
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
    return { ...assembleChangePage(version, after, pointers, new Map(snapshots)), ...legacyOpenness(collection) };
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
