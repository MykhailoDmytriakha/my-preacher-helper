import { prepareAtomicSeriesCommand } from './domainPolicy';
import { equalValues, mergeDocumentFields, MAX_RELATION_RESOURCES } from './protocol';
import { coversCommittedEffect } from './snapshotFreshness';

import type { CommitRequest, CommitStore } from './commits';
import type { DataEngineRuntime } from './runtime';
import type { CommandResult, DocumentData, EngineMetadata, JournalEntry, ResourceRef, ResourceSnapshot } from './types';

export interface AtomicCommitIdentity { id: string; participants: string[]; kind?: 'create-member' }
const sameResource = (a: ResourceRef, b: ResourceRef) => a.collection === b.collection && a.id === b.id;

/** The same predecessor rebase is used for ordinary and atomic saved intent. */
export function initializeCommit(record: CommitRequest, records: readonly CommitRequest[]): CommitRequest | null {
  const predecessor = record.predecessor && records.find(candidate => candidate.id === record.predecessor);
  if (record.predecessor && (!predecessor || predecessor.state !== 'acknowledged')) return null;
  if (predecessor && predecessor.result?.kind === 'acknowledged') {
    const snapshot = predecessor.result.snapshot;
    const rebased = mergeDocumentFields(predecessor.value, record.value, snapshot.value);
    if (rebased.conflicts.length) return { ...record, initialized: true, state: 'conflict', result: { kind: 'conflict', operationId: record.id, snapshot, conflicts: rebased.conflicts } };
    return { ...record, initialized: true, working: snapshot, intended: rebased.value.exists ? rebased.value.value as DocumentData : null };
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
    for (const id of new Set(participants.flatMap(record => record.unfinalized))) {
      await context.runtime.finalize(id); context.assertCurrent();
    }
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
    const failed = ready.find(record => record.state === 'conflict');
    return commit(failed ? ready.map(record => record === failed ? record : { ...record, state: 'refused',
      result: { kind: 'refused', operationId: record.id, code: 'atomic-predecessor-conflict' } }) : ready);
  }
  if (!primary.command) {
    let command;
    try {
      command = prepareAtomicSeriesCommand(primary.owner, primary.id, participants.map(record => ({ confirmed: record.working, draft: record.intended })));
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (typeof code !== 'string') throw error;
      return commit(participants.map(record => ({ ...record, state: 'refused', result: { kind: 'refused', operationId: record.id, code } })));
    }
    return commit(participants.map(record => ({ ...record, command: record.id === primary.id ? command : null, submitted: record.intended, state: 'prepared' })));
  }
  const journal = await context.runtime.list(); context.assertCurrent();
  const entry = journal.find(item => item.command.operationId === primary.command!.operationId);
  if (!entry?.result || !['acknowledged', 'conflict', 'refused'].includes(entry.state)) {
    await context.runtime.submit(primary.command); context.assertCurrent(); return false;
  }
  const result = entry.result;
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
    // Membership-only captures have no unsent sibling fields. Server merge output,
    // including fields changed by another device, is the confirmed participant.
    return { ...record, working: snapshot, intended: snapshot.value, command: null, submitted: null,
      sequence: record.sequence + 1, state: 'acknowledged' as const,
      result: { kind: 'acknowledged' as const, operationId: record.id, snapshot, committed: proof },
      unfinalized: [primary.command!.operationId] };
  }));
  return commit(accepted);
}


/** Replacing failed intent retires its whole relation and dependent local chain. */
export function cancellationScope(records: readonly CommitRequest[], editorId: string, additionalIds: readonly string[]): CommitRequest[] {
  const selected = new Set(records.filter(record => record.editorId === editorId || additionalIds.includes(record.id)).map(record => record.id));
  let added: boolean;
  do {
    added = false;
    for (const record of records) if (selected.has(record.id) || (record.predecessor && selected.has(record.predecessor))) {
      for (const participant of atomicParticipants(record, records)) if (!selected.has(participant.id)) { selected.add(participant.id); added = true; }
    }
  } while (added);
  return records.filter(record => selected.has(record.id) && record.state !== 'acknowledged' && record.state !== 'cancelled');
}

/** Shared by the authoritative queue guard and the action's presentation. */
export function canCancelSavedIntent(records: readonly CommitRequest[], journal: readonly JournalEntry[]): boolean {
  const unsafe = records.some(record => record.command && !['conflict', 'refused'].includes(record.state)
    && !journal.some(entry => entry.command.operationId === record.command!.operationId && ['conflict', 'refused'].includes(entry.state)));
  return !unsafe && records.some(record => ['conflict', 'refused'].includes(record.state));
}

export async function cancelActionCommits(records: readonly CommitRequest[], context: AtomicCommitContext): Promise<void> {
  if (!records.length) return;
  if (!context.store.compareAndSetBatch) throw new Error('Atomic commit storage is required');
  for (const id of new Set(records.flatMap(record => record.command ? [record.command.operationId] : []))) {
    await context.runtime.discard(id); context.assertCurrent();
  }
  // Dependents and every participant retire together, even across several moves.
  const saved = await context.store.compareAndSetBatch(records.map(previous => ({ previous, next: { ...previous, state: 'cancelled' as const, cancelledByAction: true } })));
  context.assertCurrent(); saved.forEach(context.emit);
}
