import { serverCopyIsNewer, type VersionedCopy } from '../utils/readFreshness';

import { CommitQueue, type CommitRequest, type CommitStore } from './commits';
import { EditorController, type CheckpointRecoveryStore, type CheckpointStore, type EditorState, type RecoveryCheckpoint } from './controller';
import { collectionHeadRef } from './feed';
import { ManualScope, sameManualSelection, type ManualCapture, type ManualPath, type ManualSavedIntent } from './manualScope';
import { getResourcePolicy, equalValues, isValidIdentifier } from './protocol';
import { forkCheckpoint, isRecoverableCheckpoint, reconcileRecoveryRecord } from './recovery.client';

import type { CollectionReader, CollectionState } from './collections';
import type { ManualScopeStore, StoredManualScope } from './manualScopes.client';
import type { Observation, ResourceObserver } from './observer';
import type { DataEngineRuntime, RuntimeEvent } from './runtime';
import type { SessionCheckpoint } from './session';
import type { DocumentData, EngineTransport, JournalEntry, ResourceRef, ResourceSnapshot } from './types';

export interface SnapshotStore {
  read(owner: string, resource: ResourceRef): Promise<ResourceSnapshot | undefined>;
  /** Adapters shared by tabs should compare and store atomically with canReplaceSnapshot. */
  put(owner: string, snapshot: ResourceSnapshot): Promise<void>;
}

export interface DataEngineOptions {
  runtime: DataEngineRuntime;
  observer: ResourceObserver;
  transport: Pick<EngineTransport, 'read'>;
  checkpoints: CheckpointStore;
  snapshots: SnapshotStore;
  collections?: CollectionReader;
  operationId: () => string;
  commits: CommitStore;
  manualScopes?: ManualScopeStore;
  onError?: (error: unknown) => void;
}

export interface ManagedManualForm {
  getState(): ReturnType<ManualScope['getState']> | null;
  subscribe(listener: () => void): () => void;
  begin(): Promise<void>;
  update(updater: (value: DocumentData) => DocumentData): Promise<void>;
  save(updater?: (value: DocumentData) => DocumentData): Promise<void>;
  cancel(): Promise<void>;
  retry(): Promise<void>;
  listRecoverable(): Promise<StoredManualScope[]>;
  recover(sourceScopeId: string): Promise<void>;
}

export interface ManagedEditor {
  getState(): EditorState;
  getObservation(): Observation;
  getDelivery(): JournalEntry[];
  form(slot: string, selection: readonly ManualPath[]): ManagedManualForm;
  subscribe(listener: () => void): () => void;
  edit(value: DocumentData | null): Promise<void>;
  /** Capture, stage and durably save one invocation without including later typing. */
  commit(updater: (current: DocumentData | null) => DocumentData | null): Promise<void>;
  /** Resolves when the command is durable; delivery continues independently. */
  save(): Promise<void>;
  /** Persist and queue deletion; refuses unresolved pending operations before changing the draft. */
  remove(): Promise<void>;
  acceptRemote(): Promise<void>;
  keepLocal(): Promise<void>;
  dispose(): void;
  /**
   * Leave the editor. With `flush`, a draft that could be saved — typed inside the autosave
   * delay, or a deletion whose request was not written yet — becomes a durable request first,
   * so leaving a screen never strands it in a checkpoint no editor will read again
   * (BUG-20260919-engine-leaving-strands-last-edit). A draft that waits for the person —
   * a conflict, a refusal, a document deleted elsewhere — is left alone, as is everything
   * when `flush` is false (manual forms, creation).
   */
  close(options?: { flush?: boolean }): void;
}

export interface EditorOpenOptions {
  signal?: AbortSignal;
}

interface EditorEntry {
  controller: EditorController | null;
  stopObservation: (() => void) | null;
  stopController: (() => void) | null;
  closed: boolean;
  listeners: Set<() => void>;
  observation: Observation;
}

const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const sameResource = (a: ResourceRef, b: ResourceRef) => a.collection === b.collection && a.id === b.id;
const cacheKey = (owner: string, resource: ResourceRef) => JSON.stringify([owner, resource.collection, resource.id]);
const initialObservation = (): Observation => ({ snapshot: null, source: null, readiness: 'unknown', checking: false, error: false });

/** Incoming data must be a confirmed snapshot, never an optimistic editor draft. */
export function canReplaceSnapshot(current: ResourceSnapshot | undefined, incoming: ResourceSnapshot): boolean {
  if (!current) return true;
  if (!sameResource(current.resource, incoming.resource)) return false;
  if (current.metadata) {
    return incoming.metadata !== null
      && incoming.metadata.generation === current.metadata.generation
      && incoming.metadata.revision >= current.metadata.revision
      && (!current.metadata.deleted || incoming.metadata.deleted);
  }
  if (incoming.metadata || current.value === null || incoming.value === null) return true;
  return !serverCopyIsNewer(current.value as VersionedCopy, incoming.value as VersionedCopy);
}

