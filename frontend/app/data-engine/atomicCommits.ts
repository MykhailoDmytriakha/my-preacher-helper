import { hasOutlinePointOrder, SECTION_KEYS } from '@/utils/outlineDnd';
import { explicitPreachedFlag } from '@/utils/preachDateStatus';
import { projectServiceOrderStep } from '@/utils/serviceOrderStepPlacement';

import { sameAnalysisFrame } from './analysisReshapeFields';
import { rebaseBibleMarkAncestor } from './bibleMarkStroke';
import { pendingCommitRetirement, retireCommitJournal } from './commitJournal';
import { COUNCIL_ASSEMBLY } from './councilAssemblyAction';
import { COUNCIL_TOPIC_KIND } from './councilTopicKindAction';
import { projectCouncilTopicOnDocument } from './councilTopicPlacement';
import { councilTopicConflictCode, councilTopicTransitionRefusal } from './councilTopicTransition';
import { datedRowTarget, isCapturedDateConflict } from './datedRowAction';
import { followsStandaloneCreation, initializePendingRemoval, isRemovalAfterStandaloneCreation, provesStandaloneCreation } from './deletionOrdering';
import { pendingDocumentFieldAncestor } from './documentFieldAction';
import { rebaseOptionalPrayerTags } from './documentTagMembership';
import { prepareAtomicDomainCommand } from './domainPolicy';
import { rebaseQueuedExegeticalPoint } from './exegeticalPointCapture';
import { writeField } from './fieldValues';
import { groupFlowCopySources, groupFlowRetirementSources } from './groupFlowTopology';
import { GROUP_MEETING_FIELDS, meetingFieldTarget, replacedMeetingField } from './groupMeetingFieldAction';
import { mergeGroupFlowRebase, projectGroupStepOnDocument } from './groupStepPlacement';
import { projectCapturedMembership, seriesCommandParticipant } from './membershipIntent';
import { mergeOutlineAfterAcknowledgement } from './outlinePlacementRepair';
import { outlinePlacementField } from './outlinePlacementResource';
import { projectResourceOutlinePoint } from './outlinePointPlacement';
import { isCapturedPreachDateFieldConflict, preachDateRebaseChoices, retainAuthoredChurch } from './preachDateFieldAction';
import { alignImplicitPreachStatuses, isCapturedPreachStatusConflict, replacedPreachStatusRows, retainPreachStatusIntent } from './preachStatusAction';
import { equalValues, mergeDocumentAfterAcknowledgement, mergeDocumentFields, MAX_RELATION_RESOURCES } from './protocol';
import { isCapturedRowConflict } from './rowFieldAction';
import { isCapturedAutosaveRowFieldConflict, retainQueuedThoughtPlacements } from './rowFieldAutosave';
import { rebaseSermonChurchFill } from './sermonChurchFill';
import { SERVICE_ORDER_FLAG_TARGET, SERVICE_ORDER_STEP_TITLE_TARGET } from './serviceOrderStepAction';
import { placementSteps } from './serviceOrderStepPlacement';
import { coversCommittedEffect } from './snapshotFreshness';
import { sourceNoteQueueRebase } from './sourceNoteLinkCapture';
import { captureStudyNoteReferenceChange, hasStudyNoteReferenceReview } from './studyNoteReferenceMerge';

import type { CommitRequest, CommitStore, TrackCommitAnswer } from './commits';
import type { DataEngineRuntime } from './runtime';
import type { CommandResult, DocumentData, EngineMetadata, JournalEntry, ResourceRef, ResourceSnapshot } from './types';
import type { SermonOutline } from '@/models/models';

export interface AtomicCommitIdentity { id: string; participants: string[]; kind?: 'create-member' | 'council-carry' | 'analysis-reshape' }
const sameResource = (a: ResourceRef, b: ResourceRef) => a.collection === b.collection && a.id === b.id;

