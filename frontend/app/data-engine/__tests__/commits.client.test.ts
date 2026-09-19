import { createStore } from 'idb-keyval';

import { createIndexedDbCommitStore } from '../commits.client';
import { installStorageHarness } from './storageHarness';

import type { CommitRequest } from '../commits';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
const snapshot = { resource: { collection: 'sermons', id: 'one' }, value: { userId: 'owner', title: 'base' }, metadata: null };
const request = (id = 'request'): CommitRequest => ({ id, owner: 'owner', editorId: 'editor', editGeneration: 1,
  baseline: snapshot, value: { ...snapshot.value, title: 'mine' }, predecessor: null, revision: 0,
  initialized: false, working: snapshot, intended: { ...snapshot.value, title: 'mine' },
  command: null, submitted: null, sequence: 0, state: 'queued', result: null, unfinalized: [] });

describe('IndexedDB commit storage', () => {
  let storage: ReturnType<typeof installStorageHarness>;
  beforeEach(() => { jest.clearAllMocks(); storage = installStorageHarness(); });

  it('captures every participant in one durable transaction and deduplicates across tabs', async () => {
    const a = createIndexedDbCommitStore(), b = createIndexedDbCommitStore();
    const participants = [request('a'), { ...request('b'), editorId: 'other-editor', baseline: { ...snapshot, resource: { ...snapshot.resource, id: 'two' } } }];
    const original = JSON.parse(JSON.stringify(participants)) as CommitRequest[];
    storage.holdCommit = true;
    let resolved = false;
    const saving = a.createBatch!(participants).then(rows => { resolved = true; return rows; });
    participants[0].value!.title = 'typed during persistence';
    for (let i = 0; i < 25; i++) await Promise.resolve();
    expect(resolved).toBe(false); expect(storage.rows.size).toBe(0);
    storage.holdCommit = false; storage.finishCommit!();
    const saved = await saving;
    expect(saved[0].value?.title).toBe('mine');
    expect(await b.createBatch!(original)).toEqual(saved);
    expect(await a.list('owner')).toHaveLength(2);
    saved[0].value!.title = 'caller mutation';
    expect((await b.list('owner'))[0].value?.title).toBe('mine');
  });

  it('rolls back a captured first participant when the second has an invalid predecessor', async () => {
    const store = createIndexedDbCommitStore();
    await expect(store.createBatch!([request('a'), { ...request('b'), editorId: 'other', predecessor: 'missing' }])).rejects.toMatchObject({ code: 'commit-reference-changed' });
    expect(await store.list('owner')).toEqual([]);
    expect(storage.rows.size).toBe(0);
  });

  it('allows one batch CAS winner and rolls back all rows when any participant is stale', async () => {
    const a = createIndexedDbCommitStore(), b = createIndexedDbCommitStore();
    const captured = await a.createBatch!([request('a'), { ...request('b'), editorId: 'other' }]);
    const changes = captured.map(previous => ({ previous, next: { ...previous, initialized: true } }));
    const settled = await Promise.allSettled([a.compareAndSetBatch!(changes), b.compareAndSetBatch!(changes)]);
    expect(settled.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    const accepted = await a.list('owner');
    expect(accepted.map(record => record.revision)).toEqual([1, 1]);
    await expect(a.compareAndSetBatch!([
      { previous: accepted[0], next: { ...accepted[0], state: 'prepared' } },
      { previous: captured[1], next: { ...captured[1], state: 'prepared' } },
    ])).rejects.toMatchObject({ code: 'commit-changed' });
    expect(await a.list('owner')).toEqual(accepted);
  });

  it('rejects mixed owners, duplicate generations/ids and cyclic participant dependencies before writing', async () => {
    const store = createIndexedDbCommitStore();
    for (const second of [request('b'), { ...request('a'), editorId: 'other' }, { ...request('b'), editorId: 'other', owner: 'foreign' },
      { ...request('b'), editorId: 'other', predecessor: 'a' }]) {
      await expect(store.createBatch!([request('a'), second])).rejects.toThrow('Atomic');
      expect(await store.list('owner')).toEqual([]);
      expect(await store.list('foreign')).toEqual([]);
    }
    expect(await store.createBatch!([])).toEqual([]);
    expect(await store.compareAndSetBatch!([])).toEqual([]);
  });

  it('atomically deduplicates a saved editor generation across tabs and returns detached records', async () => {
    const a = createIndexedDbCommitStore(), b = createIndexedDbCommitStore();
    const [first, repeated] = await Promise.all([a.create(request()), b.create(request('another-operation'))]);
    expect(first.id).toBe(repeated.id); expect(await a.list('owner')).toHaveLength(1);
    first.value!.title = 'caller mutation'; expect((await b.list('owner'))[0].value?.title).toBe('mine');
    expect(await b.list('someone-else')).toEqual([]);
    expect(createStore).toHaveBeenCalledTimes(2);
  });

  it('allows only one materialization to win CAS and preserves immutable identity', async () => {
    const a = createIndexedDbCommitStore(), b = createIndexedDbCommitStore();
    const first = await a.create(request());
    const committed = await a.compareAndSet(first, { ...first, initialized: true });
    expect(committed.revision).toBe(1);
    await expect(b.compareAndSet(first, { ...first, state: 'prepared' })).rejects.toMatchObject({ code: 'commit-changed' });
    await expect(a.compareAndSet(committed, { ...committed, editorId: 'wrong' })).rejects.toThrow('identity changed');
    await expect(a.compareAndSet({ ...first, id: 'absent' }, first)).rejects.toMatchObject({ code: 'commit-changed' });
    await expect(a.create({ ...request(), editGeneration: 2 })).rejects.toThrow('already used');
    expect((await a.list('owner'))[0]).toEqual(committed);
  });

  it('waits for the transaction commit and propagates a failed local save', async () => {
    storage.holdCommit = true;
    let durable = false;
    const saving = createIndexedDbCommitStore().create(request()).then(() => { durable = true; });
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    expect(durable).toBe(false); storage.finishCommit!(); await saving; expect(durable).toBe(true);
    storage.holdCommit = false; storage.readFailure = true;
    await expect(createIndexedDbCommitStore().create(request('failed'))).rejects.toThrow('read failed');
  });
});
