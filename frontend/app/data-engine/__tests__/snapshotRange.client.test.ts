import { entries, set } from 'idb-keyval';

import { watchedStore, getDeviceStorageHealth, resetDeviceStorageForTests, STORAGE_SILENCE_MS, STORAGE_WAKE_GRACE_MS } from '@/utils/deviceStorage';

import { createStorageTransaction } from '@/utils/storageTransaction';

import { CollectionReader } from '../collections';
import { ResourceObserver } from '../observer';
import { createIndexedDbSnapshots } from '../snapshots.client';
import { installStorageHarness } from './storageHarness';

import type { ResourceSnapshot } from '../types';

jest.mock('idb-keyval', () => ({ ...jest.requireActual('idb-keyval'), createStore: jest.fn() }));
jest.mock('@/services/ownerHttpTransport.client', () => ({ requestOwnerJson: jest.fn() }));
jest.mock('@/utils/queryKeys', () => ({ resolveOwnerUid: jest.fn() }));

const row = (owner: string, collection: string, id: string): ResourceSnapshot => ({
  resource: { collection, id }, value: { userId: owner, content: id }, metadata: null,
});
const seed = (harness: ReturnType<typeof installStorageHarness>, value: ResourceSnapshot, owner = 'owner') => {
  const key = JSON.stringify([owner, value.resource.collection, value.resource.id]);
  harness.rows.set(JSON.stringify(key), value);
};
const settle = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };

const originalKeyRange = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
afterEach(() => {
  resetDeviceStorageForTests(); jest.useRealTimers();
  if (originalKeyRange) Object.defineProperty(globalThis, 'IDBKeyRange', originalKeyRange);
  else Reflect.deleteProperty(globalThis, 'IDBKeyRange');
});

describe('Snapshot collection range', () => {
  it.each([0, 100, 1000])('reads only K keys and payloads with U=%i unrelated rows at the adapter', async unrelated => {
    const h = installStorageHarness();
    for (let i = 0; i < unrelated; i++) seed(h, row(i % 2 ? 'owner-extra' : 'owner', i % 2 ? 'studyNotes' : 'sermons', String(i)), i % 2 ? 'owner-extra' : 'owner');
    const selected = Array.from({ length: 3 }, (_, i) => row('owner', 'studyNotes', String(i)));
    selected.forEach(value => seed(h, value));
    const counts = { keys: 0, payloads: 0, wholeStore: 0 };
    h.onEnumeration = (keys, count, whole) => { counts[keys ? 'keys' : 'payloads'] += count; counts.wholeStore += Number(whole); };
    expect(await createIndexedDbSnapshots().list('owner', 'studyNotes')).toEqual(selected);
    console.log(JSON.stringify({ level: 'adapter', unrelated, ...counts }));
    expect(counts).toEqual({ keys: 3, payloads: 3, wholeStore: 0 });
  });

  it.each([0, 100, 1000])('opens a collection with only K keys and payloads with U=%i unrelated rows', async unrelated => {
    const h = installStorageHarness();
    for (let i = 0; i < unrelated; i++) seed(h, row(i % 2 ? 'owner-extra' : 'owner', i % 2 ? 'studyNotes' : 'sermons', String(i)), i % 2 ? 'owner-extra' : 'owner');
    const selected = Array.from({ length: 3 }, (_, i) => row('owner', 'studyNotes', String(i)));
    selected.forEach(value => seed(h, value));
    const counts = { keys: 0, payloads: 0, wholeStore: 0 };
    h.onEnumeration = (keys, count, whole) => { counts[keys ? 'keys' : 'payloads'] += count; counts.wholeStore += Number(whole); };
    const observer = new ResourceObserver({ source: { listen: () => () => undefined }, transport: { read: jest.fn() } });
    const reader = new CollectionReader({ snapshots: createIndexedDbSnapshots(), observer,
      cursors: { read: async () => undefined, put: jest.fn() }, transport: { list: jest.fn(), changes: jest.fn() } });
    reader.setOwner('owner'); reader.setOnline(false);
    try {
      const state = await reader.read('studyNotes', { allowIncompleteCache: true });
      expect(state).toMatchObject({ snapshots: selected, complete: false, freshness: 'cache' });
      console.log(JSON.stringify({ level: 'collection-open', unrelated, ...counts }));
      expect(counts).toEqual({ keys: 3, payloads: 3, wholeStore: 0 });
    } finally { reader.dispose(); observer.dispose(); }
  });
});

