import { DataEngine } from '../engine';
import { createMemoryCommitStore } from '../commits';
import { ResourceObserver } from '../observer';
import { recoveryCheckpointId, selectRecoverableCheckpoints } from '../recovery.client';
import { DataEngineRuntime } from '../runtime';
import { DataSession } from '../session';

import type { CheckpointRecoveryStore, EditorRecord } from '../controller';
import type { EngineTransport, ResourceSnapshot } from '../types';

const resource = { collection: 'studyNotes', id: 'note' };
const snapshot: ResourceSnapshot = { resource, value: { userId: 'owner', content: 'base' }, metadata: { protocol: 1, generation: 'gen', revision: 1, deleted: false } };
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const tick = async () => { for (let index = 0; index < 50; index += 1) await Promise.resolve(); };
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
function setup(creating = false) {
  const session = new DataSession(creating ? { resource, value: null, metadata: null } : snapshot);
  session.edit(creating ? { content: 'new' } : { userId: 'owner', content: 'mine' });
  const source: EditorRecord = { owner: 'owner', editorId: 'previous-tab', checkpoint: session.checkpoint(), prepared: null, unfinalized: [] };
  const records = new Map([[recoveryCheckpointId('owner', source.editorId), clone(source)]]);
  const store: CheckpointRecoveryStore = {
    read: jest.fn(async (owner, id) => { const value = records.get(recoveryCheckpointId(owner, id)); return value && clone(value); }),
    put: jest.fn(async record => { records.set(recoveryCheckpointId(record.owner, record.editorId), clone(record)); }),
    create: jest.fn(async record => {
      const key = recoveryCheckpointId(record.owner, record.editorId);
      if (records.has(key)) throw new Error('Recovery target already exists');
      records.set(key, clone(record));
    }),
    listRecoverable: jest.fn(async (owner, ref) => selectRecoverableCheckpoints([...records], owner, ref)),
  };
  const transport: EngineTransport = { read: jest.fn(async () => snapshot), send: jest.fn() };
  const runtime = new DataEngineRuntime({ transport, journal: { list: async () => [], put: async () => undefined, remove: async () => undefined } });
  const sourceAdapter = { listen: jest.fn(() => jest.fn()) };
  const observer = new ResourceObserver({ transport, source: sourceAdapter });
  const commits = createMemoryCommitStore();
  const engine = new DataEngine({ runtime, observer, transport, checkpoints: store, commits,
    snapshots: { read: async () => snapshot, put: async () => undefined }, operationId: () => 'new-operation' });
  engine.setOnline(false); engine.setOwner('owner');
  return { engine, store, records, source, sourceAdapter, commits };
}

