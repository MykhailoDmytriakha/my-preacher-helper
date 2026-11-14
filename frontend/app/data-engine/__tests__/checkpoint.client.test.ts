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
  expect(await store.listRecoverable('owner', snapshot.resource)).toEqual([{ id: '["owner","editor"]', record: { ...value, recoveryVersion: expect.any(String) } }]);
  expect(await store.listRecoverable('another')).toEqual([]);
  const target = { ...value, editorId: 'fork' }; await store.create(target);
  await expect(store.create(target)).rejects.toThrow('already exists');
  storage.readFailure = true; await expect(store.listRecoverable('owner')).rejects.toThrow('read failed');
});

it('finds healthy drafts even when another checkpoint of the same owner has an unreadable core', async () => {
  const store = createIndexedDbCheckpoints();
  await store.put(record());
  storage.rows.set(JSON.stringify(['checkpoint', 'owner', 'unreadable']), {
    owner: 'owner', editorId: 'unreadable',
    checkpoint: { confirmed: { resource: { collection: 'studyNotes', id: 'other-note' } },
      draft: { userId: 'owner', content: 'Words still on the device' }, editGeneration: 'future-format' },
  });
  storage.rows.set(JSON.stringify(['checkpoint', 'owner', 'unparseable']), {});
  storage.rows.set(JSON.stringify(['checkpoint', 'owner', 'foreign']), {
    owner: 'owner', editorId: 'foreign',
    checkpoint: { confirmed: { resource: { collection: 'studyNotes', id: 'another-note' } },
      draft: { userId: 'other', content: 'A different owner\'s words' }, editGeneration: 'future-format' },
  });
  const drafts = await store.listRecoverable('owner', snapshot.resource);
  expect(drafts.map(copy => copy.record.checkpoint.draft?.content)).toEqual(['mine']);
  const damaged = await store.listUnreadable!('owner');
  expect(damaged).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: '["owner","unreadable"]', text: expect.stringContaining('Words still on the device') }),
    { id: '["owner","unparseable"]' }, { id: '["owner","foreign"]' },
  ]));
  expect(damaged.find(copy => copy.id === '["owner","unreadable"]')?.text).not.toContain('userId');
  expect(await store.listUnreadable!('other')).toEqual([]);
  await expect(store.read('owner', 'unreadable')).rejects.toThrow();
  await expect(store.create({ ...record(), editorId: 'separate' })).resolves.toBeUndefined();
  expect(storage.rows.get(JSON.stringify(['checkpoint', 'owner', 'unparseable']))).toEqual({});
});

it('releases committed transactions while retaining two application callbacks in order', async () => {
  const store = createIndexedDbCheckpoints();
  storage.holdCompletionAfterCommit = (_rows, mode) => mode === 'readwrite';
  let first = false, second = false;
  void store.put({ ...record(), editorId: 'first' }).then(() => { first = true; });
  void store.put({ ...record(), editorId: 'second' }).then(() => { second = true; });
  const settle = async () => { for (let i = 0; i < 100; i += 1) await Promise.resolve(); };
  try {
    await settle();
    expect((await store.read('owner', 'first'))?.checkpoint.draft?.content).toBe('mine');
    expect((await store.read('owner', 'second'))?.checkpoint.draft?.content).toBe('mine');
    expect([first, second]).toEqual([false, false]);
    storage.finishCompletion!(); await settle();
    expect([first, second]).toEqual([true, false]);
    storage.finishCompletion!(); await settle();
    expect([first, second]).toEqual([true, true]);
  } finally { storage.finishCompletion?.(); storage.finishCompletion?.(); }
});
