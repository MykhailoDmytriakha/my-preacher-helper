import { newClientId } from '@/utils/clientId';
import { getUtf8ByteLength } from '@/utils/feedbackPayload';
import { hasOutlinePointOrder } from '@/utils/outlineDnd';
import { matchesSermonNoteOpening, withSermonNoteText, type SermonNoteOpening } from '@/utils/sermonNoteText';
import { projectServiceOrderStep } from '@/utils/serviceOrderStepPlacement';


import { advanceAtomicCommit, atomicParticipants, cancellationScope, cancelActionCommits, canCancelSavedIntent, initializeCommit, orderActionProjections, type AtomicCommitIdentity } from './atomicCommits';
import { isFirstBookMarksDraft } from './bibleMarksCreation';
import { captureBibleMarkStroke, restoreBibleMarkAncestor, withBibleMarkStroke, type CapturedBibleMarkStroke } from './bibleMarkStroke';
import { MAX_COMMAND_BYTES } from './commandSize';
import { captureCommentKind, matchesCommentKindRequest, type CommentKindObservation } from './commentKindAction';
import { commentOpeningPredecessor } from './commentOpening';
import { captureCommentPlace, matchesCommentPlaceDestination, matchesCommentPlaceRequest, matchesCommentPlaceScope, type CommentPlaceObservation } from './commentPlaceAction';
import { pendingCommitRetirement, retireCommitJournal } from './commitJournal';
import { CommitReceipts } from './commitReceipt';
import { captureCouncilAssembly, COUNCIL_ASSEMBLY_POLICY, matchingCouncilAssembly, type CouncilAssemblyActions } from './councilAssemblyAction';
import { captureCouncilTopicKind, COUNCIL_TOPIC_KIND_POLICY, matchingCouncilTopicKind, type CouncilTopicKindActions } from './councilTopicKindAction';
import { councilTopicPlacementPredecessor, councilTopicWitness, projectCouncilTopicOnDocument } from './councilTopicPlacement';
import { capturedDateBaseline, captureDatedRowAction, datedRowTarget, existingRowDate, matchesDatedRowChange, MEETING_DATE_TARGET, replaceExistingDate, type DatedRowActionCapture, type DatedRowActionEvidence } from './datedRowAction';
import { captureDeleteOrder, captureRemovalLineage, deleteOrderReady, replayDeleteOrder, type PendingRemovalOpening } from './deletionOrdering';
import { captureDocumentMetadataFields, capturePreparationConfirmation, type PreparationConfirmationObservations, capturedDocumentField, capturePlanTemplateName, capturePrayerStatusFields, capturePrayerTitle, captureServiceOrderTitle, captureSermonPlanMode, captureStudyNoteTitle, captureStudyNoteType, captureTagColor, documentFieldCommandAncestor, documentFieldTargets, matchesPlanTemplateNameRequest, matchesPrayerTitleRequest, permitsSermonPlanModePredecessor, matchesStudyNoteTitleRequest, matchesStudyNoteTypeRequest, matchesTagColorRequest, uncapturedAutosaveFields, withDocumentFieldAction } from './documentFieldAction';
import { commandReferenceResources, documentReferenceResources, referenceReadiness } from './documentReferences';
import { captureDocumentTags, pendingDocumentTags, restoreDocumentTagAncestor } from './documentTagCapture';
import { documentTagChange, documentTagCommandActions } from './documentTagMembership';
import { prepareAtomicSeriesCommand, prepareDomainCommand, requiredDomainTargets } from './domainPolicy';
import { areDifferentTabManualParents, readManualScopeIdentity, sharesEditorOpening } from './editorIdentity';
import { captureExegeticalPointActions, matchingExegeticalPointActions, restoreExegeticalQueueBasis, type ExegeticalQueueBasis } from './exegeticalPointCapture';
import { AddressedFailures, type AddressedFailure } from './failures';
import { writeField } from './fieldValues';
import { captureFirstGroupMeetingChange } from './groupFirstMeeting';
import { matchingGroupFlowCopySources, matchingGroupFlowRetirements } from './groupFlowTopology';
import { captureMeetingFieldActions, GROUP_MEETING_FIELD_POLICY, matchingMeetingFieldActions } from './groupMeetingFieldAction';
import { groupStepPlacementPredecessor, groupStepWitness, projectGroupStepOnDocument } from './groupStepPlacement';
import { captureHomileticMoves, captureHomileticTitles, matchingHomileticMoves, matchingHomileticPositionReviews, matchingHomileticTitles, restoreHomileticOpenings } from './homileticPlanCapture';
import { seriesCommandParticipant } from './membershipIntent';
import { outlinePlacementField } from './outlinePlacementResource';
import { projectResourceOutlinePoint, sameOutlinePointGesture } from './outlinePointPlacement';
import { noteCorrectionOpening, oversizedNoteOpening, shortenedNoteContent } from './oversizedNoteCorrection';
import { capturePreachDateFields, PREACH_DATE_FIELD_POLICY } from './preachDateFieldAction';
import { capturePreachStatusActions, matchingPreachStatusActions, pendingPreachStatusActions, replacePreachStatuses } from './preachStatusAction';
import { confirmedExistingDeletion, equalValues, isValidIdentifier, mergeDocumentAfterAcknowledgement, MAX_RELATION_RESOURCES } from './protocol';
import { compactRowTextStamps } from './rowDetailAction';
import { matchingRowDetailActions, pendingRowDetailRebases } from './rowDetailCapture';
import { existingRowField, replaceExistingRowField } from './rowFieldAction';
import { captureRowFields, matchingRowFields, pendingAutosaveRowFieldRebases, sameAutosaveRowFieldCaptures } from './rowFieldAutosave';
import { capturePlanTextEvidence, type PlanTextEvidence } from './sermonPlanText';
import { committedSermonText, selectSermonTextOpenings, sermonTextKey, type CommittedSermonText, type SermonTextOpenings } from './sermonTextOpenings';
import { captureServiceOrderStep, matchesServiceOrderStep, SERVICE_ORDER_FLAG_POLICY, SERVICE_ORDER_FLAG_TARGET, SERVICE_ORDER_STEP_SCRIPTURE_LIST, SERVICE_ORDER_STEP_SCRIPTURE_POLICY, SERVICE_ORDER_STEP_TITLE_POLICY, SERVICE_ORDER_STEP_TITLE_TARGET, type ServiceOrderFlagActions, type ServiceOrderStepScriptureActions, type ServiceOrderStepTitleActions } from './serviceOrderStepAction';
import { placementSteps } from './serviceOrderStepPlacement';
import { coversCommittedEffect } from './snapshotFreshness';
import { SOURCE_NOTE_FIELD, sourceNoteLinkChange, validSourceNoteLinkAction } from './sourceNoteLinkAction';
import { matchesSourceNoteOpening, sourceNoteCommandCopies, sourceNoteQueueCapture, type SourceNoteLinkCapture } from './sourceNoteLinkCapture';
import { captureStudyNoteContent } from './studyNoteContentCapture';
import { captureThoughtTagActions, pendingThoughtTagRebases, thoughtTagCommandActions } from './thoughtTagAction';

import type { AccountPreferenceObservations } from './accountPreference';
import type { CaptureTransferProof, CaptureTransferResult } from './captureTransfer';
import type { DocumentWriteReceipt } from './commitReceipt';
import type { EditorRecord } from './controller';
import type { CouncilFieldActions } from './councilFieldAction';
import type { DocumentFieldAction, DocumentFieldObservation, SermonChurchObservation, SermonPlanModeObservation, SermonThesisObservations } from './documentFieldAction';
import type { ExegeticalPointStamp } from './exegeticalPointAction';
import type { GroupMeetingFieldActions, GroupMeetingFieldCaptures } from './groupMeetingFieldAction';
import type { GroupTextReviewStage } from './groupTextReview';
import type { HomileticMoveActions, HomileticMoveGesture, HomileticPositionReviews, HomileticTitleActions } from './homileticPlan';
import type { SeriesMembershipCapture } from './membershipIntent';
import type { PrayerStatusObservations } from './prayerStatusAction';
import type { PreachDateFieldActions, PreachDateFieldSave } from './preachDateFieldAction';
import type { PreachStatusAction, PreachStatusCapture } from './preachStatusAction';
import type { AutosaveRowFieldActions } from './rowFieldAutosave';
import type { DataEngineRuntime } from './runtime';
import type { SeriesFieldObservations } from './seriesFieldAction';
import type { SermonChurchFill } from './sermonChurchFill';
import type { SessionCheckpoint } from './session';
import type { TagMembershipAction } from './tagMembershipOrder';
import type { ThoughtTagAction } from './thoughtTagAction';
import type { CommandResult, CouncilTopicPlacementCapture, DataCommand, DocumentData, EditorCommitAction, EngineMetadata, FieldChange, FieldValue, GroupFlowStepPlacementCapture, OutlinePointPlacementCapture, OutlineSubpointMove, ResourceRef, ResourceSnapshot, ServiceOrderPlacementCapture, ServiceOrderStepPlacementCapture, StudyNoteContentCapture, StudyNoteReferenceEvidence } from './types';

