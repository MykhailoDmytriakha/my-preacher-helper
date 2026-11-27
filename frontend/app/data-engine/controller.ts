import { failureCode } from '@/utils/failureCode';
import { projectServiceOrderStep, stepGap } from '@/utils/serviceOrderStepPlacement';

import { readAccountPreferenceComparison, type AccountPreferenceResolution } from './accountPreference';
import { isAnchoredPlacementRefusal } from './anchoredRowPlacement';
import { isLiveWholeAction, isRetiredActionDependent, orderActionProjections, type AtomicCommitIdentity } from './atomicCommits';
import { firstBookMarksIntent, isFirstBookMarksDraft } from './bibleMarksCreation';
import { CaptureContinuations } from './captureContinuations';
import { keepUncontestedCommentFields } from './commentKindChoice';
import { commentCompanionProofs, commentPlaceChoiceOpening, commentPlaceTextChange, commentPlaceTextTail, commentTextChoiceBasis, keepUncontestedCommentPlace, keepUncontestedCommentText, readCommentPlaceComparison, readReturnedCommentText } from './commentPlaceChoice';
import { assertCommitCapture } from './commits';
import { councilAssemblyRow } from './councilAssemblyAction';
import { isCouncilHeaderComparison } from './councilFieldAction';
import { readCouncilSummaryChoice, writeCouncilSummaryChoice } from './councilPrivateFields';
import { councilTopicKindRow } from './councilTopicKindAction';
import { retryCouncilTopicPlacement } from './councilTopicPlacement';
import { COUNCIL_TOPIC_TEXT_QUEUED, COUNCIL_TOPIC_TEXT_SETTLED } from './councilTopicTextAction';
import { councilTopicTextDecision, councilTopicTextVersions, projectCouncilTopicTextDecisions, readCouncilTopicTextReview, retainedCouncilTopicWords, reviewedCouncilDetailAction, withCouncilReviewProofs } from './councilTopicTextReview';
import { hasCouncilTopic } from './councilTopicTitleAction';
import { assertCouncilTopicChoice } from './councilTopicTransition';
import { deletionConflicts } from './deletionContent';
import { canRemovePendingCreation, isDocumentDeletion, pendingRemovalOpening, pendingStandaloneCreation, type PendingRemovalOpening } from './deletionOrdering';
import { isDirectLegacyDocumentIntent, type DocumentAnswer } from './documentDelivery';
import { groupStatusOutsideChoice, withQueuedGroupScalarProofs, withSubmittedScalarProofs } from './documentFieldAction';
import { keepUncontestedDocumentTagFields } from './documentTagChoice';
import { keepUncontestedDocumentText, manualSeriesTextChoiceFields, readDocumentTextChoice, retryPrayerTextChoice } from './documentTextChoice';
import { requiredDomainTargets } from './domainPolicy';
import { areDifferentTabManualParents, editorSlot, manualChoiceRecoveryIdentity, readManualScopeIdentity } from './editorIdentity';
import { hasLaterPendingExegeticalTitle } from './exegeticalPointCapture';
import { readField, writeField } from './fieldValues';
import { firstGroupMeetingReview, projectFirstGroupMeetingChoice } from './groupFirstMeeting';
import { isOrderedGroupFlowText } from './groupFlowTitleAction';
import { captureGroupMeetingReview } from './groupMeetingReview';
import { retryGroupStepPlacement } from './groupStepPlacement';
import { groupTextDecision, isGroupStatusComparison, projectGroupTextDecisions, readGroupFlowTextChoice, readGroupTextReview, sameGroupText, writeGroupFlowTextChoice } from './groupTextReview';
import { hardQuestionTextField, type HardQuestionFieldObservations } from './hardQuestionFieldAction';
import { basisScriptureConflictId, hardQuestionThemeListPath } from './hardQuestionThemeLists';
import { resolveHardQuestionThemeOrderReview, type HardQuestionThemeOrderChoices } from './hardQuestionThemeOrderReview';
import { liveSubmittedWork, sameLiveAtomicProof } from './liveSubmittedWork';
import { chooseLocalPlacement } from './localPlacementChoice';
import { projectExactManualChoice, retainedAnchoredPlacementDraft, type ExactManualChoice } from './manualChoice';
import { sameManualSources } from './manualReturnSources';
import { projectManualSelection, type ManualPath } from './manualScope';
import { assertOrdinaryAnswerScope, anchoredPlacementChoiceTail, ordinaryChoiceCheckpoint, projectOrdinaryChoiceDependents, requireDocumentChoiceForBranch, reviewOrdinaryAnswerChoice, type ManualChoiceSources } from './ordinaryAnswerChoice';
import { projectOutlineParentChoice, readOutlineParentComparison, type OutlineTitleDecision } from './outlineParentChoice';
import { readOutlinePointPlacementComparison, retryOutlinePointPlacement } from './outlinePointPlacement';
import { keepUncontestedOutlineTitle } from './outlineTitleEdit';
import { oversizedNoteOpening } from './oversizedNoteCorrection';
import { chooseLocalPreachDateEdits, isOrderedPreachDateField, preachDateChoiceFrames, unresolvedPreachDateField } from './preachDateChoice';
import { confirmedExistingDeletion, equalValues, mergeDocumentFields, mergeFields, projectHardQuestionThemeOrders } from './protocol';
import { shouldRetainCheckpoint } from './recovery.client';
import { recoveryChoiceFingerprint } from './recoveryChoice';
import { separateRefusedSermonTail } from './refusedSermonSave';
import { readServiceOrderTitleConflict, readTagColorConflict } from './rowConflictDetails';
import { carryOrderedPreachDateFields, hasAutosaveRowFieldCaptures, isAutosaveRowFieldPath, missingAutosaveRowFieldTarget, withQueuedRowFieldProofs } from './rowFieldAutosave';
import { isReturnedSeriesField } from './seriesFieldAction';
import { keepUncontestedSermonFields, readSermonSettingComparison } from './sermonFieldChoice';
import { blocksIndependentActionDuringScratchRecovery, guardedScratchTextReview, guardedScratchTextSubmission, pendingGuardedScratchTextReview } from './sermonGuardedScratchText';
import { planCellOpening, readPlanCellText, removedConflictingPlanCells, settledPlanCellView, type PlanCellDraft, type PlanCellOpening } from './sermonPlanCellSession';
import { pendingScratchRemoval, unresolvedScratchRemoval } from './sermonScratchRemovalRecovery';
import { readSermonTextDraftComparison, retryForSermonTextChoice } from './sermonTextRecovery';
import { unresolvedThoughtLock } from './sermonThoughtLockRecovery';
import { unresolvedThoughtPlacement } from './sermonThoughtPlacementRecovery';
import { pendingThoughtRemoval, unresolvedThoughtRemoval } from './sermonThoughtRemovalRecovery';
import { isReturnedServiceOrderInput, projectServiceOrderInput, ServiceOrderInputDecisionError, type ServiceOrderInput, type ServiceOrderInputComparison } from './serviceOrderInput';
import { hasServiceOrderStep, serviceOrderStepField } from './serviceOrderStepAction';
import { keepUncontestedServiceStepScripture, keepUncontestedServiceStepText, readServiceStepTextChoice, reviewedServiceStepScriptureRows, serviceStepScriptureChoice, serviceStepScriptureConflict, serviceStepTextRetry } from './serviceOrderStepChoice';
import { placementSteps } from './serviceOrderStepPlacement';
import { DataSession, type SessionCheckpoint, type ShownCopy } from './session';
import { canReplaceSnapshot } from './snapshotFreshness';
import { legacySourceNoteChange } from './sourceNoteLinkAction';
import { readSourceNoteLinkComparison, reviewedSourceNoteLinks, sourceNoteChoiceTail } from './sourceNoteLinkChoice';
import { COMMENT_TEXT_REVIEW } from './studyNoteContentCapture';
import { keepUncontestedLegacyComment, type LegacyStudyNoteImport } from './studyNoteLegacyDraft';
import { readStudyNoteReferenceComparison, reviewedReferenceEvidence } from './studyNoteReferenceChoice';
import { keepUncontestedStudyNoteFields, readStudyNoteReturnComparison } from './studyNoteTypeChoice';
import { submittedWorkCheckpoint } from './submittedWork';
import { changedThoughtTagTarget } from './thoughtTagAction';
import { hasUnreadablePreparationCheck, hasUnreadableSermonChurch, hasUnreadableSermonText } from './unreadableDraftProof';

import type { ActionTime } from './actionClock';
import type { DocumentWriteReceipt } from './commitReceipt';
import type { CommitQueue, CommitRequest } from './commits';
import type { AutosaveFieldStamp } from './documentFieldAction';
import type { PlanCellEmergency } from './planCellEmergency';
import type { RecoverySource } from './recoveryPresence';
import type { RecoveryOrigin, VersionedRecovery } from './recoverySource';
import type { DataEngineRuntime, RuntimeEvent } from './runtime';
import type { SermonOutlineReviewInput } from './sermonOutlineReview';
import type { ServiceOrderInputReserve } from './serviceOrderInputReserve';
import type { SourceNoteLinkCapture } from './sourceNoteLinkCapture';
import type { CouncilTopicPlacementCapture, EditorCommitAction, GroupFlowStepPlacementCapture, OutlinePointPlacementCapture } from './types';
import type { CommandResult, DataCommand, DocumentData, ResourceRef, ResourceSnapshot, StudyNoteContentCapture } from './types';
import type { OutlineTitleOpening, SermonNoteOpening } from '@/utils/sermonNoteText';

const PENDING_DELIVERY_FIRST = 'pending-delivery-first';
const placementUnavailable = () => Object.assign(new Error('The proposed position is unavailable or has changed'), { code: 'decision-changed' });

function requireFreshGeneration(result: CommandResult | null | undefined, rejected: string | null | undefined,
  candidate: ResourceSnapshot | null): void {
  if (result?.kind !== 'refused' || result.code !== 'generation-mismatch') return;
  if (candidate?.metadata && candidate.metadata.generation !== rejected) return;
  throw Object.assign(new Error('Read the current document before resolving a generation mismatch'), { code: 'fresh-read-required' });
}

/** A retired controller rejects late work; this is cancellation, not a storage failure. */
export class InactiveEditorError extends Error {
  constructor() { super('Editor is no longer active'); this.name = 'InactiveEditorError'; }
}

/** A retired editor's cancellation is distinct from a refused device write. */
export function isInactiveEditorError(error: unknown): error is InactiveEditorError {
  return error instanceof InactiveEditorError;
}

export interface EditorRecord extends VersionedRecovery {
  owner: string;
  editorId: string;
  checkpoint: SessionCheckpoint;
  /** The originating screen intended to save ordinary typing without a button. */
  autoSaveOnResume?: boolean;
  /** An independently held, single plan cell. It can be read without applying it to the active editor. */
  planCellAlternative?: true;
  /** Persisted before journal submission so a crash can resume the identical command. */
  prepared: DataCommand | null;
  unfinalized: string[];
  completedCommits?: string[];
  recoverySources?: RecoverySource[];
  /** Basis of the retained changes, separate from the last accepted server snapshot. */
  retainedManualChoice?: { base: DocumentData | null; decidingEditorId?: string; groupStepPlacement?: GroupFlowStepPlacementCapture; groupFieldsGeneration?: string | null;
    councilTopicPlacement?: CouncilTopicPlacementCapture; councilFieldsGeneration?: string | null;
    outlinePointPlacement?: OutlinePointPlacementCapture; templateFieldsGeneration?: string | null; sourceNoteLinks?: SourceNoteLinkCapture;
    sermonNoteText?: SermonNoteOpening; sermonFieldsGeneration?: string | null; commentText?: true };
}

export interface CheckpointStore {
  read(owner: string, editorId: string): Promise<EditorRecord | undefined>;
  put(record: EditorRecord): Promise<void>;
}

export interface RecoveryCheckpoint {
  /** Stable persisted identity, independent of the current browser factory. */
  id: string;
  record: EditorRecord;
  /** Exact legacy disk value when the displayed record has a read-only delivery projection. */
  discardRecord?: EditorRecord;
  /** Derived by engine discovery; never stored in the checkpoint. */
  answer?: DocumentAnswer;
  sourceNoteChoiceEditorId?: string;
  commentPlaceChoiceEditorId?: string;
  /** The held requests can only be resolved through their complete atomic action. */
  actionResolutionRequired?: boolean;
}

export interface CheckpointRecoveryStore extends CheckpointStore {
  listRecoverable(owner: string, resource?: ResourceRef): Promise<RecoveryCheckpoint[]>;
  listResumableStudyNoteReturns?(owner: string, resource: ResourceRef): Promise<EditorRecord[]>;
  /** Move an unchanged note return to a fresh editor without creating another copy. */
  resumeStudyNoteReturn?(expected: EditorRecord, editorId: string): Promise<void>;
  listManualChoiceCopies?(owner: string, resource?: ResourceRef): Promise<RecoveryCheckpoint[]>;
  listUnreadable?(owner: string): Promise<UnreadableCheckpoint[]>;
  /** Atomic create-if-absent; recovery never overwrites an active editor checkpoint. */
  create(record: EditorRecord, source?: RecoveryOrigin): Promise<void>;
  /** Removes only the exact explicitly selected closed copy, never an unresolved Save. */
  discardRecovery?(record: EditorRecord, isCurrent: () => boolean): Promise<void>;
  /** Exact optional native source pin; unsupported stores retain original copies. */
  pinRecovery?(record: EditorRecord): Promise<string | null>;
  /** Closed editors' copies whose Saves were all answered; unsupported stores keep them. */
  settleClosed?(owner: string, entries: readonly SettledCheckpoint[]): Promise<void>;
  /** Replace only the expected closed service checkpoint after importing a newer reserve. */
  replaceClosedServiceInput?(expected: EditorRecord, next: EditorRecord): Promise<boolean>;
}

export interface UnreadableCheckpoint {
  id: string;
  title?: string;
  /** Display only, and copy only after the person requests it. */
  text?: string;
}

/** A stored copy as it was read, and the same copy with its answered Saves applied. */
export interface SettledCheckpoint {
  stored: EditorRecord;
  settled: EditorRecord;
}

interface RemovedPlanCellCopy {
  readonly identity: string | symbol;
  discard(): void | Promise<void>;
}

type RetainRemovedPlanCell = (basis: ResourceSnapshot, id: string, draft: PlanCellDraft) => Promise<RemovedPlanCellCopy | null>;

interface RemovedPlanCellSettlement {
  replaced: RemovedPlanCellCopy[];
  settled: [id: string, text: string][];
}

interface ControllerOptions {
  owner: string;
  editorId: string;
  snapshot: ResourceSnapshot;
  store: CheckpointStore;
  runtime: DataEngineRuntime;
  operationId: () => string;
  isCurrentOwner: (owner: string) => boolean;
  readConfirmed?: (resource: ResourceRef) => Promise<ResourceSnapshot>;
  readWriteTarget?: (resource: ResourceRef) => Promise<ResourceSnapshot | null>;
  publishStoredChoice?: (snapshot: ResourceSnapshot) => Promise<void>;
  /** A clean legacy checkpoint can be collected, so cache the proof before retiring its reply. */
  persistConfirmedDeletion?: (snapshot: ResourceSnapshot) => Promise<void>;
  commits?: CommitQueue;
  planCellEmergency?: PlanCellEmergency;
  serviceOrderInputReserve?: ServiceOrderInputReserve;
  retainRemovedPlanCell?: RetainRemovedPlanCell;
  /** Proven submitted intent for a fresh opening; an existing checkpoint takes precedence. */
  submittedCheckpoint?: SessionCheckpoint;
  autoSaveOnResume?: boolean;
  /** An active private form keeps ordinary root continuation outside its parent editor. */
  canFollowSubmittedWork?: () => boolean;
  manualReturnSources?: (requests: readonly CommitRequest[]) => Promise<ReadonlyMap<string, string>>;
  manualChoiceSources?: (requests: readonly CommitRequest[]) => Promise<ManualChoiceSources>;
  /** Presentation ancestry becomes known before replay or pending ACK projection awaits. */
  onRecoverySources?(sources: readonly RecoverySource[]): void;
}

