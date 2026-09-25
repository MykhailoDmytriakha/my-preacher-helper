import { createEngineStorageTransaction, engineOwnerRange, validateCommitReferences } from '../storage.client';
import { installStorageHarness } from './storageHarness';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
let storage: ReturnType<typeof installStorageHarness>;
beforeEach(() => { jest.clearAllMocks(); storage = installStorageHarness(); });

it('shares owner-scoped rows between adapters and resolves only after transaction commit', async () => {
  const write = createEngineStorageTransaction(), read = createEngineStorageTransaction();
  storage.holdCommit = true;
  let committed = false;
  const pending = write<string>('readwrite', (store, next, done) => {
    next(store.get(['manual', 'owner', 'scope']), () => { store.put({ content: 'mine' }, ['manual', 'owner', 'scope']); done('saved'); });
  }).then(value => { committed = true; return value; });
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
  expect(committed).toBe(false); storage.finishCommit!(); expect(await pending).toBe('saved'); storage.holdCommit = false;
  expect(await read('readonly', (store, next, done) => { next(store.getAll(engineOwnerRange('manual', 'owner')), done); })).toEqual([{ content: 'mine' }]);
  expect(await read('readonly', (store, next, done) => { next(store.getAll(engineOwnerRange('manual', 'another')), done); })).toEqual([]);
});

it('validates each direct reference once and rejects missing or already collected payloads', async () => {
  const transaction = createEngineStorageTransaction();
  const validate = (ids: string[]) => transaction('readwrite', (store, read, done) => validateCommitReferences(store, read, 'owner', ids, () => done('valid')));
  expect(await validate([])).toBe('valid');
  await expect(validate(['missing'])).rejects.toMatchObject({ code: 'commit-reference-changed' });
  storage.rows.set('["identity","owner","gone"]', ['request', 'owner', 'editor', 1]);
  await expect(validate(['gone'])).rejects.toMatchObject({ code: 'commit-reference-changed' });
  storage.rows.set('["request","owner","editor",1]', { id: 'gone' });
  expect(await validate(['gone', 'gone'])).toBe('valid');
});

it('aborts a synchronous write failure without publishing partial state', async () => {
  const transaction = createEngineStorageTransaction();
  await expect(transaction('readwrite', (store) => {
    store.put({ content: 'partial' }, ['manual', 'owner', 'scope']); throw new Error('abort this write');
  })).rejects.toThrow('abort this write');
  expect(storage.rows.size).toBe(0);
});
