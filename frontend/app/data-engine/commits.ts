import { advanceAtomicCommit, atomicParticipants, cancellationScope, cancelActionCommits, canCancelSavedIntent, initializeCommit, orderActionProjections, type AtomicCommitIdentity } from './atomicCommits';
import { isFirstBookMarksDraft } from './bibleMarksCreation';
import { captureBibleMarkStroke, restoreBibleMarkAncestor, withBibleMarkStroke, type CapturedBibleMarkStroke } from './bibleMarkStroke';
import { pendingCommitRetirement, retireCommitJournal } from './commitJournal';
import { CommitReceipts } from './commitReceipt';
import { captureCouncilAssembly, COUNCIL_ASSEMBLY_POLICY, matchingCouncilAssembly, type CouncilAssemblyActions } from './councilAssemblyAction';
import { COUNCIL_TOPIC_TITLE_POLICY } from './councilTopicTitleAction';
import { captureCouncilTopicTitles, matchingCouncilTopicTitles } from './councilTopicTitleAutosave';
import { capturedDateBaseline, captureDatedRowAction, datedRowTarget, existingRowDate, matchesDatedRowChange, MEETING_DATE_TARGET, replaceExistingDate, type DatedRowActionCapture, type DatedRowActionEvidence } from './datedRowAction';
import { captureDeleteOrder, deleteOrderReady, replayDeleteOrder } from './deletionOrdering';
import { captureDocumentMetadataFields, capturedDocumentField, capturePrayerStatusFields, capturePrayerTitle, captureServiceOrderTitle, documentFieldCommandAncestor, documentFieldTargets, matchesPrayerTitleRequest, uncapturedAutosaveFields, withDocumentFieldAction } from './documentFieldAction';
import { commandReferenceResources, documentReferenceResources, referenceReadiness } from './documentReferences';
import { prepareDomainCommand, requiredDomainTargets } from './domainPolicy';
import { areDifferentTabManualParents, readManualScopeIdentity } from './editorIdentity';
import { AddressedFailures, type AddressedFailure } from './failures';
import { captureMeetingFieldActions, GROUP_MEETING_FIELD_POLICY, matchingMeetingFieldActions } from './groupMeetingFieldAction';
import { capturePreachDateFields, PREACH_DATE_FIELD_POLICY } from './preachDateFieldAction';
import { capturePreachStatusActions, matchingPreachStatusActions, pendingPreachStatusActions, replacePreachStatuses } from './preachStatusAction';
import { confirmedExistingDeletion, equalValues, mergeDocumentFields, MAX_RELATION_RESOURCES } from './protocol';
import { matchingRowDetailActions, pendingRowDetailRebases } from './rowDetailCapture';
import { existingRowField, replaceExistingRowField } from './rowFieldAction';
import { capturePlanTextEvidence, type PlanTextEvidence } from './sermonPlanText';
import { captureServiceOrderStep, matchesServiceOrderStep, SERVICE_ORDER_FLAG_POLICY, SERVICE_ORDER_FLAG_TARGET, SERVICE_ORDER_STEP_TITLE_POLICY, SERVICE_ORDER_STEP_TITLE_TARGET, type ServiceOrderFlagActions, type ServiceOrderStepTitleActions } from './serviceOrderStepAction';
import { coversCommittedEffect } from './snapshotFreshness';

import type { CaptureTransferProof, CaptureTransferResult } from './captureTransfer';
import type { DocumentWriteReceipt } from './commitReceipt';
import type { EditorRecord } from './controller';
import type { CouncilFieldActions } from './councilFieldAction';
import type { CouncilTopicTitleActions } from './councilTopicTitleAutosave';
import type { DocumentFieldAction, DocumentFieldObservation, SermonChurchObservation } from './documentFieldAction';
import type { GroupMeetingFieldActions, GroupMeetingFieldCaptures } from './groupMeetingFieldAction';
import type { PrayerStatusObservations } from './prayerStatusAction';
import type { PreachDateFieldActions, PreachDateFieldSave } from './preachDateFieldAction';
import type { PreachStatusAction, PreachStatusCapture } from './preachStatusAction';
import type { DataEngineRuntime } from './runtime';
import type { SeriesFieldObservations } from './seriesFieldAction';
import type { SermonChurchFill } from './sermonChurchFill';
import type { SessionCheckpoint } from './session';
import type { CommandResult, DataCommand, DocumentData, EditorCommitAction, EngineMetadata, ResourceRef, ResourceSnapshot } from './types';

export interface CommitRequest extends CouncilFieldActions, PrayerStatusObservations, CouncilTopicTitleActions {
  id: string;
  atomic?: AtomicCommitIdentity;
  /** A durable stage owns capture before it can persist the resulting request IDs. */
  retentionScope?: string;
  /** Present only when the native store captured a replacement and retired its sources atomically. */
  transferredFrom?: CaptureTransferProof;
  /** Technical ownership transfer, distinct from the person choosing a stored version. */
  transferredTo?: { requestId: string; resource: ResourceRef };
  /** Whole-action discard removes membership intent while retaining later metadata edits. */
  cancelledByAction?: boolean;
  /**
   * Cancelled because the person chose about exactly this request — the deciding editor held it
   * and showed it — not swept along as a dependent of someone else's choice. A closed checkpoint
   * whose latest request was decided this way waits for nothing (`reconcileRecoveryRecord`).
   */
  cancelledByChoice?: boolean;
  /** A later dependent stopped by an exact choice has its own durable recovery copy. */
  retainedAfterChoice?: true;
  owner: string;
  editorId: string;
  editGeneration: number;
  baseline: ResourceSnapshot;
  value: DocumentData | null;
  predecessor: string | null;
  /** Immutable evidence taken before this action leaves its editor. */
  planTextEvidence?: PlanTextEvidence;
  preachDateAction?: DatedRowActionEvidence;
  meetingDateAction?: DatedRowActionEvidence;
  groupMeetingFieldActions?: GroupMeetingFieldActions;
  preachDateFieldActions?: PreachDateFieldActions;
  preachStatusActions?: PreachStatusAction[];
  deferPreachDateRebase?: true;
  bibleMarkStroke?: CapturedBibleMarkStroke;
  deferBibleMarkRebase?: true;
  serviceOrderTitleAction?: DocumentFieldAction;
  serviceOrderFlagActions?: ServiceOrderFlagActions;
  councilAssemblyActions?: CouncilAssemblyActions;
  serviceOrderStepTitleActions?: ServiceOrderStepTitleActions;
  prayerTitleAction?: DocumentFieldObservation;
  sermonTitleAction?: DocumentFieldObservation;
  sermonVerseAction?: DocumentFieldObservation;
  sermonChurchAction?: SermonChurchObservation;
  sermonChurchFill?: SermonChurchFill;
  seriesFieldActions?: SeriesFieldObservations;
  groupTitleAction?: DocumentFieldAction;
  groupStatusAction?: DocumentFieldAction;
  /** Earlier locally captured uses of this resource; owned atomically by DELETE capture storage. */
  deleteAfter?: string[];
  revision: number;
  initialized: boolean;
  working: ResourceSnapshot;
  intended: DocumentData | null;
  command: DataCommand | null;
  submitted: DocumentData | null;
  sequence: number;
  state: 'queued' | 'prepared' | 'acknowledged' | 'conflict' | 'refused' | 'cancelled';
  result: CommandResult | null;
  /** Journal cleanup owned durably by this request, including explicit cancellation. */
  unfinalized: string[];
}

export interface ManualChoiceRecovery {
  rootId: string;
  requestIds: string[];
  tipId: string;
  stored: ResourceSnapshot;
}

export type ChoiceCheckpoint = EditorRecord | EditorRecord[] | {
  editorRecords: EditorRecord[];
  manualRecoveries: ManualChoiceRecovery[];
};

