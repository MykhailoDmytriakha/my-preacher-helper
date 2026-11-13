import { hasDifferentAnalysisPositionBasis, keepAnalysisReshapeFrame } from './analysisReshapeFields';
import { isLiveWholeAction, isRetiredActionDependent } from './atomicCommits';
import { keepReviewedAuthoredLists } from './authoredListChoice';
import { firstBookMarksIntent } from './bibleMarksCreation';
import { commentPlaceValue, matchesCommentPlaceScope, replaceCommentReference } from './commentPlaceAction';
import { readCommentPlaceComparison } from './commentPlaceChoice';
import { councilLifecycleValue, withCouncilLifecycle } from './councilFieldAction';
import { projectCouncilTopicOnDocument } from './councilTopicPlacement';
import { councilTopicConflictCode, rejectCouncilTopicChoice } from './councilTopicTransition';
import { autosaveAcknowledgementAncestor, autosaveFieldTargets, hasUncapturedAutosaveField, sameAutosaveCapture, stageAutosaveField } from './documentFieldAction';
import { keepExactLocalDocumentTags } from './documentTagChoice';
import { rebaseOptionalPrayerTags } from './documentTagMembership';
import { prepareDomainCommand } from './domainPolicy';
import { ACTION_SLOT, editorSlot } from './editorIdentity';
import { exegeticalPointConflictId } from './exegeticalPointAction';
import { mergeExegeticalPointChoice, stageExegeticalPoint } from './exegeticalPointCapture';
import { readField, writeField } from './fieldValues';
import { firstGroupMeetingReview, projectFirstGroupMeetingChoice } from './groupFirstMeeting';
import { GROUP_FLOW_COPY_CONTENT_MISSING, keepGroupFlowCopyContent } from './groupFlowTopology';
import { carryAnchoredDraftChronology, groupPlacementMergeFrame, mergeEditsAfterAnchoredPlacement, mergeGroupFlowRebase, restoreGroupPlacementOrder } from './groupStepPlacement';
import { chooseLocalPlacement } from './localPlacementChoice';
import { projectManualSelection } from './manualScope';
import { alignPendingOutlinePointPlacements, sameOutlinePointGesture } from './outlinePointPlacement';
import { outlineTitleChoiceFrames, readOutlineTitleComparison, templateTitleEdit, unresolvedOutlineTitleConflicts } from './outlineTitleEdit';
import { chooseLocalPreachDateEdits } from './preachDateChoice';
import { equalValues, mergeDocumentAfterAcknowledgement, mergeDocumentFields, mergeFields } from './protocol';
import { acknowledgeRowFields, carryOutlineTitleActions, clearRowFieldDrafts, hasUncapturedAutosaveRowField, registerRowFields, rowFieldAckAncestor, stageReviewedCouncilTopics, stageReviewedOutlineTitles, stageRowFields } from './rowFieldAutosave';
import { keepReselectedRowFields } from './rowReselectionChoice';
import { readSermonPlanModeComparison } from './sermonFieldChoice';
import { canReplaceSnapshot } from './snapshotFreshness';
import { projectSourceNoteChoices } from './sourceNoteLinkCapture';
import { chooseStudyNoteReferences } from './studyNoteReferenceChoice';
import { localThoughtPlacementChoices } from './thoughtPlacementAction';

import type { AccountPreferenceField } from './accountPreference';
import type { ActionTime } from './actionClock';
import type { CommentPlaceObservation } from './commentPlaceAction';
import type { CommitRequest } from './commits';
import type { AutosaveFieldActions, AutosaveFieldDrafts, AutosaveFieldStamp } from './documentFieldAction';
import type { PreachStatusAction } from './preachStatusAction';
import type { AutosaveRowFieldActions, RowFieldDrafts } from './rowFieldAutosave';
import type { SourceNoteLinkCapture } from './sourceNoteLinkCapture';
import type { CommandResult, ConflictDetail, CouncilTopicPlacementCapture, DataCommand, DocumentData, ResourceSnapshot, GroupFlowStepPlacementCapture, OutlinePointPlacementCapture, ServiceOrderPlacementCapture, ServiceOrderPlacementComparison, ServiceOrderStepPlacementCapture } from './types';
import type { OutlineTitleOpening } from '@/utils/sermonNoteText';

