import { createHash, randomUUID } from 'node:crypto';

import { FieldPath, Filter } from 'firebase-admin/firestore';

import { adminDb, FieldValue } from '@/config/firebaseAdminConfig';
import { aiModelDefaultsDocument } from '@/services/aiModelDefaults.server';
import { storeRetryHeaders } from '@/services/storeAvailability.server';
import { userEntitlementDocument } from '@/services/userEntitlement.server';

import { stampAcceptedResource } from './acceptedResource.server';
import { ACTION_CLOCK_HEADER, isClockChallenge, usesActionClock } from './actionClock';
import { isCollectionServed, isLegacyOpen, mayBeRetiredByCascade } from './activation';
import { BIBLE_MARK_HISTORY, BIBLE_MARK_PROOFS, bibleMarkProofVerses, bibleMarkTracking, metadataAfterBibleMarks, orderBibleMarks } from './bibleMarkOrder.server';
import { existingRowDate, MEETING_DATE_TARGET, PREACH_DATE_TARGET } from './datedRowAction';
import { metadataAfterDatedRow, orderDatedRow } from './datedRowOrder.server';
import { metadataAfterDocumentFields, orderDocumentFields, DOCUMENT_TITLE_HISTORY, GROUP_STATUS_HISTORY } from './documentFieldOrder.server';
import { advanceResourceSnapshot, commandFingerprint, getResourcePolicy, isValidIdentifier, TOMBSTONE_OWNER_FIELD, validateCommand } from './protocol';
import { validateResourceDocument } from './resourceSchemas';
import { assembleChangePage, collectionHeadId, HEADS_COLLECTION, parseChangePointer, planFeedWrites, readHeadVersion, sequenceId } from './serverFeed';
import { planDataCommand } from './serverRelations';
import { coversCommittedEffect } from './snapshotFreshness';


import type { AudioExportKey, AudioExportRecord, AudioExportStore, AudioExportTransaction, AudioExportUsage } from './audioExportStore';
import type { BibleMarkHistoryEntry, BibleMarkHistoryPage } from './bibleMarkStroke';
import type { DisplacedRowDate, MeetingDateHistoryPage, PreachDateHistoryPage } from './datedRowAction';
import type { GroupStatusHistoryPage, GroupTitleHistoryPage, DocumentTitleHistoryEntry, ServiceOrderTitleHistoryPage } from './documentFieldAction';
import type { FeedWrite } from './serverFeed';
import type { CollectionChanges, CollectionPage, CommandReceipt, CommandResult, ConflictDetail, DataCommand, DocumentData, EngineMetadata, EngineReadOptions, Json, ResourceRef, ResourceSnapshot } from './types';
import type { AiResultReceiptStore, ReceiptRecord } from '@/services/aiResultReceipt.server';
import type { DocumentReference, Firestore, Transaction } from 'firebase-admin/firestore';

export function readActionClockChallenge(collection: string, headers: Headers): string | undefined {
  if (!usesActionClock(collection)) return undefined;
  const challenge = headers.get(ACTION_CLOCK_HEADER);
  return isClockChallenge(challenge) ? challenge : undefined;
}

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
 * The protocol is always served (the engine owns collections in code, engineOwnedCollections.ts);
 * every collection in a new effect must still be explicitly served.
 */
export function assertDataEngineEnabled(collection?: string): void {
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
      || (data.operationId !== undefined && (typeof data.operationId !== 'string' || !data.operationId))
      || (data.shareRevocation !== undefined && !isValidIdentifier(data.shareRevocation))) {
    throw new DataEngineServerError('unsupported-protocol', 409);
  }
  return { protocol: 1, generation: data.generation, revision: data.revision!, deleted: data.deleted,
    ...(data.operationId ? { operationId: data.operationId } : {}),
    ...(data.shareRevocation ? { shareRevocation: data.shareRevocation } : {}) };
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
  const snapshot = effects.find(effect => effect.resource.collection === result.snapshot.resource.collection && effect.resource.id === result.snapshot.resource.id) ?? result.snapshot;
  return { ...result, snapshot, committed: snapshot.metadata!, ...(relatedSnapshots.length ? { relatedSnapshots } : {}) };
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

