import { prepareDomainCommand, requiredDomainTargets } from './domainPolicy';
import { equalValues, mergeDocumentFields } from './protocol';

import type { DataEngineRuntime } from './runtime';
import type { SessionCheckpoint } from './session';
import type { CommandResult, DataCommand, DocumentData, ResourceRef, ResourceSnapshot } from './types';

export interface CommitRequest {
  id: string;
  owner: string;
  editorId: string;
  editGeneration: number;
  baseline: ResourceSnapshot;
  value: DocumentData | null;
  predecessor: string | null;
  revision: number;
  initialized: boolean;
  working: ResourceSnapshot;
  intended: DocumentData | null;
  command: DataCommand | null;
  submitted: DocumentData | null;
  sequence: number;
  state: 'queued' | 'prepared' | 'acknowledged' | 'conflict' | 'refused' | 'cancelled';
  result: CommandResult | null;
  unfinalized: string[];
}

export interface CommitStore {
  list(owner: string): Promise<CommitRequest[]>;
  /** Atomically unique by owner/editor/generation. Repeats return the original request. */
  create(request: CommitRequest): Promise<CommitRequest>;
  /** Atomically compares revision, then increments it. A loser must reload. */
  compareAndSet(previous: CommitRequest, next: CommitRequest): Promise<CommitRequest>;
}