/** Actions whose existing document editors can follow the complete saved effect. */
export function isLiveWholeAction(request: CommitRequest): boolean {
  return request.atomic?.kind === 'council-carry' || request.atomic?.kind === 'analysis-reshape';
}

/** These ordinary Saves lose their queue dependency, but their authored words remain. */
export function isRetiredActionDependent(request: CommitRequest): boolean {
  const collection = request.baseline.resource.collection;
  return Boolean(request.cancelledByAction && !request.atomic && !request.transferredTo
    && (collection === 'councils' || collection === 'studyNotes'));
}

/** Project only whole-action cancellations newest first, while each held predecessor can
 * still supply its authored words. Delivery and other results retain their original order. */
export function orderActionProjections(requests: readonly CommitRequest[]): readonly CommitRequest[] {
  const rollback = (request: CommitRequest) => request.state === 'cancelled' && request.cancelledByAction
    && (isLiveWholeAction(request) || isRetiredActionDependent(request));
  const cancelled = requests.filter(rollback);
  if (cancelled.length < 2) return requests;
  let next = cancelled.length;
  return requests.map(request => rollback(request) ? cancelled[--next] : request);
}

/** The same predecessor rebase is used for ordinary and atomic saved intent. */
/** Carry the legacy marker across consecutive acknowledgements from this editor. */
function legacyPlacementField(collection: string) {
  if (collection === 'groups') return 'groupFlowPlacementLegacyRevision';
  if (collection === 'councils') return 'councilTopicPlacementLegacyRevision';
  if (outlinePlacementField(collection)) return 'outlinePointPlacementLegacyRevision';
}

function legacyPlacementObservedRevision(record: CommitRequest, predecessor: CommitRequest, snapshot: ResourceSnapshot,
  field: NonNullable<ReturnType<typeof legacyPlacementField>>): number | undefined {
  const head = snapshot.metadata, answer = predecessor.result;
  const effect = answer?.kind === 'acknowledged' ? answer.committed ?? answer.snapshot.metadata : null;
  if (!record.baseline.value || record.baseline.metadata !== null
    || predecessor.editorId !== record.editorId || predecessor.owner !== record.owner
    || !equalValues(predecessor.baseline.resource, record.baseline.resource)
    || !head || effect?.generation !== head.generation || effect.revision !== head.revision
    || effect.operationId !== (predecessor.command?.operationId ?? predecessor.id)) return undefined;
  if (head.revision === 1) return predecessor.baseline.value && !predecessor.baseline.metadata ? 1 : undefined;
  const earlier = predecessor[field];
  if (earlier === head.revision - 1 && predecessor.working.metadata?.generation === head.generation) return head.revision;
}

/** Advance only past this editor's exact receipt introducing one of the shown point IDs. */
function templatePlacementBirthRevision(record: CommitRequest, predecessor: CommitRequest, snapshot: ResourceSnapshot): number | undefined {
  const move = record.outlinePointPlacement, head = snapshot.metadata, prior = predecessor.baseline.metadata;
  if (!move || snapshot.resource.collection !== 'planTemplates' || predecessor.outlinePointPlacement
    || predecessor.editorId !== record.editorId || predecessor.owner !== record.owner || !head || !prior
    || prior.generation !== move.generation || prior.revision !== move.placement.observedRevision
    || head.generation !== prior.generation || head.revision !== prior.revision + 1
    || head.operationId !== (predecessor.command?.operationId ?? predecessor.id)
    || !hasOutlinePointOrder(predecessor.value?.structure, move.before) || !hasOutlinePointOrder(snapshot.value?.structure, move.before)) return undefined;
  const opening = predecessor.baseline.value?.structure as unknown as SermonOutline | undefined;
  if (!opening) return undefined;
  const ids = new Set(SECTION_KEYS.flatMap(section => (opening[section] ?? []).map(row => row.id)));
  const { pointId, destination } = move.placement;
  return [pointId, destination.previous, destination.next].some(id => id !== null && !ids.has(id)) ? head.revision : undefined;
}