export interface EditorState {
  checkpoint: SessionCheckpoint;
  durable: boolean;
  error: string | null;
  /** The refusal's code, when it has one, so a screen can say it in words (actionFailureMessage). */
  errorCode?: string | null;
  result: CommandResult | null;
  /** A command or explicit choice is being durably prepared; this is not an acknowledgement. */
  preparing?: boolean;
  /** An explicit Save has not transferred its captured intent to a durable request. */
  captureFailed?: boolean;
  actionResolutionRequired?: boolean;
  /** The sole pending relation created this exact document as its primary member. */
  pendingMembershipCreation?: string;
  /** Derived by the engine from every held request and its cancellation scope. */
  savedIntentReplaceable?: boolean;
  /** Borrowed form scopes with actual terminal answers, available for explicit recovery. */
  borrowedManualAnswers?: readonly string[];
  /** A legacy checkpoint may still own a command directly rather than a commit request. */
  preparedOperationId?: string;
  /** A form's save is among the pending work: dropping a refusal of the whole document is not offered. */
  manualWork?: boolean;
}

/** A single editor owns its checkpoint; the runtime owns delivery for every editor. */
function captureSaveOptions(captured: SessionCheckpoint, pending: [string, SessionCheckpoint['pending'][string]][],
  captureScope?: string, pendingRemoval?: PendingRemovalOpening) {
  if (pendingRemoval) return { predecessorIds: pendingRemoval.ids, retentionScope: captureScope, pendingRemoval };
  const creation = captured.draft === null && pendingStandaloneCreation(captured);
  const newestGeneration = Math.max(...pending.map(([, request]) => request.generation));
  // The acknowledgement may have arrived after Remove captured the displayed creation.
  const predecessorIds = creation ? [creation[0]]
    : pending.filter(([, request]) => request.generation === newestGeneration).map(([id]) => id);
  const options: { predecessorIds?: string[]; retentionScope?: string } = {};
  if (predecessorIds.length) options.predecessorIds = predecessorIds;
  if (captureScope) options.retentionScope = captureScope;
  return Object.keys(options).length ? options : undefined;
}

export class EditorController {
  private session: DataSession;
  private prepared: DataCommand | null = null;
  private unfinalized: string[] = [];
  private durable = true;
  private error: string | null = null;
  private errorCode: string | null = null;
  /** Requests a manual form handed to this editor (`adoptManualCommit`): resolved by the form, not here. */
  private manualRequests = new Set<string>();
  private result: CommandResult | null = null;
  private preparations = 0;
  private choices = 0;
  /** Submitted generations must reach the request store before a future RAM draft reaches a checkpoint. */
  private pendingCaptures = new CaptureContinuations();
  private disposed = false;
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();
  private unsubscribe: () => void = () => undefined;
  private stopCommits: () => void = () => undefined;
  private completedCommits: string[] = [];
  private recoverySources: RecoverySource[] = [];
  private recoveryOrigins: RecoveryOrigin[] = [];
  /** Whether the device holds a checkpoint for this editor, which a write must keep or clear. */
  private held = false;
  /** How many completed commits the device has already had cleared. */
  private clearedCommits = 0;
  private atomicPending = new Map<string, AtomicCommitIdentity>();

  private constructor(private readonly options: ControllerOptions) {
    this.session = new DataSession(options.snapshot);
  }

  static async open(options: ControllerOptions): Promise<EditorController> {
    const controller = new EditorController(options);
    const saved = await options.store.read(options.owner, options.editorId);
    controller.assertCurrent();
    if (saved) {
      const resource = saved.checkpoint.confirmed.resource;
      if (saved.owner !== options.owner || saved.editorId !== options.editorId
        || resource.collection !== options.snapshot.resource.collection || resource.id !== options.snapshot.resource.id) {
        throw new Error('Checkpoint identity mismatch');
      }
      controller.session = DataSession.restore(saved.checkpoint);
      controller.prepared = saved.prepared;
      controller.unfinalized = saved.unfinalized ?? [];
      controller.completedCommits = saved.completedCommits ?? [];
      controller.recoverySources = saved.recoverySources ?? [];
      controller.recoveryOrigins = saved.recoveryOrigins ?? [];
      options.onRecoverySources?.(controller.recoverySources);
      controller.held = true;
      controller.clearedCommits = controller.completedCommits.length;
    }
    if (!saved && options.submittedCheckpoint) {
      const checkpoint = options.submittedCheckpoint;
      if (checkpoint.confirmed.resource.collection !== options.snapshot.resource.collection
        || checkpoint.confirmed.resource.id !== options.snapshot.resource.id) throw new Error('Submitted checkpoint identity mismatch');
      controller.session = DataSession.restore(checkpoint);
    }
    controller.unsubscribe = options.runtime.subscribe(event => controller.onRuntime(event));
    if (options.commits) controller.stopCommits = options.commits.subscribe(({ request }) => controller.onCommit(request));
    try {
      if (controller.prepared) await controller.resumePrepared(controller.prepared);
      await controller.finishAcknowledgements();
      if (options.commits) {
        for (const request of orderActionProjections(await options.commits.list())) {
          if (request.editorId === options.editorId || controller.session.checkpoint().pending[request.id]) await controller.applyCommit(request);
        }
      }
      return controller;
    } catch (error) {
      controller.dispose();
      throw error;
    }
  }

  /** Freeze the same record guarded by explicit recovery decisions. */
  captureRecoveryChoice(): EditorRecord {
    this.assertCurrent();
    return JSON.parse(JSON.stringify(this.record())) as EditorRecord;
  }

