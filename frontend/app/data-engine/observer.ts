import { serverCopyIsNewer, type VersionedCopy } from '../utils/readFreshness';

import type { EngineTransport, ResourceRef, ResourceSnapshot } from './types';

export interface Observation {
  snapshot: ResourceSnapshot | null;
  source: 'server' | 'cache' | null;
  /** A retained value is readable even when its present freshness is unknown. */
  readiness: 'unknown' | 'cache' | 'server';
  checking: boolean;
  error: boolean;
}

export interface SnapshotEvent {
  snapshot: ResourceSnapshot;
  source: 'server' | 'cache';
}

export interface ObservationSource {
  /** The adapter must exclude snapshots containing unacknowledged local writes. */
  listen(
    owner: string,
    resource: ResourceRef,
    onSnapshot: (event: SnapshotEvent) => void,
    onError: () => void,
  ): () => void;
}

export interface ObserverTimers {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface ResourceObserverOptions {
  source: ObservationSource;
  transport: Pick<EngineTransport, 'read'>;
  timers?: ObserverTimers;
  now?: () => number;
  silenceMs?: number;
  pollIntervalMs?: number;
  leaseMs?: number;
  maxBackoffMs?: number;
}

type Listener = (observation: Observation) => void;
interface Entry {
  owner: string;
  resource: ResourceRef;
  listeners: Set<Listener>;
  state: Observation;
  epoch: number;
  active: boolean;
  stop: (() => void) | null;
  timer: unknown;
  inFlight: Promise<void> | null;
  lastHttpAt: number | null;
  lastServerAt: number | null;
  healthy: boolean;
  failures: number;
  snapshotSequence: number;
  startedAt: number;
}

const emptyState = (): Observation => ({
  snapshot: null, source: null, readiness: 'unknown', checking: false, error: false,
});
const keyOf = (owner: string, resource: ResourceRef) => JSON.stringify([owner, resource.collection, resource.id]);

/**
 * One subscription and one bounded fallback loop per actively viewed document.
 * This layer publishes evidence; DataSession decides whether an editor may adopt it.
 * Authentication, browser lifecycle events and Firestore metadata belong in adapters.
 */
export class ResourceObserver {
  private readonly entries = new Map<string, Entry>();
  private readonly timers: ObserverTimers;
  private readonly now: () => number;
  private readonly silenceMs: number;
  private readonly pollIntervalMs: number;
  private readonly leaseMs: number;
  private readonly maxBackoffMs: number;
  private owner: string | null = null;
  private online = true;
  private visible = true;
  private disposed = false;

  constructor(private readonly options: ResourceObserverOptions) {
    this.timers = options.timers ?? {
      setTimeout: (callback, delay) => setTimeout(callback, delay),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    };
    this.now = options.now ?? Date.now;
    this.silenceMs = Math.max(1, options.silenceMs ?? 2_500);
    this.pollIntervalMs = Math.max(1, options.pollIntervalMs ?? 15_000);
    this.leaseMs = Math.max(this.pollIntervalMs, options.leaseMs ?? 120_000);
    this.maxBackoffMs = Math.max(this.pollIntervalMs, options.maxBackoffMs ?? 120_000);
  }

