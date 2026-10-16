import { DataEngine } from '../engine';
import { createIndexedDbCheckpoints } from '../checkpoint.client';
import { ResourceObserver } from '../observer';
import { commitProjectionKey } from '../retention.client';
import { CommitQueue } from '../commits';
import { createIndexedDbCommitStore } from '../commits.client';
import { installStorageHarness } from './storageHarness';
import { DataEngineRuntime } from '../runtime';
import { DataSession } from '../session';
import { planDataCommand } from '../serverRelations';

import type { CommandResult, DocumentData, EngineTransport, JournalEntry, ResourceSnapshot } from '../types';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const resourceKey = (resource: { collection: string; id: string }) => `${resource.collection}/${resource.id}`;

function setup() {
  const topic = { id: 'topic', title: 'Unfinished matter', summary: 'Keep the prepared words', questions: [], options: [] };
  const source: ResourceSnapshot = { resource: { collection: 'councils', id: 'source' },
    value: { userId: 'owner', title: 'Held council', status: 'held', heldAt: 'then',
      topics: [topic], createdAt: 'then', updatedAt: 'then' },
    metadata: { protocol: 1, generation: 'source-generation', revision: 1, deleted: false } };
  const target: ResourceSnapshot = { resource: { collection: 'councils', id: 'next' }, value: null, metadata: null };
  const created: DocumentData = { userId: 'owner', title: 'Next council', status: 'preparing',
    topics: [{ ...topic, id: 'copied-topic' }], createdAt: 'now', updatedAt: 'now' };
  const rows = new Map<string, ResourceSnapshot>([[resourceKey(source.resource), clone(source)]]);
  const entries = new Map<string, JournalEntry>(), receipts = new Map<string, CommandResult>();
  const storage = installStorageHarness();
  const store = createIndexedDbCommitStore(); let sequence = 0, refuse = false;
  const read = async (resource: { collection: string; id: string }) =>
    clone(rows.get(resourceKey(resource)) ?? { resource, value: null, metadata: null });
  const transport: EngineTransport = {
    read: jest.fn(async (_owner, resource) => read(resource)),
    send: jest.fn(async command => {
      if (refuse) return { kind: 'refused' as const, operationId: command.operationId, code: 'invalid-document' };
      const saved = receipts.get(command.operationId);
      if (saved) return clone(saved);
      const plan = await planDataCommand(command, await read(command.resource), {
        get: read, list: async () => { throw new Error('A carry must not scan unrelated councils'); },
      });
      for (const write of plan.writes) rows.set(resourceKey(write.resource), clone(write));
      receipts.set(command.operationId, clone(plan.result)); return plan.result;
    }),
  };
  const make = () => {
    const runtime = new DataEngineRuntime({ transport, journal: {
      list: async owner => clone([...entries.values()].filter(entry => entry.command.owner === owner)),
      put: async entry => { entries.set(entry.command.operationId, clone(entry)); },
      remove: async (_owner, id) => { entries.delete(id); },
    } });
    runtime.setOwner('owner');
    const queue = new CommitQueue({ store, runtime, operationId: () => `carry-${++sequence}`,
      readConfirmed: read });
    queue.setOwner('owner');
    return { queue, runtime, close: () => { queue.setOwner(null); runtime.setOwner(null); } };
  };
  const from = new DataSession(source), to = new DataSession(target);
  from.edit({ ...source.value, topics: [{ ...topic, carriedToCouncilId: 'next' }] });
  to.edit(created);
  const captures = [
    { editorId: 'carry-source-action', captured: from.checkpoint(), predecessorId: null },
    { editorId: 'carry-target-action', captured: to.checkpoint(), predecessorId: null },
  ];
  const checkpoints = createIndexedDbCheckpoints();
  const cached = new Map<string, ResourceSnapshot>([[resourceKey(source.resource), clone(source)]]);
  const makeEngine = () => {
    const runtime = new DataEngineRuntime({ transport, journal: {
      list: async owner => clone([...entries.values()].filter(entry => entry.command.owner === owner)),
      put: async entry => { entries.set(entry.command.operationId, clone(entry)); },
      remove: async (_owner, id) => { entries.delete(id); },
    } });
    const onError = jest.fn();
    const engine = new DataEngine({ runtime, transport, commits: store, checkpoints,
      observer: new ResourceObserver({ transport, source: { listen: () => () => undefined } }),
      snapshots: { read: async (_owner, resource) => { const row = cached.get(resourceKey(resource)); return row && clone(row); },
        put: async (_owner, snapshot) => { cached.set(resourceKey(snapshot.resource), clone(snapshot)); } },
      operationId: () => `carry-${++sequence}`, onError });
    engine.setOnline(false); engine.setOwner('owner'); return { engine, onError };
  };
  return { rows, store, storage, cached, checkpoints, source, transport, make, makeEngine, captures, created, refuse: () => { refuse = true; } };
}