export interface CommitStore {
  list(owner: string): Promise<CommitRequest[]>;
  /** Full cancellation evidence is needed only if this owner has an analysis action. */
  listForAnalysisRecovery?(owner: string): Promise<CommitRequest[]>;
  /** Read the current rows for a known operation without opening the rest of the queue. */
  readByIds?(owner: string, ids: readonly string[]): Promise<CommitRequest[]>;
  /** Return exact rows only while the snapshot contains every current request identity. */
  readChainStep?(owner: string, knownIds: ReadonlySet<string>, ids: readonly string[]): Promise<CommitRequest[] | null>;
  /** Atomically unique by owner/editor/generation. Repeats return the original request. */
  create(request: CommitRequest): Promise<CommitRequest>;
  /** Native adapters capture the exact checkpoint and canonical request in one transaction. */
  createWithCheckpoint?(request: CommitRequest, project: (saved: CommitRequest) => EditorRecord): Promise<CommitRequest>;
  /** Exact replacement capture and refused-source retirement share one native transaction. */
  createWithTransfer?(request: CommitRequest, project: (saved: CommitRequest) => EditorRecord,
    sources: readonly CommitRequest[]): Promise<CaptureTransferResult>;
  /** Atomically compares revision, then increments it. A loser must reload. */
  compareAndSet(previous: CommitRequest, next: CommitRequest): Promise<CommitRequest>;
  /** Atomic participant capture; custom document-only ports may omit this capability. */
  createBatch?(requests: readonly CommitRequest[]): Promise<CommitRequest[]>;
  /** Release a completed participant projection after its confirmed copy is durable elsewhere. */
  releaseProjection?(owner: string, ids: readonly string[]): Promise<void>;
  /** Requests still held by their exact durable capture references. */
  listCaptures?(owner: string, scopePrefix: string): Promise<CommitRequest[]>;
  /** Release only this owner/scope/request hold, then use the shared collector. */
  releaseCapture?(owner: string, scope: string, requestId: string): Promise<void>;
  /** All revisions win together, or no participant changes. */
  /** With choice roots, reject if the full dependency scope differs from the batch in the same transaction. */
  compareAndSetBatch?(changes: readonly { previous: CommitRequest; next: CommitRequest }[],
    choiceRequestIds?: readonly string[]): Promise<CommitRequest[]>;
  /** Cancellation and its chosen editor projection commit together, or neither is published. */
  compareAndSetWithCheckpoint?(changes: readonly { previous: CommitRequest; next: CommitRequest }[],
    project: (saved: CommitRequest[]) => ChoiceCheckpoint, choiceRequestIds?: readonly string[]): Promise<CommitRequest[]>;
}

export function assertCommitIdentities(requests: readonly CommitRequest[]): void {
  if (!requests.length) return;
  const owner = requests[0].owner;
  const identities = new Set(requests.map(request => request.id));
  const generations = new Set(requests.map(request => JSON.stringify([request.editorId, request.editGeneration])));
  if (requests.some(request => request.owner !== owner) || identities.size !== requests.length || generations.size !== requests.length) {
    throw new Error('Atomic commit participants must have one owner and distinct identities');
  }
}

export function assertCommitBatch(requests: readonly CommitRequest[]): void {
  assertCommitIdentities(requests);
  const identities = new Set(requests.map(request => request.id));
  if (requests.some(request => request.predecessor && identities.has(request.predecessor))) {
    throw new Error('Atomic participants cannot depend on each other');
  }
}

export interface AtomicCapture { editorId: string; captured: SessionCheckpoint; predecessorId?: string | null; retentionScope?: string }

export interface CommitEvent { request: CommitRequest }
export type TrackCommitAnswer = (request: CommitRequest, apply: (result: CommandResult) => Promise<boolean>) => void;
export function assertCommitCapture(current: CommitRequest, incoming: CommitRequest): void {
  if (current.owner !== incoming.owner || current.editorId !== incoming.editorId || current.editGeneration !== incoming.editGeneration
    || current.predecessor !== incoming.predecessor || !equalValues(current.baseline, incoming.baseline)
    || !equalValues(current.planTextEvidence ?? null, incoming.planTextEvidence ?? null)
    || !equalValues(current.serviceOrderTitleAction ?? null, incoming.serviceOrderTitleAction ?? null)
    || !equalValues(current.serviceOrderFlagActions ?? null, incoming.serviceOrderFlagActions ?? null)
    || !equalValues(current.serviceOrderStepTitleActions ?? null, incoming.serviceOrderStepTitleActions ?? null)
    || !equalValues(current.councilTopicTitleActions ?? null, incoming.councilTopicTitleActions ?? null)
    || !equalValues(current.councilAssemblyActions ?? null, incoming.councilAssemblyActions ?? null)
    || !equalValues(current.prayerTitleAction ?? null, incoming.prayerTitleAction ?? null)
    || !equalValues(current.prayerStatusAction ?? null, incoming.prayerStatusAction ?? null)
    || !equalValues(current.prayerAnsweredAtAction ?? null, incoming.prayerAnsweredAtAction ?? null)
    || !equalValues(current.sermonTitleAction ?? null, incoming.sermonTitleAction ?? null)
    || !equalValues(current.sermonVerseAction ?? null, incoming.sermonVerseAction ?? null)
    || !equalValues(current.sermonChurchAction ?? null, incoming.sermonChurchAction ?? null)
    || !equalValues(current.sermonChurchFill ?? null, incoming.sermonChurchFill ?? null)
    || !equalValues(current.seriesFieldActions ?? null, incoming.seriesFieldActions ?? null)
    || !equalValues(current.groupTitleAction ?? null, incoming.groupTitleAction ?? null)
    || !equalValues(current.groupStatusAction ?? null, incoming.groupStatusAction ?? null)
    || !equalValues(current.councilTitleAction ?? null, incoming.councilTitleAction ?? null)
    || !equalValues(current.councilDateAction ?? null, incoming.councilDateAction ?? null)
    || !equalValues(current.councilLifecycleAction ?? null, incoming.councilLifecycleAction ?? null)
    || !equalValues(current.bibleMarkStroke ?? null, incoming.bibleMarkStroke ?? null)
    || !equalValues(current.preachDateAction ?? null, incoming.preachDateAction ?? null)
    || !equalValues(current.meetingDateAction ?? null, incoming.meetingDateAction ?? null)
    || !equalValues(current.groupMeetingFieldActions ?? null, incoming.groupMeetingFieldActions ?? null)
    || !equalValues(current.preachDateFieldActions ?? null, incoming.preachDateFieldActions ?? null)
    || !equalValues(current.preachStatusActions ?? null, incoming.preachStatusActions ?? null)
    || !equalValues(current.value, incoming.value) || !equalValues(current.atomic ?? null, incoming.atomic ?? null)
    || !equalValues(current.deleteAfter ?? null, incoming.deleteAfter ?? null)
    || current.retentionScope !== incoming.retentionScope
    || !equalValues(current.transferredFrom ?? null, incoming.transferredFrom ?? null)) throw new Error('Saved generation cannot change its captured intent');
}
const AUTHENTICATION_REQUIRED = 'Authentication required';
const COMMIT_CHANGED = 'commit-changed';
const INVALID_PREDECESSOR_REQUEST = 'Invalid predecessor request';
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const terminal = (request: CommitRequest) => ['acknowledged', 'conflict', 'refused', 'cancelled'].includes(request.state);
const resourceMatches = (a: ResourceRef, b: ResourceRef) => a.collection === b.collection && a.id === b.id;
function retainedDeletionReply(record: CommitRequest): CommandResult | null {
  if (record.state !== 'conflict' || !record.command || record.result?.kind !== 'deleted'
    || record.result.operationId !== record.id) return null;
  // Earlier clients stored the terminal reply under the durable request identity.
  const answer = { ...record.result, operationId: record.command.operationId };
  return confirmedExistingDeletion(record.command, answer);
}

export const orderCommitRequests = (records: CommitRequest[]): CommitRequest[] => {
  const byId = new Map(records.map(record => [record.id, record]));
  const dependents = new Map<string, CommitRequest[]>();
  const ordered: CommitRequest[] = [];
  for (const record of records) {
    if (record.predecessor && byId.has(record.predecessor)) dependents.set(record.predecessor, [...(dependents.get(record.predecessor) ?? []), record]);
    else ordered.push(record);
  }
  for (let index = 0; index < ordered.length; index += 1) ordered.push(...(dependents.get(ordered[index].id) ?? []));
  if (ordered.length !== records.length) throw new Error('Invalid commit dependency cycle');
  return ordered;
};

