import { hasOutlinePointOrder, SECTION_KEYS, type OutlinePointOrder } from '@/utils/outlineDnd';
import { projectServiceOrderStep } from '@/utils/serviceOrderStepPlacement';
import { isOrdinaryStudyNote } from '@/utils/studyNoteType';

import { accountPreferenceRetryFields, needsAccountPreferenceReview, readAccountPreferenceReview } from './accountPreference';
import { hasDifferentAnalysisPositionBasis, keepAnalysisReshapeFrame } from './analysisReshapeFields';
import { isLiveWholeAction, isRetiredActionDependent } from './atomicCommits';
import { keepReviewedAuthoredLists } from './authoredListChoice';
import { firstBookMarksIntent } from './bibleMarksCreation';
import { commentPlaceValue, matchesCommentPlaceScope, replaceCommentReference } from './commentPlaceAction';
import { readCommentPlaceComparison } from './commentPlaceChoice';
import { COUNCIL_LIFECYCLE, COUNCIL_TIMED_FIELDS, councilLifecycleValue, withCouncilLifecycle } from './councilFieldAction';
import { projectCouncilTopicOnDocument } from './councilTopicPlacement';
import { councilTopicConflictCode, rejectCouncilTopicChoice } from './councilTopicTransition';
import { adoptAcknowledgedStudyNoteFields, autosaveAcknowledgementAncestor, autosaveFieldTargets, cancelledAutosaveProjection, carryAutosaveFieldDrafts, GROUP_TIMED_FIELDS, hasHeldAutosaveFields, hasUncapturedAutosaveField, matchingHeldAutosaveFields, retireObservedAutosaveFields, stageAutosaveField, submittedCoversAutosaveDraft } from './documentFieldAction';
import { keepExactLocalDocumentTags } from './documentTagChoice';
import { rebaseOptionalPrayerTags } from './documentTagMembership';
import { prepareDomainCommand } from './domainPolicy';
import { ACTION_SLOT, editorSlot } from './editorIdentity';
import { mergeUnsentObservation } from './editorObservation';
import { exegeticalPointConflictId } from './exegeticalPointAction';
import { mergeExegeticalPointChoice, stageExegeticalPoint, UNREADABLE_EXEGETICAL_PROOF, unreadableExegeticalChoice, type UnreadableExegeticalProof } from './exegeticalPointCapture';
import { object, readField, writeField } from './fieldValues';
import { firstGroupMeetingReview, projectFirstGroupMeetingChoice } from './groupFirstMeeting';
import { GROUP_FLOW_COPY_CONTENT_MISSING, keepGroupFlowCopyContent } from './groupFlowTopology';
import { groupCopySourceIdsForReview, hasHeldGroupCopies, hasUnreviewedGroupCopy } from './groupPrivateCopyReview';
import { carryAnchoredDraftChronology, groupPlacementMergeFrame, mergeEditsAfterAnchoredPlacement, mergeGroupFlowRebase, restoreGroupPlacementOrder } from './groupStepPlacement';
import { chooseLocalPlacement } from './localPlacementChoice';
import { projectManualSelection } from './manualScope';
import { projectOutlineParentChoice, type OutlineTitleDecision } from './outlineParentChoice';
import { outlinePlacementField } from './outlinePlacementResource';
import { alignPendingOutlinePointPlacements, sameOutlinePointGesture } from './outlinePointPlacement';
import { outlineTitleChoiceFrames, prepareOutlineTitleEdit, readOutlineTitleComparison, unresolvedOutlineTitleConflicts } from './outlineTitleEdit';
import { chooseLocalPreachDateEdits, isOrderedPreachDateField, preachDateChoiceFrames } from './preachDateChoice';
import { readPrivateDocumentReview } from './privateDocumentReview';
import { privateFieldDecision, type PrivateFieldDecision } from './privateFieldReview';
import { equalValues, mergeDocumentAfterAcknowledgement, mergeDocumentFields, mergeFields } from './protocol';
import { compactRowTextStamps } from './rowDetailAction';
import { acknowledgeRowFields, captureRowFields, carryOutlineTitleActions, clearRowFieldDrafts, hasUncapturedAutosaveRowField, matchingRowFields, PREACH_DATE_REVIEW_FIELDS, registerRowFields, retireObservedAutosaveRowFields, rowFieldAckAncestor, stageReviewedCouncilTopics, stageReviewedGroupFlowText, stageReviewedRowFields, stageReviewedOutlineTitleIds, stageReviewedOutlineTitles, stageRowFields, unreadableRowChoice, type UnreadableRowProof } from './rowFieldAutosave';
import { keepReselectedRowFields } from './rowReselectionChoice';
import { chooseRecoveredSermonChurch, readRecoveredSermonChurch, validSermonChurchRecovery, type SermonChurchRecovery } from './sermonChurchRecovery';
import { readSermonPlanModeComparison, readSermonPreparationConfirmation } from './sermonFieldChoice';
import { capturedGuardedScratchTextPath, guardedScratchTextReview, preparedRecoveredScratchText, projectGuardedScratchText, reviewedPlacedSketchOpening } from './sermonGuardedScratchText';
import { hasSermonOutlineReview, prepareSermonOutlineReview, projectSermonOutlineDecision, refreshSermonOutlineReview, type SermonOutlineReviewInput } from './sermonOutlineReview';
import { isPlacedSketchConflict, observePlacedSketchConflicts, resolvePlacedSketchComparison } from './sermonPlacedSketchRecovery';
import { acceptPlanCellComparison, adoptFirstPlanCellVersion, preservePlanCellComparisons, projectStoredPlanCellChoice, reservePrivatePlanCells, retainPlanCellDrafts, reviewObservedPlanCells, stagePlanCell } from './sermonPlanCellSession';
import { hasPrivateSermonPointMove, readRootPointOrder, retainedRootOrderChanged, storedSermonPointOrderChoice, unreadableOutlinePointPosition } from './sermonPointMoveRecovery';
import { capturePreparationCheckRetry, changedPreparationChecks, privatePreparationCheck, validPreparationCheckRetry, type PreparationCheckRetry } from './sermonPreparationCheckRecovery';
import { capturedScratchRemovalPath, projectRecoveredScratchRemoval, recoveredScratchRemoval, unresolvedScratchRemoval } from './sermonScratchRemovalRecovery';
import { observedSermonText } from './sermonTextRecovery';
import { recoveredThoughtLock, unresolvedThoughtLock } from './sermonThoughtLockRecovery';
import { recoveredThoughtPlacement, unresolvedThoughtPlacement } from './sermonThoughtPlacementRecovery';
import { recoveredThoughtRemoval, unresolvedThoughtRemoval } from './sermonThoughtRemovalRecovery';
import { acknowledgeServiceOrderInput, projectServiceOrderInput, readServiceOrderInputValue, requireServiceOrderInputComparison, retainRemovedServiceOrderInputs, retainServiceOrderInputs, serviceOrderInputKey, stageServiceOrderInput, ServiceOrderInputDecisionError, type ServiceOrderInput, type ServiceOrderInputComparison } from './serviceOrderInput';
import { keepSavedStepPositions, placementSteps, returnedPlacementAnchors, unreadableStepPosition } from './serviceOrderStepPlacement';
import { canReplaceSnapshot } from './snapshotFreshness';
import { projectSourceNoteChoices } from './sourceNoteLinkCapture';
import { canceledStudyNoteBody, unseenStudyNoteField } from './studyNoteContentCapture';
import { assertLegacyCommentLocalChoice, projectLegacyStudyComment, projectLegacyStudyNote, reviseLegacyCommentConflicts, type LegacyStudyNoteImport } from './studyNoteLegacyDraft';
import { chooseStudyNoteReferences } from './studyNoteReferenceChoice';
import { studyNoteBodyAfterStoredChoice } from './studyNoteTypeChoice';
import { localThoughtPlacementChoices } from './thoughtPlacementAction';
import { UNREADABLE_OUTLINE_POINT_POSITION, UNREADABLE_ROW_PROOF, UNREADABLE_SCALAR_PROOF, UNREADABLE_STEP_POSITION, hasTwoPrivateServiceOrderMoves, hasUnreadableDraftProof, hasUnreadablePreparationCheck, hasUnreadableSermonChurch, privateServiceOrderPosition, unreadableScalarPath, waitsForServiceOrderPosition } from './unreadableDraftProof';

import type { AccountPreferenceField, AccountPreferenceResolution, AccountPreferenceRetry } from './accountPreference';
import type { ActionTime } from './actionClock';
import type { CommentPlaceObservation } from './commentPlaceAction';
import type { CommitRequest } from './commits';
import type { AutosaveFieldActions, AutosaveFieldDrafts, AutosaveFieldStamp } from './documentFieldAction';
import type { GroupMeetingReview } from './groupMeetingReview';
import type { GroupTextDecision } from './groupTextReview';
import type { PreachStatusAction } from './preachStatusAction';
import type { AutosaveRowFieldActions, RowFieldDrafts } from './rowFieldAutosave';
import type { PlanCellDraft, PlanCellOpening } from './sermonPlanCellSession';
import type { SourceNoteLinkCapture } from './sourceNoteLinkCapture';
import type { CommandResult, ConflictDetail, CouncilTopicPlacementCapture, DataCommand, DocumentData, ResourceSnapshot, GroupFlowStepPlacementCapture, OutlinePointPlacementCapture, ServiceOrderPlacementCapture, ServiceOrderPlacementComparison, ServiceOrderStepPlacementCapture } from './types';
import type { OutlineTitleOpening, SermonNoteOpening } from '@/utils/sermonNoteText';

export interface SessionCheckpoint extends AutosaveFieldDrafts, RowFieldDrafts {
  confirmed: ResourceSnapshot;
  draft: DocumentData | null;
  dirty: boolean;
  editGeneration: number;
  remoteCandidate: ResourceSnapshot | null;
  guardedScratchText?: SermonNoteOpening;
  exegeticalPointDrafts?: ReturnType<typeof stageExegeticalPoint>;
  planCellDrafts?: Record<string, PlanCellDraft>;
  serviceOrderInputs?: Record<string, import('./serviceOrderInput').ServiceOrderInput>;
  conflicts: ConflictDetail[];
  /** Private scalar edits whose saved observation no longer establishes an opening. */
  unreadableScalarProof?: string[];
  unreadableRowProofs?: UnreadableRowProof[];
  unreadableExegeticalProofs?: UnreadableExegeticalProof[];
  privateFieldReview?: { revision: number; decisions: PrivateFieldDecision[]; groupCopySources?: string[] };
  groupMeetingReview?: GroupMeetingReview;
  groupTextReview?: { requestId: string; revision: number; decisions: GroupTextDecision[]; separateDraft?: true };
  serviceOrderPlacementComparison?: ServiceOrderPlacementComparison;
  serviceOrderPlacementRetry?: ServiceOrderPlacementCapture;
  serviceOrderStepPlacementRetry?: ServiceOrderStepPlacementCapture;
  unreadableServiceOrderStepPlacement?: true;
  outlinePointPlacementRetry?: OutlinePointPlacementCapture;
  unreadableOutlinePointPlacement?: true;
  reviewedSermonOutlineOrder?: { generation: string | null; observedRevision: number; before: OutlinePointOrder; after: OutlinePointOrder };
  groupFlowStepPlacementRetry?: GroupFlowStepPlacementCapture;
  councilTopicPlacementRetry?: CouncilTopicPlacementCapture;
  accountPreferenceRetry?: AccountPreferenceRetry;
  preparationCheckRetry?: PreparationCheckRetry;
  sermonChurchRecovery?: SermonChurchRecovery;
  sermonTextRetry?: import('./sermonTextRecovery').SermonTextRetry;
  sourceNoteLinkRetry?: SourceNoteLinkCapture;
  pending: Record<string, { generation: number; value: DocumentData | null; operations?: string[]; borrowedManualScope?: string; amendedScratchAppend?: 'captured' | 'conflict'; scratchTextConflict?: { id: string; createdAt: string; words: string }; outlinePointPlacement?: OutlinePointPlacementCapture; groupFlowStepPlacement?: GroupFlowStepPlacementCapture; councilTopicPlacement?: CouncilTopicPlacementCapture; commentPlaceAction?: CommentPlaceObservation } & AutosaveFieldActions & AutosaveRowFieldActions>;
}

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export { UNREADABLE_ROW_PROOF, UNREADABLE_SCALAR_PROOF, hasUnreadableDraftProof } from './unreadableDraftProof';
const unreadablePointPlanPath = ['preparation', 'exegeticalPlan'];

function returnedPlacementAncestor(request: CommitRequest, base: DocumentData, prior: DocumentData | null, draft: DocumentData,
  saved: DocumentData | null): DocumentData {
  const step = request.serviceOrderStepPlacement;
  if (step) {
    const { previous, next } = step.placement.destination;
    const returned = returnedPlacementAnchors(prior?.steps, draft.steps, saved?.steps, [previous, next]);
    const steps = placementSteps(base.steps);
    return returned.length && steps ? { ...base, steps: steps.filter(row => !returned.includes(row.id)) } : base;
  }
  const move = request.outlinePointPlacement;
  const field = move && outlinePlacementField(request.baseline.resource.collection);
  if (!move || !field) return base;
  const [opening, shown, proposed, stored] = [base, prior, draft, saved].map(data => data?.[field]);
  if (!object(opening) || !object(shown) || !object(proposed) || !object(stored)) return base;
  const { section, previous, next } = move.placement.destination;
  const all = (outline: DocumentData) => SECTION_KEYS.flatMap(key => placementSteps(outline[key]) ?? []);
  const returned = returnedPlacementAnchors(all(shown), all(proposed), all(stored), [previous, next]);
  const rows = placementSteps(opening[section]);
  return returned.length && rows ? { ...base, [field]: { ...opening, [section]: rows.filter(row => !returned.includes(row.id)) } } : base;
}