describe('durable atomic carry into a new council', () => {
  it('captures offline, resumes after restart and delivers one command for both councils', async () => {
    const s = setup(), first = s.make();
    const captured = await first.queue.saveAtomic(s.captures);
    await first.queue.drain(false);
    expect(s.transport.send).not.toHaveBeenCalled();
    expect(captured).toHaveLength(2);
    const command = (await s.store.list('owner')).find(row => row.command)?.command;
    expect(command).toMatchObject({ kind: 'relation', relation: 'council-carry',
      edits: [expect.anything(), expect.objectContaining({ create: s.created })] });
    first.close();

    const restarted = s.make();
    await restarted.queue.drain(true);
    expect(s.transport.send).toHaveBeenCalledTimes(1);
    expect(s.rows.size).toBe(2);
    expect(s.rows.get('councils/source')?.value?.topics).toMatchObject([{ carriedToCouncilId: 'next' }]);
    expect(s.rows.get('councils/next')?.value).toMatchObject(s.created);
    expect((await s.store.list('owner')).every(row => row.state === 'acknowledged')).toBe(true);
    restarted.close();
  });

  it('replays a lost reply with the same identity without creating a second council or copy', async () => {
    const s = setup(), first = s.make();
    const send = jest.mocked(s.transport.send).getMockImplementation()!;
    jest.mocked(s.transport.send).mockImplementationOnce(async command => {
      const result = await send(command);
      throw Object.assign(new Error('Lost reply after commit'), { result });
    });
    await first.queue.saveAtomic(s.captures);
    await first.queue.drain(true).catch(() => undefined);
    const submitted = jest.mocked(s.transport.send).mock.calls[0][0];
    first.close();

    const restarted = s.make();
    await restarted.queue.drain(true);
    expect(s.transport.send).toHaveBeenCalledTimes(2);
    expect(jest.mocked(s.transport.send).mock.calls[1][0]).toEqual(submitted);
    expect(s.rows.size).toBe(2);
    expect(s.rows.get('councils/next')?.value?.topics).toHaveLength(1);
    expect(s.rows.get('councils/source')?.metadata?.revision).toBe(2);
    expect(s.rows.get('councils/next')?.metadata?.revision).toBe(1);
    restarted.close();
  });
});


