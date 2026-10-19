import { assertCommitCapture } from './commits';
import { isDirectLegacyDocumentIntent, type DocumentAnswer } from './documentDelivery';
import { requiredDomainTargets } from './domainPolicy';
import { editorSlot } from './editorIdentity';
import { projectManualSelection, type ManualPath } from './manualScope';
import { equalValues, mergeDocumentFields } from './protocol';
import { recoveryChoiceFingerprint } from './recoveryChoice';
import { DataSession, type SessionCheckpoint, type ShownCopy } from './session';
import { submittedWorkCheckpoint } from './submittedWork';

import type { DocumentWriteReceipt } from './commitReceipt';
import type { CommitQueue, CommitRequest } from './commits';
import type { DataEngineRuntime, RuntimeEvent } from './runtime';
import type { CommandResult, DataCommand, DocumentData, ResourceRef, ResourceSnapshot } from './types';

/** A retired controller rejects late work; this is cancellation, not a storage failure. */
export class InactiveEditorError extends Error {
  constructor() { super('Editor is no longer active'); this.name = 'InactiveEditorError'; }
}

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
  /** Derived by engine discovery; never stored in the checkpoint. */
  answer?: DocumentAnswer;
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
  /** Proven submitted intent for a fresh opening; an existing checkpoint takes precedence. */
  submittedCheckpoint?: SessionCheckpoint;
}

export interface EditorState {
  checkpoint: SessionCheckpoint;
  durable: boolean;
  error: string | null;
  /** The refusal's code, when it has one, so a screen can say it in words (actionFailureMessage). */
  errorCode?: string | null;
  result: CommandResult | null;
  /** A command is being prepared or durably queued; it is not yet an acknowledgement. */
  preparing?: boolean;
  actionResolutionRequired?: boolean;
  /** Derived by the engine from every held request and its cancellation scope. */
  savedIntentReplaceable?: boolean;
  /** A legacy checkpoint may still own a command directly rather than a commit request. */
  preparedOperationId?: string;
  /** A form's save is among the pending work: dropping a refusal of the whole document is not offered. */
  manualWork?: boolean;
}

