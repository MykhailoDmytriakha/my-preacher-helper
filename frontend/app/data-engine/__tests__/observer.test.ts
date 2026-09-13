import { ResourceObserver, type Observation, type SnapshotEvent } from '../observer';
import type { ResourceSnapshot } from '../types';

const resource = { collection: 'studyNotes', id: 'one' };
const snapshot = (revision = 1, text = 'note'): ResourceSnapshot => ({
  resource, value: { content: text },
  metadata: { protocol: 1, generation: 'first', revision, deleted: false },
});
const absent = (): ResourceSnapshot => ({ resource, value: null, metadata: null });
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
};

function harness(options: { throwOnListen?: boolean } = {}) {
  const callbacks: { next: (event: SnapshotEvent) => void; error: () => void; stop: jest.Mock }[] = [];
  const source = {
    listen: jest.fn((_owner, _resource, next, error) => {
      if (options.throwOnListen) throw new Error('Listener initialization failed.');
      const stop = jest.fn();
      callbacks.push({ next, error, stop });
      return stop;
    }),
  };
  const read = jest.fn<Promise<ResourceSnapshot>, [string, typeof resource]>().mockResolvedValue(snapshot());
  const observer = new ResourceObserver({ source, transport: { read } });
  observer.setOwner('owner');
  const values: Observation[] = [];
  const listener = jest.fn((value: Observation) => values.push(value));
  const watch = () => observer.watch('owner', resource, listener);
  const state = () => values[values.length - 1];
  const next = (value: ResourceSnapshot, from: 'server' | 'cache' = 'server', index = callbacks.length - 1) =>
    callbacks[index].next({ snapshot: value, source: from });
  return { observer, source, read, values, listener, watch, state, next, callbacks };
}