/** An active earlier Save owns its words even if the dependent whole action is discarded. */
function actionRollbackBase(request: CommitRequest, accepted: ResourceSnapshot, predecessor?: DocumentData | null):
  { value: DocumentData | null; conflicts: ConflictDetail[] } {
  if (isLiveWholeAction(request) && predecessor) {
    if (!accepted.value) return { value: predecessor, conflicts: [] };
    const retained = mergeDocumentFields(request.baseline.value, predecessor, accepted.value);
    return { value: retained.value.exists ? retained.value.value as DocumentData : null, conflicts: retained.conflicts };
  }
  return { value: accepted.value ?? (!accepted.metadata && !request.baseline.value ? predecessor ?? null : null), conflicts: [] };
}

/** What a screen showed: the confirmed copy and the edit it reflected. */
export type ShownCopy = Pick<SessionCheckpoint, 'confirmed' | 'editGeneration'> & Partial<Pick<SessionCheckpoint, 'draft'>>;

/**
 * Whether the draft went to a deletion from another device after a screen showed `shown`, with
 * nothing of the editor's own in between — no edit, no removal, no choice (each moves the edit
 * generation; an observed deletion does not). Storage is written before a screen hears of a change,
 * so a keystroke can land in that moment (BUG-20261011-refused-edit-words-not-recoverable).
 */
export function deletedUnder(live: SessionCheckpoint, shown: ShownCopy): boolean {
  const deletion = live.confirmed.metadata, before = shown.confirmed.metadata;
  return live.draft === null && !live.dirty && !Object.keys(live.pending).length && Boolean(deletion?.deleted)
    && live.editGeneration === shown.editGeneration
    && shown.confirmed.resource.collection === live.confirmed.resource.collection && shown.confirmed.resource.id === live.confirmed.resource.id
    && shown.confirmed.value !== null && Boolean(before) && !before!.deleted
    && before!.generation === deletion!.generation && before!.revision < deletion!.revision;
}

/** The editor's confirmed baseline and local intent have independent lifetimes. */
export class DataSession {
  private state: SessionCheckpoint;
  private reservedEditGeneration = 0;
  private observedWhileAwaitingHeldFields?: ResourceSnapshot;

  constructor(snapshot: ResourceSnapshot) {
    this.state = { confirmed: copy(snapshot), draft: copy(snapshot.value), dirty: false, editGeneration: 0, remoteCandidate: null, conflicts: [], pending: {} };
  }

  static restore(checkpoint: SessionCheckpoint): DataSession {
    const session = new DataSession(checkpoint.confirmed);
    session.state = { ...copy(checkpoint), conflicts: copy(checkpoint.conflicts ?? []) };
    session.replaceDraft(checkpoint.draft);
    session.refreshUnreadableComparisons();
    return session;
  }

  private refreshUnreadableComparisons(): void {
    const { unreadableScalarProof, unreadableRowProofs, unreadableExegeticalProofs, confirmed, draft, pending } = this.state;
    if (Object.keys(pending).length) return;
    const target = this.state.remoteCandidate ?? confirmed;
    if (this.state.guardedScratchText) this.refreshGuardedScratchText(target);
    if (!hasUnreadableDraftProof(this.state)) return;
    const preparationCheck = privatePreparationCheck(this.state, target);
    if (preparationCheck?.sameValue) {
      this.state.remoteCandidate = copy(target);
      this.finishChoiceAgainstRemote(target.value);
      delete this.state.unreadableScalarProof;
      return;
    }
    const scratchRemoval = recoveredScratchRemoval(this.state, target);
    if (scratchRemoval?.settled && this.finishScratchRemoval(target, 'remote')) return;
    const removal = recoveredThoughtRemoval(this.state, target) ?? scratchRemoval;
    if ((removal?.settled && !scratchRemoval) || recoveredThoughtLock(this.state, target)?.settled) {
      this.state.remoteCandidate = copy(target);
      this.finishChoiceAgainstRemote(target.value);
      delete this.state.unreadableRowProofs;
      return;
    }
    const thoughtPlacement = recoveredThoughtPlacement(this.state, target);
    if (thoughtPlacement?.samePlace) {
      this.state.remoteCandidate = copy(target);
      this.finishChoiceAgainstRemote(target.value);
      delete this.state.unreadableRowProofs;
      return;
    }
    const isPrivateProof = (conflict: ConflictDetail) => conflict.code === UNREADABLE_SCALAR_PROOF || conflict.code === UNREADABLE_ROW_PROOF || conflict.code === UNREADABLE_EXEGETICAL_PROOF || conflict.code === UNREADABLE_STEP_POSITION
      || conflict.code === UNREADABLE_OUTLINE_POINT_POSITION;
    const hadQuestion = this.state.conflicts.some(isPrivateProof);
    const autosaveScalars = new Set<string>(autosaveFieldTargets(confirmed.resource.collection).map(target => target.field));
    const agreeing = new Set(target.value ? matchingHeldAutosaveFields(this.state, target.value) : []);
    const scalars = (unreadableScalarProof ?? []).flatMap(field => {
      if (agreeing.has(field)) return [];
      const path = unreadableScalarPath(confirmed.resource.collection, field);
      const base = readField(confirmed.value ?? {}, path), mine = readField(draft ?? {}, path), theirs = readField(target.value ?? {}, path);
      return equalValues(mine, base) && equalValues(mine, theirs) ? [] : [{ path, base, mine, theirs, code: UNREADABLE_SCALAR_PROOF }];
    });
    const rows = (unreadableRowProofs ?? []).flatMap(address => {
      const choice = unreadableRowChoice(this.state, address);
      if (!choice) return [];
      const { path, base, mine, theirs, available } = choice;
      return available && equalValues(mine, base) && equalValues(mine, theirs) ? [] : [{ path, base, mine, theirs, code: UNREADABLE_ROW_PROOF }];
    });
    const pointChoices = (unreadableExegeticalProofs ?? []).flatMap(address => {
      const choice = unreadableExegeticalChoice(this.state, address);
      return choice ? [choice.conflict] : [];
    });
    const pointConflicts = [...new Map(pointChoices.map(issue => [issue.path.at(-1), issue])).values()];
    const points = unreadableExegeticalProofs?.length && pointChoices.length !== unreadableExegeticalProofs.length
      ? [{ path: unreadablePointPlanPath, base: readField(confirmed.value ?? {}, unreadablePointPlanPath),
        mine: readField(draft ?? {}, unreadablePointPlanPath), theirs: readField(target.value ?? {}, unreadablePointPlanPath),
        code: UNREADABLE_EXEGETICAL_PROOF }, ...pointConflicts] : pointConflicts;
    const step = this.state.unreadableServiceOrderStepPlacement && unreadableStepPosition(confirmed.value, draft, target.value);
    if (!step) delete this.state.unreadableServiceOrderStepPlacement;
    const outlinePosition = this.state.unreadableOutlinePointPlacement && unreadableOutlinePointPosition(confirmed.value, draft, target.value);
    if (!outlinePosition) delete this.state.unreadableOutlinePointPlacement;
    const questions = [...scalars, ...rows, ...points, ...(removal?.settled === false ? [removal.conflict] : []), ...(step ? [step] : []), ...(outlinePosition ? [outlinePosition] : [])];
    const other = this.state.conflicts.filter(conflict => !isPrivateProof(conflict));
    this.state.conflicts = [...other, ...questions.filter(question => !other.some(conflict => equalValues(conflict.path, question.path)))];
    if (questions.length) this.state.remoteCandidate = copy(target);
    const groupCopySources = groupCopySourceIdsForReview(this.state);
    if (groupCopySources.length && target.metadata) {
      this.state.privateFieldReview = { revision: target.metadata.revision, decisions: [], ...this.state.privateFieldReview,
        groupCopySources };
    }
    if (questions.length) {
      this.state.dirty = true;
      const settings = readAccountPreferenceReview(this.state);
      if (settings?.kind === 'choices' && !settings.fields.length) {
        // The account already contains every held choice and the draft has no independent work.
        this.finishChoiceAgainstRemote(settings.basis.value);
        delete this.state.unreadableScalarProof;
      }
    } else {
      if (!hasHeldGroupCopies(this.state)) {
        if (hadQuestion && !other.length && equalValues(target, confirmed)) this.state.remoteCandidate = null;
        delete this.state.privateFieldReview;
      }
      // Agreement with a checkpoint on disk cannot retire a recovered action.
      const stillHeld = this.state.dirty ? unreadableScalarProof?.filter(field => autosaveScalars.has(field)) : undefined;
      this.state.unreadableScalarProof = stillHeld?.length ? stillHeld : undefined;
      if (!unresolvedThoughtRemoval(this.state) && !unresolvedThoughtLock(this.state) && !unresolvedScratchRemoval(this.state)) delete this.state.unreadableRowProofs;
      delete this.state.unreadableExegeticalProofs;
    }
  }

  checkpoint(): SessionCheckpoint { return copy(this.state); }
  getState(): SessionCheckpoint { return this.checkpoint(); }

  /** Reserve a distinct Save identity while a removal is being written. */
  reserveEditGeneration(): number {
    this.reservedEditGeneration = Math.max(this.reservedEditGeneration, this.state.editGeneration) + 1;
    return this.reservedEditGeneration;
  }

  applyReservedRemoval(generation: number): void {
    if (generation <= this.state.editGeneration) return;
    this.applyEdit(null, generation);
  }


  /**
   * `shown` is the copy the screen showed while the person typed. Typing on a copy a deletion from
   * another device has replaced here a moment ago (`deletedUnder`) is typing in progress when the
   * deletion arrived, and waits the way such typing does (`observe`): over the copy it was typed on,
   * with the deletion as the newer version the person decides on.
   */
  edit(value: DocumentData | null, shown?: ShownCopy, autosaveStamp?: AutosaveFieldStamp): void {
    this.applyEdit(value, this.reserveEditGeneration(), shown, autosaveStamp);
  }

  private applyEdit(value: DocumentData | null, generation: number, shown?: ShownCopy, autosaveStamp?: AutosaveFieldStamp): void {
    if (hasSermonOutlineReview(this.state) && !equalValues(value?.outline, this.state.draft?.outline)) {
      throw Object.assign(new Error('Finish comparing the structure before editing it'), { code: 'other-changes-first' });
    }
    if (value !== null && shown && deletedUnder(this.state, shown)) {
      this.state.remoteCandidate = copy(this.state.confirmed);
      this.state.confirmed = copy(shown.confirmed);
    }
    if (autosaveStamp?.field === 'service-order-input') stageServiceOrderInput(this.state, value, autosaveStamp.input);
    const field = autosaveStamp?.field;
    const canceledBody = field === 'content' ? canceledStudyNoteBody(this.state, value) : undefined;
    if (value && canceledBody !== undefined) {
      value = { ...value, content: canceledBody };
      delete this.state.studyNoteContentDraft;
      this.state.conflicts = this.state.conflicts.filter(({ path }) => !equalValues(path, ['content']));
    }
    const previousConflicts = this.state.conflicts;
    if (this.state.confirmed.resource.collection === 'studyNotes' && previousConflicts.length) {
      this.state.conflicts = reviseLegacyCommentConflicts(this.state, value);
      if (!this.state.conflicts.length && equalValues(this.state.remoteCandidate, this.state.confirmed)) this.state.remoteCandidate = null;
    }
    const unseen = canceledBody === undefined && (field === 'content' || field === 'title' || field === 'type')
      ? unseenStudyNoteField(this.state, value, shown, field) : undefined;
    if (unseen) {
      const other = this.state.conflicts.filter(({ path }) => path.length !== 1 || path[0] !== field);
      this.state.conflicts = unseen.conflict ? [...other, unseen.conflict] : other;
      this.state.remoteCandidate = this.state.conflicts.length || !equalValues(unseen.snapshot, this.state.confirmed)
        ? copy(unseen.snapshot) : null;
    }
    for (const target of autosaveFieldTargets(this.state.confirmed.resource.collection)) {
      if (canceledBody !== undefined && target.field === 'content') continue;
      const previous = this.state[target.draft];
      const draft = stageAutosaveField(this.state, value, shown, target, autosaveStamp);
      if (draft) this.state[target.draft] = draft === previous ? draft : { ...draft, editGeneration: generation };
      else delete this.state[target.draft];
    }
    stageRowFields(this.state, value, shown, autosaveStamp && ('rowId' in autosaveStamp || 'rowIds' in autosaveStamp) ? autosaveStamp : undefined);
    const planActions = stageExegeticalPoint(this.state, value, shown, autosaveStamp?.field === 'exegetical-point' ? autosaveStamp : undefined);
    if (planActions) this.state.exegeticalPointDrafts = planActions;
    else delete this.state.exegeticalPointDrafts;
    const retry = this.state.sermonTextRetry;
    if (retry && (!value || !equalValues(readField(value, unreadableScalarPath('sermons', retry.field)), retry.action.after))) {
      delete this.state.sermonTextRetry;
      if (value && !equalValues(readField(value, unreadableScalarPath('sermons', retry.field)), retry.action.before)) {
        this.state.unreadableScalarProof = [...new Set([...(this.state.unreadableScalarProof ?? []), retry.field])];
      }
    }
    const churchRecovery = this.state.sermonChurchRecovery;
    if (churchRecovery && !validSermonChurchRecovery({ ...this.state, draft: value }, churchRecovery)) {
      delete this.state.sermonChurchRecovery;
      if (value && !equalValues(value, this.state.confirmed.value)) {
        this.state.unreadableScalarProof = [...new Set([...(this.state.unreadableScalarProof ?? []), 'church'])];
      }
    }
    const checkRetry = this.state.preparationCheckRetry;
    if (checkRetry && !validPreparationCheckRetry({ ...this.state, draft: value }, checkRetry)) {
      delete this.state.preparationCheckRetry;
      const base = this.state.confirmed.value;
      if (base && value) {
        const changed = changedPreparationChecks(base, value);
        if (changed.length) this.state.unreadableScalarProof = [...new Set([...(this.state.unreadableScalarProof ?? []), ...changed])];
      }
    }
    this.replaceDraft(value);
    this.state.editGeneration = generation;
    this.state.dirty = hasSermonOutlineReview(this.state)
      || !equalValues(value, this.state.confirmed.value) || hasUncapturedAutosaveField(this.state) || hasUncapturedAutosaveRowField(this.state)
      || Boolean(this.state.serviceOrderPlacementRetry || this.state.serviceOrderStepPlacementRetry || this.state.outlinePointPlacementRetry);
    const waiting = this.state.remoteCandidate;
    if (field === 'content' && waiting?.value && waiting.resource.collection === 'studyNotes'
      && (canceledBody !== undefined || (isOrdinaryStudyNote(value) && !this.state.dirty && !this.state.conflicts.length))
      && waiting.metadata?.generation === this.state.confirmed.metadata?.generation && !Object.keys(this.state.pending).length) {
      // Undo removed all unsent edits. The saved copy already waiting in this session can now be shown.
      this.observe(waiting, { source: 'cache' });
    }
    this.refreshUnreadableComparisons();
  }