export interface CommitRequest extends CouncilFieldActions, PrayerStatusObservations, AutosaveRowFieldActions {
  id: string;
  atomic?: AtomicCommitIdentity;
  seriesMembership?: SeriesMembershipCapture;
  /** Captured catalog copy when it came from a queued predecessor rather than the baseline. */
  seriesMembershipOpening?: DocumentData;
  seriesMembershipPredecessor?: string;
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
  /** Confirmed order chosen for a refused placement, also needed by other and closed editors. */
  placementChoiceStored?: ResourceSnapshot;
  groupTextReview?: GroupTextReviewStage;
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
  groupFirstMeetingChange?: FieldChange;
  preachDateFieldActions?: PreachDateFieldActions;
  preachStatusActions?: PreachStatusAction[];
  deferPreachDateRebase?: true;
  bibleMarkStroke?: CapturedBibleMarkStroke;
  deferBibleMarkRebase?: true;
  serviceOrderPlacement?: ServiceOrderPlacementCapture;
  serviceOrderStepPlacement?: ServiceOrderStepPlacementCapture;
  outlinePointPlacement?: OutlinePointPlacementCapture;
  outlineSubpointMoves?: OutlineSubpointMove[];
  outlineSubpointPredecessor?: { operationId: string; childIds: string[] };
  groupFlowStepPlacement?: GroupFlowStepPlacementCapture;
  councilTopicPlacement?: CouncilTopicPlacementCapture;
  groupFlowPlacementLegacyRevision?: number;
  councilTopicPlacementLegacyRevision?: number;
  outlinePointPlacementLegacyRevision?: number;
  outlinePointPlacementBirthRevision?: number;
  serviceOrderTitleAction?: DocumentFieldAction;
  serviceOrderFlagActions?: ServiceOrderFlagActions;
  councilTopicQueue?: string;
  councilAssemblyActions?: CouncilAssemblyActions;
  councilTopicKindActions?: CouncilTopicKindActions;
  serviceOrderStepTitleActions?: ServiceOrderStepTitleActions;
  serviceOrderStepScriptureActions?: ServiceOrderStepScriptureActions;
  prayerTitleAction?: DocumentFieldObservation;
  studyNoteTitleAction?: DocumentFieldObservation<FieldValue>;
  studyNoteContentAction?: DocumentFieldObservation<FieldValue>;
  /** Original acknowledged frame revision when a replay includes a newer head. */
  analysisFramePredecessorRevision?: number;
  studyNoteTypeAction?: DocumentFieldObservation<FieldValue>;
  commentKindAction?: CommentKindObservation;
  commentPlaceAction?: CommentPlaceObservation;
  /** Exact opening words from a saved text edit carried beyond a place choice. */
  commentTextOpening?: FieldValue;
  planTemplateNameAction?: DocumentFieldObservation;
  tagColorAction?: DocumentFieldObservation;
  sermonTitleAction?: DocumentFieldObservation;
  sermonVerseAction?: DocumentFieldObservation;
  sermonChurchAction?: SermonChurchObservation;
  sermonGoalTypeAction?: DocumentFieldObservation<FieldValue>;
  sermonThesisFieldActions?: SermonThesisObservations;
  sermonRepeatedWordsAction?: DocumentFieldObservation<FieldValue>;
  sermonPlanModeAction?: SermonPlanModeObservation;
  accountPreferenceActions?: AccountPreferenceObservations;
  sermonPreparationCheckActions?: PreparationConfirmationObservations;
  exegeticalPlanActions?: ExegeticalPointStamp[];
  homileticTitleActions?: HomileticTitleActions;
  homileticMoveActions?: HomileticMoveActions;
  homileticPositionReviews?: HomileticPositionReviews;
  thoughtTagActions?: ThoughtTagAction[];
  tagMembershipActions?: TagMembershipAction[];
  sourceNoteLink?: SourceNoteLinkCapture;
  sermonNoteText?: SermonNoteOpening;
  sermonTextOpenings?: SermonTextOpenings;
  sermonTextPredecessorRevision?: number;
  sermonTextContinuation?: SermonTextOpenings;
  committedSermonText?: CommittedSermonText;
  exegeticalQueueBasis?: ExegeticalQueueBasis;
  rebasedGroupCopySources?: DocumentData[];
  rebasedGroupRetirements?: DocumentData[];
  studyNoteReferenceChange?: FieldChange;
  studyNoteReferenceEvidence?: StudyNoteReferenceEvidence;
  sermonChurchFill?: SermonChurchFill;
  seriesFieldActions?: SeriesFieldObservations;
  groupTitleAction?: DocumentFieldObservation;
  groupStatusAction?: DocumentFieldObservation;
  groupDescriptionAction?: DocumentFieldObservation<FieldValue>;
  /** Earlier locally captured uses of this resource; owned atomically by DELETE capture storage. */
  deleteAfter?: string[];
  /** Exact visible saves that authorize an ordinary deletion once they are accepted. */
  removalLineage?: string[];
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
  replacements?: readonly CommitRequest[];
};

