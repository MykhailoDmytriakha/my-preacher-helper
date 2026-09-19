/** @jest-environment node */
import { randomUUID } from 'node:crypto';
import { adminDb } from '@/config/firebaseAdminConfig';
import { EditorController, type CheckpointStore, type EditorRecord } from '@/data-engine/controller';
import { DataEngineRuntime } from '@/data-engine/runtime';
import { DataEngine, type SnapshotStore } from '@/data-engine/engine';
import { createMemoryCommitStore } from '@/data-engine/commits';
import { ResourceObserver } from '@/data-engine/observer';
import { processCommand, readCollectionChanges, readDocument } from '@/data-engine/server';
import type { DataCommand, EngineTransport, JournalEntry, JournalStore, ResourceSnapshot } from '@/data-engine/types';

jest.mock('@/config/firebaseAdminConfig', () => {
  // Opt-in only. Never use application credentials or contact a remote database.
  if (process.env.DATA_ENGINE_EMULATOR_TEST !== 'true') return { adminDb: {} };
  if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8188') throw new Error('Use the isolated localhost emulator on port 8188');
  const { initializeApp } = jest.requireActual('firebase-admin/app');
  const { getFirestore } = jest.requireActual('firebase-admin/firestore');
  return { adminDb: getFirestore(initializeApp({ projectId: 'demo-data-engine' }, 'data-engine-integration')) };
});

const run = process.env.DATA_ENGINE_EMULATOR_TEST === 'true' ? describe : describe.skip;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const owner = `integration-${randomUUID()}`;
let sequence = 0;
const operationId = () => `${owner}-${++sequence}`;
const sermon = (id: string) => ({ collection: 'sermons', id: `${owner}-${id}` });
const note = (id: string, text: string) => ({ id, text, createdAt: '2026-09-12T00:00:00.000Z' });
const baseValue = () => ({ userId: owner, title: 'Sermon', verse: 'John 1:1', date: '2026-09-12', thoughts: [], scratch: [note('a', 'A'), note('b', 'B')] });

async function seed(id: string) {
  const resource = sermon(id);
  const result = await processCommand(owner, { protocol: 1, operationId: operationId(), owner, resource, generation: null, dependsOn: [], kind: 'create', value: baseValue() });
  if (result.kind !== 'acknowledged') throw new Error(`Seed refused: ${JSON.stringify(result)}`);
  return result.snapshot;
}
function device(initial: ResourceSnapshot, checkpoint?: Map<string, EditorRecord>, journal?: Map<string, JournalEntry>) {
  const checkpoints = checkpoint ?? new Map<string, EditorRecord>();
  const entries = journal ?? new Map<string, JournalEntry>();
  const storage: CheckpointStore = {
    read: async (_owner, id) => { const found = checkpoints.get(id); return found ? clone(found) : undefined; },
    put: async record => { checkpoints.set(record.editorId, clone(record)); },
  };
  const queue: JournalStore = {
    list: async selected => clone([...entries.values()].filter(entry => entry.command.owner === selected)),
    put: async entry => { entries.set(entry.command.operationId, clone(entry)); },
    remove: async (_owner, id) => { entries.delete(id); },
  };
  let loseAck = false;
  const commands: DataCommand[] = [];
  const transport: EngineTransport = {
    read: readDocument,
    send: async command => {
      commands.push(clone(command));
      const result = await processCommand(command.owner, command);
      if (loseAck) { loseAck = false; throw new Error('Connection lost after server commit'); }
      return result;
    },
  };
  const runtime = new DataEngineRuntime({ journal: queue, transport }); runtime.setOwner(owner);
  return {
    runtime, commands, checkpoints, entries,
    loseNextAcknowledgement: () => { loseAck = true; },
    open: () => EditorController.open({ owner, editorId: 'editor', snapshot: initial, store: storage, runtime, operationId, isCurrentOwner: value => value === owner }),
    deliver: async (editor: EditorController) => { await runtime.drain(); await editor.settled(); },
  };
}

