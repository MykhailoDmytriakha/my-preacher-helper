import { CommitQueue } from '../commits';
import { createIndexedDbCommitStore } from '../commits.client';
import { DataEngineRuntime } from '../runtime';
import { DataSession } from '../session';
import { planDataCommand } from '../serverRelations';
import { installStorageHarness } from './storageHarness';
import type { CommandResult, DocumentData, EngineTransport, JournalEntry, ResourceSnapshot } from '../types';
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const key = (resource: { collection: string; id: string }) => `${resource.collection}/${resource.id}`;
const note = (id: string, verse: number): ResourceSnapshot => ({
  resource: { collection: 'studyNotes', id }, metadata: { protocol: 1, generation: `${id}-generation`, revision: 1, deleted: false },
  value: { userId: 'owner', title: id, content: id, type: 'analysis', tags: [], isDraft: false,
    scriptureRefs: [{ id: `${id}-ref`, bible: 'rst', book: 'Ephesians', chapter: 1, fromVerse: verse, toVerse: verse }],
    analysis: { bible: 'rst', words: 4, cuts: [], links: {}, relations: {} }, createdAt: 'then', updatedAt: 'then' },
});
function setup(targets: Array<'existing' | 'new'> = ['existing']) {
  const storage = installStorageHarness(), store = createIndexedDbCommitStore();
  const snapshots: ResourceSnapshot[] = [note('source', 1), ...targets.map((kind, index) => kind === 'existing' ? note(`target-${index}`, index + 2)
    : { resource: { collection: 'studyNotes', id: `target-${index}` }, value: null, metadata: null })];
  const rows = new Map(snapshots.filter(row => row.value).map(row => [key(row.resource), clone(row)]));
  const entries = new Map<string, JournalEntry>(), receipts = new Map<string, CommandResult>();
  const read = async (resource: { collection: string; id: string }) => clone(rows.get(key(resource)) ?? { resource, value: null, metadata: null });
  const transport: EngineTransport = {
    read: jest.fn(async (_owner, resource) => read(resource)),
    send: jest.fn(async command => {
      const previous = receipts.get(command.operationId); if (previous) return clone(previous);
      const plan = await planDataCommand(command, await read(command.resource), { get: read, list: async () => { throw new Error('A reshape must not scan unrelated notes'); } });
      for (const row of plan.writes) rows.set(key(row.resource), clone(row));
      receipts.set(command.operationId, clone(plan.result)); return plan.result;
    }),
  };
  let sequence = 0;
  const make = () => {
    const runtime = new DataEngineRuntime({ transport, journal: {
      list: async owner => clone([...entries.values()].filter(entry => entry.command.owner === owner)),
      put: async entry => { entries.set(entry.command.operationId, clone(entry)); },
      remove: async (_owner, id) => { entries.delete(id); },
    } });
    runtime.setOwner('owner');
    const queue = new CommitQueue({ store, runtime, operationId: () => `reshape-${++sequence}`, readConfirmed: read });
    queue.setOwner('owner');
    return { queue, close: () => { queue.setOwner(null); runtime.setOwner(null); } };
  };
  const captures = snapshots.map((snapshot, index) => {
    const session = new DataSession(snapshot);
    const original = snapshot.value ?? note(snapshot.resource.id, index + 1).value!;
    session.edit({ ...original, content: `reshaped-${index}`, analysis: { ...(original.analysis as DocumentData), cuts: [1] } });
    return { editorId: `reshape-action-${index}`, captured: session.checkpoint(), predecessorId: null };
  });
  return { storage, store, snapshots, rows, transport, captures, make };
}

it.each([{ targets: ['existing'] }, { targets: ['new'] }, { targets: ['existing', 'new'] }] as Array<{targets:Array<'existing' | 'new'>}>)('captures the whole analysis reshape for $targets and delivers once after restart', async ({ targets }) => {
  const s = setup(targets), first = s.make();
  const saved = await first.queue.saveAtomic(s.captures);
  expect(saved).toHaveLength(targets.length + 1);
  for (const row of saved) expect(row.atomic).toMatchObject({ kind: 'analysis-reshape' });
  await first.queue.drain(false);
  expect(s.transport.send).not.toHaveBeenCalled();
  first.close();
  const next = s.make();
  await next.queue.drain(true);
  expect(s.transport.send).toHaveBeenCalledTimes(1);
  expect(s.transport.send).toHaveBeenCalledWith(expect.objectContaining({ kind: 'relation', relation: 'analysis-reshape' }));
  for (let index = 0; index < s.snapshots.length; index++) expect(s.rows.get(key(s.snapshots[index].resource))?.value?.content).toBe(`reshaped-${index}`);
  expect((await s.store.list('owner')).every(row => row.state === 'acknowledged')).toBe(true);
  next.close();
});

it('leaves no partial saved action if IndexedDB rejects the transaction', async () => {
  const s = setup(), first = s.make();
  s.storage.writeFailure = true;
  await expect(first.queue.saveAtomic(s.captures)).rejects.toThrow('disk full');
  s.storage.writeFailure = false;
  expect(await s.store.list('owner')).toEqual([]);
  expect(s.rows.get('studyNotes/source')).toEqual(s.snapshots[0]);
  expect(s.transport.send).not.toHaveBeenCalled();
  first.close();
});
