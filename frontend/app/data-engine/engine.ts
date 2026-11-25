import debounce from 'lodash/debounce';
import { v5 as uuidV5 } from 'uuid';

import { isConnectionFailure } from '@/utils/connectionFailure';
import { noteCaptureWriter } from '@/utils/draftCaptureRecovery.client';

import { readAccountPreferenceComparison } from './accountPreference';
import { analysisCreationScope } from './analysisCreation';
import { ANALYSIS_CREATION_TRANSFER_PREFIX, analysisCreationReview, captureAnalysisCreation } from './analysisCreationCapture';
import { captureAnalysisReshape, type StudyAnalysisWrite } from './analysisReshape';
import { ANALYSIS_RESHAPE_FIELDS, sameAnalysisFrame } from './analysisReshapeFields';
import { isAnchoredPlacementRefusal } from './anchoredRowPlacement';
import { originalAutosaveStillApplies, pendingAutosaveReceipts, PendingStartupAutosave, recoverableAutosaves, serviceInputWithUnchangedOpening, serviceOrderAutosaveSource } from './automaticDraftResume';
import { closedCopySettlement } from './checkpointStorage.client';
import { collectionDocumentViews } from './collectionView';
import { isCommentCreationCopy, isNewCommentEditor } from './commentEditorScope';
import { captureCommentKind, matchesCommentKindPlace, matchesCommentKindRequest } from './commentKindAction';
import { captureCommentPlace, matchesCommentPlaceRequest } from './commentPlaceAction';
import { CommitQueue, type CommitRequest, type CommitStore } from './commits';
import { EditorController, InactiveEditorError, type CheckpointRecoveryStore, type CheckpointStore, type EditorRecord, type EditorState, type RecoveryCheckpoint } from './controller';
import { captureCouncilCarry, pinCouncilDestination } from './councilCarry';
import { readCouncilSummaryChoice } from './councilPrivateFields';
import { creationsAwaitingRemoval } from './deletionOrdering';
import { canReplaceDocumentIntent, isDirectLegacyDocumentIntent, requiresWholeActionResolution, savedDocumentAnswer } from './documentDelivery';
import { capturePlanTemplateName, capturePrayerTitle, captureSermonPlanMode, captureStudyNoteTitle, captureStudyNoteType, captureTagColor, matchesPlanTemplateNameRequest, matchesPrayerStatusOpening, matchesPrayerTitleRequest, permitsSermonPlanModePredecessor, matchesStudyNoteTitleRequest, matchesStudyNoteTypeRequest, matchesTagColorRequest, sermonPlanModeOpening, studyNoteTitleValue, studyNoteTypeValue, validatedTitleCapture } from './documentFieldAction';
import { manualSeriesTextChoiceFields, seriesTextChoiceFields } from './documentTextChoice';
import { ACTION_SLOT, areDifferentTabManualParents, editorIdentity, editorSlot, isDocumentEditorSlot, isManualChoiceRecoveryIdentity, isResourceActionEditor, isRetirableOrdinaryEditor, manualScopeIdentity, readManualScopeIdentity, recoveryEditorIdentity } from './editorIdentity';
import { AddressedFailures, eachFailure, PausedReadFailure } from './failures';
import { collectionHeadRef } from './feed';
import { firstGroupMeetingReview } from './groupFirstMeeting';
import { GROUP_MEETING_SAVE_DELAY, GROUP_MEETING_SLOT, readyMeetingAutosave } from './groupMeetingAutosave';
import { readGroupFlowTextChoice } from './groupTextReview';
import { HOMILETIC_POSITION_PROJECTION, HOMILETIC_POSITION_REVIEW } from './homileticPlan';
import { reviewedHomileticList } from './homileticPlanChoice';
import { submittedEditorCheckpoint } from './liveSubmittedWork';
import { LocalWriteback, type LocalWriteHandoff } from './localWriteback';
import { exactManualRequest, exactManualWords, recoverManualChoiceCopy } from './manualChoice';
import { assertDurableManualChoice, assertManualChoiceInput, assertManualComparison, manualComparison, type ManualComparison } from './manualComparison';
import { manualReturnSources, markBorrowedManualSources, reopenedManualAnswerScope, shouldFollowReopenedManualStage } from './manualReturnSources';
import { ManualScope, recoverManualScopeRecord, reconcileManualCaptures, sameManualSelection, type ManualCapture, type ManualFieldInput, type ManualPath, type ManualSavedIntent, type ManualSaveOptions, type ManualDocumentMetadataSave } from './manualScope';
import { captureMembershipPins } from './membershipCapture';
import { describeActionDelivery, describeMembershipDelivery, type MembershipDelivery } from './membershipDelivery';
import { membershipItems, showsSeriesMembershipComparison } from './membershipIntent';
import { CREATION_SCOPE_PREFIX, MembershipScope, type MembershipScopeRecord } from './membershipScope';
import { continueRefusedNote, reviewRefusedNote, type NoteBodyContinuation } from './noteRefusalContinuation';
import { OpenEditorJournal, OpenEditorRequests } from './openEditorRequests';
import { hasBranchedOrdinaryAnswer, manualOrdinaryChoiceSources, ordinaryAnswerChoice, ordinaryAnswerCoverage, ordinaryStoredChoice, requireDocumentChoiceForBranch, reviewOrdinaryAnswerChoice, singleFieldAnswerScopes, type ManualChoiceSources } from './ordinaryAnswerChoice';
import { hasOutlineParentChoice, readOutlineParentComparison, type OutlineTitleDecision } from './outlineParentChoice';
import { readOutlineTitleComparison } from './outlineTitleEdit';
import { oversizedNoteOpening } from './oversizedNoteCorrection';
import { PlanCellEmergency, type PlanCellEmergencyStorage } from './planCellEmergency';
import { unresolvedPreachDateField } from './preachDateChoice';
import { readPrivateDocumentReview } from './privateDocumentReview';
import { getResourcePolicy, equalValues, isValidIdentifier, readField } from './protocol';
import { documentRecordPresence, type RecordPresence } from './recordPresence';
import { forkCheckpoint, isOnlyRemovedCreationCopy, isPassiveManualContinuation, isRecoverableCheckpoint, reconcileRecoveryRecord, recoveryCheckpointId, validateRecoveryRecord } from './recovery.client';
import { RecoveryPresence, recoverySources, type RecoveryPresenceKind, type RecoveryPresenceLease, type RecoveryPresencePort } from './recoveryPresence';
import { reviewedSeriesReorder, type SeriesReorderComparison } from './seriesReorder';
import { comparableSermonFields, earlierSermonDateProof, earlierSermonMetadataProof, readSermonSettingComparison } from './sermonFieldChoice';
import { hasSermonOutlineReview, type SermonOutlineReviewInput } from './sermonOutlineReview';
import { planCellOpening, readPlanCellText, type PlanCellAlternative, type PlanCellOpening } from './sermonPlanCellSession';
import { ServiceOrderAutosave, type ServiceOrderInputFilter } from './serviceOrderAutosave';
import { projectServiceOrderInput, readServiceOrderInputValue, serviceOrderInputKey, ServiceOrderInputDecisionError, type ServiceOrderInput, type ServiceOrderInputComparison } from './serviceOrderInput';
import { includesServiceOrderReserve, matchesServiceOrderReserve, SERVICE_ORDER_INPUT_SLOT, ServiceOrderInputReserve, type ServiceOrderReserveStorage } from './serviceOrderInputReserve';
import { DataSession, hasUnreadableDraftProof } from './session';
import { canReplaceSnapshot, coversCommittedEffect, storesNewCopy } from './snapshotFreshness';
import { snapshotBelongsToOwner } from './snapshotIdentity';
import { matchesSourceNoteOpening, sourceNoteLinkOpening, type SourceNoteLinkOpening } from './sourceNoteLinkCapture';
import { hasStudyNoteReferenceReview } from './studyNoteReferenceMerge';
import { redeliveryDelay } from './unanswered';


import type { ActionTime } from './actionClock';
import type { CollectionReader, CollectionState } from './collections';
import type { DocumentWriteReceipt } from './commitReceipt';
import type { DatedRowActionCapture } from './datedRowAction';
import type { AutosaveFieldStamp } from './documentFieldAction';
import type { GroupMeetingFieldInput } from './groupMeetingFieldAction';
import type { ManualScopeStore, StoredManualScope } from './manualScopes.client';
import type { MembershipScopeStore } from './membershipScopes.client';
import type { Observation, ResourceObserver } from './observer';
import type { OpenDocumentAnswer } from './openDocumentAnswers';
import type { PreachStatusSave } from './preachStatusAction';
import type { DataEngineRuntime, RuntimeEvent } from './runtime';
import type { SeriesMembershipComparison } from './seriesMembershipHistory';
import type { SessionCheckpoint, ShownCopy } from './session';
import type { LegacyStudyNoteImport } from './studyNoteLegacyDraft';
import type { EditorCommitAction, StudyNoteContentCapture } from './types';
import type { CommandResult, DataCommand, DocumentData, EngineMetadata, EngineReadOptions, EngineTransport, FailureAddress, JournalEntry, ResourceRef, ResourceSnapshot } from './types';
import type { AppLocale } from '@/utils/appLocale';
import type { BookText } from '@/utils/bibleText';
import type { PlanDraftBinding } from '@/utils/planDraftCapture.client';
import type { OutlineTitleOpening } from '@/utils/sermonNoteText';

export { canReplaceSnapshot } from './snapshotFreshness';

export type ManualRecoveryPolicy = 'same-slot' | 'same-selection';

export interface SnapshotStore {
  read(owner: string, resource: ResourceRef): Promise<ResourceSnapshot | undefined>;
  /** Adapters shared by tabs should compare and store atomically with canReplaceSnapshot. */
  put(owner: string, snapshot: ResourceSnapshot): Promise<void>;
}

export interface DataEngineOptions {
  runtime: DataEngineRuntime;
  observer: ResourceObserver;
  transport: Pick<EngineTransport, 'read'>;
  checkpoints: CheckpointStore;
  snapshots: SnapshotStore;
  collections?: CollectionReader;
  operationId: () => string;
  commits: CommitStore;
  manualScopes?: ManualScopeStore;
  /** Keep native cleanup out of the per-response path until this delivery pass has finished. */
  deferCommitCollection?: (owner: string) => () => Promise<void>;
  membershipScopes?: MembershipScopeStore;
  /** Retired device writes survive replacement of the browser provider. */
  localWriteback?: LocalWriteback;
  planCellEmergencyStorage?: PlanCellEmergencyStorage;
  serviceOrderReserveStorage?: ServiceOrderReserveStorage;
  /** Optional device-local knowledge used only by recovery choice lists. */
  recoveryPresence?: RecoveryPresencePort;
  /** A failure of background work, with the document or collection it concerns when there is one. */
  onError?: (error: unknown, about?: FailureAddress) => void;
}

export interface ManagedManualForm {
  getState(): (ReturnType<ManualScope['getState']> & { comparison?: ManualComparison; exactChoice?: true; documentChoiceRequired?: true; requestedRecovery?: true }) | null;
  subscribe(listener: () => void): () => void;
  begin(): Promise<void>;
  follow(): Promise<void>;
  update(updater: (value: DocumentData) => DocumentData, fieldInput?: ManualFieldInput, autosaveGroupMeeting?: true): Promise<void>;
  propose(producer: (source: DocumentData) => Promise<DocumentData>, signal?: AbortSignal): Promise<void>;
  save(updater?: (value: DocumentData) => DocumentData, action?: DatedRowActionCapture | GroupMeetingFieldInput | { preachStatus: PreachStatusSave } | ManualDocumentMetadataSave, onCaptured?: () => void): Promise<void>;
  cancel(): Promise<void>;
  retry(): Promise<void>;
  resolve(choice: 'local' | 'remote', options?: { discardStage?: boolean; expectedComparison?: ManualComparison;
    updater?: (current: DocumentData) => DocumentData; metadataTime?: ActionTime | null; titles?: readonly OutlineTitleDecision[] }): Promise<void>;
  listRecoverable(): Promise<StoredManualScope[]>;
  recover(sourceScopeId: string): Promise<void>;
  discardRecovery(source: StoredManualScope): Promise<void>;
}

type ClosingSaveIntent = { checkpoint: SessionCheckpoint; action?: EditorCommitAction; planCellSaveIds?: readonly string[]; serviceOrderInput?: ServiceOrderInput; serviceOrderComparison?: ServiceOrderInputComparison };

interface HeldDraftAlternative extends RecoveryCheckpoint {
  isStaged: () => Promise<boolean>;
}

interface HeldPlanCellAlternative {
  retained: Promise<boolean>;
  settle(keep: boolean, chosenWrite?: void | Promise<unknown>): Promise<void>;
}

export interface ManagedEditor {
  getState(): EditorState;
  getObservation(): Observation;
  getPresence(): RecordPresence;
  getDelivery(): JournalEntry[];
  getSermonPlanModeOpening?(shown: SessionCheckpoint): ReturnType<typeof sermonPlanModeOpening>;
  getSourceNoteLinkOpening?(): SourceNoteLinkOpening;
  getActions(): Array<{ id: string; delivery: MembershipDelivery }>;
  carryCouncilTopicToNew(topicId: string, title: string): Promise<ResourceSnapshot>;
  carryCouncilTopicToExisting(topicId: string, destinationId: string): Promise<ResourceSnapshot>;
  discardAction(id: string): Promise<void>;
  form(slot: string, selection: readonly ManualPath[], recovery?: ManualRecoveryPolicy): ManagedManualForm;
  subscribe(listener: () => void): () => void;
  /** `shown` is the copy the screen showed while the person typed (`DataSession.edit`). */
  edit(value: DocumentData | null, shown?: ShownCopy, autosaveStamp?: AutosaveFieldStamp): Promise<void>;
  importLegacyStudyNote(edits: LegacyStudyNoteImport): Promise<void>;
  editPlanCell(opening: PlanCellOpening, text: string, previous?: string, isSourceStored?: () => boolean): Promise<void>;
  editUnverifiedPlanCell?(nodeId: string, text: string, previous: string): Promise<void>;
  backsUpPlanCell?(nodeId: string, text: string): boolean;
  bindPlanCellBackups?(cells: Readonly<Record<string, string>>): PlanDraftBinding[];
  assertPlanCellsStored(cells: Readonly<Record<string, string>>): Promise<void>;
  savePlanCells(nodeIds: readonly string[]): Promise<void>;
  stageServiceOrderInput(value: DocumentData | null, shown: ShownCopy | undefined, input: ServiceOrderInput): Promise<void>;
  flushServiceOrderInputs(filter?: ServiceOrderInputFilter): Promise<void>;
  saveServiceOrderInput(input: ServiceOrderInput, compared?: ServiceOrderInputComparison): Promise<void>;
  useStoredServiceOrderInput(input: ServiceOrderInput, compared: ServiceOrderInputComparison): Promise<void>;
  /** Keep a distinct, unsent alternative based on the confirmed copy, without replacing the open draft. */
  holdDraftAlternative(alternative: (confirmed: DocumentData) => DocumentData): Promise<HeldDraftAlternative | null>;
  holdPlanCellAlternative?(alternative: PlanCellAlternative): HeldPlanCellAlternative;
  retainSermonOutlineReview?(input: SermonOutlineReviewInput): { location: 'active' | 'deferred'; durable: Promise<void> } | undefined;
  editOutlineTitle(shown: SessionCheckpoint, opening: OutlineTitleOpening, title: string, time?: ActionTime | null): Promise<DocumentData | null>;
  /** Capture, stage and durably save one invocation without including later typing. */
  commit(updater: (current: DocumentData | null, confirmed: ResourceSnapshot) => DocumentData | null, action?: EditorCommitAction): Promise<void>;
  /** Same local capture, with separate exact-request server acceptance for backup cleanup. */
  commitWithReceipt(updater: (current: DocumentData | null, confirmed: ResourceSnapshot) => DocumentData | null, options?: { captureScope?: string; action?: EditorCommitAction; noteContent?: StudyNoteContentCapture | null }): Promise<DocumentWriteReceipt>;
  removeWithReceipt(options?: { captureScope?: string }): Promise<DocumentWriteReceipt>;
  /** Resolves when the command is durable; delivery continues independently. */
  save(): Promise<void>;
  /** Persist and queue deletion; refuses unresolved pending operations before changing the draft. */
  remove(): Promise<void>;
  acceptRemote(expected?: EditorRecord, compared?: SessionCheckpoint, titles?: readonly OutlineTitleDecision[]): Promise<void>;
  keepLocal(expected?: EditorRecord, compared?: SessionCheckpoint, choiceTime?: ActionTime | null, titles?: readonly OutlineTitleDecision[]): Promise<void>;
  dispose(): void;
  /**
   * Leave the editor. With `flush`, a draft that could be saved — typed inside the autosave
   * delay, or a deletion whose request was not written yet — becomes a durable request first,
   * so leaving a screen never strands it in a checkpoint no editor will read again
   * (BUG-20260919-engine-leaving-strands-last-edit). A draft that waits for the person —
   * a conflict, a refusal, a document deleted elsewhere — sends nothing, nor does anything
   * when `flush` is false (manual forms, creation); whatever is not sent stays in the
   * checkpoint left behind as the screen showed it last (BUG-20261011-leave-during-conflict-loses-edit).
   */
  close(options?: { flush?: boolean }): void;
}

export interface EditorOpenOptions {
  signal?: AbortSignal;
  autoSaveOnResume?: boolean;
  shownRecovery?: EditorRecord;
}

interface EditorEntry {
  autoSaveOnResume?: boolean;
  planCellEmergency?: PlanCellEmergency;
  serviceOrderInputReserve?: ServiceOrderInputReserve;
  serviceOrderAutosave?: ServiceOrderAutosave;
  retirement?: { owner: string; generation: number; editorId: string; resource: ResourceRef };
  manualChoices?: ManualChoiceSources;
  presence: RecoveryPresenceLease;
  initializing: Promise<ManagedEditor> | null;
  controller: EditorController | null;
  stopObservation: (() => void) | null;
  stopController: (() => void) | null;
  closed: boolean;
  listeners: Set<() => void>;
  observation: Observation;
  pendingActionSaves: Map<number, ClosingSaveIntent[]>;
}

interface StartupDraftRecovery {
  generation: number;
  operation: Promise<void> | null;
  attempts: Map<string, number>;
  retryRead: boolean;
  waiting: Set<string>;
  recheckedReceipts: Set<string>;
}

interface ManualFormEntry {
  opening: Promise<void> | null;
  parent: EditorEntry;
  selection: readonly ManualPath[];
  form: ManagedManualForm;
  scope: ManualScope | null;
  scopeId: string;
  emit(): void;
  presence: RecoveryPresenceLease | null;
  meetingSave?: { (): void; cancel(): void; flush(): void };
}

const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
/** Work for one document fails about that document; a list gathered further down keeps its own addresses. */
const about = <T,>(resource: FailureAddress, work: Promise<T>): Promise<T> =>
  work.catch((error: unknown) => { throw error instanceof AddressedFailures ? error : new AddressedFailures([{ error, about: resource }]); });
const aboutEditor = <T,>(controller: EditorController, work: Promise<T>): Promise<T> =>
  about(controller.getState().checkpoint.confirmed.resource, work);
const sameResource = (a: ResourceRef, b: ResourceRef) => a.collection === b.collection && a.id === b.id;
const hasFormWork = (owner: string, resource: ResourceRef, requests: readonly CommitRequest[], retained?: ReadonlySet<string>) => requests.some(request => request.owner === owner
  && sameResource(request.baseline.resource, resource) && !['acknowledged', 'cancelled'].includes(request.state)
  && editorSlot(request.editorId) === null && !retained?.has(request.id));
const reviewedFormSaves = (roots: readonly CommitRequest[], requests: readonly CommitRequest[], sources?: ManualChoiceSources) =>
  new Set(roots.flatMap(root => ordinaryAnswerChoice(root, requests, sources)?.manual.map(request => request.id) ?? []));
const SERVER_SNAPSHOT_IDENTITY_MISMATCH = 'Server snapshot identity mismatch';
const CACHED_IDENTITY_MISMATCH = 'Cached snapshot identity mismatch';
/** An opening may continue once this tab can read: initially unreachable, or interrupted in transit. */
const NEEDS_CONNECTION = 'needs-connection';
export const needsConnection = (error: unknown): boolean => error instanceof PausedReadFailure
  || (error as { code?: unknown } | null)?.code === NEEDS_CONNECTION;
const cacheKey = (owner: string, resource: ResourceRef) => JSON.stringify([owner, resource.collection, resource.id]);
const COUNCIL_CARRY = 'council-carry';
const ANALYSIS_RESHAPE = 'analysis-reshape';
const ENGINE_DISPOSED = 'DataEngine has been disposed';
const RECOVERY_REMOVAL_UNAVAILABLE = 'Recovery removal is unavailable';
const DRAFT_OPEN = 'draft-open';
const initialObservation = (): Observation => ({ snapshot: null, source: null, readiness: 'unknown', checking: false, error: false });
const analysisCopyNeedsReview = (checkpoint: SessionCheckpoint, expected: readonly DocumentData[], allowEmpty: boolean): boolean =>
  checkpoint.conflicts.length > 0 || (!(allowEmpty && checkpoint.draft === null)
    && !expected.some(value => equalValues(value, checkpoint.draft)));

/** Public lifecycle boundary: callers never manage replay, baselines, or transport choice. */
export class DataEngine {
  private readonly localWriteback: LocalWriteback;
  private readonly recoveryPresence: RecoveryPresence;
  private readonly membershipPresence = new WeakMap<MembershipScope, RecoveryPresenceLease>();
  private owner: string | null = null;
  private generation = 0;
  private online = true;
  private visible = true;
  private readPause = 0;
  private disposed = false;
  /** The next send of an unanswered delivery (`unanswered.ts`), and the attempts its pause was set for. */
  private redeliveryTimer: ReturnType<typeof setTimeout> | null = null;
  private redeliveryAttempts = 0;
  private readonly editors = new Map<string, EditorEntry>();
  private readonly recovering = new Map<string, object>();
  private readonly cacheWrites = new Map<string, { owner: string; generation: number; resource: ResourceRef; operation: Promise<ResourceSnapshot> }>();
  private readonly reads = new Map<string, Promise<ResourceSnapshot>>();
  private pending: JournalEntry[] = [];
  private pendingByOperation = new OpenEditorJournal([]);
  private pendingVersion = 0;
  private readonly pendingListeners = new Set<() => void>();
  private openAnswers: readonly ResourceRef[] = Object.freeze([]);
  private readonly openAnswerListeners = new Set<() => void>();
  private openAnswerScopes: readonly OpenDocumentAnswer[] = Object.freeze([]);
  private readonly openAnswerScopeListeners = new Set<() => void>();
  private readonly reachableListeners = new Set<() => void>();
  private readonly refreshedOperations = new Set<string>();
  private readonly refreshedCollectionOperations = new Set<string>();
  private readonly stopRuntime: () => void;
  private readonly commits: CommitQueue;
  private readonly stopCommits: () => void;
  private readonly commitRecords = new Map<string, CommitRequest>();
  private readonly editorRequests = new OpenEditorRequests();
  private readonly projectedCommitEvents = new Map<string, number>();
  private localRefresh: { generation: number; requested: boolean; operation: Promise<void> } | null = null;
  private settling: { owner: string; generation: number; operation: Promise<void> } | null = null;
  private resumingAutosaves: StartupDraftRecovery | null = null;
  private readonly serviceOrderEditorsOpenedHere = new Set<string>();
  private manualForms = new Map<string, ManualFormEntry>();
  private membershipForms = new Map<string, MembershipScope>();
  private membershipOpenings = new Map<string, Promise<MembershipScope>>();
  private membershipReleases = new Map<string, MembershipScope>();
  private membershipListeners = new Set<() => void>();
  private councilCarries = new Map<string, Promise<ResourceSnapshot>>();
  private analysisReshapes = new Set<string>();
  private capabilityProjections = new Map<string, Promise<void>>();
  private analysisCreationTransfers = new Map<string, Promise<ResourceRef>>();

  constructor(private readonly options: DataEngineOptions) {
    this.localWriteback = options.localWriteback ?? new LocalWriteback();
    this.recoveryPresence = new RecoveryPresence(options.recoveryPresence);
    this.commits = new CommitQueue({ store: options.commits, runtime: options.runtime,
      operationId: options.operationId, readConfirmed: resource => this.read(resource),
      readWriteTarget: resource => this.readWriteTarget(resource),
      readCommitted: (resource, proof) => this.readCommittedSnapshot(resource, proof), canDeliver: () => this.canSend() });
    this.stopCommits = this.commits.subscribe(({ request }) => {
      if (request.owner !== this.owner || this.disposed) return;
      this.rememberCommit(request);
      const manual = [...this.manualForms.values()].find(item => item.scopeId === request.editorId && !item.parent.closed);
      if (manual?.parent.controller && request.state !== 'cancelled') {
        try { this.background(manual.parent.controller.adoptManualCommit(request, manual.selection), request.owner, this.generation, request.baseline.resource); }
        catch (error) { this.reportFailure(error, request.baseline.resource); }
        manual.emit();
      }
      if (['acknowledged', 'cancelled'].includes(request.state) && this.options.manualScopes) {
        this.background(this.options.manualScopes.compact(request.owner, request.editorId), request.owner, this.generation, request.baseline.resource);
      }
      if (request.result?.kind === 'acknowledged' && (this.projectedCommitEvents.get(request.id) ?? -1) < request.revision) {
        this.projectedCommitEvents.set(request.id, request.revision);
        const generation = this.generation;
        const projection = this.completeAcceptedProjection(request.owner, generation, request).then(() => {
          if (this.current(request.owner, generation) && this.resumingAutosaves?.waiting.has(request.id)) this.backgroundDrain();
        }).catch(error => {
          if (this.current(request.owner, generation) && this.projectedCommitEvents.get(request.id) === request.revision) {
            this.projectedCommitEvents.delete(request.id);
          }
          throw error;
        });
        this.background(projection, request.owner, generation, request.result.snapshot.resource);
      }
      for (const [editorId, entry] of this.editors) if (!entry.closed && (editorId === request.editorId || (request.atomic?.kind === COUNCIL_CARRY && entry.controller
        && sameResource(entry.controller.getState().checkpoint.confirmed.resource, request.baseline.resource)))) this.emit(entry);
    });
    this.stopRuntime = options.runtime.subscribe(event => this.onRuntime(event));
  }

  setOwner(owner: string | null): void {
    if (this.disposed || this.owner === owner) return;
    this.stopRedelivery();
    // Leaving an account retires its editors as surely as leaving a screen: what storage has not
    // caught up with is written under the account that typed it, never under the next one.
    const previous = this.owner, previousGeneration = this.generation;
    const retiringEditors = [...this.editors].map(([editorId, entry]) => ({
      entry, writeback: previous ? this.keepRetiringEditor(previous, previousGeneration, editorId, entry) : undefined,
    }));
    this.editors.clear();
    this.serviceOrderEditorsOpenedHere.clear();
    this.owner = owner;
    this.generation += 1;
    for (const { entry, writeback } of retiringEditors) this.close(entry, writeback);
    for (const manual of this.manualForms.values()) this.retireManual(manual, previousGeneration);
    this.manualForms.clear();
    for (const scope of new Set([...this.membershipForms.values(), ...this.membershipReleases.values()])) {
      const pending = this.retainLocal(scope.retire(), previousGeneration);
      this.membershipPresence.get(scope)?.releaseAfter(pending);
    }
    this.membershipForms.clear();
    this.membershipOpenings.clear();
    this.membershipReleases.clear();
    this.recovering.clear();
    this.reads.clear();
    this.options.runtime.setOwner(owner);
    this.commits.setOwner(owner);
    this.commitRecords.clear();
    this.editorRequests.clear();
    this.projectedCommitEvents.clear();
    this.options.collections?.setOwner(owner);
    this.options.observer.setOwner(owner);
    this.refreshedOperations.clear();
    this.refreshedCollectionOperations.clear();
    this.publishPending([], true);
    if (owner) {
      const generation = this.generation;
      const version = this.pendingVersion;
      this.background(this.options.runtime.list().then(entries => {
        if (this.current(owner, generation) && this.pendingVersion === version) this.publishPending(entries);
      }), owner, generation);
    }
    this.backgroundDrain();
  }

  setVisible(visible: boolean): void {
    if (this.disposed) return;
    if (!visible) {
      this.preserveDraftReserves();
      this.flushServiceOrderInputs();
      this.flushGroupMeetingEdits();
    }
    const changed = this.visible !== visible;
    this.visible = visible;
    if (visible) this.refreshLocalOnReturn();
    if (!changed) return;
    if (!visible) this.readPause += 1;
    this.options.collections?.setVisible(visible);
    this.options.observer.setVisible(visible);
    if (visible) this.backgroundDrain();
    this.notifyReachable();
  }

  /** Complete only device-local emergency writes before the page can disappear. */
  preserveDraftReserves(): void {
    for (const entry of this.editors.values()) {
      entry.planCellEmergency?.preserve();
      entry.serviceOrderInputReserve?.preserve();
    }
  }

  flushServiceOrderInputs(): void {
    for (const entry of this.editors.values()) void entry.serviceOrderAutosave?.flush().catch(() => undefined);
  }

  flushGroupMeetingEdits(): void {
    for (const form of this.manualForms.values()) form.meetingSave?.flush();
  }

  /** Focus is a hint to reread durable local work, never proof of delivery or action order. */
  private refreshLocalOnReturn(): void {
    const owner = this.owner, generation = this.generation;
    if (!owner) return;
    if (this.localRefresh?.generation === generation) { this.localRefresh.requested = true; return; }
    const refresh = { generation, requested: false, operation: Promise.resolve() };
    refresh.operation = Promise.resolve().then(async () => {
      do {
        refresh.requested = false;
        if (!this.current(owner, generation) || !this.visible) return;
        await this.refreshLocalCopies(owner, generation);
      } while (refresh.requested);
    }).finally(() => { if (this.localRefresh === refresh) this.localRefresh = null; });
    this.localRefresh = refresh;
    this.background(refresh.operation, owner, generation);
  }

