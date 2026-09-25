import { createStore, get, update } from 'idb-keyval';
import { createIndexedDbCollectionCursors } from '../collectionCursors.client';
import type { CollectionCursor } from '../collections';

jest.mock('idb-keyval', () => ({ createStore: jest.fn(() => 'cursors'), get: jest.fn(), update: jest.fn() }));

describe('Collection cursor persistence', () => {
  let current: CollectionCursor | undefined;
  beforeEach(() => {
    jest.clearAllMocks(); current = undefined;
    jest.mocked(update).mockImplementation(async (_key, change) => { current = change(current) as CollectionCursor; });
  });

  it('atomically rejects a stale completion after another tab resets hydration', async () => {
    const store = createIndexedDbCollectionCursors();
    const first = await store.put('owner', 'studyNotes', undefined, { version: 8, initialized: true });
    expect(first).toEqual({ version: 8, initialized: true, revision: 1 });
    const reset = await store.put('owner', 'studyNotes', first, { version: 8, initialized: false });
    await expect(store.put('owner', 'studyNotes', first, { version: 9, initialized: true })).rejects.toMatchObject({ code: 'cursor-changed' });
    expect(current).toEqual(reset);
    expect(await store.put('owner', 'studyNotes', reset, { version: 10, initialized: true })).toEqual({ version: 10, initialized: true, revision: 3 });
    await expect(store.put('owner', 'studyNotes', undefined, { version: 11, initialized: true })).rejects.toMatchObject({ code: 'cursor-changed' });
  });

  it('does not expose success before the transaction commits', async () => {
    let finish!: () => void;
    jest.mocked(update).mockImplementationOnce((_key, change) => {
      current = change(undefined) as CollectionCursor;
      return new Promise(resolve => { finish = resolve; });
    });
    let done = false;
    const saving = createIndexedDbCollectionCursors().put('owner', 'studyNotes', undefined, { version: 0, initialized: false }).then(() => { done = true; });
    await Promise.resolve(); expect(done).toBe(false);
    finish(); await saving; expect(done).toBe(true);
  });

  it('partitions by owner and validates cached state without treating absence as complete', async () => {
    const store = createIndexedDbCollectionCursors();
    jest.mocked(get).mockResolvedValueOnce(undefined).mockResolvedValueOnce({ version: 2, revision: 1, initialized: false });
    expect(await store.read('owner', 'studyNotes')).toBeUndefined();
    expect(await store.read('other', 'studyNotes')).toEqual({ version: 2, revision: 1, initialized: false });
    expect(get).toHaveBeenLastCalledWith('["other","studyNotes"]', 'cursors');
    expect(createStore).toHaveBeenCalledTimes(1);
    jest.mocked(get).mockResolvedValueOnce({ version: -1, revision: 1, initialized: true });
    await expect(store.read('owner', 'studyNotes')).rejects.toThrow('Invalid collection cursor');
    await expect(store.read('owner', 'unsupported')).rejects.toThrow();
  });

  it('rejects invalid or regressing cursors and propagates storage failure', async () => {
    const store = createIndexedDbCollectionCursors();
    const first = await store.put('owner', 'studyNotes', undefined, { version: 4, initialized: true });
    await expect(store.put('owner', 'studyNotes', first, { version: 3, initialized: true })).rejects.toThrow('cannot regress');
    await expect(store.put('owner', 'studyNotes', first, { version: NaN, initialized: true })).rejects.toThrow('Invalid collection cursor');
    current = { version: 4, revision: 0, initialized: true };
    await expect(store.put('owner', 'studyNotes', first, { version: 5, initialized: true })).rejects.toThrow('Invalid collection cursor');
    jest.mocked(update).mockRejectedValueOnce(new Error('quota'));
    await expect(store.put('owner', 'studyNotes', first, { version: 5, initialized: true })).rejects.toThrow('quota');
  });
});