function hasExternalIntent(snapshot: ResourceSnapshot, intended: DocumentData | null): boolean {
  return Boolean(documentReferenceResources(snapshot.resource, snapshot.value, intended).length
    || requiredDomainTargets(snapshot, intended).length);
}

type DeliveryChains = {
  knownIds: ReadonlySet<string>;
  groups: CommitRequest[][];
  next: number;
};

/** Existing-document chains are independent only when each resource has one linear editor queue. */
function ordinaryDeliveryChains(records: readonly CommitRequest[]): DeliveryChains | null {
  const byResource = new Map<string, CommitRequest[]>();
  for (const record of records) {
    if (terminal(record) && !record.unfinalized.length) continue;
    if (record.atomic || record.deleteAfter !== undefined || !record.baseline.value || !record.value) return null;
    const { collection, id } = record.baseline.resource;
    const key = JSON.stringify([collection, id]);
    const group = byResource.get(key) ?? [];
    group.push(record);
    byResource.set(key, group);
  }
  const groups = [...byResource.values()];
  if (!groups.some(group => group.length > 1)) return null;
  for (const group of groups) {
    group.sort((a, b) => a.editGeneration - b.editGeneration);
    if (group.slice(1).some((record, index) => record.editorId !== group[0].editorId
      || record.state !== 'queued' || record.initialized || record.unfinalized.length || record.predecessor !== group[index].id)) return null;
  }
  return { knownIds: new Set(records.map(record => record.id)), groups, next: 1 };
}

type CommitSaveOptions = { predecessorId?: string | null; predecessorIds?: readonly string[]; retentionScope?: string;
  preachDateAction?: DatedRowActionCapture;
  meetingDateAction?: DatedRowActionCapture;
  groupMeetingFieldCaptures?: GroupMeetingFieldCaptures;
  preachDateFieldSave?: PreachDateFieldSave;
  preachStatusCapture?: PreachStatusCapture;
  documentMetadataTime?: import('./actionClock').ActionTime | null;
  action?: EditorCommitAction;
  checkpoint?: (saved: CommitRequest) => EditorRecord;
  transfer?: { proof: CaptureTransferProof; sources: readonly CommitRequest[] } };

function pendingBibleMarkRebase(record: CommitRequest): CapturedBibleMarkStroke | undefined {
  return record.deferBibleMarkRebase && record.sequence === 0 ? record.bibleMarkStroke : undefined;
}

function pendingMeetingDateRebase(record: CommitRequest): DatedRowActionEvidence | undefined {
  const action = record.sequence === 0 ? record.meetingDateAction : undefined;
  if (!action || !record.working.value || record.working.metadata?.generation !== record.baseline.metadata?.generation
    || existingRowDate(record.working.value.meetingDates, action.rowId, MEETING_DATE_TARGET) === undefined
    || existingRowDate(record.intended?.meetingDates, action.rowId, MEETING_DATE_TARGET) !== action.after) return undefined;
  return action;
}

function pendingRowFields(record: CommitRequest) {
  return [
    ...pendingRowDetailRebases(record, record.groupMeetingFieldActions, GROUP_MEETING_FIELD_POLICY),
    ...pendingRowDetailRebases(record, record.preachDateFieldActions, PREACH_DATE_FIELD_POLICY),
    ...pendingRowDetailRebases(record, record.serviceOrderFlagActions, SERVICE_ORDER_FLAG_POLICY),
    ...pendingRowDetailRebases(record, record.serviceOrderStepTitleActions, SERVICE_ORDER_STEP_TITLE_POLICY),
    ...pendingRowDetailRebases(record, record.councilAssemblyActions, COUNCIL_ASSEMBLY_POLICY),
    ...(record.councilTopicTitleActions ?? []).flatMap(title => pendingRowDetailRebases(record, { title }, COUNCIL_TOPIC_TITLE_POLICY)),
  ];
}

function hasTimedAncestor(record: CommitRequest): boolean {
  return record.sequence === 0 && Boolean(record.serviceOrderTitleAction || record.prayerTitleAction || record.prayerStatusAction || record.prayerAnsweredAtAction || record.sermonTitleAction || record.sermonVerseAction || record.sermonChurchAction || record.seriesFieldActions || record.groupTitleAction || record.groupStatusAction || record.councilTitleAction || record.councilDateAction || record.councilLifecycleAction || pendingBibleMarkRebase(record) || pendingMeetingDateRebase(record) || pendingRowFields(record).length || pendingPreachStatusActions(record).length);
}

function freezeSaveOptions(options: CommitSaveOptions | undefined): CommitSaveOptions | undefined {
  return options && { ...options, predecessorIds: options.predecessorIds && [...options.predecessorIds],
    transfer: options.transfer && clone(options.transfer), preachDateAction: options.preachDateAction && clone(options.preachDateAction),
    meetingDateAction: options.meetingDateAction && clone(options.meetingDateAction),
    groupMeetingFieldCaptures: options.groupMeetingFieldCaptures && clone(options.groupMeetingFieldCaptures),
    preachDateFieldSave: options.preachDateFieldSave && clone(options.preachDateFieldSave),
    preachStatusCapture: options.preachStatusCapture && clone(options.preachStatusCapture),
    documentMetadataTime: options.documentMetadataTime && clone(options.documentMetadataTime),
    action: options.action && clone(options.action) };
}

/** Equal parent generations still have an exact order in the durable dependency chain. */
function selectCandidatePredecessor(records: readonly CommitRequest[], ids: readonly string[], owner: string, resource: ResourceRef): CommitRequest {
  const remaining = new Set(ids);
  const candidates = records.filter(record => remaining.has(record.id));
  if (!remaining.size || candidates.length !== remaining.size || candidates.some(record => record.owner !== owner
    || record.state === 'cancelled' || !resourceMatches(record.baseline.resource, resource))) throw new Error(INVALID_PREDECESSOR_REQUEST);
  const latest = orderCommitRequests([...records]).filter(record => remaining.has(record.id)).at(-1)!;
  const byId = new Map(records.map(record => [record.id, record]));
  let cursor: CommitRequest | undefined = latest;
  while (cursor) {
    remaining.delete(cursor.id);
    cursor = cursor.predecessor ? byId.get(cursor.predecessor) : undefined;
  }
  if (remaining.size) throw new Error(INVALID_PREDECESSOR_REQUEST);
  return latest;
}

function selectSavePredecessor(records: readonly CommitRequest[], owner: string, editorId: string, resource: ResourceRef, options?: CommitSaveOptions): CommitRequest | undefined {
  if (options?.predecessorIds) {
    if (options.predecessorId !== undefined) throw new Error(INVALID_PREDECESSOR_REQUEST);
    return selectCandidatePredecessor(records, options.predecessorIds, owner, resource);
  }
  if (options?.predecessorId === null) return undefined;
  if (options?.predecessorId) {
    const predecessor = records.find(record => record.id === options.predecessorId);
    if (!predecessor || predecessor.owner !== owner || predecessor.state === 'cancelled'
      || !resourceMatches(predecessor.baseline.resource, resource)) throw new Error(INVALID_PREDECESSOR_REQUEST);
    return predecessor;
  }
  return records.filter(record => record.editorId === editorId && record.state !== 'cancelled')
    .sort((a, b) => b.editGeneration - a.editGeneration)[0];
}

function captureSermonPlan(baseline: ResourceSnapshot, draft: DocumentData | null, predecessor?: CommitRequest): PlanTextEvidence {
  const ack = predecessor?.result?.kind === 'acknowledged' ? predecessor.result : undefined;
  const effect = ack?.committed ?? ack?.snapshot.metadata;
  // If this action already observed the ACK, use its captured baseline. Otherwise the earlier
  // local action's value is known, and a later ACK could contain unseen words.
  const alreadyObserved = effect && coversCommittedEffect(baseline, baseline.resource, effect);
  return capturePlanTextEvidence({ before: alreadyObserved ? baseline.value : predecessor?.value ?? baseline.value, after: draft });
}

/** Saved intent lives independently of editors. Only this queue prepares its commands. */
export class CommitQueue {
  private owner: string | null = null;
  private generation = 0;
  private listeners = new Set<(event: CommitEvent) => void>();
  private emittedRevisions = new Map<string, number>();
  private readonly receipts = new CommitReceipts(assertCommitCapture);
  private running: Promise<void> | null = null;
  private runningGeneration = 0;
  private requested = false;
  private deliveryRequested = false;