export function initializeCommit(record: CommitRequest, records: readonly CommitRequest[]): CommitRequest | null {
  if (record.removalLineage) return initializePendingRemoval(record, records);
  const predecessor = record.predecessor && records.find(candidate => candidate.id === record.predecessor);
  if (predecessor && isRemovalAfterStandaloneCreation(record)
    && !['queued', 'prepared'].includes(predecessor.state)
    && !(followsStandaloneCreation(record, predecessor) && provesStandaloneCreation(predecessor))) {
    return { ...record, initialized: true, state: 'refused',
      result: { kind: 'refused', operationId: record.id, code: 'decision-changed' } };
  }
  if (record.predecessor && (!predecessor || predecessor.state !== 'acknowledged')) return null;
  if (predecessor && predecessor.result?.kind === 'acknowledged') {
    const snapshot = predecessor.result.snapshot;
    const field = legacyPlacementField(record.baseline.resource.collection);
    const legacyRevision = field && legacyPlacementObservedRevision(record, predecessor, snapshot, field);
    const legacyLineage = field && legacyRevision ? { [field]: legacyRevision } : {};
    if (record.serviceOrderPlacement && snapshot.value) {
      if ((snapshot.metadata?.generation ?? null) !== record.serviceOrderPlacement.generation) {
        return { ...record, initialized: true, state: 'refused', result: { kind: 'refused', operationId: record.id, code: 'generation-mismatch' } };
      }
      return { ...record, initialized: true, working: snapshot,
        intended: { ...snapshot.value, rank: record.serviceOrderPlacement.rank } };
    }
    if (record.serviceOrderStepPlacement && snapshot.value) {
      const move = record.serviceOrderStepPlacement;
      if (move.generation !== null && snapshot.metadata?.generation !== move.generation) {
        return { ...record, initialized: true, state: 'refused', result: { kind: 'refused', operationId: record.id, code: 'generation-mismatch' } };
      }
      const steps = placementSteps(snapshot.value.steps);
      const projected = steps && projectServiceOrderStep(steps, move.placement.stepId, move.placement.destination);
      return { ...record, initialized: true, working: snapshot,
        intended: projected ? { ...snapshot.value, steps: projected } : snapshot.value };
    }
    if (record.councilTopicPlacement && snapshot.value) {
      const move = record.councilTopicPlacement;
      if (move.generation !== null && snapshot.metadata?.generation !== move.generation) {
        return { ...record, initialized: true, state: 'refused', result: { kind: 'refused', operationId: record.id, code: 'generation-mismatch' } };
      }
      return { ...record, initialized: true, working: snapshot, ...legacyLineage, intended: projectCouncilTopicOnDocument(snapshot.value, move) };
    }
    if (record.groupFlowStepPlacement && snapshot.value) {
      const move = record.groupFlowStepPlacement;
      if (move.generation !== null && snapshot.metadata?.generation !== move.generation) {
        return { ...record, initialized: true, state: 'refused', result: { kind: 'refused', operationId: record.id, code: 'generation-mismatch' } };
      }
      return { ...record, initialized: true, working: snapshot, ...legacyLineage, intended: projectGroupStepOnDocument(snapshot.value, move) };
    }
    if (record.outlinePointPlacement && snapshot.value) {
      const move = record.outlinePointPlacement;
      if (move.generation !== null && snapshot.metadata?.generation !== move.generation) {
        return { ...record, initialized: true, state: 'refused', result: { kind: 'refused', operationId: record.id, code: 'generation-mismatch' } };
      }
      const birthRevision = templatePlacementBirthRevision(record, predecessor, snapshot);
      return { ...record, initialized: true, working: snapshot, ...legacyLineage,
        ...(birthRevision && { outlinePointPlacementBirthRevision: birthRevision }),
        intended: projectResourceOutlinePoint(snapshot.resource.collection, snapshot.value, move) ?? snapshot.value };
    }
    if (record.seriesMembership && record.value && predecessor.value && snapshot.value) {
      if (record.baseline.metadata && snapshot.metadata?.generation !== record.baseline.metadata.generation) {
        return { ...record, initialized: true, state: 'refused', result: { kind: 'refused', operationId: record.id, code: 'generation-mismatch' } };
      }
      const { items, sermonIds } = predecessor.value;
      const opening: DocumentData = {};
      if (items !== undefined) opening.items = items;
      if (sermonIds !== undefined) opening.sermonIds = sermonIds;
      const operationId = record.seriesMembership.reorder
        ? predecessor.command?.operationId ?? predecessor.id
        : predecessor.result.committed?.operationId ?? snapshot.metadata?.operationId;
      return { ...record, initialized: true, working: snapshot, intended: projectCapturedMembership(snapshot.value, record.value, record.seriesMembership, opening),
        seriesMembershipOpening: opening,
        ...(operationId && { seriesMembershipPredecessor: operationId }) };
    }
    if (record.atomic?.kind === 'analysis-reshape' && !sameAnalysisFrame(predecessor.value, snapshot.value)) {
      return { ...record, initialized: true, state: 'refused', result: { kind: 'refused', operationId: record.id, code: 'resolve-version-first' } };
    }
    const markAncestor = rebaseBibleMarkAncestor(predecessor.value, snapshot, record.baseline, record.bibleMarkStroke);
    const projectedAncestor = markAncestor ?? pendingDocumentFieldAncestor(record, predecessor.value, snapshot);
    const ancestor = record.commentTextOpening && projectedAncestor
      ? writeField(projectedAncestor, ['content'], record.commentTextOpening) : projectedAncestor;
    const sameGeneration = snapshot.metadata?.generation === record.baseline.metadata?.generation;
    if (sameGeneration && record.outlineSubpointMoves?.length && ancestor && record.value && snapshot.value
      && outlinePlacementField(snapshot.resource.collection)) {
      // The prior ACK may already show the desired placement through a different
      // gesture. Preserve the actual authored frames for the server's comparison.
      const predecessorId = predecessor.result.committed?.operationId ?? predecessor.result.operationId;
      const last = new Map(predecessor.outlineSubpointMoves?.map(move => [move.subPointId, move.destination]));
      const following = record.outlineSubpointMoves.filter(move => equalValues(last.get(move.subPointId), move.opening))
        .map(move => move.subPointId);
      return { ...record, initialized: true, working: { ...snapshot, value: ancestor }, intended: record.value,
        ...(following.length && { outlineSubpointPredecessor: { operationId: predecessorId, childIds: following } }) };
    }
    const preachingChoices = sameGeneration ? preachDateRebaseChoices(snapshot, ancestor, record.preachDateFieldActions) : [];
    const replacement = GROUP_MEETING_FIELDS.flatMap(field => {
      const action = record.groupMeetingFieldActions?.[field];
      return (action && replacedMeetingField(snapshot, field, action)) || [];
    });
    const statusChoices = sameGeneration ? replacedPreachStatusRows(snapshot, record.preachStatusActions) : [];
    const scopedChoices = [...replacement, ...preachingChoices, ...statusChoices];
    if (scopedChoices.length) return { ...record, initialized: true, state: 'conflict',
      result: { kind: 'conflict', operationId: record.id, snapshot, conflicts: scopedChoices } };
    const churchFill = sameGeneration ? record.sermonChurchFill : undefined;
    // Keep a new row's original inferred value on the wire. Only the server
    // transaction knows which sermon church is current when the row is saved.
    const authoredDates = churchFill ? rebaseSermonChurchFill(predecessor.value?.preachDates, record.value?.preachDates, snapshot.value?.preachDates,
      { exists: true, value: churchFill.church }, churchFill) : record.value?.preachDates;
    const dates = sameGeneration ? alignImplicitPreachStatuses(ancestor?.preachDates, authoredDates,
      snapshot.value?.preachDates, record.preachStatusActions) : undefined;
    const authored = record.value && dates !== undefined && dates !== record.value.preachDates ? { ...record.value, preachDates: dates } : record.value;
    const outline = sameGeneration && ancestor && authored && record.baseline.resource.collection === 'sermons'
      && !equalValues(ancestor.outline, authored.outline) ? mergeOutlineAfterAcknowledgement({
        protocol: 1, kind: 'update', owner: record.owner, resource: record.baseline.resource, operationId: record.id,
        generation: record.baseline.metadata?.generation ?? null, dependsOn: [],
        thoughtPlacementActions: record.thoughtPlacementActions,
      }, ancestor, authored, snapshot) : undefined;
    const sourceNotes = sourceNoteQueueRebase(snapshot, record.sourceNoteLink);
    const group = record.baseline.resource.collection === 'groups' && sameGeneration;
    const groupCopies = group && ancestor && authored ? groupFlowCopySources(ancestor, authored) : [];
    const groupRetirements = group && ancestor && authored ? groupFlowRetirementSources(ancestor, authored) : [];
    const ordinary = outline ?? (group ? mergeGroupFlowRebase(ancestor, authored, snapshot.value, groupCopies)
      : rebaseOptionalPrayerTags(record.baseline.resource.collection, ancestor, authored, snapshot.value,
        sameGeneration && snapshot.metadata?.studyNoteReferenceAliases?.length
          ? mergeDocumentAfterAcknowledgement(ancestor, authored, snapshot)
          : mergeDocumentFields(sourceNotes ? sourceNotes.align(ancestor) : ancestor, sourceNotes ? sourceNotes.align(authored) : authored, snapshot.value)));
    const exegetical = !outline && sameGeneration && ordinary.conflicts.some(({ path }) =>
      path.length === 2 && path[0] === 'preparation' && path[1] === 'exegeticalPlan')
      ? rebaseQueuedExegeticalPoint(ancestor, authored, snapshot.value, record.exegeticalPlanActions) : undefined;
    const rebased = exegetical?.rebased ?? ordinary;
    const target = datedRowTarget(record.baseline.resource.collection);
    const action = target && record[target.evidence];
    const isDateConflict = (conflict: typeof rebased.conflicts[number]) => target && action && isCapturedDateConflict(conflict, action, target);
    const combined = rebased.value.exists ? rebased.value.value as DocumentData : null;
    const merged = sameGeneration ? retainQueuedThoughtPlacements(combined, ancestor, authored, snapshot.value, record.thoughtPlacementActions) : combined;
    if (sameGeneration && record.baseline.resource.collection === 'councils' && !equalValues(predecessor.value?.topics, record.value?.topics)) {
      const code = councilTopicConflictCode(rebased.conflicts)
        ?? councilTopicTransitionRefusal(predecessor.value?.topics, record.value?.topics, snapshot.value?.topics, merged?.topics);
      if (code) return { ...record, initialized: true, state: 'refused', result: { kind: 'refused', operationId: record.id, code } };
    }
    const church = sameGeneration ? retainAuthoredChurch(merged, snapshot, record.preachDateFieldActions) : merged;
    const withPreachStatus = sameGeneration ? retainPreachStatusIntent(church, snapshot, record.preachStatusActions) : church;
    const intended = sourceNotes ? sourceNotes.restore(withPreachStatus) : withPreachStatus;
    const flag = record.preachStatusActions?.length ? explicitPreachedFlag(intended?.preachDates, false) : undefined;
    const stepFlag = record.serviceOrderFlagActions?.flagged;
    const stepTitle = record.serviceOrderStepTitleActions?.title;
    const assembly = record.councilAssemblyActions?.forAssembly;
    const topicKind = record.councilTopicKindActions?.kind;
    const timedReference = sameGeneration && Boolean(record.studyNoteReferenceEvidence) && hasStudyNoteReferenceReview(rebased.conflicts);
    const canOrder = sameGeneration && rebased.conflicts.every(conflict => isDateConflict(conflict)
      || (timedReference && conflict.path[0] === 'scriptureRefs')
      || (record.studyNoteContentAction && conflict.path.length === 1 && conflict.path[0] === 'content'
        && equalValues(conflict.mine, record.studyNoteContentAction.after))
      || (record.groupFirstMeetingChange && conflict.path[0] === 'meetingDates')
      || isCapturedPreachStatusConflict(conflict, record.preachStatusActions)
      || (flag !== undefined && conflict.path.length === 1 && conflict.path[0] === 'isPreached')
      || isCapturedPreachDateFieldConflict(conflict, record.preachDateFieldActions)
      || (stepFlag && isCapturedRowConflict(conflict, stepFlag, SERVICE_ORDER_FLAG_TARGET))
      || (stepTitle && isCapturedRowConflict(conflict, stepTitle, SERVICE_ORDER_STEP_TITLE_TARGET))
      || (assembly && isCapturedRowConflict(conflict, assembly, COUNCIL_ASSEMBLY))
      || (topicKind && isCapturedRowConflict(conflict, topicKind, COUNCIL_TOPIC_KIND))
      || isCapturedAutosaveRowFieldConflict(conflict, record)
      || GROUP_MEETING_FIELDS.some(field => {
        const meeting = record.groupMeetingFieldActions?.[field];
        return meeting && isCapturedRowConflict(conflict, meeting, meetingFieldTarget(field));
      }));
    const deferDate = sameGeneration && rebased.conflicts.some(isDateConflict);
    if (rebased.conflicts.length && !canOrder) return { ...record, initialized: true, state: 'conflict', result: { kind: 'conflict', operationId: record.id, snapshot, conflicts: rebased.conflicts } };
    // The preceding ACK can carry another device's references or date. The server
    // needs the actual opening for the exact field the person touched.
    const studyNoteReferenceChange = sameGeneration && snapshot.resource.collection === 'studyNotes'
      ? captureStudyNoteReferenceChange(ancestor, authored) : undefined;
    return { ...record, initialized: true, working: snapshot, ...legacyLineage,
      ...(studyNoteReferenceChange && { studyNoteReferenceChange }),
      intended: intended && flag !== undefined ? { ...intended, isPreached: flag } : intended,
      ...(exegetical && { exegeticalQueueBasis: exegetical.basis }),
      ...(groupCopies.length && { rebasedGroupCopySources: groupCopies }),
      ...(groupRetirements.length && { rebasedGroupRetirements: groupRetirements }),
      ...(deferDate && { deferPreachDateRebase: true }), ...(markAncestor && { deferBibleMarkRebase: true }) };
  }
  return { ...record, initialized: true };
}