  getState(): EditorState {
    this.assertCurrent();
    const checkpoint = this.session.checkpoint();
    const atomic = this.atomicPending.size === 1 ? this.atomicPending.values().next().value : undefined;
    return { checkpoint, durable: this.durable, error: this.error, errorCode: this.errorCode, result: this.result, preparing: this.preparations > 0 || this.choices > 0, captureFailed: this.pendingCaptures.failed,
      preparedOperationId: this.prepared?.operationId,
      actionResolutionRequired: this.atomicPending.size > 0,
      pendingMembershipCreation: atomic?.kind === 'create-member' && checkpoint.pending[atomic.id] ? atomic.id : undefined,
      manualWork: Object.entries(checkpoint.pending).some(([id, intent]) => intent.borrowedManualScope || this.manualRequests.has(id)) };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** `shown` — the copy the screen showed while typing (`DataSession.edit`). */
  edit(value: DocumentData | null, shown?: ShownCopy, autosaveStamp?: AutosaveFieldStamp): Promise<void> {
    this.assertCurrent();
    this.session.edit(value, shown, autosaveStamp);
    if (autosaveStamp?.field === 'service-order-input') {
      this.options.serviceOrderInputReserve?.admit(this.session.checkpoint(), autosaveStamp.input);
    }
    this.durable = false;
    this.emit();
    return this.enqueue(() => this.persistGroupTextEdit());
  }

  /** A shortened note replaces its sole size refusal in the same durable transaction. */
  shortenOversizedStudyNote(): Promise<boolean> {
    const commits = this.options.commits;
    if (!commits || this.result?.kind !== 'refused' || this.result.code !== 'resource-exhausted') return Promise.resolve(false);
    let replaced = false;
    return this.enqueueChoice(async () => {
      const record = this.record(), shown = record.checkpoint;
      const [requestId, ...others] = Object.keys(shown.pending);
      if (!requestId || others.length || shown.remoteCandidate || shown.conflicts.length || !shown.draft) return;
      const captures = this.pendingCaptures.boundary();
      const source = (await commits.list()).find(request => request.id === requestId);
      this.assertCurrent();
      const held = shown.pending[requestId];
      if (!source || source.owner !== record.owner || editorSlot(source.editorId) !== 'study-note'
        || source.retentionScope || !oversizedNoteOpening(source)
        || held.generation !== source.editGeneration || !equalValues(held.value, source.value)
        || !equalValues(shown.confirmed, source.working) || !equalValues(shown, this.session.checkpoint())) return;
      // The failed text was displayed, but was never stored. A replacement compares against
      // the refused command's confirmed opening and carries the new action's time.
      const { studyNoteContentDraft, ...checkpoint } = shown;
      const corrected = DataSession.restore(checkpoint);
      corrected.release(requestId);
      const latest = studyNoteContentDraft?.action;
      const opening = source.studyNoteContentAction;
      const metadata = source.working.metadata;
      const shortenedContent = latest && metadata && opening?.before.exists && typeof opening.before.value === 'string'
        ? { generation: metadata.generation, observedRevision: opening.observedRevision, opening: opening.before.value, time: latest.time } : undefined;
      let projected: EditorRecord | undefined;
      const receipt = await commits.replaceOversizedNote(source, record.editorId, undefined, corrected.checkpoint(), saved => {
        this.assertCurrent();
        if (!equalValues(shown, this.session.checkpoint())) {
          throw Object.assign(new Error('The corrected text changed'), { code: 'decision-changed' });
        }
        corrected.applyCommit(saved);
        projected = { ...record, checkpoint: corrected.checkpoint(),
          completedCommits: [...new Set([...(record.completedCommits ?? []), requestId])] };
        return projected;
      }, shortenedContent);
      if (!receipt || !projected) return;
      await this.applyChoiceProjection(shown, projected, captures);
      await commits.finishCancellation(record.editorId, [requestId]);
      replaced = true;
    }).then(() => replaced);
  }

  importLegacyStudyNote(edits: LegacyStudyNoteImport): Promise<void> {
    this.assertCurrent();
    this.session.importLegacyStudyNote(edits);
    this.durable = false;
    this.emit();
    return this.enqueue(() => this.persist());
  }

  editUnverifiedPlanCell(nodeId: string, text: string, previous: string): Promise<void> {
    this.assertCurrent();
    const checkpoint = this.session.checkpoint();
    const address = planCellOpening(checkpoint, nodeId, readPlanCellText(checkpoint.draft, nodeId));
    if (!address) throw Object.assign(new Error('The plan cell is unavailable'), { code: 'decision-changed' });
    return this.editPlanCell({ ...address, text: previous, unverified: true }, text, previous);
  }

  editPlanCell(opening: PlanCellOpening, text: string, previous?: string, isSourceStored?: () => boolean): Promise<void> {
    this.assertCurrent();
    const before = isSourceStored?.() ? this.session.checkpoint() : undefined;
    this.session.editPlanCell(opening, text);
    const attempted = before && this.session.checkpoint();
    const emergency = this.options.planCellEmergency;
    const reserved = emergency?.admit(opening, text, previous, isSourceStored);
    this.durable = false;
    this.emit();
    return this.enqueue(async () => {
      try {
        await this.persist();
      } catch (error) {
        const current = !this.disposed && this.options.isCurrentOwner(this.options.owner);
        if (current && !this.durable && before && attempted && isSourceStored?.() && !this.pendingCaptures.pending
          && (reserved ? reserved.isCurrent() : this.session.checkpoint().editGeneration === attempted.editGeneration)
          && this.session.restoreUnwrittenPlanCell(opening.nodeId, before, attempted)) {
          reserved?.restore();
          await this.persist().catch(() => undefined);
        }
        emergency?.preserve();
        throw error;
      }
    });
  }

  /** The handoff of an independent source needs the actual stored words, not a completed edit callback. */
  async assertPlanCellsStored(cells: Readonly<Record<string, string>>): Promise<void> {
    this.assertCurrent();
    const expected = Object.entries(cells);
    // A pending Save may deliberately hold the displayed baseline behind the server.
    const settledView = (checkpoint: SessionCheckpoint) =>
      this.pendingCaptures.pending ? undefined : settledPlanCellView(checkpoint);
    const confirmed = settledView(this.session.checkpoint());
    if (expected.every(([id, text]) => planCellOpening(confirmed, id, text))) return;

    const stored = (await this.options.store.read(this.options.owner, this.options.editorId))?.checkpoint;
    this.assertCurrent();
    const live = this.session.checkpoint();
    const current = settledView(live);
    const sameRecord = stored && live.confirmed.value && !live.confirmed.metadata?.deleted
      && stored.confirmed.resource.id === live.confirmed.resource.id
      && stored.confirmed.metadata?.generation === live.confirmed.metadata?.generation
      && (live.confirmed.metadata || stored.confirmed.value?.createdAt === live.confirmed.value.createdAt);
    if (expected.every(([id, text]) => planCellOpening(current, id, text)
      || (sameRecord && stored.planCellDrafts?.[id]?.text === text && planCellOpening(stored, id, text)))) return;
    throw Object.assign(new Error('The selected plan words have not reached the device checkpoint'), { code: 'decision-changed' });
  }

  useStoredServiceOrderInput(input: ServiceOrderInput, compared: ServiceOrderInputComparison): Promise<void> {
    this.assertCurrent();
    return this.enqueue(async () => {
      this.session.useStoredServiceOrderInput(input, compared);
      this.durable = false;
      this.emit();
      await this.persist();
    });
  }

  captureFieldSave(): SessionCheckpoint {
    this.assertCurrent();
    if (!this.options.commits) throw new Error('Saving a field requires the commit queue');
    return this.session.pinFieldSave();
  }

  retainSermonOutlineReview(input: SermonOutlineReviewInput): Promise<void> | undefined {
    this.assertCurrent();
    if (this.prepared || this.preparations || this.choices || this.pendingCaptures.pending
      || !this.session.retainSermonOutlineReview(input)) return;
    this.durable = false;
    this.emit();
    return this.enqueue(() => this.persist());
  }

  applyAccountPreferenceReview(compared: SessionCheckpoint, choices: AccountPreferenceResolution, time: ActionTime | null): Promise<void> {
    const captures = this.pendingCaptures.boundary();
    const expected = this.captureRecoveryChoice();
    return this.enqueueChoice(async () => {
      this.assertRecoveryChoice(expected);
      this.assertChoiceAuthority();
      this.assertManualResolution();
      const source = this.session.checkpoint();
      if (!equalValues(compared, source)) {
        throw Object.assign(new Error('The shown field comparison changed'), { code: 'decision-changed' });
      }
      const chosen = DataSession.restore(source);
      chosen.applyAccountPreferenceReview(choices, time);
      const record = { ...this.record(), checkpoint: chosen.checkpoint() };
      await this.options.store.put(record);
      await this.applyChoiceProjection(source, record, captures);
    });
  }

  applyHardQuestionThemeOrderReview(compared: SessionCheckpoint, identity: string, choices: HardQuestionThemeOrderChoices,
    choiceTime: ActionTime | null): Promise<void> {
    const captures = this.pendingCaptures.boundary();
    const expected = this.captureRecoveryChoice();
    return this.enqueueChoice(async () => {
      const commits = this.options.commits;
      const initial = this.session.checkpoint();
      const pendingIds = Object.keys(initial.pending);
      if (!commits || this.prepared || !pendingIds.length || !compared.remoteCandidate || !equalValues(initial, compared)) {
        throw Object.assign(new Error('The compared theme save changed'), { code: 'decision-changed' });
      }
      this.assertChoiceAuthority(initial);
      const pending = (await commits.list()).filter(entry => Object.hasOwn(initial.pending, entry.id));
      this.assertRecoveryChoice(expected);
      const answered = pending.filter(entry => entry.state === 'conflict' && entry.result?.kind === 'conflict');
      const [request] = answered;
      if (pending.length !== pendingIds.length || answered.length !== 1 || pending.some(entry =>
        !equalValues(entry.baseline.resource, initial.confirmed.resource) || (entry !== request &&
          (entry.state !== 'queued' || entry.command)))) {
        throw Object.assign(new Error('Resolve the compared theme save separately'), { code: 'other-changes-first' });
      }
      // The comparison displayed the editor's aggregate draft. Unsent dependent actions in that
      // draft are included in the replacement, and the atomic cancellation rechecks that exact set.
      const revisions = new Map(pending.map(entry => [entry.id, entry.revision]));
      const original = [...pending].sort((first, second) => initial.pending[first.id].generation - initial.pending[second.id].generation)
        .reduce<HardQuestionFieldObservations>((fields, entry) => ({ ...fields, ...entry.hardQuestionFieldActions }), {});
      await this.options.publishStoredChoice?.(compared.remoteCandidate);
      let source: SessionCheckpoint | undefined;
      let projected: EditorRecord | undefined;
      await commits.cancelWithCheckpoint('', [request.id], retired => {
        this.assertRecoveryChoice(expected);
        const record = this.record();
        source = record.checkpoint;
        if (retired.length !== revisions.size || retired.some(entry => entry.revision - 1 !== revisions.get(entry.id))
          || !equalValues(source, compared) || [...this.pendingCaptures.boundary()].some(attempt => !captures.has(attempt))) {
          throw Object.assign(new Error('The compared theme save changed'), { code: 'decision-changed' });
        }
        const { value, reviewedText } = resolveHardQuestionThemeOrderReview(source, identity, choices);
        const session = DataSession.restore({ ...source, pending: {} });
        session.acceptRemote();
        session.edit(value);
        const next = session.checkpoint();
        const replacement = next.dirty ? commits.choiceReplacement(record.editorId, next, Object.keys(original).length || reviewedText.length ? {
          action: { kind: 'document-metadata', time: choiceTime, hardQuestionFieldReview: { fields: reviewedText, original } },
        } : {}) : null;
        if (next.dirty && !replacement) throw Object.assign(new Error('The chosen theme could not be captured'), { code: 'decision-changed' });
        if (replacement) session.applyCommit(replacement);
        projected = { ...record, checkpoint: session.checkpoint(), completedCommits: [...new Set([...(record.completedCommits ?? []), ...pendingIds])] };
        return { editorRecords: [projected], manualRecoveries: [], replacements: replacement ? [replacement] : [] };
      }, { roots: [request], included: new Set(pendingIds.filter(id => id !== request.id)),
        placementChoice: new Map([[request.id, compared.remoteCandidate]]) });
      if (!source || !projected) throw new Error('The chosen theme checkpoint was not captured');
      await this.applyChoiceProjection(source, projected, captures);
      await commits.finishCancellation('', pendingIds);
    });
  }

  chooseSermonOutlineReview(side: 'local' | 'remote', expected: EditorRecord): Promise<void> {
    const captures = this.pendingCaptures.boundary();
    return this.enqueueChoice(async () => {
      this.assertRecoveryChoice(expected);
      const source = this.session.checkpoint();
      const chosen = DataSession.restore(source);
      chosen.chooseSermonOutlineReview(side);
      const record = { ...this.record(), checkpoint: chosen.checkpoint() };
      // Retire the compared versions only after the replacement's exact checkpoint is on disk.
      await this.options.store.put(record);
      await this.applyChoiceProjection(source, record, captures);
    });
  }

  editOutlineTitle(shown: SessionCheckpoint, opening: OutlineTitleOpening, title: string, time: ActionTime | null = null): Promise<DocumentData | null> {
    this.assertCurrent();
    // Close captures the current session while an earlier disk write can still be pending.
    this.session.editOutlineTitle(shown, opening, title, time);
    const draft = this.session.checkpoint().draft;
    this.durable = false;
    this.emit();
    return this.enqueue(() => this.persist()).then(() => draft);
  }

  save(capturedIntent?: SessionCheckpoint & { planCellSaveIds?: readonly string[]; serviceOrderInput?: ServiceOrderInput; serviceOrderComparison?: ServiceOrderInputComparison; scratchRemovalValue?: DocumentData }, selection?: readonly ManualPath[], onCaptured?: (receipt: DocumentWriteReceipt) => void, captureScope?: string,
    action?: EditorCommitAction, pendingRemoval?: PendingRemovalOpening, noteContent?: StudyNoteContentCapture | null): Promise<void> {
    this.assertCurrent();
    const capturedAction = action && JSON.parse(JSON.stringify(action)) as EditorCommitAction;
    const capturedContent = noteContent && JSON.parse(JSON.stringify(noteContent)) as StudyNoteContentCapture;
    // Never freeze a Save against a choice whose durable baseline is still unsettled.
    if (this.choices > 0) return Promise.reject(Object.assign(
      new Error('Finish the current version choice before saving'), { code: PENDING_DELIVERY_FIRST }));
    const intent: NonNullable<typeof capturedIntent> = capturedIntent ?? this.session.checkpoint();
    if (blocksIndependentActionDuringScratchRecovery(intent, capturedAction)) return Promise.reject(Object.assign(
      new Error('Finish the recovered sketch before saving another field'), { code: 'resolve-version-first' }));
    // This copy needs a decision. Freezing this version as a retry would keep the old question alive.
    if (guardedScratchTextReview(intent) || hasUnreadablePreparationCheck(intent) || unresolvedThoughtPlacement(intent) || unresolvedThoughtRemoval(intent) || unresolvedScratchRemoval(intent) || unresolvedThoughtLock(intent)) return Promise.reject(Object.assign(
      new Error('Resolve the conflict before saving'), { code: 'resolve-version-first' }));
    const { planCellSaveIds, serviceOrderInput, serviceOrderComparison, scratchRemovalValue, ...captured } = intent;
    // The command owns only the reviewed scratch operation. The native checkpoint retains later edits.
    const scopedScratch = scratchRemovalValue ?? guardedScratchTextSubmission(captured);
    if (captured.guardedScratchText && !scopedScratch) return Promise.reject(Object.assign(new Error('The saved sketch changed'), { code: 'decision-changed' }));
    const submission = scopedScratch ? { ...captured, draft: scopedScratch, conflicts: [], remoteCandidate: null } : captured;
    this.assertManualResolution(selection, captured);
    this.preparations += 1;
    const capture = async (captureComplete: () => void) => {
      if (this.options.commits) {
        // Earlier saves may have registered after this intent was captured.
        // An adopted manual save can share this generation; it is still our predecessor.
        // Exclude only later work; keep the captured draft and baseline unchanged.
        const pending = Object.entries(this.session.checkpoint().pending)
          .filter(([, request]) => request.generation <= captured.editGeneration);
        const record = this.record();
        const projectCheckpoint = (request: CommitRequest): EditorRecord => {
          const session = DataSession.restore({ ...captured, pending: Object.fromEntries(pending) });
          const completed = [...(record.completedCommits ?? [])];
          if (session.applyCommit(request) && !completed.includes(request.id)) completed.push(request.id);
          return { ...record, checkpoint: session.checkpoint(), completedCommits: completed };
        };
        const options = { ...captureSaveOptions(submission, pending, captureScope, pendingRemoval), checkpoint: projectCheckpoint,
          ...(capturedAction && !captured.guardedScratchText && { action: capturedAction }), ...(scratchRemovalValue && { scratchRemoval: true as const }), noteContent: capturedContent, planCellSaveIds, serviceOrderInput, serviceOrderComparison };
        const saved = async () => {
          const capture = onCaptured ? await this.options.commits!.saveWithReceipt(this.options.editorId, submission, options) : null;
          const request = capture ? capture.request : await this.options.commits!.save(this.options.editorId, submission, options);
          return { capture, request };
        };
        const { capture, request } = await saved().catch(error => {
          if (error instanceof ServiceOrderInputDecisionError) captureComplete();
          throw error;
        });
        captureComplete();
        if (capture) onCaptured!(capture.receipt);
        if (request) await this.applyCommit(request);
        else await this.persist();
        return;
      }
      if (onCaptured) throw new Error('Write receipts require the commit queue');
      if (!this.prepared) {
        const intended = submission;
        const resources = intended.dirty && !intended.conflicts.length && !Object.keys(intended.pending).length
          ? requiredDomainTargets(intended.confirmed, intended.draft) : [];
        if (resources.length && !this.options.readConfirmed) throw new Error('Confirmed target reads are unavailable');
        const targets = await Promise.all(resources.map(resource => this.options.readConfirmed!(resource)));
        this.assertCurrent();
        this.prepared = this.session.prepare(this.options.operationId(), this.options.owner, targets, intended);
      }
      if (!this.prepared) return;
      await this.persist();
      await this.options.runtime.submit(this.prepared);
    };
    const attempt = this.options.commits ? this.pendingCaptures.register(capture) : () => capture(() => undefined);
    this.emit();
    return this.enqueue(attempt).finally(() => { this.preparations -= 1; this.emit(); });
  }

  /** A durable form request joins this editor without absorbing unrelated staged fields. */
  adoptManualCommit(request: CommitRequest, selection: readonly ManualPath[]): Promise<void> {
    this.assertCurrent();
    const checkpoint = this.session.checkpoint();
    if (request.owner !== this.options.owner || request.baseline.resource.collection !== checkpoint.confirmed.resource.collection
      || request.baseline.resource.id !== checkpoint.confirmed.resource.id || !request.value) throw new Error('Manual request identity mismatch');
    this.manualRequests.add(request.id);
    if (this.completedCommits.includes(request.id) || checkpoint.pending[request.id]) return this.enqueue(() => this.applyCommit(request));
    if (!checkpoint.draft) throw new Error('The document was deleted while its form was open');
    this.session.edit(projectManualSelection(checkpoint.draft, request.value, selection));
    this.session.registerCommit(request.id, this.session.checkpoint().editGeneration, request.value, request.command?.operationId);
    this.durable = false;
    this.emit();
    return this.enqueue(() => this.applyCommit(request));
  }

  /** Retry the latest local checkpoint without inventing an edit or replacing prepared identities. */
  needsPersistenceRetry(): boolean {
    return this.pendingCaptures.pending || !this.durable || this.prepared !== null || this.unfinalized.length > 0;
  }

  retryPersistence(): Promise<void> {
    return this.enqueue(async () => {
      await this.pendingCaptures.retry();
      await this.persist();
      if (this.prepared) await this.options.runtime.submit(this.prepared);
      await this.finishAcknowledgements();
    });
  }

  /** Queue a deletion of a confirmed document or the exact first creation shown to the person. */
  remove(onCaptured?: (receipt: DocumentWriteReceipt) => void, captureScope?: string): Promise<void> {
    const state = this.getState();
    const { checkpoint } = state;
    const pendingCreation = this.options.commits && canRemovePendingCreation(state);
    const pendingRemoval = this.options.commits && !pendingCreation && pendingRemovalOpening(state);
    if ((Object.keys(checkpoint.pending).length && !pendingCreation && !pendingRemoval) || this.prepared || this.preparations || this.choices) return Promise.reject(Object.assign(new Error('Resolve pending commands before deleting'), { code: PENDING_DELIVERY_FIRST }));
    if ((!checkpoint.confirmed.value && !pendingCreation && !pendingRemoval) || checkpoint.confirmed.metadata?.deleted) return onCaptured ? this.save(checkpoint, undefined, onCaptured, captureScope) : Promise.resolve();
    if (!this.durable) return Promise.reject(Object.assign(new Error('Save the local draft before deleting'), { code: 'not-on-device-yet' }));
    if (pendingRemoval) {
      const reserved = this.session.reserveEditGeneration();
      const deletion = DataSession.restore(checkpoint);
      deletion.applyReservedRemoval(reserved);
      return this.save(deletion.checkpoint(), undefined, receipt => {
        const current = this.session.checkpoint();
        if (current.editGeneration === checkpoint.editGeneration && current.draft
          && !deletionConflicts(current.confirmed.resource.collection, pendingRemoval.shown, current.draft).length) {
          this.session.applyReservedRemoval(reserved);
        }
        onCaptured?.(receipt);
      }, captureScope, undefined, pendingRemoval);
    }
    const persisting = this.edit(null);
    const deletion = this.session.checkpoint();
    const saving = this.save(deletion, undefined, onCaptured, captureScope);
    return Promise.all([persisting, saving]).then(() => undefined);
  }

  observe(snapshot: ResourceSnapshot, source: 'server' | 'cache'): Promise<void> {
    return this.enqueue(async () => {
      const retaining = this.preserveDraftOnObservation() ? undefined : this.retainRemovedPlanCells(snapshot);
      const settlement = retaining && await retaining;
      this.session.observe(snapshot, { source, preserveDraft: this.preserveDraftOnObservation() });
      await this.persist(settlement && (async () => {
        for (const [id, text] of settlement.settled) this.options.planCellEmergency?.settleRetained(id, text);
        await Promise.allSettled(settlement.replaced.map(async copy => copy.discard()));
      }));
    });
  }

  private preserveDraftOnObservation(): boolean {
    return this.preparations > 0 || this.choices > 0 || this.atomicPending.size > 0
      || this.result?.kind === 'conflict' || this.result?.kind === 'refused';
  }

  private retainRemovedPlanCells(snapshot: ResourceSnapshot): Promise<RemovedPlanCellSettlement | undefined> | undefined {
    const retain = this.options.retainRemovedPlanCell;
    if (!retain) return;
    const checkpoint = this.session.checkpoint();
    if (Object.keys(checkpoint.pending).length) return;
    const removed = Object.entries(removedConflictingPlanCells(checkpoint, snapshot));
    if (!removed.length) return;
    return this.retainLatestRemovedCells(snapshot, checkpoint.confirmed, removed, retain);
  }

  private async retainLatestRemovedCells(snapshot: ResourceSnapshot, basis: ResourceSnapshot,
    removed: [string, PlanCellDraft][], retain: RetainRemovedPlanCell): Promise<RemovedPlanCellSettlement | undefined> {
    const attempted = new Map<string, PlanCellDraft>();
    const stored = new Map<string, { draft: PlanCellDraft; copy: RemovedPlanCellCopy }>();
    const replaced = new Map<RemovedPlanCellCopy['identity'], RemovedPlanCellCopy>();
    let pending = removed;
    while (pending.length) {
      const writes = await Promise.all(pending.map(async ([id, draft]) => ({ id, draft, copy: await retain(basis, id, draft) })));
      this.assertCurrent();
      for (const { id, draft, copy } of writes) {
        attempted.set(id, draft);
        if (!copy) continue;
        const older = stored.get(id);
        if (older) replaced.set(older.copy.identity, older.copy);
        replaced.delete(copy.identity);
        stored.set(id, { draft, copy });
      }
      const current = this.session.checkpoint();
      if (this.preserveDraftOnObservation() || Object.keys(current.pending).length) return;
      pending = Object.entries(removedConflictingPlanCells(current, snapshot))
        .filter(([id, draft]) => !equalValues(attempted.get(id), draft));
    }

    // A synchronous edit can land while IndexedDB is finishing the earlier copy.
    // Release only the version this observation has actually preserved.
    const current = this.session.checkpoint();
    const release: [string, PlanCellDraft][] = [];
    const settled: RemovedPlanCellSettlement['settled'] = [];
    for (const [id, retained] of stored) {
      const latest = current.planCellDrafts?.[id];
      if (!latest) continue;
      if (equalValues(latest, retained.draft)) {
        release.push([id, retained.draft]);
        settled.push([id, latest.text]);
      } else if (latest.text === readPlanCellText(snapshot.value, id)) {
        replaced.set(retained.copy.identity, retained.copy);
        settled.push([id, latest.text]);
      }
    }
    this.session.releaseRemovedPlanCells(Object.fromEntries(release));
    return { replaced: [...replaced.values()], settled };
  }

  /** Explicitly replace a terminal conflict only; unknown remote outcomes cannot be discarded. */
  acceptRemote(selection?: readonly ManualPath[], expected?: EditorRecord, titles?: readonly OutlineTitleDecision[]): Promise<void> {
    const captures = this.pendingCaptures.boundary();
    // The draft as the person chose; typing that lands before this queued choice runs is kept.
    const atChoice = this.session.checkpoint().draft;
    return this.enqueueChoice(async () => {
      this.assertRecoveryChoice(expected);
      this.assertChoiceAuthority();
      this.assertManualResolution(selection);
      const before = this.session.checkpoint();
      if (expected && !selection && !this.prepared && this.session.choosePrivateFields('remote', null)) {
        if (hasUnreadableSermonChurch(before) || hasUnreadablePreparationCheck(before) || unresolvedThoughtPlacement(before) || unresolvedThoughtRemoval(before) || unresolvedScratchRemoval(before)) this.pendingCaptures.retire(captures);
        this.result = null;
        await this.persist();
        return;
      }
      // A refusal has no other version to take: "use the server's version" drops the refused change.
      const refusedWork = !selection && Object.keys(before.pending).length > 0 && !before.remoteCandidate
        && !Object.keys(before.pending).some(id => this.manualRequests.has(id));
      const chosen = before.remoteCandidate ?? (refusedWork ? before.confirmed : null);
      if (chosen && this.options.publishStoredChoice) {
        await this.options.publishStoredChoice(chosen);
        this.assertCurrent();
      }
      const cancelled = Object.keys(this.session.checkpoint().pending);
      if (this.options.commits && cancelled.length && !isDirectLegacyDocumentIntent(cancelled, this.prepared?.operationId)) {
        await this.resolveCommitChoice('remote', captures, selection, expected, undefined, { draft: atChoice, refused: refusedWork }, undefined, titles);
        return;
      }
      const retained = projectOutlineParentChoice(before.confirmed, atChoice, before.remoteCandidate, before.conflicts, 'remote', titles)
        ?? (!selection && (projectHardQuestionThemeOrders(before.confirmed, atChoice, before.remoteCandidate, before.conflicts, 'remote')
          ?? keepUncontestedOutlineTitle(before.confirmed, atChoice, before.remoteCandidate, before.conflicts)
          ?? keepUncontestedLegacyComment(before.confirmed, atChoice, before.remoteCandidate, before.conflicts)
          ?? keepUncontestedCommentPlace(before.confirmed, atChoice, before.remoteCandidate, before.conflicts)
          ?? keepUncontestedStudyNoteFields(before.confirmed, atChoice, before.remoteCandidate, before.conflicts)));
      if (this.prepared) {
        await this.options.runtime.discard(this.prepared.operationId);
        this.session.release(this.prepared.operationId);
        this.prepared = null;
      }
      this.assertManualResolution(selection);
      this.pendingCaptures.retire(captures);
      this.session.acceptRemote(atChoice);
      if (retained) {
        const accepted = this.session.checkpoint();
        const merged = mergeDocumentFields(accepted.confirmed.value, accepted.draft, retained);
        if (merged.value.exists) this.session.edit(merged.value.value as DocumentData);
        this.session.retainOutlineTitleActions(before);
        this.session.stageOutlineReviewTitles(titles);
      }
      if (refusedWork) this.session.dropRefused(atChoice);
      this.result = null;
      await this.persist();
      if (this.options.commits && cancelled.length) await this.options.commits.finishCancellation(this.options.editorId, cancelled);
    });
  }

  /** Keep local conflict fields after terminal refusal, without replacing remote siblings. */
  keepLocal(selection?: readonly ManualPath[], amendment?: { base: DocumentData; value: DocumentData }, expected?: EditorRecord, choiceTime?: ActionTime | null, titles?: readonly OutlineTitleDecision[]): Promise<void> {
    const captures = this.pendingCaptures.boundary();
    const correction = amendment ? JSON.parse(JSON.stringify(amendment)) as typeof amendment : undefined;
    return this.enqueueChoice(async () => {
      this.assertRecoveryChoice(expected);
      this.assertChoiceAuthority();
      if (correction && (!selection || !equalValues(correction.value, projectManualSelection(correction.base, correction.value, selection)))) {
        throw new Error('Manual resolution changed an unselected field');
      }
      this.assertManualResolution(selection);
      const before = this.session.checkpoint();
      if (expected && !selection && !correction && !this.prepared && this.session.choosePrivateFields('local', choiceTime ?? null)) {
        if (hasUnreadableSermonChurch(before) || hasUnreadablePreparationCheck(before) || unresolvedThoughtPlacement(before) || unresolvedThoughtRemoval(before) || unresolvedScratchRemoval(before)) this.pendingCaptures.retire(captures);
        this.result = null;
        await this.persist();
        return;
      }
      if (isFirstBookMarksDraft(before.confirmed, before.draft) && !before.remoteCandidate
        && this.result?.kind === 'refused' && ['generation-mismatch', 'already-exists'].includes(this.result.code)
        && this.options.readWriteTarget) {
        // A command prepared by an older bundle stays immutable. Read before retiring it,
        // then the existing explicit choice preserves the private draft and remote siblings.
        const target = await this.options.readWriteTarget(before.confirmed.resource);
        this.assertCurrent();
        if (!target) throw Object.assign(new Error('Read the current marks book before keeping local marks'), { code: 'fresh-read-required' });
        firstBookMarksIntent(before.confirmed, this.session.checkpoint().draft, target);
        this.session.observe(target, { source: 'server' });
        await this.persist();
      }
      const cancelled = Object.keys(this.session.checkpoint().pending);
      const checkpoint = this.session.checkpoint();
      const submittedGeneration = this.prepared ? this.prepared.generation : checkpoint.confirmed.metadata?.generation;
      assertCouncilTopicChoice(this.result);
      requireFreshGeneration(this.result, submittedGeneration, checkpoint.remoteCandidate);
      if (this.options.commits && cancelled.length && !isDirectLegacyDocumentIntent(cancelled, this.prepared?.operationId)) {
        await this.resolveCommitChoice('local', captures, selection, expected, correction, undefined, choiceTime, titles);
        return;
      }
      // Validate recovery before retiring its only durable terminal receipt.
      const preview = DataSession.restore(checkpoint);
      if (this.prepared) preview.release(this.prepared.operationId);
      preview.keepLocal(undefined, choiceTime, undefined, titles);
      const sermonText = !selection && !correction && hasUnreadableSermonText(checkpoint)
        && readSermonTextDraftComparison(checkpoint);
      const textRetry = sermonText && retryForSermonTextChoice(preview.checkpoint(), sermonText, choiceTime ?? null);
      if (this.prepared) {
        await this.options.runtime.discard(this.prepared.operationId);
        this.assertCurrent();
        this.session.release(this.prepared.operationId);
        this.prepared = null;
      }
      this.assertManualResolution(selection);
      // Typing can arrive during journal retirement, so resolve the current session, not preview.
      this.pendingCaptures.retire(captures);
      const preference = !selection && !correction ? readAccountPreferenceComparison(this.session.checkpoint()) : undefined;
      this.session.keepLocal(undefined, choiceTime, undefined, titles);
      if (textRetry) this.session.retainSermonTextRetry(textRetry);
      if (preference) this.session.stageAccountPreferenceRetry(preference.field, choiceTime ?? null);
      if (correction) {
        // The explicit choice includes staged corrections, while untouched remote siblings survive.
        const current = this.session.checkpoint();
        const merged = mergeDocumentFields(correction.base, correction.value, current.draft);
        this.session.edit(chooseLocalPlacement(current.confirmed.resource.collection,
          correction.base, correction.value, current.draft,
          merged.value.exists ? merged.value.value as DocumentData : null, mergeFields));
      }
      this.result = null;
      await this.persist();
      if (this.options.commits && cancelled.length) await this.options.commits.finishCancellation(this.options.editorId, cancelled);
    });
  }

  hasChoiceAuthority(checkpoint = this.session.checkpoint()): boolean {
    const result = this.result;
    if (result?.kind === 'conflict' && checkpoint.pending[result.operationId] && this.manualRequests.has(result.operationId)
      && result.snapshot.metadata?.generation === checkpoint.confirmed.metadata?.generation
      && result.conflicts.some(conflict => hardQuestionTextField(checkpoint.confirmed.resource.collection, conflict.path)
        || (checkpoint.confirmed.resource.collection === 'hardQuestionThemes' && basisScriptureConflictId(conflict)))) return false;
    return Object.values(checkpoint.pending).every(intent => !intent.borrowedManualScope);
  }

  assertChoiceAuthority(checkpoint = this.session.checkpoint()): void {
    if (!this.hasChoiceAuthority(checkpoint)) throw Object.assign(
      new Error('Resolve the saved change from its original form or recover that form first'), { code: PENDING_DELIVERY_FIRST });
  }

  /** A form may resolve only its fields; unrelated unsent editor work needs its own decision. */
  assertManualResolution(selection?: readonly ManualPath[], checkpoint = this.session.checkpoint()): void {
    this.assertCurrent();
    if (selection && checkpoint.confirmed.value && checkpoint.draft && !equalValues(checkpoint.draft,
      projectManualSelection(checkpoint.confirmed.value, checkpoint.draft, selection))) {
      throw Object.assign(new Error('Save or resolve other document changes before resolving this form'), { code: 'other-changes-first' });
    }
  }

  /** Await durable projection work, including ACK callbacks, for lifecycle and tests. */
  async settled(): Promise<void> {
    let pending: Promise<unknown>;
    do { pending = this.queue; await pending; } while (pending !== this.queue);
  }

  dispose(): void {
    this.pendingCaptures.retire();
    this.disposed = true;
    this.unsubscribe();
    this.stopCommits();
    this.listeners.clear();
  }

  private async resumePrepared(prepared: DataCommand): Promise<void> {
    // A checkpoint may have committed before its journal entry; resubmission is idempotent.
    await this.options.runtime.submit(prepared);
    // Old direct deletes may already have the exact answer in the local journal.
    if (prepared.kind !== 'delete') return;
    const retained = (await this.options.runtime.list()).find(entry => entry.command.operationId === prepared.operationId)?.result;
    if (!retained || !confirmedExistingDeletion(prepared, retained)) return;
    this.onRuntime({ kind: 'result', owner: this.options.owner, result: retained });
    await this.settled();
  }

  private onRuntime(event: RuntimeEvent): void {
    if (event.kind !== 'result' || event.owner !== this.options.owner
      || (event.result.operationId !== this.prepared?.operationId && !this.unfinalized.includes(event.result.operationId))) return;
    void this.enqueue(async () => {
      if (this.prepared?.operationId !== event.result.operationId && !this.unfinalized.includes(event.result.operationId)) return;
      const deletion = this.prepared && confirmedExistingDeletion(this.prepared, event.result);
      if (deletion) {
        await this.options.persistConfirmedDeletion?.(deletion.snapshot);
        this.assertCurrent();
      }
      const result = deletion ?? event.result;
      this.result = result;
      this.session.accept(result);
      if (result.kind === 'acknowledged') {
        this.prepared = null;
        if (!this.unfinalized.includes(result.operationId)) this.unfinalized.push(result.operationId);
      }
      await this.persist();
      await this.finishAcknowledgements();
    }).catch(() => undefined); // enqueue exposes persistence failure in the editor state.
  }

  /**
   * The record storage has not caught up with yet, or null once it has. Typing reaches the draft at
   * once and the device a moment later; an editor closed inside that moment hands this over to be
   * written, or its last words would live nowhere (BUG-20261011-leave-during-conflict-loses-edit).
   */
  unwrittenRecord(): EditorRecord | null {
    this.assertCurrent();
    return this.durable ? null : this.record();
  }

  private record(): EditorRecord {
    return { owner: this.options.owner, editorId: this.options.editorId, checkpoint: this.session.checkpoint(), prepared: this.prepared,
      ...(this.options.autoSaveOnResume !== undefined && { autoSaveOnResume: this.options.autoSaveOnResume }),
      unfinalized: [...this.unfinalized], completedCommits: [...this.completedCommits],
      ...(this.recoverySources.length ? { recoverySources: this.recoverySources.map(source => ({ ...source })) } : {}),
      ...(this.recoveryOrigins.length ? { recoveryOrigins: this.recoveryOrigins.map(source => ({ ...source })) } : {}) };
  }

  private async persistGroupTextEdit(): Promise<void> {
    const record = this.record();
    const { groupTextReview: review, ...checkpoint } = record.checkpoint;
    if (!review || review.separateDraft || this.pendingCaptures.capturing) return this.persist();
    const root = (await this.options.commits?.list())?.find(request => request.id === review.requestId);
    this.assertCurrent();
    if (root?.state !== 'conflict' || root.revision !== review.revision) return this.persist();
    if (equalValues(root.groupTextReview?.checkpoint.draft, checkpoint.draft)) return this.persist();
    let projected: EditorRecord | undefined;
    try {
      await this.options.commits!.stageGroupTextReview(root, { checkpoint, decisions: review.decisions }, saved => {
        this.assertCurrent();
        projected = { ...record, checkpoint: { ...checkpoint, groupTextReview: { ...review, revision: saved.revision } } };
        return projected;
      });
    } catch (error) {
      if (!['commit-changed', 'decision-changed'].includes(failureCode(error) ?? '')) throw error;
      return this.persist();
    }
    if (!projected) throw new Error('Group text review checkpoint was not captured');
    const current = this.session.checkpoint();
    this.session = DataSession.restore({ ...current, groupTextReview: projected.checkpoint.groupTextReview });
    if (current.editGeneration !== checkpoint.editGeneration) return this.persistGroupTextEdit();
    this.held = true;
    this.durable = true;
    this.error = null;
    this.errorCode = null;
    this.emit();
  }

  private async persist(afterWrite?: () => Promise<void>): Promise<void> {
    if (this.pendingCaptures.capturing) return;
    const record = this.record();
    const keeps = shouldRetainCheckpoint(record);
    // Reading a document writes nothing to the device: with nothing to keep, nothing held and no
    // commits to clear there is no transaction at all. Each write is one Safari can freeze mid-flight
    // when the page is left, holding the store for every other page (owner, 2026-10-20).
    if (keeps || this.held || record.completedCommits!.length > this.clearedCommits) {
      await this.options.store.put(record);
      this.assertCurrent();
      this.held = keeps;
      this.clearedCommits = record.completedCommits!.length;
    }
    // Another keystroke may have arrived during the storage transaction.
    this.durable = this.session.getState().editGeneration === record.checkpoint.editGeneration;
    if (this.durable) {
      this.options.planCellEmergency?.stored(record.checkpoint, !this.pendingCaptures.pending);
      this.options.serviceOrderInputReserve?.stored(record.checkpoint);
    }
    this.error = null;
    this.errorCode = null;
    if (afterWrite) await afterWrite();
    this.emit();
  }

  private canFollowSubmittedWork(): boolean {
    return this.durable && !this.prepared && !this.preparations && !this.choices && !this.pendingCaptures.pending
      && !this.unfinalized.length
      && (!this.result || this.result.kind === 'acknowledged')
      && (this.options.canFollowSubmittedWork?.() ?? true);
  }

  private async pinSubmittedWork(candidate: EditorRecord): Promise<boolean> {
    try { await this.options.store.put(candidate); return true; }
    catch (error) {
      // The source collector won before this editor obtained ownership. No RAM draft changed.
      if (failureCode(error) === 'commit-reference-changed') return false;
      throw error;
    }
  }

  /** Continue a clean cross-tab editor only after its canonical pending references are durable. */
  followSubmittedWork(): Promise<CommitRequest[] | undefined> {
    return this.enqueue(async () => {
      if (!this.options.commits) return;
      const related = (requests: readonly CommitRequest[]) => requests.filter(request => request.owner === this.options.owner
        && equalValues(request.baseline.resource, this.options.snapshot.resource));
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (!this.canFollowSubmittedWork()) return;
        const before = this.session.checkpoint();
        const requests = await this.options.commits.list(); this.assertCurrent();
        if (!this.canFollowSubmittedWork() || !equalValues(before, this.session.checkpoint())) return;
        const [sources, manualChoices] = await Promise.all([
          this.options.manualReturnSources?.(related(requests)), this.options.manualChoiceSources?.(requests),
        ]);
        this.assertCurrent();
        if (!this.canFollowSubmittedWork() || !equalValues(before, this.session.checkpoint())) return;
        const continuation = liveSubmittedWork(this.options.owner, this.options.editorId, before, requests, sources, manualChoices);
        if (!continuation) return;
        const completedCommits = [...new Set([...this.completedCommits, ...continuation.acknowledged.map(request => request.id)])];
        const candidate = { ...this.record(), checkpoint: continuation.checkpoint, completedCommits };
        if (!await this.pinSubmittedWork(candidate)) return;
        const unchanged = () => !this.disposed && this.options.isCurrentOwner(this.options.owner)
          && this.canFollowSubmittedWork() && equalValues(before, this.session.checkpoint());
        if (!unchanged()) {
          // Typing mutates RAM immediately; this queue precedes its later capture/retirement write.
          await this.options.store.put(this.record()); return;
        }
        let current: CommitRequest[];
        let currentSources: ReadonlyMap<string, string> | undefined;
        let currentChoices: ManualChoiceSources | undefined;
        try {
          current = await this.options.commits.list();
          [currentSources, currentChoices] = await Promise.all([
            sources?.size ? this.options.manualReturnSources?.(related(current)) : undefined,
            manualChoices?.size ? this.options.manualChoiceSources?.(current) : undefined,
          ]);
        } catch (error) { await this.options.store.put(this.record()); throw error; }
        if (!unchanged()) { await this.options.store.put(this.record()); return; }
        if (!equalValues(related(requests), related(current)) || !sameManualSources(sources, currentSources)
          || !sameManualSources(manualChoices, currentChoices) || !sameLiveAtomicProof(continuation.atomicProof, current)) {
          // References prove existence, not the request revision, the unique frontier or the other action participants.
          await this.options.store.put(this.record()); continue;
        }
        this.session = DataSession.restore(continuation.checkpoint);
        this.completedCommits = completedCommits;
        this.result = continuation.answer ?? continuation.acknowledged.at(-1)?.result ?? this.result;
        const followed = current.filter(request => continuation.checkpoint.pending[request.id]);
        this.atomicPending = new Map(followed.flatMap(request => request.atomic ? [[request.id, request.atomic] as const] : []));
        this.held = shouldRetainCheckpoint(candidate);
        this.clearedCommits = completedCommits.length;
        this.durable = true; this.error = null; this.errorCode = null;
        this.emit();
        return followed;
      }
    });
  }