/** Public lifecycle boundary: callers never manage replay, baselines, or transport choice. */
export class DataEngine {
  private owner: string | null = null;
  private generation = 0;
  private online = true;
  private visible = true;
  private disposed = false;
  private readonly editors = new Map<string, EditorEntry>();
  private readonly recovering = new Map<string, object>();
  private readonly cacheWrites = new Map<string, { owner: string; generation: number; operation: Promise<ResourceSnapshot> }>();
  private readonly reads = new Map<string, Promise<ResourceSnapshot>>();
  private pending: JournalEntry[] = [];
  private pendingVersion = 0;
  private readonly pendingListeners = new Set<() => void>();
  private readonly refreshedOperations = new Set<string>();
  private readonly refreshedCollectionOperations = new Set<string>();
  private readonly stopRuntime: () => void;
  private readonly commits: CommitQueue;
  private readonly stopCommits: () => void;
  private commitRecords = new Map<string, CommitRequest>();
  private manualForms = new Map<string, { parent: EditorEntry; selection: readonly ManualPath[]; form: ManagedManualForm; scope: ManualScope | null; scopeId: string; emit: () => void }>();

  constructor(private readonly options: DataEngineOptions) {
    this.commits = new CommitQueue({ store: options.commits, runtime: options.runtime,
      operationId: options.operationId, readConfirmed: resource => this.read(resource), canDeliver: () => this.canDeliver() });
    this.stopCommits = this.commits.subscribe(({ request }) => {
      if (request.owner !== this.owner || this.disposed) return;
      this.commitRecords.set(request.id, request);
      const manual = [...this.manualForms.values()].find(item => item.scopeId === request.editorId && !item.parent.closed);
      if (manual?.parent.controller && request.state !== 'cancelled') {
        try { this.background(manual.parent.controller.adoptManualCommit(request, manual.selection), request.owner, this.generation); }
        catch (error) { this.options.onError?.(error); }
        manual.emit();
        if (request.state === 'acknowledged' && this.options.manualScopes) this.background(this.options.manualScopes.compact(request.owner, manual.scopeId), request.owner, this.generation);
      }
      if (request.result?.kind === 'acknowledged') this.background(this.persistSnapshot(request.owner, this.generation, request.result.snapshot), request.owner, this.generation);
      for (const [editorId, entry] of this.editors) if (!entry.closed && editorId === request.editorId) this.emit(entry);
    });
    this.stopRuntime = options.runtime.subscribe(event => this.onRuntime(event));
  }

  setOwner(owner: string | null): void {
    if (this.disposed || this.owner === owner) return;
    this.owner = owner;
    this.generation += 1;
    for (const entry of this.editors.values()) this.close(entry);
    this.editors.clear();
    for (const manual of this.manualForms.values()) manual.scope?.dispose();
    this.manualForms.clear();
    this.recovering.clear();
    this.reads.clear();
    this.options.runtime.setOwner(owner);
    this.commits.setOwner(owner);
    this.commitRecords.clear();
    this.options.collections?.setOwner(owner);
    this.options.observer.setOwner(owner);
    this.refreshedOperations.clear();
    this.refreshedCollectionOperations.clear();
    this.publishPending([], true);
    if (owner) {
      const generation = this.generation;
      const version = this.pendingVersion;
      this.background(this.options.runtime.list().then(entries => {
        if (this.current(owner, generation) && this.pendingVersion === version) this.publishPending(entries);
      }), owner, generation);
    }
    this.backgroundDrain();
  }

  setVisible(visible: boolean): void {
    if (this.disposed || this.visible === visible) return;
    this.visible = visible;
    this.options.collections?.setVisible(visible);
    this.options.observer.setVisible(visible);
    if (visible) this.backgroundDrain();
  }

  setOnline(online: boolean): void {
    if (this.disposed || this.online === online) return;
    this.online = online;
    this.options.collections?.setOnline(online);
    this.options.observer.setOnline(online);
    if (online) this.backgroundDrain();
  }

  read(resource: ResourceRef): Promise<ResourceSnapshot> {
    const owner = this.requireOwner();
    this.validateResource(resource, owner);
    const generation = this.generation;
    const frozen = copy(resource);
    const key = cacheKey(owner, frozen);
    const existing = this.reads.get(key);
    if (existing) return existing.then(copy);
    const operation = this.readSnapshot(owner, generation, frozen);
    this.reads.set(key, operation);
    void operation.finally(() => {
      if (this.reads.get(key) === operation) this.reads.delete(key);
    }).catch(() => undefined);
    return operation.then(copy);
  }

  readCollection(collection: string): Promise<CollectionState> {
    this.requireOwner();
    return this.collectionReader().read(collection);
  }

