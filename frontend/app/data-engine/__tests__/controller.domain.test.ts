import { EditorController, type EditorRecord } from '../controller';
import { DataEngineRuntime } from '../runtime';
import { planDataCommand } from '../serverRelations';

import type { EngineTransport, JournalEntry, ResourceRef, ResourceSnapshot } from '../types';

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const key = (ref: ResourceRef) => `${ref.collection}/${ref.id}`;
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const tick = async () => { for (let index = 0; index < 20; index += 1) await Promise.resolve(); };
const material: ResourceSnapshot = { resource: { collection: 'studyMaterials', id: 'm' }, value: { userId: 'owner', title: 'Original', type: 'study', noteIds: ['a'], sections: [{ id: 'section', title: 'Keep section', noteIds: ['a'] }] }, metadata: { protocol: 1, generation: 'material-generation', revision: 1, deleted: false } };
const note = (id: string): ResourceSnapshot => ({ resource: { collection: 'studyNotes', id }, value: { userId: 'owner', content: id, materialIds: id === 'a' ? ['m'] : [] }, metadata: { protocol: 1, generation: `generation-${id}`, revision: 1, deleted: false } });
function setup() {
  let sequence = 0, current = true;
  const server = new Map([material, note('a'), note('b')].map(snapshot => [key(snapshot.resource), clone(snapshot)]));
  const checkpoints = new Map<string, EditorRecord>(), journal = new Map<string, JournalEntry>();
  const store = { read: jest.fn(async (_owner: string, id: string) => checkpoints.get(id)), put: jest.fn(async (record: EditorRecord) => { checkpoints.set(record.editorId, clone(record)); }) };
  const transport: EngineTransport = {
    read: jest.fn(async (_owner, ref) => clone(server.get(key(ref))!)),
    send: jest.fn(async command => {
      const plan = await planDataCommand(command, server.get(key(command.resource))!, { get: async ref => clone(server.get(key(ref))!), list: async () => [] });
      plan.writes.forEach(snapshot => server.set(key(snapshot.resource), clone(snapshot))); return plan.result;
    }),
  };
  const journalStore = { list: jest.fn(async () => clone([...journal.values()])), put: jest.fn(async (entry: JournalEntry) => { journal.set(entry.command.operationId, clone(entry)); }), remove: jest.fn(async (_owner: string, id: string) => { journal.delete(id); }) };
  const runtime = new DataEngineRuntime({ transport, journal: journalStore }); runtime.setOwner('owner');
  const options = { owner: 'owner', editorId: 'editor', snapshot: material, store, runtime, operationId: () => `op-${++sequence}`, isCurrentOwner: () => current, readConfirmed: jest.fn(async (ref: ResourceRef) => clone(server.get(key(ref))!)) };
  return { options, runtime, server, transport, journal, journalStore, store, checkpoints, rotate: () => { current = false; runtime.setOwner('other'); } };
}

describe('Domain controller lifecycle', () => {
  it('keeps typing during target reads and commits membership before the latest text against actual server policy', async () => {
    const s = setup(), delayed = deferred<ResourceSnapshot>();
    s.options.readConfirmed.mockImplementation(async ref => ref.id === 'b' ? delayed.promise : note('a'));
    const editor = await EditorController.open(s.options);
    await editor.edit({ ...material.value, noteIds: ['b'], title: 'First draft' });
    const saving = editor.save(); await tick();
    const beforeRemove = editor.getState().checkpoint;
    expect(editor.getState().preparing).toBe(true);
    await expect(editor.remove()).rejects.toThrow('pending commands');
    expect(editor.getState().checkpoint).toEqual(beforeRemove);
    const typing = editor.edit({ ...material.value, noteIds: ['b'], title: 'Newer draft' });
    delayed.resolve(note('b')); await Promise.all([saving, typing]);
    const prepared = s.journal.get('op-1')!.command;
    expect(prepared).toMatchObject({ relation: 'material-notes', targets: [{ id: 'a', generation: 'generation-a' }, { id: 'b', generation: 'generation-b' }] });
    await s.runtime.drain(); await editor.settled();
    expect(s.server.get('studyMaterials/m')?.value?.title).toBe('Original');
    expect(editor.getState().checkpoint).toMatchObject({ dirty: true, draft: { title: 'Newer draft', noteIds: ['b'], sections: [{ noteIds: [] }] }, pending: {} });
    await editor.save(); await s.runtime.drain(); await editor.settled();
    expect(s.server.get('studyMaterials/m')?.value?.title).toBe('Newer draft');
    expect(editor.getState().checkpoint.dirty).toBe(false); expect(s.transport.send).toHaveBeenCalledTimes(2);
    editor.dispose();
  });

  it('refuses stale cached target generations without changing the command, server membership or local draft', async () => {
    const s = setup(); s.server.set('studyNotes/b', { ...note('b'), metadata: { ...note('b').metadata!, generation: 'recreated-b' } });
    s.options.readConfirmed.mockImplementation(async ref => note(ref.id));
    const editor = await EditorController.open(s.options); await editor.edit({ ...material.value, noteIds: ['b'], title: 'Keep draft' });
    await editor.save(); const command = clone(s.journal.get('op-1')!.command);
    await s.runtime.drain(); await editor.settled();
    expect(editor.getState().result).toMatchObject({ kind: 'refused', code: 'generation-mismatch' });
    expect(s.server.get('studyMaterials/m')).toEqual(material);
    expect(editor.getState().checkpoint.draft?.title).toBe('Keep draft');
    await editor.retryPersistence(); expect(s.journal.get('op-1')!.command).toEqual(command);
    expect(s.journal.get('op-1')!.state).toBe('refused'); editor.dispose();
  });

  it('never prepares or publishes an old account after a target read completes', async () => {
    const s = setup(), delayed = deferred<ResourceSnapshot>(); s.options.readConfirmed.mockReturnValue(delayed.promise);
    const editor = await EditorController.open(s.options); await editor.edit({ ...material.value, noteIds: ['b'] });
    const saving = editor.save(); await tick(); s.rotate(); delayed.resolve(note('a'));
    await expect(saving).rejects.toThrow('no longer active'); expect(s.journal.size).toBe(0);
    expect(s.checkpoints.get('editor')?.checkpoint.draft?.noteIds).toEqual(['b']); editor.dispose();
  });

  it('reports missing generation readers without losing the persisted draft', async () => {
    const s = setup(); const editor = await EditorController.open({ ...s.options, readConfirmed: undefined });
    await editor.edit({ ...material.value, noteIds: ['b'] });
    await expect(editor.save()).rejects.toThrow('target reads are unavailable');
    expect(s.checkpoints.get('editor')?.checkpoint.draft?.noteIds).toEqual(['b']); expect(s.journal.size).toBe(0); editor.dispose();
  });
});