  private onCommit(request: CommitRequest): void {
    const resource = this.options.snapshot.resource;
    if (request.owner !== this.options.owner || this.disposed
      || request.baseline.resource.collection !== resource.collection || request.baseline.resource.id !== resource.id) return;
    void this.enqueue(async () => {
      const held = request.editorId === this.options.editorId || this.session.checkpoint().pending[request.id];
      if (!held && !await this.adoptSubmittedSuccessor(request)) return;
      await this.applyCommit(request);
    }).catch(() => undefined);
  }

  private async adoptSubmittedSuccessor(request: CommitRequest): Promise<boolean> {
    if (this.prepared || this.atomicPending.size || !this.options.commits
      || !['queued', 'prepared'].includes(request.state)) return false;
    const pending = this.session.checkpoint().pending;
    if (request.predecessor ? !pending[request.predecessor] : Object.keys(pending).length > 0) return false;
    // The current durable capture, not an older queued event, owns the published intent.
    const requests = await this.options.commits.list();
    this.assertCurrent();
    const current = requests.find(record => record.id === request.id);
    if (!current) return false;
    assertCommitCapture(current, request);
    const { owner, editorId, snapshot } = this.options;
    // Known competing branches stay separate; no event may choose one before this queue snapshot.
    const chain = submittedWorkCheckpoint(owner, snapshot.resource, requests);
    if (!chain?.pending[current.id]) return false;
    const source = readManualScopeIdentity(current.editorId);
    const predecessor = current.predecessor && requests.find(record => record.id === current.predecessor);
    const parent = predecessor && readManualScopeIdentity(predecessor.editorId)?.parentEditorId;
    if (parent === editorId && areDifferentTabManualParents(parent, source?.parentEditorId ?? current.editorId, snapshot.resource)) {
      return false;
    }
    if (!source || !areDifferentTabManualParents(source.parentEditorId, editorId, snapshot.resource)) {
      return this.session.adoptSubmittedSuccessor(current);
    }
    // An editor deciding its own Save must not select someone else's later descendant.
    if (!current.predecessor || !Object.values(pending).every(intent => intent.borrowedManualScope)) return false;
    const related = requests.filter(item => item.owner === owner && equalValues(item.baseline.resource, snapshot.resource));
    const borrowedScope = (await this.options.manualReturnSources?.(related))?.get(current.id);
    this.assertCurrent();
    const latest = this.session.checkpoint().pending;
    return Boolean(borrowedScope && latest[current.predecessor]?.borrowedManualScope
      && Object.values(latest).every(intent => intent.borrowedManualScope)
      && this.session.adoptSubmittedSuccessor(current, borrowedScope));
  }