describe('DataEngine explicit recovery', () => {
  it('exposes explicit removal on the managed editor and refuses a second unresolved deletion', async () => {
    const s = setup(); const editor = await s.engine.openEditor(resource, 'ordinary');
    await editor.remove();
    const record = (await s.commits.list('owner'))[0];
    expect(record?.command).toMatchObject({ kind: 'delete', baseline: snapshot.value });
    expect(editor.getState().checkpoint.draft).toBeNull();
    await expect(editor.remove()).rejects.toThrow('pending commands');
    editor.dispose(); s.engine.dispose();
  });
  it('lists stable owner/resource-scoped records and opens a fork without changing the source', async () => {
    const s = setup();
    const listed = await s.engine.listRecoverable(resource);
    expect(listed).toEqual([{ id: '["owner","previous-tab"]', record: s.source }]);
    listed[0].record.checkpoint.draft!.content = 'caller mutation';
    const editor = await s.engine.recoverEditor(resource, 'fresh-tab', listed[0].id);
    expect(editor.getState().checkpoint.draft?.content).toBe('mine');
    expect(s.records.get('["owner","previous-tab"]')).toEqual(s.source);
    await expect(s.engine.recoverEditor(resource, 'fresh-tab', listed[0].id)).rejects.toThrow('already open');
    editor.dispose();
    await expect(s.engine.recoverEditor(resource, 'fresh-tab', listed[0].id)).rejects.toThrow('already exists');
    s.engine.setOwner('other'); expect(await s.engine.listRecoverable()).toEqual([]);
    s.engine.dispose();
  });

  it('preserves recovered create intent before any observation can turn it into an update', async () => {
    const s = setup(true);
    const editor = await s.engine.recoverEditor(resource, 'fresh-tab', '["owner","previous-tab"]');
    expect(editor.getState().checkpoint.confirmed).toEqual({ resource, value: null, metadata: null });
    expect(editor.getState().checkpoint.draft).toEqual({ content: 'new' });
    expect(s.sourceAdapter.listen).not.toHaveBeenCalled();
    s.engine.setOnline(true); await tick();
    expect(s.sourceAdapter.listen).not.toHaveBeenCalled();
    editor.dispose(); s.engine.dispose();
  });

  it('fences late discovery and source reads after an account transition, without creating the target', async () => {
    const s = setup(); const listing = deferred<Awaited<ReturnType<CheckpointRecoveryStore['listRecoverable']>>>();
    jest.mocked(s.store.listRecoverable).mockReturnValueOnce(listing.promise);
    const pendingList = s.engine.listRecoverable(); s.engine.setOwner('other'); listing.resolve([{ id: 'old', record: s.source }]);
    await expect(pendingList).rejects.toThrow('Account changed');
    s.engine.setOwner('owner'); const reading = deferred<EditorRecord>();
    jest.mocked(s.store.read).mockReturnValueOnce(reading.promise);
    const pendingFork = s.engine.recoverEditor(resource, 'fresh', '["owner","previous-tab"]');
    await expect(s.engine.openEditor(resource, 'fresh')).rejects.toThrow('already open');
    await expect(s.engine.recoverEditor(resource, 'fresh', '["owner","previous-tab"]')).rejects.toThrow('already open');
    s.engine.setOwner('other'); reading.resolve(s.source);
    await expect(pendingFork).rejects.toThrow('Account changed');
    expect(s.store.create).not.toHaveBeenCalled(); s.engine.dispose();
  });

  it('cancels recovery before or during a source read and releases its reserved identity', async () => {
    const s = setup(); const cancelled = new AbortController(); cancelled.abort();
    await expect(s.engine.recoverEditor(resource, 'fresh', '["owner","previous-tab"]', { signal: cancelled.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(s.store.read).not.toHaveBeenCalled();
    const reading = deferred<EditorRecord>(); jest.mocked(s.store.read).mockReturnValueOnce(reading.promise);
    const active = new AbortController();
    const pending = s.engine.recoverEditor(resource, 'fresh', '["owner","previous-tab"]', { signal: active.signal });
    active.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' }); expect(s.store.create).not.toHaveBeenCalled();
    const editor = await s.engine.openEditor(resource, 'fresh');
    reading.resolve(s.source); await tick(); expect(s.store.create).not.toHaveBeenCalled();
    editor.dispose(); s.engine.dispose();
  });

  it('keeps a committed fork recoverable when owner changes during storage and never opens it for the next account', async () => {
    const s = setup(); const commit = deferred<void>();
    jest.mocked(s.store.create).mockImplementationOnce(async record => { s.records.set(recoveryCheckpointId(record.owner, record.editorId), clone(record)); await commit.promise; });
    const pending = s.engine.recoverEditor(resource, 'fresh', '["owner","previous-tab"]'); await tick();
    s.engine.setOwner('other'); commit.resolve();
    await expect(pending).rejects.toThrow('Account changed');
    expect(s.records.has('["owner","fresh"]')).toBe(true);
    expect(s.sourceAdapter.listen).not.toHaveBeenCalled(); expect(await s.engine.listRecoverable()).toEqual([]);
    s.engine.dispose();
  });

  it('does not let an old A-to-B-to-A recovery release the new account-generation reservation', async () => {
    const s = setup(); const oldRead = deferred<EditorRecord>(); const newRead = deferred<EditorRecord>();
    jest.mocked(s.store.read).mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(newRead.promise);
    const oldOpening = s.engine.recoverEditor(resource, 'fresh', '["owner","previous-tab"]');
    s.engine.setOwner('other'); s.engine.setOwner('owner');
    const newOpening = s.engine.recoverEditor(resource, 'fresh', '["owner","previous-tab"]');
    oldRead.resolve(s.source); await expect(oldOpening).rejects.toThrow('Account changed');
    await expect(s.engine.openEditor(resource, 'fresh')).rejects.toThrow('already open');
    newRead.resolve(s.source); const editor = await newOpening;
    expect(editor.getState().checkpoint.draft?.content).toBe('mine');
    editor.dispose(); s.engine.dispose();
  });

  it('surfaces unsupported stores and storage errors, and validates the target before reading disk', async () => {
    const s = setup();
    await expect(s.engine.recoverEditor(resource, '', '["owner","previous-tab"]')).rejects.toThrow('identity');
    await expect(s.engine.listRecoverable({ collection: 'users', id: 'other' })).rejects.toThrow('Owner identity mismatch');
    expect(s.store.read).not.toHaveBeenCalled();
    jest.mocked(s.store.create).mockRejectedValueOnce(new Error('quota'));
    await expect(s.engine.recoverEditor(resource, 'fresh', '["owner","previous-tab"]')).rejects.toThrow('quota');
    expect(s.records.get('["owner","previous-tab"]')).toEqual(s.source);
    const editor = await s.engine.recoverEditor(resource, 'fresh', '["owner","previous-tab"]'); editor.dispose();
    Object.assign(s.store, { listRecoverable: undefined });
    await expect(s.engine.listRecoverable()).rejects.toThrow('not supported');
    s.engine.dispose();
  });
});