  editPlanCell(opening: PlanCellOpening, text: string): void {
    const staged = stagePlanCell(this.state, opening, text);
    this.state.planCellDrafts = staged.proofs;
    this.state.remoteCandidate = copy(staged.remoteCandidate);
    this.state.conflicts = copy(staged.conflicts);
    this.edit(staged.draft);
  }

  /** Restore only the attempted cell and its opening. Other edits remain in the session. */
  restoreUnwrittenPlanCell(nodeId: string, before: SessionCheckpoint, attempted: SessionCheckpoint): boolean {
    const current = this.state;
    const path = ['planText', nodeId];
    if (!before.draft || !attempted.draft || !current.draft || !equalValues(current.confirmed, attempted.confirmed)
      || !equalValues(current.pending, attempted.pending)
      || !equalValues(readField(current.draft, path), readField(attempted.draft, path))
      || !equalValues(current.planCellDrafts?.[nodeId], attempted.planCellDrafts?.[nodeId])) return false;

    const proof = before.planCellDrafts?.[nodeId];
    const proofs = { ...current.planCellDrafts };
    if (proof) proofs[nodeId] = proof;
    else delete proofs[nodeId];
    current.planCellDrafts = proofs;
    const unrelated = current.conflicts.filter(conflict => !equalValues(conflict.path, path));
    current.conflicts = [...unrelated, ...copy(before.conflicts.filter(conflict => equalValues(conflict.path, path)))];
    if (!unrelated.length && equalValues(current.remoteCandidate, attempted.remoteCandidate)) {
      current.remoteCandidate = copy(before.remoteCandidate);
    }
    const value = writeField(current.draft, path, readField(before.draft, path));
    const planText = value.planText;
    this.replaceDraft(!readField(before.draft, ['planText']).exists && object(planText) && !Object.keys(planText).length
      ? writeField(value, ['planText'], { exists: false }) : value);
    current.editGeneration = this.reserveEditGeneration();
    current.dirty = !equalValues(current.draft, current.confirmed.value)
      || hasUncapturedAutosaveField(current) || hasUncapturedAutosaveRowField(current)
      || Boolean(current.serviceOrderPlacementRetry || current.serviceOrderStepPlacementRetry || current.outlinePointPlacementRetry);
    this.refreshUnreadableComparisons();
    return true;
  }

  retainServiceOrderChoiceFields(source: SessionCheckpoint, discarded?: ServiceOrderInput): void {
    const inputs = Object.entries(source.serviceOrderInputs ?? {}).filter(([key]) => !discarded || key !== serviceOrderInputKey(discarded));
    if (!inputs.length) return;
    let draft = this.state.draft;
    for (const [, input] of inputs) if (!input.retainedOnly) draft = projectServiceOrderInput(draft, input) ?? draft;
    this.state.serviceOrderInputs = Object.fromEntries(inputs);
    this.edit(draft);
  }

  useStoredServiceOrderInput(input: ServiceOrderInput, compared: ServiceOrderInputComparison): void {
    const latest = requireServiceOrderInputComparison(this.state, input, compared);
    const baseline = readServiceOrderInputValue(this.state.confirmed.value, input);
    if (typeof baseline !== 'string' && !Array.isArray(baseline)) {
      throw new ServiceOrderInputDecisionError('The selected service field is unavailable');
    }
    const draft = projectServiceOrderInput(this.state.draft, input, baseline as string | string[]);
    if (!draft) throw new ServiceOrderInputDecisionError('The selected service field is unavailable');
    delete this.state.serviceOrderInputs?.[serviceOrderInputKey(input)];
    this.edit(draft);
    this.observe(latest, { source: 'server' });
  }

  pinFieldSave(): SessionCheckpoint {
    this.state.editGeneration = this.reserveEditGeneration();
    return this.checkpoint();
  }

  importLegacyStudyNote(edits: LegacyStudyNoteImport): void {
    if (this.state.dirty || Object.keys(this.state.pending).length || this.state.remoteCandidate || this.state.conflicts.length) {
      throw Object.assign(new Error('Finish the current note changes before restoring a copy'), { code: 'decision-required' });
    }
    const { confirmed } = this.state;
    const comment = 'kind' in edits;
    const { value, conflicts } = comment
      ? projectLegacyStudyComment(confirmed, edits.edits)
      : projectLegacyStudyNote(confirmed, edits);
    const proofs = autosaveFieldTargets(confirmed.resource.collection).flatMap(target => {
      const { field } = target;
      if (field !== 'title' && field !== 'content' && field !== 'type') return [];
      // A comment's old copy has no engine revision. Only matching body text can inherit
      // the opening verified during import, without claiming a time for the historical edit.
      if (comment && field !== 'content') return [];
      if (conflicts.some(({ path }) => path[0] === field)) return [];
      const draft = stageAutosaveField(this.state, value, this.state, target, { field, time: null });
      return draft ? [[target.draft, draft] as const] : [];
    });
    this.edit(value);
    Object.assign(this.state, Object.fromEntries(proofs));
    if (conflicts.length) {
      this.state.conflicts = copy(conflicts);
      this.state.remoteCandidate = copy(confirmed);
    }
  }

  retainSermonOutlineReview(input: SermonOutlineReviewInput): boolean {
    const review = prepareSermonOutlineReview(this.state, input);
    if (!review) return false;
    this.state.remoteCandidate = copy(this.state.confirmed);
    this.state.conflicts = [copy(review)];
    this.state.editGeneration = this.reserveEditGeneration();
    this.state.dirty = true;
    return true;
  }

  chooseSermonOutlineReview(side: 'local' | 'remote'): void {
    const chosen = projectSermonOutlineDecision(this.state, side);
    this.state.confirmed = copy(chosen.confirmed);
    this.state.remoteCandidate = chosen.conflicts.length ? copy(chosen.confirmed) : null;
    this.state.conflicts = copy(chosen.conflicts);
    this.edit(chosen.draft);
    const before = readRootPointOrder(chosen.confirmed.value?.outline), after = readRootPointOrder(chosen.draft?.outline);
    if (side === 'local' && before && after && retainedRootOrderChanged(before, after)) {
      this.state.reviewedSermonOutlineOrder = { generation: chosen.confirmed.metadata?.generation ?? null,
        observedRevision: chosen.confirmed.metadata?.revision ?? 0, before, after };
    }
  }

  editOutlineTitle(shown: SessionCheckpoint, opening: OutlineTitleOpening, title: string, time: ActionTime | null = null): void {
    const { draft, stored, conflicts, conflictingTitle } = prepareOutlineTitleEdit(this.state, shown, opening, title);
    const metadata = shown.confirmed.metadata;
    const version = metadata && !metadata.deleted ? { generation: metadata.generation, observedRevision: metadata.revision } : undefined;
    this.edit(draft, shown, { field: 'outline-title', rowId: opening.target.id, time, titleOpening: { ...opening, version } });
    this.state.conflicts = conflicts;
    if (conflictingTitle) {
      this.state.remoteCandidate = copy(stored);
      this.state.dirty = true;
    }
  }

  /** A durable save request owns its captured value, independently of later typing. */
  registerCommit(operationId: string, generation: number, value: DocumentData | null, preparedId?: string, autosaveActions?: AutosaveFieldActions & AutosaveRowFieldActions & Pick<CommitRequest, 'outlinePointPlacement' | 'groupFlowStepPlacement' | 'councilTopicPlacement' | 'commentPlaceAction'>): void {
    if (!this.state.pending[operationId]) this.state.pending[operationId] = { generation, value: copy(value) };
    const pending = this.state.pending[operationId];
    for (const target of autosaveFieldTargets(this.state.confirmed.resource.collection)) {
      const action = autosaveActions?.[target.action];
      if (action) Object.assign(pending, { [target.action]: copy(action) });
    }
    registerRowFields(pending, autosaveActions, this.state.confirmed.resource.collection);
    if (autosaveActions?.outlinePointPlacement) pending.outlinePointPlacement = copy(autosaveActions.outlinePointPlacement);
    if (autosaveActions?.groupFlowStepPlacement) pending.groupFlowStepPlacement = copy(autosaveActions.groupFlowStepPlacement);
    if (autosaveActions?.commentPlaceAction) pending.commentPlaceAction = copy(autosaveActions.commentPlaceAction);
    if (autosaveActions?.councilTopicPlacement) pending.councilTopicPlacement = copy(autosaveActions.councilTopicPlacement);
    if (preparedId && preparedId !== operationId && !pending.operations?.includes(preparedId)) pending.operations = [...(pending.operations ?? []), preparedId];
  }

  /** Follow one ordinary saved descendant, or a one-shot root update of this exact confirmed copy. */
  adoptSubmittedSuccessor(request: CommitRequest, borrowedManualScope?: string): boolean {
    const parent = request.predecessor ? this.state.pending[request.predecessor] : undefined;
    const resource = this.state.confirmed.resource;
    const root = !request.predecessor && Object.keys(this.state.pending).length === 0
      && request.baseline.value !== null && request.value !== null
      && editorSlot(request.editorId) === ACTION_SLOT && !request.retentionScope
      && (!request.command || request.command.kind === 'update')
      && equalValues(request.baseline, this.state.confirmed)
      && (!request.initialized || equalValues(request.working, request.baseline));
    if ((!parent && !root) || this.state.pending[request.id] || request.atomic || !['queued', 'prepared'].includes(request.state)
      || request.baseline.resource.collection !== resource.collection || request.baseline.resource.id !== resource.id
      || this.state.conflicts.length || this.state.remoteCandidate
      || (parent && Object.entries(this.state.pending).some(([id, item]) => id !== request.predecessor && item.generation >= parent.generation))) return false;
    const merged = mergeDocumentFields(parent ? parent.value : this.state.confirmed.value, this.state.draft, request.value);
    // Two private local branches are not a server answer. Keep them separate until delivery or recovery.
    if (merged.conflicts.length) return false;
    const draft = merged.value.exists ? merged.value.value as DocumentData : null;
    this.edit(draft);
    this.registerCommit(request.id, this.state.editGeneration, request.value, request.command?.operationId, request);
    if (borrowedManualScope) this.state.pending[request.id].borrowedManualScope = borrowedManualScope;
    // Unsent sibling words still need their own autosave; the adopted action never captures them.
    if (!equalValues(draft, request.value)) this.edit(draft);
    return true;
  }