  private async applyCommit(request: CommitRequest): Promise<void> {
    this.assertCurrent();
    // Forms and action scopes resolve their own refusals. A recovered editor can still own a document deletion.
    if (this.session.checkpoint().pending[request.id] && (editorSlot(request.editorId) === null
      || (request.retentionScope && readManualScopeIdentity(request.retentionScope)
        && (request.hardQuestionFieldActions || request.baseline.resource.collection === 'hardQuestionThemes')))
      && !isDocumentDeletion(request)) this.manualRequests.add(request.id);
    if (this.completedCommits.includes(request.id)) return;
    if (request.atomic && !['acknowledged', 'cancelled'].includes(request.state)) this.atomicPending.set(request.id, request.atomic);
    else this.atomicPending.delete(request.id);
    if (request.state === 'cancelled' && request.cancelledByAction) {
      const priorId = request.predecessor;
      if (isLiveWholeAction(request) && priorId && this.session.checkpoint().pending[priorId]) {
        const requests = await this.options.commits?.list(); this.assertCurrent();
        const prior = requests?.find(record => record.id === priorId && ['refused', 'conflict'].includes(record.state));
        this.result = prior?.result ?? null;
      } else if (!isRetiredActionDependent(request) || this.result?.operationId === request.id) {
        this.result = null;
      }
    }
    if (request.result && ['acknowledged', 'conflict', 'refused'].includes(request.state)) this.result = request.result;
    if (this.session.applyCommit(request)) this.completedCommits.push(request.id);
    // Cancelled elsewhere with nothing of ours left in flight: the old refusal or conflict answers nothing.
    if (request.state === 'cancelled' && !this.prepared && !Object.keys(this.session.checkpoint().pending).length) this.result = null;
    await this.persist();
  }

  private assertRecoveryChoice(expected?: EditorRecord): void {
    if (expected && recoveryChoiceFingerprint([this.record()]) !== recoveryChoiceFingerprint([expected])) {
      throw Object.assign(new Error('The shown saved copy changed'), { code: 'decision-changed' });
    }
  }

  /** An online choice uses the displayed words or stops to show any newly contested field. */
  private async refreshDocumentTextChoice(expected: EditorRecord): Promise<EditorRecord> {
    const { checkpoint } = expected;
    const compare = (state: SessionCheckpoint) => {
      if (state.confirmed.resource.collection === 'councils') {
        const review = readCouncilTopicTextReview(state);
        return review && { fields: review.fields, settled: review.settled };
      }
      if (state.confirmed.resource.collection === 'groups') {
        const review = readGroupTextReview(state);
        return review && { fields: review.fields, settled: review.settled };
      }
      if (state.confirmed.resource.collection === 'tags') return readTagColorConflict(state);
      if (state.confirmed.resource.collection === 'studyNotes') return readReturnedCommentText(state) ?? readStudyNoteReturnComparison(state);
      const review = readDocumentTextChoice(state);
      return review?.complete ? review.checkpoint.conflicts : undefined;
    };
    const review = compare(checkpoint);
    const shown = checkpoint.remoteCandidate;
    if (!review || !shown) return expected;
    this.assertRecoveryChoice(expected);
    const saved = await this.options.readWriteTarget?.(shown.resource).catch(() => null);
    this.assertCurrent();
    this.assertRecoveryChoice(expected);
    if (!saved || !canReplaceSnapshot(shown, saved) || equalValues(shown, saved)) return expected;
    this.session.observe(saved, { source: 'server' });
    const refreshed = this.record();
    await this.persist();
    this.assertCurrent();
    this.assertRecoveryChoice(refreshed);
    const updated = compare(refreshed.checkpoint);
    if (!equalValues(updated, review)) {
      throw Object.assign(new Error('The shown saved text changed'), { code: 'commit-changed' });
    }
    return refreshed;
  }

