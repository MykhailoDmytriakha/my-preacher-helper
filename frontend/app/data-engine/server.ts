import { createHash, randomUUID } from 'node:crypto';

import { FieldPath, Filter } from 'firebase-admin/firestore';

import { adminDb, FieldValue } from '@/config/firebaseAdminConfig';
import { aiModelDefaultsDocument } from '@/services/aiModelDefaults.server';
import { storeRetryHeaders } from '@/services/storeAvailability.server';
import { userEntitlementDocument } from '@/services/userEntitlement.server';
import { isSermonGoalType, preparationConfirmationPaths, repeatedWordsPath } from '@/utils/preparationFieldValues';
import { TAG_NAME_EXISTS } from '@/utils/tagName';

import { stampAcceptedResource } from './acceptedResource.server';
import { ACTION_CLOCK_HEADER, isClockChallenge, readsDocumentActionClock, usesActionClock } from './actionClock';
import { isCollectionServed, isLegacyOpen, mayBeRetiredByCascade } from './activation';
import { metadataAfterAnalysisFrame, orderAnalysisFrame } from './analysisFrameOrder.server';
import { ANALYSIS_RESHAPE_FRAME } from './analysisReshapeFields';
import { metadataAfterAuthoredListRemovals, orderAuthoredListAdditions } from './authoredListOrder.server';
import { isAuthoredListComparison } from './authoredStringList';
import { BIBLE_MARK_HISTORY, BIBLE_MARK_PROOFS, bibleMarkProofVerses, bibleMarkTracking, metadataAfterBibleMarks, orderBibleMarks } from './bibleMarkOrder.server';
import { MAX_COMMAND_BYTES } from './commandSize';
import { conflictReceiptDigest, readConflictJsonParts, splitConflictJson, validConflictPartCount } from './conflictReceiptParts.server';
import { alignCouncilAssembly, COUNCIL_ASSEMBLY_POLICY, type CouncilAssemblyHistoryPage } from './councilAssemblyAction';
import { COUNCIL_OUTCOME_POLICY, isCouncilOutcome, type CouncilOutcomeHistoryPage } from './councilOutcomeAction';
import { orderCouncilOutcome } from './councilOutcomeOrder.server';
import { alignCouncilTopicKind, COUNCIL_TOPIC_KIND_POLICY, type CouncilTopicKind, type CouncilTopicKindHistoryPage } from './councilTopicKindAction';
import { COUNCIL_TOPIC_PLACEMENT_HISTORY, metadataAfterCouncilTopicPlacement } from './councilTopicPlacement.server';
import { COUNCIL_TOPIC_TEXT_QUEUED, COUNCIL_TOPIC_TEXT_SETTLED, councilTopicTextConflict } from './councilTopicTextAction';
import { boundCouncilTopicTextMetadata, councilTopicTextOrderPolicy, orderCouncilTopicText, settledCouncilTopicDetails } from './councilTopicTextOrder.server';
import { COUNCIL_TOPIC_SUMMARY_POLICY, COUNCIL_TOPIC_TITLE_POLICY, type CouncilTopicTitleHistoryPage } from './councilTopicTitleAction';
import { existingRowDate, MEETING_DATE_TARGET, PREACH_DATE_TARGET } from './datedRowAction';
import { metadataAfterDatedRow, orderDatedRow } from './datedRowOrder.server';
import { documentFieldPath, documentFieldValue, isLongTextDocumentField, isSermonPlanMode } from './documentFieldAction';
import { metadataAfterDocumentFields, orderDocumentFields, DOCUMENT_TITLE_HISTORY, GROUP_STATUS_HISTORY, DOCUMENT_METADATA_HISTORY, SERMON_CHURCH_HISTORY, SERMON_GOAL_TYPE_HISTORY, SERMON_PLAN_MODE_HISTORY, SERMON_VERSE_HISTORY, STUDY_NOTE_TYPE_HISTORY, COMMENT_KIND_HISTORY } from './documentFieldOrder.server';
import { DOCUMENT_TAG_HISTORY, documentTagCollection, tagField, tagMembership, type DocumentTagHistoryPage } from './documentTagMembership';
import { metadataAfterDocumentTags, orderDocumentTags } from './documentTagOrder.server';
import { exegeticalPointConflictId } from './exegeticalPointAction';
import { EXEGETICAL_POINT_HISTORY, metadataAfterExegeticalPoints, orderExegeticalPoints, retainedExegeticalPointHistory } from './exegeticalPointOrder.server';
import { equalValues, object, readField } from './fieldValues';
import { GROUP_BLOCK_STATUS_POLICY } from './groupBlockStatusAction';
import { groupFirstMeetingComparison } from './groupFirstMeeting';
import { adoptLegacyFirstGroupMeeting, firstGroupMeetingLegacyMetadata, prepareFirstGroupMeetingOrder, rawFirstGroupMeetingOpening } from './groupFirstMeetingOrder.server';
import { GROUP_BLOCK_CONTENT_POLICY, GROUP_BLOCK_TITLE_POLICY, GROUP_STEP_NOTES_POLICY, GROUP_STEP_TITLE_POLICY, type GroupFlowHistoryPage } from './groupFlowTitleAction';
import { metadataAfterGroupFlowTopology } from './groupFlowTopology.server';
import { GROUP_MEETING_FIELD_POLICY, type GroupMeetingFieldHistoryPage } from './groupMeetingFieldAction';
import { GROUP_MEETING_FIELD_HISTORY, metadataAfterGroupMeetingFields, orderGroupMeetingFields } from './groupMeetingFieldOrder.server';
import { alignGroupStepDurationRepresentation, GROUP_STEP_DURATION_POLICY } from './groupStepDurationAction';
import { GROUP_STEP_PLACEMENT_HISTORY, metadataAfterGroupStepPlacement } from './groupStepPlacement.server';
import { retainedHomileticMoveHistory } from './homileticPlacement.server';
import { homileticComparisonList, homileticHistoryCollection, homileticLists, homileticTitlePolicy, HOMILETIC_POSITION_PROJECTION, HOMILETIC_POSITION_REVIEW, type HomileticHistoryChange, type HomileticHistoryPage, type HomileticList } from './homileticPlan';
import { boundHomileticMetadata, homileticTitleSnapshot, metadataAfterHomileticPlans, orderHomileticPlans } from './homileticPlanOrder.server';
import { metadataAfterOutlineMoves } from './outlineMoveProof.server';
import { hasOutlineParentChoice } from './outlineParentChoice';
import { metadataAfterOutlinePointPlacement, OUTLINE_POINT_PLACEMENT_HISTORY, type OutlinePointPlacementWrite } from './outlinePointPlacement.server';
import { OUTLINE_SUBPOINT_REVIEW } from './outlineSubpointMove';
import { metadataAfterOutlineSubpointOrder, orderOutlineSubpoints } from './outlineSubpointOrder.server';
import { OUTLINE_TITLE_HISTORY, OUTLINE_TITLE_QUEUED, OUTLINE_TITLE_REVIEW, OUTLINE_TITLE_SETTLED, outlineTitlePolicy, type OutlineTitleCollection, type OutlineTitleHistoryPage } from './outlineTitleAction';
import { boundOutlineTitleMetadata, orderOutlineTitles, outlineTitleProofPolicy } from './outlineTitleOrder.server';
import { expandPreachDateNotes, PREACH_DATE_DETAIL_QUEUED, PREACH_DATE_DETAIL_SETTLED, PREACH_DATE_FIELD_POLICY, PREACH_DATE_NOTE_QUEUED, PREACH_DATE_NOTE_SETTLED, preachDateFieldTarget, preachDateNoteConflictId, type PreachDateField, type PreachDateFieldHistoryPage, type PreachDateFieldValue } from './preachDateFieldAction';
import { alignPreachStatusCommand, PREACH_STATUS_POLICY, type PreachStatusHistoryPage, type PreachStatusValue } from './preachStatusAction';
import { mergeFields, advanceResourceSnapshot, commandFingerprint, getResourcePolicy, isValidIdentifier, TOMBSTONE_OWNER_FIELD, validateCommand } from './protocol';
import { validateResourceDocument } from './resourceSchemas';
import { metadataAfterRowDetails, orderRowDetails, type RowDetailOrder } from './rowDetailOrder.server';
import { existingRowField, rowConflictPath, rowConflictValue } from './rowFieldAction';
import { orderRowText } from './rowTextOrder.server';
import { metadataAfterSeriesItemPlacement, SERIES_ITEM_PLACEMENT_HISTORY } from './seriesItemPlacement.server';
import { SERIES_MEMBERSHIP_DELETION, SERIES_MEMBERSHIP_HISTORY, SERIES_MEMBERSHIP_ORDER, seriesLocation, type SeriesMembershipWrite } from './seriesMembershipOrder.server';
import { compareReturnedSermonText, metadataAfterSermonText } from './sermonTextOrder.server';
import { assembleChangePage, collectionHeadId, HEADS_COLLECTION, parseChangePointer, planFeedWrites, readHeadVersion, sequenceId } from './serverFeed';
import { planDataCommand, tagNameIsTaken, type RelationReader } from './serverRelations';
import { metadataAfterServiceOrderPlacement, SERVICE_ORDER_PLACEMENT_HISTORY, type ServiceOrderPlacementWrite } from './serviceOrderPlacement.server';
import { alignServiceOrderFlagRepresentation, SERVICE_ORDER_FLAG_POLICY, SERVICE_ORDER_STEP_BODY_POLICY, SERVICE_ORDER_STEP_SCRIPTURE_POLICY, SERVICE_ORDER_STEP_TITLE_POLICY, type ServiceOrderFlagHistoryPage, type ServiceOrderStepTitleHistoryPage } from './serviceOrderStepAction';
import { metadataAfterServiceOrderStepPlacement, SERVICE_ORDER_STEP_PLACEMENT_HISTORY, type ServiceOrderStepPlacementWrite } from './serviceOrderStepPlacement.server';
import { orderServiceStepScripture } from './serviceOrderStepScripture.server';
import { coversCommittedEffect } from './snapshotFreshness';
import { metadataAfterSourceNoteLinks, orderSourceNoteLinks, retainedSourceNoteLinkHistory, SOURCE_NOTE_LINK_HISTORY, type SourceNoteLinkHistoryEntry } from './sourceNoteLinkOrder.server';
import { hasStudyNoteReferenceReview, isOrdinaryReferenceDocument, studyNoteReferencesPath, validStudyNoteReferenceAliases } from './studyNoteReferenceMerge';
import { metadataAfterStudyNoteReferences, planStudyNoteReferenceOrder, retainedStudyNoteReferenceHistory,
  readSplitStudyNoteReferenceHistory, REFERENCE_HISTORY_PARTS, splitLargeStudyNoteReferenceHistory,
  STUDY_NOTE_REFERENCE_HISTORY, type StudyNoteReferenceHistoryEntry } from './studyNoteReferenceOrder.server';
import { readTagCleanup, resumeTagCleanup, TAG_CLEANUP_PENDING, type TagCleanupProgress } from './tagCleanup.server';
import { compactTagConflict, expandTagConflict, isIndexedTagConflict, isSplitTagConflict, readTagConflictParts, splitTagConflictJson, tagReceiptDigest, validTagReceiptPartCount, type IndexedTagConflict, type SplitTagConflict } from './tagConflictReceipt.server';
import { alignThoughtLockRepresentation, THOUGHT_LOCK_POLICY, type ThoughtLockHistoryPage } from './thoughtLockAction';
import { isThoughtPlacementPart, THOUGHT_PLACEMENT_POLICY, thoughtPlacementConflictId, type ThoughtPlacementHistoryPage } from './thoughtPlacementAction';
import { orderThoughtPlacement } from './thoughtPlacementOrder.server';
import { THOUGHT_TAG_BIRTH, THOUGHT_TAG_HISTORY, thoughtTagTarget, type ThoughtTagHistoryPage } from './thoughtTagAction';
import { metadataAfterThoughtTags, orderThoughtTags } from './thoughtTagOrder.server';
import { THOUGHT_TEXT_POLICY } from './thoughtTextAction';

import type { AccountPreferenceHistoryPage } from './accountPreference';
import type { AudioExportKey, AudioExportRecord, AudioExportStore, AudioExportTransaction, AudioExportUsage } from './audioExportStore';
import type { BibleMarkHistoryEntry, BibleMarkHistoryPage } from './bibleMarkStroke';
import type { CommentKindHistoryPage } from './commentKindAction';
import type { CouncilMetadataHistoryPage } from './councilFieldAction';
import type { DisplacedRowDate, MeetingDateHistoryPage, PreachDateHistoryPage } from './datedRowAction';
import type { GroupStatusHistoryPage, GroupTitleHistoryPage, DocumentTitleHistoryEntry, PlanTemplateNameHistoryPage, SermonChurchHistoryPage, SermonGoalTypeHistoryPage, SermonPlanModeHistoryPage, SermonPreparationConfirmationHistoryPage, PrayerTitleHistoryPage, SermonTitleHistoryPage, SermonVerseHistoryPage, ServiceOrderTitleHistoryPage, StudyNoteTitleHistoryPage, StudyNoteTypeHistoryPage, TagColorHistoryPage } from './documentFieldAction';
import type { ExegeticalPointHistoryPage } from './exegeticalPointAction';
import type { PrayerStatusHistoryPage } from './prayerStatusAction';
import type { RowDetailPolicy } from './rowDetailAction';
import type { RowValue } from './rowFieldAction';
import type { SeriesMetadataHistoryPage } from './seriesFieldAction';
import type { SeriesMembershipHistoryEntry, SeriesMembershipHistoryPage } from './seriesMembershipHistory';
import type { FeedWrite } from './serverFeed';
import type { StepPlacementWrite } from './stepPlacement.server';
import type { OutlinePointPlacementHistoryPage } from './types';
import type { CouncilTopicPlacementHistoryPage, GroupFlowStepPlacementHistoryPage, SeriesItemPlacementHistoryPage, ServiceOrderPlacementHistoryPage, CollectionChanges, CollectionPage, CommandReceipt, CommandResult, ConflictDetail, DataCommand, DocumentData, EngineMetadata, EngineReadOptions, Json, ResourceRef, ResourceSnapshot } from './types';
import type { AiResultReceiptStore, ReceiptRecord } from '@/services/aiResultReceipt.server';
import type { DocumentReference, Firestore, Transaction } from 'firebase-admin/firestore';