/** Atomic participants share ownership, never a second transport or journal. */
export function atomicParticipants(record: CommitRequest, records: readonly CommitRequest[]): CommitRequest[] {
  const identity = record.atomic;
  if (!identity) return [record];
  const participants = identity.participants.map(id => records.find(candidate => candidate.id === id));
  if (identity.participants.length < 2 || identity.participants.length > MAX_RELATION_RESOURCES || identity.id !== identity.participants[0]
    || new Set(identity.participants).size !== identity.participants.length || !identity.participants.includes(record.id)
    || participants.some(candidate => !candidate || candidate.owner !== record.owner || !equalValues(candidate.atomic, identity))) {
    throw new Error('Incomplete atomic commit ownership');
  }
  return participants as CommitRequest[];
}

function failureFor(record: CommitRequest, result: CommandResult): CommandResult {
  if (result.kind === 'refused') return { ...result, operationId: record.id };
  // A relation conflict describes the primary resource, with participant-prefixed
  // paths. Never attach that snapshot or those paths to an unrelated editor.
  if (result.kind === 'conflict' && sameResource(result.snapshot.resource, record.baseline.resource)) {
    const conflicts = result.conflicts.filter(conflict => conflict.path[0] === record.baseline.resource.id)
      .map(conflict => ({ ...conflict, path: conflict.path.slice(1) }));
    if (conflicts.length) return { ...result, operationId: record.id, conflicts };
  }
  return { kind: 'refused', operationId: record.id, code: result.kind === 'deleted' ? 'referenced-document-deleted' : 'atomic-operation-conflict' };
}