  constructor(private readonly options: {
    store: CommitStore;
    runtime: DataEngineRuntime;
    operationId: () => string;
    readConfirmed: (resource: ResourceRef) => Promise<ResourceSnapshot>;
    /** A fresh write prerequisite; null defers preparation while offline. */
    readWriteTarget?: (resource: ResourceRef) => Promise<ResourceSnapshot | null>;
    readCommitted?: (resource: ResourceRef, proof: EngineMetadata) => Promise<ResourceSnapshot>;
    canDeliver?: () => boolean;
  }) {}

  setOwner(owner: string | null): void {
    if (owner !== this.owner) { this.receipts.reset(); this.emittedRevisions.clear(); this.owner = owner; this.generation += 1; }
  }

  subscribe(listener: (event: CommitEvent) => void): () => void {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  }

  async list(): Promise<CommitRequest[]> {
    const owner = this.owner, generation = this.generation;
    if (!owner) return [];
    const records = await this.options.store.list(owner);
    if (!this.current(owner, generation)) return [];
    records.forEach(request => this.receipts.observe(request));
    return orderCommitRequests(records);
  }

  /** Reread device captures on return, without preparing commands or asking the server. */
  async refreshStored(): Promise<CommitRequest[]> {
    const owner = this.owner, generation = this.generation;
    const requests = await this.list();
    if (!owner || !this.current(owner, generation)) return [];
    for (const request of orderActionProjections(requests)) {
      if (!this.current(owner, generation)) return [];
      // A previous read may have found private typing or an active form. Retry admission
      // on return even at the same version; emit still refuses an older delivery state.
      this.emit(request);
    }
    return requests;
  }

  /** Opt-in acceptance proof; ordinary save keeps its local-capture contract. */
  saveWithReceipt(editorId: string, captured: SessionCheckpoint, options?: CommitSaveOptions): Promise<{ request: CommitRequest | null; receipt: DocumentWriteReceipt }> {
    if (!this.owner) return Promise.reject(new Error(AUTHENTICATION_REQUIRED));
    const owner = this.owner, generation = this.generation;
    return this.receipts.capture(owner, editorId, captured, () => this.save(editorId, captured, options), async () => {
      const requests = await this.list(); this.assertCurrent(owner, generation);
      return !requests.some(request => resourceMatches(request.baseline.resource, captured.confirmed.resource)
        && !['acknowledged', 'cancelled'].includes(request.state));
    });
  }

  async save(editorId: string, captured: SessionCheckpoint, options?: CommitSaveOptions): Promise<CommitRequest | null> {
    const owner = this.owner, generation = this.generation;
    if (!owner) throw new Error(AUTHENTICATION_REQUIRED);
    return this.captureSaved(owner, editorId, captured, options, () => this.assertCurrent(owner, generation), saved => {
      this.emit(saved); this.requested = true;
    });
  }

  /** Admit exactly these immutable words now; later retirement may finish only their local capture. */
  admitSave(editorId: string, captured: SessionCheckpoint): (options?: CommitSaveOptions) => Promise<CommitRequest | null> {
    const owner = this.owner, generation = this.generation;
    if (!owner) throw new Error(AUTHENTICATION_REQUIRED);
    const frozen = clone(captured);
    return options => this.captureSaved(owner, editorId, frozen, options, () => undefined, saved => {
      if (this.current(owner, generation)) { this.emit(saved); this.requested = true; }
    });
  }

  private async captureSaved(owner: string, editorId: string, captured: SessionCheckpoint, options: CommitSaveOptions | undefined,
    check: () => void, publish: (request: CommitRequest) => void): Promise<CommitRequest | null> {
    const intent = clone(captured);
    const frozenOptions = freezeSaveOptions(options);
    if (frozenOptions?.transfer && (!this.options.store.createWithTransfer || !frozenOptions.checkpoint)) {
      throw new Error('Atomic capture transfer storage is required');
    }
    const capture = async (record: CommitRequest): Promise<CaptureTransferResult> => frozenOptions?.transfer
      ? this.options.store.createWithTransfer!(record, frozenOptions.checkpoint!, frozenOptions.transfer.sources)
      : { request: await this.captureRequest(record, frozenOptions?.checkpoint), retired: [] };
    const records = await this.options.store.list(owner);
    check();
    const existing = records.find(record => record.editorId === editorId && record.editGeneration === intent.editGeneration);
    const predecessor = selectSavePredecessor(records, owner, editorId, intent.confirmed.resource, frozenOptions);
    if (existing) {
      if (existing.retentionScope !== frozenOptions?.retentionScope
        || !equalValues(existing.transferredFrom ?? null, frozenOptions?.transfer?.proof ?? null)) throw new Error('Saved capture retention cannot change');
      if (intent.dirty && !equalValues(existing.value, intent.draft)) throw new Error('Saved generation cannot change its captured intent');
      const result = frozenOptions?.checkpoint ? await capture(existing) : { request: existing, retired: [] };
      check();
      result.retired.forEach(publish);
      return clone(result.request);
    }
    const editorAction = frozenOptions?.action;
    const step = editorAction?.kind === 'service-order-flag' ? { field: 'flagged' as const, change: editorAction.flag }
      : editorAction?.kind === 'service-order-step-title' ? { field: 'title' as const, change: editorAction.title } : undefined;
    const assembly = editorAction?.kind === 'council-assembly' ? editorAction.flag : undefined;
    if (!step && !assembly && editorAction?.kind !== 'service-order-title' && editorAction?.kind !== 'prayer-title' && editorAction?.kind !== 'prayer-status'
      && !frozenOptions?.transfer && !intent.dirty && (!predecessor || equalValues(predecessor.value, intent.draft))) return null;
    if (intent.conflicts.length) throw Object.assign(new Error('Resolve the conflict before saving'), { code: 'resolve-version-first' });
    const baseline = clone(intent.confirmed);
    const planTextEvidence = baseline.resource.collection === 'sermons' ? captureSermonPlan(baseline, intent.draft, predecessor) : undefined;
    const dateTarget = datedRowTarget(baseline.resource.collection);
    const action = dateTarget && captureDatedRowAction(baseline, predecessor, intent.draft, frozenOptions?.[dateTarget.evidence]);
    const mark = captureBibleMarkStroke(baseline, predecessor, intent.draft, editorAction?.kind === 'bible-mark-stroke' ? editorAction.time : undefined);
    const title = captureServiceOrderTitle(baseline, intent.draft, editorAction?.kind === 'service-order-title' ? editorAction.title : undefined);
    const stepActions = captureServiceOrderStep(baseline, predecessor, intent.draft, step, records);
    const councilAssemblyActions = captureCouncilAssembly(baseline, predecessor, intent.draft, assembly, records);
    const prayerCapture = editorAction?.kind === 'prayer-title' ? editorAction.title : undefined;
    const prayerPredecessor = prayerCapture?.seen.requestId
      ? matchesPrayerTitleRequest(records.find(record => record.id === prayerCapture.seen.requestId), owner, baseline.resource, prayerCapture.seen) : false;
    const prayerTitle = capturePrayerTitle(baseline, intent.draft, prayerCapture, prayerPredecessor);
    const prayerStatus = capturePrayerStatusFields(baseline, predecessor, intent.draft,
      editorAction?.kind === 'prayer-status' ? editorAction.status : undefined, records, owner);
    const metadataFields = captureDocumentMetadataFields(baseline, predecessor, intent.draft, frozenOptions?.documentMetadataTime, records);
    const autosaveFields = uncapturedAutosaveFields(intent, baseline, predecessor, records);
    const topicTitles = captureCouncilTopicTitles(intent, baseline, predecessor, records);
    const groupMeetingFieldActions = captureMeetingFieldActions(baseline, predecessor, intent.draft, frozenOptions?.groupMeetingFieldCaptures, records);
    const preachDateFieldActions = capturePreachDateFields(baseline, predecessor, intent.draft, frozenOptions?.preachDateFieldSave, records);
    const preachStatusActions = capturePreachStatusActions(baseline, predecessor, intent.draft, frozenOptions?.preachStatusCapture, records);
    const record: CommitRequest = {
      id: this.options.operationId(), owner, editorId, editGeneration: intent.editGeneration,
      ...(mark && { bibleMarkStroke: mark }),
      ...(title && { serviceOrderTitleAction: title }),
      ...stepActions,
      ...(councilAssemblyActions && { councilAssemblyActions }),
      ...(prayerTitle && { prayerTitleAction: prayerTitle }),
      ...prayerStatus,
      ...metadataFields,
      ...autosaveFields,
      ...(topicTitles.length && { councilTopicTitleActions: topicTitles }),
      ...(groupMeetingFieldActions && { groupMeetingFieldActions }),
      ...(preachDateFieldActions && { preachDateFieldActions }),
      ...(preachStatusActions && { preachStatusActions }),
      ...(dateTarget && action && { [dateTarget.evidence]: action }),
      ...(frozenOptions?.retentionScope ? { retentionScope: frozenOptions.retentionScope } : {}),
      ...(frozenOptions?.transfer ? { transferredFrom: clone(frozenOptions.transfer.proof) } : {}),
      baseline, value: clone(intent.draft), predecessor: predecessor?.id ?? null,
      ...(planTextEvidence ? { planTextEvidence } : {}),
      revision: 0, initialized: false, working: baseline, intended: clone(intent.draft),
      command: null, submitted: null, sequence: 0, state: 'queued', result: null, unfinalized: [],
    };
    const result = await capture(record);
    check();
    result.retired.forEach(publish);
    publish(result.request);
    return clone(result.request);
  }