  /** One projection rule for mounted editors and recovery of editors that already closed. */
  applyCommit(request: CommitRequest): boolean {
    if (request.state === 'cancelled') {
      const held = this.state.pending[request.id];
      if (this.state.groupTextReview?.requestId === request.id) delete this.state.groupTextReview;
      // The whole action already rebased its dependent Saves. Their separately authored words
      // stay in the draft when their obsolete request identity is released.
      if (request.cancelledByAction && held && !isRetiredActionDependent(request)) this.rollbackAction(request);
      if (held && request.placementChoiceStored) this.observe(request.placementChoiceStored, { source: 'server' });
      const latest = Boolean(held) && Object.values(this.state.pending).every(other => other.generation <= held.generation);
      this.release(request.id);
      if (held && !request.cancelledByAction && !Object.keys(this.state.pending).length) {
        // Nothing of this editor's is in flight any more, so a conflict it held answers nothing: decided
        // work settles fully; work swept along by a choice about another draft stays an ordinary draft.
        if ((request.cancelledByChoice || request.retainedAfterChoice) && latest) this.settleDecided(held, Boolean(request.placementChoiceStored));
        else this.state.conflicts = [];
      }
      if (held) {
        this.settleHeldScalarsAfterDelivery(this.state.remoteCandidate ?? this.state.confirmed);
        this.state.dirty ||= hasHeldAutosaveFields(this.state);
      }
      this.refreshUnreadableComparisons();
      return true;
    }
    if (request.serviceOrderPlacement && equalValues(request.serviceOrderPlacement, this.state.serviceOrderPlacementRetry)) {
      delete this.state.serviceOrderPlacementRetry;
    }
    if (request.serviceOrderStepPlacement && equalValues(request.serviceOrderStepPlacement, this.state.serviceOrderStepPlacementRetry)) {
      delete this.state.serviceOrderStepPlacementRetry;
    }
    const outlineRetry = this.state.outlinePointPlacementRetry;
    if (request.state === 'conflict' && request.groupTextReview && this.state.pending[request.id]) {
      const stage = request.groupTextReview;
      const previous = this.state.groupTextReview;
      if (!previous || previous.requestId !== request.id || previous.revision < request.revision) {
        const held = this.state.pending[request.id];
        const staged = copy(stage.checkpoint);
        const remote = this.state.remoteCandidate;
        if (remote && canReplaceSnapshot(staged.remoteCandidate ?? undefined, remote)) staged.remoteCandidate = copy(remote);
        const pristine = !previous && this.state.editGeneration <= held.generation;
        const canFollow = pristine || equalValues(this.state.draft, staged.draft);
        if (canFollow) this.state = staged;
        this.state.groupTextReview = { requestId: request.id, revision: request.revision,
          decisions: copy(stage.decisions), ...(!canFollow && { separateDraft: true as const }) };
      }
    }
    const templateMove = request.baseline.resource.collection === 'planTemplates' && request.outlinePointPlacement;
    const capturedTemplateRetry = templateMove && outlineRetry && sameOutlinePointGesture(templateMove, outlineRetry);
    if (request.outlinePointPlacement && (equalValues(request.outlinePointPlacement, outlineRetry) || capturedTemplateRetry)) {
      delete this.state.outlinePointPlacementRetry;
    }
    const groupRetry = this.state.groupFlowStepPlacementRetry;
    if (groupRetry && request.groupFlowStepPlacement && equalValues(groupRetry.before, request.groupFlowStepPlacement.before)
      && equalValues(groupRetry.after, request.groupFlowStepPlacement.after)
      && equalValues(groupRetry.placement.time, request.groupFlowStepPlacement.placement.time)) {
      delete this.state.groupFlowStepPlacementRetry;
    }
    const councilRetry = this.state.councilTopicPlacementRetry;
    if (councilRetry && request.councilTopicPlacement && equalValues(councilRetry.before, request.councilTopicPlacement.before)
      && equalValues(councilRetry.after, request.councilTopicPlacement.after)
      && equalValues(councilRetry.placement.time, request.councilTopicPlacement.placement.time)) {
      delete this.state.councilTopicPlacementRetry;
    }
    if (request.sourceNoteLink && this.state.sourceNoteLinkRetry && request.editGeneration === this.state.editGeneration
      && equalValues(request.sourceNoteLink.opening, this.state.sourceNoteLinkRetry.opening)) delete this.state.sourceNoteLinkRetry;
    if (this.state.groupMeetingReview && request.editGeneration === this.state.editGeneration
      && (request.meetingDateAction || request.groupMeetingFieldActions) && equalValues(this.state.draft, request.value)) {
      delete this.state.groupMeetingReview;
    }
    const churchRecovery = this.state.sermonChurchRecovery;
    if (churchRecovery && equalValues(request.sermonChurchAction, churchRecovery.observation)
      && equalValues(request.sermonChurchFill, churchRecovery.fill)) delete this.state.sermonChurchRecovery;
    const checkRetry = this.state.preparationCheckRetry;
    if (checkRetry && equalValues(request.sermonPreparationCheckActions?.[checkRetry.field], checkRetry.action)) {
      delete this.state.preparationCheckRetry;
    }
    const textRetry = this.state.sermonTextRetry;
    if (textRetry && equalValues(observedSermonText(request, textRetry.field), textRetry.action)) {
      delete this.state.sermonTextRetry;
    }
    const preferenceRetry = this.state.accountPreferenceRetry;
    if (preferenceRetry && accountPreferenceRetryFields(preferenceRetry).every(field =>
      request.accountPreferenceActions?.[field] && equalValues(request.accountPreferenceActions[field]?.time, preferenceRetry.time))) {
      delete this.state.accountPreferenceRetry;
    }
    if (this.state.guardedScratchText && request.sermonNoteText
      && equalValues(this.state.guardedScratchText.target, request.sermonNoteText.target)) delete this.state.guardedScratchText;
    const newScopedSave = (request.groupFlowStepPlacement || request.councilTopicPlacement || templateMove
      || request.scratchRemoval || request.scratchTextRecovery || request.amendedScratchAppend)
      && (!this.state.pending[request.id] || capturedTemplateRetry);
    this.registerCommit(request.id, request.editGeneration, request.value, request.atomic?.id ?? request.command?.operationId, request);
    if (request.amendedScratchAppend) {
      this.state.pending[request.id].amendedScratchAppend = request.state === 'conflict' ? 'conflict' : 'captured';
    }
    const scratchText = request.state === 'conflict' && preparedRecoveredScratchText(request);
    if (scratchText) this.state.pending[request.id].scratchTextConflict = scratchText;
    if (newScopedSave && this.state.editGeneration === request.editGeneration && !equalValues(this.state.draft, request.value)) {
      // The scoped request can leave later typing for its own generation.
      this.state.editGeneration = this.reserveEditGeneration();
    }
    if (request.result && ['acknowledged', 'conflict', 'refused'].includes(request.state)) {
      const scratchPath = capturedScratchRemovalPath(request) ?? capturedGuardedScratchTextPath(request);
      const otherConflicts = scratchPath ? this.state.conflicts.filter(({ path }) =>
        !equalValues(path, scratchPath) && !equalValues(path, scratchPath.slice(0, 2))) : [];
      this.accept(request.result, request.atomic?.kind === 'analysis-reshape', request);
      // A scoped scratch answer cannot resolve another question already in the editor.
      if (otherConflicts.length) {
        const paths = this.state.conflicts.map(conflict => conflict.path);
        this.state.conflicts.push(...otherConflicts.filter(conflict => !paths.some(path => equalValues(path, conflict.path))));
        if (!this.state.remoteCandidate) this.state.remoteCandidate = copy(this.state.confirmed);
      }
    }
    return request.state === 'acknowledged';
  }

  private rollbackAction(request: CommitRequest): void {
    const accepted = this.state.remoteCandidate ?? this.state.confirmed;
    const predecessor = request.predecessor ? this.state.pending[request.predecessor] : undefined;
    const { value: rollbackValue, conflicts: retainedConflicts } = actionRollbackBase(request, accepted, predecessor?.value);
    const rebased = mergeDocumentFields(request.value, this.state.draft, rollbackValue);
    if (request.atomic?.kind === 'analysis-reshape') keepAnalysisReshapeFrame(request.value, this.state.draft, rollbackValue, rebased);
    // Discard owns membership only. Later saved metadata in a dependent request
    // is still the person's work, just like later unsent typing. Rebase those
    // fields against the actual confirmed ancestor, not the cancelled request.
    if (request.baseline.resource.collection === 'series' && this.state.draft && rebased.value.exists) {
      const fields = ['items', 'sermonIds', 'seriesKind'];
      const ordinary = mergeDocumentFields(this.state.confirmed.value, this.state.draft, accepted.value);
      if (ordinary.value.exists) {
        rebased.value = { exists: true, value: projectManualSelection(ordinary.value.value as DocumentData, rebased.value.value as DocumentData, fields.map(field => [field])) };
        const conflicts = [...this.state.conflicts.filter(conflict => !fields.includes(conflict.path[0])),
          ...ordinary.conflicts.filter(conflict => !fields.includes(conflict.path[0])), ...rebased.conflicts.filter(conflict => fields.includes(conflict.path[0]))];
        rebased.conflicts = [...new Map(conflicts.map(conflict => [JSON.stringify(conflict.path), conflict])).values()];
      }
    }
    if (request.atomic?.kind === 'council-carry' && request.atomic.id === request.id && request.baseline.value && this.state.draft && rebased.value.exists) {
      const ancestor = request.initialized ? request.working.value : predecessor?.value ?? request.baseline.value;
      const before = (ancestor?.topics ?? []) as DocumentData[];
      const carried = ((request.value?.topics ?? []) as DocumentData[]).filter(topic => typeof topic.id === 'string'
        && typeof topic.carriedToCouncilId === 'string' && before.find(old => old.id === topic.id)?.carriedToCouncilId !== topic.carriedToCouncilId);
      const paths = carried.map(topic => ['topics', { id: topic.id as string }, 'carriedToCouncilId']);
      const ordinary = mergeDocumentFields(this.state.confirmed.value, this.state.draft, rollbackValue);
      if (ordinary.value.exists) {
        rebased.value = { exists: true, value: projectManualSelection(ordinary.value.value as DocumentData, rebased.value.value as DocumentData, paths) };
        const owned = (conflict: ConflictDetail) => conflict.path[0] === 'topics' && conflict.path.at(-1) === 'carriedToCouncilId';
        const conflicts = [...this.state.conflicts.filter(conflict => !owned(conflict)), ...ordinary.conflicts.filter(conflict => !owned(conflict)),
          ...rebased.conflicts.filter(owned)];
        rebased.conflicts = [...new Map(conflicts.map(conflict => [JSON.stringify(conflict.path), conflict])).values()];
      }
    }
    const conflicts = retainedConflicts.length
      ? [...new Map([...retainedConflicts, ...rebased.conflicts].map(conflict => [JSON.stringify(conflict.path), conflict])).values()]
      : rebased.conflicts;
    this.state.confirmed = copy(accepted);
    this.replaceDraft(rebased.value.exists ? rebased.value.value as DocumentData : null);
    this.state.conflicts = copy(conflicts);
    this.state.remoteCandidate = conflicts.length ? copy(accepted) : null;
    this.state.editGeneration = this.reserveEditGeneration();
    this.state.dirty = !equalValues(this.state.draft, accepted.value);
  }

  prepare(operationId: string, owner: string, targets: readonly ResourceSnapshot[] = [], intended: SessionCheckpoint = this.state): DataCommand | null {
    const { confirmed, draft, dirty, editGeneration } = intended;
    const { pending } = this.state;
    if (!dirty || this.state.conflicts.length || hasUnreadableDraftProof(intended)) return null;
    if (pending[operationId]) throw new Error('Operation already prepared');
    if (Object.keys(pending).length) return null;
    if (!equalValues(confirmed, this.state.confirmed)) throw new Error('The confirmed baseline changed during preparation');
    const { command, submittedValue } = prepareDomainCommand(owner, operationId, confirmed, draft, targets);
    pending[operationId] = { generation: editGeneration, value: copy(submittedValue) };
    if (command?.kind === 'update' && intended.thoughtTextDrafts) {
      const rowFields = captureRowFields(intended, confirmed, undefined, []);
      const { thoughtTextActions } = matchingRowFields(command.changes, rowFields, confirmed.resource.collection);
      if (thoughtTextActions) {
        pending[operationId].thoughtTextActions = thoughtTextActions;
        command.thoughtTextActions = compactRowTextStamps(thoughtTextActions);
      }
    }
    return command;
  }

  /** Release only after proven failed local commit or durable retirement of a terminal result.
   * Queued, sending and unknown operations must retain their identity until acknowledged. */
  release(operationId: string): void { delete this.state.pending[operationId]; }