export interface AtomicCommitContext {
  store: CommitStore;
  runtime: DataEngineRuntime;
  readConfirmed: (resource: ResourceRef) => Promise<ResourceSnapshot>;
  readCommitted?: (resource: ResourceRef, proof: EngineMetadata) => Promise<ResourceSnapshot>;
  assertCurrent: () => void;
  emit: (request: CommitRequest) => void;
  trackAnswer?: TrackCommitAnswer;
}

/** Called only by CommitQueue. Every state transition wins CAS for all participants. */
export async function advanceAtomicCommit(participants: CommitRequest[], records: readonly CommitRequest[], context: AtomicCommitContext): Promise<boolean> {
  const primary = participants[0];
  const commit = async (next: CommitRequest[]) => {
    context.assertCurrent();
    if (!context.store.compareAndSetBatch) throw new Error('Atomic commit storage is required');
    const saved = await context.store.compareAndSetBatch(next.map((record, index) => ({ previous: participants[index], next: record })));
    context.assertCurrent(); saved.forEach(context.emit); return true;
  };
  if (participants.some(record => record.unfinalized.length)) {
    await retireCommitJournal(participants, context.runtime, context.assertCurrent);
    return commit(participants.map(record => ({ ...record, unfinalized: [] })));
  }
  if (participants.some(record => !record.initialized)) {
    if (participants.some(record => !record.initialized && record.predecessor && records.some(previous => previous.id === record.predecessor
      && ['conflict', 'refused', 'cancelled'].includes(previous.state)))) {
      return commit(participants.map(record => ({ ...record, state: 'refused', result: { kind: 'refused', operationId: record.id, code: 'atomic-predecessor-conflict' } })));
    }
    const initialized = participants.map(record => record.initialized ? record : initializeCommit(record, records));
    if (initialized.some(record => !record)) return false;
    const ready = initialized as CommitRequest[];
    const failed = ready.find(record => ['conflict', 'refused'].includes(record.state));
    return commit(failed ? ready.map(record => record === failed ? record : { ...record, state: 'refused',
      result: { kind: 'refused', operationId: record.id, code: 'atomic-predecessor-conflict' } }) : ready);
  }
  if (!primary.command) {
    let command;
    try {
      command = prepareAtomicDomainCommand(primary.owner, primary.id, participants.map(seriesCommandParticipant));
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (typeof code !== 'string') throw error;
      return commit(participants.map(record => ({ ...record, state: 'refused', result: { kind: 'refused', operationId: record.id, code } })));
    }
    return commit(participants.map(record => ({ ...record, command: record.id === primary.id ? command : null, submitted: record.intended, state: 'prepared' })));
  }
  const journal = await context.runtime.list(); context.assertCurrent();
  const entry = journal.find(item => item.command.operationId === primary.command!.operationId);
  const apply = (result: CommandResult) => applyAtomicAnswer(participants, result, context, commit);
  if (!entry?.result || !['acknowledged', 'conflict', 'refused'].includes(entry.state)) {
    await context.runtime.submit(primary.command); context.assertCurrent();
    context.trackAnswer?.(primary, apply);
    return false;
  }
  return apply(entry.result);
}

