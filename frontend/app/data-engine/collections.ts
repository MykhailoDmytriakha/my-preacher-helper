import { collectionHeadRef, feedVersion } from './feed';
import { equalValues, getResourcePolicy, isValidIdentifier } from './protocol';
import { canReplaceSnapshot } from './snapshotFreshness';

import type { CollectionDocumentView } from './collectionView';
import type { SnapshotStore } from './engine';
import type { Observation, ResourceObserver } from './observer';
import type { CollectionChanges, CollectionPage, CollectionTransport, ResourceSnapshot } from './types';

export interface CollectionCursor {
  version: number;
  initialized: boolean;
  /** Local storage CAS revision, independent of the server's change sequence. */
  revision: number;
}

export interface CollectionCursorStore {
  read(owner: string, collection: string): Promise<CollectionCursor | undefined>;
  put(owner: string, collection: string, expected: CollectionCursor | undefined,
    next: Pick<CollectionCursor, 'version' | 'initialized'>): Promise<CollectionCursor>;
}

export interface CollectionSnapshotStore extends SnapshotStore {
  list(owner: string, collection: string): Promise<ResourceSnapshot[]>;
}

export interface CollectionState {
  /** Includes tombstones and confirmed legacy absences; views choose which rows to display. */
  snapshots: ResourceSnapshot[];
  /** Added by DataEngine: submitted local intent is separate from confirmed snapshots. */
  documents?: CollectionDocumentView[];
  complete: boolean;
  freshness: 'unknown' | 'cache' | 'server';
  checking: boolean;
  version: number;
  error: string | null;
}

export interface CollectionReaderOptions {
  transport: CollectionTransport;
  snapshots: CollectionSnapshotStore;
  cursors: CollectionCursorStore;
  observer: ResourceObserver;
  onError?: (error: unknown) => void;
  pageSize?: number;
  /** Protect against an endless or damaged feed without silently truncating a collection. */
  maxPages?: number;
  /** First retry delay after a failed automatic read; doubles up to 120 seconds. */
  retryIntervalMs?: number;
  /**
   * Legacy writers do not publish feed events, so while rollout is mixed an open list is swept
   * on this timer. Each sweep reads every row, so the timer is a safety net, not the freshness
   * path: opening a list, returning to the tab and reconnecting sweep at once.
   */
  legacySweepIntervalMs?: number;
}

type Listener = (state: CollectionState) => void;
interface CollectionEntry {
  owner: string;
  collection: string;
  state: CollectionState;
  cursor: CollectionCursor | undefined;
  loaded: boolean;
  loading: { generation: number; promise: Promise<void> } | null;
  inFlight: { generation: number; promise: Promise<CollectionState>; explicit: boolean } | null;
  listeners: Set<Listener>;
  stopHead: (() => void) | null;
  head: Observation | null;
  headVersion: number | null;
  closed: boolean;
  /** The server said legacy writers may still change this collection without a feed event. */
  legacyOpen: boolean;
  /** Whether the server has been asked at all since this reader was created. */
  asked: boolean;
  refreshTimer: ReturnType<typeof setTimeout> | null;
  refreshFailures: number;
}

const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const initialState = (): CollectionState => ({ snapshots: [], complete: false, freshness: 'unknown', checking: false, version: 0, error: null });
const failure = (message: string, code = 'data-loss') => Object.assign(new Error(message), { code });
const errorCode = (error: unknown) => error && typeof error === 'object' && 'code' in error ? error.code : undefined;

/** Firestore document IDs sort by UTF-8, equivalently by Unicode scalar value. */
function compareIds(left: string, right: string): number {
  const a = Array.from(left), b = Array.from(right);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const difference = a[index].codePointAt(0)! - b[index].codePointAt(0)!;
    if (difference) return difference;
  }
  return a.length - b.length;
}

/** Lists listen to one small head document and fetch only its missing change pages. */
export class CollectionReader {
  private owner: string | null = null;
  private generation = 0;
  private online = true;
  private visible = true;
  private disposed = false;
  private readonly entries = new Map<string, CollectionEntry>();
  private readonly pageSize: number;
  private readonly maxPages: number;
  private readonly retryIntervalMs: number;
  private readonly legacySweepIntervalMs: number;