/** A single editor owns its checkpoint; the runtime owns delivery for every editor. */
function captureSaveOptions(predecessorIds: string[], captureScope?: string) {
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
  /** Submitted generations must reach the request store before a future RAM draft reaches a checkpoint. */
  private pendingCaptures = new Set<SessionCheckpoint>();
  private disposed = false;
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();
  private unsubscribe: () => void = () => undefined;
  private stopCommits: () => void = () => undefined;
  private completedCommits: string[] = [];
  private atomicPending = new Set<string>();

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
    if (!saved && options.submittedCheckpoint) {
      const checkpoint = options.submittedCheckpoint;
      if (checkpoint.confirmed.resource.collection !== options.snapshot.resource.collection
        || checkpoint.confirmed.resource.id !== options.snapshot.resource.id) throw new Error('Submitted checkpoint identity mismatch');
      controller.session = DataSession.restore(checkpoint);
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
    const checkpoint = this.session.checkpoint();
    return { checkpoint, durable: this.durable, error: this.error, errorCode: this.errorCode, result: this.result, preparing: this.preparations > 0,
      preparedOperationId: this.prepared?.operationId,
      actionResolutionRequired: this.atomicPending.size > 0,
      manualWork: Object.keys(checkpoint.pending).some(id => this.manualRequests.has(id)) };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** `shown` — the copy the screen showed while typing (`DataSession.edit`). */
  edit(value: DocumentData | null, shown?: ShownCopy): Promise<void> {
    this.assertCurrent();
    this.session.edit(value, shown);
    this.durable = false;
    this.emit();
    return this.enqueue(() => this.persist());
  }

  save(capturedIntent?: SessionCheckpoint, selection?: readonly ManualPath[], onCaptured?: (receipt: DocumentWriteReceipt) => void, captureScope?: string): Promise<void> {
    this.assertCurrent();
    const captured = capturedIntent ?? this.session.checkpoint();
    this.assertManualResolution(selection, captured);
    this.preparations += 1;
    if (this.options.commits) this.pendingCaptures.add(captured);
    this.emit();
    return this.enqueue(async () => {
      if (this.options.commits) {
        // Earlier saves may have registered after this intent was captured.
        // An adopted manual save can share this generation; it is still our predecessor.
        // Exclude only later work; keep the captured draft and baseline unchanged.
        const pending = Object.entries(this.session.checkpoint().pending)
          .filter(([, request]) => request.generation <= captured.editGeneration);
        const newestGeneration = Math.max(...pending.map(([, request]) => request.generation));
        const predecessorIds = pending.filter(([, request]) => request.generation === newestGeneration).map(([id]) => id);
        const record = this.record();
        const projectCheckpoint = (request: CommitRequest): EditorRecord => {
          const session = DataSession.restore({ ...captured, pending: Object.fromEntries(pending) });
          const completed = [...(record.completedCommits ?? [])];
          if (session.applyCommit(request) && !completed.includes(request.id)) completed.push(request.id);
          return { ...record, checkpoint: session.checkpoint(), completedCommits: completed };
        };
        const options = { ...captureSaveOptions(predecessorIds, captureScope), checkpoint: projectCheckpoint };
        const capture = onCaptured ? await this.options.commits.saveWithReceipt(this.options.editorId, captured, options) : null;
        const request = capture ? capture.request : await this.options.commits.save(this.options.editorId, captured, options);
        this.pendingCaptures.delete(captured);
        if (capture) onCaptured!(capture.receipt);
        if (request) await this.applyCommit(request);
        else await this.persist();
        return;
      }
      if (onCaptured) throw new Error('Write receipts require the commit queue');
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
    }).finally(() => { this.pendingCaptures.delete(captured); this.preparations -= 1; this.emit(); });
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
  remove(onCaptured?: (receipt: DocumentWriteReceipt) => void, captureScope?: string): Promise<void> {
    this.assertCurrent();
    const checkpoint = this.session.checkpoint();
    if (Object.keys(checkpoint.pending).length || this.prepared || this.preparations) return Promise.reject(Object.assign(new Error('Resolve pending commands before deleting'), { code: 'pending-delivery-first' }));
    if (!checkpoint.confirmed.value || checkpoint.confirmed.metadata?.deleted) return onCaptured ? this.save(checkpoint, undefined, onCaptured, captureScope) : Promise.resolve();
    if (!this.durable) return Promise.reject(Object.assign(new Error('Save the local draft before deleting'), { code: 'not-on-device-yet' }));
    const persisting = this.edit(null);
    const deletion = this.session.checkpoint();
    const saving = this.save(deletion, undefined, onCaptured, captureScope);
    return Promise.all([persisting, saving]).then(() => undefined);
  }

  observe(snapshot: ResourceSnapshot, source: 'server' | 'cache'): Promise<void> {
    return this.enqueue(async () => {
      this.session.observe(snapshot, { source });
      await this.persist();
    });
  }

  /** Explicitly replace a terminal conflict only; unknown remote outcomes cannot be discarded. */
  acceptRemote(selection?: readonly ManualPath[], expected?: EditorRecord): Promise<void> {
    // The draft as the person chose; typing that lands before this queued choice runs is kept.
    const atChoice = this.session.checkpoint().draft;
    return this.enqueue(async () => {
      this.assertRecoveryChoice(expected);
      this.assertManualResolution(selection);
      const before = this.session.checkpoint();
      // A refusal has no other version to take: "use the server's version" drops the refused change.
      const refusedWork = !selection && Object.keys(before.pending).length > 0 && !before.remoteCandidate
        && !Object.keys(before.pending).some(id => this.manualRequests.has(id));
      const cancelled = Object.keys(this.session.checkpoint().pending);
      if (this.options.commits && cancelled.length && !isDirectLegacyDocumentIntent(cancelled, this.prepared?.operationId)) await this.cancelCommits(expected ? Object.keys(expected.checkpoint.pending) : undefined);
      if (this.prepared) {
        await this.options.runtime.discard(this.prepared.operationId);
        this.session.release(this.prepared.operationId);
        this.prepared = null;
      }
      this.assertManualResolution(selection);
      this.session.acceptRemote();
      if (refusedWork) this.session.dropRefused(atChoice);
      this.result = null;
      await this.persist();
      if (this.options.commits && cancelled.length) await this.options.commits.finishCancellation(this.options.editorId, cancelled);
    });
  }

  /** Keep local conflict fields after terminal refusal, without replacing remote siblings. */
  keepLocal(selection?: readonly ManualPath[], amendment?: { base: DocumentData; value: DocumentData }, expected?: EditorRecord): Promise<void> {
    const correction = amendment ? JSON.parse(JSON.stringify(amendment)) as typeof amendment : undefined;
    return this.enqueue(async () => {
      this.assertRecoveryChoice(expected);
      if (correction && (!selection || !equalValues(correction.value, projectManualSelection(correction.base, correction.value, selection)))) {
        throw new Error('Manual resolution changed an unselected field');
      }
      this.assertManualResolution(selection);
      const cancelled = Object.keys(this.session.checkpoint().pending);
      if (this.options.commits && cancelled.length && !isDirectLegacyDocumentIntent(cancelled, this.prepared?.operationId)) await this.cancelCommits(expected ? Object.keys(expected.checkpoint.pending) : undefined);
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
      this.assertManualResolution(selection);
      // Typing can arrive during journal retirement, so resolve the current session, not preview.
      this.session.keepLocal();
      if (correction) {
        // The explicit choice includes staged corrections, while untouched remote siblings survive.
        const merged = mergeDocumentFields(correction.base, correction.value, this.session.checkpoint().draft);
        this.session.edit(merged.value.exists ? merged.value.value as DocumentData : null);
      }
      this.result = null;
      await this.persist();
      if (this.options.commits && cancelled.length) await this.options.commits.finishCancellation(this.options.editorId, cancelled);
    });
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
      unfinalized: [...this.unfinalized], completedCommits: [...this.completedCommits] };
  }

  private async persist(): Promise<void> {
    if (this.pendingCaptures.size) return;
    const record = this.record();
    await this.options.store.put(record);
    this.assertCurrent();
    // Another keystroke may have arrived during the storage transaction.
    this.durable = this.session.getState().editGeneration === record.checkpoint.editGeneration;
    this.error = null;
    this.errorCode = null;
    this.emit();
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
    // Known competing branches stay separate; no event may choose one before this queue snapshot.
    const chain = submittedWorkCheckpoint(this.options.owner, this.options.snapshot.resource, requests);
    return Boolean(chain?.pending[current.id]) && this.session.adoptSubmittedSuccessor(current);
  }

  private async applyCommit(request: CommitRequest): Promise<void> {
    this.assertCurrent();
    // A request whose owner is no editor identity is a form's (or an action scope's) — also when this
    // editor took it over from a screen that was left. Its refusal is resolved there, not here.
    if (this.session.checkpoint().pending[request.id] && editorSlot(request.editorId) === null) this.manualRequests.add(request.id);
    if (this.completedCommits.includes(request.id)) return;
    if (request.atomic && !['acknowledged', 'cancelled'].includes(request.state)) this.atomicPending.add(request.id);
    else this.atomicPending.delete(request.id);
    if (request.state === 'cancelled' && request.cancelledByAction) this.result = null;
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

  private async cancelCommits(selected?: readonly string[]): Promise<void> {
    await this.options.commits!.cancel(selected ? '' : this.options.editorId, selected ?? Object.keys(this.session.checkpoint().pending));
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
        const code = (error as { code?: unknown } | null)?.code;
        this.errorCode = typeof code === 'string' ? code : null;
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