describe('one-shot council carry ownership', () => {
  it('captures the selected words before awaits and keeps unrelated and later typing outside the action', async () => {
    const s = setup(), { engine } = s.makeEngine();
    const editor = await engine.openEditor(s.source.resource, 'parent');
    const initial = editor.getState().checkpoint.draft!;
    await editor.edit({ ...initial, title: 'Unsent title', topics: [{ ...(initial.topics as DocumentData[])[0], summary: 'Displayed words' }] });
    const saving = editor.carryCouncilTopicToNew('topic', 'Next council');
    await editor.edit({ ...initial, title: 'Later title', topics: [{ ...(initial.topics as DocumentData[])[0], summary: 'Later words' }] });
    const target = await saving;
    const requests = await s.store.list('owner'), source = requests.find(request => request.baseline.resource.id === 'source')!;
    expect(source.value?.title).toBe('Held council');
    expect(source.value?.topics).toMatchObject([{ summary: 'Displayed words', carriedToCouncilId: target.resource.id }]);
    expect(target.value?.topics).toMatchObject([{ summary: 'Displayed words' }]);
    expect(editor.getState().checkpoint.draft).toMatchObject({ title: 'Later title', topics: [{ summary: 'Later words', carriedToCouncilId: target.resource.id }] });
    expect(target.value).not.toHaveProperty('date');
    engine.dispose();
  });

  it('finishes an invoked action after its parent closes and releases projections after both ACK snapshots are durable', async () => {
    const s = setup(), { engine } = s.makeEngine();
    const editor = await engine.openEditor(s.source.resource, 'parent');
    const saving = editor.carryCouncilTopicToNew('topic', 'Next council');
    editor.close();
    const target = await saving;
    const requests = await s.store.list('owner'), primary = requests.find(request => request.atomic?.id === request.id)!;
    engine.setOnline(true); await engine.retry();
    expect(s.transport.send).toHaveBeenCalledTimes(1);
    expect(s.rows.get(resourceKey(target.resource))?.value?.topics).toHaveLength(1);
    expect(s.cached.get(resourceKey(target.resource))?.metadata?.revision).toBe(1);
    expect(s.storage.rows.has(JSON.stringify(commitProjectionKey('owner', primary.atomic!.participants[1])))).toBe(false);
    expect(s.storage.rows.has(JSON.stringify(commitProjectionKey('owner', primary.id)))).toBe(false);
    expect(await s.store.list('owner')).toEqual([]);
    engine.dispose();

    const next = s.makeEngine().engine;
    const reopened = await next.openEditor(s.source.resource, 'reopened');
    await next.retry();
    expect(reopened.getState().checkpoint.draft?.topics).toMatchObject([{ carriedToCouncilId: target.resource.id }]);
    expect(await s.store.list('owner')).toEqual([]);
    next.dispose();
  });

  it('chains a second action behind the first and discards only the refused second carry', async () => {
    const s = setup();
    (s.source.value!.topics as DocumentData[]).push({ id: 'second', title: 'Another matter', questions: [], options: [] });
    s.rows.set(resourceKey(s.source.resource), clone(s.source)); s.cached.set(resourceKey(s.source.resource), clone(s.source));
    const { engine } = s.makeEngine(), editor = await engine.openEditor(s.source.resource, 'parent');
    const first = await editor.carryCouncilTopicToNew('topic', 'First next council');
    const second = await editor.carryCouncilTopicToNew('second', 'Second next council');
    const requests = await s.store.list('owner');
    const firstSource = requests.find(request => request.baseline.resource.id === 'source' && (request.value!.topics as DocumentData[])[0].carriedToCouncilId === first.resource.id)!;
    const secondSource = requests.find(request => request.baseline.resource.id === 'source' && (request.value!.topics as DocumentData[])[1].carriedToCouncilId === second.resource.id)!;
    expect(secondSource.predecessor).toBe(firstSource.id);
    const send = jest.mocked(s.transport.send).getMockImplementation()!;
    jest.mocked(s.transport.send).mockImplementation(command => command.operationId === secondSource.id
      ? Promise.resolve({ kind: 'refused' as const, operationId: command.operationId, code: 'invalid-document' }) : send(command));
    engine.setOnline(true); await engine.retry();
    expect(editor.getActions()).toMatchObject([{ id: secondSource.id, delivery: { canDiscard: true } }]);
    await editor.discardAction(secondSource.id);
    const topics = editor.getState().checkpoint.draft!.topics as DocumentData[];
    expect(topics[0].carriedToCouncilId).toBe(first.resource.id);
    expect(topics[1]).not.toHaveProperty('carriedToCouncilId');
    expect(s.rows.has(resourceKey(first.resource))).toBe(true);
    expect(s.rows.has(resourceKey(second.resource))).toBe(false);
    engine.dispose();
  });

  it('keeps source words unchanged when durable batch capture fails', async () => {
    const s = setup(), { engine } = s.makeEngine();
    const editor = await engine.openEditor(s.source.resource, 'parent');
    s.storage.writeFailure = true;
    await expect(editor.carryCouncilTopicToNew('topic', 'Next council')).rejects.toThrow('disk full');
    s.storage.writeFailure = false;
    expect(await s.store.list('owner')).toEqual([]);
    expect(editor.getState().checkpoint.draft).toEqual(s.source.value);
    engine.dispose();
  });

  it('discards a proven refused action as a whole while retaining captured and later words', async () => {
    const s = setup(), { engine } = s.makeEngine();
    const editor = await engine.openEditor(s.source.resource, 'parent');
    const initial = editor.getState().checkpoint.draft!;
    await editor.edit({ ...initial, topics: [{ ...(initial.topics as DocumentData[])[0], summary: 'Prepared before carry' }] });
    await editor.carryCouncilTopicToNew('topic', 'Next council');
    s.refuse(); engine.setOnline(true); await engine.retry();
    const action = editor.getActions()[0]; expect(action.delivery.canDiscard).toBe(true);
    const shown = editor.getState().checkpoint.draft!;
    await editor.edit({ ...shown, title: 'Later title', topics: [{ ...(shown.topics as DocumentData[])[0], summary: 'Later words' }] });
    await editor.discardAction(action.id);
    const draft = editor.getState().checkpoint.draft!;
    expect(draft).toMatchObject({ title: 'Later title', topics: [{ summary: 'Later words' }] });
    expect((draft.topics as DocumentData[])[0]).not.toHaveProperty('carriedToCouncilId');
    expect(s.rows.size).toBe(1);
    expect(await s.store.list('owner')).toEqual([]);
    expect(editor.getActions()).toEqual([]);
    engine.dispose();
  });
});
