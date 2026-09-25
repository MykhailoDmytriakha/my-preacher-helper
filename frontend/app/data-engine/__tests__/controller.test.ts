import { EditorController, type CheckpointStore, type EditorRecord } from '../controller';
import { applyCommand } from '../protocol';
import { DataEngineRuntime } from '../runtime';

import type { EngineTransport, JournalEntry, JournalStore, ResourceSnapshot } from '../types';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const initial = (): ResourceSnapshot => ({ resource: { collection: 'studyNotes', id: 'note' }, value: { userId: 'owner', content: 'base', tags: [] }, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false } });
function setup() {
  let owner = 'owner', sequence = 0, server = initial();
  const records = new Map<string, EditorRecord>();
  const entries = new Map<string, JournalEntry>();
  const store: CheckpointStore = {
    read: jest.fn(async (uid, id) => records.get(JSON.stringify([uid, id]))),
    put: jest.fn(async record => { records.set(JSON.stringify([record.owner, record.editorId]), clone(record)); }),
  };
  const journal: JournalStore = {
    list: jest.fn(async uid => clone([...entries.values()].filter(entry => entry.command.owner === uid))),
    put: jest.fn(async entry => { entries.set(entry.command.operationId, clone(entry)); }),
    remove: jest.fn(async (_uid, id) => { entries.delete(id); }),
  };
  const transport: EngineTransport = {
    read: jest.fn(async () => server),
    send: jest.fn(async command => {
      const result = applyCommand(command, server);
      if (result.kind === 'acknowledged') server = result.snapshot;
      return result;
    }),
  };
  const runtime = new DataEngineRuntime({ journal, transport }); runtime.setOwner(owner);
  const options = { owner, editorId: 'tab-editor', snapshot: initial(), store, runtime, operationId: () => `op-${++sequence}`, isCurrentOwner: (uid: string) => owner === uid };
  return { options, records, entries, store, journal, transport, runtime, server: () => server, rotate: () => { owner = 'other'; runtime.setOwner(owner); } };
}