  accept(result: CommandResult, wholeAnalysisFrame = false, request?: CommitRequest): void {
    const submitted = this.state.pending[result.operationId];
    if (!submitted) return;
    if (result.kind !== 'acknowledged') {
      if ('snapshot' in result) this.observe(result.snapshot, { source: 'server' });
      // A pinned manual Save can conflict with the parent's already observed baseline.
      if (result.kind === 'conflict' && this.matches(result.snapshot) && !this.isOlder(result.snapshot)
        && canReplaceSnapshot(this.state.remoteCandidate ?? undefined, result.snapshot)) {
        this.state.remoteCandidate = copy(result.snapshot);
        this.state.conflicts = copy(result.conflicts);
        if (result.snapshot.resource.collection === 'groups') {
          // Older prepared commands can have a rebased draft without the shown template.
          // Only this exact answered request may supply those words for the local choice.
          this.state.draft = copy(keepGroupFlowCopyContent(this.state.draft, submitted.value, result.conflicts, false));
        }
        if (result.serviceOrderPlacementComparison) this.state.serviceOrderPlacementComparison = copy(result.serviceOrderPlacementComparison);
        else delete this.state.serviceOrderPlacementComparison;
      }
      return;
    }
    if (!this.matches(result.snapshot)) return;
    delete this.state.pending[result.operationId];
    for (const target of autosaveFieldTargets(this.state.confirmed.resource.collection)) {
      if (submittedCoversAutosaveDraft(submitted, target, this.state[target.draft])) delete this.state[target.draft];
    }
    acknowledgeRowFields(this.state, submitted);
    let accepted = this.isOlder(result.snapshot) ? this.state.confirmed : result.snapshot;
    const candidate = this.state.remoteCandidate;
    if (candidate?.metadata && accepted.metadata
      && candidate.metadata.generation === accepted.metadata.generation
      && candidate.metadata.revision >= accepted.metadata.revision) accepted = candidate;
    // Only edits made AFTER this operation was prepared belong on its accepted result.
    // In particular, server-owned metadata and independently merged fields come from ACK.
    const acceptedOperation = accepted.metadata?.operationId;
    // A compact replay of A can already contain our submitted B. Rebase later
    // typing from B without claiming that B's own receipt has been received.
    const newerSubmitted = acceptedOperation && Object.entries(this.state.pending).find(([id, pending]) =>
      pending.generation > submitted.generation && (id === acceptedOperation || pending.operations?.includes(acceptedOperation)))?.[1];
    const ancestor = newerSubmitted ? newerSubmitted.value : submitted.value;
    adoptAcknowledgedStudyNoteFields(this.state, submitted, accepted, result.operationId);
    const fieldAncestor = autosaveAcknowledgementAncestor(ancestor, accepted, this.state);
    const rowAncestor = rowFieldAckAncestor(fieldAncestor, accepted, this.state);
    const acceptedAncestor = !newerSubmitted && this.state.editGeneration === submitted.generation
      && request?.predecessor && rowAncestor && this.state.draft
      && this.state.confirmed.metadata?.generation === accepted.metadata?.generation
      ? returnedPlacementAncestor(request, rowAncestor, this.state.confirmed.value, this.state.draft, accepted.value) : rowAncestor;
    const horizon = newerSubmitted ? newerSubmitted.generation : submitted.generation;
    const outlineMoves = Object.values(this.state.pending).filter(pending => pending.generation > horizon)
      .sort((a, b) => a.generation - b.generation).flatMap(pending => pending.outlinePointPlacement
        && pending.outlinePointPlacement.generation === (accepted.metadata?.generation ?? null) ? [pending.outlinePointPlacement] : []);
    const incoming = alignPendingOutlinePointPlacements(accepted.resource.collection, accepted.value, this.state.draft, outlineMoves);
    const groupMoves = Object.values(this.state.pending).filter(pending => pending.generation > horizon)
      .sort((a, b) => a.generation - b.generation).flatMap(pending => pending.groupFlowStepPlacement
        && pending.groupFlowStepPlacement.generation === (accepted.metadata?.generation ?? null) ? [pending.groupFlowStepPlacement] : []);
    const councilMoves = Object.values(this.state.pending).filter(pending => pending.generation > horizon)
      .sort((a, b) => a.generation - b.generation).flatMap(pending => pending.councilTopicPlacement
        && pending.councilTopicPlacement.generation === (accepted.metadata?.generation ?? null) ? [pending.councilTopicPlacement] : []);
    const pendingPlace = accepted.metadata?.generation === this.state.confirmed.metadata?.generation
      && Object.values(this.state.pending).findLast(pending => pending.generation > horizon
        && pending.commentPlaceAction && equalValues(pending.commentPlaceAction.after, commentPlaceValue(this.state.draft)))?.commentPlaceAction;
    // A later queued move still owns its exact place if the earlier ACK picked a different place.
    const nextPlaceRefs = pendingPlace && acceptedAncestor && matchesCommentPlaceScope(incoming, pendingPlace.after, pendingPlace.paragraph)
      ? replaceCommentReference(acceptedAncestor.scriptureRefs, commentPlaceValue(incoming)) : undefined;
    const placeAncestor = nextPlaceRefs === undefined || !acceptedAncestor ? acceptedAncestor
      : { ...acceptedAncestor, scriptureRefs: nextPlaceRefs };
    const templateAncestor = accepted.resource.collection === 'planTemplates' && outlineMoves.length
      ? alignPendingOutlinePointPlacements('planTemplates', acceptedAncestor, this.state.draft, outlineMoves) : placeAncestor;
    const rebased = groupMoves.length
      ? mergeDocumentFields(groupPlacementMergeFrame(acceptedAncestor, groupMoves), groupPlacementMergeFrame(this.state.draft, []),
        groupPlacementMergeFrame(incoming, groupMoves))
      : councilMoves.length ? mergeDocumentFields(councilMoves.reduce(projectCouncilTopicOnDocument, acceptedAncestor),
        this.state.draft, councilMoves.reduce(projectCouncilTopicOnDocument, incoming))
      : accepted.resource.collection === 'groups' ? mergeGroupFlowRebase(acceptedAncestor, this.state.draft, incoming)
        : rebaseOptionalPrayerTags(accepted.resource.collection, acceptedAncestor, this.state.draft, incoming,
          mergeDocumentAfterAcknowledgement(templateAncestor, this.state.draft, { ...accepted, value: incoming }));
    if (wholeAnalysisFrame) keepAnalysisReshapeFrame(ancestor, this.state.draft, accepted.value, rebased);
    adoptFirstPlanCellVersion(this.state, accepted, result.committed ?? result.snapshot.metadata, result.operationId, submitted.value);
    acknowledgeServiceOrderInput(this.state, request);
    retainRemovedServiceOrderInputs(this.state, accepted);
    this.state.confirmed = copy(accepted);
    const nextDraft = rebased.value.exists ? rebased.value.value as DocumentData : null;
    this.replaceDraft(groupMoves.length ? restoreGroupPlacementOrder(nextDraft) : nextDraft);
    this.state.conflicts = copy(preservePlanCellComparisons(this.state, rebased.conflicts));
    this.state.remoteCandidate = this.state.conflicts.length ? copy(accepted) : null;
    this.settleHeldScalarsAfterDelivery(accepted, result.snapshot);
    this.state.dirty = !equalValues(this.state.draft, accepted.value) || hasHeldAutosaveFields(this.state)
      || hasUncapturedAutosaveField(this.state) || hasUncapturedAutosaveRowField(this.state);
    this.refreshUnreadableComparisons();
  }

  /** The controller has already given these exact words an independent local owner. */
  releaseRemovedPlanCells(retained: Readonly<Record<string, PlanCellDraft>>): void {
    const proofs = this.state.planCellDrafts;
    if (!proofs) return;
    const released = Object.keys(retained).filter(id => equalValues(retained[id], proofs[id]));
    if (!released.length) return;
    const stays = Object.keys(proofs).filter(id => !released.includes(id));
    const remaining = reservePrivatePlanCells(this.state, this.state.confirmed.value, stays);
    this.replaceDraft(remaining.draft);
    this.state.conflicts = this.state.conflicts.filter(({ path }) =>
      path[0] !== 'planText' || path.length !== 2 || !released.includes(path[1]));
    this.state.dirty = !equalValues(this.state.draft, this.state.confirmed.value)
      || hasUncapturedAutosaveField(this.state) || hasUncapturedAutosaveRowField(this.state);
  }

  private refreshGuardedScratchText(target: ResourceSnapshot): boolean {
    const projected = this.state.guardedScratchText && projectGuardedScratchText(this.state, target);
    if (!projected) return false;
    this.state = copy(projected);
    return true;
  }

  private settleHeldScalarsAfterDelivery(projected: ResourceSnapshot, receipt?: ResourceSnapshot): void {
    if (Object.keys(this.state.pending).length) return;
    const observed = this.observedWhileAwaitingHeldFields;
    this.observedWhileAwaitingHeldFields = undefined;
    // A projected copy can settle the field only if this device heard that exact version from the server.
    if (equalValues(projected, receipt) || equalValues(projected, observed)) this.retireMatchingHeldScalars(projected);
  }

  private retireMatchingHeldScalars(snapshot: ResourceSnapshot): boolean {
    const { confirmed, remoteCandidate, pending, unreadableScalarProof } = this.state;
    const latest = remoteCandidate?.metadata ?? confirmed.metadata;
    if (!unreadableScalarProof?.length || Object.keys(pending).length || !snapshot.value
      || !latest || snapshot.metadata?.generation !== latest.generation || snapshot.metadata.revision < latest.revision) return false;
    const agreed = matchingHeldAutosaveFields(this.state, snapshot.value);
    if (!agreed.length) return false;
    const remaining = unreadableScalarProof.filter(field => !agreed.includes(field));
    this.state.unreadableScalarProof = remaining.length ? remaining : undefined;
    this.state.conflicts = this.state.conflicts.filter(conflict => conflict.code !== UNREADABLE_SCALAR_PROOF
      || !agreed.some(field => equalValues(conflict.path, unreadableScalarPath(confirmed.resource.collection, field))));
    return true;
  }

  observe(snapshot: ResourceSnapshot, { source, preserveDraft }: { source: 'server' | 'cache'; preserveDraft?: boolean }): void {
    if (!this.matches(snapshot) || this.isOlder(snapshot)) return;
    // A versioned tombstone survives acknowledgement collection. A cache miss proves nothing.
    if (source === 'cache' && snapshot.value === null && !snapshot.metadata?.deleted) return;
    if (source === 'server' && hasHeldAutosaveFields(this.state) && Object.keys(this.state.pending).length
      && canReplaceSnapshot(this.observedWhileAwaitingHeldFields, snapshot)) {
      this.observedWhileAwaitingHeldFields = copy(snapshot);
    }
    const retiredScalars = source === 'server' && this.retireMatchingHeldScalars(snapshot);
    if (equalValues(snapshot, this.state.confirmed)) {
      if (retiredScalars && !this.state.conflicts.length && !hasUnreadableDraftProof(this.state)
        && equalValues(this.state.draft, snapshot.value) && !hasUncapturedAutosaveField(this.state) && !hasUncapturedAutosaveRowField(this.state)
        && !this.state.groupFlowStepPlacementRetry && !this.state.councilTopicPlacementRetry) {
        this.state.dirty = false;
        if (equalValues(this.state.remoteCandidate, snapshot)) this.state.remoteCandidate = null;
      }
      return;
    }
    const awaiting = Object.keys(this.state.pending).length > 0;
    if (this.state.dirty || awaiting || hasUnreadableDraftProof(this.state)) {
      const candidate = this.state.remoteCandidate;
      if (candidate?.metadata && snapshot.metadata && candidate.metadata.generation === snapshot.metadata.generation
        && candidate.metadata.revision > snapshot.metadata.revision) return;
      if (!awaiting && this.refreshGuardedScratchText(snapshot)) return;
      const outlineReview = refreshSermonOutlineReview(this.state, snapshot);
      if (outlineReview) {
        this.state.remoteCandidate = copy(snapshot);
        this.state.conflicts = [copy(outlineReview)];
        return;
      }
      retainRemovedServiceOrderInputs(this.state, snapshot);
      const sketchConflicts = awaiting ? [] : observePlacedSketchConflicts(this.state, snapshot);
      if (sketchConflicts.length) {
        this.state.remoteCandidate = copy(snapshot);
        this.state.conflicts = copy(sketchConflicts);
        return;
      }
      if (!awaiting && this.state.conflicts.some(isPlacedSketchConflict)) {
        this.state.conflicts = this.state.conflicts.filter(conflict => !isPlacedSketchConflict(conflict));
      }
      if (!awaiting && !preserveDraft) {
        const merged = mergeUnsentObservation(this.state, snapshot);
        if (merged) {
          this.state.confirmed = copy(snapshot);
          this.replaceDraft(merged);
          retireObservedAutosaveFields(this.state);
          retireObservedAutosaveRowFields(this.state);
          this.state.remoteCandidate = null;
          this.state.dirty = !equalValues(this.state.draft, snapshot.value)
            || hasUncapturedAutosaveField(this.state) || hasUncapturedAutosaveRowField(this.state);
          return;
        }
      }
      this.state.remoteCandidate = copy(snapshot);
      this.state.conflicts = reviewObservedPlanCells(this.state, snapshot);
      this.refreshUnreadableComparisons();
      return;
    }
    retainRemovedServiceOrderInputs(this.state, snapshot);
    this.state.confirmed = copy(snapshot);
    this.replaceDraft(snapshot.value);
    this.clearAutosaveFieldDrafts();
    this.state.remoteCandidate = null;
  }

  /**
   * WORK THE PERSON DECIDED ON ANOTHER EDITOR (BUG-20260813-late-refusal-silent-after-navigation).
   *
   * Every opening of a screen is a new editor, and the one opened again takes over the queued
   * requests of the one that was left — a closed checkpoint, or a screen still open in another tab.
   * The person's "keep mine" or "use the server's version" there cancels them `cancelledByChoice`.
   * This editor then waits for nothing: when its latest request was decided that way and its draft
   * is exactly what that request carried, it takes the version the decider took — the newer server
   * copy, or its confirmed one. Text typed after that request stays an ordinary draft; the conflict
   * belonged to the decided request. The same rule runs for mounted editors and for recovery's
   * projection of closed ones, so one cannot settle while the other keeps waiting.
   */
  private settleDecided(submitted: SessionCheckpoint['pending'][string], placementChoice = false): void {
    const anchored = placementChoice ? this.checkpoint() : undefined;
    if (this.state.remoteCandidate) this.state.confirmed = copy(this.state.remoteCandidate);
    this.state.remoteCandidate = null;
    const { ancestor, laterFields } = cancelledAutosaveProjection(this.state, submitted);
    const source = laterFields.size && !anchored ? this.checkpoint() : undefined;
    // Retire only the submitted value the person decided about; later unsent sibling words stay.
    this.dropRefused(ancestor, anchored);
    if (source) {
      carryAutosaveFieldDrafts(source, this.state, path => laterFields.has(path[0]));
      this.state.dirty ||= hasUncapturedAutosaveField(this.state);
    }
  }

