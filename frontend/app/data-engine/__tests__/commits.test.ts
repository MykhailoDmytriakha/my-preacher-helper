import { CommitQueue, createMemoryCommitStore } from '../commits';
import { DataEngine } from '../engine';
import { ResourceObserver } from '../observer';
import { applyCommand } from '../protocol';
import { DataEngineRuntime } from '../runtime';
import { DataSession } from '../session';
import { planDataCommand } from '../serverRelations';

import type { EditorRecord } from '../controller';
import type { CommandResult, EngineTransport, JournalEntry, ResourceSnapshot } from '../types';

const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const initial = (): ResourceSnapshot => ({ resource: { collection: 'sermons', id: 'sermon' }, value: { userId: 'owner', title: 'base', scratch: [], rev: { core: 1 } }, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false } });
const settle = async () => { for (let i = 0; i < 100; i += 1) await Promise.resolve(); };

function setup() {
  let server = initial(), sequence = 0;
  const entries = new Map<string, JournalEntry>();
  const receipts = new Map<string, CommandResult>();
  const requests = createMemoryCommitStore();
  const records = new Map<string, EditorRecord>();
  let cache = initial();
  const transport: EngineTransport = {
    read: jest.fn(async () => copy(server)),
    send: jest.fn(async command => {
      const previous = receipts.get(command.operationId);
      if (previous) return copy(previous);
      const result = applyCommand(command, server);
      if (result.kind === 'acknowledged') server = copy(result.snapshot);
      receipts.set(command.operationId, copy(result)); return result;
    }),
  };
  const journal = {
    list: jest.fn(async (owner: string) => copy([...entries.values()].filter(entry => entry.command.owner === owner))),
    put: jest.fn(async (entry: JournalEntry) => { entries.set(entry.command.operationId, copy(entry)); }),
    remove: jest.fn(async (_owner: string, id: string) => { entries.delete(id); }),
  };
  const makeRuntime = () => { const runtime = new DataEngineRuntime({ transport, journal }); runtime.setOwner('owner'); return runtime; };
  const makeQueue = (runtime = makeRuntime()) => {
    const queue = new CommitQueue({ store: requests, runtime, operationId: () => `op-${++sequence}`, readConfirmed: resource => transport.read('owner', resource) });
    queue.setOwner('owner'); return { queue, runtime };
  };
  const makeEngine = () => {
    const runtime = makeRuntime();
    const observer = new ResourceObserver({ transport, source: { listen: () => () => undefined } });
    const engine = new DataEngine({ runtime, observer, transport, commits: requests,
      checkpoints: { read: async (_owner, id) => records.get(id), put: async record => { records.set(record.editorId, copy(record)); } },
      snapshots: { read: async () => copy(cache), put: async (_owner, snapshot) => { cache = copy(snapshot); } },
      operationId: () => `op-${++sequence}` });
    engine.setOnline(false); engine.setOwner('owner'); return engine;
  };
  return { requests, transport, journal, entries, records, receipts, makeQueue, makeEngine, server: () => copy(server), replace: (snapshot: ResourceSnapshot) => { server = snapshot; } };
}