  private async captureRequest(record: CommitRequest, checkpoint?: (saved: CommitRequest) => EditorRecord): Promise<CommitRequest> {
    if (checkpoint && this.options.store.createWithCheckpoint) return this.options.store.createWithCheckpoint(record, checkpoint);
    // Custom document-only ports project afterward, without native atomicity.
    return this.options.store.create(record);
  }

  /** Internal capture for a relation touching several resources; transport remains in this queue. */
  async saveAtomic(captures: readonly AtomicCapture[]): Promise<CommitRequest[]> {
    const owner = this.owner, generation = this.generation;
    if (!owner) throw new Error(AUTHENTICATION_REQUIRED);
    if (!this.options.store.createBatch || !this.options.store.compareAndSetBatch) throw new Error('Atomic commit storage is required');
    const frozen = clone(captures);
    const creation = frozen.length === 2 && ['sermons', 'groups'].includes(frozen[0].captured.confirmed.resource.collection)
      && frozen[0].captured.confirmed.value === null && frozen[0].captured.confirmed.metadata === null
      && frozen[0].captured.draft !== null && frozen[0].predecessorId === null;
    const councilCarry = frozen.length === 2 && frozen.every(item => item.captured.confirmed.resource.collection === 'councils')
      && frozen[0].captured.confirmed.value !== null && frozen.every(item => item.captured.draft !== null)
      && (frozen[1].captured.confirmed.value !== null || frozen[1].captured.confirmed.metadata === null);
    const analysisReshape = frozen.length >= 2 && frozen.length <= 3
      && frozen.every(item => item.captured.confirmed.resource.collection === 'studyNotes' && item.captured.draft !== null
        && !item.captured.confirmed.metadata?.deleted && (item.captured.confirmed.value !== null || item.captured.confirmed.metadata === null))
      && frozen[0].captured.confirmed.value !== null;
    if (frozen.length < 2 || frozen.length > MAX_RELATION_RESOURCES
      || new Set(frozen.map(item => JSON.stringify(item.captured.confirmed.resource))).size !== frozen.length
      || frozen.some((item, index) => item.captured.conflicts.length || (!(creation && index === 0)
        && !councilCarry && !analysisReshape && item.captured.confirmed.resource.collection !== 'series'))) throw new Error('Invalid atomic relation capture');
    if (frozen.some(item => (item.captured.confirmed.value && item.captured.confirmed.value.userId !== owner)
      || (item.captured.draft && item.captured.draft.userId !== owner))) throw new Error('Atomic capture belongs to another owner');
    const records = await this.options.store.list(owner); this.assertCurrent(owner, generation);
    const repeated = (available: CommitRequest[]): CommitRequest[] | null => {
      const existing = frozen.map(item => available.find(record => record.editorId === item.editorId && record.editGeneration === item.captured.editGeneration));
      if (!existing.some(Boolean)) return null;
      if (!existing.every(Boolean) || !existing[0]!.atomic || existing.some(record => !equalValues(existing[0]!.atomic, record!.atomic))
        || !equalValues(existing[0]!.atomic.participants, existing.map(record => record!.id))
        || existing.some((record, index) => !equalValues(record!.baseline, frozen[index].captured.confirmed) || !equalValues(record!.value, frozen[index].captured.draft)
          || frozen[index].retentionScope !== record!.retentionScope
          || (frozen[index].predecessorId !== undefined && frozen[index].predecessorId !== record!.predecessor))) throw new Error('Saved atomic capture cannot change');
      return clone(existing as CommitRequest[]);
    };
    const existing = repeated(records); if (existing) return existing;
    const id = this.options.operationId();
    const atomic: AtomicCommitIdentity = { id, participants: frozen.map((_, index) => index === 0 ? id : `${id}-participant-${index}`),
      ...(creation ? { kind: 'create-member' as const } : councilCarry ? { kind: 'council-carry' as const } : analysisReshape ? { kind: 'analysis-reshape' as const } : {}) };
    const requests = frozen.map((item, index): CommitRequest => {
      const predecessors = records.filter(record => record.editorId === item.editorId && record.state !== 'cancelled');
      const predecessor = item.predecessorId === null ? undefined : item.predecessorId ? records.find(record => record.id === item.predecessorId)
        : predecessors.sort((a, b) => b.editGeneration - a.editGeneration)[0];
      if ((item.predecessorId && !predecessor) || (predecessor && (predecessor.owner !== owner || predecessor.state === 'cancelled'
        || !resourceMatches(predecessor.baseline.resource, item.captured.confirmed.resource)))) throw new Error(INVALID_PREDECESSOR_REQUEST);
      const baseline = item.captured.confirmed;
      return { id: atomic.participants[index], atomic, owner, editorId: item.editorId, editGeneration: item.captured.editGeneration,
        ...(item.retentionScope ? { retentionScope: item.retentionScope } : {}),
        baseline, value: item.captured.draft, predecessor: predecessor?.id ?? null, revision: 0, initialized: false,
        working: baseline, intended: item.captured.draft, command: null, submitted: null, sequence: 0, state: 'queued', result: null, unfinalized: [] };
    });
    let saved: CommitRequest[];
    try { saved = await this.options.store.createBatch(requests); }
    catch (error) {
      // Two tabs can choose identities before either capture commits. The winning
      // immutable group is authoritative; only an exact capture may adopt it.
      const available = await this.options.store.list(owner); this.assertCurrent(owner, generation);
      const winner = repeated(available); if (!winner) throw error;
      saved = winner;
    }
    this.assertCurrent(owner, generation);
    saved.forEach(record => this.emit(record)); this.requested = true; return clone(saved);
  }

  /** Local preparation is permitted offline; transport delivery follows engine lifecycle. */
  async drain(deliver: boolean): Promise<void> {
    this.requested = true;
    this.deliveryRequested ||= deliver;
    if (this.running) {
      const generation = this.runningGeneration;
      try { await this.running; } catch (error) { if (generation === this.generation) throw error; }
      if (this.requested || generation !== this.generation) return this.drain(deliver);
      return;
    }
    const owner = this.owner, generation = this.generation;
    if (!owner) { this.requested = false; return; }
    const run = async () => {
      let races = 0;
      const attempted = new Set<string>();
      const failures = new Map<string, AddressedFailure>();
      let chains: DeliveryChains | null = null;
      do {
        this.requested = false;
        const step: CommitRequest[] | null = chains && await this.readChainStep(owner, chains);
        this.assertCurrent(owner, generation);
        const records: CommitRequest[] = step ?? await this.options.store.list(owner);
        this.assertCurrent(owner, generation);
        if (step && chains) chains.next += 1;
        else chains = this.deliveryRequested && this.options.store.readChainStep ? ordinaryDeliveryChains(records) : null;
        records.forEach(request => this.receipts.observe(request));
        const batch = await this.advanceBatch(records, owner, generation, failures, races, attempted, step !== null);
        races = batch.races;
        // A narrow step never declares the full queue exhausted.
        this.requested = this.requested || batch.changed || step !== null;
      } while (this.requested && this.current(owner, generation));
      // Every request that failed, each about its own document (BUG-20261003-background-failure-without-address).
      if (failures.size) throw new AddressedFailures([...failures.values()]);
    };
    this.runningGeneration = generation;
    this.running = run();
    try { await this.running; } finally { this.running = null; if (!this.requested) this.deliveryRequested = false; }
  }

