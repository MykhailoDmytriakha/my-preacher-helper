import { CollectionReader, type CollectionCursor, type CollectionCursorStore, type CollectionSnapshotStore, type CollectionState } from '../collections';
import { canReplaceSnapshot } from '../engine';
import { collectionHeadRef } from '../feed';
import { ResourceObserver, type SnapshotEvent } from '../observer';

import type { CollectionChanges, CollectionPage, CollectionTransport, ResourceRef, ResourceSnapshot } from '../types';

const collection = 'studyNotes';
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const key = (owner: string, resource: ResourceRef) => JSON.stringify([owner, resource.collection, resource.id]);
const cursorKey = (owner: string, name = collection) => JSON.stringify([owner, name]);
const row = (id: string, revision = 1, content = id): ResourceSnapshot => ({
  resource: { collection, id }, value: { userId: 'owner', content },
  metadata: { protocol: 1, generation: id, revision, deleted: false },
});
const legacy = (id: string): ResourceSnapshot => ({ ...row(id), metadata: null });
const deleted = (id: string, revision = 2): ResourceSnapshot => ({ ...row(id, revision), value: null, metadata: { ...row(id, revision).metadata!, deleted: true } });
const pending = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
};
const settle = async () => { for (let index = 0; index < 250; index += 1) await Promise.resolve(); };

function setup({ online = true, pageSize = 100, maxPages = 1_000 } = {}) {
  let version = 0;
  const cache = new Map<string, ResourceSnapshot>();
  const server = new Map<string, ResourceSnapshot>();
  const cursorRecords = new Map<string, CollectionCursor>();
  const events: { version: number; id: string }[] = [];
  const snapshots: CollectionSnapshotStore = {
    read: jest.fn(async (owner, resource) => { const value = cache.get(key(owner, resource)); return value && clone(value); }),
    list: jest.fn(async (owner, name) => clone([...cache.entries()].filter(([encoded]) => {
      const [storedOwner, storedCollection] = JSON.parse(encoded); return storedOwner === owner && storedCollection === name;
    }).map(([, value]) => value))),
    put: jest.fn(async (owner, value) => {
      const encoded = key(owner, value.resource);
      if (canReplaceSnapshot(cache.get(encoded), value)) cache.set(encoded, clone(value));
    }),
  };
  const cursors: CollectionCursorStore = {
    read: jest.fn(async (owner, name) => { const value = cursorRecords.get(cursorKey(owner, name)); return value && clone(value); }),
    put: jest.fn(async (owner, name, expected, next) => {
      const encoded = cursorKey(owner, name), current = cursorRecords.get(encoded);
      if (JSON.stringify(current) !== JSON.stringify(expected)) throw Object.assign(new Error('Cursor changed'), { code: 'cursor-changed' });
      if (next.version < (current?.version ?? 0)) throw new Error('Cursor moved backwards');
      const committed = { ...next, revision: (current?.revision ?? 0) + 1 };
      cursorRecords.set(encoded, committed); return clone(committed);
    }),
  };
  const transport: CollectionTransport = {
    list: jest.fn(async (_owner, name, options) => {
      const rows = [...server.values()].filter(value => value.resource.collection === name && (!options?.cursor || value.resource.id > options.cursor));
      rows.sort((a, b) => a.resource.id < b.resource.id ? -1 : 1);
      const snapshots = rows.slice(0, options?.limit ?? 100);
      return { snapshots: clone(snapshots), nextCursor: rows.length > snapshots.length ? snapshots.at(-1)!.resource.id : null, version };
    }),
    changes: jest.fn(async (_owner, _name, after, options) => {
      const page = events.filter(event => event.version > after).slice(0, options?.limit ?? 100);
      const cursor = page.at(-1)?.version ?? after;
      return { snapshots: [...new Set(page.map(event => event.id))].map(id => clone(server.get(id)!)), cursor, version, hasMore: cursor < version };
    }),
  };
  const callbacks: { next: (event: SnapshotEvent) => void; stop: jest.Mock }[] = [];
  const source = { listen: jest.fn((_owner, _resource, next) => { const stop = jest.fn(); callbacks.push({ next, stop }); return stop; }) };
  const headSnapshot = (owner = 'owner'): ResourceSnapshot => ({
    resource: collectionHeadRef(owner, collection), value: { userId: owner, collection, version },
    metadata: { protocol: 1, generation: collectionHeadRef(owner, collection).id, revision: version + 1, deleted: false },
  });
  const readHead = jest.fn(async (owner: string) => headSnapshot(owner));
  const observer = new ResourceObserver({ source, transport: { read: readHead } });
  const onError = jest.fn();
  const options = { transport, snapshots, cursors, observer, onError, pageSize, maxPages };
  const reader = new CollectionReader(options); reader.setOnline(online); reader.setOwner('owner');
  const seed = (value: ResourceSnapshot, inCache = false) => {
    server.set(value.resource.id, clone(value));
    if (inCache) cache.set(key('owner', value.resource), clone(value));
  };
  const change = (value: ResourceSnapshot) => { seed(value); events.push({ id: value.resource.id, version: ++version }); };
  const head = () => callbacks.at(-1)!.next({ snapshot: headSnapshot(), source: 'server' });
  return { reader, options, transport, snapshots, cursors, cache, server, cursorRecords, callbacks, source, observer, readHead,
    seed, change, head, onError, setVersion: (value: number) => { version = value; } };
}