  /** Publish an editor's explicit choice only with its durable checkpoint. */
  private async resolveCommitChoice(choice: 'local' | 'remote', captures: ReadonlySet<object>,
    selection?: readonly ManualPath[], expected?: EditorRecord,
    correction?: { base: DocumentData; value: DocumentData },
    remoteChoice?: { draft: DocumentData | null; refused: boolean }, choiceTime?: ActionTime | null, titles?: readonly OutlineTitleDecision[]): Promise<void> {
    if (this.prepared) throw Object.assign(new Error('Resolve pending commands before replacing saved intent'), { code: PENDING_DELIVERY_FIRST });
    const shownCollection = expected?.checkpoint.confirmed.resource.collection;
    if (expected && !selection && !correction && (shownCollection === 'prayerRequests' || shownCollection === 'planTemplates' || shownCollection === 'tags'
      || (shownCollection === 'series' && expected.checkpoint.conflicts.some(isReturnedSeriesField))
      || (shownCollection === 'councils' && expected.checkpoint.conflicts.some(isCouncilHeaderComparison))
      || (shownCollection === 'groups' && expected.checkpoint.conflicts.some(isGroupStatusComparison))
      || (shownCollection === 'studyNotes' && (readReturnedCommentText(expected.checkpoint) || readStudyNoteReturnComparison(expected.checkpoint))))) {
      expected = await this.refreshDocumentTextChoice(expected);
    }
    const cancelled = Object.keys(this.session.checkpoint().pending);
    const selected = expected ? Object.keys(expected.checkpoint.pending) : undefined;
    const shown = this.record();
    const ordinary = !selection && !correction ? await this.ordinaryAnswerFor(cancelled) : undefined;
    const groupReview = ordinary && readGroupTextReview(shown.checkpoint);
    const councilReview = ordinary && readCouncilTopicTextReview(shown.checkpoint);
    const textReview = councilReview || groupReview;
    const reviewingText = Boolean(councilReview || groupReview && (shown.checkpoint.groupTextReview
      || ordinary.scope.length > 1 || groupReview.remaining.length > 1 || groupReview.settled.length
      || (expected && groupStatusOutsideChoice(shown.checkpoint, ordinary.first.id)) || shown.checkpoint.conflicts.some(isGroupStatusComparison)));
    const hasCouncilTextOrder = shown.checkpoint.conflicts.some(({ code }) => code === COUNCIL_TOPIC_TEXT_SETTLED || code === COUNCIL_TOPIC_TEXT_QUEUED);
    const hasGroupTextOrder = shown.checkpoint.conflicts.some(({ code }) => isOrderedGroupFlowText(code));
    if (reviewingText || shown.checkpoint.groupTextReview || hasCouncilTextOrder || hasGroupTextOrder) {
      if (!expected || !ordinary || !textReview || textReview.requestId !== ordinary.first.id
        || (shown.checkpoint.groupTextReview && (ordinary.first.id !== shown.checkpoint.groupTextReview.requestId
          || ordinary.first.revision !== shown.checkpoint.groupTextReview.revision))) {
        throw Object.assign(new Error('Finish comparing the changed fields'), { code: 'decision-changed' });
      }
      if (choice === 'local' && councilReview && councilReview.remaining[0]?.removed) {
        throw Object.assign(new Error('The section entry has been deleted'), { code: 'topic-gone' });
      }
      if (textReview.remaining.length > 1) {
        const { groupTextReview: _review, ...checkpoint } = shown.checkpoint;
        const next = councilReview ? councilTopicTextDecision(councilReview.remaining[0], choice, choiceTime ?? null)
          : groupTextDecision(groupReview!.remaining[0], choice, choiceTime);
        const decisions = [...textReview.decisions, next];
        let projected: EditorRecord | undefined;
        await this.options.commits!.stageGroupTextReview(ordinary.first, { checkpoint, decisions }, saved => {
          this.assertCurrent();
          this.assertRecoveryChoice(expected);
          if ([...this.pendingCaptures.boundary()].some(attempt => !captures.has(attempt))) {
            throw Object.assign(new Error('Finish the later Save before replacing saved intent'), { code: PENDING_DELIVERY_FIRST });
          }
          projected = { ...shown, checkpoint: { ...checkpoint, groupTextReview: { requestId: saved.id, revision: saved.revision, decisions } } };
          return projected;
        });
        if (!projected) throw new Error('Group text review checkpoint was not captured');
        await this.applyChoiceProjection(shown.checkpoint, projected, captures, undefined, true);
        await this.persistGroupTextEdit();
        return;
      }
    }
    const sourceNoteComparison = readSourceNoteLinkComparison(shown.checkpoint);
    const sourceNoteTail = !selection && !correction && sourceNoteComparison && ordinary
      ? sourceNoteChoiceTail(ordinary, shown.checkpoint.remoteCandidate) : undefined;
    const placeComparison = readCommentPlaceComparison(shown.checkpoint);
    const placeTail = !selection && !correction && placeComparison && ordinary ? commentPlaceTextTail(ordinary) : undefined;
    const positionRefused = ordinary && isAnchoredPlacementRefusal(ordinary.first);
    let savedOrder: ResourceSnapshot | null | undefined;
    if (positionRefused) {
      if (choice !== 'remote') throw placementUnavailable();
      savedOrder = await this.options.readWriteTarget?.(shown.checkpoint.confirmed.resource) ?? this.session.checkpoint().remoteCandidate;
      this.assertCurrent();
      if (!savedOrder) throw Object.assign(new Error('Read the saved order before choosing'), { code: 'fresh-read-required' });
      await this.options.publishStoredChoice?.(savedOrder);
      this.assertCurrent();
    }
    const planTail = ordinary?.scope.at(-1);
    const refusedPoint = !selection && !correction && ordinary?.answer.kind === 'refused' && planTail && !ordinary.branched
      && (choice === 'remote' || ordinary.scope.length === 1)
      && Object.keys(shown.checkpoint.pending).length === ordinary.scope.length
      && ordinary.scope.every(request => request.editorId === ordinary.first.editorId
        && request.baseline.metadata?.generation === shown.checkpoint.confirmed.metadata?.generation
        && equalValues(shown.checkpoint.pending[request.id]?.value, request.value))
      && hasLaterPendingExegeticalTitle(shown.checkpoint, planTail.id) ? ordinary : undefined;
    let savedPlan: ResourceSnapshot | undefined;
    if (refusedPoint) {
      const live = await this.options.readWriteTarget?.(shown.checkpoint.confirmed.resource);
      this.assertCurrent();
      if (!live?.value || !canReplaceSnapshot(shown.checkpoint.remoteCandidate ?? shown.checkpoint.confirmed, live)) {
        throw Object.assign(new Error('Read the current sermon before reviewing the point'), { code: 'fresh-read-required' });
      }
      savedPlan = live;
    }
    let source: SessionCheckpoint | undefined;
    let projected: EditorRecord | undefined;
    let anchoredChoice: string | undefined;
    const ids = ordinary ? [ordinary.first.id] : selected ?? cancelled;
    const decidingEditor = ordinary || selected ? '' : this.options.editorId;
    await this.options.commits!.cancelWithCheckpoint(decidingEditor, ids, retired => {
        this.assertCurrent();
        this.assertRecoveryChoice(expected);
        const checkpoint = expected?.checkpoint;
        const path = checkpoint?.conflicts.length === 1 ? checkpoint.conflicts[0].path : undefined;
        const collection = checkpoint?.confirmed.resource.collection;
        const comparedField = Boolean(checkpoint?.serviceOrderPlacementComparison || (checkpoint && (readOutlinePointPlacementComparison(checkpoint) || readOutlineParentComparison(checkpoint) || readStudyNoteReferenceComparison(checkpoint) || readGroupFlowTextChoice(checkpoint) || readCouncilSummaryChoice(checkpoint)))) || isAutosaveRowFieldPath(path, collection ?? '') || (collection === 'serviceOrders' ? serviceOrderStepField(path)
          : collection === 'councils' ? councilAssemblyRow(path) || councilTopicKindRow(path)
            : path?.length === 1 && (collection === 'planTemplates' && path[0] === 'name' || collection === 'tags' && path[0] === 'color' || collection === 'studyNotes' && path[0] === 'type'));
        if (expected && (comparedField || Boolean(sourceNoteComparison && !ordinary) || retired.some(request => expected.checkpoint.pending[request.id]
          && (request.serviceOrderFlagActions || request.serviceOrderStepTitleActions || request.serviceOrderStepBodyActions || request.serviceOrderStepScriptureActions || request.outlinePointPlacement || request.groupFlowStepPlacement || request.councilTopicPlacement || hasAutosaveRowFieldCaptures(request)
            || request.councilAssemblyActions || request.councilTopicKindActions || request.planTemplateNameAction || request.tagColorAction || request.studyNoteTypeAction)))
          && retired.some(request => !expected.checkpoint.pending[request.id])) {
          throw Object.assign(new Error('Another saved change appeared during the field choice'), { code: 'decision-changed' });
        }
        if (ordinary) {
          if (ordinary.scope.length > 1) this.assertRecoveryChoice(shown);
          assertOrdinaryAnswerScope(ordinary, retired);
        }
        // A newer explicit Save owns its capture. Do not checkpoint later RAM over it.
        if ([...this.pendingCaptures.boundary()].some(attempt => !captures.has(attempt))) {
          throw Object.assign(new Error('Finish the later Save before replacing saved intent'), { code: PENDING_DELIVERY_FIRST });
        }
        const record = this.record();
        source = record.checkpoint;
        this.assertChoiceAuthority(source);
        this.assertManualResolution(selection, source);
        const answered = ordinary && !refusedPoint ? ordinaryChoiceCheckpoint(ordinary, source, reviewingText) : source;
        const reviewedSeriesText = selection && choice === 'remote'
          && manualSeriesTextChoiceFields(answered.confirmed, answered.remoteCandidate, answered.conflicts, selection, answered.draft);
        const documentTextChoice = (!selection || reviewedSeriesText) && !correction ? readDocumentTextChoice(answered) : undefined;
        const projectedWords = documentTextChoice?.checkpoint ?? answered;
        const commentWords = !selection && !correction ? readReturnedCommentText(projectedWords) : undefined;
        const commentOriginal = commentWords && (ordinary?.first ?? retired.find(request => projectedWords.pending[request.id]
          && request.result?.kind === 'conflict' && request.result.conflicts.some(conflict => conflict.code === COMMENT_TEXT_REVIEW)));
        const commentCompanions = commentWords ? commentCompanionProofs(projectedWords, commentOriginal) : {};
        const decided = commentTextChoiceBasis(projectedWords, commentCompanions);
        const separateGroupStatus = ordinary && !reviewingText ? groupStatusOutsideChoice(decided, ordinary.first.id) : undefined;
        const orderedDateField = decided.confirmed.resource.collection === 'sermons' && decided.conflicts.some(isOrderedPreachDateField);
        const atChoice = decided === source ? remoteChoice?.draft : undefined;
        const local = atChoice === undefined ? decided.draft : atChoice;
        const groupText = !reviewingText && !selection && readGroupFlowTextChoice(decided, local);
        const councilSummary = !selection && !correction && readCouncilSummaryChoice(decided, local);
        const remainingDraft = groupText ? writeGroupFlowTextChoice(local, groupText, 'before')
          : councilSummary ? writeCouncilSummaryChoice(local, councilSummary, 'before') : undefined;
        const textRemainder = remainingDraft && decided.confirmed.value && decided.remoteCandidate?.value
          ? mergeDocumentFields(decided.confirmed.value, remainingDraft, decided.remoteCandidate.value) : undefined;
        if (textRemainder?.conflicts.some(({ path }) => !separateGroupStatus || !equalValues(path, ['status']))) {
          throw Object.assign(new Error('Other changes need review'), { code: 'decision-changed' });
        }
        const placeOpening = !selection && !correction ? commentPlaceChoiceOpening(decided) : undefined;
        const textChoice = ordinary?.first.commentTextOpening && decided.conflicts.length === 1
          && equalValues(decided.conflicts[0].path, ['content']);
        const preference = !selection && !correction ? readAccountPreferenceComparison(decided) : undefined;
        const stepText = !selection && !correction ? readServiceStepTextChoice(decided, local) : undefined;
        const serviceInput = !selection && !correction ? Object.values(decided.serviceOrderInputs ?? {})
          .find(input => isReturnedServiceOrderInput(decided, input)) : undefined;
        const scriptureRow = !selection && !correction ? serviceStepScriptureConflict(decided) : undefined;
        const scriptureRows = scriptureRow ? [scriptureRow]
          : !selection && !correction ? reviewedServiceStepScriptureRows(decided) : [];
        const session = DataSession.restore(decided);
        const completed = new Set(record.completedCommits ?? []);
        for (const id of Object.keys(source.pending)) { session.release(id); completed.add(id); }
        if (reviewingText) {
          const council = readCouncilTopicTextReview(decided);
          const group = council ? undefined : readGroupTextReview(decided);
          const review = council || group;
          if (!review || review.remaining.length > 1 || review.requestId !== ordinary?.first.id) {
            throw Object.assign(new Error('The shown text changed'), { code: 'decision-changed' });
          }
          const last = council?.remaining[0] ? councilTopicTextDecision(council.remaining[0], choice, choiceTime ?? null)
            : group && group.remaining[0] ? groupTextDecision(group.remaining[0], choice, choiceTime) : undefined;
          const decisions = last ? [...review.decisions, last] : review.decisions;
          const chosen = council ? projectCouncilTopicTextDecisions(council, decisions) : projectGroupTextDecisions(group!, decisions);
          if (!chosen) throw Object.assign(new Error('The reviewed field changed'), { code: 'decision-changed' });
          const sameWriter = ordinary && ordinary.scope.every(request => request.editorId === ordinary.first.editorId);
          const tailOpening = sameWriter ? source.pending[ordinary.first.id].value : null;
          const laterDraft = source.draft;
          const independent = tailOpening && laterDraft && (group
            ? [...group.fields, ...group.settled.map(({ field }) => field)].every(field => sameGroupText(tailOpening, laterDraft, field))
            : council && [...council.fields, ...council.settled.map(({ field }) => field)].every(({ path }) => {
              const later = councilTopicTextVersions(path, tailOpening, laterDraft, tailOpening);
              return later && equalValues(later.mine, later.stored);
            }));
          const tail = independent && mergeDocumentFields(tailOpening, laterDraft, chosen);
          const keptTail = tail && tail.value.exists && !tail.conflicts.length ? tail.value.value as DocumentData : undefined;
          session.acceptRemote();
          session.clearGroupTextReview();
          session.edit(keptTail ?? chosen);
          const kept = decisions.filter(decision => decision.side === 'local');
          if (council) {
            session.retainUnreviewedAutosaveActions(withCouncilReviewProofs(keptTail ? source : decided, council, keptTail ?? chosen), council.fields);
            for (const { path, time } of kept) session.stageReviewedCouncilText(path, time ?? null);
          } else {
            const queued = group!.settled.flatMap(({ field, side }) => side === 'mine' ? [field] : []);
            const scalars = queued.flatMap(field => !('target' in field) ? [field] : []);
            const rows = queued.flatMap(field => 'target' in field ? [field] : []);
            const proofSource = keptTail ? source : decided;
            const retained = withQueuedGroupScalarProofs(withSubmittedScalarProofs(proofSource, review.requestId, keptTail ?? chosen), scalars);
            session.retainUnreviewedAutosaveActions(withQueuedRowFieldProofs(retained, rows), review.fields);
            for (const { path, time } of kept) {
              const [field] = path;
              if (path.length === 1 && (field === 'description' || field === 'title' || field === 'status')) session.stageReviewedGroupField(field, time ?? null);
              else session.stageReviewedGroupFlowText([path], time ?? null);
            }
          }
          const intent = session.checkpoint();
          const action = council && reviewedCouncilDetailAction(council, decisions, intent.confirmed, intent.draft, ordinary?.first);
          const replacement = this.options.commits!.choiceReplacement(record.editorId, intent, { action: action || undefined });
          if (replacement) session.applyCommit(replacement);
          projected = { ...record, checkpoint: session.checkpoint(), completedCommits: [...completed] };
          const recovery = ordinary && !keptTail ? projectOrdinaryChoiceDependents(
            record.owner, ordinary, projected.checkpoint.confirmed, projected.checkpoint.draft, retired) : undefined;
          const latest = ordinary && !keptTail && ordinary.scope.findLast(request => source!.pending[request.id]);
          const unsavedTail = latest && anchoredPlacementChoiceTail(source, latest.id);
          const retained = unsavedTail && retainedAnchoredPlacementDraft(record.owner, record.editorId, review.requestId,
            'unqueued', source, projected.checkpoint.confirmed, unsavedTail.base, unsavedTail.value);
          const removed = council && retainedCouncilTopicWords(decided, council);
          const removedCopy = council && removed && retainedAnchoredPlacementDraft(record.owner, record.editorId, council.requestId,
            'removed-topic', decided, projected.checkpoint.confirmed, removed.base, removed.value);
          return { editorRecords: [projected, ...(recovery?.editorRecords ?? []), ...(retained ? [retained] : []),
            ...(removedCopy ? [removedCopy] : [])], manualRecoveries: recovery?.manualRecoveries ?? [], replacements: replacement ? [replacement] : [] };
        }
        if (refusedPoint && planTail && savedPlan) {
          if (!hasLaterPendingExegeticalTitle(decided, planTail.id)
            || !canReplaceSnapshot(decided.remoteCandidate ?? decided.confirmed, savedPlan)) {
            throw Object.assign(new Error('The later point edit changed'), { code: 'decision-changed' });
          }
          const rootId = refusedPoint.first.id;
          const captured = decided.pending[rootId];
          // Only the refused Save owns the decision. The latest draft contains the rest of this editor's chain.
          const retained = DataSession.restore({ ...decided, pending: { [rootId]: captured } });
          retained.observe(savedPlan, { source: 'server' });
          const retirement = retired.find(request => request.id === rootId)!;
          retained.applyCommit(retirement);
          const checkpoint = retained.checkpoint();
          const separated = refusedPoint.scope.length > 1
            ? separateRefusedSermonTail(decided, checkpoint, refusedPoint.scope) : { checkpoint, copies: [] };
          if (!separated) throw Object.assign(new Error('The later saved work needs its own review'), { code: 'other-changes-first' });
          projected = { ...record, checkpoint: separated.checkpoint, completedCommits: [...completed] };
          if (!separated.copies.length) return projected;
          const copies = separated.copies.map(({ key, continuation, recoveryKind }): EditorRecord => ({
            owner: record.owner, editorId: manualChoiceRecoveryIdentity(rootId, key, recoveryKind),
            checkpoint: continuation, prepared: null, unfinalized: [], autoSaveOnResume: false,
          }));
          return { editorRecords: [projected, ...copies], manualRecoveries: [] };
        }
        const stepRequest = ordinary ? ordinary.first : retired.find(request => request.cancelledByChoice
          && source!.pending[request.id] && request.serviceOrderStepPlacement);
        const selectedStepMove = stepRequest?.serviceOrderStepPlacement;
        const stepAnswer = stepRequest?.result;
        const outlineRequest = ordinary ? ordinary.first : retired.find(request => request.cancelledByChoice
          && source!.pending[request.id] && request.outlinePointPlacement);
        const outlineMove = outlineRequest?.outlinePointPlacement;
        const outlineChoice = outlineMove && readOutlinePointPlacementComparison(decided);
        const positionRequest = ordinary ? ordinary.first : retired.find(request => request.cancelledByChoice
          && source!.pending[request.id] && (request.groupFlowStepPlacement || request.councilTopicPlacement));
        const groupMove = positionRequest?.groupFlowStepPlacement;
        const councilMove = positionRequest?.councilTopicPlacement;
        const positionMove = groupMove ?? councilMove;
        let retainedPlacementTail: EditorRecord | undefined;
        const preservePlacementTail = (requestId: string, tail?: { base: DocumentData; value: DocumentData }, separate = false) => {
          if (tail && (separate || !session.retainAnchoredPlacementChoiceEdits(source!, tail.base, tail.value))) {
            retainedPlacementTail = retainedAnchoredPlacementDraft(record.owner, record.editorId, requestId, 'unqueued',
              source!, session.checkpoint().confirmed, tail.base, tail.value);
          }
        };
        const scratchText = !selection && !correction ? pendingGuardedScratchTextReview(source) : undefined;
        const scratchRemoval = !selection && !correction ? pendingScratchRemoval(source) : undefined;
        const rowRemoval = scratchRemoval ?? (!selection && !correction ? pendingThoughtRemoval(source) : undefined);
        if (scratchText) {
          if (!expected || !ordinary || ordinary.first.id !== scratchText.requestId || !source.remoteCandidate
            || !equalValues(decided.remoteCandidate, source.remoteCandidate) || (choice === 'local' && !scratchText.proposed)) {
            throw Object.assign(new Error('The compared sketch text changed'), { code: 'decision-changed' });
          }
          anchoredChoice = scratchText.requestId;
          session.acceptRemote();
          if (choice === 'local' && scratchText.proposed) session.edit(scratchText.proposed);
          const latest = ordinary.scope.filter(request => source!.pending[request.id]).at(-1);
          preservePlacementTail(anchoredChoice, latest && anchoredPlacementChoiceTail(source, latest.id), true);
        } else if (rowRemoval) {
          if (!expected || !ordinary || ordinary.first.id !== rowRemoval.requestId || !source.remoteCandidate
            || !equalValues(decided.remoteCandidate, source.remoteCandidate)
            || (choice === 'local' && rowRemoval.settled)) {
            throw Object.assign(new Error('The compared removal has changed'), { code: 'decision-changed' });
          }
          anchoredChoice = rowRemoval.requestId;
          session.acceptRemote();
          if (choice === 'local' && !rowRemoval.settled) session.edit(rowRemoval.proposed);
          const latest = ordinary.scope.filter(request => source!.pending[request.id]).at(-1);
          preservePlacementTail(anchoredChoice, latest && anchoredPlacementChoiceTail(source, latest.id), true);
        } else if (ordinary && savedOrder) {
          anchoredChoice = ordinary.first.id;
          session.observe(savedOrder, { source: 'server' });
          if (session.checkpoint().remoteCandidate) session.acceptRemote();
          else session.dropRefused(decided.draft);
          const latest = ordinary.scope.filter(request => source!.pending[request.id]).at(-1);
          preservePlacementTail(ordinary.first.id, latest && anchoredPlacementChoiceTail(source, latest.id));
        } else if (positionRequest && positionMove && positionRequest.result?.kind === 'conflict') {
          anchoredChoice = positionRequest.id;
          const answer = positionRequest.result;
          const comparison = answer.serviceOrderPlacementComparison;
          const proposed = source.pending[positionRequest.id]?.value;
          const tailRequest = ordinary?.scope.filter(request => source!.pending[request.id]).at(-1)?.id
            ?? (Object.keys(source.pending).length === 1 ? positionRequest.id : undefined);
          const tail = tailRequest ? anchoredPlacementChoiceTail(source, tailRequest) : undefined;
          if (comparison?.step?.id !== positionMove.placement.stepId
            || (!tail && !equalValues(proposed, decided.draft) && !equalValues(positionRequest.intended, decided.draft))) {
            throw Object.assign(new Error('Other changes need review'), { code: 'other-changes-first' });
          }
          session.acceptRemote();
          if (choice === 'local') {
            const accepted = session.checkpoint().confirmed;
            requireFreshGeneration(answer, positionRequest.command?.generation ?? positionMove.generation, accepted);
            const saved = comparison.available && comparison.saved;
            const reviewed = saved && { previous: saved.previous?.id ?? null, next: saved.next?.id ?? null };
            if (groupMove && reviewed) {
              const retry = retryGroupStepPlacement(accepted, groupMove, reviewed, choiceTime ?? null);
              if (!retry) throw placementUnavailable();
              if (retry.capture) session.stageGroupStepPlacementRetry(retry.capture, retry.draft);
            } else if (councilMove && reviewed) {
              const retry = retryCouncilTopicPlacement(accepted, councilMove, reviewed, choiceTime ?? null);
              if (!retry) throw placementUnavailable();
              if (retry.capture) session.stageCouncilTopicPlacementRetry(retry.capture, retry.draft);
            } else throw placementUnavailable();
          }
          preservePlacementTail(positionRequest.id, tail);
        } else if (outlineRequest && outlineMove && outlineRequest.result?.kind === 'conflict' && outlineChoice) {
          const submitted = source.pending[outlineRequest.id]?.value;
          const rebased = outlineRequest.initialized ? outlineRequest.intended : outlineRequest.value;
          const template = decided.confirmed.resource.collection === 'planTemplates';
          const latest = template && (ordinary?.scope.filter(request => source!.pending[request.id]).at(-1)?.id ?? outlineRequest.id);
          const tail = latest ? anchoredPlacementChoiceTail(source, latest) : undefined;
          if (template) anchoredChoice = outlineRequest.id;
          if (!tail && !equalValues(submitted, decided.draft) && !equalValues(rebased, decided.draft)) {
            throw Object.assign(new Error('Other changes need review'), { code: 'other-changes-first' });
          }
          session.acceptRemote();
          if (choice === 'local') {
            const accepted = session.checkpoint().confirmed;
            requireFreshGeneration(outlineRequest.result, outlineRequest.command?.generation ?? outlineMove.generation, accepted);
            const retry = outlineChoice.available && retryOutlinePointPlacement(accepted, outlineChoice.pointId,
              outlineChoice.mine, outlineChoice.saved, choiceTime ?? null);
            if (!retry) throw Object.assign(new Error('The proposed position is unavailable or has changed'), { code: 'decision-changed' });
            session.stageOutlinePointPlacementRetry(retry.move, retry.draft);
          }
          preservePlacementTail(outlineRequest.id, tail, choice === 'local');
        } else if (stepRequest && selectedStepMove && stepAnswer?.kind === 'conflict' && stepAnswer.serviceOrderPlacementComparison) {
          const comparison = stepAnswer.serviceOrderPlacementComparison;
          const proposed = source.pending[stepRequest.id]?.value;
          if (!equalValues(proposed, decided.draft) || (comparison?.step?.id !== selectedStepMove.placement.stepId)) {
            throw Object.assign(new Error('Other changes need review'), { code: 'other-changes-first' });
          }
          session.acceptRemote();
          if (choice === 'local') {
            const accepted = session.checkpoint().confirmed;
            const generation = accepted.metadata?.generation ?? null;
            requireFreshGeneration(stepAnswer, stepRequest.command?.generation ?? selectedStepMove.generation, accepted);
            const { stepId, destination } = selectedStepMove.placement;
            const steps = placementSteps(accepted.value?.steps);
            const opening = steps && stepGap(steps, stepId);
            const projected = steps && projectServiceOrderStep(steps, stepId, destination);
            const reviewed = comparison?.saved && { previous: comparison.saved.previous?.id ?? null, next: comparison.saved.next?.id ?? null };
            if (!comparison?.available || !steps || !opening || !projected || !equalValues(opening, reviewed)) {
              throw Object.assign(new Error('The proposed position is unavailable or has changed'), { code: 'decision-changed' });
            }
            const actualDestination = stepGap(projected, stepId)!;
            session.stageServiceOrderStepPlacementRetry({ generation, shownIds: steps.map(step => step.id), placement: {
              stepId, opening, destination: actualDestination, observedRevision: accepted.metadata?.revision ?? 0, time: choiceTime ?? null,
            } }, projected);
          }
        } else if (serviceInput) {
          session.acceptRemote();
          session.retainServiceOrderChoiceFields(decided, choice === 'remote' ? serviceInput : undefined);
        } else if (choice === 'local') {
          if (ordinary) {
            const rejected = ordinary.first.command ? ordinary.first.command.generation : decided.confirmed.metadata?.generation;
            requireFreshGeneration(ordinary.answer, rejected, decided.remoteCandidate);
          }
          const stored = decided.remoteCandidate?.value;
          const rowRequests = ordinary ? [ordinary.first] : retired.filter(request => request.cancelledByChoice && source!.pending[request.id]);
          for (const request of rowRequests) assertCouncilTopicChoice(request.result);
          if (stored && rowRequests.some(request => {
            const step = request.serviceOrderFlagActions?.flagged ?? request.serviceOrderStepTitleActions?.title
              ?? request.serviceOrderStepBodyActions?.body ?? request.serviceOrderStepScriptureActions?.scriptureRefs;
            return (step && !hasServiceOrderStep(stored.steps, step.rowId))
              || request.serviceOrderStepScriptureActions?.reviewed?.some(({ rowId }) => !hasServiceOrderStep(stored.steps, rowId));
          })) throw Object.assign(new Error('The step that was edited is gone'), { code: 'service-order-step-gone' });
          if (scriptureRows.some(row => !stored || !hasServiceOrderStep(stored.steps, row))) {
            throw Object.assign(new Error('The step that was edited is gone'), { code: 'service-order-step-gone' });
          }
          if (stored && rowRequests.some(request => {
            const selected = request.councilAssemblyActions?.forAssembly ?? request.councilTopicKindActions?.kind;
            return (selected && !hasCouncilTopic(stored.topics, selected.rowId))
              || (request.baseline.resource.collection === 'councils' && missingAutosaveRowFieldTarget(stored, request));
          })) {
            throw Object.assign(new Error('The section that was edited is gone'), { code: 'topic-gone' });
          }
          if (stored && rowRequests.some(request => request.baseline.resource.collection === 'groups' && missingAutosaveRowFieldTarget(stored, request))) {
            throw Object.assign(new Error('The block or step that was edited is gone'), { code: 'decision-changed' });
          }
          if (stored && rowRequests.some(request => request.baseline.resource.collection === 'sermons'
            && (missingAutosaveRowFieldTarget(stored, request, decided.conflicts) || changedThoughtTagTarget(stored, request)))) {
            throw Object.assign(new Error('The edited item is gone'), { code: 'decision-changed' });
          }
          const statusActions = ordinary ? ordinary.first.preachStatusActions
            : retired.flatMap(request => request.cancelledByChoice && source!.pending[request.id] ? request.preachStatusActions ?? [] : []);
          session.keepLocal(statusActions, choiceTime, decided, titles);
          if (groupText) {
            const reviewed = writeGroupFlowTextChoice(session.checkpoint().draft, groupText, 'mine');
            if (!reviewed) throw Object.assign(new Error('The reviewed text changed'), { code: 'decision-changed' });
            session.edit(reviewed);
            if (groupText.field === 'groupStatus') session.stageReviewedGroupField('status', choiceTime ?? null);
            else if (groupText.field === 'description' || groupText.field === 'title') session.stageReviewedGroupField(groupText.field, choiceTime ?? null);
            else session.stageReviewedGroupFlowText([groupText.path], choiceTime ?? null);
          }
          if (councilSummary) {
            const reviewed = writeCouncilSummaryChoice(session.checkpoint().draft, councilSummary, 'mine');
            if (!reviewed) throw Object.assign(new Error('The reviewed section changed'), { code: 'decision-changed' });
            session.edit(reviewed);
            session.stageReviewedCouncilSummary(councilSummary.path, choiceTime ?? null);
          }
          if (preference) session.stageAccountPreferenceRetry(preference.field, choiceTime ?? null);
          const selectedMove = ordinary && ordinary.first.serviceOrderPlacement;
          if (selectedMove) {
            const answer = ordinary && ordinary.first.result;
            if (answer?.kind !== 'conflict' || !answer.serviceOrderPlacementComparison?.available) {
              throw Object.assign(new Error('The proposed position is unavailable'), { code: 'decision-changed' });
            }
            const accepted = session.checkpoint().confirmed;
            const generation = accepted.metadata?.generation ?? null;
            if (generation !== selectedMove.generation || !accepted.value) throw Object.assign(new Error('The order changed'), { code: 'decision-changed' });
            const { opening, destination } = selectedMove.placement;
            session.stageServiceOrderPlacementRetry({ ...selectedMove, before: readField(accepted.value, ['rank']),
              placement: { opening, destination, observedRevision: accepted.metadata?.revision ?? 0, time: choiceTime ?? null } });
          }
          if (correction) {
            const current = session.checkpoint();
            const note = preachDateChoiceFrames(correction.base, correction.value, current.draft, decided.conflicts);
            const merged = mergeDocumentFields(note.basis, note.draft, current.draft);
            const status = chooseLocalPreachDateEdits({ ...decided.confirmed, value: note.basis }, note.draft,
              { ...current.confirmed, value: current.draft }, statusActions);
            session.edit(status ?? chooseLocalPlacement(current.confirmed.resource.collection,
              note.basis, note.draft, current.draft,
              merged.value.exists ? merged.value.value as DocumentData : null, mergeFields));
          }
        } else {
          const chosenPath = preference?.path ?? (!selection && decided.serviceOrderPlacementComparison ? ['rank'] : undefined);
          const retainedFields = textRemainder ?? (chosenPath && local && decided.confirmed.value && decided.remoteCandidate?.value
            ? mergeDocumentFields(decided.confirmed.value,
              writeField(local, chosenPath, readField(decided.confirmed.value, chosenPath)), decided.remoteCandidate.value) : undefined);
          if (retainedFields?.conflicts.length) throw Object.assign(new Error('Other changes need review'), { code: 'decision-changed' });
          const meeting = decided.confirmed.resource.collection === 'groups' && firstGroupMeetingReview(decided.conflicts);
          const retainedMeeting = meeting && decided.remoteCandidate?.value
            ? projectFirstGroupMeetingChoice(decided.remoteCandidate.value, meeting, 'remote') : undefined;
          const retainedOutline = projectOutlineParentChoice(decided.confirmed, local, decided.remoteCandidate, decided.conflicts, 'remote', titles);
          const retainedDocumentFields = documentTextChoice?.complete && decided.confirmed.value && decided.draft && decided.remoteCandidate?.value
            ? keepUncontestedDocumentText(decided.confirmed.value, decided.draft, decided.remoteCandidate.value, documentTextChoice.fields, decided.confirmed.resource.collection)
            : undefined;
          const retainedPreachDate = orderedDateField
            ? keepUncontestedSermonFields(decided.confirmed, local, decided.remoteCandidate, decided.conflicts) : undefined;
          const retained = retainedMeeting ?? retainedOutline ?? retainedDocumentFields ?? retainedPreachDate ?? (!selection && ((retainedFields?.value.exists ? retainedFields.value.value as DocumentData : undefined)
            ?? (stepText ? keepUncontestedServiceStepText(decided, local, stepText.rowId, stepText.field) : undefined)
            ?? (scriptureRow ? keepUncontestedServiceStepScripture(decided, local, scriptureRow) : undefined)
            ?? projectHardQuestionThemeOrders(decided.confirmed, local, decided.remoteCandidate, decided.conflicts, 'remote')
            ?? keepUncontestedOutlineTitle(decided.confirmed, local, decided.remoteCandidate, decided.conflicts)
            ?? keepUncontestedSermonFields(decided.confirmed, local, decided.remoteCandidate, decided.conflicts)
            ?? keepUncontestedDocumentTagFields(decided.confirmed, local, decided.remoteCandidate, decided.conflicts)
            ?? keepUncontestedStudyNoteFields(decided.confirmed, local, decided.remoteCandidate, decided.conflicts)
            ?? keepUncontestedCommentFields(decided.confirmed, local, decided.remoteCandidate, decided.conflicts)
            ?? keepUncontestedCommentPlace(decided.confirmed, local, decided.remoteCandidate, decided.conflicts)
            ?? keepUncontestedCommentText(decided)));
          session.acceptRemote(atChoice);
          if (retained) {
            const accepted = session.checkpoint();
            const merged = mergeDocumentFields(accepted.confirmed.value, accepted.draft, retained);
            if (merged.value.exists) session.edit(merged.value.value as DocumentData);
            session.retainOutlineTitleActions(decided);
            session.stageOutlineReviewTitles(titles);
            if (textRemainder) session.retainUnreviewedAutosaveActions(decided);
          }
          if (remoteChoice?.refused && !decided.remoteCandidate) {
            session.dropRefused(decided === source ? remoteChoice.draft : decided.draft);
          }
          if (ordinary?.scope.length === 1 && ordinary.answer.kind === 'conflict'
            && ordinary.first.baseline.metadata?.generation === session.checkpoint().confirmed.metadata?.generation) {
            session.retainStudyNoteBodyAfterChoice(ordinary.first.value, source.draft, ordinary.answer.conflicts);
          }
        }
        if (separateGroupStatus) {
          const { confirmed, draft } = session.checkpoint();
          const status = separateGroupStatus.action.after;
          if (draft && confirmed.value?.status !== status) {
            session.edit({ ...draft, status });
            session.retainUnreviewedAutosaveActions({ ...decided, groupStatusDraft: separateGroupStatus });
          }
        }
        const serviceChoiceIntent = (checkpoint: SessionCheckpoint) => serviceInput
          ? { ...checkpoint, draft: projectServiceOrderInput(checkpoint.confirmed.value, serviceInput) } : checkpoint;
        const replacements: CommitRequest[] = [];
        if (decided.confirmed.resource.collection === 'hardQuestionThemes'
          && decided.conflicts.some(({ path }) => hardQuestionThemeListPath(path)) && session.checkpoint().dirty) {
          const replacement = this.options.commits!.choiceReplacement(record.editorId, session.checkpoint(), {});
          if (!replacement) throw Object.assign(new Error('The chosen theme order could not be captured'), { code: 'decision-changed' });
          session.applyCommit(replacement);
          replacements.push(replacement);
        }
        if (scratchText?.opening && choice === 'local') {
          const replacement = this.options.commits!.choiceReplacement(record.editorId, session.checkpoint(),
            { scratchTextRecovery: true, action: { kind: 'sermon-note-text', opening: scratchText.opening } });
          if (!replacement) throw Object.assign(new Error('The sketch edit could not be captured'), { code: 'decision-changed' });
          session.applyCommit(replacement);
          replacements.push(replacement);
        }
        if (rowRemoval && choice === 'local') {
          const replacement = this.options.commits!.choiceReplacement(record.editorId, session.checkpoint(),
            scratchRemoval ? { scratchRemoval: true } : {});
          if (!replacement) throw Object.assign(new Error('The removal could not be captured'), { code: 'decision-changed' });
          session.applyCommit(replacement);
          replacements.push(replacement);
        }
        const meeting = decided.confirmed.resource.collection === 'groups' && firstGroupMeetingReview(decided.conflicts);
        if (meeting) {
          const next = session.checkpoint();
          const request = retired.find(item => item.result?.kind === 'conflict' && firstGroupMeetingReview(item.result.conflicts));
          const review = captureGroupMeetingReview(next.confirmed, next.draft, meeting, decided.conflicts, choiceTime ?? null, request);
          if (review && next.dirty) {
            const replacement = this.options.commits!.choiceReplacement(record.editorId, { ...next, groupMeetingReview: review }, {});
            if (replacement) { session.applyCommit(replacement); replacements.push(replacement); }
          }
        }
        if (orderedDateField || (choice === 'local' && decided.conflicts.some(unresolvedPreachDateField))) {
          const next = session.checkpoint();
          const request = ordinary?.first ?? retired.find(item => decided.pending[item.id]
            && item.result?.kind === 'conflict' && item.result.conflicts.some(isOrderedPreachDateField));
          carryOrderedPreachDateFields(next, request);
          const replacement = next.dirty && this.options.commits!.choiceReplacement(record.editorId, next, {});
          if (replacement) { session.applyCommit(replacement); replacements.push(replacement); }
        }
        if (documentTextChoice && (choice === 'local' || documentTextChoice.complete) && session.checkpoint().dirty) {
          const time = choiceTime ?? null;
          const original = ordinary?.first ?? retired.find(request => answered.pending[request.id] && request.result?.kind === 'conflict');
          const collection = decided.confirmed.resource.collection;
          let action: EditorCommitAction | undefined;
          if (collection === 'series') action = { kind: 'document-metadata', time: choice === 'local' ? time : null,
            ...(documentTextChoice.fields[0] !== 'description' && { seriesFieldReview: { fields: documentTextChoice.fields, original: original?.seriesFieldActions ?? {} } }) };
          else if (collection === 'prayerRequests') action = retryPrayerTextChoice(documentTextChoice, choice, original, session.checkpoint().draft, time);
          else if (choice === 'local' && documentTextChoice.title) {
            action = { kind: 'plan-template-name', name: { seen: documentTextChoice.title, time } };
          }
          const replacement = this.options.commits!.choiceReplacement(record.editorId, session.checkpoint(), { action });
          if (replacement) { session.applyCommit(replacement); replacements.push(replacement); }
        }
        const noteWords = !selection && !correction ? readStudyNoteReturnComparison(decided) : undefined;
        if (noteWords && choice === 'local') {
          const next = session.checkpoint();
          const { value, metadata } = next.confirmed;
          if (!metadata || metadata.deleted || value?.content !== noteWords.stored || next.draft?.content !== noteWords.mine) {
            throw Object.assign(new Error('The compared note text changed'), { code: 'decision-changed' });
          }
          const replacement = this.options.commits!.choiceReplacement(record.editorId, next, {
            noteContent: { generation: metadata.generation, observedRevision: metadata.revision, opening: noteWords.stored, time: choiceTime ?? null },
          });
          if (!replacement) throw Object.assign(new Error('The chosen note text could not be captured'), { code: 'decision-changed' });
          session.applyCommit(replacement);
          replacements.push(replacement);
        }
        if (commentWords && (session.checkpoint().dirty || commentCompanions.commentKindAction || commentCompanions.commentPlaceAction)) {
          const next = session.checkpoint();
          const { value, metadata } = next.confirmed;
          if (!metadata || metadata.deleted || value?.content !== commentWords.stored
            || next.draft?.content !== (choice === 'local' ? commentWords.mine : commentWords.stored)) {
            throw Object.assign(new Error('The compared comment text changed'), { code: 'decision-changed' });
          }
          const replacement = this.options.commits!.choiceReplacement(record.editorId, next, { commentCompanions,
            ...(choice === 'local' && { noteContent: { generation: metadata.generation, observedRevision: metadata.revision,
              opening: commentWords.stored, time: choiceTime ?? null, reviewed: true } }),
          });
          if (replacement) { session.applyCommit(replacement); replacements.push(replacement); }
        }
        if (placeOpening || (textChoice && !commentWords)) {
          const accepted = session.checkpoint();
          const text = placeOpening ? commentPlaceTextChange(decided, placeTail?.content) : undefined;
          if (text && accepted.draft && accepted.confirmed.value) {
            session.edit(writeField(accepted.draft, text.path, readField(accepted.confirmed.value, text.path)));
          }
          const place = this.options.commits!.choiceReplacement(record.editorId, session.checkpoint(), {
            ...(choice === 'local' && placeOpening && { action: { kind: 'comment-place',
              commentPlace: { seen: placeOpening, time: choiceTime ?? null, reviewed: true } } }),
          });
          if (place) { session.applyCommit(place); replacements.push(place); }
          const placed = session.checkpoint().draft;
          if (text && placed && !equalValues(readField(placed, text.path), text.after)) {
            // A rejected place can be reviewed again without deciding about the text.
            session.edit(writeField(placed, text.path, text.after));
            const later = this.options.commits!.choiceReplacement(record.editorId, session.checkpoint(), {
              predecessor: place ?? undefined, commentTextOpening: text.before,
            });
            if (!later) throw new Error('The later comment text could not be captured');
            session.applyCommit(later); replacements.push(later);
          }
        }
        const colorReview = !selection && !correction && readTagColorConflict(decided);
        if (choice === 'local' && colorReview) {
          const next = session.checkpoint();
          const { value, metadata } = next.confirmed;
          if (!metadata || metadata.deleted || value?.color !== colorReview.stored || next.draft?.color !== colorReview.mine) {
            throw Object.assign(new Error('The compared tag color changed'), { code: 'decision-changed' });
          }
          const seen = { color: colorReview.stored, generation: metadata.generation, revision: metadata.revision };
          const replacement = this.options.commits!.choiceReplacement(record.editorId, next, {
            action: { kind: 'tag-color', color: { seen, time: choiceTime ?? null } },
          });
          if (replacement) { session.applyCommit(replacement); replacements.push(replacement); }
        }
        if (choice === 'local' && !selection && !correction && readServiceOrderTitleConflict(decided)) {
          const next = session.checkpoint();
          const { value, metadata } = next.confirmed;
          if (typeof value?.title === 'string' && metadata && !metadata.deleted && next.draft?.title !== value.title) {
            const seen = { title: value.title, generation: metadata.generation, revision: metadata.revision };
            const replacement = this.options.commits!.choiceReplacement(record.editorId, serviceChoiceIntent(next), {
              action: { kind: 'service-order-title', title: { seen, time: choiceTime ?? null } },
            });
            if (replacement) { session.applyCommit(replacement); replacements.push(replacement); }
          }
        }
        const setting = choice === 'local' && !selection && !correction && readSermonSettingComparison(decided);
        if (setting) {
          const next = session.checkpoint();
          const { resource, value, metadata } = next.confirmed;
          if (!metadata || metadata.deleted || !value || !next.draft
            || !equalValues(readField(value, setting.path), setting.stored)
            || !equalValues(readField(next.draft, setting.path), setting.mine)) {
            throw Object.assign(new Error('The compared setting changed'), { code: 'decision-changed' });
          }
          const time = choiceTime ?? null;
          const seen = { sermonId: resource.id, generation: metadata.generation, revision: metadata.revision, value: setting.stored };
          const action: EditorCommitAction = 'field' in setting
            ? { kind: 'sermon-preparation-check', field: setting.field, time, reviewed: true }
            : { kind: 'sermon-plan-mode', mode: { seen, time, reviewed: true } };
          const replacement = this.options.commits!.choiceReplacement(record.editorId, next, { action });
          if (replacement) { session.applyCommit(replacement); replacements.push(replacement); }
        }
        if (choice === 'local' && stepText) {
          const checkpoint = session.checkpoint();
          const text = serviceStepTextRetry(checkpoint, stepText.rowId, stepText.field, choiceTime ?? null);
          if (!text) throw Object.assign(new Error('The compared service step changed'), { code: 'decision-changed' });
          const action: EditorCommitAction = stepText.field === 'title'
            ? { kind: 'service-order-step-title', title: text } : { kind: 'service-order-step-body', body: text };
          const replacement = this.options.commits!.choiceReplacement(record.editorId, serviceChoiceIntent(checkpoint), { action });
          if (replacement) { session.applyCommit(replacement); replacements.push(replacement); }
        }
        if (choice === 'local' && scriptureRows.length) {
          const checkpoint = session.checkpoint();
          const scriptures = scriptureRows.flatMap(row => serviceStepScriptureChoice(checkpoint, row, choiceTime ?? null) ?? []);
          const replacement = scriptures.length && this.options.commits!.choiceReplacement(record.editorId, serviceChoiceIntent(checkpoint), {
            action: scriptureRow ? { kind: 'service-order-step-scripture', scripture: scriptures[0] }
              : { kind: 'service-order-step-scripture-review', scriptures },
          });
          if (replacement) { session.applyCommit(replacement); replacements.push(replacement); }
        }
        const referenceReview = !selection && !correction && readStudyNoteReferenceComparison(decided);
        if (referenceReview) {
          const accepted = session.checkpoint();
          const action = reviewedReferenceEvidence(accepted, referenceReview.comparedIds);
          const replacement = this.options.commits!.choiceReplacement(record.editorId, accepted, { action });
          if (replacement) { session.applyCommit(replacement); replacements.push(replacement); }
        }
        const sourceNoteRequest = ordinary?.first ?? retired.find(request => decided.pending[request.id]
          && (request.sourceNoteLink || legacySourceNoteChange(request.command)));
        const originalSourceLinks = sourceNoteRequest?.sourceNoteLink;
        const sourceNoteRetry = !selection && reviewedSourceNoteLinks(decided, originalSourceLinks, choice,
          choiceTime ?? originalSourceLinks?.action.time ?? null, sourceNoteTail,
          originalSourceLinks ? undefined : legacySourceNoteChange(sourceNoteRequest?.command));
        if (sourceNoteRetry) session.stageSourceNoteLinkRetry(sourceNoteRetry);
        if (separateGroupStatus && !replacements.length) {
          const replacement = this.options.commits!.choiceReplacement(record.editorId, session.checkpoint());
          if (replacement) { session.applyCommit(replacement); replacements.push(replacement); }
        }
        projected = { ...record, checkpoint: session.checkpoint(), completedCommits: [...completed] };
        if (!ordinary) return replacements.length ? { editorRecords: [projected], manualRecoveries: [], replacements }
          : retainedPlacementTail ? { editorRecords: [projected, retainedPlacementTail], manualRecoveries: [] } : projected;
        const { confirmed, draft } = projected.checkpoint;
        const recovery = projectOrdinaryChoiceDependents(record.owner, ordinary, confirmed, draft,
          retired, choice === 'local' ? record.editorId : undefined);
        return { ...recovery, editorRecords: [projected, ...recovery.editorRecords, ...retainedPlacementTail ? [retainedPlacementTail] : []], replacements };
      }, ordinary ? { roots: [ordinary.first], ...((sourceNoteTail || placeTail) && { retained: new Set<string>() }), ...(savedOrder && { placementChoice: new Map([[ordinary.first.id, savedOrder]]) }), ...(reviewingText && { groupTextReview: true as const }) }
        : selection ? { assertScope: requests => requireDocumentChoiceForBranch(cancelled, requests) } : undefined);
    if (!source || !projected) throw new Error('Choice checkpoint projection was not captured');
    await this.applyChoiceProjection(source, projected, captures, reviewingText ? ordinary?.first.id : anchoredChoice);
    await this.options.commits!.finishCancellation(ordinary ? '' : this.options.editorId, ordinary ? ids : cancelled);
  }