async function applyAtomicAnswer(participants: CommitRequest[], result: CommandResult, context: AtomicCommitContext,
  commit: (next: CommitRequest[]) => Promise<boolean>): Promise<boolean> {
  const primary = participants[0];
  if (result.kind !== 'acknowledged') return commit(participants.map(record => {
    const projected = failureFor(record, result);
    return { ...record, state: projected.kind === 'conflict' ? 'conflict' : 'refused', result: projected };
  }));
  // A proved series move can discover an old destination in the transaction.
  // Retain its acknowledgement on the root until the engine caches that effect.
  const additional = primary.seriesMembership ? result.affected?.filter(effect =>
    !participants.some(record => sameResource(effect.resource, record.baseline.resource))) : undefined;
  const related = additional?.length ? result.relatedSnapshots?.filter(snapshot => additional.some(effect => sameResource(effect.resource, snapshot.resource))) : undefined;
  const accepted = await Promise.all(participants.map(async record => {
    const resource = record.baseline.resource;
    const main = sameResource(resource, result.snapshot.resource);
    const proof = main ? result.committed ?? result.snapshot.metadata : result.affected?.find(effect => sameResource(effect.resource, resource))?.metadata;
    let snapshot = main ? result.snapshot : result.relatedSnapshots?.find(candidate => sameResource(candidate.resource, resource));
    if (!proof || proof.operationId !== primary.command!.operationId) throw new Error('Atomic acknowledgement is missing participant proof');
    if (!snapshot) snapshot = await (context.readCommitted ? context.readCommitted(resource, proof) : context.readConfirmed(resource));
    context.assertCurrent();
    if (!coversCommittedEffect(snapshot, resource, proof) || (snapshot.value && snapshot.value.userId !== primary.owner)) {
      throw new Error('Atomic acknowledgement does not prove participant content');
    }
    // Atomic captures own only their action fields. Server merge output,
    // including fields changed by another device, is the confirmed participant.
    return { ...record, working: snapshot, intended: snapshot.value, command: null, submitted: null,
      sequence: record.sequence + 1, state: 'acknowledged' as const,
      result: { kind: 'acknowledged' as const, operationId: record.id, snapshot, committed: proof,
        ...(main && additional?.length && { affected: additional, ...(related?.length && { relatedSnapshots: related }) }) },
      unfinalized: [primary.command!.operationId] };
  }));
  return commit(accepted);
}


