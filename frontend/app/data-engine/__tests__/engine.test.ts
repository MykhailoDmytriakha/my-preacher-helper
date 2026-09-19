import { DataEngine, canReplaceSnapshot, type SnapshotStore } from '../engine';
import { createMemoryCommitStore } from '../commits';
import { ResourceObserver, type SnapshotEvent } from '../observer';
import { applyCommand } from '../protocol';
import { DataEngineRuntime } from '../runtime';

import type { ManualScopeStore, ManualStorageRecord } from '../manualScopes.client';
import type { CheckpointStore, EditorRecord } from '../controller';
import type { EngineTransport, JournalEntry, JournalStore, ResourceRef, ResourceSnapshot } from '../types';

const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const resource = { collection: 'studyNotes', id: 'note' };
const initial = (revision = 1, content = 'base'): ResourceSnapshot => ({
  resource, value: { userId: 'owner', title: 'Title', content, tags: [], scriptureRefs: [], isDraft: false, createdAt: '2026-09-12', updatedAt: '2026-09-12' },
  metadata: { protocol: 1, generation: 'generation', revision, deleted: false },
});
const absent = (ref = resource): ResourceSnapshot => ({ resource: ref, value: null, metadata: null });
const keyOf = (owner: string, ref: ResourceRef) => JSON.stringify([owner, ref.collection, ref.id]);
const drainMicrotasks = async () => { for (let i = 0; i < 100; i += 1) await Promise.resolve(); };
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
};

function setup({ cached = true, online = true } = {}) {
  let sequence = 0;
  const records = new Map<string, EditorRecord>();
  const entries = new Map<string, JournalEntry>();
  const cache = new Map<string, ResourceSnapshot>();
  const server = new Map<string, ResourceSnapshot>([[keyOf('owner', resource), initial()]]);
  if (cached) cache.set(keyOf('owner', resource), initial());
  const checkpoints: CheckpointStore = {
    read: jest.fn(async (owner, id) => {
      const value = records.get(JSON.stringify([owner, id])); return value && copy(value);
    }),
    put: jest.fn(async record => { records.set(JSON.stringify([record.owner, record.editorId]), copy(record)); }),
  };
  const snapshots: SnapshotStore = {
    read: jest.fn(async (owner, ref) => { const value = cache.get(keyOf(owner, ref)); return value && copy(value); }),
    put: jest.fn(async (owner, value) => { cache.set(keyOf(owner, value.resource), copy(value)); }),
  };
  const journal: JournalStore = {
    list: jest.fn(async owner => copy([...entries.values()].filter(entry => entry.command.owner === owner))),
    put: jest.fn(async entry => { entries.set(JSON.stringify([entry.command.owner, entry.command.operationId]), copy(entry)); }),
    remove: jest.fn(async (owner, id) => { entries.delete(JSON.stringify([owner, id])); }),
  };
  const transport: EngineTransport = {
    read: jest.fn(async (owner, ref) => copy(server.get(keyOf(owner, ref)) ?? absent(ref))),
    send: jest.fn(async command => {
      const result = applyCommand(command, server.get(keyOf(command.owner, command.resource)) ?? absent(command.resource));
      if (result.kind === 'acknowledged') server.set(keyOf(command.owner, command.resource), copy(result.snapshot));
      return result;
    }),
  };
  const callbacks: { next: (event: SnapshotEvent) => void; stop: jest.Mock }[] = [];
  const source = { listen: jest.fn((_owner, _resource, next) => {
    const stop = jest.fn(); callbacks.push({ next, stop }); return stop;
  }) };
  const runtime = new DataEngineRuntime({ journal, transport });
  const observer = new ResourceObserver({ source, transport });
  const onError = jest.fn();
  const commits = createMemoryCommitStore();
  const manualRows = new Map<string, ManualStorageRecord>();
  const manualScopes: ManualScopeStore = {
    read: jest.fn(async (owner, id) => { const row = manualRows.get(JSON.stringify([owner, id])); return row && copy(row); }),
    list: jest.fn(async (owner, ref) => copy([...manualRows.values()].filter((row): row is import('../manualScopes.client').StoredManualScope => row.owner === owner && Boolean(row.record) && (!ref || row.record!.resource.collection === ref.collection && row.record!.resource.id === ref.id)))),
    create: jest.fn(async row => { const key = JSON.stringify([row.owner, row.scopeId]); if (manualRows.has(key)) throw new Error('occupied'); manualRows.set(key, copy(row)); }),
    put: jest.fn(async row => { manualRows.set(JSON.stringify([row.owner, row.scopeId]), copy(row)); }),
    compact: jest.fn(async () => undefined),
  };
  const engine = new DataEngine({ runtime, observer, transport, checkpoints, snapshots, commits, manualScopes, operationId: () => `operation-${++sequence}`, onError });
  engine.setOnline(online); engine.setOwner('owner');
  const next = (snapshot: ResourceSnapshot, source: 'server' | 'cache' = 'server') => callbacks[callbacks.length - 1].next({ snapshot, source });
  return { engine, observer, runtime, transport, journal, entries, checkpoints, records, snapshots, cache, server, source, callbacks, next, onError, commits, manualScopes, manualRows };
}