/** A public view is a server-observed counter event, never an editable capability command. */
export async function recordSharedNoteView(linkId: string, token: string): Promise<void> {
  if (!isValidIdentifier(linkId) || typeof token !== 'string' || !token) return;
  const resource = { collection: 'studyNoteShareLinks', id: linkId };
  const operationId = `share-view:${randomUUID()}`;
  await adminDb.runTransaction(async transaction => {
    const reference = adminDb.collection(resource.collection).doc(resource.id);
    const document = await transaction.get(reference);
    const raw = document.exists ? document.data() : undefined;
    if (!raw || raw.revoked === true || raw.token !== token || !isValidIdentifier(raw.ownerId)
      || !isValidIdentifier(raw.noteId)) return;
    const current = snapshotFromRaw(resource, raw);
    if (!current.value) return;
    const count = typeof current.value.viewCount === 'number' && Number.isFinite(current.value.viewCount) ? current.value.viewCount : 0;
    const value = { ...current.value, viewCount: count + 1 };
    validateResourceDocument(resource.collection, value, { kind: 'update', changedFields: ['viewCount'], previous: current.value });
    const next = advanceResourceSnapshot(current, value, operationId, []);
    const feedWrites = await prepareFeedWrites(transaction, raw.ownerId, operationId, [next]);
    transaction.set(reference, { ...preserveStoredTypes(raw, next.value!) as Record<string, unknown>, _dataEngine: next.metadata });
    persistFeedWrites(transaction, feedWrites);
  });
}

/** Trusted server callers pass their authenticated owner explicitly; no auth comes from the payload. */
const resourceKey = (resource: ResourceRef) => JSON.stringify([resource.collection, resource.id]);

function historyEntryId(snapshot: ResourceSnapshot, operationId: string): string {
  const metadata = snapshot.metadata!;
  const hash = createHash('sha256').update(JSON.stringify([metadata.generation, operationId])).digest('hex');
  return `${String(Number.MAX_SAFE_INTEGER - metadata.revision).padStart(16, '0')}-${hash}`;
}

function retainUncertainChronology(plan: Awaited<ReturnType<typeof planDataCommand>>, command: DataCommand, current: ResourceSnapshot,
  uncertain: readonly ConflictDetail[]): Awaited<ReturnType<typeof planDataCommand>> {
  if (!uncertain.length || (plan.result.kind !== 'acknowledged' && plan.result.kind !== 'conflict')) return plan;
  const conflicts = new Map(uncertain.map(item => [JSON.stringify(item.path), item]));
  if (plan.result.kind === 'conflict') {
    for (const item of plan.result.conflicts) conflicts.set(JSON.stringify(item.path), item);
  }
  return { result: { kind: 'conflict', operationId: command.operationId, snapshot: current, conflicts: [...conflicts.values()] }, writes: [] };
}

async function planBibleMarkOrder(transaction: Transaction, document: DocumentReference, command: DataCommand,
  current: ResourceSnapshot, raw: unknown, serverMs: number) {
  const tracking = bibleMarkTracking(raw);
  const verses = bibleMarkProofVerses(command);
  const proofs = new Map<string, unknown>();
  if (tracking.floor && verses?.length && command.kind === 'update' && command.generation === current.metadata?.generation) {
    const collection = document.collection(BIBLE_MARK_PROOFS);
    const pages = await Promise.all(verses.map(verse => transaction.get(collection.doc(verse))));
    verses.forEach((verse, index) => proofs.set(verse, pages[index].data()));
  }
  return orderBibleMarks(command, current, tracking, verses, proofs, serverMs);
}

function persistBibleMarkOrder(transaction: Transaction, command: DataCommand, snapshot: ResourceSnapshot, order?: ReturnType<typeof orderBibleMarks>): void {
  if ((!order?.proofWrites?.size && !order?.displaced?.length) || !snapshot.metadata || !snapshot.value) return;
  const { generation, revision } = snapshot.metadata;
  const document = adminDb.collection(command.resource.collection).doc(command.resource.id);
  for (const [verse, proofs] of order.proofWrites ?? []) {
    transaction.set(document.collection(BIBLE_MARK_PROOFS).doc(verse), { generation, revision, proofs });
  }
  if (order.displaced?.length) {
    const history = document.collection(BIBLE_MARK_HISTORY);
    transaction.set(history.doc(historyEntryId(snapshot, command.operationId)), {
      generation, marks: order.displaced, acceptedAt: new Date().toISOString(),
    });
  }
}

