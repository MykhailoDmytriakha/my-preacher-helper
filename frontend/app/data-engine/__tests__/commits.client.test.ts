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