  /** A terminal failed chain has no unknown effects; retiring it is an explicit user choice. */
  cancel(editorId: string, additionalRequestIds: readonly string[] = []): Promise<void> {
    return this.cancelOwned(editorId, additionalRequestIds, false);
  }

  /** An editor choice owns both the cancellation and its exact durable checkpoint. */
  async cancelWithCheckpoint(editorId: string, additionalRequestIds: readonly string[],
    project: (saved: CommitRequest[]) => ChoiceCheckpoint,
    review?: { roots: readonly CommitRequest[]; retained?: ReadonlySet<string> }
      | { assertScope: (requests: readonly CommitRequest[]) => void }): Promise<void> {
    if (!this.options.store.compareAndSetWithCheckpoint) throw new Error('Atomic choice checkpoint storage is required');
    const { owner, generation, records, chosen } = await this.planCancellation(editorId, additionalRequestIds, false);
    const reviewed = review && 'roots' in review ? review : undefined;
    if (review && 'assertScope' in review) review.assertScope(records);
    if (reviewed && (chosen.size !== reviewed.roots.length || reviewed.roots.some(root => !chosen.has(root.id)
      || !records.some(record => record.id === root.id && record.revision === root.revision
        && ['conflict', 'refused'].includes(record.state))))) {
      throw Object.assign(new Error('The shown saved copy changed'), { code: 'decision-changed' });
    }
    const selectedManual = records.filter(record => chosen.has(record.id) && readManualScopeIdentity(record.editorId));
    if (!reviewed && selectedManual.some(root => {
      const origin = readManualScopeIdentity(root.editorId)!.parentEditorId;
      return cancellationScope(records, '', [root.id]).some(dependent => {
        const writer = readManualScopeIdentity(dependent.editorId)?.parentEditorId ?? dependent.editorId;
        return dependent.editorId !== root.editorId
          && (!chosen.has(dependent.id) || areDifferentTabManualParents(origin, writer, root.baseline.resource));
      });
    })) {
      throw Object.assign(new Error('Resolve the failed Save from its form to preserve later work'), { code: 'pending-delivery-first' });
    }
    const choiceRequestIds = review || selectedManual.length ? [...chosen] : undefined;
    const saved = await this.options.store.compareAndSetWithCheckpoint(records.map(previous => ({ previous,
      next: { ...this.cancelledRequest(previous, chosen), ...(reviewed && !chosen.has(previous.id) && (reviewed.retained?.has(previous.id) ?? true)
        ? { retainedAfterChoice: true as const } : {}) },
    })), requests => {
      this.assertCurrent(owner, generation);
      return project(requests);
    }, choiceRequestIds);
    this.assertCurrent(owner, generation);
    this.requested = true;
    saved.forEach(request => this.emit(request));
  }

  /** Only the action owner may retire a relation and its dependent local work. */
  cancelAction(requestIds: readonly string[]): Promise<void> {
    return this.cancelOwned('', requestIds, true);
  }

  /** The deciding owner calls this only after its chosen projection is durable. */
  async finishCancellation(editorId: string, additionalRequestIds: readonly string[] = []): Promise<void> {
    const owner = this.owner, generation = this.generation;
    if (!owner) throw new Error(AUTHENTICATION_REQUIRED);
    let races = 0;
    for (;;) {
      const all = await this.options.store.list(owner);
      this.assertCurrent(owner, generation);
      const records = orderCommitRequests(cancellationScope(all, editorId, additionalRequestIds, true).filter(record => record.state === 'cancelled'));
      const processed = new Set<string>();
      try {
        for (const record of records) {
          const groupId = record.atomic?.id ?? record.id;
          if (processed.has(groupId) || !record.unfinalized.length) continue;
          processed.add(groupId);
          await this.advanceRequest(record, all, owner, generation);
        }
        return;
      } catch (error) {
        this.assertCurrent(owner, generation);
        // Another worker may already have retired the same immutable journal entry.
        if ((error as { code?: string }).code === COMMIT_CHANGED && ++races < 100) continue;
        throw error;
      }
    }
  }

  private async planCancellation(editorId: string, additionalRequestIds: readonly string[], wholeAction: boolean) {
    const owner = this.owner, generation = this.generation;
    if (!owner) throw new Error(AUTHENTICATION_REQUIRED);
    const all = await this.options.store.list(owner);
    const records = cancellationScope(all, editorId, additionalRequestIds);
    // Only what the deciding editor held was chosen about; dependents and participants are swept.
    const chosen = new Set(all.filter(record => record.editorId === editorId || additionalRequestIds.includes(record.id)).map(record => record.id));
    this.assertCurrent(owner, generation);
    if (!wholeAction && records.some(record => record.atomic)) throw Object.assign(
      new Error('Resolve the complete action before replacing one participant'), { code: 'atomic-action-resolution-required' });
    const journal = await this.options.runtime.list();
    this.assertCurrent(owner, generation);
    if (!canCancelSavedIntent(records, journal)) throw Object.assign(new Error('Resolve pending commands before replacing saved intent'), { code: 'pending-delivery-first' });
    return { owner, generation, records, chosen };
  }

  private cancelledRequest(record: CommitRequest, chosen: ReadonlySet<string>): CommitRequest {
    return { ...record, state: 'cancelled', unfinalized: pendingCommitRetirement(record),
      ...(chosen.has(record.id) ? { cancelledByChoice: true } : {}) };
  }

  private async cancelOwned(editorId: string, additionalRequestIds: readonly string[], wholeAction: boolean): Promise<void> {
    const { owner, generation, records, chosen } = await this.planCancellation(editorId, additionalRequestIds, wholeAction);
    this.requested = true;
    if (wholeAction) return cancelActionCommits(orderCommitRequests(records), additionalRequestIds, this.atomicContext(owner, generation));
    for (const record of records) {
      this.assertCurrent(owner, generation);
      const cancelled = await this.options.store.compareAndSet(record, this.cancelledRequest(record, chosen));
      this.assertCurrent(owner, generation);
      this.emit(cancelled);
    }
  }

  private async readChainStep(owner: string, { groups, knownIds, next }: DeliveryChains): Promise<CommitRequest[] | null> {
    const successors = groups.flatMap(group => group[next] ?? []);
    if (!successors.length) return null;
    try {
      if (successors.some(expected => hasExternalIntent(expected.baseline, expected.value))) return null;
    } catch {
      return null;
    }
    // Include a just-finished chain for its last journal retirement, even without a successor.
    const previousIds = groups.flatMap(group => group[next - 1]?.id ?? []);
    const ids = [...previousIds, ...successors.map(expected => expected.id)];
    const step = await this.options.store.readChainStep?.(owner, knownIds, ids);
    if (!step || step.slice(0, previousIds.length).some(prior => prior.state !== 'acknowledged'
      || prior.result?.kind !== 'acknowledged')) return null;
    for (const [index, expected] of successors.entries()) {
      const current = step[previousIds.length + index];
      if (current.revision !== expected.revision) return null;
      assertCommitCapture(current, expected);
    }
    return step;
  }