describe('CollectionReader durable read lifecycle', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

  it('backs off an initial failure before the server can report its legacy mode', async () => {
    const s = setup();
    jest.mocked(s.transport.list).mockRejectedValue(new Error('quota unavailable'));
    const stop = s.reader.watch(collection, jest.fn()); await settle();
    expect(s.transport.list).toHaveBeenCalledTimes(1);
    for (let index = 0; index < 10; index += 1) { s.head(); await settle(); }
    expect(s.transport.list).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(29_999); await settle();
    expect(s.transport.list).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1); await settle();
    expect(s.transport.list).toHaveBeenCalledTimes(2);
    stop(); await jest.advanceTimersByTimeAsync(120_000); await settle();
    expect(s.transport.list).toHaveBeenCalledTimes(2); s.reader.dispose();
  });

  it('backs off a failed closed-collection feed and resumes without another head event', async () => {
    const s = setup(); s.seed(row('a'));
    const stop = s.reader.watch(collection, jest.fn()); await settle();
    jest.mocked(s.transport.changes).mockRejectedValueOnce(new Error('quota unavailable'));
    s.change(row('a', 2, 'new')); s.head(); await settle();
    const calls = jest.mocked(s.transport.changes).mock.calls.length;
    for (let index = 0; index < 10; index += 1) { s.head(); await settle(); }
    expect(s.transport.changes).toHaveBeenCalledTimes(calls);
    await jest.advanceTimersByTimeAsync(30_000); await settle();
    expect(s.transport.changes).toHaveBeenCalledTimes(calls + 1);
    expect((await s.reader.read(collection)).snapshots[0].value?.content).toBe('new');
    stop(); s.reader.dispose();
  });

  it('hydrates every page and catches up from the first page anchor, including insertion behind the page cursor', async () => {
    const s = setup({ pageSize: 1 });
    jest.mocked(s.transport.list)
      .mockResolvedValueOnce({ snapshots: [row('a')], nextCursor: 'a', version: 1 })
      .mockResolvedValueOnce({ snapshots: [row('z')], nextCursor: null, version: 2 });
    jest.mocked(s.transport.changes).mockResolvedValueOnce({ snapshots: [row('0')], cursor: 2, version: 2, hasMore: false });
    const state = await s.reader.read(collection);
    expect(state).toMatchObject({ complete: true, freshness: 'server', version: 2, error: null });
    expect(state.snapshots.map(snapshot => snapshot.resource.id).sort()).toEqual(['0', 'a', 'z']);
    expect(s.transport.list).toHaveBeenNthCalledWith(2, 'owner', collection, { limit: 1, cursor: 'a' });
    expect(s.transport.changes).toHaveBeenCalledWith('owner', collection, 1, { limit: 1 });
    expect(s.cursorRecords.get(cursorKey('owner'))).toEqual({ version: 2, initialized: true, revision: 2 });
    s.reader.dispose();
  });

  it('persists all snapshots before each cursor advance across incremental change pages', async () => {
    const s = setup({ pageSize: 1 }); s.seed(row('a'), true);
    s.cursorRecords.set(cursorKey('owner'), { version: 0, initialized: true, revision: 1 });
    jest.mocked(s.transport.changes)
      .mockResolvedValueOnce({ snapshots: [row('a', 2, 'latest')], cursor: 2, version: 3, hasMore: true })
      .mockResolvedValueOnce({ snapshots: [deleted('b')], cursor: 3, version: 3, hasMore: false });
    const commit = jest.mocked(s.cursors.put).getMockImplementation()!;
    jest.mocked(s.cursors.put).mockImplementation(async (owner, name, expected, next) => {
      if (next.version === 2) expect(s.cache.get(key('owner', row('a').resource))?.value?.content).toBe('latest');
      if (next.version === 3) expect(s.cache.get(key('owner', row('b').resource))?.metadata?.deleted).toBe(true);
      return commit(owner, name, expected, next);
    });
    const state = await s.reader.refresh(collection);
    expect(state).toMatchObject({ complete: true, freshness: 'server', version: 3 });
    expect(s.transport.list).not.toHaveBeenCalled();
    expect(s.cursorRecords.get(cursorKey('owner'))?.revision).toBe(3);
    s.reader.dispose();
  });

  it('opens a complete cached collection offline after restart without requests', async () => {
    const s = setup(); s.seed(row('a')); s.seed(deleted('b'));
    await s.reader.read(collection); s.reader.dispose();
    const restored = new CollectionReader(s.options); restored.setOnline(false); restored.setOwner('owner');
    jest.mocked(s.transport.list).mockClear(); jest.mocked(s.transport.changes).mockClear();
    const state = await restored.read(collection);
    expect(state).toMatchObject({ complete: true, freshness: 'cache', snapshots: [row('a'), deleted('b')] });
    expect(s.transport.list).not.toHaveBeenCalled(); expect(s.transport.changes).not.toHaveBeenCalled();
    restored.dispose();
  });

  it('reads the cursor before rows so a cross-tab v8 commit cannot label captured v7 rows complete', async () => {
    const s = setup({ online: false }); s.seed(row('a'), true);
    s.cursorRecords.set(cursorKey('owner'), { version: 7, initialized: true, revision: 1 });
    const cursor = pending<CollectionCursor | undefined>();
    jest.mocked(s.cursors.read).mockReturnValueOnce(cursor.promise);
    const originalList = jest.mocked(s.snapshots.list).getMockImplementation()!;
    const releaseRows = pending<void>();
    jest.mocked(s.snapshots.list).mockImplementationOnce(async (owner, name) => {
      const captured = await originalList(owner, name);
      await releaseRows.promise;
      return captured;
    });
    const reading = s.reader.read(collection); await settle();
    expect(s.snapshots.list).not.toHaveBeenCalled();
    s.seed(row('b'), true);
    const committed = { version: 8, initialized: true, revision: 2 };
    s.cursorRecords.set(cursorKey('owner'), committed); cursor.resolve(committed);
    await settle(); releaseRows.resolve();
    const state = await reading;
    expect(state).toMatchObject({ version: 8, complete: true });
    expect(state.snapshots.map(snapshot => snapshot.resource.id).sort()).toEqual(['a', 'b']);
    s.reader.dispose();
  });

  it('distinguishes an uninitialized empty cache from a complete empty collection', async () => {
    const s = setup({ online: false });
    await expect(s.reader.read(collection)).rejects.toMatchObject({ code: 'cache-unavailable' });
    s.reader.setOnline(true); expect(await s.reader.refresh(collection)).toMatchObject({ snapshots: [], complete: true, freshness: 'server' });
    s.reader.setOnline(false); expect(await s.reader.read(collection)).toMatchObject({ snapshots: [], complete: true, freshness: 'cache' });
    s.reader.dispose();
  });

  it('returns known offline rows as incomplete without pretending hydration happened', async () => {
    const s = setup({ online: false }); s.seed(legacy('cached'), true);
    const state = await s.reader.read(collection);
    expect(state).toMatchObject({ snapshots: [legacy('cached')], complete: false, freshness: 'cache' });
    expect(s.cursors.put).not.toHaveBeenCalled(); s.reader.dispose();
  });

  it('leaves the cursor incomplete when snapshot persistence fails before hydration completion', async () => {
    const s = setup(); s.seed(row('a'));
    jest.mocked(s.snapshots.put).mockRejectedValueOnce(new Error('Disk full'));
    await expect(s.reader.refresh(collection)).rejects.toThrow('Disk full');
    expect(s.cursorRecords.get(cursorKey('owner'))).toEqual({ version: 0, initialized: false, revision: 1 });
    expect(jest.mocked(s.cursors.put).mock.calls.every(call => call[3].initialized === false)).toBe(true);
    expect(s.onError).toHaveBeenCalled();
    expect(await s.reader.refresh(collection)).toMatchObject({ complete: true, freshness: 'server' }); s.reader.dispose();
  });

  it('does not advance an incremental cursor when its page cannot be persisted', async () => {
    const s = setup(); s.seed(row('a'), true); s.change(row('a', 2));
    s.cursorRecords.set(cursorKey('owner'), { version: 0, initialized: true, revision: 1 });
    jest.mocked(s.snapshots.put).mockRejectedValueOnce(new Error('Write unavailable'));
    await expect(s.reader.refresh(collection)).rejects.toThrow('Write unavailable');
    expect(s.cursorRecords.get(cursorKey('owner'))?.version).toBe(0);
    expect(s.cursors.put).not.toHaveBeenCalled(); s.reader.dispose();
  });

  it('retains page snapshots after final cursor storage fails and resumes by rehydrating', async () => {
    const s = setup(); s.seed(row('a')); const put = jest.mocked(s.cursors.put).getMockImplementation()!;
    jest.mocked(s.cursors.put).mockImplementation(async (owner, name, expected, next) => {
      if (next.initialized) throw new Error('Cursor storage unavailable');
      return put(owner, name, expected, next);
    });
    await expect(s.reader.refresh(collection)).rejects.toThrow('Cursor storage unavailable');
    expect(s.cache.get(key('owner', row('a').resource))).toEqual(row('a'));
    expect(s.cursorRecords.get(cursorKey('owner'))?.initialized).toBe(false);
    jest.mocked(s.cursors.put).mockImplementation(put);
    expect(await s.reader.refresh(collection)).toMatchObject({ complete: true }); s.reader.dispose();
  });

  it('shares one head subscription and one hydration across two watches', async () => {
    const s = setup(); s.seed(row('a')); const listener = jest.fn();
    const first = s.reader.watch(collection, listener); const second = s.reader.watch(collection, listener);
    await settle();
    expect(s.source.listen).toHaveBeenCalledTimes(1); expect(s.transport.list).toHaveBeenCalledTimes(1);
    expect(s.source.listen).toHaveBeenCalledWith('owner', collectionHeadRef('owner', collection), expect.any(Function), expect.any(Function));
    first(); first(); expect(s.callbacks[0].stop).not.toHaveBeenCalled();
    second(); expect(s.callbacks[0].stop).toHaveBeenCalledTimes(1);
    s.reader.dispose(); expect(() => s.observer.watch('owner', row('a').resource, jest.fn())).not.toThrow();
    s.observer.dispose();
  });

  it('fetches only changes when the head advances and never repeatedly fetches unchanged rows', async () => {
    const s = setup(); s.seed(row('a')); const states: CollectionState[] = [];
    const stop = s.reader.watch(collection, state => states.push(state)); await settle();
    s.head(); await settle();
    const count = jest.mocked(s.transport.changes).mock.calls.length;
    s.head(); await settle(); expect(s.transport.changes).toHaveBeenCalledTimes(count);
    s.change(row('b')); s.head(); await settle();
    expect(s.transport.list).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toMatchObject({ complete: true, version: 1, freshness: 'server' });
    expect(states.at(-1)?.snapshots.map(snapshot => snapshot.resource.id).sort()).toEqual(['a', 'b']);
    stop(); s.reader.dispose();
  });

  it('polls only the small head through observer fallback when the SDK is silent', async () => {
    const s = setup(); s.seed(row('a')); const stop = s.reader.watch(collection, jest.fn()); await settle();
    const listCount = jest.mocked(s.transport.list).mock.calls.length;
    const changesCount = jest.mocked(s.transport.changes).mock.calls.length;
    await jest.advanceTimersByTimeAsync(2_500);
    await jest.advanceTimersByTimeAsync(15_000);
    expect(s.readHead).toHaveBeenCalledTimes(2);
    expect(s.transport.list).toHaveBeenCalledTimes(listCount); expect(s.transport.changes).toHaveBeenCalledTimes(changesCount);
    stop(); s.reader.dispose();
  });

  it('catches a head version arriving while an older change request is still in flight', async () => {
    const s = setup(); s.seed(row('a')); const stop = s.reader.watch(collection, jest.fn()); await settle();
    const response = pending<CollectionChanges>();
    jest.mocked(s.transport.changes).mockReturnValueOnce(response.promise);
    const refreshing = s.reader.refresh(collection); await settle();
    s.change(row('b')); s.head();
    response.resolve({ snapshots: [], cursor: 0, version: 0, hasMore: false });
    await refreshing; await settle();
    expect(s.cursorRecords.get(cursorKey('owner'))?.version).toBe(1);
    expect((await s.reader.read(collection)).snapshots).toContainEqual(row('b'));
    stop(); s.reader.dispose();
  });

  it('invalidates a gap before hydration and removes unseen legacy rows only after full catch-up', async () => {
    const s = setup(); s.seed(row('b')); s.setVersion(5);
    s.cache.set(key('owner', legacy('old').resource), legacy('old'));
    s.cache.set(key('owner', deleted('retained').resource), deleted('retained'));
    s.cursorRecords.set(cursorKey('owner'), { version: 1, initialized: true, revision: 1 });
    jest.mocked(s.transport.changes).mockResolvedValueOnce({ snapshots: [], cursor: 1, version: 5, hasMore: true, resetRequired: true });
    const state = await s.reader.refresh(collection);
    expect(jest.mocked(s.cursors.put).mock.calls[0][3]).toEqual({ version: 1, initialized: false });
    expect(state).toMatchObject({ complete: true, version: 5 });
    expect(s.cache.get(key('owner', legacy('old').resource))).toEqual({ resource: legacy('old').resource, value: null, metadata: null });
    expect(state.snapshots).toContainEqual(deleted('retained')); s.reader.dispose();
  });

  it('does not invent tombstones for unseen versioned live rows', async () => {
    const s = setup(); s.cache.set(key('owner', row('unexplained').resource), row('unexplained'));
    await expect(s.reader.refresh(collection)).rejects.toThrow('missing its deletion tombstone');
    expect(s.cursorRecords.get(cursorKey('owner'))?.initialized).toBe(false);
    expect(s.cache.get(key('owner', row('unexplained').resource))).toEqual(row('unexplained'));
    s.reader.dispose();
  });

  it('retries a cursor CAS conflict from the other tab current cursor', async () => {
    const s = setup(); s.seed(row('a'));
    const put = jest.mocked(s.cursors.put).getMockImplementation()!;
    let raced = false;
    jest.mocked(s.cursors.put).mockImplementation(async (owner, name, expected, next) => {
      if (next.initialized && !raced) {
        raced = true; s.setVersion(3);
        s.cursorRecords.set(cursorKey(owner, name), { version: 3, initialized: true, revision: 8 });
        throw Object.assign(new Error('Another tab advanced'), { code: 'cursor-changed' });
      }
      return put(owner, name, expected, next);
    });
    const state = await s.reader.refresh(collection);
    expect(state).toMatchObject({ complete: true, version: 3, freshness: 'server' });
    expect(s.transport.changes).toHaveBeenLastCalledWith('owner', collection, 3, { limit: 100 });
    expect(s.cursorRecords.get(cursorKey('owner'))?.revision).toBe(9); s.reader.dispose();
  });

  it('bounds repeated CAS conflicts and leaves the cache visibly incomplete', async () => {
    const s = setup();
    jest.mocked(s.cursors.put).mockRejectedValue(Object.assign(new Error('Another writer'), { code: 'cursor-changed' }));
    await expect(s.reader.refresh(collection)).rejects.toMatchObject({ code: 'cursor-changed' });
    expect(s.cursors.put).toHaveBeenCalledTimes(3); expect(s.transport.list).not.toHaveBeenCalled();
    expect(s.onError).toHaveBeenCalled(); s.reader.dispose();
  });

  it.each([
    { snapshots: [row('a')], nextCursor: 'not-the-last-row', version: 0 },
    { snapshots: [], nextCursor: 'a', version: 0 },
    { snapshots: [row('b'), row('a')], nextCursor: null, version: 0 },
    { snapshots: [row('a'), row('a')], nextCursor: null, version: 0 },
  ])('rejects malformed or nonadvancing full pages', async page => {
    const s = setup(); jest.mocked(s.transport.list).mockResolvedValue(page);
    await expect(s.reader.refresh(collection)).rejects.toMatchObject({ code: 'data-loss' });
    expect(s.cursorRecords.get(cursorKey('owner'))?.initialized).toBe(false); s.reader.dispose();
  });

  it('rejects a repeated continuation cursor and caps endless valid pagination', async () => {
    const s = setup({ maxPages: 2 });
    jest.mocked(s.transport.list).mockResolvedValue({ snapshots: [row('a')], nextCursor: 'a', version: 0 });
    await expect(s.reader.refresh(collection)).rejects.toThrow('did not advance');
    jest.mocked(s.transport.list).mockReset()
      .mockResolvedValueOnce({ snapshots: [row('a')], nextCursor: 'a', version: 0 })
      .mockResolvedValueOnce({ snapshots: [row('b')], nextCursor: 'b', version: 0 });
    await expect(s.reader.refresh(collection)).rejects.toThrow('request budget'); s.reader.dispose();
  });

  it.each([
    { snapshots: [], cursor: 0, version: 1, hasMore: true },
    { snapshots: [], cursor: 1, version: 1, hasMore: false },
    { snapshots: [row('a')], cursor: 2, version: 1, hasMore: false },
    { snapshots: [], cursor: 0, version: 0, hasMore: true },
  ])('rejects incomplete or nonadvancing change pages without advancing the cursor', async page => {
    const s = setup(); s.cursorRecords.set(cursorKey('owner'), { version: 0, initialized: true, revision: 1 });
    jest.mocked(s.transport.changes).mockResolvedValue(page);
    await expect(s.reader.refresh(collection)).rejects.toMatchObject({ code: 'data-loss' });
    expect(s.cursors.put).not.toHaveBeenCalled(); s.reader.dispose();
  });

  it('rejects older feed responses and never replaces a newer cached document revision', async () => {
    const s = setup(); s.seed(row('a', 5, 'newest'), true);
    s.cursorRecords.set(cursorKey('owner'), { version: 4, initialized: true, revision: 1 });
    jest.mocked(s.transport.changes).mockResolvedValueOnce({ snapshots: [], cursor: 4, version: 3, hasMore: false, resetRequired: true });
    await expect(s.reader.refresh(collection)).rejects.toThrow('moved backwards');
    jest.mocked(s.transport.changes).mockResolvedValueOnce({ snapshots: [row('a', 2, 'old')], cursor: 5, version: 5, hasMore: false });
    const state = await s.reader.refresh(collection);
    expect(state.snapshots).toEqual([row('a', 5, 'newest')]); s.reader.dispose();
  });

  it('fences late pages after an owner change and clears old-owner observations', async () => {
    const s = setup(); const response = pending<CollectionPage>();
    jest.mocked(s.transport.list).mockReturnValueOnce(response.promise);
    const states: CollectionState[] = []; s.reader.watch(collection, value => states.push(value)); await settle();
    s.reader.setOwner('other'); response.resolve({ snapshots: [row('a')], nextCursor: null, version: 0 }); await settle();
    expect(states.at(-1)).toMatchObject({ snapshots: [], complete: false, freshness: 'unknown' });
    expect(s.cache.size).toBe(0); expect(s.callbacks[0].stop).toHaveBeenCalledTimes(1);
    expect(s.cursorRecords.get(cursorKey('other'))).toBeUndefined(); s.reader.dispose();
  });

  it('does not publish a cached load completed after sign-out', async () => {
    const s = setup({ online: false }); const reading = pending<ResourceSnapshot[]>();
    jest.mocked(s.snapshots.list).mockReturnValueOnce(reading.promise);
    const read = s.reader.read(collection); s.reader.setOwner(null); reading.resolve([row('a')]);
    await expect(read).rejects.toMatchObject({ name: 'AbortError' }); s.reader.dispose();
  });

  it('suspends hidden/offline work and resumes watched collections on return', async () => {
    const s = setup(); s.seed(row('a')); const stop = s.reader.watch(collection, jest.fn()); await settle();
    s.reader.setVisible(false); s.reader.setVisible(false); s.change(row('b'));
    const calls = jest.mocked(s.transport.changes).mock.calls.length;
    await s.reader.refresh(collection); await jest.advanceTimersByTimeAsync(200_000);
    expect(s.transport.changes).toHaveBeenCalledTimes(calls);
    s.reader.setVisible(true); await settle();
    expect((await s.reader.read(collection)).snapshots).toContainEqual(row('b'));
    s.reader.setOnline(false); s.reader.setOnline(false); s.change(row('c'));
    await s.reader.refresh(collection); s.reader.setOnline(true); await settle();
    expect((await s.reader.read(collection)).snapshots).toContainEqual(row('c'));
    stop(); s.reader.dispose();
  });

  it('rejects cross-owner snapshots and invalid collection identities', async () => {
    const s = setup();
    expect(() => s.reader.watch('_dataEngineHeads', jest.fn())).toThrow();
    jest.mocked(s.transport.list).mockResolvedValueOnce({ snapshots: [{ ...row('a'), value: { userId: 'other' } }], nextCursor: null, version: 0 });
    await expect(s.reader.refresh(collection)).rejects.toThrow('identity mismatch');
    s.reader.setOwner(null); await expect(s.reader.read(collection)).rejects.toThrow('Authentication');
    s.reader.dispose(); s.reader.dispose(); s.reader.setOwner('owner'); s.reader.setVisible(false); s.reader.setOnline(false);
    expect(() => s.reader.watch(collection, jest.fn())).toThrow('disposed');
    expect(() => new CollectionReader({ ...s.options, pageSize: 0 })).toThrow('paging budget');
  });
});

