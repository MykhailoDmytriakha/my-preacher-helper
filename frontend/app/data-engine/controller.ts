import { requiredDomainTargets } from './domainPolicy';
import { projectManualSelection, type ManualPath } from './manualScope';
import { DataSession, type SessionCheckpoint } from './session';

import type { CommitQueue, CommitRequest } from './commits';
import type { DataEngineRuntime, RuntimeEvent } from './runtime';
import type { CommandResult, DataCommand, DocumentData, ResourceRef, ResourceSnapshot } from './types';

export interface EditorRecord {
  owner: string;
  editorId: string;
  checkpoint: SessionCheckpoint;
  /** Persisted before journal submission so a crash can resume the identical command. */
  prepared: DataCommand | null;
  unfinalized: string[];
  completedCommits?: string[];
}

export interface CheckpointStore {
  read(owner: string, editorId: string): Promise<EditorRecord | undefined>;
  put(record: EditorRecord): Promise<void>;
}

export interface RecoveryCheckpoint {
  /** Stable persisted identity, independent of the current browser factory. */
  id: string;
  record: EditorRecord;
}

export interface CheckpointRecoveryStore extends CheckpointStore {
  listRecoverable(owner: string, resource?: ResourceRef): Promise<RecoveryCheckpoint[]>;
  /** Atomic create-if-absent; recovery never overwrites an active editor checkpoint. */
  create(record: EditorRecord): Promise<void>;
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
  commits?: CommitQueue;
}

export interface EditorState {
  checkpoint: SessionCheckpoint;
  durable: boolean;
  error: string | null;
  result: CommandResult | null;
  /** A command is being prepared or durably queued; it is not yet an acknowledgement. */
  preparing?: boolean;
}

