import { cancellationScope } from '../atomicCommits';
import { createIndexedDbCheckpoints } from '../checkpoint.client';
import { OpenEditorJournal, OpenEditorRequests } from '../openEditorRequests';
import { recoveryCheckpointId } from '../recovery.client';
import { acknowledge, record, request, seedHistory, seedRequest } from '@test-utils/checkpointFixtures';
import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';
import { installStorageHarness } from './storageHarness';

import type { CommitRequest } from '../commits';
import type { JournalEntry } from '../types';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
let storage: ReturnType<typeof installStorageHarness>;
beforeEach(() => { jest.clearAllMocks(); storage = installStorageHarness(); });
const budget = (gets = 1, puts = 1, deletes = 0) => ({ transactions: 1, enumerations: 0, rows: 0, gets, puts, deletes });

it.each([0, 100, 1000])('keeps an open editor independent of %i unrelated unfinished Saves when typing', async size => {
  const resource = { collection: 'groups', id: 'group' };
  const baseline = { resource, value: { userId: 'owner', title: 'Original group', description: '' },
    metadata: { protocol: 1 as const, generation: 'group-generation', revision: 1, deleted: false } };
  const h = documentEngineHarness(baseline);
  const browser = h.createBrowser(), engine = browser.engine;
  for (let index = 0; index < size; index += 1) {
    const saved = request('other-' + index, 'other-editor-' + index);
    const baseline = { ...saved.baseline, resource: { collection: 'studyNotes', id: saved.id } };
    seedRequest(h.storage, { ...saved, baseline, working: baseline, state: 'refused',
      result: { kind: 'refused', operationId: saved.id, code: 'test-refusal' } });
  }
  engine.setOnline(false); engine.setOwner('owner');
  try {
    const editorId = browser.editorId(resource);
    const editor = await engine.openEditor(resource, editorId);
    const publish = () => { editor.getState(); editor.getPresence?.(); editor.getDelivery(); editor.getActions?.(); };
    const stop = editor.subscribe(publish);
    await settleEngine();
    const remembered = (engine as unknown as { commitRecords: Map<string, CommitRequest> }).commitRecords;
    expect(remembered.size).toBe(size);
    let unrelated = 0;
    const original = remembered.values.bind(remembered);
    const visit = jest.spyOn(remembered, 'values').mockImplementation(function* (): Generator<CommitRequest, undefined> {
      for (const saved of original()) {
        if (saved.baseline.resource.id !== resource.id) unrelated += 1;
        yield saved;
      }
      return undefined;
    });
    try {
      const shown = editor.getState().checkpoint;
      await editor.edit({ ...shown.draft, description: 'Typed letter' });
      expect((await h.checkpoints.read('owner', editorId))?.checkpoint.draft?.description).toBe('Typed letter');
      expect(editor.getState().checkpoint.draft?.description).toBe('Typed letter');
      expect(unrelated).toBe(0);
    } finally { visit.mockRestore(); stop(); }
  } finally { browser.dispose(); }
});

it.each([0, 100, 1000])('publishes only the requested collection with %i unrelated requests in memory', async size => {
  const baseline = request().baseline;
  const h = documentEngineHarness(baseline), browser = h.createBrowser({ withCollections: true });
  const engine = browser.engine;
  const local = request('own note words');
  seedRequest(h.storage, local);
  for (let index = 0; index < size; index++) {
    const saved = request('unrelated-' + index, 'unrelated-editor-' + index);
    const other = { ...baseline, resource: { collection: 'groups', id: saved.id } };
    seedRequest(h.storage, { ...saved, baseline: other, working: other, state: 'refused' });
  }
  engine.setOnline(false); engine.setOwner('owner');
  const first = await engine.readCollection('studyNotes');
  const remembered = (engine as unknown as { commitRecords: Map<string, CommitRequest> }).commitRecords;
  // Warm the complete presentation cache through the ordinary return-to-tab path.
  engine.setVisible(true);
  for (let attempt = 0; remembered.size !== size + 1 && attempt < 10; attempt++) await settleEngine();
  expect(remembered.size).toBe(size + 1);
  let unrelated = 0;
  const all = remembered.values.bind(remembered);
  const visit = jest.spyOn(remembered, 'values').mockImplementation(function* (): Generator<CommitRequest, undefined> {
    for (const saved of all()) {
      if (saved.baseline.resource.collection !== 'studyNotes') unrelated++;
      yield saved;
    }
    return undefined;
  });
  const updates = jest.fn();
  const stop = engine.watchCollection('studyNotes', updates);
  try {
    await settleEngine();
    const expected = [expect.objectContaining({ resource: baseline.resource,
      value: { userId: 'owner', content: 'own note words' }, pending: true, needsAttention: false })];
    expect(first.documents).toEqual(expected);
    expect(updates).toHaveBeenLastCalledWith(expect.objectContaining({ documents: expected }));
    expect((await engine.readCollection('studyNotes')).documents).toEqual(expected);
    expect(unrelated).toBe(0);
  } finally { stop(); visit.mockRestore(); browser.dispose(); }
});

it('retains all participants and dependent requests required for a choice across documents', () => {
  const answered = { ...request('answered'), state: 'refused' as const };
  const atomic = { id: 'atomic-root', participants: ['atomic-root', 'atomic-other'], kind: 'analysis-reshape' as const };
  const root = { ...request('atomic-root', 'root-editor'), atomic, predecessor: answered.id };
  const other = { ...request('atomic-other', 'other-editor'), atomic,
    baseline: { ...root.baseline, resource: { collection: 'studyNotes', id: 'a-second-note' } } };
  const tail = { ...request('third', 'third-editor'), baseline: other.baseline, predecessor: other.id };
  const unrelated = request('unrelated', 'unrelated-editor');
  const records = new Map<string, CommitRequest>();
  const index = new OpenEditorRequests();
  const remember = (saved: CommitRequest) => {
    index.set(saved, records.get(saved.id));
    records.set(saved.id, saved);
  };
  [unrelated, other, tail, answered, root].forEach(remember);
  remember({ ...other, revision: 1 });
  const select = () => cancellationScope(index.forChoice(records, 'owner', [answered.id]), '', [answered.id]);
  expect(select()).toEqual(cancellationScope([...records.values()], '', [answered.id]));
  expect(select().map(saved => saved.id)).toEqual([other.id, tail.id, answered.id, root.id]);
  expect([...index.forResource('owner', other.baseline.resource).keys()]).toEqual([other.id, tail.id]);
  index.delete(tail);
  records.delete(tail.id);
  expect(select().map(saved => saved.id)).toEqual([other.id, answered.id, root.id]);
  index.delete(other);
  records.delete(other.id);
  expect(select).toThrow('Incomplete atomic commit ownership');
  index.clear(); records.clear();
  expect(index.forChoice(records, 'owner', [answered.id], answered.editorId)).toEqual([]);
});

it('reads the requested deliveries in journal order, including operation aliases', () => {
  const entry = (operationId: string, state: JournalEntry['state'], createdAt: number): JournalEntry => ({
    command: { protocol: 1, owner: 'owner', resource: request().baseline.resource, operationId,
      kind: 'delete', generation: 'g', dependsOn: [], baseline: { userId: 'owner' } },
    state, attempts: 1, createdAt,
  });
  const original = [entry('whole-action', 'sending', 1), entry('unrelated', 'refused', 2), entry('direct-save', 'queued', 3)];
  const journal = new OpenEditorJournal(original);
  expect(journal.forOperations(['direct-save', 'whole-action', 'direct-save'])).toEqual([original[0], original[2]]);
});

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
