import { createStore } from 'idb-keyval';
import { createIndexedDbCheckpoints } from '../checkpoint.client';
import { DataSession } from '../session';
import { installStorageHarness } from './storageHarness';
import type { EditorRecord } from '../controller';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
const snapshot = { resource: { collection: 'studyNotes', id: 'note' }, value: { userId: 'owner', content: 'base' }, metadata: null };
const record = (): EditorRecord => {
  const session = new DataSession(snapshot); session.edit({ userId: 'owner', content: 'mine' });
  return { owner: 'owner', editorId: 'editor', checkpoint: session.checkpoint(), prepared: null, unfinalized: [] };
};
let storage: ReturnType<typeof installStorageHarness>;
beforeEach(() => { jest.clearAllMocks(); storage = installStorageHarness(); });

it('isolates owners, freezes the payload and awaits the transaction commit', async () => {
  const store = createIndexedDbCheckpoints(), value = record(); storage.holdCommit = true;
  let durable = false; const writing = store.put(value).then(() => { durable = true; });
  value.checkpoint.draft!.content = 'later';
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  expect(durable).toBe(false); storage.finishCommit!(); await writing;
  storage.holdCommit = false;
  expect((await store.read('owner', 'editor'))?.checkpoint.draft?.content).toBe('mine');
  expect(await store.read('another', 'editor')).toBeUndefined();
  expect(createStore).toHaveBeenCalledTimes(1);
  storage.writeFailure = true; await expect(store.put(record())).rejects.toThrow('disk full');
});

it('discovers owner-scoped recovery and creates a fork without overwriting an editor', async () => {
  const store = createIndexedDbCheckpoints(), value = record(); await store.put(value);
  expect(await store.listRecoverable('owner', snapshot.resource)).toEqual([{ id: '["owner","editor"]', record: value }]);
  expect(await store.listRecoverable('another')).toEqual([]);
  const target = { ...value, editorId: 'fork' }; await store.create(target);
  await expect(store.create(target)).rejects.toThrow('already exists');
  storage.readFailure = true; await expect(store.listRecoverable('owner')).rejects.toThrow('read failed');
});
