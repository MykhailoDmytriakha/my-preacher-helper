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
  const environment = { ...process.env };
  beforeEach(() => { process.env.DATA_ENGINE_ENABLED = 'true'; });
  afterAll(async () => { process.env = environment; await adminDb.terminate(); });

  it('refuses a dangling thought placement atomically and keeps that refusal immutable on replay', async () => {
    const resource = sermon('thought-integrity');
    const thought = { id: 'thought', text: 'Original', tags: [], date: 'today' };
    const outline = { introduction: [], main: [{ id: 'point', text: 'Point' }], conclusion: [] };
    const initial = await processCommand(owner, { protocol: 1, owner, operationId: operationId(), resource, generation: null, dependsOn: [], kind: 'create',
      value: { ...baseValue(), thoughts: [thought], outline } });
    if (initial.kind !== 'acknowledged') throw new Error('Sermon seed refused');
    const base = { protocol: 1 as const, owner, resource, generation: initial.snapshot.metadata!.generation, dependsOn: [] };
    const deleted = await processCommand(owner, { ...base, operationId: operationId(), kind: 'update', changes: [
      { path: ['outline'], before: { exists: true, value: outline }, after: { exists: true, value: { ...outline, main: [] } } },
    ] });
    if (deleted.kind !== 'acknowledged') throw new Error('Outline edit refused');
    const attempted: DataCommand = { ...base, operationId: operationId(), kind: 'update', changes: [
      { path: ['thoughts'], before: { exists: true, value: [thought] }, after: { exists: true, value: [{ ...thought, text: 'My edit', outlinePointId: 'point' }] } },
      { path: ['structure'], before: { exists: false }, after: { exists: true, value: { introduction: [], main: ['thought'], conclusion: [] } } },
    ] };
    const refused = await processCommand(owner, attempted);
    expect(refused).toMatchObject({ kind: 'refused', code: 'invalid-document' });
    expect(await readDocument(owner, resource)).toEqual(deleted.snapshot);
    await processCommand(owner, { ...base, operationId: operationId(), kind: 'update', changes: [
      { path: ['outline'], before: { exists: true, value: { ...outline, main: [] } }, after: { exists: true, value: outline } },
    ] });
    expect(await processCommand(owner, attempted)).toEqual(refused);
    expect(await processCommand(owner, { ...attempted, operationId: operationId() })).toMatchObject({ kind: 'acknowledged', snapshot: { value: { thoughts: [{ text: 'My edit', outlinePointId: 'point' }] } } });
  });

  it('guards scratch consumption atomically and preserves accepted and conflicting receipts on replay', async () => {
    const initial = await seed('scratch-proposal');
    const base = { protocol: 1 as const, owner, resource: initial.resource, generation: initial.metadata!.generation, dependsOn: [] };
    const command: DataCommand = { ...base, operationId: operationId(), kind: 'update', changes: [
      { path: ['scratch'], before: { exists: true, value: baseValue().scratch }, after: { exists: true, value: [note('b', 'B')] } },
      { path: ['outline'], before: { exists: false }, after: { exists: true, value: { introduction: [], main: [{ id: 'derived', text: 'A' }], conclusion: [] } } },
    ] };
    const remote = await processCommand(owner, { ...base, operationId: operationId(), kind: 'update', changes: [
      { path: ['scratch'], before: { exists: true, value: baseValue().scratch }, after: { exists: true, value: [note('b', 'B')] } },
    ] });
    if (remote.kind !== 'acknowledged') throw new Error('Remote deletion failed');
    const conflict = await processCommand(owner, command);
    expect(conflict).toMatchObject({ kind: 'conflict', conflicts: [{ path: ['scratch', 'a'] }] });
    expect(await readDocument(owner, initial.resource)).toEqual(remote.snapshot);
    await processCommand(owner, { ...base, operationId: operationId(), kind: 'update', changes: [
      { path: ['scratch'], before: { exists: true, value: [note('b', 'B')] }, after: { exists: true, value: baseValue().scratch } },
    ] });
    expect(await processCommand(owner, command)).toEqual(conflict);
    const explicit = { ...command, operationId: operationId() };
    const accepted = await processCommand(owner, explicit); expect(accepted.kind).toBe('acknowledged');
    const after = await readDocument(owner, initial.resource);
    expect((await processCommand(owner, explicit)).kind).toBe('acknowledged');
    expect(await readDocument(owner, initial.resource)).toEqual(after);
  });

  it('atomically creates a sermon in a series and replays a lost response without duplicating either effect', async () => {
    const destination = { collection: 'series', id: `${owner}-create-destination` };
    const seeded = await processCommand(owner, { protocol: 1, owner, operationId: operationId(), resource: destination, generation: null, dependsOn: [], kind: 'create',
      value: { userId: owner, theme: 'Creation target', bookOrTopic: '', status: 'draft', createdAt: 'now', updatedAt: 'now', items: [], sermonIds: [] } });
    if (seeded.kind !== 'acknowledged') throw new Error('Series seed failed');
    const resource = sermon('atomic-create');
    const command: DataCommand = { protocol: 1, owner, operationId: operationId(), resource, generation: null, dependsOn: [], kind: 'relation',
      relation: 'series-member-create', value: baseValue(), edit: { resource: destination, generation: seeded.snapshot.metadata!.generation,
        beforeItems: [], afterItems: [{ id: 'created-member', type: 'sermon', refId: resource.id, position: 1 }] } };
    const accepted = await processCommand(owner, command);
    expect(accepted).toMatchObject({ kind: 'acknowledged', snapshot: { metadata: { revision: 1 } }, affected: [{ resource: destination, metadata: { revision: 2 } }] });
    if (accepted.kind !== 'acknowledged') throw new Error('Atomic creation refused');
    await processCommand(owner, { protocol: 1, owner, operationId: operationId(), resource, generation: accepted.snapshot.metadata!.generation, dependsOn: [], kind: 'update',
      changes: [{ path: ['title'], before: { exists: true, value: 'Sermon' }, after: { exists: true, value: 'Later title' } }] });
    const replay = await processCommand(owner, command);
    expect(replay).toMatchObject({ kind: 'acknowledged', snapshot: { value: { title: 'Later title' }, metadata: { revision: 2 } },
      committed: { revision: 1 }, affected: [{ resource: destination, metadata: { revision: 2 } }] });
    expect((await readDocument(owner, destination)).value?.items).toHaveLength(1);
    expect((await readDocument(owner, destination)).metadata?.revision).toBe(2);
  });

  it.each(['deleted', 'unserved'])('leaves no new sermon when its destination is %s', async mode => {
    const destination = { collection: 'series', id: `${owner}-create-${mode}` }, resource = sermon(`atomic-${mode}`);
    const value = { userId: owner, theme: mode, bookOrTopic: '', status: 'draft', createdAt: 'now', updatedAt: 'now', items: [], sermonIds: [] };
    if (mode === 'unserved') await adminDb.collection('series').doc(destination.id).set(value);
    process.env.DATA_ENGINE_ENABLED = mode === 'deleted' ? 'true' : 'false'; process.env.DATA_ENGINE_COLLECTIONS = 'sermons';
    const command: DataCommand = { protocol: 1, owner, operationId: operationId(), resource, generation: null, dependsOn: [], kind: 'relation',
      relation: 'series-member-create', value: baseValue(), edit: { resource: destination, generation: null, beforeItems: [],
        afterItems: [{ id: 'created-member', type: 'sermon', refId: resource.id, position: 1 }] } };
    expect(await processCommand(owner, command)).toMatchObject({ kind: 'refused', code: mode === 'deleted' ? 'referenced-document-deleted' : 'related-collection-not-enabled' });
    expect((await adminDb.collection('sermons').doc(resource.id).get()).exists).toBe(false);
    if (mode === 'unserved') expect((await adminDb.collection('series').doc(destination.id).get()).data()).toEqual(value);
  });

  it('refuses an actual cascade into an unserved domain without marking either document', async () => {
    const group = { collection: 'groups', id: `${owner}-rollout-group` };
    const series = { collection: 'series', id: `${owner}-rollout-series` };
    const value = { userId: owner, title: 'Group', templates: [], flow: [] };
    const linked = { userId: owner, items: [{ id: 'member', type: 'group', refId: group.id, position: 1 }], sermonIds: [] };
    await adminDb.collection(group.collection).doc(group.id).set(value);
    await adminDb.collection(series.collection).doc(series.id).set(linked);
    process.env.DATA_ENGINE_ENABLED = 'false'; process.env.DATA_ENGINE_COLLECTIONS = 'groups';
    expect(await processCommand(owner, { protocol: 1, owner, operationId: operationId(), resource: group,
      generation: null, dependsOn: [], kind: 'delete', baseline: value })).toMatchObject({ kind: 'refused', code: 'related-collection-not-enabled' });
    expect((await adminDb.collection(group.collection).doc(group.id).get()).data()).toEqual(value);
    expect((await adminDb.collection(series.collection).doc(series.id).get()).data()).toEqual(linked);
  });

  it('replays both participants of an atomic relation with current content and compact proof', async () => {
    const material = { collection: 'studyMaterials', id: `${owner}-ack-material` };
    const note = { collection: 'studyNotes', id: `${owner}-ack-note` };
    await adminDb.collection(material.collection).doc(material.id).set({ userId: owner, noteIds: [] });
    await adminDb.collection(note.collection).doc(note.id).set({ userId: owner, content: 'Original text', materialIds: [] });
    const command: DataCommand = { protocol: 1, operationId: operationId(), owner, resource: material, generation: null,
      dependsOn: [], kind: 'relation', relation: 'material-notes', beforeNoteIds: [], afterNoteIds: [note.id], targets: [{ id: note.id, generation: null }] };
    const accepted = await processCommand(owner, command);
    if (accepted.kind !== 'acknowledged') throw new Error('Expected atomic acknowledgement');
    const secondary = accepted.relatedSnapshots![0];
    expect(secondary).toMatchObject({ resource: note, value: { materialIds: [material.id], content: 'Original text' } });
    const noChange: DataCommand = { ...command, operationId: operationId(), generation: accepted.snapshot.metadata!.generation,
      beforeNoteIds: [note.id], targets: [{ id: note.id, generation: secondary.metadata!.generation }] };
    const satisfied = await processCommand(owner, noChange);
    expect(satisfied).toMatchObject({ kind: 'acknowledged', committed: { operationId: noChange.operationId, revision: 2 } });
    expect(await processCommand(owner, noChange)).toEqual(satisfied);
    await processCommand(owner, { protocol: 1, operationId: operationId(), owner, resource: note, generation: secondary.metadata!.generation,
      dependsOn: [], kind: 'update', changes: [{ path: ['content'], before: { exists: true, value: 'Original text' }, after: { exists: true, value: 'Later remote text' } }] });
    const replay = await processCommand(owner, command);
    expect(replay).toMatchObject({ kind: 'acknowledged', affected: [{ metadata: { revision: 1 } }],
      relatedSnapshots: [{ resource: note, value: { content: 'Later remote text', materialIds: [material.id] }, metadata: { revision: 2 } }] });
    expect((await readDocument(owner, material)).metadata?.revision).toBe(2);
  });

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

  it('commits one competing series move and proves even a converged secondary participant on replay', async () => {
    const member = await seed('atomic-move-member');
    const item = { id: 'move-member', type: 'sermon', refId: member.resource.id, position: 1 };
    const create = async (id: string, occupied = false) => {
      const resource = { collection: 'series', id: `${owner}-atomic-${id}` };
      const result = await processCommand(owner, { protocol: 1, operationId: operationId(), owner, resource, generation: null, dependsOn: [], kind: 'create',
        value: { userId: owner, theme: id, bookOrTopic: '', status: 'draft', createdAt: 'now', updatedAt: 'now', items: occupied ? [item] : [] } });
      if (result.kind !== 'acknowledged') throw new Error('Expected series creation'); return result.snapshot;
    };
    const source = await create('source', true), a = await create('a'), b = await create('b');
    const move = (target: ResourceSnapshot): DataCommand => ({ protocol: 1, operationId: operationId(), owner, resource: source.resource,
      generation: source.metadata!.generation, dependsOn: [], kind: 'relation', relation: 'series-membership', edits: [
        { resource: source.resource, generation: source.metadata!.generation, beforeItems: [item], afterItems: [] },
        { resource: target.resource, generation: target.metadata!.generation, beforeItems: [], afterItems: [item] },
      ] });
    const commands = [move(a), move(b)];
    const outcomes = await Promise.all(commands.map(command => processCommand(owner, command)));
    expect(outcomes.map(result => result.kind).sort()).toEqual(['acknowledged', 'refused']);
    const winner = outcomes.findIndex(result => result.kind === 'acknowledged');
    const target = [a, b][winner];
    const satisfied = { ...commands[winner], operationId: operationId() };
    const result = await processCommand(owner, satisfied);
    expect(result).toMatchObject({ kind: 'acknowledged', snapshot: { metadata: { revision: 3 } },
      affected: [{ resource: target.resource, metadata: { revision: 3, operationId: satisfied.operationId } }],
      relatedSnapshots: [{ resource: target.resource, value: { items: [item] }, metadata: { revision: 3 } }] });
    expect(await processCommand(owner, satisfied)).toEqual(result);
    expect((await readDocument(owner, source.resource)).value!.items).toEqual([]);
    const targets = await Promise.all([a, b].map(snapshot => readDocument(owner, snapshot.resource)));
    expect(targets.reduce((count, snapshot) => count + (snapshot.value!.items as unknown[]).length, 0)).toBe(1);
  });

  it('collects members from several source series in one proven multi-participant transaction', async () => {
    const members = await Promise.all([seed('bulk-first'), seed('bulk-second')]);
    const items = members.map((snapshot, index) => ({ id: `bulk-${index}`, type: 'sermon', refId: snapshot.resource.id, position: index + 1 }));
    const initial = await Promise.all(['first', 'second', 'target'].map(async (name, index) => {
      const resource = { collection: 'series', id: `${owner}-bulk-${name}` };
      const result = await processCommand(owner, { protocol: 1, operationId: operationId(), owner, resource, generation: null, dependsOn: [], kind: 'create',
        value: { userId: owner, theme: name, bookOrTopic: '', status: 'draft', createdAt: 'now', updatedAt: 'now', items: index < 2 ? [items[index]] : [] } });
      if (result.kind !== 'acknowledged') throw new Error('Expected bulk fixture'); return result.snapshot;
    }));
    const command: DataCommand = { protocol: 1, operationId: operationId(), owner, resource: initial[0].resource,
      generation: initial[0].metadata!.generation, dependsOn: [], kind: 'relation', relation: 'series-membership',
      edits: initial.map((snapshot, index) => ({ resource: snapshot.resource, generation: snapshot.metadata!.generation,
        beforeItems: snapshot.value!.items as never, afterItems: index === 2 ? items : [] })) };
    const result = await processCommand(owner, command);
    expect(result.kind).toBe('acknowledged');
    if (result.kind !== 'acknowledged') return;
    expect(result.affected).toHaveLength(2); expect(result.relatedSnapshots).toHaveLength(2);
    const final = await Promise.all(initial.map(snapshot => readDocument(owner, snapshot.resource)));
    expect(final.map(snapshot => snapshot.value!.items)).toEqual([[], [], items]);
    expect(await processCommand(owner, command)).toEqual(result);
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