  watchCollection(collection: string, listener: (state: CollectionState) => void): () => void {
    this.requireOwner();
    return this.collectionReader().watch(collection, listener);
  }

  refreshCollection(collection: string): Promise<CollectionState> {
    this.requireOwner();
    return this.collectionReader().refresh(collection);
  }

  openEditor(resource: ResourceRef, editorId: string, options?: EditorOpenOptions): Promise<ManagedEditor> {
    return this.open(resource, editorId, false, options);
  }

  /** Explicit absent intent: a server-side create can never replace an existing ID. */
  createEditor(resource: ResourceRef, editorId: string, options?: EditorOpenOptions): Promise<ManagedEditor> {
    return this.open(resource, editorId, true, options);
  }

  /** Discovery never takes ownership of, rewrites or removes a saved editor. */
  async listRecoverable(resource?: ResourceRef): Promise<RecoveryCheckpoint[]> {
    const owner = this.requireOwner();
    if (resource) this.validateResource(resource, owner);
    const generation = this.generation;
    const records = await this.recoveryStore().listRecoverable(owner, resource && copy(resource));
    const requests = await this.commits.list();
    this.assertCurrent(owner, generation);
    return records.filter(({ record }) => !this.editors.has(record.editorId))
      .map(({ id, record }) => ({ id, record: reconcileRecoveryRecord(record, requests) }))
      .filter(({ record }) => isRecoverableCheckpoint(record));
  }