it('matches an independent whole-store reference through production list on generated adversarial keys', async () => {
  expect.assertions(72);
  const h = installStorageHarness();
  const identities = ['', 'owner', 'owner-extra', 'own', ',', '-', '"', '\\', '",', '","',
    'owner","studyNotes', 'owner,', 'owner-', 'a,b', 'a"b', 'a\\b', '\u0000', '\n', '\u001f',
    '\u007f', '\u2028', ' ', '+', '[', ']', '😀', '\ud83d', '\ude00', '\ude00\ud83d',
    '\ufffd', '\uffff', '\ue000', 'é', '中'];
  const ids = [...identities, 'x'.repeat(4096)];
  const collections = ['studyNotes', 'sermons', 'studyNote', 'studyNotesX', 'studyNotes"',
    'studyNotes,', 'studyNotes-', 'studyNoteShareLinks', 'sermons\\', ''];
  // Reverse insertion order so enumeration must supply IndexedDB key order, not Map order.
  for (const owner of [...identities].reverse()) for (const collection of collections) for (const id of [...ids].reverse()) {
    seed(h, row(owner, collection, id), owner);
  }
  for (const key of ['["owner","studyNotes",broken', '["owner","studyNotes",42]',
    '["owner","studyNotes","extra","part"]', '["owner","studyNotes", "space"]', '["owner","studyNotes","\\u0061"]']) {
    h.rows.set(JSON.stringify(key), { invalid: true });
  }
  h.rows.set(JSON.stringify(42), { invalid: true });
  const all = await entries<IDBValidKey, ResourceSnapshot>(watchedStore('preacher-data-engine-snapshots-v1', 'snapshots', 'engine-snapshots'));
  // Independent of the production prefix/range: enumerate everything, parse and compare identities.
  const reference = (owner: string, collection: string) => all.filter(([key]) => {
    if (typeof key !== 'string') return false;
    let identity: unknown;
    try { identity = JSON.parse(key); } catch { return false; }
    return Array.isArray(identity) && identity.length === 3 && identity[0] === owner
      && identity[1] === collection && typeof identity[2] === 'string' && JSON.stringify(identity) === key;
  }).sort(([a], [b]) => (a as string) < (b as string) ? -1 : (a as string) > (b as string) ? 1 : 0).map(([, value]) => value);
  let equalityAssertions = 0, comparedRows = 0, scannedRows = 0;
  for (const owner of identities) for (const collection of ['studyNotes', 'sermons']) {
    const expected = reference(owner, collection);
    expect(await createIndexedDbSnapshots().list(owner, collection)).toEqual(expected);
    equalityAssertions += 1; comparedRows += expected.length; scannedRows += all.length;
  }
  console.log(JSON.stringify({ level: 'differential', storedRows: all.length, equalityAssertions, comparedRows, scannedRows }));
  // 68 selection assertions plus these four accounting assertions; scanned rows are not assertions.
  expect(all).toHaveLength(11906);
  expect(equalityAssertions).toBe(68);
  expect(comparedRows).toBe(2380);
  expect(scannedRows).toBe(809608);
});

it('reads previous-bundle canonical writes and keeps tombstones and malformed in-range keys separate', async () => {
  const h = installStorageHarness();
  const database = watchedStore('preacher-data-engine-snapshots-v1', 'snapshots', 'engine-snapshots');
  const previous = row('owner', 'studyNotes', '\uffff,"\\');
  // This is the unchanged previous bundle's key and native put, with no range-specific metadata.
  await set(JSON.stringify(['owner', 'studyNotes', previous.resource.id]), previous, database);
  const deleted: ResourceSnapshot = { ...row('owner', 'studyNotes', 'deleted'), value: null,
    metadata: { protocol: 1, generation: 'g', revision: 2, deleted: true } };
  seed(h, deleted);
  for (const key of ['["owner","studyNotes",broken', '["owner","studyNotes",42]', '["owner","studyNotes","extra","part"]', '["owner","studyNotes", "space"]', '["owner","studyNotes","\\u0061"]']) {
    h.rows.set(JSON.stringify(key), { invalid: true });
  }
  expect(await createIndexedDbSnapshots().list('owner', 'studyNotes')).toEqual([deleted, previous]);
  seed(h, { ...previous, value: { userId: 'other' } });
  await expect(createIndexedDbSnapshots().list('owner', 'studyNotes')).rejects.toThrow('identity mismatch');
});