async function persistAcceptedCommand(transaction: Transaction, { owner, command, snapshot: primarySnapshot, effects, rawDocuments, dateOrder, markOrder, fieldOrder }: {
  owner: string;
  command: DataCommand;
  snapshot: ResourceSnapshot;
  effects: ResourceSnapshot[];
  rawDocuments: ReadonlyMap<string, Record<string, unknown> | undefined>;
  dateOrder?: ReturnType<typeof orderDatedRow>;
  markOrder?: ReturnType<typeof orderBibleMarks>;
  fieldOrder?: ReturnType<typeof orderDocumentFields>;
}) {
  const feedWrites = await prepareFeedWrites(transaction, owner, command.operationId, effects);
  const primaryKey = resourceKey(command.resource);
  for (const snapshot of effects) {
    const key = resourceKey(snapshot.resource);
    const raw = rawDocuments.get(key);
    const value = snapshot.value === null
      ? { [TOMBSTONE_OWNER_FIELD]: owner }
      : preserveStoredTypes(raw, snapshot.value) as Record<string, unknown>;
    const primary = key === primaryKey;
    const dated = metadataAfterDatedRow(snapshot, raw, primary ? command : undefined, primary ? dateOrder : undefined);
    const metadata = snapshot.resource.collection === 'bibleMarks'
      ? metadataAfterBibleMarks(snapshot, raw?._dataEngine, primary ? markOrder : undefined)
      : metadataAfterDocumentFields({ ...snapshot, metadata: dated }, raw?._dataEngine, primary ? fieldOrder : undefined);
    transaction.set(adminDb.collection(snapshot.resource.collection).doc(snapshot.resource.id), { ...value, _dataEngine: metadata });
  }
  const displaced = dateOrder?.displaced;
  const target = dateOrder?.target;
  if (displaced && target && existingRowDate(primarySnapshot.value?.[target.field], displaced.rowId, target) === displaced.winnerDate) {
    const history = adminDb.collection(command.resource.collection).doc(command.resource.id).collection(target.history);
    transaction.set(history.doc(historyEntryId(primarySnapshot, command.operationId)), { ...displaced, acceptedAt: new Date().toISOString() });
  }
  for (const { target, order } of fieldOrder?.fields ?? []) {
    const displaced = order.displaced;
    if (!displaced || primarySnapshot.value?.[target.field] !== displaced.winnerValue) continue;
    const history = adminDb.collection(command.resource.collection).doc(command.resource.id)
      .collection(target.field === 'status' ? GROUP_STATUS_HISTORY : DOCUMENT_TITLE_HISTORY);
    const { value, winnerValue, ...evidence } = displaced;
    const values = target.field === 'status' ? { status: value, winnerStatus: winnerValue } : { title: value, winnerTitle: winnerValue };
    transaction.set(history.doc(historyEntryId(primarySnapshot, command.operationId)), { ...evidence, ...values, acceptedAt: new Date().toISOString() });
  }
  persistBibleMarkOrder(transaction, command, primarySnapshot, markOrder);
  persistFeedWrites(transaction, feedWrites);
}

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
    let dateOrder: ReturnType<typeof orderDatedRow> | undefined;
    let markOrder: ReturnType<typeof orderBibleMarks> | undefined;
    let fieldOrder: ReturnType<typeof orderDocumentFields> | undefined;
    const rawDocuments = new Map<string, Record<string, unknown> | undefined>([[resourceKey(command.resource), raw]]);
    if (blocked.length) {
      result = { kind: 'blocked', operationId: command.operationId, dependencies: blocked };
    } else {
      const current = snapshotFromRaw(command.resource, raw);
      const serverMs = stored.readTime?.toMillis();
      dateOrder = orderDatedRow(command, current, raw?._dataEngine, serverMs);
      markOrder = await planBibleMarkOrder(transaction, documentRef, dateOrder.command, current, raw?._dataEngine, serverMs);
      fieldOrder = orderDocumentFields(markOrder.command, current, raw?._dataEngine, serverMs);
      const planned = await planDataCommand(fieldOrder.command, current, {
        get: async resource => {
          resourcePolicy(resource);
          const document = await transaction.get(adminDb.collection(resource.collection).doc(resource.id));
          const data = document.exists ? document.data() : undefined;
          if (!owns(owner, resource, data)) throw new DataEngineServerError(PERMISSION_DENIED, 403);
          rawDocuments.set(resourceKey(resource), data);
          return snapshotFromRaw(resource, data);
        },
        list: async (collection, limit, filter, select) => {
          const ownerField = getResourcePolicy(collection).ownerField;
          const pageSize = select ? 100 : limit;
          const matches: ResourceSnapshot[] = [];
          let cursor: string | undefined;
          // Every page belongs to this transaction. Unrelated rows are read, but
          // do not consume the selected participant/effect budget or raw cache.
          while (matches.length < limit) {
            let query = adminDb.collection(collection).where(ownerField, '==', owner)
              .orderBy(FieldPath.documentId()).limit(pageSize);
            if (filter) query = query.where(filter.field, filter.operator, filter.value);
            if (cursor !== undefined) query = query.startAfter(cursor);
            const documents = await transaction.get(query);
            for (const document of documents.docs) {
              const resource = { collection, id: document.id };
              const data = document.data();
              if (data[ownerField] !== owner) throw new DataEngineServerError(PERMISSION_DENIED, 403);
              const snapshot = snapshotFromRaw(resource, data);
              if (select && !select(snapshot)) continue;
              rawDocuments.set(resourceKey(resource), data);
              matches.push(snapshot);
              if (matches.length === limit) return matches;
            }
            if (!select || documents.docs.length < pageSize) return matches;
            cursor = documents.docs[documents.docs.length - 1].id;
          }
          return matches;
        },
      });
      const plan = retainUncertainChronology(planned, command, current, [...(dateOrder.uncertain ?? []), ...(markOrder.uncertain ?? []), ...(fieldOrder.uncertain ?? [])]);
      const acceptedAt = new Date().toISOString();
      // The planner exposes writes only for acknowledged commands.
      effects = plan.writes.map(effect => stampAcceptedResource(snapshotFromRaw(effect.resource, rawDocuments.get(resourceKey(effect.resource))), effect, acceptedAt));
      result = withAcceptedCopies(plan.result, effects);
      // Leave headroom below Firestore's transaction request limit; never split a cascade.
      if (effectBytes(effects) > MAX_EFFECT_BYTES) {
        result = refusal('relation-effects-too-large');
      }
      // The primary route switch is insufficient: a cascade can mark documents
      // whose clients are still legacy. Refuse the entire effect before any write.
      // Receipt replay above retains proof of already accepted work independently.
      if (effects.some(effect => !isCollectionServed(effect.resource.collection)
        && !(effect.value === null && mayBeRetiredByCascade(effect.resource.collection)))) {
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
      await persistAcceptedCommand(transaction, { owner, command, snapshot: result.snapshot, effects, rawDocuments, dateOrder, markOrder, fieldOrder });
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

type ClockEcho = { actionClock?: { challenge: string; serverMs: number } };

export async function readDocument(owner: string, resource: ResourceRef, options?: EngineReadOptions & { actionClockChallenge?: string }): Promise<ResourceSnapshot & ClockEcho> {
  checkOwner(owner);
  resourcePolicy(resource);
  const document = await adminDb.collection(resource.collection).doc(resource.id).get();
  const raw = document.exists ? document.data() : undefined;
  if (!owns(owner, resource, raw)) throw new DataEngineServerError(PERMISSION_DENIED, 403);
  const snapshot = snapshotFromRaw(resource, raw);
  const challenge = options?.actionClockChallenge;
  if (challenge && resource.collection === 'groups' && document.readTime) {
    return { ...snapshot, actionClock: { challenge, serverMs: Math.floor(document.readTime.toMillis()) } };
  }
  return snapshot;
}

async function listHistoryEntries<T extends { id: string }>(owner: string, resource: ResourceRef, subcollection: string,
  generation: string, cursor: string | undefined, unavailable: string): Promise<{ entries: T[]; nextCursor: string | null }> {
  checkOwner(owner);
  if (!validSegment(resource.id) || !validSegment(generation) || (cursor !== undefined && !/^\d{16}-[0-9a-f]{64}$/.test(cursor))) {
    throw new DataEngineServerError(INVALID_ARGUMENT, 400);
  }
  const reference = adminDb.collection(resource.collection).doc(resource.id);
  return adminDb.runTransaction(async transaction => {
    const document = await transaction.get(reference);
    const raw = document.exists ? document.data() : undefined;
    if (!owns(owner, resource, raw)) throw new DataEngineServerError(PERMISSION_DENIED, 403);
    const snapshot = snapshotFromRaw(resource, raw);
    if (!snapshot.value || snapshot.metadata?.generation !== generation) throw new DataEngineServerError(unavailable, 404);
    const pageSize = 20;
    const query = reference.collection(subcollection).where('generation', '==', generation).orderBy(FieldPath.documentId()).limit(pageSize + 1);
    const page = await transaction.get(cursor ? query.startAfter(cursor) : query);
    const entries = page.docs.slice(0, pageSize).map(item => ({ ...item.data(), id: item.id }) as T);
    return { entries, nextCursor: page.docs.length > pageSize ? entries.at(-1)!.id : null };
  });
}

export async function listPreachDateHistory(owner: string, sermonId: string, generation: string, cursor?: string): Promise<PreachDateHistoryPage> {
  const resource = { collection: 'sermons', id: sermonId };
  const page = await listHistoryEntries<DisplacedRowDate & { id: string; acceptedAt: string }>(
    owner, resource, PREACH_DATE_TARGET.history, generation, cursor, 'preach-date-gone',
  );
  return { owner, sermonId, generation, ...page };
}

export async function listMeetingDateHistory(owner: string, groupId: string, generation: string, cursor?: string): Promise<MeetingDateHistoryPage> {
  const resource = { collection: 'groups', id: groupId };
  const page = await listHistoryEntries<DisplacedRowDate & { id: string; acceptedAt: string }>(
    owner, resource, MEETING_DATE_TARGET.history, generation, cursor, 'group-gone',
  );
  return { owner, groupId, generation, ...page };
}

export async function listBibleMarkHistory(owner: string, bookId: string, generation: string, cursor?: string): Promise<BibleMarkHistoryPage> {
  const resource = { collection: 'bibleMarks', id: bookId };
  const page = await listHistoryEntries<BibleMarkHistoryEntry>(owner, resource, BIBLE_MARK_HISTORY, generation, cursor, 'marks-book-gone');
  return { owner, bookId, generation, ...page };
}

export async function listServiceOrderTitleHistory(owner: string, orderId: string, generation: string, cursor?: string): Promise<ServiceOrderTitleHistoryPage> {
  const resource = { collection: 'serviceOrders', id: orderId };
  const page = await listHistoryEntries<DocumentTitleHistoryEntry>(owner, resource, DOCUMENT_TITLE_HISTORY, generation, cursor, 'service-order-gone');
  return { owner, orderId, generation, ...page };
}

export async function listGroupTitleHistory(owner: string, groupId: string, generation: string, cursor?: string): Promise<GroupTitleHistoryPage> {
  const resource = { collection: 'groups', id: groupId };
  const page = await listHistoryEntries<DocumentTitleHistoryEntry>(owner, resource, DOCUMENT_TITLE_HISTORY, generation, cursor, 'group-gone');
  return { owner, groupId, generation, ...page };
}

export async function listGroupStatusHistory(owner: string, groupId: string, generation: string, cursor?: string): Promise<GroupStatusHistoryPage> {
  const resource = { collection: 'groups', id: groupId };
  const page = await listHistoryEntries<GroupStatusHistoryPage['entries'][number]>(owner, resource, GROUP_STATUS_HISTORY, generation, cursor, 'group-gone');
  return { owner, groupId, generation, ...page };
}

export type ResourcePage = CollectionPage & ClockEcho;

/** Said only while true, so an answer about a closed or unserved collection is byte-identical to before. */
const legacyOpenness = (collection: string): { legacyOpen?: true } => isLegacyOpen(collection) ? { legacyOpen: true } : {};

function headReference(owner: string, collection: string) {
  try { return adminDb.collection(HEADS_COLLECTION).doc(collectionHeadId(owner, collection)); }
  catch { throw new DataEngineServerError(INVALID_ARGUMENT, 400); }
}

export async function listDocuments(owner: string, collection: string, options: { limit?: number; cursor?: string; actionClockChallenge?: string } = {}): Promise<ResourcePage> {
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
    // Limit the live/tombstone union in Firestore instead of fetching two unused tails.
    // The same document order and one-row lookahead apply; the byte budget below may
    // still shorten a page.
    const query = adminDb.collection(collection).where(Filter.or(
      Filter.where(policy.ownerField, '==', owner),
      Filter.where(TOMBSTONE_OWNER_FIELD, '==', owner),
    )).orderBy(FieldPath.documentId()).limit(limit + 1);
    const page = await transaction.get(options.cursor === undefined ? query : query.startAfter(options.cursor));
    const rows = page.docs;
    const snapshots: ResourceSnapshot[] = [];
    let bytes = 0;
    for (const document of rows.slice(0, limit)) {
      const resource = { collection, id: document.id };
      const raw = document.data();
      if (!owns(owner, resource, raw)) throw new DataEngineServerError(PERMISSION_DENIED, 403);
      const snapshot = snapshotFromRaw(resource, raw);
      bytes += Buffer.byteLength(JSON.stringify(snapshot));
      if (bytes > MAX_LIST_BYTES && snapshots.length > 0) break;
      snapshots.push(snapshot);
    }
    const actionClock = usesActionClock(collection) && options.actionClockChallenge && page.readTime
      ? { challenge: options.actionClockChallenge, serverMs: Math.floor(page.readTime.toMillis()) }
      : undefined;
    return { snapshots, nextCursor: rows.length > snapshots.length ? snapshots.at(-1)!.resource.id : null, version,
      ...legacyOpenness(collection), ...(actionClock && { actionClock }) };
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
  return Response.json({ code: invalid ? INVALID_ARGUMENT : 'unavailable' }, { status: invalid ? 400 : 503, headers: { 'Cache-Control': 'no-store', ...storeRetryHeaders(error) } });
}


/** Read both inputs to the account's entitlement at one consistent Firestore snapshot. */
export async function readAccountEntitlementSnapshot(uid: string) {
  checkOwner(uid);
  const [user, defaults] = await adminDb.runTransaction(
    transaction => transaction.getAll(userEntitlementDocument(uid), aiModelDefaultsDocument()),
    { readOnly: true },
  );
  const readTime = user.readTime.valueOf() >= defaults.readTime.valueOf() ? user.readTime : defaults.readTime;
  return { userData: user.data(), defaultsData: defaults.data(), readTime };
}

/** Native IO for operational audio receipts, separate from person-edit commands and feeds. */
export function createAudioExportStore(userId: string, sermonId: string, database: Firestore = adminDb): AudioExportStore {
  checkOwner(userId);
  if (!validSegment(userId) || !validSegment(sermonId)) throw new DataEngineServerError(INVALID_ARGUMENT, 400);
  const hash = (values: string[]) => createHash('sha256').update(JSON.stringify(values)).digest('hex');
  const head = database.collection('_audioExports').doc(hash([userId, sermonId]));
  const identity = (value: string) => {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(value)) throw new DataEngineServerError(INVALID_ARGUMENT, 400);
    return value;
  };
  const reference = (key: AudioExportKey) => {
    switch (key.kind) {
      case 'head': return head;
      case 'admission': return database.collection('_audioExportAdmissions').doc(hash([userId, sermonId, identity(key.exportId)]));
      case 'settlement': return database.collection('_audioExportSettlements').doc(hash([userId, sermonId, identity(key.exportId), identity(key.outputId)]));
      case 'cache':
        if (!/^(?:chunk-\d+|bytes-\d+-\d+)$/.test(key.id)) throw new DataEngineServerError(INVALID_ARGUMENT, 400);
        return head.collection('_audioExportCache').doc(key.id);
      default: throw new DataEngineServerError(INVALID_ARGUMENT, 400);
    }
  };
  const data = <T extends AudioExportRecord>(snapshot: { exists: boolean; data(): unknown }): T | undefined =>
    snapshot.exists ? snapshot.data() as T : undefined;
  const user = database.collection('users').doc(userId);
  return Object.freeze({
    userId, sermonId,
    read: async <T extends AudioExportRecord>(key: AudioExportKey) => data<T>(await reference(key).get()),
    readMany: async <T extends AudioExportRecord>(keys: AudioExportKey[]) => {
      if (!keys.length) return [];
      return (await database.getAll(...keys.map(reference))).map(snapshot => data<T>(snapshot));
    },
    cacheKeys: async () => (await head.collection('_audioExportCache').select('generation').get()).docs
      .map(document => ({ kind: 'cache' as const, id: document.id })),
    transaction: <T>(run: (transaction: AudioExportTransaction) => Promise<T>) => database.runTransaction(async native => run({
      read: async <V extends AudioExportRecord>(key: AudioExportKey) => data<V>(await native.get(reference(key))),
      readMany: async <V extends AudioExportRecord>(keys: AudioExportKey[]) => {
        if (!keys.length) return [];
        return (await native.getAll(...keys.map(reference))).map(snapshot => data<V>(snapshot));
      },
      readUsage: async () => (await native.get(user)).data()?.usage as AudioExportUsage | undefined,
      write: (key, value) => {
        assertAudioReceiptScope(value, userId, sermonId);
        native.set(reference(key), value);
      },
      writeUsage: usage => {
        assertOperationalUsage(usage);
        native.set(user, { usage }, { merge: true });
      },
      removeCache: key => {
        if (key.kind !== 'cache') throw new DataEngineServerError(INVALID_ARGUMENT, 400);
        native.delete(reference(key));
      },
    })),
  });
}

function assertAudioReceiptScope(value: AudioExportRecord, userId: string, sermonId: string): void {
  if ((value.userId !== undefined && value.userId !== userId) || (value.sermonId !== undefined && value.sermonId !== sermonId)) {
    throw new DataEngineServerError(PERMISSION_DENIED, 403);
  }
}

function assertOperationalUsage(usage: AudioExportUsage): void {
  const counters = ['aiUsed', 'transcriptionSecondsUsed', 'audioSecondsUsed'];
  const allowed = new Set(['periodStart', ...counters]);
  if (!usage || Object.keys(usage).some(key => !allowed.has(key)) ||
      typeof usage.periodStart !== 'string' || !Number.isFinite(Date.parse(usage.periodStart)) ||
      counters.some(key => typeof usage[key as keyof AudioExportUsage] !== 'number' ||
        !Number.isFinite(usage[key as keyof AudioExportUsage]) || Number(usage[key as keyof AudioExportUsage]) < 0)) {
    throw new DataEngineServerError(INVALID_ARGUMENT, 400);
  }
}


/** Private operational receipts are not person-edit documents or feed entries. */
export function createAiResultReceiptStore(uid: string, database: Firestore = adminDb): AiResultReceiptStore {
  checkOwner(uid);
  const user = database.collection('users').doc(uid);
  const receipts = user.collection('aiResultReceipts');
  const data = (snapshot: { data(): unknown }) => snapshot.data() as ReceiptRecord | undefined;

  return {
    read: async id => data(await receipts.doc(id).get()),
    async create(id, record) {
      const receipt = receipts.doc(id);
      const { writeTime } = await receipt.create(record);
      return async patch => { await receipt.update(patch, { lastUpdateTime: writeTime }); };
    },
    transaction: run => database.runTransaction(transaction => run({
      read: async id => data(await transaction.get(receipts.doc(id))),
      readReady: async limit => {
        const result = await transaction.get(receipts.where('state', '==', 'ready').limit(limit));
        return result.docs.map(doc => ({ id: doc.id, record: doc.data() as ReceiptRecord }));
      },
      readUsage: async () => (await transaction.get(user)).data()?.usage,
      writeUsage: usage => {
        assertOperationalUsage(usage);
        transaction.set(user, { usage }, { merge: true });
      },
      writeReceipt: (id, patch) => { transaction.update(receipts.doc(id), patch); },
    })),
  };
}

function aiPromptTelemetryRecord(eventId: string) {
  return adminDb.collection(process.env.AI_TELEMETRY_COLLECTION || 'ai_prompt_telemetry').doc(eventId);
}

export async function createAiPromptTelemetryRecord(eventId: string, fields: object, terminal = false): Promise<void> {
  await aiPromptTelemetryRecord(eventId).create({
    ...fields,
    createdAt: FieldValue.serverTimestamp(),
    ...(terminal ? { settledAtServer: FieldValue.serverTimestamp() } : {}),
  });
}

export async function updateAiPromptTelemetryOutcome(eventId: string, fields: object): Promise<void> {
  await aiPromptTelemetryRecord(eventId).update({ ...fields, settledAtServer: FieldValue.serverTimestamp() });
}