describe('ResourceObserver', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(1_000_000); });
  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

  it('shares a listener per document and releases it only after the last watch', async () => {
    const h = harness();
    const first = h.watch();
    const second = h.watch();
    expect(h.source.listen).toHaveBeenCalledTimes(1);
    expect(h.state()).toMatchObject({ readiness: 'unknown', snapshot: null });
    first(); first();
    expect(h.callbacks[0].stop).not.toHaveBeenCalled();
    h.next(snapshot());
    expect(h.state()).toMatchObject({ readiness: 'server', snapshot: snapshot() });
    second();
    expect(h.callbacks[0].stop).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(300_000);
    expect(h.read).not.toHaveBeenCalled();
    h.next(snapshot(9));
    expect(h.state().snapshot).toEqual(snapshot());
  });

  it('falls back after silence and polls only the active document every fifteen seconds', async () => {
    const h = harness(); h.watch();
    await jest.advanceTimersByTimeAsync(2_499);
    expect(h.read).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(h.read).toHaveBeenCalledWith('owner', resource);
    expect(h.state()).toMatchObject({ readiness: 'server', checking: false });
    await jest.advanceTimersByTimeAsync(14_999);
    expect(h.read).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(h.read).toHaveBeenCalledTimes(2);
    h.observer.dispose();
  });

  it('keeps a healthy listener free of HTTP checks until its freshness lease expires', async () => {
    const h = harness(); h.watch(); h.next(snapshot());
    await jest.advanceTimersByTimeAsync(100_000);
    expect(h.read).not.toHaveBeenCalled();
    h.next(snapshot(2));
    await jest.advanceTimersByTimeAsync(119_999);
    expect(h.read).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(h.read).toHaveBeenCalledTimes(1);
    expect(h.state().snapshot).toEqual(snapshot(2));
    // The lower HTTP revision did not certify the retained document as fresh.
    expect(h.state().readiness).toBe('unknown');
    h.observer.dispose();
  });

  it('stops degraded polling when the stream becomes healthy', async () => {
    const h = harness(); h.watch();
    await jest.advanceTimersByTimeAsync(2_500);
    h.next(snapshot(2));
    await jest.advanceTimersByTimeAsync(119_999);
    expect(h.read).toHaveBeenCalledTimes(1);
    h.observer.dispose();
  });

  it('does not let repeated cache events postpone the initial silence deadline', async () => {
    const h = harness(); h.watch();
    h.next(snapshot(), 'cache');
    await jest.advanceTimersByTimeAsync(2_000);
    h.next(snapshot(), 'cache');
    await jest.advanceTimersByTimeAsync(500);
    expect(h.read).toHaveBeenCalledTimes(1);
    h.observer.dispose();
  });

  it('does not publish cache absence as deletion, including cached tombstones', () => {
    const h = harness(); h.watch();
    h.next(absent(), 'cache');
    expect(h.state()).toMatchObject({ snapshot: null, readiness: 'unknown' });
    h.next(snapshot(), 'cache');
    expect(h.state()).toMatchObject({ snapshot: snapshot(), readiness: 'cache' });
    const tombstone = { ...snapshot(2), value: null, metadata: { ...snapshot(2).metadata!, deleted: true } };
    h.next(tombstone, 'cache');
    expect(h.state().snapshot).toEqual(snapshot());
    h.next(tombstone);
    expect(h.state()).toMatchObject({ snapshot: tombstone, readiness: 'server' });
    h.next(snapshot(3));
    expect(h.state().snapshot).toEqual(tombstone);
    h.observer.dispose();
  });

  it('allows authenticated absence for an unversioned document', async () => {
    const h = harness(); h.watch();
    h.next({ ...snapshot(), metadata: null }, 'cache');
    h.read.mockResolvedValue(absent());
    await h.observer.refresh(resource);
    expect(h.state()).toMatchObject({ snapshot: absent(), readiness: 'server' });
    h.observer.dispose();
  });

  it('rejects old revisions, changed generations and incomplete version evidence', () => {
    const h = harness(); h.watch(); h.next(snapshot(3));
    h.next(snapshot(2));
    h.next({ ...snapshot(9), metadata: { ...snapshot(9).metadata!, generation: 'different' } });
    h.next({ ...snapshot(9), metadata: null });
    h.next({ ...snapshot(10), resource: { ...resource, id: 'wrong' } });
    h.next(snapshot(11), 'cache');
    expect(h.state().snapshot).toEqual(snapshot(3));
    h.observer.dispose();
  });

  it('uses the canonical revision-vector comparison for legacy records', () => {
    const h = harness(); h.watch();
    const legacy = { ...snapshot(), metadata: null, value: { content: 'new', rev: { note: 3 } } };
    h.next(legacy, 'cache');
    h.next({ ...legacy, value: { content: 'old', rev: { note: 2 } } });
    expect(h.state().snapshot).toEqual(legacy);
    h.next(snapshot(1, 'upgraded'));
    expect(h.state().snapshot).toEqual(snapshot(1, 'upgraded'));
    h.observer.dispose();
  });

  it('deduplicates concurrent automatic and manual requests', async () => {
    const h = harness(); const request = deferred<ResourceSnapshot>();
    h.read.mockReturnValue(request.promise); h.watch();
    await jest.advanceTimersByTimeAsync(2_500);
    const first = h.observer.refresh(resource);
    const second = h.observer.refresh(resource);
    expect(second).toBe(first);
    expect(h.read).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(h.read).toHaveBeenCalledTimes(1);
    request.resolve(snapshot()); await first;
    expect(h.state().checking).toBe(false);
    h.observer.dispose();
  });

  it('backs off failed reads with a bounded maximum', async () => {
    const h = harness(); h.read.mockRejectedValue(new Error('Network failure.')); h.watch();
    await jest.advanceTimersByTimeAsync(2_500);
    expect(h.state()).toMatchObject({ readiness: 'unknown', error: true, checking: false });
    await jest.advanceTimersByTimeAsync(29_999); expect(h.read).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1); expect(h.read).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(60_000); expect(h.read).toHaveBeenCalledTimes(3);
    await jest.advanceTimersByTimeAsync(120_000); expect(h.read).toHaveBeenCalledTimes(4);
    await jest.advanceTimersByTimeAsync(120_000); expect(h.read).toHaveBeenCalledTimes(5);
    h.observer.dispose();
  });

  it('recovers immediately from a listener error without exceeding automatic request rate', async () => {
    const h = harness(); h.watch(); h.callbacks[0].error();
    await jest.advanceTimersByTimeAsync(0);
    expect(h.read).toHaveBeenCalledTimes(1);
    h.callbacks[0].error();
    await jest.advanceTimersByTimeAsync(14_999);
    expect(h.read).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(h.read).toHaveBeenCalledTimes(2);
    h.observer.dispose();
  });

  it('uses fallback when listener initialization throws', async () => {
    const h = harness({ throwOnListen: true }); h.watch();
    expect(h.state().error).toBe(true);
    await jest.advanceTimersByTimeAsync(0);
    expect(h.read).toHaveBeenCalledTimes(1);
    expect(h.state().error).toBe(false);
    h.observer.dispose();
  });

  it('suspends network and listeners while hidden and checks again on return', async () => {
    const h = harness(); h.watch(); h.next(snapshot());
    h.observer.setVisible(false); h.observer.setVisible(false);
    expect(h.callbacks[0].stop).toHaveBeenCalledTimes(1);
    expect(h.state()).toMatchObject({ snapshot: snapshot(), readiness: 'unknown' });
    await jest.advanceTimersByTimeAsync(500_000);
    await h.observer.refresh(resource);
    expect(h.read).not.toHaveBeenCalled();
    h.observer.setVisible(true);
    await jest.advanceTimersByTimeAsync(0);
    expect(h.source.listen).toHaveBeenCalledTimes(2);
    expect(h.read).toHaveBeenCalledTimes(1);
    h.observer.dispose();
  });

  it('does no HTTP work offline and reconnects with only one read after rapid lifecycle changes', async () => {
    const h = harness(); h.watch(); h.observer.setOnline(false); h.observer.setOnline(false);
    await jest.advanceTimersByTimeAsync(500_000);
    expect(h.read).not.toHaveBeenCalled();
    h.observer.setOnline(true); await jest.advanceTimersByTimeAsync(0);
    expect(h.read).toHaveBeenCalledTimes(1);
    h.observer.setVisible(false); h.observer.setVisible(true);
    await jest.advanceTimersByTimeAsync(14_999);
    expect(h.read).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(h.read).toHaveBeenCalledTimes(2);
    h.observer.dispose();
  });

  it('can open cached documents while initially offline without claiming current server freshness', async () => {
    const h = harness(); h.observer.setOnline(false); h.watch();
    expect(h.source.listen).toHaveBeenCalledTimes(1);
    h.next(snapshot(), 'cache');
    expect(h.state()).toMatchObject({ snapshot: snapshot(), readiness: 'cache' });
    h.next(snapshot(2));
    expect(h.state()).toMatchObject({ snapshot: snapshot(2), readiness: 'unknown' });
    await h.observer.refresh(resource);
    await jest.advanceTimersByTimeAsync(500_000);
    expect(h.read).not.toHaveBeenCalled();
    h.observer.dispose();
  });

  it('fences pending requests and late callbacks after owner changes', async () => {
    const h = harness(); const request = deferred<ResourceSnapshot>(); h.read.mockReturnValue(request.promise);
    h.watch(); h.next(snapshot(), 'cache');
    const pending = h.observer.refresh(resource); await Promise.resolve();
    h.observer.setOwner('other');
    expect(h.state()).toEqual({ snapshot: null, source: null, readiness: 'unknown', checking: false, error: false });
    h.next(snapshot(10)); h.callbacks[0].error();
    request.resolve(snapshot(20)); await pending;
    expect(h.state().snapshot).toBeNull();
    h.observer.setOwner('owner'); h.observer.setOwner('owner');
    expect(h.source.listen).toHaveBeenCalledTimes(2);
    h.observer.dispose();
  });

  it('does not dispatch an already invalidated request after sign-out', async () => {
    const h = harness(); h.watch();
    const pending = h.observer.refresh(resource);
    h.observer.setOwner(null);
    await pending;
    expect(h.read).not.toHaveBeenCalled();
    h.observer.dispose();
  });

  it('releases a synchronously attached listener when its first event triggers sign-out', async () => {
    const stop = jest.fn();
    const read = jest.fn().mockResolvedValue(snapshot());
    const observer = new ResourceObserver({
      source: { listen: (_owner, _resource, next) => { next({ snapshot: snapshot(), source: 'server' }); return stop; } },
      transport: { read },
    });
    observer.setOwner('owner');
    observer.watch('owner', resource, (state) => {
      if (state.readiness === 'server') observer.setOwner(null);
    });
    expect(stop).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(300_000);
    expect(read).not.toHaveBeenCalled();
    observer.dispose();
  });

  it('fences requests from a previous visibility generation', async () => {
    const h = harness(); const first = deferred<ResourceSnapshot>();
    h.read.mockReturnValueOnce(first.promise).mockResolvedValue(snapshot(3)); h.watch();
    const pending = h.observer.refresh(resource); await Promise.resolve();
    h.observer.setVisible(false); h.observer.setVisible(true);
    await h.observer.refresh(resource);
    first.resolve(snapshot(50)); await pending;
    expect(h.state().snapshot).toEqual(snapshot(3));
    h.observer.dispose();
  });

  it('does not overwrite a newer stream version with an older HTTP response', async () => {
    const h = harness(); const request = deferred<ResourceSnapshot>(); h.read.mockReturnValue(request.promise); h.watch();
    const pending = h.observer.refresh(resource); await Promise.resolve(); h.next(snapshot(4));
    request.resolve(snapshot(2)); await pending;
    expect(h.state().snapshot).toEqual(snapshot(4));
    h.observer.dispose();
  });

  it('does not let an earlier absent read erase a subsequently observed document', async () => {
    const h = harness(); const request = deferred<ResourceSnapshot>(); h.read.mockReturnValue(request.promise); h.watch();
    const pending = h.observer.refresh(resource); await Promise.resolve();
    const legacy = { ...snapshot(), metadata: null };
    h.next(legacy); request.resolve(absent()); await pending;
    expect(h.state().snapshot).toEqual(legacy);
    h.observer.dispose();
  });

  it('does not let an earlier failed read invalidate a later healthy stream proof', async () => {
    const h = harness(); const request = deferred<ResourceSnapshot>(); h.read.mockReturnValue(request.promise); h.watch();
    const pending = h.observer.refresh(resource); await Promise.resolve(); h.next(snapshot(2));
    request.reject(new Error('Old request failed.')); await pending;
    expect(h.state()).toMatchObject({ snapshot: snapshot(2), readiness: 'server', error: false });
    await jest.advanceTimersByTimeAsync(119_999);
    expect(h.read).toHaveBeenCalledTimes(1);
    h.observer.dispose();
  });

  it('refreshes only a watched resource owned by the active account', async () => {
    const h = harness();
    await h.observer.refresh(resource); h.observer.setOwner(null);
    await h.observer.refresh(resource);
    h.watch(); await jest.advanceTimersByTimeAsync(10_000);
    expect(h.source.listen).not.toHaveBeenCalled();
    expect(h.read).not.toHaveBeenCalled();
    h.observer.dispose(); h.observer.dispose();
    h.observer.setOwner('owner'); h.observer.setVisible(false); h.observer.setOnline(false);
    expect(() => h.watch()).toThrow('disposed');
  });

  it('maintains independent leases for different resources and supports injected timers', async () => {
    const listen = jest.fn(() => jest.fn());
    const read = jest.fn(async (_owner: string, ref: typeof resource) => ({ ...snapshot(), resource: ref }));
    const setTimer = jest.fn((callback, delay) => setTimeout(callback, delay));
    const clearTimer = jest.fn((handle) => clearTimeout(handle));
    const observer = new ResourceObserver({
      source: { listen }, transport: { read }, now: () => Date.now(),
      timers: { setTimeout: setTimer, clearTimeout: clearTimer }, silenceMs: 10, pollIntervalMs: 100, leaseMs: 200,
    });
    observer.setOwner('owner');
    const one = observer.watch('owner', resource, jest.fn());
    const two = observer.watch('owner', { ...resource, id: 'two' }, jest.fn());
    await jest.advanceTimersByTimeAsync(10);
    expect(read).toHaveBeenCalledTimes(2);
    one(); await jest.advanceTimersByTimeAsync(100);
    expect(read).toHaveBeenCalledTimes(3);
    expect(read.mock.calls[2][1].id).toBe('two');
    two(); expect(clearTimer).toHaveBeenCalled(); observer.dispose();
  });
});