  watch(owner: string, resource: ResourceRef, listener: Listener): () => void {
    if (this.disposed) throw new Error('The resource observer has been disposed.');
    const key = keyOf(owner, resource);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        owner, resource: { ...resource }, listeners: new Set(), state: emptyState(),
        epoch: 0, active: false, stop: null, timer: null, inFlight: null,
        lastHttpAt: null, lastServerAt: null, healthy: false, failures: 0,
        snapshotSequence: 0, startedAt: 0,
      };
      this.entries.set(key, entry);
    }
    // Each watch owns its reference even if callers reuse the same function.
    const subscription: Listener = (state) => listener(state);
    entry.listeners.add(subscription);
    subscription(entry.state);
    if (!entry.active) this.start(entry, false);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      entry.listeners.delete(subscription);
      if (entry.listeners.size === 0) {
        this.stop(entry);
        this.entries.delete(key);
      }
    };
  }

  setOwner(owner: string | null): void {
    if (this.owner === owner || this.disposed) return;
    this.owner = owner;
    for (const entry of this.entries.values()) {
      this.stop(entry);
      // A component retained across sign-out must not retain another account's data.
      entry.state = emptyState();
      entry.lastHttpAt = null;
      entry.lastServerAt = null;
      entry.failures = 0;
      this.emit(entry);
      this.start(entry, false);
    }
  }

  setOnline(online: boolean): void {
    if (this.online === online || this.disposed) return;
    this.online = online;
    this.restart();
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible || this.disposed) return;
    this.visible = visible;
    this.restart();
  }

  /** Explicit user refresh is immediate; automatic retries obey the polling budget. */
  refresh(resource: ResourceRef): Promise<void> {
    if (!this.owner) return Promise.resolve();
    const entry = this.entries.get(keyOf(this.owner, resource));
    return entry ? this.read(entry) : Promise.resolve();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.entries.values()) this.stop(entry);
    this.entries.clear();
  }

  private eligible(entry: Entry): boolean {
    return !this.disposed && this.owner === entry.owner && this.visible && entry.listeners.size > 0;
  }

  private restart(): void {
    for (const entry of this.entries.values()) {
      this.stop(entry);
      entry.state = { ...entry.state, readiness: 'unknown', checking: false };
      this.emit(entry);
      this.start(entry, true);
    }
  }

  private stop(entry: Entry): void {
    entry.epoch += 1;
    entry.active = false;
    entry.healthy = false;
    entry.stop?.();
    entry.stop = null;
    this.clearTimer(entry);
    // The old request may finish; epoch fencing prevents it from publishing.
    entry.inFlight = null;
  }

  private start(entry: Entry, returning: boolean): void {
    if (!this.eligible(entry) || entry.active) return;
    entry.active = true;
    entry.startedAt = this.now();
    const epoch = entry.epoch;
    try {
      const stop = this.options.source.listen(entry.owner, entry.resource, (event) => {
        if (!entry.active || entry.epoch !== epoch) return;
        if (!this.accept(entry, event)) return;
        if (event.source === 'server') {
          entry.healthy = true;
          entry.failures = 0;
          entry.lastServerAt = this.now();
        }
        this.emit(entry);
        this.schedule(entry);
      }, () => {
        if (!entry.active || entry.epoch !== epoch) return;
        entry.healthy = false;
        entry.state = { ...entry.state, readiness: 'unknown', error: true };
        this.emit(entry);
        this.schedule(entry, true);
      });
      if (entry.active && entry.epoch === epoch) entry.stop = stop;
      else stop();
    } catch {
      entry.state = { ...entry.state, readiness: 'unknown', error: true };
      this.emit(entry);
    }
    this.schedule(entry, returning || entry.state.error);
  }

  private clearTimer(entry: Entry): void {
    if (entry.timer !== null) this.timers.clearTimeout(entry.timer);
    entry.timer = null;
  }

  private schedule(entry: Entry, immediate = false): void {
    this.clearTimer(entry);
    if (!this.online || !this.eligible(entry) || !entry.active || entry.inFlight) return;
    const now = this.now();
    const retryDelay = Math.min(this.maxBackoffMs, this.pollIntervalMs * 2 ** Math.min(entry.failures, 16));
    const target = entry.healthy && entry.lastServerAt !== null && !immediate
      ? entry.lastServerAt + this.leaseMs
      : entry.lastHttpAt === null
        ? (immediate ? now : entry.startedAt + this.silenceMs)
        : Math.max(now, entry.lastHttpAt + retryDelay);
    entry.timer = this.timers.setTimeout(() => {
      entry.timer = null;
      if (entry.healthy && entry.lastServerAt !== null && this.now() - entry.lastServerAt >= this.leaseMs) {
        entry.healthy = false;
        entry.state = { ...entry.state, readiness: 'unknown' };
        this.emit(entry);
      }
      void this.read(entry);
    }, Math.max(0, target - now));
  }

  private read(entry: Entry): Promise<void> {
    if (!this.online || !this.eligible(entry) || !entry.active) return Promise.resolve();
    if (entry.inFlight) return entry.inFlight;
    this.clearTimer(entry);
    const epoch = entry.epoch;
    const sequence = entry.snapshotSequence;
    entry.lastHttpAt = this.now();
    entry.state = { ...entry.state, checking: true };
    this.emit(entry);
    // Start in a microtask so even a synchronously throwing adapter is contained.
    const pending = Promise.resolve().then(() => {
      if (!this.online || !entry.active || entry.epoch !== epoch) return null;
      return this.options.transport.read(entry.owner, entry.resource);
    }).then((snapshot) => {
      if (!snapshot || !entry.active || entry.epoch !== epoch) return;
      // An absent/unversioned HTTP answer cannot outvote a later listener event.
      if (sequence !== entry.snapshotSequence && (!snapshot.metadata ||
        snapshot.metadata.generation !== entry.state.snapshot?.metadata?.generation)) return;
      if (!this.accept(entry, { snapshot, source: 'server' })) return;
      entry.lastServerAt = this.now();
      entry.failures = 0;
    }).catch(() => {
      if (!entry.active || entry.epoch !== epoch) return;
      if (sequence !== entry.snapshotSequence && entry.healthy) return;
      entry.failures += 1;
      entry.healthy = false;
      entry.state = { ...entry.state, readiness: 'unknown', error: true };
    }).finally(() => {
      if (!entry.active || entry.epoch !== epoch) return;
      entry.inFlight = null;
      entry.state = { ...entry.state, checking: false };
      this.emit(entry);
      this.schedule(entry);
    });
    entry.inFlight = pending;
    return pending;
  }

  private accept(entry: Entry, event: SnapshotEvent): boolean {
    const incoming = event.snapshot;
    if (keyOf(entry.owner, incoming.resource) !== keyOf(entry.owner, entry.resource)) return false;
    // Cache absence is only absence of evidence, including a cached tombstone.
    if (event.source === 'cache' && incoming.value === null) return false;
    const current = entry.state.snapshot;
    if (current && event.source === 'cache' && entry.state.source === 'server') return false;
    if (current && !this.canReplace(current, incoming)) return false;
    entry.snapshotSequence += 1;
    entry.state = {
      ...entry.state, snapshot: incoming, source: event.source,
      readiness: !this.online && event.source === 'server' ? 'unknown' : event.source, error: false,
    };
    return true;
  }

  private canReplace(current: ResourceSnapshot, incoming: ResourceSnapshot): boolean {
    if (current.metadata) {
      if (!incoming.metadata) return false;
      if (incoming.metadata.generation !== current.metadata.generation) return false;
      if (incoming.metadata.revision < current.metadata.revision) return false;
      if (current.metadata.deleted && !incoming.metadata.deleted) return false;
    } else if (current.value && incoming.value && !incoming.metadata &&
      serverCopyIsNewer(current.value as VersionedCopy, incoming.value as VersionedCopy)) {
      return false;
    }
    return true;
  }

  private emit(entry: Entry): void {
    for (const listener of entry.listeners) listener(entry.state);
  }
}