  /**
   * "Use the server's version" after a refusal: there is no other version to adopt, so the refused
   * change goes and the stored copy comes back. `atChoice` is the draft when the person chose; a field
   * typed since then stays (three-way merge), because a later keystroke is not part of that choice.
   */
  dropRefused(atChoice: DocumentData | null, placementSource?: SessionCheckpoint): void {
    this.clearAutosaveFieldDrafts();
    const confirmed = this.state.confirmed;
    const authored = placementSource?.draft;
    const merged = authored && atChoice ? mergeEditsAfterAnchoredPlacement(placementSource, atChoice, authored, { ...this.state, draft: confirmed.value })
      : mergeDocumentFields(atChoice, this.state.draft, confirmed.value);
    this.replaceDraft(merged.value.exists ? merged.value.value as DocumentData : null);
    this.state.dirty = !equalValues(this.state.draft, this.state.confirmed.value);
    // A choice about an earlier request cannot silently decide later positional work.
    this.state.conflicts = placementSource || hasDifferentAnalysisPositionBasis(atChoice, this.state.draft, confirmed.value) ? copy(merged.conflicts) : [];
    if (placementSource && authored && atChoice && this.state.dirty && !this.state.conflicts.length
      && (placementSource.confirmed.metadata?.generation !== confirmed.metadata?.generation
        || confirmed.resource.collection === 'councils' && confirmed.value?.status === 'held')) {
      this.state.conflicts = [{ path: [], base: readField(atChoice, []), mine: readField(authored, []),
        theirs: confirmed.value ? readField(confirmed.value, []) : { exists: false } }];
    }
    if (placementSource) carryAnchoredDraftChronology(placementSource, this.state);
    if (this.state.conflicts.length) this.state.remoteCandidate = copy(this.state.confirmed);
    this.retainCouncilTopicReview(merged.conflicts);
    this.state.editGeneration = this.reserveEditGeneration();
  }

  retainCouncilTopicReview(conflicts: readonly ConflictDetail[]): void {
    if (councilTopicConflictCode(conflicts)) {
      this.state.conflicts = copy([...conflicts]);
      this.state.remoteCandidate = copy(this.state.confirmed);
      this.state.dirty = true;
    }
  }

  private finishScratchRemoval(target: ResourceSnapshot, side: 'local' | 'remote'): boolean {
    const chosen = projectRecoveredScratchRemoval(this.state, target, side);
    if (!chosen) return false;
    this.state.remoteCandidate = copy(target);
    this.finishChoiceAgainstRemote(chosen.value);
    if (chosen.conflicts.length) {
      this.state.remoteCandidate = copy(target);
      this.state.conflicts = copy(chosen.conflicts);
    }
    delete this.state.unreadableRowProofs;
    return true;
  }

  choosePrivateFields(side: 'local' | 'remote', time: ActionTime | null): boolean {
    if (!Object.keys(this.state.pending).length && guardedScratchTextReview(this.state) && this.state.remoteCandidate) {
      const projected = projectGuardedScratchText(this.state, this.state.remoteCandidate, side);
      if (!projected) throw Object.assign(new Error('The shown sketch changed'), { code: 'decision-changed' });
      this.state = { ...copy(projected), editGeneration: this.reserveEditGeneration() };
      return true;
    }
    if (unresolvedScratchRemoval(this.state) && !Object.keys(this.state.pending).length) {
      const target = this.state.remoteCandidate;
      if (!target || !this.finishScratchRemoval(target, side)) {
        throw Object.assign(new Error('The compared scratch note changed'), { code: 'decision-changed' });
      }
      return true;
    }
    if (unresolvedThoughtLock(this.state) && !Object.keys(this.state.pending).length) {
      const target = this.state.remoteCandidate;
      const lock = target && recoveredThoughtLock(this.state, target);
      if (!target || lock?.settled !== false) {
        throw Object.assign(new Error('The compared thought lock has changed'), { code: 'decision-changed' });
      }
      const proposed = DataSession.restore({ confirmed: target, draft: side === 'local' ? lock.proposed : target.value,
        editGeneration: this.state.editGeneration, dirty: side === 'local', pending: {}, conflicts: [], remoteCandidate: null });
      if (side === 'local') {
        stageReviewedRowFields(proposed.state, [['thoughts', 'id:' + lock.rowId, 'isLocked']], time, ['thought-lock']);
        if (!proposed.state.thoughtLockDrafts?.[lock.rowId]) {
          throw Object.assign(new Error('The thought lock could not be captured'), { code: 'decision-changed' });
        }
      }
      this.finishChoiceAgainstRemote(proposed.state.draft);
      delete this.state.unreadableRowProofs;
      this.state.thoughtLockDrafts = proposed.state.thoughtLockDrafts;
      return true;
    }
    if (unresolvedThoughtRemoval(this.state) && !Object.keys(this.state.pending).length) {
      const target = this.state.remoteCandidate;
      const removal = target && recoveredThoughtRemoval(this.state, target);
      if (!target || !removal || removal.settled) {
        throw Object.assign(new Error('The compared removal has changed'), { code: 'decision-changed' });
      }
      this.finishChoiceAgainstRemote(side === 'local' ? removal.proposed : target.value);
      delete this.state.unreadableRowProofs;
      return true;
    }
    if (unresolvedThoughtPlacement(this.state) && !Object.keys(this.state.pending).length) {
      const target = this.state.remoteCandidate;
      const placement = target && recoveredThoughtPlacement(this.state, target);
      if (!target?.value || !placement || placement.samePlace || (side === 'local' && !placement.proposed)) {
        throw Object.assign(new Error('The compared thought placement has changed'), { code: 'decision-changed' });
      }
      const proposed = DataSession.restore({ confirmed: target, draft: side === 'local' ? placement.proposed! : target.value,
        editGeneration: this.state.editGeneration, dirty: side === 'local', pending: {}, conflicts: [], remoteCandidate: null });
      if (side === 'local') {
        stageReviewedRowFields(proposed.state, placement.rowIds.map(id => ['thoughts', 'id:' + id, 'outlineLocation']), time, ['thought-placement']);
        if (placement.rowIds.some(id => !proposed.state.thoughtPlacementDrafts?.[id])) {
          throw Object.assign(new Error('The thought placement could not be captured'), { code: 'decision-changed' });
        }
      }
      this.finishChoiceAgainstRemote(proposed.state.draft);
      delete this.state.unreadableRowProofs;
      this.state.thoughtPlacementDrafts = proposed.state.thoughtPlacementDrafts;
      return true;
    }
    if (hasUnreadablePreparationCheck(this.state) && !Object.keys(this.state.pending).length) {
      const target = this.state.remoteCandidate;
      const check = target && privatePreparationCheck(this.state, target);
      const compared = readSermonPreparationConfirmation(this.state);
      if (!target?.value || !check || !compared || !equalValues(check.path, compared.path) || check.sameValue) {
        throw Object.assign(new Error('Read both versions of the preparation check before choosing'), { code: 'decision-changed' });
      }
      const draft = side === 'local' ? writeField(target.value, check.path, check.mine) : target.value;
      const retry = side === 'local' ? capturePreparationCheckRetry({ confirmed: target, draft }, check.field, time, true) : undefined;
      if (side === 'local' && !retry) {
        throw Object.assign(new Error('The checked value could not be captured'), { code: 'decision-changed' });
      }
      this.finishChoiceAgainstRemote(draft);
      delete this.state.unreadableScalarProof;
      this.state.preparationCheckRetry = retry;
      return true;
    }
    if (hasUnreadableSermonChurch(this.state) && !Object.keys(this.state.pending).length) {
      const compared = readRecoveredSermonChurch(this.state);
      if (!compared || !this.state.remoteCandidate) {
        throw Object.assign(new Error('Read both versions of the church before choosing'), { code: 'decision-changed' });
      }
      const selected = chooseRecoveredSermonChurch(this.state.remoteCandidate, compared, side, time);
      this.finishChoiceAgainstRemote(selected.draft);
      const remaining = this.state.unreadableScalarProof?.filter(field => field !== 'church');
      this.state.unreadableScalarProof = remaining?.length ? remaining : undefined;
      this.state.sermonChurchRecovery = selected.recovery;
      return true;
    }
    const review = readPrivateDocumentReview(this.state);
    const next = review?.remaining[0];
    if (!review || !next) return false;
    if (side === 'local' && 'removedBy' in next && next.removedBy === 'remote') {
      throw Object.assign(new Error('The edited group row was removed'), { code: 'decision-changed' });
    }
    if (side === 'local' && 'localAvailable' in next && next.localAvailable === false) {
      throw Object.assign(new Error('The selected council option is unavailable'), { code: 'council-option-gone' });
    }
    const decisions = [...review.decisions, privateFieldDecision(next, side)];
    if (review.remaining.length > 1) {
      this.state.privateFieldReview = { revision: review.revision, decisions,
        ...('groupCopySources' in review && review.groupCopySources.length && { groupCopySources: review.groupCopySources }) };
      this.state.editGeneration = this.reserveEditGeneration();
      return true;
    }
    const chosen = review.project(decisions);
    const candidate = this.state.remoteCandidate;
    if (!chosen || !candidate) {
      throw Object.assign(new Error('The compared fields changed'), { code: 'decision-changed' });
    }
    const source = this.checkpoint();
    this.state.confirmed = copy(candidate);
    this.state.remoteCandidate = null;
    this.state.conflicts = [];
    delete this.state.privateFieldReview;
    delete this.state.unreadableScalarProof;
    delete this.state.unreadableRowProofs;
    this.edit(chosen);
    this.retainUnreviewedAutosaveActions(source, review.fields);
    const kept = decisions.filter(decision => decision.side === 'local').map(decision => decision.path);
    stageReviewedRowFields(this.state, kept, time);
    const scalarTargets = candidate.resource.collection === 'groups' ? GROUP_TIMED_FIELDS : [...COUNCIL_TIMED_FIELDS, COUNCIL_LIFECYCLE];
    for (const target of scalarTargets) {
      if (!kept.some(path => equalValues(path, [target.field]))) continue;
      const confirmed = { ...this.state, draft: this.state.confirmed.value };
      const action = stageAutosaveField(confirmed, this.state.draft, undefined, target, { field: target.field, time });
      if (action) this.state[target.draft] = action;
    }
    return true;
  }

  applyAccountPreferenceReview(choices: AccountPreferenceResolution, time: ActionTime | null): void {
    const review = readAccountPreferenceReview(this.state);
    if (review?.kind === 'saved-only' && choices === 'saved-draft') {
      this.finishChoiceAgainstRemote(review.basis.value);
      delete this.state.unreadableScalarProof;
      return;
    }
    if (review?.kind !== 'choices' || choices === 'saved-draft' || Object.keys(choices).length !== review.fields.length
      || review.fields.some(({ field }) => choices[field] !== 'local' && choices[field] !== 'remote')) {
      throw Object.assign(new Error('Choose a version for each displayed setting'), { code: 'decision-changed' });
    }
    const kept = review.fields.filter(({ field }) => choices[field] === 'local');
    const value = kept.reduce((data, { path, mineField }) => writeField(data, path, mineField), review.basis.value);
    this.finishChoiceAgainstRemote(value);
    delete this.state.unreadableScalarProof;
    if (kept.length === 1) this.stageAccountPreferenceRetry(kept[0].field, time);
    if (kept.length > 1) this.state.accountPreferenceRetry = { fields: kept.map(({ field }) => field), time };
  }

