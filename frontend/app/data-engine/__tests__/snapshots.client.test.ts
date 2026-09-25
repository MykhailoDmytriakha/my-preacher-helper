import { createStore, entries, get, update } from 'idb-keyval';
import { createIndexedDbSnapshots } from '../snapshots.client';
import type { ResourceSnapshot } from '../types';

jest.mock('idb-keyval', () => ({ createStore: jest.fn(() => 'snapshots'), entries: jest.fn(), get: jest.fn(), update: jest.fn() }));
jest.mock('@/services/ownerHttpTransport.client', () => ({ requestOwnerJson: jest.fn() }));
jest.mock('@/utils/queryKeys', () => ({ resolveOwnerUid: jest.fn() }));
const resource = { collection: 'studyNotes', id: 'note' };
const snapshot = (revision: number): ResourceSnapshot => ({ resource, value: { userId: 'owner', content: String(revision) }, metadata: { protocol: 1, generation: 'g', revision, deleted: false } });

describe('Confirmed snapshot cache', () => {
  beforeEach(() => jest.clearAllMocks());

  it('compares atomically against another tab and never regresses revisions or tombstones', async () => {
    const store = createIndexedDbSnapshots();
    let modify!: (current?: ResourceSnapshot) => ResourceSnapshot;
    let commit!: () => void;
    jest.mocked(update).mockImplementationOnce((_key, callback) => {
      modify = callback as typeof modify;
      return new Promise(resolve => { commit = resolve; });
    });
    let done = false;
    const writing = store.put('owner', snapshot(2)).then(() => { done = true; });
    expect(done).toBe(false);
    expect(modify()).toEqual(snapshot(2));
    expect(modify(snapshot(3))).toEqual(snapshot(3));
    const deleted = { ...snapshot(3), value: null, metadata: { ...snapshot(3).metadata!, deleted: true } };
    expect(modify(deleted)).toEqual(deleted);
    commit(); await writing; expect(done).toBe(true);
  });

  it('uses owner/resource partitions and distinguishes a cache miss from a stored tombstone', async () => {
    const store = createIndexedDbSnapshots();
    jest.mocked(get).mockResolvedValueOnce(undefined);
    expect(await store.read('owner', resource)).toBeUndefined();
    const deleted = { ...snapshot(3), value: null, metadata: { ...snapshot(3).metadata!, deleted: true } };
    jest.mocked(get).mockResolvedValueOnce(deleted);
    expect(await store.read('owner', resource)).toEqual(deleted);
    expect(get).toHaveBeenLastCalledWith('["owner","studyNotes","note"]', 'snapshots');
    expect(createStore).toHaveBeenCalledTimes(1);
  });

  it('rejects mismatched owner/resource metadata and propagates storage failures', async () => {
    const store = createIndexedDbSnapshots();
    await expect(store.put('other', snapshot(1))).rejects.toThrow('identity mismatch');
    await expect(store.put('owner', { resource: { collection: 'users', id: 'other' }, value: {}, metadata: null })).rejects.toThrow('identity mismatch');
    jest.mocked(get).mockResolvedValueOnce({ ...snapshot(1), resource: { ...resource, id: 'wrong' } });
    await expect(store.read('owner', resource)).rejects.toThrow('identity mismatch');
    jest.mocked(update).mockRejectedValueOnce(new Error('quota'));
    await expect(store.put('owner', snapshot(1))).rejects.toThrow('quota');
  });
});

  it('lists only the requested owner collection, retaining tombstones and validating matching rows', async () => {
    const store = createIndexedDbSnapshots();
    const deleted = { ...snapshot(3), value: null, metadata: { ...snapshot(3).metadata!, deleted: true } };
    jest.mocked(entries).mockResolvedValueOnce([
      ['["owner","studyNotes","note"]', deleted],
      ['["other","studyNotes","note"]', { invalid: true }],
      ['["owner","sermons","note"]', { invalid: true }],
      ['invalid-json', {}], ['null', {}], ['["owner","studyNotes",42]', {}],
    ]);
    expect(await store.list('owner', 'studyNotes')).toEqual([deleted]);
    jest.mocked(entries).mockResolvedValueOnce([['["owner","studyNotes","note"]', { ...snapshot(1), value: { userId: 'other' } }]]);
    await expect(store.list('owner', 'studyNotes')).rejects.toThrow('identity mismatch');
  });

  it('checks derived share-link ownerId instead of accepting an unrelated userId', async () => {
    const store = createIndexedDbSnapshots();
    const link = { resource: { collection: 'studyNoteShareLinks', id: 'link' }, value: { ownerId: 'other', userId: 'owner' }, metadata: null };
    await expect(store.put('owner', link)).rejects.toThrow('identity mismatch');
    jest.mocked(get).mockResolvedValueOnce({ ...link, value: { ownerId: 'owner' } });
    expect(await store.read('owner', link.resource)).toMatchObject({ value: { ownerId: 'owner' } });
  });
