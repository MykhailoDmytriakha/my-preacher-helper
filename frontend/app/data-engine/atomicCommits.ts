import { explicitPreachedFlag } from '@/utils/preachDateStatus';

import { sameAnalysisFrame } from './analysisReshapeFields';
import { rebaseBibleMarkAncestor } from './bibleMarkStroke';
import { pendingCommitRetirement, retireCommitJournal } from './commitJournal';
import { COUNCIL_TOPIC_TITLE } from './councilTopicTitleAction';
import { datedRowTarget, isCapturedDateConflict } from './datedRowAction';
import { pendingDocumentFieldAncestor } from './documentFieldAction';
import { prepareAtomicDomainCommand } from './domainPolicy';
import { GROUP_MEETING_FIELDS, meetingFieldTarget, replacedMeetingField } from './groupMeetingFieldAction';
import { isCapturedPreachDateFieldConflict, preachDateRebaseChoices, retainAuthoredChurch } from './preachDateFieldAction';
import { alignImplicitPreachStatuses, isCapturedPreachStatusConflict, replacedPreachStatusRows, retainPreachStatusIntent } from './preachStatusAction';
import { equalValues, mergeDocumentFields, MAX_RELATION_RESOURCES } from './protocol';
import { isCapturedRowConflict } from './rowFieldAction';
import { rebaseSermonChurchFill } from './sermonChurchFill';
import { SERVICE_ORDER_FLAG_TARGET, SERVICE_ORDER_STEP_TITLE_TARGET } from './serviceOrderStepAction';
import { coversCommittedEffect } from './snapshotFreshness';

import type { CommitRequest, CommitStore, TrackCommitAnswer } from './commits';
import type { DataEngineRuntime } from './runtime';
import type { CommandResult, DocumentData, EngineMetadata, JournalEntry, ResourceRef, ResourceSnapshot } from './types';

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
export function initializeCommit(record: CommitRequest, records: readonly CommitRequest[]): CommitRequest | null {
  const predecessor = record.predecessor && records.find(candidate => candidate.id === record.predecessor);
  if (record.predecessor && (!predecessor || predecessor.state !== 'acknowledged')) return null;
  if (predecessor && predecessor.result?.kind === 'acknowledged') {
    const snapshot = predecessor.result.snapshot;
    if (record.atomic?.kind === 'analysis-reshape' && !sameAnalysisFrame(predecessor.value, snapshot.value)) {
      return { ...record, initialized: true, state: 'refused', result: { kind: 'refused', operationId: record.id, code: 'resolve-version-first' } };
    }
    const markAncestor = rebaseBibleMarkAncestor(predecessor.value, snapshot, record.baseline, record.bibleMarkStroke);
    const ancestor = markAncestor ?? pendingDocumentFieldAncestor(record, predecessor.value, snapshot);
    const sameGeneration = snapshot.metadata?.generation === record.baseline.metadata?.generation;
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
    const rebased = mergeDocumentFields(ancestor, authored, snapshot.value);
    const target = datedRowTarget(record.baseline.resource.collection);
    const action = target && record[target.evidence];
    const isDateConflict = (conflict: typeof rebased.conflicts[number]) => target && action && isCapturedDateConflict(conflict, action, target);
    const merged = rebased.value.exists ? rebased.value.value as DocumentData : null;
    const church = sameGeneration ? retainAuthoredChurch(merged, snapshot, record.preachDateFieldActions) : merged;
    const intended = sameGeneration ? retainPreachStatusIntent(church, snapshot, record.preachStatusActions) : church;
    const flag = record.preachStatusActions?.length ? explicitPreachedFlag(intended?.preachDates, false) : undefined;
    const stepFlag = record.serviceOrderFlagActions?.flagged;
    const stepTitle = record.serviceOrderStepTitleActions?.title;
    const canOrder = sameGeneration && rebased.conflicts.every(conflict => isDateConflict(conflict)
      || isCapturedPreachStatusConflict(conflict, record.preachStatusActions)
      || (flag !== undefined && conflict.path.length === 1 && conflict.path[0] === 'isPreached')
      || isCapturedPreachDateFieldConflict(conflict, record.preachDateFieldActions)
      || (stepFlag && isCapturedRowConflict(conflict, stepFlag, SERVICE_ORDER_FLAG_TARGET))
      || (stepTitle && isCapturedRowConflict(conflict, stepTitle, SERVICE_ORDER_STEP_TITLE_TARGET))
      || record.councilTopicTitleActions?.some(title => isCapturedRowConflict(conflict, title, COUNCIL_TOPIC_TITLE))
      || GROUP_MEETING_FIELDS.some(field => {
        const meeting = record.groupMeetingFieldActions?.[field];
        return meeting && isCapturedRowConflict(conflict, meeting, meetingFieldTarget(field));
      }));
    const deferDate = sameGeneration && rebased.conflicts.some(isDateConflict);
    if (rebased.conflicts.length && !canOrder) return { ...record, initialized: true, state: 'conflict', result: { kind: 'conflict', operationId: record.id, snapshot, conflicts: rebased.conflicts } };
    // The preceding ACK can carry another device's date. Send the original ancestor
    // for this exact leaf so the server can order it or keep the ordinary choice.
    return { ...record, initialized: true, working: snapshot, intended: intended && flag !== undefined ? { ...intended, isPreached: flag } : intended,
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
      command = prepareAtomicDomainCommand(primary.owner, primary.id, participants.map(record => ({ confirmed: record.working, draft: record.intended })));
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
      result: { kind: 'acknowledged' as const, operationId: record.id, snapshot, committed: proof },
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