export interface CommitEvent { request: CommitRequest }
export function assertCommitCapture(current: CommitRequest, incoming: CommitRequest): void {
  if (current.owner !== incoming.owner || current.editorId !== incoming.editorId || current.editGeneration !== incoming.editGeneration
    || current.predecessor !== incoming.predecessor || !equalValues(current.baseline, incoming.baseline)
    || !equalValues(current.value, incoming.value)) throw new Error('Saved generation cannot change its captured intent');
}
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const terminal = (request: CommitRequest) => ['acknowledged', 'conflict', 'refused', 'cancelled'].includes(request.state);
const resourceMatches = (a: ResourceRef, b: ResourceRef) => a.collection === b.collection && a.id === b.id;
const orderRequests = (records: CommitRequest[]): CommitRequest[] => {
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

/** Saved intent lives independently of editors. Only this queue prepares its commands. */
export class CommitQueue {
  private owner: string | null = null;
  private generation = 0;
  private listeners = new Set<(event: CommitEvent) => void>();
  private running: Promise<void> | null = null;
  private runningGeneration = 0;
  private requested = false;
  private deliveryRequested = false;

  constructor(private readonly options: {
    store: CommitStore;
    runtime: DataEngineRuntime;
    operationId: () => string;
    readConfirmed: (resource: ResourceRef) => Promise<ResourceSnapshot>;
    canDeliver?: () => boolean;
  }) {}

  setOwner(owner: string | null): void {
    if (owner !== this.owner) { this.owner = owner; this.generation += 1; }
  }

  subscribe(listener: (event: CommitEvent) => void): () => void {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  }

  async list(): Promise<CommitRequest[]> {
    const owner = this.owner, generation = this.generation;
    if (!owner) return [];
    const records = await this.options.store.list(owner);
    return this.current(owner, generation) ? orderRequests(records) : [];
  }

  async save(editorId: string, captured: SessionCheckpoint, options?: { predecessorId?: string | null }): Promise<CommitRequest | null> {
    const owner = this.owner, generation = this.generation;
    if (!owner) throw new Error('Authentication required');
    const intent = clone(captured);
    const records = await this.options.store.list(owner);
    this.assertCurrent(owner, generation);
    const existing = records.find(record => record.editorId === editorId && record.editGeneration === intent.editGeneration);
    const predecessors = records.filter(record => record.editorId === editorId && record.state !== 'cancelled');
    const predecessor = options?.predecessorId === null ? undefined : options?.predecessorId
      ? records.find(record => record.id === options.predecessorId)
      : predecessors.sort((a, b) => b.editGeneration - a.editGeneration)[0];
    if (options?.predecessorId && (!predecessor || predecessor.owner !== owner || predecessor.state === 'cancelled'
      || !resourceMatches(predecessor.baseline.resource, intent.confirmed.resource))) throw new Error('Invalid predecessor request');
    if (existing) {
      if (intent.dirty && !equalValues(existing.value, intent.draft)) throw new Error('Saved generation cannot change its captured intent');
      return clone(existing);
    }
    if (!intent.dirty && (!predecessor || equalValues(predecessor.value, intent.draft))) return null;
    if (intent.conflicts.length) throw new Error('Resolve the conflict before saving');
    const baseline = clone(intent.confirmed);
    const record: CommitRequest = {
      id: this.options.operationId(), owner, editorId, editGeneration: intent.editGeneration,
      baseline, value: clone(intent.draft), predecessor: predecessor?.id ?? null,
      revision: 0, initialized: false, working: baseline, intended: clone(intent.draft),
      command: null, submitted: null, sequence: 0, state: 'queued', result: null, unfinalized: [],
    };
    const saved = await this.options.store.create(record);
    this.assertCurrent(owner, generation);
    this.emit(saved);
    this.requested = true;
    return clone(saved);
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
      const failures = new Map<string, unknown>();
      do {
        this.requested = false;
        const records = await this.options.store.list(owner);
        this.assertCurrent(owner, generation);
        const batch = await this.advanceBatch(records, owner, generation, failures, races);
        races = batch.races;
        let changed = batch.changed;
        if (this.deliveryRequested) {
          await this.options.runtime.drain(attempted, this.options.canDeliver ?? (() => true));
          this.assertCurrent(owner, generation);
          const journal = await this.options.runtime.list();
          if (journal.some(entry => records.some(record => !failures.has(record.id) && !terminal(record) && record.command?.operationId === entry.command.operationId)
            && ['acknowledged', 'conflict', 'refused'].includes(entry.state))) changed = true;
        }
        this.requested = this.requested || changed;
      } while (this.requested && this.current(owner, generation));
      if (failures.size) throw failures.values().next().value;
    };
    this.runningGeneration = generation;
    this.running = run();
    try { await this.running; } finally { this.running = null; if (!this.requested) this.deliveryRequested = false; }
  }

  /** A terminal failed chain has no unknown effects; retiring it is an explicit user choice. */
  async cancel(editorId: string, additionalRequestIds: readonly string[] = []): Promise<void> {
    const owner = this.owner, generation = this.generation;
    if (!owner) throw new Error('Authentication required');
    const records = (await this.options.store.list(owner)).filter(record => (record.editorId === editorId || additionalRequestIds.includes(record.id))
      && record.state !== 'acknowledged' && record.state !== 'cancelled');
    this.assertCurrent(owner, generation);
    const journal = await this.options.runtime.list();
    const unsafe = records.some(record => record.command && !['conflict', 'refused'].includes(record.state)
      && !journal.some(entry => entry.command.operationId === record.command!.operationId && ['conflict', 'refused'].includes(entry.state)));
    if (unsafe || !records.some(record => ['conflict', 'refused'].includes(record.state))) throw new Error('Resolve pending commands before replacing saved intent');
    for (const record of records) {
      if (record.command) await this.options.runtime.discard(record.command.operationId);
      this.assertCurrent(owner, generation);
      await this.options.store.compareAndSet(record, { ...record, state: 'cancelled' });
    }
  }

  private async advanceBatch(records: CommitRequest[], owner: string, generation: number, failures: Map<string, unknown>, races: number) {
    let changed = false;
    for (const record of records) {
      this.assertCurrent(owner, generation);
      if (failures.has(record.id)) continue;
      if (terminal(record) && !record.unfinalized.length) { this.emit(record); continue; }
      try { changed = await this.advance(record, records, owner, generation) || changed; }
      catch (error) {
        if ((error as { code?: string }).code === 'commit-changed' && ++races < 100) { changed = true; continue; }
        if (!this.current(owner, generation)) throw error;
        failures.set(record.id, error);
      }
    }
    return { changed, races };
  }

  private async advance(record: CommitRequest, records: CommitRequest[], owner: string, generation: number): Promise<boolean> {
    const commit = async (next: CommitRequest) => {
      this.assertCurrent(owner, generation);
      const updated = await this.options.store.compareAndSet(record, next);
      this.assertCurrent(owner, generation);
      this.emit(updated);
      return true;
    };
    if (record.unfinalized.length) {
      for (const id of record.unfinalized) {
        await this.options.runtime.finalize(id);
        this.assertCurrent(owner, generation);
      }
      return commit({ ...record, unfinalized: [] });
    }
    if (!record.initialized) return this.initialize(record, records, commit);
    if (record.command) return this.advanceCommand(record, owner, generation, commit);
    if (equalValues(record.working.value, record.intended)) return commit({ ...record, state: 'acknowledged', result: { kind: 'acknowledged', operationId: record.id, snapshot: record.working } });
    const targets = await Promise.all(requiredDomainTargets(record.working, record.intended).map(this.options.readConfirmed));
    this.assertCurrent(owner, generation);
    const operationId = record.sequence === 0 ? record.id : `${record.id}-${record.sequence}`;
    const prepared = prepareDomainCommand(owner, operationId, record.working, record.intended, targets);
    if (!resourceMatches(prepared.command.resource, record.baseline.resource)) throw new Error('Commit resource changed');
    return commit({ ...record, command: prepared.command, submitted: prepared.submittedValue, state: 'prepared' });
  }

  private async initialize(record: CommitRequest, records: CommitRequest[], commit: (next: CommitRequest) => Promise<boolean>): Promise<boolean> {
    const predecessor = record.predecessor && records.find(candidate => candidate.id === record.predecessor);
    if (record.predecessor && (!predecessor || predecessor.state !== 'acknowledged')) return false;
    if (predecessor && predecessor.result?.kind === 'acknowledged') {
      const snapshot = predecessor.result.snapshot;
      const rebased = mergeDocumentFields(predecessor.value, record.value, snapshot.value);
      if (rebased.conflicts.length) return commit({ ...record, initialized: true, state: 'conflict', result: { kind: 'conflict', operationId: record.id, snapshot, conflicts: rebased.conflicts } });
      return commit({ ...record, initialized: true, working: clone(snapshot), intended: rebased.value.exists ? rebased.value.value as DocumentData : null });
    }
    return commit({ ...record, initialized: true });
  }

  private async advanceCommand(record: CommitRequest, owner: string, generation: number, commit: (next: CommitRequest) => Promise<boolean>): Promise<boolean> {
    const journal = await this.options.runtime.list();
    this.assertCurrent(owner, generation);
    const entry = journal.find(item => item.command.operationId === record.command!.operationId);
    if (!entry || !entry.result || !['acknowledged', 'conflict', 'refused'].includes(entry.state)) {
      // The persisted command won CAS before any tab may submit it.
      await this.options.runtime.submit(record.command!);
      this.assertCurrent(owner, generation);
      return false;
    }
    const result = entry.result;
    if (result.kind !== 'acknowledged') return commit({ ...record, state: result.kind === 'refused' ? 'refused' : 'conflict', result: { ...result, operationId: record.id } });
    const rebased = mergeDocumentFields(record.submitted, record.intended, result.snapshot.value);
    if (rebased.conflicts.length) return commit({ ...record, state: 'conflict', result: { kind: 'conflict', operationId: record.id, snapshot: result.snapshot, conflicts: rebased.conflicts } });
    const intended = rebased.value.exists ? rebased.value.value as DocumentData : null;
    const complete = equalValues(intended, result.snapshot.value);
    // The durable request owns projection; an editor is not needed to retire ACKs.
    const updated = await this.options.store.compareAndSet(record, { ...record, working: clone(result.snapshot), intended,
      command: null, submitted: null, sequence: record.sequence + 1,
      state: complete ? 'acknowledged' : 'queued', result: complete ? { ...result, operationId: record.id } : null,
      unfinalized: [...record.unfinalized, record.command!.operationId] });
    this.assertCurrent(owner, generation);
    this.emit(updated);
    return true;
  }

  private emit(request: CommitRequest): void {
    for (const listener of this.listeners) { try { listener({ request: clone(request) }); } catch { /* Rendering cannot change delivery. */ } }
  }
  private current(owner: string, generation: number): boolean { return owner === this.owner && generation === this.generation; }
  private assertCurrent(owner: string, generation: number): void { if (!this.current(owner, generation)) throw new Error('Account changed'); }
}

/** Test/custom in-memory port; production supplies IndexedDB. */
export function createMemoryCommitStore(): CommitStore {
  const records = new Map<string, CommitRequest>();
  return {
    list: async owner => clone([...records.values()].filter(record => record.owner === owner)),
    create: async request => {
      const existing = [...records.values()].find(record => record.owner === request.owner && record.editorId === request.editorId && record.editGeneration === request.editGeneration);
      if (existing) { assertCommitCapture(existing, request); return clone(existing); }
      records.set(request.id, clone(request)); return clone(request);
    },
    compareAndSet: async (previous, next) => {
      const current = records.get(previous.id);
      if (!current || current.revision !== previous.revision) throw Object.assign(new Error('Commit changed'), { code: 'commit-changed' });
      assertCommitCapture(current, next);
      const updated = { ...clone(next), revision: previous.revision + 1 };
      records.set(previous.id, updated); return clone(updated);
    },
  };
}