  /** A choice about a private unreadable edit owns only its displayed fields. */
  private acceptStoredUnreadableFields(atChoice: DocumentData | null | undefined): boolean {
    const { confirmed, remoteCandidate, draft, unreadableScalarProof, unreadableRowProofs, unreadableExegeticalProofs, conflicts } = this.state;
    const placement = privateServiceOrderPosition(this.state);
    const target = remoteCandidate ?? (placement ? confirmed : null);
    if (!confirmed.value || !target?.value || !draft || confirmed.metadata?.generation !== target.metadata?.generation) {
      if (placement) throw Object.assign(new Error('The service order changed before this choice'), { code: 'decision-changed' });
      return false;
    }
    if (!placement && (!hasUnreadableDraftProof(this.state) || !conflicts.length
      || conflicts.some(conflict => conflict.code !== UNREADABLE_SCALAR_PROOF && conflict.code !== UNREADABLE_ROW_PROOF && conflict.code !== UNREADABLE_EXEGETICAL_PROOF))) return false;
    const source = this.checkpoint();
    const shown = atChoice ?? draft;
    if (placement === 'rank' && !equalValues(readField(draft, ['rank']), readField(shown, ['rank']))) {
      throw Object.assign(new Error('The service order position changed before this choice'), { code: 'decision-changed' });
    }
    let reordered = draft;
    if (placement === 'step') {
      const before = placementSteps(confirmed.value.steps), current = placementSteps(draft.steps), displayed = placementSteps(shown.steps);
      if (!before || !current || !displayed || !equalValues(current.map(row => row.id), displayed.map(row => row.id))) {
        throw Object.assign(new Error('The service steps changed before this choice'), { code: 'decision-changed' });
      }
      reordered = { ...draft, steps: keepSavedStepPositions(before, current) };
    }
    const scalars = (placement === 'step' ? [] : placement === 'rank' ? ['rank'] : unreadableScalarProof ?? []).reduce((value, field) => {
      const path = unreadableScalarPath(confirmed.resource.collection, field);
      if (!equalValues(readField(value, path), readField(shown, path))) return value;
      const opening = readField(confirmed.value!, path);
      return field === 'heldAt' ? withCouncilLifecycle(value, opening) : writeField(value, path, opening);
    }, reordered);
    const reduced = (unreadableRowProofs ?? []).reduce((value, address) => {
      const current = unreadableRowChoice(this.state, address);
      const reviewed = unreadableRowChoice({ ...this.state, draft: shown }, address);
      return current && reviewed && equalValues(current.mine, reviewed.mine) ? current.apply(value, 'opening') : value;
    }, scalars);
    let withPoints = reduced;
    const remainingPoints: UnreadableExegeticalProof[] = [];
    for (const address of unreadableExegeticalProofs ?? []) {
      const current = unreadableExegeticalChoice(this.state, address);
      const reviewed = unreadableExegeticalChoice({ ...this.state, draft: shown }, address);
      const neutral = current && reviewed && current.reviewedTogether(reviewed.conflict) && current.apply(withPoints, 'opening');
      if (neutral) withPoints = neutral;
      else remainingPoints.push(address);
    }
    if (remainingPoints.length && remainingPoints.length === unreadableExegeticalProofs?.length) return false;
    const result = mergeDocumentFields(confirmed.value, withPoints, target.value);
    this.state.confirmed = copy(target);
    this.replaceDraft(result.value.exists ? result.value.value as DocumentData : null);
    this.state.conflicts = copy(result.conflicts);
    this.state.remoteCandidate = result.conflicts.length ? copy(target) : null;
    this.state.dirty = !equalValues(this.state.draft, this.state.confirmed.value);
    this.state.editGeneration = this.reserveEditGeneration();
    if (placement === 'rank') delete this.state.serviceOrderPlacementRetry;
    if (placement === 'step') {
      delete this.state.serviceOrderStepPlacementRetry;
      delete this.state.unreadableServiceOrderStepPlacement;
    } else delete this.state.unreadableScalarProof;
    delete this.state.unreadableRowProofs;
    this.state.unreadableExegeticalProofs = remainingPoints.length ? remainingPoints : undefined;
    carryAnchoredDraftChronology(source, this.state, conflicts);
    this.state.dirty ||= hasUncapturedAutosaveField(this.state) || hasUncapturedAutosaveRowField(this.state)
      || Boolean(privateServiceOrderPosition(this.state));
    this.refreshUnreadableComparisons();
    return true;
  }

  /** Replacing local intent is allowed only after each pending delivery is explicitly settled. */
  acceptRemote(atChoice?: DocumentData | null): void {
    if (Object.keys(this.state.pending).length) throw Object.assign(new Error('Resolve pending commands before accepting remote data'), { code: 'pending-delivery-first' });
    const { confirmed, remoteCandidate, privateFieldReview, draft } = this.state;
    if (privateFieldReview?.groupCopySources?.length && remoteCandidate
      && (!remoteCandidate.value || remoteCandidate.metadata?.generation !== confirmed.metadata?.generation)) {
      if (atChoice !== undefined && !equalValues(draft, atChoice)) {
        throw Object.assign(new Error('The shown group draft changed'), { code: 'decision-changed' });
      }
      this.finishChoiceAgainstRemote(remoteCandidate.value);
      delete this.state.privateFieldReview;
      delete this.state.unreadableScalarProof;
      delete this.state.unreadableRowProofs;
      return;
    }
    this.assertNoUnreviewedGroupCopy();
    const storedPosition = storedSermonPointOrderChoice(this.state, atChoice);
    if (storedPosition) {
      const source = this.checkpoint();
      this.state.confirmed = copy(storedPosition.target);
      this.replaceDraft(storedPosition.draft);
      this.state.conflicts = copy(storedPosition.conflicts);
      this.state.remoteCandidate = storedPosition.conflicts.length ? copy(storedPosition.target) : null;
      this.state.editGeneration = this.reserveEditGeneration();
      this.state.dirty = !equalValues(this.state.draft, this.state.confirmed.value);
      delete this.state.outlinePointPlacementRetry;
      delete this.state.unreadableOutlinePointPlacement;
      this.retainUnreviewedAutosaveActions(source, [{ path: ['outline', 'position'] }]);
      this.refreshUnreadableComparisons();
      return;
    }
    if (this.acceptStoredUnreadableFields(atChoice) || !this.state.remoteCandidate) return;
    const savedSketches = resolvePlacedSketchComparison(this.state, 'remote');
    if (savedSketches) {
      this.finishChoiceAgainstRemote(savedSketches);
      return;
    }
    if (this.state.conflicts.some(conflict => conflict.code === UNREADABLE_EXEGETICAL_PROOF)) {
      if (this.state.unreadableExegeticalProofs?.some(address => unreadableExegeticalChoice(this.state, address))) {
        throw Object.assign(new Error('Other changes in the plan need review'), { code: 'other-changes-first' });
      }
      delete this.state.unreadableExegeticalProofs;
    }
    if (this.state.conflicts.some(conflict => conflict.code === UNREADABLE_ROW_PROOF)) delete this.state.unreadableRowProofs;
    if (atChoice === undefined || this.state.conflicts.some(conflict => conflict.code === UNREADABLE_SCALAR_PROOF)) delete this.state.unreadableScalarProof;
    const referenceChoice = chooseStudyNoteReferences(this.state, 'stored');
    if (referenceChoice) {
      this.finishChoiceAgainstRemote(referenceChoice);
      return;
    }
    const planChoice = projectStoredPlanCellChoice(this.state, atChoice);
    if (planChoice) {
      this.state.confirmed = copy(planChoice.confirmed);
      this.replaceDraft(planChoice.draft);
      this.state.conflicts = copy(planChoice.conflicts);
      this.state.remoteCandidate = planChoice.conflicts.length ? copy(this.state.confirmed) : null;
      this.state.editGeneration = this.reserveEditGeneration();
      this.state.dirty = !equalValues(this.state.draft, this.state.confirmed.value);
      this.refreshUnreadableComparisons();
      return;
    }
    this.state.confirmed = copy(this.state.remoteCandidate);
    this.state.remoteCandidate = null;
    if (atChoice !== undefined) {
      // The choice replaces the shown draft, while later typing remains a new local action.
      this.dropRefused(atChoice);
      this.refreshUnreadableComparisons();
      return;
    }
    this.replaceDraft(this.state.confirmed.value);
    this.clearAutosaveFieldDrafts();
    this.state.editGeneration = this.reserveEditGeneration();
    this.state.dirty = false;
    this.state.conflicts = [];
  }

  /** Keep a later body on this screen, with its own comparison against the newly accepted copy. */
  retainStudyNoteBodyAfterChoice(submitted: DocumentData | null, latest: DocumentData | null, conflicts: readonly ConflictDetail[]): void {
    const { confirmed, draft } = this.state;
    const later = studyNoteBodyAfterStoredChoice(submitted, latest, confirmed, conflicts);
    if (!later || !draft || this.state.remoteCandidate) return;
    const body = writeField(draft, later.conflict.path, later.conflict.mine);
    this.edit(writeField(body, ['dictationSourceIds'], later.dictationIds));
    this.state.remoteCandidate = copy(confirmed);
    this.state.conflicts = [later.conflict];
  }

  private finishChoiceAgainstRemote(draft: DocumentData | null): void {
    this.state.confirmed = copy(this.state.remoteCandidate!);
    this.state.draft = copy(draft);
    this.state.remoteCandidate = null;
    this.state.conflicts = [];
    this.clearAutosaveFieldDrafts();
    this.state.editGeneration = this.reserveEditGeneration();
    this.state.dirty = !equalValues(draft, this.state.confirmed.value);
  }

  /** Explicit conflict choice: keep edited fields and retain untouched remote siblings. */
  private assertNoUnreviewedGroupCopy(): void {
    if (hasUnreviewedGroupCopy(this.state)) {
      throw Object.assign(new Error('The copied group step needs its own review'), { code: 'other-changes-first' });
    }
  }