it('rejects failed native reads instead of returning an empty list', async () => {
  const h = installStorageHarness(); h.readFailure = true;
  seed(h, row('owner', 'studyNotes', 'note'));
  await expect(createIndexedDbSnapshots().list('owner', 'studyNotes')).rejects.toThrow('read failed');
});

it('keeps an unanswered list pending through storage silence and accepts the late completed answer', async () => {
  jest.useFakeTimers();
  const h = installStorageHarness(); h.holdCommit = true;
  const selected = row('owner', 'studyNotes', 'note'); seed(h, selected);
  const observer = new ResourceObserver({ source: { listen: () => () => undefined }, transport: { read: jest.fn() } });
  const reader = new CollectionReader({ snapshots: createIndexedDbSnapshots(), observer,
    cursors: { read: async () => undefined, put: jest.fn() }, transport: { list: jest.fn(), changes: jest.fn() } });
  reader.setOwner('owner'); reader.setOnline(false);
  let answered = false;
  const opening = reader.read('studyNotes', { allowIncompleteCache: true }).then(state => { answered = true; return state; });
  try {
    await settle();
    jest.advanceTimersByTime(STORAGE_SILENCE_MS + STORAGE_WAKE_GRACE_MS + 1); await settle();
    expect(answered).toBe(false);
    expect(getDeviceStorageHealth().silent).toEqual([expect.objectContaining({ database: 'engine-snapshots' })]);
    h.holdCommit = false; h.finishCommit!();
    await expect(opening).resolves.toMatchObject({ snapshots: [selected], complete: false, freshness: 'cache' });
  } finally { reader.dispose(); observer.dispose(); resetDeviceStorageForTests(); jest.useRealTimers(); }
});

it('keeps one transaction view while another tab writes and sees the new row on the next list', async () => {
  const h = installStorageHarness(); h.holdCommit = true;
  const first = row('owner', 'studyNotes', 'first'), second = row('owner', 'studyNotes', 'second'); seed(h, first);
  const listing = createIndexedDbSnapshots().list('owner', 'studyNotes'); await settle();
  const otherTab = watchedStore('preacher-data-engine-snapshots-v1', 'snapshots', 'engine-snapshots');
  let written = false;
  const writing = set(JSON.stringify(['owner', 'studyNotes', 'second']), second, otherTab).then(() => { written = true; });
  await settle(); expect(written).toBe(false);
  h.holdCommit = false; h.finishCommit!();
  await expect(listing).resolves.toEqual([first]); await writing;
  await expect(createIndexedDbSnapshots().list('owner', 'studyNotes')).resolves.toEqual([first, second]);
});

it.each([false, true])('enumerates string keys and values asynchronously in UTF-16 order with open bounds=%s', async open => {
  const h = installStorageHarness();
  for (const key of ['\uffff', '\ue000', '😀', 'z', 'a', '']) h.rows.set(JSON.stringify(key), { key });
  const transaction = createStorageTransaction(() => watchedStore('range-fake-test', 'strings', 'range-fake-test'));
  const range = IDBKeyRange.bound('a', '\ue000', open, open);
  let callbackReturned = false;
  const result = await transaction<{ keys: IDBValidKey[]; values: unknown[] }>('readonly', (store, read, done) => {
    const keyRequest = store.getAllKeys(range), valueRequest = store.getAll(range);
    expect(keyRequest.result).toBeUndefined(); expect(valueRequest.result).toBeUndefined();
    let keys: IDBValidKey[] = [];
    read(keyRequest, result => { expect(callbackReturned).toBe(true); keys = result; });
    read(valueRequest, values => { expect(callbackReturned).toBe(true); done({ keys, values }); });
    callbackReturned = true;
  });
  const expected = open ? ['z', '😀'] : ['a', 'z', '😀', '\ue000'];
  expect(result).toEqual({ keys: expected, values: expected.map(key => ({ key })) });
});