describe('EditorController durable lifecycle', () => {
  it('restores a draft after reload and commits through the actual runtime/reducer contract', async () => {
    const s = setup();
    const editor = await EditorController.open(s.options);
    await editor.edit({ ...initial().value, content: 'mine' });
    editor.dispose();
    const restored = await EditorController.open(s.options);
    expect(restored.getState().checkpoint.draft?.content).toBe('mine');
    await restored.save(); await s.runtime.drain(); await restored.settled();
    expect(s.server().value?.content).toBe('mine');
    expect(restored.getState()).toMatchObject({ durable: true, checkpoint: { dirty: false, pending: {} } });
    expect(s.entries.size).toBe(0);
  });

  it('replays a prepared checkpoint after a crash before journal commit', async () => {
    const s = setup(); const editor = await EditorController.open(s.options);
    await editor.edit({ ...initial().value, content: 'mine' });
    jest.mocked(s.journal.put).mockRejectedValueOnce(new Error('storage interrupted'));
    await expect(editor.save()).rejects.toThrow('interrupted');
    expect(s.entries.size).toBe(0);
    const saved = [...s.records.values()][0];
    expect(saved.prepared?.operationId).toBe('op-1');
    editor.dispose();
    const restored = await EditorController.open(s.options);
    expect([...s.entries.values()][0].command).toEqual(saved.prepared);
    await s.runtime.drain(); await restored.settled();
    expect(restored.getState().checkpoint.dirty).toBe(false);
  });

  it('retains ACK for replay when checkpoint storage fails and recovers without reload', async () => {
    const s = setup(); const editor = await EditorController.open(s.options);
    await editor.edit({ ...initial().value, content: 'mine' }); await editor.save();
    jest.mocked(s.store.put).mockRejectedValueOnce(new Error('disk full'));
    await s.runtime.drain(); await expect(editor.settled()).rejects.toThrow('disk full');
    expect([...s.entries.values()][0].state).toBe('acknowledged');
    expect(editor.getState().durable).toBe(false);
    await s.runtime.drain(); await editor.settled();
    expect(s.transport.send).toHaveBeenCalledTimes(1);
    expect(s.entries.size).toBe(0);
    expect(editor.getState().durable).toBe(true);
  });

  it('recovers the crash between durable projection and journal finalization', async () => {
    const s = setup(); const editor = await EditorController.open(s.options);
    await editor.edit({ ...initial().value, content: 'mine' }); await editor.save();
    jest.mocked(s.journal.remove).mockRejectedValueOnce(new Error('interrupted'));
    await s.runtime.drain(); await expect(editor.settled()).rejects.toThrow('interrupted');
    expect([...s.records.values()][0]).toMatchObject({ prepared: null, unfinalized: ['op-1'] });
    editor.dispose();
    const restored = await EditorController.open(s.options);
    expect(s.entries.size).toBe(0);
    expect(restored.getState().checkpoint.dirty).toBe(false);
  });

  it('keeps newer typing dirty after an earlier ACK and sends it against its new baseline', async () => {
    const s = setup(); const editor = await EditorController.open(s.options);
    await editor.edit({ ...initial().value, content: 'first' }); await editor.save();
    await editor.edit({ ...initial().value, content: 'second' });
    await s.runtime.drain(); await editor.settled();
    expect(editor.getState().checkpoint).toMatchObject({ dirty: true, draft: { content: 'second' } });
    await editor.save(); await s.runtime.drain(); await editor.settled();
    expect(s.server().value?.content).toBe('second');
    expect(editor.getState().checkpoint.dirty).toBe(false);
  });

  it('does not claim durability when a keystroke arrives during the disk transaction', async () => {
    const s = setup(); const editor = await EditorController.open(s.options);
    let finish!: () => void;
    jest.mocked(s.store.put).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const first = editor.edit({ content: 'first' });
    while (!finish) await Promise.resolve();
    const second = editor.edit({ content: 'second' });
    const observed: boolean[] = [];
    editor.subscribe(() => observed.push(editor.getState().durable));
    finish(); await first; await second;
    expect(observed).toContain(false);
    expect(editor.getState().durable).toBe(true);
  });

  it('keeps conflict draft until an explicit terminal resolution and rejects discarding unknown', async () => {
    const s = setup(); const editor = await EditorController.open(s.options);
    await editor.edit({ ...initial().value, content: 'mine' }); await editor.save();
    await expect(editor.acceptRemote()).rejects.toThrow('unresolved');
    const remote = { ...initial(), value: { ...initial().value, content: 'theirs' } };
    jest.mocked(s.transport.send).mockResolvedValueOnce({ kind: 'conflict', operationId: 'op-1', snapshot: remote, conflicts: [] });
    await s.runtime.drain(); await editor.settled();
    expect(editor.getState().checkpoint.draft?.content).toBe('mine');
    await editor.acceptRemote();
    expect(editor.getState().checkpoint.draft?.content).toBe('theirs');
    expect(s.entries.size).toBe(0);
  });

  it('observes clean updates, preserves dirty candidates, and fences account changes', async () => {
    const s = setup(); const editor = await EditorController.open(s.options);
    const listener = jest.fn(); const unsubscribe = editor.subscribe(listener);
    editor.subscribe(() => { throw new Error('render'); });
    await editor.observe({ ...initial(), value: { ...initial().value, content: 'new' } }, 'server');
    expect(editor.getState().checkpoint.draft?.content).toBe('new');
    await editor.save(); expect(s.entries.size).toBe(0);
    expect(listener).toHaveBeenCalled(); unsubscribe();
    s.rotate();
    expect(() => editor.edit({ content: 'wrong owner' })).toThrow('no longer active');
    await expect(editor.observe(initial(), 'server')).rejects.toThrow('no longer active');
    expect(() => editor.getState()).toThrow('no longer active');
    editor.dispose();
  });

  it('rejects another resource checkpoint instead of restoring it into the wrong editor', async () => {
    const s = setup(); const editor = await EditorController.open(s.options);
    await editor.edit({ content: 'mine' }); editor.dispose();
    const record = [...s.records.values()][0]; record.checkpoint.confirmed.resource.id = 'other';
    await expect(EditorController.open(s.options)).rejects.toThrow('identity mismatch');
  });

  it('unsubscribes a failed open so it cannot later overwrite a successfully restored editor', async () => {
    const s = setup(); const editor = await EditorController.open(s.options);
    await editor.edit({ ...initial().value, content: 'first' }); await editor.save(); editor.dispose();
    const subscribe = s.runtime.subscribe.bind(s.runtime);
    const disposers: jest.Mock[] = [];
    jest.spyOn(s.runtime, 'subscribe').mockImplementation(listener => {
      const stop = jest.fn(subscribe(listener)); disposers.push(stop); return stop;
    });
    jest.spyOn(s.runtime, 'submit').mockRejectedValueOnce(new Error('interrupted open'));
    await expect(EditorController.open(s.options)).rejects.toThrow('interrupted open');
    expect(disposers[0]).toHaveBeenCalledTimes(1);
    const restored = await EditorController.open(s.options);
    await restored.edit({ ...initial().value, content: 'newer' });
    await s.runtime.drain(); await restored.settled();
    expect([...s.records.values()][0].checkpoint.draft?.content).toBe('newer');
  });

  it('stops finalizing checkpoint receipts as soon as the account changes', async () => {
    const s = setup(); const editor = await EditorController.open(s.options);
    await editor.edit({ ...initial().value, content: 'mine' }); editor.dispose();
    const record = [...s.records.values()][0]; record.unfinalized = ['one', 'two'];
    const finalize = jest.spyOn(s.runtime, 'finalize').mockImplementationOnce(async () => { s.rotate(); });
    await expect(EditorController.open(s.options)).rejects.toThrow('no longer active');
    expect(finalize.mock.calls).toEqual([['one']]);
    expect(record.unfinalized).toEqual(['one', 'two']);
  });
});

