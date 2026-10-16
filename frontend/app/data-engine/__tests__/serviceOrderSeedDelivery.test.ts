import { serviceOrderSeedId } from '@/utils/serviceOrderSeedIdentity';
import { CommitQueue, createMemoryCommitStore } from '../commits';
import { advanceResourceSnapshot } from '../protocol';
import { DataEngineRuntime } from '../runtime';
import { DataSession } from '../session';
import { planDataCommand, type RelationFilter, type RelationReader } from '../serverRelations';

import type { CommandResult, DataCommand, DocumentData, EngineTransport, JournalEntry, JournalStore, ResourceRef, ResourceSnapshot } from '../types';

const owner = 'owner';
const id = serviceOrderSeedId('owner', 'funeral');
const resource: ResourceRef = { collection: 'serviceOrders', id };
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const key = (ref: ResourceRef) => `${ref.collection}/${ref.id}`;
const absent = (ref: ResourceRef): ResourceSnapshot => ({ resource: ref, value: null, metadata: null });

function rite(stepId: string): DocumentData {
  return {
    userId: owner,
    catalogKey: 'funeral',
    title: 'Standard funeral service',
    steps: [{ id: stepId, title: 'Default opening', body: 'Initial words', scriptureRefs: [] }],
    rank: 1000,
    createdAt: '2026-10-16T00:00:00.000Z',
    updatedAt: '2026-10-16T00:00:00.000Z',
  };
}

function setupSharedServer() {
  const rows = new Map<string, ResourceSnapshot>();
  const receipts = new Map<string, CommandResult>();
  const sent: DataCommand[] = [];
  const reader: RelationReader = {
    get: async ref => copy(rows.get(key(ref)) ?? absent(ref)),
    list: async (collection, limit, filter?: RelationFilter) => [...rows.values()]
      .filter(snapshot => snapshot.resource.collection === collection && snapshot.value !== null)
      .filter(snapshot => {
        if (!filter) return true;
        const value = snapshot.value?.[filter.field];
        return filter.operator === 'array-contains'
          ? Array.isArray(value) && value.includes(filter.value)
          : value === filter.value;
      })
      .slice(0, limit)
      .map(copy),
  };
  const transport: EngineTransport = {
    read: jest.fn(async (_owner, ref) => copy(rows.get(key(ref)) ?? absent(ref))),
    send: jest.fn(async command => {
      sent.push(copy(command));
      const cached = receipts.get(command.operationId);
      if (cached) return copy(cached);
      const primary = rows.get(key(command.resource)) ?? absent(command.resource);
      const plan = await planDataCommand(command, primary, reader);
      plan.writes.forEach(snapshot => rows.set(key(snapshot.resource), copy(snapshot)));
      receipts.set(command.operationId, copy(plan.result));
      return copy(plan.result);
    }),
  };
  return { rows, receipts, sent, reader, transport };
}

function device(transport: EngineTransport, operationId: string) {
  const commits = createMemoryCommitStore();
  const entries = new Map<string, JournalEntry>();
  const journal: JournalStore = {
    list: async user => copy([...entries.values()].filter(entry => entry.command.owner === user)),
    put: async entry => { entries.set(entry.command.operationId, copy(entry)); },
    remove: async (_user, commandId) => { entries.delete(commandId); },
  };
  const runtime = new DataEngineRuntime({ transport, journal });
  runtime.setOwner(owner);
  const queue = new CommitQueue({
    store: commits,
    runtime,
    operationId: () => operationId,
    readConfirmed: ref => transport.read(owner, ref),
  });
  queue.setOwner(owner);
  return { queue, runtime, commits, entries };
}

describe('service-order seed delivery', () => {
  it('adopts the authored server copy through two durable device queues and replays a lost ACK', async () => {
    const shared = setupSharedServer();
    const first = device(shared.transport, 'seed-device-one');
    const second = device(shared.transport, 'seed-device-two');
    const firstSession = new DataSession(absent(resource));
    const secondSession = new DataSession(absent(resource));
    firstSession.edit(rite('default-step-device-one'));
    secondSession.edit(rite('default-step-device-two'));

    // Both outboxes capture the same absent deterministic resource before either delivers.
    await first.queue.save('device-one-editor', firstSession.checkpoint());
    await second.queue.save('device-two-editor', secondSession.checkpoint());
    await first.queue.drain(true);
    expect((await first.queue.list())[0].state).toBe('acknowledged');

    const firstAccepted = shared.rows.get(key(resource))!;
    const authored = advanceResourceSnapshot(firstAccepted, {
      ...firstAccepted.value!,
      title: 'Funeral service shaped by the preacher',
      steps: [{ id: 'preacher-step', title: 'Welcome', body: 'Keep the authored wording', scriptureRefs: ['John 11:25'] }],
      rank: 8400,
    }, 'preacher-edit', ['title', 'steps', 'rank']);
    shared.rows.set(key(resource), authored);

    // Lose the second HTTP reply after the server commits it. Retry must use the same receipt.
    let dropSecondReply = true;
    const send = jest.mocked(shared.transport.send).getMockImplementation()!;
    jest.mocked(shared.transport.send).mockImplementation(async command => {
      const result = await send(command);
      if (command.operationId === 'seed-device-two' && dropSecondReply) {
        dropSecondReply = false;
        throw new Error('reply lost after server acceptance');
      }
      return result;
    });
    await second.queue.drain(true);
    expect((await second.runtime.list())[0]).toMatchObject({ state: 'unknown', command: { operationId: 'seed-device-two' } });
    expect(shared.rows.get(key(resource))?.value).toEqual(authored.value);
    await second.queue.drain(true);

    const saved = (await second.queue.list())[0];
    expect(saved.state).toBe('acknowledged');
    expect(saved.result?.kind).toBe('acknowledged');
    expect(saved.working.value).toEqual(authored.value);
    expect(saved.intended).toEqual(authored.value);
    expect(saved.working.metadata?.operationId).toBe('seed-device-two');
    expect(saved.working.metadata?.revision).toBe((authored.metadata?.revision ?? 0) + 1);
    expect(shared.rows.get(key(resource))?.value).toEqual(authored.value);

    const secondDeviceSends = shared.sent.filter(command => command.operationId === 'seed-device-two');
    expect(secondDeviceSends).toHaveLength(2);
    expect(secondDeviceSends[0]).toEqual(secondDeviceSends[1]);
    expect(shared.sent.every(command => command.kind === 'relation' && command.relation === 'service-order-seed')).toBe(true);
    expect((await first.runtime.list())).toEqual([]);
    expect((await second.runtime.list())).toEqual([]);
    expect((await second.commits.list(owner)).every(request => request.state === 'acknowledged')).toBe(true);
  });
});
