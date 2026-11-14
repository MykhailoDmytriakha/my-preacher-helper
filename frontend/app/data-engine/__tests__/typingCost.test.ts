import { createIndexedDbCheckpoints } from '../checkpoint.client';
import { recoveryCheckpointId } from '../recovery.client';
import { acknowledge, record, request, seedHistory, seedRequest } from '@test-utils/checkpointFixtures';
import { installStorageHarness } from './storageHarness';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
let storage: ReturnType<typeof installStorageHarness>;
beforeEach(() => { jest.clearAllMocks(); storage = installStorageHarness(); });
const budget = (gets = 1, puts = 1, deletes = 0) => ({ transactions: 1, enumerations: 0, rows: 0, gets, puts, deletes });

it.each([0, 100, 1000])('writes first and second letters without sweeping %i unrelated retained pairs', async size => {
  seedHistory(storage, size);
  const checkpoints = createIndexedDbCheckpoints();
  for (const content of ['a', 'ab']) {
    storage.resetCounts();
    await checkpoints.put(record(content));
    console.info('typing-cost', JSON.stringify({ size, content, ...storage.counts }));
    expect(storage.counts).toEqual(budget());
    expect((await checkpoints.read('owner', 'editor'))?.checkpoint.draft?.content).toBe(content);
  }
});

it.each([0, 100, 1000])('validates only D pending references with %i unrelated pairs', async size => {
  seedHistory(storage, size);
  const pending = Array.from({ length: 4 }, (_, index) => request(`pending-${index}`, 'editor', index + 1));
  pending.forEach(saved => seedRequest(storage, saved));
  const checkpoints = createIndexedDbCheckpoints();
  for (const content of ['after four Saves a', 'after four Saves ab']) {
    storage.resetCounts();
    await checkpoints.put(record(content, 'editor', pending));
    expect(storage.counts).toEqual(budget(1 + 2 * pending.length));
    expect((await checkpoints.read('owner', 'editor'))?.checkpoint.draft?.content).toBe(content);
  }
});

it.each([0, 100, 1000])('does not scan prior acknowledged history or dirty recovery origins with %i pairs', async size => {
  seedHistory(storage, size);
  seedRequest(storage, acknowledge(request('old-ack', 'old-editor')));
  const checkpoints = createIndexedDbCheckpoints();
  await checkpoints.put(record('source words', 'source'));
  const source = (await checkpoints.read('owner', 'source'))!;
  const target = record('recovered and typed words');
  target.recoveryOrigins = [{ id: recoveryCheckpointId('owner', 'source'), version: source.recoveryVersion! }];
  storage.resetCounts();
  await checkpoints.put(target);
  expect(storage.counts).toEqual(budget());
  expect((await checkpoints.read('owner', 'editor'))?.checkpoint.draft?.content).toBe('recovered and typed words');
  expect((await checkpoints.read('owner', 'source'))?.checkpoint.draft?.content).toBe('source words');
});

it.each([0, 100, 1000])('retires only exact settled recovery origins with %i unrelated pairs', async size => {
  seedHistory(storage, size);
  const checkpoints = createIndexedDbCheckpoints();
  await checkpoints.put(record('source words', 'source'));
  const source = (await checkpoints.read('owner', 'source'))!;
  const target = record(); target.checkpoint.dirty = false;
  target.recoveryOrigins = [{ id: recoveryCheckpointId('owner', 'source'), version: source.recoveryVersion! }];
  storage.resetCounts();
  await checkpoints.put(target);
  expect(storage.counts).toEqual(budget(2, 0, 2));
  expect(await checkpoints.read('owner', 'source')).toBeUndefined();
  expect(await checkpoints.read('owner', 'editor')).toBeUndefined();
});