describe('a collection legacy writers may still change', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });
  const mixed = () => {
    const s = setup();
    const list = jest.mocked(s.transport.list).getMockImplementation()!;
    const changes = jest.mocked(s.transport.changes).getMockImplementation()!;
    jest.mocked(s.transport.list).mockImplementation(async (...args) => ({ ...(await list(...args)), legacyOpen: true }));
    jest.mocked(s.transport.changes).mockImplementation(async (...args) => ({ ...(await changes(...args)), legacyOpen: true }));
    return s;
  };

  it('shares a bounded mixed refresh across consumers and suspends it while hidden, offline or unwatched', async () => {
    const s = mixed(); s.seed(legacy('a'));
    const stopA = s.reader.watch(collection, jest.fn()), stopB = s.reader.watch(collection, jest.fn());
    await settle();
    expect(s.transport.list).toHaveBeenCalledTimes(1);
    jest.mocked(s.transport.list).mockClear(); jest.mocked(s.transport.changes).mockClear();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(s.transport.list).toHaveBeenCalledTimes(4);
    expect(s.transport.changes).toHaveBeenCalledTimes(4); // One catch-up per list, no duplicate pre-list feed read.
    s.reader.setVisible(false); await jest.advanceTimersByTimeAsync(60_000);
    expect(s.transport.list).toHaveBeenCalledTimes(4);
    s.reader.setVisible(true); await settle();
    expect(s.transport.list).toHaveBeenCalledTimes(5);
    s.reader.setOnline(false); await jest.advanceTimersByTimeAsync(60_000);
    expect(s.transport.list).toHaveBeenCalledTimes(5);
    s.reader.setOnline(true); await settle();
    expect(s.transport.list).toHaveBeenCalledTimes(6);
    stopA(); stopB(); await jest.advanceTimersByTimeAsync(60_000);
    expect(s.transport.list).toHaveBeenCalledTimes(6);
    s.reader.dispose(); s.observer.dispose();
  });

  it('does not overlap a slow sweep and stops polling once the server closes legacy writes', async () => {
    const s = mixed(); const stop = s.reader.watch(collection, jest.fn()); await settle();
    const response = pending<CollectionPage>();
    jest.mocked(s.transport.list).mockReturnValueOnce(response.promise);
    await jest.advanceTimersByTimeAsync(15_000);
    expect(s.transport.list).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(120_000);
    expect(s.transport.list).toHaveBeenCalledTimes(2);
    jest.mocked(s.transport.changes).mockResolvedValue({ snapshots: [], cursor: 0, version: 0, hasMore: false });
    response.resolve({ snapshots: [], nextCursor: null, version: 0 }); await settle();
    await jest.advanceTimersByTimeAsync(120_000);
    expect(s.transport.list).toHaveBeenCalledTimes(2);
    stop(); s.reader.dispose(); s.observer.dispose();
  });

  it('backs off failed mixed sweeps and retries without a new head version', async () => {
    const s = mixed(); const stop = s.reader.watch(collection, jest.fn()); await settle();
    const list = jest.mocked(s.transport.list).getMockImplementation()!;
    jest.mocked(s.transport.list).mockRejectedValueOnce(new Error('unavailable'));
    await jest.advanceTimersByTimeAsync(15_000);
    expect(s.transport.list).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(29_999);
    expect(s.transport.list).toHaveBeenCalledTimes(2);
    jest.mocked(s.transport.list).mockImplementation(list);
    await jest.advanceTimersByTimeAsync(1);
    expect(s.transport.list).toHaveBeenCalledTimes(3);
    stop(); s.reader.dispose(); s.observer.dispose();
  });

  it('discovers legacy changes on an already open list without a feed event or user refresh', async () => {
    const s = setup(); s.seed(legacy('kept')); s.seed(legacy('doomed'));
    const list = jest.mocked(s.transport.list).getMockImplementation()!;
    const changes = jest.mocked(s.transport.changes).getMockImplementation()!;
    jest.mocked(s.transport.list).mockImplementation(async (...args) => ({ ...(await list(...args)), legacyOpen: true }));
    jest.mocked(s.transport.changes).mockImplementation(async (...args) => ({ ...(await changes(...args)), legacyOpen: true }));
    let state!: CollectionState;
    const stop = s.reader.watch(collection, next => { state = next; }); await settle(); s.head(); await settle();
    const initialLists = jest.mocked(s.transport.list).mock.calls.length;
    s.server.set('kept', { ...legacy('kept'), value: { userId: 'owner', content: 'Legacy changed this', updatedAt: '2026-09-19' } });
    s.server.delete('doomed');
    await jest.advanceTimersByTimeAsync(15_000); await settle();
    expect(s.transport.list).toHaveBeenCalledTimes(initialLists + 1);
    expect(state.snapshots.filter(snapshot => snapshot.value)).toEqual([
      expect.objectContaining({ value: expect.objectContaining({ content: 'Legacy changed this' }) }),
    ]);
    stop(); s.reader.dispose(); s.observer.dispose();
  });

  it('reads the whole list again, because a legacy write raises no feed event', async () => {
    const s = setup();
    s.seed(legacy('kept'), true); s.seed(legacy('doomed'), true);
    await s.reader.read(collection);
    jest.mocked(s.transport.list).mockClear();

    // An old bundle edits one council and deletes another through the legacy road: the head
    // does not move and the feed stays empty — exactly BUG-20260912-engine-collection-shows-deleted-legacy.
    s.server.set('kept', { ...legacy('kept'), value: { userId: 'owner', content: 'edited by an old bundle', updatedAt: '2026-09-18T10:00:00.000Z' } });
    s.server.delete('doomed');
    const transportList = jest.mocked(s.transport.list).getMockImplementation()!;
    const transportChanges = jest.mocked(s.transport.changes).getMockImplementation()!;
    jest.mocked(s.transport.list).mockImplementation(async (...args) => ({ ...(await transportList(...args)), legacyOpen: true }));
    jest.mocked(s.transport.changes).mockImplementation(async (...args) => ({ ...(await transportChanges(...args)), legacyOpen: true }));

    const state = await s.reader.refresh(collection);
    expect(s.transport.list).toHaveBeenCalled();
    const live = state.snapshots.filter(snapshot => snapshot.value !== null);
    expect(live.map(snapshot => snapshot.resource.id)).toEqual(['kept']);
    expect(live[0].value).toMatchObject({ content: 'edited by an old bundle' });
    expect(state).toMatchObject({ complete: true, error: null });
  });

  it('trusts the feed alone once the collection is closed to legacy writers', async () => {
    const s = setup();
    s.seed(legacy('kept'), true);
    await s.reader.read(collection);
    jest.mocked(s.transport.list).mockClear();
    await s.reader.refresh(collection);
    // No `legacyOpen` in the answers: closed (or an older server) — no full listing per refresh.
    expect(s.transport.list).not.toHaveBeenCalled();
  });
});