export interface SessionCheckpoint extends AutosaveFieldDrafts, RowFieldDrafts {
  confirmed: ResourceSnapshot;
  draft: DocumentData | null;
  dirty: boolean;
  editGeneration: number;
  remoteCandidate: ResourceSnapshot | null;
  exegeticalPointDrafts?: ReturnType<typeof stageExegeticalPoint>;
  conflicts: ConflictDetail[];
  serviceOrderPlacementComparison?: ServiceOrderPlacementComparison;
  serviceOrderPlacementRetry?: ServiceOrderPlacementCapture;
  serviceOrderStepPlacementRetry?: ServiceOrderStepPlacementCapture;
  outlinePointPlacementRetry?: OutlinePointPlacementCapture;
  groupFlowStepPlacementRetry?: GroupFlowStepPlacementCapture;
  councilTopicPlacementRetry?: CouncilTopicPlacementCapture;
  accountPreferenceRetry?: { field: AccountPreferenceField; time: ActionTime | null };
  sourceNoteLinkRetry?: SourceNoteLinkCapture;
  pending: Record<string, { generation: number; value: DocumentData | null; operations?: string[]; borrowedManualScope?: string; outlinePointPlacement?: OutlinePointPlacementCapture; groupFlowStepPlacement?: GroupFlowStepPlacementCapture; councilTopicPlacement?: CouncilTopicPlacementCapture; commentPlaceAction?: CommentPlaceObservation } & AutosaveFieldActions & AutosaveRowFieldActions>;
}

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

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

  constructor(snapshot: ResourceSnapshot) {
    this.state = { confirmed: copy(snapshot), draft: copy(snapshot.value), dirty: false, editGeneration: 0, remoteCandidate: null, conflicts: [], pending: {} };
  }

  static restore(checkpoint: SessionCheckpoint): DataSession {
    const session = new DataSession(checkpoint.confirmed);
    session.state = { ...copy(checkpoint), conflicts: copy(checkpoint.conflicts ?? []) };
    return session;
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
    if (value !== null && shown && deletedUnder(this.state, shown)) {
      this.state.remoteCandidate = copy(this.state.confirmed);
      this.state.confirmed = copy(shown.confirmed);
    }
    for (const target of autosaveFieldTargets(this.state.confirmed.resource.collection)) {
      const draft = stageAutosaveField(this.state, value, shown, target, autosaveStamp);
      if (draft) this.state[target.draft] = draft;
      else delete this.state[target.draft];
    }
    stageRowFields(this.state, value, shown, autosaveStamp && ('rowId' in autosaveStamp || 'rowIds' in autosaveStamp) ? autosaveStamp : undefined);
    const planActions = stageExegeticalPoint(this.state, value, shown, autosaveStamp?.field === 'exegetical-point' ? autosaveStamp : undefined);
    if (planActions) this.state.exegeticalPointDrafts = planActions;
    else delete this.state.exegeticalPointDrafts;
    this.state.draft = copy(value);
    this.state.editGeneration = generation;
    this.state.dirty = !equalValues(value, this.state.confirmed.value) || hasUncapturedAutosaveField(this.state) || hasUncapturedAutosaveRowField(this.state);
  }

  editTemplateTitle(shown: SessionCheckpoint, opening: OutlineTitleOpening, title: string, time: ActionTime | null = null): void {
    const { draft, stored, conflicts, conflictingTitle } = templateTitleEdit(this.state, shown, opening, title);
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
      // The whole action already rebased its dependent Saves. Their separately authored words
      // stay in the draft when their obsolete request identity is released.
      if (request.cancelledByAction && held && !isRetiredActionDependent(request)) this.rollbackAction(request);
      if (held && request.placementChoiceStored) this.observe(request.placementChoiceStored, { source: 'server' });
      const latest = Boolean(held) && Object.values(this.state.pending).every(other => other.generation <= held.generation);
      this.release(request.id);
      if (held && !request.cancelledByAction && !Object.keys(this.state.pending).length) {
        // Nothing of this editor's is in flight any more, so a conflict it held answers nothing: decided
        // work settles fully; work swept along by a choice about another draft stays an ordinary draft.
        if ((request.cancelledByChoice || request.retainedAfterChoice) && latest) this.settleDecided(held.value, Boolean(request.placementChoiceStored));
        else this.state.conflicts = [];
      }
      return true;
    }
    if (request.serviceOrderPlacement && equalValues(request.serviceOrderPlacement, this.state.serviceOrderPlacementRetry)) {
      delete this.state.serviceOrderPlacementRetry;
    }
    if (request.serviceOrderStepPlacement && equalValues(request.serviceOrderStepPlacement, this.state.serviceOrderStepPlacementRetry)) {
      delete this.state.serviceOrderStepPlacementRetry;
    }
    const outlineRetry = this.state.outlinePointPlacementRetry;
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
    const preferenceRetry = this.state.accountPreferenceRetry;
    if (preferenceRetry && request.accountPreferenceActions?.[preferenceRetry.field]
      && equalValues(request.accountPreferenceActions[preferenceRetry.field]?.time, preferenceRetry.time)) {
      delete this.state.accountPreferenceRetry;
    }
    const newRowMove = (request.groupFlowStepPlacement || request.councilTopicPlacement || templateMove)
      && (!this.state.pending[request.id] || capturedTemplateRetry);
    this.registerCommit(request.id, request.editGeneration, request.value, request.atomic?.id ?? request.command?.operationId, request);
    if (newRowMove && this.state.editGeneration === request.editGeneration && !equalValues(this.state.draft, request.value)) {
      // The exact move took only the position. Save the additional typing in its own generation.
      this.state.editGeneration = this.reserveEditGeneration();
    }
    if (request.result && ['acknowledged', 'conflict', 'refused'].includes(request.state)) this.accept(request.result, request.atomic?.kind === 'analysis-reshape');
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
    this.state.draft = rebased.value.exists ? copy(rebased.value.value as DocumentData) : null;
    this.state.conflicts = copy(conflicts);
    this.state.remoteCandidate = conflicts.length ? copy(accepted) : null;
    this.state.editGeneration = this.reserveEditGeneration();
    this.state.dirty = !equalValues(this.state.draft, accepted.value);
  }

  prepare(operationId: string, owner: string, targets: readonly ResourceSnapshot[] = [], intended: SessionCheckpoint = this.state): DataCommand | null {
    const { confirmed, draft, dirty, editGeneration } = intended;
    const { pending } = this.state;
    if (!dirty || this.state.conflicts.length) return null;
    if (pending[operationId]) throw new Error('Operation already prepared');
    if (Object.keys(pending).length) return null;
    if (!equalValues(confirmed, this.state.confirmed)) throw new Error('The confirmed baseline changed during preparation');
    const { command, submittedValue } = prepareDomainCommand(owner, operationId, confirmed, draft, targets);
    pending[operationId] = { generation: editGeneration, value: copy(submittedValue) };
    return command;
  }

  /** Release only after proven failed local commit or durable retirement of a terminal result.
   * Queued, sending and unknown operations must retain their identity until acknowledged. */
  release(operationId: string): void { delete this.state.pending[operationId]; }

  accept(result: CommandResult, wholeAnalysisFrame = false): void {
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
      const action = submitted[target.action];
      if (sameAutosaveCapture(action, this.state[target.draft]?.action)) delete this.state[target.draft];
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
    const fieldAncestor = autosaveAcknowledgementAncestor(ancestor, accepted, this.state);
    const acceptedAncestor = rowFieldAckAncestor(fieldAncestor, accepted, this.state);
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
    this.state.confirmed = copy(accepted);
    const nextDraft = rebased.value.exists ? rebased.value.value as DocumentData : null;
    this.state.draft = copy(groupMoves.length ? restoreGroupPlacementOrder(nextDraft) : nextDraft);
    this.state.conflicts = copy(rebased.conflicts);
    this.state.remoteCandidate = rebased.conflicts.length ? copy(accepted) : null;
    this.state.dirty = !equalValues(this.state.draft, accepted.value) || hasUncapturedAutosaveField(this.state) || hasUncapturedAutosaveRowField(this.state);
  }

  observe(snapshot: ResourceSnapshot, { source }: { source: 'server' | 'cache' }): void {
    if (!this.matches(snapshot) || this.isOlder(snapshot)) return;
    // A versioned tombstone survives acknowledgement collection. A cache miss proves nothing.
    if (source === 'cache' && snapshot.value === null && !snapshot.metadata?.deleted) return;
    if (equalValues(snapshot, this.state.confirmed)) return;
    if (this.state.dirty || Object.keys(this.state.pending).length) {
      const candidate = this.state.remoteCandidate;
      if (candidate?.metadata && snapshot.metadata && candidate.metadata.generation === snapshot.metadata.generation
        && candidate.metadata.revision > snapshot.metadata.revision) return;
      this.state.remoteCandidate = copy(snapshot);
      return;
    }
    this.state.confirmed = copy(snapshot);
    this.state.draft = copy(snapshot.value);
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
  private settleDecided(decided: DocumentData | null, placementChoice = false): void {
    const source = placementChoice ? this.checkpoint() : undefined;
    if (this.state.remoteCandidate) this.state.confirmed = copy(this.state.remoteCandidate);
    this.state.remoteCandidate = null;
    // Retire only the submitted value the person decided about; later unsent sibling words stay.
    this.dropRefused(decided, source);
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
    this.state.draft = merged.value.exists ? copy(merged.value.value as DocumentData) : null;
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

  /** Replacing local intent is allowed only after each pending delivery is explicitly settled. */
  acceptRemote(atChoice?: DocumentData | null): void {
    if (Object.keys(this.state.pending).length) throw Object.assign(new Error('Resolve pending commands before accepting remote data'), { code: 'pending-delivery-first' });
    if (!this.state.remoteCandidate) return;
    const referenceChoice = chooseStudyNoteReferences(this.state, 'stored');
    if (referenceChoice) {
      this.finishReferenceChoice(referenceChoice);
      return;
    }
    this.state.confirmed = copy(this.state.remoteCandidate);
    this.state.remoteCandidate = null;
    if (atChoice !== undefined) {
      // The choice replaces the shown draft, while later typing remains a new local action.
      this.dropRefused(atChoice);
      return;
    }
    this.state.draft = copy(this.state.confirmed.value);
    this.clearAutosaveFieldDrafts();
    this.state.editGeneration = this.reserveEditGeneration();
    this.state.dirty = false;
    this.state.conflicts = [];
  }

  private finishReferenceChoice(draft: DocumentData): void {
    this.state.confirmed = copy(this.state.remoteCandidate!);
    this.state.draft = copy(draft);
    this.state.remoteCandidate = null;
    this.state.conflicts = [];
    this.clearAutosaveFieldDrafts();
    this.state.editGeneration = this.reserveEditGeneration();
    this.state.dirty = !equalValues(draft, this.state.confirmed.value);
  }

  /** Explicit conflict choice: keep edited fields and retain untouched remote siblings. */
  keepLocal(preachStatuses?: readonly PreachStatusAction[], choiceTime: ActionTime | null = null, choiceSource?: SessionCheckpoint): void {
    if (Object.keys(this.state.pending).length) throw Object.assign(new Error('Resolve pending commands before keeping local data'), { code: 'pending-delivery-first' });
    const referenceChoice = chooseStudyNoteReferences(this.state, 'local');
    if (referenceChoice) {
      this.finishReferenceChoice(referenceChoice);
      return;
    }
    rejectCouncilTopicChoice(councilTopicConflictCode(this.state.conflicts));
    const title = readOutlineTitleComparison(this.state);
    if (title?.removed) {
      throw Object.assign(new Error('The compared point was removed'), { code: 'decision-changed' });
    }
    const candidate = this.state.remoteCandidate;
    const titleSource = choiceSource ?? { ...this.state };
    const placementFields = candidate && ['groups', 'councils'].includes(candidate.resource.collection) ? this.checkpoint() : undefined;
    if (candidate?.value === null || candidate?.metadata?.deleted || this.state.confirmed.metadata?.deleted) {
      throw Object.assign(new Error('Remote document was deleted; use a new copy to preserve this draft'), { code: 'use-new-copy' });
    }
    if (candidate) {
      const marks = firstBookMarksIntent(this.state.confirmed, this.state.draft, candidate);
      const pointIds = this.state.conflicts.flatMap(({ path }) => exegeticalPointConflictId(path) ?? []);
      const point = mergeExegeticalPointChoice(this.state.confirmed.value, this.state.draft, candidate.value, pointIds);
      const outline = outlineTitleChoiceFrames(this.state.confirmed, this.state.draft, candidate, this.state.conflicts);
      const basis = marks?.baseline ?? outline.basis;
      const draft = marks?.value ?? outline.draft;
      const recoveringCopy = candidate.resource.collection === 'groups'
        && this.state.conflicts.some(conflict => conflict.code === GROUP_FLOW_COPY_CONTENT_MISSING);
      const merged = point?.rebased ?? (recoveringCopy ? mergeGroupFlowRebase(basis, draft, candidate.value)
        : rebaseOptionalPrayerTags(candidate.resource.collection, basis, draft, candidate.value, mergeDocumentFields(basis, draft, candidate.value)));
      rejectCouncilTopicChoice(councilTopicConflictCode(merged.conflicts));
      if (merged.conflicts.some(({ path }) => outline.removed.some(removed =>
        path.slice(0, Math.min(path.length, removed.length)).every((part, index) => part === removed[index])))) {
        throw Object.assign(new Error('The removed point contains other changes that need review'), { code: 'other-changes-first' });
      }
      const chosen = chooseLocalPlacement(this.state.confirmed.resource.collection,
        outline.basis, outline.draft, candidate.value,
        merged.value.exists ? merged.value.value as DocumentData : null, mergeFields,
        localThoughtPlacementChoices(this.state.conflicts, this.state.confirmed.value, this.state.draft, candidate.value));
      const statusChoice = chooseLocalPreachDateEdits(this.state.confirmed, this.state.draft, candidate, preachStatuses);
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
      const resolved = recoveringCopy ? keepGroupFlowCopyContent(explicit, draft, this.state.conflicts) : explicit;
      const meeting = candidate.resource.collection === 'groups' && firstGroupMeetingReview(this.state.conflicts);
      const meetingChoice = meeting && candidate.value && projectFirstGroupMeetingChoice(candidate.value, meeting, 'local');
      if (meeting && !meetingChoice) throw Object.assign(new Error('The first meeting comparison changed'), { code: 'decision-changed' });
      const chosenGroup = meetingChoice && resolved ? writeField(resolved, ['meetingDates'], readField(meetingChoice, ['meetingDates'])) : resolved;
      const council = this.state.confirmed.resource.collection === 'councils';
      const lifecycle = council ? councilLifecycleValue(this.state.draft) : undefined;
      const openingLifecycle = council ? councilLifecycleValue(this.state.confirmed.value) : undefined;
      this.state.confirmed = copy(candidate);
      // A restored held time owns the status even if that status had not changed on this device.
      this.state.draft = copy(chosenGroup && lifecycle && openingLifecycle && !equalValues(lifecycle, openingLifecycle)
        ? withCouncilLifecycle(chosenGroup, lifecycle) : chosenGroup);
    }
    this.clearAutosaveFieldDrafts();
    if (placementFields) carryAnchoredDraftChronology(placementFields, this.state, this.state.conflicts);
    if (candidate) {
      this.retainOutlineTitleActions(titleSource);
      stageReviewedCouncilTopics(this.state, this.state.conflicts);
      stageReviewedOutlineTitles(this.state, unresolvedOutlineTitleConflicts(this.state.conflicts), choiceTime);
    }
    this.state.remoteCandidate = null;
    this.state.conflicts = [];
    this.state.editGeneration = this.reserveEditGeneration();
    this.state.dirty = !equalValues(this.state.draft, this.state.confirmed.value);
  }

  retainOutlineTitleActions(source: SessionCheckpoint): void {
    carryOutlineTitleActions(source, this.state);
  }

  retainUnreviewedAutosaveActions(source: SessionCheckpoint): void {
    carryAnchoredDraftChronology(source, this.state, source.conflicts);
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

  stageAccountPreferenceRetry(field: AccountPreferenceField, time: ActionTime | null): void {
    this.state.accountPreferenceRetry = { field, time };
  }

  private clearAutosaveFieldDrafts(): void {
    delete this.state.accountPreferenceRetry;
    delete this.state.serviceOrderPlacementComparison;
    delete this.state.serviceOrderStepPlacementRetry;
    delete this.state.serviceOrderPlacementRetry;
    delete this.state.outlinePointPlacementRetry;
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