  private async refreshLocalCopies(owner: string, generation: number): Promise<void> {
    const before = new Map(this.commitRecords);
    const requests = await this.commits.refreshStored(); this.assertCurrent(owner, generation);
    const present = new Set(requests.map(request => request.id));
    // A complete read may retire an old projection, never a newer event or a held delivery.
    for (const [id, request] of before) {
      if (!present.has(id) && this.commitRecords.get(id) === request) {
        this.commitRecords.delete(id);
        this.editorRequests.delete(request);
        this.projectedCommitEvents.delete(id);
      }
    }
    const editors = [...this.editors.values()].filter(entry => !entry.closed && entry.controller);
    await Promise.all(editors.map(entry => entry.controller!.settled())); this.assertCurrent(owner, generation);
    const observeAccepted = async (entry: EditorEntry) => {
      const controller = entry.controller;
      if (entry.closed || !controller) return;
      const resource = controller.getState().checkpoint.confirmed.resource;
      const snapshot = await this.knownSnapshot(owner, generation, resource); this.assertCurrent(owner, generation);
      if (!entry.closed && entry.controller === controller && snapshot) await controller.observe(snapshot, 'cache');
    };
    // A collected ACK may be the exact baseline of the next submitted root.
    await Promise.all(editors.map(observeAccepted)); this.assertCurrent(owner, generation);
    await Promise.all(editors.map(entry => this.followEditorOnReturn(entry, owner, generation)));
    this.assertCurrent(owner, generation);
    // A source may have completed while its stale hint was being checked/pinned.
    await Promise.all(editors.map(observeAccepted)); this.assertCurrent(owner, generation);
    await this.options.collections?.reloadWatchedCaches();
  }

  private async followEditorOnReturn(entry: EditorEntry, owner: string, generation: number): Promise<void> {
    const controller = entry.controller;
    if (entry.closed || !controller) return;
    const followed = await controller.followSubmittedWork();
    if (entry.closed || !this.current(owner, generation)) return;
    followed?.forEach(request => this.rememberCommit(request));
    const after = controller.getState().checkpoint;
    await Promise.all([...this.manualForms.values()].filter(form => form.parent === entry)
      .map(form => this.followReturnedManualForm(form, owner, after)));
  }

  private async followReturnedManualForm(form: ManualFormEntry, owner: string, checkpoint: SessionCheckpoint): Promise<void> {
    const scope = form.scope;
    if (!scope) return;
    const { record, dirty, value } = scope.getState();
    if (!record.active || record.savedGeneration !== null || record.recoverySources?.length) return;
    const predecessor = record.predecessor && this.commitRecords.get(record.predecessor.id);
    const source = predecessor?.state === 'cancelled' && readManualScopeIdentity(predecessor.editorId);
    const target = source && readManualScopeIdentity(record.scopeId);
    if (source && target && areDifferentTabManualParents(source.parentEditorId, target.parentEditorId, record.resource)) {
      await scope.continueAfterChoice(this.captureManual(form.parent, owner, form.selection, checkpoint), predecessor!.id);
      form.emit();
      return;
    }
    if (dirty || !form.selection.some(path => !sameManualSelection(value, checkpoint.draft, path))) return;
    const capture = this.captureManual(form.parent, owner, form.selection, checkpoint);
    if (capture.provenance.some(item => checkpoint.pending[item.requestId]?.borrowedManualScope)) await form.form.follow();
  }

  setOnline(online: boolean): void {
    if (this.disposed || this.online === online) return;
    this.online = online;
    if (!online) this.readPause += 1;
    this.options.collections?.setOnline(online);
    this.options.observer.setOnline(online);
    if (online) this.backgroundDrain();
    this.notifyReachable();
  }

  /**
   * Call `listener` once, when this tab can ask the server — now or after it becomes visible and
   * online. A screen whose document was refused only for want of the server (`needsConnection`)
   * reads it again then, instead of waiting for the person to press Retry
   * (BUG-20261006-hidden-tab-document-read-not-retried). Returns a function that cancels the call.
   */
  onceReachable(listener: () => void): () => void {
    if (this.disposed) return () => undefined;
    const call = () => {
      // Asked again when called: since the promise was queued the tab may have gone hidden or offline,
      // the engine may be disposed (which empties the set), or the screen may have stopped waiting.
      if (!this.reachableListeners.has(call) || !this.canRead()) return;
      this.reachableListeners.delete(call);
      listener();
    };
    this.reachableListeners.add(call);
    if (this.canRead()) void Promise.resolve().then(call);
    return () => { this.reachableListeners.delete(call); };
  }

  private notifyReachable(): void {
    if (!this.canRead()) return;
    for (const call of [...this.reachableListeners]) { try { call(); } catch { /* A screen's retry cannot change the engine. */ } }
  }

  read(resource: ResourceRef): Promise<ResourceSnapshot> {
    const owner = this.requireOwner();
    this.validateResource(resource, owner);
    const generation = this.generation;
    const frozen = copy(resource);
    const key = cacheKey(owner, frozen);
    const existing = this.reads.get(key);
    if (existing) return existing.then(copy);
    const operation = this.readSnapshot(owner, generation, frozen);
    this.reads.set(key, operation);
    void operation.finally(() => {
      if (this.reads.get(key) === operation) this.reads.delete(key);
    }).catch(() => undefined);
    return operation.then(copy);
  }

  /**
   * A LOOK THAT NEEDS NO EDITOR STORAGE (BUG-20260927-engine-open-hangs-on-silent-device-storage).
   * When the editor's own storage does not answer, the screen can still show what this device
   * confirmed earlier (`peekCached`) or what the server holds now (`peekRemote`). Neither writes
   * anything or touches commits and checkpoints, so a copy shown this way cannot become a draft.
   */
  async peekCached(resource: ResourceRef): Promise<ResourceSnapshot | undefined> {
    const owner = this.requireOwner(), generation = this.generation;
    this.validateResource(resource, owner);
    const cached = await this.options.snapshots.read(owner, copy(resource));
    this.assertCurrent(owner, generation);
    if (cached && !sameResource(cached.resource, resource)) throw new Error(CACHED_IDENTITY_MISMATCH);
    return cached;
  }

  async peekRemote(resource: ResourceRef, options?: EngineReadOptions): Promise<ResourceSnapshot> {
    const owner = this.requireOwner(), generation = this.generation;
    this.validateResource(resource, owner);
    if (!this.online || !this.visible) throw new Error('The server cannot be asked right now');
    const server = await (options ? this.options.transport.read(owner, copy(resource), options)
      : this.options.transport.read(owner, copy(resource)));
    this.assertCurrent(owner, generation);
    if (!sameResource(server.resource, resource)) throw new Error(SERVER_SNAPSHOT_IDENTITY_MISMATCH);
    return server;
  }

  /** A captured write may need its target even when this page is hidden; cache is not proof. */
  private async readWriteTarget(resource: ResourceRef): Promise<ResourceSnapshot | null> {
    const owner = this.requireOwner(), generation = this.generation;
    this.validateResource(resource, owner);
    if (!this.canSend()) return null;
    const snapshot = await this.options.transport.read(owner, copy(resource), { fresh: true });
    this.assertCurrent(owner, generation);
    if (!sameResource(snapshot.resource, resource)) throw new Error(SERVER_SNAPSHOT_IDENTITY_MISMATCH);
    if (!snapshotBelongsToOwner(owner, snapshot)) throw Object.assign(new Error('Write target belongs to another owner'), { code: 'permission-denied' });
    return snapshot;
  }

  /** The list counterparts: the rows this device confirmed, or the whole list from the server. */
  async peekCollectionCached(collection: string): Promise<CollectionState> {
    const owner = this.requireOwner(), generation = this.generation;
    const snapshots = await this.collectionReader().peekCached(collection);
    this.assertCurrent(owner, generation);
    return this.projectCollection(owner, collection, { snapshots, complete: false, freshness: 'cache', version: 0, checking: false, error: null });
  }

  async peekCollectionRemote(collection: string): Promise<CollectionState> {
    const owner = this.requireOwner(), generation = this.generation;
    const { snapshots, version } = await this.collectionReader().peekRemote(collection);
    this.assertCurrent(owner, generation);
    return this.projectCollection(owner, collection, { snapshots, complete: true, freshness: 'server', version, checking: false, error: null });
  }

  /** A delayed list may finish after delivery has already advanced the same request. */
  private rememberCommit(request: CommitRequest): void {
    const current = this.commitRecords.get(request.id);
    if (current && current.revision >= request.revision) return;
    this.commitRecords.set(request.id, request);
    this.editorRequests.set(request, current);
  }

  private requestsForChoice(owner: string, ids: readonly string[], editorId?: string): CommitRequest[] {
    return this.editorRequests.forChoice(this.commitRecords, owner, ids, editorId);
  }

  private journalForRequests(requests: readonly CommitRequest[]): JournalEntry[] {
    return this.pendingByOperation.forOperations(requests.flatMap(request =>
      [request.command?.operationId, request.atomic?.id].filter((id): id is string => Boolean(id))));
  }

  private canReplaceOpenIntent(owner: string, editorId: string, ids: readonly string[]): boolean {
    if (!ids.length) return false;
    const requests = this.requestsForChoice(owner, ids, editorId);
    return canReplaceDocumentIntent(owner, editorId, ids, requests, this.journalForRequests(requests));
  }

  private answerForOpenIntent(owner: string, resource: ResourceRef, ids: readonly string[], journal = this.pendingByOperation) {
    const requests = ids.flatMap(id => {
      const request = this.commitRecords.get(id);
      return request ? [request] : [];
    });
    return savedDocumentAnswer(owner, resource, ids, requests, journal.forOperations(ids));
  }

  private projectCollection(owner: string, collection: string, state: CollectionState): CollectionState {
    return { ...state,
      documents: collectionDocumentViews(owner, collection, state.snapshots, this.editorRequests.forCollection(owner, collection),
        collection === 'studyNoteShareLinks' ? this.pendingByOperation.forShareLinks(owner) : []) };
  }

  readCollection(collection: string): Promise<CollectionState> {
    const owner = this.requireOwner(), generation = this.generation;
    return this.collectionReader().read(collection, { allowIncompleteCache: true }).then(async state => {
      const requests = await this.commits.listForCollection(collection); this.assertCurrent(owner, generation);
      requests.forEach(request => this.rememberCommit(request));
      return this.projectCollection(owner, collection, state);
    });
  }

  watchCollection(collection: string, listener: (state: CollectionState) => void): () => void {
    const owner = this.requireOwner(), generation = this.generation;
    const reader = this.collectionReader();
    let active = true, latest: CollectionState | null = null;
    const emit = () => {
      if (!active || !latest) return;
      if (!this.current(owner, generation)) {
        active = false;
        listener({ snapshots: [], documents: [], complete: false, freshness: 'unknown', checking: false, version: 0, error: null });
        return;
      }
      listener(this.projectCollection(owner, collection, latest));
    };
    const stopRead = reader.watch(collection, state => { latest = state; emit(); });
    const stopCommits = this.commits.subscribe(({ request }) => {
      if (request.owner === owner && request.baseline.resource.collection === collection) emit();
    });
    this.background(this.commits.listForCollection(collection).then(requests => {
      if (!active || !this.current(owner, generation)) return;
      requests.forEach(request => this.rememberCommit(request));
      emit();
    }), owner, generation);
    const stopPending = collection === 'studyNoteShareLinks' ? this.subscribePending(emit) : () => undefined;
    return () => { active = false; stopRead(); stopCommits(); stopPending(); };
  }

  refreshCollection(collection: string): Promise<CollectionState> {
    const owner = this.requireOwner(), generation = this.generation;
    return this.collectionReader().refresh(collection).then(async state => {
      const requests = await this.commits.listForCollection(collection); this.assertCurrent(owner, generation);
      requests.forEach(request => this.rememberCommit(request));
      return this.projectCollection(owner, collection, state);
    });
  }

  openEditor(resource: ResourceRef, editorId: string, options?: EditorOpenOptions): Promise<ManagedEditor> {
    return this.open(resource, editorId, false, options);
  }

  /** Capture the confirmed note the person saw before a share request can wait for delivery. */
  async createShareLink(noteId: string, authorLanguage: AppLocale, observed?: ResourceSnapshot | null, replaces?: string): Promise<void> {
    const owner = this.requireOwner(), generation = this.generation;
    const resource = { collection: 'studyNotes', id: noteId };
    const note = observed === undefined ? await this.read(resource) : observed && copy(observed);
    this.assertCurrent(owner, generation);
    if (!note) throw Object.assign(new Error('Read the note before sharing it'), { code: NEEDS_CONNECTION });
    if (!sameResource(note.resource, resource) || !snapshotBelongsToOwner(owner, note)) {
      throw Object.assign(new Error('The note belongs to another owner'), { code: 'permission-denied' });
    }
    if (!note.value || note.metadata?.deleted) throw Object.assign(new Error('The note no longer exists'), { code: 'referenced-document-deleted' });
    if (replaces) {
      const prior = (await this.options.runtime.list()).find(entry => entry.command.operationId === replaces);
      this.assertCurrent(owner, generation);
      if (!prior || !['refused', 'conflict'].includes(prior.state) || prior.command.kind !== 'relation'
        || prior.command.relation !== 'share-link-create' || prior.command.note.id !== noteId) throw new Error('The share decision changed');
    }
    const operationId = this.options.operationId();
    await this.captureShareCapability({ protocol: 1, operationId, owner, resource: { collection: 'studyNoteShareLinks', id: this.options.operationId() },
      generation: null, dependsOn: [], kind: 'relation', relation: 'share-link-create',
      note: { id: noteId, generation: note.metadata?.generation ?? null, shareRevocation: note.metadata?.shareRevocation ?? null }, authorLanguage }, owner, generation);
    if (replaces) await this.options.runtime.discard(replaces);
  }

  async revokeShareLink(linkId: string): Promise<void> {
    const owner = this.requireOwner(), generation = this.generation;
    const resource = { collection: 'studyNoteShareLinks', id: linkId };
    const link = await this.read(resource); this.assertCurrent(owner, generation);
    if (!snapshotBelongsToOwner(owner, link)) throw Object.assign(new Error('The link belongs to another owner'), { code: 'permission-denied' });
    await this.captureShareCapability({ protocol: 1, operationId: this.options.operationId(), owner, resource,
      generation: link.metadata?.generation ?? null, dependsOn: [], kind: 'relation', relation: 'share-link-revoke' }, owner, generation);
  }

  /** Retry unanswered delivery with its exact ID; a proven refusal needs a fresh explicit action. */
  async retryShareCapability(operationId: string): Promise<void> {
    const owner = this.requireOwner(), generation = this.generation;
    const entry = (await this.options.runtime.list()).find(item => item.command.operationId === operationId);
    this.assertCurrent(owner, generation);
    if (!entry) return;
    const command = entry.command;
    if (command.resource.collection !== 'studyNoteShareLinks' || command.kind !== 'relation'
      || !['share-link-create', 'share-link-revoke'].includes(command.relation)) throw new Error('Not a share capability action');
    if (!['refused', 'conflict'].includes(entry.state)) { await this.retry(); return; }
    if (command.relation === 'share-link-create') {
      if (command.note.shareRevocation === undefined
        || (entry.result?.kind === 'refused' && entry.result.code === 'share-link-review-required')) return;
      // Delivery retry keeps the old access observation, even when a terminal receipt needs a new ID.
      await this.captureShareCapability({ ...command, operationId: this.options.operationId(),
        resource: { ...command.resource, id: this.options.operationId() } }, owner, generation);
    } else await this.revokeShareLink(command.resource.id);
    this.assertCurrent(owner, generation);
    await this.options.runtime.discard(operationId);
  }

  private async captureShareCapability(command: DataCommand, owner: string, generation: number): Promise<void> {
    this.assertCurrent(owner, generation);
    await this.options.runtime.submit(command); this.assertCurrent(owner, generation);
    // Runtime.submit owns durable capture; delivery must never hold the interactive action open.
    this.backgroundDrain();
  }

  /** Explicit absent intent: a server-side create can never replace an existing ID. */
  createEditor(resource: ResourceRef, editorId: string, options?: EditorOpenOptions): Promise<ManagedEditor> {
    return this.open(resource, editorId, true, options);
  }

  /** The selector opens only after the engine pins its complete displayed series list. */
  async beginMembership(): Promise<MembershipScope> {
    const owner = this.requireOwner(), generation = this.generation;
    if (!this.options.membershipScopes) throw new Error('Membership stage storage is not configured');
    const state = await this.collectionReader().read('series');
    const requests = await this.commits.list(); this.assertCurrent(owner, generation);
    return this.openMembershipScope(owner, generation, state, requests);
  }

  private async openMembershipScope(owner: string, generation: number, state: CollectionState, requests: CommitRequest[]): Promise<MembershipScope> {
    const scopeId = this.options.operationId();
    const scope = MembershipScope.begin(owner, scopeId, captureMembershipPins(owner, state, requests), this.membershipPort(owner, generation), state.version);
    this.membershipPresence.set(scope, this.recoveryPresence.hold(owner, 'membership', [scopeId]));
    this.membershipForms.set(scopeId, scope);
    try { await scope.settled(); this.assertCurrent(owner, generation); return scope; }
    catch (error) { if (this.membershipForms.get(scopeId) === scope) this.membershipForms.delete(scopeId); this.membershipPresence.get(scope)?.release(); scope.dispose(); throw error; }
  }

  /** Keeping the shown assignment retires only the exact refused attempt. */
  async keepMembership(scopeId: string, compared: readonly SeriesMembershipComparison[]): Promise<void> {
    const owner = this.requireOwner(), generation = this.generation;
    const delivery = await this.membershipDelivery(scopeId);
    this.assertCurrent(owner, generation);
    if (!delivery.canChooseExact || !compared.length || !equalValues(delivery.comparisons, compared)) {
      throw Object.assign(new Error('The assignment shown has changed'), { code: 'membership-stage-changed' });
    }
    await this.discardMembership(scopeId, true);
  }

  async keepSeriesReorder(scopeId: string, compared: SeriesReorderComparison): Promise<void> {
    const owner = this.requireOwner(), generation = this.generation;
    const delivery = await this.membershipDelivery(scopeId);
    this.assertCurrent(owner, generation);
    if (!delivery.canChooseReorder || !equalValues(delivery.reorderComparison, compared)) {
      throw Object.assign(new Error('The series order shown has changed'), { code: 'membership-stage-changed' });
    }
    await this.discardMembership(scopeId, true);
  }

  reviewMembership(scopeId: string, compared: readonly SeriesMembershipComparison[]): Promise<MembershipScope> {
    return this.reviewSeriesAction(scopeId, { kind: 'assignment', compared });
  }

  reviewSeriesReorder(scopeId: string, compared: SeriesReorderComparison): Promise<MembershipScope> {
    return this.reviewSeriesAction(scopeId, { kind: 'reorder', compared });
  }

  /** Keep the failed action until a reviewed replacement is a durable unsent draft. */
  private async reviewSeriesAction(scopeId: string, review: { kind: 'assignment'; compared: readonly SeriesMembershipComparison[] }
    | { kind: 'reorder'; compared: SeriesReorderComparison }): Promise<MembershipScope> {
    const owner = this.requireOwner(), generation = this.generation;
    const record = await this.options.membershipScopes?.read(owner, scopeId); this.assertCurrent(owner, generation);
    const changed = () => Object.assign(new Error('The series choice shown has changed'), { code: 'membership-stage-changed' });
    if (!record || record.creation || record.phase !== 'submitted' || !record.action) throw changed();
    const state = await this.collectionReader().refresh('series');
    const [requests, journal] = await Promise.all([this.commits.list(), this.options.runtime.list()]);
    this.assertCurrent(owner, generation);
    const delivery = describeMembershipDelivery(record, requests, journal);
    if (!state.complete || state.freshness !== 'server') throw changed();
    if (review.kind === 'reorder' ? !delivery.canChooseReorder || !equalValues(delivery.reorderComparison, review.compared)
      : !delivery.canChooseExact || !review.compared.length || !equalValues(delivery.comparisons, review.compared)) throw changed();

    if (review.kind === 'reorder') {
      const shown = review.compared;
      const latest = state.snapshots.find(snapshot => snapshot.resource.id === shown.seriesId);
      // A member removed and added again can have the same ID and position.
      if (!latest?.value || (latest.metadata?.revision ?? 0) !== shown.revision
        || (latest.metadata?.generation ?? null) !== shown.generation || !equalValues(membershipItems(latest.value), shown.stored)) {
        throw Object.assign(new Error('The saved series order changed during comparison'), { code: 'series-reorder-comparison-changed' });
      }
    }

    const scope = await this.openMembershipScope(owner, generation, state, requests.filter(request => !record.requestIds.includes(request.id)));
    let staged = false;
    try {
      const opening = scope.getState().values;
      let action = record.action;
      if (review.kind === 'reorder') {
        const { seriesId, generation: shownGeneration, proposed } = review.compared;
        if (action.kind !== 'reorder' || action.seriesId !== seriesId) throw changed();
        const target = opening.find(row => row.id === seriesId && row.generation === shownGeneration);
        const shownOrder = target && membershipItems(target.value);
        const reviewed = shownOrder && equalValues(shownOrder, review.compared.stored)
          && reviewedSeriesReorder(shownOrder, proposed, action.reorder);
        if (!reviewed || !reviewed.trace.length) throw changed();
        action = { ...action, itemIds: reviewed.rows.map(row => row.id), reorder: reviewed.trace };
      } else {
        if (action.kind === 'reorder' || !showsSeriesMembershipComparison(opening, review.compared)) throw changed();
        if (action.kind === 'assign') {
          const targetId = action.targetId;
          const captured = record.pins.find(pin => pin.baseline.resource.id === targetId);
          const target = opening.find(row => row.id === targetId);
          if (!captured || !target || target.generation !== (captured.baseline.metadata?.generation ?? null)) throw changed();
        }
      }
      await scope.update(action); staged = true;
      this.assertCurrent(owner, generation);
      await this.discardMembership(scopeId, true);
      this.assertCurrent(owner, generation);
      return scope;
    } catch (error) {
      if (this.current(owner, generation)) {
        if (!staged) await scope.cancel().catch(() => undefined);
        this.releaseMembership(scope.getState().record.scopeId);
      }
      throw error;
    }
  }

  /** A creation draft exists durably before any optional catalog request. */
  async beginMemberCreation(collection: 'sermons' | 'groups', value: DocumentData, requestedSeriesId?: string): Promise<MembershipScope> {
    const owner = this.requireOwner(), generation = this.generation;
    if (!this.options.membershipScopes) throw new Error('Creation stage storage is not configured');
    const scopeId = `${CREATION_SCOPE_PREFIX}${this.options.operationId()}`;
    const resource = { collection, id: this.options.operationId() };
    const scope = MembershipScope.beginCreation(owner, scopeId, resource, { ...value, userId: owner }, this.membershipPort(owner, generation), requestedSeriesId);
    this.membershipPresence.set(scope, this.recoveryPresence.hold(owner, 'membership', [scopeId]));
    this.membershipForms.set(scopeId, scope);
    try { await scope.settled(); this.assertCurrent(owner, generation); return scope; }
    catch (error) { if (this.membershipForms.get(scopeId) === scope) this.membershipForms.delete(scopeId); this.membershipPresence.get(scope)?.release(); scope.dispose(); throw error; }
  }

  /** Open the optional selector separately; creating an unlinked draft needs no catalog read. */
  async openCreationSeries(scopeId: string): Promise<void> {
    const owner = this.requireOwner(), generation = this.generation, scope = this.membershipForms.get(scopeId);
    if (!scope?.getState().record.creation) throw new Error('Open a creation stage first');
    if (scope.getState().record.creation?.seriesOpened) return;
    const state = await this.collectionReader().read('series');
    const requests = await this.commits.list(); this.assertCurrent(owner, generation);
    if (this.membershipForms.get(scopeId) !== scope) throw new Error('Creation stage changed');
    if (scope.getState().record.phase !== 'editing') return;
    await scope.pinCreationSeries(captureMembershipPins(owner, state, requests));
  }

  /** Recovery is an explicit continuation of the same durable Save identity. */
  async recoverMembership(scopeId: string, { exclusive = false }: { exclusive?: boolean } = {}): Promise<MembershipScope> {
    const owner = this.requireOwner(), generation = this.generation;
    if (!this.options.membershipScopes) throw new Error('Membership stage storage is not configured');
    const existing = this.membershipForms.get(scopeId), opening = this.membershipOpenings.get(scopeId);
    if (this.membershipReleases.has(scopeId) || (exclusive && (existing || opening))) throw new Error('Membership action is already open');
    if (existing) return existing;
    if (opening) return opening;
    let presence: RecoveryPresenceLease | undefined;
    const restoring = (async () => {
      const checking = this.recoveryAvailability(owner, 'membership', scopeId);
      if (checking) await checking;
      this.assertCurrent(owner, generation);
      presence = this.recoveryPresence.hold(owner, 'membership', [scopeId]);
      const repairing = this.localWriteback.retry(owner, address => address.kind === 'membership' && address.id === scopeId);
      if (repairing) await repairing;
      this.assertCurrent(owner, generation);
      const record = await this.options.membershipScopes!.read(owner, scopeId); this.assertCurrent(owner, generation);
      if (!record) throw Object.assign(new Error('Membership recovery no longer exists'), { code: 'draft-gone' });
      const scope = MembershipScope.restore(record, this.membershipPort(owner, generation));
      this.membershipPresence.set(scope, presence);
      this.membershipForms.set(scopeId, scope); this.emitMembership(); return scope;
    })();
    this.membershipOpenings.set(scopeId, restoring);
    try { return await restoring; }
    catch (error) { presence?.release(); throw error; }
    finally { if (this.membershipOpenings.get(scopeId) === restoring) this.membershipOpenings.delete(scopeId); }
  }

  /** Leaving a selector retains its unsent stage; an invoked Save finishes local ownership. */
  releaseMembership(scopeId: string): void {
    const scope = this.membershipForms.get(scopeId);
    if (!scope || !this.owner) return;
    const owner = this.owner, generation = this.generation;
    this.membershipForms.delete(scopeId);
    this.membershipReleases.set(scopeId, scope);
    // A stage is about the document it creates, or about series membership — never about everything.
    const about = scope.getState().record.creation?.resource ?? { collection: 'series' };
    this.background(scope.settled().then(async () => {
      this.assertCurrent(owner, generation);
      const record = scope.getState().record;
      if (record.phase === 'editing' && record.action === null && !record.creation) await scope.cancel();
      await this.options.membershipScopes!.compact(owner, scopeId);
    }).finally(() => {
      const pending = this.retainLocal(scope.retire(), generation);
      this.membershipPresence.get(scope)?.releaseAfter(pending);
      if (this.membershipReleases.get(scopeId) === scope) this.membershipReleases.delete(scopeId);
      if (this.current(owner, generation)) this.emitMembership();
    }), owner, generation, about);
  }

  async listMembershipRecovery({ closedOnly = false }: { closedOnly?: boolean } = {}): Promise<MembershipScopeRecord[]> {
    const owner = this.requireOwner(), generation = this.generation;
    const store = this.options.membershipScopes;
    if (!store) return [];
    const repairing = this.localWriteback.retry(owner, address => address.kind === 'membership');
    if (repairing) await repairing; this.assertCurrent(owner, generation);
    const records = await store.list(owner); this.assertCurrent(owner, generation);
    for (const record of records) { await store.compact(owner, record.scopeId); this.assertCurrent(owner, generation); }
    const remaining = await store.list(owner); this.assertCurrent(owner, generation);
    return remaining.filter(record => record.phase !== 'cancelled' && (record.action || record.creation || record.phase === 'saving')
      && (!closedOnly || (!this.membershipForms.has(record.scopeId) && !this.membershipOpenings.has(record.scopeId) && !this.membershipReleases.has(record.scopeId))));
  }

  /** Choice-list boundary; delivery and cleanup consumers retain the raw query. */
  async listMembershipRecoveryChoices(): Promise<MembershipScopeRecord[]> {
    const owner = this.requireOwner(), generation = this.generation;
    const records = await this.listMembershipRecovery({ closedOnly: true });
    return this.recoveryChoices(owner, generation, 'membership', records, record => record.scopeId);
  }

  /** Unsent membership drafts use the same exact-copy boundary as other recovery lists. */
  async discardMembershipRecovery(source: MembershipScopeRecord): Promise<void> {
    const owner = this.requireOwner(), generation = this.generation;
    if (source.owner !== owner) throw new Error('Membership recovery owner changed');
    await this.requireClosedRecovery(owner, generation, 'membership', source.scopeId);
    if (!this.options.membershipScopes?.discardRecovery) throw new Error(RECOVERY_REMOVAL_UNAVAILABLE);
    await this.options.membershipScopes.discardRecovery(copy(source), () => this.current(owner, generation));
    this.assertCurrent(owner, generation);
  }

  /** An explicit discard is allowed only for a proven failed complete action. */
  async discardMembership(scopeId: string, onlyThoseRequests = false): Promise<void> {
    const owner = this.requireOwner(), generation = this.generation;
    const store = this.options.membershipScopes;
    const record = await store?.read(owner, scopeId); this.assertCurrent(owner, generation);
    if (!record || record.phase !== 'submitted' || !record.requestIds.length) throw Object.assign(new Error('Resolve the pending Save before discarding this action'), { code: 'pending-delivery-first' });
    const requests = await this.commits.list(); this.assertCurrent(owner, generation);
    if (record.requestIds.some(id => !requests.some(request => request.id === id && request.retentionScope === scopeId))) throw new Error('Membership action evidence changed');
    if (!record.requestIds.every(id => requests.some(request => request.id === id && request.state === 'cancelled'))) {
      await this.commits.cancelAction(record.requestIds, onlyThoseRequests); this.assertCurrent(owner, generation);
    }
    await Promise.all([...this.editors.values()].map(async entry => {
      if (entry.controller?.needsPersistenceRetry()) await entry.controller.retryPersistence();
      await entry.controller?.settled();
    }));
    this.assertCurrent(owner, generation);
    await this.commits.finishCancellation('', record.requestIds); this.assertCurrent(owner, generation);
    await store!.compact(owner, scopeId); this.assertCurrent(owner, generation);
    this.releaseMembership(scopeId);
  }