describe('independent review race probes', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });
  it('stops background hydration requests after the final watch is released', async () => {
    const s = setup({ pageSize: 1 });
    const response = pending<CollectionPage>();
    jest.mocked(s.transport.list).mockReturnValueOnce(response.promise)
      .mockResolvedValueOnce({ snapshots: [row('b')], nextCursor: null, version: 0 });
    const stop = s.reader.watch(collection, jest.fn());
    await settle();
    expect(s.transport.list).toHaveBeenCalledTimes(1);
    stop();
    response.resolve({ snapshots: [row('a')], nextCursor: 'a', version: 0 });
    await settle();
    try { expect(s.transport.list).toHaveBeenCalledTimes(1); }
    finally { s.reader.dispose(); s.observer.dispose(); }
  });
  it.each(['read', 'refresh'] as const)('continues for an explicit %s that joined a released watch', async method => {
    const s = setup({ pageSize: 1 }); const response = pending<CollectionPage>();
    jest.mocked(s.transport.list).mockReturnValueOnce(response.promise)
      .mockResolvedValueOnce({ snapshots: [row('b')], nextCursor: null, version: 0 });
    const stop = s.reader.watch(collection, jest.fn()); await settle();
    const reading = s.reader[method](collection); await settle(); stop();
    response.resolve({ snapshots: [row('a')], nextCursor: 'a', version: 0 });
    await expect(reading).resolves.toMatchObject({ complete: true, error: null });
    expect(s.transport.list).toHaveBeenCalledTimes(2); s.reader.dispose(); s.observer.dispose();
  });

  it('does not start background networking when the final watch closes during cache loading', async () => {
    const s = setup(); const cached = pending<ResourceSnapshot[]>();
    jest.mocked(s.snapshots.list).mockReturnValueOnce(cached.promise);
    const stop = s.reader.watch(collection, jest.fn()); await settle(); stop();
    cached.resolve([]); await settle();
    expect(s.transport.list).not.toHaveBeenCalled();
    expect(s.transport.changes).not.toHaveBeenCalled(); s.reader.dispose(); s.observer.dispose();
  });

  it('does not invalidate a cache candidate updated while the initial response was in flight', async () => {
    const s = setup(); s.seed(row('a'), true);
    const response = pending<CollectionChanges>();
    jest.mocked(s.transport.list).mockResolvedValueOnce({ snapshots: [], nextCursor: null, version: 0 });
    jest.mocked(s.transport.changes).mockReturnValueOnce(response.promise);
    const reading = s.reader.refresh(collection); await settle();
    await s.snapshots.put('owner', row('a', 2, 'Acknowledged in another tab'));
    response.resolve({ snapshots: [], cursor: 0, version: 0, hasMore: false });
    await expect(reading).resolves.toMatchObject({ complete: true, snapshots: [row('a', 2, 'Acknowledged in another tab')] });
    s.reader.dispose(); s.observer.dispose();
  });

  it('does not call a newly committed cache insertion a missing deletion tombstone', async () => {
    const s = setup();
    s.seed(row('a'));
    const response = pending<CollectionChanges>();
    jest.mocked(s.transport.changes).mockReturnValueOnce(response.promise);
    const refreshing = s.reader.refresh(collection);
    await settle();
    expect(s.transport.changes).toHaveBeenCalledTimes(1);
    // The feed response was taken at V0. Another tab commits b at V1 and
    // persists its acknowledged snapshot before this response is delivered.
    s.change(row('b'));
    await s.snapshots.put('owner', row('b'));
    response.resolve({ snapshots: [], cursor: 0, version: 0, hasMore: false });
    try { await expect(refreshing).resolves.toMatchObject({ complete: true }); }
    finally { s.reader.dispose(); s.observer.dispose(); }
  });
});
