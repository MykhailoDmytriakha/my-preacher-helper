import { DataEngineRuntime } from '../runtime';
import type { CommandResult, DataCommand, EngineTransport, JournalEntry, JournalStore } from '../types';
const command = (operationId = 'operation-1', id = 'one', owner = 'owner'): DataCommand => ({ protocol: 1, operationId, owner, resource: { collection: 'studyNotes', id }, generation: null, dependsOn: [], kind: 'create', value: { content: 'mine' } });
const ack = (c: DataCommand): CommandResult => ({ kind: 'acknowledged', operationId: c.operationId, snapshot: { resource: c.resource, value: { content: 'mine' }, metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false } } });
function setup() {
  const records = new Map<string, JournalEntry>();
  const journal: JournalStore = {
    put: jest.fn(async entry => { records.set(entry.command.operationId, JSON.parse(JSON.stringify(entry))); }),
    remove: jest.fn(async (_owner, id) => { records.delete(id); }),
    list: jest.fn(async owner => [...records.values()].filter(entry => entry.command.owner === owner)),
  };
  const transport: EngineTransport = { send: jest.fn(async c => ack(c)), read: jest.fn() };
  const runtime = new DataEngineRuntime({ journal, transport, now: () => 1 });
  runtime.setOwner('owner');
  return { records, journal, transport, runtime };
}
describe('DataEngineRuntime', () => {
  it('drains newly committed commands during an active drain without retrying unknown outcomes', async () => {
    const { runtime, transport, records } = setup();
    await runtime.submit(command());
    let fail!: (reason: Error) => void;
    jest.mocked(transport.send).mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    const draining = runtime.drain();
    while (!fail) await Promise.resolve();
    await runtime.submit(command('operation-2', 'two'));
    const joined = runtime.drain();
    fail(new Error('lost ACK'));
    await Promise.all([draining, joined]);
    expect(transport.send).toHaveBeenCalledTimes(2);
    expect(records.get('operation-1')?.state).toBe('unknown');
    expect(records.get('operation-2')?.state).toBe('acknowledged');
  });

  it('does not send when the owner changes during the durable sending commit', async () => {
    const { runtime, journal, transport, records } = setup();
    await runtime.submit(command());
    const write = jest.mocked(journal.put).getMockImplementation()!;
    jest.mocked(journal.put).mockImplementationOnce(async entry => {
      await write(entry); runtime.setOwner('other');
    });
    await runtime.drain();
    expect(transport.send).not.toHaveBeenCalled();
    expect(records.get('operation-1')?.state).toBe('sending');
    runtime.setOwner('owner'); await runtime.drain();
    expect(records.get('operation-1')?.state).toBe('acknowledged');
  });
  it('does not expose a late journal read to another owner', async () => {
    const { runtime, journal } = setup();
    const c = command(); await runtime.submit(c);
    let finish!: (entries: JournalEntry[]) => void;
    jest.mocked(journal.list).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const reading = runtime.list(); runtime.setOwner('other'); finish([{ command: c, state: 'queued', createdAt: 1, attempts: 0 }]);
    expect(await reading).toEqual([]);
  });
  it('replays a durable ACK after reload until its local projection is finalized', async () => {
    const { runtime, journal, transport, records } = setup();
    const c = command(); await runtime.submit(c); await runtime.drain();
    const restored = new DataEngineRuntime({ journal, transport }); restored.setOwner('owner');
    const listener = jest.fn(); restored.subscribe(listener); await restored.drain();
    expect(listener).toHaveBeenCalledWith({ kind: 'result', owner: 'owner', result: ack(c) });
    expect(transport.send).toHaveBeenCalledTimes(1);
    await restored.finalize(c.operationId);
    expect(records.size).toBe(0);
    await restored.finalize(c.operationId);
    await restored.submit(command('unresolved'));
    await expect(restored.finalize('unresolved')).rejects.toThrow('unacknowledged');
    await expect(restored.discard('unresolved')).rejects.toThrow('unresolved');
    jest.mocked(transport.send).mockResolvedValueOnce({ kind: 'refused', operationId: 'unresolved', code: 'denied' });
    await restored.drain(); await restored.discard('unresolved'); await restored.discard('missing');
    restored.setOwner(null);
    await expect(restored.finalize('missing')).rejects.toThrow('Authentication');
    await expect(restored.discard('missing')).rejects.toThrow('Authentication');
  });

  it('reports queued only after local commit, protects payload identity and isolates subscribers', async () => {
    const { runtime, journal, records } = setup();
    const listener = jest.fn();
    const unsubscribe = runtime.subscribe(listener);
    runtime.subscribe(() => { throw new Error('render'); });
    const c = command();
    await expect(runtime.submit(c)).resolves.toEqual({ kind: 'queued', operationId: c.operationId });
    expect(records.size).toBe(1);
    await runtime.submit(c);
    expect(journal.put).toHaveBeenCalledTimes(1);
    await expect(runtime.submit({ ...c, kind: 'create', value: { content: 'other' } })).rejects.toThrow('identity');
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ kind: 'journal' }));
    unsubscribe();
    expect(await runtime.list()).toHaveLength(1);
    runtime.setOwner(null);
    expect(await runtime.list()).toEqual([]);
    await runtime.drain();
    await expect(runtime.submit(c)).rejects.toThrow('Account changed');
  });
  it('does not promise queued or send after failed local storage', async () => {
    const { runtime, journal, transport } = setup();
    jest.mocked(journal.put).mockRejectedValueOnce(new Error('quota'));
    await expect(runtime.submit(command())).rejects.toThrow('quota');
    expect(transport.send).not.toHaveBeenCalled();
  });
  it('retries the identical unknown command and serializes concurrent drains', async () => {
    const { runtime, transport, records } = setup();
    const c = command();
    await runtime.submit(c);
    jest.mocked(transport.send).mockRejectedValueOnce(new Error('lost ACK'));
    await Promise.all([runtime.drain(), runtime.drain()]);
    expect(transport.send).toHaveBeenCalledTimes(1);
    expect(records.get(c.operationId)).toMatchObject({ state: 'unknown', attempts: 1, command: c });
    await runtime.drain();
    expect(transport.send).toHaveBeenLastCalledWith(c);
    expect(records.get(c.operationId)?.state).toBe('acknowledged');
    await runtime.finalize(c.operationId);
    expect(records.size).toBe(0);
  });
  it('retains conflicts and blocks their dependent commands without blocking another resource', async () => {
    const { runtime, transport, records } = setup();
    const first = command();
    const second = { ...command('operation-2'), dependsOn: [first.operationId] };
    await runtime.submit(first); await runtime.submit(second); await runtime.submit(command('operation-3', 'two'));
    jest.mocked(transport.send).mockImplementation(async c => c.operationId === first.operationId ? { kind: 'refused', operationId: c.operationId, code: 'denied' } : ack(c));
    await runtime.drain();
    expect(records.get(first.operationId)?.state).toBe('refused');
    expect(records.get(second.operationId)?.state).toBe('blocked');
    expect(records.get('operation-3')?.state).toBe('acknowledged');
    const restoredListener = jest.fn(); runtime.subscribe(restoredListener);
    await runtime.drain();
    expect(restoredListener).toHaveBeenCalledWith({ kind: 'result', owner: 'owner', result: { kind: 'refused', operationId: first.operationId, code: 'denied' } });
    expect(transport.send).toHaveBeenCalledTimes(2);
  });
  it('keeps deleted and conflict results and handles server dependency refusals', async () => {
    const { runtime, transport, records } = setup();
    for (const [index, kind] of ['deleted', 'conflict', 'blocked'].entries()) {
      const c = command(`operation-${index}`, `resource-${index}`);
      await runtime.submit(c);
      const result = kind === 'blocked' ? { kind, operationId: c.operationId, dependencies: ['missing'] } : { kind, operationId: c.operationId, snapshot: (ack(c) as Extract<CommandResult, {kind:'acknowledged'}>).snapshot, conflicts: [] };
      jest.mocked(transport.send).mockResolvedValueOnce(result as CommandResult);
    }
    await runtime.drain();
    expect([...records.values()].map(entry => entry.state)).toEqual(['conflict', 'conflict', 'blocked']);
    await runtime.drain();
    expect(records.get('operation-2')?.state).toBe('acknowledged');
  });
  it('persists an old owner result without publishing it after account change', async () => {
    const { runtime, transport, records } = setup();
    const events = jest.fn(); runtime.subscribe(events);
    const c = command(); await runtime.submit(c); events.mockClear();
    let finish!: (value: CommandResult) => void;
    jest.mocked(transport.send).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const draining = runtime.drain();
    while (!finish) await Promise.resolve();
    runtime.setOwner('other'); finish(ack(c)); await draining;
    expect(events).not.toHaveBeenCalled();
    expect(records.get(c.operationId)?.state).toBe('acknowledged');
  });
  it('keeps malformed replies unknown and reports persistence failure after allowing other resources', async () => {
    const { runtime, transport, journal, records } = setup();
    await runtime.submit(command());
    jest.mocked(transport.send).mockResolvedValueOnce(ack(command('wrong')));
    await runtime.drain();
    expect(records.get('operation-1')?.state).toBe('unknown');
    await runtime.submit(command('operation-2', 'two'));
    jest.mocked(journal.put).mockRejectedValueOnce(new Error('disk failure'));
    await expect(runtime.drain()).rejects.toThrow('disk failure');
    expect(records.get('operation-2')?.state).toBe('acknowledged');
  });
});
