import { prepareDomainCommand } from './domainPolicy';
import { equalValues, mergeDocumentFields } from './protocol';

import type { CommitRequest } from './commits';
import type { CommandResult, ConflictDetail, DataCommand, DocumentData, ResourceSnapshot } from './types';

export interface SessionCheckpoint {
  confirmed: ResourceSnapshot;
  draft: DocumentData | null;
  dirty: boolean;
  editGeneration: number;
  remoteCandidate: ResourceSnapshot | null;
  conflicts: ConflictDetail[];
  pending: Record<string, { generation: number; value: DocumentData | null; operations?: string[] }>;
}

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** The editor's confirmed baseline and local intent have independent lifetimes. */
export class DataSession {
  private state: SessionCheckpoint;

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

  edit(value: DocumentData | null): void {
    this.state.draft = copy(value);
    this.state.editGeneration += 1;
    this.state.dirty = !equalValues(value, this.state.confirmed.value);
  }

  /** A durable save request owns its captured value, independently of later typing. */
  registerCommit(operationId: string, generation: number, value: DocumentData | null, preparedId?: string): void {
    if (!this.state.pending[operationId]) this.state.pending[operationId] = { generation, value: copy(value) };
    const pending = this.state.pending[operationId];
    if (preparedId && preparedId !== operationId && !pending.operations?.includes(preparedId)) pending.operations = [...(pending.operations ?? []), preparedId];
  }

  /** One projection rule for mounted editors and recovery of editors that already closed. */
  applyCommit(request: CommitRequest): boolean {
    if (request.state === 'cancelled') {
      this.release(request.id);
      return true;
    }
    this.registerCommit(request.id, request.editGeneration, request.value, request.command?.operationId);
    if (request.result && ['acknowledged', 'conflict', 'refused'].includes(request.state)) this.accept(request.result);
    return request.state === 'acknowledged';
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

  accept(result: CommandResult): void {
    const submitted = this.state.pending[result.operationId];
    if (!submitted) return;
    if (result.kind !== 'acknowledged') {
      if ('snapshot' in result) this.observe(result.snapshot, { source: 'server' });
      // A pinned manual Save can conflict with the parent's already observed baseline.
      if (result.kind === 'conflict' && this.matches(result.snapshot) && !this.isOlder(result.snapshot)) {
        this.state.remoteCandidate = copy(result.snapshot);
        this.state.conflicts = copy(result.conflicts);
      }
      return;
    }
    if (!this.matches(result.snapshot)) return;
    delete this.state.pending[result.operationId];
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
    const rebased = mergeDocumentFields(newerSubmitted ? newerSubmitted.value : submitted.value, this.state.draft, accepted.value);
    this.state.confirmed = copy(accepted);
    this.state.draft = rebased.value.exists ? copy(rebased.value.value as DocumentData) : null;
    this.state.conflicts = copy(rebased.conflicts);
    this.state.remoteCandidate = rebased.conflicts.length ? copy(accepted) : null;
    this.state.dirty = !equalValues(this.state.draft, accepted.value);
  }

  observe(snapshot: ResourceSnapshot, { source }: { source: 'server' | 'cache' }): void {
    if (!this.matches(snapshot) || this.isOlder(snapshot)) return;
    if (source === 'cache' && snapshot.value === null) return;
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
    this.state.remoteCandidate = null;
  }

  /** Replacing local intent is allowed only after each pending delivery is explicitly settled. */
  acceptRemote(): void {
    if (Object.keys(this.state.pending).length) throw new Error('Resolve pending commands before accepting remote data');
    if (!this.state.remoteCandidate) return;
    this.state.confirmed = copy(this.state.remoteCandidate);
    this.state.draft = copy(this.state.remoteCandidate.value);
    this.state.remoteCandidate = null;
    this.state.editGeneration += 1;
    this.state.dirty = false;
    this.state.conflicts = [];
  }

  /** Explicit conflict choice: keep edited fields and retain untouched remote siblings. */
  keepLocal(): void {
    if (Object.keys(this.state.pending).length) throw new Error('Resolve pending commands before keeping local data');
    const candidate = this.state.remoteCandidate;
    if (candidate?.value === null || candidate?.metadata?.deleted || this.state.confirmed.metadata?.deleted) {
      throw Object.assign(new Error('Remote document was deleted; use a new copy to preserve this draft'), { code: 'use-new-copy' });
    }
    if (candidate) {
      const merged = mergeDocumentFields(this.state.confirmed.value, this.state.draft, candidate.value);
      this.state.confirmed = copy(candidate);
      // mergeFields preserves mine at conflicting paths; this explicit action accepts that choice.
      this.state.draft = merged.value.exists ? copy(merged.value.value as DocumentData) : null;
    }
    this.state.remoteCandidate = null;
    this.state.conflicts = [];
    this.state.editGeneration += 1;
    this.state.dirty = !equalValues(this.state.draft, this.state.confirmed.value);
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