describe('EditorController keeps local conflict fields explicitly', () => {
  it('blocks unknown outcomes, then rebases a terminal conflict and durably prepares only local changes', async () => {
    const s = setup(); const editor = await EditorController.open(s.options);
    await editor.edit({ ...initial().value, content: 'mine' }); await editor.save();
    jest.mocked(s.transport.send).mockRejectedValueOnce(new Error('lost ACK'));
    await s.runtime.drain();
    await expect(editor.keepLocal()).rejects.toThrow('unresolved');
    expect(s.entries.get('op-1')?.state).toBe('unknown');
    const remote = { ...initial(), value: { ...initial().value, content: 'theirs', tags: ['remote'] }, metadata: { ...initial().metadata!, revision: 2 } };
    jest.mocked(s.transport.send).mockResolvedValueOnce({ kind: 'conflict', operationId: 'op-1', snapshot: remote, conflicts: [] });
    await s.runtime.drain(); await editor.settled(); await editor.keepLocal();
    expect(editor.getState()).toMatchObject({ durable: true, result: null, checkpoint: { confirmed: remote, draft: { content: 'mine', tags: ['remote'] }, pending: {}, conflicts: [] } });
    expect(s.entries.size).toBe(0);
    expect([...s.records.values()][0]).toMatchObject({ prepared: null, checkpoint: { draft: { content: 'mine', tags: ['remote'] } } });
    await editor.save();
    expect(s.entries.get('op-2')?.command).toMatchObject({ kind: 'update', changes: [{ path: ['content'], before: { exists: true, value: 'theirs' }, after: { exists: true, value: 'mine' } }] });
  });

  it('keeps terminal deletion evidence and the draft when a new copy is required', async () => {
    const s = setup(); const editor = await EditorController.open(s.options);
    await editor.edit({ ...initial().value, content: 'mine' }); await editor.save();
    const deleted = { ...initial(), value: null, metadata: { ...initial().metadata!, revision: 2, deleted: true } };
    jest.mocked(s.transport.send).mockResolvedValueOnce({ kind: 'deleted', operationId: 'op-1', snapshot: deleted });
    await s.runtime.drain(); await editor.settled();
    await expect(editor.keepLocal()).rejects.toMatchObject({ code: 'use-new-copy' });
    expect(editor.getState().checkpoint.draft?.content).toBe('mine');
    expect(s.entries.get('op-1')?.state).toBe('conflict');
    expect(editor.getState().checkpoint.pending).toHaveProperty('op-1');
  });

  it('releases a corrected invalid document without inventing a new baseline, but requires a fresh generation', async () => {
    const s = setup(); const editor = await EditorController.open(s.options);
    await editor.edit({ ...initial().value, content: 'invalid' }); await editor.save();
    jest.mocked(s.transport.send).mockResolvedValueOnce({ kind: 'refused', operationId: 'op-1', code: 'invalid-document' });
    await s.runtime.drain(); await editor.settled();
    await editor.edit({ ...initial().value, content: 'corrected' }); await editor.keepLocal();
    expect(editor.getState().checkpoint.confirmed).toEqual(initial());
    expect(editor.getState().checkpoint.draft?.content).toBe('corrected');
    await editor.save();
    jest.mocked(s.transport.send).mockResolvedValueOnce({ kind: 'refused', operationId: 'op-2', code: 'generation-mismatch' });
    await s.runtime.drain(); await editor.settled();
    await expect(editor.keepLocal()).rejects.toMatchObject({ code: 'fresh-read-required' });
    expect(s.entries.get('op-2')?.state).toBe('refused');
  });

  it('uses typing arriving during retirement and ignores an obsolete ACK after the replacement is queued', async () => {
    const s = setup();
    let receive!: Parameters<typeof s.runtime.subscribe>[0];
    const subscribe = s.runtime.subscribe.bind(s.runtime);
    jest.spyOn(s.runtime, 'subscribe').mockImplementation(listener => { receive = listener; return subscribe(listener); });
    const editor = await EditorController.open(s.options);
    await editor.edit({ ...initial().value, content: 'mine' }); await editor.save();
    const remote = { ...initial(), value: { ...initial().value, content: 'theirs', tags: ['remote'] }, metadata: { ...initial().metadata!, revision: 2 } };
    jest.mocked(s.transport.send).mockResolvedValueOnce({ kind: 'conflict', operationId: 'op-1', snapshot: remote, conflicts: [] });
    await s.runtime.drain(); await editor.settled();
    let finish!: () => void;
    const remove = jest.mocked(s.journal.remove).getMockImplementation()!;
    jest.mocked(s.journal.remove).mockImplementationOnce(async (owner, id) => { await new Promise<void>(resolve => { finish = resolve; }); await remove(owner, id); });
    const resolving = editor.keepLocal(); while (!finish) await Promise.resolve();
    const typing = editor.edit({ ...initial().value, content: 'newer typing' });
    finish(); await resolving; await typing; await editor.save();
    receive({ kind: 'result', owner: 'owner', result: { kind: 'acknowledged', operationId: 'op-1', snapshot: remote } });
    await editor.settled();
    expect(editor.getState().checkpoint).toMatchObject({ draft: { content: 'newer typing', tags: ['remote'] }, dirty: true, pending: { 'op-2': expect.any(Object) } });
    expect([...s.records.values()][0].checkpoint.draft?.content).toBe('newer typing');
  });
  it.each(['local', 'remote'] as const)('preserves unrelated typing arriving during a manual %s conflict decision', async choice => {
    const s = setup(), editor = await EditorController.open(s.options);
    await editor.edit({ ...initial().value, content: 'mine' }); await editor.save();
    const remote = { ...initial(), value: { ...initial().value, content: 'theirs' }, metadata: { ...initial().metadata!, revision: 2 } };
    jest.mocked(s.transport.send).mockResolvedValueOnce({ kind: 'conflict', operationId: 'op-1', snapshot: remote, conflicts: [] });
    await s.runtime.drain(); await editor.settled();
    let finish!: () => void;
    const remove = jest.mocked(s.journal.remove).getMockImplementation()!;
    jest.mocked(s.journal.remove).mockImplementationOnce(async (owner, id) => { await new Promise<void>(resolve => { finish = resolve; }); await remove(owner, id); });
    const resolving = choice === 'local' ? editor.keepLocal([['content']], {
      base: { ...initial().value!, content: 'mine' }, value: { ...initial().value!, content: 'corrected mine' },
    }) : editor.acceptRemote([['content']]);
    const refused = expect(resolving).rejects.toThrow('other document changes');
    while (!finish) await Promise.resolve();
    const typing = editor.edit({ ...initial().value, content: 'mine', tags: ['later unsent'] });
    finish(); await refused; await typing; await editor.settled();
    expect(editor.getState().checkpoint.draft).toMatchObject({ content: 'mine', tags: ['later unsent'] });
    expect([...s.records.values()][0].checkpoint.draft?.tags).toEqual(['later unsent']);
    expect(s.transport.send).toHaveBeenCalledTimes(1);
    expect(() => editor.save(undefined, [['content']])).toThrow('other document changes');
  });

  it('retries a failed local checkpoint with the latest draft and the same edit generation', async () => {
    const s = setup(); const editor = await EditorController.open(s.options);
    jest.mocked(s.store.put).mockRejectedValueOnce(new Error('quota'));
    await expect(editor.edit({ ...initial().value, content: 'latest' })).rejects.toThrow('quota');
    const generation = editor.getState().checkpoint.editGeneration;
    await editor.retryPersistence();
    expect(editor.getState()).toMatchObject({ durable: true, error: null, checkpoint: { editGeneration: generation, draft: { content: 'latest' } } });
    expect([...s.records.values()][0].checkpoint.editGeneration).toBe(generation); editor.dispose();
  });

  it('retries a missing journal commit with the identical prepared command instead of creating another operation', async () => {
    const s = setup(); const editor = await EditorController.open(s.options);
    await editor.edit({ ...initial().value, content: 'queued' });
    jest.mocked(s.journal.put).mockRejectedValueOnce(new Error('journal quota'));
    await expect(editor.save()).rejects.toThrow('journal quota');
    const prepared = clone([...s.records.values()][0].prepared);
    await editor.edit({ ...initial().value, content: 'later typing' });
    await editor.retryPersistence();
    expect(s.entries.get(prepared!.operationId)?.command).toEqual(prepared);
    expect(editor.getState().checkpoint.draft?.content).toBe('later typing');
    expect(s.transport.send).not.toHaveBeenCalled(); editor.dispose();
  });

  it('queues delete against the exact confirmed baseline, preserves later typing, and refuses pending removal before mutation', async () => {
    const s = setup(); const editor = await EditorController.open(s.options);
    await editor.edit({ ...initial().value, content: 'unsent draft' });
    const removing = editor.remove();
    const typing = editor.edit({ ...initial().value, content: 'typed after delete' });
    await Promise.all([removing, typing]);
    expect(s.entries.get('op-1')?.command).toMatchObject({ kind: 'delete', baseline: initial().value });
    const checkpoint = editor.getState().checkpoint;
    await expect(editor.remove()).rejects.toThrow('pending commands');
    expect(editor.getState().checkpoint).toEqual(checkpoint);
    await s.runtime.drain(); await editor.settled();
    expect(editor.getState().checkpoint).toMatchObject({ confirmed: { value: null }, draft: { content: 'typed after delete' }, dirty: true });
    await editor.remove(); expect(s.entries.size).toBe(0); editor.dispose();
  });

  it('does not remove an unavailable or nondurable document', async () => {
    const s = setup(); const absent = await EditorController.open({ ...s.options, snapshot: { ...initial(), value: null, metadata: null } });
    await absent.remove(); expect(s.entries.size).toBe(0); absent.dispose();
    const editor = await EditorController.open(s.options);
    jest.mocked(s.store.put).mockRejectedValueOnce(new Error('quota'));
    await editor.edit({ ...initial().value, content: 'unsaved' }).catch(() => undefined);
    const before = editor.getState().checkpoint;
    await expect(editor.remove()).rejects.toThrow('local draft'); expect(editor.getState().checkpoint).toEqual(before); editor.dispose();
  });

});

it('rejects an unselected manual amendment before retiring the failed command', async () => {
  const s = setup(), editor = await EditorController.open(s.options);
  await editor.edit({ ...initial().value, content: 'mine' }); await editor.save();
  const remote = { ...initial(), value: { ...initial().value, content: 'theirs' }, metadata: { ...initial().metadata!, revision: 2 } };
  jest.mocked(s.transport.send).mockResolvedValueOnce({ kind: 'conflict', operationId: 'op-1', snapshot: remote, conflicts: [] });
  await s.runtime.drain(); await editor.settled();
  await expect(editor.keepLocal([['content']], { base: initial().value!, value: { ...initial().value!, tags: ['unselected'] } })).rejects.toThrow('unselected');
  expect(s.journal.remove).not.toHaveBeenCalled();
  expect(Object.keys(editor.getState().checkpoint.pending)).toEqual(['op-1']);
  expect(editor.getState().checkpoint.draft?.content).toBe('mine'); editor.dispose();
});