export function readActionClockChallenge(collection: string, headers: Headers, document = false): string | undefined {
  const enabled = document ? readsDocumentActionClock(collection) : usesActionClock(collection);
  if (!enabled) return undefined;
  const challenge = headers.get(ACTION_CLOCK_HEADER);
  return isClockChallenge(challenge) ? challenge : undefined;
}

export { MAX_COMMAND_BYTES } from './commandSize';
const MAX_RECEIPT_BYTES = 1_000_000;
const MAX_EXACT_RECEIPT_PARTS = 20;
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
      || (data.shareRevocation !== undefined && !isValidIdentifier(data.shareRevocation))
      || (data.studyNoteReferenceAliases !== undefined && !validStudyNoteReferenceAliases(data.studyNoteReferenceAliases, isValidIdentifier))) {
    throw new DataEngineServerError('unsupported-protocol', 409);
  }
  return { protocol: 1, generation: data.generation, revision: data.revision!, deleted: data.deleted,
    ...(data.operationId ? { operationId: data.operationId } : {}),
    ...(data.shareRevocation ? { shareRevocation: data.shareRevocation } : {}),
    ...(data.studyNoteReferenceAliases?.length ? { studyNoteReferenceAliases: data.studyNoteReferenceAliases } : {}) };
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

const tagCleanupPending = () => new DataEngineServerError(TAG_CLEANUP_PENDING, 503);

async function saveTagCleanupProgress(reference: DocumentReference, owner: string, commandHash: string,
  expected: TagCleanupProgress, next: TagCleanupProgress): Promise<TagCleanupProgress> {
  return adminDb.runTransaction(async transaction => {
    const stored = (await transaction.get(reference)).data();
    const current = readTagCleanup(stored, expected.name);
    if (!current || !stored || stored.owner !== owner || stored.commandHash !== commandHash) throw tagCleanupPending();
    if (current.completed || current.after !== expected.after) return current;
    transaction.set(reference, { ...stored, tagCleanup: next });
    return next;
  });
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
type ExactConflict = Extract<CommandResult, { kind: 'conflict' }>;
type SplitExactConflict = Pick<ExactConflict, 'kind' | 'operationId'> & {
  exactReceiptParts: number;
  exactReceiptDigest: string;
};
type ConflictManifest = SplitTagConflict | SplitExactConflict;
type StoredReceipt = Omit<CommandReceipt, 'result'> & {
  result: CommandResult | CompactAcknowledgement | IndexedTagConflict | ConflictManifest;
};
const isSplitExactConflict = (result: object): result is SplitExactConflict => 'exactReceiptParts' in result;
const comparesAuthoredList = (conflicts: readonly ConflictDetail[]) =>
  hasStudyNoteReferenceReview(conflicts) || conflicts.some(({ path, code }) => isAuthoredListComparison(code) || homileticComparisonList({ code, path }) !== undefined || equalValues(path, repeatedWordsPath));
function preservesExactConflict(result: ExactConflict, command: DataCommand): boolean {
  return comparesAuthoredList(result.conflicts)
    || (command.resource.collection === 'sermons' && result.conflicts.some(({ path }) => preachDateNoteConflictId(path) !== undefined))
    || (command.resource.collection === 'councils' && result.conflicts.some(({ path }) => councilTopicTextConflict(path) !== undefined))
    || (command.kind === 'update' && command.resource.collection === 'studyNotes'
      && isOrdinaryReferenceDocument(result.snapshot.value) && command.changes.some(change => equalValues(change.path, studyNoteReferencesPath)));
}
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
  const parsed = 'receiptVersion' in result ? readCompactAcknowledgement(result as Record<string, unknown>) : result as CommandResult | IndexedTagConflict | ConflictManifest;
  return { owner: raw.owner as string, operationId: raw.operationId as string, commandHash: raw.commandHash as string, result: parsed };
}

function metadataEffect(metadata: EngineMetadata): EngineMetadata {
  const { studyNoteReferenceAliases: _aliases, ...effect } = metadata;
  return effect;
}

/** ACK history retains proof of effect, never another full document per autosave. */
function serializeReceipt(receipt: StoredReceipt) {
  const result = receipt.result;
  const stored = result.kind === 'acknowledged' && !compact(result)
    ? { receiptVersion: 2, kind: result.kind, operationId: result.operationId, resource: result.snapshot.resource,
      committed: metadataEffect(result.committed ?? result.snapshot.metadata!),
      ...(result.affected ? { affected: result.affected.map(effect => ({ ...effect, metadata: metadataEffect(effect.metadata) })) } : {}) }
    : result;
  // Exact conflict payloads remain JSON strings to avoid nested map depth amplification.
  return { owner: receipt.owner, operationId: receipt.operationId, commandHash: receipt.commandHash, resultJson: JSON.stringify(stored) };
}

function prepareReceipt(owner: string, command: DataCommand, commandHash: string, result: CommandResult) {
  const identity = { owner, operationId: command.operationId, commandHash };
  const fits = (value: ReturnType<typeof serializeReceipt>) =>
    Object.values(value).reduce((bytes, field) => bytes + Buffer.byteLength(field), 0) <= MAX_RECEIPT_BYTES;
  const ordinary = serializeReceipt({ ...identity, result });
  if (fits(ordinary)) return { result, stored: ordinary };
  // Keep the exact snapshot and choices. A tag reference avoids a second copy of its name.
  const compacted = result.kind === 'conflict' ? compactTagConflict(result, command) : undefined;
  if (compacted) {
    const stored = serializeReceipt({ ...identity, result: compacted });
    if (fits(stored)) return { result, stored };
    const parts = splitTagConflictJson(stored.resultJson);
    if (parts) return { result, parts: { collection: '_tagParts', values: parts }, stored: serializeReceipt({ ...identity,
      result: { kind: 'conflict', operationId: command.operationId, tagReceiptParts: parts.length, tagReceiptDigest: tagReceiptDigest(stored.resultJson) },
    }) };
  }
  if (result.kind === 'conflict' && preservesExactConflict(result, command)) {
    const parts = splitConflictJson(ordinary.resultJson, MAX_EXACT_RECEIPT_PARTS);
    if (parts) return { result, parts: { collection: '_conflictParts', values: parts }, stored: serializeReceipt({ ...identity,
      result: { kind: 'conflict', operationId: command.operationId, exactReceiptParts: parts.length,
        exactReceiptDigest: conflictReceiptDigest(ordinary.resultJson) },
    }) };
  }
  const refusal: CommandResult = { kind: 'refused', operationId: command.operationId, code: 'receipt-too-large' };
  return { result: refusal, stored: serializeReceipt({ ...identity, result: refusal }) };
}

const receiptPartRef = (receipt: DocumentReference, collection: string, index: number) =>
  receipt.collection(collection).doc(String(index));