  constructor(private readonly options: CollectionReaderOptions) {
    this.pageSize = options.pageSize ?? 100;
    this.maxPages = options.maxPages ?? 1_000;
    this.retryIntervalMs = options.retryIntervalMs ?? 15_000;
    // Five minutes: one sweep of 20 rows costs ~24 reads, so a visible list costs ~300 reads an
    // hour instead of ~6,000 at the former 15 s — the free daily allowance is 50,000 for everyone.
    this.legacySweepIntervalMs = options.legacySweepIntervalMs ?? 300_000;
    if (!Number.isInteger(this.pageSize) || this.pageSize < 1 || this.pageSize > 100
      || !Number.isInteger(this.maxPages) || this.maxPages < 1
      || ![this.retryIntervalMs, this.legacySweepIntervalMs].every(delay => Number.isFinite(delay) && delay >= 1)) {
      throw failure('Invalid collection paging budget', 'invalid-argument');
    }
  }

  setOwner(owner: string | null): void {
    if (this.disposed || this.owner === owner) return;
    this.owner = owner;
    this.generation += 1;
    for (const entry of this.entries.values()) {
      entry.closed = true;
      this.clearRefreshTimer(entry);
      entry.stopHead?.();
      entry.state = initialState();
      this.emit(entry);
      entry.listeners.clear();
    }
    this.entries.clear();
    this.options.observer.setOwner(owner);
  }

  setOnline(online: boolean): void {
    if (this.disposed || this.online === online) return;
    this.online = online;
    this.options.observer.setOnline(online);
    this.restart();
  }

  setVisible(visible: boolean): void {
    if (this.disposed || this.visible === visible) return;
    this.visible = visible;
    this.options.observer.setVisible(visible);
    this.restart();
  }

  async read(collection: string, options?: { allowIncompleteCache?: boolean }): Promise<CollectionState> {
    const entry = this.entry(collection);
    const generation = this.generation;
    await this.load(entry, generation);
    this.assertCurrent(entry, generation);
    if (!entry.cursor?.initialized && this.online && this.visible) return this.refresh(collection);
    if (!options?.allowIncompleteCache) this.requireAvailableCache(entry);
    return copy(entry.state);
  }