run('DataEngine against real Firestore transactions', () => {
  jest.setTimeout(30_000);
  afterAll(async () => { await adminDb.terminate(); });

  it('serializes competing series assignments and preserves one owner after duplicate delivery', async () => {
    const member = await seed('exclusive-member');
    const createSeries = async (name: string, items: unknown[] = []) => {
      const resource = { collection: 'series', id: `${owner}-${name}` };
      const result = await processCommand(owner, { protocol: 1, operationId: operationId(), owner, resource, generation: null, dependsOn: [], kind: 'create',
        value: { userId: owner, theme: name, bookOrTopic: '', status: 'draft', createdAt: 'now', updatedAt: 'now', items } });
      if (result.kind !== 'acknowledged') throw new Error(`Series seed refused: ${JSON.stringify(result)}`);
      return result.snapshot;
    };
    const first = await createSeries('exclusive-first'), second = await createSeries('exclusive-second');
    const attach = (target: ResourceSnapshot): DataCommand => ({ protocol: 1, operationId: operationId(), owner,
      resource: target.resource, generation: target.metadata!.generation, dependsOn: [], kind: 'relation', relation: 'series-membership', edits: [
        { resource: target.resource, generation: target.metadata!.generation, beforeItems: [], afterItems: [
          { id: 'member', type: 'sermon', refId: member.resource.id, position: 1 },
        ] },
      ] });
    const commands = [attach(first), attach(second)];
    const results = await Promise.all(commands.map(command => processCommand(owner, command)));
    expect(results.map(result => result.kind).sort()).toEqual(['acknowledged', 'refused']);
    expect(results.find(result => result.kind === 'refused')).toMatchObject({ code: 'membership-already-assigned' });
    await Promise.all(commands.map(command => processCommand(owner, command)));
    const stored = await Promise.all([first, second].map(target => readDocument(owner, target.resource)));
    expect(stored.reduce((count, snapshot) => count + (snapshot.value!.items as unknown[]).length, 0)).toBe(1);
  });

  it('delivers two explicit offline saves after restart without opening the editor and retains unsaved typing', async () => {
    const initial = await seed('closed-successor');
    const checkpointRows = new Map<string, EditorRecord>();
    const journalRows = new Map<string, JournalEntry>();
    const cache = new Map<string, ResourceSnapshot>([[initial.resource.id, initial]]);
    const commits = createMemoryCommitStore();
    const checkpoints: CheckpointStore = {
      read: async (_owner, id) => { const row = checkpointRows.get(id); return row && clone(row); },
      put: async record => { checkpointRows.set(record.editorId, clone(record)); },
    };
    const journal: JournalStore = {
      list: async selected => clone([...journalRows.values()].filter(row => row.command.owner === selected)),
      put: async row => { journalRows.set(row.command.operationId, clone(row)); },
      remove: async (_owner, id) => { journalRows.delete(id); },
    };
    const snapshots: SnapshotStore = {
      read: async (_owner, resource) => { const row = cache.get(resource.id); return row && clone(row); },
      put: async (_owner, snapshot) => { cache.set(snapshot.resource.id, clone(snapshot)); },
    };
    const sent: DataCommand[] = [];
    const transport: EngineTransport = {
      read: readDocument,
      send: async command => { sent.push(clone(command)); return processCommand(command.owner, command); },
    };
    const errors: unknown[] = [];
    const start = () => {
      const runtime = new DataEngineRuntime({ journal, transport });
      const observer = new ResourceObserver({ transport, source: { listen: () => () => undefined } });
      const engine = new DataEngine({ runtime, observer, transport, snapshots, checkpoints, commits,
        operationId, onError: error => { errors.push(error); } });
      engine.setOnline(false); engine.setOwner(owner);
      return engine;
    };
    const first = start();
    let restarted: DataEngine | undefined;
    try {
      const editor = await first.openEditor(initial.resource, 'closed-editor');
      await editor.commit(current => ({ ...current, title: 'Save A' }));
      await editor.commit(current => ({ ...current, title: 'Save B' }));
      await editor.edit({ ...editor.getState().checkpoint.draft!, title: 'Unsaved C' });
      expect(sent).toHaveLength(0);
      editor.dispose(); first.dispose();
      restarted = start();
      restarted.setOnline(true);
      await restarted.retry();
      expect(sent).toHaveLength(2);
      expect((await readDocument(owner, initial.resource)).value?.title).toBe('Save B');
      expect(checkpointRows.get('closed-editor')?.checkpoint.draft?.title).toBe('Unsaved C');
      expect(journalRows.size).toBe(0);
      const reopened = await restarted.openEditor(initial.resource, 'closed-editor');
      expect(reopened.getState().checkpoint.draft?.title).toBe('Unsaved C');
      expect(reopened.getState().checkpoint.conflicts).toEqual([]);
      await reopened.save();
      await restarted.retry();
      expect((await readDocument(owner, initial.resource)).value?.title).toBe('Unsaved C');
      expect(errors).toEqual([]);
    } finally { first.dispose(); restarted?.dispose(); }
  });

  it('merges two offline devices editing different existing scratch notes', async () => {
    const initial = await seed('siblings');
    const laptop = device(initial), tablet = device(initial);
    const a = await laptop.open(), b = await tablet.open();
    await a.edit({ ...initial.value!, scratch: [note('a', 'Laptop A'), note('b', 'B')] });
    await b.edit({ ...initial.value!, scratch: [note('a', 'A'), note('b', 'Tablet B')] });
    await a.save(); await b.save();
    expect((await readDocument(owner, initial.resource)).value!.scratch).toEqual(baseValue().scratch);
    await Promise.all([laptop.deliver(a), tablet.deliver(b)]);
    const result = await readDocument(owner, initial.resource);
    expect(result.value!.scratch).toEqual([note('a', 'Laptop A'), note('b', 'Tablet B')]);
    expect(result.metadata!.revision).toBe(3);
    expect(a.getState().checkpoint.pending).toEqual({}); expect(b.getState().checkpoint.pending).toEqual({});
    a.dispose(); b.dispose();
  });

  it('restarts after a lost ACK without replaying the effect or retiring newer local text', async () => {
    const initial = await seed('lost-ack');
    const original = device(initial), editor = await original.open();
    await editor.edit({ ...initial.value!, title: 'First edit' }); await editor.save();
    original.loseNextAcknowledgement(); await original.deliver(editor);
    expect([...original.entries.values()][0].state).toBe('unknown');
    await editor.edit({ ...initial.value!, title: 'Later unsent draft' }); editor.dispose();
    const restarted = device(initial, original.checkpoints, original.entries), recovered = await restarted.open();
    await restarted.deliver(recovered);
    expect(restarted.commands[0]).toEqual(original.commands[0]);
    expect((await readDocument(owner, initial.resource)).metadata!.revision).toBe(2);
    expect(recovered.getState().checkpoint.draft!.title).toBe('Later unsent draft');
    expect(recovered.getState().checkpoint.dirty).toBe(true);
    await recovered.save(); await restarted.deliver(recovered);
    expect((await readDocument(owner, initial.resource)).value!.title).toBe('Later unsent draft');
    expect((await readDocument(owner, initial.resource)).metadata!.revision).toBe(3);
    recovered.dispose();
  });

  it('preserves both same-field versions and does not resurrect a remotely deleted record', async () => {
    const initial = await seed('conflict'), first = device(initial), second = device(initial);
    const a = await first.open(), b = await second.open();
    await a.edit({ ...initial.value!, title: 'Laptop' }); await b.edit({ ...initial.value!, title: 'Tablet' });
    await a.save(); await b.save(); await first.deliver(a); await second.deliver(b);
    expect(b.getState().result).toMatchObject({ kind: 'conflict' });
    expect(b.getState().checkpoint.draft!.title).toBe('Tablet');
    expect(b.getState().checkpoint.remoteCandidate!.value!.title).toBe('Laptop');
    await b.keepLocal(); await b.save(); await second.deliver(b);
    const current = await readDocument(owner, initial.resource);
    expect(current.value!.title).toBe('Tablet');
    const deleted = await processCommand(owner, { protocol: 1, operationId: operationId(), owner, resource: initial.resource, generation: current.metadata!.generation, dependsOn: [], kind: 'delete', baseline: current.value! });
    expect(deleted.kind).toBe('acknowledged');
    await a.edit({ ...a.getState().checkpoint.draft!, title: 'Stale retry' }); await a.save(); await first.deliver(a);
    expect(a.getState().result).toMatchObject({ kind: 'deleted' });
    expect(a.getState().checkpoint.draft!.title).toBe('Stale retry');
    expect((await readDocument(owner, initial.resource)).metadata!.deleted).toBe(true);
    const changes = await readCollectionChanges(owner, 'sermons', 0, { limit: 100 });
    expect(changes.snapshots.find(item => item.resource.id === initial.resource.id)).toMatchObject({ value: null, metadata: { deleted: true } });
    a.dispose(); b.dispose();
  });
});