  private async ordinaryAnswerFor(held: readonly string[]) {
    const requests = await this.options.commits!.list();
    this.assertCurrent();
    const answered = requests.filter(request => held.includes(request.id) && ['conflict', 'refused'].includes(request.state));
    if (!answered.length) return null;
    const manualChoices = await this.options.manualChoiceSources?.(requests);
    this.assertCurrent();
    const ordinary = answered.flatMap(request => reviewOrdinaryAnswerChoice(request, requests, manualChoices) ?? []);
    if (!ordinary.length) return null;
    if (answered.length !== 1 || (this.result && this.result.operationId !== ordinary[0].first.id)) {
      throw Object.assign(new Error('Resolve the saved answers separately'), { code: 'other-changes-first' });
    }
    return ordinary[0];
  }

  private async applyChoiceProjection(source: SessionCheckpoint, projected: EditorRecord, captures: ReadonlySet<object>,
    anchoredChoice?: string, preserveAnswer = false): Promise<void> {
    this.assertCurrent();
    const current = this.session.checkpoint();
    const laterTyping = current.editGeneration !== source.editGeneration;
    const session = DataSession.restore(projected.checkpoint);
    if (laterTyping && anchoredChoice && source.draft && current.draft) {
      const templateRetry = projected.checkpoint.confirmed.resource.collection === 'planTemplates' && projected.checkpoint.outlinePointPlacementRetry;
      if (templateRetry || !session.retainAnchoredPlacementChoiceEdits(current, source.draft, current.draft)) {
        await this.retainTypingDuringPlacementChoice(anchoredChoice, source.draft, current, projected.checkpoint.confirmed);
      }
    } else if (laterTyping) {
      const merged = mergeDocumentFields(source.draft, current.draft, projected.checkpoint.draft);
      session.edit(chooseLocalPlacement(current.confirmed.resource.collection,
        source.draft, current.draft, projected.checkpoint.draft,
        merged.value.exists ? merged.value.value as DocumentData : null, mergeFields));
      session.retainCouncilTopicReview(merged.conflicts);
      if (preserveAnswer) session.retainUnreviewedAutosaveActions(current, []);
    }
    this.session = session;
    this.completedCommits = projected.completedCommits ?? [];
    this.pendingCaptures.retire(captures);
    if (!preserveAnswer) this.result = null;
    this.held = shouldRetainCheckpoint(projected);
    this.clearedCommits = this.completedCommits.length;
    this.durable = !laterTyping;
    this.error = null;
    this.errorCode = null;
    this.emit();
    if (laterTyping && !preserveAnswer) await this.persist();
  }