  private async advanceBatch(records: CommitRequest[], owner: string, generation: number,
    failures: Map<string, AddressedFailure>, races: number, attempted: Set<string>, narrow: boolean) {
    let changed = false;
    const advancedOperations = new Set<string>();
    const awaiting = new Map<string, { request: CommitRequest; apply: (result: CommandResult) => Promise<boolean> }>();
    const trackAnswer: TrackCommitAnswer = (request, apply) => {
      if (request.command) awaiting.set(request.command.operationId, { request, apply });
    };
    const onFailure = (request: CommitRequest, error: unknown) => {
      if (!this.current(owner, generation)) throw error;
      if ((error as { code?: string }).code === COMMIT_CHANGED && ++races < 100) {
        changed = true;
        return;
      }
      for (const participant of atomicParticipants(request, records)) failures.set(participant.id, { error, about: participant.baseline.resource });
    };
    const ready = referenceReadiness(owner, records);
    for (const record of records) {
      this.assertCurrent(owner, generation);
      const groupId = record.atomic?.id;
      if (failures.has(record.id) || (groupId && advancedOperations.has(groupId))) continue;
      const deletion = retainedDeletionReply(record);
      if (terminal(record) && !record.unfinalized.length && !deletion) {
        // A retained answer is evidence for its dependents, not a new answer on every pass.
        // Explicit device refresh still replays it for a newly ready editor.
        this.emit(record, false);
        continue;
      }
      advancedOperations.add(groupId ?? record.id);
      try {
        changed = await this.advanceRequest(record, records, owner, generation, ready, trackAnswer, deletion) || changed;
      } catch (error) { onFailure(record, error); }
    }
    const journal = this.deliveryRequested ? await this.deliverBatch(owner, generation, attempted, ready, narrow, awaiting) : [];
    for (const entry of journal) {
      if (!['acknowledged', 'conflict', 'refused'].includes(entry.state)) continue;
      const answer = awaiting.get(entry.command.operationId);
      if (answer && entry.result) {
        // The answer only updates its exact durable capture. Selecting successors still takes a fresh snapshot.
        try { changed = await answer.apply(entry.result) || changed; }
        catch (error) { onFailure(answer.request, error); }
      } else if (records.some(record => !failures.has(record.id) && !terminal(record)
        && record.command?.operationId === entry.command.operationId)) changed = true;
    }
    return { changed, races };
  }

  private async deliverBatch(owner: string, generation: number, attempted: Set<string>,
    ready: ReturnType<typeof referenceReadiness>, narrow: boolean, submitted: ReadonlyMap<string, unknown>) {
    await this.options.runtime.drain(attempted, this.options.canDeliver ?? (() => true), command => {
      const references = commandReferenceResources(command);
      return (!narrow || (submitted.has(command.operationId) && !references.length)) && ready(references, command.operationId);
    });
    this.assertCurrent(owner, generation);
    const journal = await this.options.runtime.list();
    this.assertCurrent(owner, generation);
    return journal;
  }

  private atomicContext(owner: string, generation: number, trackAnswer?: TrackCommitAnswer) {
    return { ...this.options, assertCurrent: () => this.assertCurrent(owner, generation), emit: (request: CommitRequest) => this.emit(request), trackAnswer };
  }

  private advanceRequest(record: CommitRequest, records: CommitRequest[], owner: string, generation: number,
    ready = referenceReadiness(owner, records), trackAnswer?: TrackCommitAnswer, retainedDeletion: CommandResult | null = null): Promise<boolean> {
    if (retainedDeletion) return this.applyCommandAnswer(record, retainedDeletion, owner, generation);
    const participants = atomicParticipants(record, records);
    if (participants.some(participant => !deleteOrderReady(participant, records))) return Promise.resolve(false);
    if (!participants[0].command && participants.every(participant => participant.initialized && !terminal(participant) && !participant.unfinalized.length)) {
      const references = participants.flatMap(participant => [
        ...documentReferenceResources(participant.working.resource, participant.working.value, participant.intended),
        ...requiredDomainTargets(participant.working, participant.intended),
      ]);
      // A saved source create owns existence until its answer. Do not prepare a permanent
      // refusal from today's absence, or invent a confirmed source from local planned words.
      if (!ready(references, record.atomic?.id ?? record.id)) return Promise.resolve(false);
    }
    return record.atomic ? advanceAtomicCommit(participants, records, this.atomicContext(owner, generation, trackAnswer))
      : this.advance(record, records, owner, generation, trackAnswer);
  }

  private async persistTransition(record: CommitRequest, next: CommitRequest, owner: string, generation: number): Promise<CommitRequest> {
    this.assertCurrent(owner, generation);
    const updated = await this.options.store.compareAndSet(record, next);
    this.assertCurrent(owner, generation);
    this.emit(updated);
    return updated;
  }

  private async advance(record: CommitRequest, records: CommitRequest[], owner: string, generation: number,
    trackAnswer?: TrackCommitAnswer): Promise<boolean> {
    const commit = async (next: CommitRequest, queueNow = false) => {
      const updated = await this.persistTransition(record, next, owner, generation);
      // Only the durable materialization winner can enqueue the command.
      if (queueNow && updated.command && this.current(owner, generation)) {
        await this.options.runtime.submit(updated.command);
        this.assertCurrent(owner, generation);
        trackAnswer?.(updated, result => this.applyCommandAnswer(updated, result, owner, generation));
      }
      return true;
    };
    if (record.unfinalized.length) {
      await retireCommitJournal([record], this.options.runtime, () => this.assertCurrent(owner, generation));
      return commit({ ...record, unfinalized: [] });
    }
    if (!record.initialized) {
      const initialized = initializeCommit(record, records);
      if (!initialized) return false;
      const prepared = this.prepareIndependentUpdate(initialized, owner);
      return commit(prepared ?? initialized, prepared !== null);
    }
    if (record.command) return this.advanceCommand(record, owner, generation, trackAnswer);
    if (!hasTimedAncestor(record) && equalValues(record.working.value, record.intended)) return commit({ ...record, state: 'acknowledged', result: { kind: 'acknowledged', operationId: record.id, snapshot: record.working } });
    const targets = await Promise.all(requiredDomainTargets(record.working, record.intended).map(this.options.readConfirmed));
    if (isFirstBookMarksDraft(record.working, record.intended)) {
      const target = await (this.options.readWriteTarget ?? this.options.readConfirmed)(record.working.resource);
      this.assertCurrent(owner, generation);
      if (!target) return false;
      targets.push(target);
    }
    this.assertCurrent(owner, generation);
    return commit(this.materialize(record, owner, targets));
  }

  /** A local, single-document update can initialize and prepare from the same durable evidence. */
  private prepareIndependentUpdate(record: CommitRequest, owner: string): CommitRequest | null {
    if (record.state !== 'queued' || record.command || record.deleteAfter?.length
      || !record.working.value || !record.intended || (!hasTimedAncestor(record) && equalValues(record.working.value, record.intended))) return null;
    try {
      if (hasExternalIntent(record.working, record.intended)) return null;
      const prepared = this.materialize(record, owner, []);
      return prepared.command?.kind === 'update' && !commandReferenceResources(prepared.command).length ? prepared : null;
    } catch {
      // Preserve the ordinary initialize-then-prepare path and its retryable failures.
      return null;
    }
  }