/** A single editor owns its checkpoint; the runtime owns delivery for every editor. */
export class EditorController {
  private session: DataSession;
  private prepared: DataCommand | null = null;
  private unfinalized: string[] = [];
  private durable = true;
  private error: string | null = null;
  private result: CommandResult | null = null;
  private preparations = 0;
  private disposed = false;
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();
  private unsubscribe: () => void = () => undefined;
  private stopCommits: () => void = () => undefined;
  private completedCommits: string[] = [];

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
    }
    controller.unsubscribe = options.runtime.subscribe(event => controller.onRuntime(event));
    if (options.commits) controller.stopCommits = options.commits.subscribe(({ request }) => controller.onCommit(request));
    try {
      // A checkpoint may have committed before its journal entry; resubmission is idempotent.
      if (controller.prepared) await options.runtime.submit(controller.prepared);
      await controller.finishAcknowledgements();
      if (options.commits) {
        for (const request of await options.commits.list()) {
          if (request.editorId === options.editorId || controller.session.checkpoint().pending[request.id]) await controller.applyCommit(request);
        }
      }
      return controller;
    } catch (error) {
      controller.dispose();
      throw error;
    }
  }

  getState(): EditorState {
    this.assertCurrent();
    return { checkpoint: this.session.checkpoint(), durable: this.durable, error: this.error, result: this.result, preparing: this.preparations > 0 };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  edit(value: DocumentData | null): Promise<void> {
    this.assertCurrent();
    this.session.edit(value);
    this.durable = false;
    this.emit();
    return this.enqueue(() => this.persist());
  }

  save(capturedIntent?: SessionCheckpoint): Promise<void> {
    this.assertCurrent();
    const captured = capturedIntent ?? this.session.checkpoint();
    this.preparations += 1;
    this.emit();
    return this.enqueue(async () => {
      if (this.options.commits) {
        const predecessorId = Object.entries(captured.pending).sort((a, b) => b[1].generation - a[1].generation)[0]?.[0];
        const request = await this.options.commits.save(this.options.editorId, captured, predecessorId ? { predecessorId } : undefined);
        if (request) await this.applyCommit(request);
        return;
      }
      if (!this.prepared) {
        const intended = captured;
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
    }).finally(() => { this.preparations -= 1; this.emit(); });
  }

  /** A durable form request joins this editor without absorbing unrelated staged fields. */
  adoptManualCommit(request: CommitRequest, selection: readonly ManualPath[]): Promise<void> {
    this.assertCurrent();
    const checkpoint = this.session.checkpoint();
    if (request.owner !== this.options.owner || request.baseline.resource.collection !== checkpoint.confirmed.resource.collection
      || request.baseline.resource.id !== checkpoint.confirmed.resource.id || !request.value) throw new Error('Manual request identity mismatch');
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
    return !this.durable || this.prepared !== null || this.unfinalized.length > 0;
  }

  retryPersistence(): Promise<void> {
    return this.enqueue(async () => {
      await this.persist();
      if (this.prepared) await this.options.runtime.submit(this.prepared);
      await this.finishAcknowledgements();
    });
  }

  /** Queue a deletion only when no earlier operation has an unresolved outcome. */
  remove(): Promise<void> {
    this.assertCurrent();
    const checkpoint = this.session.checkpoint();
    if (Object.keys(checkpoint.pending).length || this.prepared || this.preparations) return Promise.reject(new Error('Resolve pending commands before deleting'));
    if (!checkpoint.confirmed.value || checkpoint.confirmed.metadata?.deleted) return Promise.resolve();
    if (!this.durable) return Promise.reject(new Error('Save the local draft before deleting'));
    const persisting = this.edit(null);
    const deletion = this.session.checkpoint();
    return persisting.then(() => this.save(deletion));
  }

  observe(snapshot: ResourceSnapshot, source: 'server' | 'cache'): Promise<void> {
    return this.enqueue(async () => {
      this.session.observe(snapshot, { source });
      await this.persist();
    });
  }

  /** Explicitly replace a terminal conflict only; unknown remote outcomes cannot be discarded. */
  acceptRemote(): Promise<void> {
    return this.enqueue(async () => {
      if (this.options.commits && Object.keys(this.session.checkpoint().pending).length) await this.cancelCommits();
      if (this.prepared) {
        await this.options.runtime.discard(this.prepared.operationId);
        this.session.release(this.prepared.operationId);
        this.prepared = null;
      }
      this.session.acceptRemote();
      this.result = null;
      await this.persist();
    });
  }

  /** Keep local conflict fields after terminal refusal, without replacing remote siblings. */
  keepLocal(): Promise<void> {
    return this.enqueue(async () => {
      if (this.options.commits && Object.keys(this.session.checkpoint().pending).length) await this.cancelCommits();
      const checkpoint = this.session.checkpoint();
      if (this.result?.kind === 'refused' && this.result.code === 'generation-mismatch'
        && (!checkpoint.remoteCandidate?.metadata
          || checkpoint.remoteCandidate.metadata.generation === this.prepared?.generation)) {
        throw Object.assign(new Error('Read the current document before resolving a generation mismatch'), { code: 'fresh-read-required' });
      }
      // Validate recovery before retiring its only durable terminal receipt.
      const preview = DataSession.restore(checkpoint);
      if (this.prepared) preview.release(this.prepared.operationId);
      preview.keepLocal();
      if (this.prepared) {
        await this.options.runtime.discard(this.prepared.operationId);
        this.assertCurrent();
        this.session.release(this.prepared.operationId);
        this.prepared = null;
      }
      // Typing can arrive during journal retirement, so resolve the current session, not preview.
      this.session.keepLocal();
      this.result = null;
      await this.persist();
    });
  }

  /** Await durable projection work, including ACK callbacks, for lifecycle and tests. */
  async settled(): Promise<void> {
    let pending: Promise<unknown>;
    do { pending = this.queue; await pending; } while (pending !== this.queue);
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
    this.stopCommits();
    this.listeners.clear();
  }

  private onRuntime(event: RuntimeEvent): void {
    if (event.kind !== 'result' || event.owner !== this.options.owner
      || (event.result.operationId !== this.prepared?.operationId && !this.unfinalized.includes(event.result.operationId))) return;
    void this.enqueue(async () => {
      if (this.prepared?.operationId !== event.result.operationId && !this.unfinalized.includes(event.result.operationId)) return;
      this.result = event.result;
      this.session.accept(event.result);
      if (event.result.kind === 'acknowledged') {
        this.prepared = null;
        if (!this.unfinalized.includes(event.result.operationId)) this.unfinalized.push(event.result.operationId);
      }
      await this.persist();
      await this.finishAcknowledgements();
    }).catch(() => undefined); // enqueue exposes persistence failure in the editor state.
  }

  private async persist(): Promise<void> {
    const checkpoint = this.session.checkpoint();
    await this.options.store.put({ owner: this.options.owner, editorId: this.options.editorId, checkpoint, prepared: this.prepared, unfinalized: [...this.unfinalized], completedCommits: [...this.completedCommits] });
    this.assertCurrent();
    // Another keystroke may have arrived during the storage transaction.
    this.durable = this.session.getState().editGeneration === checkpoint.editGeneration;
    this.error = null;
    this.emit();
  }

  private onCommit(request: CommitRequest): void {
    if (request.owner !== this.options.owner || this.disposed
      || (request.editorId !== this.options.editorId && !this.session.checkpoint().pending[request.id])) return;
    void this.enqueue(() => this.applyCommit(request)).catch(() => undefined);
  }

  private async applyCommit(request: CommitRequest): Promise<void> {
    this.assertCurrent();
    if (this.completedCommits.includes(request.id)) return;
    if (request.state === 'cancelled') {
      this.session.release(request.id);
      this.completedCommits.push(request.id);
    } else {
      this.session.registerCommit(request.id, request.editGeneration, request.value, request.command?.operationId);
      if (request.result && ['acknowledged', 'conflict', 'refused'].includes(request.state)) {
        this.result = request.result;
        this.session.accept(request.result);
        if (request.state === 'acknowledged') this.completedCommits.push(request.id);
      }
    }
    await this.persist();
  }

  private async cancelCommits(): Promise<void> {
    await this.options.commits!.cancel(this.options.editorId, Object.keys(this.session.checkpoint().pending));
    this.assertCurrent();
    for (const id of Object.keys(this.session.checkpoint().pending)) {
      this.session.release(id);
      if (!this.completedCommits.includes(id)) this.completedCommits.push(id);
    }
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

  private enqueue(action: () => Promise<void>): Promise<void> {
    const next = this.queue.catch(() => undefined).then(async () => {
      this.assertCurrent();
      try { await action(); } catch (error) {
        this.durable = false;
        this.error = error instanceof Error ? error.message : 'Data engine storage failed';
        this.emit();
        throw error;
      }
    });
    this.queue = next;
    return next;
  }

  private assertCurrent(): void {
    if (this.disposed || !this.options.isCurrentOwner(this.options.owner)) throw new Error('Editor is no longer active');
  }

  private emit(): void {
    if (this.disposed || !this.options.isCurrentOwner(this.options.owner)) return;
    this.listeners.forEach(listener => { try { listener(); } catch { /* Rendering never changes persistence. */ } });
  }
}