  private async retainTypingDuringPlacementChoice(requestId: string, base: DocumentData, source: SessionCheckpoint,
    accepted: ResourceSnapshot): Promise<void> {
    // Leave the mounted copy intact until all typing, including input during storage, is on disk.
    let authored = source;
    while (authored.draft) {
      const copy = retainedAnchoredPlacementDraft(this.options.owner, this.options.editorId, requestId, 'during-choice',
        authored, accepted, base, authored.draft);
      await this.options.store.put(copy);
      this.assertCurrent();
      const latest = this.session.checkpoint();
      if (latest.editGeneration === authored.editGeneration) return;
      authored = latest;
    }
    throw Object.assign(new Error('Another document action arrived during the position choice'), { code: PENDING_DELIVERY_FIRST });
  }

  resolveExactManualChoice(decision: ExactManualChoice, recheck: () => void): Promise<void> {
    const captures = this.pendingCaptures.boundary();
    const expected = this.captureRecoveryChoice();
    return this.enqueueChoice(async () => {
      if (!this.options.commits) throw new Error('An exact choice requires the commit queue');
      recheck();
      this.assertRecoveryChoice(expected);
      if (decision.choice === 'local') {
        const generation = decision.request.command?.generation ?? decision.request.baseline.metadata?.generation;
        requireFreshGeneration(decision.request.result, generation, decision.stored);
      }
      if (this.options.publishStoredChoice) await this.options.publishStoredChoice(decision.stored);
      let source: SessionCheckpoint | undefined;
      let projected: EditorRecord | undefined;
      await this.options.commits.cancelWithCheckpoint('', [decision.request.id], retired => {
        this.assertCurrent();
        recheck();
        this.assertRecoveryChoice(expected);
        if ([...this.pendingCaptures.boundary()].some(attempt => !captures.has(attempt))) {
          throw Object.assign(new Error('Finish the later Save before replacing saved intent'), { code: PENDING_DELIVERY_FIRST });
        }
        const record = this.record();
        source = record.checkpoint;
        const records = projectExactManualChoice(record, decision, retired);
        [projected] = records;
        const hardQuestionReview = decision.hardQuestionReview;
        if (!hardQuestionReview || !projected.checkpoint.dirty) return records;
        const session = DataSession.restore(projected.checkpoint);
        const replacement = this.options.commits!.choiceReplacement(record.editorId, projected.checkpoint, {
          retentionScope: hardQuestionReview.scopeId,
          ...(hardQuestionReview.text && { action: { kind: 'document-metadata' as const, time: decision.choiceTime ?? null,
            hardQuestionFieldReview: hardQuestionReview.text } }),
        });
        if (!replacement) throw Object.assign(new Error('The shown question choice could not be saved'), { code: 'decision-changed' });
        session.applyCommit(replacement);
        projected = { ...projected, checkpoint: session.checkpoint() };
        return { editorRecords: [projected, ...records.slice(1)], manualRecoveries: [], replacements: [replacement] };
      }, { roots: [decision.request] });
      if (!source || !projected) throw new Error('Choice checkpoint projection was not captured');
      await this.applyChoiceProjection(source, projected, captures);
      await this.options.commits.finishCancellation('', [decision.request.id]);
    });
  }

  private async finishAcknowledgements(): Promise<void> {
    if (!this.unfinalized.length) return;
    for (const operationId of this.unfinalized) {
      this.assertCurrent();
      await this.options.runtime.finalize(operationId);
      this.assertCurrent();
    }
    this.unfinalized = [];
    await this.persist();
  }

  private enqueueChoice(action: () => Promise<void>): Promise<void> {
    this.choices += 1;
    this.emit();
    return this.enqueue(action).finally(() => { this.choices -= 1; this.emit(); });
  }

  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const next = this.queue.catch(() => undefined).then(async () => {
      this.assertCurrent();
      try { return await action(); } catch (error) {
        this.durable = false;
        this.error = error instanceof Error ? error.message : 'Data engine storage failed';
        this.errorCode = failureCode(error);
        this.emit();
        throw error;
      }
    });
    this.queue = next;
    return next;
  }

  private assertCurrent(): void {
    if (this.disposed || !this.options.isCurrentOwner(this.options.owner)) throw new InactiveEditorError();
  }

  private emit(): void {
    if (this.disposed || !this.options.isCurrentOwner(this.options.owner)) return;
    this.listeners.forEach(listener => { try { listener(); } catch { /* Rendering never changes persistence. */ } });
  }
}
