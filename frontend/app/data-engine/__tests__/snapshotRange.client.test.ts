import { entries, set } from 'idb-keyval';

import { watchedStore, getDeviceStorageHealth, resetDeviceStorageForTests, STORAGE_SILENCE_MS, STORAGE_WAKE_GRACE_MS } from '@/utils/deviceStorage';

import { createStorageTransaction } from '@/utils/storageTransaction';

import { CollectionReader, type CollectionCursor } from '../collections';
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

const openTwoPages = (holdSecond?: Promise<void>) => {
  let cursor: CollectionCursor | undefined;
  const selected = ['a', 'b', 'c', 'd'].map(id => row('owner', 'studyNotes', id));
  const observer = new ResourceObserver({ source: { listen: () => () => undefined }, transport: { read: jest.fn() } });
  const reader = new CollectionReader({ snapshots: createIndexedDbSnapshots(), observer, pageSize: 2, cursors: {
    read: async () => cursor,
    put: async (_owner, _collection, _expected, next) => (cursor = { ...next, revision: (cursor?.revision ?? 0) + 1 }),
  }, transport: {
    list: async (_owner, _collection, options) => {
      if (options?.cursor) {
        await holdSecond;
        return { snapshots: selected.slice(2), nextCursor: null, version: 0 };
      }
      return { snapshots: selected.slice(0, 2), nextCursor: 'b', version: 0 };
    },
    changes: async () => ({ snapshots: [], cursor: 0, version: 0, hasMore: false }),
  } });
  reader.setOwner('owner');
  return { reader, selected, cursor: () => cursor, close: () => { reader.dispose(); observer.dispose(); } };
};

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

it('stores each listing page in one transaction and reads the whole collection only at the opening and final boundaries', async () => {
  const h = installStorageHarness();
  let releaseSecond!: () => void;
  const held = new Promise<void>(resolve => { releaseSecond = resolve; });
  const s = openTwoPages(held);
  const firstPublished = jest.fn();
  const stop = s.reader.watch('studyNotes', state => {
    if (state.snapshots.length === 2) firstPublished(state);
  });
  const reading = s.reader.read('studyNotes');
  try {
    for (let attempt = 0; !firstPublished.mock.calls.length && attempt < 10; attempt++) await settle();
    expect(firstPublished).toHaveBeenCalledWith(expect.objectContaining({ snapshots: s.selected.slice(0, 2), complete: false }));
    expect(s.cursor()?.initialized).toBe(false);
    expect(h.rows.size).toBe(2);
    releaseSecond();
    await expect(reading).resolves.toMatchObject({ snapshots: s.selected, complete: true, freshness: 'server' });
    expect(h.counts).toEqual({ transactions: 4, enumerations: 4, rows: 8, gets: 4, puts: 4, deletes: 0 });
  } finally { releaseSecond(); await reading.catch(() => undefined); stop(); s.close(); }
});

it('keeps the preceding page but aborts the whole failed page before the cursor can call it complete', async () => {
  const h = installStorageHarness(), s = openTwoPages();
  h.writeFailureFor = key => key === JSON.stringify(['owner', 'studyNotes', 'd']);
  try {
    await expect(s.reader.read('studyNotes')).rejects.toThrow('disk full');
    expect(s.cursor()?.initialized).toBe(false);
    expect([...h.rows.values()]).toEqual(s.selected.slice(0, 2));
    h.writeFailureFor = undefined;
    await expect(s.reader.refresh('studyNotes')).resolves.toMatchObject({ snapshots: s.selected, complete: true });
  } finally { s.close(); }
});

it('opens fully cached legacy pages without a row write transaction', async () => {
  const h = installStorageHarness(), s = openTwoPages();
  s.selected.forEach(value => seed(h, value));
  try {
    await expect(s.reader.read('studyNotes')).resolves.toMatchObject({ snapshots: s.selected, complete: true });
    expect(h.counts).toEqual({ transactions: 2, enumerations: 4, rows: 16, gets: 0, puts: 0, deletes: 0 });
  } finally { s.close(); }
});

it('keeps newer copies from another tab and picks up its unlisted rows at the final boundary', async () => {
  installStorageHarness();
  let releaseSecond!: () => void;
  const held = new Promise<void>(resolve => { releaseSecond = resolve; });
  const s = openTwoPages(held);
  let releaseFirst!: () => void;
  const firstPage = new Promise<void>(resolve => { releaseFirst = resolve; });
  const stop = s.reader.watch('studyNotes', state => { if (state.snapshots.length === 2) releaseFirst(); });
  const reading = s.reader.read('studyNotes');
  try {
    await firstPage;
    const otherTab = createIndexedDbSnapshots();
    const fresh = { ...s.selected[2], value: { userId: 'owner', content: 'accepted in the other tab' },
      metadata: { protocol: 1 as const, generation: 'generation-c', revision: 3, deleted: false } };
    const extra = row('owner', 'studyNotes', 'e');
    await otherTab.put('owner', fresh);
    await otherTab.put('owner', extra);
    releaseSecond();
    await expect(reading).resolves.toMatchObject({
      snapshots: [...s.selected.slice(0, 2), fresh, s.selected[3], extra],
      complete: true,
    });
  } finally { releaseSecond(); await reading.catch(() => undefined); stop(); s.close(); }
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