  /** Explicitly fork a checkpoint to a fresh editor identity, preserving pending operation IDs. */
  async recoverEditor(resource: ResourceRef, editorId: string, sourceId: string, options?: EditorOpenOptions): Promise<ManagedEditor> {
    const owner = this.requireOwner();
    const generation = this.generation;
    const frozen = copy(resource);
    this.validateResource(frozen, owner);
    const store = this.recoveryStore();
    const active = () => {
      this.assertCurrent(owner, generation);
      if (options?.signal?.aborted) throw this.abortError();
    };
    active();
    if (!editorId) throw new Error('An editor identity is required');
    if (this.editors.has(editorId) || this.recovering.has(editorId)) throw new Error('This editor identity is already open');
    const reservation = {};
    this.recovering.set(editorId, reservation);
    let onAbort: (() => void) | undefined;
    const cancelled = options?.signal && new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(this.abortError());
      options.signal!.addEventListener('abort', onAbort, { once: true });
    });
    try {
      const forking = forkCheckpoint({
        read: async (uid, id) => {
          const record = await store.read(uid, id); active();
          const requests = await this.commits.list(); active();
          return record && reconcileRecoveryRecord(record, requests);
        },
        create: async record => { active(); await store.create(record); active(); },
      }, owner, sourceId, editorId, frozen);
      const forked = await (cancelled ? Promise.race([forking, cancelled]) : forking);
      active();
      this.recovering.delete(editorId);
      const creating = forked.checkpoint.confirmed.value === null && forked.checkpoint.confirmed.metadata === null;
      return this.open(frozen, editorId, creating, options);
    } finally {
      if (onAbort) options?.signal?.removeEventListener('abort', onAbort);
      if (this.recovering.get(editorId) === reservation) this.recovering.delete(editorId);
    }
  }

  private recoveryStore(): CheckpointRecoveryStore {
    const store = this.options.checkpoints as Partial<CheckpointRecoveryStore>;
    if (typeof store.listRecoverable !== 'function' || typeof store.create !== 'function') throw new Error('Checkpoint recovery is not supported by this store');
    return store as CheckpointRecoveryStore;
  }

  async retry(resource?: ResourceRef): Promise<void> {
    if (this.disposed || !this.owner) return;
    const owner = this.requireOwner();
    const generation = this.generation;
    // Repair local ownership even offline. A failed first checkpoint or journal
    // insertion has no queued remote result that could repair it through replay.
    await Promise.all([...this.editors.values()].map(entry => {
      const controller = entry.controller;
      return controller?.needsPersistenceRetry() ? controller.retryPersistence() : undefined;
    }));
    this.assertCurrent(owner, generation);
    await this.commits.drain(this.canDeliver());
    this.assertCurrent(owner, generation);
    // Only an explicit document retry requests a fresh read; the background
    // delivery timer must not turn into an extra polling loop for every editor.
    if (resource) await this.options.observer.refresh(resource);
    this.assertCurrent(owner, generation);
    await Promise.all([...this.editors.values()].map(entry => entry.controller?.settled()));
    this.assertCurrent(owner, generation);
    await Promise.all([...this.cacheWrites.values()]
      .filter(write => write.owner === owner && write.generation === generation)
      .map(write => write.operation));
  }

  listPending(): Promise<JournalEntry[]> {
    return this.options.runtime.list();
  }

  getPending(): JournalEntry[] { return copy(this.pending); }

  subscribePending(listener: () => void): () => void {
    if (this.disposed) throw new Error('DataEngine has been disposed');
    const subscription = () => listener();
    this.pendingListeners.add(subscription);
    return () => { this.pendingListeners.delete(subscription); };
  }

  dispose(): void {
    if (this.disposed) return;
    this.setOwner(null);
    this.disposed = true;
    this.stopRuntime();
    this.stopCommits();
    this.commits.setOwner(null);
    this.pendingListeners.clear();
    this.options.collections?.dispose();
    this.options.observer.dispose();
  }

  private async readSnapshot(owner: string, generation: number, resource: ResourceRef): Promise<ResourceSnapshot> {
    const cached = await this.options.snapshots.read(owner, resource);
    this.assertCurrent(owner, generation);
    if (cached) {
      if (!sameResource(cached.resource, resource)) throw new Error('Cached snapshot identity mismatch');
      return cached;
    }
    if (!this.online || !this.visible) throw new Error('The document is not available in the local cache');
    const server = await this.options.transport.read(owner, resource);
    this.assertCurrent(owner, generation);
    if (!sameResource(server.resource, resource)) throw new Error('Server snapshot identity mismatch');
    return this.persistSnapshot(owner, generation, server);
  }

  private async open(resource: ResourceRef, editorId: string, creating: boolean, options?: EditorOpenOptions): Promise<ManagedEditor> {
    const owner = this.requireOwner();
    this.validateResource(resource, owner);
    if (!editorId) throw new Error('An editor identity is required');
    if (options?.signal?.aborted) throw this.abortError();
    if (this.editors.has(editorId) || this.recovering.has(editorId)) throw new Error('This editor identity is already open');
    const generation = this.generation;
    const frozen = copy(resource);
    const entry: EditorEntry = {
      controller: null, stopObservation: null, stopController: null, closed: false,
      listeners: new Set(), observation: initialObservation(),
    };
    this.editors.set(editorId, entry);
    let onAbort: (() => void) | undefined;
    const cancelled = options?.signal && new Promise<never>((_resolve, reject) => {
      onAbort = () => {
        this.close(entry);
        if (this.editors.get(editorId) === entry) this.editors.delete(editorId);
        reject(this.abortError());
      };
      options.signal!.addEventListener('abort', onAbort, { once: true });
    });
    const opening = this.initializeEditor(owner, generation, frozen, editorId, creating, entry);
    try {
      const managed = await (cancelled ? Promise.race([opening, cancelled]) : opening);
      if (entry.closed) throw this.abortError();
      return managed;
    } finally {
      if (onAbort) options?.signal?.removeEventListener('abort', onAbort);
    }
  }

  private async initializeEditor(owner: string, generation: number, frozen: ResourceRef, editorId: string, creating: boolean, entry: EditorEntry): Promise<ManagedEditor> {
    const assertOpening = () => {
      this.assertCurrent(owner, generation);
      if (entry.closed) throw this.abortError();
    };
    try {
      const snapshot: ResourceSnapshot = creating
        ? { resource: frozen, value: null, metadata: null }
        : await this.openingSnapshot(owner, generation, frozen, editorId);
      assertOpening();
      const controller = await EditorController.open({
        owner, editorId, snapshot, store: this.options.checkpoints, runtime: this.options.runtime,
        operationId: this.options.operationId,
        readConfirmed: resource => this.read(resource),
        commits: this.commits,
        isCurrentOwner: uid => !entry.closed && this.current(uid, generation),
      });
      entry.controller = controller;
      assertOpening();
      // A request may commit just before its optimistic parent checkpoint is persisted.
      // The durable manual envelope is the association; never infer ownership from another tab.
      if (this.options.manualScopes) {
        const scopes = await this.options.manualScopes.list(owner, frozen); assertOpening();
        const requests = await this.commits.list(); assertOpening();
        requests.forEach(request => this.commitRecords.set(request.id, request));
        for (const scope of scopes.filter(item => item.parentEditorId === editorId)) {
          for (const request of requests.filter(item => item.editorId === scope.scopeId && item.state !== 'cancelled').sort((a, b) => a.editGeneration - b.editGeneration)) {
            await controller.adoptManualCommit(request, scope.record.selection); assertOpening();
          }
        }
      }
      // Restore and reconcile before attaching a source that may emit synchronously.
      if (!creating && canReplaceSnapshot(controller.getState().checkpoint.confirmed, snapshot)) {
        await controller.observe(snapshot, 'cache');
      }
      assertOpening();
      let lastConfirmed: ResourceSnapshot | null = null;
      const updateCache = () => {
        if (entry.closed || !this.current(owner, generation)) return;
        const confirmed = controller.getState().checkpoint.confirmed;
        if (!equalValues(confirmed, lastConfirmed)) {
          lastConfirmed = confirmed;
          // A new, unsubmitted editor's absence is not evidence of a server deletion.
          if (!creating || confirmed.metadata || confirmed.value !== null) {
            this.background(this.persistSnapshot(owner, generation, confirmed), owner, generation);
          }
        }
        // Watching an existing ID before create acknowledgement could turn create into update.
        if (!entry.stopObservation && (!creating || confirmed.metadata || confirmed.value !== null)) {
          const stopObservation = this.options.observer.watch(owner, frozen, observation => {
            if (entry.closed || !this.current(owner, generation)) return;
            entry.observation = observation;
            this.emit(entry);
            if (!observation.snapshot || !observation.source) return;
            this.background(controller.observe(observation.snapshot, observation.source), owner, generation);
            this.background(this.persistSnapshot(owner, generation, observation.snapshot), owner, generation);
          });
          if (entry.closed || !this.current(owner, generation)) stopObservation();
          else entry.stopObservation = stopObservation;
        }
        this.emit(entry);
      };
      entry.stopController = controller.subscribe(updateCache);
      updateCache();
      assertOpening();
      const active = () => {
        this.assertCurrent(owner, generation);
        if (entry.closed) throw new Error('Editor is no longer active');
      };
      const managed: ManagedEditor = {
        getState: () => { active(); return controller.getState(); },
        getObservation: () => { active(); return copy(entry.observation); },
        getDelivery: () => { active(); return copy(this.editorDelivery(entry, this.pending)); },
        form: (slot, selection) => { active(); return this.manualForm(owner, generation, frozen, editorId, entry, slot, selection); },
        subscribe: listener => {
          active();
          const subscription = () => listener();
          entry.listeners.add(subscription);
          return () => { entry.listeners.delete(subscription); };
        },
        edit: value => { active(); return controller.edit(value); },
        commit: updater => {
          active();
          const persistence = controller.edit(updater(controller.getState().checkpoint.draft));
          const saving = controller.save();
          return Promise.all([persistence, saving]).then(async () => { active(); this.backgroundDrain(); await this.prepareCommits(); active(); });
        },
        save: async () => { active(); await controller.save(); active(); this.backgroundDrain(); await this.prepareCommits(); active(); },
        remove: async () => { active(); await controller.remove(); active(); this.backgroundDrain(); await this.prepareCommits(); active(); },
        acceptRemote: async () => { active(); await controller.acceptRemote(); },
        keepLocal: async () => { active(); await controller.keepLocal(); },
        dispose: () => {
          this.close(entry);
          if (this.editors.get(editorId) === entry) this.editors.delete(editorId);
        },
        close: ({ flush = false } = {}) => {
          if (entry.closed) return;
          const leaving = flush && this.current(owner, generation) ? this.leavingIntent(controller) : null;
          // The entry closes now, synchronously: the same editor identity may reopen at once
          // (navigation back to this document), and an open entry would refuse it.
          this.close(entry);
          if (this.editors.get(editorId) === entry) this.editors.delete(editorId);
          if (!leaving) return;
          // The request belongs to the engine's queue, not to the controller that just closed:
          // it is delivered by any editor or tab of this owner, now or after a reload.
          this.background(this.commits.save(editorId, leaving.checkpoint, leaving.predecessorId ? { predecessorId: leaving.predecessorId } : undefined)
            .then(() => { this.backgroundDrain(); }), owner, generation);
        },
      };
      this.backgroundDrain();
      return managed;
    } catch (error) {
      this.close(entry);
      if (this.editors.get(editorId) === entry) this.editors.delete(editorId);
      throw error;
    }
  }

  /** What a closing editor still owes the server: a savable draft no request has taken yet. */
  private leavingIntent(controller: EditorController): { checkpoint: SessionCheckpoint; predecessorId?: string } | null {
    let state: EditorState;
    try { state = controller.getState(); } catch { return null; }
    const { checkpoint } = state;
    const pending = Object.entries(checkpoint.pending);
    const unqueued = pending.every(([, request]) => request.generation < checkpoint.editGeneration);
    const waitsForPerson = checkpoint.conflicts.length > 0
      || state.result?.kind === 'conflict' || state.result?.kind === 'refused'
      || Boolean(checkpoint.confirmed.metadata?.deleted)
      || (checkpoint.remoteCandidate !== null && checkpoint.remoteCandidate.value === null);
    if (!checkpoint.dirty || !unqueued || waitsForPerson) return null;
    const predecessorId = pending.sort((a, b) => b[1].generation - a[1].generation)[0]?.[0];
    return { checkpoint: JSON.parse(JSON.stringify(checkpoint)) as SessionCheckpoint, ...(predecessorId ? { predecessorId } : {}) };
  }

  private abortError(): Error {
    return Object.assign(new Error('Editor opening was cancelled'), { name: 'AbortError' });
  }

  private manualForm(owner: string, generation: number, resource: ResourceRef, parentEditorId: string, parent: EditorEntry, slot: string, selection: readonly ManualPath[]): ManagedManualForm {
    if (!this.options.manualScopes) throw new Error('Manual form storage is not configured');
    const registryKey = JSON.stringify([parentEditorId, slot]);
    const previous = this.manualForms.get(registryKey);
    if (previous && previous.parent === parent) {
      if (!equalValues(previous.selection, selection)) throw new Error('Manual form selection changed');
      return previous.form;
    }
    selection = copy(selection);
    const store = this.options.manualScopes;
    const listeners = new Set<() => void>();
    const emit = () => { if (parent.closed || !this.current(owner, generation)) return; for (const listener of listeners) { try { listener(); } catch { /* Rendering cannot change staged intent. */ } } };
    const state = { parent, selection: copy(selection), scopeId: JSON.stringify([parentEditorId, 'manual', slot]), scope: null as ManualScope | null, form: null as unknown as ManagedManualForm, emit };
    this.manualForms.set(registryKey, state);
    let opening: Promise<void> | null = null;
    const active = () => { this.assertCurrent(owner, generation); if (parent.closed || this.manualForms.get(registryKey) !== state) throw new Error('Manual parent editor changed'); };
    const intent = (request: CommitRequest): ManualSavedIntent => ({ id: request.id, owner: request.owner, resource: request.baseline.resource, value: copy(request.value!), predecessorId: request.predecessor });
    const capture = (): ManualCapture => {
      active();
      const checkpoint = parent.controller!.getState().checkpoint;
      const pending = Object.entries(checkpoint.pending).sort((a, b) => b[1].generation - a[1].generation);
      const provenance = selection.flatMap(path => {
        const match = pending.find(([id]) => {
          const request = this.commitRecords.get(id);
          return request?.value && !sameManualSelection(request.baseline.value, request.value, path)
            && sameManualSelection(checkpoint.draft, request.value, path);
        });
        return match ? [{ path, requestId: match[0] }] : [];
      });
      return { checkpoint, provenance, requests: [...this.commitRecords.values()].filter(request => request.owner === owner && request.value).map(intent) };
    };
    const execute = (action: () => Promise<unknown>): Promise<void> => {
      active();
      const result = action(); emit();
      return result.then(() => { active(); emit(); }, error => { emit(); throw error; });
    };
    const start = (sourceScopeId?: string): Promise<void> => {
      active();
      if (opening) return opening;
      if (!sourceScopeId && state.scope?.getState().record.active) return state.scope.settled();
      // Keep what the user actually saw pinned while IndexedDB/provenance reads await.
      const pinned = copy(parent.controller!.getState().checkpoint);
      const run = async () => {
        const records = await this.commits.list(); active();
        records.forEach(request => this.commitRecords.set(request.id, request));
        const source = sourceScopeId ? await store.read(owner, sourceScopeId) : undefined; active();
        if (sourceScopeId && !source?.record) throw new Error('Manual recovery record no longer exists');
        if (source?.record && (!sameResource(source.record.resource, resource) || !equalValues(source.record.selection, selection))) throw new Error('Manual recovery selection mismatch');
        const targetId = source ? JSON.stringify([parentEditorId, 'manual', slot, this.options.operationId()]) : state.scopeId;
        const existing = source ?? await store.read(owner, targetId); active();
        if (existing && !source && existing.parentEditorId !== parentEditorId) throw new Error('Manual form storage identity mismatch');
        let creating = !existing || Boolean(source);
        const frozenCapture = capture(); frozenCapture.checkpoint = pinned;
        // Derive provenance against the pinned displayed value, not a later render.
        frozenCapture.provenance = selection.flatMap(path => {
          const pending = Object.entries(pinned.pending).sort((a, b) => b[1].generation - a[1].generation);
          const match = pending.find(([id]) => { const request = this.commitRecords.get(id); return request?.value
            && !sameManualSelection(request.baseline.value, request.value, path) && sameManualSelection(pinned.draft, request.value, path); });
          return match ? [{ path, requestId: match[0] }] : [];
        });
        state.scopeId = targetId;
        const port = {
          capture: () => frozenCapture,
          isCurrent: () => this.current(owner, generation),
          isAcknowledged: (id: string) => this.commitRecords.get(id)?.state === 'acknowledged',
          persist: async (record: ReturnType<ManualScope['getState']>['record']) => {
            const envelope: StoredManualScope = { owner, scopeId: targetId, parentEditorId, slot, record, commitReferences: record.predecessor ? [record.predecessor.id] : [] };
            if (creating) { await store.create(envelope); creating = false; } else await store.put(envelope);
            if (!record.active) await store.compact(owner, targetId);
          },
          save: async (scopeId: string, checkpoint: import('./session').SessionCheckpoint, options: { predecessorId?: string | null }) => {
            active();
            const request = await this.commits.save(scopeId, checkpoint, options); active();
            if (!request || !request.value) throw new Error('Manual Save did not create an intent');
            await parent.controller!.adoptManualCommit(request, selection); active();
            await this.prepareCommits(); this.backgroundDrain();
            return intent(request);
          },
        };
        const options = { owner, resource, scopeId: targetId, selection, port };
        state.scope?.dispose();
        state.scope = existing?.record ? ManualScope.restore(options, { ...copy(existing.record), scopeId: targetId, active: true }) : ManualScope.begin(options, existing ? existing.watermark.generation + 1 : 0);
        if (existing?.record) {
          if (!source && !existing.record.active && equalValues(existing.record.stage, existing.record.savedSelection)
            && (!existing.record.predecessor || port.isAcknowledged(existing.record.predecessor.id))) {
            await state.scope.restart();
          } else await state.scope.reopen();
        } else await state.scope.settled();
        active(); emit();
      };
      opening = run().finally(() => { opening = null; });
      return opening;
    };
    const requireScope = () => { active(); if (!state.scope) throw new Error('Open the manual form before editing'); return state.scope; };
    state.form = {
      getState: () => { active(); return state.scope?.getState() ?? null; },
      subscribe: listener => { active(); listeners.add(listener); return () => { listeners.delete(listener); }; },
      begin: () => start(),
      update: updater => execute(() => requireScope().update(updater)),
      save: updater => execute(async () => {
        const scope = requireScope();
        if (updater) { const staged = scope.update(updater); const saving = scope.save(); await Promise.all([staged, saving]); }
        else await scope.save();
        if (!scope.getState().dirty) await scope.cancel();
      }),
      cancel: () => execute(() => requireScope().cancel()),
      retry: () => execute(async () => { if (state.scope) await state.scope.retryPersistence(); else await start(); await this.retry(resource); }),
      listRecoverable: async () => { active(); const values = await store.list(owner, resource); active(); return values.filter(value => equalValues(value.record.selection, selection)
        && (!equalValues(value.record.stage, value.record.savedSelection) || Boolean(value.record.predecessor && this.commitRecords.get(value.record.predecessor.id)?.state !== 'acknowledged'))); },
      recover: sourceScopeId => start(sourceScopeId),
    };
    return state.form;
  }

  private onRuntime(event: RuntimeEvent): void {
    if (this.disposed || event.owner !== this.owner) return;
    if (event.kind === 'journal') {
      this.publishPending(event.entries);
    } else if (event.result.kind === 'acknowledged') {
      this.background(this.refreshAcknowledged(event.result.operationId, event.result.snapshot, event.owner, this.generation), event.owner, this.generation);
      if (this.options.collections) this.background(this.refreshAcknowledgedCollections(event.result.operationId,
        [event.result.snapshot.resource.collection, ...(event.result.affected ?? []).map(effect => effect.resource.collection)],
        event.owner, this.generation), event.owner, this.generation);
    }
  }

  private collectionReader(): CollectionReader {
    if (!this.options.collections) throw new Error('Collection reads are not configured');
    return this.options.collections;
  }

  private async refreshAcknowledgedCollections(operationId: string, collections: string[], owner: string, generation: number): Promise<void> {
    await Promise.resolve();
    if (!this.current(owner, generation) || !this.canDeliver() || this.refreshedCollectionOperations.has(operationId)) return;
    this.refreshedCollectionOperations.add(operationId);
    if (this.refreshedCollectionOperations.size > 256) this.refreshedCollectionOperations.delete(this.refreshedCollectionOperations.values().next().value!);
    // ResourceObserver refreshes only registered interests; unopened lists cost no read.
    await Promise.all([...new Set(collections)].map(collection => this.options.observer.refresh(collectionHeadRef(owner, collection))));
  }

  private publishPending(entries: JournalEntry[], force = false): void {
    this.pendingVersion += 1;
    const next = copy(entries.filter(entry => entry.command.owner === this.owner));
    if (!force && equalValues(next, this.pending)) return;
    const changed = [...this.editors.values()].filter(entry => !entry.closed && entry.controller
      && !equalValues(this.editorDelivery(entry, this.pending), this.editorDelivery(entry, next)));
    this.pending = next;
    for (const listener of this.pendingListeners) {
      try { listener(); } catch { /* Rendering never changes delivery state. */ }
    }
    changed.forEach(entry => this.emit(entry));
  }

  private editorDelivery(entry: EditorEntry, entries: JournalEntry[]): JournalEntry[] {
    if (entry.closed || !entry.controller) return [];
    const checkpoint = entry.controller.getState().checkpoint;
    const operations = new Set(Object.keys(checkpoint.pending));
    for (const id of Object.keys(checkpoint.pending)) {
      const command = this.commitRecords.get(id)?.command;
      if (command) operations.add(command.operationId);
    }
    return entries.filter(item => operations.has(item.command.operationId)
      && sameResource(checkpoint.confirmed.resource, item.command.resource));
  }

  private async refreshAcknowledged(operationId: string, snapshot: ResourceSnapshot, owner: string, generation: number): Promise<void> {
    // Let every runtime subscriber enqueue its accepted projection before checking it.
    await Promise.resolve();
    if (!this.current(owner, generation) || this.refreshedOperations.has(operationId)) return;
    const affected = [...this.editors.values()].filter(entry => !entry.closed && entry.controller
      && sameResource(entry.controller.getState().checkpoint.confirmed.resource, snapshot.resource));
    if (!affected.length) return;
    await Promise.all(affected.map(entry => entry.controller!.settled()));
    if (!this.current(owner, generation) || !this.canDeliver() || this.refreshedOperations.has(operationId)
      || !affected.some(entry => !entry.closed && entry.stopObservation)) return;
    this.refreshedOperations.add(operationId);
    // The bounded set prevents duplicate receipt replays from adding another read loop.
    if (this.refreshedOperations.size > 256) this.refreshedOperations.delete(this.refreshedOperations.values().next().value!);
    // A live listener that already proved this revision needs no extra billed read.
    if (affected.every(entry => entry.observation.readiness === 'server' && entry.observation.snapshot
      && canReplaceSnapshot(snapshot, entry.observation.snapshot))) return;
    await this.options.observer.refresh(snapshot.resource);
  }

  private async openingSnapshot(owner: string, generation: number, resource: ResourceRef, editorId: string): Promise<ResourceSnapshot> {
    try {
      return await this.read(resource);
    } catch (error) {
      this.assertCurrent(owner, generation);
      const saved = await this.options.checkpoints.read(owner, editorId);
      this.assertCurrent(owner, generation);
      if (!saved) throw error;
      if (!sameResource(saved.checkpoint.confirmed.resource, resource)) throw new Error('Checkpoint identity mismatch');
      // Controller.open owns restoration and independently validates the full identity.
      this.options.onError?.(error);
      return saved.checkpoint.confirmed;
    }
  }

  private persistSnapshot(owner: string, generation: number, snapshot: ResourceSnapshot): Promise<ResourceSnapshot> {
    const frozen = copy(snapshot);
    const key = cacheKey(owner, frozen.resource);
    const operation = (this.cacheWrites.get(key)?.operation ?? Promise.resolve()).catch(() => undefined).then(async () => {
      this.assertCurrent(owner, generation);
      const current = await this.options.snapshots.read(owner, frozen.resource);
      this.assertCurrent(owner, generation);
      if (current && !sameResource(current.resource, frozen.resource)) throw new Error('Cached snapshot identity mismatch');
      if (!canReplaceSnapshot(current, frozen)) return current!;
      if (!equalValues(current, frozen)) await this.options.snapshots.put(owner, frozen);
      this.assertCurrent(owner, generation);
      return frozen;
    });
    this.cacheWrites.set(key, { owner, generation, operation });
    void operation.finally(() => {
      if (this.cacheWrites.get(key)?.operation === operation) this.cacheWrites.delete(key);
    }).catch(() => undefined);
    return operation;
  }

  private close(entry: EditorEntry): void {
    entry.closed = true;
    entry.stopObservation?.();
    entry.stopObservation = null;
    entry.stopController?.();
    entry.stopController = null;
    entry.controller?.dispose();
    entry.controller = null;
    entry.listeners.clear();
  }

  private emit(entry: EditorEntry): void {
    for (const listener of entry.listeners) {
      try { listener(); } catch { /* UI rendering never changes data delivery. */ }
    }
  }

  private backgroundDrain(): void {
    if (this.disposed || !this.owner) return;
    this.background(this.retry(), this.owner, this.generation);
  }

  private async prepareCommits(): Promise<void> {
    // The request is already durable. Preparation failures remain retryable work,
    // rather than misreporting that the user's Save was discarded.
    try { await this.commits.drain(false); } catch (error) { this.options.onError?.(error); }
  }

  private background(operation: Promise<unknown>, owner: string, generation: number): void {
    void operation.catch(error => {
      if (this.current(owner, generation)) this.options.onError?.(error);
    });
  }

  private canDeliver(): boolean {
    return !this.disposed && this.owner !== null && this.online && this.visible;
  }

  private requireOwner(): string {
    if (this.disposed) throw new Error('DataEngine has been disposed');
    if (!this.owner) throw new Error('Authentication required');
    return this.owner;
  }

  private current(owner: string, generation: number): boolean {
    return !this.disposed && owner === this.owner && generation === this.generation;
  }

  private assertCurrent(owner: string, generation: number): void {
    if (!this.current(owner, generation)) throw new Error('Account changed');
  }

  private validateResource(resource: ResourceRef, owner: string): void {
    const policy = getResourcePolicy(resource.collection);
    if (!isValidIdentifier(resource.id)) throw new Error('Invalid resource identifier');
    if (policy.ownerField === 'id' && resource.id !== owner) throw new Error('Owner identity mismatch');
  }
}