/** Replacing failed intent retires its whole relation and dependent local chain. */
export function cancellationScope(records: readonly CommitRequest[], editorId: string, additionalIds: readonly string[], includeCancelled = false): CommitRequest[] {
  const selected = new Set(records.filter(record => record.editorId === editorId || additionalIds.includes(record.id)).map(record => record.id));
  let added: boolean;
  do {
    added = false;
    for (const record of records) if (selected.has(record.id) || (record.predecessor && selected.has(record.predecessor))) {
      for (const participant of atomicParticipants(record, records)) if (!selected.has(participant.id)) { selected.add(participant.id); added = true; }
    }
  } while (added);
  return records.filter(record => selected.has(record.id) && record.state !== 'acknowledged' && (includeCancelled || record.state !== 'cancelled'));
}

/** Shared by the authoritative queue guard and the action's presentation. */
export function canCancelSavedIntent(records: readonly CommitRequest[], journal: readonly JournalEntry[]): boolean {
  const unsafe = records.some(record => record.command && !['conflict', 'refused'].includes(record.state)
    && !journal.some(entry => entry.command.operationId === record.command!.operationId && ['conflict', 'refused'].includes(entry.state)));
  return !unsafe && records.some(record => ['conflict', 'refused'].includes(record.state));
}

export async function cancelActionCommits(records: readonly CommitRequest[], roots: readonly string[], context: AtomicCommitContext): Promise<void> {
  if (!records.length) return;
  if (!context.store.compareAndSetBatch) throw new Error('Atomic commit storage is required');
  // Recheck the full dependency scope in the transaction before retiring the action and its dependents.
  const saved = await context.store.compareAndSetBatch(records.map(previous => ({
    previous, next: { ...previous, state: 'cancelled', cancelledByAction: true, unfinalized: pendingCommitRetirement(previous) },
  })), roots);
  context.assertCurrent(); orderActionProjections(saved).forEach(context.emit);
}