export interface CommitStore {
  list(owner: string): Promise<CommitRequest[]>;
  listForCollection?(owner: string, collection: string): Promise<CommitRequest[]>;
  /** Full cancellation evidence is needed only if this owner has an analysis action. */
  listForAnalysisRecovery?(owner: string): Promise<CommitRequest[]>;
  /** Read the current rows for a known operation without opening the rest of the queue. */
  readByIds?(owner: string, ids: readonly string[]): Promise<CommitRequest[]>;
  /** Return exact rows only while the snapshot contains every current request identity. */
  readChainStep?(owner: string, knownIds: ReadonlySet<string>, ids: readonly string[]): Promise<CommitRequest[] | null>;
  /** Atomically unique by owner/editor/generation. Repeats return the original request. */
  create(request: CommitRequest): Promise<CommitRequest>;
  /**
   * Native adapters capture the exact checkpoint and canonical request in one transaction. `deferRetention`
   * leaves the sweep of retained rows to the next pass, so a page being left writes only what it must keep.
   */
  createWithCheckpoint?(request: CommitRequest, project: (saved: CommitRequest) => EditorRecord,
    options?: { deferRetention?: true }): Promise<CommitRequest>;
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

export interface AtomicCapture {
  editorId: string;
  captured: SessionCheckpoint;
  predecessorId?: string | null;
  retentionScope?: string;
  seriesMembership?: SeriesMembershipCapture;
}

export interface CommitEvent { request: CommitRequest }
export type TrackCommitAnswer = (request: CommitRequest, apply: (result: CommandResult) => Promise<boolean>) => void;
export function assertCommitCapture(current: CommitRequest, incoming: CommitRequest): void {
  if (current.owner !== incoming.owner || current.editorId !== incoming.editorId || current.editGeneration !== incoming.editGeneration
    || current.predecessor !== incoming.predecessor || !equalValues(current.baseline, incoming.baseline)
    || !equalValues(current.planTextEvidence ?? null, incoming.planTextEvidence ?? null)
    || !equalValues(current.serviceOrderTitleAction ?? null, incoming.serviceOrderTitleAction ?? null)
    || !equalValues(current.serviceOrderFlagActions ?? null, incoming.serviceOrderFlagActions ?? null)
    || !equalValues(current.serviceOrderStepTitleActions ?? null, incoming.serviceOrderStepTitleActions ?? null)
    || !equalValues(current.serviceOrderStepScriptureActions ?? null, incoming.serviceOrderStepScriptureActions ?? null)
    || !sameAutosaveRowFieldCaptures(current, incoming)
    || !equalValues(current.councilAssemblyActions ?? null, incoming.councilAssemblyActions ?? null)
    || !equalValues(current.councilTopicKindActions ?? null, incoming.councilTopicKindActions ?? null)
    || !equalValues(current.prayerTitleAction ?? null, incoming.prayerTitleAction ?? null)
    || !equalValues(current.commentKindAction ?? null, incoming.commentKindAction ?? null)
    || !equalValues(current.commentPlaceAction ?? null, incoming.commentPlaceAction ?? null)
    || !equalValues(current.commentTextOpening ?? null, incoming.commentTextOpening ?? null)
    || !equalValues(current.studyNoteTypeAction ?? null, incoming.studyNoteTypeAction ?? null)
    || !equalValues(current.studyNoteTitleAction ?? null, incoming.studyNoteTitleAction ?? null)
    || !equalValues(current.studyNoteContentAction ?? null, incoming.studyNoteContentAction ?? null)
    || !equalValues(current.planTemplateNameAction ?? null, incoming.planTemplateNameAction ?? null)
    || !equalValues(current.tagColorAction ?? null, incoming.tagColorAction ?? null)
    || !equalValues(current.prayerStatusAction ?? null, incoming.prayerStatusAction ?? null)
    || !equalValues(current.prayerAnsweredAtAction ?? null, incoming.prayerAnsweredAtAction ?? null)
    || !equalValues(current.sermonTitleAction ?? null, incoming.sermonTitleAction ?? null)
    || !equalValues(current.sermonVerseAction ?? null, incoming.sermonVerseAction ?? null)
    || !equalValues(current.sermonChurchAction ?? null, incoming.sermonChurchAction ?? null)
    || !equalValues(current.sermonGoalTypeAction ?? null, incoming.sermonGoalTypeAction ?? null)
    || !equalValues(current.sermonThesisFieldActions ?? null, incoming.sermonThesisFieldActions ?? null)
    || !equalValues(current.sermonRepeatedWordsAction ?? null, incoming.sermonRepeatedWordsAction ?? null)
    || !equalValues(current.sermonPlanModeAction ?? null, incoming.sermonPlanModeAction ?? null)
    || !equalValues(current.serviceOrderPlacement ?? null, incoming.serviceOrderPlacement ?? null)
    || !equalValues(current.serviceOrderStepPlacement ?? null, incoming.serviceOrderStepPlacement ?? null)
    || !equalValues(current.outlinePointPlacement ?? null, incoming.outlinePointPlacement ?? null)
    || !equalValues(current.groupFlowStepPlacement ?? null, incoming.groupFlowStepPlacement ?? null)
    || !equalValues(current.councilTopicPlacement ?? null, incoming.councilTopicPlacement ?? null)
    || !equalValues(current.accountPreferenceActions ?? null, incoming.accountPreferenceActions ?? null)
    || !equalValues(current.thoughtTagActions ?? null, incoming.thoughtTagActions ?? null)
    || !equalValues(current.tagMembershipActions ?? null, incoming.tagMembershipActions ?? null)
    || !equalValues(current.sourceNoteLink ?? null, incoming.sourceNoteLink ?? null)
    || !equalValues(current.sermonNoteText ?? null, incoming.sermonNoteText ?? null)
    || !equalValues(current.sermonTextOpenings ?? null, incoming.sermonTextOpenings ?? null)
    || !equalValues(current.exegeticalPlanActions ?? null, incoming.exegeticalPlanActions ?? null)
    || !equalValues(current.homileticTitleActions ?? null, incoming.homileticTitleActions ?? null)
    || !equalValues(current.homileticMoveActions ?? null, incoming.homileticMoveActions ?? null)
    || !equalValues(current.outlineSubpointMoves ?? null, incoming.outlineSubpointMoves ?? null)
    || !equalValues(current.homileticPositionReviews ?? null, incoming.homileticPositionReviews ?? null)
    || !equalValues(current.sermonPreparationCheckActions ?? null, incoming.sermonPreparationCheckActions ?? null)
    || !equalValues(current.sermonChurchFill ?? null, incoming.sermonChurchFill ?? null)
    || !equalValues(current.seriesFieldActions ?? null, incoming.seriesFieldActions ?? null)
    || !equalValues(current.seriesMembership ?? null, incoming.seriesMembership ?? null)
    || !equalValues(current.groupTitleAction ?? null, incoming.groupTitleAction ?? null)
    || !equalValues(current.groupStatusAction ?? null, incoming.groupStatusAction ?? null)
    || !equalValues(current.groupDescriptionAction ?? null, incoming.groupDescriptionAction ?? null)
    || !equalValues(current.councilTitleAction ?? null, incoming.councilTitleAction ?? null)
    || !equalValues(current.councilDateAction ?? null, incoming.councilDateAction ?? null)
    || !equalValues(current.councilLifecycleAction ?? null, incoming.councilLifecycleAction ?? null)
    || !equalValues(current.bibleMarkStroke ?? null, incoming.bibleMarkStroke ?? null)
    || !equalValues(current.preachDateAction ?? null, incoming.preachDateAction ?? null)
    || !equalValues(current.meetingDateAction ?? null, incoming.meetingDateAction ?? null)
    || !equalValues(current.groupMeetingFieldActions ?? null, incoming.groupMeetingFieldActions ?? null)
    || !equalValues(current.groupFirstMeetingChange ?? null, incoming.groupFirstMeetingChange ?? null)
    || !equalValues(current.preachDateFieldActions ?? null, incoming.preachDateFieldActions ?? null)
    || !equalValues(current.preachStatusActions ?? null, incoming.preachStatusActions ?? null)
    || !equalValues(current.value, incoming.value) || !equalValues(current.atomic ?? null, incoming.atomic ?? null)
    || !equalValues(current.deleteAfter ?? null, incoming.deleteAfter ?? null)
    || !equalValues(current.removalLineage ?? null, incoming.removalLineage ?? null)
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

type CommitSaveOptions = { noteContent?: StudyNoteContentCapture | null; predecessorId?: string | null; predecessorIds?: readonly string[]; retentionScope?: string;
  pendingRemoval?: PendingRemovalOpening;
  seriesMembership?: SeriesMembershipCapture;
  preachDateAction?: DatedRowActionCapture;
  meetingDateAction?: DatedRowActionCapture;
  groupMeetingFieldCaptures?: GroupMeetingFieldCaptures;
  preachDateFieldSave?: PreachDateFieldSave;
  preachStatusCapture?: PreachStatusCapture;
  documentMetadataTime?: import('./actionClock').ActionTime | null;
  homileticMoves?: readonly HomileticMoveGesture[];
  outlineSubpointMoves?: readonly OutlineSubpointMove[];
  thoughtPlacementIds?: readonly string[];
  thoughtTagId?: string;
  thoughtTextId?: string;
  action?: EditorCommitAction;
  checkpoint?: (saved: CommitRequest) => EditorRecord;
  /** A Save captured while its page is left: request and checkpoint only, no retention sweep in that transaction. */
  deferRetention?: true;
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
    ...pendingRowDetailRebases(record, record.serviceOrderStepScriptureActions, SERVICE_ORDER_STEP_SCRIPTURE_POLICY),
    ...pendingRowDetailRebases(record, record.councilAssemblyActions, COUNCIL_ASSEMBLY_POLICY),
    ...pendingRowDetailRebases(record, record.councilTopicKindActions, COUNCIL_TOPIC_KIND_POLICY),
    ...pendingAutosaveRowFieldRebases(record),
    ...pendingThoughtTagRebases(record),
  ];
}

function initialMeetingChange(record: CommitRequest): FieldChange | undefined {
  if (record.sequence !== 0 || record.working.metadata?.generation !== record.baseline.metadata?.generation) return;
  return record.groupFirstMeetingChange;
}

function hasTimedAncestor(record: CommitRequest): boolean {
  return record.sequence === 0 && Boolean(record.sourceNoteLink || record.seriesMembership || record.serviceOrderPlacement || record.serviceOrderStepPlacement || record.outlinePointPlacement || record.outlineSubpointMoves?.length || record.groupFlowStepPlacement || record.councilTopicPlacement || record.serviceOrderTitleAction || record.prayerTitleAction || record.planTemplateNameAction || record.tagColorAction || record.studyNoteTitleAction || record.studyNoteContentAction || record.studyNoteTypeAction || record.commentKindAction || record.commentPlaceAction || record.prayerStatusAction || record.prayerAnsweredAtAction || record.sermonTitleAction || record.sermonVerseAction || record.sermonChurchAction || record.sermonGoalTypeAction || record.sermonThesisFieldActions || record.sermonRepeatedWordsAction || record.sermonPlanModeAction || record.accountPreferenceActions || record.sermonPreparationCheckActions || record.exegeticalPlanActions?.length || record.homileticTitleActions || record.homileticMoveActions || record.seriesFieldActions || record.groupTitleAction || record.groupStatusAction || record.groupDescriptionAction || record.councilTitleAction || record.councilDateAction || record.councilLifecycleAction || pendingBibleMarkRebase(record) || initialMeetingChange(record) || pendingMeetingDateRebase(record) || pendingDocumentTags(record).length || pendingRowFields(record).length || pendingPreachStatusActions(record).length);
}

function freezeSaveOptions(options: CommitSaveOptions | undefined): CommitSaveOptions | undefined {
  return options && { ...options, ...(options.seriesMembership && { seriesMembership: clone(options.seriesMembership) }), predecessorIds: options.predecessorIds && [...options.predecessorIds],
    pendingRemoval: options.pendingRemoval && clone(options.pendingRemoval),
    transfer: options.transfer && clone(options.transfer), preachDateAction: options.preachDateAction && clone(options.preachDateAction),
    meetingDateAction: options.meetingDateAction && clone(options.meetingDateAction),
    groupMeetingFieldCaptures: options.groupMeetingFieldCaptures && clone(options.groupMeetingFieldCaptures),
    preachDateFieldSave: options.preachDateFieldSave && clone(options.preachDateFieldSave),
    preachStatusCapture: options.preachStatusCapture && clone(options.preachStatusCapture),
    documentMetadataTime: options.documentMetadataTime && clone(options.documentMetadataTime),
    homileticMoves: options.homileticMoves && clone(options.homileticMoves),
    outlineSubpointMoves: options.outlineSubpointMoves && clone(options.outlineSubpointMoves),
    ...(options.noteContent !== undefined && { noteContent: clone(options.noteContent) }), action: options.action && clone(options.action) };
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

function outlineMovePredecessor(records: readonly CommitRequest[], predecessor: CommitRequest | undefined,
  move: OutlinePointPlacementCapture): string | undefined {
  if (!predecessor) return undefined;
  const chain = new Map(records.map(record => [record.id, record]));
  const { owner, baseline } = predecessor;
  const field = outlinePlacementField(baseline.resource.collection);
  if (!field) return undefined;
  let shown = move.before;
  let record: CommitRequest | undefined = predecessor;
  while (record && chain.delete(record.id)) {
    if (record.owner !== owner || !resourceMatches(record.baseline.resource, baseline.resource)
      || record.baseline.metadata?.generation !== baseline.metadata?.generation
      || record.state === 'cancelled' || record.state === 'conflict' || record.state === 'refused'
      || !hasOutlinePointOrder(record.value?.[field], shown)) return undefined;
    const previousMove = record.outlinePointPlacement;
    if (previousMove) {
      if (previousMove.generation !== move.generation || !hasOutlinePointOrder(previousMove.after, shown)) return undefined;
      if (previousMove.placement.pointId === move.placement.pointId) return record.id;
      // Rewind the exact move of the other point before inspecting earlier saves.
      shown = previousMove.before;
    }
    record = record.predecessor ? chain.get(record.predecessor) : undefined;
  }
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

  /** Collection presentation can use its own snapshot of native request rows. */
  async listForCollection(collection: string): Promise<CommitRequest[]> {
    const owner = this.owner, generation = this.generation;
    if (!owner) return [];
    if (!this.options.store.listForCollection) {
      return (await this.list()).filter(request => request.owner === owner && request.baseline.resource.collection === collection);
    }
    const records = await this.options.store.listForCollection(owner, collection);
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

  /** Replace an exact terminal size refusal and capture the corrected draft in one transaction. */
  async replaceOversizedNote(source: CommitRequest, editorId: string, captureScope: string, corrected: SessionCheckpoint,
    project: (saved: CommitRequest) => EditorRecord, content?: StudyNoteContentCapture | null): Promise<DocumentWriteReceipt | null> {
    const owner = this.owner, generation = this.generation;
    const store = this.options.store;
    if (!owner || owner !== source.owner || !oversizedNoteOpening(source) || !store.compareAndSetWithCheckpoint
      || !corrected.draft || !equalValues(corrected.confirmed, source.working) || !shortenedNoteContent(source.value, corrected.draft)) return null;
    const replacement = this.buildRequest(owner, editorId, corrected, [], undefined, {
      retentionScope: captureScope, noteContent: noteCorrectionOpening(source, content),
    });
    if (!replacement) return null;
    const prepared = this.prepareIndependentUpdate({ ...replacement, initialized: true }, owner);
    if (!prepared || getUtf8ByteLength(JSON.stringify(prepared.command)) > MAX_COMMAND_BYTES) return null;
    const scope = await this.planCancellation('', [source.id], false);
    this.assertCurrent(owner, generation);
    const [previous] = scope.records;
    if (scope.records.length !== 1 || previous.id !== source.id || previous.revision !== source.revision || !oversizedNoteOpening(previous)) return null;

    const { receipt } = await this.receipts.capture(owner, editorId, corrected, async () => {
      const saved = await store.compareAndSetWithCheckpoint!([
        { previous, next: this.cancelledRequest(previous, scope.chosen) },
      ], () => {
        this.assertCurrent(owner, generation);
        return { editorRecords: [project(prepared)], manualRecoveries: [], replacements: [prepared] };
      }, [previous.id]);
      this.assertCurrent(owner, generation);
      saved.forEach(request => this.emit(request));
      this.requested = true;
      return saved.find(request => request.id === prepared.id)!;
    });
    return receipt;
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
      : { request: await this.captureRequest(record, frozenOptions?.checkpoint, frozenOptions?.deferRetention), retired: [] };
    const records = await this.options.store.list(owner);
    check();
    const existing = records.find(record => record.editorId === editorId && record.editGeneration === intent.editGeneration);
    let predecessor = selectSavePredecessor(records, owner, editorId, intent.confirmed.resource, frozenOptions);
    const action = frozenOptions?.action;
    // An ACK can remove the opening from the live controller after it froze this Save.
    // Recover only a request in that frozen checkpoint that still proves what was displayed.
    if (!predecessor && (action?.kind === 'comment-kind' || action?.kind === 'comment-place')) {
      const seen = action.kind === 'comment-kind' ? action.commentKind.seen : action.commentPlace.seen;
      const opening = seen.requestId && Object.prototype.hasOwnProperty.call(intent.pending, seen.requestId)
        ? records.find(record => record.id === seen.requestId && record.state === 'acknowledged') : undefined;
      if (opening && (action.kind === 'comment-kind'
        ? matchesCommentKindRequest(opening, owner, intent.confirmed.resource, action.commentKind.seen)
        : matchesCommentPlaceRequest(opening, owner, intent.confirmed.resource, action.commentPlace.seen))) predecessor = opening;
    }
    if (existing) {
      const outlineMove = frozenOptions?.action ? frozenOptions.action.kind === 'outline-point-placement' ? frozenOptions.action.move : undefined
        : intent.outlinePointPlacementRetry;
      if (existing.retentionScope !== frozenOptions?.retentionScope
        || !equalValues(existing.seriesMembership ?? null, frozenOptions?.seriesMembership ?? null)
        || !equalValues(existing.transferredFrom ?? null, frozenOptions?.transfer?.proof ?? null)) throw new Error('Saved capture retention cannot change');
      const sameGroupPlacement = existing.groupFlowStepPlacement
        && equalValues(groupStepWitness(intent.draft?.flow), existing.groupFlowStepPlacement.after);
      const sameCouncilPlacement = existing.councilTopicPlacement
        && equalValues(councilTopicWitness(intent.draft?.topics), existing.councilTopicPlacement.after);
      const savedMove = existing.outlinePointPlacement;
      const sameTemplatePlacement = intent.confirmed.resource.collection === 'planTemplates' && outlineMove && savedMove
        && sameOutlinePointGesture(savedMove, outlineMove);
      if (intent.dirty && !equalValues(existing.value, intent.draft) && !sameGroupPlacement && !sameCouncilPlacement && !sameTemplatePlacement) {
        throw new Error('Saved generation cannot change its captured intent');
      }
      const result = frozenOptions?.checkpoint ? await capture(existing) : { request: existing, retired: [] };
      check();
      result.retired.forEach(publish);
      return clone(result.request);
    }
    const record = this.buildRequest(owner, editorId, intent, records, predecessor, frozenOptions);
    if (!record) return null;
    const result = await capture(record);
    check();
    result.retired.forEach(publish);
    publish(result.request);
    return clone(result.request);
  }

  /** Build from the exact chosen copy after retiring its answered predecessors. */
  choiceReplacement(editorId: string, intent: SessionCheckpoint,
    options: { action?: EditorCommitAction; predecessor?: CommitRequest; commentTextOpening?: FieldValue } = {}): CommitRequest | null {
    if (!this.owner) throw new Error(AUTHENTICATION_REQUIRED);
    const { action, predecessor, commentTextOpening } = options;
    const replacement = this.buildRequest(this.owner, editorId, intent, [], predecessor, {
      ...(action && { action }), ...(commentTextOpening && { noteContent: null }),
    });
    return replacement && { ...replacement, ...(commentTextOpening && { commentTextOpening }) };
  }

  private buildRequest(owner: string, editorId: string, intent: SessionCheckpoint, records: readonly CommitRequest[],
    predecessor: CommitRequest | undefined, frozenOptions?: CommitSaveOptions): CommitRequest | null {
    const outlineMove = frozenOptions?.action ? frozenOptions.action.kind === 'outline-point-placement' ? frozenOptions.action.move : undefined
      : intent.outlinePointPlacementRetry;
    const accountRetry = intent.accountPreferenceRetry;
    const editorAction = frozenOptions?.action ?? (intent.sourceNoteLinkRetry
      ? { kind: 'sermon-source-note-links', selection: intent.sourceNoteLinkRetry } as const
      : accountRetry
      ? { kind: 'account-preference', fields: [accountRetry.field], time: accountRetry.time } as const
      : intent.serviceOrderPlacementRetry
      ? { kind: 'service-order-placement', move: intent.serviceOrderPlacementRetry } as const
      : intent.serviceOrderStepPlacementRetry
        ? { kind: 'service-order-step-placement', move: intent.serviceOrderStepPlacementRetry } as const
        : intent.outlinePointPlacementRetry ? { kind: 'outline-point-placement', move: intent.outlinePointPlacementRetry } as const
          : intent.groupFlowStepPlacementRetry ? { kind: 'group-flow-step-placement', move: intent.groupFlowStepPlacementRetry } as const
            : intent.councilTopicPlacementRetry ? { kind: 'council-topic-placement', move: intent.councilTopicPlacementRetry } as const : undefined);
    if (intent.conflicts.length || intent.unreadableScalarProof?.length || intent.unreadableRowProofs?.length || intent.unreadableExegeticalProofs?.length) throw Object.assign(new Error('Resolve the conflict before saving'), { code: 'resolve-version-first' });
    const step = editorAction?.kind === 'service-order-flag' ? { field: 'flagged' as const, change: editorAction.flag }
      : editorAction?.kind === 'service-order-step-title' ? { field: 'title' as const, change: editorAction.title }
        : editorAction?.kind === 'service-order-step-scripture' ? { field: 'scriptureRefs' as const, change: editorAction.scripture }
          : editorAction?.kind === 'service-order-step-scripture-review' ? { field: 'scriptureReview' as const, changes: editorAction.scriptures } : undefined;
    const assembly = editorAction?.kind === 'council-assembly' ? editorAction.flag : undefined;
    const topicKind = editorAction?.kind === 'council-topic-kind' ? editorAction.topicKind : undefined;
    if (!step && !assembly && !topicKind && editorAction?.kind !== 'service-order-title' && editorAction?.kind !== 'service-order-placement' && editorAction?.kind !== 'service-order-step-placement' && editorAction?.kind !== 'outline-point-placement' && editorAction?.kind !== 'outline-subpoint-placement' && editorAction?.kind !== 'group-flow-step-placement' && editorAction?.kind !== 'council-topic-placement' && editorAction?.kind !== 'prayer-title' && editorAction?.kind !== 'study-note-title' && editorAction?.kind !== 'study-note-type' && editorAction?.kind !== 'sermon-plan-mode' && editorAction?.kind !== 'comment-kind' && editorAction?.kind !== 'comment-place' && editorAction?.kind !== 'document-tags' && editorAction?.kind !== 'plan-template-name' && editorAction?.kind !== 'tag-color' && editorAction?.kind !== 'prayer-status' && editorAction?.kind !== 'sermon-source-note-links'
      && !frozenOptions?.transfer && !frozenOptions?.noteContent && !intent.dirty && (!predecessor || equalValues(predecessor.value, intent.draft))) return null;
    const baseline = clone(intent.confirmed);
    const removalLineage = frozenOptions?.pendingRemoval && captureRemovalLineage(frozenOptions.pendingRemoval, baseline, predecessor, records);
    const sourceNoteLink = editorAction?.kind === 'sermon-source-note-links'
      ? sourceNoteQueueCapture(editorAction.selection, newClientId) : undefined;
    if (sourceNoteLink && (!intent.draft || !matchesSourceNoteOpening(baseline, sourceNoteLink))) {
      throw Object.assign(new Error('The shown sermon changed'), { code: 'decision-changed' });
    }
    if (editorAction?.kind === 'service-order-step-placement'
      && (baseline.resource.collection !== 'serviceOrders'
        || editorAction.move.generation !== (baseline.metadata?.generation ?? null))) {
      throw Object.assign(new Error('The service order shown when moving the step has changed'), { code: 'generation-mismatch' });
    }
    if (outlineMove && (!outlinePlacementField(baseline.resource.collection)
      || (outlineMove.generation !== null && outlineMove.generation !== baseline.metadata?.generation))) {
      throw Object.assign(new Error('The outline shown when moving the point has changed'), { code: 'generation-mismatch' });
    }
    const priorOutlineMove = outlineMove && outlineMovePredecessor(records, predecessor, outlineMove);
    const groupMove = editorAction?.kind === 'group-flow-step-placement' ? editorAction.move : undefined;
    if (groupMove && (baseline.resource.collection !== 'groups'
      || (baseline.metadata?.generation ?? null) !== groupMove.generation)) {
      throw Object.assign(new Error('The group shown when moving the step has changed'), { code: 'generation-mismatch' });
    }
    const earlierGroupMove = groupMove && groupStepPlacementPredecessor(records, predecessor, groupMove);
    const earlierGroupQueue = earlierGroupMove && sharesEditorOpening(earlierGroupMove.editorId, editorId)
      ? earlierGroupMove.groupFlowStepPlacement?.placement.queueId : undefined;
    const councilMove = editorAction?.kind === 'council-topic-placement' ? editorAction.move : undefined;
    if (councilMove && (baseline.resource.collection !== 'councils'
      || (baseline.metadata?.generation ?? null) !== councilMove.generation)) {
      throw Object.assign(new Error('The council shown when moving the section has changed'), { code: 'generation-mismatch' });
    }
    const councilTopicQueue = baseline.resource.collection === 'councils' ? (predecessor
      && predecessor.baseline.metadata?.generation === baseline.metadata?.generation
      && sharesEditorOpening(predecessor.editorId, editorId) && predecessor.councilTopicQueue) || newClientId() : undefined;
    const earlierCouncilMove = councilMove && councilTopicPlacementPredecessor(records, predecessor, councilMove);
    const councilPredecessor = earlierCouncilMove?.councilTopicQueue === councilTopicQueue ? earlierCouncilMove?.id : undefined;
    const planTextEvidence = baseline.resource.collection === 'sermons' ? captureSermonPlan(baseline, intent.draft, predecessor) : undefined;
    const dateTarget = datedRowTarget(baseline.resource.collection);
    const action = dateTarget && captureDatedRowAction(baseline, predecessor, intent.draft, frozenOptions?.[dateTarget.evidence], records);
    const mark = captureBibleMarkStroke(baseline, predecessor, intent.draft, editorAction?.kind === 'bible-mark-stroke' ? editorAction.time : undefined, records);
    const title = captureServiceOrderTitle(baseline, intent.draft, editorAction?.kind === 'service-order-title' ? editorAction.title : undefined);
    const stepActions = captureServiceOrderStep(baseline, predecessor, intent.draft, step, records);
    const councilAssemblyActions = captureCouncilAssembly(baseline, predecessor, intent.draft, assembly, records);
    const councilTopicKindActions = captureCouncilTopicKind(baseline, predecessor, intent.draft, topicKind, records);
    const prayerCapture = editorAction?.kind === 'prayer-title' ? editorAction.title : undefined;
    const prayerPredecessor = prayerCapture?.seen.requestId
      ? matchesPrayerTitleRequest(records.find(record => record.id === prayerCapture.seen.requestId), owner, baseline.resource, prayerCapture.seen) : false;
    const prayerTitle = capturePrayerTitle(baseline, intent.draft, prayerCapture, prayerPredecessor);
    const noteCapture = editorAction?.kind === 'study-note-title' ? editorAction.title : undefined;
    const noteRequestId = noteCapture?.seen.requestId;
    const noteTitle = captureStudyNoteTitle(baseline, intent.draft, noteCapture, Boolean(noteCapture && noteRequestId
      && matchesStudyNoteTitleRequest(records.find(record => record.id === noteRequestId), owner, baseline.resource, noteCapture.seen)));
    const noteTypeCapture = editorAction?.kind === 'study-note-title' || editorAction?.kind === 'study-note-type' ? editorAction.type : undefined;
    const noteTypeRequestId = noteTypeCapture?.seen.requestId;
    const noteType = captureStudyNoteType(baseline, intent.draft, noteTypeCapture, Boolean(noteTypeCapture && noteTypeRequestId
      && matchesStudyNoteTypeRequest(records.find(record => record.id === noteTypeRequestId), owner, baseline.resource, noteTypeCapture.seen)));
    const noteContent = captureStudyNoteContent(baseline, intent.draft, predecessor, frozenOptions?.noteContent, records);
    const planModeCapture = editorAction?.kind === 'sermon-plan-mode' ? editorAction.mode : undefined;
    const planModeRequestId = planModeCapture?.seen.requestId;
    const planMode = planModeCapture && captureSermonPlanMode(baseline, intent.draft, planModeCapture,
      permitsSermonPlanModePredecessor(records.find(record => record.id === planModeRequestId), owner, baseline.resource, planModeCapture.seen));
    const kindCapture = editorAction?.kind === 'comment-kind' ? editorAction.commentKind : undefined;
    const kindPredecessor = commentOpeningPredecessor(records, predecessor, kindCapture?.seen.requestId);
    const commentKind = kindCapture && captureCommentKind(baseline, intent.draft, kindCapture,
      matchesCommentKindRequest(kindPredecessor, owner, baseline.resource, kindCapture.seen));
    if (kindCapture && !commentKind) throw Object.assign(new Error('The comment kind opening changed'), { code: 'comment-kind-basis-changed' });
    const placeCapture = editorAction?.kind === 'comment-place' ? editorAction.commentPlace : undefined;
    const placePredecessor = commentOpeningPredecessor(records, predecessor, placeCapture?.seen.requestId);
    const commentPlace = placeCapture && captureCommentPlace(baseline, intent.draft, placeCapture,
      matchesCommentPlaceRequest(placePredecessor, owner, baseline.resource, placeCapture.seen));
    if (placeCapture && !commentPlace) throw Object.assign(new Error('The comment move opening changed'), { code: 'comment-place-basis-changed' });
    const studyNoteReferenceEvidence = baseline.resource.collection === 'studyNotes' && editorAction && 'referenceEvidence' in editorAction
      ? editorAction.referenceEvidence : undefined;
    const tagMembership = editorAction && 'tagMembership' in editorAction ? editorAction.tagMembership : undefined;
    const tagMembershipActions = captureDocumentTags(baseline, predecessor, intent.draft, tagMembership, records);
    const templateCapture = editorAction?.kind === 'plan-template-name' ? editorAction.name : undefined;
    const templateRequestId = templateCapture?.seen.requestId;
    const templateName = capturePlanTemplateName(baseline, intent.draft, templateCapture, Boolean(templateCapture && templateRequestId
      && matchesPlanTemplateNameRequest(records.find(record => record.id === templateRequestId), owner, baseline.resource, templateCapture.seen)));
    const colorCapture = editorAction?.kind === 'tag-color' ? editorAction.color : undefined;
    const colorRequestId = colorCapture?.seen.requestId;
    const tagColor = captureTagColor(baseline, intent.draft, colorCapture, Boolean(colorCapture && colorRequestId
      && matchesTagColorRequest(records.find(record => record.id === colorRequestId), owner, baseline.resource, colorCapture.seen)));
    const prayerStatus = capturePrayerStatusFields(baseline, predecessor, intent.draft,
      editorAction?.kind === 'prayer-status' ? editorAction.status : undefined, records, owner);
    const preparationChecks = editorAction?.kind === 'sermon-preparation-check'
      ? capturePreparationConfirmation(baseline, predecessor, intent.draft, editorAction, records) : undefined;
    const metadataTime = editorAction?.kind === 'account-preference' || editorAction?.kind === 'document-metadata'
      ? editorAction.time : frozenOptions?.documentMetadataTime;
    const metadataFields = captureDocumentMetadataFields(baseline, predecessor, intent.draft, metadataTime, records,
      editorAction?.kind === 'account-preference' ? editorAction.fields : undefined);
    const exegeticalPlanActions = captureExegeticalPointActions(intent, baseline, predecessor, records);
    const homileticTitleActions = captureHomileticTitles(baseline, predecessor, intent.draft, metadataTime, records);
    const homileticMoveActions = captureHomileticMoves(baseline, predecessor, intent.draft, frozenOptions?.homileticMoves, metadataTime, records);
    const outlineSubpointMoves = editorAction?.kind === 'outline-subpoint-placement' ? [editorAction.move] : frozenOptions?.outlineSubpointMoves;
    const homileticPositionReviews = editorAction?.kind === 'document-metadata' && editorAction.homileticPositionReview && baseline.metadata
      ? { [editorAction.homileticPositionReview]: baseline.metadata.revision } : undefined;
    const autosaveFields = groupMove || councilMove ? {} : uncapturedAutosaveFields(intent, baseline, predecessor, records);
    const rowFields = groupMove || councilMove ? {}
      : captureRowFields(intent, baseline, predecessor, records, frozenOptions?.documentMetadataTime, frozenOptions?.thoughtPlacementIds, frozenOptions?.thoughtTextId);
    const thoughtTagActions = captureThoughtTagActions(baseline, predecessor, intent.draft, frozenOptions?.thoughtTagId, frozenOptions?.documentMetadataTime, records);
    const groupMeetingFieldActions = captureMeetingFieldActions(baseline, predecessor, intent.draft, frozenOptions?.groupMeetingFieldCaptures, records);
    const preachDateFieldActions = capturePreachDateFields(baseline, predecessor, intent.draft, frozenOptions?.preachDateFieldSave, records);
    const preachStatusActions = capturePreachStatusActions(baseline, predecessor, intent.draft, frozenOptions?.preachStatusCapture, records);
    const basis = predecessor?.value ?? baseline.value;
    const firstMeeting = baseline.resource.collection === 'groups' ? captureFirstGroupMeetingChange(basis, intent.draft) : undefined;
    const templateMove = outlineMove && baseline.resource.collection === 'planTemplates';
    const value = groupMove ? projectGroupStepOnDocument(basis, groupMove)
      : councilMove ? projectCouncilTopicOnDocument(basis, councilMove)
        : templateMove ? projectResourceOutlinePoint('planTemplates', basis, outlineMove) : intent.draft;
    if (templateMove && !value) throw Object.assign(new Error('The template point position is unavailable'), { code: 'decision-changed' });
    return {
      id: this.options.operationId(), owner, editorId, editGeneration: intent.editGeneration,
      ...(councilTopicQueue && { councilTopicQueue }),
      ...(mark && { bibleMarkStroke: mark }),
      ...(title && { serviceOrderTitleAction: title }),
      ...(editorAction?.kind === 'service-order-placement' && { serviceOrderPlacement: editorAction.move }),
      ...(editorAction?.kind === 'service-order-step-placement' && { serviceOrderStepPlacement: editorAction.move }),
      ...(outlineMove && { outlinePointPlacement: { ...outlineMove, placement: { ...outlineMove.placement,
        ...(priorOutlineMove && { predecessorOperationId: priorOutlineMove }),
      } } }),
      ...(councilMove && { councilTopicPlacement: { ...councilMove, placement: { ...councilMove.placement,
        ...(councilPredecessor && { predecessorOperationId: councilPredecessor }),
      } } }),
      ...(groupMove && { groupFlowStepPlacement: { ...groupMove, placement: { ...groupMove.placement,
        queueId: earlierGroupQueue || newClientId(),
        ...(earlierGroupQueue && earlierGroupMove && { predecessorOperationId: earlierGroupMove.id }),
      } } }),
      ...stepActions,
      ...(councilAssemblyActions && { councilAssemblyActions }),
      ...(councilTopicKindActions && { councilTopicKindActions }),
      ...(prayerTitle && { prayerTitleAction: prayerTitle }),
      ...(noteTitle && { studyNoteTitleAction: noteTitle }),
      ...(noteContent && { studyNoteContentAction: noteContent }),
      ...(noteType && { studyNoteTypeAction: noteType }),
      ...(planMode && { sermonPlanModeAction: planMode }),
      ...(commentKind && { commentKindAction: commentKind }),
      ...(commentPlace && { commentPlaceAction: commentPlace }),
      ...(templateName && { planTemplateNameAction: templateName }),
      ...(tagColor && { tagColorAction: tagColor }),
      ...prayerStatus,
      ...metadataFields,
      ...(preparationChecks && { sermonPreparationCheckActions: preparationChecks }),
      ...(exegeticalPlanActions && { exegeticalPlanActions }),
      ...(homileticTitleActions && { homileticTitleActions }),
      ...(homileticMoveActions && { homileticMoveActions }),
      ...(outlineSubpointMoves?.length && { outlineSubpointMoves: clone([...outlineSubpointMoves]) }),
      ...(homileticPositionReviews && { homileticPositionReviews }),
      ...autosaveFields,
      ...rowFields,
      ...(thoughtTagActions && { thoughtTagActions }),
      ...(tagMembershipActions && { tagMembershipActions }),
      ...(studyNoteReferenceEvidence && { studyNoteReferenceEvidence: clone(studyNoteReferenceEvidence) }),
      ...(sourceNoteLink && { sourceNoteLink }),
      ...(editorAction?.kind === 'sermon-note-text' && { sermonNoteText: editorAction.opening }),
      ...(editorAction?.kind === 'sermon-plan-text' && { sermonTextOpenings: Object.fromEntries(
        Object.entries(editorAction.openings).map(([id, revision]) => [sermonTextKey('planText', id), revision])),
      }),
      ...(groupMeetingFieldActions && { groupMeetingFieldActions }),
      ...(firstMeeting && { groupFirstMeetingChange: firstMeeting }),
      ...(preachDateFieldActions && { preachDateFieldActions }),
      ...(preachStatusActions && { preachStatusActions }),
      ...(dateTarget && action && { [dateTarget.evidence]: action }),
      ...(frozenOptions?.retentionScope ? { retentionScope: frozenOptions.retentionScope } : {}),
      ...(frozenOptions?.seriesMembership && { seriesMembership: frozenOptions.seriesMembership }),
      ...(frozenOptions?.transfer ? { transferredFrom: clone(frozenOptions.transfer.proof) } : {}),
      ...(removalLineage && { removalLineage }),
      baseline, value: clone(value), predecessor: predecessor?.id ?? null,
      ...(planTextEvidence ? { planTextEvidence } : {}),
      revision: 0, initialized: false, working: baseline, intended: clone(value),
      command: null, submitted: null, sequence: 0, state: 'queued', result: null, unfinalized: [],
    };
  }

  private async captureRequest(record: CommitRequest, checkpoint?: (saved: CommitRequest) => EditorRecord, deferRetention?: true): Promise<CommitRequest> {
    if (checkpoint && this.options.store.createWithCheckpoint) {
      return this.options.store.createWithCheckpoint(record, checkpoint, ...(deferRetention ? [{ deferRetention }] as const : []));
    }
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
          || !equalValues(frozen[index].seriesMembership ?? null, record!.seriesMembership ?? null)
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
        ...(item.seriesMembership && { seriesMembership: item.seriesMembership }),
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
    review?: { roots: readonly CommitRequest[]; retained?: ReadonlySet<string>; placementChoice?: ReadonlyMap<string, ResourceSnapshot>; groupTextReview?: true }
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
    if (records.some(record => record.groupTextReview) && !reviewed?.groupTextReview) {
      throw Object.assign(new Error('Finish comparing the group fields'), { code: 'decision-changed' });
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
    const placementByRequest = new Map<string, ResourceSnapshot>();
    for (const root of reviewed?.roots ?? []) {
      const stored = reviewed?.placementChoice?.get(root.id);
      if (stored) for (const request of cancellationScope(records, '', [root.id])) placementByRequest.set(request.id, stored);
    }
    const saved = await this.options.store.compareAndSetWithCheckpoint(records.map(previous => ({ previous,
      next: { ...this.cancelledRequest(previous, chosen), ...(reviewed && !chosen.has(previous.id) && (reviewed.retained?.has(previous.id) ?? true)
        ? { retainedAfterChoice: true as const } : {}),
      ...(placementByRequest.has(previous.id) && { placementChoiceStored: placementByRequest.get(previous.id) }) },
    })), requests => {
      this.assertCurrent(owner, generation);
      return project(requests);
    }, choiceRequestIds);
    this.assertCurrent(owner, generation);
    this.requested = true;
    const projected = placementByRequest.size ? orderCommitRequests(saved) : saved;
    projected.forEach(request => this.emit(request));
  }

  async stageGroupTextReview(root: CommitRequest, stage: GroupTextReviewStage,
    project: (saved: CommitRequest) => EditorRecord): Promise<void> {
    if (!this.options.store.compareAndSetWithCheckpoint) throw new Error('Atomic choice checkpoint storage is required');
    const { owner, generation, records } = await this.planCancellation('', [root.id], false);
    if (records.length !== 1 || records[0].id !== root.id || records[0].revision !== root.revision
      || root.state !== 'conflict' || root.baseline.resource.collection !== 'groups') {
      throw Object.assign(new Error('The shown saved copy changed'), { code: 'decision-changed' });
    }
    const [saved] = await this.options.store.compareAndSetWithCheckpoint(
      [{ previous: root, next: { ...root, groupTextReview: stage } }], ([request]) => {
        this.assertCurrent(owner, generation);
        return project(request);
      }, [root.id]);
    this.assertCurrent(owner, generation);
    this.emit(saved);
  }

  /** Only the action owner may retire a relation and its dependent local work. */
  cancelAction(requestIds: readonly string[], onlyThoseRequests = false): Promise<void> {
    return this.cancelOwned('', requestIds, true, onlyThoseRequests);
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

  private async cancelOwned(editorId: string, additionalRequestIds: readonly string[], wholeAction: boolean, onlyThoseRequests = false): Promise<void> {
    const { owner, generation, records, chosen } = await this.planCancellation(editorId, additionalRequestIds, wholeAction);
    if (onlyThoseRequests && records.some(record => !additionalRequestIds.includes(record.id))) {
      throw Object.assign(new Error('A later Save depends on this assignment'), { code: 'membership-stage-changed' });
    }
    if (records.some(record => record.groupTextReview && record.state === 'conflict')) {
      throw Object.assign(new Error('Finish comparing the group fields'), { code: 'decision-changed' });
    }
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
    const prerequisites = record.serviceOrderPlacement?.afterRequests;
    if (prerequisites?.length) {
      const requiredMoves = records.filter(candidate => prerequisites.includes(candidate.id));
      if (requiredMoves.some(candidate => ['cancelled', 'refused', 'conflict'].includes(candidate.state))) {
        return this.persistTransition(record, { ...record, state: 'refused',
          result: { kind: 'refused', operationId: record.id, code: 'service-order-position-needs-review' } }, owner, generation).then(() => true);
      }
      if (requiredMoves.some(candidate => candidate.state !== 'acknowledged')) return Promise.resolve(false);
    }
    const participants = atomicParticipants(record, records);
    // An earlier refused Save can leave a later Save waiting forever. Resolve that
    // Delete outcome during initialization, before its normal delivery frontier.
    if (participants.some(participant => (participant.initialized || !participant.removalLineage)
      && !deleteOrderReady(participant, records))) return Promise.resolve(false);
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
    const placement = record.sequence === 0 ? record.serviceOrderPlacement : undefined;
    if (placement && record.working.value) {
      // A one-shot move affects one logical position. Preserve other fields from the latest ACK.
      const source = { ...record.working, value: writeField(record.working.value, ['rank'], placement.before) };
      const intended = { ...record.working.value, rank: placement.rank };
      const { command, submittedValue } = prepareDomainCommand(owner, operationId, source, intended, [], undefined, ['rank']);
      if (command.kind !== 'update') throw new Error('A service-order placement requires an update');
      return { ...record, command: { ...command, dependsOn: placement.afterRequests ?? [], serviceOrderPlacement: placement.placement }, submitted: submittedValue, state: 'prepared' };
    }
    const stepMove = record.sequence === 0 ? record.serviceOrderStepPlacement : undefined;
    if (stepMove && record.working.value) {
      const before = stepMove.shownIds.map(id => ({ id }));
      const after = projectServiceOrderStep(before, stepMove.placement.stepId, stepMove.placement.destination);
      if (!after) throw new Error('Invalid captured service step placement');
      const command: DataCommand = {
        protocol: 1, kind: 'update', operationId, owner, resource: record.working.resource,
        generation: record.working.metadata?.generation ?? null, dependsOn: [],
        changes: [{ path: ['steps'], before: { exists: true, value: before }, after: { exists: true, value: after } }],
        serviceOrderStepPlacement: stepMove.placement,
      };
      const source = placementSteps(record.working.value.steps);
      const sentPosition = source && projectServiceOrderStep(source, stepMove.placement.stepId, stepMove.placement.destination);
      // A stale working copy must not prevent the captured command from reaching the server.
      const submitted = sentPosition ? { ...record.working.value, steps: sentPosition } : record.working.value;
      return { ...record, command, submitted, state: 'prepared' };
    }
    const groupMove = record.sequence === 0 ? record.groupFlowStepPlacement : undefined;
    if (groupMove && record.working.value && groupMove.placement.queueId) {
      const { predecessorOperationId, queueId } = groupMove.placement;
      const legacyRevision = groupMove.generation === null && groupMove.placement.observedRevision === 0
        && equalValues(groupStepWitness(record.working.value.flow), groupMove.before) ? record.groupFlowPlacementLegacyRevision : undefined;
      const command: DataCommand = {
        protocol: 1, kind: 'update', operationId, owner, resource: record.working.resource,
        generation: record.working.metadata?.generation ?? null, dependsOn: predecessorOperationId ? [predecessorOperationId] : [],
        changes: [{ path: ['flow'], before: { exists: true, value: groupMove.before },
          after: { exists: true, value: groupMove.after } }],
        groupFlowStepPlacement: { ...groupMove.placement, queueId,
          ...(legacyRevision && { observedRevision: legacyRevision }) },
      };
      return { ...record, command, submitted: record.intended, state: 'prepared' };
    }
    const councilMove = record.sequence === 0 ? record.councilTopicPlacement : undefined;
    if (councilMove && record.working.value && record.councilTopicQueue) {
      const previous = councilMove.placement.predecessorOperationId;
      const legacyRevision = councilMove.generation === null && councilMove.placement.observedRevision === 0
        && equalValues(councilTopicWitness(record.working.value.topics), councilMove.before) ? record.councilTopicPlacementLegacyRevision : undefined;
      const command: DataCommand = {
        protocol: 1, kind: 'update', operationId, owner, resource: record.working.resource,
        generation: record.working.metadata?.generation ?? null, dependsOn: previous ? [previous] : [],
        changes: [{ path: ['topics'], before: { exists: true, value: councilMove.before },
          after: { exists: true, value: councilMove.after } }],
        councilTopicQueue: record.councilTopicQueue,
        councilTopicPlacement: legacyRevision ? { ...councilMove.placement, observedRevision: legacyRevision } : councilMove.placement,
      };
      return { ...record, command, submitted: record.intended, state: 'prepared' };
    }
    const outlineMove = record.sequence === 0 ? record.outlinePointPlacement : undefined;
    const outlineField = outlinePlacementField(record.working.resource.collection);
    if (outlineMove && outlineField && record.working.value) {
      const previous = outlineMove.placement.predecessorOperationId;
      const legacyRevision = outlineMove.generation === null && outlineMove.placement.observedRevision === 0
        && hasOutlinePointOrder(record.working.value[outlineField], outlineMove.before) ? record.outlinePointPlacementLegacyRevision : undefined;
      const provenRevision = record.outlinePointPlacementBirthRevision ?? legacyRevision;
      const command: DataCommand = {
        protocol: 1, kind: 'update', operationId, owner, resource: record.working.resource,
        generation: record.working.metadata?.generation ?? null, dependsOn: previous ? [previous] : [],
        changes: [{ path: [outlineField], before: { exists: true, value: outlineMove.before },
          after: { exists: true, value: outlineMove.after } }],
        outlinePointPlacement: provenRevision ? { ...outlineMove.placement, observedRevision: provenRevision } : outlineMove.placement,
      };
      const submitted = projectResourceOutlinePoint(record.working.resource.collection, record.working.value, outlineMove) ?? record.working.value;
      return { ...record, command, submitted, state: 'prepared' };
    }
    const markRebase = pendingBibleMarkRebase(record);
    const fields = record.sequence === 0 ? documentFieldTargets(record.working.resource.collection) : [];
    const commentKind = record.sequence === 0 ? record.commentKindAction : undefined;
    const commentPlace = record.sequence === 0 ? record.commentPlaceAction : undefined;
    if (commentPlace && (record.working.metadata?.generation !== record.baseline.metadata?.generation
      || !matchesCommentPlaceScope(record.working.value, commentPlace.before, commentPlace.paragraph)
      || !matchesCommentPlaceDestination(record.intended, commentPlace.after, commentPlace.paragraph, commentPlace.compound))) {
      return { ...record, state: 'refused', result: { kind: 'refused', operationId: record.id, code: 'decision-changed' } };
    }
    const meeting = pendingMeetingDateRebase(record);
    let source = record.working;
    if (record.sequence === 0 && record.commentTextOpening && source.value) {
      source = { ...source, value: writeField(source.value, ['content'], record.commentTextOpening) };
    }
    for (const target of fields) {
      const action = capturedDocumentField(record, target);
      if (action) source = documentFieldCommandAncestor(source, action, target);
    }
    if (markRebase) source = restoreBibleMarkAncestor(source, markRebase);
    if (record.sequence === 0 && record.exegeticalQueueBasis) source = restoreExegeticalQueueBasis(source, record.exegeticalQueueBasis);
    source = restoreHomileticOpenings(source, record);
    // Even when the previous ACK already shows the intended date, the server
    // still needs this action's exact ancestor and time to arbitrate later deliveries.
    if (meeting && source.value) {
      const rows = replaceExistingDate(source.value.meetingDates, meeting.rowId, meeting.before, MEETING_DATE_TARGET);
      if (rows !== undefined) source = { ...source, value: { ...source.value, meetingDates: rows } };
    }
    const documentTags = pendingDocumentTags(record);
    source = restoreDocumentTagAncestor(source, documentTags);
    const rowFields = pendingRowFields(record);
    for (const { action, target } of rowFields) {
      if (!source.value) break;
      if (target === SERVICE_ORDER_FLAG_TARGET && existingRowField(source.value[target.field], action.rowId, target) === action.before) continue;
      const rows = replaceExistingRowField(source.value[target.field], action.rowId, action.before, target);
      if (rows !== undefined) source = { ...source, value: { ...source.value, [target.field]: rows } };
    }
    const status = pendingPreachStatusActions(record);
    if (source.value && status.length) source = { ...source, value: replacePreachStatuses(source.value, status, 'before') };
    const retainedRoots = rowFields.filter(({ action }) => equalValues(action.before, action.after)).map(({ target }) => target.field);
    if (status.length) retainedRoots.push('preachDates');
    const subpointMoves = record.sequence === 0 ? record.outlineSubpointMoves : undefined;
    if (subpointMoves?.length && outlineField) retainedRoots.push(outlineField);
    const noteOpening = record.sequence === 0 ? record.sermonNoteText : undefined;
    if (noteOpening) {
      const original = matchesSermonNoteOpening(source, noteOpening) && withSermonNoteText(source.value, noteOpening.target, noteOpening.text);
      if (!original) return { ...record, state: 'refused', result: { kind: 'refused', operationId: record.id, code: 'decision-changed' } };
      source = { ...source, value: original };
    }
    const sourceNoteLink = record.sequence === 0 ? record.sourceNoteLink : undefined;
    let intended = record.intended;
    if (sourceNoteLink) {
      if (!source.value || !intended || !matchesSourceNoteOpening(source, sourceNoteLink)) {
        return { ...record, state: 'refused', result: { kind: 'refused', operationId: record.id, code: 'decision-changed' } };
      }
      ({ source, intended } = sourceNoteCommandCopies(source, intended, sourceNoteLink));
      retainedRoots.push(SOURCE_NOTE_FIELD);
    }
    const mode = record.sequence === 0 ? record.sermonPlanModeAction : undefined;
    if (mode && equalValues(mode.before, mode.after)) retainedRoots.push('planMode');
    const firstMeeting = initialMeetingChange(record);
    if (firstMeeting) retainedRoots.push('meetingDates');
    try {
      const participant = seriesCommandParticipant(record);
      prepared = participant.captured
        ? { command: prepareAtomicSeriesCommand(owner, operationId, [participant]), submittedValue: record.intended }
        : prepareDomainCommand(owner, operationId, source, intended, targets, evidence, retainedRoots);
    } catch (error) {
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
    if (command.kind === 'update' && command.analysisFrameObservedRevision !== undefined
      && record.analysisFramePredecessorRevision !== undefined) {
      command.analysisFrameObservedRevision = record.analysisFramePredecessorRevision;
    }
    if (command.kind === 'update' && command.resource.collection === 'sermons' && record.sequence === 0) {
      if (record.sermonTextPredecessorRevision !== undefined && command.sermonTextObservedRevision !== undefined) {
        command.sermonTextObservedRevision = record.sermonTextPredecessorRevision;
      }
      const note = record.sermonNoteText;
      const target = note?.target;
      const openings = selectSermonTextOpenings(command.changes,
        note && target ? { ...record.sermonTextOpenings,
          [target.kind === 'scratch' ? sermonTextKey('scratch', target.id, target.createdAt) : sermonTextKey('outline', target.id)]:
            note.observedRevision ?? null, ...record.sermonTextContinuation }
          : { ...record.sermonTextOpenings, ...record.sermonTextContinuation });
      if (openings) command.sermonTextOpenings = openings;
    }
    if (record.sequence === 0 && command.kind === 'update' && record.studyNoteReferenceChange) {
      const referenceChange = record.studyNoteReferenceChange;
      command.changes = command.changes.map(change => equalValues(change.path, referenceChange.path) ? clone(referenceChange) : change);
    }
    if (record.sequence === 0 && command.kind === 'update' && command.resource.collection === 'studyNotes'
      && command.generation === record.baseline.metadata?.generation
      && command.changes.some(change => change.path.length === 1 && change.path[0] === 'scriptureRefs')) {
      const evidence = record.studyNoteReferenceEvidence;
      if (evidence?.times) command.studyNoteReferenceTimes = clone(evidence.times);
      if (evidence?.observedRevisions) command.studyNoteReferenceObservedRevisions = clone(evidence.observedRevisions);
    }
    if (firstMeeting && command.kind === 'update') {
      command.changes = command.changes.map(change => change.path[0] === 'meetingDates' ? clone(firstMeeting) : change);
    }
    if (command.kind === 'update' && record.sequence === 0 && record.rebasedGroupCopySources) {
      const live = command.groupFlowCopySources ?? [];
      const liveIds = new Set(live.map(source => source.id));
      const fallback = matchingGroupFlowCopySources(command.changes, record.rebasedGroupCopySources)
        .filter(source => !liveIds.has(source.id));
      if (fallback.length) command.groupFlowCopySources = [...live, ...fallback];
    }
    if (command.kind === 'update' && record.sequence === 0 && record.rebasedGroupRetirements) {
      const sources = matchingGroupFlowRetirements(command.changes, record.rebasedGroupRetirements);
      const capturedIds = new Set(sources.map(source => source.id));
      const other = command.groupFlowRetirements?.filter(source => !capturedIds.has(String(source.id))) ?? [];
      if (sources.length) command.groupFlowRetirements = [...sources, ...other];
    }
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
      const stepScripture = record.serviceOrderStepScriptureActions;
      const reviewed = stepScripture?.reviewed?.filter(action => matchesServiceOrderStep(command.changes, SERVICE_ORDER_STEP_SCRIPTURE_LIST, action));
      if (reviewed?.length) command.serviceOrderStepScriptureActions = { reviewed };
      else if (stepScripture && matchesServiceOrderStep(command.changes, SERVICE_ORDER_STEP_SCRIPTURE_LIST, stepScripture.scriptureRefs)) {
        command.serviceOrderStepScriptureActions = stepScripture;
      }
      const exegeticalActions = matchingExegeticalPointActions(command.changes, record.exegeticalPlanActions);
      if (exegeticalActions) command.exegeticalPlanActions = exegeticalActions;
      const homileticTitles = matchingHomileticTitles(command.changes, record.homileticTitleActions);
      if (homileticTitles) command.homileticTitleActions = homileticTitles;
      const homileticMoves = matchingHomileticMoves(command.changes, record.homileticMoveActions);
      if (homileticMoves) command.homileticMoveActions = homileticMoves;
      const outlineField = outlinePlacementField(command.resource.collection);
      if (record.outlineSubpointMoves?.length && outlineField && command.changes.some(change => change.path[0] === outlineField)) {
        const preceding = record.outlineSubpointPredecessor;
        command.outlineSubpointMoves = record.outlineSubpointMoves.map(move => preceding?.childIds.includes(move.subPointId)
          ? { ...clone(move), predecessorOperationId: preceding.operationId } : clone(move));
        command.dependsOn = [...new Set([...command.dependsOn, ...command.outlineSubpointMoves.flatMap(move =>
          move.predecessorOperationId ? [move.predecessorOperationId] : [])])];
      }
      const homileticReviews = matchingHomileticPositionReviews(command.changes, record);
      if (homileticReviews) command.homileticPositionReviews = homileticReviews;
      const tags = thoughtTagCommandActions(command.changes, record.thoughtTagActions);
      if (tags.length) command.thoughtTagActions = tags;
      const membership = documentTagChange(command.changes);
      const matched = membership && documentTagCommandActions(membership, documentTags);
      if (matched?.length) command.tagMembershipActions = matched;
      const { councilOutcomeActions, councilTopicSummaryActions, groupBlockContentActions, groupStepNotesActions, thoughtTextActions, ...rowFields } = matchingRowFields(command.changes, record, command.resource.collection);
      Object.assign(command, rowFields);
      // The two row arrays on the command already carry these exact values.
      for (const [key, actions] of Object.entries({ councilOutcomeActions, councilTopicSummaryActions, groupBlockContentActions, groupStepNotesActions, thoughtTextActions })) {
        if (actions) Object.assign(command, { [key]: compactRowTextStamps(actions) });
      }
      const assembly = matchingCouncilAssembly(command.changes, record.councilAssemblyActions);
      if (assembly) command.councilAssemblyActions = assembly;
      const topicKind = matchingCouncilTopicKind(command.changes, record.councilTopicKindActions);
      if (topicKind) command.councilTopicKindActions = topicKind;
      const statusActions = matchingPreachStatusActions(command.changes, status);
      if (statusActions.length) command.preachStatusActions = statusActions;
    }
    if (sourceNoteLink) {
      if (command.kind !== 'update' || !validSourceNoteLinkAction(sourceNoteLink.action, sourceNoteLinkChange(command.changes), isValidIdentifier)) {
        return { ...record, state: 'refused', result: { kind: 'refused', operationId: record.id, code: 'decision-changed' } };
      }
      command.sourceNoteLinkAction = sourceNoteLink.action;
    }
    if (record.councilTopicQueue && command.resource.collection === 'councils' && (command.kind === 'create'
      || (command.kind === 'update' && command.changes.some(change => change.path.length === 1 && change.path[0] === 'topics')))) {
      command.councilTopicQueue = record.councilTopicQueue;
    }
    const stamped = fields.reduce((current, target) => withDocumentFieldAction(current, target, capturedDocumentField(record, target)), command);
    if (commentKind && (stamped.kind !== 'update' || !stamped.commentKindAction)) {
      return { ...record, state: 'refused', result: { kind: 'refused', operationId: record.id, code: 'decision-changed' } };
    }
    if (commentPlace && (stamped.kind !== 'update' || !stamped.commentPlaceAction)) {
      return { ...record, state: 'refused', result: { kind: 'refused', operationId: record.id, code: 'decision-changed' } };
    }
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
    const rebased = mergeDocumentAfterAcknowledgement(record.submitted, record.intended, result.snapshot);
    if (rebased.conflicts.length) return commit({ ...record, state: 'conflict', result: { kind: 'conflict', operationId: record.id, snapshot: result.snapshot, conflicts: rebased.conflicts } });
    const intended = rebased.value.exists ? rebased.value.value as DocumentData : null;
    const complete = equalValues(intended, result.snapshot.value);
    const sermonText = committedSermonText(record.command, result);
    // The durable request owns projection; an editor is not needed to retire ACKs.
    return commit({ ...record, working: clone(result.snapshot), intended, committedSermonText: sermonText,
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