  keepLocal(preachStatuses?: readonly PreachStatusAction[], choiceTime: ActionTime | null = null, choiceSource?: SessionCheckpoint, titles?: readonly OutlineTitleDecision[]): void {
    this.assertNoUnreviewedGroupCopy();
    if (Object.keys(this.state.pending).length) throw Object.assign(new Error('Resolve pending commands before keeping local data'), { code: 'pending-delivery-first' });
    if (needsAccountPreferenceReview(this.state)) {
      throw Object.assign(new Error('Choose a version for each displayed setting'), { code: 'decision-changed' });
    }
    if (waitsForServiceOrderPosition(this.state) || hasTwoPrivateServiceOrderMoves(this.state)) {
      throw Object.assign(new Error('Choose the service order position again'), { code: 'decision-changed' });
    }
    if (this.state.unreadableOutlinePointPlacement) {
      throw Object.assign(new Error('Choose the outline point position again'), { code: 'decision-changed' });
    }
    if ((privateServiceOrderPosition(this.state) || hasPrivateSermonPointMove(this.state))
      && !this.state.remoteCandidate && !this.state.conflicts.length) return;
    const mySketches = resolvePlacedSketchComparison(this.state, 'local');
    if (mySketches) {
      const observed = this.state.remoteCandidate;
      this.finishChoiceAgainstRemote(mySketches);
      const opening = observed && reviewedPlacedSketchOpening(observed, mySketches);
      if (opening) this.state.guardedScratchText = opening;
      return;
    }
    assertLegacyCommentLocalChoice(this.state);
    const referenceChoice = chooseStudyNoteReferences(this.state, 'local');
    if (referenceChoice) {
      this.finishChoiceAgainstRemote(referenceChoice);
      return;
    }
    rejectCouncilTopicChoice(councilTopicConflictCode(this.state.conflicts));
    const title = readOutlineTitleComparison(this.state);
    if (title?.removed) {
      throw Object.assign(new Error('The compared point was removed'), { code: 'decision-changed' });
    }
    const candidate = this.state.remoteCandidate;
    const titleSource = choiceSource ?? { ...this.state };
    const reviewingPrivate = !choiceSource || Object.keys(choiceSource.pending).length === 0;
    const reviewingUnreadableProof = reviewingPrivate && this.state.conflicts.some(conflict => conflict.code === UNREADABLE_SCALAR_PROOF);
    const reviewingRows = reviewingPrivate && this.state.conflicts.some(conflict => conflict.code === UNREADABLE_ROW_PROOF);
    const unavailablePoint = () => Object.assign(new Error('The edited plan point has changed places or was removed'), { code: 'decision-changed' });
    const pointChoices = (this.state.unreadableExegeticalProofs ?? []).map(address => {
      const choice = unreadableExegeticalChoice(this.state, address);
      if (!choice?.localAvailable) throw unavailablePoint();
      return choice;
    });
    const independentPointProofs = pointChoices.length ? this.state.exegeticalPointDrafts : undefined;
    const carryFieldProofs = candidate && (['groups', 'councils'].includes(candidate.resource.collection)
      || (reviewingUnreadableProof && candidate.resource.collection === 'studyNotes')) ? this.checkpoint() : undefined;
    if (candidate?.value === null || candidate?.metadata?.deleted || this.state.confirmed.metadata?.deleted) {
      throw Object.assign(new Error('Remote document was deleted; use a new copy to preserve this draft'), { code: 'use-new-copy' });
    }
    if (candidate) {
      const marks = firstBookMarksIntent(this.state.confirmed, this.state.draft, candidate);
      const pointIds = this.state.conflicts.flatMap(({ path, code }) => code === UNREADABLE_EXEGETICAL_PROOF ? [] : exegeticalPointConflictId(path) ?? []);
      const point = mergeExegeticalPointChoice(this.state.confirmed.value, this.state.draft, candidate.value, pointIds);
      const outline = outlineTitleChoiceFrames(this.state.confirmed, this.state.draft, candidate, this.state.conflicts);
      const note = preachDateChoiceFrames(outline.basis, outline.draft, candidate.value, this.state.conflicts);
      const basis = marks?.baseline ?? note.basis;
      const draft = pointChoices.reduce((value, choice) => {
        const neutral = value && choice.apply(value, 'opening');
        if (!neutral) throw unavailablePoint();
        return neutral;
      }, marks?.value ?? note.draft);
      const recoveringCopy = candidate.resource.collection === 'groups'
        && this.state.conflicts.some(conflict => conflict.code === GROUP_FLOW_COPY_CONTENT_MISSING);
      const merged = point?.rebased ?? (recoveringCopy ? mergeGroupFlowRebase(basis, draft, candidate.value)
        : rebaseOptionalPrayerTags(candidate.resource.collection, basis, draft, candidate.value, mergeDocumentFields(basis, draft, candidate.value)));
      rejectCouncilTopicChoice(councilTopicConflictCode(merged.conflicts));
      if (merged.conflicts.some(({ path }) => outline.removed.some(removed =>
        path.slice(0, Math.min(path.length, removed.length)).every((part, index) => part === removed[index])))) {
        throw Object.assign(new Error('The removed point contains other changes that need review'), { code: 'other-changes-first' });
      }
      const parentChoice = projectOutlineParentChoice(this.state.confirmed, this.state.draft, candidate, this.state.conflicts, 'local', titles);
      const chosen = parentChoice ?? chooseLocalPlacement(this.state.confirmed.resource.collection,
        note.basis, note.draft, candidate.value,
        merged.value.exists ? merged.value.value as DocumentData : null, mergeFields,
        localThoughtPlacementChoices(this.state.conflicts, this.state.confirmed.value, this.state.draft, candidate.value));
      const statusChoice = chooseLocalPreachDateEdits({ ...this.state.confirmed, value: note.basis }, note.draft, candidate, preachStatuses);
      const exactLists = keepReviewedAuthoredLists(candidate.resource.collection, statusChoice ?? chosen, this.state.conflicts);
      const exactTags = keepExactLocalDocumentTags(this.state, exactLists);
      const withRows = keepReselectedRowFields(this.state.confirmed.resource.collection, this.state.confirmed.value,
        this.state.draft, candidate.value, exactTags, this.state.conflicts);
      const planMode = readSermonPlanModeComparison(this.state);
      const commentPlace = readCommentPlaceComparison(this.state);
      const chosenRefs = commentPlace && withRows
        ? replaceCommentReference(withRows.scriptureRefs, { exists: true, value: commentPlace.mine }) : undefined;
      const explicit = withRows && planMode ? writeField(withRows, ['planMode'], planMode.mine)
        : withRows && chosenRefs !== undefined ? { ...withRows, scriptureRefs: chosenRefs } : withRows;
      const reviewedScalars = reviewingUnreadableProof && explicit && this.state.draft
        ? this.state.unreadableScalarProof?.reduce((value, field) => {
          const path = unreadableScalarPath(candidate.resource.collection, field);
          const local = readField(this.state.draft!, path);
          return field === 'heldAt' ? withCouncilLifecycle(value, local) : writeField(value, path, local);
        }, explicit) : undefined;
      const withScalars = reviewedScalars ?? explicit;
      const withReviewedRows = reviewingRows && withScalars ? this.state.unreadableRowProofs?.reduce((value, address) => {
        const row = unreadableRowChoice(this.state, address);
        if (row && !row.available) throw Object.assign(new Error('The edited row is gone'), { code: 'decision-changed' });
        return row?.apply(value, 'mine') ?? value;
      }, withScalars) ?? withScalars : withScalars;
      const withPoints = pointChoices.reduce((value, choice) => {
        const projected = value && choice.apply(value, 'mine');
        if (!projected) throw unavailablePoint();
        return projected;
      }, withReviewedRows);
      const resolved = recoveringCopy ? keepGroupFlowCopyContent(withPoints, draft, this.state.conflicts) : withPoints;
      const meeting = candidate.resource.collection === 'groups' && firstGroupMeetingReview(this.state.conflicts);
      const meetingChoice = meeting && candidate.value && projectFirstGroupMeetingChoice(candidate.value, meeting, 'local');
      if (meeting && !meetingChoice) throw Object.assign(new Error('The first meeting comparison changed'), { code: 'decision-changed' });
      const chosenGroup = meetingChoice && resolved ? writeField(resolved, ['meetingDates'], readField(meetingChoice, ['meetingDates'])) : resolved;
      const council = this.state.confirmed.resource.collection === 'councils';
      const lifecycle = council ? councilLifecycleValue(this.state.draft) : undefined;
      const openingLifecycle = council ? councilLifecycleValue(this.state.confirmed.value) : undefined;
      this.state.confirmed = copy(candidate);
      // A restored held time owns the status even if that status had not changed on this device.
      this.replaceDraft(chosenGroup && lifecycle && openingLifecycle && !equalValues(lifecycle, openingLifecycle)
        ? withCouncilLifecycle(chosenGroup, lifecycle) : chosenGroup);
    }
    if (reviewingUnreadableProof) delete this.state.unreadableScalarProof;
    if (reviewingRows) delete this.state.unreadableRowProofs;
    if (reviewingPrivate && this.state.conflicts.some(conflict => conflict.code === UNREADABLE_EXEGETICAL_PROOF)) delete this.state.unreadableExegeticalProofs;
    this.clearAutosaveFieldDrafts();
    if (independentPointProofs?.length) {
      this.state.exegeticalPointDrafts = stageExegeticalPoint({ ...this.state, exegeticalPointDrafts: independentPointProofs },
        this.state.draft, undefined, undefined);
    }
    if (carryFieldProofs) carryAnchoredDraftChronology(carryFieldProofs, this.state, this.state.conflicts);
    if (candidate) {
      acceptPlanCellComparison(this.state);
      this.retainOutlineTitleActions(titleSource);
      stageReviewedCouncilTopics(this.state, this.state.conflicts);
      const selectedPaths = this.state.conflicts.filter(conflict => !isOrderedPreachDateField(conflict)).map(({ path }) => path);
      stageReviewedRowFields(this.state, selectedPaths, choiceTime, ['thought-text', ...PREACH_DATE_REVIEW_FIELDS]);
      stageReviewedOutlineTitles(this.state, unresolvedOutlineTitleConflicts(this.state.conflicts), choiceTime);
      this.stageOutlineReviewTitles(titles, choiceTime);
      if (reviewingRows) this.stageReviewedGroupFlowText(this.state.conflicts.filter(issue => issue.code === UNREADABLE_ROW_PROOF).map(issue => issue.path), choiceTime);
      if (reviewingUnreadableProof && this.state.conflicts.some(conflict => conflict.code === UNREADABLE_SCALAR_PROOF
        && equalValues(conflict.path, ['description']))) this.stageReviewedGroupField('description', choiceTime);
    }
    this.state.remoteCandidate = null;
    this.state.conflicts = [];
    this.state.editGeneration = this.reserveEditGeneration();
    this.state.dirty = !equalValues(this.state.draft, this.state.confirmed.value);
    this.refreshUnreadableComparisons();
  }

  stageOutlineReviewTitles(titles: readonly OutlineTitleDecision[] = [], time: ActionTime | null = null): void {
    stageReviewedOutlineTitleIds(this.state, titles.filter(title => title.side === 'local' && !title.field).map(title => title.id), time);
  }

  retainOutlineTitleActions(source: SessionCheckpoint): void {
    carryOutlineTitleActions(source, this.state);
  }

  stageReviewedCouncilSummary(path: readonly string[], time: ActionTime | null): void {
    stageReviewedRowFields(this.state, [path], time, ['council-topic-summary']);
  }

  stageReviewedCouncilText(path: readonly string[], time: ActionTime | null): void {
    const target = path.length === 1 && [...COUNCIL_TIMED_FIELDS, COUNCIL_LIFECYCLE].find(item => item.field === path[0]);
    if (target) {
      const opening = { ...this.state, draft: this.state.confirmed.value };
      const action = stageAutosaveField(opening, this.state.draft, undefined, target, { field: target.field, time });
      if (action) this.state[target.draft] = action;
      return;
    }
    stageReviewedRowFields(this.state, [path], time, ['council-topic-text', 'council-topic-summary', 'council-topic-title', 'council-topic-outcome']);
  }

  stageReviewedGroupFlowText(paths: readonly (readonly string[])[], time: ActionTime | null): void {
    stageReviewedGroupFlowText(this.state, paths, time);
  }

  stageReviewedGroupField(field: 'description' | 'title' | 'status', time: ActionTime | null): void {
    const target = autosaveFieldTargets(this.state.confirmed.resource.collection).find(candidate => candidate.field === field);
    if (!target) return;
    const confirmed = { ...this.state, draft: this.state.confirmed.value };
    const action = stageAutosaveField(confirmed, this.state.draft, undefined, target, { field, time });
    if (action) this.state[target.draft] = action;
  }

  clearGroupTextReview(): void { delete this.state.groupTextReview; }

  retainUnreviewedAutosaveActions(source: SessionCheckpoint, reviewed: readonly { path: string[] }[] = source.conflicts): void {
    carryAnchoredDraftChronology(source, this.state, reviewed);
    this.state.dirty ||= hasUncapturedAutosaveField(this.state) || hasUncapturedAutosaveRowField(this.state);
  }

  stageServiceOrderPlacementRetry(move: ServiceOrderPlacementCapture): void {
    if (!this.state.draft) throw new Error('The service order is unavailable');
    this.edit({ ...this.state.draft, rank: move.rank });
    this.state.serviceOrderPlacementRetry = copy(move);
    this.state.dirty = true;
  }

  stageServiceOrderStepPlacementRetry(move: ServiceOrderStepPlacementCapture, steps: DocumentData[]): void {
    if (!this.state.draft) throw new Error('The service order is unavailable');
    this.edit({ ...this.state.draft, steps });
    this.state.serviceOrderStepPlacementRetry = copy(move);
    this.state.dirty = true;
  }

  stageOutlinePointPlacementRetry(move: OutlinePointPlacementCapture, draft: DocumentData): void {
    this.edit(draft);
    delete this.state.reviewedSermonOutlineOrder;
    this.state.outlinePointPlacementRetry = copy(move);
    this.state.dirty = true;
  }

  retainAnchoredPlacementChoiceEdits(source: SessionCheckpoint, base: DocumentData, draft: DocumentData): boolean {
    const accepted = this.state.confirmed;
    if (source.confirmed.metadata?.generation !== accepted.metadata?.generation
      || accepted.resource.collection === 'councils' && accepted.value?.status === 'held') return false;
    const merged = mergeEditsAfterAnchoredPlacement(source, base, draft, this.state);
    if (merged.conflicts.length || !merged.value.exists) return false;
    this.edit(merged.value.value as DocumentData);
    carryAnchoredDraftChronology(source, this.state);
    this.state.dirty ||= hasUncapturedAutosaveField(this.state) || hasUncapturedAutosaveRowField(this.state);
    return true;
  }

  stageGroupStepPlacementRetry(move: GroupFlowStepPlacementCapture, draft: DocumentData): void {
    this.edit(draft);
    this.state.groupFlowStepPlacementRetry = copy(move);
    this.state.dirty = true;
  }

  stageCouncilTopicPlacementRetry(move: CouncilTopicPlacementCapture, draft: DocumentData): void {
    this.edit(draft);
    this.state.councilTopicPlacementRetry = copy(move);
    this.state.dirty = true;
  }

  stageSourceNoteLinkRetry(capture: SourceNoteLinkCapture): void {
    if (!this.state.draft) return;
    this.state.draft = projectSourceNoteChoices(this.state.draft, capture.action.changes);
    this.state.sourceNoteLinkRetry = copy(capture);
    this.state.dirty = true;
  }

  retainSermonTextRetry(retry: SessionCheckpoint['sermonTextRetry']): void {
    if (retry) this.state.sermonTextRetry = copy(retry);
  }

  stageAccountPreferenceRetry(field: AccountPreferenceField, time: ActionTime | null): void {
    this.state.accountPreferenceRetry = { field, time };
  }

  private replaceDraft(value: DocumentData | null): void {
    retainServiceOrderInputs(this.state, value);
    // A retry owns exactly its displayed target, regardless of who replaces the draft.
    const rankMove = this.state.serviceOrderPlacementRetry;
    if (rankMove && value?.rank !== rankMove.rank) delete this.state.serviceOrderPlacementRetry;
    const stepMove = this.state.serviceOrderStepPlacementRetry;
    if (stepMove) {
      const target = projectServiceOrderStep(stepMove.shownIds.map(id => ({ id })), stepMove.placement.stepId, stepMove.placement.destination);
      const steps = placementSteps(value?.steps);
      if (!target || !steps || !equalValues(steps.map(step => step.id), target.map(step => step.id))) delete this.state.serviceOrderStepPlacementRetry;
    }
    const outlineMove = this.state.outlinePointPlacementRetry;
    if (outlineMove) {
      const field = outlinePlacementField(this.state.confirmed.resource.collection);
      if (!field || !hasOutlinePointOrder(value?.[field], outlineMove.after)) delete this.state.outlinePointPlacementRetry;
    }
    const reviewed = this.state.reviewedSermonOutlineOrder;
    if (reviewed && !hasOutlinePointOrder(value?.outline, reviewed.after)) delete this.state.reviewedSermonOutlineOrder;
    this.state.draft = copy(value);
    retainPlanCellDrafts(this.state, value);
  }

  private clearAutosaveFieldDrafts(): void {
    delete this.state.preparationCheckRetry;
    delete this.state.sermonChurchRecovery;
    delete this.state.sermonTextRetry;
    delete this.state.accountPreferenceRetry;
    delete this.state.serviceOrderPlacementComparison;
    delete this.state.serviceOrderStepPlacementRetry;
    delete this.state.unreadableServiceOrderStepPlacement;
    delete this.state.serviceOrderPlacementRetry;
    delete this.state.outlinePointPlacementRetry;
    delete this.state.unreadableOutlinePointPlacement;
    delete this.state.groupFlowStepPlacementRetry;
    delete this.state.councilTopicPlacementRetry;
    delete this.state.sourceNoteLinkRetry;
    delete this.state.exegeticalPointDrafts;
    clearRowFieldDrafts(this.state);
    for (const target of autosaveFieldTargets(this.state.confirmed.resource.collection)) delete this.state[target.draft];
  }

  private matches(snapshot: ResourceSnapshot): boolean {
    const resource = this.state.confirmed.resource;
    return resource.collection === snapshot.resource.collection && resource.id === snapshot.resource.id;
  }

  private isOlder(snapshot: ResourceSnapshot): boolean {
    const current = this.state.confirmed.metadata;
    if (!current) return false;
    if (!snapshot.metadata) return true;
    // Generations have no ordering. Re-creation needs an explicit recovery decision.
    return snapshot.metadata.generation !== current.generation || snapshot.metadata.revision < current.revision;
  }
}