describe('DataEngine composition', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

  it('pins pristine manual baseline and preserves the conflict when remote changes before typing', async () => {
    const s = setup({ online: false }); const editor = await s.engine.openEditor(resource, 'manual');
    const form = editor.form('title', [['title']]); await form.begin();
    s.next({ ...initial(2), value: { ...initial().value, title: 'Other device' } }); await drainMicrotasks();
    await form.update(value => ({ ...value, title: 'Mine' }));
    expect(editor.getState().checkpoint.draft?.title).toBe('Other device');
    s.server.set(keyOf('owner', resource), { ...initial(2), value: { ...initial().value, title: 'Other device' } });
    await form.save(); expect(editor.getState().checkpoint.draft?.title).toBe('Mine');
    s.engine.setOnline(true); await s.engine.retry();
    expect((await s.commits.list('owner'))[0].state).toBe('conflict');
    expect(editor.getState().result?.kind).toBe('conflict');
    expect(s.server.get(keyOf('owner', resource))?.value?.title).toBe('Other device');
    await editor.acceptRemote();
    expect(editor.getState().checkpoint.draft?.title).toBe('Other device');
    expect(Object.keys(editor.getState().checkpoint.pending)).toEqual([]);
    expect((await s.commits.list('owner'))[0].state).toBe('cancelled');
    s.engine.dispose();
  });

  it('refuses form conflict resolution while either its own or unrelated unsent input needs a decision', async () => {
    const s = setup({ online: false }); const editor = await s.engine.openEditor(resource, 'manual');
    const form = editor.form('title', [['title']]); await form.begin();
    await form.update(value => ({ ...value, title: 'Unsent form' }));
    await expect(form.resolve('remote')).rejects.toThrow('unsent form');
    expect(form.getState()?.value.title).toBe('Unsent form');
    await form.cancel(); await form.begin();
    await editor.edit({ ...editor.getState().checkpoint.draft, content: 'Unsent sibling' });
    await expect(form.resolve('local')).rejects.toThrow('other document changes');
    expect(editor.getState().checkpoint.draft?.content).toBe('Unsent sibling');
    expect(form.getState()?.record.active).toBe(true);
    expect(await s.commits.list('owner')).toEqual([]); s.engine.dispose();
  });

  it('preserves amended manual input when journal retirement fails, and recovers it in a new editor', async () => {
    const s = setup(); const editor = await s.engine.openEditor(resource, 'repair');
    const form = editor.form('title', [['title']]); await form.begin();
    await form.update(value => ({ ...value, title: 'Mine' }));
    s.server.set(keyOf('owner', resource), { ...initial(), value: { ...initial().value!, title: 'Theirs' } });
    await form.save(); await s.engine.retry(); await drainMicrotasks();
    await form.begin(); await form.update(value => ({ ...value, title: 'Corrected mine' }));
    await expect(form.save()).rejects.toThrow('Resolve the failed delivery');
    const count = (await s.commits.list('owner')).length;
    jest.mocked(s.journal.remove).mockRejectedValueOnce(new Error('Journal disk failure'));
    await expect(form.resolve('local')).rejects.toThrow('Journal disk failure');
    expect(form.getState()).toMatchObject({ value: { title: 'Corrected mine' }, dirty: true, durable: true, record: { active: false } });
    expect((await s.commits.list('owner'))).toHaveLength(count);
    editor.close({ flush: false });
    const reopened = await s.engine.openEditor(resource, 'repair-reopened');
    const recovered = reopened.form('title', [['title']]); await recovered.begin();
    const choices = await recovered.listRecoverable();
    expect(choices).toHaveLength(1); await recovered.recover(choices[0].scopeId);
    expect(recovered.getState()).toMatchObject({ value: { title: 'Corrected mine' }, dirty: true, record: { active: true } });
    expect(s.server.get(keyOf('owner', resource))!.value!.title).toBe('Theirs'); s.engine.dispose();
  });

  it('saves title B then D offline while unrelated unsaved content stays outside both requests', async () => {
    const s = setup({ online: false }); const editor = await s.engine.openEditor(resource, 'manual');
    await editor.edit({ ...editor.getState().checkpoint.draft, content: 'unsaved scratch C' });
    const form = editor.form('title', [['title']]); await form.begin();
    await form.update(value => ({ ...value, title: 'B' }));
    expect(editor.getState().checkpoint.draft?.title).toBe('Title');
    expect((await s.commits.list('owner'))).toEqual([]);
    await form.save(); expect(form.getState()?.record.active).toBe(false);
    expect(editor.getState().checkpoint.draft).toMatchObject({ title: 'B', content: 'unsaved scratch C' });
    await form.begin(); expect(form.getState()?.value.title).toBe('B');
    await form.save(value => ({ ...value, title: 'D' }));
    const requests = await s.commits.list('owner');
    expect(requests).toHaveLength(2);
    expect(requests[0].value).toMatchObject({ title: 'B', content: 'base' });
    expect(requests[1]).toMatchObject({ predecessor: requests[0].id, value: { title: 'D', content: 'base' } });
    expect(Object.keys(editor.getState().checkpoint.pending)).toEqual(requests.map(request => request.id));
    expect(s.source.listen).toHaveBeenCalledTimes(1);
    s.engine.setOnline(true); await s.engine.retry();
    expect(s.server.get(keyOf('owner', resource))?.value).toMatchObject({ title: 'D', content: 'base' });
    expect(editor.getState().checkpoint.draft).toMatchObject({ title: 'D', content: 'unsaved scratch C' });
    expect(editor.getState().checkpoint.dirty).toBe(true);
    await editor.save(); await s.engine.retry();
    expect(s.server.get(keyOf('owner', resource))?.value?.content).toBe('unsaved scratch C');
    expect(s.onError).not.toHaveBeenCalled(); s.engine.dispose();
  });

  it('recovers stage-only forms explicitly and owner fences old actions', async () => {
    const s = setup({ online: false }); const editor = await s.engine.openEditor(resource, 'first-tab');
    const form = editor.form('title', [['title']]); await form.begin(); await form.update(value => ({ ...value, title: 'recover me' }));
    const source = form.getState()!.record.scopeId; editor.dispose();
    const second = await s.engine.openEditor(resource, 'second-tab'); const restored = second.form('title', [['title']]);
    expect(restored.getState()).toBeNull(); expect(await restored.listRecoverable()).toHaveLength(1);
    await restored.recover(source);
    expect(restored.getState()?.value.title).toBe('recover me'); expect(restored.getState()?.record.scopeId).not.toBe(source);
    expect(second.getState().checkpoint.draft?.title).toBe('Title'); expect(await s.commits.list('owner')).toEqual([]);
    expect(s.manualRows.size).toBe(2);
    s.engine.setOwner('other'); expect(() => restored.save()).toThrow();
    expect(await s.commits.list('owner')).toEqual([]); s.engine.dispose();
  });

  it('refreshes the requested document on explicit retry without adding reads to background retries', async () => {
    const s = setup();
    const editor = await s.engine.openEditor(resource, 'retry-read');
    await drainMicrotasks();
    const refresh = jest.spyOn(s.observer, 'refresh');
    s.server.set(keyOf('owner', resource), initial(2, 'Fresh after a read failure'));
    await s.engine.retry();
    expect(refresh).not.toHaveBeenCalled();
    await s.engine.retry(resource);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith(resource);
    expect(editor.getState().checkpoint.draft?.content).toBe('Fresh after a read failure');
    s.engine.dispose();
    await s.engine.retry(resource);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('reads a cached document offline and treats a cached tombstone as a real result', async () => {
    const s = setup({ online: false });
    const first = await s.engine.read(resource);
    expect(first).toEqual(initial());
    first.value!.content = 'caller mutation';
    expect((await s.engine.read(resource)).value?.content).toBe('base');
    s.cache.set(keyOf('owner', resource), { ...initial(2), value: null, metadata: { ...initial(2).metadata!, deleted: true } });
    expect((await s.engine.read(resource)).value).toBeNull();
    expect(s.transport.read).not.toHaveBeenCalled();
    s.engine.dispose();
  });

  it('distinguishes an unavailable offline cache from authenticated server absence', async () => {
    const s = setup({ cached: false, online: false });
    await expect(s.engine.read(resource)).rejects.toThrow('local cache');
    expect(s.transport.read).not.toHaveBeenCalled();
    s.engine.setOnline(true); s.server.clear();
    expect(await s.engine.read(resource)).toEqual(absent());
    expect(s.cache.get(keyOf('owner', resource))).toEqual(absent());
    s.engine.dispose();
  });

  it('deduplicates cache misses and caches the server response before returning it', async () => {
    const s = setup({ cached: false }); const response = deferred<ResourceSnapshot>();
    jest.mocked(s.transport.read).mockReturnValueOnce(response.promise);
    const first = s.engine.read(resource); const second = s.engine.read(resource);
    await drainMicrotasks(); expect(s.transport.read).toHaveBeenCalledTimes(1);
    response.resolve(initial());
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(initial()); expect(b).toEqual(initial()); expect(a).not.toBe(b);
    expect(s.cache.get(keyOf('owner', resource))).toEqual(initial());
    s.engine.dispose();
  });

  it('persists an offline draft, queues its save, and restores it after editor disposal', async () => {
    const s = setup({ online: false });
    const editor = await s.engine.openEditor(resource, 'tab');
    await editor.edit({ ...editor.getState().checkpoint.draft, content: 'offline work' });
    await editor.save();
    expect((await s.engine.listPending())[0]).toMatchObject({ state: 'queued', command: { kind: 'update' } });
    expect(s.transport.send).not.toHaveBeenCalled();
    editor.dispose();
    const restored = await s.engine.openEditor(resource, 'tab');
    expect(restored.getState()).toMatchObject({ durable: true, checkpoint: { dirty: true, draft: { content: 'offline work' } } });
    expect(s.entries.size).toBe(1);
    s.engine.setOnline(true); await s.engine.retry();
    expect(restored.getState().checkpoint.dirty).toBe(false);
    expect(s.server.get(keyOf('owner', resource))?.value?.content).toBe('offline work');
    expect(s.cache.get(keyOf('owner', resource))?.value?.content).toBe('offline work');
    expect(s.entries.size).toBe(0);
    s.engine.dispose();
  });

  it('retries a failed draft checkpoint offline without requiring another keystroke', async () => {
    const s = setup({ online: false });
    try {
      const editor = await s.engine.openEditor(resource, 'tab');
      jest.mocked(s.checkpoints.put).mockRejectedValueOnce(new Error('temporary disk failure'));
      await expect(editor.edit({ ...editor.getState().checkpoint.draft, content: 'retain this draft' })).rejects.toThrow('temporary disk failure');
      expect(editor.getState().durable).toBe(false);
      await s.engine.retry();
      expect(editor.getState()).toMatchObject({ durable: true, checkpoint: { dirty: true, draft: { content: 'retain this draft' } } });
      expect([...s.records.values()][0].checkpoint.draft?.content).toBe('retain this draft');
      expect(s.transport.send).not.toHaveBeenCalled();
    } finally { s.engine.dispose(); }
  });

  it.each([false, true])('retries a prepared command after journal failure with later typing=%s', async laterTyping => {
    const s = setup({ online: false });
    try {
      const editor = await s.engine.openEditor(resource, 'tab');
      await editor.edit({ ...editor.getState().checkpoint.draft, content: 'retained command' });
      jest.mocked(s.journal.put).mockRejectedValueOnce(new Error('temporary journal failure'));
      await editor.save();
      const prepared = (await s.commits.list('owner'))[0].command;
      expect(prepared?.operationId).toBe('operation-1');
      expect(s.onError).toHaveBeenCalledWith(new Error('temporary journal failure'));
      if (laterTyping) {
        await editor.edit({ ...editor.getState().checkpoint.draft, content: 'Typed after the journal failed' });
        expect(editor.getState().durable).toBe(true);
      }
      s.engine.setOnline(true);
      await s.engine.retry();
      expect(s.transport.send).toHaveBeenCalledTimes(1);
      expect(s.transport.send).toHaveBeenCalledWith(prepared);
      expect(editor.getState()).toMatchObject({ durable: true, checkpoint: { dirty: laterTyping, pending: {} } });
      expect(editor.getState().checkpoint.draft?.content).toBe(laterTyping ? 'Typed after the journal failed' : 'retained command');
      expect(s.server.get(keyOf('owner', resource))?.value?.content).toBe('retained command');
    } finally { s.engine.dispose(); }
  });

  it('publishes queued delivery only to its owning editor and not to another editor of the same resource', async () => {
    const s = setup({ online: false });
    const first = await s.engine.openEditor(resource, 'first');
    const second = await s.engine.openEditor(resource, 'second');
    const pendingListener = jest.fn(); const unsubscribe = s.engine.subscribePending(pendingListener);
    s.engine.subscribePending(() => { throw new Error('Rendering failed'); });
    const firstListener = jest.fn(); const secondListener = jest.fn();
    first.subscribe(firstListener); second.subscribe(secondListener);
    await first.edit({ ...first.getState().checkpoint.draft, content: 'queued' });
    firstListener.mockClear(); secondListener.mockClear();
    await first.save();
    expect(s.engine.getPending()).toEqual(await s.engine.listPending());
    expect(first.getDelivery()).toMatchObject([{ state: 'queued', command: { operationId: 'operation-1' } }]);
    expect(second.getDelivery()).toEqual([]);
    expect(firstListener).toHaveBeenCalled(); expect(secondListener).not.toHaveBeenCalled();
    expect(pendingListener).toHaveBeenCalled();
    const detached = s.engine.getPending(); detached[0].state = 'refused';
    expect(s.engine.getPending()[0].state).toBe('queued');
    const detachedDelivery = first.getDelivery(); detachedDelivery[0].command.operationId = 'tampered';
    expect(first.getDelivery()[0].command.operationId).toBe('operation-1');
    unsubscribe(); s.engine.dispose();
    expect(() => first.getDelivery()).toThrow();
    expect(() => s.engine.subscribePending(jest.fn())).toThrow('disposed');
  });

  it('publishes an unknown result and clears pending delivery after acknowledged recovery', async () => {
    const s = setup({ online: false }); const editor = await s.engine.openEditor(resource, 'tab');
    const send = jest.mocked(s.transport.send).getMockImplementation()!;
    jest.mocked(s.transport.send).mockRejectedValue(new Error('Response lost'));
    await editor.edit({ ...editor.getState().checkpoint.draft, content: 'recover' }); await editor.save();
    const states: string[] = []; editor.subscribe(() => states.push(editor.getDelivery()[0]?.state ?? 'empty'));
    s.engine.setOnline(true); await s.engine.retry();
    expect(s.engine.getPending()[0].state).toBe('unknown');
    expect(editor.getDelivery()[0].state).toBe('unknown');
    expect(states).toContain('unknown');
    jest.mocked(s.transport.send).mockImplementation(send);
    await s.engine.retry(); await drainMicrotasks();
    expect(s.engine.getPending()).toEqual([]); expect(editor.getDelivery()).toEqual([]);
    expect(states).toContain('empty');
    s.engine.dispose();
  });

  it('publishes a terminal refusal and clears it only after explicit recovery', async () => {
    const s = setup({ online: false }); const editor = await s.engine.openEditor(resource, 'tab');
    await editor.edit({ ...editor.getState().checkpoint.draft, content: 'mine' }); await editor.save();
    jest.mocked(s.transport.send).mockResolvedValue({ kind: 'refused', operationId: 'operation-1', code: 'permission-denied' });
    const listener = jest.fn(); editor.subscribe(listener);
    s.engine.setOnline(true); await s.engine.retry();
    expect(editor.getDelivery()).toMatchObject([{ state: 'refused', result: { code: 'permission-denied' } }]);
    expect(s.engine.getPending()[0].state).toBe('refused'); expect(listener).toHaveBeenCalled();
    await editor.acceptRemote();
    expect(s.engine.getPending()).toEqual([]); expect(editor.getDelivery()).toEqual([]);
    s.engine.dispose();
  });

  it('keeps local conflict fields on explicit choice without sending until save is requested', async () => {
    const s = setup({ online: false }); const editor = await s.engine.openEditor(resource, 'tab');
    await editor.edit({ ...editor.getState().checkpoint.draft, content: 'mine' }); await editor.save();
    s.server.set(keyOf('owner', resource), { ...initial(2, 'theirs'), value: { ...initial(2, 'theirs').value, title: 'Remote title' } });
    s.engine.setOnline(true); await s.engine.retry();
    expect(editor.getDelivery()[0].state).toBe('conflict');
    await editor.keepLocal();
    expect(editor.getDelivery()).toEqual([]); expect(s.engine.getPending()).toEqual([]);
    expect(editor.getState().checkpoint).toMatchObject({ draft: { content: 'mine', title: 'Remote title' }, dirty: true });
    expect(s.transport.send).toHaveBeenCalledTimes(1);
    await editor.save(); await s.engine.retry();
    expect(s.server.get(keyOf('owner', resource))?.value).toMatchObject({ content: 'mine', title: 'Remote title' });
    s.engine.dispose();
  });

  it('clears pending state at account boundaries and hydrates persisted work without sending offline', async () => {
    const s = setup({ online: false }); const editor = await s.engine.openEditor(resource, 'tab');
    await editor.edit({ ...editor.getState().checkpoint.draft, content: 'owned' }); await editor.save();
    const snapshots: JournalEntry[][] = [];
    s.engine.subscribePending(() => snapshots.push(s.engine.getPending()));
    s.engine.setOwner('other');
    expect(s.engine.getPending()).toEqual([]); expect(snapshots[snapshots.length - 1]).toEqual([]);
    await drainMicrotasks(); expect(s.engine.getPending()).toEqual([]);
    s.engine.setOwner('owner'); await drainMicrotasks();
    expect(s.engine.getPending()).toMatchObject([{ state: 'queued', command: { owner: 'owner' } }]);
    expect(s.transport.send).not.toHaveBeenCalled();
    s.engine.dispose(); expect(s.engine.getPending()).toEqual([]);
  });

  it('does not let late initial journal hydration overwrite a newer publication', async () => {
    const s = setup({ online: false });
    s.engine.setOwner(null);
    const reading = deferred<JournalEntry[]>();
    jest.spyOn(s.runtime, 'list').mockReturnValueOnce(reading.promise);
    s.engine.setOwner('owner');
    const editor = await s.engine.openEditor(resource, 'tab');
    await editor.edit({ ...editor.getState().checkpoint.draft, content: 'queued' }); await editor.save();
    reading.resolve([]); await drainMicrotasks();
    expect(s.engine.getPending()).toHaveLength(1);
    s.engine.dispose();
  });

  it('does not expose a late journal hydration belonging to the previous owner', async () => {
    const s = setup({ online: false }); const editor = await s.engine.openEditor(resource, 'tab');
    await editor.edit({ ...editor.getState().checkpoint.draft, content: 'queued' }); await editor.save();
    const old = s.engine.getPending();
    s.engine.setOwner(null);
    const reading = deferred<JournalEntry[]>(); jest.spyOn(s.runtime, 'list').mockReturnValueOnce(reading.promise);
    s.engine.setOwner('owner'); s.engine.setOwner('other');
    reading.resolve(old); await drainMicrotasks();
    expect(s.engine.getPending()).toEqual([]);
    s.engine.dispose();
  });

  it('refreshes only the actively observed resource after ACK and does not create a polling loop', async () => {
    const s = setup({ online: false }); const editor = await s.engine.openEditor(resource, 'tab');
    const refresh = jest.spyOn(s.observer, 'refresh');
    await editor.edit({ ...editor.getState().checkpoint.draft, content: 'saved' }); await editor.save();
    s.engine.setOnline(true); await s.engine.retry(); await drainMicrotasks();
    expect(refresh).toHaveBeenCalledTimes(1); expect(refresh).toHaveBeenCalledWith(resource);
    await s.engine.retry(); await drainMicrotasks(); expect(refresh).toHaveBeenCalledTimes(1);
    s.engine.setOnline(false);
    await editor.edit({ ...editor.getState().checkpoint.draft, content: 'later' }); await editor.save();
    editor.dispose(); s.engine.setOnline(true); await s.engine.retry(); await drainMicrotasks();
    expect(refresh).toHaveBeenCalledTimes(1);
    s.engine.dispose();
  });

  it('avoids an extra ACK read when the listener has already proved the accepted revision', async () => {
    const s = setup({ online: false }); const editor = await s.engine.openEditor(resource, 'tab');
    const send = jest.mocked(s.transport.send).getMockImplementation()!;
    jest.mocked(s.transport.send).mockImplementation(async command => {
      const result = await send(command);
      if (result.kind === 'acknowledged') s.next(result.snapshot);
      return result;
    });
    const refresh = jest.spyOn(s.observer, 'refresh');
    await editor.edit({ ...editor.getState().checkpoint.draft, content: 'saved' }); await editor.save();
    s.engine.setOnline(true); await s.engine.retry(); await drainMicrotasks();
    expect(editor.getObservation().readiness).toBe('server');
    expect(refresh).not.toHaveBeenCalled();
    expect(s.transport.read).not.toHaveBeenCalled();
    s.engine.dispose();
  });

  it('recovers offline from its durable checkpoint when the separate snapshot cache is unavailable', async () => {
    const s = setup({ online: false });
    const editor = await s.engine.openEditor(resource, 'tab');
    await editor.edit({ ...editor.getState().checkpoint.draft, content: 'recover me' });
    editor.dispose(); await drainMicrotasks(); s.cache.clear();
    const recovered = await s.engine.openEditor(resource, 'tab');
    expect(recovered.getState().checkpoint).toMatchObject({ draft: { content: 'recover me' }, dirty: true });
    expect(s.transport.read).not.toHaveBeenCalled();
    expect(s.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'The document is not available in the local cache' }));
    s.engine.dispose();
  });

  it('does not invent an empty baseline when an offline editor has neither cache nor checkpoint', async () => {
    const s = setup({ online: false, cached: false });
    await expect(s.engine.openEditor(resource, 'tab')).rejects.toThrow('local cache');
    expect(s.source.listen).not.toHaveBeenCalled();
    s.engine.dispose();
  });

  it('saves through the controller and real runtime, then caches only its accepted projection', async () => {
    const s = setup(); const editor = await s.engine.openEditor(resource, 'tab');
    const listener = jest.fn(); const stop = editor.subscribe(listener);
    editor.subscribe(() => { throw new Error('Rendering failed'); });
    await editor.edit({ ...editor.getState().checkpoint.draft, content: 'saved work' });
    expect(s.cache.get(keyOf('owner', resource))?.value?.content).toBe('base');
    await editor.save(); await s.engine.retry();
    expect(editor.getState()).toMatchObject({ durable: true, result: { kind: 'acknowledged' }, checkpoint: { dirty: false } });
    expect(s.cache.get(keyOf('owner', resource))?.value?.content).toBe('saved work');
    expect(s.transport.send).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalled(); stop(); s.engine.dispose();
  });

  it('allows independent editors to share observation while keeping separate local drafts', async () => {
    const s = setup({ online: false });
    const first = await s.engine.openEditor(resource, 'one');
    const second = await s.engine.openEditor(resource, 'two');
    expect(s.source.listen).toHaveBeenCalledTimes(1);
    await first.edit({ ...first.getState().checkpoint.draft, content: 'first local' });
    expect(second.getState().checkpoint.draft?.content).toBe('base');
    first.dispose(); first.dispose(); expect(s.callbacks[0].stop).not.toHaveBeenCalled();
    second.dispose(); expect(s.callbacks[0].stop).toHaveBeenCalledTimes(1);
    s.engine.dispose();
  });

  it('rejects duplicate active or concurrently opening editor identities', async () => {
    const s = setup(); const first = s.engine.openEditor(resource, 'same');
    await expect(s.engine.openEditor(resource, 'same')).rejects.toThrow('already open');
    const editor = await first;
    await expect(s.engine.createEditor({ ...resource, id: 'another' }, 'same')).rejects.toThrow('already open');
    editor.dispose(); expect(await s.engine.openEditor(resource, 'same')).toBeDefined();
    s.engine.dispose();
  });

  it('immediately cancels a pending read and releases its editor identity for another resource', async () => {
    const s = setup({ cached: false }); const response = deferred<ResourceSnapshot>();
    jest.mocked(s.transport.read).mockReturnValueOnce(response.promise);
    const cancellation = new AbortController();
    const old = s.engine.openEditor(resource, 'tab', { signal: cancellation.signal });
    await drainMicrotasks(); cancellation.abort();
    await expect(old).rejects.toMatchObject({ name: 'AbortError' });
    const other = { ...resource, id: 'other' };
    s.cache.set(keyOf('owner', other), { ...initial(), resource: other });
    const current = await s.engine.openEditor(other, 'tab');
    response.resolve(initial()); await drainMicrotasks();
    expect(current.getState().checkpoint.confirmed.resource).toEqual(other);
    expect(s.source.listen).toHaveBeenCalledTimes(1);
    await expect(s.engine.openEditor(other, 'tab')).rejects.toThrow('already open');
    current.dispose(); s.engine.dispose();
  });

  it('allows a cancelled identity to reopen the same resource while sharing its pending read', async () => {
    const s = setup({ cached: false }); const response = deferred<ResourceSnapshot>();
    jest.mocked(s.transport.read).mockReturnValueOnce(response.promise);
    const cancellation = new AbortController();
    const old = s.engine.openEditor(resource, 'tab', { signal: cancellation.signal });
    await drainMicrotasks(); cancellation.abort();
    await expect(old).rejects.toMatchObject({ name: 'AbortError' });
    const replacement = s.engine.openEditor(resource, 'tab');
    response.resolve(initial());
    const current = await replacement; await drainMicrotasks();
    expect(s.transport.read).toHaveBeenCalledTimes(1);
    expect(s.source.listen).toHaveBeenCalledTimes(1);
    expect(current.getState().checkpoint.confirmed).toEqual(initial());
    s.engine.dispose();
  });

  it('does not attach a controller after cancellation during checkpoint recovery', async () => {
    const s = setup(); const reading = deferred<EditorRecord | undefined>();
    jest.mocked(s.checkpoints.read).mockReturnValueOnce(reading.promise);
    const cancellation = new AbortController();
    const opening = s.engine.openEditor(resource, 'tab', { signal: cancellation.signal });
    await drainMicrotasks(); cancellation.abort();
    await expect(opening).rejects.toMatchObject({ name: 'AbortError' });
    const current = await s.engine.openEditor(resource, 'tab');
    reading.resolve(undefined); await drainMicrotasks();
    expect(current.getState().checkpoint.confirmed).toEqual(initial());
    expect(s.source.listen).toHaveBeenCalledTimes(1);
    expect(s.callbacks[0].stop).not.toHaveBeenCalled();
    s.engine.dispose();
  });

  it('rejects an already aborted create and removes the abort listener after successful open', async () => {
    const s = setup({ online: false }); const cancelled = new AbortController(); cancelled.abort();
    await expect(s.engine.createEditor(resource, 'new', { signal: cancelled.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(s.checkpoints.read).not.toHaveBeenCalled();
    const active = new AbortController();
    const remove = jest.spyOn(active.signal, 'removeEventListener');
    const editor = await s.engine.createEditor(resource, 'new', { signal: active.signal });
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    active.abort(); expect(editor.getState().checkpoint.confirmed).toEqual(absent());
    editor.dispose(); s.engine.dispose();
  });

  it('applies remote observations through the controller and preserves dirty drafts as candidates', async () => {
    const s = setup(); const editor = await s.engine.openEditor(resource, 'tab');
    s.next(initial(2, 'remote')); await drainMicrotasks();
    expect(editor.getState().checkpoint.draft?.content).toBe('remote');
    expect(editor.getObservation()).toMatchObject({ readiness: 'server', snapshot: initial(2, 'remote') });
    await editor.edit({ ...editor.getState().checkpoint.draft, content: 'mine' });
    s.next(initial(3, 'next remote')); await drainMicrotasks();
    expect(editor.getState().checkpoint).toMatchObject({ draft: { content: 'mine' }, remoteCandidate: { value: { content: 'next remote' } } });
    expect((await s.engine.read(resource)).value?.content).toBe('next remote');
    await editor.acceptRemote();
    expect(editor.getState().checkpoint.draft?.content).toBe('next remote');
    s.engine.dispose();
  });

  it('reconciles the opening cache before a synchronous newer legacy source event', async () => {
    const s = setup();
    const cached = { ...initial(), metadata: null, value: { ...initial().value, rev: { note: 1 } } };
    const remote = { ...cached, value: { ...cached.value, content: 'latest', rev: { note: 2 } } };
    s.cache.set(keyOf('owner', resource), cached);
    s.source.listen.mockImplementationOnce((_owner, _resource, next) => {
      next({ snapshot: remote, source: 'server' }); return jest.fn();
    });
    const editor = await s.engine.openEditor(resource, 'tab'); await drainMicrotasks();
    expect(editor.getState().checkpoint.confirmed).toEqual(remote);
    s.engine.dispose();
  });

  it('keeps a restored legacy checkpoint that is newer than the separate snapshot cache', async () => {
    const s = setup({ online: false });
    const latest = { ...initial(), metadata: null, value: { ...initial().value, content: 'latest', rev: { note: 2 } } };
    s.cache.set(keyOf('owner', resource), latest);
    const first = await s.engine.openEditor(resource, 'tab'); first.dispose();
    await drainMicrotasks();
    s.cache.set(keyOf('owner', resource), { ...latest, value: { ...latest.value, content: 'stale', rev: { note: 1 } } });
    const restored = await s.engine.openEditor(resource, 'tab');
    expect(restored.getState().checkpoint.confirmed).toEqual(latest);
    s.engine.dispose();
  });

  it('propagates remote deletion without turning cache absence into a deletion', async () => {
    const s = setup(); const editor = await s.engine.openEditor(resource, 'tab');
    s.next(absent(), 'cache'); await drainMicrotasks();
    expect(editor.getState().checkpoint.draft?.content).toBe('base');
    const deleted = { ...initial(2), value: null, metadata: { ...initial(2).metadata!, deleted: true } };
    s.next(deleted); await drainMicrotasks();
    expect(editor.getState().checkpoint.draft).toBeNull();
    expect(await s.engine.read(resource)).toEqual(deleted);
    s.engine.dispose();
  });

  it('creates explicit absent intent offline and begins observation only after creation succeeds', async () => {
    const s = setup({ online: false }); const ref = { ...resource, id: 'domain-prefix-new' };
    const editor = await s.engine.createEditor(ref, 'new');
    expect(s.transport.read).not.toHaveBeenCalled(); expect(s.source.listen).not.toHaveBeenCalled();
    await editor.edit({ ...initial().value, content: 'created' }); await editor.save();
    expect((await s.engine.listPending())[0].command.kind).toBe('create');
    expect(s.cache.has(keyOf('owner', ref))).toBe(false);
    s.engine.setOnline(true); await s.engine.retry();
    expect(editor.getState().checkpoint.dirty).toBe(false);
    expect(s.source.listen).toHaveBeenCalledTimes(1);
    expect(s.server.get(keyOf('owner', ref))?.value?.content).toBe('created');
    s.engine.dispose();
  });

  it('does not let a create collision become an update of existing server data', async () => {
    const s = setup(); const editor = await s.engine.createEditor(resource, 'new');
    expect(s.source.listen).not.toHaveBeenCalled();
    await editor.edit({ ...initial().value, content: 'new copy' }); await editor.save(); await s.engine.retry();
    expect(s.transport.send).toHaveBeenCalledWith(expect.objectContaining({ kind: 'create' }));
    expect(s.server.get(keyOf('owner', resource))).toEqual(initial());
    expect(editor.getState().checkpoint.draft?.content).toBe('new copy');
    expect(editor.getState().checkpoint.dirty).toBe(true);
    s.engine.dispose();
  });

  it('fences late reads after an account change without populating another owner cache', async () => {
    const s = setup({ cached: false }); const response = deferred<ResourceSnapshot>();
    jest.mocked(s.transport.read).mockReturnValueOnce(response.promise);
    const read = s.engine.read(resource); await drainMicrotasks();
    s.engine.setOwner('other'); response.resolve(initial());
    await expect(read).rejects.toThrow('Account changed');
    expect(s.cache.size).toBe(0); s.engine.dispose();
  });

  it('rejects an open completed after sign-out and releases its editor reservation', async () => {
    const s = setup(); const checkpoint = deferred<EditorRecord | undefined>();
    jest.mocked(s.checkpoints.read).mockReturnValueOnce(checkpoint.promise);
    const opening = s.engine.openEditor(resource, 'tab'); await drainMicrotasks();
    s.engine.setOwner(null); checkpoint.resolve(undefined);
    await expect(opening).rejects.toThrow();
    s.engine.setOwner('owner'); expect(await s.engine.openEditor(resource, 'tab')).toBeDefined();
    s.engine.dispose();
  });

  it('disposes old editors on account changes and ignores their late subscription events', async () => {
    const s = setup(); const editor = await s.engine.openEditor(resource, 'tab');
    const listener = jest.fn(); editor.subscribe(listener);
    s.engine.setOwner('other'); s.next(initial(50, 'late'));
    await drainMicrotasks(); expect(listener).not.toHaveBeenCalled();
    expect(() => editor.getState()).toThrow('Account changed');
    expect(() => editor.edit({ content: 'wrong' })).toThrow('Account changed');
    expect(() => editor.subscribe(jest.fn())).toThrow('Account changed');
    await expect(editor.save()).rejects.toThrow('Account changed');
    await expect(editor.acceptRemote()).rejects.toThrow('Account changed');
    await expect(editor.keepLocal()).rejects.toThrow('Account changed');
    editor.dispose(); s.engine.dispose();
  });

  it('does not deliver while hidden and resumes queued work on visibility return', async () => {
    const s = setup(); s.engine.setVisible(false); s.engine.setVisible(false);
    const editor = await s.engine.openEditor(resource, 'tab');
    await editor.edit({ ...editor.getState().checkpoint.draft, content: 'hidden queued' }); await editor.save();
    await s.engine.retry(); expect(s.transport.send).not.toHaveBeenCalled();
    s.engine.setVisible(true); await s.engine.retry();
    expect(s.server.get(keyOf('owner', resource))?.value?.content).toBe('hidden queued');
    s.engine.dispose();
  });

  it('reports automatic failures and keeps failed persistence from becoming a send', async () => {
    const s = setup(); const editor = await s.engine.openEditor(resource, 'tab');
    await drainMicrotasks(); jest.mocked(s.checkpoints.put).mockRejectedValueOnce(new Error('Disk full'));
    await expect(editor.edit({ ...editor.getState().checkpoint.draft, content: 'unsafe' })).rejects.toThrow('Disk full');
    expect(s.transport.send).not.toHaveBeenCalled();
    expect(editor.getState().durable).toBe(false);
    jest.spyOn(s.runtime, 'drain').mockRejectedValueOnce(new Error('Journal unavailable'));
    s.engine.setOnline(false); s.engine.setOnline(true); await drainMicrotasks();
    expect(s.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Journal unavailable' }));
    s.engine.dispose();
  });

  it('does not downgrade a cache that becomes newer while an HTTP request is in flight', async () => {
    const s = setup({ cached: false }); const response = deferred<ResourceSnapshot>();
    jest.mocked(s.transport.read).mockReturnValueOnce(response.promise);
    const reading = s.engine.read(resource); await drainMicrotasks();
    s.cache.set(keyOf('owner', resource), initial(5, 'newest'));
    response.resolve(initial(2, 'old'));
    expect(await reading).toEqual(initial(5, 'newest'));
    expect(s.cache.get(keyOf('owner', resource))).toEqual(initial(5, 'newest'));
    s.engine.dispose();
  });

  it('validates resource boundaries and isolates bad cache or server identities', async () => {
    const s = setup();
    expect(() => s.engine.read({ collection: 'secret', id: 'id' })).toThrow('Unregistered');
    expect(() => s.engine.read({ ...resource, id: '../wrong' })).toThrow('Invalid resource');
    expect(() => s.engine.read({ collection: 'users', id: 'other' })).toThrow('Owner identity');
    await expect(s.engine.openEditor(resource, '')).rejects.toThrow('identity is required');
    s.cache.set(keyOf('owner', resource), { ...initial(), resource: { ...resource, id: 'wrong' } });
    await expect(s.engine.read(resource)).rejects.toThrow('Cached snapshot identity');
    s.cache.clear(); jest.mocked(s.transport.read).mockResolvedValueOnce({ ...initial(), resource: { ...resource, id: 'wrong' } });
    await expect(s.engine.read(resource)).rejects.toThrow('Server snapshot identity');
    s.engine.setOwner(null); expect(() => s.engine.read(resource)).toThrow('Authentication');
    s.engine.dispose(); s.engine.dispose();
    s.engine.setOwner('owner'); s.engine.setVisible(false); s.engine.setOnline(false);
    expect(() => s.engine.read(resource)).toThrow('disposed');
  });

  it('keeps custom document-only engines explicit about unavailable collection APIs', () => {
    const s = setup();
    expect(() => s.engine.readCollection('studyNotes')).toThrow('not configured');
    expect(() => s.engine.watchCollection('studyNotes', jest.fn())).toThrow('not configured');
    expect(() => s.engine.refreshCollection('studyNotes')).toThrow('not configured');
    s.engine.dispose();
  });

  it('cleans up a constructed controller if observer attachment fails', async () => {
    const s = setup(); jest.spyOn(s.observer, 'watch').mockImplementationOnce(() => { throw new Error('Observer unavailable'); });
    await expect(s.engine.openEditor(resource, 'tab')).rejects.toThrow('Observer unavailable');
    const editor = await s.engine.openEditor(resource, 'tab');
    editor.dispose(); expect(() => editor.getObservation()).toThrow('no longer active');
    s.engine.dispose();
  });
});

describe('canReplaceSnapshot', () => {
  it('preserves generation, revision and deletion evidence and supports legacy upgrades', () => {
    expect(canReplaceSnapshot(undefined, initial())).toBe(true);
    expect(canReplaceSnapshot(initial(3), initial(2))).toBe(false);
    expect(canReplaceSnapshot(initial(), { ...initial(2), resource: { ...resource, id: 'other' } })).toBe(false);
    expect(canReplaceSnapshot(initial(), { ...initial(2), metadata: { ...initial(2).metadata!, generation: 'other' } })).toBe(false);
    expect(canReplaceSnapshot(initial(), { ...initial(), metadata: null })).toBe(false);
    const tombstone = { ...initial(2), value: null, metadata: { ...initial(2).metadata!, deleted: true } };
    expect(canReplaceSnapshot(tombstone, initial(3))).toBe(false);
    expect(canReplaceSnapshot(initial(), tombstone)).toBe(true);
    const legacy = { ...initial(), metadata: null, value: { rev: { note: 3 } } };
    expect(canReplaceSnapshot(legacy, { ...legacy, value: { rev: { note: 2 } } })).toBe(false);
    expect(canReplaceSnapshot(legacy, initial())).toBe(true);
    expect(canReplaceSnapshot(legacy, absent())).toBe(true);
    expect(canReplaceSnapshot(absent(), legacy)).toBe(true);
  });
});