  async membershipDelivery(scopeId: string): Promise<MembershipDelivery> {
    const owner = this.requireOwner(), generation = this.generation, store = this.options.membershipScopes;
    const outcome = await store?.completion(owner, scopeId); this.assertCurrent(owner, generation);
    if (outcome) return { phase: outcome, canDiscard: false, code: null };
    const record = this.membershipForms.get(scopeId)?.getState().record ?? await store?.read(owner, scopeId);
    this.assertCurrent(owner, generation);
    if (!record) return { phase: 'unavailable', canDiscard: false, code: null };
    const [requests, journal] = await Promise.all([this.commits.list(), this.options.runtime.list()]);
    this.assertCurrent(owner, generation);
    return describeMembershipDelivery(record, requests, journal);
  }

  subscribeMembership(listener: () => void): () => void {
    const owner = this.requireOwner(), generation = this.generation;
    const notify = () => { if (this.current(owner, generation)) listener(); };
    this.membershipListeners.add(notify);
    const stopSavedWork = this.subscribeSavedWork(notify);
    return () => { this.membershipListeners.delete(notify); stopSavedWork(); };
  }

  /** Resume frozen capture or replay its existing identity; never rebase on retry. */
  async retryMembership(scopeId: string): Promise<void> {
    const owner = this.requireOwner(), generation = this.generation;
    const outcome = await this.options.membershipScopes?.completion(owner, scopeId); this.assertCurrent(owner, generation);
    if (outcome) return;
    const scope = await this.recoverMembership(scopeId); this.assertCurrent(owner, generation);
    if (['editing', 'cancelled'].includes(scope.getState().record.phase)) await scope.retryPersistence();
    else await scope.save();
    this.assertCurrent(owner, generation);
    await this.retry(); this.assertCurrent(owner, generation);
  }

  private membershipPort(owner: string, generation: number): import('./membershipScope').MembershipScopePort {
    const store = this.options.membershipScopes!;
    return {
      isCurrent: () => this.current(owner, generation),
      persist: async (record, revision) => {
        if (record.owner !== owner) throw new Error('Membership persistence owner changed');
        return store.persist(record, revision);
      },
      readSaveReceipt: (record, editingRevision) => {
        this.assertCurrent(owner, generation);
        if (record.owner !== owner) throw new Error('Membership receipt owner changed');
        return store.readSaveReceipt(record, editingRevision);
      },
      save: async captures => {
        this.assertCurrent(owner, generation);
        const first = captures[0];
        const saved = captures.length > 1 ? await this.commits.saveAtomic(captures)
          : [await this.commits.save(first.editorId, first.captured, { predecessorId: first.predecessorId,
            retentionScope: first.retentionScope, seriesMembership: first.seriesMembership })].filter((request): request is CommitRequest => Boolean(request));
        this.assertCurrent(owner, generation);
        this.prepareCommitsInBackground(); this.backgroundDrain(); return saved;
      },
    };
  }

  private assertMountedAnalysisCopies(resource: ResourceRef, expected: readonly DocumentData[], allowEmpty = false): void {
    for (const entry of this.editors.values()) if (!entry.closed && entry.controller) {
      const state = entry.controller.getState();
      if (sameResource(state.checkpoint.confirmed.resource, resource)
        && (state.preparing || state.captureFailed || analysisCopyNeedsReview(state.checkpoint, expected, allowEmpty))) return analysisCreationReview();
    }
  }

  private async assertClosedAnalysisCopies(resource: ResourceRef, expected: readonly DocumentData[], allowEmpty = false): Promise<void> {
    const copies = await this.listRecoverable(resource);
    if (copies.some(({ record }) => analysisCopyNeedsReview(record.checkpoint, expected, allowEmpty))) return analysisCreationReview();
  }

  /** A failed local continuation may already have captured its stable creation address. */
  async findStudyAnalysisCreation(id: string): Promise<{ resource: ResourceRef; value: DocumentData } | null> {
    const owner = this.requireOwner(), generation = this.generation;
    const resource = { collection: 'studyNotes', id }; this.validateResource(resource, owner);
    const requests = await this.commits.list(); this.assertCurrent(owner, generation);
    const transferred = requests.filter(request => request.owner === owner && request.transferredFrom
      && sameResource(request.transferredFrom.source, resource));
    if (transferred.length > 1) return analysisCreationReview();
    if (transferred.length === 1 && transferred[0].value) {
      if (requests.some(request => sameResource(request.baseline.resource, resource)
        && !['acknowledged', 'cancelled'].includes(request.state))) return analysisCreationReview();
      await this.assertClosedAnalysisCopies(resource, [transferred[0].transferredFrom!.value], true); this.assertCurrent(owner, generation);
      this.assertMountedAnalysisCopies(resource, [transferred[0].transferredFrom!.value], true);
      return { resource: copy(transferred[0].baseline.resource), value: copy(transferred[0].value!) };
    }
    const captured = requests.filter(request => request.owner === owner && request.retentionScope === analysisCreationScope(id)
      && sameResource(request.baseline.resource, resource));
    if (!captured.length) return null;
    if (captured.length !== 1 || captured[0].state === 'cancelled' || !captured[0].value) return analysisCreationReview();
    return { resource, value: copy(captured[0].value) };
  }

  /** Once an answering editor owns the request, its ordinary checkpoint replaces the temporary capture hold. */
  async releaseStudyAnalysisCreation(sourceId: string, adoptedId: string): Promise<void> {
    const owner = this.requireOwner(), generation = this.generation;
    const source = { collection: 'studyNotes', id: sourceId }, adopted = { collection: 'studyNotes', id: adoptedId };
    this.validateResource(source, owner); this.validateResource(adopted, owner);
    if (!this.options.commits.releaseCapture) return;
    const requests = (await this.commits.list()).filter(request => request.owner === owner);
    this.assertCurrent(owner, generation);
    const direct = sameResource(source, adopted);
    const roots = direct ? requests.filter(request => request.retentionScope === analysisCreationScope(sourceId)
      && sameResource(request.baseline.resource, source)) : [];
    const replacements = requests.filter(request => request.transferredFrom
      && request.retentionScope?.startsWith(ANALYSIS_CREATION_TRANSFER_PREFIX) && sameResource(request.baseline.resource, adopted)
      && (direct || sameResource(request.transferredFrom.source, source)));
    const held = [...roots, ...replacements];
    if (!held.length) return;
    const owns = (request: CommitRequest): boolean => [...this.editors].some(([editorId, entry]) => {
      if (entry.closed || !entry.controller || editorSlot(editorId) === ACTION_SLOT) return false;
      const { checkpoint, durable } = entry.controller.getState();
      return sameResource(checkpoint.confirmed.resource, adopted) && ((durable && Boolean(checkpoint.pending[request.id]))
        || (request.result?.kind === 'acknowledged' && request.result.snapshot.metadata !== null
          && coversCommittedEffect(checkpoint.confirmed, adopted, request.result.snapshot.metadata)));
    });
    if (!held.every(owns)) return analysisCreationReview();
    for (const request of held) {
      const proof = request.transferredFrom;
      // Keep the replacement's proof until its exact retired root is released.
      const root = proof && requests.find(candidate => candidate.id === proof.requestIds[0] && candidate.state === 'cancelled'
        && candidate.retentionScope === analysisCreationScope(proof.source.id) && sameResource(candidate.baseline.resource, proof.source)
        && candidate.transferredTo?.requestId === request.id && sameResource(candidate.transferredTo.resource, adopted));
      if (root?.retentionScope) {
        await this.options.commits.releaseCapture(owner, root.retentionScope, root.id); this.assertCurrent(owner, generation);
      }
      if (request.retentionScope) {
        await this.options.commits.releaseCapture(owner, request.retentionScope, request.id); this.assertCurrent(owner, generation);
      }
    }
  }

  /** Combine one refused generated creation through the queue, preserving the existing note address. */
  transferStudyAnalysisCreation(sourceId: string, targetId: string, text: BookText): Promise<ResourceRef> {
    const owner = this.requireOwner(), generation = this.generation;
    const source = { collection: 'studyNotes', id: sourceId }, target = { collection: 'studyNotes', id: targetId };
    this.validateResource(source, owner); this.validateResource(target, owner);
    const key = JSON.stringify([owner, source]);
    const running = this.analysisCreationTransfers.get(key); if (running) return running;
    const run = async (): Promise<ResourceRef> => {
      const requests = await this.commits.list(); this.assertCurrent(owner, generation);
      const previous = requests.filter(request => request.owner === owner
        && request.retentionScope?.startsWith(ANALYSIS_CREATION_TRANSFER_PREFIX)
        && request.transferredFrom && sameResource(request.transferredFrom.source, source));
      if (previous.length) {
        const saved = previous[0];
        if (previous.length !== 1 || !sameResource(saved.baseline.resource, target)
          || requests.some(request => sameResource(request.baseline.resource, source)
            && !['cancelled', 'acknowledged'].includes(request.state))) return analysisCreationReview();
        return copy(saved.baseline.resource);
      }
      const snapshot = await this.read(target); this.assertCurrent(owner, generation);
      const captured = captureAnalysisCreation(owner, source, snapshot, requests, text);
      // Older submitted source checkpoints are known ancestry; private later words are not.
      await this.assertClosedAnalysisCopies(source, captured.sources.map(request => request.value!)); this.assertCurrent(owner, generation);
      await this.assertClosedAnalysisCopies(target, [captured.targetValue]); this.assertCurrent(owner, generation);
      this.assertMountedAnalysisCopies(source, [captured.proof.value]);
      this.assertMountedAnalysisCopies(target, [captured.targetValue]);
      const saved = await this.commits.save(captured.editorId, captured.captured, {
        predecessorId: captured.predecessorId, retentionScope: captured.retentionScope,
        transfer: { proof: captured.proof, sources: captured.sources },
        checkpoint: request => {
          const session = DataSession.restore(captured.captured); session.applyCommit(request);
          return { owner, editorId: captured.editorId, checkpoint: session.checkpoint(), prepared: null, unfinalized: [] };
        },
      });
      this.assertCurrent(owner, generation);
      if (!saved) throw new Error('Analysis transfer did not capture its replacement');
      this.prepareCommitsInBackground(); this.backgroundDrain();
      return copy(saved.baseline.resource);
    };
    const pending = run(); this.analysisCreationTransfers.set(key, pending);
    void pending.finally(() => { if (this.analysisCreationTransfers.get(key) === pending) this.analysisCreationTransfers.delete(key); }).catch(() => undefined);
    return pending;
  }

  /** The entire reshape is captured before returning; navigation never owns its delivery. */
  async reshapeStudyAnalysis(edits: readonly StudyAnalysisWrite[]): Promise<void> {
    const owner = this.requireOwner(), generation = this.generation;
    const frozen = copy(edits), source = frozen[0]?.resource;
    if (!source) throw new Error('Analysis reshape requires a source');
    frozen.forEach(edit => this.validateResource(edit.resource, owner));
    const lock = JSON.stringify([owner, source]);
    if (this.analysisReshapes.has(lock)) throw Object.assign(new Error('Analysis action is already being captured'), { code: 'action-in-progress' });
    this.analysisReshapes.add(lock);
    const actionId = this.options.operationId();
    try {
      const snapshots = await Promise.all(frozen.map(async edit => edit.expected
        ? await this.peekCached(edit.resource) ?? await this.read(edit.resource)
        : { resource: edit.resource, value: null, metadata: null }));
      this.assertCurrent(owner, generation);
      const requests = await this.commits.list(); this.assertCurrent(owner, generation);
      // A mounted editor may contain newer words that have not reached a request yet.
      // The action must never silently remove or move a different frame than was shown.
      for (const entry of this.editors.values()) if (!entry.closed && entry.controller) {
        const checkpoint = entry.controller.getState().checkpoint;
        const edit = frozen.find(item => sameResource(item.resource, checkpoint.confirmed.resource));
        if (edit && (checkpoint.conflicts.length || !sameAnalysisFrame(edit.expected, checkpoint.draft))) {
          throw Object.assign(new Error('Resolve the current analysis first'), { code: 'resolve-version-first' });
        }
      }
      const captures = captureAnalysisReshape(owner, actionId, frozen, snapshots, requests);
      const saved = await this.commits.saveAtomic(captures); this.assertCurrent(owner, generation);
      for (const entry of this.editors.values()) if (!entry.closed && entry.controller) {
        const checkpoint = entry.controller.getState().checkpoint;
        const index = frozen.findIndex(item => sameResource(item.resource, checkpoint.confirmed.resource));
        if (index < 0 || checkpoint.conflicts.length || !sameAnalysisFrame(frozen[index].expected, checkpoint.draft)) continue;
        try { await entry.controller.adoptManualCommit(saved[index], ANALYSIS_RESHAPE_FIELDS.map(field => [field])); }
        catch (error) { this.reportFailure(error, frozen[index].resource); }
      }
      this.assertCurrent(owner, generation);
      this.prepareCommitsInBackground(); this.backgroundDrain();
    } finally { this.analysisReshapes.delete(lock); }
  }

  /** An action remains discoverable after every participating editor has closed. */
  async listAnalysisReshapes(): Promise<Array<{ id: string; resource: ResourceRef; title: string; delivery: MembershipDelivery }>> {
    const owner = this.requireOwner(), generation = this.generation;
    const requests = await (this.options.commits.listForAnalysisRecovery?.(owner) ?? this.commits.list());
    this.assertCurrent(owner, generation);
    return requests.filter(request => request.atomic?.kind === ANALYSIS_RESHAPE && request.id === request.atomic.id
      && !['acknowledged', 'cancelled'].includes(request.state)).map(request => ({ id: request.id,
      resource: copy(request.baseline.resource), title: typeof request.value?.title === 'string' ? request.value.title : '',
      delivery: describeActionDelivery(owner, request.atomic!.participants, requests, this.pending) }));
  }

  /** Explicitly discard every participant and dependent through the shared cancellation proof. */
  async discardAnalysisReshape(id: string): Promise<void> {
    const owner = this.requireOwner(), generation = this.generation;
    const requests = await this.commits.list(); this.assertCurrent(owner, generation);
    const action = requests.find(request => request.id === id && request.owner === owner
      && request.atomic?.kind === ANALYSIS_RESHAPE && request.atomic.id === id);
    if (!action) throw Object.assign(new Error('Analysis action evidence changed'), { code: 'decision-changed' });
    const entries = [...this.editors.values()].filter(entry => !entry.closed && entry.controller
      && requests.some(request => action.atomic!.participants.includes(request.id)
        && sameResource(request.baseline.resource, entry.controller!.getState().checkpoint.confirmed.resource)));
    await Promise.all(entries.map(async entry => {
      await entry.controller!.settled();
      if (entry.controller!.needsPersistenceRetry()) await entry.controller!.retryPersistence();
    }));
    this.assertCurrent(owner, generation);
    await this.commits.cancelAction(action.atomic!.participants); this.assertCurrent(owner, generation);
    await Promise.all(entries.filter(entry => !entry.closed).map(entry => entry.controller!.settled()));
    this.assertCurrent(owner, generation);
    await this.commits.finishCancellation('', action.atomic!.participants); this.assertCurrent(owner, generation);
    await this.completeAcceptedProjections(owner, generation);
  }

  /** Discovery never takes ownership of, rewrites or removes a saved editor. */
  listRecoverable(resource?: ResourceRef): Promise<RecoveryCheckpoint[]> {
    return this.discoverRecoverable(resource);
  }

  async listUnreadableCheckpoints() {
    const owner = this.requireOwner(), generation = this.generation;
    const rows = await this.recoveryStore().listUnreadable?.(owner) ?? [];
    this.assertCurrent(owner, generation);
    return rows;
  }

  private async discoverRecoverable(resource: ResourceRef | undefined, forRecoveryChoices = false,
    matches?: (record: EditorRecord) => boolean): Promise<RecoveryCheckpoint[]> {
    const owner = this.requireOwner();
    if (resource) this.validateResource(resource, owner);
    const generation = this.generation;
    const repairing = this.localWriteback.retry(owner, address => address.kind === 'checkpoint' && (!resource || Boolean(address.resource && sameResource(address.resource, resource))));
    if (repairing) await repairing;
    this.assertCurrent(owner, generation);
    const stored = await this.recoveryStore().listRecoverable(owner, resource && copy(resource));
    this.assertCurrent(owner, generation);
    const records = stored.filter(({ record }) => !this.editors.has(record.editorId) && (!matches || matches(record)));
    if (!records.length) return [];
    const requests = await this.commits.list();
    this.assertCurrent(owner, generation);
    const fieldAnswers = singleFieldAnswerScopes(requests);
    const removingCreations = forRecoveryChoices ? creationsAwaitingRemoval(requests) : undefined;
    return records.filter(({ record }) => !this.editors.has(record.editorId)
      && (!removingCreations?.size || !isOnlyRemovedCreationCopy(record, removingCreations)))
      .map(({ id, record }) => {
        const reconciled = reconcileRecoveryRecord(record, requests);
        const pendingIds = Object.keys(reconciled.checkpoint.pending);
        const answer = Object.values(reconciled.checkpoint.pending).some(intent => intent.borrowedManualScope)
          ? null : savedDocumentAnswer(owner, reconciled.checkpoint.confirmed.resource, pendingIds, requests, this.pending);
        const actionResolutionRequired = requiresWholeActionResolution(owner, record.editorId, pendingIds, requests);
        const fieldAnswer = pendingIds.length ? fieldAnswers.find(candidate => pendingIds.every(id => candidate.requests.has(id))) : undefined;
        return { id, record: reconciled, ...(!record.recoveryVersion && !equalValues(record, reconciled) ? { discardRecord: copy(record) } : {}),
          ...(answer ? { answer } : {}), ...(actionResolutionRequired ? { actionResolutionRequired: true } : {}),
          ...(fieldAnswer?.kind === 'source-notes' && { sourceNoteChoiceEditorId: fieldAnswer.editorId }),
          ...(fieldAnswer?.kind === 'comment-place' && { commentPlaceChoiceEditorId: fieldAnswer.editorId }) };
      })
      .filter(({ record }) => isRecoverableCheckpoint(record) && !isPassiveManualContinuation(record));
  }

  /** Import only a closed writer's exact reserve. A live writer still owns its in-flight checkpoint. */
  private async importServiceOrderReserves(owner: string, generation: number, resource: ResourceRef, store: CheckpointRecoveryStore,
    starting = false): Promise<void> {
    const reserves = this.options.serviceOrderReserveStorage?.list(owner, resource.id);
    if (!reserves?.length) return;
    const known = await this.knownSnapshot(owner, generation, resource);
    for (const source of reserves) {
      const { editorId, token, payload } = source;
      if (starting && this.serviceOrderEditorsOpenedHere.has(editorId)) continue;
      const held = await this.recoveryPresence.held(owner, 'checkpoint', recoveryCheckpointId(owner, editorId));
      this.assertCurrent(owner, generation);
      if (held === true || this.editors.has(editorId)) continue;
      const original = await store.read(owner, editorId);
      this.assertCurrent(owner, generation);
      if (original && matchesServiceOrderReserve(original.checkpoint.confirmed, payload)) {
        const opening = original.checkpoint;
        const address = serviceOrderInputKey(payload.input);
        if (includesServiceOrderReserve(opening, payload) || (opening.editGeneration >= payload.editGeneration
          && opening.serviceOrderInputs?.[address])) {
          if (held === false) source.retire();
          continue;
        }
        if (held === false && store.replaceClosedServiceInput && opening.editGeneration < payload.editGeneration
          && !original.prepared && !original.unfinalized.length && !Object.keys(opening.pending).length) {
          const draft = projectServiceOrderInput(opening.draft, payload.input);
          if (draft) {
            const checkpoint = { ...opening, draft, dirty: true, editGeneration: payload.editGeneration,
              serviceOrderInputs: { ...opening.serviceOrderInputs, [address]: payload.input } };
            const replaced = await store.replaceClosedServiceInput(original, { ...original, checkpoint });
            this.assertCurrent(owner, generation);
            if (replaced) { source.retire(); continue; }
          }
        }
      }
      const confirmed = known ?? original?.checkpoint.confirmed;
      if (!confirmed || !snapshotBelongsToOwner(owner, confirmed) || (!confirmed.value && !confirmed.metadata?.deleted)) continue;
      const matches = matchesServiceOrderReserve(confirmed, payload);
      if (matches && payload.input.version && (payload.input.version.generation !== confirmed.metadata?.generation
        || payload.input.version.observedRevision > confirmed.metadata.revision)) continue;
      const draft = matches && !payload.input.retainedOnly ? projectServiceOrderInput(confirmed.value, payload.input) : null;
      const input = draft ? payload.input : { ...payload.input, retainedOnly: true as const };
      const backupEditorId = editorIdentity('service-order-reserve', resource, SERVICE_ORDER_INPUT_SLOT, token);
      const checkpoint: SessionCheckpoint = {
        ...new DataSession(confirmed).checkpoint(), draft: draft ?? confirmed.value, dirty: Boolean(draft), editGeneration: payload.editGeneration,
        serviceOrderInputs: { [serviceOrderInputKey(input)]: input },
      };
      try {
        await store.create({ owner, editorId: backupEditorId, checkpoint, autoSaveOnResume: false, prepared: null, unfinalized: [] });
      } catch (error) {
        this.assertCurrent(owner, generation);
        // Two openings may import the same immutable reserve. Neither can replace its durable copy.
        const winner = await store.read(owner, backupEditorId);
        if (!winner || !includesServiceOrderReserve(winner.checkpoint, payload)) throw error;
      }
      this.assertCurrent(owner, generation);
      if (held === false) source.retire();
    }
  }

  /** Keep a route to drafts even if the service itself vanished from the library. */
  async listServiceOrderDraftLinks(): Promise<{ id: string; title?: string }[]> {
    const owner = this.requireOwner(), generation = this.generation;
    const documents = new Map<string, { id: string; title?: string }>();
    for (const source of this.options.serviceOrderReserveStorage?.listServices(owner) ?? []) documents.set(source.id, source);
    const records = await this.discoverRecoverable(undefined, true, record =>
      record.checkpoint.confirmed.resource.collection === 'serviceOrders' && Object.keys(record.checkpoint.serviceOrderInputs ?? {}).length > 0);
    this.assertCurrent(owner, generation);
    for (const { record } of records) {
      const { confirmed, draft } = record.checkpoint;
      const { id } = confirmed.resource;
      const title = draft?.title ?? confirmed.value?.title;
      if (!documents.has(id) || typeof title === 'string') documents.set(id, { id, title: typeof title === 'string' ? title : undefined });
    }
    return [...documents.values()];
  }

  /** Choice-list boundary; unresolved-decision consumers retain listRecoverable. */
  async listRecoveryChoices(resource?: ResourceRef, manualChoicesOnly = false): Promise<RecoveryCheckpoint[]> {
    const owner = this.requireOwner(), generation = this.generation;
    if (resource) this.validateResource(resource, owner);
    const store = this.recoveryStore();
    if (!manualChoicesOnly && resource?.collection === 'serviceOrders') await this.importServiceOrderReserves(owner, generation, resource, store);
    const records = manualChoicesOnly && store.listManualChoiceCopies
      ? await store.listManualChoiceCopies(owner, resource) : await this.discoverRecoverable(resource, true);
    const choices = manualChoicesOnly ? records.filter(({ record }) => isManualChoiceRecoveryIdentity(record.editorId)) : records;
    // A durable descendant owns its exact recovery origin. A source with a renewed version stays available.
    const key = (id: string, version?: string) => JSON.stringify([id, version]);
    const outlineOrigins = new Set(choices.filter(({ record }) => hasSermonOutlineReview(record.checkpoint))
      .map(({ id, record }) => key(id, record.recoveryVersion)));
    const claimed = new Set(choices.flatMap(({ record }) => (record.recoveryOrigins ?? []).map(({ id, version }) => key(id, version))
      .filter(origin => resource?.collection === 'serviceOrders' || outlineOrigins.has(origin))));
    return this.recoveryChoices(owner, generation, 'checkpoint', choices.filter(({ id, record }) =>
      !claimed.has(key(id, record.recoveryVersion))), record => record.id);
  }

  /** Restore only new comments left at this passage or in the Studies place picker. */
  async listNewCommentCopies(slot: string): Promise<RecoveryCheckpoint[]> {
    const owner = this.requireOwner(), generation = this.generation;
    const matches = (record: EditorRecord) => isCommentCreationCopy(record, slot);
    const records = (await this.discoverRecoverable(undefined, true, matches)).filter(({ record }) => matches(record));
    const submittedOrigins = new Set(records.flatMap(({ record }) => {
      const queued = Object.keys(record.checkpoint.pending).some(id => {
        const request = this.commitRecords.get(id);
        return request?.state === 'queued' || request?.state === 'prepared';
      });
      return queued ? (record.recoverySources ?? []).map(source => source.id) : [];
    }));
    // A closed editor's queued creation owns the exact source that it recovered.
    // The original stays on disk until delivery, but cannot be offered as another new comment.
    const choices = records.filter(source => !submittedOrigins.has(source.id));
    return this.recoveryChoices(owner, generation, 'checkpoint', choices, source => source.id);
  }

  /** Atomically reserve the destination of an exact legacy creation on this device. */
  async parkLegacyCommentCreation(resource: ResourceRef, slot: string, value: DocumentData): Promise<RecoveryCheckpoint | null> {
    const owner = this.requireOwner(), generation = this.generation;
    this.validateResource(resource, owner);
    const editorId = editorIdentity('legacy-comment-creation', resource, slot, 'source');
    if (resource.collection !== 'studyNotes' || value.userId !== owner || value.type !== 'comment' || !isNewCommentEditor(editorId)) {
      throw new Error('Invalid legacy comment creation');
    }
    // A matching old copy can survive a crash just after the new comment was accepted.
    const saved = await this.knownSnapshot(owner, generation, resource);
    this.assertCurrent(owner, generation);
    if (saved?.metadata || [...this.commitRecords.values()].some(request => request.owner === owner
      && sameResource(request.baseline.resource, resource) && request.baseline.value === null
      && request.baseline.metadata === null && request.intended !== null
      && (request.state === 'queued' || request.state === 'prepared'))) return null;
    const store = this.recoveryStore();
    let record = await store.read(owner, editorId);
    this.assertCurrent(owner, generation);
    if (!record) {
      const session = new DataSession({ resource, value: null, metadata: null });
      session.edit(value);
      const draft: EditorRecord = { owner, editorId, checkpoint: session.checkpoint(), autoSaveOnResume: false, prepared: null, unfinalized: [] };
      try { await store.create(draft); }
      catch (failure) {
        this.assertCurrent(owner, generation);
        // Another tab may have parked the same exact source while this one read it.
        record = await store.read(owner, editorId);
        if (!record) throw failure;
      }
      record ??= draft;
    }
    this.assertCurrent(owner, generation);
    if (!isCommentCreationCopy(record, slot)) throw new Error('The parked comment creation changed');
    return { id: recoveryCheckpointId(owner, editorId), record };
  }

  /** Explicit removal owns only the shown persisted version, with no queue cancellation. */
  async discardRecovery(source: RecoveryCheckpoint): Promise<void> {
    const owner = this.requireOwner(), generation = this.generation;
    await this.discardRecoveryForOwner(source, owner, () => this.current(owner, generation));
    this.assertCurrent(owner, generation);
  }

  private async discardRecoveryForOwner(source: RecoveryCheckpoint, owner: string, isCurrent: () => boolean): Promise<void> {
    const record = validateRecoveryRecord(source.discardRecord ?? source.record, owner, source.record.editorId, source.record.checkpoint.confirmed.resource);
    if (source.id !== recoveryCheckpointId(owner, record.editorId)) throw new Error('Recovery removal identity mismatch');
    this.validateResource(record.checkpoint.confirmed.resource, owner);
    const held = await this.recoveryPresence.held(owner, 'checkpoint', source.id);
    if (!isCurrent()) throw new Error('Account changed');
    this.assertRecoveryClosed(held);
    const store = this.recoveryStore();
    if (!store.discardRecovery) throw new Error(RECOVERY_REMOVAL_UNAVAILABLE);
    await store.discardRecovery(record, isCurrent);
  }

  private async discardSupersededPlanCell(source: RecoveryCheckpoint, owner: string, generation: number): Promise<void> {
    const current = () => this.current(owner, generation);
    const held = await this.recoveryPresence.held(owner, 'checkpoint', source.id);
    // This receipt is for our own interim write. The checkpoint store still checks
    // its exact version and any captured request even without a presence adapter.
    if (held !== true && current()) await this.recoveryStore().discardRecovery?.(source.record, current);
  }

  private async requireClosedRecovery(owner: string, generation: number,
    kind: RecoveryPresenceKind, id: string): Promise<void> {
    const held = await this.recoveryPresence.held(owner, kind, id);
    this.assertCurrent(owner, generation);
    this.assertRecoveryClosed(held);
  }

  private assertRecoveryClosed(held: boolean | null): void {
    if (held !== false) throw Object.assign(new Error(held ? 'This draft is still open' : 'Could not verify that this draft is closed'),
      { code: held ? DRAFT_OPEN : 'draft-presence-unknown' });
  }

  /** No browser adapter preserves the original admission path, including synchronous cancellation. */
  private recoveryAvailability(owner: string, kind: RecoveryPresenceKind, id: string, cancelled?: Promise<never> | null): Promise<void> | undefined {
    if (!this.options.recoveryPresence) return;
    const checking = this.recoveryPresence.held(owner, kind, id);
    return (cancelled ? Promise.race([checking, cancelled]) : checking).then(held => {
      if (held === true) throw Object.assign(new Error('This draft is still open in another tab'), { code: DRAFT_OPEN });
    });
  }

  private async recoveryChoices<T>(owner: string, generation: number, kind: RecoveryPresenceKind, records: T[], identity: (record: T) => string): Promise<T[]> {
    this.assertCurrent(owner, generation);
    const held = await Promise.all(records.map(record => this.recoveryPresence.held(owner, kind, identity(record))));
    this.assertCurrent(owner, generation);
    return records.filter((_record, index) => held[index] !== true);
  }