describe('Durable commit requests', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

  it('delivers saved A then B after a full engine restart without opening an editor, leaving staged C unsent', async () => {
    const s = setup(); const first = s.makeEngine();
    const editor = await first.openEditor(initial().resource, 'tab');
    await editor.commit(current => ({ ...current, title: 'A' }));
    await editor.commit(current => ({ ...current, title: 'B' }));
    await editor.edit({ ...editor.getState().checkpoint.draft, title: 'C' });
    expect(s.transport.send).not.toHaveBeenCalled();
    expect((await s.requests.list('owner')).map(request => request.value?.title)).toEqual(['A', 'B']);
    editor.dispose(); first.dispose(); await settle();
    const restarted = s.makeEngine();
    restarted.setOnline(true); await restarted.retry();
    expect(s.server().value?.title).toBe('B');
    expect(s.transport.send).toHaveBeenCalledTimes(2);
    expect([...s.records.values()][0].checkpoint.draft?.title).toBe('C');
    expect((await s.requests.list('owner')).every(request => request.state === 'acknowledged')).toBe(true);
    const recovered = await restarted.openEditor(initial().resource, 'tab');
    expect(recovered.getState().checkpoint).toMatchObject({ draft: { title: 'C', rev: { core: 3 } }, conflicts: [], pending: {} });
    restarted.dispose();
  });

  it('freezes save at invocation before persistence and does not accidentally authorize later typing', async () => {
    const s = setup(); const engine = s.makeEngine(); const editor = await engine.openEditor(initial().resource, 'tab');
    const staging = editor.edit({ ...initial().value, title: 'saved' });
    const saving = editor.save();
    const later = editor.edit({ ...initial().value, title: 'unsaved' });
    await Promise.all([staging, saving, later]);
    engine.setOnline(true); await engine.retry();
    expect(s.server().value?.title).toBe('saved');
    expect(editor.getState().checkpoint.draft?.title).toBe('unsaved');
    expect(editor.getState().checkpoint.conflicts).toEqual([]);
    engine.dispose();
  });

  it('does not create requests for stage-only edits or duplicate requests for repeated Save', async () => {
    const s = setup(); const engine = s.makeEngine(); const editor = await engine.openEditor(initial().resource, 'tab');
    await editor.edit({ ...initial().value, title: 'mine' });
    await engine.retry(); expect(await s.requests.list('owner')).toEqual([]);
    await Promise.all([editor.save(), editor.save()]);
    expect(await s.requests.list('owner')).toHaveLength(1);
    engine.dispose();
  });

  it('blocks a saved successor behind a terminal conflict and preserves the captured requests', async () => {
    const s = setup(); const { queue } = s.makeQueue(); const session = new DataSession(initial());
    session.edit({ ...initial().value, title: 'A' }); await queue.save('tab', session.checkpoint());
    session.edit({ ...initial().value, title: 'B' }); await queue.save('tab', session.checkpoint());
    s.replace({ ...initial(), value: { ...initial().value, title: 'remote' }, metadata: { ...initial().metadata!, revision: 2 } });
    await queue.drain(true);
    expect(s.server().value?.title).toBe('remote'); expect(s.transport.send).toHaveBeenCalledTimes(1);
    expect((await queue.list()).map(request => request.state)).toEqual(['conflict', 'queued']);
    await queue.cancel('tab'); expect((await queue.list()).every(request => request.state === 'cancelled')).toBe(true);
  });

  it('shares one persisted materialization across competing workers and preserves operation bytes on retry', async () => {
    const s = setup(); const a = s.makeQueue(); const b = s.makeQueue();
    const session = new DataSession(initial()); session.edit({ ...initial().value, title: 'mine' });
    await a.queue.save('tab', session.checkpoint());
    await Promise.all([a.queue.drain(false), b.queue.drain(false)]);
    const frozen = (await a.queue.list())[0].command;
    const send = jest.mocked(s.transport.send).getMockImplementation()!;
    jest.mocked(s.transport.send).mockImplementationOnce(async command => { await send(command); throw new Error('Lost ACK'); });
    await a.queue.drain(true); expect(s.transport.send).toHaveBeenCalledTimes(1);
    await b.queue.drain(true);
    expect(s.transport.send).toHaveBeenCalledTimes(2);
    expect(jest.mocked(s.transport.send).mock.calls.map(([command]) => command)).toEqual([frozen, frozen]);
    expect((await b.queue.list())[0].state).toBe('acknowledged');
  });

  it('retries ACK cleanup after a crash without replaying an accepted command', async () => {
    const s = setup(); const { queue } = s.makeQueue(); const session = new DataSession(initial());
    session.edit({ ...initial().value, title: 'mine' }); await queue.save('tab', session.checkpoint());
    jest.mocked(s.journal.remove).mockRejectedValueOnce(new Error('cleanup failed'));
    await expect(queue.drain(true)).rejects.toThrow('cleanup failed');
    expect((await queue.list())[0].unfinalized).toEqual(['op-1']);
    const restarted = s.makeQueue(); await restarted.queue.drain(true);
    expect(s.transport.send).toHaveBeenCalledTimes(1); expect(s.entries.size).toBe(0);
  });

  it('fences a late account response and never submits the old owner request as another owner', async () => {
    const s = setup(); const { queue, runtime } = s.makeQueue(); const session = new DataSession(initial());
    session.edit({ ...initial().value, title: 'mine' }); await queue.save('tab', session.checkpoint());
    const stop = queue.subscribe(() => undefined); stop();
    queue.setOwner(null); runtime.setOwner(null);
    expect(await queue.list()).toEqual([]); await queue.drain(true);
    await expect(queue.save('tab', session.checkpoint())).rejects.toThrow('Authentication');
    expect(s.transport.send).not.toHaveBeenCalled();
  });

  it('drains more than one hundred preparation transitions without needing another page or timer', async () => {
    const s = setup(); const { queue } = s.makeQueue(); const session = new DataSession(initial());
    for (let i = 0; i < 55; i += 1) {
      session.edit({ ...initial().value, title: `saved-${i}` }); await queue.save('tab', session.checkpoint());
    }
    await queue.drain(true);
    expect(s.server().value?.title).toBe('saved-54'); expect(s.transport.send).toHaveBeenCalledTimes(55);
    expect((await queue.list()).every(record => record.state === 'acknowledged' && !record.unfinalized.length)).toBe(true);
  });

  it('rebases C from known submitted B when compact ACK A already contains B, retaining B until its receipt', () => {
    const session = new DataSession(initial());
    const a = { ...initial().value, title: 'A' }, b = { ...initial().value, title: 'B' };
    session.edit(a); session.registerCommit('A', 1, a);
    session.edit(b); session.registerCommit('B', 2, b, 'B-1');
    session.edit({ ...b, title: 'C' });
    const snapshot = { ...initial(), value: b, metadata: { ...initial().metadata!, revision: 3, operationId: 'B-1' } };
    session.accept({ kind: 'acknowledged', operationId: 'A', snapshot });
    expect(session.checkpoint()).toMatchObject({ draft: { title: 'C' }, conflicts: [], pending: { B: { value: b } } });
    expect(Object.keys(session.checkpoint().pending)).toEqual(['B']);
    session.accept({ kind: 'acknowledged', operationId: 'B', snapshot });
    expect(session.checkpoint()).toMatchObject({ draft: { title: 'C' }, conflicts: [], dirty: true, pending: {} });
  });

  it('durably includes both a relation and ordinary fields, completing both without an editor', async () => {
    const s = setup();
    const material: ResourceSnapshot = { resource: { collection: 'studyMaterials', id: 'material' },
      value: { userId: 'owner', title: 'Old title', type: 'study', noteIds: [], createdAt: 'now', updatedAt: 'now' }, metadata: null };
    const note: ResourceSnapshot = { resource: { collection: 'studyNotes', id: 'note' },
      value: { userId: 'owner', content: 'Note', tags: [], scriptureRefs: [], isDraft: true, materialIds: [], createdAt: 'now', updatedAt: 'now' }, metadata: null };
    const rows = new Map([['studyMaterials/material', material], ['studyNotes/note', note]]);
    jest.mocked(s.transport.read).mockImplementation(async (_owner, resource) => copy(rows.get(`${resource.collection}/${resource.id}`)!));
    jest.mocked(s.transport.send).mockImplementation(async command => {
      const plan = await planDataCommand(command, rows.get(`${command.resource.collection}/${command.resource.id}`)!, {
        get: async resource => copy(rows.get(`${resource.collection}/${resource.id}`)!), list: async () => [],
      });
      for (const value of plan.writes) rows.set(`${value.resource.collection}/${value.resource.id}`, value);
      return plan.result;
    });
    const { queue } = s.makeQueue(); const session = new DataSession(material);
    session.edit({ ...material.value, title: 'Saved title', noteIds: ['note'] });
    await queue.save('tab', session.checkpoint()); await queue.drain(true);
    expect(jest.mocked(s.transport.send).mock.calls.map(([command]) => command.kind)).toEqual(['relation', 'update']);
    expect(rows.get('studyMaterials/material')?.value).toMatchObject({ title: 'Saved title', noteIds: ['note'] });
    expect(rows.get('studyNotes/note')?.value).toMatchObject({ materialIds: ['material'] });
    expect((await queue.list())[0].state).toBe('acknowledged');
  });

  it('validates explicit predecessor identity without inferring order between different scope generations', async () => {
    const s = setup(); const { queue } = s.makeQueue(); const session = new DataSession(initial());
    session.edit({ ...initial().value, title: 'A' }); const a = await queue.save('scope-A', session.checkpoint());
    const other = new DataSession(initial()); other.edit({ ...initial().value, title: 'B' });
    const b = await queue.save('scope-B', other.checkpoint(), { predecessorId: a!.id });
    expect(b?.predecessor).toBe(a?.id);
    const list = s.requests.list.bind(s.requests);
    jest.spyOn(s.requests, 'list').mockImplementation(async owner => (await list(owner)).reverse());
    expect((await queue.list()).map(request => request.id)).toEqual([a?.id, b?.id]);
    other.edit({ ...initial().value, title: 'C' });
    await expect(queue.save('scope-C', other.checkpoint(), { predecessorId: 'missing' })).rejects.toThrow('Invalid predecessor');
    await queue.drain(true); expect(s.server().value?.title).toBe('B');
  });

  it('starts the new owner after an old owner read finishes late without leaking its request', async () => {
    const s = setup(); const { queue, runtime } = s.makeQueue(); const session = new DataSession(initial());
    session.edit({ ...initial().value, title: 'owner intent' }); await queue.save('tab', session.checkpoint());
    const previous = await s.requests.list('owner');
    let finish!: (records: typeof previous) => void;
    jest.spyOn(s.requests, 'list').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const old = queue.drain(true);
    queue.setOwner('another'); runtime.setOwner('another');
    const next = queue.drain(true); finish(previous);
    const outcomes = await Promise.allSettled([old, next]);
    expect(outcomes[0].status).toBe('rejected'); expect(outcomes[1].status).toBe('fulfilled');
    expect(await queue.list()).toEqual([]); expect(s.transport.send).not.toHaveBeenCalled();
  });

  it('does not claim a queued request when its durable creation fails', async () => {
    const s = setup(); const engine = s.makeEngine(); const editor = await engine.openEditor(initial().resource, 'tab');
    jest.spyOn(s.requests, 'create').mockRejectedValueOnce(new Error('disk full'));
    await expect(editor.commit(current => ({ ...current, title: 'keep local' }))).rejects.toThrow('disk full');
    expect(await s.requests.list('owner')).toEqual([]);
    expect(editor.getState().checkpoint.draft?.title).toBe('keep local');
    expect(s.transport.send).not.toHaveBeenCalled(); engine.dispose();
  });

  it('retires terminal manual requests adopted by a parent, but refuses to discard any unknown sibling', async () => {
    const s = setup(); const { queue } = s.makeQueue(); const session = new DataSession(initial());
    session.edit({ ...initial().value, title: 'manual' }); const manual = await queue.save('scope', session.checkpoint());
    s.replace({ ...initial(), value: { ...initial().value, title: 'remote' } });
    await queue.drain(true);
    const other = new DataSession(initial()); other.edit({ ...initial().value, title: 'other' });
    const sibling = await queue.save('independent', other.checkpoint()); await queue.drain(false);
    await expect(queue.cancel('parent', [manual!.id, sibling!.id])).rejects.toThrow('Resolve pending');
    expect((await queue.list()).find(record => record.id === manual!.id)?.state).toBe('conflict');
    await queue.cancel('parent', [manual!.id]);
    expect((await queue.list()).find(record => record.id === manual!.id)?.state).toBe('cancelled');
  });
});
