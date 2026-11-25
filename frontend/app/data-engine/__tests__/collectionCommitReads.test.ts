import { request, seedRequest } from '@test-utils/checkpointFixtures';
import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';

import { COLLECTION_COMMIT_INDEX } from '../collectionCommitIndex';
import { createIndexedDbCommitStore } from '../commits.client';
import { commitRowKey } from '../retention.client';
import { installStorageHarness } from './storageHarness';

import type { CommitRequest } from '../commits';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const selected = 'studyNotes';
const localRequest = (id: string, collection = selected, document = id): CommitRequest => {
  const captured = request(id, id);
  const baseline = { ...captured.baseline, resource: { collection, id: document } };
  return { ...captured, baseline, working: baseline, state: 'refused',
    result: { kind: 'refused', operationId: id, code: 'fixture-refusal' } };
};

it.each([0, 100, 1000])('reads only selected or previously unseen request payloads (%i unrelated known rows)', async size => {
  const first = localRequest('first');
  const h = documentEngineHarness(first.baseline), browser = h.createBrowser({ withCollections: true });
  const engine = browser.engine;
  seedRequest(h.storage, first);
  for (let index = 0; index < size; index++) seedRequest(h.storage, localRequest('other-' + index, 'groups'));
  engine.setOnline(false); engine.setOwner('owner');
  try {
    const opening = await engine.readCollection(selected);
    expect(opening.documents?.find(row => row.resource.id === first.id)).toMatchObject({ pending: true, value: first.value });
    await settleEngine();
    const other = localRequest('from-an-older-tab');
    seedRequest(h.storage, other);
    const payloadReads: number[] = [];
    h.storage.onEnumeration = (keys, count) => { if (!keys) payloadReads.push(count); };
    h.storage.resetCounts();
    const next = await engine.readCollection(selected);
    expect(next.documents?.map(row => row.resource.id).sort()).toEqual([first.id, other.id].sort());
    expect(payloadReads.reduce((sum, count) => sum + count, 0)).toBe(0);
    expect(h.storage.counts.gets).toBe(2);
  } finally { browser.dispose(); }
});

it('reads a changed request at the same key, notices retirement and classifies a new generation written directly', async () => {
  const h = installStorageHarness(), store = createIndexedDbCommitStore();
  const original = localRequest('same-editor');
  seedRequest(h, original);
  expect(await store.listForCollection!('owner', selected)).toEqual([original]);
  const revised = { ...original, revision: 1 };
  seedRequest(h, revised);
  expect(await store.listForCollection!('owner', selected)).toEqual([revised]);
  h.rows.delete(JSON.stringify(commitRowKey(revised)));
  h.rows.delete(JSON.stringify(['identity', revised.owner, revised.id]));
  const next = { ...localRequest('next-save', 'groups'), editorId: original.editorId, editGeneration: 2 };
  seedRequest(h, next);
  expect(await store.listForCollection!('owner', selected)).toEqual([]);
  expect(await store.listForCollection!('owner', 'groups')).toEqual([next]);
  expect(await store.listForCollection!('other-owner', 'groups')).toEqual([]);
});

it('uses the native key kind for classification and refuses an unreadable stored request', async () => {
  const h = installStorageHarness(), store = createIndexedDbCommitStore();
  const legacy = { ...localRequest('legacy'), deleteAfter: [] };
  h.rows.set(JSON.stringify(['request', legacy.owner, legacy.editorId, legacy.editGeneration]), legacy);
  expect(await store.listForCollection!('owner', selected)).toEqual([legacy]);
  h.rows.set(JSON.stringify(['request', 'owner', 'unreadable', 1]), { owner: 'owner' });
  await expect(store.listForCollection!('owner', selected)).rejects.toThrow('Stored request identity changed');
  h.rows.delete(JSON.stringify(['request', 'owner', 'unreadable', 1]));
  expect(await store.listForCollection!('owner', selected)).toEqual([legacy]);
});


const indexedCommitHarness = () => installStorageHarness({
  [COLLECTION_COMMIT_INDEX]: value => {
    const row = value as Partial<CommitRequest>;
    return row?.owner && row.baseline?.resource?.collection ? [row.owner, row.baseline.resource.collection] : undefined;
  },
});

it('reads only indexed keys and values on new and repeated opens, with a live legacy-writer update', async () => {
  const storage = indexedCommitHarness();
  const store = createIndexedDbCommitStore();
  const study = localRequest('visible-study');
  const newLegacyStudy = localRequest('written-by-another-version');
  const otherOwner = { ...localRequest('others-study'), owner: 'other-owner' };
  seedRequest(storage, study);
  seedRequest(storage, otherOwner);
  for (let i = 0; i < 1000; i++) seedRequest(storage, localRequest('unrelated-' + i, 'groups'));

  const counts = { keys: 0, values: 0 };
  storage.onEnumeration = (keys, size) => { counts[keys ? 'keys' : 'values'] += size; };
  expect(await store.listForCollection!('owner', selected)).toEqual([study]);
  expect(counts).toEqual({ keys: 1, values: 1 });

  const revised = { ...study, revision: 1 };
  seedRequest(storage, revised);
  seedRequest(storage, newLegacyStudy);
  counts.keys = counts.values = 0;
  expect(await store.listForCollection!('owner', selected)).toEqual([revised, newLegacyStudy]);
  expect(counts).toEqual({ keys: 2, values: 2 });
});

it('ignores an unrelated primary owner even when a corrupt indexed row claims the selected owner', async () => {
  const storage = indexedCommitHarness();
  const store = createIndexedDbCommitStore();
  const study = localRequest('visible-study');
  seedRequest(storage, study);
  const corrupt = localRequest('foreign-study');
  storage.rows.set(JSON.stringify(commitRowKey({ ...corrupt, owner: 'other-owner' })), corrupt);
  expect(await store.listForCollection!('owner', selected)).toEqual([study]);
});