  /**
   * Whether a screen opened on this document now would take over its queued work: exactly one chain
   * of unfinished requests, or one proved answer shared by all ordinary branches. The screen
   * does not pick a later branch. Several independent answers still need separate recovery.
   */
  async screenDecides(resource: ResourceRef): Promise<boolean> {
    const owner = this.requireOwner();
    this.validateResource(resource, owner);
    const generation = this.generation;
    const requests = await this.commits.list();
    this.assertCurrent(owner, generation);
    if (submittedEditorCheckpoint(owner, resource, requests)) return true;
    const sources = await this.manualChoices(owner, resource, requests);
    this.assertCurrent(owner, generation);
    return submittedEditorCheckpoint(owner, resource, requests, sources) !== null;
  }

  /**
   * Whether an editor open in this tab holds an answered saved request of this document — its screen then says the answer itself. A screen opened before the request existed
   * holds nothing, and the answer must be said elsewhere.
   */
  async answerHeldOpen(resource: ResourceRef): Promise<boolean> {
    return this.answeredEditorResources(await this.listPending()).some(candidate => sameResource(candidate, resource));
  }

  /** Stable local snapshot: exactly the open editors whose screen already holds an answered request. */
  getOpenAnswers(): readonly ResourceRef[] { return this.openAnswers; }

  subscribeOpenAnswers(listener: () => void): () => void {
    if (this.disposed) throw new Error(ENGINE_DISPOSED);
    this.openAnswerListeners.add(listener);
    return () => { this.openAnswerListeners.delete(listener); };
  }

  /** Stable exact-work view; ordinary resource subscribers retain their previous notification boundary. */
  getOpenAnswerScopes(): readonly OpenDocumentAnswer[] { return this.openAnswerScopes; }

  subscribeOpenAnswerScopes(listener: () => void): () => void {
    if (this.disposed) throw new Error(ENGINE_DISPOSED);
    this.openAnswerScopeListeners.add(listener);
    return () => { this.openAnswerScopeListeners.delete(listener); };
  }