  private materialize(record: CommitRequest, owner: string, targets: ResourceSnapshot[]): CommitRequest {
    const operationId = record.sequence === 0 ? record.id : `${record.id}-${record.sequence}`;
    let prepared: ReturnType<typeof prepareDomainCommand>;
    const evidence = record.working.resource.collection === 'sermons'
      ? record.planTextEvidence ?? capturePlanTextEvidence({ before: record.baseline.value, after: record.value })
      : undefined;
    const markRebase = pendingBibleMarkRebase(record);
    const fields = record.sequence === 0 ? documentFieldTargets(record.working.resource.collection) : [];
    const meeting = pendingMeetingDateRebase(record);
    let source = record.working;
    for (const target of fields) {
      const action = capturedDocumentField(record, target);
      if (action) source = documentFieldCommandAncestor(source, action, target.field);
    }
    if (markRebase) source = restoreBibleMarkAncestor(source, markRebase);
    // Even when the previous ACK already shows the intended date, the server
    // still needs this action's exact ancestor and time to arbitrate later deliveries.
    if (meeting && source.value) {
      const rows = replaceExistingDate(source.value.meetingDates, meeting.rowId, meeting.before, MEETING_DATE_TARGET);
      if (rows !== undefined) source = { ...source, value: { ...source.value, meetingDates: rows } };
    }
    for (const { action, target } of pendingRowFields(record)) {
      if (!source.value) break;
      if (target === SERVICE_ORDER_FLAG_TARGET && existingRowField(source.value[target.field], action.rowId, target) === action.before) continue;
      const rows = replaceExistingRowField(source.value[target.field], action.rowId, action.before, target);
      if (rows !== undefined) source = { ...source, value: { ...source.value, [target.field]: rows } };
    }
    const status = pendingPreachStatusActions(record);
    if (source.value && status.length) source = { ...source, value: replacePreachStatuses(source.value, status, 'before') };
    try { prepared = prepareDomainCommand(owner, operationId, source, record.intended, targets, evidence, Boolean(status.length)); }
    catch (error) {
      // The policy names WHY this draft can never be a command (two sections carried in one
      // save, a destination that was deleted, a derived field). Left as a throw, the request
      // stayed `queued` and was retried for ever, and `cancel` — which needs something terminal —
      // refused the person both ways out. A coded refusal is terminal; nothing was sent.
      // A failure WITHOUT a code (a target that could not be read offline) stays retryable.
      const code = (error as { code?: unknown }).code;
      if (typeof code !== 'string') throw error;
      return { ...record, state: 'refused', result: { kind: 'refused', operationId: record.id, code } };
    }
    if (!resourceMatches(prepared.command.resource, record.baseline.resource)) throw new Error('Commit resource changed');
    const { command } = prepared;
    const dateTarget = datedRowTarget(command.resource.collection);
    const action = dateTarget && record[dateTarget.evidence];
    if (dateTarget && action && command.kind === 'update' && record.sequence === 0
      && command.generation === record.baseline.metadata?.generation) {
      const changes = record.deferPreachDateRebase ? capturedDateBaseline(command.changes, action, dateTarget) : command.changes;
      if (matchesDatedRowChange(changes, action, dateTarget)) {
        command.changes = changes;
        command[dateTarget.evidence] = action;
      }
    }
    if (command.kind === 'update' && record.sequence === 0 && command.generation === record.baseline.metadata?.generation) {
      const meetingActions = matchingMeetingFieldActions(command.changes, record.groupMeetingFieldActions);
      if (meetingActions) command.groupMeetingFieldActions = meetingActions;
      if (record.sermonChurchFill && command.changes.some(change => change.path[0] === 'preachDates')) command.sermonChurchFill = record.sermonChurchFill;
      const preachActions = matchingRowDetailActions(command.changes, record.preachDateFieldActions, PREACH_DATE_FIELD_POLICY);
      if (preachActions) command.preachDateFieldActions = preachActions;
      const flags = record.serviceOrderFlagActions;
      if (flags && matchesServiceOrderStep(command.changes, SERVICE_ORDER_FLAG_TARGET, flags.flagged)) command.serviceOrderFlagActions = flags;
      const stepTitles = record.serviceOrderStepTitleActions;
      if (stepTitles && matchesServiceOrderStep(command.changes, SERVICE_ORDER_STEP_TITLE_TARGET, stepTitles.title)) command.serviceOrderStepTitleActions = stepTitles;
      const topicTitles = matchingCouncilTopicTitles(command.changes, record.councilTopicTitleActions);
      if (topicTitles?.length) command.councilTopicTitleActions = topicTitles;
      const assembly = matchingCouncilAssembly(command.changes, record.councilAssemblyActions);
      if (assembly) command.councilAssemblyActions = assembly;
      const statusActions = matchingPreachStatusActions(command.changes, status);
      if (statusActions.length) command.preachStatusActions = statusActions;
    }
    const stamped = fields.reduce((current, target) => withDocumentFieldAction(current, target, capturedDocumentField(record, target)), command);
    const timed = record.sequence === 0 ? withBibleMarkStroke(stamped, record.bibleMarkStroke) : command;
    return { ...record, command: timed, submitted: prepared.submittedValue, state: 'prepared' };
  }

  private async advanceCommand(record: CommitRequest, owner: string, generation: number, trackAnswer?: TrackCommitAnswer): Promise<boolean> {
    const journal = await this.options.runtime.list();
    this.assertCurrent(owner, generation);
    const entry = journal.find(item => item.command.operationId === record.command!.operationId);
    if (!entry || !entry.result || !['acknowledged', 'conflict', 'refused'].includes(entry.state)) {
      // The persisted command won CAS before any tab may submit it.
      await this.options.runtime.submit(record.command!);
      this.assertCurrent(owner, generation);
      trackAnswer?.(record, result => this.applyCommandAnswer(record, result, owner, generation));
      return false;
    }
    return this.applyCommandAnswer(record, entry.result, owner, generation);
  }

  private async applyCommandAnswer(record: CommitRequest, result: CommandResult, owner: string, generation: number): Promise<boolean> {
    const commit = async (next: CommitRequest) => { await this.persistTransition(record, next, owner, generation); return true; };
    if (record.command) result = confirmedExistingDeletion(record.command, result) ?? result;
    if (result.kind !== 'acknowledged') return commit({ ...record, state: result.kind === 'refused' ? 'refused' : 'conflict', result: { ...result, operationId: record.id } });
    const rebased = mergeDocumentFields(record.submitted, record.intended, result.snapshot.value);
    if (rebased.conflicts.length) return commit({ ...record, state: 'conflict', result: { kind: 'conflict', operationId: record.id, snapshot: result.snapshot, conflicts: rebased.conflicts } });
    const intended = rebased.value.exists ? rebased.value.value as DocumentData : null;
    const complete = equalValues(intended, result.snapshot.value);
    // The durable request owns projection; an editor is not needed to retire ACKs.
    return commit({ ...record, working: clone(result.snapshot), intended,
      command: null, submitted: null, sequence: record.sequence + 1,
      state: complete ? 'acknowledged' : 'queued', result: complete ? { ...result, operationId: record.id } : null,
      unfinalized: [...record.unfinalized, record.command!.operationId] });
  }

  private emit(request: CommitRequest, allowRepeat = true): void {
    const previous = this.emittedRevisions.get(request.id);
    if (previous !== undefined && (previous > request.revision || (!allowRepeat && previous === request.revision))) return;
    this.emittedRevisions.set(request.id, request.revision);
    this.receipts.observe(request);
    for (const listener of this.listeners) { try { listener({ request: clone(request) }); } catch { /* Rendering cannot change delivery. */ } }
  }
  private current(owner: string, generation: number): boolean { return owner === this.owner && generation === this.generation; }
  private assertCurrent(owner: string, generation: number): void { if (!this.current(owner, generation)) throw new Error('Account changed'); }
}

/** Test/custom in-memory port; production supplies IndexedDB. */
export function createMemoryCommitStore(): CommitStore {
  const records = new Map<string, CommitRequest>();
  const captures = new Set<string>();
  const captureKey = (owner: string, scope: string, id: string) => JSON.stringify([owner, scope, id]);
  return {
    list: async owner => clone([...records.values()].filter(record => record.owner === owner)),
    listCaptures: async (owner, prefix) => clone([...records.values()].filter(record => record.owner === owner
      && record.retentionScope?.startsWith(prefix) && captures.has(captureKey(owner, record.retentionScope, record.id)))),
    releaseCapture: async (owner, scope, id) => { captures.delete(captureKey(owner, scope, id)); },
    create: async request => {
      const existing = [...records.values()].find(record => record.owner === request.owner && record.editorId === request.editorId && record.editGeneration === request.editGeneration);
      if (existing) { assertCommitCapture(existing, replayDeleteOrder(request, existing)); return clone(existing); }
      const saved = captureDeleteOrder(request, [...records.values()]);
      records.set(saved.id, clone(saved));
      if (saved.retentionScope) captures.add(captureKey(saved.owner, saved.retentionScope, saved.id));
      return clone(saved);
    },
    compareAndSet: async (previous, next) => {
      const current = records.get(previous.id);
      if (!current || current.revision !== previous.revision) throw Object.assign(new Error('Commit changed'), { code: COMMIT_CHANGED });
      assertCommitCapture(current, next);
      const updated = { ...clone(next), revision: previous.revision + 1 };
      records.set(previous.id, updated); return clone(updated);
    },
  };
}