async function readReceiptParts(transaction: Transaction, receipt: DocumentReference, manifest: ConflictManifest,
  command: DataCommand): Promise<ExactConflict | IndexedTagConflict> {
  const readParts = async (collection: string, count: number) => {
    const parts = await Promise.all(Array.from({ length: count }, (_, index) =>
      transaction.get(receiptPartRef(receipt, collection, index))));
    return parts.map(part => part.data()?.json);
  };
  if (isSplitTagConflict(manifest)) {
    if (validTagReceiptPartCount(manifest.tagReceiptParts)) {
      const result = readTagConflictParts(await readParts('_tagParts', manifest.tagReceiptParts), manifest);
      if (result) return result;
    }
  } else if (validConflictPartCount(manifest.exactReceiptParts, MAX_EXACT_RECEIPT_PARTS)) {
    const result = readConflictJsonParts(await readParts('_conflictParts', manifest.exactReceiptParts),
      manifest.exactReceiptParts, manifest.exactReceiptDigest) as ExactConflict | undefined;
    if (object(result) && result.kind === 'conflict' && result.operationId === command.operationId
      && equalValues(result.snapshot?.resource, command.resource)
      && Array.isArray(result.conflicts) && preservesExactConflict(result, command)) return result;
  }
  throw new DataEngineServerError(INVALID_RECEIPT, 409);
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

async function previousCommandResult(previous: StoredReceipt | undefined, command: DataCommand, commandHash: string,
  raw: Record<string, unknown> | undefined, readParts: (manifest: ConflictManifest) => Promise<ExactConflict | IndexedTagConflict>): Promise<CommandResult | undefined> {
  if (!owns(command.owner, command.resource, raw)) {
    if (previous && compact(previous.result)) throw unavailableReceiptSnapshot();
    return { kind: 'refused', operationId: command.operationId, code: PERMISSION_DENIED };
  }
  if (!previous) return undefined;
  if (previous.owner !== command.owner || previous.operationId !== command.operationId || previous.commandHash !== commandHash) {
    return { kind: 'refused', operationId: command.operationId, code: 'operation-id-reused' };
  }
  if (compact(previous.result)) return replayAcknowledgement(previous.result, command.resource, raw);
  const stored = isSplitTagConflict(previous.result) || isSplitExactConflict(previous.result)
    ? await readParts(previous.result) : previous.result;
  if (isIndexedTagConflict(stored)) {
    const result = expandTagConflict(stored, command);
    if (!result) throw new DataEngineServerError(INVALID_RECEIPT, 409);
    return result;
  }
  return stored.kind === 'blocked' ? undefined : stored;
}

async function prepareFeedWrites(transaction: Transaction, owner: string, operationId: string, effects: ResourceSnapshot[],
  cachedSeriesHead?: Promise<DocumentData | undefined>): Promise<FeedWrite[]> {
  const collections = [...new Set(effects.map(effect => effect.resource.collection))];
  const heads = await Promise.all(collections.map(async collection => {
    if (collection === 'series' && cachedSeriesHead) return [collection, await cachedSeriesHead] as const;
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

const HISTORY_CHUNK_TARGET_BYTES = 768 * 1024;

function persistChunkedHistory<Entry>(transaction: Transaction, snapshot: ResourceSnapshot, operationId: string,
  collection: string, field: 'tags' | 'fields' | 'entries', entries: readonly Entry[],
  chunkId: (index: number) => string = index => index === 0 ? operationId : JSON.stringify([operationId, index])) {
  const { resource, metadata } = snapshot;
  const generation = metadata!.generation;
  const history = adminDb.collection(resource.collection).doc(resource.id).collection(collection);
  let chunk: Entry[] = [], index = 0, bytes = 0;
  const flush = () => {
    if (!chunk.length) return;
    const id = historyEntryId(snapshot, chunkId(index));
    transaction.set(history.doc(id), { generation, [field]: chunk });
    chunk = [];
    index++;
    bytes = 0;
  };
  for (const entry of entries) {
    const size = Buffer.byteLength(JSON.stringify(entry)) + 1;
    if (bytes + size > HISTORY_CHUNK_TARGET_BYTES) flush();
    chunk.push(entry);
    bytes += size;
  }
  flush();
}

function retainUncertainChronology(plan: Awaited<ReturnType<typeof planDataCommand>>, command: DataCommand, current: ResourceSnapshot,
  uncertain: readonly ConflictDetail[]): Awaited<ReturnType<typeof planDataCommand>> {
  if (!uncertain.length || (plan.result.kind !== 'acknowledged' && plan.result.kind !== 'conflict')) return plan;
  const conflicts = new Map(uncertain.map(item => [JSON.stringify(item.path), item]));
  if (plan.result.kind === 'conflict') {
    const contains = (parent: ConflictDetail, child: ConflictDetail) =>
      parent.path.length < child.path.length && parent.path.every((part, index) => child.path[index] === part);
    for (const item of plan.result.conflicts) {
      if (uncertain.some(parent => {
        const id = thoughtPlacementConflictId(parent.path);
        return (parent.code !== HOMILETIC_POSITION_REVIEW && parent.code !== HOMILETIC_POSITION_PROJECTION && contains(parent, item)) || (id !== undefined && isThoughtPlacementPart(item.path, id));
      })) continue;
      for (const child of uncertain) {
        if (!contains(item, child)) continue;
        const outlineTitle = child.code === OUTLINE_TITLE_REVIEW || child.code === OUTLINE_TITLE_SETTLED || child.code === OUTLINE_TITLE_QUEUED;
        if (!outlineTitle || !hasOutlineParentChoice(current.resource.collection, [item])) conflicts.delete(JSON.stringify(child.path));
      }
      const path = JSON.stringify(item.path);
      const existing = conflicts.get(path);
      if (!existing || (!isAuthoredListComparison(existing.code) && existing.code !== OUTLINE_SUBPOINT_REVIEW && existing.code !== OUTLINE_TITLE_REVIEW && existing.code !== OUTLINE_TITLE_SETTLED && existing.code !== OUTLINE_TITLE_QUEUED
        && existing.code !== COUNCIL_TOPIC_TEXT_SETTLED && existing.code !== COUNCIL_TOPIC_TEXT_QUEUED && !homileticComparisonList(existing))) conflicts.set(path, item);
    }
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

function persistDatedRowHistory(transaction: Transaction, command: DataCommand, snapshot: ResourceSnapshot,
  order?: ReturnType<typeof orderDatedRow>): void {
  const displaced = order?.displaced, target = order?.target;
  if (!displaced || !target || existingRowDate(snapshot.value?.[target.field], displaced.rowId, target) !== displaced.winnerDate) return;
  const history = adminDb.collection(command.resource.collection).doc(command.resource.id).collection(target.history);
  transaction.set(history.doc(historyEntryId(snapshot, command.operationId)), { ...displaced, acceptedAt: new Date().toISOString() });
}

function retainedRowDetailHistory<Field extends string, Value extends RowValue>(snapshot: ResourceSnapshot,
  policy: RowDetailPolicy<Field, Value>, order?: RowDetailOrder<Field, Value>) {
  const rows = snapshot.value?.[policy.birth.field];
  return order?.displaced.filter(entry =>
    equalValues(existingRowField(rows, entry.rowId, policy.target(entry.field)), entry.winnerValue)
    && existingRowField(rows, entry.rowId, policy.birth) === entry.rowCreatedAt
    && (entry.scope === undefined || equalValues(entry.scope, policy.scopes?.(rows, entry.field)?.get(entry.rowId)))) ?? [];
}

function orderedPreachDateFieldComparisons(command: DataCommand, order: RowDetailOrder<PreachDateField, PreachDateFieldValue>): ConflictDetail[] {
  if (command.kind !== 'update') return [];
  const notes = expandPreachDateNotes(command);
  return order.displaced.flatMap(({ field, rowId, value, winnerValue }) => {
    const action = field === 'notes' ? notes : command.preachDateFieldActions?.[field];
    if (action?.rowId !== rowId) return [];
    const settled = equalValues(value, action.after);
    return [{ path: rowConflictPath(rowId, preachDateFieldTarget(field)),
      code: field === 'notes' ? (settled ? PREACH_DATE_NOTE_SETTLED : PREACH_DATE_NOTE_QUEUED)
        : (settled ? PREACH_DATE_DETAIL_SETTLED : PREACH_DATE_DETAIL_QUEUED),
      base: rowConflictValue(action.before), mine: rowConflictValue(action.after), theirs: rowConflictValue(settled ? winnerValue : value) }];
  });
}

function persistRowDetailHistory<Field extends string, Value extends RowValue>(transaction: Transaction, command: DataCommand,
  snapshot: ResourceSnapshot, policy: RowDetailPolicy<Field, Value>, order?: RowDetailOrder<Field, Value>) {
  const fields = retainedRowDetailHistory(snapshot, policy, order);
  if (!fields.length || !snapshot.metadata) return;
  const history = adminDb.collection(command.resource.collection).doc(command.resource.id).collection(policy.history);
  transaction.set(history.doc(historyEntryId(snapshot, command.operationId)), {
    generation: snapshot.metadata.generation, fields: fields.map(entry => {
      // Date note history needs the recoverable text only. The current text already lives on the sermon.
      if (policy.history !== PREACH_DATE_FIELD_POLICY.history || entry.field !== 'notes') return entry;
      const { winnerValue: _winner, ...earlier } = entry;
      return earlier;
    }), acceptedAt: new Date().toISOString(),
  });
}

function persistRowTextHistory<Field extends string, Value extends string | null>(transaction: Transaction, command: DataCommand,
  snapshot: ResourceSnapshot, policy: RowDetailPolicy<Field, Value>, order?: RowDetailOrder<Field, Value>) {
  const fields = retainedRowDetailHistory(snapshot, policy, order);
  if (!fields.length || !snapshot.metadata) return;
  const acceptedAt = new Date().toISOString();
  const entries = fields.map(({ winnerValue, ...field }) => ({ ...field, acceptedAt,
    winnerDigest: createHash('sha256').update(commandFingerprint(winnerValue)).digest('base64url') }));
  persistChunkedHistory(transaction, snapshot, command.operationId, policy.history, 'fields', entries);
}

function persistStudyNoteReferenceHistory(transaction: Transaction, command: DataCommand, snapshot: ResourceSnapshot,
  plan: ReturnType<typeof planStudyNoteReferenceOrder>, comparison = false) {
  const entries = retainedStudyNoteReferenceHistory(snapshot, plan, comparison);
  if (!entries.length || !snapshot.metadata) return;
  const inline: StudyNoteReferenceHistoryEntry[] = [];
  const history = adminDb.collection(snapshot.resource.collection).doc(snapshot.resource.id).collection(STUDY_NOTE_REFERENCE_HISTORY);
  const generation = snapshot.metadata.generation;
  const key = (kind: 'inline' | 'split', index: number) => JSON.stringify([command.operationId, kind, index]);
  for (const [index, entry] of entries.entries()) {
    const split = splitLargeStudyNoteReferenceHistory(entry);
    if (!split) {
      inline.push(entry);
      continue;
    }
    const document = history.doc(historyEntryId(snapshot, key('split', index)));
    transaction.set(document, { generation, parts: split.parts.length, digest: split.digest });
    split.parts.forEach((json, part) => transaction.set(document.collection(REFERENCE_HISTORY_PARTS).doc(String(part)), { json }));
  }
  persistChunkedHistory(transaction, snapshot, command.operationId, STUDY_NOTE_REFERENCE_HISTORY, 'entries', inline,
    index => key('inline', index));
}

function persistHomileticHistory(transaction: Transaction, command: DataCommand, snapshot: ResourceSnapshot,
  order: ReturnType<typeof orderHomileticPlans> | undefined, comparison = false) {
  if (!order || !snapshot.metadata) return;
  for (const list of homileticLists) {
    const frame = homileticTitleSnapshot(snapshot, list);
    const titleOrder = order.titles.get(list);
    const storedTitles = new Set(retainedRowDetailHistory(frame, homileticTitlePolicy(list), titleOrder));
    const moves = order.moves.get(list)?.writes ?? [];
    const storedMoves = new Set(retainedHomileticMoveHistory(frame, list, moves));
    const changes: HomileticHistoryChange[] = [];
    for (const entry of comparison ? titleOrder?.displaced ?? [] : storedTitles) {
      const { rowId, value: earlier, winnerValue: kept } = entry;
      changes.push({ kind: 'title', rowId, earlier, kept, ...(!storedTitles.has(entry) && { origin: 'comparison' }) });
    }
    for (const entry of comparison ? moves.flatMap(move => move.displaced ?? []) : storedMoves) {
      const { stepId, stepTitle, earlier, kept } = entry;
      changes.push({ kind: 'position', rowId: stepId, ...(stepTitle !== undefined && { title: stepTitle }), earlier, kept,
        ...(!storedMoves.has(entry) && { origin: 'comparison' }) });
    }
    if (changes.length) {
      const history = adminDb.collection(command.resource.collection).doc(command.resource.id).collection(homileticHistoryCollection(list));
      transaction.set(history.doc(historyEntryId(snapshot, command.operationId)), {
        generation: snapshot.metadata.generation, acceptedAt: new Date().toISOString(), changes,
      });
    }
  }
}

function seriesMembershipHeadRef(member: ResourceRef): DocumentReference {
  return adminDb.collection(member.collection).doc(member.id).collection(SERIES_MEMBERSHIP_ORDER).doc('head');
}

function acceptedSeriesCatalogVersion(feedWrites: readonly FeedWrite[]): number | undefined {
  const version = feedWrites.find(write => write.path.length === 2 && write.value.collection === 'series')?.value.version;
  return typeof version === 'number' ? version : undefined;
}

function persistSeriesMembershipWrites(transaction: Transaction, owner: string, operationId: string,
  writes: readonly SeriesMembershipWrite[], effects: readonly ResourceSnapshot[], feedWrites: readonly FeedWrite[]) {
  const acceptedSeries = new Map(effects.filter(snapshot => snapshot.resource.collection === 'series')
    .map(snapshot => [snapshot.resource.id, seriesLocation(snapshot)]));
  const catalogVersion = acceptedSeriesCatalogVersion(feedWrites);
  const acceptedAt = Date.now();
  const historyId = `${String(Number.MAX_SAFE_INTEGER - acceptedAt).padStart(16, '0')}-${createHash('sha256').update(operationId).digest('hex')}`;
  for (const { member, head, displaced } of writes) {
    if (head) {
      const location = head.location && (acceptedSeries.get(head.location.id) ?? head.location);
      transaction.set(seriesMembershipHeadRef(member), { ...head, location, ...(typeof catalogVersion === 'number' && { catalogVersion }) });
    }
    if (displaced) {
      const former = displaced.former?.generation === null ? acceptedSeries.get(displaced.former.id) ?? displaced.former : displaced.former;
      const current = displaced.current && (acceptedSeries.get(displaced.current.id) ?? displaced.current);
      transaction.set(adminDb.collection(member.collection).doc(member.id).collection(SERIES_MEMBERSHIP_HISTORY).doc(historyId),
        { ...displaced, former, current, owner, acceptedAt: new Date(acceptedAt).toISOString() });
    }
  }
}

function orderGroupFlowFields(command: DataCommand, current: ResourceSnapshot, metadata: unknown, serverMs: number) {
  const block = orderRowDetails(command, current, metadata, serverMs, GROUP_BLOCK_TITLE_POLICY);
  const step = orderRowDetails(block.command, current, metadata, serverMs, GROUP_STEP_TITLE_POLICY);
  const blockStatus = orderRowDetails(step.command, current, metadata, serverMs, GROUP_BLOCK_STATUS_POLICY);
  const duration = orderRowDetails(blockStatus.command, current, metadata, serverMs, GROUP_STEP_DURATION_POLICY);
  const content = orderRowText(alignGroupStepDurationRepresentation(duration.command, current), current, metadata, serverMs, GROUP_BLOCK_CONTENT_POLICY);
  const notes = orderRowText(content.command, current, metadata, serverMs, GROUP_STEP_NOTES_POLICY);
  return { block, step, blockStatus, duration, content, notes };
}

async function persistAcceptedCommand(transaction: Transaction, { owner, command, snapshot: primarySnapshot, effects, rawDocuments, listOrder, dateOrder, meetingOrder, groupFlowOrder, preachingOrder, statusOrder, serviceFlagOrder, serviceStepTitleOrder, serviceStepBodyOrder, serviceStepScriptureOrder, councilTopicTitleOrder, councilTopicSummaryOrder, councilTopicTextOrder, councilAssemblyOrder, councilTopicKindOrder, councilOutcomeOrder, thoughtTextOrder, thoughtLockOrder, thoughtPlacementOrder, markOrder, fieldOrder, exegeticalOrder, homileticOrder, outlineTitleOrder, thoughtTagOrder, documentTagOrder, sourceNoteOrder, studyNoteReferenceOrder, analysisFrameOrder, serviceOrderPlacement, serviceOrderStepPlacement, groupFlowStepPlacement, councilTopicPlacement, outlinePointPlacement, outlineSubpointOrder, seriesItemPlacement, seriesMembershipWrites, cachedSeriesHead }: {
  owner: string;
  command: DataCommand;
  snapshot: ResourceSnapshot;
  effects: ResourceSnapshot[];
  rawDocuments: ReadonlyMap<string, Record<string, unknown> | undefined>;
  listOrder?: ReturnType<typeof orderAuthoredListAdditions>;
  dateOrder?: ReturnType<typeof orderDatedRow>;
  meetingOrder?: ReturnType<typeof orderGroupMeetingFields>;
  groupFlowOrder?: ReturnType<typeof orderGroupFlowFields>;
  preachingOrder?: RowDetailOrder<PreachDateField, PreachDateFieldValue>;
  statusOrder?: RowDetailOrder<'status', PreachStatusValue>;
  serviceFlagOrder?: RowDetailOrder<'flagged', boolean>;
  serviceStepTitleOrder?: RowDetailOrder<'title', string>;
  serviceStepBodyOrder?: RowDetailOrder<'body', string>;
  serviceStepScriptureOrder?: ReturnType<typeof orderServiceStepScripture>;
  councilTopicTitleOrder?: RowDetailOrder<'title', string>;
  councilTopicSummaryOrder?: RowDetailOrder<'summary', string | null>;
  councilTopicTextOrder?: ReturnType<typeof orderCouncilTopicText>;
  councilAssemblyOrder?: RowDetailOrder<'forAssembly', boolean>;
  councilTopicKindOrder?: RowDetailOrder<'kind', CouncilTopicKind>;
  councilOutcomeOrder?: ReturnType<typeof orderCouncilOutcome>;
  thoughtTextOrder?: RowDetailOrder<'text', string>;
  thoughtLockOrder?: RowDetailOrder<'isLocked', boolean>;
  thoughtPlacementOrder?: ReturnType<typeof orderThoughtPlacement>;
  markOrder?: ReturnType<typeof orderBibleMarks>;
  fieldOrder?: ReturnType<typeof orderDocumentFields>;
  exegeticalOrder?: ReturnType<typeof orderExegeticalPoints>;
  homileticOrder?: ReturnType<typeof orderHomileticPlans>;
  outlineTitleOrder?: ReturnType<typeof orderOutlineTitles>;
  thoughtTagOrder?: ReturnType<typeof orderThoughtTags>;
  documentTagOrder?: ReturnType<typeof orderDocumentTags>;
  sourceNoteOrder?: ReturnType<typeof orderSourceNoteLinks>;
  studyNoteReferenceOrder?: ReturnType<typeof planStudyNoteReferenceOrder>;
  analysisFrameOrder?: ReturnType<typeof orderAnalysisFrame>;
  serviceOrderPlacement?: ServiceOrderPlacementWrite;
  serviceOrderStepPlacement?: ServiceOrderStepPlacementWrite;
  groupFlowStepPlacement?: StepPlacementWrite;
  councilTopicPlacement?: StepPlacementWrite;
  outlinePointPlacement?: OutlinePointPlacementWrite;
  outlineSubpointOrder?: ReturnType<typeof orderOutlineSubpoints>;
  seriesItemPlacement?: StepPlacementWrite[];
  seriesMembershipWrites: readonly SeriesMembershipWrite[];
  cachedSeriesHead?: Promise<DocumentData | undefined>;
}) {
  const feedWrites = await prepareFeedWrites(transaction, owner, command.operationId, effects, cachedSeriesHead);
  const primaryKey = resourceKey(command.resource);
  for (const snapshot of effects) {
    const key = resourceKey(snapshot.resource);
    const raw = rawDocuments.get(key);
    const value = snapshot.value === null
      ? { [TOMBSTONE_OWNER_FIELD]: owner }
      : preserveStoredTypes(raw, snapshot.value) as Record<string, unknown>;
    const primary = key === primaryKey;
    const meetingOpening = primary ? rawFirstGroupMeetingOpening(command, snapshot, raw) : raw;
    const dated = metadataAfterDatedRow(snapshot, meetingOpening, primary ? command : undefined, primary ? dateOrder : undefined);
    const meeting = metadataAfterGroupMeetingFields({ ...snapshot, metadata: dated }, meetingOpening, primary ? meetingOrder : undefined);
    const blockTitle = metadataAfterRowDetails({ ...snapshot, metadata: meeting }, raw, GROUP_BLOCK_TITLE_POLICY, primary ? groupFlowOrder?.block : undefined);
    const groupStepTitle = metadataAfterRowDetails({ ...snapshot, metadata: blockTitle }, raw, GROUP_STEP_TITLE_POLICY, primary ? groupFlowOrder?.step : undefined);
    const groupBlockStatus = metadataAfterRowDetails({ ...snapshot, metadata: groupStepTitle }, raw, GROUP_BLOCK_STATUS_POLICY, primary ? groupFlowOrder?.blockStatus : undefined);
    const groupStepDuration = metadataAfterRowDetails({ ...snapshot, metadata: groupBlockStatus }, raw, GROUP_STEP_DURATION_POLICY, primary ? groupFlowOrder?.duration : undefined);
    const groupBlockContent = metadataAfterRowDetails({ ...snapshot, metadata: groupStepDuration }, raw, GROUP_BLOCK_CONTENT_POLICY, primary ? groupFlowOrder?.content : undefined);
    const groupStepNotes = metadataAfterRowDetails({ ...snapshot, metadata: groupBlockContent }, raw, GROUP_STEP_NOTES_POLICY, primary ? groupFlowOrder?.notes : undefined);
    const preaching = metadataAfterRowDetails({ ...snapshot, metadata: groupStepNotes }, raw, PREACH_DATE_FIELD_POLICY, primary ? preachingOrder : undefined);
    const status = metadataAfterRowDetails({ ...snapshot, metadata: preaching }, raw, PREACH_STATUS_POLICY, primary ? statusOrder : undefined);
    const flag = metadataAfterRowDetails({ ...snapshot, metadata: status }, raw, SERVICE_ORDER_FLAG_POLICY, primary ? serviceFlagOrder : undefined);
    const stepTitle = metadataAfterRowDetails({ ...snapshot, metadata: flag }, raw, SERVICE_ORDER_STEP_TITLE_POLICY, primary ? serviceStepTitleOrder : undefined);
    const stepScripture = metadataAfterRowDetails({ ...snapshot, metadata: stepTitle }, raw, SERVICE_ORDER_STEP_SCRIPTURE_POLICY, primary ? serviceStepScriptureOrder : undefined);
    const stepBody = metadataAfterRowDetails({ ...snapshot, metadata: stepScripture }, raw, SERVICE_ORDER_STEP_BODY_POLICY, primary ? serviceStepBodyOrder : undefined);
    const topicTitle = metadataAfterRowDetails({ ...snapshot, metadata: stepBody }, raw, COUNCIL_TOPIC_TITLE_POLICY, primary ? councilTopicTitleOrder : undefined);
    const topicSummary = metadataAfterRowDetails({ ...snapshot, metadata: topicTitle }, raw, COUNCIL_TOPIC_SUMMARY_POLICY, primary ? councilTopicSummaryOrder : undefined);
    const topicText = metadataAfterRowDetails({ ...snapshot, metadata: topicSummary }, raw, councilTopicTextOrderPolicy, primary ? councilTopicTextOrder : undefined);
    const assembly = metadataAfterRowDetails({ ...snapshot, metadata: topicText }, raw, COUNCIL_ASSEMBLY_POLICY, primary ? councilAssemblyOrder : undefined);
    const topicKind = metadataAfterRowDetails({ ...snapshot, metadata: assembly }, raw, COUNCIL_TOPIC_KIND_POLICY, primary ? councilTopicKindOrder : undefined);
    const topicOutcome = metadataAfterRowDetails({ ...snapshot, metadata: topicKind }, raw, COUNCIL_OUTCOME_POLICY, primary ? councilOutcomeOrder : undefined,
      undefined, primary ? councilOutcomeOrder?.queueDigest : undefined);
    const thoughtText = metadataAfterRowDetails({ ...snapshot, metadata: topicOutcome }, raw, THOUGHT_TEXT_POLICY, primary ? thoughtTextOrder : undefined);
    const thoughtLock = metadataAfterRowDetails({ ...snapshot, metadata: thoughtText }, raw, THOUGHT_LOCK_POLICY, primary ? thoughtLockOrder : undefined);
    const thoughtPlacement = metadataAfterRowDetails({ ...snapshot, metadata: thoughtLock }, raw, THOUGHT_PLACEMENT_POLICY, primary ? thoughtPlacementOrder : undefined, primary ? thoughtPlacementOrder?.repairs : undefined);
    const metadata = snapshot.resource.collection === 'bibleMarks'
      ? metadataAfterBibleMarks(snapshot, raw?._dataEngine, primary ? markOrder : undefined)
      : metadataAfterDocumentFields({ ...snapshot, metadata: thoughtPlacement }, raw, primary ? fieldOrder : undefined);
    const exegetical = metadataAfterExegeticalPoints({ ...snapshot, metadata }, raw?._dataEngine, primary ? exegeticalOrder : undefined);
    const homiletic = metadataAfterHomileticPlans({ ...snapshot, metadata: exegetical }, raw, primary ? homileticOrder : undefined);
    const titlePolicy = outlineTitleProofPolicy(snapshot.resource.collection);
    const titles = titlePolicy ? metadataAfterRowDetails({ ...snapshot, metadata: homiletic }, raw, titlePolicy, primary ? outlineTitleOrder : undefined) : homiletic;
    const tags = metadataAfterThoughtTags({ ...snapshot, metadata: titles }, raw, primary ? thoughtTagOrder : undefined);
    const documentTags = metadataAfterDocumentTags({ ...snapshot, metadata: tags }, raw, primary ? documentTagOrder : undefined);
    const sourceNotes = metadataAfterSourceNoteLinks({ ...snapshot, metadata: documentTags }, raw, primary ? sourceNoteOrder : undefined);
    const outlineMoves = metadataAfterOutlineMoves({ ...snapshot, metadata: sourceNotes }, raw);
    const subpointMoves = metadataAfterOutlineSubpointOrder({ ...snapshot, metadata: outlineMoves }, raw, primary ? outlineSubpointOrder?.proofs : undefined);
    const outlinePointPlacementMetadata = metadataAfterOutlinePointPlacement({ ...snapshot, metadata: subpointMoves }, raw, primary ? outlinePointPlacement : undefined);
    const orderPlacementMetadata = metadataAfterServiceOrderPlacement({ ...snapshot, metadata: outlinePointPlacementMetadata }, raw,
      primary ? serviceOrderPlacement : undefined, !primary && Boolean(serviceOrderPlacement));
    const serviceStepMetadata = metadataAfterServiceOrderStepPlacement({ ...snapshot, metadata: orderPlacementMetadata }, raw,
      primary ? serviceOrderStepPlacement : undefined);
    const groupStepMetadata = metadataAfterGroupStepPlacement({ ...snapshot, metadata: serviceStepMetadata }, raw, primary ? groupFlowStepPlacement : undefined);
    const councilMetadata = metadataAfterCouncilTopicPlacement({ ...snapshot, metadata: groupStepMetadata }, raw, primary ? councilTopicPlacement : undefined);
    const finalMetadata = metadataAfterSeriesItemPlacement({ ...snapshot, metadata: councilMetadata }, raw, primary ? seriesItemPlacement : undefined);
    const listMetadata = metadataAfterAuthoredListRemovals({ ...snapshot, metadata: finalMetadata }, raw, primary ? listOrder : undefined, edit => {
      const time = edit.observation?.time;
      if (!time) return false;
      const stamp = edit.rowId === undefined
        ? fieldOrder?.fields.find(entry => entry.target.action === 'sermonRepeatedWordsAction')?.order.stamp
        : serviceStepScriptureOrder?.fields.get('scriptureRefs')?.find(entry => entry.stamp?.rowId === edit.rowId)?.stamp?.time;
      return equalValues(stamp, time);
    });
    const seriesDeletionVersion = snapshot.resource.collection === 'series' && snapshot.value === null
      ? acceptedSeriesCatalogVersion(feedWrites) : undefined;
    const groupPlanBefore = snapshot.resource.collection === 'groups' && primary && command.kind === 'update'
      && Array.isArray(raw?.flow) && Array.isArray(raw?.templates) ? { flow: toJson(raw.flow), templates: toJson(raw.templates) } : null;
    const bounded = snapshot.resource.collection === 'sermons' ? boundHomileticMetadata(value, listMetadata)
      : snapshot.resource.collection === 'groups' ? metadataAfterGroupFlowTopology(listMetadata, raw?._dataEngine, groupPlanBefore, snapshot.value)
      : listMetadata;
    const referenceMetadata = snapshot.resource.collection === 'studyNotes'
      ? metadataAfterStudyNoteReferences(bounded, snapshot, snapshotFromRaw(snapshot.resource, raw), raw?._dataEngine,
        primary ? studyNoteReferenceOrder : undefined)
      : bounded;
    const analysisMetadata = snapshot.resource.collection === 'studyNotes' && snapshot.value?.type === 'analysis'
      ? metadataAfterAnalysisFrame({ ...snapshot, metadata: referenceMetadata ?? snapshot.metadata }, snapshotFromRaw(snapshot.resource, raw), raw?._dataEngine,
        primary ? analysisFrameOrder?.accepted : undefined)
      : referenceMetadata;
    const withTitles = boundOutlineTitleMetadata(value, analysisMetadata ?? referenceMetadata);
    const sermonMetadata = snapshot.resource.collection === 'sermons'
      ? metadataAfterSermonText({ ...snapshot, metadata: withTitles ?? snapshot.metadata }, snapshotFromRaw(snapshot.resource, raw), raw?._dataEngine)
      : snapshot.resource.collection === 'councils' ? boundCouncilTopicTextMetadata(value, withTitles) : withTitles;
    transaction.set(adminDb.collection(snapshot.resource.collection).doc(snapshot.resource.id), { ...value,
      _dataEngine: { ...sermonMetadata, ...firstGroupMeetingLegacyMetadata(snapshot, raw, primary ? command : undefined),
        ...(seriesDeletionVersion !== undefined && { [SERIES_MEMBERSHIP_DELETION]: seriesDeletionVersion }) } });
  }
  for (const [index, addition] of (listOrder?.discarded ?? []).entries()) {
    const collection = command.resource.collection === 'serviceOrders' ? SERVICE_ORDER_STEP_SCRIPTURE_POLICY.history : DOCUMENT_METADATA_HISTORY;
    const history = adminDb.collection(command.resource.collection).doc(command.resource.id).collection(collection);
    transaction.set(history.doc(historyEntryId(primarySnapshot, JSON.stringify([command.operationId, 'addition', index]))), {
      generation: primarySnapshot.metadata!.generation, acceptedAt: new Date().toISOString(), discardedAddition: addition,
    });
  }
  if (serviceOrderPlacement?.displaced && primarySnapshot.metadata) {
    const history = adminDb.collection('serviceOrders').doc(primarySnapshot.resource.id).collection(SERVICE_ORDER_PLACEMENT_HISTORY);
    transaction.set(history.doc(historyEntryId(primarySnapshot, command.operationId)), {
      ...serviceOrderPlacement.displaced, generation: primarySnapshot.metadata.generation, acceptedAt: new Date().toISOString(),
    });
  }
  if (councilTopicPlacement?.displaced && primarySnapshot.metadata) {
    const history = adminDb.collection('councils').doc(primarySnapshot.resource.id).collection(COUNCIL_TOPIC_PLACEMENT_HISTORY);
    transaction.set(history.doc(historyEntryId(primarySnapshot, command.operationId)), {
      ...councilTopicPlacement.displaced, generation: primarySnapshot.metadata.generation, acceptedAt: new Date().toISOString(),
    });
  }
  if (groupFlowStepPlacement?.displaced && primarySnapshot.metadata) {
    const history = adminDb.collection('groups').doc(primarySnapshot.resource.id).collection(GROUP_STEP_PLACEMENT_HISTORY);
    transaction.set(history.doc(historyEntryId(primarySnapshot, command.operationId)), {
      ...groupFlowStepPlacement.displaced, generation: primarySnapshot.metadata.generation, acceptedAt: new Date().toISOString(),
    });
  }
  if (serviceOrderStepPlacement?.displaced && primarySnapshot.metadata) {
    const history = adminDb.collection('serviceOrders').doc(primarySnapshot.resource.id).collection(SERVICE_ORDER_STEP_PLACEMENT_HISTORY);
    transaction.set(history.doc(historyEntryId(primarySnapshot, command.operationId)), {
      ...serviceOrderStepPlacement.displaced, generation: primarySnapshot.metadata.generation, acceptedAt: new Date().toISOString(),
    });
  }
  const displacedSeriesItems = seriesItemPlacement?.flatMap(effect => effect.displaced ?? []) ?? [];
  if (displacedSeriesItems.length && primarySnapshot.metadata) {
    const history = adminDb.collection('series').doc(primarySnapshot.resource.id).collection(SERIES_ITEM_PLACEMENT_HISTORY);
    transaction.set(history.doc(historyEntryId(primarySnapshot, command.operationId)), { owner,
      changes: displacedSeriesItems, generation: primarySnapshot.metadata.generation, acceptedAt: new Date().toISOString() });
  }
  if (outlinePointPlacement?.displaced && primarySnapshot.metadata) {
    const history = adminDb.collection(primarySnapshot.resource.collection).doc(primarySnapshot.resource.id).collection(OUTLINE_POINT_PLACEMENT_HISTORY);
    transaction.set(history.doc(historyEntryId(primarySnapshot, command.operationId)), {
      ...outlinePointPlacement.displaced, generation: primarySnapshot.metadata.generation, acceptedAt: new Date().toISOString(),
    });
  }
  if (outlineSubpointOrder?.displaced.length && primarySnapshot.metadata) {
    const history = adminDb.collection(primarySnapshot.resource.collection).doc(primarySnapshot.resource.id).collection(OUTLINE_POINT_PLACEMENT_HISTORY);
    for (const entry of outlineSubpointOrder.displaced) {
      const id = historyEntryId(primarySnapshot, JSON.stringify([command.operationId, entry.pointId]));
      transaction.set(history.doc(id), { ...entry, generation: primarySnapshot.metadata.generation, acceptedAt: new Date().toISOString() });
    }
  }
  const tagHistory = thoughtTagOrder?.displaced.filter(entry =>
    existingRowField(primarySnapshot.value?.thoughts, entry.rowId, THOUGHT_TAG_BIRTH) === entry.rowCreatedAt
    && existingRowField(primarySnapshot.value?.thoughts, entry.rowId, thoughtTagTarget(entry.field)) === entry.winnerValue);
  if (tagHistory?.length && primarySnapshot.metadata) {
    persistChunkedHistory(transaction, primarySnapshot, command.operationId, THOUGHT_TAG_HISTORY, 'fields', tagHistory);
  }
  const sourceNoteHistory = retainedSourceNoteLinkHistory(primarySnapshot, sourceNoteOrder);
  if (sourceNoteHistory.length && primarySnapshot.metadata) {
    persistChunkedHistory(transaction, primarySnapshot, command.operationId, SOURCE_NOTE_LINK_HISTORY, 'entries', sourceNoteHistory);
  }
  persistStudyNoteReferenceHistory(transaction, command, primarySnapshot, studyNoteReferenceOrder);
  const displacedAnalysis = analysisFrameOrder?.displaced;
  if (displacedAnalysis && primarySnapshot.metadata) {
    const { values, ...proof } = displacedAnalysis;
    persistChunkedHistory(transaction, primarySnapshot, command.operationId, '_analysisFrameHistory', 'fields',
      values.map((value, index) => ({ field: ANALYSIS_RESHAPE_FRAME[index], value, ...proof })));
  }
  const documentTagHistory = documentTagOrder?.displaced.filter(entry =>
    tagMembership(tagField(primarySnapshot.value), entry.tag) === entry.winnerValue);
  if (documentTagHistory?.length && primarySnapshot.metadata && primarySnapshot.value) {
    persistChunkedHistory(transaction, primarySnapshot, command.operationId, DOCUMENT_TAG_HISTORY, 'tags', documentTagHistory);
  }
  const pointHistory = retainedExegeticalPointHistory(primarySnapshot, exegeticalOrder);
  if (pointHistory) {
    const history = adminDb.collection(command.resource.collection).doc(command.resource.id).collection(EXEGETICAL_POINT_HISTORY);
    transaction.set(history.doc(historyEntryId(primarySnapshot, command.operationId)), { ...pointHistory, generation: primarySnapshot.metadata!.generation });
  }
  persistDatedRowHistory(transaction, command, primarySnapshot, dateOrder);
  persistHomileticHistory(transaction, command, primarySnapshot, homileticOrder);
  if (outlineTitleOrder) persistRowDetailHistory(transaction, command, primarySnapshot, outlineTitleOrder.policy, outlineTitleOrder);
  persistRowDetailHistory(transaction, command, primarySnapshot, GROUP_MEETING_FIELD_POLICY, meetingOrder);
  persistRowDetailHistory(transaction, command, primarySnapshot, GROUP_BLOCK_TITLE_POLICY, groupFlowOrder?.block);
  persistRowDetailHistory(transaction, command, primarySnapshot, GROUP_STEP_TITLE_POLICY, groupFlowOrder?.step);
  persistRowDetailHistory(transaction, command, primarySnapshot, GROUP_BLOCK_STATUS_POLICY, groupFlowOrder?.blockStatus);
  persistRowDetailHistory(transaction, command, primarySnapshot, GROUP_STEP_DURATION_POLICY, groupFlowOrder?.duration);
  persistRowTextHistory(transaction, command, primarySnapshot, GROUP_BLOCK_CONTENT_POLICY, groupFlowOrder?.content);
  persistRowTextHistory(transaction, command, primarySnapshot, GROUP_STEP_NOTES_POLICY, groupFlowOrder?.notes);
  persistRowDetailHistory(transaction, command, primarySnapshot, PREACH_DATE_FIELD_POLICY, preachingOrder);
  persistRowDetailHistory(transaction, command, primarySnapshot, PREACH_STATUS_POLICY, statusOrder);
  persistRowDetailHistory(transaction, command, primarySnapshot, SERVICE_ORDER_FLAG_POLICY, serviceFlagOrder);
  persistRowDetailHistory(transaction, command, primarySnapshot, SERVICE_ORDER_STEP_TITLE_POLICY, serviceStepTitleOrder);
  persistRowDetailHistory(transaction, command, primarySnapshot, SERVICE_ORDER_STEP_SCRIPTURE_POLICY, serviceStepScriptureOrder);
  persistRowTextHistory(transaction, command, primarySnapshot, SERVICE_ORDER_STEP_BODY_POLICY, serviceStepBodyOrder);
  persistRowDetailHistory(transaction, command, primarySnapshot, COUNCIL_TOPIC_TITLE_POLICY, councilTopicTitleOrder);
  persistRowTextHistory(transaction, command, primarySnapshot, COUNCIL_TOPIC_SUMMARY_POLICY, councilTopicSummaryOrder);
  persistRowTextHistory(transaction, command, primarySnapshot, councilTopicTextOrderPolicy, councilTopicTextOrder);
  persistRowTextHistory(transaction, command, primarySnapshot, THOUGHT_TEXT_POLICY, thoughtTextOrder);
  persistRowDetailHistory(transaction, command, primarySnapshot, COUNCIL_ASSEMBLY_POLICY, councilAssemblyOrder);
  persistRowDetailHistory(transaction, command, primarySnapshot, COUNCIL_TOPIC_KIND_POLICY, councilTopicKindOrder);
  persistRowDetailHistory(transaction, command, primarySnapshot, THOUGHT_LOCK_POLICY, thoughtLockOrder);
  persistRowDetailHistory(transaction, command, primarySnapshot, THOUGHT_PLACEMENT_POLICY, thoughtPlacementOrder);
  const metadataHistory = [];
  for (const { target, order } of fieldOrder?.fields ?? []) {
    const displaced = order.displaced;
    if (!displaced || !primarySnapshot.value) continue;
    const valueAtTarget = target.action === 'commentPlaceAction' ? documentFieldValue(primarySnapshot.value, target)
      : readField(primarySnapshot.value, documentFieldPath(target));
    if (!equalValues(valueAtTarget, displaced.winnerValue)) continue;
    if (target.action === 'sermonRepeatedWordsAction' || isLongTextDocumentField(target)) {
      if (!primarySnapshot.metadata) continue;
      const history = adminDb.collection(command.resource.collection).doc(command.resource.id).collection(DOCUMENT_METADATA_HISTORY);
      const winnerDigest = createHash('sha256').update(commandFingerprint(displaced.winnerValue)).digest('base64url');
      // Keep one exact version per history document and identify the winner by digest.
      transaction.set(history.doc(historyEntryId(primarySnapshot, command.operationId) + '-' + target.field), {
        generation: primarySnapshot.metadata.generation, acceptedAt: new Date().toISOString(),
        fields: [{ field: target.field, value: displaced.value.value ?? null, winnerDigest,
          actionTime: displaced.actionTime, winnerActionTime: displaced.winnerActionTime }],
      });
      continue;
    }
    if (target.field === 'color' || target.action === 'commentPlaceAction' || target.action === 'seriesFieldActions' || target.action === 'councilTitleAction' || target.action === 'councilDateAction' || target.action === 'councilLifecycleAction'
      || target.action === 'prayerStatusAction' || target.action === 'prayerAnsweredAtAction' || target.action === 'sermonPreparationCheckActions' || target.action === 'sermonThesisFieldActions' || target.action === 'accountPreferenceActions') {
      metadataHistory.push({ field: target.field, value: displaced.value.value ?? null, winner: displaced.winnerValue.value ?? null,
        actionTime: displaced.actionTime, winnerActionTime: displaced.winnerActionTime });
      continue;
    }
    const field = target.field === 'name' ? 'title' : target.field;
    const destination = {
      title: { collection: DOCUMENT_TITLE_HISTORY, winner: 'winnerTitle' },
      status: { collection: GROUP_STATUS_HISTORY, winner: 'winnerStatus' },
      verse: { collection: SERMON_VERSE_HISTORY, winner: 'winnerVerse' },
      church: { collection: SERMON_CHURCH_HISTORY, winner: 'winnerChurch' },
      paragraph: { collection: COMMENT_KIND_HISTORY, winner: 'winnerParagraph' },
      planMode: { collection: SERMON_PLAN_MODE_HISTORY, winner: 'winnerPlanMode' },
      type: { collection: target.action === 'studyNoteTypeAction' ? STUDY_NOTE_TYPE_HISTORY : SERMON_GOAL_TYPE_HISTORY, winner: 'winnerType' },
    }[field];
    const history = adminDb.collection(command.resource.collection).doc(command.resource.id).collection(destination.collection);
    const { value, winnerValue, ...evidence } = displaced;
    transaction.set(history.doc(historyEntryId(primarySnapshot, command.operationId)), {
      ...evidence, [field]: value.value ?? null, [destination.winner]: winnerValue.value ?? null, acceptedAt: new Date().toISOString(),
    });
  }
  if (metadataHistory.length && primarySnapshot.metadata) {
    const history = adminDb.collection(command.resource.collection).doc(command.resource.id).collection(DOCUMENT_METADATA_HISTORY);
    transaction.set(history.doc(historyEntryId(primarySnapshot, command.operationId)), {
      fields: metadataHistory, generation: primarySnapshot.metadata.generation, acceptedAt: new Date().toISOString(),
    });
  }
  persistBibleMarkOrder(transaction, command, primarySnapshot, markOrder);
  if (seriesMembershipWrites.length) persistSeriesMembershipWrites(transaction, owner, command.operationId, seriesMembershipWrites, effects, feedWrites);
  persistFeedWrites(transaction, feedWrites);
}

function relationListFor(owner: string, transaction: Transaction,
  rawDocuments?: Map<string, Record<string, unknown> | undefined>): RelationReader['list'] {
  return async (collection, limit, filter, select) => {
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
        rawDocuments?.set(resourceKey(resource), data);
        matches.push(snapshot);
        if (matches.length === limit) return matches;
      }
      if (!select || documents.docs.length < pageSize) return matches;
      cursor = documents.docs[documents.docs.length - 1].id;
    }
    return matches;
  };
}

export async function tagNameStillAbsent(transaction: Transaction, owner: string, name: string): Promise<boolean> {
  // Accepted tag mutations also read and write this head. It serializes a
  // replacement tag with cleanup even when the exact-name query is empty.
  await transaction.get(adminDb.collection(HEADS_COLLECTION).doc(collectionHeadId(owner, 'tags')));
  return !await tagNameIsTaken(relationListFor(owner, transaction), name);
}

/** Only trusted per-sermon cleanup supplies this guard; it is never part of the HTTP command. */
export interface TagCleanupGuard { absentTagName: string }

export async function processCommand(owner: string, input: unknown, tagCleanup?: TagCleanupGuard): Promise<CommandResult> {
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
  // The exact delete receipt keeps the original write admitted until the guarded cleanup finishes.
  let cleanup: TagCleanupProgress | undefined;

  const outcome = await adminDb.runTransaction(async transaction => {
    cleanup = undefined;
    // Rights and receipts are read in the same transaction as the eventual effect.
    const [stored, existingReceipt] = await Promise.all([transaction.get(documentRef), transaction.get(commandReceiptRef)]);
    const raw = stored.exists ? stored.data() : undefined;
    const storedReceipt = existingReceipt.exists ? existingReceipt.data() : undefined;
    const previous = readReceipt(storedReceipt);
    const replay = await previousCommandResult(previous, command, commandHash, raw,
      manifest => readReceiptParts(transaction, commandReceiptRef, manifest, command));
    if (replay) {
      if (replay.kind !== 'acknowledged') return replay;
      const reply = await relatedAcknowledgement(transaction, owner, replay);
      if (command.kind === 'delete' && command.resource.collection === 'tags' && replay.snapshot.metadata?.deleted) {
        const name = command.baseline.name;
        try { cleanup = readTagCleanup(storedReceipt, name); }
        catch { throw tagCleanupPending(); }
        if (!cleanup && storedReceipt && typeof name === 'string' && name) {
          // Old receipts predate the cursor. Repeating their owner-scoped cleanup is safe.
          cleanup = { name, after: null, completed: false };
          transaction.set(commandReceiptRef, { ...storedReceipt, tagCleanup: cleanup });
        }
      }
      return reply;
    }

    const dependencies = await Promise.all(command.dependsOn.map(id => transaction.get(receiptRef(owner, id))));
    const blocked = command.dependsOn.filter((id, index) => {
      const dependency = readReceipt(dependencies[index].data());
      return !dependency || dependency.owner !== owner || dependency.operationId !== id || dependency.result.kind !== 'acknowledged';
    });
    let result: CommandResult;
    let effects: ResourceSnapshot[] = [];
    let detachedTagName: string | undefined;
    let seriesMembershipWrites: SeriesMembershipWrite[] = [];
    let cachedSeriesHead: Promise<DocumentData | undefined> | undefined;
    const readSeriesHead = () => cachedSeriesHead ??= transaction.get(adminDb.collection(HEADS_COLLECTION).doc(collectionHeadId(owner, 'series')))
      .then(head => head.exists ? head.data() as DocumentData : undefined);
    let listOrder: ReturnType<typeof orderAuthoredListAdditions> | undefined;
    let dateOrder: ReturnType<typeof orderDatedRow> | undefined;
    let meetingOrder: ReturnType<typeof orderGroupMeetingFields> | undefined;
    let groupFlowOrder: ReturnType<typeof orderGroupFlowFields> | undefined;
    let preachingOrder: RowDetailOrder<PreachDateField, PreachDateFieldValue> | undefined;
    let statusOrder: RowDetailOrder<'status', PreachStatusValue> | undefined;
    let serviceFlagOrder: RowDetailOrder<'flagged', boolean> | undefined;
    let serviceStepTitleOrder: RowDetailOrder<'title', string> | undefined;
    let serviceStepBodyOrder: RowDetailOrder<'body', string> | undefined;
    let serviceStepScriptureOrder: ReturnType<typeof orderServiceStepScripture> | undefined;
    let councilTopicTitleOrder: RowDetailOrder<'title', string> | undefined;
    let councilTopicSummaryOrder: RowDetailOrder<'summary', string | null> | undefined;
    let councilTopicTextOrder: ReturnType<typeof orderCouncilTopicText> | undefined;
    let councilAssemblyOrder: RowDetailOrder<'forAssembly', boolean> | undefined;
    let councilTopicKindOrder: RowDetailOrder<'kind', CouncilTopicKind> | undefined;
    let councilOutcomeOrder: ReturnType<typeof orderCouncilOutcome> | undefined;
    let thoughtTextOrder: RowDetailOrder<'text', string> | undefined;
    let thoughtLockOrder: RowDetailOrder<'isLocked', boolean> | undefined;
    let thoughtPlacementOrder: ReturnType<typeof orderThoughtPlacement> | undefined;
    let markOrder: ReturnType<typeof orderBibleMarks> | undefined;
    let fieldOrder: ReturnType<typeof orderDocumentFields> | undefined;
    let exegeticalOrder: ReturnType<typeof orderExegeticalPoints> | undefined;
    let homileticOrder: ReturnType<typeof orderHomileticPlans> | undefined;
    let outlineTitleOrder: ReturnType<typeof orderOutlineTitles>;
    let thoughtTagOrder: ReturnType<typeof orderThoughtTags> | undefined;
    let documentTagOrder: ReturnType<typeof orderDocumentTags> | undefined;
    let sourceNoteOrder: ReturnType<typeof orderSourceNoteLinks> | undefined;
    let analysisFrameOrder: ReturnType<typeof orderAnalysisFrame> | undefined;
    let studyNoteReferenceOrder: ReturnType<typeof planStudyNoteReferenceOrder>;
    let serviceOrderPlacement: ServiceOrderPlacementWrite | undefined;
    let serviceOrderStepPlacement: ServiceOrderStepPlacementWrite | undefined;
    let groupFlowStepPlacement: StepPlacementWrite | undefined;
    let seriesItemPlacement: StepPlacementWrite[] | undefined;
    let councilTopicPlacement: StepPlacementWrite | undefined;
    let outlinePointPlacement: OutlinePointPlacementWrite | undefined;
    let outlineSubpointOrder: ReturnType<typeof orderOutlineSubpoints> | undefined;
    const rawDocuments = new Map<string, Record<string, unknown> | undefined>([[resourceKey(command.resource), raw]]);
    if (blocked.length) {
      result = { kind: 'blocked', operationId: command.operationId, dependencies: blocked };
    } else {
      if (tagCleanup && !await tagNameStillAbsent(transaction, owner, tagCleanup.absentTagName)) {
        return refusal(TAG_NAME_EXISTS);
      }
      const current = snapshotFromRaw(command.resource, raw);
      const serverMs = stored.readTime?.toMillis();
      const compatible = adoptLegacyFirstGroupMeeting(command, current, raw?._dataEngine);
      listOrder = orderAuthoredListAdditions(compatible, current, raw?._dataEngine, serverMs);
      const initialMeeting = prepareFirstGroupMeetingOrder(listOrder.command, current);
      const meetingOpening = initialMeeting?.current ?? current;
      dateOrder = orderDatedRow(initialMeeting?.command ?? listOrder.command, meetingOpening, raw?._dataEngine, serverMs, initialMeeting?.rowId);
      meetingOrder = orderGroupMeetingFields(dateOrder.command, meetingOpening, raw?._dataEngine, serverMs, initialMeeting?.rowId);
      groupFlowOrder = orderGroupFlowFields(initialMeeting?.restoreOpening(meetingOrder.command) ?? meetingOrder.command, current, raw?._dataEngine, serverMs);
      const preaching = groupFlowOrder.notes.command;
      const note = preaching.kind === 'update' ? expandPreachDateNotes(preaching) : undefined;
      const detailedPreaching = note && preaching.kind === 'update'
        ? { ...preaching, preachDateFieldActions: { ...preaching.preachDateFieldActions, notes: note } } : preaching;
      preachingOrder = orderRowDetails(detailedPreaching, current, raw?._dataEngine, serverMs, PREACH_DATE_FIELD_POLICY);
      const statusCommand = alignPreachStatusCommand(preachingOrder.command, current);
      statusOrder = orderRowDetails(statusCommand, current, raw?._dataEngine, serverMs, PREACH_STATUS_POLICY);
      serviceFlagOrder = orderRowDetails(statusOrder.command, current, raw?._dataEngine, serverMs, SERVICE_ORDER_FLAG_POLICY);
      serviceStepTitleOrder = orderRowDetails(serviceFlagOrder.command, current, raw?._dataEngine, serverMs, SERVICE_ORDER_STEP_TITLE_POLICY);
      serviceStepScriptureOrder = orderServiceStepScripture(serviceStepTitleOrder.command, current, raw?._dataEngine, serverMs, listOrder.resolved);
      serviceStepBodyOrder = orderRowText(serviceStepScriptureOrder.command, current, raw?._dataEngine, serverMs, SERVICE_ORDER_STEP_BODY_POLICY);
      councilTopicTitleOrder = orderRowDetails(serviceStepBodyOrder.command, current, raw?._dataEngine, serverMs, COUNCIL_TOPIC_TITLE_POLICY);
      councilTopicSummaryOrder = orderRowText(councilTopicTitleOrder.command, current, raw?._dataEngine, serverMs, COUNCIL_TOPIC_SUMMARY_POLICY);
      councilTopicTextOrder = orderCouncilTopicText(councilTopicSummaryOrder.command, current, raw?._dataEngine, serverMs);
      councilAssemblyOrder = orderRowDetails(councilTopicTextOrder.command, current, raw?._dataEngine, serverMs, COUNCIL_ASSEMBLY_POLICY);
      councilTopicKindOrder = orderRowDetails(councilAssemblyOrder.command, current, raw?._dataEngine, serverMs, COUNCIL_TOPIC_KIND_POLICY);
      councilOutcomeOrder = orderCouncilOutcome(councilTopicKindOrder.command, current, raw?._dataEngine, serverMs, command);
      const aligned = alignServiceOrderFlagRepresentation(alignCouncilAssembly(alignCouncilTopicKind(councilOutcomeOrder.command, current), current), current);
      outlineSubpointOrder = orderOutlineSubpoints(aligned, current, raw?._dataEngine, serverMs);
      thoughtTextOrder = orderRowText(outlineSubpointOrder.command, current, raw?._dataEngine, serverMs, THOUGHT_TEXT_POLICY);
      thoughtLockOrder = orderRowDetails(thoughtTextOrder.command, current, raw?._dataEngine, serverMs, THOUGHT_LOCK_POLICY);
      thoughtPlacementOrder = orderThoughtPlacement(alignThoughtLockRepresentation(thoughtLockOrder.command, current),
        current, raw?._dataEngine, serverMs, aligned);
      thoughtTagOrder = orderThoughtTags(thoughtPlacementOrder.command, command, current, raw?._dataEngine, serverMs);
      documentTagOrder = orderDocumentTags(thoughtTagOrder.command, command, current, raw?._dataEngine, serverMs);
      sourceNoteOrder = orderSourceNoteLinks(documentTagOrder.command, current, raw?._dataEngine, serverMs);
      markOrder = await planBibleMarkOrder(transaction, documentRef, sourceNoteOrder.command, current, raw?._dataEngine, serverMs);
      fieldOrder = orderDocumentFields(markOrder.command, current, raw?._dataEngine, serverMs, listOrder.resolved.has(''));
      exegeticalOrder = orderExegeticalPoints(fieldOrder.command, current, raw?._dataEngine, serverMs);
      homileticOrder = orderHomileticPlans(exegeticalOrder.command, current, raw?._dataEngine, serverMs);
      outlineTitleOrder = orderOutlineTitles(homileticOrder.command, current, raw?._dataEngine, serverMs);
      analysisFrameOrder = orderAnalysisFrame(outlineTitleOrder?.command ?? homileticOrder.command, current, raw?._dataEngine, serverMs);
      const orderedCommand = analysisFrameOrder.command;
      studyNoteReferenceOrder = planStudyNoteReferenceOrder(orderedCommand, current, raw?._dataEngine, serverMs);
      const planned = await planDataCommand(orderedCommand, current, {
        guardedTagCleanupName: tagCleanup?.absentTagName,
        orderStudyNoteReference: studyNoteReferenceOrder?.order,
        analysisFrameMetadata: resource => rawDocuments.get(resourceKey(resource))?._dataEngine,
        serviceOrderPlacement: { rawMetadata: raw?._dataEngine, serverMs },
        seriesPlacementMetadata: resource => rawDocuments.get(resourceKey(resource))?._dataEngine,
        ...(serverMs !== undefined && { seriesMembershipOrder: { serverMs,
          catalogVersion: async () => readHeadVersion(owner, 'series', await readSeriesHead()),
          read: async member => (await transaction.get(seriesMembershipHeadRef(member))).data(),
          readDeletion: async ({ id, generation }) => {
            const document = await transaction.get(adminDb.collection('series').doc(id));
            const data = document.data();
            if (!data || !owns(owner, { collection: 'series', id }, data)) return undefined;
            const metadata = readMetadata(data._dataEngine);
            if (!metadata?.deleted || (generation !== null && metadata.generation !== generation)) return undefined;
            const version = (data._dataEngine as DocumentData)[SERIES_MEMBERSHIP_DELETION];
            return typeof version === 'number' && Number.isSafeInteger(version) ? version : undefined;
          },
        } }),
        get: async resource => {
          resourcePolicy(resource);
          const document = await transaction.get(adminDb.collection(resource.collection).doc(resource.id));
          const data = document.exists ? document.data() : undefined;
          if (!owns(owner, resource, data)) throw new DataEngineServerError(PERMISSION_DENIED, 403);
          rawDocuments.set(resourceKey(resource), data);
          return snapshotFromRaw(resource, data);
        },
        list: relationListFor(owner, transaction, rawDocuments),
      });
      const uncertain = [...(dateOrder.uncertain ?? []), ...meetingOrder.uncertain, ...groupFlowOrder.block.uncertain, ...groupFlowOrder.step.uncertain, ...groupFlowOrder.blockStatus.uncertain, ...groupFlowOrder.duration.uncertain, ...groupFlowOrder.content.uncertain, ...groupFlowOrder.notes.uncertain, ...preachingOrder.uncertain, ...statusOrder.uncertain, ...serviceFlagOrder.uncertain, ...serviceStepTitleOrder.uncertain, ...serviceStepBodyOrder.uncertain, ...serviceStepScriptureOrder.uncertain, ...councilTopicTitleOrder.uncertain, ...councilTopicSummaryOrder.uncertain, ...councilTopicTextOrder.uncertain, ...councilAssemblyOrder.uncertain, ...councilTopicKindOrder.uncertain, ...councilOutcomeOrder.uncertain, ...thoughtTextOrder.uncertain, ...thoughtLockOrder.uncertain, ...thoughtPlacementOrder.uncertain, ...(markOrder.uncertain ?? []), ...(fieldOrder.uncertain ?? []), ...exegeticalOrder.uncertain, ...thoughtTagOrder.uncertain, ...documentTagOrder.uncertain, ...sourceNoteOrder.uncertain, ...listOrder.uncertain];
      uncertain.push(...homileticOrder.uncertain, ...outlineSubpointOrder.uncertain, ...(outlineTitleOrder?.uncertain ?? []));
      const orderedPreachingPaths = new Set([...preachingOrder.fields].flatMap(([field, plans]) =>
        plans.flatMap(plan => plan.stamp ? [JSON.stringify(rowConflictPath(plan.stamp.rowId, preachDateFieldTarget(field)))] : [])));
      uncertain.push(...analysisFrameOrder.conflicts,
        ...compareReturnedSermonText(orderedCommand, current, raw?._dataEngine, orderedPreachingPaths));
      const nestedCouncilReview = councilTopicTextOrder.settled.length || councilTopicTextOrder.uncertain.length
        || (command.resource.collection === 'councils' && planned.result.kind === 'conflict'
          && planned.result.conflicts.some(({ path }) => councilTopicTextConflict(path)));
      const settledCouncilDetails = nestedCouncilReview
        ? [...settledCouncilTopicDetails(command, current, COUNCIL_ASSEMBLY_POLICY, councilAssemblyOrder),
          ...settledCouncilTopicDetails(command, current, COUNCIL_TOPIC_KIND_POLICY, councilTopicKindOrder)] : [];
      const blockedByComparison = planned.result.kind === 'conflict' || uncertain.length > 0;
      const plan = retainUncertainChronology(planned, command, current, blockedByComparison
        ? [...uncertain, ...listOrder.rejectedChoices, ...homileticOrder.settled, ...outlineSubpointOrder.settled,
          ...(outlineTitleOrder?.settled ?? []), ...councilTopicTextOrder.settled, ...settledCouncilDetails, ...orderedPreachDateFieldComparisons(command, preachingOrder)]
        : uncertain);
      if (plan.result.kind === 'conflict' && command.kind === 'update' && command.resource.collection === 'groups'
        && orderedCommand.kind === 'update' && current.value) {
        const sent = command.changes.find(change => change.path[0] === 'meetingDates');
        const ordered = orderedCommand.changes.find(change => change.path[0] === 'meetingDates');
        const comparison = sent && ordered && groupFirstMeetingComparison(sent, ordered, current.value, plan.result.conflicts, mergeFields);
        if (comparison) plan.result.conflicts.push(comparison);
      }
      const acceptedAt = new Date().toISOString();
      // The planner exposes writes only for acknowledged commands.
      effects = plan.writes.map(effect => stampAcceptedResource(snapshotFromRaw(effect.resource, rawDocuments.get(resourceKey(effect.resource))), effect, acceptedAt));
      result = withAcceptedCopies(plan.result, effects);
      detachedTagName = plan.detachedTagName;
      seriesMembershipWrites = plan.seriesMembershipWrites ?? [];
      serviceOrderPlacement = plan.serviceOrderPlacement;
      serviceOrderStepPlacement = plan.serviceOrderStepPlacement;
      groupFlowStepPlacement = plan.groupFlowStepPlacement;
      seriesItemPlacement = plan.seriesItemPlacement;
      councilTopicPlacement = plan.councilTopicPlacement;
      outlinePointPlacement = plan.outlinePointPlacement;
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
    const receipt = prepareReceipt(owner, command, commandHash, result);
    result = receipt.result;
    if (result.kind === 'acknowledged' && command.kind === 'delete' && command.resource.collection === 'tags'
      && typeof command.baseline.name === 'string' && command.baseline.name) {
      cleanup = { name: command.baseline.name, after: null, completed: !detachedTagName };
    }
    if (result.kind === 'acknowledged') {
      await persistAcceptedCommand(transaction, { owner, command, snapshot: result.snapshot, effects, rawDocuments, listOrder, dateOrder, meetingOrder, groupFlowOrder, preachingOrder, statusOrder, serviceFlagOrder, serviceStepTitleOrder, serviceStepBodyOrder, serviceStepScriptureOrder, councilTopicTitleOrder, councilTopicSummaryOrder, councilTopicTextOrder, councilAssemblyOrder, councilTopicKindOrder, councilOutcomeOrder, thoughtTextOrder, thoughtLockOrder, thoughtPlacementOrder, markOrder, fieldOrder, exegeticalOrder, homileticOrder, outlineTitleOrder, thoughtTagOrder, documentTagOrder, sourceNoteOrder, studyNoteReferenceOrder, analysisFrameOrder, serviceOrderPlacement, serviceOrderStepPlacement, groupFlowStepPlacement, councilTopicPlacement, outlinePointPlacement, outlineSubpointOrder, seriesItemPlacement, seriesMembershipWrites, cachedSeriesHead });
    }
    if (result.kind === 'conflict') {
      // Keep a proven earlier value even if another field blocks the command. Mark a result that
      // still depends on the comparison separately from one already visible in the document.
      persistStudyNoteReferenceHistory(transaction, command, result.snapshot, studyNoteReferenceOrder, true);
      persistHomileticHistory(transaction, command, result.snapshot, homileticOrder, true);
      persistRowTextHistory(transaction, command, result.snapshot, councilTopicTextOrderPolicy, councilTopicTextOrder);
      if (result.conflicts.some(({ code }) => code === COUNCIL_TOPIC_TEXT_SETTLED || code === COUNCIL_TOPIC_TEXT_QUEUED)) {
        persistRowDetailHistory(transaction, command, result.snapshot, COUNCIL_ASSEMBLY_POLICY, councilAssemblyOrder);
        persistRowDetailHistory(transaction, command, result.snapshot, COUNCIL_TOPIC_KIND_POLICY, councilTopicKindOrder);
      }
      if (outlineTitleOrder) persistRowDetailHistory(transaction, command, result.snapshot, outlineTitleOrder.policy, outlineTitleOrder);
      if (preachingOrder) persistRowDetailHistory(transaction, command, result.snapshot, PREACH_DATE_FIELD_POLICY, preachingOrder);
      if (meetingOrder) persistRowDetailHistory(transaction, command, result.snapshot, GROUP_MEETING_FIELD_POLICY, meetingOrder);
      if (dateOrder?.target === MEETING_DATE_TARGET) persistDatedRowHistory(transaction, command, result.snapshot, dateOrder);
    }
    if (result.kind === 'conflict' && exegeticalOrder?.comparisons?.length) {
      const points = new Set(result.conflicts.map(({ path }) => exegeticalPointConflictId(path)));
      const history = documentRef.collection(EXEGETICAL_POINT_HISTORY);
      for (const comparison of exegeticalOrder.comparisons) {
        if (!points.has(comparison.nodeId)) continue;
        const identity = exegeticalOrder.comparisons.length === 1 ? command.operationId : JSON.stringify([command.operationId, comparison.nodeId]);
        transaction.set(history.doc(historyEntryId(result.snapshot, identity)), { ...comparison, generation: result.snapshot.metadata!.generation });
      }
    }
    // A blocked receipt fixes the identity but may advance after its dependencies acknowledge.
    transaction.set(commandReceiptRef, cleanup ? { ...receipt.stored, tagCleanup: cleanup } : receipt.stored);
    if (receipt.parts) {
      const { collection, values } = receipt.parts;
      values.forEach((json, index) => transaction.set(receiptPartRef(commandReceiptRef, collection, index), { json }));
    }
    return result;
  });
  const progress = cleanup as TagCleanupProgress | undefined;
  if (outcome.kind === 'acknowledged' && progress && !progress.completed) {
    try { await resumeTagCleanup(owner, progress, (expected, next) => saveTagCleanupProgress(commandReceiptRef, owner, commandHash, expected, next)); }
    catch { throw tagCleanupPending(); }
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
  if (challenge && readsDocumentActionClock(resource.collection) && document.readTime) {
    return { ...snapshot, actionClock: { challenge, serverMs: Math.floor(document.readTime.toMillis()) } };
  }
  return snapshot;
}

async function readHistoryEntries<T extends { id: string }>(owner: string, resource: ResourceRef, subcollection: string,
  generation: string | null | undefined, cursor: string | undefined, unavailable: string, includeLegacy = false,
  project?: (transaction: Transaction, reference: DocumentReference, data: Record<string, unknown> & { id: string }) => Promise<T>) {
  checkOwner(owner);
  if (!validSegment(resource.id) || (typeof generation === 'string' && !validSegment(generation))
    || (cursor !== undefined && !/^\d{16}-[0-9a-f]{64}$/.test(cursor))) {
    throw new DataEngineServerError(INVALID_ARGUMENT, 400);
  }
  const reference = adminDb.collection(resource.collection).doc(resource.id);
  return adminDb.runTransaction(async transaction => {
    const document = await transaction.get(reference);
    const raw = document.exists ? document.data() : undefined;
    if (!owns(owner, resource, raw)) throw new DataEngineServerError(PERMISSION_DENIED, 403);
    const snapshot = snapshotFromRaw(resource, raw);
    const actualGeneration = snapshot.metadata?.generation ?? null;
    if (!snapshot.value || (generation !== undefined && actualGeneration !== generation)) throw new DataEngineServerError(unavailable, 404);
    const pageSize = 20;
    const history = reference.collection(subcollection);
    // A legacy live member can acquire its first marker without changing identity.
    // A tombstone permanently prevents reusing the member's address.
    const versions = includeLegacy && actualGeneration !== null
      ? history.where(Filter.or(Filter.where('generation', '==', actualGeneration), Filter.where('generation', '==', null)))
      : history.where('generation', '==', actualGeneration);
    const query = (includeLegacy ? versions.where('owner', '==', owner) : versions).orderBy(FieldPath.documentId()).limit(pageSize + 1);
    const page = await transaction.get(cursor ? query.startAfter(cursor) : query);
    const entries: T[] = [];
    let bytes = 0;
    for (const item of page.docs.slice(0, pageSize)) {
      const data = { ...item.data(), id: item.id };
      const entry = project ? await project(transaction, history.doc(item.id), data) : data as T;
      if (project) {
        const size = Buffer.byteLength(JSON.stringify(entry)) + 1;
        if (entries.length && bytes + size > MAX_LIST_BYTES) break;
        bytes += size;
      }
      entries.push(entry);
    }
    return { generation: actualGeneration, entries, nextCursor: page.docs.length > entries.length ? entries.at(-1)!.id : null };
  });
}

async function listHistoryEntries<T extends { id: string }>(owner: string, resource: ResourceRef, subcollection: string,
  generation: string, cursor: string | undefined, unavailable: string): Promise<{ entries: T[]; nextCursor: string | null }> {
  const { entries, nextCursor } = await readHistoryEntries<T>(owner, resource, subcollection, generation, cursor, unavailable);
  return { entries, nextCursor };
}

export async function listSeriesMembershipHistory(owner: string, collection: 'sermons' | 'groups', memberId: string,
  generation?: string | null, cursor?: string): Promise<SeriesMembershipHistoryPage> {
  if (collection !== 'sermons' && collection !== 'groups') throw new DataEngineServerError(INVALID_ARGUMENT, 400);
  const page = await readHistoryEntries<SeriesMembershipHistoryEntry>(owner, { collection, id: memberId }, SERIES_MEMBERSHIP_HISTORY,
    generation, cursor, 'series-member-gone', true);
  return { owner, collection, memberId, ...page, entries: page.entries.map(({ id, former, current, acceptedAt }) => ({ id, former, current, acceptedAt })) };
}

export async function listPreachDateHistory(owner: string, sermonId: string, generation: string, cursor?: string): Promise<PreachDateHistoryPage> {
  const resource = { collection: 'sermons', id: sermonId };
  const page = await listHistoryEntries<DisplacedRowDate & { id: string; acceptedAt: string }>(
    owner, resource, PREACH_DATE_TARGET.history, generation, cursor, 'preach-date-gone',
  );
  return { owner, sermonId, generation, ...page };
}

export async function listPreachStatusHistory(owner: string, sermonId: string, generation: string, cursor?: string): Promise<PreachStatusHistoryPage> {
  const page = await listHistoryEntries<PreachStatusHistoryPage['entries'][number]>(
    owner, { collection: 'sermons', id: sermonId }, PREACH_STATUS_POLICY.history, generation, cursor, 'preach-date-gone',
  );
  return { owner, sermonId, generation, ...page };
}

export async function listPreachDateFieldHistory(owner: string, sermonId: string, generation: string, cursor?: string): Promise<PreachDateFieldHistoryPage> {
  const page = await listHistoryEntries<PreachDateFieldHistoryPage['entries'][number]>(
    owner, { collection: 'sermons', id: sermonId }, PREACH_DATE_FIELD_POLICY.history, generation, cursor, 'preach-date-gone',
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

export async function listGroupMeetingFieldHistory(owner: string, groupId: string, generation: string, cursor?: string): Promise<GroupMeetingFieldHistoryPage> {
  const resource = { collection: 'groups', id: groupId };
  const page = await listHistoryEntries<GroupMeetingFieldHistoryPage['entries'][number]>(owner, resource, GROUP_MEETING_FIELD_HISTORY, generation, cursor, 'group-gone');
  return { owner, groupId, generation, ...page };
}

export async function listBibleMarkHistory(owner: string, bookId: string, generation: string, cursor?: string): Promise<BibleMarkHistoryPage> {
  const resource = { collection: 'bibleMarks', id: bookId };
  const page = await listHistoryEntries<BibleMarkHistoryEntry>(owner, resource, BIBLE_MARK_HISTORY, generation, cursor, 'marks-book-gone');
  return { owner, bookId, generation, ...page };
}

export async function listThoughtPlacementHistory(owner: string, sermonId: string, generation: string, cursor?: string): Promise<ThoughtPlacementHistoryPage> {
  const resource = { collection: 'sermons', id: sermonId };
  const page = await listHistoryEntries<ThoughtPlacementHistoryPage['entries'][number]>(owner, resource, THOUGHT_PLACEMENT_POLICY.history, generation, cursor, 'sermon-gone');
  return { owner, sermonId, generation, ...page };
}

export async function listDocumentTagHistory(owner: string, collection: string, documentId: string, generation: string,
  cursor?: string): Promise<DocumentTagHistoryPage> {
  if (!documentTagCollection(collection)) throw new DataEngineServerError('invalid-argument', 400);
  const page = await listHistoryEntries<DocumentTagHistoryPage['entries'][number]>(owner, { collection, id: documentId },
    DOCUMENT_TAG_HISTORY, generation, cursor, collection === 'prayerRequests' ? 'prayer-gone' : 'note-gone');
  return { owner, documentId, generation, ...page };
}

export async function listThoughtTagHistory(owner: string, sermonId: string, generation: string, cursor?: string): Promise<ThoughtTagHistoryPage> {
  const resource = { collection: 'sermons', id: sermonId };
  const page = await listHistoryEntries<ThoughtTagHistoryPage['entries'][number]>(owner, resource, THOUGHT_TAG_HISTORY, generation, cursor, 'sermon-gone');
  return { owner, sermonId, generation, ...page };
}

export async function listThoughtLockHistory(owner: string, sermonId: string, generation: string, cursor?: string): Promise<ThoughtLockHistoryPage> {
  const resource = { collection: 'sermons', id: sermonId };
  const page = await listHistoryEntries<ThoughtLockHistoryPage['entries'][number]>(owner, resource, THOUGHT_LOCK_POLICY.history, generation, cursor, 'sermon-gone');
  return { owner, sermonId, generation, ...page };
}

export async function listServiceOrderFlagHistory(owner: string, orderId: string, generation: string, cursor?: string): Promise<ServiceOrderFlagHistoryPage> {
  const resource = { collection: 'serviceOrders', id: orderId };
  const page = await listHistoryEntries<ServiceOrderFlagHistoryPage['entries'][number]>(
    owner, resource, SERVICE_ORDER_FLAG_POLICY.history, generation, cursor, 'service-order-gone',
  );
  return { owner, orderId, generation, ...page };
}

export async function listGroupFlowHistory(owner: string, groupId: string, generation: string,
  cursor: string | undefined, field: 'block' | 'step' | 'status' | 'duration'): Promise<GroupFlowHistoryPage> {
  const resource = { collection: 'groups', id: groupId };
  const policy = { block: GROUP_BLOCK_TITLE_POLICY, step: GROUP_STEP_TITLE_POLICY, status: GROUP_BLOCK_STATUS_POLICY, duration: GROUP_STEP_DURATION_POLICY }[field];
  const page = await listHistoryEntries<GroupFlowHistoryPage['entries'][number]>(owner, resource, policy.history, generation, cursor, 'group-gone');
  return { owner, groupId, generation, ...page };
}

export async function listServiceOrderStepTitleHistory(owner: string, orderId: string, generation: string, cursor?: string): Promise<ServiceOrderStepTitleHistoryPage> {
  const resource = { collection: 'serviceOrders', id: orderId };
  const page = await listHistoryEntries<ServiceOrderStepTitleHistoryPage['entries'][number]>(
    owner, resource, SERVICE_ORDER_STEP_TITLE_POLICY.history, generation, cursor, 'service-order-gone',
  );
  return { owner, orderId, generation, ...page };
}

export async function listCouncilOutcomeHistory(owner: string, councilId: string, generation: string, cursor?: string): Promise<CouncilOutcomeHistoryPage> {
  const resource = { collection: 'councils', id: councilId };
  const page = await listHistoryEntries<CouncilOutcomeHistoryPage['entries'][number]>(
    owner, resource, COUNCIL_OUTCOME_POLICY.history, generation, cursor, 'council-gone',
  );
  return { owner, councilId, generation, ...page, entries: page.entries.map(entry => ({ ...entry,
    fields: entry.fields.filter(field => isCouncilOutcome(field.value) && isCouncilOutcome(field.winnerValue)),
  })) };
}

export async function listCouncilTopicKindHistory(owner: string, councilId: string, generation: string, cursor?: string): Promise<CouncilTopicKindHistoryPage> {
  const resource = { collection: 'councils', id: councilId };
  const page = await listHistoryEntries<CouncilTopicKindHistoryPage['entries'][number]>(
    owner, resource, COUNCIL_TOPIC_KIND_POLICY.history, generation, cursor, 'council-gone',
  );
  return { owner, councilId, generation, ...page };
}

export async function listCouncilAssemblyHistory(owner: string, councilId: string, generation: string, cursor?: string): Promise<CouncilAssemblyHistoryPage> {
  const resource = { collection: 'councils', id: councilId };
  const page = await listHistoryEntries<CouncilAssemblyHistoryPage['entries'][number]>(
    owner, resource, COUNCIL_ASSEMBLY_POLICY.history, generation, cursor, 'council-gone',
  );
  return { owner, councilId, generation, ...page };
}

export async function listCouncilTopicTitleHistory(owner: string, councilId: string, generation: string, cursor?: string): Promise<CouncilTopicTitleHistoryPage> {
  const resource = { collection: 'councils', id: councilId };
  const page = await listHistoryEntries<CouncilTopicTitleHistoryPage['entries'][number]>(
    owner, resource, COUNCIL_TOPIC_TITLE_POLICY.history, generation, cursor, 'council-gone',
  );
  return { owner, councilId, generation, ...page };
}

export async function listServiceOrderPlacementHistory(owner: string, orderId: string, generation: string, cursor?: string): Promise<ServiceOrderPlacementHistoryPage> {
  const resource = { collection: 'serviceOrders', id: orderId };
  const page = await listHistoryEntries<ServiceOrderPlacementHistoryPage['entries'][number]>(
    owner, resource, SERVICE_ORDER_PLACEMENT_HISTORY, generation, cursor, 'service-order-gone',
  );
  return { owner, orderId, generation, ...page };
}

export async function listServiceOrderStepPlacementHistory(owner: string, orderId: string, generation: string, cursor?: string): Promise<ServiceOrderPlacementHistoryPage> {
  const resource = { collection: 'serviceOrders', id: orderId };
  const page = await listHistoryEntries<ServiceOrderPlacementHistoryPage['entries'][number]>(
    owner, resource, SERVICE_ORDER_STEP_PLACEMENT_HISTORY, generation, cursor, 'service-order-gone',
  );
  return { owner, orderId, generation, ...page };
}

export async function listCouncilTopicPlacementHistory(owner: string, councilId: string, generation: string,
  cursor?: string): Promise<CouncilTopicPlacementHistoryPage> {
  const page = await listHistoryEntries<CouncilTopicPlacementHistoryPage['entries'][number]>(
    owner, { collection: 'councils', id: councilId }, COUNCIL_TOPIC_PLACEMENT_HISTORY, generation, cursor, 'council-gone',
  );
  return { owner, councilId, generation, ...page };
}

export async function listSermonSourceNoteLinkHistory(owner: string, sermonId: string, generation: string, cursor?: string) {
  const page = await listHistoryEntries<{ id: string; entries: SourceNoteLinkHistoryEntry[] }>(owner,
    { collection: 'sermons', id: sermonId }, SOURCE_NOTE_LINK_HISTORY, generation, cursor, 'sermon-gone');
  return { owner, sermonId, generation, ...page };
}

export async function listSeriesItemPlacementHistory(owner: string, seriesId: string, generation: string,
  cursor?: string): Promise<SeriesItemPlacementHistoryPage> {
  const page = await listHistoryEntries<SeriesItemPlacementHistoryPage['entries'][number]>(
    owner, { collection: 'series', id: seriesId }, SERIES_ITEM_PLACEMENT_HISTORY, generation, cursor, 'series-gone',
  );
  return { owner, seriesId, generation, ...page };
}

export async function listGroupStepPlacementHistory(owner: string, groupId: string, generation: string,
  cursor?: string): Promise<GroupFlowStepPlacementHistoryPage> {
  const page = await listHistoryEntries<GroupFlowStepPlacementHistoryPage['entries'][number]>(
    owner, { collection: 'groups', id: groupId }, GROUP_STEP_PLACEMENT_HISTORY, generation, cursor, 'group-gone',
  );
  return { owner, groupId, generation, ...page };
}

export async function listServiceOrderTitleHistory(owner: string, orderId: string, generation: string, cursor?: string): Promise<ServiceOrderTitleHistoryPage> {
  const resource = { collection: 'serviceOrders', id: orderId };
  const page = await listHistoryEntries<DocumentTitleHistoryEntry>(owner, resource, DOCUMENT_TITLE_HISTORY, generation, cursor, 'service-order-gone');
  return { owner, orderId, generation, ...page };
}

export async function listPlanTemplateNameHistory(owner: string, templateId: string, generation: string, cursor?: string): Promise<PlanTemplateNameHistoryPage> {
  const resource = { collection: 'planTemplates', id: templateId };
  const page = await listHistoryEntries<DocumentTitleHistoryEntry>(owner, resource, DOCUMENT_TITLE_HISTORY, generation, cursor, 'template-gone');
  return { owner, templateId, generation, ...page };
}

export async function listCommentKindHistory(owner: string, noteId: string, generation: string, cursor?: string): Promise<CommentKindHistoryPage> {
  const resource = { collection: 'studyNotes', id: noteId };
  const page = await listHistoryEntries<CommentKindHistoryPage['entries'][number]>(owner, resource, COMMENT_KIND_HISTORY, generation, cursor, 'note-gone');
  return { owner, noteId, generation, ...page, entries: page.entries.filter(entry => typeof entry.paragraph === 'boolean'
    && typeof entry.winnerParagraph === 'boolean') };
}

export async function listStudyNoteTypeHistory(owner: string, noteId: string, generation: string, cursor?: string): Promise<StudyNoteTypeHistoryPage> {
  const resource = { collection: 'studyNotes', id: noteId };
  const page = await listHistoryEntries<StudyNoteTypeHistoryPage['entries'][number]>(owner, resource, STUDY_NOTE_TYPE_HISTORY, generation, cursor, 'note-gone');
  return { owner, noteId, generation, ...page };
}

export async function listStudyNoteReferenceHistory(owner: string, noteId: string, generation: string, cursor?: string) {
  const { entries, nextCursor } = await readHistoryEntries<{ id: string; entries: StudyNoteReferenceHistoryEntry[] }>(owner,
    { collection: 'studyNotes', id: noteId }, STUDY_NOTE_REFERENCE_HISTORY, generation, cursor, 'note-gone', false,
    async (transaction, reference, data) => {
      if (Array.isArray(data.entries)) return { id: data.id, entries: data.entries };
      const entry = await readSplitStudyNoteReferenceHistory(data.parts, data.digest, async index =>
        (await transaction.get(reference.collection(REFERENCE_HISTORY_PARTS).doc(String(index)))).data()?.json);
      if (!entry) throw new DataEngineServerError('note-reference-history-unavailable', 503);
      return { id: data.id, entries: [entry] };
    });
  return { owner, noteId, generation, entries, nextCursor };
}

export async function listStudyNoteTitleHistory(owner: string, noteId: string, generation: string, cursor?: string): Promise<StudyNoteTitleHistoryPage> {
  const resource = { collection: 'studyNotes', id: noteId };
  const page = await listHistoryEntries<StudyNoteTitleHistoryPage['entries'][number]>(owner, resource, DOCUMENT_TITLE_HISTORY, generation, cursor, 'note-gone');
  return { owner, noteId, generation, ...page };
}

export async function listPrayerTitleHistory(owner: string, prayerId: string, generation: string, cursor?: string): Promise<PrayerTitleHistoryPage> {
  const resource = { collection: 'prayerRequests', id: prayerId };
  const page = await listHistoryEntries<DocumentTitleHistoryEntry>(owner, resource, DOCUMENT_TITLE_HISTORY, generation, cursor, 'prayer-gone');
  return { owner, prayerId, generation, ...page };
}

export async function listSermonTitleHistory(owner: string, sermonId: string, generation: string, cursor?: string): Promise<SermonTitleHistoryPage> {
  const resource = { collection: 'sermons', id: sermonId };
  const page = await listHistoryEntries<DocumentTitleHistoryEntry>(owner, resource, DOCUMENT_TITLE_HISTORY, generation, cursor, 'sermon-gone');
  return { owner, sermonId, generation, ...page };
}

export async function listSermonVerseHistory(owner: string, sermonId: string, generation: string, cursor?: string): Promise<SermonVerseHistoryPage> {
  const resource = { collection: 'sermons', id: sermonId };
  const page = await listHistoryEntries<SermonVerseHistoryPage['entries'][number]>(owner, resource, SERMON_VERSE_HISTORY, generation, cursor, 'sermon-gone');
  return { owner, sermonId, generation, ...page };
}

export async function listSermonGoalTypeHistory(owner: string, sermonId: string, generation: string, cursor?: string): Promise<SermonGoalTypeHistoryPage> {
  const resource = { collection: 'sermons', id: sermonId };
  const page = await listHistoryEntries<SermonGoalTypeHistoryPage['entries'][number]>(owner, resource, SERMON_GOAL_TYPE_HISTORY, generation, cursor, 'sermon-gone');
  return { owner, sermonId, generation, ...page, entries: page.entries.filter(entry => isSermonGoalType(entry.type) && isSermonGoalType(entry.winnerType)) };
}

export async function listOutlineTitleHistory(owner: string, collection: OutlineTitleCollection, id: string, generation: string,
  cursor?: string): Promise<OutlineTitleHistoryPage> {
  if (!outlineTitlePolicy(collection)) throw new DataEngineServerError(INVALID_ARGUMENT, 400);
  const page = await listHistoryEntries<OutlineTitleHistoryPage['entries'][number]>(
    owner, { collection, id }, OUTLINE_TITLE_HISTORY, generation, cursor, collection === 'sermons' ? 'sermon-gone' : 'template-gone',
  );
  return { owner, id, generation, ...page };
}

export async function listOutlinePointPlacementHistory(owner: string, sermonId: string, generation: string, cursor?: string): Promise<OutlinePointPlacementHistoryPage> {
  const page = await listHistoryEntries<OutlinePointPlacementHistoryPage['entries'][number]>(
    owner, { collection: 'sermons', id: sermonId }, OUTLINE_POINT_PLACEMENT_HISTORY, generation, cursor, 'sermon-gone',
  );
  return { owner, sermonId, generation, ...page };
}

export async function listPlanTemplatePointPlacementHistory(owner: string, templateId: string, generation: string, cursor?: string):
  Promise<Omit<OutlinePointPlacementHistoryPage, 'sermonId'> & { templateId: string }> {
  const page = await listHistoryEntries<OutlinePointPlacementHistoryPage['entries'][number]>(
    owner, { collection: 'planTemplates', id: templateId }, OUTLINE_POINT_PLACEMENT_HISTORY, generation, cursor, 'template-gone',
  );
  return { owner, templateId, generation, ...page };
}

export async function listSermonPlanModeHistory(owner: string, sermonId: string, generation: string, cursor?: string): Promise<SermonPlanModeHistoryPage> {
  const resource = { collection: 'sermons', id: sermonId };
  const page = await listHistoryEntries<SermonPlanModeHistoryPage['entries'][number]>(owner, resource, SERMON_PLAN_MODE_HISTORY, generation, cursor, 'sermon-gone');
  return { owner, sermonId, generation, ...page, entries: page.entries.filter(entry => isSermonPlanMode(entry.planMode) && isSermonPlanMode(entry.winnerPlanMode)) };
}

export async function listHomileticPlanHistory(owner: string, sermonId: string, generation: string, cursor: string | undefined,
  list: HomileticList): Promise<HomileticHistoryPage> {
  const page = await listHistoryEntries<HomileticHistoryPage['entries'][number]>(
    owner, { collection: 'sermons', id: sermonId }, homileticHistoryCollection(list), generation, cursor, 'sermon-gone',
  );
  return { owner, sermonId, generation, list, ...page,
    entries: page.entries.map(({ id, acceptedAt, changes }) => ({ id, acceptedAt, changes })) };
}

export async function listExegeticalPointHistory(owner: string, sermonId: string, generation: string, cursor?: string): Promise<ExegeticalPointHistoryPage> {
  const resource = { collection: 'sermons', id: sermonId };
  const page = await listHistoryEntries<ExegeticalPointHistoryPage['entries'][number]>(
    owner, resource, EXEGETICAL_POINT_HISTORY, generation, cursor, 'sermon-gone',
  );
  const entries = page.entries.map(({ id, nodeId, value, winner, origin }) => ({ id, nodeId, value, winner, ...(origin === 'comparison' && { origin }) }));
  return { owner, sermonId, generation, ...page, entries };
}

export async function listSermonPreparationConfirmationHistory(
  owner: string, sermonId: string, generation: string, cursor?: string,
): Promise<SermonPreparationConfirmationHistoryPage> {
  const resource = { collection: 'sermons', id: sermonId };
  const page = await listHistoryEntries<SermonPreparationConfirmationHistoryPage['entries'][number]>(
    owner, resource, DOCUMENT_METADATA_HISTORY, generation, cursor, 'sermon-gone',
  );
  const entries = page.entries.flatMap(entry => {
    const fields = Array.isArray(entry.fields) ? entry.fields.filter(item => item && Object.hasOwn(preparationConfirmationPaths, item.field)
      && typeof item.value === 'boolean' && typeof item.winner === 'boolean') : [];
    return fields.length ? [{ id: entry.id, fields }] : [];
  });
  return { owner, sermonId, generation, ...page, entries };
}

export async function listSermonChurchHistory(owner: string, sermonId: string, generation: string, cursor?: string): Promise<SermonChurchHistoryPage> {
  const resource = { collection: 'sermons', id: sermonId };
  const page = await listHistoryEntries<SermonChurchHistoryPage['entries'][number]>(owner, resource, SERMON_CHURCH_HISTORY, generation, cursor, 'sermon-gone');
  return { owner, sermonId, generation, ...page };
}

export async function listAccountPreferenceHistory(owner: string, userId: string, generation: string, cursor?: string): Promise<AccountPreferenceHistoryPage> {
  const resource = { collection: 'users', id: userId };
  const page = await listHistoryEntries<AccountPreferenceHistoryPage['entries'][number]>(
    owner, resource, DOCUMENT_METADATA_HISTORY, generation, cursor, 'account-settings-gone',
  );
  return { owner, userId, generation, ...page };
}

export async function listTagColorHistory(owner: string, tagId: string, generation: string, cursor?: string): Promise<TagColorHistoryPage> {
  const resource = { collection: 'tags', id: tagId };
  const page = await listHistoryEntries<TagColorHistoryPage['entries'][number]>(owner, resource, DOCUMENT_METADATA_HISTORY, generation, cursor, 'tag-gone');
  return { owner, tagId, generation, ...page };
}

export async function listSeriesMetadataHistory(owner: string, seriesId: string, generation: string, cursor?: string): Promise<SeriesMetadataHistoryPage> {
  const resource = { collection: 'series', id: seriesId };
  const page = await listHistoryEntries<SeriesMetadataHistoryPage['entries'][number]>(owner, resource, DOCUMENT_METADATA_HISTORY, generation, cursor, 'series-gone');
  return { owner, seriesId, generation, ...page };
}

export async function listCouncilMetadataHistory(owner: string, councilId: string, generation: string, cursor?: string): Promise<CouncilMetadataHistoryPage> {
  const resource = { collection: 'councils', id: councilId };
  const page = await listHistoryEntries<CouncilMetadataHistoryPage['entries'][number]>(owner, resource, DOCUMENT_METADATA_HISTORY, generation, cursor, 'council-gone');
  return { owner, councilId, generation, ...page };
}

export async function listPrayerStatusHistory(owner: string, prayerId: string, generation: string, cursor?: string): Promise<PrayerStatusHistoryPage> {
  const resource = { collection: 'prayerRequests', id: prayerId };
  const page = await listHistoryEntries<PrayerStatusHistoryPage['entries'][number]>(owner, resource, DOCUMENT_METADATA_HISTORY, generation, cursor, 'prayer-gone');
  return { owner, prayerId, generation, ...page };
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