  watch(collection: string, listener: Listener): () => void {
    const entry = this.entry(collection);
    const subscription: Listener = state => listener(state);
    entry.listeners.add(subscription);
    this.notify(subscription, entry.state);
    this.startHead(entry);
    const generation = this.generation;
    this.background(this.load(entry, generation).then(() => {
      this.assertCurrent(entry, generation);
      if (!entry.listeners.size) return;
      if (!this.online || !this.visible) this.requireAvailableCache(entry);
      // Every opening of a list asks again while legacy writers share the collection: their
      // writes never move the head, so an unchanged head proves nothing about them.
      else if (entry.listeners.size && (this.needsRefresh(entry) || entry.legacyOpen)) return this.requestRefresh(collection, false).then(() => undefined);
    }), entry, generation);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      entry.listeners.delete(subscription);
      if (!entry.listeners.size) {
        this.clearRefreshTimer(entry);
        entry.stopHead?.();
        entry.stopHead = null;
      }
    };
  }

  refresh(collection: string): Promise<CollectionState> { return this.requestRefresh(collection, true); }

  private requestRefresh(collection: string, explicit: boolean): Promise<CollectionState> {
    const entry = this.entry(collection);
    const generation = this.generation;
    if (entry.inFlight?.generation === generation) {
      // An explicit caller may join a watch's request and owns its completion.
      entry.inFlight.explicit ||= explicit;
      return entry.inFlight.promise.then(copy);
    }
    // Every failed automatic read gets a cooldown, even before the first server
    // answer establishes legacy mode. Head events cannot bypass it; explicit Retry may.
    if (!explicit && entry.refreshFailures > 0 && entry.refreshTimer !== null) return Promise.resolve(copy(entry.state));
    this.clearRefreshTimer(entry);
    const promise = this.synchronize(entry, generation);
    entry.inFlight = { generation, promise, explicit };
    const finish = (failed = false) => {
      if (entry.inFlight?.promise !== promise) return;
      entry.inFlight = null;
      entry.refreshFailures = failed ? entry.refreshFailures + 1 : 0;
      this.scheduleRefresh(entry);
    };
    void promise.then(() => {
      finish();
      if (this.current(entry, generation) && this.online && this.visible && entry.listeners.size && this.needsRefresh(entry)) {
        this.background(this.requestRefresh(collection, false), entry, generation);
      }
    }, () => finish(true));
    return promise.then(copy);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    for (const entry of this.entries.values()) {
      entry.closed = true;
      this.clearRefreshTimer(entry);
      entry.stopHead?.();
      entry.listeners.clear();
    }
    this.entries.clear();
  }

  private entry(collection: string): CollectionEntry {
    if (this.disposed) throw failure('Collection reader has been disposed', 'inactive');
    if (!this.owner) throw failure('Authentication required', 'unauthenticated');
    collectionHeadRef(this.owner, collection);
    let entry = this.entries.get(collection);
    if (!entry) {
      entry = { owner: this.owner, collection, state: initialState(), cursor: undefined, loaded: false,
        loading: null, inFlight: null, listeners: new Set(), stopHead: null, head: null, headVersion: null, closed: false,
        legacyOpen: false, asked: false, refreshTimer: null, refreshFailures: 0 };
      this.entries.set(collection, entry);
    }
    return entry;
  }

  private async load(entry: CollectionEntry, generation: number, force = false): Promise<void> {
    if (entry.loaded && !force) return;
    if (entry.loading?.generation === generation) return entry.loading.promise;
    const promise = (async () => {
      // Rows commit before their cursor. Reading the cursor first avoids
      // pairing an older row snapshot with a newer cross-tab cursor forever.
      const cursor = await this.options.cursors.read(entry.owner, entry.collection);
      this.assertCurrent(entry, generation);
      const snapshots = await this.options.snapshots.list(entry.owner, entry.collection);
      this.assertCurrent(entry, generation);
      this.validateSnapshots(entry, snapshots);
      if (cursor && (!Number.isSafeInteger(cursor.revision) || cursor.revision < 1 || typeof cursor.initialized !== 'boolean')) throw failure('Invalid cached collection cursor');
      if (cursor) feedVersion(cursor.version);
      entry.cursor = cursor;
      entry.loaded = true;
      entry.state = { ...entry.state, snapshots: copy(snapshots), complete: cursor?.initialized ?? false,
        version: cursor?.version ?? 0, freshness: snapshots.length || cursor?.initialized ? 'cache' : 'unknown' };
      this.emit(entry);
    })();
    entry.loading = { generation, promise };
    try { await promise; } finally { if (entry.loading?.promise === promise) entry.loading = null; }
  }

  private async synchronize(entry: CollectionEntry, generation: number): Promise<CollectionState> {
    try {
      await this.load(entry, generation, true);
      this.assertCurrent(entry, generation);
      if (!this.online || !this.visible) {
        this.requireAvailableCache(entry);
        return copy(entry.state);
      }
      entry.state = { ...entry.state, checking: true, freshness: entry.state.snapshots.length ? 'cache' : 'unknown', error: null };
      this.emit(entry);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await this.advance(entry, generation);
          await this.reloadRows(entry, generation);
          this.assertCurrent(entry, generation);
          entry.asked = true;
          entry.state = { ...entry.state, complete: true, freshness: 'server', checking: false, version: entry.cursor!.version, error: null };
          if (entry.headVersion !== null && entry.headVersion > entry.state.version) entry.state.freshness = 'cache';
          this.emit(entry);
          return copy(entry.state);
        } catch (error) {
          if (errorCode(error) !== 'cursor-changed' || attempt === 2) throw error;
          await this.load(entry, generation, true);
        }
      }
      throw failure('Collection cursor kept changing', 'cursor-changed');
    } catch (error) {
      if (this.current(entry, generation)) {
        if (error instanceof Error && error.name === 'AbortError') {
          entry.state = { ...entry.state, checking: false };
          this.emit(entry);
        } else this.report(entry, error);
      }
      throw error;
    }
  }

  private async advance(entry: CollectionEntry, generation: number): Promise<void> {
    if (!entry.cursor?.initialized) return this.hydrate(entry, generation);
    // A complete mixed-mode listing already catches the feed up from its page anchor.
    // Reading the same feed before it adds cost but cannot prove legacy freshness.
    if (entry.legacyOpen) return this.hydrate(entry, generation);
    try { await this.changes(entry, generation, entry.cursor.version, true); }
    catch (error) {
      if (errorCode(error) !== 'feed-reset') throw error;
      return this.hydrate(entry, generation);
    }
    // MIXED MODE. Between "the engine serves this collection" and "legacy writers are closed"
    // (activation.ts) bundles that have not updated still write the legacy way, and a legacy
    // write raises no feed event: the feed just said "nothing changed" about a collection in
    // which a council may have been edited or deleted. The whole list is the only witness, and
    // reconcileAbsence turns an unversioned row that vanished into a confirmed absence.
    // The cost is one listing per synchronisation, so it lasts only while the server says so.
    if (entry.legacyOpen) await this.hydrate(entry, generation);
  }

  private async hydrate(entry: CollectionEntry, generation: number): Promise<void> {
    // Only rows present before this read can be missing from its server view.
    // A different tab may confirm a new row after our final feed response.
    const candidates = copy(entry.state.snapshots);
    if (!entry.cursor || entry.cursor.initialized) {
      await this.commitCursor(entry, generation, { version: entry.cursor?.version ?? 0, initialized: false });
    }
    entry.state = { ...entry.state, complete: false };
    this.emit(entry);
    const seen = new Set<string>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    let anchor: number | undefined;
    let latestPageVersion = entry.cursor!.version;
    for (let pageNumber = 0; ; pageNumber += 1) {
      if (pageNumber >= this.maxPages) throw failure('Collection pagination exceeded its request budget');
      this.assertCurrent(entry, generation, true);
      const page = await this.options.transport.list(entry.owner, entry.collection, { limit: this.pageSize, ...(cursor === undefined ? {} : { cursor }) });
      this.assertCurrent(entry, generation, true);
      this.validatePage(entry, page, cursor, cursors);
      entry.legacyOpen = page.legacyOpen === true;
      if (page.version < latestPageVersion) throw failure('Collection page moved backwards');
      anchor ??= page.version;
      latestPageVersion = page.version;
      await this.persistPage(entry, generation, page.snapshots);
      page.snapshots.forEach(snapshot => seen.add(snapshot.resource.id));
      await this.reloadRows(entry, generation);
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
      cursors.add(cursor);
    }
    const version = await this.changes(entry, generation, anchor!, false, seen, latestPageVersion);
    await this.reconcileAbsence(entry, generation, seen, candidates);
    await this.commitCursor(entry, generation, { version, initialized: true });
  }

  private async changes(entry: CollectionEntry, generation: number, after: number, commit: boolean,
    seen?: Set<string>, minimumVersion = after): Promise<number> {
    for (let pageNumber = 0; pageNumber < this.maxPages; pageNumber += 1) {
      this.assertCurrent(entry, generation, true);
      const page = await this.options.transport.changes(entry.owner, entry.collection, after, { limit: this.pageSize });
      this.assertCurrent(entry, generation, true);
      this.validateChanges(entry, page, after, minimumVersion);
      entry.legacyOpen = page.legacyOpen === true;
      if (page.resetRequired) throw failure('Collection change history requires a full refresh', 'feed-reset');
      await this.persistPage(entry, generation, page.snapshots);
      page.snapshots.forEach(snapshot => seen?.add(snapshot.resource.id));
      if (commit) await this.commitCursor(entry, generation, { version: page.cursor, initialized: true });
      after = page.cursor;
      minimumVersion = page.version;
      if (!page.hasMore) return after;
    }
    throw failure('Collection changes exceeded their request budget');
  }

  private async persistPage(entry: CollectionEntry, generation: number, snapshots: ResourceSnapshot[]): Promise<void> {
    this.validateSnapshots(entry, snapshots);
    for (const snapshot of snapshots) {
      this.assertCurrent(entry, generation, true);
      const current = await this.options.snapshots.read(entry.owner, snapshot.resource);
      this.assertCurrent(entry, generation, true);
      if (canReplaceSnapshot(current, snapshot)) await this.options.snapshots.put(entry.owner, copy(snapshot));
      this.assertCurrent(entry, generation, true);
    }
  }

  private async reconcileAbsence(entry: CollectionEntry, generation: number, seen: Set<string>, candidates: ResourceSnapshot[]): Promise<void> {
    const cached = await this.options.snapshots.list(entry.owner, entry.collection);
    this.assertCurrent(entry, generation, true);
    this.validateSnapshots(entry, cached);
    const current = new Map(cached.map(snapshot => [snapshot.resource.id, snapshot]));
    for (const snapshot of candidates) {
      if (seen.has(snapshot.resource.id) || snapshot.value === null
        || !equalValues(snapshot, current.get(snapshot.resource.id))) continue;
      if (snapshot.metadata) throw failure('A versioned document is missing its deletion tombstone');
      await this.persistPage(entry, generation, [{ resource: snapshot.resource, value: null, metadata: null }]);
    }
  }

  private async commitCursor(entry: CollectionEntry, generation: number, next: Pick<CollectionCursor, 'version' | 'initialized'>): Promise<void> {
    this.assertCurrent(entry, generation, true);
    const committed = await this.options.cursors.put(entry.owner, entry.collection, entry.cursor, next);
    this.assertCurrent(entry, generation, true);
    entry.cursor = committed;
    entry.state = { ...entry.state, complete: committed.initialized, version: committed.version };
  }

  private async reloadRows(entry: CollectionEntry, generation: number): Promise<void> {
    const snapshots = await this.options.snapshots.list(entry.owner, entry.collection);
    this.assertCurrent(entry, generation);
    this.validateSnapshots(entry, snapshots);
    entry.state = { ...entry.state, snapshots: copy(snapshots) };
    this.emit(entry);
  }

  private validateSnapshots(entry: CollectionEntry, snapshots: ResourceSnapshot[]): void {
    const policy = getResourcePolicy(entry.collection);
    const seen = new Set<string>();
    for (const snapshot of snapshots) {
      const resource = snapshot.resource;
      if (resource.collection !== entry.collection || !isValidIdentifier(resource.id) || seen.has(resource.id)
        || (policy.ownerField === 'id' && resource.id !== entry.owner)
        || (policy.ownerField !== 'id' && snapshot.value !== null && snapshot.value[policy.ownerField] !== entry.owner)) throw failure('Collection snapshot identity mismatch');
      seen.add(resource.id);
    }
  }

  private validatePage(entry: CollectionEntry, page: CollectionPage, cursor: string | undefined, cursors: Set<string>): void {
    feedVersion(page.version);
    this.validateSnapshots(entry, page.snapshots);
    if (page.snapshots.length > this.pageSize) throw failure('Collection page exceeded its requested limit');
    let previous = cursor;
    for (const snapshot of page.snapshots) {
      if (previous !== undefined && compareIds(snapshot.resource.id, previous) <= 0) throw failure('Collection page did not advance');
      previous = snapshot.resource.id;
    }
    if (page.nextCursor !== null && (!isValidIdentifier(page.nextCursor) || cursors.has(page.nextCursor)
      || page.nextCursor !== previous || !page.snapshots.length)) throw failure('Invalid collection pagination cursor');
  }

  private validateChanges(entry: CollectionEntry, page: CollectionChanges, after: number, minimumVersion: number): void {
    feedVersion(page.version); feedVersion(page.cursor);
    this.validateSnapshots(entry, page.snapshots);
    if (page.version < minimumVersion || page.cursor < after || page.cursor > page.version
      || page.snapshots.length > this.pageSize) throw failure('Collection change cursor moved backwards');
    if (page.resetRequired) return;
    if (page.hasMore !== (page.cursor < page.version) || (page.hasMore && page.cursor === after)
      || (page.cursor > after && page.snapshots.length === 0)) throw failure('Collection change page did not advance');
  }

  private startHead(entry: CollectionEntry): void {
    if (entry.stopHead || !entry.listeners.size || entry.closed) return;
    const stop = this.options.observer.watch(entry.owner, collectionHeadRef(entry.owner, entry.collection), head => {
      if (entry.closed || !entry.listeners.size || entry.owner !== this.owner || this.disposed) return;
      entry.head = head;
      try {
        if (head.snapshot && head.source) entry.headVersion = head.snapshot.value === null ? 0 : feedVersion(head.snapshot.value.version);
        entry.state = { ...entry.state, freshness: !entry.state.checking && !entry.state.error && head.readiness === 'server'
          && entry.state.complete && entry.headVersion !== null && entry.state.version >= entry.headVersion
          ? 'server' : entry.state.snapshots.length || entry.state.complete ? 'cache' : 'unknown' };
        this.emit(entry);
        if (entry.loaded && this.online && this.visible && this.needsRefresh(entry)) {
          this.background(this.requestRefresh(entry.collection, false), entry, this.generation);
        }
      } catch (error) { this.report(entry, error); }
    });
    if (entry.closed || !entry.listeners.size) stop();
    else entry.stopHead = stop;
  }

  private needsRefresh(entry: CollectionEntry): boolean {
    // Once per reader the server is asked regardless of the head: only its answer says whether
    // legacy writers still share this collection, and a cache from an earlier session cannot.
    return !entry.asked || !entry.cursor?.initialized || (entry.headVersion !== null && entry.headVersion > entry.cursor.version);
  }

  private restart(): void {
    this.generation += 1;
    for (const entry of this.entries.values()) {
      this.clearRefreshTimer(entry);
      entry.state = { ...entry.state, checking: false, freshness: entry.state.snapshots.length || entry.state.complete ? 'cache' : 'unknown' };
      this.emit(entry);
      if (this.online && this.visible && entry.listeners.size) this.background(this.requestRefresh(entry.collection, false), entry, this.generation);
    }
  }

  private clearRefreshTimer(entry: CollectionEntry): void {
    if (entry.refreshTimer !== null) clearTimeout(entry.refreshTimer);
    entry.refreshTimer = null;
  }

  private scheduleRefresh(entry: CollectionEntry): void {
    this.clearRefreshTimer(entry);
    if (!this.current(entry, this.generation) || (!entry.legacyOpen && entry.refreshFailures === 0) || !this.online || !this.visible
      || !entry.listeners.size || entry.inFlight) return;
    const generation = this.generation;
    const delay = entry.refreshFailures > 0
      ? Math.min(Math.max(120_000, this.retryIntervalMs), this.retryIntervalMs * 2 ** Math.min(entry.refreshFailures, 16))
      : this.legacySweepIntervalMs;
    entry.refreshTimer = setTimeout(() => {
      entry.refreshTimer = null;
      if (this.current(entry, generation) && this.online && this.visible && entry.listeners.size) {
        this.background(this.requestRefresh(entry.collection, false), entry, generation);
      }
    }, delay);
  }

  private requireAvailableCache(entry: CollectionEntry): void {
    if (!entry.state.complete && !entry.state.snapshots.length) throw failure('Collection cache is unavailable', 'cache-unavailable');
  }

  private current(entry: CollectionEntry, generation: number): boolean {
    return !this.disposed && !entry.closed && entry.owner === this.owner && this.generation === generation;
  }

  private assertCurrent(entry: CollectionEntry, generation: number, network = false): void {
    if (!this.current(entry, generation) || (network && (!this.online || !this.visible
      || (!entry.listeners.size && !entry.inFlight?.explicit)))) {
      throw Object.assign(new Error('Collection reader changed during the request'), { name: 'AbortError' });
    }
  }

  private background(operation: Promise<unknown>, entry: CollectionEntry, generation: number): void {
    void operation.catch(error => { if (this.current(entry, generation) && !(error instanceof Error && error.name === 'AbortError')) this.report(entry, error); });
  }

  private report(entry: CollectionEntry, error: unknown): void {
    entry.state = { ...entry.state, checking: false, freshness: entry.state.snapshots.length || entry.state.complete ? 'cache' : 'unknown',
      error: error instanceof Error ? error.message : 'Collection synchronization failed' };
    this.emit(entry);
    try { this.options.onError?.(error); } catch { /* Diagnostics never change the durable cursor. */ }
  }

  private emit(entry: CollectionEntry): void {
    for (const listener of entry.listeners) this.notify(listener, entry.state);
  }

  private notify(listener: Listener, state: CollectionState): void {
    try { listener(copy(state)); } catch { /* UI rendering never changes read progress. */ }
  }
}