  private answeredEditorWork(journal: OpenEditorJournal): OpenDocumentAnswer[] {
    const owner = this.owner ?? '';
    const scopes: OpenDocumentAnswer[] = [];
    for (const [editorId, entry] of [...this.editors.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      // A transient action has no answering screen; opening it cannot hide the global question.
      if (editorSlot(editorId) === ACTION_SLOT) continue;
      const checkpoint = !entry.closed ? entry.controller?.getState().checkpoint : null;
      if (!checkpoint || !entry.controller!.hasChoiceAuthority(checkpoint)) continue;
      const operationIds = Object.keys(checkpoint.pending);
      if (!this.answerForOpenIntent(owner, checkpoint.confirmed.resource, operationIds, journal)) continue;
      const scope = { owner, resource: checkpoint.confirmed.resource,
        operationIds: operationIds.sort(), draft: checkpoint.draft,
        ...ordinaryAnswerCoverage(checkpoint, this.requestsForChoice(owner, operationIds), entry.manualChoices) };
      if (!scopes.some(previous => equalValues(previous, scope))) scopes.push(scope);
    }
    return scopes;
  }

  private resourcesForAnswers(scopes: readonly OpenDocumentAnswer[]): ResourceRef[] {
    const resources = new Map(scopes.map(scope => [cacheKey(scope.owner, scope.resource), scope.resource]));
    return [...resources.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, resource]) => resource);
  }

  private answeredEditorResources(journal: readonly JournalEntry[]): ResourceRef[] {
    return this.resourcesForAnswers(this.answeredEditorWork(new OpenEditorJournal(journal)));
  }

  private publishOpenAnswers(): void {
    const work = this.answeredEditorWork(this.pendingByOperation);
    if (!equalValues(work, this.openAnswerScopes)) {
      this.openAnswerScopes = Object.freeze(work.map(scope => Object.freeze({ ...copy(scope),
        resource: Object.freeze(copy(scope.resource)), operationIds: Object.freeze([...scope.operationIds]),
        draft: scope.draft === null ? null : Object.freeze(copy(scope.draft)),
        ...(scope.laterSaves ? { laterSaves: Object.freeze(scope.laterSaves.map(save => Object.freeze({
          ...save, operationIds: Object.freeze([...save.operationIds]), draft: save.draft === null ? null : Object.freeze(copy(save.draft)),
        }))) } : {}),
        ...(scope.councilRefusal ? { councilRefusal: Object.freeze(copy(scope.councilRefusal)) } : {}),
      })));
      for (const listener of this.openAnswerScopeListeners) {
        try { listener(); } catch { /* Rendering never changes editor ownership. */ }
      }
    }
    const next = this.resourcesForAnswers(work);
    if (equalValues(next, this.openAnswers)) return;
    this.openAnswers = Object.freeze(next.map(resource => Object.freeze(copy(resource))));
    for (const listener of this.openAnswerListeners) {
      try { listener(); } catch { /* Rendering never changes editor ownership. */ }
    }
  }

  async continueRefusedNote(resource: ResourceRef, editorId: string, captureScope: string,
    waiting: readonly EditorRecord[], attempt: NoteBodyContinuation): Promise<DocumentWriteReceipt | null> {
    const owner = this.requireOwner(), generation = this.generation;
    this.validateResource(resource, owner);
    const writer = noteCaptureWriter(captureScope, owner, resource);
    const [record] = waiting;
    if (!writer || !isResourceActionEditor(editorId, resource) || waiting.length !== 1
      || record.owner !== owner || !sameResource(record.checkpoint.confirmed.resource, resource) || !isResourceActionEditor(record.editorId, resource)) return null;
    const requests = await this.commits.list();
    this.assertCurrent(owner, generation);
    const unsettled = requests.filter(request => request.owner === owner && sameResource(request.baseline.resource, resource)
      && request.state !== 'cancelled' && request.state !== 'acknowledged');
    const [source] = unsettled;
    if (unsettled.length !== 1 || source.editorId !== record.editorId
      || noteCaptureWriter(source.retentionScope, owner, resource) !== writer) return null;
    const held = record.checkpoint.pending[source.id];
    if (Object.keys(record.checkpoint.pending).length !== 1 || !held || held.generation !== source.editGeneration
      || !equalValues(held.value, source.value)) return null;
    const automatic = continueRefusedNote(source, attempt);
    const known = await this.knownSnapshot(owner, generation, resource);
    this.assertCurrent(owner, generation);
    if (known && (!known.value || known.metadata?.generation !== source.working.metadata?.generation)) return null;
    const currentOpening = automatic && (!known || (known.metadata?.revision ?? 0) < automatic.content.observedRevision
      || (known.metadata?.revision === automatic.content.observedRevision && known.value?.content === automatic.content.opening));
    const replacement = currentOpening ? automatic : reviewRefusedNote(source, attempt);
    if (!replacement) return null;

    const session = new DataSession(replacement.confirmed);
    session.edit(replacement.value);
    const receipt = await this.commits.replaceNoteRequest(source, editorId, captureScope, session.checkpoint(), request => {
      session.applyCommit(request);
      return { owner, editorId, checkpoint: session.checkpoint(), prepared: null, unfinalized: [] };
    }, replacement.content);
    this.assertCurrent(owner, generation);
    if (receipt) { this.prepareCommitsInBackground(); this.backgroundDrain(); }
    return receipt;
  }

  /** The same note draft may correct its sole definitive body-size refusal. */
  async shortenRefusedNote(resource: ResourceRef, editorId: string, captureScope: string,
    waiting: readonly EditorRecord[], update: (opening: DocumentData | null, confirmed: ResourceSnapshot, sizeRefusedDraft: DocumentData) => DocumentData | null,
    content?: StudyNoteContentCapture | null): Promise<DocumentWriteReceipt | null> {
    const owner = this.requireOwner(), generation = this.generation;
    this.validateResource(resource, owner);
    const writer = noteCaptureWriter(captureScope, owner, resource);
    const [record] = waiting;
    if (!writer || !isResourceActionEditor(editorId, resource) || waiting.length !== 1
      || record.owner !== owner || !sameResource(record.checkpoint.confirmed.resource, resource) || !isResourceActionEditor(record.editorId, resource)
      || record.checkpoint.conflicts.length || record.checkpoint.remoteCandidate) return null;
    const requests = await this.commits.list();
    this.assertCurrent(owner, generation);
    const unsettled = requests.filter(request => request.owner === owner && sameResource(request.baseline.resource, resource)
      && request.state !== 'cancelled' && request.state !== 'acknowledged');
    const [source] = unsettled;
    if (unsettled.length !== 1 || !oversizedNoteOpening(source) || source.editorId !== record.editorId
      || noteCaptureWriter(source.retentionScope, owner, resource) !== writer) return null;
    const held = record.checkpoint.pending[source.id];
    if (Object.keys(record.checkpoint.pending).length !== 1 || !held || held.generation !== source.editGeneration
      || !equalValues(held.value, source.value) || !equalValues(record.checkpoint.draft, source.value)) return null;
    const known = await this.knownSnapshot(owner, generation, resource);
    if (known && (!known.value || known.metadata?.generation !== source.working.metadata?.generation)) return null;

    const corrected = update(source.working.value, source.working, source.value);
    if (!corrected) return null;
    const session = new DataSession(source.working);
    session.edit(corrected);
    const receipt = await this.commits.replaceOversizedNote(source, editorId, captureScope, session.checkpoint(), request => {
      session.applyCommit(request);
      return { owner, editorId, checkpoint: session.checkpoint(), prepared: null, unfinalized: [] };
    }, content);
    this.assertCurrent(owner, generation);
    if (receipt) { this.prepareCommitsInBackground(); this.backgroundDrain(); }
    return receipt;
  }

  /**
   * "Use the server's version" for every request of a document the server refused or conflicted on,
   * for a document no screen can decide (`screenDecides`). Each is cancelled as the person's choice, so
   * the checkpoints holding it settle (`DataSession.applyCommit`) without opening any editor — one of
   * them may still be open in another tab. Optional IDs pin the reviewed roots; an empty selection
   * cancels nothing. Omitted IDs retain the resource-wide API. Resolves to the requests taken back.
   */
  async takeStoredVersion(resource: ResourceRef, operationIds?: readonly string[],
    onStored?: (snapshot: ResourceSnapshot) => void): Promise<number> {
    const owner = this.requireOwner();
    this.validateResource(resource, owner);
    const generation = this.generation;
    const selected = operationIds && new Set(operationIds);
    const requests = await this.commits.list();
    this.assertCurrent(owner, generation);
    const answered = requests.filter(request => request.owner === owner
      && sameResource(request.baseline.resource, resource) && (!selected || selected.has(request.id))
      && (request.state === 'refused' || request.state === 'conflict'));
    if (answered.some(request => request.result?.kind === 'conflict' && hasStudyNoteReferenceReview(request.result.conflicts))) {
      throw Object.assign(new Error('Review the note references before deciding'), { code: 'decision-changed' });
    }
    if (answered.some(request => request.result?.kind === 'conflict' && hasOutlineParentChoice(resource.collection, request.result.conflicts))) {
      throw Object.assign(new Error('Review the subpoint placement in its editor before deciding'), { code: 'decision-changed' });
    }
    if (answered.length) {
      const sources = await this.manualChoices(owner, resource, requests);
      this.assertCurrent(owner, generation);
      // The notice never decides a form's own answer or an unrelated form Save.
      if (hasFormWork(owner, resource, requests, reviewedFormSaves(answered, requests, sources))) return 0;
      const reviewed = answered.flatMap(request => reviewOrdinaryAnswerChoice(request, requests, sources) ?? []);
      let chosen: ResourceSnapshot | undefined;
      for (const request of answered) {
        const result = request.result;
        if (result && (result.kind === 'conflict' || result.kind === 'deleted')
          && sameResource(result.snapshot.resource, resource) && canReplaceSnapshot(chosen, result.snapshot)) chosen = result.snapshot;
      }
      const placementRefusals = reviewed.filter(choice => isAnchoredPlacementRefusal(choice.first));
      if (placementRefusals.length) {
        const target = await this.readWriteTarget(resource);
        this.assertCurrent(owner, generation);
        if (!target) throw Object.assign(new Error('Read the saved order before choosing'), { code: 'fresh-read-required' });
        if (canReplaceSnapshot(chosen, target)) chosen = target;
      }
      if (chosen) await this.publishStoredChoice(owner, generation, chosen);
      const ids = answered.map(request => request.id);
      if (reviewed.length) {
        const retained = new Set(reviewed.flatMap(choice => choice.scope.slice(1).map(request => request.id)));
        const known = placementRefusals.length ? chosen : reviewed.some(choice => choice.scope.length > 1)
          ? await this.knownSnapshot(owner, generation, resource) : undefined;
        const placementChoice = chosen && new Map(placementRefusals.map(({ first }) => [first.id, chosen!]));
        await this.commits.cancelWithCheckpoint('', ids, retired => ordinaryStoredChoice(owner, reviewed, retired, known),
          { roots: answered, retained, placementChoice });
      } else await this.commits.cancel('', ids);
      this.assertCurrent(owner, generation);
      await Promise.all([...this.editors.values()].filter(entry => entry.controller
        && sameResource(entry.controller.getState().checkpoint.confirmed.resource, resource)).map(entry => entry.controller!.settled()));
      this.assertCurrent(owner, generation);
      await this.commits.finishCancellation('', ids); this.assertCurrent(owner, generation);
      if (onStored && chosen) {
        const stored = await this.knownSnapshot(owner, generation, resource);
        if (!stored || stored.metadata?.generation === chosen.metadata?.generation) {
          onStored(stored && canReplaceSnapshot(chosen, stored) ? stored : chosen);
        }
      }
    }
    return answered.length;
  }

  /** Keep the chosen confirmed row visible when cancellation removes the list's draft overlay. */
  private async publishStoredChoice(owner: string, generation: number, snapshot: ResourceSnapshot): Promise<void> {
    const collections = this.options.collections;
    if (!collections) return;
    this.assertCurrent(owner, generation);
    if (!snapshotBelongsToOwner(owner, snapshot)) throw new Error(SERVER_SNAPSHOT_IDENTITY_MISMATCH);
    await this.persistSnapshot(owner, generation, snapshot);
    this.assertCurrent(owner, generation);
    await collections.reloadCached(snapshot.resource.collection);
    this.assertCurrent(owner, generation);
  }

  /**
   * Whether unfinished work of this document belongs to a form (a request whose owner is no editor
   * identity). Such work is resolved by the form, as it always was; the app-wide notice and its
   * choices stay out of it (BUG-20260813-late-refusal-silent-after-navigation).
   */
  async formWorkPending(resource: ResourceRef): Promise<boolean> {
    const owner = this.requireOwner();
    this.validateResource(resource, owner);
    const generation = this.generation;
    const requests = await this.commits.list();
    this.assertCurrent(owner, generation);
    if (!hasFormWork(owner, resource, requests)) return false;
    const sources = await this.manualChoices(owner, resource, requests);
    this.assertCurrent(owner, generation);
    const roots = requests.filter(request => request.owner === owner && sameResource(request.baseline.resource, resource)
      && (request.state === 'conflict' || request.state === 'refused'));
    return hasFormWork(owner, resource, requests, reviewedFormSaves(roots, requests, sources));
  }

  private manualChoices(owner: string, resource: ResourceRef, requests: readonly CommitRequest[]) {
    const store = this.options.manualScopes;
    return store && manualOrdinaryChoiceSources(store, owner, resource, requests);
  }

  /** Explicitly fork a checkpoint to a fresh editor identity, preserving pending operation IDs. */
  async recoverEditor(resource: ResourceRef, editorId: string, sourceId: string, options?: EditorOpenOptions): Promise<ManagedEditor> {
    const owner = this.requireOwner();
    const generation = this.generation;
    const frozen = copy(resource);
    this.validateResource(frozen, owner);
    const store = this.recoveryStore();
    const active = () => {
      this.assertCurrent(owner, generation);
      if (options?.signal?.aborted) throw this.abortError();
    };
    active();
    if (!editorId) throw new Error('An editor identity is required');
    if (this.editors.has(editorId) || this.recovering.has(editorId)) throw new Error('This editor identity is already open');
    const reservation = {};
    this.recovering.set(editorId, reservation);
    let presence: RecoveryPresenceLease | undefined;
    let forking: Promise<EditorRecord> | undefined;
    let onAbort: (() => void) | undefined;
    const cancelled = options?.signal && new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(this.abortError());
      options.signal!.addEventListener('abort', onAbort, { once: true });
    });
    try {
      const checking = this.recoveryAvailability(owner, 'checkpoint', sourceId, cancelled);
      if (checking) await checking;
      active();
      presence = this.recoveryPresence.hold(owner, 'checkpoint', [sourceId]);
      let storedSource: EditorRecord | undefined;
      forking = forkCheckpoint({
        ...(store.pinRecovery ? { pinRecovery: async () => {
          active();
          const version = storedSource ? await store.pinRecovery!(storedSource) : null; active();
          return version;
        } } : {}),
        read: async (uid, id) => {
          const record = await store.read(uid, id); active();
          const shown = options?.shownRecovery;
          if (shown && !(shown.recoveryVersion ? record?.recoveryVersion === shown.recoveryVersion : equalValues(record, shown))) {
            throw Object.assign(new Error('The displayed draft changed'), { code: 'decision-changed' });
          }
          storedSource = record;
          const requests = await this.commits.list(); active();
          const retained = record?.retainedManualChoice;
          if (!retained) {
            const reconciled = record && reconcileRecoveryRecord(record, requests);
            const checkpoint = reconciled?.checkpoint;
            if (!checkpoint || Object.keys(checkpoint.pending).length) return reconciled;
            const review = ['groups', 'councils', 'users'].includes(frozen.collection)
              ? checkpoint.unreadableRowProofs?.length || checkpoint.unreadableScalarProof?.length
              : frozen.collection === 'sermons' ? checkpoint.unreadableExegeticalProofs?.length
                : frozen.collection === 'serviceOrders' && (checkpoint.unreadableScalarProof?.length || checkpoint.unreadableServiceOrderStepPlacement
                  || Object.keys(checkpoint.serviceOrderInputs ?? {}).length);
            if (!review) return reconciled;
            // The observer may still be showing a cached opening when the recovery controls become clickable.
            const fresh = await this.readWriteTarget(frozen).catch(() => null);
            active();
            if (!fresh || !storesNewCopy(checkpoint.remoteCandidate ?? checkpoint.confirmed, fresh)) return reconciled;
            const session = DataSession.restore(checkpoint);
            session.observe(fresh, { source: 'server' });
            return { ...reconciled!, checkpoint: session.checkpoint() };
          }
          if (retained.decidingEditorId) {
            const deciding = await store.read(uid, retained.decidingEditorId); active();
            if ((deciding?.checkpoint.dirty && equalValues(deciding.checkpoint.draft, retained.base))
              || requests.some(request => sameResource(request.baseline.resource, frozen) && !['acknowledged', 'cancelled'].includes(request.state))) {
              throw Object.assign(new Error('Finish the earlier choice before recovering this draft'), { code: 'pending-delivery-first' });
            }
          }
          const known = await this.knownSnapshot(owner, generation, frozen); active();
          return recoverManualChoiceCopy(record!, known);
        },
        create: async (record, origin) => {
          active(); presence?.add((record.recoverySources ?? []).map(source => source.id));
          await store.create(record, ...(origin ? [origin] : [])); active();
        },
      }, owner, sourceId, editorId, frozen);
      const forked = await (cancelled ? Promise.race([forking, cancelled]) : forking);
      active();
      this.recovering.delete(editorId);
      const creating = forked.checkpoint.confirmed.value === null && forked.checkpoint.confirmed.metadata === null;
      presence.add((forked.recoverySources ?? []).map(source => source.id));
      return await this.open(frozen, editorId, creating, options, 0, (forked.recoverySources ?? []).map(source => source.id));
    } finally {
      presence?.releaseAfter(forking ?? Promise.resolve());
      if (onAbort) options?.signal?.removeEventListener('abort', onAbort);
      if (this.recovering.get(editorId) === reservation) this.recovering.delete(editorId);
    }
  }

  /**
   * An editor closed while its Save was on the way leaves its copy behind, and nothing settles that copy when the answer
   * arrives: it keeps its answered rows forever, and every later storage pass reads all of them in full — on a device with
   * a long history the engine's store stopped answering for minutes (BUG-20261107-engine-state-held-by-old-local-backlog).
   * Once no tab holds the editor, finish what it would have done on those answers while open — the same reconciliation,
   * written by the rule `closedCopySettlement` names. A copy open in some tab — its editor, or a recovery taking it over —
   * or of unknown presence stays. Runs beside delivery and again at the end of the pass; a failure is said and never
   * stops the person's own work.
   */
  private settleClosedEditors(owner: string, generation: number): Promise<void> {
    if (this.settling?.owner === owner && this.settling.generation === generation) return this.settling.operation;
    const store = this.options.checkpoints as Partial<CheckpointRecoveryStore>;
    if (typeof store.settleClosed !== 'function' || typeof store.listRecoverable !== 'function') return Promise.resolve();
    const operation: Promise<void> = (async () => {
      const stored = (await store.listRecoverable!(owner)).filter(({ record }) => !this.editors.has(record.editorId));
      this.assertCurrent(owner, generation);
      if (!stored.length) return;
      const requests = await this.commits.list(); this.assertCurrent(owner, generation);
      const answered = stored.map(({ id, record }) => ({ id, stored: record, settled: reconcileRecoveryRecord(record, requests) }))
        .filter(entry => closedCopySettlement(entry.stored, entry.settled) !== null);
      if (!answered.length) return;
      const held = await Promise.all(answered.map(entry => this.recoveryPresence.held(owner, 'checkpoint', entry.id)));
      this.assertCurrent(owner, generation);
      const closed = answered.filter((_entry, index) => held[index] === false);
      if (closed.length) await store.settleClosed!(owner, closed.map(({ stored: record, settled }) => ({ stored: record, settled })));
    })().catch(error => { if (this.current(owner, generation)) this.reportFailure(error); })
      .finally(() => { if (this.settling?.operation === operation) this.settling = null; });
    this.settling = { owner, generation, operation };
    return operation;
  }

  private answeredDraftReceipts(state: StartupDraftRecovery): string[] {
    return [...state.waiting].filter(id => {
      const result = this.commitRecords.get(id)?.state;
      return result === 'acknowledged' || result === 'cancelled';
    });
  }

  private needsAutosaveRecovery(generation: number): boolean {
    const state = this.resumingAutosaves;
    return !state || state.generation !== generation || state.retryRead || this.answeredDraftReceipts(state).length > 0;
  }

  /** Inspect closed autosaves on startup and when an earlier captured Save actually settles. */
  private resumeAutosaves(owner: string, generation: number): Promise<void> | undefined {
    const previous = this.resumingAutosaves?.generation === generation ? this.resumingAutosaves : null;
    if (previous?.operation) return previous.operation;
    const store = this.options.checkpoints as Partial<CheckpointRecoveryStore>;
    if (!this.canSend() || !this.needsAutosaveRecovery(generation) || !store.listRecoverable || !store.pinRecovery
      || !this.options.commits.createWithCheckpoint) return;
    const active = () => this.assertCurrent(owner, generation);
    const state: StartupDraftRecovery = previous ?? { generation, operation: null, attempts: new Map(), retryRead: false,
      waiting: new Set(), recheckedReceipts: new Set() };
    for (const id of this.answeredDraftReceipts(state)) state.recheckedReceipts.add(id);
    state.retryRead = false;
    const operation = (async () => {
      const copies = await store.listRecoverable!(owner);
      active();
      const manualStore = this.options.manualScopes;
      const meetingDrafts = manualStore?.pinRecovery && this.options.commits.createWithMeetingResume
        ? await manualStore.listMeetingDrafts?.(owner).catch(error => {
          active(); this.reportFailure(error); return [];
        }) ?? [] : [];
      active();
      const reserveIds = new Set(this.options.serviceOrderReserveStorage?.listServices(owner).map(source => source.id));
      if (!copies.length && !meetingDrafts.length && !reserveIds.size) { state.waiting.clear(); return; }
      const requests = await this.commits.list();
      active();
      requests.forEach(request => this.rememberCommit(request));
      state.waiting.clear();
      for (const { source, receipts } of pendingAutosaveReceipts(copies, requests)) {
        if (this.editors.has(source.record.editorId) || await this.recoveryPresence.held(owner, 'checkpoint', source.id) !== false) continue;
        active();
        for (const id of receipts) if (!state.recheckedReceipts.has(id)) state.waiting.add(id);
      }
      for (const { id, record } of recoverableAutosaves(copies, requests)) {
        const attempts = state.attempts.get(id) ?? 0;
        if (attempts >= 2) continue;
        if (!this.canSend()) { state.retryRead = true; return; }
        const { resource } = record.checkpoint.confirmed;
        if (this.editors.has(record.editorId) || await this.recoveryPresence.held(owner, 'checkpoint', id) !== false) continue;
        active();
        let fresh: ResourceSnapshot | null;
        try { fresh = await this.readWriteTarget(resource); }
        catch (error) {
          active();
          if ((error as { code?: unknown } | null)?.code === 'resource-exhausted') { state.retryRead = false; return; }
          state.attempts.set(id, attempts + 1);
          state.retryRead ||= attempts === 0;
          continue;
        }
        active();
        if (!fresh) { state.retryRead = true; continue; }
        state.attempts.set(id, 2);
        if (originalAutosaveStillApplies(record, fresh)) await this.captureResumedAutosave(owner, generation, id, record, store.pinRecovery!);
      }
      await this.resumeServiceOrderAutosaves(owner, generation, state, copies, requests, reserveIds, store.pinRecovery!);
      if (meetingDrafts.length && manualStore?.pinRecovery) {
        await this.resumeGroupMeetingAutosaves(owner, generation, state, meetingDrafts, requests, manualStore);
      }
    })().catch(error => { if (this.current(owner, generation)) this.reportFailure(error); })
      .finally(() => { state.operation = null; });
    state.operation = operation;
    this.resumingAutosaves = state;
    return operation;
  }

  private async resumeServiceOrderAutosaves(owner: string, generation: number, scan: StartupDraftRecovery,
    copies: readonly RecoveryCheckpoint[], requests: readonly CommitRequest[], reserveIds: ReadonlySet<string>,
    pin: NonNullable<CheckpointRecoveryStore['pinRecovery']>): Promise<void> {
    const active = () => this.assertCurrent(owner, generation);
    if (reserveIds.size) {
      const store = this.recoveryStore();
      for (const id of reserveIds) {
        const resource = { collection: 'serviceOrders', id };
        await this.importServiceOrderReserves(owner, generation, resource, store, true).catch(error => {
          active(); this.reportFailure(error, resource);
        });
      }
      copies = await store.listRecoverable(owner);
      active();
    }

    // Startup only adopts work left by a preceding app run. A writer opened by this
    // run already has its own autosave and leaving rules, even if it just closed.
    const previousWriter = (record: EditorRecord) => !this.serviceOrderEditorsOpenedHere.has(record.editorId) && serviceOrderAutosaveSource(record);
    const serviceCopies = copies.filter(({ record }) => previousWriter(record));
    for (const request of requests) {
      if ((request.state === 'queued' || request.state === 'prepared') && !scan.recheckedReceipts.has(request.id)
        && serviceCopies.some(({ record }) => sameResource(record.checkpoint.confirmed.resource, request.baseline.resource))) {
        scan.waiting.add(request.id);
      }
    }
    for (const { id, record } of recoverableAutosaves(copies, requests, previousWriter)) {
      const stamp = JSON.stringify([id, record.checkpoint.editGeneration]);
      const attempts = scan.attempts.get(stamp) ?? 0;
      if (attempts >= 2 || this.editors.has(record.editorId) || await this.recoveryPresence.held(owner, 'checkpoint', id) !== false) continue;
      active();
      if (!this.canSend()) { scan.retryRead = true; return; }
      const { resource } = record.checkpoint.confirmed;
      let fresh: ResourceSnapshot | null;
      try { fresh = await this.readWriteTarget(resource); }
      catch (error) {
        active();
        if ((error as { code?: unknown } | null)?.code === 'resource-exhausted') { scan.retryRead = false; return; }
        scan.attempts.set(stamp, attempts + 1);
        scan.retryRead ||= attempts === 0;
        continue;
      }
      active();
      if (!fresh) { scan.retryRead = true; continue; }
      scan.attempts.set(stamp, 2);
      const input = serviceInputWithUnchangedOpening(record, fresh);
      if (!input) continue;
      try {
        const request = await this.captureResumedAutosave(owner, generation, id, record, pin, input);
        if (request) scan.waiting.add(request.id);
      } catch (error) {
        active();
        if (!(error instanceof PendingStartupAutosave)) throw error;
        await this.waitForStartupAutosaveReceipts(owner, generation, scan, stamp, error);
      }
    }
  }

  private async resumeGroupMeetingAutosaves(owner: string, generation: number, scan: StartupDraftRecovery,
    drafts: readonly StoredManualScope[], requests: readonly CommitRequest[], store: ManualScopeStore): Promise<void> {
    const active = () => this.assertCurrent(owner, generation);
    const byId = new Map(requests.map(request => [request.id, request]));
    const intents = requests.flatMap(request => request.value ? [{
      id: request.id, owner: request.owner, resource: request.baseline.resource,
      value: request.value, predecessorId: request.predecessor,
    }] : []);
    const counts = new Map<string, number>();
    for (const { record: { resource } } of drafts) counts.set(resource.id, (counts.get(resource.id) ?? 0) + 1);
    const isSettled = (id: string) => ['acknowledged', 'cancelled'].includes(byId.get(id)?.state ?? '');
    const isCancelled = (id: string) => byId.get(id)?.state === 'cancelled';

    for (const source of drafts) {
      const { scopeId } = source;
      const attempts = scan.attempts.get(scopeId) ?? 0;
      if (counts.get(source.record.resource.id) !== 1 || source.record.recoveryOrigins?.length || attempts >= 2) continue;
      const record = reconcileManualCaptures(source.record, requests);
      const { resource, baseline, predecessor } = record;
      // Partial input and decisions after a cancelled Save belong to the recovery UI.
      const ready = readyMeetingAutosave(record);
      const capturedHere = record !== source.record && predecessor && equalValues(record.stage, record.savedSelection)
        ? byId.get(predecessor.id) : undefined;
      if ((!ready && !capturedHere) || (predecessor && isCancelled(predecessor.id))) continue;
      if ([...this.manualForms.values()].some(form => form.scopeId === scopeId)
        || await this.recoveryPresence.held(owner, 'manual', scopeId) !== false) continue;
      active();
      if (capturedHere) {
        if (capturedHere.state === 'acknowledged') await store.retireAcknowledgedMeetingDraft?.(source, capturedHere.id);
        else if (!scan.recheckedReceipts.has(capturedHere.id)) scan.waiting.add(capturedHere.id);
        active();
        continue;
      }
      const waiting = requests.filter(request => sameResource(request.baseline.resource, resource) && !isSettled(request.id));
      if (waiting.length) {
        for (const { id } of waiting) if (!scan.recheckedReceipts.has(id)) scan.waiting.add(id);
        continue;
      }
      if (!this.canSend()) { scan.retryRead = true; return; }
      let fresh: ResourceSnapshot | null;
      try { fresh = await this.readWriteTarget(resource); }
      catch (error) {
        active();
        if ((error as { code?: unknown } | null)?.code === 'resource-exhausted') return;
        scan.attempts.set(scopeId, attempts + 1);
        scan.retryRead ||= attempts === 0;
        continue;
      }
      active();
      if (!fresh) { scan.retryRead = true; continue; }
      scan.attempts.set(scopeId, 2);
      if (!fresh.value || !baseline.value || fresh.metadata?.deleted
        || (baseline.metadata ? baseline.metadata.generation !== fresh.metadata?.generation : !equalValues(baseline, fresh))) continue;
      const version = await store.pinRecovery?.(source);
      active();
      if (!version || !this.canSend() || await this.recoveryPresence.held(owner, 'manual', scopeId) !== false) continue;
      active();

      const scope = ManualScope.restore({ owner, resource, scopeId, selection: record.selection, port: {
        capture: () => ({ checkpoint: new DataSession(baseline).checkpoint(), provenance: [], requests: intents }),
        isCurrent: () => this.current(owner, generation), isSettled, isCancelled,
        // The commit and the closed form receipt share one storage transaction.
        persist: async () => undefined,
        save: async (id, checkpoint, options) => {
          const request = await this.commits.save(id, checkpoint, { ...options, resumeMeetingVersion: version });
          if (!request?.value) throw new Error('Meeting recovery did not capture its form');
          return { id: request.id, owner, resource, value: request.value, predecessorId: request.predecessor };
        },
      } }, record);
      try { await scope.save(); }
      catch (error) {
        if (!this.current(owner, generation)) return;
        if (error instanceof PendingStartupAutosave) {
          // A command admitted during the fresh read can defer exactly this source again.
          await this.waitForStartupAutosaveReceipts(owner, generation, scan, scopeId, error);
        } else if ((error as { code?: unknown } | null)?.code !== 'commit-changed') this.reportFailure(error, resource);
      } finally { scope.dispose(); }
    }
  }

  private async waitForStartupAutosaveReceipts(owner: string, generation: number, scan: StartupDraftRecovery,
    stamp: string, error: PendingStartupAutosave): Promise<void> {
    scan.attempts.delete(stamp);
    for (const id of error.receipts) if (!scan.recheckedReceipts.has(id)) scan.waiting.add(id);
    const requests = await this.commits.list();
    this.assertCurrent(owner, generation);
    requests.forEach(request => this.rememberCommit(request));
  }

  private async captureResumedAutosave(owner: string, generation: number, id: string, source: EditorRecord,
    pin: NonNullable<CheckpointRecoveryStore['pinRecovery']>, input?: ServiceOrderInput): Promise<CommitRequest | null> {
    if (await this.recoveryPresence.held(owner, 'checkpoint', id) !== false) return null;
    this.assertCurrent(owner, generation);
    const version = await pin(source);
    this.assertCurrent(owner, generation);
    const { editorId } = source;
    if (!version || !this.canSend() || (input && this.serviceOrderEditorsOpenedHere.has(editorId))) return null;
    const intent = input ? DataSession.restore(source.checkpoint).pinFieldSave() : source.checkpoint;
    try {
      return await this.commits.save(editorId, intent, {
        resumeVersion: version,
        ...(input && { serviceOrderInput: input, predecessorId: null }),
        checkpoint: request => {
          this.assertCurrent(owner, generation);
          const session = DataSession.restore(intent);
          const completed = session.applyCommit(request) ? [request.id] : [];
          return { ...source, checkpoint: session.checkpoint(), completedCommits: [...(source.completedCommits ?? []), ...completed] };
        },
      });
    } catch (error) {
      if (error instanceof PendingStartupAutosave) throw error;
      // A reopened tab or another startup can consume this exact version first.
      if (this.current(owner, generation) && (error as { code?: unknown } | null)?.code !== 'commit-changed') {
        this.reportFailure(error, source.checkpoint.confirmed.resource);
      }
      return null;
    }
  }

  private async createDraftAlternative(owner: string, editorId: string, confirmed: ResourceSnapshot,
    alternative: ((confirmed: DocumentData) => DocumentData) | PlanCellAlternative,
    { verify, reuse }: { verify?: () => void; reuse?: boolean } = {}): Promise<RecoveryCheckpoint | null> {
    if (!confirmed.value || confirmed.metadata?.deleted) {
      throw Object.assign(new Error('The record is not available for this alternative'), { code: 'decision-changed' });
    }
    const session = new DataSession(confirmed);
    if (typeof alternative === 'function') session.edit(alternative(copy(confirmed.value)));
    else {
      const { nodeId, text } = alternative;
      const opening = planCellOpening(session.checkpoint(), nodeId, readPlanCellText(confirmed.value, nodeId));
      if (!opening) throw Object.assign(new Error('The plan cell is unavailable'), { code: 'decision-changed' });
      session.editPlanCell(opening, text);
    }
    const checkpoint = session.checkpoint();
    if (!checkpoint.dirty) return null;
    return this.persistDraftAlternative({
      owner, editorId, checkpoint, prepared: null, unfinalized: [],
      ...(typeof alternative !== 'function' && { planCellAlternative: true, autoSaveOnResume: false }),
    }, { verify, reuse });
  }

  private async persistDraftAlternative(draft: EditorRecord, { verify, reuse }: { verify?: () => void; reuse?: boolean }): Promise<RecoveryCheckpoint> {
    const { owner, editorId, checkpoint: { confirmed } } = draft;
    const record = validateRecoveryRecord(draft, owner, editorId, confirmed.resource);
    const store = this.recoveryStore();
    let stored = reuse ? await store.read(owner, editorId) : undefined;
    if (!stored) {
      await store.create(record);
      verify?.();
      stored = await store.read(owner, editorId);
    }
    verify?.();
    if (!stored) throw new Error('The alternative checkpoint is missing after its write');
    return { id: recoveryCheckpointId(owner, editorId),
      record: validateRecoveryRecord(stored, owner, editorId, confirmed.resource) };
  }

  private recoveryStore(): CheckpointRecoveryStore {
    const store = this.options.checkpoints as Partial<CheckpointRecoveryStore>;
    if (typeof store.listRecoverable !== 'function' || typeof store.create !== 'function') throw new Error('Checkpoint recovery is not supported by this store');
    return store as CheckpointRecoveryStore;
  }

  async retry(resource?: ResourceRef): Promise<void> {
    if (this.disposed || !this.owner) return;
    const owner = this.requireOwner();
    const generation = this.generation;
    const repairing = this.localWriteback.retry(owner);
    if (repairing) await repairing; this.assertCurrent(owner, generation);
    // Repair local ownership even offline. A failed first checkpoint or journal
    // insertion has no queued remote result that could repair it through replay.
    // The first failure ends the retry, as it always did, and stays about its own document
    // (BUG-20261003-background-failure-without-address).
    await Promise.all([...this.editors.values()].map(entry => {
      const controller = entry.controller;
      return controller?.needsPersistenceRetry() ? aboutEditor(controller, controller.retryPersistence()) : undefined;
    }));
    this.assertCurrent(owner, generation);
    // Started beside delivery, never ahead of it; what the pass releases is settled again at its end, also on failure.
    const finishCollection = this.options.deferCommitCollection?.(owner);
    const settling = this.settleClosedEditors(owner, generation);
    try {
      await this.commits.drain(this.canSend());
      this.assertCurrent(owner, generation);
      // Only an explicit document retry requests a fresh read; the background
      // delivery timer must not turn into an extra polling loop for every editor.
      if (resource) await about(resource, this.options.observer.refresh(resource));
      this.assertCurrent(owner, generation);
      await Promise.all([...this.editors.values()].map(entry => entry.controller && aboutEditor(entry.controller, entry.controller.settled())));
      this.assertCurrent(owner, generation);
      await Promise.all([...this.cacheWrites.values()]
        .filter(write => write.owner === owner && write.generation === generation)
        .map(write => about(write.resource, write.operation)));
      await this.completeAcceptedProjections(owner, generation);
      await this.completeCapabilityProjections(owner, generation);
      if (this.canSend() && this.needsAutosaveRecovery(generation)) {
        // A Save captured before the interruption still owns its opening. Let its
        // receipt settle the same closed copy before inspecting the words typed next.
        await settling;
        await this.settleClosedEditors(owner, generation);
        this.assertCurrent(owner, generation);
      }
      const resuming = this.resumeAutosaves(owner, generation);
      if (resuming) {
        await resuming;
        this.assertCurrent(owner, generation);
        await this.commits.drain(this.canSend());
        await this.completeAcceptedProjections(owner, generation);
      }
    } finally {
      try {
        await settling;
        await this.settleClosedEditors(owner, generation);
      } finally {
        await finishCollection?.().catch(error => { if (this.current(owner, generation)) this.reportFailure(error); });
      }
    }
    // A receipt can arrive between reading the closed copies and reading the queue.
    const startup = this.resumingAutosaves;
    if (this.canSend() && startup?.generation === generation && !startup.operation && this.answeredDraftReceipts(startup).length) this.backgroundDrain();
  }

  private async completeAcceptedProjections(owner: string, generation: number): Promise<void> {
    const requests = await this.commits.list(); this.assertCurrent(owner, generation);
    const completed = new Set<string>();
    for (const request of requests) {
      const group = request.atomic?.id ?? request.id;
      const transferredSource = request.state === 'cancelled' && Boolean(request.transferredTo);
      if (completed.has(group) || (request.state !== 'acknowledged' && !transferredSource
        && ![COUNCIL_CARRY, ANALYSIS_RESHAPE].includes(request.atomic?.kind ?? ''))) continue;
      completed.add(group);
      await this.completeAcceptedProjection(owner, generation, request, requests);
    }
  }

  /** The request remains the durable accepted copy until every participant is cached. */
  private async completeAcceptedProjection(owner: string, generation: number, request: CommitRequest, loaded?: CommitRequest[]): Promise<void> {
    // Preserve the immediate cache projection for document-only custom stores too.
    if (request.result?.kind === 'acknowledged') {
      const cached = await about(request.result.snapshot.resource, this.persistSnapshot(owner, generation, request.result.snapshot));
      if (!canReplaceSnapshot(request.result.snapshot, cached)) return;
    }
    this.assertCurrent(owner, generation);
    if (!this.options.commits.releaseProjection) {
      await this.completeMembershipEffects(request, owner, generation);
      return;
    }
    const ids = request.atomic?.participants ?? [request.id];
    const requests = request.atomic ? loaded ?? await (this.options.commits.readByIds?.(owner, ids) ?? this.commits.list()) : [request];
    this.assertCurrent(owner, generation);
    const participants = ids.map(id => requests.find(candidate => candidate.id === id));
    if (participants.some(participant => !participant || !['acknowledged', 'cancelled'].includes(participant.state) || participant.unfinalized.length)) return;
    for (const participant of participants) if (participant!.id !== request.id && participant!.result?.kind === 'acknowledged') {
      const cached = await about(participant!.result.snapshot.resource, this.persistSnapshot(owner, generation, participant!.result.snapshot)); this.assertCurrent(owner, generation);
      if (!canReplaceSnapshot(participant!.result.snapshot, cached)) return;
    }
    await this.completeMembershipEffects(participants[0]!, owner, generation);
    // Checkpoints/manual captures retain any proofs still needed for later unsent words.
    await about(request.baseline.resource, this.options.commits.releaseProjection(owner, ids)); this.assertCurrent(owner, generation);
  }

  private async completeMembershipEffects(request: CommitRequest, owner: string, generation: number): Promise<void> {
    const result = request.result;
    if (!request.seriesMembership || result?.kind !== 'acknowledged' || !result.affected?.length) return;
    const operationId = result.committed?.operationId ?? result.snapshot.metadata?.operationId;
    for (const effect of result.affected) {
      if (effect.resource.collection !== 'series' || effect.metadata.operationId !== operationId) throw new Error('Invalid series acknowledgement effect');
      await this.cacheAcknowledgedEffect(result, effect.resource, effect.metadata, owner, generation);
    }
    await this.options.collections?.reloadCached('series');
    this.assertCurrent(owner, generation);
  }

  private async cacheAcknowledgedEffect(result: Extract<CommandResult, { kind: 'acknowledged' }>, resource: ResourceRef,
    proof: EngineMetadata, owner: string, generation: number): Promise<void> {
    this.assertCurrent(owner, generation);
    const supplied = [result.snapshot, ...(result.relatedSnapshots ?? [])].find(snapshot => sameResource(snapshot.resource, resource)
      && coversCommittedEffect(snapshot, resource, proof));
    const snapshot = supplied ?? await this.readCommittedSnapshot(resource, proof);
    if (!snapshotBelongsToOwner(owner, snapshot)) throw new Error('Acknowledgement effect owner mismatch');
    const cached = await this.persistSnapshot(owner, generation, snapshot);
    if (!coversCommittedEffect(cached, resource, proof)) throw new Error('Acknowledgement effect projection is not covered');
  }

  private async completeCapabilityProjections(owner: string, generation: number): Promise<void> {
    const entries = await this.options.runtime.list(); this.assertCurrent(owner, generation);
    for (const entry of entries) if (entry.command.resource.collection === 'studyNoteShareLinks' && entry.result?.kind === 'acknowledged') {
      await this.completeCapabilityProjection(entry.result, owner, generation);
    }
  }

  /** The existing journal retains the ACK until every capability effect is durably cached. */
  private completeCapabilityProjection(result: Extract<CommandResult, { kind: 'acknowledged' }>, owner: string, generation: number): Promise<void> {
    const key = JSON.stringify([owner, generation, result.operationId]);
    const existing = this.capabilityProjections.get(key);
    if (existing) return existing;
    const operation = Promise.resolve().then(async () => {
      const effects = [{ resource: result.snapshot.resource, metadata: result.committed ?? result.snapshot.metadata }, ...(result.affected ?? [])];
      for (const effect of effects) {
        this.assertCurrent(owner, generation);
        if (!['studyNoteShareLinks', 'studyNotes'].includes(effect.resource.collection) || !effect.metadata) {
          throw new Error('Invalid capability acknowledgement');
        }
        await this.cacheAcknowledgedEffect(result, effect.resource, effect.metadata, owner, generation);
      }
      this.assertCurrent(owner, generation);
      for (const collection of new Set(effects.map(effect => effect.resource.collection))) {
        await this.options.collections?.reloadCached(collection); this.assertCurrent(owner, generation);
      }
      await this.options.runtime.finalize(result.operationId);
    });
    this.capabilityProjections.set(key, operation);
    void operation.finally(() => { if (this.capabilityProjections.get(key) === operation) this.capabilityProjections.delete(key); }).catch(() => undefined);
    return operation;
  }

  listPending(): Promise<JournalEntry[]> {
    return this.options.runtime.list();
  }

  getPending(): JournalEntry[] { return copy(this.pending); }

  subscribePending(listener: () => void): () => void {
    if (this.disposed) throw new Error(ENGINE_DISPOSED);
    const subscription = () => listener();
    this.pendingListeners.add(subscription);
    return () => { this.pendingListeners.delete(subscription); };
  }

  /** A backup may transfer only to an actual request held by its own capture reference. */
  async listWriteCaptures(scopePrefix: string) {
    if (this.disposed) throw new Error(ENGINE_DISPOSED);
    const owner = this.owner, generation = this.generation;
    if (!owner || !this.options.commits.listCaptures) return [];
    const requests = await this.options.commits.listCaptures(owner, scopePrefix);
    this.assertCurrent(owner, generation);
    return requests.map(request => {
      const transfer = request.planTextEvidence?.planSubpointTransfer;
      const capture = { requestId: request.id, scope: request.retentionScope!, owner,
        resource: copy(request.baseline.resource), value: copy(request.value) };
      if (!transfer) return capture;
      return {
        ...capture,
        state: request.state,
        planTransfer: { pointId: transfer.pointId, subPointId: transfer.subPointId },
        ...(request.result?.kind === 'acknowledged' && { acceptedValue: copy(request.result.snapshot.value) }),
      };
    });
  }

  async releaseWriteCapture(scope: string, requestId: string): Promise<void> {
    if (this.disposed) throw new Error(ENGINE_DISPOSED);
    const owner = this.owner, generation = this.generation;
    if (!owner || !this.options.commits.releaseCapture) return;
    await this.options.commits.releaseCapture(owner, scope, requestId);
    this.assertCurrent(owner, generation);
  }

  /** Recovery and whole-action delivery depend on both journal rows and durable request answers. */
  subscribeSavedWork(listener: () => void): () => void {
    const stopPending = this.subscribePending(listener);
    const stopCommits = this.commits.subscribe(({ request }) => {
      if (!this.disposed && request.owner === this.owner) listener();
    });
    return () => { stopPending(); stopCommits(); };
  }

  dispose(): void {
    if (this.disposed) return;
    this.setOwner(null);
    this.stopRedelivery();
    this.disposed = true;
    this.stopRuntime();
    this.stopCommits();
    this.commits.setOwner(null);
    this.pendingListeners.clear();
    this.openAnswerListeners.clear();
    this.openAnswerScopeListeners.clear();
    this.membershipListeners.clear();
    this.reachableListeners.clear();
    this.options.collections?.dispose();
    this.options.observer.dispose();
  }

  /** A cache copy is sufficient only if it proves the accepted participant revision. */
  private async readCommittedSnapshot(resource: ResourceRef, proof: EngineMetadata): Promise<ResourceSnapshot> {
    const owner = this.requireOwner(), generation = this.generation;
    const cached = await this.knownSnapshot(owner, generation, resource);
    if (cached && coversCommittedEffect(cached, resource, proof)) return cached;
    // Part of finishing this tab's own write, not polling: allowed whenever the write could be sent.
    if (!this.canSend()) throw new Error('Participant acknowledgement needs a confirmed read');
    const snapshot = await this.options.transport.read(owner, resource); this.assertCurrent(owner, generation);
    if (!coversCommittedEffect(snapshot, resource, proof) || !snapshotBelongsToOwner(owner, snapshot)) throw new Error('Participant read does not prove the acknowledgement');
    return this.persistSnapshot(owner, generation, snapshot);
  }

  /** Read requests first: collected ACKs must already have their durable cache copy. */
  private async knownSnapshot(owner: string, generation: number, resource: ResourceRef): Promise<ResourceSnapshot | undefined> {
    const requests = await this.commits.list(); this.assertCurrent(owner, generation);
    requests.forEach(request => this.rememberCommit(request));
    return this.cachedSnapshotWithAcknowledgements(owner, generation, resource);
  }

  private async cachedSnapshotWithAcknowledgements(owner: string, generation: number, resource: ResourceRef): Promise<ResourceSnapshot | undefined> {
    let snapshot = await this.options.snapshots.read(owner, resource); this.assertCurrent(owner, generation);
    if (snapshot && !sameResource(snapshot.resource, resource)) throw new Error(CACHED_IDENTITY_MISMATCH);
    for (const request of this.commitRecords.values()) {
      if (request.owner !== owner || request.state !== 'acknowledged' || request.result?.kind !== 'acknowledged') continue;
      const accepted = request.result.snapshot;
      if (sameResource(accepted.resource, resource) && snapshotBelongsToOwner(owner, accepted)
        && canReplaceSnapshot(snapshot, accepted)) snapshot = accepted;
    }
    return snapshot && copy(snapshot);
  }

  private async readSnapshot(owner: string, generation: number, resource: ResourceRef): Promise<ResourceSnapshot> {
    const cached = await this.knownSnapshot(owner, generation, resource);
    if (cached) return cached;
    if (!this.online || !this.visible) throw Object.assign(new Error('The document is not available in the local cache'), { code: NEEDS_CONNECTION });
    const startedBeforePause = this.readPause;
    let server: ResourceSnapshot;
    try {
      server = await this.options.transport.read(owner, resource);
    } catch (error) {
      this.assertCurrent(owner, generation);
      // A failed response can settle after visibility or connectivity has already returned.
      if (startedBeforePause !== this.readPause && isConnectionFailure(error)) throw new PausedReadFailure(error);
      throw error;
    }
    this.assertCurrent(owner, generation);
    if (!sameResource(server.resource, resource)) throw new Error(SERVER_SNAPSHOT_IDENTITY_MISMATCH);
    return this.persistSnapshot(owner, generation, server);
  }

  private async open(resource: ResourceRef, editorId: string, creating: boolean, options?: EditorOpenOptions, attempt = 0, recoverySourceIds: readonly string[] = []): Promise<ManagedEditor> {
    const owner = this.requireOwner();
    this.validateResource(resource, owner);
    if (!editorId) throw new Error('An editor identity is required');
    if (options?.signal?.aborted) throw this.abortError();
    if (this.editors.has(editorId) || this.recovering.has(editorId)) throw new Error('This editor identity is already open');
    const generation = this.generation;
    const frozen = copy(resource);
    const serviceInput = frozen.collection === 'serviceOrders' && isDocumentEditorSlot(editorId, frozen, SERVICE_ORDER_INPUT_SLOT);
    if (serviceInput) this.serviceOrderEditorsOpenedHere.add(editorId);
    const entry: EditorEntry = {
      autoSaveOnResume: options?.autoSaveOnResume,
      planCellEmergency: frozen.collection === 'sermons' && this.options.planCellEmergencyStorage
        ? new PlanCellEmergency(owner, editorId, this.options.planCellEmergencyStorage) : undefined,
      serviceOrderInputReserve: this.options.serviceOrderReserveStorage && serviceInput
        ? new ServiceOrderInputReserve(owner, frozen.id, editorId, this.options.serviceOrderReserveStorage) : undefined,
      presence: this.recoveryPresence.hold(owner, 'checkpoint', [recoveryCheckpointId(owner, editorId), ...recoverySourceIds]),
      initializing: null,
      controller: null, stopObservation: null, stopController: null, closed: false,
      listeners: new Set(), observation: initialObservation(), pendingActionSaves: new Map(),
    };
    this.editors.set(editorId, entry);
    let onAbort: (() => void) | undefined;
    const cancelled = options?.signal && new Promise<never>((_resolve, reject) => {
      onAbort = () => {
        this.close(entry);
        if (this.editors.get(editorId) === entry) this.editors.delete(editorId);
        reject(this.abortError());
      };
      options.signal!.addEventListener('abort', onAbort, { once: true });
    });
    const opening = this.initializeEditor(owner, generation, frozen, editorId, creating, entry, recoverySourceIds.length > 0);
    entry.initializing = opening;
    try {
      const managed = await (cancelled ? Promise.race([opening, cancelled]) : opening);
      if (entry.closed) throw this.abortError();
      return managed;
    } catch (error) {
      // Initialization already retired its failed entry; reread before exposing a new editor.
      if ((error as { code?: string } | null)?.code === 'commit-reference-changed' && attempt < 2
        && this.current(owner, generation) && !options?.signal?.aborted) {
        return this.open(frozen, editorId, creating, options, attempt + 1, recoverySourceIds);
      }
      throw error;
    } finally {
      if (onAbort) options?.signal?.removeEventListener('abort', onAbort);
    }
  }

  private async initializeEditor(owner: string, generation: number, frozen: ResourceRef, editorId: string, creating: boolean, entry: EditorEntry, recovering: boolean): Promise<ManagedEditor> {
    const assertOpening = () => {
      this.assertCurrent(owner, generation);
      if (entry.closed) throw this.abortError();
    };
    try {
      // A later action on this document must see a Save captured by the screen that just closed.
      const repairing = this.localWriteback.retry(owner, address =>
        (address.kind === 'checkpoint' && address.id === editorId)
        || (address.kind === 'closing-save' && address.resource !== undefined && sameResource(address.resource, frozen)));
      if (repairing) await repairing;
      assertOpening();
      const reservedNote = creating && frozen.collection === 'studyNotes'
        && (editorSlot(editorId) === 'study-note' || (recovering && isNewCommentEditor(editorId)));
      const requests = creating && !reservedNote ? [] : await this.commits.list();
      assertOpening();
      requests.forEach(request => this.rememberCommit(request));
      let submittedCheckpoint = submittedEditorCheckpoint(owner, frozen, requests);
      const manualStore = this.options.manualScopes;
      const readManualChoices = manualStore && (async (related: readonly CommitRequest[]) => {
        const choices = await manualOrdinaryChoiceSources(manualStore, owner, frozen, related);
        assertOpening();
        entry.manualChoices = choices;
        return choices;
      });
      if (!submittedCheckpoint && readManualChoices) {
        submittedCheckpoint = submittedEditorCheckpoint(owner, frozen, requests, await readManualChoices(requests));
      }
      const readManualSources = manualStore && ((related: readonly CommitRequest[]) => manualReturnSources(manualStore, owner, editorId, frozen, related));
      if (submittedCheckpoint && readManualSources) {
        const sources = await readManualSources(requests.filter(request => sameResource(request.baseline.resource, frozen)));
        assertOpening();
        markBorrowedManualSources(submittedCheckpoint, sources);
      }
      const resumingCreation = Boolean(submittedCheckpoint && submittedCheckpoint.confirmed.value === null && !submittedCheckpoint.confirmed.metadata);
      // Returning to the reserved address can follow a creation this account already captured.
      // A new address still starts absent, so creating offline cannot replace a different record.
      const retainedCreation = reservedNote && !submittedCheckpoint
        ? await this.cachedSnapshotWithAcknowledgements(owner, generation, frozen) : undefined;
      const snapshot: ResourceSnapshot = submittedCheckpoint?.confirmed ?? (creating
        ? retainedCreation ?? { resource: frozen, value: null, metadata: null }
        : await this.openingSnapshot(owner, generation, frozen, editorId));
      assertOpening();
      const controller = await EditorController.open({
        owner, editorId, snapshot, store: this.options.checkpoints, runtime: this.options.runtime,
        operationId: this.options.operationId,
        readConfirmed: resource => this.read(resource),
        readWriteTarget: resource => this.readWriteTarget(resource),
        publishStoredChoice: snapshot => this.publishStoredChoice(owner, generation, snapshot),
        persistConfirmedDeletion: async snapshot => {
          const cached = await this.persistSnapshot(owner, generation, snapshot);
          if (!canReplaceSnapshot(snapshot, cached)) throw new Error('Confirmed deletion was not stored');
        },
        commits: this.commits, autoSaveOnResume: entry.autoSaveOnResume, planCellEmergency: entry.planCellEmergency,
        serviceOrderInputReserve: entry.serviceOrderInputReserve,
        retainRemovedPlanCell: frozen.collection === 'sermons' ? async (basis, nodeId, draft) => {
          const reserve = entry.planCellEmergency?.hold(frozen.id, nodeId, draft.text);
          const key = uuidV5(JSON.stringify(['removed-plan-cell', editorId, nodeId, draft]), uuidV5.URL);
          try {
            const retained = await this.createDraftAlternative(owner, recoveryEditorIdentity(editorId, key), basis,
              { kind: 'plan-cell', nodeId, text: draft.text }, { reuse: true });
            if (retained?.record.checkpoint.planCellDrafts?.[nodeId]?.text === draft.text) {
              reserve?.release();
              return { identity: retained.id, discard: () => this.discardSupersededPlanCell(retained, owner, generation) };
            }
          } catch {
            // Keep the same words synchronously when the checkpoint store refuses the copy.
          }
          return reserve?.preserve() ? { identity: Symbol(), discard: reserve.release } : null;
        } : undefined,
        submittedCheckpoint: submittedCheckpoint ?? undefined,
        manualReturnSources: readManualSources,
        manualChoiceSources: readManualChoices,
        canFollowSubmittedWork: () => ![...this.manualForms.values()].some(form => {
          if (form.parent !== entry) return false;
          const stage = form.scope?.getState();
          // Merely opening a date/control is not private authoring work.
          return Boolean(form.opening || (stage && (stage.dirty || stage.capturing || stage.captureFailed || !stage.durable)));
        }),
        onRecoverySources: sources => entry.presence.add(sources.map(source => source.id)),
        isCurrentOwner: uid => !entry.closed && this.current(uid, generation),
      });
      entry.controller = controller;
      assertOpening();
      // A request may commit just before its optimistic parent checkpoint is persisted.
      // The durable manual envelope is the association; never infer ownership from another tab.
      if (this.options.manualScopes) {
        const scopes = await this.options.manualScopes.list(owner, frozen); assertOpening();
        const requests = await this.commits.list(); assertOpening();
        requests.forEach(request => this.rememberCommit(request));
        for (const scope of scopes.filter(item => item.parentEditorId === editorId)) {
          for (const request of requests.filter(item => item.editorId === scope.scopeId && item.state !== 'cancelled').sort((a, b) => a.editGeneration - b.editGeneration)) {
            await controller.adoptManualCommit(request, scope.record.selection); assertOpening();
          }
        }
      }
      // Restore and reconcile before attaching a source that may emit synchronously.
      if (!creating && canReplaceSnapshot(controller.getState().checkpoint.confirmed, snapshot)) {
        await controller.observe(snapshot, 'cache');
      }
      // The answer opens on its capture basis. Do not block opening a saved draft on a second
      // IndexedDB store, but a newly opened branched choice must wait for the known stored copy.
      const checkpoint = controller.getState().checkpoint;
      let loadingBranchAnswer = Boolean(checkpoint.groupTextReview
        || (submittedCheckpoint && hasBranchedOrdinaryAnswer(Object.keys(checkpoint.pending), requests)));
      if (loadingBranchAnswer || (submittedCheckpoint && ordinaryAnswerCoverage(checkpoint, requests).councilRefusal)) {
        const observing = this.cachedSnapshotWithAcknowledgements(owner, generation, frozen).then(cached => {
          if (entry.closed || !this.current(owner, generation) || !cached) return;
          const { confirmed, remoteCandidate } = controller.getState().checkpoint;
          if (storesNewCopy(remoteCandidate ?? confirmed, cached)) return controller.observe(cached, 'cache');
        }).finally(() => {
          if (!loadingBranchAnswer) return;
          loadingBranchAnswer = false;
          if (!entry.closed && this.current(owner, generation)) this.emit(entry);
        });
        this.background(observing, owner, generation, frozen);
      }
      assertOpening();
      let lastConfirmed: ResourceSnapshot | null = null;
      let resumeCreatedStepInputs: (() => void) | undefined;
      let resumeServiceOrderInputs: ((state: EditorState) => void) | undefined;
      const updateCache = () => {
        if (entry.closed || !this.current(owner, generation)) return;
        const state = controller.getState();
        const { confirmed } = state.checkpoint;
        if (!equalValues(confirmed, lastConfirmed)) {
          lastConfirmed = confirmed;
          // A new, unsubmitted editor's absence is not evidence of a server deletion.
          if ((!creating && !resumingCreation) || confirmed.metadata || confirmed.value !== null) {
            this.background(this.persistSnapshot(owner, generation, confirmed), owner, generation, frozen);
          }
        }
        // Watching an existing ID before create acknowledgement could turn create into update.
        if (!entry.stopObservation && ((!creating && !resumingCreation) || confirmed.metadata || confirmed.value !== null)) {
          const stopObservation = this.options.observer.watch(owner, frozen, observation => {
            if (entry.closed || !this.current(owner, generation)) return;
            entry.observation = observation;
            this.emit(entry);
            if (!observation.snapshot || !observation.source) return;
            this.background(controller.observe(observation.snapshot, observation.source), owner, generation, frozen);
            this.background(this.persistSnapshot(owner, generation, observation.snapshot), owner, generation, frozen);
          });
          if (entry.closed || !this.current(owner, generation)) stopObservation();
          else entry.stopObservation = stopObservation;
        }
        resumeCreatedStepInputs?.();
        resumeServiceOrderInputs?.(state);
        this.emit(entry);
      };
      entry.stopController = controller.subscribe(updateCache);
      updateCache();
      assertOpening();
      const active = () => {
        this.assertCurrent(owner, generation);
        if (entry.closed) throw new Error('Editor is no longer active');
      };
      const carryCouncilTopic = (topicId: string, title: string, destinationId?: string): Promise<ResourceSnapshot> => {
        active();
        const key = JSON.stringify([owner, frozen, topicId]);
        const existing = this.councilCarries.get(key); if (existing) return existing;
        const pinned = copy(controller.getState().checkpoint);
        const copyId = this.options.operationId(), targetId = destinationId ?? copyId, now = new Date().toISOString();
        const run = async () => {
          let targetSnapshot = destinationId ? await this.peekCached({ collection: 'councils', id: destinationId }) : null;
          this.assertCurrent(owner, generation);
          const requests = await this.commits.list(); this.assertCurrent(owner, generation);
          if (destinationId && !targetSnapshot) targetSnapshot = requests.find(request => request.owner === owner
            && sameResource(request.baseline.resource, { collection: 'councils', id: destinationId }))?.baseline
            ?? await this.read({ collection: 'councils', id: destinationId });
          this.assertCurrent(owner, generation);
          const captured = captureCouncilCarry(owner, editorId, pinned, requests, topicId, targetId, title, now,
            targetSnapshot ? pinCouncilDestination(owner, targetSnapshot, requests) : undefined, copyId);
          const saved = await this.commits.saveAtomic(captured.captures); this.assertCurrent(owner, generation);
          // Durable ownership survives navigation; adoption only updates a parent still on screen.
          if (!entry.closed) {
            try { await controller.adoptManualCommit(saved[0], [['topics', { id: topicId }, 'carriedToCouncilId']]); }
            catch (error) { this.reportFailure(error, frozen); }
          }
          this.assertCurrent(owner, generation);
          this.prepareCommitsInBackground(); this.backgroundDrain();
          return captured.destination;
        };
        const pending = run(); this.councilCarries.set(key, pending);
        void pending.finally(() => { if (this.councilCarries.get(key) === pending) this.councilCarries.delete(key); }).catch(() => undefined);
        return pending;
      };
      const { pendingActionSaves } = entry;
      const saveServiceOrderField = async (input: ServiceOrderInput, compared?: ServiceOrderInputComparison) => {
        active();
        const checkpoint = controller.captureFieldSave();
        const serviceOrderInput = copy(input);
        const serviceOrderComparison = compared && copy(compared);
        const field = { serviceOrderInput, serviceOrderComparison };
        const saving = controller.save({ ...checkpoint, ...field });
        pendingActionSaves.set(checkpoint.editGeneration, [{ checkpoint, ...field }]);
        await saving.catch(error => {
          if (error instanceof ServiceOrderInputDecisionError) pendingActionSaves.delete(checkpoint.editGeneration);
          throw error;
        });
        pendingActionSaves.delete(checkpoint.editGeneration);
        active();
        this.backgroundDrain();
        this.prepareCommitsInBackground();
      };
      const stageServiceInput = (value: DocumentData | null, shown: ShownCopy | undefined, input: ServiceOrderInput) => {
        active();
        const autosave = entry.serviceOrderAutosave;
        if (!autosave) throw new Error('This editor does not own service input');
        const { confirmed, pending } = controller.getState().checkpoint;
        const metadata = confirmed.metadata;
        const followsAdd = input.field !== 'orderTitle' && metadata && !metadata.deleted
          && readServiceOrderInputValue(confirmed.value, input) === undefined
          && (input.waitingForStep || Object.values(pending).some(saved =>
            equalValues(readServiceOrderInputValue(saved.value, input), input.before)));
        const opening = autosave.opening(followsAdd ? { ...input, waitingForStep: true,
          version: input.version ?? { generation: metadata.generation, observedRevision: metadata.revision } } : input);
        const persistence = controller.edit(value, shown, { field: 'service-order-input', input: opening });
        const stamp = controller.getState().checkpoint.serviceOrderInputs?.[serviceOrderInputKey(input)];
        autosave.arrange(input, stamp);
        return persistence;
      };
      if (frozen.collection === 'serviceOrders' && isDocumentEditorSlot(editorId, frozen, SERVICE_ORDER_INPUT_SLOT)) {
        entry.serviceOrderAutosave = new ServiceOrderAutosave(
          input => equalValues(controller.getState().checkpoint.serviceOrderInputs?.[serviceOrderInputKey(input)], input),
          input => saveServiceOrderField(input).catch(error => {
            if (!entry.closed && this.current(owner, generation)) this.reportFailure(error, frozen);
            throw error;
          }),
          input => {
            const { checkpoint: { confirmed, remoteCandidate, pending }, result } = controller.getState();
            const version = input.version;
            return Boolean(Object.keys(pending).length && result?.kind !== 'conflict' && result?.kind !== 'refused'
              && version && confirmed.metadata?.generation === version.generation
              && confirmed.metadata.revision < version.observedRevision && remoteCandidate?.metadata?.generation === version.generation
              && !remoteCandidate.metadata.deleted && remoteCandidate.metadata.revision >= version.observedRevision);
          },
        );
        resumeServiceOrderInputs = ({ checkpoint, result }) => {
          if (result?.kind === 'refused' || result?.kind === 'conflict' || !Object.keys(checkpoint.pending).length) {
            entry.serviceOrderAutosave?.finishPredecessor(result?.kind === 'acknowledged');
          }
        };
        resumeCreatedStepInputs = () => {
          if (loadingBranchAnswer) return;
          const { checkpoint, result } = controller.getState();
          if (result?.kind === 'refused' || result?.kind === 'conflict') return;
          const { confirmed, draft, serviceOrderInputs } = checkpoint;
          if (confirmed.metadata?.deleted) return;
          for (const input of Object.values(serviceOrderInputs ?? {})) {
            if (!input.waitingForStep || !input.retainedOnly
              || (input.version && input.version.generation !== confirmed.metadata?.generation)) continue;
            const stored = readServiceOrderInputValue(confirmed.value, input);
            if (recovering ? stored === undefined : (!input.version && !equalValues(stored, input.before))
              || !equalValues(readServiceOrderInputValue(draft, input), input.before)) continue;
            const { retainedOnly: _retained, ...created } = input;
            const next = projectServiceOrderInput(controller.getState().checkpoint.draft, created);
            if (!next) continue;
            const staged = recovering ? controller.edit(next, undefined, { field: 'service-order-input', input: created })
              : stageServiceInput(next, undefined, created);
            this.background(staged, owner, generation, frozen);
          }
        };
        resumeCreatedStepInputs();
      }
      const commit = (updater: (current: DocumentData | null, confirmed: ResourceSnapshot) => DocumentData | null, onCaptured?: (receipt: DocumentWriteReceipt) => void, captureScope?: string, action?: EditorCommitAction, noteContent?: StudyNoteContentCapture | null) => {
        active();
        const checkpoint = controller.getState().checkpoint;
        if (checkpoint.groupTextReview) throw Object.assign(
          new Error('Finish comparing the group fields before saving another action'), { code: 'resolve-version-first' });
        const rowVersion = action?.kind === 'service-order-flag' || action?.kind === 'council-assembly' ? action.flag
          : action?.kind === 'service-order-step-title' ? action.title
            : action?.kind === 'service-order-step-body' ? action.body
            : action?.kind === 'service-order-step-scripture' ? action.scripture
              : action?.kind === 'council-topic-kind' ? action.topicKind : undefined;
        if (rowVersion && checkpoint.confirmed.metadata?.generation !== rowVersion.generation) {
          throw Object.assign(new Error('The shown record changed'), { code: 'decision-changed' });
        }
        const tagMembership = action && 'tagMembership' in action ? action.tagMembership : undefined;
        if (tagMembership?.some(intent => intent.generation !== checkpoint.confirmed.metadata?.generation)) {
          throw Object.assign(new Error('The shown record changed'), { code: 'decision-changed' });
        }
        if (action?.kind === 'group-flow-step-placement' && (frozen.collection !== 'groups'
          || (checkpoint.confirmed.metadata?.generation ?? null) !== action.move.generation)) {
          throw Object.assign(new Error('The shown group changed'), { code: 'decision-changed' });
        }
        if (action?.kind === 'council-topic-placement' && (frozen.collection !== 'councils'
          || (checkpoint.confirmed.metadata?.generation ?? null) !== action.move.generation)) {
          throw Object.assign(new Error('The shown council changed'), { code: 'decision-changed' });
        }
        if (action?.kind === 'sermon-source-note-links' && !matchesSourceNoteOpening(checkpoint.confirmed, action.selection)) {
          throw Object.assign(new Error('The shown sermon changed'), { code: 'decision-changed' });
        }
        const next = updater(checkpoint.draft, checkpoint.confirmed);
        let captured = next === checkpoint.draft && (action?.kind === 'document-tags' || action?.kind === 'prayer-text'
          || action?.kind === 'sermon-plan-text' && action.transfer) ? undefined : action;
        if (action?.kind === 'service-order-placement'
          && (frozen.collection !== 'serviceOrders' || !next || next.rank !== action.move.rank
            || (checkpoint.confirmed.metadata?.generation ?? null) !== action.move.generation)) {
          throw Object.assign(new Error('The shown service order changed'), { code: 'decision-changed' });
        }
        if (action?.kind === 'service-order-title') {
          const { seen } = action.title;
          const predecessor = seen.requestId ? this.commitRecords.get(seen.requestId) : undefined;
          const known = predecessor?.owner === owner && sameResource(predecessor.baseline.resource, frozen)
            && predecessor.baseline.metadata?.generation === seen.generation && predecessor.value?.title === seen.title
            && !['conflict', 'refused', 'cancelled'].includes(predecessor.state);
          const title = validatedTitleCapture(checkpoint.confirmed, checkpoint.draft, next, action.title, known);
          captured = title ? { kind: 'service-order-title', title } : undefined;
        }
        const prayerTitle = action?.kind === 'prayer-title' || action?.kind === 'prayer-text' ? action.title : undefined;
        if (prayerTitle) {
          const { seen } = prayerTitle;
          const known = Boolean(seen.requestId && matchesPrayerTitleRequest(this.commitRecords.get(seen.requestId), owner, frozen, seen));
          if (!capturePrayerTitle(checkpoint.confirmed, next === checkpoint.draft ? null : next, prayerTitle, known)) {
            if (next !== checkpoint.draft && (checkpoint.confirmed.metadata?.generation !== seen.generation || checkpoint.draft?.title !== seen.title)) {
              throw Object.assign(new Error('The prayer title changed'), { code: 'prayer-title-basis-changed' });
            }
            if (captured?.kind === 'prayer-text') captured = { ...captured, title: undefined };
            else captured = next !== checkpoint.draft && tagMembership?.length
              ? { kind: 'document-tags', tagMembership } : undefined;
          }
        }
        if (action?.kind === 'plan-template-name') {
          const { seen } = action.name;
          const known = Boolean(seen.requestId && matchesPlanTemplateNameRequest(this.commitRecords.get(seen.requestId), owner, frozen, seen));
          if (!capturePlanTemplateName(checkpoint.confirmed, next === checkpoint.draft ? null : next, action.name, known)) {
            if (next !== checkpoint.draft && (checkpoint.confirmed.metadata?.generation !== seen.generation || checkpoint.draft?.name !== seen.title)) {
              throw Object.assign(new Error('The template name changed'), { code: 'plan-template-name-basis-changed' });
            }
            captured = undefined;
          }
        }
        if (action?.kind === 'tag-color') {
          const { seen } = action.color;
          const known = Boolean(seen.requestId && matchesTagColorRequest(this.commitRecords.get(seen.requestId), owner, frozen, seen));
          if (!captureTagColor(checkpoint.confirmed, next === checkpoint.draft ? null : next, action.color, known)) {
            if (next !== checkpoint.draft && (checkpoint.confirmed.metadata?.generation !== seen.generation || checkpoint.draft?.color !== seen.color)) {
              throw Object.assign(new Error('The tag color changed'), { code: 'tag-color-basis-changed' });
            }
            captured = undefined;
          }
        }
        if (action?.kind === 'sermon-plan-mode') {
          const { seen, initialize } = action.mode;
          if (initialize && checkpoint.draft?.planMode !== undefined) return Promise.resolve();
          const predecessor = seen.requestId ? this.commitRecords.get(seen.requestId) : undefined;
          const permitted = permitsSermonPlanModePredecessor(predecessor, owner, frozen, seen);
          if (!captureSermonPlanMode(checkpoint.confirmed, next, action.mode, permitted)) {
            throw Object.assign(new Error('The shown plan mode changed'), { code: 'decision-changed' });
          }
        }
        if (action?.kind === 'study-note-title' || action?.kind === 'study-note-type') {
          let title = action.kind === 'study-note-title' ? action.title : undefined;
          let type = action.type;
          const edited = next !== checkpoint.draft ? next : null;
          if (title) {
            const { seen } = title;
            const known = Boolean(seen.requestId && matchesStudyNoteTitleRequest(this.commitRecords.get(seen.requestId), owner, frozen, seen));
            if (!captureStudyNoteTitle(checkpoint.confirmed, edited, title, known)) {
              if (edited && (checkpoint.confirmed.metadata?.generation !== seen.generation
                || !equalValues(readField(checkpoint.draft ?? {}, ['title']), studyNoteTitleValue(seen)))) {
                throw Object.assign(new Error('The study note title changed'), { code: 'study-note-title-basis-changed' });
              }
              title = undefined;
            }
          }
          if (type) {
            const { seen } = type;
            const known = Boolean(seen.requestId && matchesStudyNoteTypeRequest(this.commitRecords.get(seen.requestId), owner, frozen, seen));
            if (!captureStudyNoteType(checkpoint.confirmed, edited, type, known)) {
              if (edited && (checkpoint.confirmed.metadata?.generation !== seen.generation
                || !equalValues(readField(checkpoint.draft ?? {}, ['type']), studyNoteTypeValue(seen)))) {
                throw Object.assign(new Error('The study note type changed'), { code: 'study-note-type-basis-changed' });
              }
              type = undefined;
            }
          }
          const { tagMembership, referenceEvidence } = action;
          captured = title ? { kind: 'study-note-title', title, type, tagMembership, referenceEvidence }
            : type ? { kind: 'study-note-type', type, tagMembership, referenceEvidence }
              : edited && referenceEvidence ? { kind: 'study-note-references', referenceEvidence, tagMembership }
                : edited && tagMembership?.length ? { kind: 'document-tags', tagMembership } : undefined;
        }
        if (action?.kind === 'comment-kind') {
          const { seen } = action.commentKind;
          const known = Boolean(seen.requestId && matchesCommentKindRequest(this.commitRecords.get(seen.requestId), owner, frozen, seen));
          const resolving = next === checkpoint.draft;
          const anchored = matchesCommentKindPlace(checkpoint.draft, seen.reference)
            || (resolving && matchesCommentKindPlace(checkpoint.confirmed.value, seen.reference));
          if (!anchored) throw Object.assign(new Error('The comment passage changed'), { code: 'comment-kind-place-changed' });
          if (!captureCommentKind(checkpoint.confirmed, next, action.commentKind, known)) {
            if (!resolving || next?.paragraph !== checkpoint.confirmed.value?.paragraph) {
              throw Object.assign(new Error('The comment kind changed'), { code: 'comment-kind-basis-changed' });
            }
            captured = undefined;
          }
        }
        if (action?.kind === 'comment-place') {
          const { seen } = action.commentPlace;
          const known = Boolean(seen.requestId && matchesCommentPlaceRequest(this.commitRecords.get(seen.requestId), owner, frozen, seen));
          if (!captureCommentPlace(checkpoint.confirmed, next, action.commentPlace, known)) {
            throw Object.assign(new Error('The comment move opening changed'), { code: 'comment-place-basis-changed' });
          }
        }
        const prayerStatus = action?.kind === 'prayer-status' || action?.kind === 'prayer-text' ? action.status : undefined;
        if (prayerStatus) {
          if (next === checkpoint.draft) captured = undefined;
          else if (prayerStatus.opening && !matchesPrayerStatusOpening(checkpoint.confirmed, prayerStatus.opening)) {
            throw Object.assign(new Error('The prayer status opening changed'), { code: 'prayer-status-basis-changed' });
          }
        }
        const stamp = captured?.kind === 'council-lifecycle' ? { field: 'heldAt' as const, time: captured.time }
          : captured?.kind === 'thought-placement' ? { field: 'thought-placement' as const, rowId: captured.rowId, time: captured.time }
            : captured?.kind === 'exegetical-point' ? { field: 'exegetical-point' as const, nodeId: captured.nodeId, intent: captured.intent, time: captured.time }
              : undefined;
        // The exact move owns only the position. Queue this opening draft first
        // so any unsaved words or independent fields keep their own durable Save.
        // CaptureContinuations retries earlier attempts before the exact Save.
        const move = captured?.kind === 'outline-point-placement' || captured?.kind === 'group-flow-step-placement'
          || captured?.kind === 'council-topic-placement' ? captured : undefined;
        if (move) void controller.save(checkpoint).catch(() => undefined);
        const persistence = controller.edit(next, captured?.kind === 'thought-placement' || captured?.kind === 'exegetical-point' ? captured.shown : undefined, stamp);
        const keepOnClose = move || (captured?.kind === 'sermon-plan-text' ? captured : undefined);
        const stagedAction = keepOnClose && controller.getState().checkpoint;
        const scope = captureScope ?? (captured?.kind === 'sermon-plan-text' ? captured.draftCaptureScope : undefined);
        const saving = controller.save(stagedAction, undefined, onCaptured, scope, stamp ? undefined : captured, undefined, noteContent);
        if (keepOnClose && stagedAction) {
          const edit = stagedAction.editGeneration;
          const pending = { checkpoint: stagedAction, action: keepOnClose };
          pendingActionSaves.set(edit, move ? [{ checkpoint }, pending] : [pending]);
          void saving.then(() => { pendingActionSaves.delete(edit); }, () => undefined);
        }
        return Promise.all([persistence, saving]).then(() => { active(); this.backgroundDrain(); this.prepareCommitsInBackground(); active(); });
      };
      const remove = async (onCaptured?: (receipt: DocumentWriteReceipt) => void, captureScope?: string) => {
        active(); await controller.remove(onCaptured, captureScope); active(); this.backgroundDrain(); this.prepareCommitsInBackground(); active();
      };
      const withReceipt = async (run: (captured: (receipt: DocumentWriteReceipt) => void) => Promise<void>) => {
        let receipt: DocumentWriteReceipt | undefined;
        try { await run(captured => { receipt = captured; }); }
        catch (error) {
          if (!receipt) throw error;
          // The canonical request already owns this write. A later checkpoint projection
          // failure is reported and repaired independently; it must not erase that receipt.
          if (this.current(owner, generation)) {
            this.reportFailure(error, frozen);
            this.backgroundDrain(); this.prepareCommitsInBackground();
          }
        }
        if (!receipt) throw new Error('Write capture did not return its receipt');
        return receipt;
      };
      const choose = async (choice: 'local' | 'remote', expected?: EditorRecord, compared?: SessionCheckpoint, choiceTime?: ActionTime | null, titles?: readonly OutlineTitleDecision[]) => {
        active();
        if (loadingBranchAnswer) throw Object.assign(new Error('Read the current version before choosing'), { code: 'fresh-read-required' });
        const current = controller.getState().checkpoint;
        if (hasSermonOutlineReview(current) && !compared) {
          throw Object.assign(new Error('Read both versions of the structure before choosing'), { code: 'decision-changed' });
        }
        if ((current.groupTextReview || readPrivateDocumentReview(current)) && !compared) {
          throw Object.assign(new Error('Finish comparing the group fields'), { code: 'decision-changed' });
        }
        if (compared && !equalValues(current, compared)) {
          throw Object.assign(new Error('The shown field comparison changed'), { code: 'decision-changed' });
        }
        if ((current.unreadableExegeticalProofs?.length && !Object.keys(current.pending).length)
          || (compared && (frozen.collection === 'serviceOrders' || readSermonSettingComparison(current)))) {
          const saved = await this.readWriteTarget(frozen).catch(() => null);
          active();
          const shown = current.remoteCandidate ?? current.confirmed;
          if (!saved || !canReplaceSnapshot(shown, saved)) {
            throw Object.assign(new Error('Read the current record before choosing'), { code: 'fresh-read-required' });
          }
          if (!equalValues(shown, saved)) {
            await controller.observe(saved, 'server');
            throw Object.assign(new Error('The shown field comparison changed'), { code: 'decision-changed' });
          }
          if (!equalValues(current, controller.getState().checkpoint)) {
            throw Object.assign(new Error('The shown field comparison changed'), { code: 'decision-changed' });
          }
        }
        await this.resolveEditorChoice(entry, owner, generation, choice, compared ? controller.captureRecoveryChoice() : expected, choiceTime, titles);
        active();
      };
      const holdAlternative = async (alternative: ((confirmed: DocumentData) => DocumentData) | PlanCellAlternative): Promise<HeldDraftAlternative | null> => {
        active();
        const confirmed = controller.getState().checkpoint.confirmed;
        const alternativeId = recoveryEditorIdentity(editorId, this.options.operationId());
        const source = await this.createDraftAlternative(owner, alternativeId, confirmed, alternative, {
          verify: typeof alternative === 'function' ? () => this.assertCurrent(owner, generation) : undefined,
        });
        if (!source) return null;
        const matchesGeneration = (basis: ResourceSnapshot) => {
          const birth = confirmed.value?.createdAt;
          const sameGeneration = confirmed.metadata
            ? basis.metadata?.generation === confirmed.metadata.generation
            : basis.metadata === null && typeof birth === 'string' && basis.value?.createdAt === birth;
          return sameGeneration && !basis.metadata?.deleted;
        };
        const matches = (basis: ResourceSnapshot, value: DocumentData | null) => {
          if (!matchesGeneration(basis) || !value) return false;
          try { return typeof alternative === 'function' && equalValues(alternative(copy(value)), value); } catch { return false; }
        };
        return {
          ...source,
          isStaged: async () => {
            active();
            const live = controller.getState().checkpoint.confirmed;
            if (typeof alternative !== 'function') {
              if (!matchesGeneration(live)) return false;
              try {
                await controller.assertPlanCellsStored({ [alternative.nodeId]: alternative.text });
                return true;
              } catch { return false; }
            }
            if (matches(live, live.value)) return true;
            const primary = await this.recoveryStore().read(owner, editorId);
            active();
            if (!primary) return false;
            const { checkpoint } = validateRecoveryRecord(primary, owner, editorId, frozen);
            return matches(checkpoint.confirmed, checkpoint.draft);
          },
        };
      };
      const holdPlanCellAlternative = (alternative: PlanCellAlternative): HeldPlanCellAlternative => {
        active();
        const reserve = entry.planCellEmergency?.hold(frozen.id, alternative.nodeId, alternative.text);
        let discarded = false;
        const held = holdAlternative(alternative).then(source => {
          if (source) reserve?.release();
          return { source, retained: Boolean(source) || (!discarded && Boolean(reserve?.preserve())) };
        }, error => {
          if (discarded) return { source: null, retained: false };
          if (!reserve?.preserve()) throw error;
          return { source: null, retained: true };
        });
        return {
          retained: held.then(answer => answer.retained),
          settle: async (keep, chosenWrite) => {
            active();
            if (!keep) {
              discarded = true;
              reserve?.release();
            } else {
              if (!chosenWrite) return;
              reserve?.followAdmittedCell();
            }
            const [{ source }] = await Promise.all([held, keep ? chosenWrite : undefined]);
            if (!source) return;
            // The explicit discard was admitted in this editor. Finish only
            // its exact device-local removal if the account has since changed.
            if (!keep) await this.discardRecoveryForOwner(source, owner, () => true);
            else if (await source.isStaged()) await this.discardRecovery(source);
          },
        };
      };

      const managed: ManagedEditor = {
        getState: () => {
          active();
          const state = controller.getState();
          const pendingIds = Object.keys(state.checkpoint.pending);
          // Directly owned legacy commands keep their existing terminal-journal proof.
          const legacy = isDirectLegacyDocumentIntent(pendingIds, state.preparedOperationId);
          const borrowedManualAnswers = Object.entries(state.checkpoint.pending).flatMap(([id, intent]) => {
            const request = this.commitRecords.get(id);
            if (!request || !['conflict', 'refused'].includes(request.state)) return [];
            const scope = intent.borrowedManualScope ?? reopenedManualAnswerScope(request, editorId,
              this.editorRequests.forResource(owner, frozen), this.commitRecords);
            return scope ? [scope] : [];
          });
          return { ...state, borrowedManualAnswers, savedIntentReplaceable: legacy ? undefined : !loadingBranchAnswer && !borrowedManualAnswers.length && controller.hasChoiceAuthority(state.checkpoint)
            && this.canReplaceOpenIntent(owner, editorId, pendingIds) };
        },
        getObservation: () => { active(); return copy(entry.observation); },
        getPresence: () => {
          active();
          const { checkpoint } = controller.getState();
          const pending = Object.keys(checkpoint.pending);
          const local = checkpoint.dirty || pending.length > 0;
          if (local && checkpoint.draft === null && checkpoint.confirmed.value !== null) {
            return { kind: 'deleting', source: 'local', snapshot: copy(checkpoint.confirmed) };
          }
          const heldCreation = pending.some(id => {
            const request = this.commitRecords.get(id);
            return request && request.owner === owner && sameResource(request.baseline.resource, frozen)
              && !['acknowledged', 'cancelled'].includes(request.state) && request.baseline.value === null
              && !request.baseline.metadata && request.value !== null;
          });
          if (checkpoint.draft !== null && checkpoint.confirmed.value === null && !checkpoint.confirmed.metadata
            && (heldCreation || creating && local)) {
            return { kind: 'creating', source: 'local', snapshot: { resource: copy(frozen), value: copy(checkpoint.draft), metadata: null } };
          }
          const accepted = [...this.editorRequests.forResource(owner, frozen).values()].flatMap(request =>
            request.owner === owner && request.result?.kind === 'acknowledged'
              && sameResource(request.result.snapshot.resource, frozen) ? [request.result.snapshot] : []);
          if (checkpoint.confirmed.value === null && checkpoint.confirmed.metadata?.deleted) accepted.push(checkpoint.confirmed);
          return copy(documentRecordPresence(frozen, entry.observation, undefined, accepted));
        },
        getDelivery: () => { active(); return copy(this.editorDelivery(entry, this.pendingByOperation)); },
        getSourceNoteLinkOpening: () => { active(); return sourceNoteLinkOpening(controller.getState().checkpoint, this.commitRecords); },
        getSermonPlanModeOpening: shown => {
          active();
          return sameResource(shown.confirmed.resource, frozen)
            ? sermonPlanModeOpening(shown, [...this.editorRequests.forResource(owner, frozen).values()]) : undefined;
        },
        getActions: () => {
          active();
          const requests = [...this.editorRequests.forResource(owner, frozen).values()];
          return requests.filter(request => request.atomic?.kind === COUNCIL_CARRY && request.id === request.atomic.id
            && sameResource(request.baseline.resource, frozen) && !['acknowledged', 'cancelled'].includes(request.state))
            .map(request => {
              const scope = this.requestsForChoice(owner, request.atomic!.participants);
              return { id: request.id, delivery: describeActionDelivery(owner, request.atomic!.participants, scope, this.journalForRequests(scope)) };
            });
        },
        carryCouncilTopicToNew: (topicId, title) => carryCouncilTopic(topicId, title),
        carryCouncilTopicToExisting: (topicId, destinationId) => carryCouncilTopic(topicId, '', destinationId),
        discardAction: async id => {
          active();
          const requests = await this.commits.list(); active();
          const request = requests.find(candidate => candidate.id === id && candidate.atomic?.kind === COUNCIL_CARRY
            && sameResource(candidate.baseline.resource, frozen));
          if (!request) throw new Error('Council action evidence changed');
          await controller.settled(); active();
          if (controller.needsPersistenceRetry()) await controller.retryPersistence(); active();
          await this.commits.cancelAction(request.atomic!.participants); this.assertCurrent(owner, generation);
          if (!entry.closed) await controller.settled();
          await this.commits.finishCancellation('', request.atomic!.participants); this.assertCurrent(owner, generation);
          await this.completeAcceptedProjections(owner, generation);
        },
        form: (slot, selection, recovery = 'same-slot') => { active(); return this.manualForm(owner, generation, frozen, editorId, entry, slot, selection, recovery); },
        subscribe: listener => {
          active();
          const subscription = () => listener();
          entry.listeners.add(subscription);
          return () => { entry.listeners.delete(subscription); };
        },
        edit: (value, shown, autosaveStamp) => {
          active();
          const persistence = controller.edit(value, shown, autosaveStamp);
          if (frozen.collection !== 'studyNotes' || autosaveStamp?.field !== 'content') return persistence;
          return persistence.then(async () => {
            if (await controller.shortenOversizedStudyNote() && this.current(owner, generation)) {
              this.prepareCommitsInBackground();
              this.backgroundDrain();
            }
          });
        },
        importLegacyStudyNote: edits => { active(); return controller.importLegacyStudyNote(edits); },
        editPlanCell: (opening, text, previous, isSourceStored) => {
          active();
          return controller.editPlanCell(opening, text, previous, isSourceStored);
        },
        editUnverifiedPlanCell: (nodeId, text, previous) => {
          active();
          return controller.editUnverifiedPlanCell(nodeId, text, previous);
        },
        backsUpPlanCell: (nodeId, text) => entry.planCellEmergency?.covers(nodeId, text) ?? false,
        bindPlanCellBackups: cells => { active(); return entry.planCellEmergency?.bind(cells) ?? []; },
        assertPlanCellsStored: cells => { active(); return controller.assertPlanCellsStored(cells); },
        holdDraftAlternative: holdAlternative,
        holdPlanCellAlternative,
        retainSermonOutlineReview: input => {
          active();
          const retaining = controller.retainSermonOutlineReview(input);
          if (retaining) return { location: 'active', durable: retaining };
          const { confirmed, pending } = controller.getState().checkpoint;
          if (!Object.keys(pending).length) return;
          // An earlier Save keeps its own editor and outcome. This comparison is independent work
          // and can be recovered after that Save, using the same device checkpoint store.
          const session = new DataSession(confirmed);
          if (!session.retainSermonOutlineReview(input)) return;
          const alternativeId = recoveryEditorIdentity(editorId, this.options.operationId());
          const draft = { owner, editorId: alternativeId, checkpoint: session.checkpoint(), prepared: null, unfinalized: [], autoSaveOnResume: false };
          const durable = this.retainLocal({
            address: { owner, kind: 'checkpoint', id: alternativeId, resource: frozen },
            persist: async () => { await this.persistDraftAlternative(draft, { reuse: true }); },
          }, generation);
          return { location: 'deferred', durable };
        },
        editOutlineTitle: (shown, opening, title, time) => { active(); return controller.editOutlineTitle(shown, opening, title, time); },
        commit: (updater, action) => commit(updater, undefined, undefined, action),
        commitWithReceipt: (updater, options) => withReceipt(captured => commit(updater, captured, options?.captureScope, options?.action, options?.noteContent)),
        removeWithReceipt: options => withReceipt(captured => remove(captured, options?.captureScope)),
        save: async () => { active(); await controller.save(); active(); this.backgroundDrain(); this.prepareCommitsInBackground(); active(); },
        savePlanCells: async nodeIds => {
          active();
          const checkpoint = controller.captureFieldSave();
          const planCellSaveIds = [...nodeIds];
          const saving = controller.save({ ...checkpoint, planCellSaveIds });
          pendingActionSaves.set(checkpoint.editGeneration, [{ checkpoint, planCellSaveIds }]);
          await saving;
          pendingActionSaves.delete(checkpoint.editGeneration);
          active();
          this.backgroundDrain();
          this.prepareCommitsInBackground();
        },
        stageServiceOrderInput: stageServiceInput,
        flushServiceOrderInputs: async filter => { active(); await entry.serviceOrderAutosave?.flush(filter); },
        saveServiceOrderInput: async (input, compared) => {
          active();
          if (compared || !input.version) {
            // An unversioned copy can resume against its unchanged opening. If we can see a
            // newer field now, ask before making a request instead of discovering it by refusal.
            const latest = await this.readWriteTarget(frozen).catch(() => null);
            active();
            if (latest) await controller.observe(latest, 'server');
            active();
          }
          await saveServiceOrderField(input, compared);
        },
        useStoredServiceOrderInput: async (input, compared) => {
          active();
          const latest = await this.readWriteTarget(frozen).catch(() => null);
          active();
          if (latest) await controller.observe(latest, 'server');
          active();
          await controller.useStoredServiceOrderInput(input, compared);
        },
        remove: () => remove(),
        acceptRemote: (expected, compared, titles) => choose('remote', expected, compared, undefined, titles),
        keepLocal: (expected, compared, choiceTime, titles) => choose('local', expected, compared, choiceTime, titles),
        dispose: () => {
          this.close(entry);
          if (this.editors.get(editorId) === entry) this.editors.delete(editorId);
        },
        close: ({ flush = false } = {}) => {
          if (entry.closed) return;
          const current = this.current(owner, generation);
          if (current) void entry.serviceOrderAutosave?.flush().catch(() => undefined);
          const leaving = flush && current ? this.leavingIntent(controller) : null;
          const actions = current ? [...pendingActionSaves.values()].flat().filter(intent => flush || intent.serviceOrderInput) : [];
          const record = leaving || actions.length ? this.closingRecord(controller) : null;
          const closingRequests: CommitRequest[] = [];
          // Register before closing. The local handoff outlives the controller and gates only
          // another opening of this resource, even if no checkpoint discovery has to read the queue.
          const saving = actions.length
            ? this.keepClosingActionSaves(owner, generation, editorId, controller.settled(), actions, record, closingRequests, leaving?.checkpoint)
            : leaving ? this.keepClosingSave(owner, generation, editorId, controller.settled(), leaving.checkpoint, record, closingRequests, leaving.predecessorId) : undefined;
          // With no request taking the last words along, retain the unwritten checkpoint.
          const unwritten = current && !leaving ? this.unwrittenRecord(controller) : null;
          const keeping = unwritten ? this.keepUnwritten(unwritten, owner, generation,
            Promise.allSettled([controller.settled(), saving]), frozen, closingRequests, entry.planCellEmergency) : undefined;
          const writing = saving && keeping ? Promise.all([saving, keeping]) : keeping ?? saving;
          this.close(entry, writing);
          if (this.editors.get(editorId) === entry) this.editors.delete(editorId);
        },
      };
      if (isRetirableOrdinaryEditor(editorId) && this.options.commits.activateOrdinaryEditor
        && this.options.commits.retireOrdinaryEditor) {
        await this.options.commits.activateOrdinaryEditor(owner, editorId);
        entry.retirement = { owner, generation, editorId, resource: frozen };
        if (entry.closed) this.retireOrdinaryEditor(entry, Promise.resolve());
        assertOpening();
      }
      this.backgroundDrain();
      return managed;
    } catch (error) {
      this.close(entry);
      if (this.editors.get(editorId) === entry) this.editors.delete(editorId);
      throw error;
    }
  }

  /** What a closing editor still owes the server: a savable draft no request has taken yet. */
  private leavingIntent(controller: EditorController): { checkpoint: SessionCheckpoint; predecessorId?: string } | null {
    let state: EditorState;
    try { state = controller.getState(); } catch { return null; }
    const { checkpoint } = state;
    const pending = Object.entries(checkpoint.pending);
    const unqueued = pending.every(([, request]) => request.generation < checkpoint.editGeneration);
    const waitsForPerson = checkpoint.conflicts.length > 0 || hasUnreadableDraftProof(checkpoint)
      || state.result?.kind === 'conflict' || state.result?.kind === 'refused'
      || Boolean(checkpoint.confirmed.metadata?.deleted)
      || (checkpoint.remoteCandidate !== null && checkpoint.remoteCandidate.value === null);
    if (!checkpoint.dirty || !unqueued || waitsForPerson) return null;
    const predecessorId = pending.sort((a, b) => b[1].generation - a[1].generation)[0]?.[0];
    return { checkpoint: JSON.parse(JSON.stringify(checkpoint)) as SessionCheckpoint, ...(predecessorId ? { predecessorId } : {}) };
  }

  /**
   * The record a closing Save pins in its checkpoint, guarded like `leavingIntent`: a controller retired a
   * moment ago has none to give, and its Save still goes — only without pinning the closed copy.
   */
  private closingRecord(controller: EditorController): EditorRecord | null {
    try { return controller.captureRecoveryChoice(); } catch { return null; }
  }

  /** A page being left writes its request and checkpoint and nothing more; the retention sweep waits for the next pass. */
  private keepClosingSave(owner: string, generation: number, editorId: string, settled: Promise<void>,
    checkpoint: SessionCheckpoint, record: EditorRecord | null, closingRequests: CommitRequest[], predecessorId?: string): Promise<void> {
    const capture = this.commits.admitSave(editorId, checkpoint);
    const project = record && ((request: CommitRequest) => reconcileRecoveryRecord(record, [request]));
    const pending = this.retainLocal({ address: { owner, kind: 'closing-save', id: editorId, resource: checkpoint.confirmed.resource },
      persist: async () => {
        // The latest words were frozen on exit. An earlier Save can still be finishing its local transaction.
        await settled.catch(() => undefined);
        const request = await capture({ ...(predecessorId && { predecessorId }), ...(project && { checkpoint: project }),
          followClosingCapture: true, deferRetention: true });
        if (request) {
          closingRequests.push(request);
          if (project && !this.options.commits.createWithCheckpoint) await this.options.checkpoints.put(project(request));
        } else if (record && checkpoint.planCellDrafts) await this.options.checkpoints.put(record);
      } }, generation);
    void pending.then(() => { if (this.current(owner, generation)) this.backgroundDrain(); }, () => undefined);
    return pending;
  }

  private keepClosingActionSaves(owner: string, generation: number, editorId: string, settled: Promise<void>,
    actions: readonly ClosingSaveIntent[], record: EditorRecord | null, closingRequests: CommitRequest[], trailing?: SessionCheckpoint): Promise<void> {
    const intents = new Map<number, ClosingSaveIntent>();
    for (const intent of actions) {
      const edit = intent.checkpoint.editGeneration;
      if (!intents.has(edit) || intent.action) intents.set(edit, intent);
    }
    if (trailing && !intents.has(trailing.editGeneration)) intents.set(trailing.editGeneration, { checkpoint: trailing });
    const ordered = [...intents.values()].sort((a, b) => a.checkpoint.editGeneration - b.checkpoint.editGeneration);
    const captures = ordered.map(({ checkpoint, action, planCellSaveIds, serviceOrderInput, serviceOrderComparison }) => {
      const predecessor = Object.entries(checkpoint.pending).sort((a, b) => b[1].generation - a[1].generation)[0]?.[0];
      return { capture: this.commits.admitSave(editorId, checkpoint), checkpoint, action, planCellSaveIds, serviceOrderInput, serviceOrderComparison, predecessor };
    });
    const pending = this.retainLocal({ address: { owner, kind: 'closing-save', id: editorId, resource: ordered[0].checkpoint.confirmed.resource },
      persist: async () => {
        await settled.catch(() => undefined);
        let previous: string | undefined;
        for (const { capture, checkpoint, action, planCellSaveIds, serviceOrderInput, serviceOrderComparison, predecessor } of captures) {
          const project = record && ((request: CommitRequest) => reconcileRecoveryRecord({ ...record, checkpoint }, [...closingRequests, request]));
          const retentionScope = action?.kind === 'sermon-plan-text' ? action.draftCaptureScope : undefined;
          const request = await capture({ predecessorId: previous ?? predecessor ?? null, ...(action && { action }),
            ...(planCellSaveIds && { planCellSaveIds }),
            ...(serviceOrderInput && { serviceOrderInput, serviceOrderComparison }),
            ...(retentionScope && { retentionScope }),
            ...(project && { checkpoint: project }), deferRetention: true }).catch(error => {
            if (error instanceof ServiceOrderInputDecisionError) return null;
            throw error;
          });
          if (request) {
            previous = request.id; closingRequests.push(request);
            if (project && !this.options.commits.createWithCheckpoint) await this.options.checkpoints.put(project(request));
          } else if (record && (checkpoint.planCellDrafts || checkpoint.serviceOrderInputs)) {
            await this.options.checkpoints.put(reconcileRecoveryRecord({ ...record, checkpoint }, closingRequests));
          }
        }
      } }, generation);
    void pending.then(() => { if (this.current(owner, generation)) this.backgroundDrain(); }, () => undefined);
    return pending;
  }

  /** Retiring a provider keeps explicit plan Saves ahead of their dependent removal. */
  private keepRetiringEditor(owner: string, generation: number, editorId: string, entry: EditorEntry): Promise<unknown> | undefined {
    const { controller } = entry;
    if (!controller || entry.closed) return undefined;
    void entry.serviceOrderAutosave?.flush().catch(() => undefined);
    const actions = [...entry.pendingActionSaves.values()].flat().filter(intent =>
      intent.action?.kind === 'sermon-plan-text' || intent.planCellSaveIds || intent.serviceOrderInput);
    const unwritten = this.unwrittenRecord(controller);
    if (!actions.length && !unwritten) return undefined;
    const settled = controller.settled(), requests: CommitRequest[] = [];
    const saving = actions.length
      ? this.keepClosingActionSaves(owner, generation, editorId, settled, actions, this.closingRecord(controller), requests)
      : undefined;
    const keeping = unwritten ? this.keepUnwritten(unwritten, owner, generation,
      saving ? Promise.allSettled([settled, saving]) : settled, undefined, requests, entry.planCellEmergency) : undefined;
    return saving && keeping ? Promise.all([saving, keeping]) : saving ?? keeping;
  }

  /** The checkpoint a closing editor has not written yet; a retired controller has none to give. */
  private unwrittenRecord(controller: EditorController): EditorRecord | null {
    try { return controller.unwrittenRecord(); } catch { return null; }
  }

  /** The old queue finishes before its immutable last checkpoint can repair the same identity. */
  private keepUnwritten(record: EditorRecord, owner: string, generation: number, pending: Promise<unknown>, about?: FailureAddress,
    closingRequests: readonly CommitRequest[] = [], planCellEmergency?: PlanCellEmergency): Promise<void> {
    return this.retainLocal({ address: { owner, kind: 'checkpoint', id: record.editorId, resource: record.checkpoint.confirmed.resource },
      persist: async () => {
        await pending.catch(() => undefined);
        const next = closingRequests.length ? reconcileRecoveryRecord(record, closingRequests) : record;
        await this.options.checkpoints.put(next);
        planCellEmergency?.stored(next.checkpoint);
      } }, generation, about);
  }

  private retainLocal(handoff: LocalWriteHandoff, generation: number, failureAddress?: FailureAddress): Promise<void> {
    const resource = failureAddress ?? handoff.address.resource ?? (handoff.address.kind === 'membership' ? { collection: 'series' } : undefined);
    const pending = this.localWriteback.write(handoff.address, () => resource ? about(resource, handoff.persist()) : handoff.persist());
    this.background(pending, handoff.address.owner, generation, resource);
    return pending;
  }

  private retireManual(manual: ManualFormEntry, generation: number, finishPending = false): void {
    manual.meetingSave?.cancel();
    const presence = manual.presence; manual.presence = null;
    if (manual.scope) {
      const pending = this.retainLocal(manual.scope.retire({ finishPending }), generation);
      presence?.releaseAfter(pending);
    } else presence?.releaseAfter(manual.opening ?? Promise.resolve());
  }

  private abortError(): Error {
    return Object.assign(new Error('Editor opening was cancelled'), { name: 'AbortError' });
  }

  private captureManual(parent: EditorEntry, owner: string, selection: readonly ManualPath[], checkpoint = parent.controller!.getState().checkpoint): ManualCapture {
    const pending = Object.entries(checkpoint.pending).sort((a, b) => b[1].generation - a[1].generation);
    const provenance = selection.flatMap(path => {
      const match = pending.find(([id]) => {
        const request = this.commitRecords.get(id);
        if (!request?.value || request.owner !== owner || request.state === 'cancelled'
          || !sameResource(request.baseline.resource, checkpoint.confirmed.resource)) return false;
        const predecessor = request.predecessor && this.commitRecords.get(request.predecessor);
        const ancestor = predecessor ? predecessor.value : request.initialized ? request.working.value : request.baseline.value;
        return ((!request.baseline.value && request.baseline.metadata === null) || !sameManualSelection(ancestor, request.value, path))
          && sameManualSelection(checkpoint.draft, request.value, path);
      });
      return match ? [{ path, requestId: match[0] }] : [];
    });
    return { checkpoint, provenance, requests: [...this.commitRecords.values()].filter(request => request.owner === owner && request.value)
      .map(request => ({ id: request.id, owner: request.owner, resource: request.baseline.resource, value: copy(request.value!), predecessorId: request.predecessor })) };
  }

  /** A retained conflict receipt is a real server copy even when a reopened cache is older. */
  private async observeManualChoice(parent: EditorEntry, owner: string, generation: number, predecessorId: string): Promise<void> {
    const request = this.commitRecords.get(predecessorId);
    const result = request?.state === 'cancelled' ? request.result : null;
    const snapshot = result && 'snapshot' in result ? result.snapshot : null;
    const controller = parent.controller;
    if (!snapshot || !controller || parent.closed || !sameResource(snapshot.resource, request!.baseline.resource)
      || !snapshotBelongsToOwner(owner, snapshot)) return;
    if (!storesNewCopy(controller.getState().checkpoint.confirmed, snapshot)) return;
    await controller.observe(snapshot, 'server'); this.assertCurrent(owner, generation);
  }

  private async resolveEditorChoice(parent: EditorEntry, owner: string, generation: number, choice: 'local' | 'remote', expected?: EditorRecord, choiceTime?: ActionTime | null, titles?: readonly OutlineTitleDecision[]): Promise<void> {
    const controller = parent.controller!;
    const checkpoint = controller.getState().checkpoint;
    const about = copy(checkpoint.confirmed.resource);
    const pending = checkpoint.pending;
    const preference = readAccountPreferenceComparison(checkpoint);
    const groupText = readGroupFlowTextChoice(checkpoint) || readCouncilSummaryChoice(checkpoint);
    const finalPrivateFieldChoice = readPrivateDocumentReview(checkpoint)?.remaining.length === 1;
    const meeting = checkpoint.confirmed.resource.collection === 'groups' && firstGroupMeetingReview(checkpoint.conflicts);
    const affected = [...this.manualForms.values()].filter(item => {
      if (item.parent !== parent || !item.scope) return false;
      const state = item.scope.getState();
      return (state.record.active || state.dirty) && Boolean(state.record.predecessor && pending[state.record.predecessor.id]);
    }).map(item => ({ item, scope: item.scope! }));
    let failure: unknown;
    try {
      if (expected && hasSermonOutlineReview(checkpoint)) {
        await controller.chooseSermonOutlineReview(choice, expected);
      } else if (choice === 'remote') {
        await controller.acceptRemote(undefined, expected, titles);
        const resolved = controller.getState().checkpoint;
        if ((preference || meeting || finalPrivateFieldChoice || (groupText && !checkpoint.groupTextReview) || resolved.sourceNoteLinkRetry || readOutlineTitleComparison(checkpoint) || readOutlineParentComparison(checkpoint) || (checkpoint.confirmed.resource.collection === 'sermons'
          && comparableSermonFields(checkpoint.conflicts))) && resolved.dirty && !resolved.groupTextReview) {
          await controller.save(); this.assertCurrent(owner, generation);
        }
      } else {
        await controller.keepLocal(undefined, undefined, expected, choiceTime, titles);
        // The explicit document choice owns its replacement; field stages keep their later words.
        const resolved = controller.getState().checkpoint;
        if (affected.length || meeting || (finalPrivateFieldChoice && resolved.dirty) || (readOutlineParentComparison(checkpoint) && resolved.dirty) || (groupText && resolved.dirty && !resolved.groupTextReview && !checkpoint.groupTextReview) || (preference && resolved.accountPreferenceRetry) || resolved.outlinePointPlacementRetry || resolved.groupFlowStepPlacementRetry || resolved.councilTopicPlacementRetry || resolved.sourceNoteLinkRetry) {
          await controller.save(); this.assertCurrent(owner, generation);
        }
      }
      this.prepareCommitsInBackground(); this.backgroundDrain();
    } catch (error) { failure = error; }
    const repairFields = async () => {
      this.assertCurrent(owner, generation);
      if (!parent.closed) {
        const requests = await this.commits.list(); this.assertCurrent(owner, generation);
        requests.forEach(request => this.rememberCommit(request));
        for (const { item, scope } of affected) {
          if (item.scope !== scope || ![...this.manualForms.values()].includes(item)) continue;
          await scope.settled().catch(() => undefined); this.assertCurrent(owner, generation);
          const predecessor = scope.getState().record.predecessor;
          if (predecessor && requests.some(request => request.id === predecessor.id && request.state === 'cancelled')) {
            await scope.continueAfterChoice(this.captureManual(parent, owner, item.selection), predecessor.id);
            item.emit();
          }
        }
      }
    };
    try {
      await repairFields();
    } catch (error) {
      if (failure) { if (this.current(owner, generation)) this.reportFailure(error, about); }
      else throw error;
    }
    if (failure) throw failure;
  }

  private manualForm(owner: string, generation: number, resource: ResourceRef, parentEditorId: string, parent: EditorEntry, slot: string, selection: readonly ManualPath[], recovery: ManualRecoveryPolicy): ManagedManualForm {
    if (!this.options.manualScopes) throw new Error('Manual form storage is not configured');
    const registryKey = JSON.stringify([parentEditorId, slot, recovery]);
    const previous = this.manualForms.get(registryKey);
    if (previous && previous.parent === parent) {
      if (!equalValues(previous.selection, selection)) throw new Error('Manual form selection changed');
      return previous.form;
    }
    selection = copy(selection);
    const store = this.options.manualScopes;
    const listeners = new Set<() => void>();
    const emit = () => { if (parent.closed || !this.current(owner, generation)) return; for (const listener of listeners) { try { listener(); } catch { /* Rendering cannot change staged intent. */ } } };
    const state: ManualFormEntry = { parent, selection: copy(selection), scopeId: manualScopeIdentity(parentEditorId, slot), scope: null as ManualScope | null, form: null as unknown as ManagedManualForm, emit, presence: null as RecoveryPresenceLease | null, opening: null as Promise<void> | null };
    this.manualForms.set(registryKey, state);
    let opening: Promise<void> | null = null;
    let requestedRecovery: { scope: ManualScope; generation: number } | undefined;
    const active = () => { this.assertCurrent(owner, generation); if (parent.closed || this.manualForms.get(registryKey) !== state) throw new Error('Manual parent editor changed'); };
    const intent = (request: CommitRequest): ManualSavedIntent => ({ id: request.id, owner: request.owner, resource: request.baseline.resource, value: copy(request.value!), predecessorId: request.predecessor });
    const capture = (): ManualCapture => { active(); return this.captureManual(parent, owner, selection); };
    const hasFailedDelivery = () => {
      const checkpoint = parent.controller!.getState().checkpoint;
      return Boolean(this.answerForOpenIntent(owner, resource, Object.keys(checkpoint.pending)));
    };
    const execute = (action: () => Promise<unknown>): Promise<void> => {
      active();
      const result = action(); emit();
      return result.then(() => { active(); emit(); }, error => { emit(); throw error; });
    };
    const start = (sourceScopeId?: string): Promise<void> => {
      active();
      if (opening) return opening;
      if (!sourceScopeId && state.scope?.getState().record.active) return state.scope.settled();
      // Keep what the user actually saw pinned while IndexedDB/provenance reads await.
      const pinned = copy(parent.controller!.getState().checkpoint);
      const readRecord = async (records: readonly CommitRequest[]) => {
        const source = sourceScopeId ? await store.read(owner, sourceScopeId) : undefined; active();
        if (sourceScopeId && !source?.record) throw Object.assign(new Error('Manual recovery record no longer exists'), { code: 'draft-gone' });
        if (source?.record && ((recovery === 'same-slot' && source.slot !== slot) || !sameResource(source.record.resource, resource) || !equalValues(source.record.selection, selection))) throw new Error('Manual recovery selection mismatch');
        let targetId = source ? manualScopeIdentity(parentEditorId, slot, this.options.operationId()) : state.scopeId;
        let existing = source ?? await store.read(owner, targetId); active();
        if (!source && existing && !existing.record && existing.discarded) {
          targetId = manualScopeIdentity(parentEditorId, slot, this.options.operationId());
          existing = undefined;
        }
        if (existing?.record) existing = { ...existing, record: reconcileManualCaptures(existing.record, records) };
        const saved = existing?.record?.predecessor;
        if (source && existing?.record && saved && equalValues(existing.record.stage, existing.record.savedSelection)
          && records.some(request => request.id === saved.id && request.state === 'cancelled')) {
          throw Object.assign(new Error('The shown saved copy changed'), { code: 'decision-changed' });
        }
        if (existing && !source && existing.parentEditorId !== parentEditorId) throw new Error('Manual form storage identity mismatch');
        const sourceVersion = source?.record && store.pinRecovery ? await store.pinRecovery(source) : null; active();
        if (source && store.pinRecovery && !sourceVersion) throw Object.assign(new Error('Manual recovery source changed before capture'), { code: 'decision-changed' });
        return { existing, targetId, source, sourceVersion };
      };
      const run = async (attempt = 0): Promise<void> => {
        this.retireManual(state, generation); state.scope = null;
        const checking = sourceScopeId && this.recoveryAvailability(owner, 'manual', sourceScopeId);
        if (checking) await checking;
        active();
        const presence = this.recoveryPresence.hold(owner, 'manual', [sourceScopeId ?? state.scopeId]);
        state.presence = presence;
        const repairing = this.localWriteback.retry(owner, address => address.kind === 'manual' && (address.id === state.scopeId || address.id === sourceScopeId));
        if (repairing) await repairing; active();
        const records = await this.commits.list(); active();
        records.forEach(request => this.rememberCommit(request));
        const { existing, targetId, source, sourceVersion } = await readRecord(records); active();
        if (existing?.record?.predecessor) { await this.observeManualChoice(parent, owner, generation, existing.record.predecessor.id); active(); }
        let creating = !existing || Boolean(source);
        const accepted = Object.entries(pinned.pending).sort((a, b) => a[1].generation - b[1].generation)
          .flatMap(([id]) => { const request = this.commitRecords.get(id); return request?.state === 'acknowledged' && request.result?.kind === 'acknowledged' ? [request] : []; });
        // Reconcile only work held by the original displayed copy, never a later parent render.
        const openingCheckpoint = reconcileRecoveryRecord({ owner, editorId: parentEditorId, checkpoint: pinned, prepared: null, unfinalized: [] }, accepted).checkpoint;
        const frozenCapture = this.captureManual(parent, owner, selection, openingCheckpoint);
        state.scopeId = targetId;
        presence.add([targetId, ...recoverySources(existing?.record?.recoverySources).map(source => source.id)]);
        let initializing = true;
        const port = {
          capture: () => frozenCapture,
          isCurrent: () => this.current(owner, generation)
            && (!initializing || (!parent.closed && this.manualForms.get(registryKey) === state)),
          isSettled: (id: string) => ['acknowledged', 'cancelled'].includes(this.commitRecords.get(id)?.state ?? ''),
          isCancelled: (id: string) => this.commitRecords.get(id)?.state === 'cancelled',
          persist: async (record: ReturnType<ManualScope['getState']>['record']) => {
            const envelope: StoredManualScope = { owner, scopeId: targetId, parentEditorId, slot, record, commitReferences: record.predecessor ? [record.predecessor.id] : [] };
            if (creating) {
              if (source && sourceVersion) await store.create(envelope, { id: source.scopeId, version: sourceVersion });
              else await store.create(envelope);
              creating = false;
            } else await store.put(envelope);
            if (!record.active) {
              await store.compact(owner, targetId);
              presence.releaseAfter(scope.settled());
            }
          },
          admitSave: (scopeId: string, checkpoint: SessionCheckpoint) => {
            active();
            const frozen = copy(checkpoint), admitted = this.commits.admitSave(scopeId, frozen);
            return async (submittedScope: string, submitted: SessionCheckpoint, options: ManualSaveOptions, onCaptured?: () => void) => {
              if (submittedScope !== scopeId || !equalValues(submitted, frozen)) throw new Error('Admitted manual Save changed its words');
              const request = await admitted(options);
              if (!request?.value) throw new Error('Manual Save did not create an intent');
              onCaptured?.();
              if (this.current(owner, generation)) {
                try { if (!parent.closed) await parent.controller!.adoptManualCommit(request, selection); }
                finally {
                  if (this.current(owner, generation)) { this.prepareCommitsInBackground(); this.backgroundDrain(); }
                }
              }
              return intent(request);
            };
          },
          save: async (scopeId: string, checkpoint: import('./session').SessionCheckpoint, options: ManualSaveOptions, onCaptured?: () => void) => {
            // Save was invoked while the form was active. Its captured intent belongs to the
            // owner even if navigation closes the page before earlier local writes finish.
            this.assertCurrent(owner, generation);
            const request = await this.commits.save(scopeId, checkpoint, options);
            this.assertCurrent(owner, generation);
            if (!request || !request.value) throw new Error('Manual Save did not create an intent');
            onCaptured?.();
            if (!parent.closed) await parent.controller!.adoptManualCommit(request, selection);
            this.assertCurrent(owner, generation);
            this.prepareCommitsInBackground(); this.backgroundDrain();
            return intent(request);
          },
        };
        const options = { owner, resource, scopeId: targetId, selection, port };
        const scope = existing?.record ? ManualScope.restore(options, recoverManualScopeRecord(existing.record, targetId,
          source ? { id: sourceScopeId!, version: sourceVersion } : undefined)) : ManualScope.begin(options, existing ? existing.watermark.generation + 1 : 0);
        try {
          if (existing?.record) {
            const restarting = !source && !existing.record.active && equalValues(existing.record.stage, existing.record.savedSelection)
              && (!existing.record.predecessor || port.isSettled(existing.record.predecessor.id));
            await (restarting ? scope.restart() : scope.reopen());
            const stage = scope.getState();
            const predecessor = stage.record.predecessor;
            if (predecessor && port.isCancelled(predecessor.id)) await scope.continueAfterChoice(capture(), predecessor.id);
            else if (!source && shouldFollowReopenedManualStage(stage, frozenCapture)) await scope.follow(frozenCapture);
          } else await scope.settled();
          active();
        } catch (error) {
          scope.dispose();
          if (!existing?.record && (error as { code?: string } | null)?.code === 'commit-reference-changed' && attempt < 2) {
            active(); return run(attempt + 1);
          }
          throw error;
        }
        initializing = false;
        state.scope = scope;
        requestedRecovery = sourceScopeId ? { scope, generation: scope.getState().record.generation } : undefined;
        if (sourceScopeId) this.emit(parent); else emit();
      };
      opening = run().catch(error => { state.presence?.release(); state.presence = null; throw error; }).finally(() => { opening = null; state.opening = null; });
      state.opening = opening;
      return opening;
    };
    const requireScope = () => { active(); if (!state.scope) throw new Error('Open the manual form before editing'); return state.scope; };
    const exactRequest = (stage: ReturnType<ManualScope['getState']> | undefined, checkpoint: SessionCheckpoint) =>
      exactManualRequest(stage, checkpoint, this.editorRequests.forResource(owner, resource));
    const finishExactChoice = async (choice: 'local' | 'remote', scope: ManualScope, request: CommitRequest,
      updating: Promise<void> | undefined, assertComparison: () => void, action?: EditorCommitAction, titles?: readonly OutlineTitleDecision[]) => {
        await updating; active(); assertComparison();
        const controller = parent.controller!;
        const shown = scope.getState();
        const checkpoint = controller.getState().checkpoint;
        const comparison = manualComparison(shown, checkpoint, this.commitRecords, request);
        const stored = comparison?.stored ?? checkpoint.remoteCandidate ?? checkpoint.confirmed;
        const predecessor = shown.record.predecessor;
        const privateStage = shown.dirty && predecessor && predecessor.id !== request.id
          ? { scopeId: shown.record.scopeId, generation: shown.record.generation, predecessorId: predecessor.id, base: predecessor.value, value: shown.value }
          : undefined;
        await controller.resolveExactManualChoice({ choice, titles, request, stored, value: exactManualWords(shown, request), selection, privateStage,
          choiceTime: action?.kind === 'document-metadata' ? action.time : undefined }, () => {
          active(); assertComparison();
          const current = scope.getState();
          const reviewed = exactRequest(current, controller.getState().checkpoint);
          if (!current.durable || reviewed?.id !== request.id || reviewed.revision !== request.revision
            || current.record.generation !== shown.record.generation || !equalValues(current.value, shown.value)) throw Object.assign(new Error('The shown saved copy changed'), { code: 'decision-changed' });
        });
        active();
        if (choice === 'local' || controller.getState().checkpoint.dirty) {
          const positionReview = request.result?.kind === 'conflict' ? reviewedHomileticList(
            request.result.conflicts.filter(conflict => conflict.code === HOMILETIC_POSITION_REVIEW || conflict.code === HOMILETIC_POSITION_PROJECTION), selection) : undefined;
          const keepSeriesDescription = stored.resource.collection === 'series' && comparison
            && seriesTextChoiceFields(comparison.conflictPaths, comparison.mine, stored.value)?.includes('description');
          const comparedSeries = comparison?.returnedSeriesFields;
          const settled = controller.getState().checkpoint.draft;
          const field = comparison?.kind === 'returned-sermon-title' ? 'title'
            : comparison?.kind === 'returned-sermon-verse' ? 'verse' : comparison?.kind === 'sermon-church' ? 'church'
              : comparison?.preparationField;
          const checkedAction: EditorCommitAction | undefined = field ? {
            kind: 'document-metadata', time: action?.kind === 'document-metadata' ? action.time : null,
            sermonMetadataReview: {
              field,
              title: field !== 'title' ? earlierSermonMetadataProof(request.sermonTitleAction, settled?.title) : undefined,
              verse: field !== 'verse' ? earlierSermonMetadataProof(request.sermonVerseAction, settled?.verse) : undefined,
              church: field !== 'church' ? earlierSermonMetadataProof(request.sermonChurchAction, readField(settled ?? {}, ['church'])) : undefined,
              date: earlierSermonDateProof(request, settled, stored),
            },
          } : positionReview ? {
            kind: 'document-metadata', time: action?.kind === 'document-metadata' ? action.time : null,
            homileticPositionReview: positionReview,
          } : comparedSeries ? {
            kind: 'document-metadata', time: action?.kind === 'document-metadata' ? action.time : null,
            seriesFieldReview: { fields: comparedSeries, original: request.seriesFieldActions ?? {} },
          } : choice === 'remote' && keepSeriesDescription ? { kind: 'document-metadata', time: null } : action;
          const reviewScope = field && field !== 'title' ? shown.record.scopeId : undefined;
          await controller.save(undefined, selection, undefined, reviewScope, checkedAction); active();
          this.prepareCommitsInBackground(); this.backgroundDrain();
        }
        const latest = scope.getState();
        if (latest.dirty && latest.record.generation !== shown.record.generation) {
          await scope.suspend();
          return;
        }
        await scope.cancel(); active();
        if (shown.record.active && controller.getState().checkpoint.draft) await start();
    };
    // Admission and capture stay above; this continuation owns the queued parent decision.
    const finishChoice = async (choice: 'local' | 'remote', scope: ManualScope | null,
      staged: ReturnType<ManualScope['getState']> | undefined, updating: Promise<void> | undefined,
      assertComparison: () => void, checked: boolean, action?: EditorCommitAction, titles?: readonly OutlineTitleDecision[]) => {
        const amendment = staged?.dirty ? { base: staged.record.predecessor?.value ?? staged.record.baseline.value!, value: staged.value } : undefined;
        const comparison = checked ? state.form.getState()?.comparison : undefined;
        const comparedRequest = comparison ? this.commitRecords.get(comparison.requestId) : undefined;
        parent.controller!.assertManualResolution(selection);
        // Freeze the form before awaiting retirement; amended input keeps a durable recovery copy.
        if (scope) await Promise.all([updating, amendment ? scope.suspend() : scope.cancel()]);
        active(); assertComparison();
        if (staged?.choiceRequired) { await this.observeManualChoice(parent, owner, generation, staged.record.predecessor!.id); active(); assertComparison(); }
        const expectedParent = checked ? parent.controller!.captureRecoveryChoice() : undefined;
        if (choice === 'remote') {
          const controller = parent.controller!;
          const shown = controller.getState().checkpoint;
          const meeting = shown.confirmed.resource.collection === 'groups' && firstGroupMeetingReview(shown.conflicts);
          await controller.acceptRemote(selection, expectedParent, titles); active();
          if ((meeting || readOutlineParentComparison(shown)) && controller.getState().checkpoint.dirty) {
            await controller.save(undefined, selection); active();
            this.prepareCommitsInBackground(); this.backgroundDrain();
          } else if (manualSeriesTextChoiceFields(shown.confirmed, shown.remoteCandidate, shown.conflicts, selection, shown.draft)) {
            this.prepareCommitsInBackground(); this.backgroundDrain();
          }
          if (amendment && scope) await scope.cancel();
        } else {
          const controller = parent.controller!;
          const conflicts = controller.getState().checkpoint.conflicts;
          const choiceTime = action?.kind === 'document-metadata'
            && (conflicts.some(unresolvedPreachDateField) || firstGroupMeetingReview(conflicts)) ? action.time : undefined;
          await controller.keepLocal(selection, amendment, expectedParent, choiceTime, titles); active();
          const seriesFields = comparison?.returnedSeriesFields;
          const reviewedAction = seriesFields && action?.kind === 'document-metadata'
            ? { ...action, seriesFieldReview: { fields: seriesFields, original: comparedRequest?.seriesFieldActions ?? {} } } : action;
          await controller.save(undefined, selection, undefined, undefined, reviewedAction); active();
          // Only the durable replacement request may retire the suspended correction copy.
          if (amendment && scope) await scope.cancel();
          this.prepareCommitsInBackground(); this.backgroundDrain();
        }
        active();
        // Reopen from the resolved document, never from the retired form's displayed values.
        if (parent.controller!.getState().checkpoint.draft) await start();
    };
    if (resource.collection === 'groups' && slot === GROUP_MEETING_SLOT) {
      state.meetingSave = debounce(() => {
        const scope = state.scope;
        if (!scope || parent.closed || !this.current(owner, generation)) return;
        const stage = scope.getState();
        if (!scope.meetingAutosaveReady() || stage.choiceRequired || hasFailedDelivery()) return;
        const saving = execute(async () => {
          await scope.save();
          if (!scope.getState().dirty && !parent.closed) await scope.cancel();
        });
        void saving.catch(error => {
          if (!parent.closed && this.current(owner, generation)) this.reportFailure(error, resource);
        });
      }, GROUP_MEETING_SAVE_DELAY);
    }
    state.form = {
      getState: () => {
        active();
        const form = state.scope?.getState();
        if (!form) return null;
        const controller = parent.controller!;
        const checkpoint = controller.getState().checkpoint;
        const request = exactRequest(form, checkpoint);
        const exact = request && this.canReplaceOpenIntent(owner, '', [request.id]);
        const pendingIds = Object.keys(checkpoint.pending);
        const documentChoiceRequired = !exact && hasBranchedOrdinaryAnswer(pendingIds, this.requestsForChoice(owner, pendingIds));
        return { ...form, ...(exact ? { exactChoice: true as const } : {}),
          ...(form.record.active && requestedRecovery?.scope === state.scope && requestedRecovery.generation === form.record.generation
            && { requestedRecovery: true as const }),
          ...(documentChoiceRequired ? { documentChoiceRequired: true as const } : {}),
          comparison: exact || ((!documentChoiceRequired || form.choiceRequired) && controller.hasChoiceAuthority(checkpoint))
            ? manualComparison(form, checkpoint, this.commitRecords, exact ? request : undefined) : undefined };
      },
      subscribe: listener => { active(); listeners.add(listener); return () => { listeners.delete(listener); }; },
      begin: () => start(),
      follow: () => execute(() => requireScope().follow(capture())),
      update: (updater, fieldInput, autosaveGroupMeeting) => execute(() => {
        if (autosaveGroupMeeting && !state.meetingSave) throw new Error('Meeting autosave requires its own form');
        const scope = requireScope();
        const staged = scope.update(updater, fieldInput, autosaveGroupMeeting);
        if (autosaveGroupMeeting) {
          if (scope.meetingAutosaveReady()) state.meetingSave?.();
          else state.meetingSave?.cancel();
        }
        return staged;
      }),
      propose: (producer, signal) => execute(() => requireScope().propose(async source => {
        const proposed = await producer(source); active(); return proposed;
      }, signal)),
      save: (updater, action, onCaptured) => execute(async () => {
        if (hasFailedDelivery()) {
          throw Object.assign(new Error('Resolve the failed delivery with Keep local or Accept remote before saving'), { code: 'resolve-version-first' });
        }
        const scope = requireScope();
        const fieldInput = action && 'field' in action ? action : undefined;
        const status = action && 'preachStatus' in action ? action.preachStatus : undefined;
        const metadata = action && 'documentMetadata' in action ? action.documentMetadata : undefined;
        const dateInput = metadata?.dateAction ?? (status?.rowId && status.time ? { rowId: status.rowId, time: status.time }
          : action && 'rowId' in action && !('field' in action) ? action : undefined);
        if (updater) {
          const staged = scope.update(updater, fieldInput);
          const saving = scope.save(dateInput, status, metadata?.time, metadata, onCaptured);
          await Promise.all([staged, saving]);
        } else await scope.save(dateInput, status, metadata?.time, metadata, onCaptured);
        if (!scope.getState().dirty) await scope.cancel();
      }),
      cancel: () => execute(async () => {
        state.meetingSave?.cancel();
        const scope = requireScope();
        const privateStage = scope.getState().dirty;
        await scope.cancel(); active();
        if (privateStage && this.visible) await this.followEditorOnReturn(parent, owner, generation);
      }),
      retry: () => execute(async () => { if (state.scope) await state.scope.retryPersistence(); else await start(); await this.retry(resource); }),
      resolve: (choice, options) => execute(async () => {
        const expected = options?.expectedComparison;
        let expectedIdentity = expected?.identity;
        const assertComparison = () => {
          assertManualComparison(expectedIdentity, state.form.getState()?.comparison);
        };
        assertComparison();
        const scope = state.scope;
        const initial = scope?.getState();
        assertDurableManualChoice(initial);
        if (initial?.record.predecessor) {
          const requests = await this.commits.list(); active();
          requests.forEach(request => this.rememberCommit(request));
          assertComparison();
        }
        const checkpoint = parent.controller!.getState().checkpoint;
        const exact = exactRequest(initial, checkpoint);
        if (exact && (expected?.kind === 'returned-sermon-verse' || expected?.kind === 'sermon-church' || expected?.preparationField)) {
          const saved = await this.readWriteTarget(resource).catch(() => null);
          active(); assertComparison();
          if (!saved || !canReplaceSnapshot(expected.stored, saved)) {
            throw Object.assign(new Error('Read the current sermon before choosing'), { code: 'fresh-read-required' });
          }
          if (!equalValues(expected.stored, saved)) {
            await parent.controller!.observe(saved, 'server');
            throw Object.assign(new Error('The shown field comparison changed'), { code: 'decision-changed' });
          }
        }
        if (!exact && (choice === 'local' || !initial?.choiceRequired)) {
          requireDocumentChoiceForBranch(Object.keys(checkpoint.pending), [...this.commitRecords.values()]);
        }
        if (!exact && !initial?.choiceRequired) parent.controller!.assertChoiceAuthority();
        const updating = choice === 'local' && options?.updater && scope ? scope.update(options.updater) : undefined;
        // Normalization is synchronous; later input is checked against this exact chosen stage.
        if (updating && expected) expectedIdentity = state.form.getState()?.comparison?.identity;
        const staged = scope?.getState();
        const failed = hasFailedDelivery();
        const discardStage = choice === 'remote' && options?.discardStage && Boolean(state.form.getState()?.comparison);
        const retainsReviewedStage = exact && Boolean(options?.titles?.length) && Boolean(expected?.outlineParent);
        if (!retainsReviewedStage) assertManualChoiceInput(staged, choice, failed, Boolean(discardStage));
        // The parent already made its decision. Taking those words now discards only this
        // remaining stage; it must not cancel a newer parent request or repeat its decision.
        if (choice === 'remote' && staged?.choiceRequired && scope) {
          if (options?.titles?.length) throw Object.assign(new Error('Finish the saved outline review first'), { code: 'other-changes-first' });
          await scope.suspend(); active(); assertComparison();
          await this.observeManualChoice(parent, owner, generation, staged.record.predecessor!.id); active(); assertComparison();
          await scope.cancel(); active();
          if (parent.controller!.getState().checkpoint.draft) await start();
          return;
        }
        const time = options?.metadataTime;
        const action = choice === 'local' && time !== undefined ? { kind: 'document-metadata', time } as const : undefined;
        if (exact && scope) await finishExactChoice(choice, scope, exact, updating, assertComparison, action, options?.titles);
        else await finishChoice(choice, scope, staged, updating, assertComparison, Boolean(expected), action, options?.titles);
      }),
      listRecoverable: async () => {
        active();
        const repairing = this.localWriteback.retry(owner, address => address.kind === 'manual' && Boolean(address.resource && sameResource(address.resource, resource)));
        if (repairing) await repairing; active();
        const values = await store.list(owner, resource);
        const requests = await this.commits.list(); active();
        const byId = new Map(requests.map(request => [request.id, request]));
        const candidates = values.filter(value => {
          if (value.scopeId === state.scopeId || (recovery !== 'same-selection' && value.slot !== slot)
            || !equalValues(value.record.selection, selection)) return false;
          const record = value.record;
          if (!equalValues(record.stage, record.savedSelection)) return true;
          if (!record.predecessor) return false;
          const request = byId.get(record.predecessor.id);
          if (request && ['acknowledged', 'cancelled'].includes(request.state)) return false;
          const source = request && readManualScopeIdentity(request.editorId);
          return record.savedGeneration !== null || Boolean(record.recoverySources?.length) || !source
            || !areDifferentTabManualParents(source.parentEditorId, value.parentEditorId, resource);
        });
        const choices = await this.recoveryChoices(owner, generation, 'manual', candidates, value => value.scopeId);
        active(); return choices;
      },
      discardRecovery: async source => {
        active();
        if (source.owner !== owner || !sameResource(source.record.resource, resource)
          || !equalValues(source.record.selection, selection) || (recovery === 'same-slot' && source.slot !== slot)) throw new Error('Manual recovery selection changed');
        await this.requireClosedRecovery(owner, generation, 'manual', source.scopeId); active();
        if (!store.discardRecovery) throw new Error(RECOVERY_REMOVAL_UNAVAILABLE);
        await store.discardRecovery(copy(source), () => this.current(owner, generation)
          && !parent.closed && this.manualForms.get(registryKey) === state);
        active();
      },
      recover: sourceScopeId => start(sourceScopeId),
    };
    return state.form;
  }

  private onRuntime(event: RuntimeEvent): void {
    if (this.disposed || event.owner !== this.owner) return;
    if (event.kind === 'journal') {
      this.publishPending(event.entries);
      this.scheduleRedelivery(event.entries);
    } else if (event.result.kind === 'acknowledged') {
      if (event.result.snapshot.resource.collection === 'studyNoteShareLinks') this.background(
        this.completeCapabilityProjection(event.result, event.owner, this.generation), event.owner, this.generation, event.result.snapshot.resource);
      this.background(this.refreshAcknowledged(event.result.operationId, event.result.snapshot, event.owner, this.generation), event.owner, this.generation, event.result.snapshot.resource);
      if (this.options.collections) this.background(this.refreshAcknowledgedCollections(event.result.operationId,
        [event.result.snapshot.resource.collection, ...(event.result.affected ?? []).map(effect => effect.resource.collection)],
        event.owner, this.generation), event.owner, this.generation, { collection: event.result.snapshot.resource.collection });
    }
  }

  private collectionReader(): CollectionReader {
    if (!this.options.collections) throw new Error('Collection reads are not configured');
    return this.options.collections;
  }

  private async refreshAcknowledgedCollections(operationId: string, collections: string[], owner: string, generation: number): Promise<void> {
    await Promise.resolve();
    if (!this.current(owner, generation) || !this.canRead() || this.refreshedCollectionOperations.has(operationId)) return;
    this.refreshedCollectionOperations.add(operationId);
    if (this.refreshedCollectionOperations.size > 256) this.refreshedCollectionOperations.delete(this.refreshedCollectionOperations.values().next().value!);
    // ResourceObserver refreshes only registered interests; unopened lists cost no read.
    await Promise.all([...new Set(collections)].map(collection => this.options.observer.refresh(collectionHeadRef(owner, collection))));
  }

  private publishPending(entries: JournalEntry[], force = false): void {
    this.pendingVersion += 1;
    const next = copy(entries.filter(entry => entry.command.owner === this.owner));
    if (!force && equalValues(next, this.pending)) return;
    const nextByOperation = new OpenEditorJournal(next);
    const changed = [...this.editors.values()].filter(entry => !entry.closed && entry.controller
      && !equalValues(this.editorDelivery(entry, this.pendingByOperation), this.editorDelivery(entry, nextByOperation)));
    this.pending = next;
    this.pendingByOperation = nextByOperation;
    for (const listener of this.pendingListeners) {
      try { listener(); } catch { /* Rendering never changes delivery state. */ }
    }
    changed.forEach(entry => this.emit(entry));
    this.publishOpenAnswers();
  }

  private editorDelivery(entry: EditorEntry, journal: OpenEditorJournal): JournalEntry[] {
    if (entry.closed || !entry.controller) return [];
    const checkpoint = entry.controller.getState().checkpoint;
    const operations = new Set(Object.keys(checkpoint.pending));
    const atomicOperations = new Set<string>();
    for (const id of Object.keys(checkpoint.pending)) {
      const request = this.commitRecords.get(id);
      if (request?.command) operations.add(request.command.operationId);
      if (request?.atomic) { operations.add(request.atomic.id); atomicOperations.add(request.atomic.id); }
    }
    return journal.forOperations(operations).filter(item =>
      sameResource(checkpoint.confirmed.resource, item.command.resource) || atomicOperations.has(item.command.operationId));
  }

  private async refreshAcknowledged(operationId: string, snapshot: ResourceSnapshot, owner: string, generation: number): Promise<void> {
    // Let every runtime subscriber enqueue its accepted projection before checking it.
    await Promise.resolve();
    if (!this.current(owner, generation) || this.refreshedOperations.has(operationId)) return;
    const affected = [...this.editors.values()].filter(entry => !entry.closed && entry.controller
      && sameResource(entry.controller.getState().checkpoint.confirmed.resource, snapshot.resource));
    if (!affected.length) return;
    await Promise.all(affected.map(entry => entry.controller!.settled()));
    if (!this.current(owner, generation) || !this.canRead() || this.refreshedOperations.has(operationId)
      || !affected.some(entry => !entry.closed && entry.stopObservation)) return;
    this.refreshedOperations.add(operationId);
    // The bounded set prevents duplicate receipt replays from adding another read loop.
    if (this.refreshedOperations.size > 256) this.refreshedOperations.delete(this.refreshedOperations.values().next().value!);
    // A live listener that already proved this revision needs no extra billed read.
    if (affected.every(entry => entry.observation.readiness === 'server' && entry.observation.snapshot
      && canReplaceSnapshot(snapshot, entry.observation.snapshot))) return;
    await this.options.observer.refresh(snapshot.resource);
  }

  private async openingSnapshot(owner: string, generation: number, resource: ResourceRef, editorId: string): Promise<ResourceSnapshot> {
    try {
      return await this.read(resource);
    } catch (error) {
      this.assertCurrent(owner, generation);
      const saved = await this.options.checkpoints.read(owner, editorId);
      this.assertCurrent(owner, generation);
      if (!saved) throw error;
      if (!sameResource(saved.checkpoint.confirmed.resource, resource)) throw new Error('Checkpoint identity mismatch');
      // Controller.open owns restoration and independently validates the full identity.
      this.options.onError?.(error, resource);
      return saved.checkpoint.confirmed;
    }
  }

  private persistSnapshot(owner: string, generation: number, snapshot: ResourceSnapshot): Promise<ResourceSnapshot> {
    const frozen = copy(snapshot);
    const key = cacheKey(owner, frozen.resource);
    const operation = (this.cacheWrites.get(key)?.operation ?? Promise.resolve()).catch(() => undefined).then(async () => {
      this.assertCurrent(owner, generation);
      const current = await this.options.snapshots.read(owner, frozen.resource);
      this.assertCurrent(owner, generation);
      if (current && !sameResource(current.resource, frozen.resource)) throw new Error(CACHED_IDENTITY_MISMATCH);
      if (!canReplaceSnapshot(current, frozen)) return current!;
      if (storesNewCopy(current, frozen)) await this.options.snapshots.put(owner, frozen);
      this.assertCurrent(owner, generation);
      return frozen;
    });
    this.cacheWrites.set(key, { owner, generation, resource: frozen.resource, operation });
    void operation.finally(() => {
      if (this.cacheWrites.get(key)?.operation === operation) this.cacheWrites.delete(key);
    }).catch(() => undefined);
    return operation;
  }

  private retireOrdinaryEditor(entry: EditorEntry, settled: Promise<unknown>, writeback?: Promise<unknown>): void {
    const retirement = entry.retirement;
    if (!retirement) return;
    entry.retirement = undefined;
    const { owner, generation, editorId, resource } = retirement;
    // A failed closing write remains retryable. Retire only after its original owner can finish it.
    const completed = writeback?.then(() => true, () => false);
    void settled.then(() => this.retainLocal({
      address: { owner, kind: 'editor-retirement', id: editorId, resource },
      persist: async () => {
        if (completed && !await completed) {
          await this.localWriteback.retry(owner, address => address.id === editorId
            && (address.kind === 'checkpoint' || address.kind === 'closing-save'));
        }
        await this.options.commits.retireOrdinaryEditor!(owner, editorId);
      },
    }, generation)).catch(() => undefined);
  }

  private close(entry: EditorEntry, writeback?: Promise<unknown>): void {
    if (entry.closed) return;
    entry.planCellEmergency?.preserve();
    entry.serviceOrderInputReserve?.preserve();
    entry.serviceOrderAutosave?.dispose();
    for (const form of this.manualForms.values()) if (form.parent === entry) form.meetingSave?.flush();
    entry.closed = true;
    const settled = Promise.allSettled([entry.initializing, entry.controller?.settled()]);
    entry.presence.releaseAfter(Promise.allSettled([settled, writeback]));
    this.retireOrdinaryEditor(entry, settled, writeback);
    for (const [key, manual] of this.manualForms) if (manual.parent === entry) {
      this.retireManual(manual, this.generation, this.owner !== null);
      this.manualForms.delete(key);
    }
    entry.stopObservation?.();
    entry.stopObservation = null;
    entry.stopController?.();
    entry.stopController = null;
    entry.controller?.dispose();
    entry.controller = null;
    entry.listeners.clear();
    this.publishOpenAnswers();
  }

  private emitMembership(): void {
    for (const listener of this.membershipListeners) { try { listener(); } catch { /* UI does not own persistence. */ } }
  }

  private emit(entry: EditorEntry): void {
    for (const listener of entry.listeners) {
      try { listener(); } catch { /* UI rendering never changes data delivery. */ }
    }
    for (const manual of this.manualForms.values()) if (manual.parent === entry) manual.emit();
    this.publishOpenAnswers();
  }

  private backgroundDrain(): void {
    if (this.disposed || !this.owner) return;
    this.background(this.retry(), this.owner, this.generation);
  }

  private prepareCommitsInBackground(): void {
    if (this.disposed || !this.owner) return;
    // Capture is already durable. The shared runner may join or be upgraded to
    // delivery, so completion here must never wait for its network acknowledgement.
    // Preparation failures stay visible and retryable through the existing owner scope.
    const finishCollection = this.options.deferCommitCollection?.(this.owner);
    this.background(this.commits.drain(false).finally(() => finishCollection?.()), this.owner, this.generation);
  }

  /**
   * A delivery left unanswered (a weak signal cut its request) is sent again by itself, after a
   * growing pause (`unanswered.ts`): before, it waited for the next edit, a return to the tab or the
   * network coming back. Offline or hidden, nothing is sent; coming back online or into view drains
   * at once (`setOnline`, `setVisible`), and the journal that follows schedules the next pause.
   */
  private scheduleRedelivery(entries: readonly JournalEntry[]): void {
    const unanswered = entries.filter(entry => entry.state === 'unknown');
    if (!unanswered.length) {
      this.stopRedelivery();
      return;
    }
    // The journal is published more than once around a send, and a copy made before it can arrive after
    // it: the pause follows the most attempts seen, and an outdated count never shortens it.
    const attempts = Math.max(...unanswered.map(entry => entry.attempts));
    if (this.redeliveryTimer !== null && attempts <= this.redeliveryAttempts) return;
    this.stopRedelivery();
    this.redeliveryAttempts = attempts;
    this.redeliveryTimer = setTimeout(() => {
      this.redeliveryTimer = null;
      if (this.online && this.visible) this.backgroundDrain();
    }, redeliveryDelay(attempts));
  }

  private stopRedelivery(): void {
    if (this.redeliveryTimer !== null) clearTimeout(this.redeliveryTimer);
    this.redeliveryTimer = null;
    this.redeliveryAttempts = 0;
  }

  private background(operation: Promise<unknown>, owner: string, generation: number, about?: FailureAddress): void {
    void operation.catch(error => { if (this.current(owner, generation)) this.reportFailure(error, about); });
  }

  /** Say each failure once, with what it was about; a list gathered from many operations is said entry by entry. */
  reportFailure(error: unknown, about?: FailureAddress): void {
    for (const failure of eachFailure(error, about)) {
      // Editor queues can settle after normal form closure. Keep real I/O failures visible.
      if (failure.error instanceof InactiveEditorError) continue;
      if (failure.about) this.options.onError?.(failure.error, failure.about);
      else this.options.onError?.(failure.error);
    }
  }

  /**
   * Whether this tab may SEND the person's own edits: a signed-in owner and a network. A hidden
   * page sends too — the phone whose screen went dark must not hold the last words away from the
   * computer (BUG-20261006-hidden-tab-holds-last-edit).
   */
  private canSend(): boolean {
    return !this.disposed && this.owner !== null && this.online;
  }

  /** Whether this tab may ask the server to READ: only while someone can see it (the read budget). */
  private canRead(): boolean {
    return this.canSend() && this.visible;
  }

  private requireOwner(): string {
    if (this.disposed) throw new Error(ENGINE_DISPOSED);
    if (!this.owner) throw new Error('Authentication required');
    return this.owner;
  }

  private current(owner: string, generation: number): boolean {
    return !this.disposed && owner === this.owner && generation === this.generation;
  }

  private assertCurrent(owner: string, generation: number): void {
    if (!this.current(owner, generation)) throw new Error('Account changed');
  }

  private validateResource(resource: ResourceRef, owner: string): void {
    const policy = getResourcePolicy(resource.collection);
    if (!isValidIdentifier(resource.id)) throw new Error('Invalid resource identifier');
    if (policy.ownerField === 'id' && resource.id !== owner) throw new Error('Owner identity mismatch');
  }
}
